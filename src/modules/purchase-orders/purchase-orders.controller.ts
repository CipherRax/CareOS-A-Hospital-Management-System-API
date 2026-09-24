import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { PurchaseOrdersService } from './purchase-orders.service';
import {
  ActionPurchaseOrderDto,
  CreatePurchaseOrderDto,
  ListPurchaseOrdersQueryDto,
  PurchaseOrderResponseDto,
  ReceivePurchaseOrderDto,
} from './dto/purchase-order.dto';

@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrders: PurchaseOrdersService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Create a purchase order (DRAFT)',
    operationId: 'purchaseOrdersCreate',
    permissions: [PERMISSION_GROUPS.purchaseOrders.create],
    statusCode: 201,
    responseType: PurchaseOrderResponseDto,
    errors: [
      { status: 404, description: 'Branch, supplier or medication not found' },
      { status: 409, description: 'Duplicate PO number' },
    ],
  })
  create(@Body() body: CreatePurchaseOrderDto) {
    return this.purchaseOrders.create(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List purchase orders (filters + pagination)',
    operationId: 'purchaseOrdersList',
    permissions: [PERMISSION_GROUPS.purchaseOrders.read],
    responseType: ListPurchaseOrdersQueryDto,
  })
  list(@Query() query: ListPurchaseOrdersQueryDto) {
    return this.purchaseOrders.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get a purchase order',
    operationId: 'purchaseOrdersGet',
    permissions: [PERMISSION_GROUPS.purchaseOrders.read],
    responseType: PurchaseOrderResponseDto,
    errors: [{ status: 404, description: 'Purchase order not found' }],
  })
  get(@Param('id') id: string) {
    return this.purchaseOrders.get(id);
  }

  @Post(':id/action')
  @ApiEndpoint({
    summary: 'Submit, approve, order or close a purchase order',
    operationId: 'purchaseOrdersAction',
    permissions: [PERMISSION_GROUPS.purchaseOrders.approve],
    statusCode: 201,
    responseType: PurchaseOrderResponseDto,
    errors: [{ status: 409, description: 'Invalid workflow transition' }],
  })
  action(@Param('id') id: string, @Body() body: ActionPurchaseOrderDto) {
    return this.purchaseOrders.action(id, body);
  }

  @Post(':id/receive')
  @ApiEndpoint({
    summary: 'Receive ordered items into stock (batches + ledger)',
    operationId: 'purchaseOrdersReceive',
    permissions: [PERMISSION_GROUPS.purchaseOrders.receive],
    statusCode: 201,
    responseType: PurchaseOrderResponseDto,
    errors: [
      { status: 409, description: 'Invalid workflow transition or exceeds outstanding quantity' },
    ],
  })
  receive(@Param('id') id: string, @Body() body: ReceivePurchaseOrderDto) {
    return this.purchaseOrders.receive(id, body);
  }
}