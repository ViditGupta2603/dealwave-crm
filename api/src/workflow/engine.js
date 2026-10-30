import { withTenant } from '../db.js';
import { logger } from '../logger.js';

import { AUTOMATION_FIELDS, ENTITY_PATH, ENTITY_TABLE, recordName } from '../lib/entities.js';
import { deliverMail } from '../lib/mail.js';
import { publish } from '../lib/realtime.js';
import { postJson } from '../lib/safeWebhook.js';

const getVal = (r, path) => {
  if (!r) return undefined;
  if (path.startsWith('custom_data.')) return r.custom_data?.[path.slice(12)];
  return r[path];
};

export function matches(conds, before, after) {
  return conds.every((c) => {
    const v = getVal(after, c.field);
    const a = Number(v),
      b = Number(c.value);
    switch (c.op) {
      case 'eq':
        return String(v ?? '') === String(c.value ?? '');
      case 'neq':
        return String(v ?? '') !== String(c.value ?? '');
      case 'gt':
        return a > b;
      case 'gte':
        return a >= b;
      case 'lt':
        return a < b;
      case 'lte':
        return a <= b;
      case 'contains':
        return String(v ?? '')
          .toLowerCase()
          .includes(String(c.value ?? '').toLowerCase());
      case 'in':
        return String(c.value ?? '')
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .includes(String(v ?? '').toLowerCase());
      case 'is_empty':
        return v === null || v === undefined || v === '';
      case 'not_empty':
        return !(v === null || v === undefined || v === '');
      case 'changed_to':
        return String(v ?? '') === String(c.value ?? '') && String(getVal(before, c.field) ?? '') !== String(v ?? '');
      default:
        return false;
    }
  });
}

const render = (tpl, ctx, extra = {}) =>
  tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => {
    if (key === 'name') return recordName(ctx.ev.entity, ctx.record);
    if (key in extra) return extra[key];
    const v = getVal(ctx.record, key);
    return v === null || v === undefined ? '' : String(v);
  });

async function ownerInfo(tenantId, ownerId) {
  if (!ownerId) return null;
  return withTenant(
    tenantId,
    async (c) => (await c.query('SELECT id,name,email FROM users WHERE id=$1 AND active', [ownerId])).rows[0] || null,
  );
}

