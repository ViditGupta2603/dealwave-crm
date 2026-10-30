import IORedis from 'ioredis';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const redis = new IORedis(config.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1, lazyConnect: false });
redis.on('error', (e) => logger.warn({ err: e.message }, 'redis error'));

/** Plain connection options for BullMQ (it manages its own ioredis instances). */
export function bullConnection() {
  const u = new URL(config.REDIS_URL);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
