import { Router } from 'express';
import { z } from 'zod';
import { withSystem, withTenant } from '../db.js';
import { HttpError, badRequest, conflict, unauthorized } from '../http.js';
import { authRateLimit, authenticate, invalidateUserCache, refreshRateLimit } from '../middleware.js';
import crypto from 'crypto';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  hashPassword,
  issueRefreshToken,
  randomToken,
  readCookie,
  setRefreshCookie,
  sha256,
  signAccessToken,
  verifyPassword,
} from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import jwt from 'jsonwebtoken';
import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { config, cookieSecure } from '../config.js';
import { redis } from '../lib/redis.js';
import { consumeAuthToken, createAuthToken, peekAuthToken, sentRecently } from '../lib/authTokens.js';
import { sendPasswordChangedEmail, sendResetEmail, sendVerifyEmail } from '../lib/authMail.js';
import { GoogleError, buildAuthUrl, exchangeCode, googleEnabled, newPkce } from '../lib/google.js';
import { decryptSecret, encryptSecret, hashBackup, newBackupCodes, newSecret, otpauthUrl, qrDataUrl, verifyCode } from '../lib/totp.js';

export const authRouter = Router();

const password = z.string().min(8, 'Use at least 8 characters').max(128);
const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(200);

export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  title: u.title ?? null,
  tenant_id: u.tenant_id,
  totp_enabled: !!u.totp_enabled,
  email_verified: !!u.email_verified_at,
});
export const publicTenant = (t) => ({ id: t.id, name: t.name, slug: t.slug, plan: t.plan, currency: t.currency });

async function session(c, user, tenant) {
  return {
    accessToken: signAccessToken(user.id, tenant.id, user.role),
    refreshToken: await issueRefreshToken(c, tenant.id, user.id),
    user: publicUser(user),
    tenant: publicTenant(tenant),
  };
}

/** Browsers get the refresh token only as an httpOnly cookie. Non-browser clients can opt in to the JSON field. */
function sendSession(req, res, out, status = 200) {
  setRefreshCookie(res, out.refreshToken);
  const { refreshToken, ...rest } = out;
  res.status(status).json(req.get('x-return-refresh-token') === '1' ? out : rest);
}

export const DEFAULT_STAGES = [
  { name: 'Prospecting', probability: 10, color: '#7C8DB5', won: false, lost: false },
  { name: 'Qualified', probability: 25, color: '#3E7CB1', won: false, lost: false },
  { name: 'Proposal', probability: 50, color: '#0F6B5C', won: false, lost: false },
  { name: 'Negotiation', probability: 75, color: '#E08A00', won: false, lost: false },
  { name: 'Won', probability: 100, color: '#2E9E5B', won: true, lost: false },
  { name: 'Lost', probability: 0, color: '#C8574B', won: false, lost: true },
];

export async function seedTenantDefaults(c, tenantId, ownerId) {
  let pos = 0;
  for (const s of DEFAULT_STAGES) {
    await c.query('INSERT INTO pipeline_stages (tenant_id,name,position,probability,color,is_won,is_lost) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      tenantId,
      s.name,
      pos++,
      s.probability,
      s.color,
      s.won,
      s.lost,
    ]);
  }
  await c.query(
    `INSERT INTO workflow_rules (tenant_id,name,description,entity,event,conditions,actions,created_by) VALUES ($1,$2,$3,'lead','created','[]',$4,$5)`,
    [
      tenantId,
      'Follow up on every new lead',
      'Creates a follow-up task for the owner of each new lead.',
      JSON.stringify([{ type: 'create_task', subject: 'Call {{name}} and introduce us', due_in_days: 1, priority: 'high' }]),
      ownerId,
    ],
  );
}

const slugify = (s) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace';

