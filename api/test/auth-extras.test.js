import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { withSystem } from '../src/db.js';
import { sha256 } from '../src/lib/auth.js';
import { testOutbox } from '../src/lib/authMail.js';
import { setGoogleFetch } from '../src/lib/google.js';
import { OWNER, as, http, login } from './helpers.js';

// ---------- helpers ----------
let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;
const PW = 'Str0ng-Pass-1';

async function signUp(over = {}) {
  const email = over.email ?? `person-${uniq()}@example.com`;
  const r = await request(app)
    .post('/api/auth/register')
    .send({ company_name: `Co ${uniq()}`, name: 'Test Person', email, password: over.password ?? PW });
  expect(r.status).toBe(201);
  return { email, token: r.body.accessToken, userId: r.body.user.id, tenantId: r.body.tenant.id, body: r.body };
}
const lastLink = (to, kind) => [...testOutbox].reverse().find((m) => m.to === to && m.kind === kind)?.link;
const tokenOf = (link) => new URL(link).searchParams.get('token');
const sql = (q, p = []) => withSystem(async (c) => (await c.query(q, p)).rows);
const cookieOf = (r, name) => r.headers['set-cookie']?.find((c) => c.startsWith(name + '='));
const pair = (c) => c.split(';')[0];
/** Pretend a link was requested a few minutes ago, so the one-per-minute limit does not get in the way. */
const ageTokens = (userId) => sql(`UPDATE auth_tokens SET created_at = created_at - interval '5 minutes' WHERE user_id=$1`, [userId]);

// ---------- forgot / reset password ----------
describe('forgot password', () => {
  it('answers the same for a known and an unknown email, and only emails the known one', async () => {
    const u = await signUp();
    const a = await request(app).post('/api/auth/forgot-password').send({ email: u.email });
    const b = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: `nobody-${uniq()}@example.com` });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body).toEqual(b.body);
    expect(lastLink(u.email, 'reset')).toMatch(/\/reset-password\?token=[0-9a-f]{64}$/);
    expect(testOutbox.filter((m) => m.kind === 'reset' && m.to.startsWith('nobody-'))).toHaveLength(0);
  });

  it('stores only a hash of the token, and the email log does not keep the link', async () => {
    const u = await signUp();
    await request(app).post('/api/auth/forgot-password').send({ email: u.email });
    const token = tokenOf(lastLink(u.email, 'reset'));
    const rows = await sql(`SELECT token_hash FROM auth_tokens WHERE user_id=$1 AND purpose='reset'`, [u.userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(sha256(token));
    expect(rows[0].token_hash).not.toContain(token);
    await new Promise((r) => setTimeout(r, 300));
    const log = await sql(`SELECT body FROM email_log WHERE user_id=$1 AND source='auth' AND subject LIKE 'Reset%'`, [u.userId]);
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].body).not.toContain(token);
  });

  it('only sends one link a minute to the same person', async () => {
    const u = await signUp();
    await request(app).post('/api/auth/forgot-password').send({ email: u.email });
    const before = testOutbox.filter((m) => m.to === u.email && m.kind === 'reset').length;
    const again = await request(app).post('/api/auth/forgot-password').send({ email: u.email });
    expect(again.status).toBe(202);
    expect(testOutbox.filter((m) => m.to === u.email && m.kind === 'reset').length).toBe(before);
  });

  it('rejects something that is not an email address', async () => {
    const r = await request(app).post('/api/auth/forgot-password').send({ email: 'not-an-email' });
    expect(r.status).toBe(400);
  });

  it('does not email disabled accounts', async () => {
    const u = await signUp();
    await sql('UPDATE users SET active=false WHERE id=$1', [u.userId]);
    const before = testOutbox.length;
    expect((await request(app).post('/api/auth/forgot-password').send({ email: u.email })).status).toBe(202);
    expect(testOutbox.length).toBe(before);
  });
});

