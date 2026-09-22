import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import S3rver from 's3rver';

export const E2E_ENV_FILE = join(__dirname, '..', '.e2e.env.json');

/**
 * Container images. Overridable so CI can pin the production version (16) even
 * when the developer machine only has another minor cached.
 */
const POSTGRES_IMAGE = process.env.E2E_POSTGRES_IMAGE ?? 'postgres:17-alpine';
const REDIS_IMAGE = process.env.E2E_REDIS_IMAGE ?? 'redis:7-alpine';

/** s3rver credentials (defaults expected by the in-memory S3 server). */
export const S3RVER_ACCESS_KEY = 'S3RVER';
export const S3RVER_SECRET_KEY = 'S3RVER';

export interface E2EDependencies {
  postgres: StartedPostgreSqlContainer | null;
  redis: StartedRedisContainer | null;
  /** In-process S3 server handle. Runs in the jest globalSetup process. */
  s3rver: { close(): Promise<unknown> } | null;
}

function writeEnvFile(env: Record<string, string | number>): void {
  mkdirSync(join(__dirname, '..'), { recursive: true });
  writeFileSync(E2E_ENV_FILE, JSON.stringify(env, null, 2));
}

/**
 * Starts Postgres + Redis via Testcontainers, applies migrations, and records
 * the connection details to JSON so test workers (separate process) can load
 * them. `prisma migrate deploy` is idempotent, so a warm container reuses state.
 *
 * Set E2E_DATABASE_URL (+ E2E_REDIS_HOST/E2E_REDIS_PORT) to reuse external
 * services instead of starting containers — handy for fast local iteration or
 * CI service containers.
 */
export async function startDependencies(): Promise<E2EDependencies> {
  const s3rver = await startS3rver();

  const externalDatabaseUrl = process.env.E2E_DATABASE_URL;
  if (externalDatabaseUrl) {
    writeEnvFile(
      withS3Env(
        {
          DATABASE_URL: externalDatabaseUrl,
          DATABASE_DIRECT_URL: externalDatabaseUrl,
          REDIS_HOST: process.env.E2E_REDIS_HOST ?? 'localhost',
          REDIS_PORT: process.env.E2E_REDIS_PORT ?? '6379',
          REDIS_DB: process.env.E2E_REDIS_DB ?? '0',
        },
        s3rver,
      ),
    );
    return { postgres: null, redis: null, s3rver };
  }

  const postgres = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase('careos')
    .withUsername('careos')
    .withPassword('careos')
    .start();

  const redis = await new RedisContainer(REDIS_IMAGE).start();

  const databaseUrl = postgres.getConnectionUri();
  const directUrl = databaseUrl;

  const migrate = spawnSync(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DATABASE_DIRECT_URL: directUrl,
        CHECKPOINT_DISABLE: '1',
      },
      encoding: 'utf8',
    },
  );
  if (migrate.status !== 0) {
    throw new Error(
      `prisma migrate deploy failed in e2e global setup\nSTDOUT:\n${migrate.stdout}\nSTDERR:\n${migrate.stderr}`,
    );
  }

  writeEnvFile(
    withS3Env(
      {
        DATABASE_URL: databaseUrl,
        DATABASE_DIRECT_URL: directUrl,
        REDIS_HOST: redis.getHost(),
        REDIS_PORT: redis.getPort(),
        REDIS_DB: '0',
      },
      s3rver,
    ),
  );

  return { postgres, redis, s3rver };
}

export async function stopDependencies(deps: E2EDependencies): Promise<void> {
  await Promise.all([deps.postgres?.stop(), deps.redis?.stop()]);
  await deps.s3rver?.close();
}

export function loadE2EEnv(): Record<string, string> {
  if (!existsSync(E2E_ENV_FILE)) {
    throw new Error(
      `${E2E_ENV_FILE} missing — e2e globalSetup must run first (npm run test:e2e).`,
    );
  }
  return JSON.parse(readFileSync(E2E_ENV_FILE, 'utf8')) as Record<string, string>;
}

/**
 * Starts an in-process S3-compatible server (s3rver) on an ephemeral port and
 * returns configured bucket 'careos'. The server runs inside the jest
 * globalSetup process, which stays alive for the whole run, so test workers
 * reach it over localhost. s3rver validates SigV4 signatures against the
 * S3RVER/S3RVER credentials written into the e2e env.
 */
async function startS3rver(): Promise<{ close(): Promise<unknown>; port: number }> {
  const server = new S3rver({
    port: 0,
    address: '127.0.0.1',
    silent: true,
    configureBuckets: [{ name: 'careos' }],
  });
  const addr = await server.run();
  return { close: () => server.close(), port: addr.port };
}

function withS3Env(env: Record<string, string | number>, s3: { port: number }): Record<string, string | number> {
  return {
    ...env,
    S3_ENDPOINT: `http://127.0.0.1:${s3.port}`,
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'careos',
    S3_ACCESS_KEY: S3RVER_ACCESS_KEY,
    S3_SECRET_KEY: S3RVER_SECRET_KEY,
    S3_FORCE_PATH_STYLE: 'true',
    S3_SIGNED_URL_TTL_SECONDS: '900',
  };
}