authRouter.post('/register', authRateLimit, async (req, res) => {
  const body = z
    .object({
      company_name: z.string().trim().min(2, 'Enter your company name').max(120),
      name: z.string().trim().min(2, 'Enter your name').max(120),
      email: emailSchema,
      password,
    })
    .parse(req.body);
  const verifyMail = [];
  const out = await withSystem(async (c) => {
    if ((await c.query('SELECT 1 FROM users WHERE lower(email)=$1', [body.email])).rowCount)
      throw conflict('An account with this email already exists. Try signing in.');
    let slug = slugify(body.company_name);
    if ((await c.query('SELECT 1 FROM tenants WHERE slug=$1', [slug])).rowCount) slug += '-' + randomToken(2);
    const tenant = (await c.query('INSERT INTO tenants (name, slug) VALUES ($1,$2) RETURNING *', [body.company_name, slug])).rows[0];
    const user = (
      await c.query(`INSERT INTO users (tenant_id,email,name,password_hash,role,title) VALUES ($1,$2,$3,$4,'owner','Owner') RETURNING *`, [
        tenant.id,
        body.email,
        body.name,
        await hashPassword(body.password),
      ])
    ).rows[0];
    await seedTenantDefaults(c, tenant.id, user.id);
    await audit(c, tenant.id, user.id, 'created', 'workspace', tenant.id, tenant.name);
    verifyMail.push({ user, token: await createAuthToken(c, tenant.id, user.id, 'verify') });
    return session(c, user, tenant);
  });
  // Delivery problems never block sign-up: the app shows a "resend" button if the email does not arrive.
  for (const m of verifyMail) void sendVerifyEmail(m.user, m.token).catch(() => undefined);
  sendSession(req, res, out, 201);
});

const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.yQdXw1o3G9yXUq1nX8bRk6mYb6Zy';

authRouter.post('/login', authRateLimit, async (req, res) => {
  const body = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password') }).parse(req.body);
  const out = await withSystem(async (c) => {
    const { rows } = await c.query(
      'SELECT u.*, row_to_json(t) AS tenant FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE lower(u.email)=$1',
      [body.email],
    );
    const row = rows[0];
    const ok = await verifyPassword(body.password, row?.password_hash || DUMMY_HASH);
    if (!row || !ok) throw unauthorized('Incorrect email or password');
    if (!row.active) throw new HttpError(403, 'Your account is disabled. Ask a workspace admin to re-enable it.');
    if (row.tenant.status !== 'active') throw new HttpError(403, 'This workspace is suspended. Contact support.');
    // Optional strict mode (REQUIRE_EMAIL_VERIFICATION=true): no access until the email is confirmed. Checked after the
    // password so nobody can learn whether an address has an account.
    if (config.REQUIRE_EMAIL_VERIFICATION === 'true' && !row.email_verified_at) {
      const token = (await sentRecently(c, row.id, 'verify')) ? null : await createAuthToken(c, row.tenant_id, row.id, 'verify');
      return { unverified: { user: row, token } };
    }
    if (row.totp_enabled) return { mfa_required: true, mfa_token: signMfaToken(row.id) };
    await c.query('UPDATE users SET last_login_at=now() WHERE id=$1', [row.id]);
    return session(c, row, row.tenant);
  });
  if ('unverified' in out && out.unverified) {
    if (out.unverified.token) void sendVerifyEmail(out.unverified.user, out.unverified.token).catch(() => undefined);
    throw new HttpError(403, 'Please confirm your email address first. Check your inbox for the link we sent.');
  }
  if ('mfa_required' in out) return res.json(out);
  sendSession(req, res, out);
});

// ---------------- Two-step verification (authenticator app) ----------------
const MFA_PURPOSE = 'mfa';
const signMfaToken = (userId) => jwt.sign({ purpose: MFA_PURPOSE }, config.JWT_SECRET, { subject: userId, expiresIn: '5m' });
function readMfaToken(token) {
  try {
    const p = jwt.verify(token, config.JWT_SECRET);
    if (p.purpose !== MFA_PURPOSE || !p.sub) throw new Error('bad purpose');
    return String(p.sub);
  } catch {
    throw unauthorized('That sign-in attempt expired. Sign in again.');
  }
}

