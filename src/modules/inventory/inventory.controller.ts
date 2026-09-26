import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { InventoryService } from './inventory.service';
import {
  CountResponseDto,
  CreateCountDto,
  CreateStockTransferDto,
  DispenseDto,
  InventoryResponseDto,
  OnHandQueryDto,
  ReceiveStockDto,
  RecordCountItemDto,
  StockAlertsQueryDto,
  TransferActionDto,
  TransferResponseDto,
  WriteOffDto,
} from './dto/inventory.dto';

@Controller('pharmacy')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Post('stock/receive')
  @ApiEndpoint({
    summary: 'Receive stock into a branch (create/top-up batches + ledger)',
    operationId: 'pharmacyStockReceive',
    permissions: [PERMISSION_GROUPS.inventory.manage],
    statusCode: 201,
    responseType: InventoryResponseDto,
    errors: [
      { status: 404, description: 'Branch or medication not found' },
      { status: 409, description: 'Stock and ledger disagree' },
    ],
  })
  receive(@Body() body: ReceiveStockDto) {
    return this.inventory.receive(body);
  }

  @Post('stock/dispense')
  @ApiEndpoint({
    summary: 'Dispense a prescription (FEFO across batches, locked)',
    operationId: 'pharmacyStockDispense',
    permissions: [PERMISSION_GROUPS.pharmacy.dispense],
    statusCode: 201,
    responseType: InventoryResponseDto,
    errors: [
      { status: 404, description: 'Prescription, branch or medication not found' },
      { status: 409, description: 'Insufficient stock, expired stock or invalid transition' },
    ],
  })
  dispense(@Body() body: DispenseDto) {
    return this.inventory.dispense(body);
  }

  @Post('stock/write-off')
  @ApiEndpoint({
    summary: 'Write off damaged/expired stock (WASTAGE ledger entries)',
    operationId: 'pharmacyStockWriteOff',
    permissions: [PERMISSION_GROUPS.inventory.wastage],
    statusCode: 201,
    errors: [
      { status: 404, description: 'Branch or medication not found' },
      { status: 409, description: 'Insufficient stock or expired stock' },
    ],
  })
  writeOff(@Body() body: WriteOffDto) {
    return this.inventory.writeOff(body);
  }

  @Post('transfers')
  @ApiEndpoint({
    summary: 'Request a branch-to-branch stock transfer',
    operationId: 'pharmacyTransfersCreate',
    permissions: [PERMISSION_GROUPS.inventory.manage],
    statusCode: 201,
    responseType: TransferResponseDto,
    errors: [
      { status: 400, description: 'Transfer must be between two different branches' },
      { status: 404, description: 'Branch or medication not found' },
    ],
  })
  createTransfer(@Body() body: CreateStockTransferDto) {
    return this.inventory.createTransfer(body);
  }

  @Post('transfers/:id/action')
  @ApiEndpoint({
    summary: 'Approve, ship or cancel a transfer',
    operationId: 'pharmacyTransfersAction',
    permissions: [PERMISSION_GROUPS.inventory.manage],
    statusCode: 201,
    responseType: TransferResponseDto,
    errors: [{ status: 409, description: 'Invalid workflow transition' }],
  })
  transferAction(@Param('id') id: string, @Body() body: TransferActionDto) {
    return this.inventory.transferAction(id, body.action);
  }

  @Post('transfers/:id/receive')
  @ApiEndpoint({
    summary: 'Receive a transfer (both ledger legs + batch moves)',
    operationId: 'pharmacyTransfersReceive',
    permissions: [PERMISSION_GROUPS.inventory.manage],
    statusCode: 201,
    responseType: TransferResponseDto,
    errors: [{ status: 409, description: 'Invalid workflow transition or insufficient stock' }],
  })
  receiveTransfer(@Param('id') id: string) {
    return this.inventory.receiveTransfer(id);
  }

  @Get('stock/alerts')
  @ApiEndpoint({
    summary: 'Low-stock / reorder / expiry advisories',
    operationId: 'pharmacyStockAlerts',
    permissions: [PERMISSION_GROUPS.inventory.read],
    responseType: StockAlertsQueryDto,
  })
  alerts(@Query() query: StockAlertsQueryDto) {
    return this.inventory.alerts(query);
  }

  @Get('stock/on-hand')
  @ApiEndpoint({
    summary: 'Current stock on hand per medication/branch (ledger-reconstructed)',
    operationId: 'pharmacyStockOnHand',
    permissions: [PERMISSION_GROUPS.inventory.read],
    responseType: OnHandQueryDto,
  })
  onHand(@Query() query: OnHandQueryDto) {
    return this.inventory.onHand(query);
  }

  @Post('stock/counts')
  @ApiEndpoint({
    summary: 'Open a stock count (systemQuantity snapshot)',
    operationId: 'pharmacyStockCountsCreate',
    permissions: [PERMISSION_GROUPS.inventory.manage],
    statusCode: 201,
    responseType: CountResponseDto,
    errors: [{ status: 404, description: 'Branch not found' }],
  })
  createCount(@Body() body: CreateCountDto) {
    return this.inventory.createCount(body);
  }

  @Post('stock/counts/:countId/items/:itemId')
  @ApiEndpoint({
    summary: 'Record a counted quantity for one batch line',
    operationId: 'pharmacyStockCountsRecordItem',
    permissions: [PERMISSION_GROUPS.inventory.manage],
    statusCode: 201,
    errors: [
      { status: 404, description: 'Count or count item not found' },
      { status: 400, description: 'Count is not OPEN' },
    ],
  })
  recordCountItem(
    @Param('countId') countId: string,
    @Param('itemId') itemId: string,
    @Body() body: RecordCountItemDto,
  ) {
    return this.inventory.recordCountItem(countId, itemId, body.countedQuantity);
  }

  @Post('stock/counts/:id/apply')
  @ApiEndpoint({
    summary: 'Apply an OPEN count (ADJUSTMENT ledger entries + on-hand reset)',
    operationId: 'pharmacyStockCountsApply',
    permissions: [PERMISSION_GROUPS.inventory.manage],
    statusCode: 201,
    responseType: CountResponseDto,
    errors: [{ status: 400, description: 'Count is not OPEN' }],
  })
  applyCount(@Param('id') id: string) {
    return this.inventory.applyCount(id);
  }
}