import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { from, Observable, of, switchMap, tap, throwError } from 'rxjs';
import { ENV, type Env } from '../../config/config.module';
import { TenantContext } from '../../database/tenant-context';
import { PrismaService } from '../../database/prisma.service';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/codes';
import { newId } from '../lib/uuidv7';

const IDEMPOTENT_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_KEY_LENGTH = 128;

type Decision =
  { kind: 'execute' } | { kind: 'replay'; responseStatus: number; value: unknown };

/**
 * Idempotency-Key support (RFC-style). Same key + same payload replay the
 * stored response; same key + different payload → IDEMPOTENCY_KEY_REUSED;
 * concurrent duplicate with the same key sees IDEMPOTENCY_IN_PROGRESS.
 * Uniqueness on (organizationId, scopeKey, idempotencyKey) is the guard.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    @Inject(ENV) private readonly env: Env,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<{
      method: string;
      url: string;
      body?: unknown;
      headers?: Record<string, string | string[] | undefined>;
    }>();

    const keyHeader = this.header(req.headers, 'idempotency-key');
    if (!keyHeader || !IDEMPOTENT_METHODS.has(req.method)) {
      return next.handle();
    }

    const key = keyHeader.trim();
    if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
      return throwError(
        () =>
          new AppError({
            code: ErrorCodes.IDEMPOTENCY_KEY_INVALID,
            message: 'Invalid Idempotency-Key header',
            silent: true,
          }),
      );
    }

    const routePattern =
      (req as { routeOptions?: { url?: string } }).routeOptions?.url ?? req.url;
    const scopeKey = `${req.method.toUpperCase()} ${routePattern}`;
    const requestHash = this.hash(JSON.stringify(req.body ?? {}));

    const organizationId = this.tenantContext.requireOrg();

    return from(this.acquire(organizationId, scopeKey, key, requestHash)).pipe(
      switchMap((decision): Observable<unknown> => {
        if (decision.kind === 'replay') {
          const reply = http.getResponse<{
            code: (c: number) => unknown;
            raw: unknown;
          }>();
          reply.code(decision.responseStatus);
          const raw = reply.raw as {
            writableEnded: boolean;
            once: (evt: string, cb: () => void) => void;
          };
          void raw;
          return of(decision.value);
        }

        return next.handle().pipe(
          tap({
            next: (_value) => {
              const reply = http.getResponse<{ raw: unknown }>();
              const raw = reply.raw as {
                writableEnded: boolean;
                once: (evt: string, cb: () => void) => void;
              };
              if (!raw.once) return;
              const persist = () => {
                void this.complete(organizationId, scopeKey, key, requestHash, _value);
              };
              if (raw.writableEnded) persist();
              else raw.once('finish', persist);
            },
            error: () => {
              void this.fail(organizationId, scopeKey, key, requestHash);
            },
          }),
        );
      }),
    );
  }

  private header(
    headers: Record<string, unknown> | undefined,
    name: string,
  ): string | undefined {
    if (!headers) return undefined;
    const value = headers[name.toLowerCase()];
    if (value === undefined) return undefined;
    return Array.isArray(value) ? String(value[0]) : String(value);
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private async acquire(
    organizationId: string,
    scopeKey: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<Decision> {
    const expiresAt = new Date(Date.now() + this.env.IDEMPOTENCY_WINDOW_SECONDS * 1000);

    try {
      await this.prisma.tenant.idempotencyRecord.create({
        data: {
          id: newId(),
          organizationId,
          scopeKey,
          idempotencyKey,
          requestHash,
          status: 'IN_PROGRESS',
          expiresAt,
        },
        select: { id: true },
      });
      return { kind: 'execute' };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.determineForExisting(
          organizationId,
          scopeKey,
          idempotencyKey,
          requestHash,
        );
      }
      throw err;
    }
  }

  private async determineForExisting(
    organizationId: string,
    scopeKey: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<Decision> {
    const record = await this.prisma.tenant.idempotencyRecord.findUnique({
      where: {
        organizationId_scopeKey_idempotencyKey: {
          organizationId,
          scopeKey,
          idempotencyKey,
        },
      },
    });

    if (!record) {
      throw new AppError({
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Idempotency state lost',
        silent: true,
      });
    }

    if (record.requestHash !== requestHash) {
      throw new AppError({
        code: ErrorCodes.IDEMPOTENCY_KEY_REUSED,
        message: 'Idempotency-Key was already used with a different payload',
        details: { idempotencyKey: idempotencyKey.slice(0, 8) },
        silent: true,
      });
    }

    if (
      record.status === 'COMPLETED' &&
      record.responseBody !== null &&
      record.responseBody !== undefined
    ) {
      return {
        kind: 'replay',
        responseStatus: record.responseStatus ?? 200,
        value: record.responseBody,
      };
    }

    if (record.status === 'REJECTED') {
      // Previous attempt failed before committing; allow a clean retry.
      await this.prisma.tenant.idempotencyRecord.delete({ where: { id: record.id } });
      await this.prisma.tenant.idempotencyRecord.create({
        data: {
          id: newId(),
          organizationId,
          scopeKey,
          idempotencyKey,
          requestHash,
          status: 'IN_PROGRESS',
          expiresAt: new Date(Date.now() + this.env.IDEMPOTENCY_WINDOW_SECONDS * 1000),
        },
        select: { id: true },
      });
      return { kind: 'execute' };
    }

    // IN_PROGRESS with the same payload: another request is being handled or a
    // request died mid-flight. Report the conflict; the window mismatch (409) is
    // acceptable per the idempotency contract.
    throw new AppError({
      code: ErrorCodes.IDEMPOTENCY_IN_PROGRESS,
      message: 'A request with this Idempotency-Key is already being processed',
      silent: true,
    });
  }

  private async complete(
    organizationId: string,
    scopeKey: string,
    idempotencyKey: string,
    requestHash: string,
    value: unknown,
  ): Promise<void> {
    try {
      await this.prisma.tenant.idempotencyRecord.updateMany({
        where: { organizationId, scopeKey, idempotencyKey, requestHash },
        data: {
          status: 'COMPLETED',
          responseBody: (value ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          responseStatus: 200,
        },
      });
    } catch (err) {
      this.logger.error(
        'Failed to persist idempotency record',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private async fail(
    organizationId: string,
    scopeKey: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<void> {
    try {
      await this.prisma.tenant.idempotencyRecord.updateMany({
        where: { organizationId, scopeKey, idempotencyKey, requestHash },
        data: { status: 'REJECTED' },
      });
    } catch (err) {
      this.logger.error(
        'Failed to mark idempotency record rejected',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