// Six-digit codes can be guessed, so each account gets only 5 wrong tries every 5 minutes.
const mfaFailLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:mfa',
  points: 5,
  duration: 300,
  insuranceLimiter: new RateLimiterMemory({ points: 5, duration: 300 }),
});
async function mfaGuard(userId) {
  try {
    await mfaFailLimiter.get(userId).then((r) => {
      if (r && r.remainingPoints <= 0) throw r;
    });
  } catch (e) {
    if (e instanceof Error) return;
    throw new HttpError(429, `Too many wrong codes. Try again in ${Math.max(1, Math.ceil((e.msBeforeNext || 1000) / 60000))} minute(s).`);
  }
}
const mfaFail = (userId) => mfaFailLimiter.consume(userId).catch(() => undefined);
const mfaOk = (userId) => mfaFailLimiter.delete(userId).catch(() => undefined);

/** Checks an authenticator code or a backup code. Returns true and records use, or false. */
async function checkSecondFactor(c, user, code) {
  const step = verifyCode(decryptSecret(user.totp_secret_enc), code, user.totp_last_step === null ? null : Number(user.totp_last_step));
  if (step !== null) {
    await c.query('UPDATE users SET totp_last_step=$2 WHERE id=$1', [user.id, step]);
    return true;
  }
  const h = hashBackup(code);
  if (user.totp_backup_hashes.includes(h)) {
    await c.query('UPDATE users SET totp_backup_hashes = array_remove(totp_backup_hashes, $2) WHERE id=$1', [user.id, h]);
    return true;
  }
  return false;
}

authRouter.post('/2fa/verify', authRateLimit, async (req, res) => {
  const body = z
    .object({ mfa_token: z.string().min(10), code: z.string().trim().min(6).max(20, 'Enter the 6-digit code') })
    .parse(req.body);
  const userId = readMfaToken(body.mfa_token);
  await mfaGuard(userId);
  const result = await withSystem(async (c) => {
    const row = (
      await c.query('SELECT u.*, row_to_json(t) AS tenant FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.id=$1', [userId])
    ).rows[0];
    if (!row || !row.active || !row.totp_enabled || row.tenant.status !== 'active') return null;
    if (!(await checkSecondFactor(c, row, body.code))) return 'wrong';
    await c.query('UPDATE users SET last_login_at=now() WHERE id=$1', [row.id]);
    return session(c, row, row.tenant);
  });
  if (result === null) throw unauthorized();
  if (result === 'wrong') {
    await mfaFail(userId);
    throw unauthorized('That code is not correct. Check the app and try again.');
  }
  await mfaOk(userId);
  sendSession(req, res, result);
});

authRouter.post('/2fa/setup', authenticate, async (req, res) => {
  const { tenantId, userId, email } = req.auth;
  const secret = newSecret();
  const issuer = 'Dealwave CRM';
  const done = await withTenant(tenantId, async (c) => {
    const u = (await c.query('SELECT totp_enabled FROM users WHERE id=$1', [userId])).rows[0];
    if (u.totp_enabled) throw conflict('Two-step verification is already on. Turn it off first to set it up again.');
    await c.query('UPDATE users SET totp_secret_enc=$2, totp_last_step=NULL WHERE id=$1', [userId, encryptSecret(secret)]);
    return true;
  });
  const url = otpauthUrl(email, issuer, secret);
  res.json({ ok: done, secret, otpauth_url: url, qr: await qrDataUrl(url) });
});

authRouter.post('/2fa/enable', authenticate, async (req, res) => {
  const { tenantId, userId } = req.auth;
  const { code } = z.object({ code: z.string().trim().min(6).max(10, 'Enter the 6-digit code') }).parse(req.body);
  await mfaGuard(userId);
  const codes = newBackupCodes();
  const ok = await withTenant(tenantId, async (c) => {
    const u = (await c.query('SELECT * FROM users WHERE id=$1', [userId])).rows[0];
    if (u.totp_enabled) throw conflict('Two-step verification is already on');
    if (!u.totp_secret_enc) throw badRequest('Start the setup first');
    const step = verifyCode(decryptSecret(u.totp_secret_enc), code, null);
    if (step === null) return false;
    await c.query('UPDATE users SET totp_enabled=true, totp_last_step=$2, totp_backup_hashes=$3 WHERE id=$1', [
      userId,
      step,
      codes.map(hashBackup),
    ]);
    await audit(c, tenantId, userId, 'turned on', 'security', userId, 'Two-step verification');
    return true;
  });
  if (!ok) {
    await mfaFail(userId);
    throw badRequest('That code is not correct. Check the app and try again.');
  }
  await mfaOk(userId);
  invalidateUserCache(userId);
  res.json({ backup_codes: codes });
});

