import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { ReferralsService } from './referrals.service';
import {
  ActionReferralDto,
  CreateReferralDto,
  ListReferralsQueryDto,
  ReferralResponseDto,
} from './dto/referral.dto';

@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Create a referral (in-facility department or external facility)',
    operationId: 'referralsCreate',
    permissions: [PERMISSION_GROUPS.referrals.create],
    statusCode: 201,
    responseType: ReferralResponseDto,
    errors: [
      { status: 400, description: 'Neither toDepartmentId nor toFacilityName provided' },
      { status: 404, description: 'Patient, encounter or destination department not found' },
    ],
  })
  create(@Body() body: CreateReferralDto) {
    return this.referrals.create(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List referrals (filters + pagination)',
    operationId: 'referralsList',
    permissions: [PERMISSION_GROUPS.referrals.read],
    responseType: ListReferralsQueryDto,
  })
  list(@Query() query: ListReferralsQueryDto) {
    return this.referrals.list(query);
  }

  @Post(':id/action')
  @ApiEndpoint({
    summary: 'Act on a referral (send, accept, reject, complete, cancel)',
    operationId: 'referralsAction',
    permissions: [PERMISSION_GROUPS.referrals.update],
    statusCode: 201,
    responseType: ReferralResponseDto,
    errors: [{ status: 409, description: 'Invalid workflow transition' }],
  })
  action(@Param('id') id: string, @Body() body: ActionReferralDto) {
    return this.referrals.action(id, body);
  }
}