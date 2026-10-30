import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setLlmFetch } from '../src/lib/llm.js';
import { scoreLead } from '../src/lib/scoring.js';
import { parseQuery } from '../src/lib/nlsearch.js';
import { pickTemplateName } from '../src/lib/aiText.js';
import { withSystem } from '../src/db.js';
import { MANAGER, MEMBER, OTHER_OWNER, OWNER, as, firstId, http, login } from './helpers.js';

const NOW = new Date('2026-10-15T10:00:00Z');
const ctx = {
  stages: ['Prospecting', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'],
  sources: ['Website', 'Referral', 'Google Ads', 'Trade show'],
  cities: ['Pune', 'Mumbai', 'New Delhi', 'Indore'],
  people: [
    { id: 'u1', name: 'Rohan Deshmukh' },
    { id: 'u2', name: 'Priya Nair' },
  ],
};

describe('lead scoring', () => {
  const base = {
    source: 'Referral',
    email: 'a@b.com',
    phone: '999',
    company: 'Acme',
    title: 'Managing Director',
    status: 'qualified',
    created_at: NOW.toISOString(),
    custom_data: { budget_range: 'Above ₹2Cr' },
  };
  it('rewards a warm, senior, well-sourced lead and explains every point', () => {
    const r = scoreLead(base, 3, NOW);
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.factors.reduce((a, f) => a + f.points, 0)).toBeGreaterThanOrEqual(r.score);
    expect(r.factors.some((f) => /Referral/.test(f.label))).toBe(true);
    expect(r.factors.some((f) => /decision maker/.test(f.label))).toBe(true);
  });
  it('scores a bare cold lead low', () => {
    expect(scoreLead({ source: 'Cold outreach', status: 'new', created_at: NOW.toISOString() }, 0, NOW).score).toBeLessThan(25);
  });
  it('an unqualified lead drops sharply and is never negative', () => {
    const r = scoreLead(
      { ...base, status: 'unqualified', source: null, email: null, phone: null, company: null, title: null, custom_data: {} },
      0,
      NOW,
    );
    expect(r.score).toBe(0);
  });
  it('is capped at 100', () => expect(scoreLead({ ...base, status: 'qualified' }, 10, NOW).score).toBeLessThanOrEqual(100));
  it('old and untouched leads lose points', () => {
    const old = { source: 'Website', status: 'new', created_at: new Date(NOW.getTime() - 200 * 86400000).toISOString() };
    const fresh = { ...old, created_at: NOW.toISOString() };
    expect(scoreLead(old, 0, NOW).score).toBeLessThan(scoreLead(fresh, 0, NOW).score);
  });
});

describe('plain-English parsing (no AI needed)', () => {
  const p = (q) => parseQuery(q, ctx, NOW);
  it('lead status, source and city', () => {
    expect(p('qualified leads from website in Pune')).toMatchObject({
      entity: 'lead',
      status: 'qualified',
      source: 'Website',
      city: 'Pune',
    });
  });
  it('unqualified is not mistaken for qualified', () => expect(p('show unqualified leads').status).toBe('unqualified'));
  it('amounts in lakh and crore, and the deal type', () => {
    expect(p('deals above 50 lakh')).toMatchObject({ entity: 'deal', min_amount: 5_000_000 });
    expect(p('deals worth more than 1.5 crore').min_amount).toBe(15_000_000);
    expect(p('lost deals under 10 lakhs')).toMatchObject({ status: 'lost', max_amount: 1_000_000 });
    expect(p('deals over ₹2,50,000').min_amount).toBe(250_000);
  });
  it('an amount alone implies deals', () => expect(p('anything above 20 lakh').entity).toBe('deal'));
  it('does not read "over 30 days" as an amount', () => {
    const s = p('leads added over 30 days ago');
    expect(s.min_amount).toBeUndefined();
    expect(s.entity).toBe('lead');
  });
  it('reads "not updated in 30 days" as an inactivity filter', () => {
    const s = p('deals not updated in 30 days');
    expect(s.stale_days).toBe(30);
    expect(s.min_amount).toBeUndefined();
  });
  it("stages, mine, and a teammate's first name", () => {
    expect(p('my deals in proposal stage')).toMatchObject({ entity: 'deal', owner: 'me', stage: 'Proposal' });
    expect(p("Rohan's leads")).toMatchObject({ entity: 'lead', owner: 'Rohan Deshmukh' });
  });
  it('time words', () => {
    expect(p('hot leads added this week')).toMatchObject({ min_score: 70, created_within_days: 7 });
    expect(p('leads in the last 3 weeks').created_within_days).toBe(21);
    expect(p('leads created today').created_within_days).toBe(1);
    expect(p('leads this month').created_within_days).toBe(15);
  });
  it('closing dates', () => {
    expect(p('open deals closing this month').closing_within_days).toBe(16);
    expect(p('deals closing in 2 weeks').closing_within_days).toBe(14);
    expect(p('overdue deals').closing_overdue).toBe(true);
  });
  it('multi-word cities', () => expect(p('contacts in New Delhi')).toMatchObject({ entity: 'contact', city: 'New Delhi' }));
  it('score threshold', () => expect(p('leads with score above 80').min_score).toBe(80));
  it('an empty-ish question still gives a valid spec', () => expect(p('hello there').entity).toBe('lead'));
});

