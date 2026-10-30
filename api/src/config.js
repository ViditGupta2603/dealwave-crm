import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  MIGRATION_DATABASE_URL: z.string().optional(),
  APP_DB_PASSWORD: z.string().optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TTL_MIN: z.coerce.number().default(15),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),
  APP_URL: z.string().default('http://localhost:8080'),
  CORS_ORIGIN: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Dealwave CRM <no-reply@dealwave.local>'),
  SEED_DEMO: z.string().default('false'),
  ALLOW_PRIVATE_WEBHOOKS: z.string().default('false'),
  TENANT_RATE_LIMIT_PER_MIN: z.coerce.number().default(600),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  TOTP_ENCRYPTION_KEY: z.string().min(32, 'TOTP_ENCRYPTION_KEY must be at least 32 characters').optional(),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(20),
  REFRESH_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(120),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  REQUIRE_EMAIL_VERIFICATION: z.enum(['true', 'false']).default('false'),
  LOG_LEVEL: z.string().default('info'),
});

// docker-compose passes unset optional settings as empty strings; treat those as "not set".
const BLANK_IS_UNSET = new Set([
  'TOTP_ENCRYPTION_KEY',
  'ANTHROPIC_API_KEY',
  'COOKIE_SECURE',
  'CORS_ORIGIN',
  'AI_MODEL',
  'SMTP_PORT',
  'REFRESH_RATE_LIMIT_PER_MIN',
  'AUTH_RATE_LIMIT_PER_MIN',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'REQUIRE_EMAIL_VERIFICATION',
]);
const source = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => !(v === '' && BLANK_IS_UNSET.has(k))));
const parsed = schema.safeParse(source);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const i of parsed.error.issues) console.error(` - ${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}
export const config = parsed.data;

if (config.NODE_ENV === 'production' && /change[-_ ]?me/i.test(config.JWT_SECRET)) {
  console.error('Refusing to start: JWT_SECRET still has the placeholder value. Generate one with: openssl rand -hex 48');
  process.exit(1);
}
export const isProd = config.NODE_ENV === 'production';

/** The refresh cookie is Secure whenever the app is served over HTTPS (override with COOKIE_SECURE). */
export const cookieSecure = config.COOKIE_SECURE ? config.COOKIE_SECURE === 'true' : config.APP_URL.startsWith('https://');
