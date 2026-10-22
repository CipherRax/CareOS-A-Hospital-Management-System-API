import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { ObjectStorageService } from '../../common/storage/object-storage.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { PrivacyService } from './privacy.service';
import { DataExportService, MAX_EXPORT_ARTIFACT_BYTES } from './data-export.service';
import {
  PlaceLegalHoldDto,
  ReleaseLegalHoldDto,
  RequestDataExportDto,
  UpdateRetentionPolicyDto,
  UpsertRetentionPolicyDto,
} from './dto/privacy.dto';

/**
 * The privacy surface (brief §8).
 *
 * Retention policies, legal holds, and data-subject exports. Every route here
 * is audited, and the export download streams patient data back through the
 * API rather than handing out a bearer URL.
 */
@Controller('privacy')
export class PrivacyController {
  private readonly logger = new Logger(PrivacyController.name);

  constructor(
    private readonly privacy: PrivacyService,
    private readonly exports: DataExportService,
    private readonly storage: ObjectStorageService,
  ) {}

  // ---------------------------------------------------------------------------
  // retention policies
  // ---------------------------------------------------------------------------

  @Get('retention-policies')
  @ApiEndpoint({
    summary: 'List the org retention policies',
    operationId: 'privacyRetentionPoliciesList',
    permissions: [PERMISSION_GROUPS.privacy.read],
  })
  listRetentionPolicies() {
    return this.privacy.listRetentionPolicies();
  }

  @Post('retention-policies')
  @ApiEndpoint({
    summary: 'Create or replace the retention policy for one record category',
    operationId: 'privacyRetentionPoliciesUpsert',
    permissions: [PERMISSION_GROUPS.privacy.manage],
    statusCode: 201,
    errors: [{ status: 400, description: 'Unknown record category' }],
  })
  upsertRetentionPolicy(@Body() body: UpsertRetentionPolicyDto) {
    return this.privacy.upsertRetentionPolicy(body);
  }

  @Patch('retention-policies/:id')
  @ApiEndpoint({
    summary: 'Update a retention policy',
    operationId: 'privacyRetentionPoliciesUpdate',
    permissions: [PERMISSION_GROUPS.privacy.manage],
    errors: [{ status: 404, description: 'Retention policy not found' }],
  })
  updateRetentionPolicy(@Param('id') id: string, @Body() body: UpdateRetentionPolicyDto) {
    return this.privacy.updateRetentionPolicy(id, body);
  }

  @Post('retention/run')
  @ApiEndpoint({
    summary: 'Run the retention sweep (anonymize/archive expired records)',
    description:
      'Applies the enabled retention policies to records whose window has elapsed. A patient under an active legal hold is skipped, a REVIEW policy changes nothing, and financial/audit categories are reported only. Returns a per-category report of what changed, what was held, and what still needs a decision.',
    operationId: 'privacyRetentionRun',
    permissions: [PERMISSION_GROUPS.privacy.manage],
  })
  runRetention() {
    return this.privacy.runRetentionSweep();
  }

  @Post('patients/:id/anonymize')
  @ApiEndpoint({
    summary: 'Anonymize one patient record (data-subject erasure)',
    description:
      'Replaces the patient\'s direct identifiers with a stable, non-reversible subject key and archives the record. A patient under an active legal hold is refused with 409 LEGAL_HOLD_ACTIVE.',
    operationId: 'privacyPatientAnonymize',
    permissions: [PERMISSION_GROUPS.privacy.manage],
    errors: [
      { status: 404, description: 'Patient not found' },
      { status: 409, description: 'An active legal hold covers this patient' },
    ],
  })
  anonymizePatient(@Param('id') id: string) {
    return this.privacy.anonymizePatient(id);
  }

  // ---------------------------------------------------------------------------
  // legal holds
  // ---------------------------------------------------------------------------

  @Get('legal-holds')
  @ApiEndpoint({
    summary: 'List legal holds',
    operationId: 'privacyLegalHoldsList',
    permissions: [PERMISSION_GROUPS.privacy.read],
  })
  listLegalHolds(
    @Query('patientId') patientId?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.privacy.listLegalHolds({
      patientId,
      activeOnly: activeOnly === 'true',
    });
  }

