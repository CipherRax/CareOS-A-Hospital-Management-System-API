import { Body, Controller, Get, Logger, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { ObjectStorageService } from '../../common/storage/object-storage.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { MAX_REPORT_ARTIFACT_BYTES } from './domain/report-document';
import { ReportsService } from './reports.service';
import { ExportReportDto, ReportExportsListQueryDto } from './dto/insights.dto';

@Controller('reports')
export class ReportsController {
  private readonly logger = new Logger(ReportsController.name);

  constructor(
    private readonly reports: ReportsService,
    private readonly storage: ObjectStorageService,
  ) {}

  @Post('export')
  @ApiEndpoint({
    summary: 'Request a report export (JSON/CSV/PDF); poll for READY, 24h expiry',
    operationId: 'reportsExport',
    permissions: [PERMISSION_GROUPS.reports.read],
    statusCode: 202,
    errors: [
      { status: 422, description: 'Invalid report type/format or window' },
    ],
  })
  export(@Body() body: ExportReportDto) {
    return this.reports.exportReport(body);
  }

  @Get('exports')
  @ApiEndpoint({
    summary: 'List report exports',
    operationId: 'reportsExportsList',
    permissions: [PERMISSION_GROUPS.reports.read],
  })
  list(@Query() query: ReportExportsListQueryDto) {
    return this.reports.list(query);
  }

  @Get('exports/:id')
  @ApiEndpoint({
    summary: 'Get one report export and its generation status',
    operationId: 'reportsExportsGet',
    permissions: [PERMISSION_GROUPS.reports.read],
    errors: [{ status: 404, description: 'Report export not found' }],
  })
  get(@Param('id') id: string) {
    return this.reports.get(id);
  }

  /**
   * Streams the artifact.
   *
   * The bytes are served through the API rather than handed out as a presigned
   * URL, which is what document downloads do. A presigned GET would be simpler
   * and would keep the bytes off this process, but the URL it mints is a bearer
   * capability: once issued it is unaudited, it outlives the caller's session,
   * and it bypasses the organization check that everything else here goes
   * through. For a multi-megabyte patient-data file that trade is the wrong way
   * round, so the stream stays behind the permission check and the audit trail.
   *
   * Memory is bounded by the chunk size rather than the file size: chunks are
   * pulled from object storage and written to the socket one at a time, and the
   * cap stops a mismatched object from streaming forever.
   */
  @Get('exports/:id/download')
  @ApiEndpoint({
    summary: 'Download the export artifact as a stream before expiry',
    operationId: 'reportsExportsDownload',
    permissions: [PERMISSION_GROUPS.reports.read],
    errors: [
      { status: 404, description: 'Report export not found' },
      { status: 409, description: 'Report is still generating, or failed' },
      { status: 410, description: 'Report has expired' },
    ],
  })
  async download(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const target = await this.reports.downloadTarget(id);
    if (!target.artifactKey) {
      // Unreachable while the service and row agree, but streaming `undefined`
      // would produce a 200 with an empty body, which is the worst outcome.
      // Thrown rather than sent by hand so it goes through the same envelope
      // and error filter as every other failure on this route.
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: 'Report has no artifact to download',
        silent: true,
      });
    }

    // The size recorded when the artifact was written. It is the authoritative
    // length, and it goes out as Content-Length so the client can show a
    // progress bar — but it is *not* the read cap. The cap is a runaway guard
    // sized off what this kind of report can plausibly weigh, not off the row:
    // an object that has grown far past its recorded size is corrupt or
    // substituted, and the response should fail rather than quietly ship
    // megabytes nobody asked for. A legitimate file is never truncated, since
    // the cap is orders of magnitude above the recorded size.
    const stream = await this.storage.stream(
      target.artifactKey,
      Math.max(target.sizeBytes ?? 0, MAX_REPORT_ARTIFACT_BYTES),
    );

    reply.raw.setHeader('content-type', target.contentType ?? 'application/octet-stream');
    reply.raw.setHeader('content-length', String(target.sizeBytes ?? 0));
    reply.raw.setHeader('content-disposition', `attachment; filename="${target.filename}"`);
    // Patient data: never let a shared cache or a proxy keep a copy.
    reply.raw.setHeader('cache-control', 'private, no-store');
    // A caller that hangs up mid-download must not leave the socket open.
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
      // The status line is already sent by this point, so there is nothing
      // useful left to return — just stop writing and let the socket close.
      this.logger.warn(
        `report export ${id} download failed mid-stream: ${err instanceof Error ? err.message : String(err)}`,
      );
      reply.raw.destroy();
    } finally {
      req.raw.off('close', abort);
    }
  }
}
