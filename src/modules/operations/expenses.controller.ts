import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { ErrorCodes } from '../../common/errors/codes';
import { ExpensesService } from './expenses.service';
import {
  CreateExpenseDto,
  ExpenseResponseDto,
  ListExpensesQueryDto,
  RejectExpenseDto,
  UpdateExpenseDto,
} from './dto/expense.dto';

@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Create a DRAFT expense',
    operationId: 'expensesCreate',
    permissions: [PERMISSION_GROUPS.expenses.create],
    statusCode: 201,
    responseType: ExpenseResponseDto,
    errors: [{ status: 404, description: 'Branch / department / supplier not found' }],
  })
  create(@Body() body: CreateExpenseDto) {
    return this.expenses.create(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List expenses (status/payment/category/branch/supplier filters)',
    operationId: 'expensesList',
    permissions: [PERMISSION_GROUPS.expenses.read],
    responseType: ListExpensesQueryDto,
  })
  list(@Query() query: ListExpensesQueryDto) {
    return this.expenses.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get one expense',
    operationId: 'expensesGet',
    permissions: [PERMISSION_GROUPS.expenses.read],
    responseType: ExpenseResponseDto,
    errors: [{ status: 404, description: 'Expense not found' }],
  })
  get(@Param('id') id: string) {
    return this.expenses.get(id);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Update a DRAFT expense',
    operationId: 'expensesUpdate',
    permissions: [PERMISSION_GROUPS.expenses.create],
    responseType: ExpenseResponseDto,
    errors: [
      { status: 404, description: 'Expense not found' },
      { status: 409, code: ErrorCodes.EXPENSE_STATE_CONFLICT, description: 'Only DRAFT expenses can be edited' },
    ],
  })
  update(@Param('id') id: string, @Body() body: UpdateExpenseDto) {
    return this.expenses.update(id, body);
  }

  @Post(':id/submit')
  @ApiEndpoint({
    summary: 'Submit an expense for approval',
    operationId: 'expensesSubmit',
    permissions: [PERMISSION_GROUPS.expenses.create],
    statusCode: 201,
    responseType: ExpenseResponseDto,
    errors: [
      { status: 404, description: 'Expense not found' },
      { status: 409, code: ErrorCodes.EXPENSE_STATE_CONFLICT, description: 'Only DRAFT expenses can be submitted' },
    ],
  })
  submit(@Param('id') id: string) {
    return this.expenses.submit(id);
  }

  @Post(':id/approve')
  @ApiEndpoint({
    summary: 'Approve a submitted expense (posts a ledger accrual)',
    operationId: 'expensesApprove',
    permissions: [PERMISSION_GROUPS.expenses.approve],
    statusCode: 201,
    responseType: ExpenseResponseDto,
    errors: [
      { status: 403, code: ErrorCodes.SEGREGATION_VIOLATION, description: 'Approver must differ from the creator' },
      { status: 404, description: 'Expense not found' },
      { status: 409, code: ErrorCodes.EXPENSE_STATE_CONFLICT, description: 'Only SUBMITTED expenses can be approved' },
    ],
  })
  approve(@Param('id') id: string) {
    return this.expenses.approve(id);
  }

  @Post(':id/reject')
  @ApiEndpoint({
    summary: 'Reject a submitted expense (reason required)',
    operationId: 'expensesReject',
    permissions: [PERMISSION_GROUPS.expenses.approve],
    statusCode: 201,
    responseType: ExpenseResponseDto,
    errors: [
      { status: 403, code: ErrorCodes.SEGREGATION_VIOLATION, description: 'Rejecter must differ from the creator' },
      { status: 404, description: 'Expense not found' },
      { status: 409, code: ErrorCodes.EXPENSE_STATE_CONFLICT, description: 'Only SUBMITTED expenses can be rejected' },
    ],
  })
  reject(@Param('id') id: string, @Body() body: RejectExpenseDto) {
    return this.expenses.reject(id, body.reason);
  }

  @Post(':id/pay')
  @ApiEndpoint({
    summary: 'Mark an approved expense as paid (clears the ledger payable)',
    operationId: 'expensesPay',
    permissions: [PERMISSION_GROUPS.expenses.pay],
    statusCode: 201,
    responseType: ExpenseResponseDto,
    errors: [
      { status: 403, code: ErrorCodes.SEGREGATION_VIOLATION, description: 'Payer must differ from the creator' },
      { status: 404, description: 'Expense not found' },
      { status: 409, code: ErrorCodes.EXPENSE_STATE_CONFLICT, description: 'Only APPROVED + unpaid expenses can be paid' },
      { status: 409, code: ErrorCodes.EXPENSE_ALREADY_PAID, description: 'Expense is already paid' },
    ],
  })
  pay(@Param('id') id: string) {
    return this.expenses.pay(id);
  }

  @Post(':id/cancel')
  @ApiEndpoint({
    summary: 'Cancel a DRAFT/SUBMITTED expense',
    operationId: 'expensesCancel',
    permissions: [PERMISSION_GROUPS.expenses.create],
    statusCode: 201,
    responseType: ExpenseResponseDto,
    errors: [
      { status: 404, description: 'Expense not found' },
      { status: 409, code: ErrorCodes.EXPENSE_STATE_CONFLICT, description: 'Only DRAFT/SUBMITTED expenses can be cancelled' },
    ],
  })
  cancel(@Param('id') id: string) {
    return this.expenses.cancel(id);
  }
}