import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { withTenant } from '../db.js';

const transporter = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    })
  : null;

export const mailEnabled = !!transporter;

/** Sends through SMTP when configured; otherwise logs the message (simulated) so flows stay testable. */
export async function sendMail(to, subject, text) {
  if (!transporter) {
    logger.info({ to, subject }, `[mail:simulated] ${text.slice(0, 300)}`);
    return { simulated: true };
  }
  await transporter.sendMail({ from: config.MAIL_FROM, to, subject, text });
  return { simulated: false };
}

/** Sends an email and records the outcome in the email log. Never throws on a delivery problem. */
export async function deliverMail(job) {
  let status = 'sent';
  let error;
  try {
    const r = await sendMail(job.to, job.subject, job.body);
    status = r.simulated ? 'simulated' : 'sent';
  } catch (e) {
    status = 'failed';
    error = String(e?.message || 'Delivery failed').slice(0, 300);
    logger.warn({ to: job.to, err: error }, 'email delivery failed');
  }
  try {
    await withTenant(job.tenantId, (c) =>
      c.query(
        `INSERT INTO email_log (tenant_id,user_id,to_email,subject,body,status,error,source,related_type,related_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          job.tenantId,
          job.userId ?? null,
          job.to,
          job.subject.slice(0, 300),
          job.redactBody ? '(content hidden: contains a private link)' : job.body,
          status,
          error ?? null,
          job.source,
          job.relatedType ?? null,
          job.relatedId ?? null,
        ],
      ),
    );
  } catch (e) {
    logger.error({ err: e?.message }, 'could not write email log');
  }
  return { status, error };
}
