import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { EmergencyIntakeService } from './emergency-intake.service';
import {
  EmergencyContactPatchDto,
  EmergencyContactUpsertDto,
  IntakePolicyUpdateDto,
} from './dto/emergency-intake.dto';

/**
 * Branch-scoped emergency intake settings (brief §6.15): the SLA/escalation
 * policy plus the ordered staff contact chain. `emergency_settings.manage`.
 */
@Controller('settings/emergency')
export class IntakeSettingsController {
  constructor(private readonly intake: EmergencyIntakeService) {}

  @Get()
  @ApiEndpoint({
    summary: 'Emergency intake policy for this branch',
    operationId: 'getEmergencyIntakePolicy',
    permissions: [PERMISSION_GROUPS.emergencySettings.manage],
    example: {
      data: {
        branchId: '…',
        policy: {
          enabled: true,
          autoEscalate: true,
          requireDescription: false,
          allowAnonymousCaller: true,
          levelSeconds: [120, 300, 900],
          depth: 3,
          emergencyPhone: '+254 20 555 0100',
          version: 2,
        },
      },
    },
  })
  getPolicy() {
    return this.intake.getPolicy();
  }

  @Put()
  @ApiEndpoint({
    summary: 'Set the emergency intake policy for this branch',
    operationId: 'updateEmergencyIntakePolicy',
    permissions: [PERMISSION_GROUPS.emergencySettings.manage],
    errors: [{ status: 404, description: 'Branch not found', code: 'RESOURCE_NOT_FOUND' }],
  })
  updatePolicy(@Body() body: IntakePolicyUpdateDto) {
    return this.intake.updatePolicy(body);
  }

  @Get('contacts')
  @ApiEndpoint({
    summary: 'Ordered staff escalation contact chain for this branch',
    operationId: 'listEmergencyContacts',
    permissions: [PERMISSION_GROUPS.emergencySettings.manage],
  })
  listContacts() {
    return this.intake.listContacts();
  }

  @Post('contacts')
  @ApiEndpoint({
    summary: 'Create or replace a contact at `order` in the escalation chain',
    operationId: 'upsertEmergencyContact',
    statusCode: 201,
    permissions: [PERMISSION_GROUPS.emergencySettings.manage],
    errors: [{ status: 404, description: 'Branch not found', code: 'RESOURCE_NOT_FOUND' }],
  })
  upsertContact(@Body() body: EmergencyContactUpsertDto) {
    return this.intake.upsertContact(body);
  }

  @Patch('contacts/:id')
  @ApiEndpoint({
    summary: 'Update an escalation contact',
    operationId: 'patchEmergencyContact',
    permissions: [PERMISSION_GROUPS.emergencySettings.manage],
    errors: [{ status: 404, description: 'Contact not found', code: 'RESOURCE_NOT_FOUND' }],
  })
  patchContact(@Param('id') id: string, @Body() body: EmergencyContactPatchDto) {
    return this.intake.patchContact(id, body);
  }

  @Delete('contacts/:id')
  @ApiEndpoint({
    summary: 'Remove an escalation contact',
    operationId: 'deleteEmergencyContact',
    permissions: [PERMISSION_GROUPS.emergencySettings.manage],
    errors: [{ status: 404, description: 'Contact not found', code: 'RESOURCE_NOT_FOUND' }],
  })
  deleteContact(@Param('id') id: string) {
    return this.intake.deleteContact(id);
  }
}