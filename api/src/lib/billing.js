import { audit } from './audit.js';
import { PLANS } from '../plans.js';

export const PLAN_PERIOD_DAYS = 30;

/**
 * Marks a payment as paid and switches the workspace to the plan it bought. Safe to call twice (the browser
 * confirmation and Razorpay's webhook both arrive): the second call changes nothing.
 */
export async function applyPaidPayment(c, payment, razorpayPaymentId, actorUserId) {
  const claimed = await c.query(
    `UPDATE payments SET status='paid', razorpay_payment_id=$2, paid_at=now() WHERE id=$1 AND status <> 'paid' RETURNING id`,
    [payment.id, razorpayPaymentId],
  );
  if (!claimed.rowCount) return { applied: false };
  // Renewing the same plan before it ends adds a month on top; otherwise the month starts now.
  await c.query(
    `UPDATE tenants SET plan=$2,
       plan_paid_until = CASE WHEN plan=$2 AND plan_paid_until > now() THEN plan_paid_until ELSE now() END + ($3 || ' days')::interval
     WHERE id=$1`,
    [payment.tenant_id, payment.plan, String(PLAN_PERIOD_DAYS)],
  );
  await audit(c, payment.tenant_id, actorUserId, 'paid for', 'workspace', payment.tenant_id, `${PLANS[payment.plan].name} plan`);
  return { applied: true };
}
