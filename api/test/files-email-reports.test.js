import { beforeAll, describe, expect, it } from 'vitest';
import { MANAGER, MEMBER, OTHER_OWNER, OWNER, as, firstId, http, login, tinyPdf } from './helpers.js';

let owner, manager, member, other;
let dealId = '';
let memberDealId = '';

beforeAll(async () => {
  [owner, manager, member, other] = await Promise.all([login(OWNER), login(MANAGER), login(MEMBER), login(OTHER_OWNER)]);
  dealId = await firstId('deals', owner.tenantId, 'owner_id IS DISTINCT FROM $2', [member.userId]);
  memberDealId = await firstId('deals', owner.tenantId, 'owner_id = $2', [member.userId]);
});

const upload = (s, entityId, filename, body, entity = 'deal') =>
  http()
    .post(`/api/attachments?entity=${entity}&entity_id=${entityId}&filename=${encodeURIComponent(filename)}`)
    .set(as(s))
    .set('Content-Type', 'application/octet-stream')
    .send(body);

describe('file attachments', () => {
  it('uploads, lists, downloads the same bytes, and deletes', async () => {
    const pdf = tinyPdf();
    const up = await upload(owner, dealId, 'quotation.pdf', pdf);
    expect(up.status).toBe(201);
    expect(up.body.mime_type).toBe('application/pdf');

    const list = await http().get(`/api/attachments?entity=deal&entity_id=${dealId}`).set(as(owner));
    expect(list.body.some((a) => a.id === up.body.id)).toBe(true);

    const dl = await http()
      .get(`/api/attachments/${up.body.id}/download`)
      .set(as(owner))
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/attachment/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(dl.body, pdf)).toBe(0);

    expect((await http().delete(`/api/attachments/${up.body.id}`).set(as(owner))).status).toBe(204);
    expect((await http().get(`/api/attachments/${up.body.id}/download`).set(as(owner))).status).toBe(404);
  });

  it('rejects dangerous or fake files and files that are too large', async () => {
    expect((await upload(owner, dealId, 'run.exe', tinyPdf())).status).toBe(400);
    expect((await upload(owner, dealId, 'page.html', '<script>alert(1)</script>')).status).toBe(400);
    expect((await upload(owner, dealId, 'fake.pdf', 'this is not a pdf')).status).toBe(400);
    expect((await upload(owner, dealId, 'empty.txt', Buffer.alloc(0))).status).toBe(400);
    expect((await upload(owner, dealId, 'big.txt', Buffer.alloc(5 * 1024 * 1024 + 10, 97))).status).toBe(413);
  });

  it('keeps files inside their own workspace', async () => {
    const up = await upload(owner, dealId, 'private.pdf', tinyPdf());
    expect((await http().get(`/api/attachments?entity=deal&entity_id=${dealId}`).set(as(other))).status).toBe(404);
    expect((await http().get(`/api/attachments/${up.body.id}/download`).set(as(other))).status).toBe(404);
    expect((await http().delete(`/api/attachments/${up.body.id}`).set(as(other))).status).toBe(404);
    expect((await upload(other, dealId, 'x.pdf', tinyPdf())).status).toBe(404);
  });

  it("a member only reaches files on their own records, and cannot delete others' files", async () => {
    expect((await http().get(`/api/attachments?entity=deal&entity_id=${dealId}`).set(as(member))).status).toBe(404);
    const up = await upload(owner, memberDealId, 'owner-upload.pdf', tinyPdf());
    expect(up.status).toBe(201);
    expect((await http().delete(`/api/attachments/${up.body.id}`).set(as(member))).status).toBe(403);
    expect((await http().delete(`/api/attachments/${up.body.id}`).set(as(manager))).status).toBe(204);
  });
});

describe('email', () => {
  it('sends, logs, and puts the email on the record timeline', async () => {
    const leadId = await firstId('leads', owner.tenantId);
    const r = await http()
      .post('/api/emails/send')
      .set(as(owner))
      .send({ to: 'Buyer@Example.com', subject: 'Hello there', body: 'Test body', related_type: 'lead', related_id: leadId });
    expect(r.status).toBe(201);
    expect(['sent', 'simulated']).toContain(r.body.status);

    const log = await http().get(`/api/emails?related_type=lead&related_id=${leadId}`).set(as(owner));
    expect(log.body.data.some((e) => e.subject === 'Hello there' && e.to_email === 'buyer@example.com')).toBe(true);

    const acts = await http().get(`/api/activities?related_type=lead&related_id=${leadId}&limit=100`).set(as(owner));
    expect(acts.body.data.some((a) => a.type === 'email' && a.subject.includes('Hello there'))).toBe(true);
  });

  it('validates the address and subject', async () => {
    const r = await http().post('/api/emails/send').set(as(owner)).send({ to: 'nope', subject: '', body: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.fields.to).toBeTruthy();
    expect(r.body.fields.subject).toBeTruthy();
  });

  it('will not email on a record the member cannot see', async () => {
    const r = await http()
      .post('/api/emails/send')
      .set(as(member))
      .send({ to: 'a@b.com', subject: 's', body: 'b', related_type: 'deal', related_id: dealId });
    expect(r.status).toBe(404);
  });

  it('a member sees only the emails they sent; a manager sees all', async () => {
    const m = await http().get('/api/emails?limit=100').set(as(member));
    expect(m.body.data.every((e) => e.sender_name === 'Rohan Deshmukh')).toBe(true);
    const t = await http().get('/api/emails?limit=100').set(as(manager));
    expect(t.body.total).toBeGreaterThan(m.body.total);
  });

  it('templates: managers can add and remove, members can only read', async () => {
    const body = { name: `Test template ${Date.now()}`, subject: 'Hi {{name}}', body: 'Hello {{name}}' };
    expect((await http().post('/api/emails/templates').set(as(member)).send(body)).status).toBe(403);
    const made = await http().post('/api/emails/templates').set(as(manager)).send(body);
    expect(made.status).toBe(201);
    expect((await http().get('/api/emails/templates').set(as(member))).body.some((t) => t.id === made.body.id)).toBe(true);
    expect((await http().delete(`/api/emails/templates/${made.body.id}`).set(as(manager))).status).toBe(204);
  });

  it('invitation emails never store the private link in the log', async () => {
    const email = `invitee${Date.now()}@example.com`;
    const inv = await http().post('/api/team/invite').set(as(owner)).send({ email, role: 'member' });
    expect(inv.status).toBe(201);
    const log = await http().get('/api/emails?limit=50').set(as(manager));
    const row = log.body.data.find((e) => e.to_email === email);
    expect(row).toBeTruthy();
    expect(row.body).not.toContain('accept-invite');
  });
});

describe('report export', () => {
  const bin = (res, cb) => {
    const c = [];
    res.on('data', (d) => c.push(d));
    res.on('end', () => cb(null, Buffer.concat(c)));
  };

  it('exports an Excel workbook (a zip file)', async () => {
    const r = await http().get('/api/reports/export?format=xlsx').set(as(manager)).buffer(true).parse(bin);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/spreadsheetml/);
    expect(r.body.subarray(0, 2).toString()).toBe('PK');
  });

  it('exports a PDF', async () => {
    const r = await http().get('/api/reports/export?format=pdf').set(as(manager)).buffer(true).parse(bin);
    expect(r.status).toBe(200);
    expect(r.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('works for a member too (their own numbers) and requires sign-in', async () => {
    expect((await http().get('/api/reports/export?format=xlsx').set(as(member))).status).toBe(200);
    expect((await http().get('/api/reports/export?format=xlsx')).status).toBe(401);
  });
});
