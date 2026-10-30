import { z } from 'zod';

import { recordName } from './entities.js';
import { assertRecordAccess } from './access.js';
import { DATA_RULE, LlmError, complete, extractJson } from './llm.js';
import { inr } from './nlsearch.js';

const daysAgo = (d, now = new Date()) => Math.max(0, Math.floor((now.getTime() - new Date(d).getTime()) / 86_400_000));
const ago = (n) => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export async function loadFacts(c, auth, entity, id) {
  const rec = await assertRecordAccess(c, auth, entity, id);
  const t = auth.tenantId;
  const one = async (sql, p) => (await c.query(sql, p)).rows[0] ?? null;
  const [stage, account, owner, activities, emails, files, counts] = await Promise.all([
    entity === 'deal' ? one('SELECT name FROM pipeline_stages WHERE tenant_id=$1 AND id=$2', [t, rec.stage_id]) : null,
    rec.account_id ? one('SELECT name FROM accounts WHERE tenant_id=$1 AND id=$2', [t, rec.account_id]) : null,
    rec.owner_id ? one('SELECT name FROM users WHERE tenant_id=$1 AND id=$2', [t, rec.owner_id]) : null,
    c.query(
      `SELECT a.type,a.subject,a.notes,a.due_at,a.completed_at,a.created_at,u.name AS by FROM activities a LEFT JOIN users u ON u.id=a.owner_id
             WHERE a.tenant_id=$1 AND a.related_type=$2 AND a.related_id=$3 ORDER BY a.created_at DESC LIMIT 15`,
      [t, entity, id],
    ),
    c.query(
      `SELECT subject,status,created_at FROM email_log WHERE tenant_id=$1 AND related_type=$2 AND related_id=$3 ORDER BY created_at DESC LIMIT 6`,
      [t, entity, id],
    ),
    one('SELECT count(*)::int AS n FROM attachments WHERE tenant_id=$1 AND entity=$2 AND entity_id=$3', [t, entity, id]),
    entity === 'account'
      ? one(
          `SELECT (SELECT count(*) FROM contacts WHERE tenant_id=$1 AND account_id=$2)::int AS contacts, (SELECT count(*) FROM deals WHERE tenant_id=$1 AND account_id=$2)::int AS deals,
                                 (SELECT coalesce(sum(amount),0) FROM deals WHERE tenant_id=$1 AND account_id=$2 AND status='won')::float AS won`,
          [t, id],
        )
      : null,
  ]);
  return {
    entity,
    rec,
    name: recordName(entity, rec) || rec.name || 'this record',
    stage: stage?.name ?? null,
    account: account?.name ?? (entity === 'account' ? rec.name : null),
    owner: owner?.name ?? null,
    activities: activities.rows,
    emails: emails.rows,
    files: files?.n ?? 0,
    contacts: counts?.contacts ?? 0,
    deals: counts?.deals ?? 0,
    wonValue: counts?.won ?? 0,
  };
}

/** A plain, factual summary built from the data. Used when no AI key is set. */
export function autoSummary(f, now = new Date()) {
  const r = f.rec;
  const L = [];
  if (f.entity === 'lead') {
    L.push(
      `${f.name} is a ${r.status} lead${r.source ? ` from ${r.source}` : ''}${r.city ? ` in ${r.city}` : ''}${r.company ? `, at ${r.company}` : ''}, with a score of ${r.score}/100. Added ${ago(daysAgo(r.created_at, now))}.`,
    );
  } else if (f.entity === 'deal') {
    L.push(
      `${f.name} is ${r.status === 'open' ? 'an open' : r.status === 'won' ? 'a won' : 'a lost'} deal worth ${inr(Number(r.amount))}${f.stage ? `, currently in ${f.stage}` : ''}${f.account ? ` for ${f.account}` : ''}.`,
    );
    if (r.status === 'open' && r.expected_close) {
      const d = Math.round((new Date(r.expected_close).getTime() - new Date(now.toDateString()).getTime()) / 86_400_000);
      L.push(
        d < 0
          ? `The expected close date was ${plural(-d, 'day')} ago, so it needs a new date or a decision.`
          : d === 0
            ? 'It is expected to close today.'
            : `It is expected to close in ${plural(d, 'day')}.`,
      );
    }
    if (r.status === 'lost' && r.lost_reason) L.push(`It was lost because: ${r.lost_reason}.`);
    if (r.next_step) L.push(`Next step noted: ${r.next_step}.`);
  } else if (f.entity === 'contact') {
    L.push(
      `${f.name}${r.title ? `, ${r.title},` : ''} is a contact${f.account ? ` at ${f.account}` : ''}${r.city ? ` in ${r.city}` : ''}.`,
    );
  } else {
    L.push(
      `${f.name} is an account${r.industry ? ` in ${r.industry}` : ''}${r.city ? `, based in ${r.city}` : ''}. It has ${plural(f.contacts, 'contact')} and ${plural(f.deals, 'deal')}; ${inr(f.wonValue)} has been won so far.`,
    );
  }
  if (f.owner) L.push(`Owner: ${f.owner}.`);

  const touches = f.activities.filter((a) => a.type !== 'task' || a.completed_at);
  const last = touches[0];
  const lastEmail = f.emails[0];
  const lastTouch = [last?.created_at, lastEmail?.created_at].filter(Boolean).sort().pop();
  if (lastTouch) {
    const n = daysAgo(lastTouch, now);
    L.push(
      `Last contact was ${ago(n)}${last && new Date(last.created_at).getTime() === new Date(lastTouch).getTime() ? ` (${last.type}: ${last.subject})` : ''}.${n > 14 && f.rec.status !== 'won' && f.rec.status !== 'lost' && f.rec.status !== 'converted' ? ' That is a long gap, so a follow-up is due.' : ''}`,
    );
  } else L.push('No calls, meetings, emails or notes have been logged yet.');

  const open = f.activities.filter((a) => a.type === 'task' && !a.completed_at);
  if (open.length) {
    const overdue = open.filter((a) => a.due_at && new Date(a.due_at) < now);
    const next = [...open].filter((a) => a.due_at).sort((a, b) => +new Date(a.due_at) - +new Date(b.due_at))[0];
    L.push(
      `${plural(open.length, 'open task')}${overdue.length ? `, ${overdue.length} overdue` : ''}${next ? `. Next: "${next.subject}"` : ''}.`,
    );
  } else if (!['won', 'lost', 'converted'].includes(f.rec.status)) L.push('There are no open tasks, so nothing is scheduled.');
  if (f.emails.length) L.push(`${plural(f.emails.length, 'email')} on record; the latest is "${f.emails[0].subject}".`);
  if (f.files) L.push(`${plural(f.files, 'file')} attached.`);
  return L.join(' ');
}

