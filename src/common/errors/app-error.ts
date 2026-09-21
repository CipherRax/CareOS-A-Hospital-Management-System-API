import type { HttpStatus } from '@nestjs/common';
import { ERROR_CODE_HTTP, ErrorCodes, type ErrorCode } from './codes';

export interface AppErrorOptions {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown> | undefined;
  httpStatus?: HttpStatus;
  cause?: unknown;
  /** Do not log this error's stack (e.g. expected 4xx). */
  silent?: boolean;
}

/**
 * Domain/business error carrying a typed catalog code. Rendered by
 * AppExceptionFilter into the error envelope. Not an error to be swallowed.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly httpStatus: HttpStatus;
  readonly silent: boolean;
  readonly originalStack: string | undefined;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code;
    this.details = options.details;
    this.httpStatus =
      options.httpStatus ?? ERROR_CODE_HTTP[options.code]?.httpStatus ?? 500;
    this.silent = options.silent ?? this.httpStatus < 500;
    this.originalStack = this.stack;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  static badRequest(message: string, details?: Record<string, unknown>) {
    return new AppError({
      code: ErrorCodes.BAD_REQUEST,
      message,
      details,
      silent: true,
    });
  }

  static notFound(message = 'Resource not found') {
    return new AppError({
      code: ErrorCodes.RESOURCE_NOT_FOUND,
      message,
      silent: true,
    });
  }

  static forbidden(message = 'Forbidden') {
    return new AppError({
      code: ErrorCodes.PERMISSION_DENIED,
      message,
      silent: true,
    });
  }

  static unauthorized(message = 'Unauthorized') {
    return new AppError({
      code: ErrorCodes.UNAUTHORIZED,
      message,
      silent: true,
    });
  }
}

/** Thrown by the tenant-guard when tenant context is missing for a tenant op. */
export class TenantRequiredError extends AppError {
  constructor() {
    super({
      code: ErrorCodes.TENANT_REQUIRED,
      message: 'No tenant context. Use unscoped() only for audited platform jobs.',
      silent: true,
    });
  }
}

export class TenantAccessDeniedError extends AppError {
  constructor() {
    super({
      code: ErrorCodes.TENANT_ACCESS_DENIED,
      message: 'Cross-organization access denied.',
      silent: true,
    });
  }
}
