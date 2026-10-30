import { Router } from 'express';
import { createOrder, rzpEnabled, rzpKeyId, verifyPaymentSignature } from '../lib/razorpay.js';
import { applyPaidPayment } from '../lib/billing.js';
import { z } from 'zod';
import { withTenant } from '../db.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../http.js';
import { requireRole } from '../middleware.js';
import { audit } from '../lib/audit.js';
import { PLANS } from '../plans.js';
import { getPlan, usage } from '../lib/limits.js';
import { parseId } from '../resource.js';

// ---------------- Pipeline stages ----------------
export const pipelineRouter = Router();
const stageSchema = z
  .object({
    name: z.string().trim().min(1, 'Name the stage').max(60),
    probability: z.number().int().min(0).max(100),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #0F6B5C'),
    is_won: z.boolean().default(false),
    is_lost: z.boolean().default(false),
  })
  .refine((s) => !(s.is_won && s.is_lost), { message: 'A stage cannot be both won and lost' });

pipelineRouter.get('/stages', async (req, res) => {
  const rows = await withTenant(
    req.auth.tenantId,
    async (c) =>
      (
        await c.query(
          `SELECT s.*, (SELECT count(*) FROM deals d WHERE d.stage_id=s.id) AS deal_count FROM pipeline_stages s WHERE s.tenant_id=$1 ORDER BY s.position`,
          [req.auth.tenantId],
        )
      ).rows,
  );
  res.json(rows);
});

pipelineRouter.post('/stages', requireRole('admin'), async (req, res) => {
  const b = stageSchema.parse(req.body);
  const row = await withTenant(req.auth.tenantId, async (c) => {
    const pos = (
      await c.query('SELECT COALESCE(MAX(position),-1)+1 AS p FROM pipeline_stages WHERE tenant_id=$1 AND NOT is_won AND NOT is_lost', [
        req.auth.tenantId,
      ])
    ).rows[0].p;
    // Keep won/lost stages at the end: shift them down when a new open stage is added.
    if (!b.is_won && !b.is_lost)
      await c.query('UPDATE pipeline_stages SET position=position+1 WHERE tenant_id=$1 AND (is_won OR is_lost)', [req.auth.tenantId]);
    const total = (await c.query('SELECT COALESCE(MAX(position),-1)+1 AS p FROM pipeline_stages WHERE tenant_id=$1', [req.auth.tenantId]))
      .rows[0].p;
    const r = (
      await c.query(
        'INSERT INTO pipeline_stages (tenant_id,name,position,probability,color,is_won,is_lost) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [req.auth.tenantId, b.name, b.is_won || b.is_lost ? total : pos, b.probability, b.color, b.is_won, b.is_lost],
      )
    ).rows[0];
    await audit(c, req.auth.tenantId, req.auth.userId, 'created', 'stage', r.id, r.name);
    return r;
  });
  res.status(201).json(row);
});

pipelineRouter.patch('/stages/reorder', requireRole('admin'), async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(req.body);
  await withTenant(req.auth.tenantId, async (c) => {
    for (let i = 0; i < ids.length; i++)
      await c.query('UPDATE pipeline_stages SET position=$3 WHERE tenant_id=$1 AND id=$2', [req.auth.tenantId, ids[i], i]);
  });
  res.status(204).end();
});

pipelineRouter.patch('/stages/:id', requireRole('admin'), async (req, res) => {
  const b = stageSchema.parse(req.body);
  const id = parseId(req.params.id);
  const row = await withTenant(req.auth.tenantId, async (c) => {
    const r = (
      await c.query(
        'UPDATE pipeline_stages SET name=$3,probability=$4,color=$5,is_won=$6,is_lost=$7 WHERE tenant_id=$1 AND id=$2 RETURNING *',
        [req.auth.tenantId, id, b.name, b.probability, b.color, b.is_won, b.is_lost],
      )
    ).rows[0];
    if (!r) throw notFound('Stage not found');
    await c.query(
      `UPDATE deals SET status = CASE WHEN $3 THEN 'won' WHEN $4 THEN 'lost' ELSE 'open' END,
      closed_at = CASE WHEN $3 OR $4 THEN COALESCE(closed_at, now()) ELSE NULL END WHERE tenant_id=$1 AND stage_id=$2`,
      [req.auth.tenantId, id, b.is_won, b.is_lost],
    );
    await audit(c, req.auth.tenantId, req.auth.userId, 'updated', 'stage', id, r.name);
    return r;
  });
  res.json(row);
});