authRouter.post('/2fa/disable', authenticate, async (req, res) => {
  const { tenantId, userId } = req.auth;
  const body = z.object({ password: z.string().min(1), code: z.string().trim().min(6).max(20) }).parse(req.body);
  await mfaGuard(userId);
  const ok = await withTenant(tenantId, async (c) => {
    const u = (await c.query('SELECT * FROM users WHERE id=$1', [userId])).rows[0];
    if (!u.totp_enabled) return true;
    if (!(await verifyPassword(body.password, u.password_hash))) throw badRequest('Your password is not correct');
    if (!(await checkSecondFactor(c, u, body.code))) return false;
    await c.query('UPDATE users SET totp_enabled=false, totp_secret_enc=NULL, totp_last_step=NULL, totp_backup_hashes=$2 WHERE id=$1', [
      userId,
      [],
    ]);
    await audit(c, tenantId, userId, 'turned off', 'security', userId, 'Two-step verification');
    return true;
  });
  if (!ok) {
    await mfaFail(userId);
    throw badRequest('That code is not correct');
  }
  await mfaOk(userId);
  res.status(204).end();
});

authRouter.get('/2fa/status', authenticate, async (req, res) => {
  const { tenantId, userId } = req.auth;
  const row = await withTenant(
    tenantId,
    async (c) =>
      (await c.query('SELECT totp_enabled, coalesce(array_length(totp_backup_hashes,1),0) AS backups FROM users WHERE id=$1', [userId]))
        .rows[0],
  );
  res.json({ enabled: row.totp_enabled, backup_codes_left: row.backups });
});

authRouter.post('/refresh', refreshRateLimit, async (req, res) => {
  const bodyToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined;
  const cookieToken = readCookie(req.headers.cookie, REFRESH_COOKIE);
  const refreshToken = bodyToken ?? cookieToken;
  // Cookie-based refresh must come from our own frontend (defence in depth on top of SameSite=Strict).
  if (!bodyToken && cookieToken && req.get('x-requested-with') !== 'dealwave') throw new HttpError(403, 'Blocked request');
  if (!refreshToken || refreshToken.length < 10) {
    clearRefreshCookie(res);
    throw unauthorized();
  }
  const out = await withSystem(async (c) => {
    const { rows } = await c.query('SELECT * FROM refresh_tokens WHERE token_hash=$1', [sha256(refreshToken)]);
    const t = rows[0];
    if (!t) return null;
    if (t.revoked_at) {
      // A rotated token was presented again: assume theft and end every session for this user.
      // (Returned as a marker so this update commits instead of rolling back with the error.)
      await c.query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [t.user_id]);
      return null;
    }
    if (new Date(t.expires_at) < new Date()) return null;
    const u = (
      await c.query('SELECT u.*, row_to_json(t) AS tenant FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.id=$1', [t.user_id])
    ).rows[0];
    if (!u || !u.active || u.tenant.status !== 'active') return null;
    await c.query('UPDATE refresh_tokens SET revoked_at=now() WHERE id=$1', [t.id]);
    return session(c, u, u.tenant);
  });
  if (!out) {
    clearRefreshCookie(res);
    throw unauthorized();
  }
  sendSession(req, res, out);
});

authRouter.post('/logout', async (req, res) => {
  const token =
    (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined) ?? readCookie(req.headers.cookie, REFRESH_COOKIE);
  if (token) await withSystem((c) => c.query('UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1', [sha256(token)]));
  clearRefreshCookie(res);
  res.status(204).end();
});

authRouter.get('/invite/:token', async (req, res) => {
  const row = await withSystem(
    async (c) =>
      (
        await c.query(
          `SELECT i.email, i.role, t.name AS tenant_name FROM invitations i JOIN tenants t ON t.id=i.tenant_id
     WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.expires_at > now()`,
          [sha256(String(req.params.token))],
        )
      ).rows[0],
  );
  if (!row) throw new HttpError(404, 'This invitation link is invalid or has expired');
  res.json(row);
});

