import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ClsService } from 'nestjs-cls';
import { createTestApp, principalHeaders } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import type { TenantScope } from '../../src/database/tenant-context';
import { newId } from '../../src/common/lib/uuidv7';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createCls(app: NestFastifyApplication): ClsService {
  return app.get(ClsService);
}

describe('tenant pipeline (auth, tenancy, outbox, idempotency) — Phase 0', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let env: Env;
  let orgA: string;
  let orgB: string;

  const headerFor = (
    organizationId: string,
    permissions: string[],
    extra: Record<string, string> = {},
  ) => ({
    ...principalHeaders({ organizationId, userId: 'test-user', permissions }),
    ...extra,
  });

  beforeAll(async () => {
    app = await createTestApp({ tenantHeaders: true });
    prisma = app.get(PrismaService);
    env = app.get(ENV);

    orgA = newId();
    orgB = newId();
    await prisma.unscoped().organization.createMany({
      data: [
        { id: orgA, name: 'Pipeline Test Org A' },
        { id: orgB, name: 'Pipeline Test Org B' },
      ],
    });
  });

  afterAll(async () => {
    // No row cleanup: audit_logs are append-only (trigger) and outbox_events
    // reference the org with onDelete: Restrict. The container is disposable.
    await app.close();
  });

  it('organizations/me returns the tenant from the (test) principal, not the body', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${env.API_PREFIX}/organizations/me`,
      headers: headerFor(orgA, ['organizations.read']),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.organization.id).toBe(orgA);
    expect(body.data.organization.name).toBe('Pipeline Test Org A');
  });

  it('enforces tenant scoping on the tenant-scoped client (cross-org isolation)', async () => {
    // Write a probe + audit trail while scoped to A (via the HTTP pipeline).
    const res = await app.inject({
      method: 'POST',
      url: `${env.API_PREFIX}/_demo/outbox`,
      headers: headerFor(orgA, ['organizations.manage'], { 'idempotency-key': newId() }),
      payload: { label: 'cross-tenant sentinel' },
    });
    expect(res.statusCode).toBe(201);

    const cls = createCls(app);
    const scopeFor = (organizationId: string): TenantScope => ({
      organizationId,
      userId: 'test-user',
      sessionId: null,
      roles: ['admin'],
      permissions: ['organizations.manage'],
      requestId: 'test',
      isPlatformJob: false,
    });

    const countOutbox = (scope: TenantScope): Promise<number> =>
      cls.run(async () => {
        cls.set('scope', scope);
        return prisma.tenant.outboxEvent.count();
      });

    // A sees its own probe events.
    const aCount = await countOutbox(scopeFor(orgA));
    expect(aCount).toBeGreaterThan(0);

    // B sees zero of A's rows through the same tenant client.
    const bCount = await countOutbox(scopeFor(orgB));
    expect(bCount).toBe(0);

    // Without any scope, tenanted operations refuse (no accidental global reads).
    const unset = prisma.tenant.auditLog.count();
    await expect(unset).rejects.toThrow(/tenant/i);
  });

  it('commits business rows and outbox events in ONE transaction', async () => {
    const before = await prisma
      .unscoped()
      .outboxEvent.count({ where: { organizationId: orgA } });

    const auditBefore = await prisma.unscoped().auditLog.count({
      where: { organizationId: orgA, action: 'demo.probe' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `${env.API_PREFIX}/_demo/outbox`,
      headers: headerFor(orgA, ['organizations.manage']),
      payload: { label: 'tx probe' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.ok).toBe(true);
    expect(body.data.eventType).toBe('CareOS.Probe');

    const after = await prisma
      .unscoped()
      .outboxEvent.count({ where: { organizationId: orgA } });
    expect(after).toBe(before + 1);

    const auditCount = await prisma.unscoped().auditLog.count({
      where: { organizationId: orgA, action: 'demo.probe' },
    });
    expect(auditCount).toBe(auditBefore + 1);
  });

  it('replays the stored response for a repeated Idempotency-Key', async () => {
    const key = newId();
    const doPost = () =>
      app.inject({
        method: 'POST',
        url: `${env.API_PREFIX}/_demo/outbox`,
        headers: headerFor(orgA, ['organizations.manage'], { 'idempotency-key': key }),
        payload: { label: 'idempotent probe' },
      });

    const res1 = await doPost();
    expect(res1.statusCode).toBe(201);
    const auditId1 = res1.json().data.auditId as string;

    // Wait for the completion to be persisted before replay.
    let recordStatus: string | undefined;
    for (let i = 0; i < 40; i++) {
      const record = await prisma.unscoped().idempotencyRecord.findFirst({
        where: { organizationId: orgA, idempotencyKey: key },
      });
      recordStatus = record?.status;
      if (recordStatus === 'COMPLETED') break;
      await sleep(100);
    }
    expect(recordStatus).toBe('COMPLETED');

    const res2 = await doPost();
    expect(res2.statusCode).toBe(200);
    expect(res2.json().data.auditId).toBe(auditId1);

    const count = await prisma
      .unscoped()
      .auditLog.count({ where: { organizationId: orgA, id: auditId1 } });
    expect(count).toBe(1);
  });

  it('rejects the same Idempotency-Key with a different payload (409)', async () => {
    const key = newId();
    const doPost = (label: string) =>
      app.inject({
        method: 'POST',
        url: `${env.API_PREFIX}/_demo/outbox`,
        headers: headerFor(orgA, ['organizations.manage'], { 'idempotency-key': key }),
        payload: { label },
      });

    const res1 = await doPost('variant-1');
    expect(res1.statusCode).toBe(201);
    await sleep(300);

    const res2 = await doPost('variant-2');
    expect(res2.statusCode).toBe(409);
    const body = res2.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('denies the demo route when the principal lacks the permission', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${env.API_PREFIX}/_demo/outbox`,
      headers: headerFor(orgA, ['patients.read']),
      payload: { label: 'no-access' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERMISSION_DENIED');
  });
});
