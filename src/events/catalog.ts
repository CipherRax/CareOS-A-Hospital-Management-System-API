/**
 * Typed, versioned event catalog. Every outbox consumer subscribes to these
 * exact names. Payloads carry IDs only (never PHI). Add events here before
 * emitting them; version bumps are explicit.
 */
export const EventTypes = {
  OrganizationProvisioned: 'OrganizationProvisioned',
  OutboxEventDead: 'OutboxEventDead',
  /**
   * Test/demo signal used by the Phase 0 harness (see modules/demo and
   * docs/limitations.md). Removed from the catalog before production use.
   */
  Probe: 'CareOS.Probe',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

export const EVENT_VERSION: Record<EventType, number> = {
  [EventTypes.OrganizationProvisioned]: 1,
  [EventTypes.OutboxEventDead]: 1,
  [EventTypes.Probe]: 1,
};
