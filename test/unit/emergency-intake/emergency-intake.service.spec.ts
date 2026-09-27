import { FieldEncryption } from '../../../src/common/security/crypto';
import { ErrorCodes } from '../../../src/common/errors/codes';
import { EmergencyIntakeService } from '../../../src/modules/emergency-intake/emergency-intake.service';
import type { PrismaService } from '../../../src/database/prisma.service';
import type { TenantContext } from '../../../src/database/tenant-context';
import type { TxRunner } from '../../../src/database/tx';
import type { RealtimeService } from '../../../src/database/realtime.service';
import type { Queue } from 'bullmq';

const SECRET = 'unit-test-key-encryption-secret-0123456789abcdef';

function projection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-1',
    slug: 'st-matthews',
    name: 'St Matthews Hospital',
    status: 'PUBLISHED',
    emergencyIntakeEnabled: true,
    sourceOrganizationId: 'org-1',
    sourceBranchId: 'branch-1',
    locationLat: -1.2921,
    locationLng: 36.8219,
    phone: '+254 20 555 0100',
    ...overrides,
  };
}

function makeMocks() {
  const findFirst = jest.fn();
  const unscoped = { publicFacilityListing: { findFirst } } as never;
  const tenant: Record<string, unknown> = {};
  const prisma = { unscoped: () => unscoped, tenantFor: () => tenant };
  const tenantContext = { scope: {}, requireOrg: jest.fn(() => 'org-1'), requireUserId: jest.fn(() => 'user-1') };
  const realtime = { publish: jest.fn() };
  const queue = { add: jest.fn() };
  const encryption = new FieldEncryption(SECRET);
  const txContext: { db: Record<string, unknown>; emit: (e: unknown) => void } = {
    db: {},
    emit: jest.fn(),
  };
  const txRun = jest.fn(async (work: (ctx: unknown) => Promise<unknown>) => work(txContext));
  const service = new EmergencyIntakeService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContext,
    { run: txRun } as unknown as TxRunner,
    realtime as unknown as RealtimeService,
    encryption,
    queue as unknown as Queue,
  );
  return { service, findFirst, tenant, tenantContext, realtime, queue, txContext };
}

describe('EmergencyIntakeService.submitPublic guards', () => {
  it('rejects an unknown slug', async () => {
    const { service, findFirst } = makeMocks();
    findFirst.mockResolvedValue(null);
    await expect(service.submitPublic({ slug: 'nope' } as never)).rejects.toMatchObject({
      code: ErrorCodes.PUBLIC_LISTING_NOT_PUBLISHED,
    });
  });

  it('rejects a listing that is not PUBLISHED', async () => {
    const { service, findFirst } = makeMocks();
    findFirst.mockResolvedValue(projection({ status: 'DRAFT' }));
    await expect(service.submitPublic({ slug: 'st-matthews' } as never)).rejects.toMatchObject({
      code: ErrorCodes.PUBLIC_LISTING_NOT_PUBLISHED,
    });
  });

  it('rejects a facility that has not enabled intake', async () => {
    const { service, findFirst } = makeMocks();
    findFirst.mockResolvedValue(projection({ emergencyIntakeEnabled: false }));
    await expect(service.submitPublic({ slug: 'st-matthews' } as never)).rejects.toMatchObject({
      code: ErrorCodes.FACILITY_NOT_ACCEPTING_REQUESTS,
    });
  });

  it('rejects a published listing with no tenant source', async () => {
    const { service, findFirst } = makeMocks();
    findFirst.mockResolvedValue(
      projection({ sourceOrganizationId: null, sourceBranchId: null }),
    );
    await expect(service.submitPublic({ slug: 'st-matthews' } as never)).rejects.toMatchObject({
      code: ErrorCodes.FACILITY_NOT_ACCEPTING_REQUESTS,
    });
  });

  it('rejects a partial location', async () => {
    const { service, findFirst } = makeMocks();
    findFirst.mockResolvedValue(projection());
    await expect(
      service.submitPublic({ slug: 'st-matthews', location: { lat: -1.29 } } as never),
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_COORDINATES });
  });

  it('requires a location when the facility cannot be located', async () => {
    const { service, findFirst } = makeMocks();
    findFirst.mockResolvedValue(projection({ locationLat: null, locationLng: null }));
    await expect(service.submitPublic({ slug: 'st-matthews' } as never)).rejects.toMatchObject({
      code: ErrorCodes.LOCATION_REQUIRED,
    });
  });
});

