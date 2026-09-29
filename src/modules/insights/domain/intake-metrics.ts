/**
 * Pure metric math for public emergency-intake requests (brief §7.2, patch P9).
 *
 * Kept out of the service so the arithmetic is unit-testable and so the
 * reasoning behind the filters is written down next to the code that depends
 * on it. Nothing here reads a database or knows about Prisma.
 */

/** The subset of an EmergencyRequest row the metrics actually need. */
export interface IntakeRequestSample {
  branchId: string;
  createdAt: Date;
  acknowledgedAt: Date | null;
  respondedAt: Date | null;
  closedAt: Date | null;
  cancelledAt: Date | null;
  escalationLevel: number;
}

/**
 * Latency distribution. A mean is the wrong summary for emergency response: one
 * request left unacknowledged for two hours moves a 20-request average by six
 * minutes while being the entire reason the metric exists. Percentiles keep the
 * tail visible, and `max` keeps it unmissable.
 */
export interface LatencyDistribution {
  samples: number;
  /** Median, rounded to whole minutes. */
  p50Minutes: number | null;
  /**
   * 90th percentile, rounded to whole minutes. Note that on a small sample a
   * nearest-rank p90 will not reach a lone outlier — with 20 samples, p90 is the
   * 18th smallest. `maxMinutes` is what keeps the tail unmissable; neither number
   * alone is honest about a small window.
   */
  p90Minutes: number | null;
  /** Worst observed latency, rounded to whole minutes. */
  maxMinutes: number | null;
}

export interface IntakeRequestMetrics {
  received: number;
  acknowledged: number;
  dispatched: number;
  closed: number;
  cancelled: number;
  escalated: number;
  acknowledgementRate: number | null;
  escalationRate: number | null;
  timeToAcknowledge: LatencyDistribution;
  timeToDispatch: LatencyDistribution;
  /** Acknowledgement → first responder, excluding the receive→acknowledge leg. */
  ackToDispatch: LatencyDistribution;
  byEscalationLevel: Array<{ level: number; count: number }>;
  byBranch: Array<{ branchId: string; received: number; escalated: number }>;
}

/**
 * Percentile over an unsorted sample. `p` is 0..1.
 *
 * Nearest-rank, no interpolation. Two consequences worth knowing rather than
 * discovering: on an even-sized sample p50 is the *lower* middle value (not the
 * mean of the two middles), and on a small sample p90 will not reach a lone
 * outlier. Both are the point — a percentile here always names a latency that
 * actually occurred, never an interpolated figure between two observations.
 */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(p * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? null;
}

export function distribution(minutes: number[]): LatencyDistribution {
  if (minutes.length === 0) {
    return { samples: 0, p50Minutes: null, p90Minutes: null, maxMinutes: null };
  }
  const sorted = [...minutes].sort((a, b) => a - b);
  const round = (n: number | null): number | null => (n === null ? null : Math.round(n));
  return {
    samples: sorted.length,
    p50Minutes: round(percentile(sorted, 0.5)),
    p90Minutes: round(percentile(sorted, 0.9)),
    maxMinutes: round(sorted[sorted.length - 1] ?? null),
  };
}

/**
 * Minutes from `start` to `end`, or null when the interval is unusable.
 *
 * A null `end` means the leg never happened and is not a zero. A negative
 * interval means the two timestamps disagree — clock skew between an app node
 * and the database, or a backfill that inverted the pair. Either way it is
 * dropped rather than folded in: one negative sample would drag a mean toward
 * zero and make a response-time metric look better than reality, which is the
 * dangerous direction to be wrong in.
 */
export function minutesBetween(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const minutes = (end.getTime() - start.getTime()) / 60000;
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  return minutes;
}

/**
 * Aggregates windowed intake requests.
 *
 * Cancelled requests need no special handling, and that is worth stating
 * because it is not obvious: `cancelPublic` refuses to cancel a `RESPONDING`
 * request ("a responder is already on the way"), so a cancelled row can never
 * carry a `respondedAt`. Cancellation therefore drops out of dispatch latency
 * for free — not by filtering, but because the state the service forbids
 * cannot exist. The only samples that reach `timeToDispatch` are requests a
 * responder actually left for, which is exactly the population the metric is
 * about.
 *
 * A never-responded request contributes no dispatch sample. Treating it as zero
 * (or excluding it silently) would both misstate the distribution, which is why
 * `samples` is published next to every percentile rather than assumed.
 */
