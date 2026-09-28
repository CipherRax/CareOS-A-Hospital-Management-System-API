import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Notification, NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ENV, type Env } from '../../config/config.module';
import {
  NOTIFICATION_PROVIDERS,
  NotificationDeliveryError,
  type NotificationProvider,
} from '../../integrations/notifications/notifications.provider';

export type DeliveryPlan =
  | { provider: NotificationProvider; error?: undefined }
  | { provider?: undefined; error: 'PROVIDER_UNAVAILABLE' | 'PROVIDER_CHANNEL_MISMATCH' };

export function planDelivery(
  channel: NotificationChannel,
  providers: ReadonlyMap<NotificationChannel, NotificationProvider>,
): DeliveryPlan {
  const provider = providers.get(channel);
  if (!provider) return { error: 'PROVIDER_UNAVAILABLE' };
  if (provider.channel !== channel) return { error: 'PROVIDER_CHANNEL_MISMATCH' };
  return { provider };
}

/** Catch-all category in `NotificationPreference`: opt out of every template. */
export const WILDCARD_PREFERENCE_CATEGORY = '*';

/**
 * Opt-out resolution for one (recipient, channel, category). Default is
 * *enabled*: a recipient has to opt out, and the most specific row wins — the
 * template's own category before the `*` catch-all, so a blanket email opt-out
 * can be re-enabled for one template without touching the others.
 */
export function resolveOptOut(
  preferences: ReadonlyArray<{ category: string; enabled: boolean }>,
  templateKey: string,
): { optedOut: boolean; matchedCategory: string | null } {
  const exact = preferences.find((row) => row.category === templateKey);
  if (exact) return { optedOut: !exact.enabled, matchedCategory: exact.category };
  const wildcard = preferences.find(
    (row) => row.category === WILDCARD_PREFERENCE_CATEGORY,
  );
  if (wildcard)
    return { optedOut: !wildcard.enabled, matchedCategory: wildcard.category };
  return { optedOut: false, matchedCategory: null };
}

export type DeliveryTarget =
  | { kind: 'address'; address: string }
  /** IN_APP/PUSH carry the recipient id; the row or the receiver resolves it. */
  | { kind: 'recipient-id'; to: string }
  | { kind: 'no-recipient' }
  | { kind: 'missing-address' };

/** Channels that need a real address on file; the rest address by recipient id. */
const ADDRESS_FIELD: Partial<Record<NotificationChannel, 'email' | 'phone'>> = {
  EMAIL: 'email',
  SMS: 'phone',
};

/**
 * Resolve what a channel's payload is addressed to. The pre-P6 path passed the
 * raw `recipientUserId` to every provider, which no mail relay or SMS gateway
 * can act on; EMAIL/SMS now resolve the address on the recipient record.
 */
export function deliveryTargetFor(
  channel: NotificationChannel,
  recipientId: string | null,
  recipient: { email: string | null; phone: string | null } | null,
): DeliveryTarget {
  if (!recipientId) return { kind: 'no-recipient' };
  const field = ADDRESS_FIELD[channel];
  if (!field) return { kind: 'recipient-id', to: recipientId };
  const value = recipient?.[field] ?? null;
  return value && value.length > 0
    ? { kind: 'address', address: value }
    : { kind: 'missing-address' };
}

/**
 * Terminal delivery error codes. Deliberately stable and short: they are
 * persisted in `notifications.errorCode` and grouped in dashboards, so they
 * must not carry provider internals (URLs, response bodies, addresses).
 *
 * Note what is *not* here: a provider that is reachable but unavailable
 * (`PROVIDER_UNAVAILABLE`, i.e. a 5xx or a transport failure) is retryable. It
 * has its own code precisely so "no provider is configured for this channel"
 * and "the provider we are configured with is down" cannot collapse into one.
 */
const PERMANENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_CHANNEL_MISMATCH',
  'PROVIDER_REJECTED',
  'RECIPIENT_REQUIRED',
]);