describe('reset password', () => {
  async function requestLink() {
    const u = await signUp();
    const login1 = await request(app).post('/api/auth/login').send({ email: u.email, password: PW });
    const oldCookie = pair(cookieOf(login1, 'dealwave_rt'));
    await request(app).post('/api/auth/forgot-password').send({ email: u.email });
    return { ...u, oldCookie, token: tokenOf(lastLink(u.email, 'reset')) };
  }

  it('sets the new password, ends every old session and cannot be used twice', async () => {
    const u = await requestLink();
    expect((await request(app).get(`/api/auth/reset-password/${u.token}`)).status).toBe(200);

    const r = await request(app).post('/api/auth/reset-password').send({ token: u.token, password: 'Brand-New-Pass-9' });
    expect(r.status).toBe(204);

    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: PW })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: 'Brand-New-Pass-9' })).status).toBe(200);
    // the session that existed before the reset can no longer be refreshed
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', u.oldCookie).set('x-requested-with', 'dealwave').send({});
    expect(refresh.status).toBe(401);

    const again = await request(app).post('/api/auth/reset-password').send({ token: u.token, password: 'Another-Pass-10' });
    expect(again.status).toBe(400);
    expect((await request(app).get(`/api/auth/reset-password/${u.token}`)).status).toBe(404);
  });

  it('emails the owner that the password was changed', async () => {
    const u = await requestLink();
    await request(app).post('/api/auth/reset-password').send({ token: u.token, password: 'Brand-New-Pass-9' });
    expect(testOutbox.some((m) => m.to === u.email && m.kind === 'changed')).toBe(true);
  });

  it('refuses an expired link', async () => {
    const u = await requestLink();
    await sql(`UPDATE auth_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash=$1`, [sha256(u.token)]);
    expect((await request(app).get(`/api/auth/reset-password/${u.token}`)).status).toBe(404);
    const r = await request(app).post('/api/auth/reset-password').send({ token: u.token, password: 'Brand-New-Pass-9' });
    expect(r.status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: PW })).status).toBe(200);
  });

  it('refuses a made-up link and a weak password', async () => {
    const u = await requestLink();
    expect(
      (
        await request(app)
          .post('/api/auth/reset-password')
          .send({ token: 'f'.repeat(64), password: 'Brand-New-Pass-9' })
      ).status,
    ).toBe(400);
    const weak = await request(app).post('/api/auth/reset-password').send({ token: u.token, password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.fields.password).toBeTruthy();
    // a rejected password must not use the link up
    expect((await request(app).get(`/api/auth/reset-password/${u.token}`)).status).toBe(200);
  });

  it('a newer link replaces the older one', async () => {
    const u = await requestLink();
    await ageTokens(u.userId);
    await request(app).post('/api/auth/forgot-password').send({ email: u.email });
    const newer = tokenOf(lastLink(u.email, 'reset'));
    expect(newer).not.toBe(u.token);
    expect((await request(app).post('/api/auth/reset-password').send({ token: u.token, password: 'Brand-New-Pass-9' })).status).toBe(400);
    expect((await request(app).post('/api/auth/reset-password').send({ token: newer, password: 'Brand-New-Pass-9' })).status).toBe(204);
  });

  it('two requests with the same link cannot both win', async () => {
    const u = await requestLink();
    const results = await Promise.all(
      [1, 2, 3].map((i) =>
        request(app)
          .post('/api/auth/reset-password')
          .send({ token: u.token, password: `Parallel-Pass-${i}0` }),
      ),
    );
    expect(results.filter((r) => r.status === 204)).toHaveLength(1);
  });

  it('keeps two-step verification switched on (email alone must not remove it)', async () => {
    const u = await requestLink();
    await sql(`UPDATE users SET totp_enabled=true, totp_secret_enc='x' WHERE id=$1`, [u.userId]);
    await request(app).post('/api/auth/reset-password').send({ token: u.token, password: 'Brand-New-Pass-9' });
    const l = await request(app).post('/api/auth/login').send({ email: u.email, password: 'Brand-New-Pass-9' });
    expect(l.body.mfa_required).toBe(true);
  });

  it('marks the email as verified, because the person just opened a link sent to it', async () => {
    const u = await requestLink();
    expect((await sql('SELECT email_verified_at FROM users WHERE id=$1', [u.userId]))[0].email_verified_at).toBeNull();
    await request(app).post('/api/auth/reset-password').send({ token: u.token, password: 'Brand-New-Pass-9' });
    expect((await sql('SELECT email_verified_at FROM users WHERE id=$1', [u.userId]))[0].email_verified_at).not.toBeNull();
  });

  it('a verification link cannot be used to reset a password', async () => {
    const u = await signUp();
    const verifyToken = tokenOf(lastLink(u.email, 'verify'));
    const r = await request(app).post('/api/auth/reset-password').send({ token: verifyToken, password: 'Brand-New-Pass-9' });
    expect(r.status).toBe(400);
  });
});

