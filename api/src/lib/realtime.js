import { redis } from './redis.js';
import { logger } from '../logger.js';

/**
 * Live updates over Server-Sent Events.
 *
 * Any process (API or worker) publishes to Redis channel "rt:<tenantId>". Every API process subscribes once and
 * forwards each message to the browsers connected to it. Because Redis sits in the middle, this keeps working when
 * several API containers run behind a load balancer.
 */

const hub = new Map();

const CHANNEL_PREFIX = 'rt:';

/** Fire and forget: a Redis hiccup must never break the request that triggered the event. */
export function publish(tenantId, msg) {
  redis.publish(CHANNEL_PREFIX + tenantId, JSON.stringify(msg)).catch((e) => logger.debug({ err: e?.message }, 'realtime publish skipped'));
}

/** Members only hear about records they own and notifications addressed to them. */
export function visibleTo(msg, c) {
  if (msg.type === 'notification') return msg.user_id === c.userId;
  if (c.role !== 'member') return true;
  return !!msg.owner_id && msg.owner_id === c.userId;
}

let subscriber = null;
function ensureSubscriber() {
  if (subscriber) return;
  subscriber = redis.duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null });
  subscriber.on('error', (e) => logger.warn({ err: e.message }, 'realtime subscriber error'));
  subscriber.psubscribe(CHANNEL_PREFIX + '*').catch((e) => logger.warn({ err: e?.message }, 'realtime subscribe failed'));
  subscriber.on('pmessage', (_pattern, channel, raw) => {
    const clients = hub.get(channel.slice(CHANNEL_PREFIX.length));
    if (!clients?.size) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const frame = `event: change\ndata: ${JSON.stringify(msg)}\n\n`;
    for (const c of clients) if (visibleTo(msg, c)) c.res.write(frame);
  });
}

export const MAX_STREAM_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 25_000;

export function openStream(req, res, maxMs = MAX_STREAM_MS) {
  ensureSubscriber();
  const { tenantId, userId, role } = req.auth;
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // tell nginx not to hold the stream back
  });
  res.flushHeaders();
  res.write(`retry: 3000\nevent: ready\ndata: {}\n\n`);

  const client = { userId, role, res };
  if (!hub.has(tenantId)) hub.set(tenantId, new Set());
  hub.get(tenantId).add(client);

  const beat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);
  // End the stream periodically so the browser reconnects with a fresh access token and the account is re-checked.
  const stop = setTimeout(() => {
    res.write('event: reconnect\ndata: {}\n\n');
    res.end();
  }, maxMs);
  const cleanup = () => {
    clearInterval(beat);
    clearTimeout(stop);
    const set = hub.get(tenantId);
    set?.delete(client);
    if (set && set.size === 0) hub.delete(tenantId);
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
}

export function connectedClients() {
  let n = 0;
  for (const s of hub.values()) n += s.size;
  return n;
}

export function closeRealtime() {
  subscriber?.disconnect();
  subscriber = null;
  for (const set of hub.values()) for (const c of set) c.res.end();
  hub.clear();
}
