import { Body, Controller, Delete, Get, Param, Post, Patch, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { BranchesService } from './branches.service';
import {
  BranchDto,
  BranchListResponseDto,
  CreateBranchDto,
  UpdateBranchDto,
} from './dto/branch.dto';
import { ListUsersQueryDto } from '../users/dto/user.dto';

@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @ApiEndpoint({
    summary: 'List branches (paginated, search, status filter)',
    operationId: 'branchesList',
    permissions: [PERMISSION_GROUPS.branches.read],
    responseType: BranchListResponseDto,
  })
  list(@Query() query: ListUsersQueryDto) {
    return this.branches.list(query);
  }

  @Post()
  @ApiEndpoint({
    summary: 'Create a branch',
    operationId: 'branchesCreate',
    permissions: [PERMISSION_GROUPS.branches.manage],
    responseType: BranchDto,
    statusCode: 201,
    errors: [{ status: 409, description: 'Branch code already exists' }],
  })
  create(@Body() body: CreateBranchDto) {
    return this.branches.create(body);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get a branch',
    operationId: 'branchesGet',
    permissions: [PERMISSION_GROUPS.branches.read],
    responseType: BranchDto,
  })
  findById(@Param('id') id: string) {
    return this.branches.findById(id);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Update a branch',
    operationId: 'branchesUpdate',
    permissions: [PERMISSION_GROUPS.branches.manage],
    responseType: BranchDto,
  })
  update(@Param('id') id: string, @Body() body: UpdateBranchDto) {
    return this.branches.update(id, body);
  }

  @Delete(':id')
  @ApiEndpoint({
    summary: 'Deactivate a branch (soft delete; fails if staff are assigned)',
    operationId: 'branchesDelete',
    permissions: [PERMISSION_GROUPS.branches.manage],
    statusCode: 204,
    errors: [{ status: 409, description: 'Branch still has assigned staff' }],
  })
  async remove(@Param('id') id: string) {
    await this.branches.remove(id);
  }
}
