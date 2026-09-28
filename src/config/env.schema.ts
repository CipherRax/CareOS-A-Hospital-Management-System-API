import { z } from 'zod';

const urlSchema = z.string().trim().min(1, 'URL required');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().trim().startsWith('/').default('/api/v1'),
  ENABLE_SWAGGER: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  DATABASE_URL: urlSchema,
  DATABASE_DIRECT_URL: urlSchema.optional(),

  REDIS_HOST: z.string().trim().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),
  REDIS_URL: urlSchema.optional(),

  BULL_PREFIX: z.string().trim().default('careos'),

  S3_ENDPOINT: urlSchema.optional(),
  S3_REGION: z.string().trim().default('us-east-1'),
  S3_BUCKET: z.string().trim().default('careos'),
  S3_ACCESS_KEY: z.string().trim().optional(),
  S3_SECRET_KEY: z.string().trim().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
  S3_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  // M-PESA (repo Phase 11). MPESA_PROVIDER selects the adapter ('mock' in
  // dev/test by default; the 'daraja' adapter talks to Safaricom and is an
  // honest non-live stub — see docs/limitations.md).
  MPESA_PROVIDER: z.enum(['mock', 'daraja']).default('mock'),
  MPESA_CALLBACK_SECRET: z.string().trim().default('careos-dev-mpesa-callback-secret'),
  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: z.string().trim().optional(),
  MPESA_CONSUMER_SECRET: z.string().trim().optional(),
  MPESA_PASSKEY: z.string().trim().optional(),
  MPESA_SHORTCODE: z.string().trim().optional(),
  MPESA_BASE_URL: urlSchema.optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_REDACT_PATHS: z
    .string()
    .default('req.headers.authorization,req.headers.cookie,req.body'),

  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32)
    .default('careos-dev-access-secret-do-not-use-in-prod'),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32)
    .default('careos-dev-refresh-secret-do-not-use-in-prod'),
  JWT_ISSUER: z.string().trim().min(1).default('careos'),
  JWT_AUDIENCE: z.string().trim().min(1).default('careos-api'),

  // Refresh tokens rotate; a session dies once its refresh tokens are all
  // expired/revoked or the absolute session TTL elapses.
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  SESSION_ABS_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),

  KEY_ENCRYPTION_SECRET: z
    .string()
    .min(32)
    .default('careos-dev-encryption-secret-do-not-use-in-prod'),
  MFA_ISSUER: z.string().trim().min(1).default('careos'),
  INVITE_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  IDEMPOTENCY_WINDOW_SECONDS: z.coerce.number().int().positive().default(3600),

  METRICS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  METRICS_PATH: z.string().trim().startsWith('/').default('/metrics'),

  OTEL_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  OTEL_EXPORTER_OTLP_ENDPOINT: urlSchema.default('http://localhost:4318'),

  SEED_ALLOWED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Public facility directory (brief §6.14, patch P2). When unset the importer
  // is disabled and the feed is empty; the anonymous directory still serves
  // org-published branches.
  PUBLIC_FACILITY_SOURCE_CSV_URL: urlSchema.optional(),

  // Public emergency intake (brief §6.15, patch P4 hardening — ADR-043).
  // EMERGENCY_RETENTION_DAYS impels the maintenance sweep to anonymize caller
  // PII on terminal requests older than N days (0 disables retention). Duplicate
  // submissions from the same normalized phone within EMERGENCY_DEDUPE_SECONDS
  // against an open request are collapsed. EMERGENCY_SWEEP_INTERVAL_MS is the
  // BullMQ repeat period for reconcile+retention (not started under NODE_ENV=test).
  EMERGENCY_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(90),
  EMERGENCY_DEDUPE_SECONDS: z.coerce.number().int().nonnegative().default(120),
  EMERGENCY_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60000),

  // Time-based scheduler (patch P5 — ADR-044). One BullMQ repeatable job per duty
  // on the `scheduler` queue, registered by every process and deduped by jobId.
  // SCHEDULER_ENABLED is an operator kill-switch (the API/worker still boot with
  // no time-based duties at all — the queue is drained only when a worker runs).
  SCHEDULER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Outbox delivery: drains committed PENDING events (the pre-P5 worker polled
  // this on a bare setInterval every 5s).
  OUTBOX_DRAIN_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  // Maintenance reminders are materialised on a cadence instead of on demand.
  MAINTENANCE_REMINDER_INTERVAL_MS: z.coerce.number().int().positive().default(900_000),
  // Reclaims expired IdempotencyRecord rows (COMPLETED past their replay window
  // and IN_PROGRESS rows orphaned by a crashed request, which would otherwise
  // answer 409 forever).
  IDEMPOTENCY_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
  // Flips READY report exports to EXPIRED at `expiresAt` (read-side already
  // enforces expiry; this keeps listings honest).
  REPORT_EXPIRY_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  // Row cap per sweep pass — a pass only ever handles this many rows, so a huge
  // backlog drains over several ticks instead of one long transaction.
  SCHEDULER_SWEEP_BATCH: z.coerce.number().int().positive().default(500),
  // Organizations visited per maintenance-reminder pass.
  SCHEDULER_ORG_BATCH: z.coerce.number().int().positive().default(50),
  // Off-system notification delivery (patch P6, ADR-045).
  // Cadence of the notification-delivery sweep: claims PENDING rows whose
  // nextAttemptAt has passed and attempts one delivery per row.
  NOTIFICATION_DELIVERY_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  // Rows attempted per sweep pass. Deliberately smaller than SCHEDULER_SWEEP_BATCH:
  // every row is an outbound network call, so one slow channel cannot monopolise
  // a tick.
  NOTIFICATION_DELIVERY_BATCH: z.coerce.number().int().positive().default(100),
  // Attempts before a delivery is FAILED for good. Retries back off from
  // NOTIFICATION_DELIVERY_RETRY_BASE_MS.
  NOTIFICATION_DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  NOTIFICATION_DELIVERY_RETRY_BASE_MS: z.coerce.number().int().positive().default(30_000),
  // Channels (EMAIL, SMS, PUSH) the notification consumer fans out to in
  // addition to IN_APP. Empty = in-app only, which is the safe default: an
  // off-system send leaves the system and cannot be unsent.
  NOTIFICATION_OFFSITE_CHANNELS: z.string().default(''),
  // Off-system delivery adapter. Unset = the honest structural stub (logged,
  // counted as delivered, nothing leaves the host). Set = every configured
  // channel is POSTed as a signed JSON webhook to this URL.
  NOTIFICATION_WEBHOOK_URL: z.string().default(''),
  // HMAC-SHA256 key for the webhook body signature. Empty = unsigned payload
  // (the receiver can still parse it, but cannot verify the sender).
  NOTIFICATION_WEBHOOK_SECRET: z.string().default(''),
  NOTIFICATION_WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Env = z.infer<typeof envSchema>;
export type NodeEnv = Env['NODE_ENV'];

export function parseEnv(env: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration. Refusing to start.\n${issues}\nSee .env.example.`,
    );
  }
  return result.data;
}

/** Sanitises the raw env (no secrets) for structured logs. */
export function envSummary(env: Env): Record<string, unknown> {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    apiPrefix: env.API_PREFIX,
    swagger: env.ENABLE_SWAGGER,
    redis: `${env.REDIS_HOST}:${env.REDIS_PORT}`,
    metrics: env.METRICS_ENABLED,
    otel: env.OTEL_ENABLED,
    emergencyRetentionDays: env.EMERGENCY_RETENTION_DAYS,
    schedulerEnabled: env.SCHEDULER_ENABLED,
    outboxDrainIntervalMs: env.OUTBOX_DRAIN_INTERVAL_MS,
    notificationChannels: env.NOTIFICATION_OFFSITE_CHANNELS || 'IN_APP only',
    notificationWebhook: env.NOTIFICATION_WEBHOOK_URL ? 'configured' : 'stubbed',
  };
}