  @Post('legal-holds')
  @ApiEndpoint({
    summary: 'Place a legal hold on a patient',
    description:
      'A legal hold makes the patient\'s record ineligible for automated deletion or anonymization. A patient may have only one active hold; a second attempt is refused rather than stacked.',
    operationId: 'privacyLegalHoldsPlace',
    permissions: [PERMISSION_GROUPS.privacy.manage],
    statusCode: 201,
    errors: [
      { status: 404, description: 'Patient not found' },
      { status: 409, description: 'An active legal hold already covers this patient' },
    ],
  })
  placeLegalHold(@Body() body: PlaceLegalHoldDto) {
    return this.privacy.placeLegalHold(body);
  }

  @Post('legal-holds/:id/release')
  @ApiEndpoint({
    summary: 'Release a legal hold',
    operationId: 'privacyLegalHoldsRelease',
    permissions: [PERMISSION_GROUPS.privacy.manage],
    errors: [
      { status: 404, description: 'Legal hold not found' },
      { status: 409, description: 'The hold was already released' },
    ],
  })
  releaseLegalHold(@Param('id') id: string, @Body() body: ReleaseLegalHoldDto) {
    return this.privacy.releaseLegalHold(id, body);
  }

  // ---------------------------------------------------------------------------
  // data exports
  // ---------------------------------------------------------------------------

  @Post('data-exports')
  @ApiEndpoint({
    summary: 'Request a data-subject export (asynchronous; poll for READY)',
    description:
      'Records the request and returns immediately. The artifact is built in the background and is downloadable for 24 hours once it is READY.',
    operationId: 'privacyDataExportsRequest',
    permissions: [PERMISSION_GROUPS.dataExports.request],
    statusCode: 202,
    errors: [{ status: 404, description: 'Patient not found' }],
  })
  requestDataExport(@Body() body: RequestDataExportDto) {
    return this.privacy.requestDataExport(body);
  }

  @Get('data-exports')
  @ApiEndpoint({
    summary: 'List data exports',
    operationId: 'privacyDataExportsList',
    permissions: [PERMISSION_GROUPS.dataExports.read],
  })
  listDataExports(@Query('status') status?: string) {
    return this.privacy.listDataExports(status ? { status } : {});
  }

  @Get('data-exports/:id')
  @ApiEndpoint({
    summary: 'Get one data export and its status',
    operationId: 'privacyDataExportsGet',
    permissions: [PERMISSION_GROUPS.dataExports.read],
    errors: [{ status: 404, description: 'Data export not found' }],
  })
  getDataExport(@Param('id') id: string) {
    return this.privacy.getDataExport(id);
  }

  /**
   * Streams the artifact.
   *
   * The bytes go through the API instead of being handed out as a presigned
   * URL: a presigned GET is a bearer capability that outlives the caller's
   * session and bypasses the organization check, which is the wrong trade for a
   * file full of patient data. Streaming keeps the download behind the
   * permission check and the audit trail.
   */
  @Get('data-exports/:id/download')
  @ApiEndpoint({
    summary: 'Download the export artifact as a stream before expiry',
    operationId: 'privacyDataExportsDownload',
    permissions: [PERMISSION_GROUPS.dataExports.read],
    errors: [
      { status: 404, description: 'Data export not found' },
      { status: 409, description: 'The export is still being generated, or failed' },
      { status: 410, description: 'The export has expired' },
    ],
  })
  async download(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const target = await this.exports.downloadTarget(id);
    if (!target.storageKey) {
      throw new AppError({
        code: ErrorCodes.DATA_EXPORT_NOT_READY,
        message: 'Data export has no artifact to download',
        silent: true,
      });
    }

    const stream = await this.storage.stream(
      target.storageKey,
      Math.max(target.sizeBytes ?? 0, MAX_EXPORT_ARTIFACT_BYTES),
    );

    reply.raw.setHeader('content-type', target.contentType);
    reply.raw.setHeader('content-length', String(target.sizeBytes ?? 0));
    reply.raw.setHeader('content-disposition', `attachment; filename="${target.filename}"`);
    // Patient data: never let a shared cache or a proxy keep a copy.
    reply.raw.setHeader('cache-control', 'private, no-store');

    const abort = (): void => {
      void stream.chunks.return?.(undefined);
    };
    req.raw.on('close', abort);

    try {
      for await (const chunk of stream.chunks) {
        if (!reply.raw.write(chunk)) {
          await new Promise<void>((resolve) => reply.raw.once('drain', resolve));
        }
      }
      reply.raw.end();
    } catch (err) {
      this.logger.warn(
        `data export ${id} download failed mid-stream: ${err instanceof Error ? err.message : String(err)}`,
      );
      reply.raw.destroy();
    } finally {
      req.raw.off('close', abort);
    }
  }
}
