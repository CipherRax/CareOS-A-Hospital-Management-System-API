import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { EmergencyIntakeService } from './emergency-intake.service';
import {
  CancelEmergencyRequestDto,
  SubmitEmergencyRequestDto,
  TrackEmergencyRequestDto,
} from './dto/emergency-intake.dto';

const SUBMIT_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
const TRACK_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

/**
 * Anonymous public emergency help surface (brief §6.15). Every route is
 * `@Public`, IP-rate-limited, and reads only the PUBLISHED projection or the
 * cross-tenant reference tables — never tenant data. Caller PII is encrypted
 * at rest; the tracking token is returned once as a bearer capability.
 */
@Controller('public/emergency')
export class PublicEmergencyController {
  constructor(private readonly intake: EmergencyIntakeService) {}

  @Post('requests')
  @Throttle(SUBMIT_THROTTLE)
  @ApiEndpoint({
    summary: 'Request emergency help anonymously from a published facility',
    operationId: 'emergencyIntakeSubmit',
    public: true,
    statusCode: 201,
    errors: [
      { status: 404, description: 'Facility not found for that slug', code: 'PUBLIC_LISTING_NOT_PUBLISHED' },
      { status: 422, description: 'Facility not accepting requests', code: 'FACILITY_NOT_ACCEPTING_REQUESTS' },
      { status: 422, description: 'Location required for this facility', code: 'LOCATION_REQUIRED' },
      { status: 422, description: 'Invalid coordinates', code: 'INVALID_COORDINATES' },
      { status: 429, description: 'Rate limited', code: 'RATE_LIMITED' },
    ],
    example: {
      data: {
        request: { id: '…', referenceNumber: 'EMR-2026-000042', trackingToken: '…' },
        contact: '+254 20 555 0100',
      },
    },
  })
  submit(@Body() body: SubmitEmergencyRequestDto) {
    return this.intake.submitPublic(body);
  }

  @Post('requests/track')
  @Throttle(TRACK_THROTTLE)
  @ApiEndpoint({
    summary: 'Track a previously submitted request with its token',
    operationId: 'emergencyIntakeTrack',
    public: true,
    errors: [{ status: 404, description: 'No request for that token', code: 'RESOURCE_NOT_FOUND' }],
    example: {
      data: {
        referenceNumber: 'EMR-2026-000042',
        receivedAt: '2026-09-27T10:00:00.000Z',
        status: 'ESCALATED',
        action: 'CALL_NOW',
        message: '…',
        level: 1,
        facility: { name: 'St Matthews Hospital', slug: 'st-matthews', phone: '+254 20 555 0100' },
      },
    },
  })
  track(@Body() body: TrackEmergencyRequestDto) {
    return this.intake.trackPublic(body);
  }

  @Post('requests/cancel')
  @Throttle(TRACK_THROTTLE)
  @ApiEndpoint({
    summary: 'Cancel a non-terminal request the caller opened',
    operationId: 'emergencyIntakeCancel',
    public: true,
    statusCode: 201,
    errors: [
      { status: 404, description: 'No request for that token', code: 'RESOURCE_NOT_FOUND' },
      { status: 409, description: 'Responder on the way — do not cancel', code: 'EMERGENCY_CALL_NOW' },
    ],
    example: { data: { status: 'CANCELLED' } },
  })
  cancel(@Body() body: CancelEmergencyRequestDto) {
    return this.intake.cancelPublic(body);
  }

  @Get('numbers')
  @ApiEndpoint({
    summary: 'National/regional emergency numbers (reference data, fallback built-in)',
    operationId: 'emergencyIntakeNumbers',
    public: true,
    example: {
      data: {
        numbers: [{ country: 'KE', purpose: 'ambulance', label: '…', phone: '199', hours: '24/7' }],
        source: 'reference',
      },
    },
  })
  numbers() {
    return this.intake.listPublicNumbers();
  }

  @Get('notice')
  @ApiEndpoint({
    summary: 'Active public service notice (or a safe default)',
    operationId: 'emergencyIntakeNotice',
    public: true,
    example: { data: { notice: { title: '…', message: '…', severity: 'INFO' } } },
  })
  notice() {
    return this.intake.getPublicNotice();
  }
}