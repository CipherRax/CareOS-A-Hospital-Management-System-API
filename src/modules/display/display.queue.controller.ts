import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { DeviceAuthGuard } from '../../common/guards/device-auth.guard';
import type { Permission } from '../../common/auth/permissions.catalog';
import { DisplayService } from './display.service';

/**
 * Device-facing queue data at the brief §5.16 contract path `/display/queue`.
 * Authenticated with a display-device token; the device only ever receives the
 * PHI-free board for its own branch + departments (queue.display, ADR-023).
 */
@Controller('display')
export class DisplayQueueController {
  constructor(private readonly display: DisplayService) {}

  @Get('queue')
  @UseGuards(DeviceAuthGuard)
  @ApiEndpoint({
    summary: 'PHI-free waiting-room queue data for this device (device token)',
    operationId: 'displayDeviceQueue',
    public: true,
    permissions: ['queue.display' as Permission],
    errors: [{ status: 401, description: 'Invalid or revoked device token' }],
  })
  queue() {
    return this.display.snapshot();
  }
}