pipelineRouter.delete('/stages/:id', requireRole('admin'), async (req, res) => {
  const id = parseId(req.params.id);
  await withTenant(req.auth.tenantId, async (c) => {
    const n = (await c.query('SELECT count(*) AS n FROM deals WHERE stage_id=$1', [id])).rows[0].n;
    if (n > 0) throw conflict(`This stage has ${n} deal${n === 1 ? '' : 's'}. Move them to another stage first.`);
    const open = (
      await c.query('SELECT count(*) AS n FROM pipeline_stages WHERE tenant_id=$1 AND NOT is_won AND NOT is_lost AND id<>$2', [
        req.auth.tenantId,
        id,
      ])
    ).rows[0].n;
    if (open < 1) throw badRequest('Keep at least one open stage');
    const r = await c.query('DELETE FROM pipeline_stages WHERE tenant_id=$1 AND id=$2 RETURNING name', [req.auth.tenantId, id]);
    if (!r.rowCount) throw notFound('Stage not found');
    await audit(c, req.auth.tenantId, req.auth.userId, 'deleted', 'stage', id, r.rows[0].name);
  });
  res.status(204).end();
});

// ---------------- Custom fields ----------------
export const fieldsRouter = Router();
const fieldSchema = z
  .object({
    entity: z.enum(['lead', 'contact', 'account', 'deal']),
    key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use lowercase letters, numbers and underscores (2-40 characters)'),
    label: z.string().trim().min(1, 'Add a label').max(80),
    type: z.enum(['text', 'number', 'date', 'select', 'boolean']),
    options: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
    required: z.boolean().default(false),
  })
  .refine((f) => f.type !== 'select' || f.options.length > 0, { message: 'Add at least one option', path: ['options'] });

fieldsRouter.get('/', async (req, res) => {
  const entity = typeof req.query.entity === 'string' ? req.query.entity : null;
  const rows = await withTenant(
    req.auth.tenantId,
    async (c) =>
      (
        await c.query(
          `SELECT * FROM field_definitions WHERE tenant_id=$1 AND ($2::text IS NULL OR entity=$2) ORDER BY entity, position, created_at`,
          [req.auth.tenantId, entity],
        )
      ).rows,
  );
  res.json(rows);
});

fieldsRouter.post('/', requireRole('admin'), async (req, res) => {
  const b = fieldSchema.parse(req.body);
  const row = await withTenant(req.auth.tenantId, async (c) => {
    const pos = (
      await c.query('SELECT COALESCE(MAX(position),-1)+1 AS p FROM field_definitions WHERE tenant_id=$1 AND entity=$2', [
        req.auth.tenantId,
        b.entity,
      ])
    ).rows[0].p;
    const r = (
      await c.query(
        'INSERT INTO field_definitions (tenant_id,entity,key,label,type,options,required,position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [req.auth.tenantId, b.entity, b.key, b.label, b.type, JSON.stringify(b.options), b.required, pos],
      )
    ).rows[0];
    await audit(c, req.auth.tenantId, req.auth.userId, 'created', 'field', r.id, `${b.entity}.${b.key}`);
    return r;
  }).catch((e) => {
    if (e.code === '23505') throw conflict('A field with this key already exists on this object');
    throw e;
  });
  res.status(201).json(row);
});

fieldsRouter.patch('/:id', requireRole('admin'), async (req, res) => {
  const b = z
    .object({
      label: z.string().trim().min(1).max(80),
      options: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
      required: z.boolean().default(false),
    })
    .parse(req.body);
  const row = await withTenant(
    req.auth.tenantId,
    async (c) =>
      (
        await c.query('UPDATE field_definitions SET label=$3, options=$4, required=$5 WHERE tenant_id=$1 AND id=$2 RETURNING *', [
          req.auth.tenantId,
          parseId(req.params.id),
          b.label,
          JSON.stringify(b.options),
          b.required,
        ])
      ).rows[0],
  );
  if (!row) throw notFound();
  res.json(row);
});

fieldsRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  await withTenant(req.auth.tenantId, async (c) => {
    const r = await c.query('DELETE FROM field_definitions WHERE tenant_id=$1 AND id=$2 RETURNING entity,key', [
      req.auth.tenantId,
      parseId(req.params.id),
    ]);
    if (!r.rowCount) throw notFound();
    await audit(c, req.auth.tenantId, req.auth.userId, 'deleted', 'field', null, `${r.rows[0].entity}.${r.rows[0].key}`);
  });
  res.status(204).end();
});

