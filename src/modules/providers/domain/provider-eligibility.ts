import type { Prisma } from '@prisma/client';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Bookability for a provider. This file is the *only* definition (ADR-050).
 *
 * There is no `Provider` model: a provider is a `users` row with a role, so
 * every booking path that resolves a `providerId` can resolve a user who should
 * not be seeing patients. Before this predicate, all four booking paths checked
 * only that the id existed in the organization, so a suspended, deactivated or
 * terminated user could be booked and would still publish availability. Three
 * copies of this rule is how that happened, so the rule and the query fragment
 * that expresses it live together and are imported everywhere.
 */

/** Why a provider cannot take new work. Safe to show a caller; never a name. */
export type IneligibleReason = 'USER_NOT_ACTIVE' | 'TERMINATED' | 'UNAVAILABLE';

/**
 * A user may hold a clinician role, and the directory groups by it. It is a
 * *filter*, never a booking gate: this codebase books nurses, pharmacists and
 * clinical officers, and a role gate would refuse legitimate work while still
 * missing the real hazard — an active user who cannot see patients.
 */
export const PROVIDER_ROLE_KEYS = [
  'DOCTOR',
  'CLINICAL_OFFICER',
  'NURSE',
  'PHARMACIST',
  'LAB_TECHNICIAN',
  'RADIOLOGY_TECHNICIAN',
] as const;

export type ProviderRoleKey = (typeof PROVIDER_ROLE_KEYS)[number];

/** Employment states under which someone may still see patients. */
const BOOKABLE_EMPLOYMENT = ['ACTIVE', 'CONTRACT'] as const;

/** The subset of `User` and `StaffProfile` eligibility depends on. */
export interface EligibilityInput {
  status: string;
  staffProfile: { employmentStatus: string; availability: boolean } | null;
}

/**
 * Bookable means: the user is ACTIVE, and — where a staff profile exists — is
 * not terminated and has not opted out of taking patients.
 *
 * A *missing* staff profile is not disqualifying. Plenty of legitimate
 * providers in this schema carry only a user row, and refusing them would break
 * real bookings to fix a hazard the status check already covers.
 */
export function ineligibilityReason(input: EligibilityInput): IneligibleReason | null {
  if (input.status !== 'ACTIVE') return 'USER_NOT_ACTIVE';
  const profile = input.staffProfile;
  if (!profile) return null;
  if (!(BOOKABLE_EMPLOYMENT as readonly string[]).includes(profile.employmentStatus)) {
    return 'TERMINATED';
  }
  if (!profile.availability) return 'UNAVAILABLE';
  return null;
}

export function isBookable(input: EligibilityInput): boolean {
  return ineligibilityReason(input) === null;
}

/**
 * What counts as a *provider* for the directory's purposes: holds a clinician
 * role, or has a published availability template.
 *
 * The role test alone is not enough — a clinician who is rostered somewhere but
 * has never been given a role would vanish from the booking screen. The template
 * test alone is not enough either — a scheduled receptionist is not a provider.
 * Requiring both would hide every clinician who has not yet been scheduled.
 *
 * This is the same rule for every entry point, so `GET /providers/:id` cannot
 * return a receptionist's detail view merely because the id exists.
 */
export function providerViewWhere(organizationId: string): Prisma.UserWhereInput {
  return { OR: providerViewOr(organizationId) };
}

/** The same rule as a disjunction, for callers that AND it beside their own. */
export function providerViewOr(organizationId: string): Prisma.UserWhereInput[] {
  return [
    { userRoles: { some: { role: { key: { in: [...PROVIDER_ROLE_KEYS] } } } } },
    { providerSchedules: { some: { organizationId } } },
  ];
}

/**
 * The Prisma `where` fragment equivalent to {@link isBookable}.
 *
 * The employment/availability clauses are nested under the optional staff
 * profile so a user *without* one still matches — the same rule the function
 * above applies, expressed once in the two forms callers need. Keeping the
 * `staffProfile: { is: ... }` shape is deliberate: it is the same predicate for
 * "no profile" and "a profile that qualifies", and a `some`-style filter here
 * would silently drop profileless users.
 */
export function bookableUserWhere(): Prisma.UserWhereInput {
  return {
    status: 'ACTIVE',
    OR: [
      { staffProfile: { is: null } },
      {
        staffProfile: {
          is: {
            employmentStatus: { in: [...BOOKABLE_EMPLOYMENT] },
            availability: true,
          },
        },
      },
    ],
  };
}

/** Caller-facing wording. Names the reason, never the provider. */
const REASON_TEXT: Record<IneligibleReason, string> = {
  USER_NOT_ACTIVE: 'the provider account is not active',
  TERMINATED: 'the provider’s employment has ended',
  UNAVAILABLE: 'the provider is marked unavailable for new bookings',
};

export function notBookableError(reason: IneligibleReason): AppError {
  return new AppError({
    code: ErrorCodes.PROVIDER_NOT_BOOKABLE,
    message: `Provider cannot be booked: ${REASON_TEXT[reason]}.`,
    silent: true,
  });
}

/** The minimal shape a caller must select for {@link ineligibilityReason}. */
export const ELIGIBILITY_SELECT = {
  status: true,
  staffProfile: { select: { employmentStatus: true, availability: true } },
} as const;
