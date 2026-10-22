import { SyncService } from '../../../src/modules/sync/sync.service';
import { ErrorCodes } from '../../../src/common/errors/codes';
import { AppError } from '../../../src/common/errors/app-error';
import type { PrismaService } from '../../../src/database/prisma.service';
import type { TenantContext } from '../../../src/database/tenant-context';
import { PERMISSION_GROUPS } from '../../../src/common/auth/permissions.catalog';

interface Row {
  id: string;
  seq: bigint;
  resourceType: string;
  resourceId: string;
  operation: 'UPSERT' | 'DELETE';
  version: number;
  branchId: string | null;
  occurredAt: Date;
}

function makeMocks(rows: Row[], permissions: string[]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const tenant = { changeLog: { findMany } };
  const prisma = { tenantFor: jest.fn(() => tenant) };
  const tenantContext = {
    scope: { permissions },
    requireOrg: jest.fn(() => 'org-1'),
  };
  const service = new SyncService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContext,
  );
  return { service, findMany, tenant };
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'chg-0001',
    seq: BigInt(1),
    resourceType: 'patient',
    resourceId: 'pat-1',
    operation: 'UPSERT',
    version: 1,
    branchId: null,
    occurredAt: new Date('2026-01-02T03:04:05.000Z'),
    ...overrides,
  };
}

describe('SyncService.pull', () => {
  it('returns changes after the cursor and computes the next cursor', async () => {
    const { service, findMany } = makeMocks(
      [
        row({ id: 'chg-0002', seq: BigInt(2), resourceType: 'appointment', resourceId: 'apt-1' }),
        row({ id: 'chg-0003', seq: BigInt(3), resourceType: 'patient', resourceId: 'pat-2' }),
      ],
      [PERMISSION_GROUPS.patients.read, PERMISSION_GROUPS.appointments.read],
    );

    const page = await service.pull({ cursor: '1' });

    expect(page.changes.map((c) => c.id)).toEqual(['chg-0002', 'chg-0003']);
    expect(page.cursor).toBe('3');
    expect(page.hasMore).toBe(false);
    const where = findMany.mock.calls[0][0].where;
    expect(where.seq).toEqual({ gt: BigInt(1) });
  });

  it('reports hasMore and truncates the page when more rows exist', async () => {
    const { service, findMany } = makeMocks(
      [
        row({ id: 'chg-0002', seq: BigInt(2) }),
        row({ id: 'chg-0003', seq: BigInt(3) }),
        row({ id: 'chg-0004', seq: BigInt(4) }),
      ],
      [PERMISSION_GROUPS.patients.read],
    );

    const page = await service.pull({ limit: 2 });

    expect(page.changes).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.cursor).toBe('3');
    expect(findMany.mock.calls[0][0].take).toBe(3);
  });

  it('echoes the cursor when nothing changed so a poll does not reset history', async () => {
    const { service } = makeMocks([], [PERMISSION_GROUPS.patients.read]);

    const page = await service.pull({ cursor: '42' });

    expect(page.changes).toEqual([]);
    expect(page.cursor).toBe('42');
    expect(page.hasMore).toBe(false);
  });

  it('filters the pull to the resources the caller may read', async () => {
    const { service, findMany } = makeMocks([], [PERMISSION_GROUPS.patients.read]);

    await service.pull({});

    const where = findMany.mock.calls[0][0].where;
    expect(where.resourceType.in).toEqual(['patient']);
    expect(where.requiredPermission.in).toEqual([PERMISSION_GROUPS.patients.read]);
  });

  it('narrows to the requested resource types', async () => {
    const { service, findMany } = makeMocks(
      [],
      [PERMISSION_GROUPS.patients.read, PERMISSION_GROUPS.appointments.read],
    );

    await service.pull({ resources: ['patient'] });

    const where = findMany.mock.calls[0][0].where;
    expect(where.resourceType.in).toEqual(['patient']);
  });

  it('drops a requested resource the caller has no permission for', async () => {
    const { service, findMany } = makeMocks([], [PERMISSION_GROUPS.patients.read]);

    await service.pull({ resources: ['patient', 'invoice'] });

    const where = findMany.mock.calls[0][0].where;
    expect(where.resourceType.in).toEqual(['patient']);
  });

  it('rejects an unknown resource type', async () => {
    const { service } = makeMocks([], [PERMISSION_GROUPS.patients.read]);

    await expect(service.pull({ resources: ['unicorn'] })).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(service.pull({ resources: ['unicorn'] })).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION_ERROR,
    });
  });

  it('rejects a malformed cursor', async () => {
    const { service } = makeMocks([], [PERMISSION_GROUPS.patients.read]);

    await expect(service.pull({ cursor: 'not-a-cursor!' })).rejects.toMatchObject({
      code: ErrorCodes.INVALID_SYNC_CURSOR,
    });
  });

  it('returns no rows at all when the caller holds no syncable permission', async () => {
    const { service, findMany } = makeMocks([], []);

    const page = await service.pull({});

    expect(page.changes).toEqual([]);
    const where = findMany.mock.calls[0][0].where;
    expect(where.resourceType.in).toEqual([]);
    expect(where.requiredPermission.in).toEqual([]);
  });
});