// ---------------- Notifications ----------------
export const notificationsRouter = Router();
notificationsRouter.get('/', async (req, res) => {
  const out = await withTenant(req.auth.tenantId, async (c) => ({
    data: (
      await c.query(
        'SELECT id,title,body,link,read_at,created_at FROM notifications WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 30',
        [req.auth.tenantId, req.auth.userId],
      )
    ).rows,
    unread: (
      await c.query('SELECT count(*) AS n FROM notifications WHERE tenant_id=$1 AND user_id=$2 AND read_at IS NULL', [
        req.auth.tenantId,
        req.auth.userId,
      ])
    ).rows[0].n,
  }));
  res.json(out);
});
notificationsRouter.post('/read-all', async (req, res) => {
  await withTenant(req.auth.tenantId, (c) =>
    c.query('UPDATE notifications SET read_at=now() WHERE tenant_id=$1 AND user_id=$2 AND read_at IS NULL', [
      req.auth.tenantId,
      req.auth.userId,
    ]),
  );
  res.status(204).end();
});
notificationsRouter.post('/:id/read', async (req, res) => {
  await withTenant(req.auth.tenantId, (c) =>
    c.query('UPDATE notifications SET read_at=now() WHERE tenant_id=$1 AND user_id=$2 AND id=$3', [
      req.auth.tenantId,
      req.auth.userId,
      parseId(req.params.id),
    ]),
  );
  res.status(204).end();
});

