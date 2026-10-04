import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ThrottlerException } from '@nestjs/throttler';
import { defaultNumbersFor } from './domain/numbers';

/**
 * Rate-limit filter for the anonymous emergency surface (brief §6.15).
 *
 * A 429 on an emergency submit is a genuinely dangerous outcome: the caller has
 * just told us they need help and the response is the one place we can still
 * push them toward a real phone call. So this filter never returns a bare
 * "too many requests" — it returns `EMERGENCY_CALL_NOW` with the caller's next
 * best action and the national emergency numbers.
 *
 * Numbers come from the built-in fallback rather than the database: a throttle
 * rejection must not depend on a working DB read, and these are static
 * reference values, not tenant data. Operators should keep
 * `emergency_numbers` seeded so the curated set is what staff review.
 *
 * It also never logs the caller's IP alongside the body, and never echoes the
 * submitted payload.
 */
@Injectable()
@Catch(ThrottlerException)
export class EmergencyRateLimitFilter implements ExceptionFilter {
  private readonly logger = new Logger(EmergencyRateLimitFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: ThrottlerException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ id?: string }>();

    this.logger.warn('emergency public surface rate limited', {
      requestId: request?.id,
      // Intentionally no IP: this is an anonymous path and the limit is keyed
      // on it, so logging would re-identify the caller we just refused.
    });

    const body = {
      success: false,
      error: {
        code: 'EMERGENCY_CALL_NOW',
        message:
          'Too many requests from this connection, so this service could not accept your request. Call the facility or your national emergency number now.',
        details: {
          action: 'CALL_NOW',
          numbers: defaultNumbersFor('KE').map((n) => ({
            purpose: n.purpose,
            label: n.label,
            phone: n.phone,
            hours: n.hours ?? null,
          })),
          // careOS does not dispatch, triage, or guarantee a response.
          disclaimer:
            'careOS does not dispatch emergency services or guarantee a response time.',
        },
      },
      requestId: request?.id,
    };

    this.httpAdapterHost.httpAdapter.reply(ctx.getResponse(), body, HttpStatus.TOO_MANY_REQUESTS);
  }
}