import { AppError } from '../../../common/errors/app-error';
import { ErrorCodes } from '../../../common/errors/codes';

/**
 * Workflow engine core (brief §6.6). One centrally-validated transition map per
 * entity type. Organizations customize WITHIN safety bounds: the built-in edges
 * below are the mandatory core and can NEVER be removed; custom edges stored in
 * `workflow_transitions` are ADDITIVE (the effective allowed set is the union).
 * Every transition service funnels through assertWorkflowTransition, so a mis-
 * configured workflow can widen a flow but never unlock a locked one.
 */

export const WORKFLOW_ENTITY_TYPES = [
  'encounter',
  'clinical_note',
  'diagnosis',
  'follow_up',
  'referral',
  'task',
] as const;

export type WorkflowEntityType = (typeof WORKFLOW_ENTITY_TYPES)[number];

export interface WorkflowEdge {
  fromStatus: string;
  toStatus: string;
}

/** Valid statuses per entity type (mirrors Prisma enums). */
export const WORKFLOW_VALID_STATUSES: Record<WorkflowEntityType, readonly string[]> = {
  encounter: ['OPEN', 'IN_PROGRESS', 'COMPLETED'],
  clinical_note: ['DRAFT', 'FINAL'],
  diagnosis: ['ACTIVE', 'RESOLVED', 'HISTORICAL', 'AMENDED'],
  follow_up: ['SCHEDULED', 'REMINDED', 'COMPLETED', 'MISSED', 'CANCELLED'],
  referral: ['CREATED', 'SENT', 'ACCEPTED', 'REJECTED', 'COMPLETED', 'CANCELLED'],
  task: ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'],
};

/** Built-in, mandatory edges for each entity type (the safe core). */
export const SYSTEM_TRANSITIONS: Record<WorkflowEntityType, readonly WorkflowEdge[]> = {
  encounter: [
    { fromStatus: 'OPEN', toStatus: 'IN_PROGRESS' },
    { fromStatus: 'IN_PROGRESS', toStatus: 'COMPLETED' },
  ],
  clinical_note: [{ fromStatus: 'DRAFT', toStatus: 'FINAL' }],
  diagnosis: [
    { fromStatus: 'ACTIVE', toStatus: 'RESOLVED' },
    { fromStatus: 'ACTIVE', toStatus: 'HISTORICAL' },
    { fromStatus: 'ACTIVE', toStatus: 'AMENDED' },
    { fromStatus: 'RESOLVED', toStatus: 'HISTORICAL' },
  ],
  follow_up: [
    { fromStatus: 'SCHEDULED', toStatus: 'REMINDED' },
    { fromStatus: 'SCHEDULED', toStatus: 'COMPLETED' },
    { fromStatus: 'SCHEDULED', toStatus: 'MISSED' },
    { fromStatus: 'SCHEDULED', toStatus: 'CANCELLED' },
    { fromStatus: 'REMINDED', toStatus: 'COMPLETED' },
    { fromStatus: 'REMINDED', toStatus: 'MISSED' },
    { fromStatus: 'REMINDED', toStatus: 'CANCELLED' },
  ],
  referral: [
    { fromStatus: 'CREATED', toStatus: 'SENT' },
    { fromStatus: 'CREATED', toStatus: 'CANCELLED' },
    { fromStatus: 'SENT', toStatus: 'ACCEPTED' },
    { fromStatus: 'SENT', toStatus: 'REJECTED' },
    { fromStatus: 'SENT', toStatus: 'COMPLETED' },
    { fromStatus: 'SENT', toStatus: 'CANCELLED' },
    { fromStatus: 'ACCEPTED', toStatus: 'COMPLETED' },
  ],
  task: [
    { fromStatus: 'OPEN', toStatus: 'IN_PROGRESS' },
    { fromStatus: 'OPEN', toStatus: 'DONE' },
    { fromStatus: 'IN_PROGRESS', toStatus: 'DONE' },
    { fromStatus: 'OPEN', toStatus: 'CANCELLED' },
    { fromStatus: 'IN_PROGRESS', toStatus: 'CANCELLED' },
  ],
};

export function isValidWorkflowStatus(entityType: WorkflowEntityType, status: string): boolean {
  return WORKFLOW_VALID_STATUSES[entityType].includes(status);
}

export function isValidWorkflowEntityType(value: unknown): value is WorkflowEntityType {
  return (WORKFLOW_ENTITY_TYPES as readonly string[]).includes(value as string);
}

/** Union of system + custom edges, deduplicated. Custom edges can only widen. */
export function effectiveEdges(
  entityType: WorkflowEntityType,
  custom: readonly WorkflowEdge[],
): WorkflowEdge[] {
  const seen = new Set<string>();
  const out: WorkflowEdge[] = [];
  for (const edge of [...SYSTEM_TRANSITIONS[entityType], ...custom]) {
    const key = `${edge.fromStatus}\u0000${edge.toStatus}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}

/** List of custom edges the operator may still add (not already present). */
export function addableEdges(
  entityType: WorkflowEntityType,
  custom: readonly WorkflowEdge[],
): WorkflowEdge[] {
  const allowed = validEdgesFor(entityType);
  const present = new Set(
    effectiveEdges(entityType, custom).map((e) => `${e.fromStatus}\u0000${e.toStatus}`),
  );
  return allowed.filter(
    (e) => !present.has(`${e.fromStatus}\u0000${e.toStatus}`),
  );
}

/** All status pairs that are syntactically valid (any valid statuses). */
function validEdgesFor(entityType: WorkflowEntityType): WorkflowEdge[] {
  const statuses = WORKFLOW_VALID_STATUSES[entityType];
  const out: WorkflowEdge[] = [];
  for (const from of statuses) {
    for (const to of statuses) {
      if (from !== to) out.push({ fromStatus: from, toStatus: to });
    }
  }
  return out;
}

/**
 * Central guard. Throws INVALID_WORKFLOW_TRANSITION unless the move is in the
 * effective set (system ∪ custom). Statuses must also be valid for the entity.
 */
export function assertWorkflowTransition(
  entityType: WorkflowEntityType,
  fromStatus: string,
  toStatus: string,
  custom: readonly WorkflowEdge[],
): void {
  if (fromStatus === toStatus) return;
  if (!isValidWorkflowStatus(entityType, fromStatus) || !isValidWorkflowStatus(entityType, toStatus)) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `Invalid status for ${entityType} workflow.`,
      silent: true,
    });
  }
  const ok = effectiveEdges(entityType, custom).some(
    (e) => e.fromStatus === fromStatus && e.toStatus === toStatus,
  );
  if (!ok) {
    throw new AppError({
      code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
      message: `${entityType} cannot move from ${fromStatus} to ${toStatus}.`,
      silent: true,
    });
  }
}