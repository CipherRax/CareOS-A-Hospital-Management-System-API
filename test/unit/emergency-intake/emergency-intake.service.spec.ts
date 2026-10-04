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

/**
 * A branch that passes the intake-readiness guard: enabled, auto-escalating,
 * one on-call contact with a phone.
 */
const READY_POLICY = { enabled: true, autoEscalate: true, levelSeconds: [120, 300, 900] };
const READY_CONTACTS = [{ active: true, onCall: true, phone: '+254 700 000 000', userId: null }];

function makeMocks(overrides: { policy?: unknown; contacts?: unknown } = {}) {
  const findFirst = jest.fn();
  const unscoped = { publicFacilityListing: { findFirst } } as never;
  const tenant: Record<string, unknown> = {
    // Default readiness state: submit-time guard passes unless a test overrides.
    emergencyIntakePolicy: {
      findFirst: jest.fn().mockResolvedValue(overrides.policy ?? READY_POLICY),
    },
    emergencyContact: {
      findMany: jest.fn().mockResolvedValue(overrides.contacts ?? READY_CONTACTS),
    },
  };
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
    { EMERGENCY_DEDUPE_SECONDS: 120, EMERGENCY_RETENTION_DAYS: 90 } as never,
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

  it('rejects a facility that has not enabled intake, telling the caller to phone', async () => {
    const { service, findFirst } = makeMocks();
    findFirst.mockResolvedValue(projection({ emergencyIntakeEnabled: false }));
    // EMERGENCY_CALL_NOW, not a bare refusal: the caller must leave with a
    // number to ring (brief §6.15).
    const err = await service
      .submitPublic({ slug: 'st-matthews' } as never)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: ErrorCodes.EMERGENCY_CALL_NOW });
    expect((err as { details: { numbers: Array<{ phone: string }> } }).details.numbers.length).toBeGreaterThan(0);
  });

  it('rejects a published listing with no tenant source', async () => {
    const { service, findFirst } = makeMocks();
    findFirst.mockResolvedValue(
      projection({ sourceOrganizationId: null, sourceBranchId: null }),
    );
    await expect(service.submitPublic({ slug: 'st-matthews' } as never)).rejects.toMatchObject({
      code: ErrorCodes.EMERGENCY_CALL_NOW,
    });
  });

  it('refuses intake when the branch has no on-call contact (submit-time guard)', async () => {
    // Defence in depth for branches enabled before the guard existed, or whose
    // contacts were all taken off call afterwards.
    const { service, findFirst } = makeMocks({ contacts: [] });
    findFirst.mockResolvedValue(projection());
    const err = await service.submitPublic({ slug: 'st-matthews' } as never).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: ErrorCodes.EMERGENCY_CALL_NOW });
    expect((err as { details: { facilityIntakeReady: boolean } }).details.facilityIntakeReady).toBe(false);
  });

  it('refuses intake when the only contact is off call', async () => {
    const { service, findFirst } = makeMocks({
      contacts: [{ active: true, onCall: false, phone: '+254 700 000 000', userId: null }],
    });
    findFirst.mockResolvedValue(projection());
    const err = await service.submitPublic({ slug: 'st-matthews' } as never).catch((e: unknown) => e);
    expect((err as { details: { reasons: string[] } }).details.reasons).toContain('NO_CONTACT_CHANNEL');
  });

  it('refuses intake when auto-escalation is switched off', async () => {
    const { service, findFirst } = makeMocks({
      policy: { enabled: true, autoEscalate: false, levelSeconds: [120] },
    });
    findFirst.mockResolvedValue(projection());
    const err = await service.submitPublic({ slug: 'st-matthews' } as never).catch((e: unknown) => e);
    expect((err as { details: { reasons: string[] } }).details.reasons).toContain('AUTO_ESCALATE_OFF');
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
        // Dedupe window finds nothing, then scheduleEscalation resolves the
        // branch so the SLA job is queued.
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({ id: 'req-1', branchId: 'branch-1' }),
      },
      emergencyRequestEvent: { create: jest.fn().mockResolvedValue({ id: 'ev-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([{ value: 1n }]),
    };
    (txContext as { db: Record<string, unknown> }).db = db;
    tenant.emergencyRequest = db.emergencyRequest;
    tenant.emergencyRequestEvent = db.emergencyRequestEvent;
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

describe('EmergencyIntakeService.submitPublic dedupe (ADR-043)', () => {
  it('returns the existing open request and appends the repeat to its history', async () => {
    const { service, findFirst, tenant, realtime, txContext } = makeMocks();
    findFirst.mockResolvedValue(projection());
    const recent = { id: 'req-1', referenceNumber: 'EMR-2026-000001' };
    const update = jest.fn().mockResolvedValue({ id: 'req-1' });
    const eventCreate = jest.fn().mockResolvedValue({ id: 'ev-dup' });
    tenant.emergencyRequest = { findFirst: jest.fn().mockResolvedValue(recent), update };
    txContext.db = {
      emergencyRequest: { update },
      emergencyRequestEvent: { create: eventCreate },
    };

    const out = await service.submitPublic({
      slug: 'st-matthews',
      callerPhone: '+254 712 345 678',
      description: 'Same incident, retry',
      location: { lat: -1.2921, lng: 36.8219 },
    } as never);

    // No second incident, and the caller is told the token already exists
    // rather than being handed a new one.
    expect(out.request).toEqual({
      id: 'req-1',
      referenceNumber: 'EMR-2026-000001',
      trackingToken: null,
      trackingTokenAlreadyIssued: true,
      duplicate: true,
    });
    expect((tenant.emergencyRequest as { create: jest.Mock }).create).toBeUndefined();

    // The repeat is APPENDED, not dropped: staff can see the caller submitted again.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'req-1' },
        data: { mergedCount: { increment: 1 } },
      }),
    );
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'DUPLICATE', actor: 'CALLER', requestId: 'req-1' }),
      }),
    );
    // And the inbox is told, so staff are not blind to the second submission.
    expect(realtime.publish).toHaveBeenCalledWith(
      'org-1',
      'emergency-requests',
      expect.objectContaining({ event: 'Emergency.RequestDuplicate' }),
    );
    expect(
      ((tenant.emergencyRequest as { findFirst: jest.Mock }).findFirst as jest.Mock).mock
        .calls[0][0].where,
    ).toMatchObject({
      organizationId: 'org-1',
      branchId: 'branch-1',
      callerPhoneIndex: '+254712345678',
      status: { in: ['RECEIVED', 'ESCALATED'] },
    });
  });

  it('never puts caller PII into the appended duplicate event', async () => {
    const { service, findFirst, tenant, txContext } = makeMocks();
    findFirst.mockResolvedValue(projection());
    tenant.emergencyRequest = {
      findFirst: jest.fn().mockResolvedValue({ id: 'req-1', referenceNumber: 'EMR-1' }),
    };
    const eventCreate = jest.fn().mockResolvedValue({ id: 'ev' });
    txContext.db = {
      emergencyRequest: { update: jest.fn() },
      emergencyRequestEvent: { create: eventCreate },
    };

    await service.submitPublic({
      slug: 'st-matthews',
      callerPhone: '+254 712 999 888',
      description: 'Chest pain, second submit',
      location: { lat: -1.2921, lng: 36.8219 },
    } as never);

    const serialized = JSON.stringify(eventCreate.mock.calls);
    expect(serialized).not.toContain('999888');
    expect(serialized).not.toContain('Chest pain');
  });

  it('returns the original request for a repeated clientRequestId', async () => {
    const { service, findFirst, tenant } = makeMocks();
    findFirst.mockResolvedValue(projection());
    tenant.emergencyRequest = {
      findFirst: jest
        .fn()
        // First call is the idempotency lookup, which hits.
        .mockResolvedValueOnce({ id: 'req-7', referenceNumber: 'EMR-2026-000007' }),
    };

    const out = await service.submitPublic({
      slug: 'st-matthews',
      clientRequestId: 'browser-retry-key-1',
      location: { lat: -1.2921, lng: 36.8219 },
    } as never);

    expect(out.request.referenceNumber).toBe('EMR-2026-000007');
    expect(out.request.trackingToken).toBeNull();
    expect(
      ((tenant.emergencyRequest as { findFirst: jest.Mock }).findFirst as jest.Mock).mock
        .calls[0][0].where,
    ).toMatchObject({ organizationId: 'org-1', clientRequestId: 'browser-retry-key-1' });
  });

  it('creates a new request for a different phone (no recent match)', async () => {
    const { service, findFirst, tenant, queue, txContext } = makeMocks();
    findFirst.mockResolvedValue(projection());
    const db = {
      emergencyRequest: {
        create: jest.fn().mockResolvedValue({ id: 'req-2', trackingTokenHash: 'hash' }),
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 'req-2',
          referenceNumber: 'EMR-2026-000002',
          trackingTokenHash: 'hash',
        }),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({ id: 'req-2', branchId: 'branch-1' }),
      },
      emergencyRequestEvent: { create: jest.fn().mockResolvedValue({ id: 'ev-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([{ value: 1n }]),
    };
    (txContext as { db: Record<string, unknown> }).db = db;
    tenant.emergencyRequest = db.emergencyRequest;
    tenant.emergencyRequestEvent = db.emergencyRequestEvent;
    const out = await service.submitPublic({
      slug: 'st-matthews',
      callerPhone: '+254 711 000 000',
      description: 'New incident',
      location: { lat: -1.2921, lng: 36.8219 },
    } as never);

    expect(db.emergencyRequest.create).toHaveBeenCalledTimes(1);
    expect(out.request.duplicate).toBeUndefined();
    expect(out.request.trackingToken).toBeTruthy();
    expect(queue.add).toHaveBeenCalledWith(
      'escalate',
      expect.objectContaining({ requestId: 'req-2', level: 1 }),
      expect.anything(),
    );
  });
});

