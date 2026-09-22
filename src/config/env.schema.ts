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
  };
}
