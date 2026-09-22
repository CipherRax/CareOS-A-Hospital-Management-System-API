import { Body, Controller, Delete, Get, Param, Post, Patch, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { UsersService } from './users.service';
import {
  CreateUserDto,
  CreateUserResponseDto,
  ListUsersQueryDto,
  SetUserRolesDto,
  UserListResponseDto,
  UpdateUserDto,
} from './dto/user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiEndpoint({
    summary: 'List users (search, filter by status, paginated)',
    operationId: 'usersList',
    permissions: [PERMISSION_GROUPS.users.read],
    responseType: UserListResponseDto,
  })
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @Post()
  @ApiEndpoint({
    summary: 'Invite a user (optionally staff profile, branches, departments, roles)',
    operationId: 'usersInvite',
    permissions: [PERMISSION_GROUPS.users.manage, PERMISSION_GROUPS.roles.manage],
    responseType: CreateUserResponseDto,
    statusCode: 201,
    errors: [
      { status: 403, description: 'Privilege escalation denied' },
      { status: 409, description: 'User or staff number already exists' },
    ],
  })
  invite(@Body() body: CreateUserDto) {
    return this.users.invite(body);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get a user',
    operationId: 'usersGet',
    permissions: [PERMISSION_GROUPS.users.read],
  })
  findById(@Param('id') id: string) {
    return this.users.findById(id);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Update a user (profile or status; status changes revoke sessions)',
    operationId: 'usersUpdate',
    permissions: [PERMISSION_GROUPS.users.manage],
    errors: [{ status: 400, description: 'Cannot self-manage through this endpoint' }],
  })
  update(@Param('id') id: string, @Body() body: UpdateUserDto) {
    return this.users.update(id, body);
  }

  @Post(':id/roles')
  @ApiEndpoint({
    summary: 'Replace a user role set (privilege escalation is rejected)',
    operationId: 'usersSetRoles',
    permissions: [PERMISSION_GROUPS.users.manage, PERMISSION_GROUPS.roles.manage],
    errors: [{ status: 403, description: 'Privilege escalation denied' }],
  })
  setRoles(@Param('id') id: string, @Body() body: SetUserRolesDto) {
    return this.users.setRoles(id, body.roleIds);
  }

  @Post(':id/sessions/revoke')
  @ApiEndpoint({
    summary: 'Revoke all sessions of a user',
    operationId: 'usersRevokeSessions',
    permissions: [PERMISSION_GROUPS.users.manage, PERMISSION_GROUPS.sessions.manage],
  })
  revokeSessions(@Param('id') id: string) {
    return this.users.revokeSessions(id);
  }

  @Delete(':id')
  @ApiEndpoint({
    summary: 'Deactivate a user (soft delete; sessions revoked)',
    operationId: 'usersDeactivate',
    permissions: [PERMISSION_GROUPS.users.manage],
    statusCode: 204,
  })
  async deactivate(@Param('id') id: string) {
    await this.users.deactivate(id);
  }
}
