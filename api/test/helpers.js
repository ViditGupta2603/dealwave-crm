import request from 'supertest';
import { app } from '../src/app.js';
import { withSystem } from '../src/db.js';

export const http = () => request(app);

const cache = new Map();

/** Signs in once per user and reuses the session. */
export async function login(email) {
  const hit = cache.get(email);
  if (hit) return hit;
  const r = await request(app).post('/api/auth/login').set('x-return-refresh-token', '1').send({ email, password: 'Demo@12345' });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  const s = {
    token: r.body.accessToken,
    refreshToken: r.body.refreshToken,
    userId: r.body.user.id,
    tenantId: r.body.tenant.id,
    role: r.body.user.role,
  };
  cache.set(email, s);
  return s;
}

export const as = (s) => ({ Authorization: `Bearer ${s.token}` });

export const OWNER = 'owner@sundaram.demo';
export const MANAGER = 'arjun@sundaram.demo';
export const MEMBER = 'rohan@sundaram.demo';
export const OTHER_OWNER = 'owner@nimbus.demo';

/** Ids straight from the database (bypassing the API) for setting up scenarios. */
export async function firstId(table, tenantId, where = 'true', params = []) {
  return withSystem(async (c) => {
    const r = await c.query(`SELECT id FROM ${table} WHERE tenant_id=$1 AND ${where} ORDER BY created_at LIMIT 1`, [tenantId, ...params]);
    if (!r.rows[0]) throw new Error(`no row in ${table}`);
    return r.rows[0].id;
  });
}

/** A minimal but valid PDF file. */
export const tinyPdf = () => Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
