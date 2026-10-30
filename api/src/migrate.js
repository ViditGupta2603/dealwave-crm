import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

/**
 * Applies SQL files from /migrations in order, and makes sure the low-privilege
 * application role exists. RLS only protects tenants when the app does NOT connect
 * as a superuser, so the runtime DATABASE_URL should use the app role (crm_app).
 */
export async function migrate() {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727272)');
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      console.log(`[migrate] applying ${f}`);
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }

    const appPassword = process.env.APP_DB_PASSWORD;
    if (appPassword) {
      // The low-privilege role the API connects as. Never a superuser, never BYPASSRLS.
      const role = process.env.APP_DB_USER || 'crm_app';
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error(`Invalid APP_DB_USER "${role}"`);
      const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount;
      const pw = (await client.query('SELECT quote_literal($1) AS q', [appPassword])).rows[0].q;
      await client.query(
        exists ? `ALTER ROLE ${role} LOGIN PASSWORD ${pw}` : `CREATE ROLE ${role} LOGIN PASSWORD ${pw} NOSUPERUSER NOBYPASSRLS`,
      );
      const db = (await client.query('SELECT current_database() AS d')).rows[0].d;
      await client.query(`GRANT CONNECT ON DATABASE "${db}" TO ${role}`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`);
      console.log(`[migrate] app role ${role} is ready`);
    }
    console.log('[migrate] up to date');
  } finally {
    await client.query('SELECT pg_advisory_unlock(727272)').catch(() => undefined);
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
