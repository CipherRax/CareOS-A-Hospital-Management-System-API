import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { isPageResult, type PageResult } from '../pagination/pagination';

export interface Envelope<T = unknown> {
  success: true;
  data: T;
  meta?: unknown;
}

/**
 * Global response envelope: `{ success: true, data, meta? }`.
 * Page results are unwrapped into `{ data: items, meta }`.
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<Envelope> {
    return next.handle().pipe(
      map((value: unknown): Envelope => {
        if (value === undefined || value === null) {
          return { success: true, data: null };
        }
        if (isPageResult(value)) {
          const page = value as PageResult<unknown>;
          return { success: true, data: page.items, meta: page.meta };
        }
        return { success: true, data: value };
      }),
    );
  }
}
