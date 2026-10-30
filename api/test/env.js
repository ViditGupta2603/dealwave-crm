/**
 * Test environment. Tests run against a throwaway database (dealwave_test) on the same Postgres server,
 * with their own low-privilege role and their own Redis database, so a running dev stack is never touched.
 *
 * Needs: a reachable Postgres superuser (TEST_ADMIN_DATABASE_URL, or MIGRATION_DATABASE_URL) and Redis.
 */
export const TEST_DB = 'dealwave_test';

export function testEnv() {
  const admin = new URL(
    process.env.TEST_ADMIN_DATABASE_URL || process.env.MIGRATION_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres',
  );
  const withDb = (user, pw) => {
    const u = new URL(admin.toString());
    u.username = user;
    u.password = pw;
    u.pathname = `/${TEST_DB}`;
    return u.toString();
  };
  const appUser = 'crm_app_test';
  const appPw = 'test_app_pw_0123456789';
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JWT_SECRET: 'test-secret-that-is-long-enough-0123456789abcdef',
    APP_URL: 'http://localhost:8080',
    REDIS_URL: process.env.TEST_REDIS_URL || 'redis://localhost:6379/1',
    MIGRATION_DATABASE_URL: withDb(decodeURIComponent(admin.username), decodeURIComponent(admin.password)),
    DATABASE_URL: withDb(appUser, appPw),
    APP_DB_USER: appUser,
    APP_DB_PASSWORD: appPw,
    AUTH_RATE_LIMIT_PER_MIN: '100000',
    TENANT_RATE_LIMIT_PER_MIN: '1000000',
    SMTP_HOST: '',
    GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    __ADMIN_URL: admin.toString(),
  };
}
