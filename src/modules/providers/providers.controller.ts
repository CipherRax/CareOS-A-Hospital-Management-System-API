import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { ProvidersService } from './providers.service';
import {
  ListProvidersQueryDto,
  OnboardProviderDto,
  UpdateProviderDto,
} from './dto/providers.dto';

/**
 * The provider directory and onboarding (ADR-050).
 *
 * Reads are a projection over identity, so `providers.read` is enough to browse
 * the roster; onboarding needs `providers.manage`. Booking is *not* implied by
 * either — it still requires `appointments.create` — so directory access never
 * grants the ability to assign work to someone.
 */
@Controller('providers')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  @ApiEndpoint({
    summary: 'List providers, filterable and bookable-only by default',
    operationId: 'providersList',
    permissions: [PERMISSION_GROUPS.providers.read],
  })
  list(@Query() query: ListProvidersQueryDto) {
    return this.providers.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get a provider with their weekly availability and upcoming appointments',
    operationId: 'providersGet',
    permissions: [PERMISSION_GROUPS.providers.read],
    errors: [{ status: 404, description: 'Provider not found' }],
  })
  get(@Param('id') id: string) {
    return this.providers.get(id);
  }

  @Post()
  @ApiEndpoint({
    summary:
      'Onboard a provider: identity, staff profile, roles, assignments, availability',
    operationId: 'providersOnboard',
    permissions: [PERMISSION_GROUPS.providers.manage],
    statusCode: 201,
    errors: [
      { status: 409, description: 'Email or staff number already in use' },
      { status: 404, description: 'A role, branch or department does not exist' },
      { status: 422, description: 'Invalid provider details or availability window' },
    ],
  })
  onboard(@Body() body: OnboardProviderDto) {
    return this.providers.onboard(body);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Update a provider’s clinical profile and booking eligibility',
    operationId: 'providersUpdate',
    permissions: [PERMISSION_GROUPS.providers.manage],
    errors: [
      { status: 404, description: 'Provider not found' },
      { status: 422, description: 'Nothing to update' },
    ],
  })
  update(@Param('id') id: string, @Body() body: UpdateProviderDto) {
    return this.providers.update(id, body);
  }
}
