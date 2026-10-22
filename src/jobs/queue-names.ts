/**
 * The names of the platform's own BullMQ queues.
 *
 * They live here rather than in the owning modules so that a second surface —
 * the admin job inspector (brief §5.9) — can name the same queues without
 * duplicating the strings. A queue that exists in Redis but not in this file
 * is one an administrator cannot inspect, so adding a queue to the system means
 * adding it here as well.
 */
export const ESCALATION_QUEUE = 'emergency-escalation';
export const SCHEDULER_QUEUE = 'scheduler';
