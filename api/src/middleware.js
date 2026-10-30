import { ZodError } from 'zod';
import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { config } from './config.js';
import { HttpError, forbidden, unauthorized } from './http.js';
import { ROLE_RANK, verifyAccessToken } from './lib/auth.js';
import { withTenant } from './db.js';
import { redis } from './lib/redis.js';
import { logger } from './logger.js';

// ---- Auth: verifies the JWT, then confirms the user is still active (cached briefly) ----
const userCache = new Map();

export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) throw unauthorized();
    let claims;
    try {
      claims = verifyAccessToken(header.slice(7));
    } catch {
      throw unauthorized('Session expired');
    }

    let u = userCache.get(claims.userId);
    if (!u || Date.now() - u.at > 10_000) {
      const row = await withTenant(claims.tenantId, async (c) => {
        const r = await c.query(
          `SELECT u.role, u.name, u.email, u.active AND t.status='active' AS ok FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.id=$1`,
          [claims.userId],
        );
        return r.rows[0];
      });
      u = { at: Date.now(), role: row?.role, name: row?.name, email: row?.email, ok: !!row?.ok };
      userCache.set(claims.userId, u);
      if (userCache.size > 5000) userCache.clear();
    }
    if (!u.ok) throw unauthorized('This account is disabled');
    req.auth = { userId: claims.userId, tenantId: claims.tenantId, role: u.role, name: u.name, email: u.email };
    next();
  } catch (e) {
    next(e);
  }
}

export function invalidateUserCache(userId) {
  userCache.delete(userId);
}

export const requireRole = (min) => (req, _res, next) => {
  if (!req.auth || ROLE_RANK[req.auth.role] < ROLE_RANK[min]) return next(forbidden(`This needs ${min} access or higher`));
  next();
};

// ---- Rate limiting: per tenant (after auth) and per IP (login / signup) ----
function makeLimiter(keyPrefix, points, duration) {
  return new RateLimiterRedis({
    storeClient: redis,
    keyPrefix,
    points,
    duration,
    insuranceLimiter: new RateLimiterMemory({ points, duration }),
  });
}
const tenantLimiter = makeLimiter('rl:tenant', config.TENANT_RATE_LIMIT_PER_MIN, 60);
const authLimiter = makeLimiter('rl:auth', config.AUTH_RATE_LIMIT_PER_MIN, 60);
const aiLimiter = makeLimiter('rl:ai', 30, 60);
// Refreshing a session needs a valid secret cookie, so it can allow far more traffic than password guessing can.
const refreshLimiter = makeLimiter('rl:refresh', config.REFRESH_RATE_LIMIT_PER_MIN, 60);
const feedLimiter = makeLimiter('rl:feed', 300, 60);

async function consume(limiter, key, res) {
  try {
    await limiter.consume(key);
  } catch (rej) {
    if (rej instanceof Error) {
      logger.warn({ err: rej.message }, 'rate limiter failure (allowing)');
      return;
    }
    const secs = Math.max(1, Math.ceil((rej.msBeforeNext || 1000) / 1000));
    res.set('Retry-After', String(secs));
    throw new HttpError(429, `Too many requests. Try again in ${secs}s.`);
  }
}

export const tenantRateLimit = async (req, res, next) => {
  try {
    await consume(tenantLimiter, req.auth.tenantId, res);
    next();
  } catch (e) {
    next(e);
  }
};
/** AI calls cost money, so each workspace gets 30 per minute on top of the normal limit. */
export const aiRateLimit = async (req, res, next) => {
  try {
    await consume(aiLimiter, req.auth.tenantId, res);
    next();
  } catch (e) {
    next(e);
  }
};
/** Calendar apps poll this link. The limit is generous because one calendar provider can fetch for many people from one address. */
export const calendarFeedLimit = async (req, res, next) => {
  try {
    await consume(feedLimiter, req.ip || 'unknown', res);
    next();
  } catch (e) {
    next(e);
  }
};
/** Session refresh (every page load and every 15 minutes) is limited separately from sign-in attempts. */
export const refreshRateLimit = async (req, res, next) => {
  try {
    await consume(refreshLimiter, req.ip || 'unknown', res);
    next();
  } catch (e) {
    next(e);
  }
};
export const authRateLimit = async (req, res, next) => {
  try {
    await consume(authLimiter, req.ip || 'unknown', res);
    next();
  } catch (e) {
    next(e);
  }
};

// ---- Errors ----
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    const fields = {};
    for (const i of err.issues) {
      let msg = i.message;
      if (/received undefined|received null/.test(msg)) msg = 'This field is required';
      else if (/^Invalid input: expected/.test(msg)) msg = 'Enter a valid value';
      fields[i.path.join('.') || '_'] = msg;
    }
    return res.status(400).json({ error: 'Please check the highlighted fields', fields });
  }
  if (err instanceof HttpError) {
    const body = { error: err.message };
    const d = err.details;
    if (d?.custom_data) body.fields = Object.fromEntries(Object.entries(d.custom_data).map(([k, v]) => [`custom_data.${k}`, v]));
    return res.status(err.status).json(body);
  }
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON' });
  if (err?.code === '23505') return res.status(409).json({ error: 'That value already exists' });
  if (err?.code === '23503') return res.status(409).json({ error: 'This record is linked to other records' });
  if (err?.code === '22P02') return res.status(400).json({ error: 'Invalid id or value' });
  logger.error({ err: err?.message, stack: err?.stack, path: req.path }, 'unhandled error');
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
}