describe('picking an email template from a goal', () => {
  it.each([
    ['send the quotation', 'Quotation follow-up'],
    ['confirm our meeting', 'Meeting confirmation'],
    ['thank them', 'Thank you for choosing us'],
    ['gentle reminder', 'Pending decision reminder'],
    ['say hello', 'Introduction'],
  ])('%s', (g, n) => expect(pickTemplateName(g)).toBe(n));
});

let owner, manager, member, other;
beforeAll(async () => {
  [owner, manager, member, other] = await Promise.all([login(OWNER), login(MANAGER), login(MEMBER), login(OTHER_OWNER)]);
});
afterEach(async () => {
  setLlmFetch(null);
  delete process.env.ANTHROPIC_API_KEY;
  await withSystem((c) => c.query('UPDATE tenants SET ai_enabled=true'));
});

const okReply = (text) => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }] }) }));

describe('search endpoint', () => {
  it('answers in rules mode with the interpretation shown', async () => {
    const r = await http().post('/api/ai/search').set(as(owner)).send({ query: 'qualified leads' });
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe('rules');
    expect(r.body.interpretation.some((c) => c.label === 'Status' && c.value === 'qualified')).toBe(true);
    expect(r.body.rows.length).toBeGreaterThan(0);
    expect(r.body.rows.every((x) => x.badge === 'qualified')).toBe(true);
  });
  it('a member only ever gets their own records', async () => {
    const r = await http().post('/api/ai/search').set(as(member)).send({ query: 'all leads' });
    const mine = (await http().get('/api/leads?limit=1').set(as(member))).body.total;
    expect(r.body.total).toBe(mine);
    const spy = await http().post('/api/ai/search').set(as(member)).send({ query: "Priya's leads" });
    expect(spy.body.total).toBeLessThanOrEqual(mine);
  });
  it('never crosses into another workspace', async () => {
    const a = await http().post('/api/ai/search').set(as(owner)).send({ query: 'leads' });
    const b = await http().post('/api/ai/search').set(as(other)).send({ query: 'leads' });
    const idsA = new Set(a.body.rows.map((x) => x.id));
    expect(b.body.rows.some((x) => idsA.has(x.id))).toBe(false);
    expect(b.body.total).not.toBe(a.body.total);
  });
  it('treats SQL-looking text as plain text', async () => {
    const r = await http().post('/api/ai/search').set(as(owner)).send({ query: "leads named '; DROP TABLE leads; --" });
    expect(r.status).toBe(200);
    expect((await http().get('/api/leads?limit=1').set(as(owner))).status).toBe(200);
  });
  it('validates the question', async () => {
    expect((await http().post('/api/ai/search').set(as(owner)).send({ query: 'a' })).status).toBe(400);
    expect((await http().post('/api/ai/search').send({ query: 'leads' })).status).toBe(401);
  });
  it('uses the AI to understand the question when a key is set, and validates what it returns', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const fetchMock = okReply('Sure! {"entity":"deal","status":"won","min_amount":5000000,"sql":"DROP TABLE deals"}');
    setLlmFetch(fetchMock);
    const r = await http().post('/api/ai/search').set(as(owner)).send({ query: 'big wins' });
    expect(r.body.mode).toBe('ai');
    expect(r.body.entity).toBe('deal');
    expect(r.body.rows.every((x) => x.amount >= 5_000_000)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-test-key');
    expect(JSON.parse(init.body).system).toMatch(/untrusted data/);
  });
  it('falls back to the built-in rules when the AI fails or returns nonsense', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    setLlmFetch(okReply('I cannot help with that'));
    expect((await http().post('/api/ai/search').set(as(owner)).send({ query: 'qualified leads' })).body.mode).toBe('rules');
    setLlmFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect((await http().post('/api/ai/search').set(as(owner)).send({ query: 'qualified leads' })).body.mode).toBe('rules');
    setLlmFetch(okReply('{"entity":"spreadsheet"}'));
    expect((await http().post('/api/ai/search').set(as(owner)).send({ query: 'qualified leads' })).body.mode).toBe('rules');
  });
  it('does not send anything to the AI when the workspace has switched AI off', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const fetchMock = okReply('{"entity":"lead"}');
    setLlmFetch(fetchMock);
    expect((await http().patch('/api/ai/settings').set(as(owner)).send({ enabled: false })).status).toBe(200);
    const r = await http().post('/api/ai/search').set(as(owner)).send({ query: 'leads' });
    expect(r.body.mode).toBe('rules');
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await http().get('/api/ai/status').set(as(owner))).body).toMatchObject({ enabled: false, ai_active: false });
  });
});

