import { Body, Controller, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { DisplayService } from './display.service';
import { PairDisplayDeviceDto } from './dto/display.dto';

function requestIp(req: FastifyRequest): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return forwardedValue?.split(',')[0]?.trim() || req.ip || undefined;
}

/**
 * Brief §5.16 spells pairing `POST /display/pair`; the deployed contract nests it
 * under `/display/devices/pair` (ADR-052). Aliased onto the same
 * `DisplayService.pair` — a second pairing implementation would mean two places
 * to get the attempt limit or the token-rotation window wrong.
 *
 * The pairing attempt counter is keyed by IP inside the service, so calling the
 * alias is not a way to buy extra attempts: the limit is shared with the primary
 * path, and both write the same pairing-code consumption.
 */
@Controller('display')
export class DisplayPairAliasController {
  constructor(private readonly display: DisplayService) {}

  @Post('pair')
  @Public()
  @ApiEndpoint({
    summary: 'Exchange a pairing code for a device token (brief §5.16 path)',
    operationId: 'displayPairDeviceAlias',
    public: true,
    statusCode: 201,
    deprecated: true,
    responseType: PairDisplayDeviceDto,
    errors: [
      { status: 401, description: 'Invalid or expired pairing code' },
      { status: 429, description: 'Too many pairing attempts (PAIRING_ATTEMPTS_EXCEEDED)' },
    ],
  })
  pair(@Body() body: PairDisplayDeviceDto, @Req() req: FastifyRequest) {
    return this.display.pair(body, requestIp(req));
  }
}