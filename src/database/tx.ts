import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { newId } from '../common/lib/uuidv7';
import { TenantContext } from './tenant-context';
import { PrismaService, type TenantClient } from './prisma.service';

export type TxClient = Parameters<Parameters<TenantClient['$transaction']>[0]>[0];

/** What a use-case may emit inside a transaction. Payloads carry IDs, never PHI. */
export interface EmittableEvent<T = unknown> {
  type: string;
  version?: number;
  aggregateType: string;
  aggregateId: string;
  correlationId?: string | null;
  payload: T;
}

export interface TxContext {
  readonly db: TxClient;
  /** The organization this transaction is scoped to. */
  readonly organizationId: string;
  /** Queues a domain event to be committed with this transaction. Returns the event id. */
  emit<T>(event: EmittableEvent<T>): string;
}

export interface TxOptions {
  timeoutMs?: number;
  /** Run with an explicitly provided organization (used by audited platform jobs). */
  organizationId?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Runs a use-case and its emitted domain events in ONE database transaction and
 * in ONE Prisma interactive transaction. OutboxEvent rows are inserted in the
 * same transaction as the business rows, so a committed state change can never
 * lose its events (each event is an outbox row).
 */
@Injectable()
export class TxRunner {
  private readonly logger = new Logger(TxRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async run<T>(work: (ctx: TxContext) => Promise<T>, options?: TxOptions): Promise<T> {
    const organizationId = options?.organizationId ?? this.tenantContext.requireOrg();
    const actorId = this.tenantContext.scope.userId;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Run on a client extended for this exact organization: Prisma applies the
    // extension's query hooks to every operation inside the interactive tx, so
    // organizationId injection holds inside transactions too.
    const scoped: TenantClient = this.prisma.tenantFor(organizationId);

    return scoped.$transaction(
      async (tx) => {
        // Tie the DB-level RLS policy to this transaction (defense in depth).
        await tx.$queryRaw`SELECT set_config('app.current_org', ${organizationId}, true)`;

        const pending: Array<EmittableEvent & { id: string; occurredAt: Date }> = [];

        const ctx: TxContext = {
          db: tx,
          organizationId,
          emit: (event) => {
            const id = newId();
            pending.push({
              ...event,
              version: event.version ?? 1,
              id,
              occurredAt: new Date(),
              correlationId: event.correlationId ?? null,
            });
            return id;
          },
        };

        const result = await work(ctx);

        for (const ev of pending) {
          await tx.outboxEvent.create({
            data: {
              id: ev.id,
              organizationId,
              type: ev.type,
              version: ev.version,
              aggregateType: ev.aggregateType,
              aggregateId: ev.aggregateId,
              occurredAt: ev.occurredAt,
              actorId,
              correlationId: ev.correlationId,
              payload: (ev.payload ?? {}) as Prisma.InputJsonObject,
              status: 'PENDING',
            },
          });
        }

        return result;
      },
      {
        timeout: timeoutMs,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }
}
