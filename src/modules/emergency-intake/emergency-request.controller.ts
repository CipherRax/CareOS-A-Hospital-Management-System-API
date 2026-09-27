import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { RealtimeService } from '../../database/realtime.service';
import { TenantContext } from '../../database/tenant-context';
import { EmergencyIntakeService, REQUESTS_TOPIC } from './emergency-intake.service';
import { ListEmergencyRequestsQueryDto, StaffNoteDto } from './dto/emergency-intake.dto';

/**
 * Staff emergency-request inbox (brief §6.15). Reads/actions are audited and
 * the two status transitions (acknowledge → respond) are the only signals that
 * stop the caller-facing CALL_NOW guidance; every transition is append-logged.
 */
@Controller('emergency/requests')
export class EmergencyRequestController {
  constructor(
    private readonly intake: EmergencyIntakeService,
    private readonly realtime: RealtimeService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Get()
  @ApiEndpoint({
    summary: 'List incoming emergency help requests for this organization',
    operationId: 'listEmergencyRequests',
    permissions: [PERMISSION_GROUPS.emergencyRequests.read],
    errors: [{ status: 404, description: 'Branch not found' }],
    example: {
      data: {
        items: [
          {
            id: '…',
            referenceNumber: 'EMR-2026-000042',
            status: 'RECEIVED',
            escalationLevel: 1,
            callerName: '…',
            callerPhone: '+254 7…',
            description: '…',
            location: { lat: -1.29, lng: 36.82, landmark: '…' },
            createdAt: '2026-09-27T10:00:00.000Z',
          },
        ],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      },
    },
  })
  list(@Query() query: ListEmergencyRequestsQueryDto) {
    return this.intake.listRequests(query);
  }

  @Get('stream')
  @ApiEndpoint({
    summary: 'Live inbox stream over SSE (new requests and status transitions)',
    operationId: 'streamEmergencyRequests',
    permissions: [PERMISSION_GROUPS.emergencyRequests.read],
  })
  stream(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const organizationId = this.tenantContext.requireOrg();

    reply.raw.setHeader('content-type', 'text/event-stream');
    reply.raw.setHeader('cache-control', 'no-cache, no-transform');
    reply.raw.setHeader('connection', 'keep-alive');
    reply.raw.setHeader('x-accel-buffering', 'no');
    reply.raw.write(`retry: 3000\n\n`);
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    const channel = this.realtime.channel(organizationId, REQUESTS_TOPIC);
    const sub = this.realtime.subscriber();
    const heartbeat = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 15_000);
    const closed = () => {
      clearInterval(heartbeat);
      sub.quit().catch(() => {});
    };
    req.raw.on('close', closed);
    reply.raw.on('error', closed);

    sub.subscribe(channel).catch((err: unknown) => {
      closed();
      reply.raw.write(
        `event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n\n`,
      );
    });
    sub.on('message', (_ch: unknown, raw: string) => {
      reply.raw.write(`event: emergency\ndata: ${raw}\n\n`);
    });
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'One request with its append-only event history',
    operationId: 'getEmergencyRequest',
    permissions: [PERMISSION_GROUPS.emergencyRequests.read],
    errors: [{ status: 404, description: 'Request not found', code: 'RESOURCE_NOT_FOUND' }],
  })
  get(@Param('id') id: string) {
    return this.intake.getRequest(id);
  }

  @Post(':id/acknowledge')
  @ApiEndpoint({
    summary: 'Acknowledge a request (stops autonomous escalation)',
    operationId: 'acknowledgeEmergencyRequest',
    statusCode: 201,
    permissions: [PERMISSION_GROUPS.emergencyRequests.manage],
    errors: [{ status: 404, description: 'Request not found', code: 'RESOURCE_NOT_FOUND' }],
  })
  acknowledge(@Param('id') id: string) {
    return this.intake.acknowledgeRequest(id);
  }

  @Post(':id/respond')
  @ApiEndpoint({
    summary: 'Mark a responder as on the way (help is confirmed)',
    operationId: 'respondEmergencyRequest',
    statusCode: 201,
    permissions: [PERMISSION_GROUPS.emergencyRequests.manage],
    errors: [{ status: 404, description: 'Request not found', code: 'RESOURCE_NOT_FOUND' }],
  })
  respond(@Param('id') id: string) {
    return this.intake.respondRequest(id);
  }

  @Post(':id/note')
  @ApiEndpoint({
    summary: 'Attach an encrypted staff note to a request',
    operationId: 'noteEmergencyRequest',
    statusCode: 201,
    permissions: [PERMISSION_GROUPS.emergencyRequests.manage],
    errors: [{ status: 404, description: 'Request not found', code: 'RESOURCE_NOT_FOUND' }],
  })
  note(@Param('id') id: string, @Body() body: StaffNoteDto) {
    return this.intake.noteRequest(id, body);
  }

  @Post(':id/close')
  @ApiEndpoint({
    summary: 'Close a resolved or superseded request',
    operationId: 'closeEmergencyRequest',
    statusCode: 201,
    permissions: [PERMISSION_GROUPS.emergencyRequests.manage],
    errors: [{ status: 404, description: 'Request not found', code: 'RESOURCE_NOT_FOUND' }],
  })
  close(@Param('id') id: string) {
    return this.intake.closeRequest(id);
  }
}