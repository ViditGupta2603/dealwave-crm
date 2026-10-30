import crypto from 'crypto';

/**
 * Razorpay payments (India: UPI, cards, netbanking, wallets).
 * Configured with RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET. Without the first two,
 * the billing page simply keeps its instant plan switch (there is nothing to charge with).
 */
const env = () => ({
  id: process.env.RAZORPAY_KEY_ID || '',
  secret: process.env.RAZORPAY_KEY_SECRET || '',
  webhook: process.env.RAZORPAY_WEBHOOK_SECRET || '',
});
export const rzpEnabled = () => {
  const e = env();
  return !!(e.id && e.secret);
};
export const rzpKeyId = () => env().id;
export const rzpWebhookConfigured = () => !!env().webhook;

let impl = (url, init) => fetch(url, init);
export const setRzpFetch = (f) => {
  impl = f ?? ((url, init) => fetch(url, init));
};

const safeEqualHex = (a, b) => {
  if (!/^[0-9a-f]+$/i.test(a) || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a.toLowerCase()), Buffer.from(b.toLowerCase()));
};
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

/** Razorpay's rule: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyPaymentSignature(orderId, paymentId, signature) {
  const { secret } = env();
  if (!secret || !signature) return false;
  return safeEqualHex(hmac(secret, `${orderId}|${paymentId}`), String(signature));
}

/** Webhooks are signed over the exact raw request body with the webhook secret. */
export function verifyWebhookSignature(rawBody, signature) {
  const { webhook } = env();
  if (!webhook || !signature) return false;
  return safeEqualHex(hmac(webhook, rawBody), String(signature));
}

export async function createOrder(opts) {
  const { id, secret } = env();
  const res = await impl('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') },
    body: JSON.stringify({ amount: opts.amountPaise, currency: 'INR', receipt: opts.receipt.slice(0, 40), notes: opts.notes }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.id) throw new Error(`Razorpay could not create the order (${res.status})`);
  return { id: String(data.id), amount: Number(data.amount), currency: String(data.currency) };
}
