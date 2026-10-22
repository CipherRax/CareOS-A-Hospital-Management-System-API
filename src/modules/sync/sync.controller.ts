import { Controller, Get, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { SyncService } from './sync.service';
import { SyncPageResponseDto, SyncQueryDto } from './dto/sync.dto';

/**
 * Offline-sync feed (brief §10).
 *
 * A client pulls `GET /sync?cursor=…&resources=…` to receive only the changes
 * made since its last cursor, already narrowed to what the caller may read.
 * Conflict detection is orthogonal: mutations carry the base `version`, and a
 * stale write returns 409 VERSION_CONFLICT with current server state.
 */
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get()
  @ApiEndpoint({
    summary: 'Pull changes since a cursor (permission- and resource-filtered)',
    description:
      'Returns change-log rows after the given cursor, filtered to the caller\'s effective permissions and (optionally) named resource types. Echoes the cursor when nothing changed so a poll does not reset to history.',
    operationId: 'syncPull',
    permissions: [PERMISSION_GROUPS.sync.read],
    responseType: SyncPageResponseDto,
    errors: [
      { status: 400, description: 'Malformed cursor or unknown resource (INVALID_SYNC_CURSOR / VALIDATION_ERROR)' },
    ],
  })
  pull(@Query() query: SyncQueryDto) {
    return this.sync.pull(query);
  }
}
