import { Pool, types } from 'pg';
import { config } from './config.js';

// numeric -> number, bigint (count) -> number
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
// keep DATE columns as plain YYYY-MM-DD strings
types.setTypeParser(1082, (v) => v);

export const pool = new Pool({ connectionString: config.DATABASE_URL, max: 20, idleTimeoutMillis: 30000 });
pool.on('error', (err) => console.error('pg pool error', err));

async function tx(setting, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT set_config($1, $2, true)', setting);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    try {
      await c.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    c.release();
  }
}

/** Runs fn in a transaction where Row-Level Security is locked to one tenant. */
export function withTenant(tenantId, fn) {
  return tx(['app.tenant_id', tenantId], fn);
}

/** Cross-tenant access. Only for auth (login by email), signup, seeding and system jobs. */
export function withSystem(fn) {
  return tx(['app.bypass', 'on'], fn);
}