describe('EmergencyIntakeService.reconcileEscalations (ADR-043)', () => {
  const POLICY = { organizationId: 'org-1', branchId: 'branch-1', levelSeconds: [0.05, 0.2] };

  function build(args: {
    open: Array<Record<string, unknown>>;
    lastEvent?: Record<string, unknown> | null;
    tenantRequest?: Record<string, unknown>;
  }) {
    const unscoped = {
      publicFacilityListing: { findFirst: jest.fn() },
      emergencyIntakePolicy: {
        findMany: jest.fn().mockResolvedValue([POLICY]),
      },
      emergencyRequest: { findMany: jest.fn().mockResolvedValue(args.open) },
      emergencyRequestEvent: {
        findFirst: jest.fn().mockResolvedValue(args.lastEvent ?? null),
      },
    };
    const tenant: Record<string, unknown> = {};
    const prisma = { unscoped: () => unscoped, tenantFor: () => tenant };
    const tenantContext = {
      scope: {},
      requireOrg: jest.fn(() => 'org-1'),
      requireUserId: jest.fn(() => 'user-1'),
    };
    const realtime = { publish: jest.fn() };
    const queue = { add: jest.fn() };
    const encryption = new FieldEncryption(SECRET);
    const txContext: { db: Record<string, unknown>; emit: (e: unknown) => void } = {
      db: {},
      emit: jest.fn(),
    };
    const txRun = jest.fn(async (work: (ctx: unknown) => Promise<unknown>) => work(txContext));
    const service = new EmergencyIntakeService(
      prisma as never,
      tenantContext as never,
      { run: txRun } as never,
      realtime as never,
      encryption,
      queue as never,
      { EMERGENCY_DEDUPE_SECONDS: 120, EMERGENCY_RETENTION_DAYS: 90 } as never,
    );

    tenant.emergencyRequest = {
      findFirst: jest.fn().mockResolvedValue(args.tenantRequest),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    tenant.emergencyIntakePolicy = {
      findFirst: jest
        .fn()
        .mockResolvedValue({ enabled: true, autoEscalate: true, levelSeconds: [0.05, 0.2] }),
    };
    txContext.db = {
      emergencyRequestEvent: { create: jest.fn().mockResolvedValue({ id: 'ev-x' }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'a-x' }) },
    };
    return { service, tenant, queue };
  }

  it('re-promotes an overdue RECEIVED request to level 1', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 60_000);
    const { service, tenant } = build({
      open: [
        {
          id: 'req-1',
          organizationId: 'org-1',
          branchId: 'branch-1',
          status: 'RECEIVED',
          escalationLevel: 0,
          createdAt: old,
          updatedAt: old,
        },
      ],
      tenantRequest: { id: 'req-1', status: 'RECEIVED', branchId: 'branch-1', escalationLevel: 0 },
    });

    const out = await service.reconcileEscalations(now);
    expect(out).toEqual({ scanned: 1, advanced: 1 });
    expect(
      (tenant.emergencyRequest as { updateMany: jest.Mock }).updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ escalationLevel: 0 }),
      }),
    );
  });

  it('advances a stuck ESCALATED request whose later-level job was lost', async () => {
    const now = new Date();
    const lastEscalated = new Date(now.getTime() - 10_000);
    const { service, tenant } = build({
      open: [
        {
          id: 'req-1',
          organizationId: 'org-1',
          branchId: 'branch-1',
          status: 'ESCALATED',
          escalationLevel: 1,
          createdAt: new Date(now.getTime() - 120_000),
          updatedAt: lastEscalated,
        },
      ],
      lastEvent: { occurredAt: lastEscalated },
      tenantRequest: { id: 'req-1', status: 'ESCALATED', branchId: 'branch-1', escalationLevel: 1 },
    });

    const out = await service.reconcileEscalations(now);
    expect(out).toEqual({ scanned: 1, advanced: 1 });
    expect(
      (tenant.emergencyRequest as { updateMany: jest.Mock }).updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ escalationLevel: 1 }),
      }),
    );
  });

  it('leaves requests that are not yet overdue alone', async () => {
    const now = new Date();
    const { service, tenant } = build({
      open: [
        {
          id: 'req-1',
          organizationId: 'org-1',
          branchId: 'branch-1',
          status: 'RECEIVED',
          escalationLevel: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
      tenantRequest: { id: 'req-1', status: 'RECEIVED', branchId: 'branch-1', escalationLevel: 0 },
    });

    const out = await service.reconcileEscalations(now);
    expect(out).toEqual({ scanned: 1, advanced: 0 });
    expect(
      (tenant.emergencyRequest as { updateMany: jest.Mock }).updateMany,
    ).not.toHaveBeenCalled();
  });

  it('short-circuits when no enabled auto-escalate policy exists', async () => {
    const prisma = {
      unscoped: () => ({
        publicFacilityListing: { findFirst: jest.fn() },
        emergencyIntakePolicy: { findMany: jest.fn().mockResolvedValue([]) },
        emergencyRequest: { findMany: jest.fn() },
      }),
      tenantFor: () => ({}),
    };
    const service = new EmergencyIntakeService(
      prisma as never,
      { scope: {} } as never,
      { run: jest.fn() } as never,
      { publish: jest.fn() } as never,
      new FieldEncryption(SECRET),
      { add: jest.fn() } as never,
      { EMERGENCY_DEDUPE_SECONDS: 120, EMERGENCY_RETENTION_DAYS: 90 } as never,
    );

    const out = await service.reconcileEscalations(new Date());
    expect(out).toEqual({ scanned: 0, advanced: 0 });
  });
});

