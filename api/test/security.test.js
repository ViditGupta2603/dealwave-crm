import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { withSystem } from '../src/db.js';
import { base32Decode, base32Encode, codeAt, decryptSecret, encryptSecret, hotp, newBackupCodes, verifyCode } from '../src/lib/totp.js';

describe('one-time passwords (RFC 6238 test vectors)', () => {
  const secret = Buffer.from('12345678901234567890');
  it('matches the published SHA-1 vectors', () => {
    expect(hotp(secret, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(hotp(secret, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(hotp(secret, Math.floor(20000000000 / 30), 8)).toBe('65353130');
  });
  it('base32 round trips and decodes the standard example', () => {
    expect(base32Encode(secret)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').equals(secret)).toBe(true);
  });
  it('accepts one step of clock drift, but not more', () => {
    const b32 = base32Encode(secret);
    const t = 1_700_000_000_000;
    expect(verifyCode(b32, codeAt(b32, t), null, t)).not.toBeNull();
    expect(verifyCode(b32, codeAt(b32, t - 30_000), null, t)).not.toBeNull();
    expect(verifyCode(b32, codeAt(b32, t + 30_000), null, t)).not.toBeNull();
    expect(verifyCode(b32, codeAt(b32, t - 90_000), null, t)).toBeNull();
  });
  it('refuses a code from a step that was already used', () => {
    const b32 = base32Encode(secret);
    const t = 1_700_000_000_000;
    const step = verifyCode(b32, codeAt(b32, t), null, t);
    expect(verifyCode(b32, codeAt(b32, t), step, t)).toBeNull();
  });
  it('rejects malformed codes', () => {
    const b32 = base32Encode(secret);
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5x']) expect(verifyCode(b32, bad, null)).toBeNull();
  });
  it('secrets are encrypted, and tampering is detected', () => {
    const enc = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(enc).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(enc)).toBe('JBSWY3DPEHPK3PXP');
    const [iv, tag, data] = enc.split('.');
    expect(() => decryptSecret([iv, tag, Buffer.from('tampered!!!!!!!!!').toString('base64')].join('.'))).toThrow();
    expect(data.length).toBeGreaterThan(0);
  });
  it('makes 8 distinct backup codes', () => {
    const c = newBackupCodes();
    expect(new Set(c).size).toBe(8);
    expect(c[0]).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
  });
});

let n = 0;
async function newUser() {
  const email = `twofa${Date.now()}${n++}@example.com`;
  const r = await request(app)
    .post('/api/auth/register')
    .send({ company_name: `Test Co ${n}${Date.now()}`, name: 'Two Fa', email, password: 'Sup3rSecret!' });
  expect(r.status).toBe(201);
  return {
    email,
    password: 'Sup3rSecret!',
    token: r.body.accessToken,
    id: r.body.user.id,
    auth: { Authorization: `Bearer ${r.body.accessToken}` },
  };
}
async function enable(u) {
  const setup = await request(app).post('/api/auth/2fa/setup').set(u.auth);
  expect(setup.status).toBe(200);
  const en = await request(app)
    .post('/api/auth/2fa/enable')
    .set(u.auth)
    .send({ code: codeAt(setup.body.secret) });
  expect(en.status).toBe(200);
  return { secret: setup.body.secret, backup: en.body.backup_codes };
}
const freshStep = (id) => withSystem((c) => c.query('UPDATE users SET totp_last_step=NULL WHERE id=$1', [id]));
const login = (u) => request(app).post('/api/auth/login').send({ email: u.email, password: u.password });

describe('two-step verification', () => {
  it('setup gives a secret, a link and a QR image, and stores the secret encrypted', async () => {
    const u = await newUser();
    const r = await request(app).post('/api/auth/2fa/setup').set(u.auth);
    expect(r.status).toBe(200);
    expect(r.body.otpauth_url).toMatch(/^otpauth:\/\/totp\//);
    expect(r.body.otpauth_url).toContain(`secret=${r.body.secret}`);
    expect(r.body.qr).toMatch(/^data:image\/png;base64,/);
    const stored = await withSystem(
      async (c) => (await c.query('SELECT totp_secret_enc, totp_enabled FROM users WHERE id=$1', [u.id])).rows[0],
    );
    expect(stored.totp_enabled).toBe(false);
    expect(stored.totp_secret_enc).not.toContain(r.body.secret);
    expect((await login(u)).body.accessToken).toBeTruthy(); // not enforced until it is enabled
  });

  it('only turns on after a correct code, and returns backup codes once', async () => {
    const u = await newUser();
    const setup = await request(app).post('/api/auth/2fa/setup').set(u.auth);
    expect((await request(app).post('/api/auth/2fa/enable').set(u.auth).send({ code: '000000' })).status).toBe(400);
    const ok = await request(app)
      .post('/api/auth/2fa/enable')
      .set(u.auth)
      .send({ code: codeAt(setup.body.secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.backup_codes).toHaveLength(8);
    expect((await request(app).get('/api/auth/2fa/status').set(u.auth)).body).toEqual({ enabled: true, backup_codes_left: 8 });
    const stored = await withSystem(
      async (c) => (await c.query('SELECT totp_backup_hashes FROM users WHERE id=$1', [u.id])).rows[0].totp_backup_hashes,
    );
    expect(JSON.stringify(stored)).not.toContain(ok.body.backup_codes[0].replace('-', ''));
  });

  it('after it is on, a password alone no longer signs you in', async () => {
    const u = await newUser();
    const { secret } = await enable(u);
    const r = await login(u);
    expect(r.status).toBe(200);
    expect(r.body.mfa_required).toBe(true);
    expect(r.body.accessToken).toBeUndefined();
    expect(r.headers['set-cookie']).toBeUndefined();

    await freshStep(u.id);
    const bad = await request(app).post('/api/auth/2fa/verify').send({ mfa_token: r.body.mfa_token, code: '123456' });
    expect(bad.status).toBe(401);
    const good = await request(app)
      .post('/api/auth/2fa/verify')
      .send({ mfa_token: r.body.mfa_token, code: codeAt(secret) });
    expect(good.status).toBe(200);
    expect(good.body.accessToken).toBeTruthy();
    expect(String(good.headers['set-cookie'])).toMatch(/dealwave_rt=/);
    expect(good.body.user.totp_enabled).toBe(true);
  });

  it('a code cannot be used twice', async () => {
    const u = await newUser();
    const { secret } = await enable(u);
    await freshStep(u.id);
    const code = codeAt(secret);
    const a = await request(app)
      .post('/api/auth/2fa/verify')
      .send({ mfa_token: (await login(u)).body.mfa_token, code });
    expect(a.status).toBe(200);
    const b = await request(app)
      .post('/api/auth/2fa/verify')
      .send({ mfa_token: (await login(u)).body.mfa_token, code });
    expect(b.status).toBe(401);
  });

  it('a backup code works exactly once', async () => {
    const u = await newUser();
    const { backup } = await enable(u);
    const first = await request(app)
      .post('/api/auth/2fa/verify')
      .send({ mfa_token: (await login(u)).body.mfa_token, code: backup[0] });
    expect(first.status).toBe(200);
    const again = await request(app)
      .post('/api/auth/2fa/verify')
      .send({ mfa_token: (await login(u)).body.mfa_token, code: backup[0] });
    expect(again.status).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/auth/2fa/status')
          .set({ Authorization: `Bearer ${first.body.accessToken}` })
      ).body.backup_codes_left,
    ).toBe(7);
  });

  it('the two kinds of token cannot be swapped for each other', async () => {
    const u = await newUser();
    const { secret } = await enable(u);
    await freshStep(u.id);
    // An access token, even with a correct code, is not accepted in place of the short sign-in token.
    const swapped = await request(app)
      .post('/api/auth/2fa/verify')
      .send({ mfa_token: u.token, code: codeAt(secret) });
    expect(swapped.status).toBe(401);
    // And the short sign-in token is not an access token.
    const { mfa_token } = (await login(u)).body;
    expect(
      (
        await request(app)
          .get('/api/leads')
          .set({ Authorization: `Bearer ${mfa_token}` })
      ).status,
    ).toBe(401);
    expect((await request(app).post('/api/auth/2fa/verify').send({ mfa_token: 'not.a.token-at-all', code: '123456' })).status).toBe(401);
  });

  it('locks out guessing after 5 wrong codes, even for the right code afterwards', async () => {
    const u = await newUser();
    const { secret } = await enable(u);
    await freshStep(u.id);
    const { mfa_token } = (await login(u)).body;
    for (let i = 0; i < 5; i++)
      expect((await request(app).post('/api/auth/2fa/verify').send({ mfa_token, code: '000000' })).status).toBe(401);
    const locked = await request(app)
      .post('/api/auth/2fa/verify')
      .send({ mfa_token, code: codeAt(secret) });
    expect(locked.status).toBe(429);
  });

  it('turning it off needs the password and a valid code', async () => {
    const u = await newUser();
    const { secret } = await enable(u);
    await freshStep(u.id);
    expect(
      (
        await request(app)
          .post('/api/auth/2fa/disable')
          .set(u.auth)
          .send({ password: 'wrong-password', code: codeAt(secret) })
      ).status,
    ).toBe(400);
    expect((await request(app).post('/api/auth/2fa/disable').set(u.auth).send({ password: u.password, code: '000000' })).status).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/auth/2fa/disable')
          .set(u.auth)
          .send({ password: u.password, code: codeAt(secret) })
      ).status,
    ).toBe(204);
    expect((await login(u)).body.accessToken).toBeTruthy();
  });

  it('cannot start setup again while it is on', async () => {
    const u = await newUser();
    await enable(u);
    expect((await request(app).post('/api/auth/2fa/setup').set(u.auth)).status).toBe(409);
  });

  it('requires sign-in for every management endpoint', async () => {
    for (const path of ['/api/auth/2fa/setup', '/api/auth/2fa/enable', '/api/auth/2fa/disable'])
      expect((await request(app).post(path).send({})).status).toBe(401);
    expect((await request(app).get('/api/auth/2fa/status')).status).toBe(401);
  });
});