// ---------- email verification ----------
describe('email verification', () => {
  it('new sign-ups start unverified and get an email with a link', async () => {
    const u = await signUp();
    expect(u.body.user.email_verified).toBe(false);
    expect(lastLink(u.email, 'verify')).toMatch(/\/verify-email\?token=[0-9a-f]{64}$/);
  });

  it('people who existed before this feature count as verified', async () => {
    const s = await login(OWNER);
    const me = await http().get('/api/auth/me').set(as(s));
    expect(me.body.user.email_verified).toBe(true);
  });

  it('the link verifies the email once', async () => {
    const u = await signUp();
    const token = tokenOf(lastLink(u.email, 'verify'));
    expect((await request(app).post('/api/auth/verify-email').send({ token })).status).toBe(204);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${u.token}`);
    expect(me.body.user.email_verified).toBe(true);
    expect((await request(app).post('/api/auth/verify-email').send({ token })).status).toBe(400);
  });

  it('refuses a wrong or expired link', async () => {
    const u = await signUp();
    expect(
      (
        await request(app)
          .post('/api/auth/verify-email')
          .send({ token: 'a'.repeat(64) })
      ).status,
    ).toBe(400);
    const token = tokenOf(lastLink(u.email, 'verify'));
    await sql(`UPDATE auth_tokens SET expires_at = now() - interval '1 second' WHERE token_hash=$1`, [sha256(token)]);
    expect((await request(app).post('/api/auth/verify-email').send({ token })).status).toBe(400);
  });

  it('can send the link again, but not more than once a minute', async () => {
    const u = await signUp();
    const auth = { Authorization: `Bearer ${u.token}` };
    const soon = await request(app).post('/api/auth/resend-verification').set(auth).send({});
    expect(soon.status).toBe(429);
    await ageTokens(u.userId);
    const old = tokenOf(lastLink(u.email, 'verify'));
    expect((await request(app).post('/api/auth/resend-verification').set(auth).send({})).status).toBe(204);
    const fresh = tokenOf(lastLink(u.email, 'verify'));
    expect(fresh).not.toBe(old);
    expect((await request(app).post('/api/auth/verify-email').send({ token: old })).status).toBe(400);
    expect((await request(app).post('/api/auth/verify-email').send({ token: fresh })).status).toBe(204);
  });

  it('resending needs a sign-in, and does nothing once verified', async () => {
    expect((await request(app).post('/api/auth/resend-verification').send({})).status).toBe(401);
    const s = await login(OWNER);
    const before = testOutbox.length;
    expect((await http().post('/api/auth/resend-verification').set(as(s)).send({})).status).toBe(204);
    expect(testOutbox.length).toBe(before);
  });

  it('people who join through an invitation are verified (the invite link proved their inbox)', async () => {
    const owner = await login(OWNER);
    const email = `invitee-${uniq()}@example.com`;
    const inv = await http().post('/api/team/invite').set(as(owner)).send({ email, role: 'member' });
    expect(inv.status).toBe(201);
    const token = new URL(inv.body.invite_link).searchParams.get('token');
    const r = await request(app).post('/api/auth/accept-invite').send({ token, name: 'New Joiner', password: PW });
    expect(r.status).toBe(201);
    expect(r.body.user.email_verified).toBe(true);
  });

  describe('strict mode (REQUIRE_EMAIL_VERIFICATION=true)', () => {
    beforeEach(() => {
      config.REQUIRE_EMAIL_VERIFICATION = 'true';
    });
    afterEach(() => {
      config.REQUIRE_EMAIL_VERIFICATION = 'false';
    });

    it('blocks sign-in until the email is confirmed, without revealing anything on a wrong password', async () => {
      const u = await signUp();
      const wrong = await request(app).post('/api/auth/login').send({ email: u.email, password: 'wrong-password-1' });
      expect(wrong.status).toBe(401);
      const blocked = await request(app).post('/api/auth/login').send({ email: u.email, password: PW });
      expect(blocked.status).toBe(403);
      expect(blocked.body.error).toMatch(/confirm your email/i);
      await request(app)
        .post('/api/auth/verify-email')
        .send({ token: tokenOf(lastLink(u.email, 'verify')) });
      expect((await request(app).post('/api/auth/login').send({ email: u.email, password: PW })).status).toBe(200);
    });

    it('does not lock out the demo accounts', async () => {
      expect((await request(app).post('/api/auth/login').send({ email: OWNER, password: 'Demo@12345' })).status).toBe(200);
    });

    it('is reported to the frontend', async () => {
      expect((await request(app).get('/api/auth/providers')).body.require_email_verification).toBe(true);
    });
  });
});

// ---------- Google sign-in ----------
const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

function idToken(claims) {
  return jwt.sign(
    { iss: 'https://accounts.google.com', aud: CLIENT_ID, email_verified: true, ...claims },
    'google-signing-key-we-never-check',
    { expiresIn: '1h' },
  );
}

async function startFlow() {
  const r = await request(app).get('/api/auth/google/start');
  expect(r.status).toBe(302);
  const location = new URL(r.headers.location);
  return {
    state: location.searchParams.get('state'),
    nonce: location.searchParams.get('nonce'),
    cookie: pair(cookieOf(r, 'dealwave_oauth')),
    location,
  };
}

/** Fakes Google's token endpoint, then plays the browser coming back to our callback. */
async function finish(flow, claims, opts = {}) {
  setGoogleFetch(async () => ({
    ok: (opts.tokenStatus ?? 200) < 400,
    status: opts.tokenStatus ?? 200,
    json: async () => (claims ? { id_token: idToken({ nonce: flow.nonce, ...claims }) } : { error: 'invalid_grant' }),
  }));
  const req = request(app).get(`/api/auth/google/callback?${opts.query ?? `code=one-time-code&state=${opts.state ?? flow.state}`}`);
  const cookie = opts.cookie === undefined ? flow.cookie : opts.cookie;
  if (cookie) req.set('Cookie', cookie);
  return req;
}

const profile = (over = {}) => ({ sub: `g-${uniq()}`, email: `g-${uniq()}@example.com`, name: 'Gita Sharma', ...over });

describe('Continue with Google', () => {
  afterEach(() => setGoogleFetch(null));

  it('tells the frontend whether Google is set up', async () => {
    expect((await request(app).get('/api/auth/providers')).body.google).toBe(true);
    const keep = config.GOOGLE_CLIENT_ID;
    config.GOOGLE_CLIENT_ID = undefined;
    try {
      expect((await request(app).get('/api/auth/providers')).body.google).toBe(false);
      const r = await request(app).get('/api/auth/google/start');
      expect(r.status).toBe(302);
      expect(r.headers.location).toBe('/login?error=google_off');
    } finally {
      config.GOOGLE_CLIENT_ID = keep;
    }
  });

  it('sends the person to Google with state, nonce and a PKCE challenge, and remembers them in a short-lived cookie', async () => {
    const r = await request(app).get('/api/auth/google/start');
    const u = new URL(r.headers.location);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:8080/api/auth/google/callback');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state').length).toBeGreaterThanOrEqual(16);
    expect(u.searchParams.get('nonce').length).toBeGreaterThanOrEqual(16);
    const c = cookieOf(r, 'dealwave_oauth');
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Lax/i);
    expect(c).toMatch(/Path=\/api\/auth\/google/);
    // that cookie is not a login token
    const packed = decodeURIComponent(pair(c).split('=')[1]);
    expect((await request(app).get('/api/leads').set('Authorization', `Bearer ${packed}`)).status).toBe(401);
  });

  it('proves the PKCE secret and sends our secret to Google when trading the code', async () => {
    const flow = await startFlow();
    let sent = null;
    setGoogleFetch(async (_url, init) => {
      sent = new URLSearchParams(init.body);
      return { ok: true, status: 200, json: async () => ({ id_token: idToken({ nonce: flow.nonce, ...profile() }) }) };
    });
    await request(app).get(`/api/auth/google/callback?code=abc&state=${flow.state}`).set('Cookie', flow.cookie);
    expect(sent.get('code')).toBe('abc');
    expect(sent.get('client_secret')).toBe('test-client-secret');
    expect(sent.get('grant_type')).toBe('authorization_code');
    const verifier = sent.get('code_verifier');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    expect(flow.location.searchParams.get('code_challenge')).toBe(challenge);
  });

  it('creates a workspace for a first-time Google user and signs them in', async () => {
    const p = profile({ name: 'Gita Sharma' });
    const flow = await startFlow();
    const r = await finish(flow, p);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/auth/google/done');
    const rt = cookieOf(r, 'dealwave_rt');
    expect(rt).toMatch(/HttpOnly/i);
    expect(cookieOf(r, 'dealwave_oauth')).toMatch(/Expires=Thu, 01 Jan 1970/); // one-time cookie is cleared

    // the frontend now trades the cookie for an access token
    const s = await request(app).post('/api/auth/refresh').set('Cookie', pair(rt)).set('x-requested-with', 'dealwave').send({});
    expect(s.status).toBe(200);
    expect(s.body.user.email).toBe(p.email);
    expect(s.body.user.role).toBe('owner');
    expect(s.body.user.email_verified).toBe(true);
    expect(s.body.tenant.name).toBe("Gita Sharma's workspace");
    const stages = await sql('SELECT 1 FROM pipeline_stages WHERE tenant_id=$1', [s.body.tenant.id]);
    expect(stages.length).toBeGreaterThan(0);
    const row = (await sql('SELECT google_sub FROM users WHERE email=$1', [p.email]))[0];
    expect(row.google_sub).toBe(p.sub);
  });

  it('signs an existing person into their own workspace instead of making a second one', async () => {
    const before = (await sql('SELECT count(*)::int AS n FROM tenants'))[0].n;
    const p = profile({ email: 'ananya@sundaram.demo' });
    const r = await finish(await startFlow(), p);
    expect(r.headers.location).toBe('/auth/google/done');
    const s = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', pair(cookieOf(r, 'dealwave_rt')))
      .set('x-requested-with', 'dealwave')
      .send({});
    expect(s.body.user.email).toBe('ananya@sundaram.demo');
    expect(s.body.tenant.slug).toMatch(/sundaram/);
    expect((await sql('SELECT count(*)::int AS n FROM tenants'))[0].n).toBe(before);

    // next time Google is recognised by its id, even if the email on the Google account changed
    const again = await finish(await startFlow(), { sub: p.sub, email: 'renamed@example.com', name: 'Ananya' });
    expect(again.headers.location).toBe('/auth/google/done');
    expect((await sql('SELECT 1 FROM users WHERE google_sub=$1', [p.sub])).length).toBe(1);
  });

  it('does not let a different Google account take over an email that is already linked', async () => {
    const first = profile({ email: 'karan@sundaram.demo' });
    await finish(await startFlow(), first);
    const second = profile({ email: 'karan@sundaram.demo' });
    const r = await finish(await startFlow(), second);
    expect(r.headers.location).toBe('/login?error=google_failed');
    expect(cookieOf(r, 'dealwave_rt')).toBeUndefined();
  });

  it('throws away a password set by someone else before the real owner arrived with Google (pre-hijacking)', async () => {
    const victimEmail = `victim-${uniq()}@example.com`;
    const attacker = await signUp({ email: victimEmail, password: 'Attacker-Pass-1' });
    const attackerLogin = await request(app).post('/api/auth/login').send({ email: victimEmail, password: 'Attacker-Pass-1' });
    const attackerCookie = pair(cookieOf(attackerLogin, 'dealwave_rt'));

    const r = await finish(await startFlow(), profile({ email: victimEmail, name: 'Real Owner' }));
    expect(r.headers.location).toBe('/auth/google/done');
    expect((await request(app).post('/api/auth/login').send({ email: victimEmail, password: 'Attacker-Pass-1' })).status).toBe(401);
    expect(
      (await request(app).post('/api/auth/refresh').set('Cookie', attackerCookie).set('x-requested-with', 'dealwave').send({})).status,
    ).toBe(401);
    expect(attacker.userId).toBeTruthy();
  });

  it('keeps the password of an account whose email was already verified', async () => {
    const u = await signUp();
    await request(app)
      .post('/api/auth/verify-email')
      .send({ token: tokenOf(lastLink(u.email, 'verify')) });
    await finish(await startFlow(), profile({ email: u.email }));
    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: PW })).status).toBe(200);
  });

  it('refuses a forged callback: wrong state, missing cookie, or a cookie from another visit', async () => {
    const flow = await startFlow();
    expect((await finish(flow, profile(), { state: 'forged-state-value' })).headers.location).toBe('/login?error=google_failed');
    expect((await finish(flow, profile(), { cookie: null })).headers.location).toBe('/login?error=google_expired');
    const other = await startFlow();
    expect((await finish(flow, profile(), { cookie: other.cookie })).headers.location).toBe('/login?error=google_failed');
    expect((await finish(flow, profile(), { cookie: 'dealwave_oauth=garbage' })).headers.location).toBe('/login?error=google_expired');
  });

  it('refuses a token with the wrong nonce, audience, issuer or expiry', async () => {
    const bad = async (claims) => {
      const flow = await startFlow();
      setGoogleFetch(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id_token: idToken({ nonce: flow.nonce, ...profile(), ...claims }) }),
      }));
      const r = await request(app).get(`/api/auth/google/callback?code=c&state=${flow.state}`).set('Cookie', flow.cookie);
      return r.headers.location;
    };
    expect(await bad({ nonce: 'someone-elses-nonce' })).toBe('/login?error=google_failed');
    expect(await bad({ aud: 'another-app.apps.googleusercontent.com' })).toBe('/login?error=google_failed');
    expect(await bad({ iss: 'https://evil.example.com' })).toBe('/login?error=google_failed');
    expect(await bad({ exp: Math.floor(Date.now() / 1000) - 60 })).toBe('/login?error=google_failed');
    expect(await bad({ email: undefined })).toBe('/login?error=google_failed');
  });

  it('refuses a Google account whose email Google has not verified', async () => {
    const r = await finish(await startFlow(), profile({ email_verified: false }));
    expect(r.headers.location).toBe('/login?error=google_unverified');
    expect(cookieOf(r, 'dealwave_rt')).toBeUndefined();
  });

  it('handles Cancel on the Google screen and a failing token exchange', async () => {
    const flow = await startFlow();
    expect((await finish(flow, null, { query: 'error=access_denied&state=x' })).headers.location).toBe('/login?error=google_cancelled');
    expect((await finish(await startFlow(), null, { tokenStatus: 400 })).headers.location).toBe('/login?error=google_failed');
    setGoogleFetch(async () => {
      throw new Error('network down');
    });
    const f2 = await startFlow();
    const r = await request(app).get(`/api/auth/google/callback?code=c&state=${f2.state}`).set('Cookie', f2.cookie);
    expect(r.headers.location).toBe('/login?error=google_failed');
  });

  it('does not sign in disabled people or suspended workspaces', async () => {
    const p = profile();
    await finish(await startFlow(), p);
    await sql('UPDATE users SET active=false WHERE google_sub=$1', [p.sub]);
    const r = await finish(await startFlow(), p);
    expect(r.headers.location).toBe('/login?error=account_disabled');
    expect(cookieOf(r, 'dealwave_rt')).toBeUndefined();

    const q = profile();
    await finish(await startFlow(), q);
    await sql(`UPDATE tenants SET status='suspended' WHERE id=(SELECT tenant_id FROM users WHERE google_sub=$1)`, [q.sub]);
    expect((await finish(await startFlow(), q)).headers.location).toBe('/login?error=workspace_suspended');
  });

  it('still asks for the authenticator code when two-step verification is on', async () => {
    const p = profile();
    await finish(await startFlow(), p);
    await sql(`UPDATE users SET totp_enabled=true, totp_secret_enc='x' WHERE google_sub=$1`, [p.sub]);
    const r = await finish(await startFlow(), p);
    expect(r.headers.location).toMatch(/^\/login#mfa=/);
    expect(cookieOf(r, 'dealwave_rt')).toBeUndefined();
    const token = decodeURIComponent(r.headers.location.split('#mfa=')[1]);
    // the token only works for the code step, never as an access token
    expect((await request(app).get('/api/leads').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('treats a bare callback with no cookie as an expired attempt', async () => {
    const hits = await Promise.all([1, 2, 3].map(() => request(app).get('/api/auth/google/callback')));
    for (const h of hits) expect(h.headers.location).toBe('/login?error=google_expired');
  });
});
