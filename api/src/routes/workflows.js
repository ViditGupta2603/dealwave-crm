import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../db.js';
import { badRequest, notFound } from '../http.js';
import { requireRole } from '../middleware.js';
import { audit } from '../lib/audit.js';
import { assertWithinLimit } from '../lib/limits.js';
import { assertPublicUrl } from '../lib/safeWebhook.js';
import { parseId } from '../resource.js';

export const workflowsRouter = Router();

const condition = z.object({
  field: z.string().min(1).max(80),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'is_empty', 'not_empty', 'changed_to']),
  value: z.any().optional(),
});

const action = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_task'),
    subject: z.string().min(1).max(300),
    due_in_days: z.number().int().min(0).max(365).default(1),
    priority: z.enum(['low', 'normal', 'high']).default('normal'),
  }),
  z.object({ type: z.literal('update_field'), field: z.string().min(1).max(80), value: z.any() }),
  z.object({ type: z.literal('assign_round_robin') }),
  z.object({ type: z.literal('notify'), title: z.string().min(1).max(200), body: z.string().max(500).optional() }),
  z.object({
    type: z.literal('send_email'),
    to: z.string().min(1).max(200),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(3000),
  }),
  z.object({ type: z.literal('webhook'), url: z.string().url().max(500), secret: z.string().max(200).optional() }),
  z.object({ type: z.literal('add_note'), body: z.string().min(1).max(2000) }),
]);

const ruleSchema = z
  .object({
    name: z.string().trim().min(1, 'Name the automation').max(120),
    description: z.string().max(500).nullish(),
    entity: z.enum(['lead', 'contact', 'account', 'deal']),
    event: z.enum(['created', 'updated', 'stage_changed']),
    conditions: z.array(condition).max(10).default([]),
    actions: z.array(action).min(1, 'Add at least one action').max(10),
    active: z.boolean().default(true),
  })
  .refine((r) => r.event !== 'stage_changed' || r.entity === 'deal', { message: 'Stage changes only apply to deals', path: ['event'] });

async function validateWebhooks(actions) {
  for (const a of actions) {
    if (a.type === 'webhook') {
      try {
        await assertPublicUrl(a.url);
      } catch (e) {
        throw badRequest(e.message, undefined);
      }
    }
  }
}

workflowsRouter.get('/', requireRole('manager'), async (req, res) => {
  const rows = await withTenant(
    req.auth.tenantId,
    async (c) =>
      (
        await c.query(
          `SELECT w.*, (SELECT count(*) FROM workflow_runs r WHERE r.rule_id=w.id AND r.status='failed' AND r.created_at > now() - interval '7 days') AS failed_7d
     FROM workflow_rules w WHERE w.tenant_id=$1 ORDER BY w.created_at DESC`,
          [req.auth.tenantId],
        )
      ).rows,
  );
  res.json(rows);
});

workflowsRouter.get('/runs', requireRole('manager'), async (req, res) => {
  const ruleId = typeof req.query.rule_id === 'string' ? req.query.rule_id : null;
  const rows = await withTenant(
    req.auth.tenantId,
    async (c) =>
      (
        await c.query(
          `SELECT r.*, w.name AS rule_name FROM workflow_runs r JOIN workflow_rules w ON w.id=r.rule_id
     WHERE r.tenant_id=$1 AND ($2::uuid IS NULL OR r.rule_id=$2) ORDER BY r.created_at DESC LIMIT 40`,
          [req.auth.tenantId, ruleId],
        )
      ).rows,
  );
  res.json(rows);
});

workflowsRouter.post('/', requireRole('admin'), async (req, res) => {
  const b = ruleSchema.parse(req.body);
  await validateWebhooks(b.actions);
  const row = await withTenant(req.auth.tenantId, async (c) => {
    await assertWithinLimit(c, req.auth.tenantId, 'workflows');
    const r = (
      await c.query(
        `INSERT INTO workflow_rules (tenant_id,name,description,entity,event,conditions,actions,active,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          req.auth.tenantId,
          b.name,
          b.description ?? null,
          b.entity,
          b.event,
          JSON.stringify(b.conditions),
          JSON.stringify(b.actions),
          b.active,
          req.auth.userId,
        ],
      )
    ).rows[0];
    await audit(c, req.auth.tenantId, req.auth.userId, 'created', 'automation', r.id, r.name);
    return r;
  });
  res.status(201).json(row);
});

workflowsRouter.patch('/:id', requireRole('admin'), async (req, res) => {
  const id = parseId(req.params.id);
  // Quick toggle: { active: boolean }
  if (Object.keys(req.body || {}).length === 1 && typeof req.body.active === 'boolean') {
    const row = await withTenant(req.auth.tenantId, async (c) => {
      const r = (
        await c.query('UPDATE workflow_rules SET active=$3 WHERE tenant_id=$1 AND id=$2 RETURNING *', [
          req.auth.tenantId,
          id,
          req.body.active,
        ])
      ).rows[0];
      if (!r) throw notFound();
      await audit(c, req.auth.tenantId, req.auth.userId, req.body.active ? 'enabled' : 'disabled', 'automation', id, r.name);
      return r;
    });
    return res.json(row);
  }
  const b = ruleSchema.parse(req.body);
  await validateWebhooks(b.actions);
  const row = await withTenant(req.auth.tenantId, async (c) => {
    const r = (
      await c.query(
        `UPDATE workflow_rules SET name=$3,description=$4,entity=$5,event=$6,conditions=$7,actions=$8,active=$9 WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [
          req.auth.tenantId,
          id,
          b.name,
          b.description ?? null,
          b.entity,
          b.event,
          JSON.stringify(b.conditions),
          JSON.stringify(b.actions),
          b.active,
        ],
      )
    ).rows[0];
    if (!r) throw notFound();
    await audit(c, req.auth.tenantId, req.auth.userId, 'updated', 'automation', id, r.name);
    return r;
  });
  res.json(row);
});

workflowsRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  await withTenant(req.auth.tenantId, async (c) => {
    const r = await c.query('DELETE FROM workflow_rules WHERE tenant_id=$1 AND id=$2 RETURNING name', [
      req.auth.tenantId,
      parseId(req.params.id),
    ]);
    if (!r.rowCount) throw notFound();
    await audit(c, req.auth.tenantId, req.auth.userId, 'deleted', 'automation', null, r.rows[0].name);
  });
  res.status(204).end();
});
