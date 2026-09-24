import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { SuppliersService } from './suppliers.service';
import {
  CreateSupplierDto,
  ListSuppliersQueryDto,
  SupplierResponseDto,
  UpdateSupplierDto,
} from './dto/supplier.dto';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Add a supplier',
    operationId: 'suppliersCreate',
    permissions: [PERMISSION_GROUPS.suppliers.manage],
    statusCode: 201,
    responseType: SupplierResponseDto,
    errors: [{ status: 409, description: 'Duplicate supplier name for this organization' }],
  })
  create(@Body() body: CreateSupplierDto) {
    return this.suppliers.create(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List suppliers (search, filters + pagination)',
    operationId: 'suppliersList',
    permissions: [PERMISSION_GROUPS.suppliers.read],
    responseType: ListSuppliersQueryDto,
  })
  list(@Query() query: ListSuppliersQueryDto) {
    return this.suppliers.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get one supplier',
    operationId: 'suppliersGet',
    permissions: [PERMISSION_GROUPS.suppliers.read],
    responseType: SupplierResponseDto,
    errors: [{ status: 404, description: 'Supplier not found' }],
  })
  get(@Param('id') id: string) {
    return this.suppliers.get(id);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Update a supplier',
    operationId: 'suppliersUpdate',
    permissions: [PERMISSION_GROUPS.suppliers.manage],
    responseType: SupplierResponseDto,
    errors: [{ status: 404, description: 'Supplier not found' }],
  })
  update(@Param('id') id: string, @Body() body: UpdateSupplierDto) {
    return this.suppliers.update(id, body);
  }
}