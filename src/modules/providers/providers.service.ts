import { Injectable } from '@nestjs/common';
import type { EmploymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { generateHashedToken } from '../../common/security/token';
import { paginate, pageOf, type PageResult } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { EventTypes } from '../../events/catalog';
import { ErrorCodes } from '../../common/errors/codes';
import {
  bookableUserWhere,
  ELIGIBILITY_SELECT,
  ineligibilityReason,
  providerViewOr,
  providerViewWhere,
  type IneligibleReason,
} from './domain/provider-eligibility';
import type {
  ListProvidersQueryDto,
  OnboardProviderDto,
  UpdateProviderDto,
} from './dto/providers.dto';

const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

/** The provider view: identity, clinical attributes, where they practise. */
const DIRECTORY_SELECT = {
  id: true,
  status: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  staffProfile: {
    select: {
      staffNumber: true,
      professionalTitle: true,
      specialization: true,
      employmentStatus: true,
      availability: true,
    },
  },
  userRoles: { select: { role: { select: { key: true } } } },
  userBranches: { select: { branchId: true } },
  userDepartments: { select: { departmentId: true } },
} satisfies Prisma.UserSelect;

type DirectoryRow = Prisma.UserGetPayload<{ select: typeof DIRECTORY_SELECT }>;

/**
 * The provider directory and onboarding (ADR-050).
 *
 * A provider is a `users` row that holds a clinician role, so this service owns
 * no table of its own. It is a projection over identity plus assignments, and
 * onboarding is a single composite write — deliberately not a wrapper around
 * `POST /users`, which owns its own transaction and would leave a provider
 * created with no profile, no roles, and no availability if a later step failed.
 */
@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
  ) {}

  // ---------------------------------------------------------------------------
  // directory
  // ---------------------------------------------------------------------------

  async list(query: ListProvidersQueryDto): Promise<PageResult<unknown>> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    // Prisma allows one `OR` per level, and this query needs three independent
    // disjunctions: "is a provider", "matches the free-text search", and the
    // optional role filter. Rather than let them overwrite each other, the
    // provider-view and search clauses are ANDed as sibling groups.
    const orGroups: Prisma.UserWhereInput[][] = [providerViewOr(organizationId)];
    if (query.q) orGroups.push(searchOr(query.q));

    const where: Prisma.UserWhereInput = {
      organizationId,
      ...(query.bookableOnly ? bookableUserWhere() : {}),
      ...(query.branchId ? { userBranches: { some: { branchId: query.branchId } } } : {}),
      ...(query.departmentId
        ? { userDepartments: { some: { departmentId: query.departmentId } } }
        : {}),
      ...(query.specialization
        ? { staffProfile: { is: { specialization: query.specialization } } }
        : {}),
      ...(query.roleKey ? { userRoles: { some: { role: { key: query.roleKey } } } } : {}),
      AND: orGroups.map((group) => ({ OR: group })),
    };

    const [rows, total] = await Promise.all([
      db.user.findMany({
        where,
        select: DIRECTORY_SELECT,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.user.count({ where }),
    ]);

    return pageOf(
      rows.map((row) => this.present(row)),
      total,
      page,
      limit,
    );
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    // Membership matters here as much as tenancy: without it, `GET /providers/:id`
    // would return a detail view for any user in the organization, including a
    // receptionist, which is a directory of clinicians by contract.
    const row = await db.user.findFirst({
      where: { id, organizationId, AND: [providerViewWhere(organizationId)] },
      select: DIRECTORY_SELECT,
    });
    if (!row) throw this.notFound();

    // Availability is what makes a provider bookable in practice, so the detail
    // view carries the weekly template rather than making the caller stitch it
    // together from a second call.
    const [schedules, upcoming] = await Promise.all([
      db.providerSchedule.findMany({
        where: { organizationId, providerId: id },
        orderBy: [{ dayOfWeek: 'asc' }, { startMinutes: 'asc' }],
      }),
      db.appointment.findMany({
        where: {
          organizationId,
          providerId: id,
          startsAt: { gte: new Date() },
          status: { in: ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'] },
        },
        select: { id: true, startsAt: true, status: true },
        orderBy: { startsAt: 'asc' },
        take: 10,
      }),
    ]);

    return {
      ...this.present(row),
      availability: schedules.map((s) => ({
        id: s.id,
        dayOfWeek: s.dayOfWeek,
        startMinutes: s.startMinutes,
        endMinutes: s.endMinutes,
        slotDurationMinutes: s.slotDurationMinutes,
        capacity: s.capacity,
        isAvailable: s.isAvailable,
        branchId: s.branchId,
        departmentId: s.departmentId,
        note: s.note,
      })),
      upcomingAppointments: upcoming,
    };
  }

  // ---------------------------------------------------------------------------
  // onboarding
  // ---------------------------------------------------------------------------

  /**
   * Creates a provider as one transaction: identity, staff profile, roles,
   * assignments, optional availability, audit, and the lifecycle event.
   *
   * The user starts `INVITED`, as with any invite — activation is the identity
   * proof, and a directory that reported a half-onboarded clinician as
   * bookable would be lying. The directory reports the real state instead.
   */
  async onboard(input: OnboardProviderDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);

    // Validate every reference before opening the transaction, so a bad branch
    // id fails as a 404 rather than as a half-applied write.
    const [emailClash, staffClash, roles, branches, departments] = await Promise.all([
      db.user.findFirst({ where: { email: input.email }, select: { id: true } }),
      db.staffProfile.findFirst({
        where: { staffNumber: input.staffNumber },
        select: { id: true },
      }),
      db.role.findMany({
        where: { key: { in: [...input.roleKeys] } },
        select: { id: true, key: true },
      }),
      input.branchIds.length > 0
        ? db.branch.findMany({
            where: { id: { in: input.branchIds } },
            select: { id: true },
          })
        : Promise.resolve([]),
      input.departmentIds.length > 0
        ? db.department.findMany({
            where: { id: { in: input.departmentIds } },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);

    if (emailClash) {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message:
          'A user with that email already exists in this organization. Update the existing provider with PATCH /providers/:id instead.',
        silent: true,
      });
    }
    if (staffClash) {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: 'That staff number is already in use in this organization.',
        silent: true,
      });
    }
    if (roles.length !== new Set(input.roleKeys).size) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'One or more roles do not exist in this organization.',
        silent: true,
      });
    }
    if (branches.length !== new Set(input.branchIds).size) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'One or more branches do not exist in this organization.',
        silent: true,
      });
    }
    if (departments.length !== new Set(input.departmentIds).size) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'One or more departments do not exist in this organization.',
        silent: true,
      });
    }

    // The availability seed must reference branches and departments that exist,
    // otherwise the slots would point at nothing.
    const windowBranchIds = [...new Set(input.availability.map((w) => w.branchId))];
    const windowDepartmentIds = [
      ...new Set(input.availability.map((w) => w.departmentId)),
    ];
    if (windowBranchIds.some((id) => !input.branchIds.includes(id))) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message:
          'Every availability window must reference one of the provider’s branches.',
        silent: true,
      });
    }
    if (windowDepartmentIds.some((id) => !input.departmentIds.includes(id))) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message:
          'Every availability window must reference one of the provider’s departments.',
        silent: true,
      });
    }

    const { digest: inviteDigest } = generateHashedToken();
    const userId = newId();

    await this.txRunner.run(async (ctx) => {
      const user = await ctx.db.user.create({
        data: {
          id: userId,
          organizationId,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          otherNames: input.otherNames ?? null,
          phone: input.phone ?? null,
          // INVITED until they accept; see the doc comment.
          status: 'INVITED',
          inviteTokenHash: inviteDigest,
          inviteTokenExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      });

      await ctx.db.staffProfile.create({
        data: {
          id: newId(),
          organizationId,
          userId: user.id,
          staffNumber: input.staffNumber,
          professionalTitle: input.professionalTitle ?? null,
          specialization: input.specialization ?? null,
          licenseNumber: input.licenseNumber ?? null,
          employmentStatus: 'ACTIVE',
          availability: true,
        },
      });

      await ctx.db.userRole.createMany({
        data: roles.map((r) => ({
          id: newId(),
          organizationId,
          userId: user.id,
          roleId: r.id,
        })),
      });
      if (input.branchIds.length > 0) {
        await ctx.db.userBranch.createMany({
          data: input.branchIds.map((id) => ({
            id: newId(),
            organizationId,
            userId: user.id,
            branchId: id,
          })),
        });
      }
      if (input.departmentIds.length > 0) {
        await ctx.db.userDepartment.createMany({
          data: input.departmentIds.map((id) => ({
            id: newId(),
            organizationId,
            userId: user.id,
            departmentId: id,
          })),
        });
      }
      if (input.availability.length > 0) {
        await ctx.db.providerSchedule.createMany({
          data: input.availability.map((w) => ({
            id: newId(),
            organizationId,
            providerId: user.id,
            branchId: w.branchId,
            departmentId: w.departmentId,
            dayOfWeek: w.dayOfWeek,
            startMinutes: w.startMinutes,
            endMinutes: w.endMinutes,
            slotDurationMinutes: w.slotDurationMinutes,
            capacity: w.capacity,
            isAvailable: true,
          })),
        });
      }

      ctx.emit({
        type: EventTypes.ProviderOnboarded,
        aggregateType: 'user',
        aggregateId: user.id,
        payload: { organizationId, roleKeys: roles.map((r) => r.key) },
      });

      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'providers.onboarded',
          resource: 'user',
          resourceId: user.id,
          reason: `Onboarded with roles: ${roles.map((r) => r.key).join(', ')}`,
          // The email is already in the row and is a staff attribute, not
          // patient data, so the audit record can name who was onboarded.
          newState: {
            staffNumber: input.staffNumber,
            specialization: input.specialization ?? null,
            roleKeys: roles.map((r) => r.key),
            availabilityWindows: input.availability.length,
            status: 'INVITED',
          },
        },
      });
    });

    return this.get(userId);
  }

  /**
   * Patches the clinical half of a provider.
   *
   * Account-level state (`status`, sessions, credentials) stays on
   * `/users/:id` — this is deliberately not a second way to reactivate someone,
   * so there is no single endpoint that both grants access and ends employment.
   */
  async update(id: string, input: UpdateProviderDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const existing = await db.user.findFirst({
      where: { id, organizationId, AND: [providerViewWhere(organizationId)] },
      select: ELIGIBILITY_SELECT,
    });
    if (!existing) throw this.notFound();

    const { employmentStatus, availability, ...identity } = input;

    await this.txRunner.run(async (ctx) => {
      const nameKeys = ['firstName', 'lastName', 'otherNames', 'phone'] as const;
      const hasIdentity = nameKeys.some((k) => identity[k] !== undefined);
      if (hasIdentity) {
        await ctx.db.user.update({
          where: { id },
          data: Object.fromEntries(
            nameKeys
              .filter((k) => identity[k] !== undefined)
              .map((k) => [k, identity[k]]),
          ),
        });
      }

      const profileKeys = [
        'professionalTitle',
        'specialization',
        'licenseNumber',
      ] as const;
      const hasProfile = profileKeys.some((k) => identity[k] !== undefined);
      if (hasProfile || employmentStatus !== undefined || availability !== undefined) {
        // A provider may exist with only a user row; onboarding always writes a
        // profile, so this upsert is for rows that predate it.
        await ctx.db.staffProfile.upsert({
          where: { userId: id },
          create: {
            id: newId(),
            organizationId,
            userId: id,
            staffNumber: `UNASSIGNED-${id.slice(0, 8)}`,
            employmentStatus: (employmentStatus as EmploymentStatus) ?? 'ACTIVE',
            availability: availability ?? true,
          },
          update: {
            ...(hasProfile
              ? Object.fromEntries(
                  profileKeys
                    .filter((k) => identity[k] !== undefined)
                    .map((k) => [k, identity[k]]),
                )
              : {}),
            ...(employmentStatus !== undefined ? { employmentStatus } : {}),
            ...(availability !== undefined ? { availability } : {}),
          },
        });
      }

      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'providers.updated',
          resource: 'user',
          resourceId: id,
          newState: { changed: Object.keys(input) },
        },
      });
    });

    return this.get(id);
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  /**
   * The directory shape. A non-bookable provider is still listed, with the
   * reason: staff need to see who they can no longer book, and a provider
   * vanishing from the roster because they went on leave is its own bug.
   */
  private present(row: DirectoryRow) {
    const reason: IneligibleReason | null = ineligibilityReason(row);
    const profile = row.staffProfile;
    return {
      id: row.id,
      name: `${row.firstName} ${row.lastName}`.trim(),
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
      status: row.status,
      bookable: reason === null,
      ...(reason ? { ineligibleReason: reason } : {}),
      roleKeys: row.userRoles.map((r) => r.role.key),
      staffNumber: profile?.staffNumber ?? null,
      professionalTitle: profile?.professionalTitle ?? null,
      specialization: profile?.specialization ?? null,
      employmentStatus: profile?.employmentStatus ?? null,
      // Null, not false: no profile is a different state from opted-out, and
      // collapsing them would make a provider look deliberately unavailable.
      acceptsNewBookings: profile ? profile.availability : null,
      branchIds: row.userBranches.map((b) => b.branchId),
      departmentIds: row.userDepartments.map((d) => d.departmentId),
    };
  }

  private notFound(): AppError {
    return new AppError({
      code: ErrorCodes.RESOURCE_NOT_FOUND,
      message: 'Provider not found in this organization.',
      silent: true,
    });
  }
}

/** Free-text search across name, staff number, and specialization. */
function searchOr(q: string): Prisma.UserWhereInput[] {
  return [
    { firstName: { contains: q, mode: 'insensitive' } },
    { lastName: { contains: q, mode: 'insensitive' } },
    { staffProfile: { is: { staffNumber: { contains: q, mode: 'insensitive' } } } },
    { staffProfile: { is: { specialization: { contains: q, mode: 'insensitive' } } } },
  ];
}
