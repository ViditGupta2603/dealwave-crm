import { Router } from 'express';
import { withSystem, withTenant } from '../db.js';
import { badRequest, notFound } from '../http.js';
import { config } from '../config.js';
import { sha256, randomToken } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { buildCalendar } from '../lib/ics.js';
import { ENTITY_PATH } from '../lib/entities.js';
import { parseId } from '../resource.js';

const LABEL = { task: 'Task', call: 'Call', meeting: 'Meeting', email: 'Email', note: 'Note' };
const link = (a) =>
  a.related_type && a.related_id ? `${config.APP_URL.replace(/\/$/, '')}/${ENTITY_PATH[a.related_type]}?open=${a.related_id}` : null;

const toEvent = (a) => ({
  uid: `${a.id}@dealwave-crm`,
  summary: `${LABEL[a.type] ?? 'Task'}: ${a.subject}`,
  description: [a.notes, a.related_name ? `Related: ${a.related_name}` : null].filter(Boolean).join('\n') || null,
  start: new Date(a.due_at),
  end: new Date(new Date(a.due_at).getTime() + (a.type === 'meeting' ? 60 : 30) * 60_000),
  url: link(a),
  alarmMinutes: 15,
});

const RELATED_NAME = `(SELECT CASE a.related_type
    WHEN 'lead' THEN (SELECT trim(first_name || ' ' || coalesce(last_name,'')) FROM leads WHERE id=a.related_id)
    WHEN 'contact' THEN (SELECT trim(first_name || ' ' || coalesce(last_name,'')) FROM contacts WHERE id=a.related_id)
    WHEN 'account' THEN (SELECT name FROM accounts WHERE id=a.related_id)
    WHEN 'deal' THEN (SELECT name FROM deals WHERE id=a.related_id) END) AS related_name`;

// ---------------- signed-in routes ----------------
export const calendarRouter = Router();

/** One task or meeting as a .ics file: "Add to calendar". */
calendarRouter.get('/activity/:file', async (req, res) => {
  const id = parseId(String(req.params.file).replace(/\.ics$/i, ''));
  const { tenantId, userId, role } = req.auth;
  const row = await withTenant(
    tenantId,
    async (c) =>
      (
        await c.query(
          `SELECT a.*, ${RELATED_NAME} FROM activities a WHERE a.tenant_id=$1 AND a.id=$2 ${role === 'member' ? 'AND a.owner_id=$3' : ''}`,
          role === 'member' ? [tenantId, id, userId] : [tenantId, id],
        )
      ).rows[0],
  );
  if (!row) throw notFound('Task not found');
  if (!row.due_at) throw badRequest('This task has no due date, so there is nothing to add to a calendar');
  res.set({
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'attachment; filename="dealwave-task.ics"',
    'Cache-Control': 'private, no-store',
  });
  res.send(buildCalendar('Dealwave CRM', [toEvent(row)]));
});

calendarRouter.get('/feed', async (req, res) => {
  const { tenantId, userId } = req.auth;
  const row = await withTenant(
    tenantId,
    async (c) => (await c.query('SELECT calendar_token_hash IS NOT NULL AS on FROM users WHERE id=$1', [userId])).rows[0],
  );
  res.json({ enabled: !!row?.on });
});

/** Creates (or replaces) the private subscription link. The link is shown once; only its hash is stored. */
calendarRouter.post('/feed-token', async (req, res) => {
  const { tenantId, userId } = req.auth;
  const token = randomToken(32);
  await withTenant(tenantId, async (c) => {
    await c.query('UPDATE users SET calendar_token_hash=$2 WHERE id=$1', [userId, sha256(token)]);
    await audit(c, tenantId, userId, 'created', 'calendar link', userId, 'Calendar subscription link');
  });
  res.status(201).json({ url: `${config.APP_URL.replace(/\/$/, '')}/api/calendar/public/${token}.ics` });
});

calendarRouter.delete('/feed-token', async (req, res) => {
  const { tenantId, userId } = req.auth;
  await withTenant(tenantId, async (c) => {
    await c.query('UPDATE users SET calendar_token_hash=NULL WHERE id=$1', [userId]);
    await audit(c, tenantId, userId, 'removed', 'calendar link', userId, 'Calendar subscription link');
  });
  res.status(204).end();
});

// ---------------- public feed (the secret link is the credential, like Google's own private iCal address) ----------------
export const calendarPublicRouter = Router();

calendarPublicRouter.get('/:file', async (req, res) => {
  const token = String(req.params.file).replace(/\.ics$/i, '');
  if (!/^[0-9a-f]{64}$/.test(token)) throw notFound('Calendar not found');
  const found = await withSystem(async (c) => {
    const u = (
      await c.query(
        "SELECT u.id, u.name, u.tenant_id, t.name AS tenant_name FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.calendar_token_hash=$1 AND u.active AND t.status='active'",
        [sha256(token)],
      )
    ).rows[0];
    if (!u) return null;
    const rows = (
      await c.query(
        `SELECT a.*, ${RELATED_NAME} FROM activities a
       WHERE a.tenant_id=$1 AND a.owner_id=$2 AND a.completed_at IS NULL AND a.due_at IS NOT NULL AND a.type IN ('task','call','meeting')
         AND a.due_at BETWEEN now() - interval '14 days' AND now() + interval '120 days' ORDER BY a.due_at LIMIT 500`,
        [u.tenant_id, u.id],
      )
    ).rows;
    return { u, rows };
  });
  if (!found) throw notFound('Calendar not found');
  res.set({
    'Content-Type': 'text/calendar; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex',
  });
  res.send(buildCalendar(`Dealwave: ${found.u.name} (${found.u.tenant_name})`, found.rows.map(toEvent)));
});
