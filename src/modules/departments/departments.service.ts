import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { AuditService } from '../../database/audit.service';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf, type PageResult } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import type { Prisma, Department } from '@prisma/client';

function serialize(department: Department) {
  return {
    id: department.id,
    name: department.name,
    code: department.code,
    kind: department.kind,
    active: department.active,
    createdAt: department.createdAt,
  };
}

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
  ) {}

  async create(input: {
    name: string;
    code?: string;
    kind?: string;
  }): Promise<{ department: ReturnType<typeof serialize> }> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);

    const name = input.name.trim();
    const clash = await db.department.findFirst({
      where: { name },
      select: { id: true },
    });
    if (clash) {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: 'A department with this name already exists.',
        silent: true,
      });
    }

    const department = await db.department.create({
      data: {
        id: newId(),
        organizationId,
        name,
        code: input.code?.trim().toUpperCase() ?? null,
        kind: input.kind as Department['kind'] | undefined,
      },
    });

    await this.audit.record({
      action: 'departments.created',
      resource: 'department',
      resourceId: department.id,
      newState: { name: department.name, kind: department.kind },
    });

    return { department: serialize(department) };
  }

  async list(params: {
    page?: number;
    limit?: number;
    q?: string;
    kind?: string;
  }): Promise<PageResult<ReturnType<typeof serialize>>> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(params);

    const where: Prisma.DepartmentWhereInput = {
      ...(params.kind ? { kind: params.kind as Department['kind'] } : {}),
      ...(params.q
        ? {
            OR: [
              { name: { contains: params.q, mode: 'insensitive' } },
              { code: { contains: params.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      db.department.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.department.count({ where }),
    ]);

    return pageOf(rows.map(serialize), total, page, limit);
  }

  async findById(id: string): Promise<{ department: ReturnType<typeof serialize> }> {
    const organizationId = this.tenantContext.requireOrg();
    const dept = await this.prisma
      .tenantFor(organizationId)
      .department.findFirst({ where: { id } });
    if (!dept) throw AppError.notFound('Department not found');
    return { department: serialize(dept) };
  }

  async update(
    id: string,
    input: {
      name?: string;
      code?: string | null;
      kind?: string;
      active?: boolean;
    },
  ): Promise<{ department: ReturnType<typeof serialize> }> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const dept = await db.department.findFirst({ where: { id } });
    if (!dept) throw AppError.notFound('Department not found');

    const updated = await db.department.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        code:
          input.code === undefined
            ? undefined
            : (input.code?.trim().toUpperCase() ?? null),
        kind: input.kind as Department['kind'] | undefined,
        active: input.active,
      },
    });

    await this.audit.record({
      action: 'departments.updated',
      resource: 'department',
      resourceId: id,
      previousState: { name: dept.name, active: dept.active },
      newState: { name: updated.name, active: updated.active },
    });

    return { department: serialize(updated) };
  }

  async remove(id: string): Promise<void> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const dept = await db.department.findFirst({
      where: { id },
      include: { userDepartmentLinks: { select: { id: true }, take: 1 } },
    });
    if (!dept) throw AppError.notFound('Department not found');

    if (dept.userDepartmentLinks.length > 0) {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: 'Department has staff assigned; reassign them before deletion.',
        silent: true,
      });
    }

    const updated = await db.department.update({
      where: { id },
      data: { active: false },
    });

    await this.audit.record({
      action: 'departments.deactivated',
      resource: 'department',
      resourceId: id,
      previousState: { active: dept.active },
      newState: { active: updated.active },
    });
  }
}
