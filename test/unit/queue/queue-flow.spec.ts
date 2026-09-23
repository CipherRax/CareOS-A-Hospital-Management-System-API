import type { QueueStatus } from '@prisma/client';
import { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  ACTIVE_QUEUE_STATUSES,
  QUEUE_TRANSITIONS,
  VISIT_TRANSITIONS,
  assertQueueTransition,
  assertVisitTransition,
} from '../../../src/modules/queue/domain/queue-flow';

describe('queue-flow', () => {
  describe('QUEUE_TRANSITIONS', () => {
    it('walks WAITING → CALLED → IN_SERVICE → COMPLETED', () => {
      expect(QUEUE_TRANSITIONS.WAITING).toEqual(
        expect.arrayContaining(['CALLED', 'NO_SHOW', 'ABANDONED', 'CANCELLED', 'TRANSFERRED']),
      );
      expect(QUEUE_TRANSITIONS.CALLED).toEqual(
        expect.arrayContaining(['IN_SERVICE', 'WAITING', 'NO_SHOW', 'CANCELLED', 'TRANSFERRED']),
      );
      expect(QUEUE_TRANSITIONS.IN_SERVICE).toEqual(['COMPLETED', 'CANCELLED', 'TRANSFERRED']);
    });

    it('terminal statuses have no exits', () => {
      for (const s of ['COMPLETED', 'NO_SHOW', 'ABANDONED', 'CANCELLED', 'TRANSFERRED'] as const) {
        expect(QUEUE_TRANSITIONS[s]).toHaveLength(0);
      }
    });

    it('ACTIVE_QUEUE_STATUSES are WAITING/CALLED/IN_SERVICE', () => {
      expect(ACTIVE_QUEUE_STATUSES).toEqual(new Set(['WAITING', 'CALLED', 'IN_SERVICE']));
    });
  });

  describe('assertQueueTransition', () => {
    it('allows legal moves and identical status', () => {
      expect(() => assertQueueTransition('WAITING', 'CALLED')).not.toThrow();
      expect(() => assertQueueTransition('IN_SERVICE', 'IN_SERVICE')).not.toThrow();
    });

    it('rejects illegal moves', () => {
      const cases: Array<[QueueStatus, QueueStatus]> = [
        ['WAITING', 'IN_SERVICE'],
        ['CALLED', 'COMPLETED'],
        ['COMPLETED', 'WAITING'],
        ['WAITING', 'COMPLETED'],
      ];
      for (const [from, to] of cases) {
        try {
          assertQueueTransition(from, to);
          throw new Error(`expected throw for ${from} → ${to}`);
        } catch (err) {
          expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
        }
      }
    });
  });

  describe('VISIT_TRANSITIONS', () => {
    it('supports the reception→triage→provider→completion spine', () => {
      expect(VISIT_TRANSITIONS.REGISTERED).toContain('CHECKED_IN');
      expect(VISIT_TRANSITIONS.CHECKED_IN).toEqual(
        expect.arrayContaining(['WAITING', 'TRIAGE', 'WAITING_FOR_PROVIDER', 'CONSULTATION']),
      );
      expect(VISIT_TRANSITIONS.WAITING_FOR_PROVIDER).toEqual(
        expect.arrayContaining(['CONSULTATION', 'LAB', 'RADIOLOGY', 'PHARMACY', 'BILLING', 'COMPLETED']),
      );
      expect(VISIT_TRANSITIONS.COMPLETED).toHaveLength(0);
    });

    it('leaves REGISTERED unable to jump straight to CONSULTATION', () => {
      expect(() => assertVisitTransition('REGISTERED', 'CONSULTATION')).toThrow(AppError);
    });

    it('accepts same-status', () => {
      expect(() => assertVisitTransition('TRIAGE', 'TRIAGE')).not.toThrow();
    });
  });
});