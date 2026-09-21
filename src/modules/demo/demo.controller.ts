import { Body, Controller, Post } from '@nestjs/common';
import { DemoService } from './demo.service';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { EmitProbeDto, EmitProbeResponseDto } from './dto/demo.dto';

/**
 * DEMO-ONLY module exercising the Phase 0 pipeline (tenant extension, TxRunner,
 * outbox, audit, idempotency). Disabled in production via env guard in the demo
 * module provider; do not ship as production API surface.
 */
@Controller('_demo')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Post('outbox')
  @ApiEndpoint({
    summary: 'DEMO — write an audit row and emit an outbox event in one transaction',
    operationId: 'demoOutboxProbe',
    permissions: [PERMISSION_GROUPS.organizations.manage],
    responseType: EmitProbeResponseDto,
    statusCode: 201,
    errors: [{ status: 409, description: 'Idempotency conflict' }],
  })
  emitProbe(@Body() body: EmitProbeDto) {
    return this.demo.emitProbe(body.label);
  }
}
