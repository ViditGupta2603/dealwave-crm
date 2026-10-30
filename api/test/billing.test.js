import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { withSystem } from '../src/db.js';
import { setRzpFetch, verifyPaymentSignature, verifyWebhookSignature } from '../src/lib/razorpay.js';
import { OTHER_OWNER, as, http, login } from './helpers.js';

const KEY_ID = 'rzp_test_key',
  SECRET = 'rzp_test_secret_value',
  HOOK = 'whsec_test_hook';
const sign = (data, secret = SECRET) => crypto.createHmac('sha256', secret).update(data).digest('hex');

let n = 0;
async function newOwner() {
  const r = await request(app)
    .post('/api/auth/register')
    .send({
      company_name: `Pay Co ${Date.now()}${n++}`,
      name: 'Pay Owner',
      email: `pay${Date.now()}${n}@example.com`,
      password: 'Sup3rSecret!',
    });
  return { auth: { Authorization: `Bearer ${r.body.accessToken}` }, tenantId: r.body.tenant.id, userId: r.body.user.id };
}
const planOf = (tenantId) =>
  withSystem(async (c) => (await c.query('SELECT plan, plan_paid_until FROM tenants WHERE id=$1', [tenantId])).rows[0]);

let orderSeq = 0;
const mockOrders = () => {
  const m = vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: `order_TEST${++orderSeq}${Date.now()}`, amount: body.amount, currency: 'INR' }),
    };
  });
  setRzpFetch(m);
  return m;
};

beforeEach(() => {
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = HOOK;
});
afterEach(() => {
  setRzpFetch(null);
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
});

describe('payment signatures', () => {
  it('accepts only the exact HMAC of order|payment', () => {
    expect(verifyPaymentSignature('order_1', 'pay_1', sign('order_1|pay_1'))).toBe(true);
    expect(verifyPaymentSignature('order_1', 'pay_2', sign('order_1|pay_1'))).toBe(false);
    expect(verifyPaymentSignature('order_1', 'pay_1', sign('order_1|pay_1', 'other-secret'))).toBe(false);
    expect(verifyPaymentSignature('order_1', 'pay_1', '')).toBe(false);
    expect(verifyPaymentSignature('order_1', 'pay_1', 'zz')).toBe(false);
  });
  it('webhook signature covers the raw body', () => {
    const body = Buffer.from('{"event":"payment.captured"}');
    expect(verifyWebhookSignature(body, sign(body, HOOK))).toBe(true);
    expect(verifyWebhookSignature(Buffer.from('{"event":"payment.captured" }'), sign(body, HOOK))).toBe(false);
  });
});

