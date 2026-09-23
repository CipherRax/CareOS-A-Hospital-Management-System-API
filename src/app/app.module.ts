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
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { RequestScopeInterceptor } from '../common/interceptors/request-scope.interceptor';
import { HealthModule } from '../modules/health/health.module';
import { OrganizationsModule } from '../modules/organizations/organizations.module';
import { DemoModule } from '../modules/demo/demo.module';
import { AuthModule } from '../modules/auth/auth.module';
import { UsersModule } from '../modules/users/users.module';
import { RolesModule } from '../modules/roles/roles.module';
import { BranchesModule } from '../modules/branches/branches.module';
import { DepartmentsModule } from '../modules/departments/departments.module';
import { StaffModule } from '../modules/staff/staff.module';
import { BreakGlassModule } from '../modules/break-glass/break-glass.module';
import { DocumentsModule } from '../modules/documents/documents.module';
import { PatientsModule } from '../modules/patients/patients.module';
import { SchedulesModule } from '../modules/schedules/schedules.module';
import { AppointmentsModule } from '../modules/appointments/appointments.module';
import { QueueModule } from '../modules/queue/queue.module';
import { VitalsModule } from '../modules/vitals/vitals.module';
import { DisplayModule } from '../modules/display/display.module';
import { RealtimeModule } from '../modules/realtime/realtime.module';
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
    AuthModule,
    UsersModule,
    RolesModule,
    BranchesModule,
    DepartmentsModule,
    StaffModule,
    BreakGlassModule,
    DocumentsModule,
    PatientsModule,
    SchedulesModule,
    AppointmentsModule,
    QueueModule,
    VitalsModule,
    DisplayModule,
    RealtimeModule,
  ],
  providers: [
    // Guard order: throttler (outer) -> JWT identity -> session/tenant
    // revalidation (permissions re-resolved) -> permissions. Public routes
    // (health) pass all of them; every other route must carry auth metadata.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
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
