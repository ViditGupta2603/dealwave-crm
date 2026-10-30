import { beforeAll, describe, expect, it } from 'vitest';
import { withSystem } from '../src/db.js';
import { buildCalendar, fold } from '../src/lib/ics.js';
import { MEMBER, OTHER_OWNER, OWNER, as, http, login } from './helpers.js';

describe('iCalendar writer', () => {
  it('produces a well-formed calendar with CRLF line endings', () => {
    const ics = buildCalendar(
      'Test',
      [
        {
          uid: 'a@x',
          summary: 'Call, Ramesh; "urgent"',
          description: 'Line1\nLine2',
          start: new Date('2026-10-20T09:30:00Z'),
          alarmMinutes: 15,
        },
      ],
      new Date('2026-10-01T00:00:00Z'),
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261020T093000Z');
    expect(ics).toContain('DTEND:20261020T100000Z');
    expect(ics).toContain('SUMMARY:Call\\, Ramesh\\; "urgent"');
    expect(ics).toContain('DESCRIPTION:Line1\\nLine2');
    expect(ics).toContain('TRIGGER:-PT15M');
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });
  it('folds long lines at 75 bytes without splitting a character', () => {
    const long = 'SUMMARY:' + 'नमस्ते '.repeat(30);
    const folded = fold(long);
    for (const line of folded.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
  });
});

let owner, member, other;
let taskId = '';
beforeAll(async () => {
  [owner, member, other] = await Promise.all([login(OWNER), login(MEMBER), login(OTHER_OWNER)]);
  taskId = await withSystem(
    async (c) =>
      (
        await c.query(
          `SELECT id FROM activities WHERE tenant_id=$1 AND owner_id=$2 AND type='task' AND completed_at IS NULL AND due_at IS NOT NULL LIMIT 1`,
          [owner.tenantId, member.userId],
        )
      ).rows[0].id,
  );
});

describe('add one task to a calendar', () => {
  it('downloads a .ics for a task with a due date', async () => {
    const r = await http().get(`/api/calendar/activity/${taskId}.ics`).set(as(member));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/calendar/);
    expect(r.text).toContain('BEGIN:VEVENT');
    expect(r.text).toContain(`UID:${taskId}@dealwave-crm`);
  });
  it("is not available for someone else's task, or from another workspace", async () => {
    const theirs = await withSystem(
      async (c) =>
        (
          await c.query(`SELECT id FROM activities WHERE tenant_id=$1 AND owner_id IS DISTINCT FROM $2 AND due_at IS NOT NULL LIMIT 1`, [
            owner.tenantId,
            member.userId,
          ])
        ).rows[0].id,
    );
    expect((await http().get(`/api/calendar/activity/${theirs}.ics`).set(as(member))).status).toBe(404);
    expect((await http().get(`/api/calendar/activity/${taskId}.ics`).set(as(other))).status).toBe(404);
    expect((await http().get(`/api/calendar/activity/${taskId}.ics`)).status).toBe(401);
  });
  it('says so when a task has no due date', async () => {
    const id = await withSystem(
      async (c) =>
        (
          await c.query(`INSERT INTO activities (tenant_id,type,subject,owner_id) VALUES ($1,'task','No date',$2) RETURNING id`, [
            owner.tenantId,
            member.userId,
          ])
        ).rows[0].id,
    );
    expect((await http().get(`/api/calendar/activity/${id}.ics`).set(as(member))).status).toBe(400);
  });
});

describe('subscription feed', () => {
  let url = '';
  it("creates a private link, stores only its hash, and serves the person's open tasks", async () => {
    expect((await http().get('/api/calendar/feed').set(as(member))).body.enabled).toBe(false);
    const r = await http().post('/api/calendar/feed-token').set(as(member));
    expect(r.status).toBe(201);
    url = r.body.url;
    expect(url).toMatch(/\/api\/calendar\/public\/[0-9a-f]{64}\.ics$/);
    const token = url.split('/').pop().replace('.ics', '');
    const stored = await withSystem(
      async (c) => (await c.query('SELECT calendar_token_hash FROM users WHERE id=$1', [member.userId])).rows[0].calendar_token_hash,
    );
    expect(stored).not.toContain(token);

    const feed = await http().get(new URL(url).pathname);
    expect(feed.status).toBe(200);
    expect(feed.headers['content-type']).toMatch(/text\/calendar/);
    expect(feed.headers['cache-control']).toMatch(/no-store/);
    expect((feed.text.match(/BEGIN:VEVENT/g) || []).length).toBeGreaterThan(0);
    expect(feed.text).toContain(`UID:${taskId}@dealwave-crm`);
  });
  it("contains only that person's items, never completed ones", async () => {
    const feed = await http().get(new URL(url).pathname);
    const uids = [...feed.text.matchAll(/UID:([0-9a-f-]{36})@/g)].map((m) => m[1]);
    const rows = await withSystem(
      async (c) => (await c.query('SELECT id, owner_id, completed_at FROM activities WHERE id = ANY($1::uuid[])', [uids])).rows,
    );
    expect(rows.length).toBe(uids.length);
    expect(rows.every((r) => r.owner_id === member.userId && r.completed_at === null)).toBe(true);
  });
  it('rejects guessed or malformed links', async () => {
    expect((await http().get('/api/calendar/public/' + '0'.repeat(64) + '.ics')).status).toBe(404);
    expect((await http().get('/api/calendar/public/short.ics')).status).toBe(404);
    expect((await http().get("/api/calendar/public/'%20OR%201=1--.ics")).status).toBe(404);
  });
  it('stops working as soon as the link is removed or replaced', async () => {
    const second = await http().post('/api/calendar/feed-token').set(as(member));
    expect((await http().get(new URL(url).pathname)).status).toBe(404); // old link dead
    expect((await http().get(new URL(second.body.url).pathname)).status).toBe(200);
    expect((await http().delete('/api/calendar/feed-token').set(as(member))).status).toBe(204);
    expect((await http().get(new URL(second.body.url).pathname)).status).toBe(404);
  });
});