describe('EmergencyIntakeService.applyRetention (ADR-043)', () => {
  function build(args: { candidates: Array<Record<string, unknown>>; days?: number }) {
    const unscoped = {
      publicFacilityListing: { findFirst: jest.fn() },
      emergencyRequest: { findMany: jest.fn().mockResolvedValue(args.candidates) },
    };
    const tenant: Record<string, unknown> = {};
    const prisma = { unscoped: () => unscoped, tenantFor: () => tenant };
    const tenantContext = {
      scope: {},
      requireOrg: jest.fn(() => 'org-1'),
      requireUserId: jest.fn(() => 'user-1'),
    };
    const realtime = { publish: jest.fn() };
    const queue = { add: jest.fn() };
    const encryption = new FieldEncryption(SECRET);
    const txContext: { db: Record<string, unknown>; emit: (e: unknown) => void } = {
      db: {},
      emit: jest.fn(),
    };
    const txRun = jest.fn(async (work: (ctx: unknown) => Promise<unknown>) => work(txContext));
    const service = new EmergencyIntakeService(
      prisma as never,
      tenantContext as never,
      { run: txRun } as never,
      realtime as never,
      encryption,
      queue as never,
      {
        EMERGENCY_DEDUPE_SECONDS: 120,
        EMERGENCY_RETENTION_DAYS: args.days ?? 90,
      } as never,
    );
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    txContext.db = {
      emergencyRequest: { updateMany },
      emergencyRequestEvent: { create: jest.fn().mockResolvedValue({ id: 'ev-r' }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'a-r' }) },
    };
    return { service, unscoped, txContext, updateMany, realtime };
  }

  it('anonymizes eligible terminal requests and retires the token', async () => {
    const now = new Date();
    const { service, txContext, updateMany, realtime } = build({
      candidates: [
        { id: 'req-99', organizationId: 'org-1', referenceNumber: 'EMR-2026-000099' },
      ],
    });

    const out = await service.applyRetention(now);
    expect(out).toEqual({ scanned: 1, retained: 1 });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'req-99', organizationId: 'org-1' },
        data: expect.objectContaining({
          retainedAt: now,
          trackingTokenHash: 'retired:req-99',
          callerNameEnc: null,
          callerPhoneEnc: null,
          callerPhoneIndex: null,
          descriptionEnc: null,
          landmarkEnc: null,
          staffNoteEnc: null,
        }),
      }),
    );
    const eventCreate = (txContext.db.emergencyRequestEvent as { create: jest.Mock }).create;
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'RETENTION', level: null, actor: 'SYSTEM' }),
      }),
    );
    expect((txContext.db.auditLog as { create: jest.Mock }).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'emergency_request.pii_retained' }),
      }),
    );
    expect(txContext.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'Emergency.RequestRetained', aggregateId: 'req-99' }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      'org-1',
      'emergency-requests',
      expect.objectContaining({
        event: 'Emergency.RequestRetained',
        aggregateId: 'req-99',
        payload: expect.objectContaining({ requestId: 'req-99' }),
      }),
    );
  });

  it('returns early when retention is disabled (0 days)', async () => {
    const { service } = build({ candidates: [], days: 0 });
    await expect(service.applyRetention(new Date())).resolves.toEqual({
      scanned: 0,
      retained: 0,
    });
  });

  it('ignores updates that lost the guarded race (already retained)', async () => {
    const { service, txContext, realtime } = build({
      candidates: [{ id: 'req-99', organizationId: 'org-1', referenceNumber: 'EMR' }],
    });
    ((txContext.db.emergencyRequest as { updateMany: jest.Mock }).updateMany as jest.Mock).mockResolvedValue(
      { count: 0 },
    );

    await expect(service.applyRetention(new Date())).resolves.toEqual({
      scanned: 1,
      retained: 0,
    });
    expect(
      (txContext.db.emergencyRequestEvent as { create: jest.Mock }).create,
    ).not.toHaveBeenCalled();
    expect(realtime.publish).not.toHaveBeenCalled();
  });
});

