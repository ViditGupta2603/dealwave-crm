const SOURCE_POINTS = {
  referral: 25,
  partner: 18,
  'trade show': 15,
  webinar: 12,
  linkedin: 10,
  website: 10,
  'google ads': 8,
  'cold outreach': 3,
};
const SENIOR =
  /(founder|owner|director|managing|\bmd\b|\bceo\b|\bcfo\b|\bcto\b|\bcoo\b|\bvp\b|vice president|head|general manager|partner)/i;
const MID = /(manager|lead|chief|principal|procurement|purchase)/i;
const BUDGET_POINTS = [
  [/above|crore|2\s*cr/i, 15],
  [/50\s*l.*2\s*cr|₹50l/i, 10],
  [/10\s*l.*50\s*l|₹10l/i, 5],
];

/**
 * An explainable lead score from 0 to 100. Every point comes from a visible reason, so a salesperson can see
 * why a lead scored what it did. It never calls an AI service and never sends data anywhere.
 */
export function scoreLead(lead, touches30, now = new Date()) {
  const f = [{ label: 'Starting point', points: 10 }];
  const add = (label, points) => {
    if (points !== 0) f.push({ label, points });
  };

  const src = String(lead.source ?? '').trim();
  if (src) add(`Came from ${src}`, SOURCE_POINTS[src.toLowerCase()] ?? 0);
  if (lead.email) add('Has an email address', 8);
  if (lead.phone) add('Has a phone number', 8);
  if (lead.company) add('Company is known', 6);

  const title = String(lead.title ?? '');
  if (SENIOR.test(title)) add(`Senior decision maker (${title})`, 15);
  else if (MID.test(title)) add(`Manager level (${title})`, 8);

  const budget = String(lead.custom_data?.budget_range ?? '');
  if (budget) {
    const hit = BUDGET_POINTS.find(([re]) => re.test(budget));
    if (hit) add(`Budget: ${budget}`, hit[1]);
  }

  const t = Math.min(3, touches30);
  if (t > 0) add(`${touches30} contact${touches30 === 1 ? '' : 's'} in the last 30 days`, t * 4);

  const status = String(lead.status ?? '');
  if (status === 'qualified') add('Already qualified', 10);
  else if (status === 'contacted') add('We have reached out', 4);
  else if (status === 'unqualified') add('Marked unqualified', -40);

  const ageDays = (now.getTime() - new Date(lead.created_at ?? now).getTime()) / 86_400_000;
  if (ageDays > 90 && touches30 === 0 && status !== 'converted') add('Older than 90 days with no recent contact', -10);

  const score = Math.max(
    0,
    Math.min(
      100,
      f.reduce((a, x) => a + x.points, 0),
    ),
  );
  return { score, factors: f };
}

/** Number of calls, meetings, emails, notes and tasks logged against each lead in the last 30 days. */
export async function loadTouches(c, tenantId, leadIds) {
  const out = new Map();
  if (!leadIds.length) return out;
  const { rows } = await c.query(
    `SELECT related_id AS id, count(*)::int AS n FROM (
        SELECT related_id FROM activities WHERE tenant_id=$1 AND related_type='lead' AND related_id = ANY($2::uuid[]) AND created_at > now() - interval '30 days'
        UNION ALL
        SELECT related_id FROM email_log WHERE tenant_id=$1 AND related_type='lead' AND related_id = ANY($2::uuid[]) AND created_at > now() - interval '30 days' AND status <> 'failed'
     ) x GROUP BY related_id`,
    [tenantId, leadIds],
  );
  for (const r of rows) out.set(r.id, r.n);
  return out;
}
