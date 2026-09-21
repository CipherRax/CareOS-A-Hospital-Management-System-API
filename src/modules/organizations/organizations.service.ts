import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  /** Returns the calling tenant's organization. */
  async current() {
    const orgId = this.tenantContext.requireOrg();
    const org = await this.prisma.tenant.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        status: true,
        currency: true,
        timezone: true,
        country: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { organization: org };
  }
}
