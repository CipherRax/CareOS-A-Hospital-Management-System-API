import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContext } from '../../database/tenant-context';
import { newId } from '../lib/uuidv7';

/**
 * Populates the request-scoped CLS values (requestId) from the inbound
 * request. Authorization guards (JWT → tenant/user/roles/permissions) run first
 * in later phases and extend the same scope; nothing ever populates the tenant
 * from a body/query/header value.
 */
@Injectable()
export class RequestScopeInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContext) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      id?: string;
      headers?: Record<string, string | string[] | undefined>;
    }>();

    const supplied = request.headers?.['x-request-id'];
    const requestId =
      (Array.isArray(supplied) ? supplied[0] : supplied)?.trim() || request.id || newId();

    this.tenantContext.setScope({ requestId });

    return next.handle();
  }
}