export async function aiSummary(f) {
  const data = {
    type: f.entity,
    name: f.name,
    details: pickDetails(f.rec),
    stage: f.stage,
    account: f.account,
    owner: f.owner,
    recent_activity: f.activities
      .slice(0, 10)
      .map((a) => ({
        type: a.type,
        subject: a.subject,
        notes: a.notes?.slice(0, 200) ?? null,
        done: !!a.completed_at,
        due: a.due_at,
        when: a.created_at,
      })),
    recent_emails: f.emails.map((e) => ({ subject: e.subject, status: e.status, when: e.created_at })),
    files_attached: f.files,
  };
  return complete({
    system: `You write a short briefing for a salesperson about one CRM record: where things stand, what happened recently, any risk, and one suggested next step. 4 to 6 plain sentences, no headings, no bullet points. Use only the facts given and never invent numbers, names or dates. ${DATA_RULE}`,
    user: JSON.stringify(data),
    maxTokens: 400,
  });
}

function pickDetails(r) {
  const keep = [
    'status',
    'source',
    'city',
    'company',
    'title',
    'score',
    'amount',
    'expected_close',
    'next_step',
    'lost_reason',
    'industry',
    'created_at',
  ];
  return Object.fromEntries(keep.filter((k) => r[k] !== null && r[k] !== undefined).map((k) => [k, r[k]]));
}

// ---------------- Email drafting ----------------
export const draftSchema = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(4000) });

const fill = (t, v) => t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => v[k] ?? '');

export function pickTemplateName(goal) {
  const g = goal.toLowerCase();
  if (/quot|quote|proposal|pric|estimate/.test(g)) return 'Quotation follow-up';
  if (/meet|call|schedul|visit|demo|appoint/.test(g)) return 'Meeting confirmation';
  if (/thank|welcome|onboard|congrat/.test(g)) return 'Thank you for choosing us';
  if (/remind|pending|decision|nudge|chase|follow|status/.test(g)) return 'Pending decision reminder';
  return 'Introduction';
}

export function templateDraft(f, sender, goal, templates) {
  const vars = { name: f.name, first_name: f.rec.first_name || f.name, company: f.rec.company || f.account || '', owner_name: sender };
  const t = templates.find((x) => x.name === pickTemplateName(goal));
  if (t) return { subject: fill(t.subject, vars), body: fill(t.body, vars) };
  return {
    subject: `Following up, ${vars.first_name}`,
    body: `Hi ${vars.first_name},\n\nI wanted to follow up${goal ? ` regarding ${goal}` : ''}. Please let me know a convenient time to talk.\n\nRegards,\n${sender}`,
  };
}

export async function aiDraft(f, sender, tenantName, goal) {
  const text = await complete({
    system: `You write short, polite, professional sales emails for an Indian B2B company. Reply with ONE JSON object {"subject": "...", "body": "..."} and nothing else. The body is plain text under 140 words, starts with a greeting by first name, and ends with the sender's first name. Do not invent prices, dates, discounts or promises. ${DATA_RULE}`,
    user: JSON.stringify({
      sender,
      sender_company: tenantName,
      recipient: f.name,
      recipient_company: f.rec.company || f.account || null,
      context: pickDetails(f.rec),
      stage: f.stage,
      recent_activity: f.activities.slice(0, 4).map((a) => `${a.type}: ${a.subject}`),
      goal: goal || 'a friendly follow-up',
    }),
    maxTokens: 450,
  });
  const parsed = draftSchema.safeParse(extractJson(text));
  if (!parsed.success) throw new LlmError('The AI answer was not in the expected format');
  return parsed.data;
}
