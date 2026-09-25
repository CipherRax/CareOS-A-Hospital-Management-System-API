import type { VirtualSessionStatus } from '@prisma/client';
import { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  VIRTUAL_SESSION_TRANSITIONS,
  assertTransition,
  canStart,
} from '../../../src/modules/telemedicine/domain/virtual-session-flow';

describe('virtual session flow', () => {
  const statuses: VirtualSessionStatus[] = [
    'SCHEDULED',
    'STARTED',
    'ENDED',
    'CANCELLED',
    'NO_SHOW',
  ];

  it('allows every legal transition', () => {
    for (const [from, targets] of Object.entries(VIRTUAL_SESSION_TRANSITIONS)) {
      for (const to of targets) {
        expect(() => assertTransition(from as VirtualSessionStatus, to)).not.toThrow();
      }
    }
  });

  it('rejects every illegal transition', () => {
    for (const from of statuses) {
      for (const to of statuses) {
        if (VIRTUAL_SESSION_TRANSITIONS[from].includes(to)) continue;
        try {
          assertTransition(from, to);
          throw new Error(`expected ${from} to ${to} to be rejected`);
        } catch (error) {
          expect(error).toBeInstanceOf(AppError);
          expect((error as AppError).code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
        }
      }
    }
  });

  it('requires recorded consent to start a scheduled session', () => {
    const now = new Date('2026-01-01T12:00:00.000Z');
    expect(
      canStart({
        status: 'SCHEDULED',
        consentRecorded: true,
        scheduledStartAt: new Date('2026-01-01T13:00:00.000Z'),
        now,
      }),
    ).toBe(true);
    expect(
      canStart({
        status: 'SCHEDULED',
        consentRecorded: false,
        scheduledStartAt: new Date('2026-01-01T13:00:00.000Z'),
        now,
      }),
    ).toBe(false);
  });

  it('does not start a session in a non-scheduled state', () => {
    expect(
      canStart({
        status: 'ENDED',
        consentRecorded: true,
        scheduledStartAt: new Date('2026-01-01T13:00:00.000Z'),
        now: new Date('2026-01-01T12:00:00.000Z'),
      }),
    ).toBe(false);
  });
});
