import { applyDecorators, HttpCode, type Type } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  type ApiResponseOptions,
} from '@nestjs/swagger';
import { ErrorCodes } from '../errors/codes';
import type { Permission } from '../auth/permissions.catalog';
import { Public } from './public.decorator';
import { AuthenticatedOnly } from './authenticated.decorator';
import { RequirePermissions } from './require-permissions.decorator';

const COMMON_ERROR_RESPONSES: Array<{
  status: number;
  code: string;
  description: string;
}> = [
  {
    status: 400,
    code: ErrorCodes.VALIDATION_ERROR,
    description: 'Request validation failed',
  },
  {
    status: 401,
    code: ErrorCodes.UNAUTHORIZED,
    description: 'Missing or invalid credentials',
  },
  {
    status: 403,
    code: ErrorCodes.PERMISSION_DENIED,
    description: 'Insufficient permissions',
  },
  { status: 404, code: ErrorCodes.RESOURCE_NOT_FOUND, description: 'Resource not found' },
  { status: 409, code: ErrorCodes.CONFLICT, description: 'Conflict' },
  { status: 429, code: ErrorCodes.RATE_LIMITED, description: 'Too many requests' },
];

export interface ApiEndpointOptions {
  summary: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  /** One or more required permissions. Default: route is denied. */
  permissions?: Permission[];
  /** Marks the route as public (skip auth + permissions). */
  public?: boolean;
  /**
   * Authenticated but self-scoped: a valid session is required, yet no role
   * permission is checked (own password/MFA/sessions).
   */
  authenticatedOnly?: boolean;
  /** Response DTO class (Zod DTO via createZodDto) for the success body. */
  responseType?: Type<unknown>;
  /** API documentation example for the success body. */
  example?: unknown;
  /** Success status code. */
  statusCode?: 200 | 201 | 202 | 204;
  deprecated?: boolean;
  /** Additional success-response options. */
  okResponse?: ApiResponseOptions;
  /** Additional error responses. */
  errors?: Array<{ status: number; description: string; code?: string }>;
}

/**
 * Composed endpoint decorator so API documentation, authorization metadata and
 * Swagger responses are never optional: every endpoint declares summary,
 * permission/public and response schema in one place.
 */
export function ApiEndpoint(options: ApiEndpointOptions): MethodDecorator {
  const decorators: MethodDecorator[] = [];

  if (options.permissions && options.permissions.length > 0) {
    decorators.push(RequirePermissions(...options.permissions));
  } else if (options.public !== true && options.authenticatedOnly !== true) {
    decorators.push(RequirePermissions('__deny_by_default__' as Permission));
  }

  if (options.authenticatedOnly === true) {
    decorators.push(AuthenticatedOnly());
  }

  decorators.push(HttpCode(options.statusCode ?? 200));

  if (options.public === true) {
    decorators.push(Public());
  }

  decorators.push(
    ApiOperation({
      summary: options.summary,
      description: options.description,
      operationId: options.operationId,
    }),
  );

  if (options.public !== true) {
    decorators.push(ApiBearerAuth());
  }

  decorators.push(
    HttpCode(options.statusCode ?? 200),
    ApiResponse({
      status: options.statusCode ?? 200,
      description: options.summary,
      type: options.responseType,
      example: options.example,
      ...(options.okResponse ?? {}),
    }),
  );

  for (const err of [...COMMON_ERROR_RESPONSES, ...(options.errors ?? [])]) {
    decorators.push(
      ApiResponse({
        status: err.status,
        description: `${err.description} — code: ${err.code ?? 'n/a'}`,
      }),
    );
  }

  return applyDecorators(...decorators);
}

export { Public };