/** Persisted code for each `planDelivery` rejection. */
const PLAN_ERROR_CODES: Record<
  'PROVIDER_UNAVAILABLE' | 'PROVIDER_CHANNEL_MISMATCH',
  string
> = {
  PROVIDER_UNAVAILABLE: 'PROVIDER_NOT_CONFIGURED',
  PROVIDER_CHANNEL_MISMATCH: 'PROVIDER_CHANNEL_MISMATCH',
};

export type SuppressionCode = 'RECIPIENT_OPTED_OUT' | 'RECIPIENT_ADDRESS_MISSING';

type TenantDb = ReturnType<PrismaService['tenantFor']>;

/**
 * Notification delivery (patch P6, ADR-045).
 *
 * Replaces the pre-P6 single inline attempt with an honest delivery contract:
 *
 *  - **Opt-out first.** `NotificationPreference` rows were written and listed
 *    but never read at send time, so a recipient who opted out of a channel
 *    still got it. Suppression is decided here, before anything leaves the
 *    system, and lands in the terminal `SUPPRESSED` status — never `FAILED`,
 *    and never retried.
 *  - **Real addresses.** EMAIL/SMS resolve the address on the recipient record.
 *  - **Retry ladder.** A transient provider failure leaves the row `PENDING`
 *    with `nextAttemptAt` pushed out (`base * 2 ** attempt`), and the
 *    notification-delivery sweep claims it. Only `NOTIFICATION_DELIVERY_MAX_ATTEMPTS`
 *    turns a failure into a terminal `FAILED`.
 *  - **At-least-once.** A retry after a timeout may re-send an already-accepted
 *    payload, so every provider call carries the notification id as an
 *    idempotency key for receiver-side dedupe. Suppression and the idempotency
 *    key are what keep a duplicate from being read twice: re-delivering a
 *    neutral "a task was assigned" notice is harmless, a stale one is not.
 */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATION_PROVIDERS)
    private readonly providers: ReadonlyMap<NotificationChannel, NotificationProvider>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async send(row: Notification): Promise<Notification> {
    // SENT / FAILED / SUPPRESSED are terminal; the sweep only claims PENDING.
    if (row.status !== 'PENDING') return row;

    const db = this.prisma.tenantFor(row.organizationId);
    const plan = planDelivery(row.channel, this.providers);
    if (plan.error) {
      // A missing or mislabelled provider is a configuration fault: retrying it
      // can only produce the same failure, so it is terminal immediately.
      return this.write(db, row, {
        status: 'FAILED',
        errorCode: PLAN_ERROR_CODES[plan.error],
      });
    }

    const recipientId = row.recipientUserId ?? row.recipientPatientId;
    const target = deliveryTargetFor(
      row.channel,
      recipientId,
      await this.loadRecipient(db, row),
    );
    if (target.kind === 'no-recipient') {
      return this.write(db, row, { status: 'FAILED', errorCode: 'RECIPIENT_REQUIRED' });
    }

    const optOut = await this.optOut(db, row);
    if (optOut.optedOut) {
      return this.suppress(db, row, 'RECIPIENT_OPTED_OUT');
    }
    if (target.kind === 'missing-address') {
      return this.suppress(db, row, 'RECIPIENT_ADDRESS_MISSING');
    }

    const attemptCount = row.attemptCount + 1;
    const to = target.kind === 'address' ? target.address : target.to;
    try {
      const result = await plan.provider.send({
        to,
        subject: row.subject,
        body: row.body,
        variables: providerVariables(row.variables),
        idempotencyKey: row.id,
      });
      if (!result.delivered) {
        throw new NotificationDeliveryError(
          'provider did not confirm delivery',
          'DELIVERY_NOT_CONFIRMED',
        );
      }
      return this.write(db, row, {
        status: 'SENT',
        attemptCount,
        errorCode: null,
        providerRef: result.ref ?? null,
        sentAt: new Date(),
      });
    } catch (err) {
      return this.recordFailure(db, row, attemptCount, err);
    }
  }

  /**
   * Transient failure → stay PENDING and push `nextAttemptAt` out; permanent
   * cause (no provider, 4xx, no recipient) or the last attempt → FAILED. The
   * backoff matches the outbox publisher's ladder so both subsystems age
   * failures at the same rate.
   */
  private async recordFailure(
    db: TenantDb,
    row: Notification,
    attemptCount: number,
    err: unknown,
  ): Promise<Notification> {
    const code =
      err instanceof NotificationDeliveryError ? err.reason : 'DELIVERY_FAILED';
    if (
      PERMANENT_ERROR_CODES.has(code) ||
      attemptCount >= this.env.NOTIFICATION_DELIVERY_MAX_ATTEMPTS
    ) {
      this.logger.warn(`notification ${row.id} channel=${row.channel} failed: ${code}`);
      return this.write(db, row, { status: 'FAILED', attemptCount, errorCode: code });
    }
    const delay = this.env.NOTIFICATION_DELIVERY_RETRY_BASE_MS * 2 ** (attemptCount - 1);
    this.logger.warn(
      `notification ${row.id} channel=${row.channel} attempt ${attemptCount} failed: ${code}; retrying in ${delay}ms`,
    );
    return this.write(db, row, {
      status: 'PENDING',
      attemptCount,
      errorCode: code,
      nextAttemptAt: new Date(Date.now() + delay),
    });
  }

  /**
   * A deliberate non-send. `attemptCount` is untouched (no provider was
   * contacted) and `nextAttemptAt` is irrelevant once the row is terminal.
   */
  private async suppress(
    db: TenantDb,
    row: Notification,
    code: SuppressionCode,
  ): Promise<Notification> {
    this.logger.log(`notification ${row.id} channel=${row.channel} suppressed: ${code}`);
    return this.write(db, row, { status: 'SUPPRESSED', errorCode: code });
  }

  private async write(
    db: TenantDb,
    row: Notification,
    data: {
      status: 'SENT' | 'FAILED' | 'SUPPRESSED' | 'PENDING';
      attemptCount?: number;
      errorCode?: string | null;
      providerRef?: string | null;
      sentAt?: Date;
      nextAttemptAt?: Date;
    },
  ): Promise<Notification> {
    return db.notification.update({
      where: { id: row.id, organizationId: row.organizationId },
      data,
    });
  }

  private async optOut(
    db: TenantDb,
    row: Notification,
  ): Promise<{ optedOut: boolean; matchedCategory: string | null }> {
    // Both recipient columns are nullable, so a row with neither would build an
    // unfiltered recipient clause and read *someone else's* preferences. The
    // no-recipient case is already terminal by the time we get here; this guard
    // keeps that true even if the order above ever changes.
    if (!row.recipientUserId && !row.recipientPatientId) {
      return { optedOut: false, matchedCategory: null };
    }
    const recipient = row.recipientUserId
      ? { recipientUserId: row.recipientUserId }
      : { recipientPatientId: row.recipientPatientId ?? undefined };
    const preferences = await db.notificationPreference.findMany({
      where: {
        organizationId: row.organizationId,
        channel: row.channel,
        category: { in: [row.templateKey, WILDCARD_PREFERENCE_CATEGORY] },
        ...recipient,
      },
      select: { category: true, enabled: true },
    });
    return resolveOptOut(preferences, row.templateKey);
  }

  private async loadRecipient(
    db: TenantDb,
    row: Notification,
  ): Promise<{ email: string | null; phone: string | null } | null> {
    if (row.recipientUserId) {
      return db.user.findUnique({
        where: { id: row.recipientUserId },
        select: { email: true, phone: true },
      });
    }
    if (row.recipientPatientId) {
      return db.patient.findUnique({
        where: { id: row.recipientPatientId },
        select: { email: true, phone: true },
      });
    }
    return null;
  }
}

function providerVariables(value: Prisma.JsonValue | null): Record<string, string> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      entry === null
        ? ''
        : typeof entry === 'object'
          ? JSON.stringify(entry)
          : String(entry),
    ]),
  );
}
