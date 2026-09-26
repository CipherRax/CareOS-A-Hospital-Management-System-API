import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { ErrorCodes } from '../../common/errors/codes';
import { AssetsService } from './assets.service';
import {
  AssetResponseDto,
  CreateAssetDto,
  ListAssetsQueryDto,
  UpdateAssetDto,
} from './dto/asset.dto';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Register a physical asset',
    operationId: 'assetsCreate',
    permissions: [PERMISSION_GROUPS.assets.create],
    statusCode: 201,
    responseType: AssetResponseDto,
    errors: [
      { status: 404, description: 'Branch / department not found' },
      { status: 409, description: 'Duplicate asset tag for this organization' },
    ],
  })
  create(@Body() body: CreateAssetDto) {
    return this.assets.create(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List assets (status/category/branch/search filters)',
    operationId: 'assetsList',
    permissions: [PERMISSION_GROUPS.assets.read],
    responseType: ListAssetsQueryDto,
  })
  list(@Query() query: ListAssetsQueryDto) {
    return this.assets.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get one asset',
    operationId: 'assetsGet',
    permissions: [PERMISSION_GROUPS.assets.read],
    responseType: AssetResponseDto,
    errors: [{ status: 404, description: 'Asset not found' }],
  })
  get(@Param('id') id: string) {
    return this.assets.get(id);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Update asset details or maintenance status flag',
    operationId: 'assetsUpdate',
    permissions: [PERMISSION_GROUPS.assets.update],
    responseType: AssetResponseDto,
    errors: [
      { status: 404, description: 'Asset not found' },
      {
        status: 409,
        code: ErrorCodes.ASSET_STATE_CONFLICT,
        description: 'Retirement must use the retire endpoint; immutable after RETIRED/DISPOSED',
      },
    ],
  })
  update(@Param('id') id: string, @Body() body: UpdateAssetDto) {
    return this.assets.update(id, body);
  }

  @Post(':id/retire')
  @ApiEndpoint({
    summary: 'Retire an asset (one-way lifecycle change)',
    operationId: 'assetsRetire',
    permissions: [PERMISSION_GROUPS.assets.manage],
    statusCode: 201,
    responseType: AssetResponseDto,
    errors: [
      { status: 404, description: 'Asset not found' },
      { status: 409, code: ErrorCodes.ASSET_STATE_CONFLICT, description: 'Asset already retired/disposed' },
    ],
  })
  retire(@Param('id') id: string) {
    return this.assets.retire(id);
  }
}