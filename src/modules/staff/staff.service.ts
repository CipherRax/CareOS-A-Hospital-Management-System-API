import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { AuditService } from '../../database/audit.service';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf, type PageResult } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import type { Prisma, EmploymentStatus } from '@prisma/client';

const STAFF_INCLUDE = {
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true,
      userBranches: {
        select: { branch: { select: { id: true, name: true, code: true } } },
      },
      userDepartments: {
        select: { department: { select: { id: true, name: true } } },
      },
    },
  },
} as const;

type StaffRow = {
  id: string;
  staffNumber: string;
  professionalTitle: string | null;
  specialization: string | null;
  employmentStatus: string;
  licenseNumber: string | null;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    status: string;
    userBranches: Array<{ branch: { id: string; name: string; code: string } }>;
    userDepartments: Array<{ department: { id: string; name: string } }>;
  };
};

function serialize(staff: StaffRow) {
  return {
    id: staff.id,
    staffNumber: staff.staffNumber,
    professionalTitle: staff.professionalTitle,
    specialization: staff.specialization,
    employmentStatus: staff.employmentStatus,
    licenseNumber: staff.licenseNumber,
    user: {
      id: staff.user.id,
      email: staff.user.email,
      firstName: staff.user.firstName,
      lastName: staff.user.lastName,
      status: staff.user.status,
    },
    branches: staff.user.userBranches.map((l) => l.branch),
    departments: staff.user.userDepartments.map((l) => l.department),
  };
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
    private readonly txRunner: TxRunner,
  ) {}

  async list(params: { page?: number; limit?: number; q?: string }) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(params);

    const where: Prisma.StaffProfileWhereInput = params.q
      ? {
          OR: [
            { staffNumber: { contains: params.q, mode: 'insensitive' } },
            { professionalTitle: { contains: params.q, mode: 'insensitive' } },
            { specialization: { contains: params.q, mode: 'insensitive' } },
            {
              user: {
                OR: [
                  { email: { contains: params.q, mode: 'insensitive' } },
                  { firstName: { contains: params.q, mode: 'insensitive' } },
                  { lastName: { contains: params.q, mode: 'insensitive' } },
                ],
              },
            },
          ],
        }
      : {};

    const [rows, total] = await Promise.all([
      db.staffProfile.findMany({
        where,
        include: STAFF_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.staffProfile.count({ where }),
    ]);

    return pageOf(rows.map(serialize), total, page, limit) as PageResult<
      ReturnType<typeof serialize>
    >;
  }

  async findById(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const staff = await this.prisma
      .tenantFor(organizationId)
      .staffProfile.findFirst({ where: { id }, include: STAFF_INCLUDE });
    if (!staff) throw AppError.notFound('Staff profile not found');
    return { staff: serialize(staff as StaffRow) };
  }

  async update(
    id: string,
    input: {
      professionalTitle?: string | null;
      specialization?: string | null;
      employmentStatus?: string;
      licenseNumber?: string | null;
    },
  ) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const staff = await db.staffProfile.findFirst({ where: { id } });
    if (!staff) throw AppError.notFound('Staff profile not found');

    const updated = await db.staffProfile.update({
      where: { id },
      data: {
        professionalTitle:
          input.professionalTitle === undefined ? undefined : input.professionalTitle,
        specialization:
          input.specialization === undefined ? undefined : input.specialization,
        employmentStatus: (input.employmentStatus ??
          staff.employmentStatus) as EmploymentStatus,
        licenseNumber:
          input.licenseNumber === undefined ? undefined : input.licenseNumber,
      },
      include: STAFF_INCLUDE,
    });

    await this.audit.record({
      action: 'staff.updated',
      resource: 'staff',
      resourceId: id,
      newState: { changed: Object.keys(input) },
    });

    return { staff: serialize(updated as StaffRow) };
  }

  async setAssignments(
    id: string,
    input: { branchIds?: string[]; departmentIds?: string[] },
  ) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const staff = await db.staffProfile.findFirst({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!staff) throw AppError.notFound('Staff profile not found');

    const branchIds = await this.verifyBranches(input.branchIds ?? []);
    const departmentIds = await this.verifyDepartments(input.departmentIds ?? []);
    const { userId } = staff;

    await this.txRunner.run(async (ctx: TxContext) => {
      await ctx.db.userBranch.deleteMany({ where: { userId } });
      if (branchIds.length > 0) {
        await ctx.db.userBranch.createMany({
          data: branchIds.map((branchId) => ({
            id: newId(),
            organizationId,
            userId,
            branchId,
          })),
        });
      }
      await ctx.db.userDepartment.deleteMany({ where: { userId } });
      if (departmentIds.length > 0) {
        await ctx.db.userDepartment.createMany({
          data: departmentIds.map((departmentId) => ({
            id: newId(),
            organizationId,
            userId,
            departmentId,
          })),
        });
      }
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'staff.assignments_set',
          resource: 'staff',
          resourceId: id,
          newState: { branchIds, departmentIds, userId },
        },
      });
    });

    return this.findById(id);
  }

  private async verifyBranches(branchIds: string[]) {
    if (branchIds.length === 0) return [];
    const organizationId = this.tenantContext.requireOrg();
    const found = await this.prisma
      .tenantFor(organizationId)
      .branch.findMany({ where: { id: { in: branchIds } }, select: { id: true } });
    if (found.length !== branchIds.length) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'One or more branches do not exist.',
        silent: true,
      });
    }
    return found.map((b) => b.id);
  }

  private async verifyDepartments(departmentIds: string[]) {
    if (departmentIds.length === 0) return [];
    const organizationId = this.tenantContext.requireOrg();
    const found = await this.prisma
      .tenantFor(organizationId)
      .department.findMany({
        where: { id: { in: departmentIds } },
        select: { id: true },
      });
    if (found.length !== departmentIds.length) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'One or more departments do not exist.',
        silent: true,
      });
    }
    return found.map((d) => d.id);
  }
}
