import { randomToken, sha256 } from './auth.js';

/** A reset link is short-lived because it is as powerful as the password itself. */
const TTL = { reset: '1 hour', verify: '48 hours' };

/** Creates a fresh link token and retires any older unused ones of the same kind. Returns the raw token (emailed, never stored). */
export async function createAuthToken(c, tenantId, userId, purpose) {
  await c.query('UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL', [userId, purpose]);
  const token = randomToken(32);
  await c.query('INSERT INTO auth_tokens (tenant_id,user_id,purpose,token_hash,expires_at) VALUES ($1,$2,$3,$4, now() + $5::interval)', [
    tenantId,
    userId,
    purpose,
    sha256(token),
    TTL[purpose],
  ]);
  return token;
}

/** Is this token still usable? Does not use it up. */
export async function peekAuthToken(c, token, purpose) {
  const r = await c.query('SELECT 1 FROM auth_tokens WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at > now()', [
    sha256(token),
    purpose,
  ]);
  return !!r.rowCount;
}

/**
 * Uses the token up in one atomic statement, so two requests with the same link can never both succeed.
 * Returns who it belonged to, or null when it is wrong, expired or already used.
 */
export async function consumeAuthToken(c, token, purpose) {
  const r = await c.query(
    'UPDATE auth_tokens SET used_at=now() WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at > now() RETURNING user_id, tenant_id',
    [sha256(token), purpose],
  );
  return r.rows[0] ?? null;
}

/** True when a link of this kind was already sent to the user in the last `seconds` (used to stop email bombing). */
export async function sentRecently(c, userId, purpose, seconds = 60) {
  const r = await c.query(
    `SELECT 1 FROM auth_tokens WHERE user_id=$1 AND purpose=$2 AND created_at > now() - ($3 || ' seconds')::interval`,
    [userId, purpose, String(seconds)],
  );
  return !!r.rowCount;
}
