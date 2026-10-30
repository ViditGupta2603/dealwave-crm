import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { logger } from './logger.js';
import { pool } from './db.js';
import { redis } from './lib/redis.js';
import { authenticate, calendarFeedLimit, errorHandler, tenantRateLimit } from './middleware.js';
import { authRouter } from './routes/auth.js';
import { teamRouter } from './routes/team.js';
import { accountsRouter, activitiesRouter, contactsRouter, dealsRouter, leadsRouter } from './routes/records.js';
import { auditRouter, billingRouter, fieldsRouter, notificationsRouter, pipelineRouter, searchRouter } from './routes/settings.js';
import { workflowsRouter } from './routes/workflows.js';
import { reportsRouter } from './routes/reports.js';
import { emailsRouter } from './routes/emails.js';
import { attachmentsRouter } from './routes/attachments.js';
import { eventsRouter } from './routes/events.js';
import { aiRouter } from './routes/ai.js';
import { calendarPublicRouter, calendarRouter } from './routes/calendar.js';
import { webhooksRouter } from './routes/webhooks.js';

export const app = express();
app.set('trust proxy', config.TRUST_PROXY_HOPS);
app.disable('x-powered-by');
app.use(helmet());
if (config.CORS_ORIGIN) app.use(cors({ origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: false }));
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
// Webhooks need the untouched raw body to check their signature, so they are mounted before the JSON parser.
app.use('/api/webhooks', webhooksRouter);
app.use(express.json({ limit: '2mb' }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    const redisOk = (await redis.ping().catch(() => null)) === 'PONG';
    res.status(redisOk ? 200 : 503).json({ status: redisOk ? 'ok' : 'degraded', db: 'ok', redis: redisOk ? 'ok' : 'down' });
  } catch {
    res.status(503).json({ status: 'down', db: 'down' });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/calendar/public', calendarFeedLimit, calendarPublicRouter);

const api = express.Router();
api.use(authenticate, tenantRateLimit);
api.use('/team', teamRouter);
api.use('/leads', leadsRouter);
api.use('/contacts', contactsRouter);
api.use('/accounts', accountsRouter);
api.use('/deals', dealsRouter);
api.use('/activities', activitiesRouter);
api.use('/pipeline', pipelineRouter);
api.use('/fields', fieldsRouter);
api.use('/workflows', workflowsRouter);
api.use('/reports', reportsRouter);
api.use('/notifications', notificationsRouter);
api.use('/audit', auditRouter);
api.use('/search', searchRouter);
api.use('/billing', billingRouter);
api.use('/emails', emailsRouter);
api.use('/attachments', attachmentsRouter);
api.use('/events', eventsRouter);
api.use('/ai', aiRouter);
api.use('/calendar', calendarRouter);
app.use('/api', api);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);