authRouter.post('/accept-invite', authRateLimit, async (req, res) => {
  const body = z
    .object({ token: z.string().min(10), name: z.string().trim().min(2, 'Enter your name').max(120), password })
    .parse(req.body);
  const out = await withSystem(async (c) => {
    const inv = (
      await c.query('SELECT * FROM invitations WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at > now() FOR UPDATE', [
        sha256(body.token),
      ])
    ).rows[0];
    if (!inv) throw new HttpError(404, 'This invitation link is invalid or has expired');
    if ((await c.query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [inv.email])).rowCount)
      throw conflict('An account with this email already exists');
    const tenant = (await c.query('SELECT * FROM tenants WHERE id=$1', [inv.tenant_id])).rows[0];
    const user = (
      await c.query(
        'INSERT INTO users (tenant_id,email,name,password_hash,role,email_verified_at) VALUES ($1,$2,$3,$4,$5,now()) RETURNING *',
        [inv.tenant_id, inv.email.toLowerCase(), body.name, await hashPassword(body.password), inv.role],
      )
    ).rows[0];
    await c.query('UPDATE invitations SET accepted_at=now() WHERE id=$1', [inv.id]);
    await audit(c, inv.tenant_id, user.id, 'joined', 'user', user.id, user.name);
    return session(c, user, tenant);
  });
  sendSession(req, res, out, 201);
});

authRouter.get('/me', authenticate, async (req, res) => {
  const { tenantId, userId } = req.auth;
  const out = await withTenant(tenantId, async (c) => {
    const u = (await c.query('SELECT * FROM users WHERE id=$1', [userId])).rows[0];
    const t = (await c.query('SELECT * FROM tenants WHERE id=$1', [tenantId])).rows[0];
    return { user: publicUser(u), tenant: publicTenant(t) };
  });
  res.json(out);
});

authRouter.patch('/me', authenticate, async (req, res) => {
  const { tenantId, userId } = req.auth;
  const body = z
    .object({ name: z.string().trim().min(2).max(120).optional(), title: z.string().trim().max(120).nullish() })
    .parse(req.body);
  const u = await withTenant(
    tenantId,
    async (c) =>
      (
        await c.query(
          'UPDATE users SET name=COALESCE($2,name), title=CASE WHEN $3::boolean THEN $4 ELSE title END WHERE id=$1 RETURNING *',
          [userId, body.name ?? null, 'title' in body, body.title ?? null],
        )
      ).rows[0],
  );
  invalidateUserCache(userId);
  res.json(publicUser(u));
});

authRouter.post('/change-password', authenticate, async (req, res) => {
  const { tenantId, userId } = req.auth;
  const body = z.object({ current_password: z.string().min(1), new_password: password }).parse(req.body);
  await withTenant(tenantId, async (c) => {
    const u = (await c.query('SELECT password_hash FROM users WHERE id=$1', [userId])).rows[0];
    if (!(await verifyPassword(body.current_password, u.password_hash))) throw badRequest('Your current password is not correct');
    await c.query('UPDATE users SET password_hash=$2 WHERE id=$1', [userId, await hashPassword(body.new_password)]);
    await c.query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
  });
  res.status(204).end();
});

// ---------------- Forgot password, email verification ----------------
authRouter.get('/providers', (_req, res) => {
  res.json({ google: googleEnabled(), require_email_verification: config.REQUIRE_EMAIL_VERIFICATION === 'true' });
});

/** Always answers the same way, so nobody can use this form to find out which emails have accounts. */
authRouter.post('/forgot-password', authRateLimit, async (req, res) => {
  const { email } = z.object({ email: emailSchema }).parse(req.body);
  const job = await withSystem(async (c) => {
    const u = (
      await c.query(
        `SELECT u.id, u.tenant_id, u.email, u.name FROM users u JOIN tenants t ON t.id=u.tenant_id
       WHERE lower(u.email)=$1 AND u.active AND t.status='active'`,
        [email],
      )
    ).rows[0];
    // One link a minute per person, so this form cannot be used to flood someone's inbox.
    if (!u || (await sentRecently(c, u.id, 'reset'))) return null;
    return { user: u, token: await createAuthToken(c, u.tenant_id, u.id, 'reset') };
  });
  if (job) void sendResetEmail(job.user, job.token).catch(() => undefined);
  res.status(202).json({ message: 'If that email has an account, a reset link is on its way.' });
});

