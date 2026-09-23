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
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { DeviceAuthGuard } from '../../common/guards/device-auth.guard';
import { TenantContext } from '../../database/tenant-context';
import { RealtimeService } from '../../database/realtime.service';
import { DisplayService } from './display.service';
import {
  ListDisplayDevicesQueryDto,
  PairDisplayDeviceDto,
  RegisterDisplayDeviceDto,
  UpdateDisplayDeviceDto,
} from './dto/display.dto';

function requestIp(req: FastifyRequest): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return forwardedValue?.split(',')[0]?.trim() || req.ip || undefined;
}

@Controller('display/devices')
export class DisplayController {
  private readonly logger = new Logger(DisplayController.name);

  constructor(
    private readonly display: DisplayService,
    private readonly tenantContext: TenantContext,
    private readonly realtime: RealtimeService,
  ) {}

  // --- admin (staff, display.devices.manage) -------------------------------

  @Post()
  @ApiEndpoint({
    summary: 'Register a waiting-room display device (returns a one-time pairing code)',
    operationId: 'displayRegisterDevice',
    permissions: [PERMISSION_GROUPS.display.devicesManage],
    statusCode: 201,
    responseType: RegisterDisplayDeviceDto,
  })
  register(@Body() body: RegisterDisplayDeviceDto) {
    return this.display.register(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List display devices',
    operationId: 'displayListDevices',
    permissions: [PERMISSION_GROUPS.display.devicesManage],
    responseType: ListDisplayDevicesQueryDto,
  })
  list(@Query() query: ListDisplayDevicesQueryDto) {
    return this.display.list(query);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Update a display device (name / branch / departments)',
    operationId: 'displayUpdateDevice',
    permissions: [PERMISSION_GROUPS.display.devicesManage],
    responseType: UpdateDisplayDeviceDto,
  })
  update(@Param('id') id: string, @Body() body: UpdateDisplayDeviceDto) {
    return this.display.update(id, body);
  }

  @Post(':id/revoke')
  @ApiEndpoint({
    summary: 'Revoke a display device (kills its token immediately)',
    operationId: 'displayRevokeDevice',
    permissions: [PERMISSION_GROUPS.display.devicesManage],
    statusCode: 201,
    responseType: UpdateDisplayDeviceDto,
  })
  revoke(@Param('id') id: string) {
    return this.display.revoke(id);
  }

  @Post(':id/rotate-token')
  @ApiEndpoint({
    summary: 'Rotate a device token (the old one stops working at once)',
    operationId: 'displayRotateDeviceToken',
    permissions: [PERMISSION_GROUPS.display.devicesManage],
    statusCode: 201,
    responseType: UpdateDisplayDeviceDto,
  })
  rotateToken(@Param('id') id: string) {
    return this.display.rotateToken(id);
  }

  // --- pairing (public, IP rate-limited) -----------------------------------

  @Post('pair')
  @Public()
  @ApiEndpoint({
    summary: 'Exchange a pairing code for a device token (public, rate-limited per IP)',
    operationId: 'displayPairDevice',
    public: true,
    statusCode: 201,
    responseType: PairDisplayDeviceDto,
    errors: [
      { status: 401, description: 'Invalid or expired pairing code' },
      { status: 429, description: 'Too many pairing attempts (PAIRING_ATTEMPTS_EXCEEDED)' },
    ],
  })
  pair(@Body() body: PairDisplayDeviceDto, @Req() req: FastifyRequest) {
    return this.display.pair(body, requestIp(req));
  }

  // --- device-facing (DeviceAuthGuard, queue.display only) ------------------

  @Get('board')
  @Public()
  @UseGuards(DeviceAuthGuard)
  @ApiEndpoint({
    summary: 'PHI-free waiting-room board snapshot (device token)',
    operationId: 'displayBoard',
    public: true,
    responseType: PairDisplayDeviceDto,
    errors: [
      { status: 401, description: 'Invalid or revoked device token' },
    ],
  })
  board() {
    return this.display.snapshot();
  }

  @Get('stream')
  @Public()
  @UseGuards(DeviceAuthGuard)
  @ApiEndpoint({
    summary: 'Live waiting-room board stream (SSE, device token)',
    operationId: 'displayStream',
    public: true,
    errors: [
      { status: 401, description: 'Invalid or revoked device token' },
    ],
  })
  stream(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const scope = this.tenantContext.scope.device;
    if (!scope) {
      reply.code(401).send({ error: 'Device scope required.' });
      return;
    }

    reply.raw.setHeader('content-type', 'text/event-stream');
    reply.raw.setHeader('cache-control', 'no-cache, no-transform');
    reply.raw.setHeader('connection', 'keep-alive');
    reply.raw.setHeader('x-accel-buffering', 'no');
    reply.raw.write(`retry: 3000\n\n`);
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ deviceId: scope.deviceId })}\n\n`);

    const channel = this.realtime.channel(this.tenantContext.requireOrg(), 'queue');
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
      this.logger.error(
        { channel, err: err instanceof Error ? err.message : String(err) },
        'device stream subscribe failed',
      );
    });
    sub.on('message', (_ch: string, raw: string) => {
      try {
        if (!this.forScopes(raw, scope.departmentIds)) return;
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

  /** A device may only see events for its own departments (payload-driven). */
  private forScopes(raw: string, departmentIds: string[]): boolean {
    const parsed = JSON.parse(raw) as { payload?: { departmentId?: string } };
    if (!parsed.payload?.departmentId) return true;
    return departmentIds.includes(parsed.payload.departmentId);
  }
}