import express, { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../db.js';
import { HttpError, badRequest, forbidden, notFound } from '../http.js';
import { ROLE_RANK } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { ENTITY_KEYS, assertRecordAccess } from '../lib/access.js';
import { parseId } from '../resource.js';
import { publish } from '../lib/realtime.js';

export const attachmentsRouter = Router();

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Only these types are accepted. The type is decided by the extension (never by what the browser claims). */
const TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  csv: 'text/csv',
  txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Checks that the first bytes match the claimed type, so a renamed program cannot pass as a PDF. */
export function signatureOk(ext, buf) {
  const starts = (...b) => b.every((v, i) => buf[i] === v);
  switch (ext) {
    case 'pdf':
      return starts(0x25, 0x50, 0x44, 0x46);
    case 'png':
      return starts(0x89, 0x50, 0x4e, 0x47);
    case 'jpg':
    case 'jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'docx':
    case 'xlsx':
      return starts(0x50, 0x4b);
    default:
      return !buf.subarray(0, 2048).includes(0); // csv / txt: no binary bytes
  }
}

const cleanName = (n) =>
  n
    .replace(/[\\/\u0000-\u001f"<>|:*?]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 150);

const listQuery = z.object({ entity: z.enum(ENTITY_KEYS), entity_id: z.string().uuid('Invalid record') });

attachmentsRouter.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);
  const { tenantId } = req.auth;
  const rows = await withTenant(tenantId, async (c) => {
    await assertRecordAccess(c, req.auth, q.entity, q.entity_id);
    return (
      await c.query(
        `SELECT a.id,a.filename,a.mime_type,a.size_bytes,a.created_at,a.uploaded_by,u.name AS uploaded_by_name
       FROM attachments a LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.tenant_id=$1 AND a.entity=$2 AND a.entity_id=$3 ORDER BY a.created_at DESC`,
        [tenantId, q.entity, q.entity_id],
      )
    ).rows;
  });
  res.json(rows);
});

// Raw bytes in the request body; the file name travels in the query string.
attachmentsRouter.post('/', express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), async (req, res) => {
  const q = listQuery.extend({ filename: z.string().trim().min(1, 'Missing file name').max(200) }).parse(req.query);
  const { tenantId, userId } = req.auth;
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('The file is empty');
  if (body.length > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Files can be up to 5 MB');
  const filename = cleanName(q.filename);
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (!filename.includes('.') || !TYPES[ext])
    throw badRequest('This file type is not allowed. Use PDF, image, Word, Excel, CSV or text files.');
  if (!signatureOk(ext, body)) throw badRequest(`This file does not look like a real .${ext} file`);
  const row = await withTenant(tenantId, async (c) => {
    const rec = await assertRecordAccess(c, req.auth, q.entity, q.entity_id);
    const r = (
      await c.query(
        `INSERT INTO attachments (tenant_id,entity,entity_id,filename,mime_type,size_bytes,data,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id,filename,mime_type,size_bytes,created_at`,
        [tenantId, q.entity, q.entity_id, filename, TYPES[ext], body.length, body, userId],
      )
    ).rows[0];
    await audit(
      c,
      tenantId,
      userId,
      'attached a file to',
      q.entity,
      q.entity_id,
      `${filename} on ${rec.name || [rec.first_name, rec.last_name].filter(Boolean).join(' ')}`,
    );
    return { ...r, owner_id: rec.owner_id ?? null };
  });
  publish(tenantId, {
    type: 'record',
    entity: q.entity,
    id: q.entity_id,
    action: 'files',
    owner_id: row.owner_id,
    by_user_id: userId,
    by_name: req.auth.name,
  });
  const { owner_id: _o, ...out } = row;
  res.status(201).json(out);
});

attachmentsRouter.get('/:id/download', async (req, res) => {
  const id = parseId(req.params.id);
  const { tenantId } = req.auth;
  const row = await withTenant(tenantId, async (c) => {
    const a = (await c.query('SELECT * FROM attachments WHERE tenant_id=$1 AND id=$2', [tenantId, id])).rows[0];
    if (!a) throw notFound('File not found');
    await assertRecordAccess(c, req.auth, a.entity, a.entity_id);
    return a;
  });
  res.set({
    'Content-Type': row.mime_type,
    'Content-Length': String(row.size_bytes),
    'Content-Disposition': `attachment; filename="${row.filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
    'Cache-Control': 'private, no-store',
  });
  res.send(row.data);
});

attachmentsRouter.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const { tenantId, userId, role } = req.auth;
  const gone = await withTenant(tenantId, async (c) => {
    const a = (
      await c.query('SELECT id,entity,entity_id,filename,uploaded_by FROM attachments WHERE tenant_id=$1 AND id=$2', [tenantId, id])
    ).rows[0];
    if (!a) throw notFound('File not found');
    const rec = await assertRecordAccess(c, req.auth, a.entity, a.entity_id);
    if (a.uploaded_by !== userId && ROLE_RANK[role] < ROLE_RANK.manager)
      throw forbidden('Only the uploader or a manager can delete this file');
    await c.query('DELETE FROM attachments WHERE tenant_id=$1 AND id=$2', [tenantId, id]);
    await audit(c, tenantId, userId, 'removed a file from', a.entity, a.entity_id, a.filename);
    return { entity: a.entity, entity_id: a.entity_id, owner_id: rec.owner_id ?? null };
  });
  publish(tenantId, {
    type: 'record',
    entity: gone.entity,
    id: gone.entity_id,
    action: 'files',
    owner_id: gone.owner_id,
    by_user_id: userId,
    by_name: req.auth.name,
  });
  res.status(204).end();
});
