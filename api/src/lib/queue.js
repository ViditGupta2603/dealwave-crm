import { Queue } from 'bullmq';
import { bullConnection } from './redis.js';
import { logger } from '../logger.js';

export const WORKFLOW_QUEUE = 'workflow-events';
export const SYSTEM_QUEUE = 'system-jobs';

let workflowQueue = null;
export function getWorkflowQueue() {
  if (!workflowQueue) {
    workflowQueue = new Queue(WORKFLOW_QUEUE, {
      connection: bullConnection(),
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 500, removeOnFail: 1000 },
    });
    workflowQueue.on('error', (e) => logger.warn({ err: e.message }, 'queue error'));
  }
  return workflowQueue;
}

/** Fire-and-forget: a queue outage must never fail the user's request. */
export async function emitEvent(ev) {
  try {
    await getWorkflowQueue().add(`${ev.entity}.${ev.event}`, ev);
  } catch (e) {
    logger.error({ err: e.message, ev: { entity: ev.entity, event: ev.event, id: ev.recordId } }, 'failed to enqueue workflow event');
  }
}