/** Lets the reset page say "this link expired" straight away instead of after the person types a new password. */
authRouter.get('/reset-password/:token', authRateLimit, async (req, res) => {
  const ok = await withSystem((c) => peekAuthToken(c, String(req.params.token), 'reset'));
  if (!ok) throw new HttpError(404, 'This reset link is invalid or has expired. Ask for a new one.');
  res.json({ valid: true });
});

authRouter.post('/reset-password', authRateLimit, async (req, res) => {
  const body = z.object({ token: z.string().min(10).max(200), password }).parse(req.body);
  const user = await withSystem(async (c) => {
    const t = await consumeAuthToken(c, body.token, 'reset');
    if (!t) return null;
    // Opening the emailed link also proves the mailbox is theirs, so the email counts as verified.
    const u = (
      await c.query(
        'UPDATE users SET password_hash=$2, email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1 AND active RETURNING id, tenant_id, email, name',
        [t.user_id, await hashPassword(body.password)],
      )
    ).rows[0];
    if (!u) return null;
    await c.query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [u.id]);
    await c.query(`UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND purpose='reset' AND used_at IS NULL`, [u.id]);
    await audit(c, u.tenant_id, u.id, 'reset', 'security', u.id, 'Password (forgot password)');
    return u;
  });
  if (!user) throw new HttpError(400, 'This reset link is invalid or has expired. Ask for a new one.');
  invalidateUserCache(user.id);
  void sendPasswordChangedEmail(user).catch(() => undefined);
  res.status(204).end();
});

authRouter.post('/verify-email', authRateLimit, async (req, res) => {
  const { token } = z.object({ token: z.string().min(10).max(200) }).parse(req.body);
  const userId = await withSystem(async (c) => {
    const t = await consumeAuthToken(c, token, 'verify');
    if (!t) return null;
    await c.query('UPDATE users SET email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1', [t.user_id]);
    return t.user_id;
  });
  if (!userId) throw new HttpError(400, 'This confirmation link is invalid or has expired. Sign in and ask for a new one.');
  invalidateUserCache(userId);
  res.status(204).end();
});

authRouter.post('/resend-verification', authRateLimit, authenticate, async (req, res) => {
  const { tenantId, userId } = req.auth;
  const job = await withTenant(tenantId, async (c) => {
    const u = (await c.query('SELECT id, tenant_id, email, name, email_verified_at FROM users WHERE id=$1', [userId])).rows[0];
    if (!u || u.email_verified_at) return null;
    if (await sentRecently(c, userId, 'verify')) throw new HttpError(429, 'We just sent a link. Please wait a minute before asking again.');
    return { user: u, token: await createAuthToken(c, tenantId, userId, 'verify') };
  });
  if (job) void sendVerifyEmail(job.user, job.token).catch(() => undefined);
  res.status(204).end();
});

// ---------------- Continue with Google ----------------
// Browser -> /google/start -> Google -> /google/callback -> back into the app signed in.
// A short-lived cookie remembers the random "state" (so a forged callback is refused), the "nonce" and the PKCE secret.
const OAUTH_COOKIE = 'dealwave_oauth';
const OAUTH_PURPOSE = 'oauth';
const oauthCookie = { httpOnly: true, secure: cookieSecure, sameSite: 'lax', path: '/api/auth/google' };
const sameText = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

authRouter.get('/google/start', authRateLimit, (_req, res) => {
  if (!googleEnabled()) return res.redirect('/login?error=google_off');
  const state = randomToken(16),
    nonce = randomToken(16),
    pkce = newPkce();
  const packed = jwt.sign({ purpose: OAUTH_PURPOSE, state, nonce, v: pkce.verifier }, config.JWT_SECRET, { expiresIn: '10m' });
  res.cookie(OAUTH_COOKIE, packed, { ...oauthCookie, maxAge: 10 * 60_000 });
  res.redirect(buildAuthUrl({ state, nonce, challenge: pkce.challenge }));
});

