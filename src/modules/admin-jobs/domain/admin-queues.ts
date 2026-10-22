import { ESCALATION_QUEUE, SCHEDULER_QUEUE } from '../../../jobs/queue-names';

/**
 * The queues an administrator can inspect (brief §5.9).
 *
 * The list is explicit rather than discovered: BullMQ has no registry of
 * queue names, and a discovery sweep over Redis would list queues this
 * deployment does not own. Adding a queue to the system means adding it here
 * as well as to `jobs/queue-names.ts`.
 */
export const ADMIN_QUEUE_NAMES = [ESCALATION_QUEUE, SCHEDULER_QUEUE] as const;

export type AdminQueueName = (typeof ADMIN_QUEUE_NAMES)[number];

export function isAdminQueueName(name: string): name is AdminQueueName {
  return (ADMIN_QUEUE_NAMES as readonly string[]).includes(name);
}
