import { Body, Controller, Post, UseFilters } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { EmergencyRateLimitFilter } from './emergency-rate-limit.filter';
import { EMERGENCY_CONSENT_VERSION } from './domain/consent';
import { EmergencyIntakeService } from './emergency-intake.service';
import {
  CancelEmergencyRequestDto,
  SubmitEmergencyRequestDto,
  TrackEmergencyRequestDto,
  UpdateCallerEmergencyRequestDto,
} from './dto/emergency-intake.dto';

// Identical to the throttles on PublicEmergencyController. An alias must not be a
// way around a limit, so the aliasing is additive and never weakens a throttle.
const SUBMIT_THROTTLE = { publicEmergencySubmit: { limit: 5, ttl: 60_000 } };
const TRACK_THROTTLE = { publicEmergencyTrack: { limit: 30, ttl: 60_000 } };

/**
 * Brief §6.15's flat emergency namespace, aliased onto the same service as the
 * deployed `/public/emergency/*` controller (ADR-052).
 *
 * Every method delegates to `EmergencyIntakeService` — there is no second
 * implementation of intake, tracking, or cancellation here. The 429 filter is
 * applied at class level exactly as on the primary controller, so a caller who
 * exhausts the limit on either path gets EMERGENCY_CALL_NOW and the national
 * numbers rather than a bare "try again later".
 *
 * `operationId`s are suffixed `Alias` to stay unique in Swagger; both spellings
 * are documented, and the alias is marked deprecated so the deployed layout is
 * what a new integrator is steered toward.
 */
@Controller('public/emergency-requests')
@UseFilters(EmergencyRateLimitFilter)
export class PublicEmergencyRequestsController {
  constructor(private readonly intake: EmergencyIntakeService) {}

  @Post()
  @Throttle(SUBMIT_THROTTLE)
  @ApiEndpoint({
    summary: 'Request emergency help anonymously from a published facility (brief §6.15 path)',
    operationId: 'emergencyIntakeSubmitAlias',
    public: true,
    statusCode: 201,
    deprecated: true,
    errors: [
      { status: 404, description: 'Facility not found for that slug', code: 'PUBLIC_LISTING_NOT_PUBLISHED' },
      { status: 422, description: 'Facility not accepting requests', code: 'FACILITY_NOT_ACCEPTING_REQUESTS' },
      { status: 422, description: 'Location required for this facility', code: 'LOCATION_REQUIRED' },
      { status: 422, description: 'Invalid coordinates', code: 'INVALID_COORDINATES' },
      {
        status: 429,
        description: 'Rate limited — response is EMERGENCY_CALL_NOW with national numbers',
        code: 'EMERGENCY_CALL_NOW',
      },
    ],
    example: {
      data: {
        request: { id: '…', referenceNumber: 'EMR-2026-000042', trackingToken: '…' },
        contact: '+254 20 555 0100',
        consentVersion: EMERGENCY_CONSENT_VERSION,
      },
    },
  })
  submit(@Body() body: SubmitEmergencyRequestDto) {
    return this.intake.submitPublic(body);
  }

  @Post('update')
  @Throttle(TRACK_THROTTLE)
  @ApiEndpoint({
    summary: 'Update details on a request you opened (correct a number or location)',
    operationId: 'emergencyIntakeUpdateCallerAlias',
    public: true,
    deprecated: true,
    errors: [
      { status: 404, description: 'No request for that token', code: 'RESOURCE_NOT_FOUND' },
      {
        status: 409,
        description: 'Request can no longer be changed (responder assigned or closed)',
        code: 'EMERGENCY_REQUEST_LOCKED',
      },
    ],
    example: {
      data: { updated: true, status: 'RECEIVED', action: 'WAIT', message: '…' },
    },
  })
  updateCaller(@Body() body: UpdateCallerEmergencyRequestDto) {
    return this.intake.updateByCaller(body);
  }

  @Post('track')
  @Throttle(TRACK_THROTTLE)
  @ApiEndpoint({
    summary: 'Track a previously submitted request with its token',
    operationId: 'emergencyIntakeTrackAlias',
    public: true,
    deprecated: true,
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

  @Post('cancel')
  @Throttle(TRACK_THROTTLE)
  @ApiEndpoint({
    summary: 'Cancel a non-terminal request the caller opened',
    operationId: 'emergencyIntakeCancelAlias',
    public: true,
    statusCode: 201,
    deprecated: true,
    errors: [
      { status: 404, description: 'No request for that token', code: 'RESOURCE_NOT_FOUND' },
      { status: 409, description: 'Responder on the way — do not cancel', code: 'EMERGENCY_CALL_NOW' },
    ],
    example: { data: { status: 'CANCELLED' } },
  })
  cancel(@Body() body: CancelEmergencyRequestDto) {
    return this.intake.cancelPublic(body);
  }
}