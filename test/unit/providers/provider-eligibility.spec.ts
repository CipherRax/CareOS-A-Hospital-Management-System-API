import {
  bookableUserWhere,
  ineligibilityReason,
  isBookable,
  notBookableError,
  PROVIDER_ROLE_KEYS,
} from '../../../src/modules/providers/domain/provider-eligibility';
import { ErrorCodes } from '../../../src/common/errors/codes';
import { HttpStatus } from '@nestjs/common';

/**
 * The bookability predicate is the one place that decides whether work may be
 * assigned to someone (ADR-050), so it is tested as a pure function. Every reason
 * has to be distinguishable, because the message is what tells an administrator
 * which half of the system to go and fix.
 */
describe('provider eligibility', () => {
  const profile = (over: Record<string, unknown> = {}) => ({
    employmentStatus: 'ACTIVE',
    availability: true,
    ...over,
  });

  it('accepts an active, employed, available clinician', () => {
    expect(ineligibilityReason({ status: 'ACTIVE', staffProfile: profile() })).toBeNull();
    expect(isBookable({ status: 'ACTIVE', staffProfile: profile() })).toBe(true);
  });

  it('accepts a user with no staff profile', () => {
    // Plenty of legitimate providers in this schema carry only a user row, and
    // refusing them would break real bookings to fix a hazard the status check
    // already covers.
    expect(ineligibilityReason({ status: 'ACTIVE', staffProfile: null })).toBeNull();
  });

  it('accepts a contract clinician, who is employed but not permanent', () => {
    expect(
      ineligibilityReason({
        status: 'ACTIVE',
        staffProfile: profile({ employmentStatus: 'CONTRACT' }),
      }),
    ).toBeNull();
  });

  it.each(['INVITED', 'SUSPENDED', 'DISABLED', 'DEACTIVATED'])(
    'reports a %s user as USER_NOT_ACTIVE',
    (status) => {
      expect(ineligibilityReason({ status, staffProfile: profile() })).toBe(
        'USER_NOT_ACTIVE',
      );
    },
  );

  it.each(['TERMINATED', 'ON_LEAVE'])(
    'reports %s employment as TERMINATED, since neither can see patients',
    (employmentStatus) => {
      // Both collapse to one reason: the remedy is the same — end or reinstate
      // the appointment — so splitting them would only add a code to translate.
      expect(
        ineligibilityReason({
          status: 'ACTIVE',
          staffProfile: profile({ employmentStatus }),
        }),
      ).toBe('TERMINATED');
    },
  );

  it('reports an unavailable clinician as UNAVAILABLE', () => {
    expect(
      ineligibilityReason({
        status: 'ACTIVE',
        staffProfile: profile({ availability: false }),
      }),
    ).toBe('UNAVAILABLE');
  });

  it('treats a missing employment status as not bookable', () => {
    // A profile that exists but never had an employment status recorded is not
    // a licence to book, and must not fall through as bookable.
    expect(
      ineligibilityReason({
        status: 'ACTIVE',
        staffProfile: { employmentStatus: null as unknown as string, availability: true },
      }),
    ).toBe('TERMINATED');
  });

  it('checks the account before the employment record', () => {
    // Both gates are open when an account is suspended *and* a clinician is
    // terminated. The account is reported because that is the outer gate an
    // administrator sees first; fixing employment alone would not restore
    // booking, and the directory's bookable flag stays false either way.
    expect(
      ineligibilityReason({
        status: 'SUSPENDED',
        staffProfile: profile({ employmentStatus: 'TERMINATED' }),
      }),
    ).toBe('USER_NOT_ACTIVE');
  });

  it('reports employment before the availability opt-out', () => {
    // A clinician who is leaving and has already closed their calendar has one
    // root problem; telling them to flip `availability` invites a pointless fix.
    expect(
      ineligibilityReason({
        status: 'ACTIVE',
        staffProfile: profile({ employmentStatus: 'TERMINATED', availability: false }),
      }),
    ).toBe('TERMINATED');
  });

  it('builds a silent 409 that names the reason and never the provider', () => {
    const err = notBookableError('TERMINATED');
    expect(err.httpStatus).toBe(HttpStatus.CONFLICT);
    expect(err.code).toBe(ErrorCodes.PROVIDER_NOT_BOOKABLE);
    expect(err.message).toMatch(/employment has ended/i);
    // `silent` keeps the reason out of logs; the response still carries it.
    expect(err.silent).toBe(true);
  });

  it('shares one role list with the rest of the system', () => {
    // Booking must not depend on a role list that drifted from the directory's.
    expect(PROVIDER_ROLE_KEYS).toContain('DOCTOR');
    expect(PROVIDER_ROLE_KEYS).toContain('NURSE');
    expect(PROVIDER_ROLE_KEYS).not.toContain('PATIENT');
    expect(PROVIDER_ROLE_KEYS).not.toContain('RECEPTIONIST');
  });

  it('expresses the same rule as a Prisma filter, including profileless users', () => {
    const where = bookableUserWhere();
    expect(where.status).toBe('ACTIVE');
    // The predicate's employment states and the filter's must not drift: one is
    // checked in memory, the other in SQL, and a divergence books the wrong
    // people depending on which code path ran.
    const serialised = JSON.stringify(where);
    expect(serialised).toContain('CONTRACT');
    expect(serialised).toContain('availability');
    // A user with no staff profile must still match, or the directory silently
    // hides every provider whose staff record was never completed.
    expect(serialised).toContain('"is":null');
  });
});