describe('lead score endpoints', () => {
  it('explains the score of a lead', async () => {
    const id = await firstId('leads', owner.tenantId);
    const r = await http().get(`/api/ai/lead-score/${id}`).set(as(owner));
    expect(r.status).toBe(200);
    expect(r.body.score).toBeGreaterThanOrEqual(0);
    expect(r.body.factors.length).toBeGreaterThan(1);
  });
  it("a member cannot score someone else's lead, and other workspaces cannot either", async () => {
    const theirs = await firstId('leads', owner.tenantId, 'owner_id IS DISTINCT FROM $2', [member.userId]);
    expect((await http().get(`/api/ai/lead-score/${theirs}`).set(as(member))).status).toBe(404);
    expect((await http().get(`/api/ai/lead-score/${theirs}`).set(as(other))).status).toBe(404);
  });
  it('only admins can re-score every lead', async () => {
    expect((await http().post('/api/ai/rescore').set(as(member))).status).toBe(403);
    expect((await http().post('/api/ai/rescore').set(as(manager))).status).toBe(403);
    const r = await http().post('/api/ai/rescore').set(as(owner));
    expect(r.status).toBe(200);
    expect(r.body.checked).toBeGreaterThan(50);
  });
});

describe('summary', () => {
  it('builds a factual summary with no AI', async () => {
    const id = await firstId('deals', owner.tenantId, `status='open'`);
    const r = await http().post('/api/ai/summary').set(as(owner)).send({ entity: 'deal', id });
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe('auto');
    expect(r.body.text).toMatch(/open deal worth/);
  });
  it('covers leads, contacts and accounts', async () => {
    for (const [entity, table] of [
      ['lead', 'leads'],
      ['contact', 'contacts'],
      ['account', 'accounts'],
    ]) {
      const r = await http()
        .post('/api/ai/summary')
        .set(as(owner))
        .send({ entity, id: await firstId(table, owner.tenantId) });
      expect(r.status).toBe(200);
      expect(r.body.text.length).toBeGreaterThan(30);
    }
  });
  it('respects who may see the record', async () => {
    const theirs = await firstId('deals', owner.tenantId, 'owner_id IS DISTINCT FROM $2', [member.userId]);
    expect((await http().post('/api/ai/summary').set(as(member)).send({ entity: 'deal', id: theirs })).status).toBe(404);
    expect((await http().post('/api/ai/summary').set(as(other)).send({ entity: 'deal', id: theirs })).status).toBe(404);
  });
  it('uses the AI when available, and falls back when it fails', async () => {
    const id = await firstId('deals', owner.tenantId);
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const fetchMock = okReply('A short AI briefing.');
    setLlmFetch(fetchMock);
    const ai = await http().post('/api/ai/summary').set(as(owner)).send({ entity: 'deal', id });
    expect(ai.body).toEqual({ mode: 'ai', text: 'A short AI briefing.' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).toContain('"type":"deal"');
    setLlmFetch(async () => {
      throw new Error('network down');
    });
    expect((await http().post('/api/ai/summary').set(as(owner)).send({ entity: 'deal', id })).body.mode).toBe('auto');
  });
});

describe('email draft', () => {
  it('without AI, picks a template that fits the goal and fills it in', async () => {
    const id = await firstId('leads', owner.tenantId);
    const r = await http().post('/api/ai/email-draft').set(as(owner)).send({ entity: 'lead', id, goal: 'send the quotation' });
    expect(r.body.mode).toBe('template');
    expect(r.body.subject).toMatch(/quotation/i);
    expect(r.body.body).not.toMatch(/\{\{/);
    expect(r.body.body).toContain('Rajesh');
  });
  it("with AI, returns the model's draft after validating its shape", async () => {
    const id = await firstId('leads', owner.tenantId);
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    setLlmFetch(okReply('```json\n{"subject":"Quick hello","body":"Hi,\\n\\nNice to meet you.\\n\\nRajesh"}\n```'));
    const r = await http().post('/api/ai/email-draft').set(as(owner)).send({ entity: 'lead', id, goal: 'introduce us' });
    expect(r.body).toMatchObject({ mode: 'ai', subject: 'Quick hello' });
    setLlmFetch(okReply('{"subject":"","body":"x"}'));
    expect((await http().post('/api/ai/email-draft').set(as(owner)).send({ entity: 'lead', id })).body.mode).toBe('template');
  });
  it('will not draft for a record the member cannot see', async () => {
    const theirs = await firstId('leads', owner.tenantId, 'owner_id IS DISTINCT FROM $2', [member.userId]);
    expect((await http().post('/api/ai/email-draft').set(as(member)).send({ entity: 'lead', id: theirs })).status).toBe(404);
  });
});

describe('AI settings', () => {
  it('only admins can switch it', async () => {
    expect((await http().patch('/api/ai/settings').set(as(member)).send({ enabled: false })).status).toBe(403);
    expect((await http().patch('/api/ai/settings').set(as(owner)).send({ enabled: 'no' })).status).toBe(400);
  });
});
