import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { RealtimeService } from '../../database/realtime.service';
import { TenantContext } from '../../database/tenant-context';
import { EmergencyIntakeService, REQUESTS_TOPIC } from './emergency-intake.service';
import {
  LinkArrivalVisitDto,
  ListEmergencyRequestsQueryDto,
  MergeRequestDto,
  RecordCallbackDto,
  SetRequestStatusDto,
  StaffNoteDto,
} from './dto/emergency-intake.dto';

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
    // Guards against a double teardown when both the subscribe failure and the
    // client 'close' event fire.
    let finished = false;
    const heartbeat = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 15_000);
    const closed = () => {
      if (finished) return;
      finished = true;
      clearInterval(heartbeat);
      sub.quit().catch(() => {});
      // Release the connection rather than only silencing it: a half-closed SSE
      // stream holds a socket per open inbox tab.
      try {
        reply.raw.end();
      } catch {
        // Already torn down by the client.
      }
    };
    req.raw.on('close', closed);
    reply.raw.on('error', closed);

    sub.subscribe(channel).catch((err: unknown) => {
      // Tell the client first: closing without a reason shows an inbox that
      // silently stops updating, which looks identical to "no new requests".
      reply.raw.write(
        `event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n\n`,
      );
      closed();
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

  @Post(':id/contacted')
  @ApiEndpoint({
    summary: 'Mark that a staff member reached the caller (not that help is coming)',
    operationId: 'contactedEmergencyRequest',
    statusCode: 201,
    permissions: [PERMISSION_GROUPS.emergencyRequests.manage],
    errors: [
      { status: 404, description: 'Request not found', code: 'RESOURCE_NOT_FOUND' },
      {
        status: 409,
        description: 'Request already finished (closed, cancelled, redirected, unreachable)',
        code: 'EMERGENCY_INVALID_TRANSITION',
      },
    ],
  })
  contacted(@Param('id') id: string) {
    return this.intake.markContacted(id);
  }

  @Post(':id/callback')
  @ApiEndpoint({
    summary: 'Record a callback attempt and whether it reached the caller',
    operationId: 'recordEmergencyCallback',
    statusCode: 201,
    permissions: [PERMISSION_GROUPS.emergencyRequests.manage],
    errors: [
      { status: 404, description: 'Request not found', code: 'RESOURCE_NOT_FOUND' },
      {
        status: 409,
        description: 'Request already closed',
        code: 'EMERGENCY_INVALID_TRANSITION',
      },
    ],
  })
  callback(@Param('id') id: string, @Body() body: RecordCallbackDto) {
    return this.intake.recordCallback(id, body);
  }

  @Post(':id/status')
  @ApiEndpoint({
    summary: 'Set unreachable / redirected / not-actionable (a reason is required except when unreachable)',
    operationId: 'setEmergencyRequestStatus',
    statusCode: 201,
    permissions: [PERMISSION_GROUPS.emergencyRequests.manage],
    errors: [
      { status: 400, description: 'Reason required for redirected / not actionable', code: 'VALIDATION_ERROR' },
      { status: 404, description: 'Request not found', code: 'RESOURCE_NOT_FOUND' },
      { status: 409, description: 'Request already closed', code: 'EMERGENCY_INVALID_TRANSITION' },
    ],
  })
  status(@Param('id') id: string, @Body() body: SetRequestStatusDto) {
    return this.intake.setRequestStatus(id, body);
  }

  @Post(':id/link-arrival')
  @ApiEndpoint({
    summary: 'Link this request to the emergency-department arrival it produced',
    operationId: 'linkEmergencyRequestArrival',
    statusCode: 201,
    permissions: [PERMISSION_GROUPS.emergencyRequests.manage],
    errors: [
      { status: 404, description: 'Request or visit not found', code: 'RESOURCE_NOT_FOUND' },
      {
        status: 409,
        description: 'Visit is from another branch, or the request is already linked',
        code: 'EMERGENCY_INVALID_TRANSITION',
      },
    ],
  })
  linkArrival(@Param('id') id: string, @Body() body: LinkArrivalVisitDto) {
    return this.intake.linkArrivalVisit(id, body);
  }

  @Post(':id/merge')
  @ApiEndpoint({
    summary: 'Merge a duplicate request into the canonical request',
    operationId: 'mergeEmergencyRequest',
    statusCode: 201,
    permissions: [PERMISSION_GROUPS.emergencyRequests.manage],
    errors: [
      { status: 404, description: 'Request or target not found', code: 'RESOURCE_NOT_FOUND' },
      {
        status: 409,
        description: 'Already merged, or requests are from different branches',
        code: 'EMERGENCY_INVALID_TRANSITION',
      },
    ],
  })
  merge(@Param('id') id: string, @Body() body: MergeRequestDto) {
    return this.intake.mergeRequest(id, body);
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