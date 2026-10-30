import { app } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { pool } from './db.js';
import { redis } from './lib/redis.js';
import { closeRealtime } from './lib/realtime.js';

const server = app.listen(config.PORT, () => logger.info(`API listening on :${config.PORT} (${config.NODE_ENV})`));

async function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  closeRealtime();
  server.close(async () => {
    await pool.end().catch(() => undefined);
    redis.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
