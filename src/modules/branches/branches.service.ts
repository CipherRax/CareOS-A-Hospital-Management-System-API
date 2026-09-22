import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { AuditService } from '../../database/audit.service';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf, type PageResult } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import type { Prisma, Branch } from '@prisma/client';

function serialize(branch: Branch) {
  return {
    id: branch.id,
    name: branch.name,
    code: branch.code,
    address: branch.address,
    phone: branch.phone,
    email: branch.email,
    operatingHours: branch.operatingHours,
    status: branch.status,
    createdAt: branch.createdAt,
  };
}

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
  ) {}

  async create(input: {
    name: string;
    code: string;
    address?: string;
    phone?: string | null;
    email?: string | null;
    operatingHours?: string | null;
  }): Promise<{ branch: ReturnType<typeof serialize> }> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);

    const code = input.code.trim().toUpperCase();
    const clash = await db.branch.findUnique({
      where: { organizationId_code: { organizationId, code } },
    });
    if (clash) {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: 'A branch with this code already exists.',
        silent: true,
      });
    }

    const branch = await db.branch.create({
      data: {
        id: newId(),
        organizationId,
        name: input.name,
        code,
        address: input.address ?? null,
        phone: input.phone ?? null,
        email: input.email ? input.email.toLowerCase() : null,
        operatingHours: input.operatingHours ?? null,
      },
    });

    await this.audit.record({
      action: 'branches.created',
      resource: 'branch',
      resourceId: branch.id,
      newState: { name: branch.name, code: branch.code },
    });

    return { branch: serialize(branch) };
  }

  async list(params: {
    page?: number;
    limit?: number;
    q?: string;
    status?: string;
  }): Promise<PageResult<ReturnType<typeof serialize>>> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(params);

    const where: Prisma.BranchWhereInput = {
      ...(params.status ? { status: params.status as Branch['status'] } : {}),
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
      db.branch.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.branch.count({ where }),
    ]);

    return pageOf(rows.map(serialize), total, page, limit);
  }

  async findById(id: string): Promise<{ branch: ReturnType<typeof serialize> }> {
    const organizationId = this.tenantContext.requireOrg();
    const branch = await this.prisma
      .tenantFor(organizationId)
      .branch.findFirst({ where: { id } });
    if (!branch) throw AppError.notFound('Branch not found');
    return { branch: serialize(branch) };
  }

  async update(
    id: string,
    input: {
      name?: string;
      address?: string | null;
      phone?: string | null;
      email?: string | null;
      operatingHours?: string | null;
      status?: string;
    },
  ): Promise<{ branch: ReturnType<typeof serialize> }> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const branch = await db.branch.findFirst({ where: { id } });
    if (!branch) throw AppError.notFound('Branch not found');

    const updated = await db.branch.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        address: input.address === undefined ? undefined : input.address,
        phone: input.phone === undefined ? undefined : input.phone,
        email:
          input.email === undefined
            ? undefined
            : input.email
              ? input.email.toLowerCase()
              : null,
        operatingHours:
          input.operatingHours === undefined ? undefined : input.operatingHours,
        status: input.status as Branch['status'] | undefined,
      },
    });

    await this.audit.record({
      action: 'branches.updated',
      resource: 'branch',
      resourceId: id,
      previousState: { name: branch.name, status: branch.status },
      newState: { name: updated.name, status: updated.status },
    });

    return { branch: serialize(updated) };
  }

  async remove(id: string): Promise<void> {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const branch = await db.branch.findFirst({
      where: { id },
      include: { userLinks: { select: { id: true }, take: 1 } },
    });
    if (!branch) throw AppError.notFound('Branch not found');

    if (branch.userLinks.length > 0) {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: 'Branch has staff assigned; reassign them before deletion.',
        silent: true,
      });
    }

    // Soft-deactivate instead of a hard delete: keeps audit references valid.
    const updated = await db.branch.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });

    await this.audit.record({
      action: 'branches.deactivated',
      resource: 'branch',
      resourceId: id,
      previousState: { status: branch.status },
      newState: { status: updated.status },
    });
  }
}