async function runAction(a, ctx) {
  const { tenantId, entity, recordId } = ctx.ev;
  const rec = ctx.record;
  switch (a.type) {
    case 'create_task': {
      const owner = rec.owner_id || ctx.ev.userId;
      await withTenant(tenantId, (c) =>
        c.query(
          `INSERT INTO activities (tenant_id,type,subject,priority,due_at,related_type,related_id,owner_id)
         VALUES ($1,'task',$2,$3, now() + ($4 || ' days')::interval, $5,$6,$7)`,
          [tenantId, render(a.subject, ctx), a.priority || 'normal', String(a.due_in_days ?? 1), entity, recordId, owner],
        ),
      );
      publish(tenantId, {
        type: 'record',
        entity: 'activity',
        id: recordId,
        action: 'created',
        owner_id: owner ?? null,
        label: render(a.subject, ctx),
      });
      publish(tenantId, { type: 'record', entity, id: recordId, action: 'updated', owner_id: owner ?? null });
      return `Created task "${render(a.subject, ctx)}"`;
    }
    case 'add_note': {
      await withTenant(tenantId, (c) =>
        c.query(
          `INSERT INTO activities (tenant_id,type,subject,notes,related_type,related_id,owner_id,completed_at) VALUES ($1,'note',$2,$3,$4,$5,$6,now())`,
          [tenantId, `Automation: ${ctx.ruleName}`, render(a.body, ctx), entity, recordId, rec.owner_id || ctx.ev.userId],
        ),
      );
      return 'Added a note';
    }
    case 'update_field': {
      const table = ENTITY_TABLE[entity];
      const field = String(a.field);
      if (field.startsWith('custom_data.')) {
        const key = field.slice(12);
        if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) throw new Error(`Invalid custom field "${key}"`);
        await withTenant(tenantId, (c) =>
          c.query(`UPDATE ${table} SET custom_data = custom_data || jsonb_build_object($3::text, $4::jsonb) WHERE tenant_id=$1 AND id=$2`, [
            tenantId,
            recordId,
            key,
            JSON.stringify(a.value ?? null),
          ]),
        );
        rec.custom_data = { ...(rec.custom_data || {}), [key]: a.value };
      } else {
        if (!AUTOMATION_FIELDS[entity].includes(field)) throw new Error(`"${field}" cannot be changed by an automation`);
        await withTenant(tenantId, (c) =>
          c.query(`UPDATE ${table} SET ${field}=$3 WHERE tenant_id=$1 AND id=$2`, [tenantId, recordId, a.value === '' ? null : a.value]),
        );
        rec[field] = a.value;
      }
      return `Set ${field} to ${JSON.stringify(a.value)}`;
    }
    case 'assign_round_robin': {
      const table = ENTITY_TABLE[entity];
      const picked = await withTenant(tenantId, async (c) => {
        // Least-loaded active seller gets the record.
        const u = (
          await c.query(
            `SELECT u.id, u.name FROM users u WHERE u.tenant_id=$1 AND u.active AND u.role IN ('member','manager')
           ORDER BY (SELECT count(*) FROM ${table} t WHERE t.owner_id=u.id AND t.created_at > now() - interval '30 days') ASC, u.created_at LIMIT 1`,
            [tenantId],
          )
        ).rows[0];
        if (u) await c.query(`UPDATE ${table} SET owner_id=$3 WHERE tenant_id=$1 AND id=$2`, [tenantId, recordId, u.id]);
        return u;
      });
      if (!picked) return 'No active sellers to assign to';
      rec.owner_id = picked.id;
      await withTenant(tenantId, (c) =>
        c.query(`INSERT INTO notifications (tenant_id,user_id,title,body,link) VALUES ($1,$2,$3,$4,$5)`, [
          tenantId,
          picked.id,
          `New ${entity} assigned to you`,
          recordName(entity, rec) || rec.name,
          `/${ENTITY_PATH[entity]}?open=${recordId}`,
        ]),
      );
      publish(tenantId, { type: 'notification', user_id: picked.id });
      publish(tenantId, {
        type: 'record',
        entity,
        id: recordId,
        action: 'updated',
        owner_id: picked.id,
        label: recordName(entity, rec) || rec.name,
      });
      return `Assigned to ${picked.name}`;
    }
    case 'notify': {
      const owner = rec.owner_id || ctx.ev.userId;
      if (!owner) return 'No owner to notify';
      await withTenant(tenantId, (c) =>
        c.query(`INSERT INTO notifications (tenant_id,user_id,title,body,link) VALUES ($1,$2,$3,$4,$5)`, [
          tenantId,
          owner,
          render(a.title, ctx),
          a.body ? render(a.body, ctx) : null,
          `/${ENTITY_PATH[entity]}?open=${recordId}`,
        ]),
      );
      publish(tenantId, { type: 'notification', user_id: owner });
      return 'Sent an in-app notification';
    }
    case 'send_email': {
      const owner = await ownerInfo(tenantId, rec.owner_id);
      const extra = { owner_name: owner?.name || '' };
      const to = a.to === 'owner' ? owner?.email : a.to === 'record' ? rec.email : a.to;
      if (!to) return `Skipped email: no address for "${a.to}"`;
      const r = await deliverMail({
        tenantId,
        userId: ctx.ev.userId,
        to,
        subject: render(a.subject, ctx, extra),
        body: render(a.body, ctx, extra),
        source: 'automation',
        relatedType: entity,
        relatedId: recordId,
      });
      if (r.status === 'failed') throw new Error(`Email to ${to} failed: ${r.error}`);
      return r.status === 'simulated' ? `Email to ${to} (simulated: SMTP is not configured)` : `Emailed ${to}`;
    }
    case 'webhook': {
      const payload = {
        event: `${entity}.${ctx.ev.event}`,
        id: recordId,
        data: rec,
        previous: ctx.ev.before,
        at: new Date().toISOString(),
      };
      const r = await postJson(a.url, payload, a.secret);
      return `Webhook delivered (HTTP ${r.status})`;
    }
    default:
      throw new Error(`Unknown action ${a.type}`);
  }
}

export async function processEvent(ev) {
  const rules = await withTenant(
    ev.tenantId,
    async (c) =>
      (
        await c.query(`SELECT * FROM workflow_rules WHERE tenant_id=$1 AND entity=$2 AND event=$3 AND active ORDER BY created_at`, [
          ev.tenantId,
          ev.entity,
          ev.event,
        ])
      ).rows,
  );
  for (const rule of rules) {
    if (!matches(rule.conditions || [], ev.before, ev.after)) continue;
    const ctx = { ev, record: { ...ev.after }, ruleName: rule.name };
    const log = [];
    let failed = false;
    for (const a of rule.actions) {
      try {
        log.push({ action: a.type, ok: true, message: await runAction(a, ctx) });
      } catch (e) {
        failed = true;
        log.push({ action: a.type, ok: false, message: e.message || 'Action failed' });
        logger.warn({ rule: rule.id, action: a.type, err: e.message }, 'workflow action failed');
      }
    }
    await withTenant(ev.tenantId, async (c) => {
      await c.query('INSERT INTO workflow_runs (tenant_id,rule_id,entity,record_id,status,log) VALUES ($1,$2,$3,$4,$5,$6)', [
        ev.tenantId,
        rule.id,
        ev.entity,
        ev.recordId,
        failed ? 'failed' : 'success',
        JSON.stringify(log),
      ]);
      await c.query('UPDATE workflow_rules SET run_count=run_count+1, last_run_at=now() WHERE id=$1', [rule.id]);
    });
  }
}
