import { PrivacyService } from '../../../src/modules/privacy/privacy.service';
import { ErrorCodes } from '../../../src/common/errors/codes';
import { planAnonymization } from '../../../src/modules/privacy/domain/retention';
import type { PrismaService } from '../../../src/database/prisma.service';
import type { TenantContext } from '../../../src/database/tenant-context';
import type { AuditService } from '../../../src/database/audit.service';
import type { TxRunner } from '../../../src/database/tx';

function makeMocks(overrides: Record<string, unknown> = {}) {
  const retentionPolicy = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    upsert: jest.fn(),
    update: jest.fn(),
  };
  const legalHold = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn(),
  };
  const patient = { findFirst: jest.fn().mockResolvedValue({ id: 'pat-1' }), update: jest.fn() };
  const dataExport = { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) };
  const tenant = { retentionPolicy, legalHold, patient, dataExport, ...overrides };
  const prisma = { tenantFor: jest.fn(() => tenant) };
  const tenantContext = {
    scope: { userId: 'user-1', permissions: [] },
    requireOrg: jest.fn(() => 'org-1'),
  };
  const audit = { record: jest.fn() };
  const txContext = { db: tenant, emit: jest.fn(), organizationId: 'org-1' };
  const txRunner = { run: jest.fn(async (work: (c: unknown) => Promise<unknown>) => work(txContext)) };
  const service = new PrivacyService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContext,
    audit as unknown as AuditService,
    txRunner as unknown as TxRunner,
  );
  return { service, tenant, audit, txContext, txRunner };
}

describe('PrivacyService retention policies', () => {
  it('upserts by category and audits the change', async () => {
    const { service, tenant, audit } = makeMocks();
    tenant.retentionPolicy.upsert.mockResolvedValue({
      id: 'rp-1',
      category: 'patient',
      retentionDays: 2555,
      action: 'ANONYMIZE',
      enabled: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const out = await service.upsertRetentionPolicy({
      category: 'patient',
      retentionDays: 2555,
      action: 'ANONYMIZE',
      enabled: true,
    });

    expect(out.id).toBe('rp-1');
    expect(tenant.retentionPolicy.upsert).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'privacy.retention_policy.upserted' }),
    );
  });

  it('rejects an unknown retention category', async () => {
    const { service } = makeMocks();
    await expect(
      service.upsertRetentionPolicy({
        category: 'unicorns' as never,
        retentionDays: 30,
        action: 'REVIEW',
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR });
  });

  it('404s when updating a policy that does not exist', async () => {
    const { service } = makeMocks();
    await expect(
      service.updateRetentionPolicy('missing', { retentionDays: 10 }),
    ).rejects.toMatchObject({ code: ErrorCodes.RESOURCE_NOT_FOUND });
  });
});

describe('PrivacyService legal holds', () => {
  it('places a hold and emits the event', async () => {
    const { service, tenant, txContext, audit } = makeMocks();
    tenant.legalHold.create.mockResolvedValue({
      id: 'lh-1',
      patientId: 'pat-1',
      reason: 'litigation',
      placedById: 'user-1',
      placedAt: new Date('2026-01-01T00:00:00.000Z'),
      releasedAt: null,
      releasedById: null,
      releaseReason: null,
    });

    const out = await service.placeLegalHold({ patientId: 'pat-1', reason: 'litigation' });

    expect(out.active).toBe(true);
    expect(txContext.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'Privacy.LegalHoldPlaced' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'privacy.legal_hold.placed' }),
    );
  });

  it('refuses a second active hold on the same patient', async () => {
    const { service, tenant } = makeMocks();
    tenant.legalHold.findFirst.mockResolvedValue({ id: 'lh-existing' });

    await expect(
      service.placeLegalHold({ patientId: 'pat-1', reason: 'litigation' }),
    ).rejects.toMatchObject({ code: ErrorCodes.LEGAL_HOLD_ALREADY_ACTIVE });
  });

  it('404s when releasing a hold that does not exist', async () => {
    const { service } = makeMocks();
    await expect(
      service.releaseLegalHold('missing', { releaseReason: 'case closed' }),
    ).rejects.toMatchObject({ code: ErrorCodes.LEGAL_HOLD_NOT_FOUND });
  });

  it('refuses to release a hold twice', async () => {
    const { service, tenant } = makeMocks();
    tenant.legalHold.findFirst.mockResolvedValue({
      id: 'lh-1',
      patientId: 'pat-1',
      releasedAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    await expect(
      service.releaseLegalHold('lh-1', { releaseReason: 'case closed' }),
    ).rejects.toMatchObject({ code: ErrorCodes.CONFLICT });
  });

  it('reports whether a patient is held', async () => {
    const { service, tenant } = makeMocks();
    tenant.legalHold.findFirst.mockResolvedValue({ id: 'lh-1' });
    await expect(service.hasActiveHold('pat-1')).resolves.toBe(true);
    tenant.legalHold.findFirst.mockResolvedValue(null);
    await expect(service.hasActiveHold('pat-1')).resolves.toBe(false);
  });
});

