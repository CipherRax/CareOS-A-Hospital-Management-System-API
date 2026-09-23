import type { QueueEntry } from '@prisma/client';
import {
  computeQueueStats,
  estimateWaitMinutes,
  peopleAhead,
  queueSortKey,
} from '../../../src/modules/queue/domain/metrics';
import type { QueueStats } from '../../../src/modules/queue/domain/metrics';

type Row = Pick<
  QueueEntry,
  'status' | 'enteredAt' | 'calledAt' | 'serviceStartedAt' | 'completedAt' | 'noShowAt'
>;

function row(over: Partial<Row> & { status: Row['status'] }): Row {
  return {
    enteredAt: new Date('2026-09-23T08:00:00Z'),
    calledAt: null,
    serviceStartedAt: null,
    completedAt: null,
    noShowAt: null,
    ...over,
  };
}

describe('queue metrics', () => {
  describe('computeQueueStats', () => {
    it('averages call-wait and service durations from timestamps', () => {
      const stats = computeQueueStats([
        row({
          status: 'COMPLETED',
          enteredAt: new Date('2026-09-23T08:00:00Z'),
          serviceStartedAt: new Date('2026-09-23T08:12:00Z'),
          completedAt: new Date('2026-09-23T08:24:00Z'),
        }),
        row({
          status: 'COMPLETED',
          enteredAt: new Date('2026-09-23T09:00:00Z'),
          serviceStartedAt: new Date('2026-09-23T09:06:00Z'),
          completedAt: new Date('2026-09-23T09:21:00Z'),
        }),
        row({ status: 'WAITING' }),
        row({ status: 'CALLED' }),
      ]);
      expect(stats.avgCallWaitMinutes).toBe(9); // (12 + 6) / 2
      expect(stats.avgServiceMinutes).toBe(13.5); // (12 + 15) / 2
      expect(stats.currentlyWaiting).toBe(2);
      expect(stats.abandonmentRate).toBe(0);
    });

    it('null summary arithmetic when no finished counterpart', () => {
      const stats = computeQueueStats([row({ status: 'WAITING' }), row({ status: 'CALLED' })]);
      expect(stats.avgCallWaitMinutes).toBeNull();
      expect(stats.avgServiceMinutes).toBeNull();
      expect(stats.abandonmentRate).toBeNull();
      expect(stats.currentlyWaiting).toBe(2);
    });

    it('computes abandonment rate across finished entries', () => {
      const stats = computeQueueStats([
        row({ status: 'COMPLETED' }),
        row({ status: 'NO_SHOW' }),
        row({ status: 'ABANDONED' }),
      ]);
      expect(stats.abandonmentRate).toBeCloseTo(2 / 3);
    });
  });

  describe('queueSortKey', () => {
    it('orders by priority rank then entry time then ticket', () => {
      const a = queueSortKey({
        operationalPriority: 'NORMAL',
        enteredAt: new Date('2026-09-23T08:00:00Z'),
        ticketNumber: 'O001',
      });
      const b = queueSortKey({
        operationalPriority: 'HIGH',
        enteredAt: new Date('2026-09-23T08:05:00Z'),
        ticketNumber: 'O002',
      });
      expect(a.localeCompare(b)).toBeGreaterThan(0); // HIGH sorts before NORMAL
    });
  });

  describe('peopleAhead', () => {
    const make = (
      id: string,
      ticketNumber: string,
      at: string,
      priority: QueueEntry['operationalPriority'],
    ): {
      id: string;
      ticketNumber: string;
      enteredAt: Date;
      operationalPriority: QueueEntry['operationalPriority'];
      status: QueueEntry['status'];
    } => ({
      id,
      ticketNumber,
      enteredAt: new Date(at),
      operationalPriority: priority,
      status: 'WAITING',
    });

    it('counts active entries that sort ahead, excluding terminal ones', () => {
      const entries = [
        make('c', 'O003', '2026-09-23T08:10:00Z', 'NORMAL'),
        make('a', 'O001', '2026-09-23T08:00:00Z', 'NORMAL'),
        make('done', 'O099', '2026-09-23T07:00:00Z', 'URGENT'),
        make('b', 'O002', '2026-09-23T08:05:00Z', 'NORMAL'),
      ];
      entries.find((e) => e.id === 'done')!.status = 'COMPLETED';
      expect(peopleAhead(entries, 'c')).toBe(2);
      expect(peopleAhead(entries, 'a')).toBe(0);
    });

    it('returns 0 for a missing target', () => {
      expect(peopleAhead([make('x', 'O001', '2026-09-23T08:00:00Z', 'NORMAL')], 'nope')).toBe(0);
    });
  });

  describe('estimateWaitMinutes', () => {
    it('derives a bandwidth around people × avg service', () => {
      const stats: Pick<QueueStats, 'avgServiceMinutes'> = { avgServiceMinutes: 10 };
      expect(estimateWaitMinutes(stats, 4)).toEqual({ minMinutes: 28, maxMinutes: 52 });
    });

    it('falls back to avgCall when no service average exists', () => {
      expect(estimateWaitMinutes({ avgServiceMinutes: null }, 2, 5)).toEqual({
        minMinutes: 7,
        maxMinutes: 13,
      });
    });

    it('is null when no timing exists at all', () => {
      expect(estimateWaitMinutes({ avgServiceMinutes: null }, 2)).toBeNull();
    });
  });
});