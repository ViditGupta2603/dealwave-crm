import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import { config, cookieSecure } from '../config.js';

export const ROLE_RANK = { member: 1, manager: 2, admin: 3, owner: 4 };

export const hashPassword = (p) => bcrypt.hash(p, 10);
export const verifyPassword = (p, h) => bcrypt.compare(p, h);
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

export function signAccessToken(userId, tenantId, role) {
  return jwt.sign({ tid: tenantId, role }, config.JWT_SECRET, { subject: userId, expiresIn: `${config.ACCESS_TTL_MIN}m` });
}

export function verifyAccessToken(token) {
  const p = jwt.verify(token, config.JWT_SECRET);
  // Short-lived tokens made for other purposes (like the two-step sign-in token) must never work as access tokens.
  if (p.purpose || !p.sub || !p.tid || !p.role) throw new Error('not an access token');
  return { userId: String(p.sub), tenantId: String(p.tid), role: p.role };
}

export async function issueRefreshToken(c, tenantId, userId) {
  const token = randomToken(48);
  await c.query(
    `INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' days')::interval)`,
    [tenantId, userId, sha256(token), String(config.REFRESH_TTL_DAYS)],
  );
  return token;
}

// ---- Refresh token cookie: httpOnly so page scripts can never read it ----
export const REFRESH_COOKIE = 'dealwave_rt';

export function readCookie(header, name) {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

const cookieBase = { httpOnly: true, secure: cookieSecure, sameSite: 'strict', path: '/api/auth' };
export const setRefreshCookie = (res, token) =>
  res.cookie(REFRESH_COOKIE, token, { ...cookieBase, maxAge: config.REFRESH_TTL_DAYS * 86_400_000 });
export const clearRefreshCookie = (res) => res.clearCookie(REFRESH_COOKIE, cookieBase);
