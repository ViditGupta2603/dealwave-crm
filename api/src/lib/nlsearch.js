import { z } from 'zod';

import { LlmError, complete, extractJson, DATA_RULE } from './llm.js';

/**
 * Plain-English search. A sentence is turned into a small, validated filter spec, and only that spec is ever
 * turned into SQL (always with bound parameters). Neither the rules nor an AI model can write SQL.
 */
export const specSchema = z.object({
  entity: z.enum(['lead', 'deal', 'contact', 'account']).default('lead'),
  status: z.enum(['new', 'contacted', 'qualified', 'unqualified', 'converted', 'open', 'won', 'lost']).optional(),
  stage: z.string().trim().max(60).optional(),
  source: z.string().trim().max(60).optional(),
  city: z.string().trim().max(60).optional(),
  owner: z.string().trim().max(80).optional(),
  min_amount: z.number().nonnegative().max(1e13).optional(),
  max_amount: z.number().nonnegative().max(1e13).optional(),
  min_score: z.number().min(0).max(100).optional(),
  created_within_days: z.number().int().min(1).max(3650).optional(),
  stale_days: z.number().int().min(1).max(3650).optional(),
  closing_within_days: z.number().int().min(0).max(730).optional(),
  closing_overdue: z.boolean().optional(),
  text: z.string().trim().max(80).optional(),
});

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (lc, word) => new RegExp(`(?:^|[^a-z0-9])${esc(word.toLowerCase())}(?:[^a-z0-9]|$)`).test(lc);
const UNIT = { crore: 1e7, crores: 1e7, cr: 1e7, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, l: 1e5, thousand: 1e3, k: 1e3 };
const TIME_UNIT = '(?:days?|weeks?|months?|years?)';
const toDays = (n, unit) => Math.round(n * (/^week/.test(unit) ? 7 : /^month/.test(unit) ? 30 : /^year/.test(unit) ? 365 : 1));

/** Removes the first match of re from the text (so later rules do not read the same words twice). */
function take(state, re) {
  const m = re.exec(state.s);
  if (m) state.s = state.s.slice(0, m.index) + ' ' + state.s.slice(m.index + m[0].length);
  return m;
}