export function intakeRequestMetrics(
  samples: IntakeRequestSample[],
  rateOf: (part: number, whole: number) => number | null,
): IntakeRequestMetrics {
  const ackMinutes: number[] = [];
  const dispatchMinutes: number[] = [];
  const ackToDispatchMinutes: number[] = [];
  const levelCounts = new Map<number, number>();
  const branchCounts = new Map<string, { received: number; escalated: number }>();

  let acknowledged = 0;
  let dispatched = 0;
  let closed = 0;
  let cancelled = 0;
  let escalated = 0;

  for (const row of samples) {
    if (row.cancelledAt) cancelled += 1;
    if (row.closedAt) closed += 1;
    if (row.acknowledgedAt) acknowledged += 1;
    if (row.escalationLevel > 0) {
      escalated += 1;
      levelCounts.set(row.escalationLevel, (levelCounts.get(row.escalationLevel) ?? 0) + 1);
    }

    const branch = branchCounts.get(row.branchId) ?? { received: 0, escalated: 0 };
    branch.received += 1;
    if (row.escalationLevel > 0) branch.escalated += 1;
    branchCounts.set(row.branchId, branch);

    const toAck = minutesBetween(row.createdAt, row.acknowledgedAt);
    if (toAck !== null) ackMinutes.push(toAck);

    if (row.respondedAt) {
      dispatched += 1;
      const toDispatch = minutesBetween(row.createdAt, row.respondedAt);
      if (toDispatch !== null) dispatchMinutes.push(toDispatch);
      const toRespond = minutesBetween(row.acknowledgedAt, row.respondedAt);
      if (toRespond !== null) ackToDispatchMinutes.push(toRespond);
    }
  }

  return {
    received: samples.length,
    acknowledged,
    dispatched,
    closed,
    cancelled,
    escalated,
    acknowledgementRate: rateOf(acknowledged, samples.length),
    escalationRate: rateOf(escalated, samples.length),
    timeToAcknowledge: distribution(ackMinutes),
    timeToDispatch: distribution(dispatchMinutes),
    ackToDispatch: distribution(ackToDispatchMinutes),
    byEscalationLevel: [...levelCounts.entries()]
      .map(([level, count]) => ({ level, count }))
      .sort((a, b) => a.level - b.level),
    byBranch: [...branchCounts.entries()]
      .map(([branchId, counts]) => ({ branchId, ...counts }))
      .sort((a, b) => a.branchId.localeCompare(b.branchId)),
  };
}

/**
 * Point-in-time safety counters: what is *outstanding right now*, as opposed to
 * what happened in the window. This is the block an on-call lead reads at 3am,
 * and it is the one a windowed average can never substitute for — a service with
 * excellent historical latency and one request stuck unacknowledged right now is
 * still an emergency.
 */
export interface IntakeOutstanding {
  /** Open, never acknowledged, not cancelled or closed. */
  unacknowledgedNow: number;
  /** Acknowledged but no responder has taken it yet. */
  awaitingDispatchNow: number;
  /** Unacknowledged past the branch's first escalation level — the loud one. */
  unacknowledgedPastSlaNow: number;
  /** Open requests, whatever their stage. */
  openNow: number;
}

const OPEN_STATUSES: ReadonlySet<string> = new Set([
  'RECEIVED',
  'ACKNOWLEDGED',
  'RESPONDING',
  'ESCALATED',
]);

export function outstanding(
  rows: Array<{
    status: string;
    createdAt: Date;
    acknowledgedAt: Date | null;
    respondedAt: Date | null;
    /** The branch's first escalation level in seconds, or null if unknown. */
    firstLevelSeconds: number | null;
  }>,
  now: Date,
): IntakeOutstanding {
  let unacknowledgedNow = 0;
  let awaitingDispatchNow = 0;
  let unacknowledgedPastSlaNow = 0;
  let openNow = 0;

  for (const row of rows) {
    // A request is outstanding only while it is genuinely open: a cancelled or
    // closed request is finished business, and a retained one has been
    // anonymised out of the active picture.
    if (!OPEN_STATUSES.has(row.status)) continue;
    openNow += 1;
    if (row.respondedAt) continue;

    if (row.acknowledgedAt) {
      awaitingDispatchNow += 1;
      continue;
    }

    unacknowledgedNow += 1;
    const level = row.firstLevelSeconds;
    if (level === null) continue;
    if ((now.getTime() - row.createdAt.getTime()) / 1000 >= level) {
      unacknowledgedPastSlaNow += 1;
    }
  }

  return { unacknowledgedNow, awaitingDispatchNow, unacknowledgedPastSlaNow, openNow };
}