describe('PrivacyService.anonymizePatient', () => {
  it('refuses to anonymize a patient under an active legal hold', async () => {
    const { service, tenant } = makeMocks();
    tenant.legalHold.findFirst.mockResolvedValue({ id: 'lh-1' });
    tenant.patient.update = jest.fn();

    await expect(service.anonymizePatient('pat-1')).rejects.toMatchObject({
      code: ErrorCodes.LEGAL_HOLD_ACTIVE,
    });
    expect(tenant.patient.update).not.toHaveBeenCalled();
  });

  it('anonymizes a patient that is not held', async () => {
    const { service, tenant, audit } = makeMocks();
    tenant.legalHold.findFirst.mockResolvedValue(null);
    tenant.patient.update = jest.fn().mockResolvedValue({});

    const out = await service.anonymizePatient('pat-1');

    expect(out).toEqual({ patientId: 'pat-1', anonymized: true });
    expect(tenant.patient.update).toHaveBeenCalledTimes(1);
    const data = tenant.patient.update.mock.calls[0][0].data;
    expect(data.firstName).toBe('ANONYMIZED');
    expect(data.lastName).toBe('ANON-PAT-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'privacy.patient.anonymized' }),
    );
  });

  it('404s for a patient that does not exist', async () => {
    const { service, tenant } = makeMocks();
    tenant.patient.findFirst.mockResolvedValue(null);

    await expect(service.anonymizePatient('missing')).rejects.toMatchObject({
      code: ErrorCodes.PATIENT_NOT_FOUND,
    });
  });
});

describe('PrivacyService data exports', () => {
  it('records a request as PENDING and emits the request event', async () => {
    const { service, tenant, txContext } = makeMocks();
    tenant.dataExport.create.mockResolvedValue({
      id: 'de-1',
      patientId: 'pat-1',
      requestedById: 'user-1',
      status: 'PENDING',
      format: 'JSON',
      sizeBytes: null,
      failureReason: null,
      expiresAt: null,
      completedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const out = await service.requestDataExport({ patientId: 'pat-1' });

    expect(out.status).toBe('PENDING');
    expect(txContext.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'Privacy.DataExportRequested' }),
    );
  });

  it('404s for an export that does not exist', async () => {
    const { service } = makeMocks();
    await expect(service.getDataExport('missing')).rejects.toMatchObject({
      code: ErrorCodes.DATA_EXPORT_NOT_FOUND,
    });
  });
});

describe('anonymization plan', () => {
  it('replaces the direct identifiers and keeps a stable subject key', () => {
    const plan = planAnonymization('0198abcd-1234-7000-8000-abcdefabcdef');
    expect(plan.firstName).toBe('ANONYMIZED');
    expect(plan.lastName).toBe('ANON-0198ABCD');
    expect(plan.phone).toBeNull();
    expect(plan.email).toBeNull();
    expect(plan.address).toBeNull();
    expect(plan.dateOfBirth).toBeNull();
  });

  it('is stable for the same patient', () => {
    expect(planAnonymization('pat-abcdefgh')).toEqual(planAnonymization('pat-abcdefgh'));
  });
});
