import { Body, Controller, Delete, Get, Param, Post, Patch, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { DepartmentsService } from './departments.service';
import {
  CreateDepartmentDto,
  DepartmentDto,
  DepartmentListResponseDto,
  UpdateDepartmentDto,
} from './dto/department.dto';
import { ListUsersQueryDto } from '../users/dto/user.dto';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @ApiEndpoint({
    summary: 'List departments (paginated, search, kind filter)',
    operationId: 'departmentsList',
    permissions: [PERMISSION_GROUPS.departments.read],
    responseType: DepartmentListResponseDto,
  })
  list(@Query() query: ListUsersQueryDto) {
    return this.departments.list(query);
  }

  @Post()
  @ApiEndpoint({
    summary: 'Create a department',
    operationId: 'departmentsCreate',
    permissions: [PERMISSION_GROUPS.departments.manage],
    responseType: DepartmentDto,
    statusCode: 201,
    errors: [{ status: 409, description: 'Department name already exists' }],
  })
  create(@Body() body: CreateDepartmentDto) {
    return this.departments.create(body);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get a department',
    operationId: 'departmentsGet',
    permissions: [PERMISSION_GROUPS.departments.read],
    responseType: DepartmentDto,
  })
  findById(@Param('id') id: string) {
    return this.departments.findById(id);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Update a department',
    operationId: 'departmentsUpdate',
    permissions: [PERMISSION_GROUPS.departments.manage],
    responseType: DepartmentDto,
  })
  update(@Param('id') id: string, @Body() body: UpdateDepartmentDto) {
    return this.departments.update(id, body);
  }

  @Delete(':id')
  @ApiEndpoint({
    summary: 'Deactivate a department (soft delete; fails if staff are assigned)',
    operationId: 'departmentsDelete',
    permissions: [PERMISSION_GROUPS.departments.manage],
    statusCode: 204,
    errors: [{ status: 409, description: 'Department still has assigned staff' }],
  })
  async remove(@Param('id') id: string) {
    await this.departments.remove(id);
  }
}
