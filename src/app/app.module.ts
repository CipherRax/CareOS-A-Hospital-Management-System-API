import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ClsMiddleware, ClsModule } from 'nestjs-cls';
import { ConfigModule, ENV } from '../config/config.module';
import type { Env } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { AppExceptionFilter } from '../common/filters/app-exception.filter';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { RequestScopeInterceptor } from '../common/interceptors/request-scope.interceptor';
import { HealthModule } from '../modules/health/health.module';
import { OrganizationsModule } from '../modules/organizations/organizations.module';
import { DemoModule } from '../modules/demo/demo.module';
import { newId } from '../common/lib/uuidv7';

@Global()
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    DiscoveryModule,
    // CLS is global; the middleware is mounted explicitly below so it runs
    // before the test-principal middleware in e2e (mount: false avoids double).
    ClsModule.forRoot({ global: true, middleware: { mount: false } }),
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          genReqId: (req: { headers?: Record<string, unknown>; id?: unknown }) =>
            (req.headers?.['x-request-id'] as string) ?? req.id?.toString() ?? newId(),
          redact: {
            paths: env.LOG_REDACT_PATHS.split(',') as string[],
            censor: '[REDACTED]',
          },
          autoLogging: {
            ignore: (req) =>
              (req as { url?: string }).url?.startsWith('/health') === true,
          },
        },
      }),
    }),
    HealthModule,
    OrganizationsModule,
    DemoModule,
  ],
  providers: [
    // Guard order: throttler (outer) then permissions (inner). Public routes
    // (health) pass both; every other route must carry authorization metadata.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    // Interceptor order matters: Transform is outer (envelope), then
    // Idempotency (replays raw handler values), then RequestId (inner).
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: RequestScopeInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ClsMiddleware).forRoutes('*');
  }
}