/**
 * ADR-055: the sweep previously matched only CLOSED/CANCELLED via closedAt /
 * cancelledAt. UNREACHABLE / REDIRECTED / NOT_ACTIONABLE never wrote a terminal
 * timestamp and DUPLICATE wrote closedAt while carrying a non-matching status, so
 * all four retained encrypted caller PII indefinitely.
 *
 * The bug lived entirely in the query, and the existing suite mocked `findMany`
 * — so it returned the candidates it was handed and never inspected the filter
 * that produced them. These tests assert the query itself.
 */
describe('EmergencyIntakeService.applyRetention — query coverage (ADR-055)', () => {
  function build() {
    const unscoped = {
      emergencyRequest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = { unscoped: () => unscoped, tenantFor: () => ({}) };
    const service = new EmergencyIntakeService(
      prisma as never,
      { scope: {}, requireOrg: () => 'org-1', requireUserId: () => 'user-1' } as never,
      { run: jest.fn() } as never,
      { publish: jest.fn() } as never,
      new FieldEncryption(SECRET),
      { add: jest.fn() } as never,
      { EMERGENCY_DEDUPE_SECONDS: 120, EMERGENCY_RETENTION_DAYS: 90 } as never,
    );
    return { service, unscoped };
  }

  function filterOf(unscoped: { emergencyRequest: { findMany: jest.Mock } }) {
    const [args] = unscoped.emergencyRequest.findMany.mock.calls[0] as [
      { where: { status: { in: string[] }; OR: Array<Record<string, unknown>> } },
    ];
    return args.where;
  }

  it('includes every finished disposition, not only the two closed states', async () => {
    const { service, unscoped } = build();
    await service.applyRetention(new Date());
    expect(filterOf(unscoped).status.in).toEqual(
      expect.arrayContaining(['CLOSED', 'CANCELLED', 'UNREACHABLE', 'REDIRECTED', 'NOT_ACTIONABLE', 'DUPLICATE']),
    );
  });

  it('does not reap requests that are still live', async () => {
    // RECEIVED/ACKNOWLEDGED/CONTACTED/RESPONDING/ESCALATED must stay out of the
    // sweep: a request someone is still working is not eligible for anonymization.
    const { service, unscoped } = build();
    await service.applyRetention(new Date());
    const statuses = filterOf(unscoped).status.in;
    for (const live of ['RECEIVED', 'ACKNOWLEDGED', 'CONTACTED', 'RESPONDING', 'ESCALATED']) {
      expect(statuses).not.toContain(live);
    }
  });

  it('keys off dispositionAt so a non-closed disposition can still age out', async () => {
    // The four dispositions carry no close stamp, so a filter on closedAt alone
    // could never match them — that was the leak.
    const { service, unscoped } = build();
    await service.applyRetention(new Date());
    const { OR } = filterOf(unscoped);
    expect(OR).toContainEqual({ dispositionAt: { lt: expect.any(Date) } });
  });

  it('still reaps pre-existing rows that predate the dispositionAt column', async () => {
    // Rows written before this column existed have it null, so the old
    // timestamps remain a fallback rather than being dropped.
    const { service, unscoped } = build();
    await service.applyRetention(new Date());
    const { OR } = filterOf(unscoped);
    expect(OR).toContainEqual({ dispositionAt: null, closedAt: { lt: expect.any(Date) } });
    expect(OR).toContainEqual({ dispositionAt: null, cancelledAt: { lt: expect.any(Date) } });
  });

  it('never matches an already-retained row', async () => {
    // Idempotency: the job runs repeatedly and must not re-anonymize.
    const { service, unscoped } = build();
    await service.applyRetention(new Date());
    const [args] = unscoped.emergencyRequest.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(args.where.retainedAt).toBeNull();
  });

  it('computes the cutoff from the retention window', async () => {
    const { service, unscoped } = build();
    const now = new Date('2026-06-01T00:00:00.000Z');
    await service.applyRetention(now, 30);
    const [args] = unscoped.emergencyRequest.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    const cutoff = (args.where.OR as Array<{ dispositionAt?: { lt: Date } }>)[0]!.dispositionAt!.lt;
    expect(cutoff.toISOString()).toBe('2026-05-02T00:00:00.000Z');
  });
});