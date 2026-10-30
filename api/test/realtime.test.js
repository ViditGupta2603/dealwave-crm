import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { app } from '../src/app.js';
import { closeRealtime, visibleTo } from '../src/lib/realtime.js';
import { MANAGER, MEMBER, OTHER_OWNER, OWNER, as, firstId, http, login } from './helpers.js';

let server;
let base = '';
let owner, manager, member, other;

beforeAll(async () => {
  [owner, manager, member, other] = await Promise.all([login(OWNER), login(MANAGER), login(MEMBER), login(OTHER_OWNER)]);
  await new Promise((r) => {
    server = app.listen(0, r);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  closeRealtime();
  await new Promise((r) => server.close(r));
});

/** Opens /api/events like the browser does (fetch + bearer token) and collects the parsed events. */
function listen(s) {
  const ctl = new AbortController();
  const events = [];
  let resolveReady;
  const ready = new Promise((r) => {
    resolveReady = r;
  });
  fetch(`${base}/api/events`, { headers: { Authorization: `Bearer ${s.token}` }, signal: ctl.signal })
    .then(async (res) => {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (ev === 'ready') resolveReady();
          if (ev === 'change' && data) events.push(JSON.parse(data));
        }
      }
    })
    .catch(() => undefined);
  return { events, ready, close: () => ctl.abort() };
}

const until = async (fn, ms = 3000) => {
  const t = Date.now();
  while (!fn() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 25));
  return fn();
};
const quiet = (ms = 700) => new Promise((r) => setTimeout(r, ms));

describe('live updates', () => {
  it('requires sign-in', async () => {
    expect((await fetch(`${base}/api/events`)).status).toBe(401);
  });

  it('sends the right headers and a ready event', async () => {
    const res = await fetch(`${base}/api/events`, { headers: { Authorization: `Bearer ${owner.token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    await res.body.cancel();
  });

  it('a change made by one person reaches another person in the same workspace', async () => {
    const watcher = listen(owner);
    await watcher.ready;
    const leadId = await firstId('leads', owner.tenantId);
    const r = await http()
      .patch(`/api/leads/${leadId}`)
      .set(as(manager))
      .send({ city: `Live-${Date.now()}` });
    expect(r.status).toBe(200);
    expect(await until(() => watcher.events.some((e) => e.entity === 'lead' && e.id === leadId && e.action === 'updated'))).toBe(true);
    const ev = watcher.events.find((e) => e.id === leadId);
    expect(ev.by_name).toBe('Arjun Kapoor');
    watcher.close();
  });

  it('reports created and deleted records, and stage moves on deals', async () => {
    const watcher = listen(manager);
    await watcher.ready;
    const created = await http().post('/api/leads').set(as(owner)).send({ first_name: 'Live', last_name: 'Created' });
    expect(await until(() => watcher.events.some((e) => e.id === created.body.id && e.action === 'created'))).toBe(true);
    expect((await http().delete(`/api/leads/${created.body.id}`).set(as(owner))).status).toBe(204);
    expect(await until(() => watcher.events.some((e) => e.id === created.body.id && e.action === 'deleted'))).toBe(true);

    const deal = (await http().get('/api/deals?status=open&limit=1').set(as(owner))).body.data[0];
    const stages = (await http().get('/api/pipeline/stages').set(as(owner))).body;
    const target = stages.find((s) => !s.is_won && !s.is_lost && s.id !== deal.stage_id);
    await http().patch(`/api/deals/${deal.id}`).set(as(owner)).send({ stage_id: target.id });
    expect(await until(() => watcher.events.some((e) => e.id === deal.id && e.action === 'moved'))).toBe(true);
    expect(watcher.events.find((e) => e.id === deal.id && e.action === 'moved').detail).toBe(target.name);
    watcher.close();
  });

  it('never leaks events to another workspace', async () => {
    const outsider = listen(other);
    await outsider.ready;
    const leadId = await firstId('leads', owner.tenantId);
    await http()
      .patch(`/api/leads/${leadId}`)
      .set(as(owner))
      .send({ city: `Private-${Date.now()}` });
    await quiet();
    expect(outsider.events.length).toBe(0);
    outsider.close();
  });

  it('a member only hears about their own records', async () => {
    const watcher = listen(member);
    await watcher.ready;
    const theirs = await firstId('leads', owner.tenantId, 'owner_id = $2', [member.userId]);
    const notTheirs = await firstId('leads', owner.tenantId, 'owner_id IS DISTINCT FROM $2', [member.userId]);
    await http()
      .patch(`/api/leads/${notTheirs}`)
      .set(as(manager))
      .send({ city: `Hidden-${Date.now()}` });
    await quiet();
    expect(watcher.events.some((e) => e.id === notTheirs)).toBe(false);
    await http()
      .patch(`/api/leads/${theirs}`)
      .set(as(manager))
      .send({ city: `Mine-${Date.now()}` });
    expect(await until(() => watcher.events.some((e) => e.id === theirs))).toBe(true);
    watcher.close();
  });
});

describe('who may hear what', () => {
  const rec = (owner_id) => ({ type: 'record', entity: 'lead', id: 'x', action: 'updated', owner_id });
  it('managers hear every record event in the workspace', () =>
    expect(visibleTo(rec('someone'), { userId: 'me', role: 'manager' })).toBe(true));
  it('members hear only their own records', () => {
    expect(visibleTo(rec('me'), { userId: 'me', role: 'member' })).toBe(true);
    expect(visibleTo(rec('other'), { userId: 'me', role: 'member' })).toBe(false);
    expect(visibleTo(rec(null), { userId: 'me', role: 'member' })).toBe(false);
  });
  it('notifications go only to the person they are for', () => {
    expect(visibleTo({ type: 'notification', user_id: 'me' }, { userId: 'me', role: 'member' })).toBe(true);
    expect(visibleTo({ type: 'notification', user_id: 'me' }, { userId: 'boss', role: 'owner' })).toBe(false);
  });
});
