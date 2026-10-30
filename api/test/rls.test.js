import { beforeAll, describe, expect, it } from 'vitest';
import { pool, withSystem, withTenant } from '../src/db.js';

/** These talk to the database directly, as the low-privilege app role, to prove isolation does not depend on the API. */
let A = '';
let B = '';

beforeAll(async () => {
  const rows = await withSystem(async (c) => (await c.query(`SELECT id, slug FROM tenants`)).rows);
  A = rows.find((r) => r.slug === 'sundaram-solar').id;
  B = rows.find((r) => r.slug === 'nimbus-logistics').id;
});

const TABLES = ['leads', 'contacts', 'accounts', 'deals', 'activities', 'email_log', 'attachments', 'email_templates', 'users'];

describe('row level security', () => {
  it.each(TABLES)('a query with no WHERE on %s only returns the current tenant', async (table) => {
    const rows = await withTenant(A, async (c) => (await c.query(`SELECT DISTINCT tenant_id FROM ${table}`)).rows);
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(A);
  });

  it('shows nothing at all when no tenant has been set', async () => {
    const r = await pool.query('SELECT count(*)::int AS n FROM leads');
    expect(r.rows[0].n).toBe(0);
  });

  it('refuses to insert a row for another tenant', async () => {
    await expect(withTenant(A, (c) => c.query(`INSERT INTO leads (tenant_id, first_name) VALUES ($1, 'Intruder')`, [B]))).rejects.toThrow(
      /row-level security/i,
    );
  });

  it("cannot update or delete another tenant's rows", async () => {
    const upd = await withTenant(A, (c) => c.query(`UPDATE leads SET city='hacked' WHERE tenant_id=$1`, [B]));
    expect(upd.rowCount).toBe(0);
    const del = await withTenant(A, (c) => c.query(`DELETE FROM attachments WHERE tenant_id=$1`, [B]));
    expect(del.rowCount).toBe(0);
    const still = await withSystem(
      async (c) => (await c.query(`SELECT count(*)::int AS n FROM leads WHERE tenant_id=$1 AND city='hacked'`, [B])).rows[0].n,
    );
    expect(still).toBe(0);
  });

  it('the app role is not a superuser and cannot bypass the policies', async () => {
    const r = await pool.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});
