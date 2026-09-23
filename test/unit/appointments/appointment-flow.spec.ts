import type { AppointmentStatus } from '@prisma/client';
import { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  APPOINTMENT_TRANSITIONS,
  TERMINAL_APPOINTMENT_STATUSES,
  assertAppointmentTransition,
} from '../../../src/modules/appointments/domain/appointment-flow';

describe('appointment-flow', () => {
  describe('table reads (brief §6.4 happy path)', () => {
    it('walks BOOKED → CONFIRMED → CHECKED_IN → IN_PROGRESS → COMPLETED', () => {
      expect(APPOINTMENT_TRANSITIONS.BOOKED).toEqual(
        expect.arrayContaining(['CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW']),
      );
      expect(APPOINTMENT_TRANSITIONS.CONFIRMED).toEqual(
        expect.arrayContaining(['CHECKED_IN', 'CANCELLED', 'NO_SHOW']),
      );
      expect(APPOINTMENT_TRANSITIONS.CHECKED_IN).toEqual(
        expect.arrayContaining(['IN_PROGRESS', 'CANCELLED', 'NO_SHOW']),
      );
      expect(APPOINTMENT_TRANSITIONS.IN_PROGRESS).toEqual(['COMPLETED']);
    });

    it('terminal states have no exits', () => {
      for (const s of ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'] as const) {
        expect(APPOINTMENT_TRANSITIONS[s]).toHaveLength(0);
        expect(TERMINAL_APPOINTMENT_STATUSES.has(s)).toBe(true);
      }
    });
  });

  describe('assertAppointmentTransition', () => {
    it('allows a legal forward move', () => {
      expect(() => assertAppointmentTransition('BOOKED' as AppointmentStatus, 'CONFIRMED')).not.toThrow();
    });

    it('is a no-op for an identical status', () => {
      expect(() => assertAppointmentTransition('IN_PROGRESS', 'IN_PROGRESS')).not.toThrow();
    });

    it('rejects a backwards or skipped move', () => {
      for (const [from, to] of [
        ['CONFIRMED', 'BOOKED'],
        ['IN_PROGRESS', 'CHECKED_IN'],
        ['COMPLETED', 'IN_PROGRESS'],
        ['CANCELLED', 'CHECKED_IN'],
        ['NO_SHOW', 'CONFIRMED'],
      ] as const) {
        try {
          assertAppointmentTransition(from, to);
          throw new Error(`expected throw for ${from} → ${to}`);
        } catch (err) {
          expect(err).toBeInstanceOf(AppError);
          expect((err as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
        }
      }
    });
  });
});