import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminJobsModule } from '../../../src/modules/admin-jobs/admin-jobs.module';
import { AdminJobsService } from '../../../src/modules/admin-jobs/admin-jobs.service';
import { PrismaService } from '../../../src/database/prisma.service';
import { TenantContext } from '../../../src/database/tenant-context';
import { AuditService } from '../../../src/database/audit.service';
import { ENV } from '../../../src/config/config.module';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ADMIN_QUEUE_NAMES } from '../../../src/modules/admin-jobs/domain/admin-queues';

/**
 * Stands in for the global DatabaseModule, which the real application
 * provides. The admin module injects three of its providers.
 */
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: TenantContext, useValue: { requireOrg: () => 'org-1' } },
    { provide: AuditService, useValue: { record: jest.fn() } },
    // The BullMQ root configuration is built from the environment. Nothing
    // connects to Redis in this test, but the token has to resolve.
    {
      provide: ENV,
      useValue: {
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: 6379,
        REDIS_DB: 0,
        BULL_PREFIX: 'careos-test',
      },
    },
  ],
  exports: [PrismaService, TenantContext, AuditService, ENV],
})
class TestDatabaseModule {}

describe('AdminJobsModule wiring', () => {
  it('resolves its dependencies', async () => {
    // The compile step instantiates the providers, which is what proves the
    // dependency graph is complete. Lifecycle hooks are deliberately not
    // triggered: connecting to Redis is not this test's business.
    const moduleRef = await Test.createTestingModule({
      imports: [AdminJobsModule, TestDatabaseModule],
    }).compile();

    const service = moduleRef.get(AdminJobsService);
    expect(service).toBeInstanceOf(AdminJobsService);

    // The queues hold a Redis client each. Nothing connected, but the handles
    // are open, and jest will not exit while they are.
    for (const name of ADMIN_QUEUE_NAMES) {
      await moduleRef.get<Queue>(getQueueToken(name)).close();
    }
  });
});
