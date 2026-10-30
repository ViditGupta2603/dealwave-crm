import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { TEST_DB, testEnv } from './env.js';

/** Creates a fresh test database, applies the migrations and loads the demo data. */
export default async function setup() {
  const env = testEnv();
  const admin = new URL(env.__ADMIN_URL);
  admin.pathname = '/postgres';
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  try {
    await c.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await c.end();
  }
  const run = (cmd) => execSync(cmd, { env: { ...process.env, ...env, SEED_DEMO: 'true' }, stdio: ['ignore', 'ignore', 'inherit'] });
  run('node src/migrate.js');
  run('node src/seed.js');
}
