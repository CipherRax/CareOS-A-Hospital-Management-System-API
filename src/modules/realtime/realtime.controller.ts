import {
  Controller,
  Get,
  Logger,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { TenantContext } from '../../database/tenant-context';
import { RealtimeService } from '../../database/realtime.service';

const ALLOWED_TOPICS = new Set(['appointments', 'queue', 'vitals', 'display']);

/**
 * Staff SSE stream. Subscribes to the tenant's app channels and forwards each
 * live event. All payloads on these channels are already PHI-free by design.
 */
@Controller('realtime')
export class RealtimeController {
  private readonly logger = new Logger(RealtimeController.name);

  constructor(
    private readonly tenantContext: TenantContext,
    private readonly realtime: RealtimeService,
  ) {}

  @Get('stream')
  @ApiEndpoint({
    summary: 'Live event stream for staff clients (SSE)',
    description:
      'Accepts ?topics=queue,appointments,vitals,display. Each event is a PHI-free JSON envelope published by the domain services.',
    operationId: 'realtimeStream',
    permissions: [PERMISSION_GROUPS.queue.read],
    errors: [
      { status: 400, description: 'Unknown topic requested' },
    ],
  })
  stream(
    @Query('topics') topicsRaw: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const organizationId = this.tenantContext.requireOrg();
    const requested = (topicsRaw ?? 'queue')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    for (const topic of requested) {
      if (!ALLOWED_TOPICS.has(topic)) {
        reply.code(400).send({ error: `Unknown topic: ${topic}` });
        return;
      }
    }
    const topics = requested.length > 0 ? requested : ['queue'];

    reply.raw.setHeader('content-type', 'text/event-stream');
    reply.raw.setHeader('cache-control', 'no-cache, no-transform');
    reply.raw.setHeader('connection', 'keep-alive');
    reply.raw.setHeader('x-accel-buffering', 'no');
    reply.raw.write(`retry: 3000\n\n`);
    reply.raw.write(
      `event: connected\ndata: ${JSON.stringify({ topics, organizationId })}\n\n`,
    );

    const sub = this.realtime.subscriber();
    const channels = topics.map((t) => this.realtime.channel(organizationId, t));
    const heartbeat = setInterval(() => {
      reply.raw.write(': ping\n\n');
    }, 15_000);
    const closed = () => {
      clearInterval(heartbeat);
      sub.quit().catch(() => {});
    };
    req.raw.on('close', closed);
    reply.raw.on('error', closed);

    sub.subscribe(...channels).catch((err: unknown) => {
      this.logger.error(
        { channels, err: err instanceof Error ? err.message : String(err) },
        'realtime subscribe failed',
      );
    });
    sub.on('message', (_ch: string, raw: string) => {
      try {
        reply.raw.write(`data: ${raw}\n\n`);
      } catch {
        closed();
      }
    });

    return new Promise<void>((resolve) => {
      reply.raw.on('close', () => resolve());
      req.raw.on('close', () => resolve());
    });
  }
}