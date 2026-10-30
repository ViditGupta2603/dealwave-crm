import express, { Router } from 'express';
import { withSystem } from '../db.js';
import { HttpError } from '../http.js';
import { logger } from '../logger.js';
import { applyPaidPayment } from '../lib/billing.js';
import { rzpEnabled, rzpWebhookConfigured, verifyWebhookSignature } from '../lib/razorpay.js';

export const webhooksRouter = Router();

/**
 * Razorpay calls this when a payment succeeds, even if the customer closed the browser before it finished.
 * The signature is checked over the raw body, so this route must see the body before any JSON parsing.
 */
webhooksRouter.post('/razorpay', express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
  if (!rzpEnabled() || !rzpWebhookConfigured()) throw new HttpError(404, 'Not found');
  const body = req.body;
  if (!Buffer.isBuffer(body) || !verifyWebhookSignature(body, String(req.get('x-razorpay-signature') || '')))
    throw new HttpError(400, 'Invalid signature');
  let evt;
  try {
    evt = JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid body');
  }
  if (evt?.event !== 'payment.captured' && evt?.event !== 'order.paid') return res.json({ ok: true, ignored: true });
  const pay = evt.payload?.payment?.entity;
  const orderId = pay?.order_id ?? evt.payload?.order?.entity?.id;
  if (!orderId || !pay?.id) return res.json({ ok: true, ignored: true });
  const applied = await withSystem(async (c) => {
    const row = (await c.query('SELECT * FROM payments WHERE razorpay_order_id=$1', [String(orderId)])).rows[0];
    if (!row) return 'unknown';
    // The amount Razorpay says was captured must be the amount we asked for.
    if (typeof pay.amount === 'number' && pay.amount !== row.amount_paise) {
      logger.warn({ orderId }, 'razorpay webhook amount mismatch');
      return 'mismatch';
    }
    return (await applyPaidPayment(c, row, String(pay.id), null)).applied ? 'applied' : 'already';
  });
  res.json({ ok: true, result: applied });
});