export function parseQuery(query, ctx, now = new Date()) {
  const original = query.toLowerCase().replace(/[\u2018\u2019]/g, "'");
  const st = { s: ` ${original} ` };
  const spec = { entity: 'lead' };

  // ---- time and closing words first, so they are not mistaken for amounts or statuses ----
  const daysLeftInMonth = Math.max(1, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate());
  let m;
  if ((m = take(st, /closing (?:in|within) (?:the )?(?:next )?(\d+)\s*(days?|weeks?|months?)/)))
    spec.closing_within_days = Math.min(730, toDays(+m[1], m[2]));
  else if (take(st, /closing this month|expected (?:to close )?this month|close this month/)) spec.closing_within_days = daysLeftInMonth;
  else if (take(st, /closing next month|expected next month|close next month/)) spec.closing_within_days = daysLeftInMonth + 30;
  else if (take(st, /closing this week|closing soon|closing shortly/)) spec.closing_within_days = 7;
  if (take(st, /\b(?:overdue|past due|slipped|missed (?:the )?close)\b/) && !spec.closing_within_days) spec.closing_overdue = true;

  if (
    (m = take(
      st,
      new RegExp(
        `(?:older than|not (?:touched|updated|contacted|worked) (?:in|for)|no activity (?:in|for)|untouched (?:for|in)|inactive (?:for|since)|for more than)\\s*(\\d+)\\s*(${TIME_UNIT})`,
      ),
    ))
  )
    spec.stale_days = toDays(+m[1], m[2]);
  else if (take(st, /\b(?:stale|neglected|going cold|gone cold|inactive|untouched|forgotten)\b/)) spec.stale_days = 14;

  if ((m = take(st, new RegExp(`(?:in the )?(?:last|past)\\s*(\\d+)\\s*(${TIME_UNIT})`)))) spec.created_within_days = toDays(+m[1], m[2]);
  else if (take(st, /\b(?:today|added today|created today)\b/)) spec.created_within_days = 1;
  else if (take(st, /\bthis week\b/)) spec.created_within_days = 7;
  else if (take(st, /\blast week\b|\bpast week\b/)) spec.created_within_days = 7;
  else if (take(st, /\bthis month\b/)) spec.created_within_days = Math.max(1, now.getDate());
  else if (take(st, /\blast month\b|\bpast month\b/)) spec.created_within_days = 30;
  else if (take(st, /\brecent(?:ly)?\b|\bnew(?:ly)? added\b/)) spec.created_within_days = 14;

  // ---- score ----
  if (
    (m = take(st, /score\s*(?:of\s*)?(?:above|over|>=?|at least|more than)?\s*(\d{1,3})/)) ||
    (m = take(st, /(?:above|over|at least)\s*(\d{1,3})\s*score/))
  )
    spec.min_score = Math.min(100, +m[1]);
  else if (take(st, /\b(?:hot|high[- ]?score|high[- ]?scoring|best|top|promising)\b/)) spec.min_score = 70;

  // ---- amounts ----
  const amt = (re) => {
    const x = take(st, re);
    if (!x) return undefined;
    const n = parseFloat(x[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) return undefined;
    return Math.round(n * (x[2] ? (UNIT[x[2]] ?? 1) : 1));
  };
  const numTail = `\\s*(?:rs\\.?|₹|inr)?\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(crores?|cr|lakhs?|lacs?|l|thousand|k)?\\b(?!\\s*${TIME_UNIT})`;
  const lo = amt(
    new RegExp(`(?:above|over|more than|greater than|at least|minimum|min|exceeding|worth more than|bigger than|>=|>)${numTail}`),
  );
  if (lo !== undefined) spec.min_amount = lo;
  const hi = amt(new RegExp(`(?:below|under|less than|at most|maximum|max|up to|upto|smaller than|<=|<)${numTail}`));
  if (hi !== undefined) spec.max_amount = hi;

  // ---- record type ----
  const body = st.s;
  if (/\bdeals?\b|\bopportunit/.test(body)) spec.entity = 'deal';
  else if (/\bcontacts?\b|\bpeople\b|\bpersons?\b/.test(body)) spec.entity = 'contact';
  else if (/\baccounts?\b|\bcompan(?:y|ies)\b|\bcustomers?\b|\bclients?\b/.test(body)) spec.entity = 'account';
  else if (/\bleads?\b|\bprospects?\b/.test(body)) spec.entity = 'lead';
  else if (
    spec.min_amount !== undefined ||
    spec.max_amount !== undefined ||
    spec.closing_within_days !== undefined ||
    spec.closing_overdue ||
    /\b(?:won|lost|pipeline|worth|value)\b/.test(body)
  )
    spec.entity = 'deal';

  // ---- status and stage ----
  if (spec.entity === 'deal') {
    if (/\bwon\b/.test(body)) spec.status = 'won';
    else if (/\blost\b/.test(body)) spec.status = 'lost';
    else if (/\bopen\b|\bactive\b|\bin progress\b/.test(body)) spec.status = 'open';
    const stage = [...ctx.stages].sort((a, b) => b.length - a.length).find((s) => !/^(won|lost)$/i.test(s) && has(body, s));
    if (stage) {
      spec.stage = stage;
      if (spec.status === 'open') delete spec.status;
    }
  } else if (spec.entity === 'lead') {
    if (/\bunqualified\b/.test(body)) spec.status = 'unqualified';
    else if (/\bqualified\b/.test(body)) spec.status = 'qualified';
    else if (/\bcontacted\b/.test(body)) spec.status = 'contacted';
    else if (/\bconverted\b/.test(body)) spec.status = 'converted';
    else if (/\bnew\b/.test(body) && !spec.created_within_days) spec.status = 'new';
  }

  // ---- source, city, owner ----
  const source = [...ctx.sources].sort((a, b) => b.length - a.length).find((s) => has(body, s));
  if (source) spec.source = source;
  const city = [...ctx.cities]
    .sort((a, b) => b.length - a.length)
    .find((c) => has(body, c) && c.toLowerCase() !== (source ?? '').toLowerCase());
  if (city) spec.city = city;
  if (/\b(?:my|mine|me|myself)\b|assigned to me|owned by me/.test(body)) spec.owner = 'me';
  else {
    const person = ctx.people.find(
      (p) =>
        has(body, p.name) ||
        (p.name.split(' ')[0].length >= 3 &&
          new RegExp(`(?:^|[^a-z0-9])${esc(p.name.split(' ')[0].toLowerCase())}(?:'s)?(?:[^a-z0-9]|$)`).test(body)),
    );
    if (person) spec.owner = person.name;
  }
  return specSchema.parse(spec);
}

// ---------------- Optional AI path ----------------
export async function parseWithAi(query, ctx, includePeople, now = new Date()) {
  const system = [
    "You convert a salesperson's question into a JSON search filter for a CRM. Reply with ONE JSON object and nothing else.",
    'Allowed keys: entity (lead|deal|contact|account), status (new|contacted|qualified|unqualified|converted for leads; open|won|lost for deals),',
    'stage (a deal stage name), source, city, owner ("me" or a person\'s name), min_amount and max_amount (rupees as plain numbers; 1 lakh = 100000, 1 crore = 10000000),',
    'min_score (0-100), created_within_days, stale_days (no recent update), closing_within_days, closing_overdue (true/false), text (a name to look for).',
    'Include only keys the question actually asks for. Never invent values. ' + DATA_RULE,
    `Today is ${now.toISOString().slice(0, 10)}. Known stages: ${ctx.stages.join(', ')}. Known sources: ${ctx.sources.slice(0, 20).join(', ')}.`,
    `Known cities: ${ctx.cities.slice(0, 40).join(', ')}.` +
      (includePeople ? ` Team members: ${ctx.people.map((p) => p.name).join(', ')}.` : ''),
  ].join('\n');
  const text = await complete({ system, user: query, maxTokens: 300 });
  const parsed = specSchema.safeParse(extractJson(text));
  if (!parsed.success) throw new LlmError('The AI answer was not in the expected format');
  return parsed.data;
}

// ---------------- Context + execution ----------------
export async function loadContext(c, tenantId, includePeople) {
  const [stages, sources, cities, people] = await Promise.all([
    c.query('SELECT name FROM pipeline_stages WHERE tenant_id=$1 ORDER BY position', [tenantId]),
    c.query('SELECT DISTINCT source FROM leads WHERE tenant_id=$1 AND source IS NOT NULL LIMIT 60', [tenantId]),
    c.query(
      `SELECT DISTINCT city FROM (SELECT city FROM leads WHERE tenant_id=$1 UNION SELECT city FROM accounts WHERE tenant_id=$1 UNION SELECT city FROM contacts WHERE tenant_id=$1) x WHERE city IS NOT NULL LIMIT 300`,
      [tenantId],
    ),
    includePeople ? c.query('SELECT id,name FROM users WHERE tenant_id=$1 AND active', [tenantId]) : Promise.resolve({ rows: [] }),
  ]);
  return {
    stages: stages.rows.map((r) => r.name),
    sources: sources.rows.map((r) => r.source),
    cities: cities.rows.map((r) => r.city),
    people: people.rows,
  };
}

const MAX_ROWS = 50;

export async function runSpec(c, auth, spec, ctx) {
  const ignored = [];
  const params = [auth.tenantId];
  const where = ['t.tenant_id = $1'];
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const like = (v) => `%${v.replace(/[%_\\]/g, '\\$&')}%`;

  // Members only ever search their own records, whatever the question says.
  if (auth.role === 'member') where.push(`t.owner_id = ${p(auth.userId)}`);
  else if (spec.owner === 'me') where.push(`t.owner_id = ${p(auth.userId)}`);
  else if (spec.owner) {
    const person =
      ctx.people.find((x) => x.name.toLowerCase() === spec.owner.toLowerCase()) ??
      ctx.people.find((x) => x.name.toLowerCase().startsWith(spec.owner.toLowerCase().split(' ')[0]));
    if (person) where.push(`t.owner_id = ${p(person.id)}`);
    else ignored.push(`I could not find a team member called "${spec.owner}"`);
  }
  if (spec.created_within_days) where.push(`t.created_at >= now() - ${p(spec.created_within_days)}::int * interval '1 day'`);
  if (spec.stale_days) where.push(`t.updated_at < now() - ${p(spec.stale_days)}::int * interval '1 day'`);

  let from = '',
    cols = '';
  switch (spec.entity) {
    case 'lead': {
      from = 'leads t LEFT JOIN users o ON o.id=t.owner_id';
      cols = `t.id, trim(t.first_name || ' ' || coalesce(t.last_name,'')) AS title, t.company AS subtitle, t.status AS badge, NULL::numeric AS amount, t.score, o.name AS owner_name, t.created_at`;
      if (spec.status && ['new', 'contacted', 'qualified', 'unqualified', 'converted'].includes(spec.status))
        where.push(`t.status = ${p(spec.status)}`);
      if (spec.source) where.push(`t.source ILIKE ${p(like(spec.source))}`);
      if (spec.city) where.push(`t.city ILIKE ${p(like(spec.city))}`);
      if (spec.min_score !== undefined) where.push(`t.score >= ${p(spec.min_score)}`);
      if (spec.text)
        where.push(
          `(t.first_name ILIKE ${p(like(spec.text))} OR t.last_name ILIKE $${params.length} OR t.company ILIKE $${params.length})`,
        );
      if (spec.min_amount !== undefined || spec.max_amount !== undefined)
        ignored.push('Leads have no amount, so the amount filter was skipped');
      break;
    }
    case 'deal': {
      from =
        'deals t JOIN pipeline_stages s ON s.id=t.stage_id LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN users o ON o.id=t.owner_id';
      cols = `t.id, t.name AS title, a.name AS subtitle, s.name AS badge, t.amount, NULL::int AS score, o.name AS owner_name, t.created_at`;
      if (spec.status && ['open', 'won', 'lost'].includes(spec.status)) where.push(`t.status = ${p(spec.status)}`);
      if (spec.stage) where.push(`s.name ILIKE ${p(spec.stage)}`);
      if (spec.min_amount !== undefined) where.push(`t.amount >= ${p(spec.min_amount)}`);
      if (spec.max_amount !== undefined) where.push(`t.amount <= ${p(spec.max_amount)}`);
      if (spec.closing_within_days !== undefined)
        where.push(`t.status='open' AND t.expected_close BETWEEN current_date AND current_date + ${p(spec.closing_within_days)}::int`);
      if (spec.closing_overdue) where.push(`t.status='open' AND t.expected_close < current_date`);
      if (spec.text) where.push(`(t.name ILIKE ${p(like(spec.text))} OR a.name ILIKE $${params.length})`);
      if (spec.city) where.push(`a.city ILIKE ${p(like(spec.city))}`);
      break;
    }
    case 'contact': {
      from = 'contacts t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN users o ON o.id=t.owner_id';
      cols = `t.id, trim(t.first_name || ' ' || coalesce(t.last_name,'')) AS title, a.name AS subtitle, t.title AS badge, NULL::numeric AS amount, NULL::int AS score, o.name AS owner_name, t.created_at`;
      if (spec.city) where.push(`t.city ILIKE ${p(like(spec.city))}`);
      if (spec.text)
        where.push(`(t.first_name ILIKE ${p(like(spec.text))} OR t.last_name ILIKE $${params.length} OR a.name ILIKE $${params.length})`);
      break;
    }
    case 'account': {
      from = 'accounts t LEFT JOIN users o ON o.id=t.owner_id';
      cols = `t.id, t.name AS title, t.city AS subtitle, t.industry AS badge, t.annual_revenue AS amount, NULL::int AS score, o.name AS owner_name, t.created_at`;
      if (spec.city) where.push(`t.city ILIKE ${p(like(spec.city))}`);
      if (spec.text) where.push(`(t.name ILIKE ${p(like(spec.text))} OR t.industry ILIKE $${params.length})`);
      if (spec.min_amount !== undefined) where.push(`t.annual_revenue >= ${p(spec.min_amount)}`);
      if (spec.max_amount !== undefined) where.push(`t.annual_revenue <= ${p(spec.max_amount)}`);
      break;
    }
  }
  const sql = `SELECT ${cols}, count(*) OVER() AS _total FROM ${from} WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC LIMIT ${MAX_ROWS}`;
  const rows = (await c.query(sql, params)).rows;
  return {
    total: rows[0]?._total ?? 0,
    rows: rows.map(({ _total, ...r }) => ({ ...r, entity: spec.entity, amount: r.amount === null ? null : Number(r.amount) })),
    ignored,
  };
}

export const inr = (n) =>
  n >= 1e7 ? `₹${+(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${+(n / 1e5).toFixed(2)} L` : `₹${new Intl.NumberFormat('en-IN').format(n)}`;
const PLURAL = { lead: 'Leads', deal: 'Deals', contact: 'Contacts', account: 'Accounts' };

/** Human-readable chips that show the user how their sentence was understood. */
export function describeSpec(spec) {
  const out = [{ label: 'Showing', value: PLURAL[spec.entity] }];
  if (spec.status) out.push({ label: 'Status', value: spec.status });
  if (spec.stage) out.push({ label: 'Stage', value: spec.stage });
  if (spec.source) out.push({ label: 'Source', value: spec.source });
  if (spec.city) out.push({ label: 'City', value: spec.city });
  if (spec.owner) out.push({ label: 'Owner', value: spec.owner === 'me' ? 'You' : spec.owner });
  if (spec.min_amount !== undefined) out.push({ label: 'Amount at least', value: inr(spec.min_amount) });
  if (spec.max_amount !== undefined) out.push({ label: 'Amount at most', value: inr(spec.max_amount) });
  if (spec.min_score !== undefined) out.push({ label: 'Score at least', value: String(spec.min_score) });
  if (spec.created_within_days)
    out.push({ label: 'Added in the last', value: `${spec.created_within_days} day${spec.created_within_days === 1 ? '' : 's'}` });
  if (spec.stale_days) out.push({ label: 'No update for', value: `${spec.stale_days}+ days` });
  if (spec.closing_within_days !== undefined) out.push({ label: 'Closing within', value: `${spec.closing_within_days} days` });
  if (spec.closing_overdue) out.push({ label: 'Close date', value: 'overdue' });
  if (spec.text) out.push({ label: 'Name contains', value: spec.text });
  return out;
}
