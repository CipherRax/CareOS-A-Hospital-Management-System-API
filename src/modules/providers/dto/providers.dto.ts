import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PROVIDER_ROLE_KEYS } from '../domain/provider-eligibility';

const uuid = z.string().uuid();

/** Minutes-since-midnight bounds, matching `ProviderSchedule`. */
const minuteOfDay = z
  .number()
  .int()
  .min(0)
  .max(24 * 60);

export class ListProvidersQueryDto extends createZodDto(
  z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().optional(),
    /** Free-text over name, staff number, professional title, specialization. */
    q: z.string().trim().min(1).max(120).optional(),
    branchId: uuid.optional(),
    departmentId: uuid.optional(),
    /** Matches `StaffProfile.specialization`. */
    specialization: z.string().trim().min(1).max(120).optional(),
    /**
     * Restrict to a provider role. A filter, not a booking rule — see ADR-050.
     */
    roleKey: z.enum(PROVIDER_ROLE_KEYS).optional(),
    /**
     * Defaults to true. A caller explicitly asking for `bookableOnly=false`
     * still gets only providers who exist; it is not a way to see non-staff
     * users, because the directory is always a provider view.
     */
    bookableOnly: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
  }),
) {}

/**
 * One recurring weekly availability window, seeded at onboarding.
 *
 * Mirrors `ProviderSchedule`, including the 0=Monday convention rather than
 * JavaScript's `getDay()` — a mismatch here is an off-by-three-days bug that
 * only shows up once someone is already booked wrongly.
 */
export const availabilityWindowSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startMinutes: minuteOfDay,
    endMinutes: minuteOfDay,
    slotDurationMinutes: z.number().int().min(5).max(480),
    capacity: z.number().int().min(1).max(100).default(1),
    branchId: uuid,
    departmentId: uuid,
  })
  .refine((w) => w.endMinutes > w.startMinutes, {
    message: 'endMinutes must be after startMinutes',
    path: ['endMinutes'],
  })
  .refine((w) => w.startMinutes % w.slotDurationMinutes === 0, {
    message: 'startMinutes must fall on a slot boundary',
    path: ['startMinutes'],
  });

export class OnboardProviderDto extends createZodDto(
  z.object({
    email: z.string().email().max(200),
    firstName: z.string().trim().min(1).max(120),
    lastName: z.string().trim().min(1).max(120),
    otherNames: z.string().trim().max(120).optional(),
    phone: z.string().trim().min(5).max(40).optional(),

    staffNumber: z.string().trim().min(1).max(60),
    professionalTitle: z.string().trim().max(120).optional(),
    specialization: z.string().trim().max(120).optional(),
    licenseNumber: z.string().trim().max(120).optional(),

    /** At least one, so a provider is never onboarded with nothing to do. */
    roleKeys: z.array(z.enum(PROVIDER_ROLE_KEYS)).min(1).max(4),
    /**
     * At least one of each, and required. Bookings are scoped to a branch and a
     * department, so a provider assigned to neither cannot be offered a slot and
     * would be invisible in every branch's booking screen — onboarded but
     * unusable. There is deliberately no `.default([])` here: Zod validates the
     * default against the inner schema, so it would be rejected anyway, and
     * leaving it in place would suggest the field is optional.
     */
    branchIds: z.array(uuid).min(1).max(50),
    departmentIds: z.array(uuid).min(1).max(50),

    /**
     * Optional seed availability. Omitting it is legitimate — onboarding and
     * scheduling are separate concerns — but the provider then has no slots
     * until someone publishes a template.
     */
    availability: z.array(availabilityWindowSchema).max(60).default([]),
  }),
) {}

/** Empty by design: a provider with no assignable field has nothing to patch. */
export class UpdateProviderDto extends createZodDto(
  z
    .object({
      firstName: z.string().trim().min(1).max(120).optional(),
      lastName: z.string().trim().min(1).max(120).optional(),
      otherNames: z.string().trim().max(120).optional(),
      phone: z.string().trim().min(5).max(40).optional(),
      professionalTitle: z.string().trim().max(120).optional(),
      specialization: z.string().trim().max(120).optional(),
      licenseNumber: z.string().trim().max(120).optional(),
      employmentStatus: z
        .enum(['ACTIVE', 'ON_LEAVE', 'TERMINATED', 'CONTRACT'])
        .optional(),
      /** A clinician can opt out of new bookings without being terminated. */
      availability: z.boolean().optional(),
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' }),
) {}