describe('EmergencyIntakeService.submitPublic happy path', () => {
  it('writes the tenant request, emits RECEIVED, returns the token once, schedules escalation', async () => {
    const { service, findFirst, realtime, queue, tenant, txContext } = makeMocks();
    findFirst.mockResolvedValue(projection());

    const db = {
      emergencyRequest: {
        create: jest.fn().mockResolvedValue({ id: 'req-1', trackingTokenHash: 'hash' }),
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 'req-1',
          referenceNumber: 'EMR-2026-000001',
          trackingTokenHash: 'hash',
        }),
        findFirst: jest.fn().mockResolvedValue({ id: 'req-1', branchId: 'branch-1' }),
      },
      emergencyRequestEvent: { create: jest.fn().mockResolvedValue({ id: 'ev-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([{ value: 1n }]),
    };
    (txContext as { db: Record<string, unknown> }).db = db;
    tenant.emergencyRequest = db.emergencyRequest;
    tenant.emergencyRequestEvent = db.emergencyRequestEvent;
    tenant.emergencyIntakePolicy = {
      findFirst: jest.fn().mockResolvedValue({ enabled: true, autoEscalate: true }),
    };

    const out = await service.submitPublic({
      slug: 'st-matthews',
      callerName: 'Jane Doe',
      callerPhone: '+254 712 345 678',
      description: 'Maternal emergency at home',
      location: { lat: -1.2921, lng: 36.8219, landmark: 'Near the green gate' },
    } as never);

    expect(db.emergencyRequest.create).toHaveBeenCalledTimes(1);
    const createData = (db.emergencyRequest.create as jest.Mock).mock.calls[0][0].data;
    expect(createData).toMatchObject({
      organizationId: 'org-1',
      branchId: 'branch-1',
      referenceNumber: expect.stringMatching(/^EMR-\d{4}-\d{6}$/),
      status: 'RECEIVED',
      source: 'PUBLIC',
    });
    expect(createData.trackingTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(createData.callerPhoneIndex).toBe('+254712345678');
    expect(createData.callerPhoneEnc).not.toBeNull();
    expect(createData.callerPhoneEnc).not.toContain('712345678');
    expect(createData.locationLat).toBe(-1.2921);
    expect(txContext.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'Emergency.RequestReceived', aggregateId: 'req-1' }),
    );
    expect(out.request.trackingToken).toBeTruthy();
    expect(out.request.trackingToken).not.toBe(createData.trackingTokenHash);
    expect(out.request.referenceNumber).toBe('EMR-2026-000001');
    expect(tenant.emergencyIntakePolicy).toBeTruthy();
    expect(queue.add).toHaveBeenCalledWith(
      'escalate',
      expect.objectContaining({ requestId: 'req-1', level: 1, organizationId: 'org-1' }),
      expect.objectContaining({ jobId: 'req-1-1' }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      'org-1',
      expect.any(String),
      expect.objectContaining({ event: 'Emergency.RequestReceived' }),
    );

    // The caller's encrypted PII must not leak into the outbox payload or the
    // response — only the facility's public contact number is surfaced.
    expect((txContext.emit as jest.Mock).mock.calls[0][0].payload).toEqual({ requestId: 'req-1' });
    const json = JSON.stringify(out);
    expect(json).not.toContain('712345678');
    expect(json).not.toContain('Jane');
    expect(json).not.toContain('green gate');
  });
});