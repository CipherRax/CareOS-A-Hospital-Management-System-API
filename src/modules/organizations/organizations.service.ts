import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { AuditService } from '../../database/audit.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';

const ORG_SELECT = {
  id: true,
  name: true,
  status: true,
  legalName: true,
  tradingName: true,
  registrationNumber: true,
  kraPin: true,
  phone: true,
  email: true,
  website: true,
  logoUrl: true,
  address: true,
  county: true,
  town: true,
  currency: true,
  timezone: true,
  country: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
  ) {}

  /** Returns the calling tenant's organization. */
  async current() {
    const orgId = this.tenantContext.requireOrg();
    const org = await this.prisma.tenant.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: ORG_SELECT,
    });
    return { organization: org };
  }

  /** Updates the calling tenant's own profile fields. */
  async updateMe(
    input: Partial<{
      legalName: string;
      tradingName: string | null;
      registrationNumber: string;
      kraPin: string;
      phone: string | null;
      email: string | null;
      website: string | null;
      logoUrl: string | null;
      address: string | null;
      county: string | null;
      town: string | null;
    }>,
  ) {
    const orgId = this.tenantContext.requireOrg();

    if (input.email !== undefined && input.email !== null) {
      const email = input.email.trim().toLowerCase();
      const clash = await this.prisma.tenant.organization.findFirst({
        where: { email, id: { not: orgId } },
        select: { id: true },
      });
      if (clash) {
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: 'Another organization already uses this email.',
          silent: true,
        });
      }
      input.email = email;
    }

    const org = await this.prisma.tenant.organization.update({
      where: { id: orgId },
      data: {
        legalName: input.legalName ?? undefined,
        tradingName: input.tradingName === undefined ? undefined : input.tradingName,
        registrationNumber: input.registrationNumber ?? undefined,
        kraPin: input.kraPin ?? undefined,
        phone: input.phone === undefined ? undefined : input.phone,
        email: input.email === undefined ? undefined : input.email,
        website: input.website === undefined ? undefined : input.website,
        logoUrl: input.logoUrl === undefined ? undefined : input.logoUrl,
        address: input.address === undefined ? undefined : input.address,
        county: input.county === undefined ? undefined : input.county,
        town: input.town === undefined ? undefined : input.town,
      },
      select: ORG_SELECT,
    });

    await this.audit.record({
      action: 'organizations.updated',
      resource: 'organization',
      resourceId: orgId,
      newState: { changed: Object.keys(input) },
    });

    return { organization: org };
  }
}