// ---------------- Audit log ----------------
export const auditRouter = Router();
auditRouter.get('/', requireRole('manager'), async (req, res) => {
  const q = req.query;
  const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
  const limit = Math.min(100, parseInt(q.limit || '30', 10) || 30);
  const params = [req.auth.tenantId];
  let where = 'a.tenant_id=$1';
  if (q.entity) {
    params.push(q.entity);
    where += ` AND a.entity=$${params.length}`;
  }
  if (q.entity_id) {
    params.push(q.entity_id);
    where += ` AND a.entity_id=$${params.length}`;
  }
  if (q.user_id) {
    params.push(q.user_id);
    where += ` AND a.user_id=$${params.length}`;
  }
  params.push(limit, (page - 1) * limit);
  const rows = await withTenant(
    req.auth.tenantId,
    async (c) =>
      (
        await c.query(
          `SELECT a.*, u.name AS user_name, count(*) OVER() AS _total FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
     WHERE ${where} ORDER BY a.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        )
      ).rows,
  );
  res.json({ data: rows.map(({ _total, ...r }) => r), total: rows[0]?._total ?? 0, page, limit });
});

// ---------------- Global search ----------------
export const searchRouter = Router();
searchRouter.get('/', async (req, res) => {
  const term = String(req.query.q || '').trim();
  if (term.length < 2) return res.json([]);
  const like = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
  const { tenantId, userId, role } = req.auth;
  const own = role === 'member' ? ' AND owner_id=$3' : '';
  const params = role === 'member' ? [tenantId, like, userId] : [tenantId, like];
  const out = await withTenant(tenantId, async (c) => {
    const [l, ct, a, d] = await Promise.all([
      c.query(
        `SELECT id, concat_ws(' ', first_name, last_name) AS title, company AS subtitle FROM leads WHERE tenant_id=$1 AND (first_name ILIKE $2 OR last_name ILIKE $2 OR company ILIKE $2 OR email ILIKE $2)${own} ORDER BY created_at DESC LIMIT 5`,
        params,
      ),
      c.query(
        `SELECT id, concat_ws(' ', first_name, last_name) AS title, email AS subtitle FROM contacts WHERE tenant_id=$1 AND (first_name ILIKE $2 OR last_name ILIKE $2 OR email ILIKE $2)${own} ORDER BY created_at DESC LIMIT 5`,
        params,
      ),
      c.query(
        `SELECT id, name AS title, industry AS subtitle FROM accounts WHERE tenant_id=$1 AND (name ILIKE $2)${own} ORDER BY created_at DESC LIMIT 5`,
        params,
      ),
      c.query(
        `SELECT id, name AS title, status AS subtitle FROM deals WHERE tenant_id=$1 AND (name ILIKE $2)${own} ORDER BY created_at DESC LIMIT 5`,
        params,
      ),
    ]);
    return [
      ...l.rows.map((r) => ({ ...r, type: 'lead' })),
      ...ct.rows.map((r) => ({ ...r, type: 'contact' })),
      ...a.rows.map((r) => ({ ...r, type: 'account' })),
      ...d.rows.map((r) => ({ ...r, type: 'deal' })),
    ];
  });
  res.json(out);
});

// ---------------- Billing / plan ----------------
export const billingRouter = Router();
billingRouter.get('/', requireRole('admin'), async (req, res) => {
  const out = await withTenant(req.auth.tenantId, async (c) => ({
    plan: (await getPlan(c, req.auth.tenantId)).id,
    usage: await usage(c, req.auth.tenantId),
    plans: Object.values(PLANS),
    // "razorpay" when RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set; otherwise plan changes are applied directly.
    payment_gateway: rzpEnabled() ? 'razorpay' : 'not_configured',
    plan_paid_until:
      (await c.query('SELECT plan_paid_until FROM tenants WHERE id=$1', [req.auth.tenantId])).rows[0]?.plan_paid_until ?? null,
    payments: (
      await c.query(
        `SELECT id, plan, amount_paise, status, razorpay_order_id, created_at, paid_at FROM payments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 12`,
        [req.auth.tenantId],
      )
    ).rows,
  }));
  res.json(out);
});

billingRouter.post('/checkout', async (req, res) => {
  if (req.auth.role !== 'owner') throw forbidden('Only the workspace owner can change the plan');
  if (!rzpEnabled()) throw badRequest('Online payments are not set up on this server');
  const { plan } = z.object({ plan: z.enum(['pro', 'enterprise']) }).parse(req.body);
  const { tenantId, userId } = req.auth;
  const amountPaise = (PLANS[plan].priceMonthly ?? 0) * 100;
  const order = await createOrder({
    amountPaise,
    receipt: `dealwave_${tenantId.slice(0, 8)}_${Date.now()}`,
    notes: { tenant_id: tenantId, plan },
  });
  const prefill = await withTenant(tenantId, async (c) => {
    await c.query('INSERT INTO payments (tenant_id,plan,amount_paise,razorpay_order_id,created_by) VALUES ($1,$2,$3,$4,$5)', [
      tenantId,
      plan,
      amountPaise,
      order.id,
      userId,
    ]);
    return (
      await c.query('SELECT u.name, u.email, t.name AS tenant FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.id=$1', [userId])
    ).rows[0];
  });
  res
    .status(201)
    .json({
      key_id: rzpKeyId(),
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      plan_name: PLANS[plan].name,
      prefill: { name: prefill.name, email: prefill.email },
      company: prefill.tenant,
    });
});

billingRouter.post('/verify', async (req, res) => {
  if (req.auth.role !== 'owner') throw forbidden('Only the workspace owner can change the plan');
  const b = z
    .object({
      razorpay_order_id: z.string().min(5).max(80),
      razorpay_payment_id: z.string().min(5).max(80),
      razorpay_signature: z.string().min(10).max(200),
    })
    .parse(req.body);
  const { tenantId, userId } = req.auth;
  const result = await withTenant(tenantId, async (c) => {
    const pay = (await c.query('SELECT * FROM payments WHERE tenant_id=$1 AND razorpay_order_id=$2', [tenantId, b.razorpay_order_id]))
      .rows[0];
    if (!pay) throw new HttpError(404, 'We could not find that payment');
    if (!verifyPaymentSignature(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature))
      throw badRequest('The payment could not be verified. If money was taken, it will be matched automatically within a few minutes.');
    await applyPaidPayment(c, pay, b.razorpay_payment_id, userId);
    return { plan: pay.plan };
  });
  res.json(result);
});

billingRouter.post('/plan', async (req, res) => {
  if (req.auth.role !== 'owner') throw forbidden('Only the workspace owner can change the plan');
  const { plan } = z.object({ plan: z.enum(['free', 'pro', 'enterprise']) }).parse(req.body);
  if (plan !== 'free' && rzpEnabled()) throw badRequest('Paid plans are bought through checkout');
  await withTenant(req.auth.tenantId, async (c) => {
    const next = PLANS[plan];
    const u = await usage(c, req.auth.tenantId);
    for (const k of ['users', 'records', 'workflows']) {
      const max = next.limits[k];
      if (max !== null && u[k] > max)
        throw badRequest(`You have ${u[k]} ${k}, more than the ${next.name} plan allows (${max}). Reduce usage before downgrading.`);
    }
    await c.query('UPDATE tenants SET plan=$2 WHERE id=$1', [req.auth.tenantId, plan]);
    await audit(c, req.auth.tenantId, req.auth.userId, 'changed_plan', 'workspace', req.auth.tenantId, next.name);
  });
  res.json({ plan });
});
