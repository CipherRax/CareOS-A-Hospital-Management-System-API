import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { MpesaService } from './mpesa.service';
import {
  GetReconciliationResponseDto,
  InitiateStkPushDto,
  ListReconciliationsQueryDto,
  ListReconciliationsResponseDto,
  ListRequestsQueryDto,
  ListRequestsResponseDto,
  MpesaCallbackResponseDto,
  MpesaReconciliationMatchResponseDto,
  MpesaRequestResponseDto,
  ReconcileDto,
  ReconcileResponseDto,
  ResolveMatchDto,
  StatusQueryResponseDto,
} from './dto/mpesa.dto';

const CALLBACK_SECRET_HEADER = 'x-careos-mpesa-callback-secret';

@Controller()
export class MpesaController {
  constructor(private readonly mpesa: MpesaService) {}

  // ─── STK push ──────────────────────────────────────────────────────────────

  @Post('mpesa/stk-push')
  @ApiEndpoint({
    summary: 'Initiate an M-PESA STK push for an issued invoice',
    operationId: 'mpesaStkPush',
    permissions: [PERMISSION_GROUPS.mpesa.initiate],
    statusCode: 201,
    responseType: MpesaRequestResponseDto,
    errors: [
      { status: 404, description: 'Invoice not found' },
      { status: 409, description: 'Invoice not payable or amount exceeds balance' },
      { status: 503, description: 'Provider unavailable (MPESA_PROVIDER_UNAVAILABLE)' },
    ],
  })
  stkPush(@Body() body: InitiateStkPushDto) {
    return this.mpesa.initiateStkPush(body);
  }

  @Get('mpesa/requests')
  @ApiEndpoint({
    summary: 'List M-PESA requests (filters + pagination)',
    operationId: 'mpesaRequestsList',
    permissions: [PERMISSION_GROUPS.mpesa.read],
    responseType: ListRequestsResponseDto,
  })
  listRequests(@Query() query: ListRequestsQueryDto) {
    return this.mpesa.listRequests(query);
  }

  @Get('mpesa/requests/:id')
  @ApiEndpoint({
    summary: 'Get an M-PESA request',
    operationId: 'mpesaRequestsGet',
    permissions: [PERMISSION_GROUPS.mpesa.read],
    responseType: MpesaRequestResponseDto,
  })
  getRequest(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.mpesa.getRequest(id);
  }

  @Post('mpesa/requests/:id/status-query')
  @ApiEndpoint({
    summary: 'Query provider status for an in-flight request',
    operationId: 'mpesaRequestsStatusQuery',
    permissions: [PERMISSION_GROUPS.mpesa.read],
    statusCode: 200,
    responseType: StatusQueryResponseDto,
  })
  statusQuery(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.mpesa.statusQuery(id);
  }

  // ─── Callback (public webhook from Safaricom) ─────────────────────────────

  @Post('mpesa/callback')
  @ApiEndpoint({
    summary:
      'Safecom STK callback (public). Acknowledged with the Daraja ack when processed or a no-op for unknown requests.',
    operationId: 'mpesaCallback',
    public: true,
    statusCode: 200,
    responseType: MpesaCallbackResponseDto,
    errors: [
      { status: 401, description: 'Missing or invalid callback secret' },
      { status: 400, description: 'Malformed callback body' },
    ],
  })
  callback(
    @Headers(CALLBACK_SECRET_HEADER) secret: string | undefined,
    @Body() body: unknown,
  ) {
    return this.mpesa.handleCallback(secret, body);
  }

  // ─── Reconciliation ────────────────────────────────────────────────────────

  @Post('mpesa/reconcile')
  @ApiEndpoint({
    summary: 'Run reconciliation (default window: last 24h)',
    operationId: 'mpesaReconcile',
    permissions: [PERMISSION_GROUPS.mpesa.reconcile],
    statusCode: 201,
    responseType: ReconcileResponseDto,
  })
  reconcile(@Body() body: ReconcileDto) {
    return this.mpesa.reconcile(body);
  }

  @Get('mpesa/reconciliations')
  @ApiEndpoint({
    summary: 'List reconciliation runs',
    operationId: 'mpesaReconciliationsList',
    permissions: [PERMISSION_GROUPS.mpesa.read],
    responseType: ListReconciliationsResponseDto,
  })
  listReconciliations(@Query() query: ListReconciliationsQueryDto) {
    return this.mpesa.listReconciliations(query);
  }

  @Get('mpesa/reconciliations/:id')
  @ApiEndpoint({
    summary: 'Get a reconciliation run with its matches',
    operationId: 'mpesaReconciliationsGet',
    permissions: [PERMISSION_GROUPS.mpesa.read],
    responseType: GetReconciliationResponseDto,
  })
  getReconciliation(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.mpesa.getReconciliation(id);
  }

  @Post('mpesa/matches/:id/resolve')
  @ApiEndpoint({
    summary: 'Resolve a reconciliation match (audited stamp, no mutation)',
    operationId: 'mpesaReconciliationsResolve',
    permissions: [PERMISSION_GROUPS.mpesa.reconcile],
    statusCode: 201,
    responseType: MpesaReconciliationMatchResponseDto,
    errors: [
      { status: 409, description: 'Already resolved (RECONCILIATION_ALREADY_RESOLVED)' },
    ],
  })
  resolveMatch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ResolveMatchDto,
  ) {
    return this.mpesa.resolveMatch(id, body);
  }
}