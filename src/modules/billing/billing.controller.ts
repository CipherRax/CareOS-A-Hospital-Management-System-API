import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { BillingService } from './billing.service';
import {
  ActionClaimDto,
  ActionInvoiceDto,
  BillableItemResponseDto,
  CreateBillableItemDto,
  CreateClaimDto,
  CreateInsurancePayerDto,
  CreateInvoiceDto,
  CreatePatientInsurancePolicyDto,
  CreatePaymentDto,
  InsuranceClaimResponseDto,
  InsurancePayerResponseDto,
  InvoiceResponseDto,
  ListBillableItemsQueryDto,
  ListClaimsQueryDto,
  ListInvoicesQueryDto,
  ListPaymentsQueryDto,
  ListPoliciesQueryDto,
  PatientInsurancePolicyResponseDto,
  PaymentResponseDto,
  RefundPaymentDto,
  UpdateBillableItemDto,
} from './dto/billing.dto';

@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // ─── Price-list / billable items ────────────────────────────────────────────

  @Post('billable-items')
  @ApiEndpoint({
    summary: 'Create a billable item (price-list entry)',
    operationId: 'billableItemsCreate',
    permissions: [PERMISSION_GROUPS.billing.create],
    statusCode: 201,
    responseType: BillableItemResponseDto,
    errors: [{ status: 409, description: 'Duplicate name + category in the org' }],
  })
  createBillableItem(@Body() body: CreateBillableItemDto) {
    return this.billing.createBillableItem(body);
  }

  @Get('billable-items')
  @ApiEndpoint({
    summary: 'List billable items (filters + pagination)',
    operationId: 'billableItemsList',
    permissions: [PERMISSION_GROUPS.billing.read],
    responseType: ListBillableItemsQueryDto,
  })
  listBillableItems(@Query() query: ListBillableItemsQueryDto) {
    return this.billing.listBillableItems(query);
  }

  @Patch('billable-items/:id')
  @ApiEndpoint({
    summary: 'Update a billable item (price, active state, insurance eligibility)',
    operationId: 'billableItemsUpdate',
    permissions: [PERMISSION_GROUPS.billing.manage],
    responseType: BillableItemResponseDto,
    errors: [{ status: 409, description: 'Optimistic lock conflict' }],
  })
  updateBillableItem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateBillableItemDto,
  ) {
    return this.billing.updateBillableItem(id, body);
  }

  // ─── Invoices ───────────────────────────────────────────────────────────────

  @Post('invoices')
  @ApiEndpoint({
    summary: 'Create an invoice (DRAFT)',
    operationId: 'invoicesCreate',
    permissions: [PERMISSION_GROUPS.billing.create],
    statusCode: 201,
    responseType: InvoiceResponseDto,
    errors: [
      { status: 404, description: 'Branch, patient, billable item or medication not found' },
      { status: 400, description: 'Invalid line (missing price/description, inactive item, branch mismatch)' },
    ],
  })
  createInvoice(@Body() body: CreateInvoiceDto) {
    return this.billing.createInvoice(body);
  }

  @Get('invoices')
  @ApiEndpoint({
    summary: 'List invoices (filters + pagination)',
    operationId: 'invoicesList',
    permissions: [PERMISSION_GROUPS.billing.read],
    responseType: ListInvoicesQueryDto,
  })
  listInvoices(@Query() query: ListInvoicesQueryDto) {
    return this.billing.listInvoices(query);
  }

  @Get('invoices/:id')
  @ApiEndpoint({
    summary: 'Get an invoice with its items and payments',
    operationId: 'invoicesGet',
    permissions: [PERMISSION_GROUPS.billing.read],
    responseType: InvoiceResponseDto,
    errors: [{ status: 404, description: 'Invoice not found' }],
  })
  getInvoice(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.billing.getInvoice(id);
  }

  @Post('invoices/:id/issue')
  @ApiEndpoint({
    summary: 'Issue a DRAFT invoice',
    operationId: 'invoicesIssue',
    permissions: [PERMISSION_GROUPS.billing.create],
    statusCode: 201,
    responseType: InvoiceResponseDto,
    errors: [{ status: 409, description: 'Invalid workflow transition' }],
  })
  issueInvoice(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: ActionInvoiceDto) {
    return this.billing.issueInvoice(id, body);
  }

  @Post('invoices/:id/cancel')
  @ApiEndpoint({
    summary: 'Cancel an unpaid invoice',
    operationId: 'invoicesCancel',
    permissions: [PERMISSION_GROUPS.billing.manage],
    statusCode: 201,
    responseType: InvoiceResponseDto,
    errors: [{ status: 409, description: 'Only DRAFT/ISSUED invoices can be cancelled' }],
  })
  cancelInvoice(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: ActionInvoiceDto) {
    return this.billing.cancelInvoice(id, body);
  }

  @Post('invoices/:id/refund')
  @ApiEndpoint({
    summary: 'Refund a fully-paid invoice (refunds all its payments)',
    operationId: 'invoicesRefund',
    permissions: [PERMISSION_GROUPS.payments.refund],
    statusCode: 201,
    responseType: InvoiceResponseDto,
    errors: [
      { status: 409, description: 'Only a PAID invoice can be refunded' },
    ],
  })
  refundInvoice(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: ActionInvoiceDto) {
    return this.billing.refundInvoice(id, body);
  }

  @Post('invoices/:id/payments')
  @ApiEndpoint({
    summary: 'Record a payment against an issued invoice',
    operationId: 'invoicesCreatePayment',
    permissions: [PERMISSION_GROUPS.payments.create],
    statusCode: 201,
    responseType: PaymentResponseDto,
    errors: [
      { status: 409, description: 'Over-payment or invoice not payable' },
      { status: 404, description: 'Invoice not found' },
    ],
  })
  createPayment(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: CreatePaymentDto) {
    return this.billing.createPayment(id, body);
  }

  @Get('invoices/:id/payments')
  @ApiEndpoint({
    summary: 'List payments for an invoice',
    operationId: 'invoicesListPayments',
    permissions: [PERMISSION_GROUPS.billing.read],
    responseType: ListPaymentsQueryDto,
  })
  listInvoicePayments(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.billing.listPayments({ invoiceId: id });
  }

  // ─── Payments ───────────────────────────────────────────────────────────────

  @Get('payments')
  @ApiEndpoint({
    summary: 'List payments (filters + pagination)',
    operationId: 'paymentsList',
    permissions: [PERMISSION_GROUPS.billing.read],
    responseType: ListPaymentsQueryDto,
  })
  listPayments(@Query() query: ListPaymentsQueryDto) {
    return this.billing.listPayments(query);
  }

  @Get('payments/:id')
  @ApiEndpoint({
    summary: 'Get a payment',
    operationId: 'paymentsGet',
    permissions: [PERMISSION_GROUPS.billing.read],
    responseType: PaymentResponseDto,
    errors: [{ status: 404, description: 'Payment not found' }],
  })
  getPayment(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.billing.getPayment(id);
  }

  @Post('payments/:id/refund')
  @ApiEndpoint({
    summary: 'Refund a completed payment (restores the invoice balance)',
    operationId: 'paymentsRefund',
    permissions: [PERMISSION_GROUPS.payments.refund],
    statusCode: 201,
    responseType: PaymentResponseDto,
    errors: [
      { status: 409, description: 'Only a completed payment can be refunded' },
    ],
  })
  refundPayment(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: RefundPaymentDto) {
    return this.billing.refundPayment(id, body);
  }

  // ─── Insurance: payers ──────────────────────────────────────────────────────

  @Post('insurance/payers')
  @ApiEndpoint({
    summary: 'Create an insurance payer',
    operationId: 'insurancePayersCreate',
    permissions: [PERMISSION_GROUPS.insurance.manage],
    statusCode: 201,
    responseType: InsurancePayerResponseDto,
    errors: [{ status: 409, description: 'Payer name already exists' }],
  })
  createPayer(@Body() body: CreateInsurancePayerDto) {
    return this.billing.createPayer(body);
  }

  @Get('insurance/payers')
  @ApiEndpoint({
    summary: 'List insurance payers',
    operationId: 'insurancePayersList',
    permissions: [PERMISSION_GROUPS.insurance.read],
    responseType: InsurancePayerResponseDto,
  })
  listPayers() {
    return this.billing.listPayers();
  }

  // ─── Insurance: patient policies ────────────────────────────────────────────

  @Post('insurance/policies')
  @ApiEndpoint({
    summary: 'Create a patient insurance policy',
    operationId: 'insurancePoliciesCreate',
    permissions: [PERMISSION_GROUPS.insurance.manage],
    statusCode: 201,
    responseType: PatientInsurancePolicyResponseDto,
    errors: [
      { status: 404, description: 'Patient or payer not found' },
      { status: 400, description: 'PARTIAL coverage requires coveragePercent' },
    ],
  })
  createPolicy(@Body() body: CreatePatientInsurancePolicyDto) {
    return this.billing.createPolicy(body);
  }

  @Get('insurance/policies')
  @ApiEndpoint({
    summary: 'List patient insurance policies',
    operationId: 'insurancePoliciesList',
    permissions: [PERMISSION_GROUPS.insurance.read],
    responseType: ListPoliciesQueryDto,
  })
  listPolicies(@Query() query: ListPoliciesQueryDto) {
    return this.billing.listPolicies(query);
  }

  // ─── Insurance: claims ──────────────────────────────────────────────────────

  @Post('insurance/claims')
  @ApiEndpoint({
    summary: 'Create an insurance claim (DRAFT)',
    operationId: 'insuranceClaimsCreate',
    permissions: [PERMISSION_GROUPS.insurance.manage],
    statusCode: 201,
    responseType: InsuranceClaimResponseDto,
    errors: [
      { status: 400, description: 'Claim exceeds invoice total or policy/patient mismatch' },
      { status: 404, description: 'Invoice or policy not found' },
    ],
  })
  createClaim(@Body() body: CreateClaimDto) {
    return this.billing.createClaim(body);
  }

  @Get('insurance/claims')
  @ApiEndpoint({
    summary: 'List insurance claims (filters + pagination)',
    operationId: 'insuranceClaimsList',
    permissions: [PERMISSION_GROUPS.insurance.read],
    responseType: ListClaimsQueryDto,
  })
  listClaims(@Query() query: ListClaimsQueryDto) {
    return this.billing.listClaims(query);
  }

  @Get('insurance/claims/:id')
  @ApiEndpoint({
    summary: 'Get an insurance claim',
    operationId: 'insuranceClaimsGet',
    permissions: [PERMISSION_GROUPS.insurance.read],
    responseType: InsuranceClaimResponseDto,
    errors: [{ status: 404, description: 'Claim not found' }],
  })
  getClaim(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.billing.getClaim(id);
  }

  @Post('insurance/claims/:id/action')
  @ApiEndpoint({
    summary: 'Submit, approve, partially approve, deny or pay a claim',
    operationId: 'insuranceClaimsAction',
    permissions: [PERMISSION_GROUPS.insurance.manage],
    statusCode: 201,
    responseType: InsuranceClaimResponseDto,
    errors: [
      { status: 409, description: 'Invalid workflow transition' },
      { status: 400, description: 'Invalid approvedAmount or missing deny reason' },
    ],
  })
  claimAction(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: ActionClaimDto) {
    return this.billing.claimAction(id, body);
  }
}