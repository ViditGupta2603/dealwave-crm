import { beforeAll, describe, expect, it } from 'vitest';
import { MANAGER, MEMBER, OTHER_OWNER, OWNER, as, firstId, http, login } from './helpers.js';

let owner, manager, member, other;
beforeAll(async () => {
  [owner, manager, member, other] = await Promise.all([login(OWNER), login(MANAGER), login(MEMBER), login(OTHER_OWNER)]);
});

describe('tenant isolation through the API', () => {
  it('another workspace sees a 404 for our records, never the data', async () => {
    const leadId = await firstId('leads', owner.tenantId);
    expect((await http().get(`/api/leads/${leadId}`).set(as(owner))).status).toBe(200);
    expect((await http().get(`/api/leads/${leadId}`).set(as(other))).status).toBe(404);
    expect((await http().patch(`/api/leads/${leadId}`).set(as(other)).send({ city: 'Hacked' })).status).toBe(404);
    expect((await http().delete(`/api/leads/${leadId}`).set(as(other))).status).toBe(404);
  });

  it("lists only the caller's own workspace", async () => {
    const a = await http().get('/api/leads?limit=500').set(as(owner));
    const b = await http().get('/api/leads?limit=500').set(as(other));
    expect(a.body.total).toBeGreaterThan(b.body.total);
    const idsA = new Set(a.body.data.map((r) => r.id));
    expect(b.body.data.some((r) => idsA.has(r.id))).toBe(false);
  });
});

describe('roles', () => {
  it('a member sees only their own leads, a manager sees the team', async () => {
    const m = await http().get('/api/leads?limit=500').set(as(member));
    const t = await http().get('/api/leads?limit=500').set(as(manager));
    expect(m.body.total).toBeGreaterThan(0);
    expect(m.body.total).toBeLessThan(t.body.total);
    expect(m.body.data.every((r) => r.owner_id === member.userId)).toBe(true);
  });

  it("a member cannot delete records, and cannot open someone else's record", async () => {
    const mine = (await http().get('/api/leads?limit=1').set(as(member))).body.data[0].id;
    expect((await http().delete(`/api/leads/${mine}`).set(as(member))).status).toBe(403);
    const notMine = await firstId('leads', owner.tenantId, 'owner_id IS DISTINCT FROM $2', [member.userId]);
    expect((await http().get(`/api/leads/${notMine}`).set(as(member))).status).toBe(404);
  });

  it('only admins can open the team settings', async () => {
    expect((await http().get('/api/team').set(as(member))).status).toBe(403);
    expect((await http().get('/api/team').set(as(owner))).status).toBe(200);
  });
});

describe('leads', () => {
  it('moves a lead between statuses (used by the lead board)', async () => {
    const id = (await http().get('/api/leads?limit=1&status=new').set(as(owner))).body.data[0].id;
    const r = await http().patch(`/api/leads/${id}`).set(as(owner)).send({ status: 'contacted' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('contacted');
    expect((await http().patch(`/api/leads/${id}`).set(as(owner)).send({ status: 'bogus' })).status).toBe(400);
  });

  it('validates input and reports which field is wrong', async () => {
    const r = await http().post('/api/leads').set(as(owner)).send({ last_name: 'NoFirstName', email: 'not-an-email' });
    expect(r.status).toBe(400);
    expect(r.body.fields.first_name).toBeTruthy();
    expect(r.body.fields.email).toBeTruthy();
  });

  it('creates a lead with a custom field and enforces custom field rules', async () => {
    const ok = await http()
      .post('/api/leads')
      .set(as(owner))
      .send({ first_name: 'Test', last_name: 'Lead', custom_data: { budget_range: '₹10L-50L' } });
    expect(ok.status).toBe(201);
    const bad = await http()
      .post('/api/leads')
      .set(as(owner))
      .send({ first_name: 'Test', custom_data: { budget_range: 'Not an option' } });
    expect(bad.status).toBe(400);
  });
});
