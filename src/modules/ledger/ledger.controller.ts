import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { LedgerService } from './ledger.service';
import {
  ChartAccountResponseDto,
  CreateAccountDto,
  CreateJournalDto,
  CreatePeriodDto,
  FinanceTransactionResponseDto,
  FinancialPeriodResponseDto,
  ListAccountsQueryDto,
  ListJournalResponseDto,
  ListJournalQueryDto,
  ListPeriodsQueryDto,
  ReverseJournalDto,
  TrialBalanceResponseDto,
  UpdateAccountDto,
} from './dto/ledger.dto';

@Controller()
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  // ─── Chart of accounts ─────────────────────────────────────────────────────

  @Get('ledger/accounts')
  @ApiEndpoint({
    summary: 'List chart of accounts (optional category/active filter)',
    operationId: 'ledgerAccountsList',
    permissions: [PERMISSION_GROUPS.ledger.read],
    responseType: ListAccountsQueryDto,
  })
  listAccounts(@Query() query: ListAccountsQueryDto) {
    return this.ledger.listAccounts(query);
  }

  @Post('ledger/accounts')
  @ApiEndpoint({
    summary: 'Create a chart account (custom accounts only; defaults auto-seed)',
    operationId: 'ledgerAccountsCreate',
    permissions: [PERMISSION_GROUPS.ledger.manage],
    statusCode: 201,
    responseType: ChartAccountResponseDto,
    errors: [{ status: 409, description: 'Account code already exists' }],
  })
  createAccount(@Body() body: CreateAccountDto) {
    return this.ledger.createAccount(body);
  }

  @Get('ledger/accounts/:id')
  @ApiEndpoint({
    summary: 'Get a chart account',
    operationId: 'ledgerAccountsGet',
    permissions: [PERMISSION_GROUPS.ledger.read],
    responseType: ChartAccountResponseDto,
  })
  getAccount(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ledger.getAccount(id);
  }

  @Patch('ledger/accounts/:id')
  @ApiEndpoint({
    summary: 'Update a chart account (name, description, active state)',
    operationId: 'ledgerAccountsUpdate',
    permissions: [PERMISSION_GROUPS.ledger.manage],
    responseType: ChartAccountResponseDto,
    errors: [{ status: 409, description: 'Optimistic lock conflict' }],
  })
  updateAccount(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateAccountDto,
  ) {
    return this.ledger.updateAccount(id, body);
  }

  // ─── Financial periods ─────────────────────────────────────────────────────

  @Get('ledger/periods')
  @ApiEndpoint({
    summary: 'List financial periods',
    operationId: 'ledgerPeriodsList',
    permissions: [PERMISSION_GROUPS.ledger.read],
    responseType: ListPeriodsQueryDto,
  })
  listPeriods(@Query() query: ListPeriodsQueryDto) {
    return this.ledger.listPeriods(query);
  }

  @Post('ledger/periods')
  @ApiEndpoint({
    summary: 'Open a financial period (posts inside it are allowed)',
    operationId: 'ledgerPeriodsOpen',
    permissions: [PERMISSION_GROUPS.ledger.manage],
    statusCode: 201,
    responseType: FinancialPeriodResponseDto,
    errors: [{ status: 409, description: 'Duplicate code or overlapping dates' }],
  })
  openPeriod(@Body() body: CreatePeriodDto) {
    return this.ledger.openPeriod(body);
  }

  @Post('ledger/periods/:id/close')
  @ApiEndpoint({
    summary: 'Close an OPEN financial period',
    operationId: 'ledgerPeriodsClose',
    permissions: [PERMISSION_GROUPS.ledger.manage],
    statusCode: 201,
    responseType: FinancialPeriodResponseDto,
    errors: [{ status: 409, description: 'Only an OPEN period can be closed' }],
  })
  closePeriod(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ledger.closePeriod(id);
  }

  @Post('ledger/periods/:id/lock')
  @ApiEndpoint({
    summary: 'Lock a CLOSED financial period for auditors',
    operationId: 'ledgerPeriodsLock',
    permissions: [PERMISSION_GROUPS.ledger.manage],
    statusCode: 201,
    responseType: FinancialPeriodResponseDto,
    errors: [{ status: 409, description: 'Only a CLOSED period can be locked' }],
  })
  lockPeriod(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ledger.lockPeriod(id);
  }

  // ─── Journal ───────────────────────────────────────────────────────────────

  @Get('ledger/journal')
  @ApiEndpoint({
    summary: 'List journal entries (filters + pagination)',
    operationId: 'ledgerJournalList',
    permissions: [PERMISSION_GROUPS.ledger.read],
    responseType: ListJournalResponseDto,
  })
  listJournal(@Query() query: ListJournalQueryDto) {
    return this.ledger.listJournal(query);
  }

  @Post('ledger/journal')
  @ApiEndpoint({
    summary: 'Post a manual journal entry (must balance)',
    operationId: 'ledgerJournalPost',
    permissions: [PERMISSION_GROUPS.ledger.post],
    statusCode: 201,
    responseType: FinanceTransactionResponseDto,
    errors: [
      { status: 422, description: 'Unbalanced journal (UNBALANCED_JOURNAL)' },
      { status: 409, description: 'Journal date falls in a closed/locked period' },
    ],
  })
  postJournal(@Body() body: CreateJournalDto) {
    return this.ledger.postJournal(body);
  }

  @Get('ledger/journal/:id')
  @ApiEndpoint({
    summary: 'Get a journal entry with its lines',
    operationId: 'ledgerJournalGet',
    permissions: [PERMISSION_GROUPS.ledger.read],
    responseType: FinanceTransactionResponseDto,
  })
  getJournal(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ledger.getJournal(id);
  }

  @Post('ledger/journal/:id/reverse')
  @ApiEndpoint({
    summary: 'Reverse a manual journal entry (auto-posted journals are excluded)',
    operationId: 'ledgerJournalReverse',
    permissions: [PERMISSION_GROUPS.ledger.post],
    statusCode: 201,
    responseType: FinanceTransactionResponseDto,
    errors: [
      { status: 409, description: 'Already reversed, auto-posted journal, or closed/locked period' },
    ],
  })
  reverseJournal(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ReverseJournalDto,
  ) {
    return this.ledger.reverseJournal(id, body.reason);
  }

  // ─── Trial balance ─────────────────────────────────────────────────────────

  @Get('ledger/balances')
  @ApiEndpoint({
    summary: 'Trial balance (account balances over all posted journals)',
    operationId: 'ledgerBalances',
    permissions: [PERMISSION_GROUPS.ledger.read],
    responseType: TrialBalanceResponseDto,
  })
  trialBalance() {
    return this.ledger.trialBalance();
  }
}