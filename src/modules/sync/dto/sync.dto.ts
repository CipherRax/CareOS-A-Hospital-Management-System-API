import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Offline-sync request (brief §10). `cursor` is the sequence of the last
 * change row the client saw; `resources` narrows the pull to resource types.
 * Both are optional — an empty pull returns the first page of everything the
 * caller may see.
 */
export const SyncQuerySchema = z.object({
  cursor: z
    .string()
    .max(19)
    .regex(/^\d+$/, 'Cursor must be a change-log sequence number')
    .optional(),
  resources: z
    .string()
    .max(512)
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : undefined,
    ),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export class SyncQueryDto extends createZodDto(SyncQuerySchema) {}

export class SyncChangeResponseDto {
  id!: string;
  resourceType!: string;
  resourceId!: string;
  operation!: 'UPSERT' | 'DELETE';
  version!: number;
  branchId?: string | null;
  occurredAt!: string;
}

export class SyncPageResponseDto {
  changes!: SyncChangeResponseDto[];
  /** Cursor to pass on the next pull. Echoes the input when nothing changed. */
  cursor!: string | null;
  hasMore!: boolean;
}
