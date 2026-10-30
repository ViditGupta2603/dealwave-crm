import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../db.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../http.js';
import { authenticate, invalidateUserCache, requireRole } from '../middleware.js';
import { ROLE_RANK, randomToken, sha256 } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { assertWithinLimit } from '../lib/limits.js';
import { config } from '../config.js';
import { deliverMail } from '../lib/mail.js';
import { withSystem } from '../db.js';
import { parseId } from '../resource.js';

export const teamRouter = Router();

// Anyone signed in can list active teammates (needed for owner pickers).
teamRouter.get('/options', async (req, res) => {
  const rows = await withTenant(
    req.auth.tenantId,
    async (c) =>
      (await c.query('SELECT id,name,role,title FROM users WHERE tenant_id=$1 AND active ORDER BY name', [req.auth.tenantId])).rows,
  );
  res.json(rows);
});

teamRouter.get('/', requireRole('admin'), async (req, res) => {
  const out = await withTenant(req.auth.tenantId, async (c) => ({
    users: (
      await c.query(
        `SELECT u.id,u.name,u.email,u.role,u.title,u.active,u.last_login_at,u.created_at,
        (SELECT count(*) FROM deals d WHERE d.owner_id=u.id AND d.status='open') AS open_deals,
        (SELECT count(*) FROM leads l WHERE l.owner_id=u.id AND l.status NOT IN ('converted','unqualified')) AS open_leads
       FROM users u WHERE u.tenant_id=$1 ORDER BY CASE u.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, u.name`,
        [req.auth.tenantId],
      )
    ).rows,
    invitations: (
      await c.query(
        `SELECT id,email,role,expires_at,created_at FROM invitations WHERE tenant_id=$1 AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
        [req.auth.tenantId],
      )
    ).rows,
  }));
  res.json(out);
});

teamRouter.post('/invite', requireRole('admin'), async (req, res) => {
  const { tenantId, userId, name } = req.auth;
  const body = z
    .object({
      email: z.string().trim().toLowerCase().email('Enter a valid email address'),
      role: z.enum(['admin', 'manager', 'member']),
    })
    .parse(req.body);
  if (body.role === 'admin' && req.auth.role !== 'owner') throw forbidden('Only the owner can invite admins');
  const exists = await withSystem(async (c) => (await c.query('SELECT 1 FROM users WHERE lower(email)=$1', [body.email])).rowCount);
  if (exists) throw conflict('Someone with this email already has an account');
  const token = randomToken(32);
  const tenantName = await withTenant(tenantId, async (c) => {
    await c.query('DELETE FROM invitations WHERE tenant_id=$1 AND lower(email)=$2 AND accepted_at IS NULL', [tenantId, body.email]);
    await assertWithinLimit(c, tenantId, 'users');
    await c.query(
      `INSERT INTO invitations (tenant_id,email,role,token_hash,invited_by,expires_at) VALUES ($1,$2,$3,$4,$5, now() + interval '7 days')`,
      [tenantId, body.email, body.role, sha256(token), userId],
    );
    await audit(c, tenantId, userId, 'invited', 'user', null, `${body.email} as ${body.role}`);
    return (await c.query('SELECT name FROM tenants WHERE id=$1', [tenantId])).rows[0].name;
  });
  const link = `${config.APP_URL.replace(/\/$/, '')}/accept-invite?token=${token}`;
  const mail = await deliverMail({
    tenantId,
    userId,
    to: body.email,
    source: 'invite',
    redactBody: true,
    subject: `${name} invited you to ${tenantName} on Dealwave CRM`,
    body: `${name} invited you to join ${tenantName}.\n\nSet your password and get started:\n${link}\n\nThis link works for 7 days.`,
  });
  res.status(201).json({ invite_link: link, emailed: mail.status === 'sent' });
});

teamRouter.delete('/invitations/:id', requireRole('admin'), async (req, res) => {
  await withTenant(req.auth.tenantId, (c) =>
    c.query('DELETE FROM invitations WHERE tenant_id=$1 AND id=$2', [req.auth.tenantId, parseId(req.params.id)]),
  );
  res.status(204).end();
});

teamRouter.patch('/:id', requireRole('admin'), async (req, res) => {
  const { tenantId, userId, role: myRole } = req.auth;
  const id = parseId(req.params.id);
  const body = z
    .object({
      role: z.enum(['admin', 'manager', 'member']).optional(),
      active: z.boolean().optional(),
      title: z.string().trim().max(120).nullish(),
    })
    .parse(req.body);
  if (id === userId && (body.role !== undefined || body.active !== undefined))
    throw badRequest('You cannot change your own role or access');
  const updated = await withTenant(tenantId, async (c) => {
    const target = (await c.query('SELECT * FROM users WHERE tenant_id=$1 AND id=$2', [tenantId, id])).rows[0];
    if (!target) throw notFound('Teammate not found');
    if (target.role === 'owner') throw forbidden('The workspace owner cannot be changed');
    if (ROLE_RANK[target.role] >= ROLE_RANK[myRole] && myRole !== 'owner') throw forbidden('You can only manage people below your role');
    if (body.role === 'admin' && myRole !== 'owner') throw forbidden('Only the owner can make someone an admin');
    if (body.active === true && !target.active) await assertWithinLimit(c, tenantId, 'users');
    const row = (
      await c.query(
        `UPDATE users SET role=COALESCE($3,role), active=COALESCE($4,active), title=CASE WHEN $5::boolean THEN $6 ELSE title END WHERE tenant_id=$1 AND id=$2
       RETURNING id,name,email,role,title,active`,
        [tenantId, id, body.role ?? null, body.active ?? null, 'title' in body, body.title ?? null],
      )
    ).rows[0];
    await audit(c, tenantId, userId, 'updated', 'user', id, target.name, { role: body.role, active: body.active });
    if (body.active === false) await c.query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [id]);
    return row;
  });
  invalidateUserCache(id);
  res.json(updated);
});

export { authenticate, HttpError };
