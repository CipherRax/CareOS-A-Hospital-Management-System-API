import {
  Injectable,
  Module,
  MiddlewareConsumer,
  NestMiddleware,
  NestModule,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { ZodValidationPipe } from 'nestjs-zod';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { AppModule } from '../../src/app/app.module';
import { ENV, type Env } from '../../src/config/config.module';
import { TenantContext } from '../../src/database/tenant-context';

export const TEST_ORG_HEADER = 'x-careos-test-org';
export const TEST_USER_HEADER = 'x-careos-test-user';
export const TEST_PERMS_HEADER = 'x-careos-test-permissions';
export const TEST_PATIENT_HEADER = 'x-careos-test-patient-id';

/**
 * TEST-ONLY middleware: claims a tenant + permissions from headers so tests can
 * exercise authenticated flows through the REAL guard/interceptors. Never used
 * by application code. Absent headers yield an empty scope (deny by default).
 */
@Injectable()
export class TestPrincipalMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContext) {}

  use(req: Record<string, unknown>, _res: unknown, next: () => void): void {
    const headers = (req.headers ?? {}) as Record<string, string | string[] | undefined>;
    const one = (name: string): string | undefined => {
      const raw = headers[name];
      if (Array.isArray(raw)) return raw[0];
      return raw;
    };

    this.tenantContext.setScope({
      organizationId: one(TEST_ORG_HEADER) ?? null,
      userId: one(TEST_USER_HEADER) ?? null,
      sessionId: null,
      roles: [],
      permissions: (one(TEST_PERMS_HEADER) ?? '').split(',').filter(Boolean),
      requestId: one('x-request-id') ?? '',
      isPlatformJob: false,
      // TEST-ONLY seam: simulate a patient-participant (self-scoped portal
      // session) claiming ownership of a single record.
      patientId: one(TEST_PATIENT_HEADER) ?? null,
    });
    next();
  }
}

@Module({ providers: [TestPrincipalMiddleware] })
export class TestPrincipalModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TestPrincipalMiddleware).forRoutes('*');
  }
}

export interface TestAppOptions {
  /** Enable authenticated flows via the test principal middleware. */
  tenantHeaders?: boolean;
}

/** Builds a Nest Fastify app mirroring main.ts bootstrap for e2e. */
export async function createTestApp(
  options: TestAppOptions = {},
): Promise<NestFastifyApplication> {
  const imports = options.tenantHeaders ? [AppModule, TestPrincipalModule] : [AppModule];

  const moduleRef = await Test.createTestingModule({ imports }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ bodyLimit: 1024 * 1024 }),
  );

  await app.register(helmet, { contentSecurityPolicy: false });

  const env: Env = app.get(ENV);
  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });

  app.useGlobalPipes(new ZodValidationPipe());

  app.setGlobalPrefix(env.API_PREFIX, {
    exclude: ['health/(.*)', 'health', env.METRICS_ENABLED ? env.METRICS_PATH : ''],
  });

  await app.init();
  return app;
}

/**
 * Returns an auth-bearing header set for the given tenant/permissions. Omit
 * headers for a denied (anonymous/zero-scope) request.
 */
export function principalHeaders(opts: {
  organizationId: string;
  userId?: string;
  permissions?: string[];
  requestId?: string;
  patientId?: string;
}): Record<string, string> {
  return {
    [TEST_ORG_HEADER]: opts.organizationId,
    [TEST_USER_HEADER]: opts.userId ?? 'test-user',
    [TEST_PERMS_HEADER]: (opts.permissions ?? []).join(','),
    'x-request-id': opts.requestId ?? 'test-request',
    ...(opts.patientId !== undefined ? { [TEST_PATIENT_HEADER]: opts.patientId } : {}),
  };
}
