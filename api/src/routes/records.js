import { z } from 'zod';
import Papa from 'papaparse';
import { withTenant } from '../db.js';
import { crud, parseId } from '../resource.js';
import { badRequest, notFound } from '../http.js';
import { audit } from '../lib/audit.js';
import { assertWithinLimit } from '../lib/limits.js';
import { emitEvent } from '../lib/queue.js';
import { recordName } from '../lib/entities.js';

const str = (n = 200) => z.string().max(n).nullish();
const id = z.string().uuid('Pick a valid option').nullish();
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, 'Use YYYY-MM-DD')
  .nullish();
const dateTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date and time')
  .nullish();
const email = z.string().email('Enter a valid email address').max(200).nullish();

// ---------------- Leads ----------------
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted'];
const leadSchema = z.object({
  first_name: z.string().trim().min(1, 'First name is required').max(100),
  last_name: str(100),
  email,
  phone: str(30),
  company: str(200),
  title: str(120),
  source: str(60),
  status: z.enum(LEAD_STATUSES).optional(),
  score: z.number().int().min(0).max(100).optional(),
  city: str(100),
  notes: z.string().max(5000).nullish(),
  owner_id: id,
});

export const leadsRouter = crud(
  {
    table: 'leads',
    entity: 'lead',
    schema: leadSchema,
    hasCustom: true,
    ownerScoped: true,
    search: ['first_name', 'last_name', 'email', 'company', 'phone'],
    filters: ['status', 'source', 'owner_id', 'city'],
    sortable: ['created_at', 'first_name', 'company', 'score', 'status', 'updated_at'],
    defaultSort: 'created_at',
    joins: 'LEFT JOIN users o ON o.id = t.owner_id',
    extraSelect: ', o.name AS owner_name',
    label: (r) => recordName('lead', r) + (r.company ? ` (${r.company})` : ''),
  },
  (r) => {
    r.get('/export.csv', async (req, res) => {
      const { tenantId, userId, role } = req.auth;
      const rows = await withTenant(
        tenantId,
        async (c) =>
          (
            await c.query(
              `SELECT t.first_name,t.last_name,t.email,t.phone,t.company,t.title,t.source,t.status,t.score,t.city,o.name AS owner,t.created_at
           FROM leads t LEFT JOIN users o ON o.id=t.owner_id WHERE t.tenant_id=$1 ${role === 'member' ? 'AND t.owner_id=$2' : ''} ORDER BY t.created_at DESC LIMIT 20000`,
              role === 'member' ? [tenantId, userId] : [tenantId],
            )
          ).rows,
      );
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="leads.csv"' });
      res.send(Papa.unparse(rows));
    });

    r.post('/import', async (req, res) => {
      const { tenantId, userId } = req.auth;
      const rows = z
        .array(z.record(z.string(), z.any()))
        .min(1, 'The file has no rows')
        .max(2000, 'Import up to 2,000 rows at a time')
        .parse(req.body?.rows);
      const errors = [];
      const valid = [];
      rows.forEach((raw, i) => {
        const clean = {};
        for (const [k, v] of Object.entries(raw)) {
          const key = k.trim().toLowerCase().replace(/\s+/g, '_');
          if (v !== null && v !== undefined && String(v).trim() !== '') clean[key] = typeof v === 'string' ? v.trim() : v;
        }
        if (clean.score !== undefined) clean.score = Number(clean.score);
        if (clean.status) clean.status = String(clean.status).toLowerCase();
        delete clean.owner_id;
        const p = leadSchema.safeParse(clean);
        if (p.success) valid.push(p.data);
        else errors.push({ row: i + 2, message: p.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
      });
      const created = await withTenant(tenantId, async (c) => {
        await assertWithinLimit(c, tenantId, 'records', valid.length);
        const out = [];
        for (const v of valid) {
          const { rows: ins } = await c.query(
            `INSERT INTO leads (tenant_id,first_name,last_name,email,phone,company,title,source,status,score,city,notes,owner_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'new'),COALESCE($10,0),$11,$12,$13) RETURNING *`,
            [
              tenantId,
              v.first_name,
              v.last_name ?? null,
              v.email ?? null,
              v.phone ?? null,
              v.company ?? null,
              v.title ?? null,
              v.source ?? null,
              v.status ?? null,
              v.score ?? null,
              v.city ?? null,
              v.notes ?? null,
              userId,
            ],
          );
          out.push(ins[0]);
        }
        if (out.length) await audit(c, tenantId, userId, 'imported', 'lead', null, `${out.length} leads imported from CSV`);
        return out;
      });
      for (const row of created)
        await emitEvent({ tenantId, entity: 'lead', event: 'created', recordId: row.id, before: null, after: row, userId });
      res.json({ created: created.length, skipped: errors.length, errors: errors.slice(0, 25) });
    });

    r.post('/:id/convert', async (req, res) => {
      const { tenantId, userId, role } = req.auth;
      const body = z
        .object({ create_deal: z.boolean().default(true), deal_name: z.string().max(200).optional(), amount: z.number().min(0).optional() })
        .parse(req.body || {});
      const leadId = parseId(req.params.id);
      const out = await withTenant(tenantId, async (c) => {
        const { rows } = await c.query(
          `SELECT * FROM leads WHERE tenant_id=$1 AND id=$2 ${role === 'member' ? 'AND owner_id=$3' : ''}`,
          role === 'member' ? [tenantId, leadId, userId] : [tenantId, leadId],
        );
        const lead = rows[0];
        if (!lead) throw notFound('Lead not found');
        if (lead.status === 'converted') throw badRequest('This lead is already converted');
        await assertWithinLimit(c, tenantId, 'records', body.create_deal ? 3 : 2);
        const owner = lead.owner_id || userId;
        let accountId = null;
        if (lead.company) {
          const ex = await c.query('SELECT id FROM accounts WHERE tenant_id=$1 AND lower(name)=lower($2) LIMIT 1', [
            tenantId,
            lead.company,
          ]);
          accountId =
            ex.rows[0]?.id ??
            (
              await c.query(`INSERT INTO accounts (tenant_id,name,city,owner_id) VALUES ($1,$2,$3,$4) RETURNING id`, [
                tenantId,
                lead.company,
                lead.city,
                owner,
              ])
            ).rows[0].id;
        }
        const contact = (
          await c.query(
            `INSERT INTO contacts (tenant_id,account_id,first_name,last_name,email,phone,title,city,owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [tenantId, accountId, lead.first_name, lead.last_name, lead.email, lead.phone, lead.title, lead.city, owner],
          )
        ).rows[0];
        let deal = null;
        if (body.create_deal) {
          const st = await c.query(
            'SELECT id FROM pipeline_stages WHERE tenant_id=$1 AND NOT is_won AND NOT is_lost ORDER BY position LIMIT 1',
            [tenantId],
          );
          if (!st.rows[0]) throw badRequest('Add an open pipeline stage first');
          deal = (
            await c.query(
              `INSERT INTO deals (tenant_id,name,account_id,contact_id,stage_id,amount,owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
              [
                tenantId,
                body.deal_name || `${lead.company || recordName('lead', lead)} - new deal`,
                accountId,
                contact.id,
                st.rows[0].id,
                body.amount ?? 0,
                owner,
              ],
            )
          ).rows[0];
        }
        const updated = (await c.query(`UPDATE leads SET status='converted', converted_at=now() WHERE id=$1 RETURNING *`, [lead.id]))
          .rows[0];
        await audit(c, tenantId, userId, 'converted', 'lead', lead.id, recordName('lead', lead), {
          account_id: accountId,
          contact_id: contact.id,
          deal_id: deal?.id ?? null,
        });
        return { lead, updated, contact, deal, accountId };
      });
      await emitEvent({ tenantId, entity: 'lead', event: 'updated', recordId: out.lead.id, before: out.lead, after: out.updated, userId });
      await emitEvent({
        tenantId,
        entity: 'contact',
        event: 'created',
        recordId: out.contact.id,
        before: null,
        after: out.contact,
        userId,
      });
      if (out.deal)
        await emitEvent({ tenantId, entity: 'deal', event: 'created', recordId: out.deal.id, before: null, after: out.deal, userId });
      res.json({ account_id: out.accountId, contact_id: out.contact.id, deal_id: out.deal?.id ?? null });
    });
  },
);

// ---------------- Contacts ----------------
const contactSchema = z.object({
  first_name: z.string().trim().min(1, 'First name is required').max(100),
  last_name: str(100),
  email,
  phone: str(30),
  title: str(120),
  city: str(100),
  account_id: id,
  owner_id: id,
});
export const contactsRouter = crud({
  table: 'contacts',
  entity: 'contact',
  schema: contactSchema,
  hasCustom: true,
  ownerScoped: true,
  search: ['first_name', 'last_name', 'email', 'phone', 'a.name'],
  filters: ['account_id', 'owner_id', 'city'],
  sortable: ['created_at', 'first_name', 'updated_at'],
  defaultSort: 'created_at',
  joins: 'LEFT JOIN accounts a ON a.id = t.account_id LEFT JOIN users o ON o.id = t.owner_id',
  extraSelect: ', a.name AS account_name, o.name AS owner_name',
  label: (r) => recordName('contact', r),
});

// ---------------- Accounts ----------------
const accountSchema = z.object({
  name: z.string().trim().min(1, 'Company name is required').max(200),
  industry: str(80),
  website: str(200),
  phone: str(30),
  employees: z.number().int().min(0).nullish(),
  annual_revenue: z.number().min(0).nullish(),
  city: str(100),
  state: str(100),
  country: str(100),
  description: z.string().max(5000).nullish(),
  owner_id: id,
});
export const accountsRouter = crud({
  table: 'accounts',
  entity: 'account',
  schema: accountSchema,
  hasCustom: true,
  ownerScoped: true,
  search: ['name', 'industry', 'city', 'website'],
  filters: ['industry', 'owner_id', 'city'],
  sortable: ['created_at', 'name', 'employees', 'annual_revenue', 'updated_at'],
  defaultSort: 'created_at',
  joins: 'LEFT JOIN users o ON o.id = t.owner_id',
  extraSelect: `, o.name AS owner_name,
    (SELECT count(*) FROM contacts x WHERE x.account_id = t.id) AS contact_count,
    (SELECT count(*) FROM deals x WHERE x.account_id = t.id) AS deal_count,
    (SELECT COALESCE(SUM(x.amount),0) FROM deals x WHERE x.account_id = t.id AND x.status='won') AS won_value`,
  label: (r) => r.name,
});

// ---------------- Deals ----------------
const dealSchema = z.object({
  name: z.string().trim().min(1, 'Deal name is required').max(200),
  account_id: id,
  contact_id: id,
  stage_id: id,
  amount: z.number().min(0, 'Amount cannot be negative').max(1e13).optional(),
  expected_close: dateStr,
  next_step: str(300),
  lost_reason: str(300),
  owner_id: id,
});

async function applyStage(c, tenantId, stageId, data) {
  const { rows } = await c.query('SELECT id,is_won,is_lost FROM pipeline_stages WHERE tenant_id=$1 AND id=$2', [tenantId, stageId]);
  if (!rows[0]) throw badRequest('That pipeline stage does not exist');
  data.status = rows[0].is_won ? 'won' : rows[0].is_lost ? 'lost' : 'open';
  data.closed_at = rows[0].is_won || rows[0].is_lost ? new Date().toISOString() : null;
  if (!rows[0].is_lost) data.lost_reason = null;
}

export const dealsRouter = crud({
  table: 'deals',
  entity: 'deal',
  schema: dealSchema,
  hasCustom: true,
  ownerScoped: true,
  search: ['name', 'a.name'],
  filters: ['stage_id', 'status', 'owner_id', 'account_id', 'contact_id'],
  sortable: ['created_at', 'name', 'amount', 'expected_close', 'updated_at'],
  defaultSort: 'created_at',
  joins: `JOIN pipeline_stages s ON s.id = t.stage_id LEFT JOIN accounts a ON a.id = t.account_id
          LEFT JOIN contacts ct ON ct.id = t.contact_id LEFT JOIN users o ON o.id = t.owner_id`,
  extraSelect: `, s.name AS stage_name, s.color AS stage_color, s.probability, s.is_won, s.is_lost, a.name AS account_name,
    NULLIF(concat_ws(' ', ct.first_name, ct.last_name), '') AS contact_name, o.name AS owner_name`,
  label: (r) => r.name,
  beforeSave: async ({ c, tenantId, op, data, before }) => {
    if (op === 'create') {
      if (!data.stage_id) {
        const st = await c.query(
          'SELECT id FROM pipeline_stages WHERE tenant_id=$1 AND NOT is_won AND NOT is_lost ORDER BY position LIMIT 1',
          [tenantId],
        );
        if (!st.rows[0]) throw badRequest('Add an open pipeline stage first');
        data.stage_id = st.rows[0].id;
      }
      await applyStage(c, tenantId, data.stage_id, data);
      return;
    }
    if (data.stage_id && data.stage_id !== before.stage_id) {
      await applyStage(c, tenantId, data.stage_id, data);
      return { events: ['stage_changed'] };
    }
  },
});

// ---------------- Activities (tasks, calls, meetings, notes) ----------------
const activitySchema = z.object({
  type: z.enum(['task', 'call', 'meeting', 'email', 'note']),
  subject: z.string().trim().min(1, 'Add a short subject').max(300),
  notes: z.string().max(5000).nullish(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  due_at: dateTime,
  completed_at: dateTime,
  related_type: z.enum(['lead', 'contact', 'account', 'deal']).nullish(),
  related_id: id,
  owner_id: id,
});
export const activitiesRouter = crud({
  table: 'activities',
  entity: 'activity',
  schema: activitySchema,
  hasCustom: false,
  ownerScoped: true,
  search: ['subject', 'notes'],
  filters: ['type', 'related_type', 'related_id', 'owner_id', 'priority'],
  sortable: ['created_at', 'due_at', 'completed_at', 'priority'],
  defaultSort: 'created_at',
  joins: 'LEFT JOIN users o ON o.id = t.owner_id',
  extraSelect: `, o.name AS owner_name, CASE t.related_type
      WHEN 'lead' THEN (SELECT concat_ws(' ', first_name, last_name) FROM leads WHERE id = t.related_id)
      WHEN 'contact' THEN (SELECT concat_ws(' ', first_name, last_name) FROM contacts WHERE id = t.related_id)
      WHEN 'account' THEN (SELECT name FROM accounts WHERE id = t.related_id)
      WHEN 'deal' THEN (SELECT name FROM deals WHERE id = t.related_id) END AS related_name`,
  label: (r) => `${r.type}: ${r.subject}`,
  deleteRole: 'member',
  extraFilters: (q) => {
    const w = [];
    if (q.completed === 'no') w.push('t.completed_at IS NULL');
    if (q.completed === 'yes') w.push('t.completed_at IS NOT NULL');
    if (q.due === 'overdue') w.push('t.completed_at IS NULL AND t.due_at < now()');
    if (q.due === 'today')
      w.push("t.completed_at IS NULL AND t.due_at >= date_trunc('day', now()) AND t.due_at < date_trunc('day', now()) + interval '1 day'");
    if (q.due === 'week')
      w.push("t.completed_at IS NULL AND t.due_at >= date_trunc('day', now()) AND t.due_at < date_trunc('day', now()) + interval '7 days'");
    return w;
  },
  beforeSave: async ({ data, before }) => {
    const type = data.related_type ?? before?.related_type;
    const rid = data.related_id ?? before?.related_id;
    if (type && !rid) throw badRequest('Pick the record this activity belongs to');
  },
});
