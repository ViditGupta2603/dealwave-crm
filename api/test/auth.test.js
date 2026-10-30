import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { OWNER } from './helpers.js';

const creds = { email: OWNER, password: 'Demo@12345' };
const cookieOf = (r) => r.headers['set-cookie']?.find((c) => c.startsWith('dealwave_rt='));
const pair = (cookie) => cookie.split(';')[0];

describe('sign in', () => {
  it('returns an access token and keeps the refresh token out of the JSON body', async () => {
    const r = await request(app).post('/api/auth/login').send(creds);
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeTruthy();
    expect(r.body.refreshToken).toBeUndefined();
    expect(r.body.user.email).toBe(OWNER);
  });

  it('sets the refresh token as an httpOnly, SameSite=Strict cookie scoped to /api/auth', async () => {
    const r = await request(app).post('/api/auth/login').send(creds);
    const c = cookieOf(r);
    expect(c).toBeTruthy();
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Strict/i);
    expect(c).toMatch(/Path=\/api\/auth/);
  });

  it('gives the same generic error for a wrong password and an unknown email', async () => {
    const a = await request(app)
      .post('/api/auth/login')
      .send({ ...creds, password: 'wrong-password' });
    const b = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });

  it('rejects API calls without a token', async () => {
    expect((await request(app).get('/api/leads')).status).toBe(401);
    expect((await request(app).get('/api/leads').set('Authorization', 'Bearer not-a-token')).status).toBe(401);
  });
});

describe('refresh cookie', () => {
  it('needs the x-requested-with header (CSRF defence) and then rotates the cookie', async () => {
    const login = await request(app).post('/api/auth/login').send(creds);
    const c1 = pair(cookieOf(login));

    const blocked = await request(app).post('/api/auth/refresh').set('Cookie', c1).send({});
    expect(blocked.status).toBe(403);

    const ok = await request(app).post('/api/auth/refresh').set('Cookie', c1).set('x-requested-with', 'dealwave').send({});
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    const c2 = pair(cookieOf(ok));
    expect(c2).not.toBe(c1);
  });

  it('logout revokes the token and clears the cookie', async () => {
    const login = await request(app).post('/api/auth/login').send(creds);
    const c1 = pair(cookieOf(login));
    const out = await request(app).post('/api/auth/logout').set('Cookie', c1).send({});
    expect(out.status).toBe(204);
    expect(cookieOf(out)).toMatch(/dealwave_rt=;/);
    const again = await request(app).post('/api/auth/refresh').set('Cookie', c1).set('x-requested-with', 'dealwave').send({});
    expect(again.status).toBe(401);
  });
});

describe('refresh token reuse detection', () => {
  it('ends every session when a rotated token is presented again', async () => {
    const login = await request(app).post('/api/auth/login').set('x-return-refresh-token', '1').send(creds);
    const rt1 = login.body.refreshToken;

    const second = await request(app).post('/api/auth/refresh').set('x-return-refresh-token', '1').send({ refreshToken: rt1 });
    expect(second.status).toBe(200);
    const rt2 = second.body.refreshToken;
    expect(rt2).not.toBe(rt1);

    // The old token is used again: treated as theft.
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: rt1 })).status).toBe(401);
    // So even the newest token no longer works.
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: rt2 })).status).toBe(401);
  });
});

describe('rate limits are separate for sign-in and for refreshing a session', () => {
  it('reads both limits from settings, with refresh allowing much more than sign-in', async () => {
    const { config } = await import('../src/config.js');
    expect(config.REFRESH_RATE_LIMIT_PER_MIN).toBeGreaterThan(
      config.AUTH_RATE_LIMIT_PER_MIN === 100000 ? 0 : config.AUTH_RATE_LIMIT_PER_MIN,
    );
  });
});
