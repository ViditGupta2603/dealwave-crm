import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../db.js';
import { notFound } from '../http.js';
import { requireRole } from '../middleware.js';
import { parseId } from '../resource.js';
import { audit } from '../lib/audit.js';
import { deliverMail, mailEnabled } from '../lib/mail.js';
import { ENTITY_KEYS, assertRecordAccess } from '../lib/access.js';
import { recordName } from '../lib/entities.js';
import { publish } from '../lib/realtime.js';

export const emailsRouter = Router();

const entityEnum = z.enum(ENTITY_KEYS);

// ---- Templates ----
emailsRouter.get('/templates', async (req, res) => {
  const rows = await withTenant(
    req.auth.tenantId,
    async (c) =>
      (await c.query('SELECT id,name,subject,body,created_at FROM email_templates WHERE tenant_id=$1 ORDER BY name', [req.auth.tenantId]))
        .rows,
  );
  res.json(rows);
});

const templateSchema = z.object({
  name: z.string().trim().min(2, 'Give the template a name').max(80),
  subject: z.string().trim().min(1, 'Enter a subject').max(200),
  body: z.string().trim().min(1, 'Write the message').max(10000),
});

emailsRouter.post('/templates', requireRole('manager'), async (req, res) => {
  const { tenantId, userId } = req.auth;
  const b = templateSchema.parse(req.body);
  const row = await withTenant(tenantId, async (c) => {
    const r = (
      await c.query(
        'INSERT INTO email_templates (tenant_id,name,subject,body,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,subject,body,created_at',
        [tenantId, b.name, b.subject, b.body, userId],
      )
    ).rows[0];
    await audit(c, tenantId, userId, 'created', 'email template', r.id, r.name);
    return r;
  });
  res.status(201).json(row);
});

emailsRouter.delete('/templates/:id', requireRole('manager'), async (req, res) => {
  const { tenantId, userId } = req.auth;
  const id = parseId(req.params.id);
  await withTenant(tenantId, async (c) => {
    const r = await c.query('DELETE FROM email_templates WHERE tenant_id=$1 AND id=$2 RETURNING name', [tenantId, id]);
    if (!r.rowCount) throw notFound('Template not found');
    await audit(c, tenantId, userId, 'deleted', 'email template', id, r.rows[0].name);
  });
  res.status(204).end();
});

// ---- Log ----
emailsRouter.get('/', async (req, res) => {
  const { tenantId, userId, role } = req.auth;
  const q = req.query;
  const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(q.limit || '25', 10) || 25));
  const out = await withTenant(tenantId, async (c) => {
    const where = ['e.tenant_id=$1'];
    const params = [tenantId];
    if (q.related_type && q.related_id) {
      const et = entityEnum.parse(q.related_type);
      const id = parseId(q.related_id);
      await assertRecordAccess(c, req.auth, et, id);
      params.push(et, id);
      where.push(`e.related_type=$${params.length - 1} AND e.related_id=$${params.length}`);
    } else if (role === 'member') {
      params.push(userId);
      where.push(`e.user_id=$${params.length}`);
    }
    if (q.status && ['sent', 'simulated', 'failed'].includes(q.status)) {
      params.push(q.status);
      where.push(`e.status=$${params.length}`);
    }
    const w = where.join(' AND ');
    const total = (await c.query(`SELECT count(*)::int AS n FROM email_log e WHERE ${w}`, params)).rows[0].n;
    const rows = (
      await c.query(
        `SELECT e.id,e.to_email,e.subject,e.body,e.status,e.error,e.source,e.related_type,e.related_id,e.created_at,u.name AS sender_name
       FROM email_log e LEFT JOIN users u ON u.id=e.user_id WHERE ${w} ORDER BY e.created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        params,
      )
    ).rows;
    return { data: rows, total };
  });
  res.json({ ...out, smtp_configured: mailEnabled });
});

// ---- Send ----
const sendSchema = z.object({
  to: z.string().trim().toLowerCase().email('Enter a valid email address').max(200),
  subject: z.string().trim().min(1, 'Enter a subject').max(200),
  body: z.string().trim().min(1, 'Write the message').max(10000),
  related_type: entityEnum.nullish(),
  related_id: z.string().uuid().nullish(),
});

emailsRouter.post('/send', async (req, res) => {
  const b = sendSchema.parse(req.body);
  const { tenantId, userId } = req.auth;
  const rec = await withTenant(tenantId, async (c) =>
    b.related_type && b.related_id ? assertRecordAccess(c, req.auth, b.related_type, b.related_id) : null,
  );
  const r = await deliverMail({
    tenantId,
    userId,
    to: b.to,
    subject: b.subject,
    body: b.body,
    source: 'manual',
    relatedType: b.related_type ?? null,
    relatedId: b.related_id ?? null,
  });
  if (r.status === 'failed') return res.status(502).json({ error: `The email could not be delivered: ${r.error}` });
  if (rec && b.related_type && b.related_id) {
    // Put it on the record's timeline too, so the whole team can see it.
    await withTenant(tenantId, (c) =>
      c.query(
        `INSERT INTO activities (tenant_id,type,subject,notes,related_type,related_id,owner_id,completed_at) VALUES ($1,'email',$2,$3,$4,$5,$6,now())`,
        [
          tenantId,
          `Emailed ${recordName(b.related_type, rec) || b.to}: ${b.subject}`.slice(0, 200),
          b.body.slice(0, 500),
          b.related_type,
          b.related_id,
          userId,
        ],
      ),
    );
  }
  if (rec && b.related_type && b.related_id)
    publish(tenantId, {
      type: 'record',
      entity: b.related_type,
      id: b.related_id,
      action: 'emails',
      owner_id: rec.owner_id ?? null,
      by_user_id: userId,
      by_name: req.auth.name,
    });
  res.status(201).json({ status: r.status });
});
