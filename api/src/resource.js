import { Router } from 'express';

import { withTenant } from './db.js';
import { badRequest, forbidden, notFound } from './http.js';
import { ROLE_RANK } from './lib/auth.js';
import { audit, diff } from './lib/audit.js';
import { loadFieldDefs, mergeCustom, validateCustom } from './lib/custom.js';
import { assertWithinLimit } from './lib/limits.js';
import { emitEvent } from './lib/queue.js';

import { publish } from './lib/realtime.js';

const blankToNull = (o) => {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = v === '' ? null : v;
  return out;
};

export function crud(cfg, extend) {
  const r = Router();
  const cols = Object.keys(cfg.schema.shape);
  const scoped = (req) => cfg.ownerScoped && req.auth.role === 'member';

  const selectById = async (c, req, id) => {
    const params = [req.auth.tenantId, id];
    let vis = '';
    if (scoped(req)) {
      params.push(req.auth.userId);
      vis = ' AND t.owner_id = $3';
    }
    const { rows } = await c.query(
      `SELECT t.*${cfg.extraSelect} FROM ${cfg.table} t ${cfg.joins} WHERE t.tenant_id=$1 AND t.id=$2${vis}`,
      params,
    );
    return rows[0];
  };

  r.get('/', async (req, res) => {
    const q = req.query;
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(q.limit || '25', 10) || 25));
    const params = [req.auth.tenantId];
    const where = ['t.tenant_id = $1'];
    if (scoped(req)) {
      params.push(req.auth.userId);
      where.push(`t.owner_id = $${params.length}`);
    }
    for (const f of cfg.filters) {
      let v = q[f];
      if (v === undefined || v === '') continue;
      if (v === 'me' && f === 'owner_id') v = req.auth.userId;
      if (v === 'none') {
        where.push(`t.${f} IS NULL`);
        continue;
      }
      params.push(v);
      where.push(`t.${f}::text = $${params.length}`);
    }
    if (cfg.extraFilters) where.push(...cfg.extraFilters(q, params));
    if (q.q && cfg.search.length) {
      params.push(`%${q.q.trim().replace(/[%_\\]/g, '\\$&')}%`);
      where.push('(' + cfg.search.map((s) => `${s.includes('.') ? s : 't.' + s} ILIKE $${params.length}`).join(' OR ') + ')');
    }
    const sortCol = cfg.sortable.includes(q.sort) ? q.sort : cfg.defaultSort;
    const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
    params.push(limit, (page - 1) * limit);
    const sql = `SELECT t.*${cfg.extraSelect}, count(*) OVER() AS _total FROM ${cfg.table} t ${cfg.joins}
      WHERE ${where.join(' AND ')} ORDER BY ${sortCol.includes('.') ? sortCol : 't.' + sortCol} ${dir} NULLS LAST, t.id LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const rows = await withTenant(req.auth.tenantId, async (c) => (await c.query(sql, params)).rows);
    const total = rows[0]?._total ?? 0;
    res.json({ data: rows.map(({ _total, ...rest }) => rest), total, page, limit });
  });

  extend?.(r);

  r.get('/:id', async (req, res) => {
    const row = await withTenant(req.auth.tenantId, (c) => selectById(c, req, String(req.params.id)));
    if (!row) throw notFound();
    res.json(row);
  });

  r.post('/', async (req, res) => {
    const { tenantId, userId, role } = req.auth;
    const body = blankToNull(req.body);
    const parsed = cfg.schema.parse(body);
    const created = await withTenant(tenantId, async (c) => {
      await assertWithinLimit(c, tenantId, 'records');
      const data = { ...parsed };
      if (cfg.ownerScoped && (!data.owner_id || role === 'member')) data.owner_id = userId;
      if (cfg.hasCustom) data.custom_data = validateCustom(await loadFieldDefs(c, tenantId, cfg.entity), body.custom_data, false);
      const hook = await cfg.beforeSave?.({ c, tenantId, userId, op: 'create', data, before: null });
      Object.assign(data, hook?.patch || {});
      const keys = Object.keys(data).filter((k) => data[k] !== undefined);
      const vals = keys.map((k) => (k === 'custom_data' ? JSON.stringify(data[k]) : data[k]));
      const ins = await c.query(
        `INSERT INTO ${cfg.table} (tenant_id, ${keys.join(',')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(',')}) RETURNING id`,
        [tenantId, ...vals],
      );
      const id = ins.rows[0].id;
      const row = await selectById(c, req, id);
      await audit(c, tenantId, userId, 'created', cfg.entity, id, cfg.label(row));
      await cfg.afterCreate?.(c, tenantId, row);
      return row;
    });
    if (cfg.entity !== 'activity') {
      await emitEvent({ tenantId, entity: cfg.entity, event: 'created', recordId: created.id, before: null, after: created, userId });
    }
    publish(tenantId, {
      type: 'record',
      entity: cfg.entity,
      id: created.id,
      action: 'created',
      owner_id: created.owner_id ?? null,
      by_user_id: userId,
      by_name: req.auth.name,
      label: cfg.label(created),
    });
    res.status(201).json(created);
  });

  r.patch('/:id', async (req, res) => {
    const { tenantId, userId, role } = req.auth;
    const body = blankToNull(req.body);
    const parsed = cfg.schema.partial().parse(body);
    const result = await withTenant(tenantId, async (c) => {
      const before = await selectById(c, req, String(req.params.id));
      if (!before) throw notFound();
      const data = { ...parsed };
      if (role === 'member' && 'owner_id' in data && data.owner_id !== userId) throw forbidden('Only managers can reassign records');
      if (cfg.hasCustom && 'custom_data' in body) {
        const defs = await loadFieldDefs(c, tenantId, cfg.entity);
        const patch = validateCustom(defs, body.custom_data, true);
        const merged = mergeCustom(before.custom_data || {}, patch);
        validateCustom(defs, merged, false);
        data.custom_data = merged;
      }
      const hook = await cfg.beforeSave?.({ c, tenantId, userId, op: 'update', data, before });
      Object.assign(data, hook?.patch || {});
      const keys = Object.keys(data).filter((k) => data[k] !== undefined);
      if (!keys.length) return { after: before, events: [], changed: false };
      const vals = keys.map((k) => (k === 'custom_data' ? JSON.stringify(data[k]) : data[k]));
      await c.query(`UPDATE ${cfg.table} SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(',')} WHERE tenant_id=$1 AND id=$2`, [
        tenantId,
        before.id,
        ...vals,
      ]);
      const after = await selectById(c, req, before.id);
      const changes = diff(
        before,
        after,
        [...cols, 'custom_data'].filter((k) => k !== 'custom_data' || cfg.hasCustom),
      );
      if (Object.keys(changes).length) await audit(c, tenantId, userId, 'updated', cfg.entity, before.id, cfg.label(after), changes);
      return { before, after, events: hook?.events || [], changed: Object.keys(changes).length > 0 };
    });
    if (result.changed && cfg.entity !== 'activity') {
      const base = { tenantId, entity: cfg.entity, recordId: result.after.id, before: result.before, after: result.after, userId };
      await emitEvent({ ...base, event: 'updated' });
      for (const ev of result.events) await emitEvent({ ...base, event: ev });
    }
    if (result.changed) {
      const moved = result.events.includes('stage_changed');
      publish(tenantId, {
        type: 'record',
        entity: cfg.entity,
        id: result.after.id,
        action: moved ? 'moved' : 'updated',
        owner_id: result.after.owner_id ?? null,
        by_user_id: userId,
        by_name: req.auth.name,
        label: cfg.label(result.after),
        detail: moved ? (result.after.stage_name ?? null) : null,
      });
    }
    res.json(result.after);
  });

  r.delete('/:id', async (req, res) => {
    const { tenantId, userId, role } = req.auth;
    const min = cfg.deleteRole || 'manager';
    const own = cfg.entity === 'activity';
    if (ROLE_RANK[role] < ROLE_RANK[min] && !own) throw forbidden(`Only ${min}s and above can delete ${cfg.table}`);
    const gone = await withTenant(tenantId, async (c) => {
      const before = await selectById(c, req, String(req.params.id));
      if (!before) throw notFound();
      await c.query(`DELETE FROM ${cfg.table} WHERE tenant_id=$1 AND id=$2`, [tenantId, before.id]);
      await audit(c, tenantId, userId, 'deleted', cfg.entity, before.id, cfg.label(before));
      return before;
    });
    publish(tenantId, {
      type: 'record',
      entity: cfg.entity,
      id: gone.id,
      action: 'deleted',
      owner_id: gone.owner_id ?? null,
      by_user_id: userId,
      by_name: req.auth.name,
      label: cfg.label(gone),
    });
    res.status(204).end();
  });

  return r;
}

export const parseId = (v) => {
  const s = String(v);
  if (!/^[0-9a-f-]{36}$/i.test(s)) throw badRequest('Invalid id');
  return s;
};
