import { Controller, Get } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { OrganizationResponseDto } from './dto/organization.dto';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get('me')
  @ApiEndpoint({
    summary: 'Get the calling tenant organization',
    description:
      'Returns the organization the authenticated token belongs to. Tenant comes from the JWT, never from the request body.',
    operationId: 'organizationsMe',
    permissions: [PERMISSION_GROUPS.organizations.read],
    responseType: OrganizationResponseDto,
  })
  me(): Promise<{ organization: unknown }> {
    return this.organizations.current();
  }
}
