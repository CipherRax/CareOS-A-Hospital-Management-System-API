import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { WorkflowsService } from './workflows.service';
import {
  AddWorkflowTransitionDto,
  WorkflowDetailDto,
  WorkflowTransitionCreatedDto,
} from './dto/workflow.dto';

@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get(':entityType')
  @ApiEndpoint({
    summary: 'Get the effective workflow for an entity type (system + custom edges)',
    operationId: 'workflowsGet',
    permissions: [PERMISSION_GROUPS.workflows.read],
    responseType: WorkflowDetailDto,
    errors: [{ status: 400, description: 'Unknown workflow entity type' }],
  })
  get(@Param('entityType') entityType: string) {
    return this.workflows.get(entityType);
  }

  @Post(':entityType/transitions')
  @ApiEndpoint({
    summary: 'Add an optional workflow transition (system edges are immutable)',
    description:
      'Organizations may only widen a flow: the built-in edges can never be removed, so mandatory gates stay locked.',
    operationId: 'workflowsAddTransition',
    permissions: [PERMISSION_GROUPS.workflows.manage],
    statusCode: 201,
    responseType: WorkflowTransitionCreatedDto,
    errors: [
      { status: 400, description: 'Invalid status pair for this entity type' },
      { status: 409, description: 'Transition already exists (CONFLICT)' },
    ],
  })
  addTransition(@Param('entityType') entityType: string, @Body() body: AddWorkflowTransitionDto) {
    return this.workflows.addTransition(entityType, body);
  }
}