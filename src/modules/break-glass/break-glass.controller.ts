import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { BreakGlassService } from './break-glass.service';
import {
  BreakGlassGrantDto,
  BreakGlassGrantListResponseDto,
  CreateBreakGlassRequestDto,
} from './dto/break-glass.dto';
import { ListUsersQueryDto } from '../users/dto/user.dto';

@Controller('break-glass')
export class BreakGlassController {
  constructor(private readonly breakGlass: BreakGlassService) {}

  @Post('requests')
  @ApiEndpoint({
    summary:
      'Request temporary elevated access to a resource (PENDING only; never self-granting)',
    operationId: 'breakGlassRequest',
    permissions: [PERMISSION_GROUPS.breakGlass.request],
    responseType: BreakGlassGrantDto,
    statusCode: 201,
    errors: [
      { status: 400, description: 'Already holds the permission, or invalid request' },
    ],
  })
  request(@Body() body: CreateBreakGlassRequestDto) {
    return this.breakGlass.request(body);
  }

  @Get('requests/mine')
  @ApiEndpoint({
    summary: 'List my own break-glass requests',
    operationId: 'breakGlassMine',
    permissions: [PERMISSION_GROUPS.breakGlass.request],
  })
  mine() {
    return this.breakGlass.mine();
  }

  @Get('requests')
  @ApiEndpoint({
    summary: 'List all break-glass requests (audit view)',
    operationId: 'breakGlassList',
    permissions: [PERMISSION_GROUPS.breakGlass.manage],
    responseType: BreakGlassGrantListResponseDto,
  })
  list(@Query() query: ListUsersQueryDto) {
    return this.breakGlass.list(query);
  }

  @Post('requests/:id/expire')
  @ApiEndpoint({
    summary: 'Expire/revoke a break-glass request (owner or auditor)',
    operationId: 'breakGlassExpire',
    permissions: [PERMISSION_GROUPS.breakGlass.manage],
  })
  expire(@Param('id') id: string) {
    return this.breakGlass.expire(id);
  }
}
