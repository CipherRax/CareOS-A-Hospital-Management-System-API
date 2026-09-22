import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { StaffService } from './staff.service';
import {
  SetStaffAssignmentsDto,
  StaffDto,
  StaffListResponseDto,
  UpdateStaffDto,
} from './dto/staff.dto';
import { ListUsersQueryDto } from '../users/dto/user.dto';

@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @ApiEndpoint({
    summary: 'List staff (with current branches & departments)',
    operationId: 'staffList',
    permissions: [PERMISSION_GROUPS.staff.read],
    responseType: StaffListResponseDto,
  })
  list(@Query() query: ListUsersQueryDto) {
    return this.staff.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get a staff profile',
    operationId: 'staffGet',
    permissions: [PERMISSION_GROUPS.staff.read],
    responseType: StaffDto,
  })
  findById(@Param('id') id: string) {
    return this.staff.findById(id);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Update a staff profile',
    operationId: 'staffUpdate',
    permissions: [PERMISSION_GROUPS.staff.manage],
    responseType: StaffDto,
  })
  update(@Param('id') id: string, @Body() body: UpdateStaffDto) {
    return this.staff.update(id, body);
  }

  @Post(':id/assignments')
  @ApiEndpoint({
    summary: 'Replace branch/department assignments for a staff member',
    operationId: 'staffSetAssignments',
    permissions: [PERMISSION_GROUPS.staff.manage],
    responseType: StaffDto,
  })
  setAssignments(@Param('id') id: string, @Body() body: SetStaffAssignmentsDto) {
    return this.staff.setAssignments(id, body);
  }
}
