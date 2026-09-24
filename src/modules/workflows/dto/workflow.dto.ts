import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const WorkflowEntityType = z.enum([
  'encounter',
  'clinical_note',
  'diagnosis',
  'follow_up',
  'referral',
  'task',
]);
export const WorkflowEntityTypeDto = createZodDto(WorkflowEntityType);

export const AddWorkflowTransitionSchema = z.object({
  fromStatus: z.string().trim().min(1).max(64),
  toStatus: z.string().trim().min(1).max(64),
  label: z.string().trim().max(200).optional(),
});
export class AddWorkflowTransitionDto extends createZodDto(AddWorkflowTransitionSchema) {}

export const WorkflowDetailSchema = z.object({
  entityType: WorkflowEntityType,
  isActive: z.boolean(),
  systemEdges: z.array(z.object({ fromStatus: z.string(), toStatus: z.string() })),
  customEdges: z.array(z.object({ fromStatus: z.string(), toStatus: z.string() })),
  edges: z.array(z.object({ fromStatus: z.string(), toStatus: z.string() })),
  addable: z.array(z.object({ fromStatus: z.string(), toStatus: z.string() })),
});
export class WorkflowDetailDto extends createZodDto(WorkflowDetailSchema) {}

export const WorkflowTransitionCreatedSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  fromStatus: z.string(),
  toStatus: z.string(),
  label: z.string().nullable().optional(),
});
export class WorkflowTransitionCreatedDto extends createZodDto(WorkflowTransitionCreatedSchema) {}