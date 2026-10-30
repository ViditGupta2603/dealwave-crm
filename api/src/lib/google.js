import crypto from 'crypto';
import { config } from '../config.js';

/**
 * "Continue with Google" using the OAuth 2.0 authorization-code flow with PKCE.
 *
 * Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (free, from Google Cloud Console). Without them the button
 * is hidden and the rest of the app works as before.
 *
 * About the ID token: we get it straight from Google's token endpoint over HTTPS, in exchange for our one-time
 * code and client secret. OpenID Connect allows trusting it on that basis (no separate signature check),
 * but we still verify issuer, audience, expiry, nonce and that Google says the email is verified.
 */
export const googleEnabled = () => !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
export const googleRedirectUri = () => `${config.APP_URL.replace(/\/+$/, '')}/api/auth/google/callback`;

// These two can be overridden only so the whole flow can be tested against a pretend Google on a laptop. Leave them unset.
const AUTH_URL = () => process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';

let impl = (url, init) => fetch(url, init);
export const setGoogleFetch = (f) => {
  impl = f ?? ((url, init) => fetch(url, init));
};

export class GoogleError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const b64url = (b) => b.toString('base64url');
export const newPkce = () => {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
};

export function buildAuthUrl(p) {
  const u = new URL(AUTH_URL());
  u.searchParams.set('client_id', config.GOOGLE_CLIENT_ID);
  u.searchParams.set('redirect_uri', googleRedirectUri());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', p.state);
  u.searchParams.set('nonce', p.nonce);
  u.searchParams.set('code_challenge', p.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

/** Trades the one-time code for the signed-in person's Google identity. Throws GoogleError when anything is off. */
export async function exchangeCode(code, verifier, nonce) {
  const res = await impl(TOKEN_URL(), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: googleRedirectUri(),
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
    }).toString(),
  }).catch(() => {
    throw new GoogleError('google_failed', 'Could not reach Google');
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data?.id_token !== 'string') throw new GoogleError('google_failed', `Google refused the sign-in (${res.status})`);

  const parts = data.id_token.split('.');
  if (parts.length !== 3) throw new GoogleError('google_failed', 'Malformed ID token');
  let c;
  try {
    c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new GoogleError('google_failed', 'Malformed ID token');
  }

  if (c.iss !== 'https://accounts.google.com' && c.iss !== 'accounts.google.com')
    throw new GoogleError('google_failed', 'Wrong token issuer');
  if (c.aud !== config.GOOGLE_CLIENT_ID) throw new GoogleError('google_failed', 'Token was made for a different app');
  if (typeof c.exp !== 'number' || c.exp * 1000 < Date.now()) throw new GoogleError('google_failed', 'Token expired');
  if (c.nonce !== nonce) throw new GoogleError('google_failed', 'Nonce mismatch');
  if (!c.sub || typeof c.email !== 'string') throw new GoogleError('google_failed', 'Token has no email');
  // Linking by email is only safe when Google itself vouches that the person owns the address.
  if (c.email_verified !== true && c.email_verified !== 'true') throw new GoogleError('google_unverified', 'Google email is not verified');

  const email = c.email.trim().toLowerCase();
  return { sub: String(c.sub), email, name: String(c.name || email.split('@')[0]).slice(0, 120) };
}
