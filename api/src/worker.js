import { Worker, Queue } from 'bullmq';
import { pool, withSystem } from './db.js';
import { logger } from './logger.js';
import { publish } from './lib/realtime.js';
import { bullConnection } from './lib/redis.js';
import { SYSTEM_QUEUE, WORKFLOW_QUEUE } from './lib/queue.js';
import { processEvent } from './workflow/engine.js';

const workflowWorker = new Worker(WORKFLOW_QUEUE, async (job) => processEvent(job.data), {
  connection: bullConnection(),
  concurrency: 5,
});
workflowWorker.on('failed', (job, err) => logger.error({ id: job?.id, err: err.message }, 'workflow job failed'));
workflowWorker.on('completed', (job) => logger.debug({ id: job.id, name: job.name }, 'workflow job done'));

// Recurring system job: notify owners about overdue tasks (once per task).
const systemQueue = new Queue(SYSTEM_QUEUE, { connection: bullConnection() });
const systemWorker = new Worker(
  SYSTEM_QUEUE,
  async (job) => {
    if (job.name === 'overdue-scan') {
      await withSystem(async (c) => {
        const r = await c.query(
          `INSERT INTO notifications (tenant_id,user_id,title,body,link,dedupe_key)
         SELECT a.tenant_id, a.owner_id, 'Task overdue', a.subject, '/tasks', 'overdue:' || a.id
         FROM activities a WHERE a.type='task' AND a.completed_at IS NULL AND a.due_at < now() AND a.owner_id IS NOT NULL
         ON CONFLICT DO NOTHING
         RETURNING tenant_id, user_id`,
        );
        if (r.rowCount) logger.info({ created: r.rowCount }, 'overdue notifications created');
        for (const row of r.rows) publish(row.tenant_id, { type: 'notification', user_id: row.user_id });
      });
    }
  },
  { connection: bullConnection() },
);
systemWorker.on('failed', (job, err) => logger.error({ name: job?.name, err: err.message }, 'system job failed'));

systemQueue
  .upsertJobScheduler('overdue-scan-schedule', { every: 30 * 60 * 1000 }, { name: 'overdue-scan' })
  .catch((e) => logger.error({ err: e.message }, 'failed to schedule overdue scan'));

logger.info('worker started: workflow-events, system-jobs');

async function shutdown() {
  logger.info('worker shutting down');
  await Promise.allSettled([workflowWorker.close(), systemWorker.close(), systemQueue.close()]);
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