authRouter.get('/google/callback', authRateLimit, async (req, res) => {
  const fail = (code) => {
    res.clearCookie(OAUTH_COOKIE, oauthCookie);
    res.redirect(`/login?error=${code}`);
  };
  if (!googleEnabled()) return fail('google_off');
  const q = z
    .object({ code: z.string().min(1).max(2048).optional(), state: z.string().max(200).optional(), error: z.string().max(100).optional() })
    .safeParse(req.query);
  if (!q.success) return fail('google_failed');
  if (q.data.error) return fail('google_cancelled');
  let saved;
  try {
    saved = jwt.verify(readCookie(req.headers.cookie, OAUTH_COOKIE) || '', config.JWT_SECRET);
  } catch {
    return fail('google_expired');
  }
  if (saved?.purpose !== OAUTH_PURPOSE || !q.data.code || !q.data.state || !sameText(String(saved.state), q.data.state))
    return fail('google_failed');

  let profile;
  try {
    profile = await exchangeCode(q.data.code, saved.v, saved.nonce);
  } catch (e) {
    return fail(e instanceof GoogleError ? e.code : 'google_failed');
  }

  const result = await withSystem(async (c) => {
    const find = (where, v) =>
      c
        .query(`SELECT u.*, row_to_json(t) AS tenant FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE ${where}`, [v])
        .then((r) => r.rows[0]);
    let row = await find('u.google_sub=$1', profile.sub);
    if (!row) {
      row = await find('lower(u.email)=$1', profile.email);
      if (row) {
        if (row.google_sub) return { fail: 'google_failed' }; // this email is already tied to a different Google account
        if (!row.email_verified_at) {
          // Pre-hijacking defence: someone may have signed up with this address (and a password they chose) before the
          // real owner arrived. Google just proved who owns the address, so the unverified password is thrown away.
          await c.query('UPDATE users SET password_hash=$2 WHERE id=$1', [row.id, await hashPassword(randomToken(24))]);
          await c.query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [row.id]);
        }
        await c.query('UPDATE users SET google_sub=$2, email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1', [
          row.id,
          profile.sub,
        ]);
      }
    }
    if (!row) {
      // First time here: create a workspace for them, just like the sign-up form does.
      const company = `${profile.name}'s workspace`;
      let slug = slugify(company);
      if ((await c.query('SELECT 1 FROM tenants WHERE slug=$1', [slug])).rowCount) slug += '-' + randomToken(2);
      const tenant = (await c.query('INSERT INTO tenants (name, slug) VALUES ($1,$2) RETURNING *', [company, slug])).rows[0];
      const user = (
        await c.query(
          `INSERT INTO users (tenant_id,email,name,password_hash,role,title,google_sub,email_verified_at) VALUES ($1,$2,$3,$4,'owner','Owner',$5,now()) RETURNING *`,
          [tenant.id, profile.email, profile.name, await hashPassword(randomToken(24)), profile.sub],
        )
      ).rows[0];
      await seedTenantDefaults(c, tenant.id, user.id);
      await audit(c, tenant.id, user.id, 'created', 'workspace', tenant.id, tenant.name);
      row = { ...user, tenant };
    }
    if (!row.active) return { fail: 'account_disabled' };
    if (row.tenant.status !== 'active') return { fail: 'workspace_suspended' };
    if (row.totp_enabled) return { mfa: signMfaToken(row.id) };
    await c.query('UPDATE users SET last_login_at=now() WHERE id=$1', [row.id]);
    return { refresh: await issueRefreshToken(c, row.tenant.id, row.id) };
  });

  if (result.fail) return fail(result.fail);
  res.clearCookie(OAUTH_COOKIE, oauthCookie);
  // Two-step verification stays on for Google sign-ins. The short-lived token goes in the URL fragment, which browsers never send to servers.
  if (result.mfa) return res.redirect(`/login#mfa=${encodeURIComponent(result.mfa)}`);
  setRefreshCookie(res, result.refresh);
  res.redirect('/auth/google/done');
});