describe('checkout and verification', () => {
  it('creates an order for the plan price in paise and sends credentials only to Razorpay', async () => {
    const o = await newOwner();
    const fetchMock = mockOrders();
    const r = await http().post('/api/billing/checkout').set(o.auth).send({ plan: 'pro' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ key_id: KEY_ID, amount: 299900, currency: 'INR', plan_name: 'Growth' });
    expect(JSON.stringify(r.body)).not.toContain(SECRET);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    expect(init.headers.authorization).toBe('Basic ' + Buffer.from(`${KEY_ID}:${SECRET}`).toString('base64'));
  });

  it('upgrades the plan after a correctly signed payment, and does nothing the second time', async () => {
    const o = await newOwner();
    mockOrders();
    const { order_id } = (await http().post('/api/billing/checkout').set(o.auth).send({ plan: 'pro' })).body;
    expect((await planOf(o.tenantId)).plan).toBe('free');
    const body = { razorpay_order_id: order_id, razorpay_payment_id: 'pay_ABC12345', razorpay_signature: sign(`${order_id}|pay_ABC12345`) };
    const ok = await http().post('/api/billing/verify').set(o.auth).send(body);
    expect(ok.status).toBe(200);
    const after = await planOf(o.tenantId);
    expect(after.plan).toBe('pro');
    expect(new Date(after.plan_paid_until).getTime()).toBeGreaterThan(Date.now() + 29 * 86400000);
    const again = await http().post('/api/billing/verify').set(o.auth).send(body);
    expect(again.status).toBe(200);
    expect((await planOf(o.tenantId)).plan_paid_until).toEqual(after.plan_paid_until); // no extra month
    const billing = await http().get('/api/billing').set(o.auth);
    expect(billing.body.payment_gateway).toBe('razorpay');
    expect(billing.body.payments[0]).toMatchObject({ status: 'paid', plan: 'pro', amount_paise: 299900 });
  });

  it('refuses a forged signature and leaves the plan alone', async () => {
    const o = await newOwner();
    mockOrders();
    const { order_id } = (await http().post('/api/billing/checkout').set(o.auth).send({ plan: 'enterprise' })).body;
    const r = await http()
      .post('/api/billing/verify')
      .set(o.auth)
      .send({
        razorpay_order_id: order_id,
        razorpay_payment_id: 'pay_FAKE12345',
        razorpay_signature: sign(`${order_id}|pay_FAKE12345`, 'attacker-secret'),
      });
    expect(r.status).toBe(400);
    expect((await planOf(o.tenantId)).plan).toBe('free');
  });

  it("another workspace cannot claim someone else's order", async () => {
    const o = await newOwner();
    mockOrders();
    const { order_id } = (await http().post('/api/billing/checkout').set(o.auth).send({ plan: 'pro' })).body;
    const thief = await login(OTHER_OWNER);
    const r = await http()
      .post('/api/billing/verify')
      .set(as(thief))
      .send({ razorpay_order_id: order_id, razorpay_payment_id: 'pay_ABC12345', razorpay_signature: sign(`${order_id}|pay_ABC12345`) });
    expect(r.status).toBe(404);
  });

  it('cannot skip payment: direct upgrades are blocked while payments are on, downgrades still work', async () => {
    const o = await newOwner();
    expect((await http().post('/api/billing/plan').set(o.auth).send({ plan: 'pro' })).status).toBe(400);
    expect((await planOf(o.tenantId)).plan).toBe('free');
    expect((await http().post('/api/billing/plan').set(o.auth).send({ plan: 'free' })).status).toBe(200);
  });

  it('only the owner can pay, and bad input is rejected', async () => {
    mockOrders();
    const member = await login('rohan@sundaram.demo');
    expect((await http().post('/api/billing/checkout').set(as(member)).send({ plan: 'pro' })).status).toBe(403);
    const o = await newOwner();
    expect((await http().post('/api/billing/checkout').set(o.auth).send({ plan: 'free' })).status).toBe(400);
    expect((await http().post('/api/billing/checkout').set(o.auth).send({ plan: 'platinum' })).status).toBe(400);
    expect((await http().post('/api/billing/checkout')).status).toBe(401);
  });

  it('without payment keys, plan changes keep working instantly', async () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    const o = await newOwner();
    expect((await http().get('/api/billing').set(o.auth)).body.payment_gateway).toBe('not_configured');
    expect((await http().post('/api/billing/plan').set(o.auth).send({ plan: 'pro' })).status).toBe(200);
    expect((await planOf(o.tenantId)).plan).toBe('pro');
    expect((await http().post('/api/billing/checkout').set(o.auth).send({ plan: 'pro' })).status).toBe(400);
  });
});

describe('Razorpay webhook', () => {
  const post = (raw, sig) =>
    request(app)
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', sig ?? sign(raw, HOOK))
      .send(raw);
  const captured = (orderId, amount) =>
    JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_WEB123456', order_id: orderId, amount } } } });

  it('upgrades the plan even if the browser never confirmed', async () => {
    const o = await newOwner();
    mockOrders();
    const { order_id } = (await http().post('/api/billing/checkout').set(o.auth).send({ plan: 'pro' })).body;
    const r = await post(captured(order_id, 299900));
    expect(r.status).toBe(200);
    expect(r.body.result).toBe('applied');
    expect((await planOf(o.tenantId)).plan).toBe('pro');
    expect((await post(captured(order_id, 299900))).body.result).toBe('already');
  });
  it('rejects a bad signature and an unsigned call', async () => {
    const o = await newOwner();
    mockOrders();
    const { order_id } = (await http().post('/api/billing/checkout').set(o.auth).send({ plan: 'pro' })).body;
    expect((await post(captured(order_id, 299900), sign('x', 'wrong'))).status).toBe(400);
    expect(
      (await request(app).post('/api/webhooks/razorpay').set('Content-Type', 'application/json').send(captured(order_id, 299900))).status,
    ).toBe(400);
    expect((await planOf(o.tenantId)).plan).toBe('free');
  });
  it('does not upgrade when the captured amount differs from the order', async () => {
    const o = await newOwner();
    mockOrders();
    const { order_id } = (await http().post('/api/billing/checkout').set(o.auth).send({ plan: 'enterprise' })).body;
    expect((await post(captured(order_id, 100))).body.result).toBe('mismatch');
    expect((await planOf(o.tenantId)).plan).toBe('free');
  });
  it('ignores other events and unknown orders, and is off when no webhook secret is set', async () => {
    expect((await post(JSON.stringify({ event: 'refund.created' }))).body.ignored).toBe(true);
    expect((await post(captured('order_unknown', 1))).body.result).toBe('unknown');
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    expect((await post(captured('order_x', 1), 'anything')).status).toBe(404);
  });
});
