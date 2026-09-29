import {
  distribution,
  intakeRequestMetrics,
  minutesBetween,
  outstanding,
  percentile,
  type IntakeRequestSample,
} from '../../../src/modules/insights/domain/intake-metrics';

/** Same rounding as rollup-cells.rateOf, so the service's injected fn is honest. */
const rateOf = (part: number, whole: number): number | null =>
  whole <= 0 ? null : Math.round((part / whole) * 1000) / 10;

const at = (iso: string): Date => new Date(iso);

function sample(over: Partial<IntakeRequestSample> = {}): IntakeRequestSample {
  return {
    branchId: 'branch-a',
    createdAt: at('2026-03-01T10:00:00Z'),
    acknowledgedAt: null,
    respondedAt: null,
    closedAt: null,
    cancelledAt: null,
    escalationLevel: 0,
    ...over,
  };
}

describe('emergency intake request metrics', () => {
  describe('percentile', () => {
    it('returns null for an empty sample', () => {
      expect(percentile([], 0.5)).toBeNull();
    });

    it('uses nearest-rank rather than interpolating', () => {
      const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(percentile(sorted, 0.5)).toBe(5);
      expect(percentile(sorted, 0.9)).toBe(9);
    });

    it('handles a single sample', () => {
      expect(percentile([42], 0.5)).toBe(42);
      expect(percentile([42], 0.9)).toBe(42);
    });
  });

  describe('distribution', () => {
    it('reports an empty shape when there are no samples', () => {
      expect(distribution([])).toEqual({
        samples: 0,
        p50Minutes: null,
        p90Minutes: null,
        maxMinutes: null,
      });
    });

    it('keeps the tail visible instead of absorbing it in a mean', () => {
      // The scenario the whole shape exists for: nineteen good responses and one
      // that never got answered for six hours. A mean would call this 19 minutes.
      const minutes = [...Array(19).fill(1), 360];
      const d = distribution(minutes);
      expect(d.samples).toBe(20);
      expect(d.p50Minutes).toBe(1);
      // p50 and p90 both sit in the bulk; max is what carries the outlier. This
      // is why max is published rather than left to a reader's imagination.
      expect(d.p90Minutes).toBe(1);
      expect(d.maxMinutes).toBe(360);
    });

    it('places p90 in the tail once enough of the sample is slow', () => {
      // 15 of 100 requests took ten minutes. Nearest-rank p90 is the 90th
      // smallest, so the tail has to be worse than 1-in-10 before p90 reaches it
      // — which is exactly why `max` is reported alongside it.
      const minutes = [...Array(85).fill(1), ...Array(15).fill(600)];
      const d = distribution(minutes);
      expect(d.p50Minutes).toBe(1);
      expect(d.p90Minutes).toBe(600);
      expect(d.maxMinutes).toBe(600);
    });

    it('keeps p90 in the bulk when only a tenth of the sample is slow', () => {
      // The boundary case, and a real trap for anyone reading p90 as a worst
      // case. 10 of 100 slow: p90 is still 1, only max reveals the problem.
      const minutes = [...Array(90).fill(1), ...Array(10).fill(600)];
      const d = distribution(minutes);
      expect(d.p90Minutes).toBe(1);
      expect(d.maxMinutes).toBe(600);
    });
  });

  describe('minutesBetween', () => {
    it('measures the interval', () => {
      expect(minutesBetween(at('2026-03-01T10:00:00Z'), at('2026-03-01T10:04:00Z'))).toBe(4);
    });

    it('returns null when the second leg never happened', () => {
      // Null end is "did not happen", not "took zero minutes".
      expect(minutesBetween(at('2026-03-01T10:00:00Z'), null)).toBeNull();
    });

    it('drops an inverted interval rather than folding in a negative', () => {
      // Clock skew or a bad backfill. Folding this in would drag a mean toward
      // zero and make response time look better than it was.
      expect(minutesBetween(at('2026-03-01T10:05:00Z'), at('2026-03-01T10:00:00Z'))).toBeNull();
    });
  });

  describe('intakeRequestMetrics', () => {
    it('counts the window funnel', () => {
      const metrics = intakeRequestMetrics(
        [
          sample({ acknowledgedAt: at('2026-03-01T10:01:00Z'), respondedAt: at('2026-03-01T10:06:00Z'), closedAt: at('2026-03-01T11:00:00Z') }),
          sample({ acknowledgedAt: at('2026-03-01T10:02:00Z'), escalationLevel: 1 }),
          sample({ cancelledAt: at('2026-03-01T10:00:30Z') }),
          sample({}),
        ],
        rateOf,
      );

      expect(metrics.received).toBe(4);
      expect(metrics.acknowledged).toBe(2);
      expect(metrics.dispatched).toBe(1);
      expect(metrics.closed).toBe(1);
      expect(metrics.cancelled).toBe(1);
      expect(metrics.escalated).toBe(1);
      expect(metrics.acknowledgementRate).toBe(50);
      expect(metrics.escalationRate).toBe(25);
    });

    it('splits the dispatch leg from the acknowledge-to-respond leg', () => {
      // Received 10:00, acknowledged 10:04, responder left 10:10. The service
      // dispatch target is 6 minutes end to end, but only 6 of those minutes
      // were the dispatcher's.
      const metrics = intakeRequestMetrics(
        [sample({ acknowledgedAt: at('2026-03-01T10:04:00Z'), respondedAt: at('2026-03-01T10:10:00Z') })],
        rateOf,
      );
      expect(metrics.timeToDispatch.p50Minutes).toBe(10);
      expect(metrics.ackToDispatch.p50Minutes).toBe(6);
    });

    it('excludes a cancelled request from dispatch latency but still counts it', () => {
      // A cancelled request has no respondedAt: cancelPublic refuses to cancel
      // once a request is RESPONDING, so the two states cannot coexist. This test
      // pins that real shape and the consequence for the metric.
      const metrics = intakeRequestMetrics(
        [sample({ cancelledAt: at('2026-03-01T10:00:30Z') }), sample({ respondedAt: at('2026-03-01T10:08:00Z') })],
        rateOf,
      );
      expect(metrics.cancelled).toBe(1);
      expect(metrics.received).toBe(2);
      expect(metrics.dispatched).toBe(1);
      // The cancelled request contributes no dispatch sample, so it cannot pull
      // the latency down using a request where nothing went wrong.
      expect(metrics.timeToDispatch.samples).toBe(1);
      expect(metrics.timeToDispatch.p50Minutes).toBe(8);
    });

    it('excludes a never-responded request from dispatch latency', () => {
      const metrics = intakeRequestMetrics([sample({}), sample({ respondedAt: at('2026-03-01T10:08:00Z') })], rateOf);
      expect(metrics.dispatched).toBe(1);
      // Samples is published next to the percentiles precisely so a reader can
      // see that a never-responded request is absent, not zero.
      expect(metrics.timeToDispatch.samples).toBe(1);
    });

    it('reports nulls rather than zeros for an empty window', () => {
      const metrics = intakeRequestMetrics([], rateOf);
      expect(metrics.received).toBe(0);
      expect(metrics.acknowledgementRate).toBeNull();
      expect(metrics.escalationRate).toBeNull();
      expect(metrics.timeToAcknowledge.p50Minutes).toBeNull();
      expect(metrics.byBranch).toEqual([]);
      expect(metrics.byEscalationLevel).toEqual([]);
    });

    it('breaks escalation out by level, ascending', () => {
      const metrics = intakeRequestMetrics(
        [
          sample({ escalationLevel: 2 }),
          sample({ escalationLevel: 1 }),
          sample({ escalationLevel: 2 }),
          sample({ escalationLevel: 0 }),
        ],
        rateOf,
      );
      expect(metrics.byEscalationLevel).toEqual([
        { level: 1, count: 1 },
        { level: 2, count: 2 },
      ]);
    });

    it('breaks out by branch, sorted, so output is deterministic', () => {
      const metrics = intakeRequestMetrics(
        [
          sample({ branchId: 'branch-c' }),
          sample({ branchId: 'branch-a', escalationLevel: 1 }),
          sample({ branchId: 'branch-a' }),
          sample({ branchId: 'branch-b' }),
        ],
        rateOf,
      );
      expect(metrics.byBranch).toEqual([
        { branchId: 'branch-a', received: 2, escalated: 1 },
        { branchId: 'branch-b', received: 1, escalated: 0 },
        { branchId: 'branch-c', received: 1, escalated: 0 },
      ]);
    });

    it('ignores an inverted timestamp pair in the latency sample', () => {
      const metrics = intakeRequestMetrics(
        [sample({ acknowledgedAt: at('2026-03-01T09:00:00Z') })],
        rateOf,
      );
      // Still counted as acknowledged...
      expect(metrics.acknowledged).toBe(1);
      // ...but contributes no latency sample, so it cannot poison the average.
      expect(metrics.timeToAcknowledge.samples).toBe(0);
    });
  });

  describe('outstanding', () => {
    const now = at('2026-03-01T12:00:00Z');
    const row = (over: Partial<Parameters<typeof outstanding>[0][number]> = {}) => ({
      status: 'RECEIVED',
      createdAt: at('2026-03-01T11:59:00Z'),
      acknowledgedAt: null,
      respondedAt: null,
      firstLevelSeconds: 120,
      ...over,
    });

    it('counts an unacknowledged open request still inside the SLA', () => {
      // 2 minute SLA, created 1 minute ago: outstanding, not yet late.
      const result = outstanding([row()], now);
      expect(result.openNow).toBe(1);
      expect(result.unacknowledgedNow).toBe(1);
      expect(result.unacknowledgedPastSlaNow).toBe(0);
    });

    it('treats the SLA boundary as already late', () => {
      // Exactly at the level is not "about to be" — the escalation job would
      // already have fired.
      const result = outstanding([row({ createdAt: at('2026-03-01T11:58:00Z') })], now);
      expect(result.unacknowledgedPastSlaNow).toBe(1);
    });

    it('flags a request unacknowledged past the branch SLA', () => {
      // 2 minute SLA, created 10 minutes ago. This is the number an on-call
      // lead acts on, and it cannot be derived from a windowed average.
      const result = outstanding([row({ createdAt: at('2026-03-01T11:50:00Z') })], now);
      expect(result.unacknowledgedPastSlaNow).toBe(1);
    });

    it('does not count an acknowledged request as unacknowledged', () => {
      const result = outstanding([row({ status: 'ACKNOWLEDGED', acknowledgedAt: at('2026-03-01T11:59:00Z') })], now);
      expect(result.unacknowledgedNow).toBe(0);
      expect(result.awaitingDispatchNow).toBe(1);
      expect(result.openNow).toBe(1);
    });

    it('treats a dispatched request as no longer outstanding', () => {
      const result = outstanding(
        [row({ status: 'RESPONDING', acknowledgedAt: at('2026-03-01T11:59:00Z'), respondedAt: at('2026-03-01T11:59:30Z') })],
        now,
      );
      expect(result.openNow).toBe(1);
      expect(result.unacknowledgedNow).toBe(0);
      expect(result.awaitingDispatchNow).toBe(0);
    });

    it('excludes finished requests', () => {
      const result = outstanding(
        [
          row({ status: 'CLOSED' }),
          row({ status: 'CANCELLED' }),
          row({ status: 'RETAINED' }),
          row({ status: 'ESCALATED' }),
        ],
        now,
      );
      // Only ESCALATED is still open; a closed, cancelled, or P4-retained
      // request is finished business and must not be reported as outstanding.
      expect(result.openNow).toBe(1);
    });

    it('skips the SLA test when the branch policy is unknown', () => {
      // Better to under-report "past SLA" than to invent a threshold.
      const result = outstanding([row({ createdAt: at('2026-03-01T11:00:00Z'), firstLevelSeconds: null })], now);
      expect(result.unacknowledgedNow).toBe(1);
      expect(result.unacknowledgedPastSlaNow).toBe(0);
    });

    it('reports zeros for an empty queue', () => {
      expect(outstanding([], now)).toEqual({
        unacknowledgedNow: 0,
        awaitingDispatchNow: 0,
        unacknowledgedPastSlaNow: 0,
        openNow: 0,
      });
    });
  });
});
