import { Client } from 'pg';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../support/test-app';
import { PrismaService } from '../../src/database/prisma.service';
import { newId } from '../../src/common/lib/uuidv7';

/**
 * Defense-in-depth RLS test: connects as the restricted `careos_app` role
 * (created by the init migration) and verifies that:
 *   1. a session without app.current_org sees nothing,
 *   2. the GUC-scoped session sees only its own organization,
 *   3. writes outside one's own organization are blocked by RLS,
 *   4. audit_logs are append-only at the database level.
 */
describe('RLS defense-in-depth (careos_app role) — Phase 0', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let orgId: string;
  let conn: Client;

  afterAll(async () => {
    // No row cleanup: audit_logs are append-only (trigger blocks DELETE) and
    // the container is disposable.
    await conn?.end();
    await app?.close();
  });

  beforeAll(async () => {
    app = await createTestApp({ tenantHeaders: true });
    prisma = app.get(PrismaService);

    orgId = newId();
    await prisma.unscoped().organization.create({
      data: { id: orgId, name: 'RLS Test Org' },
    });

    const raw = process.env.DATABASE_URL as string;
    const connString = raw
      .replace(/^postgresql:\/\//, 'postgres://')
      .replace(
        'careos:careos',
        `careos_app:${process.env.RLS_APP_PASSWORD ?? '__CHANGE_ME__'}`,
      )
      .split('?')[0];

    conn = new Client({ connectionString: connString });
    await conn.connect();
  });

  it('session without app.current_org sees an empty namespace (RLS denies)', async () => {
    const res = await conn.query(`SELECT count(*)::int AS n FROM "Organization"`);
    expect(res.rows[0]?.n).toBe(0);
  });

  it('GUC-scoped session sees only its own organization', async () => {
    await conn.query(`SELECT set_config('app.current_org', $1, false)`, [orgId]);
    const res = await conn.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "Organization"`,
    );
    expect(res.rows[0]?.n).toBe(1);
  });

  it('inserts pointing at another organization are rejected', async () => {
    await conn.query(`SELECT set_config('app.current_org', $1, false)`, [orgId]);
    await expect(
      conn.query(
        `INSERT INTO "outbox_events" (id, "organizationId", type, "aggregateType", "aggregateId", "occurredAt", payload, "attemptCount")
         VALUES ($1, $2, 'CareOS.Probe', 'x', 'y', now(), '{}'::jsonb, 0)`,
        [newId(), newId()],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('audit_logs are append-only (UPDATE and DELETE rejected by trigger)', async () => {
    const auditId = newId();
    await prisma.unscoped().auditLog.create({
      data: { id: auditId, organizationId: orgId, action: 'rls.smoke', resource: 'rls' },
    });

    await expect(
      prisma.unscoped()
        .$queryRaw`UPDATE "audit_logs" SET "action" = 'tampered' WHERE "id" = ${auditId}`,
    ).rejects.toThrow(/append-only/i);

    await expect(
      prisma.unscoped().$queryRaw`DELETE FROM "audit_logs" WHERE "id" = ${auditId}`,
    ).rejects.toThrow(/append-only/i);
  });
});
