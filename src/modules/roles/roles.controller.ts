import { Body, Controller, Delete, Get, Param, Post, Patch, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { RolesService } from './roles.service';
import {
  CreateRoleDto,
  RoleDto,
  RoleListResponseDto,
  UpdateRoleDto,
} from './dto/role.dto';
import { ListUsersQueryDto } from '../users/dto/user.dto';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @ApiEndpoint({
    summary: 'List roles (paginated, search)',
    operationId: 'rolesList',
    permissions: [PERMISSION_GROUPS.roles.read],
    responseType: RoleListResponseDto,
  })
  list(@Query() query: ListUsersQueryDto) {
    return this.roles.list(query);
  }

  @Get('permissions')
  @ApiEndpoint({
    summary: 'Role/permission catalog used when building custom roles',
    operationId: 'rolesCatalog',
    permissions: [PERMISSION_GROUPS.roles.read],
  })
  catalog() {
    return this.roles.catalog();
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get a role',
    operationId: 'rolesGet',
    permissions: [PERMISSION_GROUPS.roles.read],
    responseType: RoleDto,
  })
  findById(@Param('id') id: string) {
    return this.roles.findById(id);
  }

  @Post()
  @ApiEndpoint({
    summary: 'Create a custom role (cannot exceed caller permissions)',
    operationId: 'rolesCreate',
    permissions: [PERMISSION_GROUPS.roles.manage],
    responseType: RoleDto,
    statusCode: 201,
    errors: [{ status: 403, description: 'Privilege escalation denied' }],
  })
  create(@Body() body: CreateRoleDto) {
    return this.roles.create(body);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Update a role (permission changes cannot exceed caller permissions)',
    operationId: 'rolesUpdate',
    permissions: [PERMISSION_GROUPS.roles.manage],
    responseType: RoleDto,
    errors: [
      { status: 403, description: 'Privilege escalation or system-role edit denied' },
    ],
  })
  update(@Param('id') id: string, @Body() body: UpdateRoleDto) {
    return this.roles.update(id, body);
  }

  @Delete(':id')
  @ApiEndpoint({
    summary: 'Delete a role (only when unassigned; system roles guarded)',
    operationId: 'rolesDelete',
    permissions: [PERMISSION_GROUPS.roles.manage],
    statusCode: 204,
    errors: [{ status: 409, description: 'Role is still assigned to users' }],
  })
  async remove(@Param('id') id: string) {
    await this.roles.remove(id);
  }
}
