import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../errors/app-error';
import { ErrorCodes, ERROR_CODE_HTTP, type ErrorCode } from '../errors/codes';

interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId?: string;
}

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCodes.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCodes.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCodes.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCodes.NOT_FOUND,
  [HttpStatus.METHOD_NOT_ALLOWED]: ErrorCodes.METHOD_NOT_ALLOWED,
  [HttpStatus.CONFLICT]: ErrorCodes.CONFLICT,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCodes.UNPROCESSABLE_ENTITY,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCodes.FILE_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ErrorCodes.FILE_TYPE_REJECTED,
  [HttpStatus.REQUEST_TIMEOUT]: ErrorCodes.BAD_REQUEST,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCodes.RATE_LIMITED,
};

/**
 * One typed error envelope for every failure. Client never sees stack traces.
 * Unexpected errors are logged in full; expected (client-caused) errors are not.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpAdapter = this.httpAdapterHost.httpAdapter;
    const ctx = host.switchToHttp();

    const requestId = (ctx.getRequest() as { id?: string })?.id;

    let body: ErrorEnvelope;
    let status: number;

    if (exception instanceof AppError) {
      status = exception.httpStatus;
      body = {
        success: false,
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception.details ? { details: exception.details } : {}),
        },
        requestId,
      };
      if (!exception.silent)
        this.logger.error(exception.originalStack ?? exception.message);
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      body = {
        success: false,
        error: {
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Request validation failed',
          details: {
            issues: exception.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          },
        },
        requestId,
      };
      this.logger.debug(exception.issues);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : Array.isArray((response as { message?: unknown })?.message)
            ? (response as { message: string[] }).message.join('; ')
            : ((response as { message?: string })?.message ?? exception.message);
      const details =
        typeof response === 'object' && response !== null
          ? ((response as Record<string, unknown>)['details'] as
              Record<string, unknown> | undefined)
          : undefined;
      body = {
        success: false,
        error: {
          code: STATUS_TO_CODE[status] ?? ErrorCodes.INTERNAL_ERROR,
          message,
          ...(details ? { details } : {}),
        },
        requestId,
      };
      if (status >= 500) this.logger.error(exception.stack ?? exception.message);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = this.mapPrismaError(exception);
      const meta = ERROR_CODE_HTTP[mapped.code];
      status = meta.httpStatus;
      body = {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
          ...(mapped.details ? { details: mapped.details } : {}),
        },
        requestId,
      };
      this.logger.warn(`Prisma ${exception.code}`, { meta: exception.meta });
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      body = {
        success: false,
        error: { code: ErrorCodes.INTERNAL_ERROR, message: 'Internal server error' },
        requestId,
      };
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(stack);
    }

    httpAdapter.reply(ctx.getResponse(), body, status);
  }

  private mapPrismaError(err: Prisma.PrismaClientKnownRequestError): {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  } {
    switch (err.code) {
      case 'P2002':
        return {
          code: ErrorCodes.CONFLICT,
          message: 'A record with the same unique value already exists.',
          details: { fields: err.meta?.target },
        };
      case 'P2025':
        return { code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Record not found.' };
      case 'P2003':
        return {
          code: ErrorCodes.BAD_REQUEST,
          message: 'Related record is missing or referenced elsewhere.',
        };
      case 'P2016':
      case 'P2004':
        return {
          code: ErrorCodes.CONCURRENT_MODIFICATION,
          message: 'Modification conflict.',
        };
      default:
        return { code: ErrorCodes.INTERNAL_ERROR, message: 'Database operation failed.' };
    }
  }
}
