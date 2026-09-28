import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';
import type { Env } from '../../config/config.module';

export const NOTIFICATION_PROVIDERS = Symbol('NOTIFICATION_PROVIDERS');

export interface NotificationSendRequest {
  /** Resolved address for the channel (email/phone), or the recipient id. */
  to: string;
  subject: string;
  body: string;
  variables?: Record<string, string>;
  /**
   * Stable provider-side dedupe key (the notification id). A retry after a
   * timeout may re-POST an already-accepted payload, so every adapter must
   * forward this and every receiver must dedupe on it: delivery here is
   * at-least-once, not exactly-once (ADR-045).
   */
  idempotencyKey: string;
}

export interface NotificationProvider {
  readonly channel: NotificationChannel;
  /** False = structural stub: no external system is contacted. */
  readonly enabled: boolean;
  send(opts: NotificationSendRequest): Promise<{ delivered: boolean; ref?: string }>;
}

/**
 * The pre-P6 no-op, kept as an explicit stub: it reports success so the
 * delivery path is exercised end to end, but nothing leaves the host. It logs
 * lengths rather than content because subject/body are recipient data even
 * though the renderer guarantees they carry no clinical detail (ADR-034).
 */
export class StubNotificationProvider implements NotificationProvider {
  readonly enabled = false;
  private readonly logger: Logger;

  constructor(readonly channel: NotificationChannel) {
    this.logger = new Logger(`${channel}StubProvider`);
  }

  async send(opts: NotificationSendRequest): Promise<{ delivered: boolean }> {
    this.logger.debug(
      `stub accepted channel=${this.channel} subjectLength=${opts.subject.length} bodyLength=${opts.body.length}`,
    );
    return { delivered: true };
  }
}

/**
 * Thrown for every adapter-level failure. `reason` is the *stable* error class
 * the delivery service persists (and groups) — never a provider internal — while
 * `message` keeps the detail for logs only.
 */
export class NotificationDeliveryError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = 'NotificationDeliveryError';
  }
}

export interface WebhookProviderOptions {
  url: string;
  secret: string;
  timeoutMs: number;
}

/**
 * Off-system delivery adapter (patch P6, ADR-045): POSTs the rendered
 * notification as JSON to an operator-configured endpoint, HMAC-SHA256 signed
 * over the raw body. One adapter serves EMAIL/SMS/PUSH — the receiving system
 * (mail relay, SMS gateway, push service) is what actually talks to the
 * channel, so the platform never needs per-provider credentials to prove the
 * delivery path is real.
 *
 * A 2xx means "the receiver accepted it" and is the only success signal. Any
 * other status, a timeout, or a transport error throws, and the service turns
 * that into a retry (the row stays PENDING with a pushed-out `nextAttemptAt`).
 */
export class WebhookNotificationProvider implements NotificationProvider {
  readonly enabled = true;
  private readonly logger: Logger;

  constructor(
    readonly channel: NotificationChannel,
    private readonly options: WebhookProviderOptions,
  ) {
    this.logger = new Logger(`${channel}WebhookProvider`);
  }

  async send(opts: NotificationSendRequest): Promise<{ delivered: boolean; ref?: string }> {
    const payload = {
      channel: this.channel,
      to: opts.to,
      subject: opts.subject,
      body: opts.body,
      variables: opts.variables ?? {},
      idempotencyKey: opts.idempotencyKey,
      sentAt: new Date().toISOString(),
    };
    const raw = JSON.stringify(payload);
    const signature = this.options.secret
      ? createHmac('sha256', this.options.secret).update(raw).digest('hex')
      : '';

    let response: Response;
    try {
      response = await fetch(this.options.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-careos-channel': this.channel,
          'x-careos-idempotency-key': opts.idempotencyKey,
          ...(signature ? { 'x-careos-signature': `sha256=${signature}` } : {}),
        },
        body: raw,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (err) {
      throw new NotificationDeliveryError(
        `webhook transport failed for channel ${this.channel}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        'PROVIDER_UNAVAILABLE',
      );
    }

    if (!response.ok) {
      // The status stays in the log (safe); the persisted errorCode is the
      // stable class only, because a 4xx will never succeed on retry while a
      // 5xx or a timeout will.
      if (response.status >= 400 && response.status < 500) {
        throw new NotificationDeliveryError(
          `webhook rejected channel ${this.channel} with status ${response.status}`,
          'PROVIDER_REJECTED',
        );
      }
      throw new NotificationDeliveryError(
        `webhook unavailable for channel ${this.channel} with status ${response.status}`,
        'PROVIDER_UNAVAILABLE',
      );
    }

    const ref = await deliveryRef(response);
    this.logger.log(`webhook accepted channel=${this.channel} ref=${ref ?? 'none'}`);
    return ref ? { delivered: true, ref } : { delivered: true };
  }
}

/** Best-effort receiver-side id: a header first, then a small JSON body. */
async function deliveryRef(response: Response): Promise<string | undefined> {
  const header = response.headers.get('x-careos-delivery-ref');
  if (header) return header;
  const text = await response.text().catch(() => '');
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      for (const key of ['ref', 'id', 'messageId']) {
        const value = record[key];
        if (typeof value === 'string' && value.length > 0) return value;
      }
    }
  } catch {
    // A non-JSON 2xx body is fine: acceptance is the contract, the id is a bonus.
  }
  return undefined;
}

export const OFFSITE_NOTIFICATION_CHANNELS: ReadonlyArray<NotificationChannel> = [
  'EMAIL',
  'SMS',
  'PUSH',
];

/** Parses NOTIFICATION_OFFSITE_CHANNELS, ignoring blanks and unknown channels. */
export function parseOffsiteChannels(value: string): NotificationChannel[] {
  return value
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is NotificationChannel =>
      (OFFSITE_NOTIFICATION_CHANNELS as readonly string[]).includes(entry),
    );
}

/**
 * Provider map, selected from env. IN_APP is always the stub: the row *is* the
 * in-app delivery, so "sending" it is a status transition, not an API call.
 * The off-system channels get the real webhook adapter when
 * NOTIFICATION_WEBHOOK_URL is configured, and the stub otherwise, so a
 * deployment that has not configured an endpoint still runs the full delivery
 * path (attempts, backoff, suppression) against a provider that does nothing.
 */
export function defaultProviders(env: Env): Map<NotificationChannel, NotificationProvider> {
  const webhook = env.NOTIFICATION_WEBHOOK_URL
    ? {
        url: env.NOTIFICATION_WEBHOOK_URL,
        secret: env.NOTIFICATION_WEBHOOK_SECRET,
        timeoutMs: env.NOTIFICATION_WEBHOOK_TIMEOUT_MS,
      }
    : null;
  const entries: Array<[NotificationChannel, NotificationProvider]> = [
    ['IN_APP', new StubNotificationProvider('IN_APP')],
  ];
  for (const channel of OFFSITE_NOTIFICATION_CHANNELS) {
    entries.push([
      channel,
      webhook
        ? new WebhookNotificationProvider(channel, webhook)
        : new StubNotificationProvider(channel),
    ]);
  }
  return new Map<NotificationChannel, NotificationProvider>(entries);
}
