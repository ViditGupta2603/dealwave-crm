import { config } from '../config.js';
import { logger } from '../logger.js';
import { deliverMail, mailEnabled } from './mail.js';

const base = () => config.APP_URL.replace(/\/+$/, '');

/** Tests read the emailed links from here (nothing is recorded outside the test environment). */
export const testOutbox = [];

/**
 * Account emails. The link is a secret, so the email log stores "(content hidden)" instead of the body.
 * When SMTP is not set up, the link is printed in the API log so the flow can still be tried on a laptop:
 *   docker compose logs api | grep "link for"
 */
async function send(kind, u, subject, text, link) {
  if (config.NODE_ENV === 'test') testOutbox.push({ to: u.email, kind, link });
  if (!mailEnabled && link) logger.info(`[mail:simulated] ${kind} link for ${u.email}: ${link}`);
  return deliverMail({ tenantId: u.tenant_id, userId: u.id, to: u.email, subject, body: text, source: 'auth', redactBody: true });
}

export function sendResetEmail(u, token) {
  const link = `${base()}/reset-password?token=${token}`;
  return send(
    'reset',
    u,
    'Reset your Dealwave password',
    `Hi ${u.name},\n\nSomeone asked to reset the password for your Dealwave account. Open this link to choose a new one:\n\n${link}\n\nThe link works for 1 hour and only once. If you did not ask for this, you can ignore this email; your password stays the same.\n\n- Dealwave CRM`,
    link,
  );
}

export function sendVerifyEmail(u, token) {
  const link = `${base()}/verify-email?token=${token}`;
  return send(
    'verify',
    u,
    'Confirm your email for Dealwave',
    `Hi ${u.name},\n\nPlease confirm this email address so we know it is really yours:\n\n${link}\n\nThe link works for 48 hours. If you did not create a Dealwave account, you can ignore this email.\n\n- Dealwave CRM`,
    link,
  );
}

export function sendPasswordChangedEmail(u) {
  return send(
    'changed',
    u,
    'Your Dealwave password was changed',
    `Hi ${u.name},\n\nThe password for your Dealwave account was just changed and you were signed out everywhere.\n\nIf this was you, there is nothing more to do. If it was not, reset your password right away at ${base()}/forgot-password and contact your workspace owner.\n\n- Dealwave CRM`,
  );
}
