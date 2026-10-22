import { PrivacyService } from '../../../src/modules/privacy/privacy.service';
import type { PrismaService } from '../../../src/database/prisma.service';
import type { TenantContext } from '../../../src/database/tenant-context';
import type { AuditService } from '../../../src/database/audit.service';
import type { TxRunner } from '../../../src/database/tx';

/**
 * The retention sweep is the one place where the API removes data. These tests
 * pin the two rules that matter: a patient under a legal hold is never
 * modified, and a REVIEW policy changes nothing.
 */
function makeMocks(options: {
  policies: Array<{
    category: string;
    retentionDays: number;
    action: string;
    enabled: boolean;
  }>;
  heldPatientIds: string[];
  patients?: Array<{ id: string }>;
}) {
  const patientUpdate = jest.fn().mockResolvedValue({});
  const encounterUpdate = jest.fn().mockResolvedValue({});
  const tenant = {
    retentionPolicy: {
      findMany: jest.fn().mockResolvedValue(options.policies),
    },
    legalHold: {
      findFirst: jest.fn(async (args: { where: { patientId: string } }) =>
        options.heldPatientIds.includes(args.where.patientId) ? { id: 'lh-1' } : null,
      ),
    },
    patient: {
      findMany: jest.fn().mockResolvedValue(options.patients ?? [{ id: 'pat-1' }]),
      update: patientUpdate,
    },
    encounter: {
      findMany: jest.fn().mockResolvedValue([]),
      update: encounterUpdate,
    },
    invoice: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const prisma = { tenantFor: jest.fn(() => tenant) };
  const tenantContext = {
    scope: { userId: 'user-1', permissions: [] },
    requireOrg: jest.fn(() => 'org-1'),
  };
  const audit = { record: jest.fn() };
  const txRunner = { run: jest.fn() };
  const service = new PrivacyService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContext,
    audit as unknown as AuditService,
    txRunner as unknown as TxRunner,
  );
  return { service, tenant, patientUpdate, encounterUpdate, audit };
}

describe('PrivacyService.runRetentionSweep', () => {
  it('skips a patient under an active legal hold', async () => {
    const { service, patientUpdate, audit } = makeMocks({
      policies: [
        { category: 'patient', retentionDays: 365, action: 'ANONYMIZE', enabled: true },
      ],
      heldPatientIds: ['pat-1'],
      patients: [{ id: 'pat-1' }],
    });

    const report = await service.runRetentionSweep(new Date('2026-01-01T00:00:00.000Z'));

    expect(patientUpdate).not.toHaveBeenCalled();
    expect(report[0]?.held).toBe(1);
    expect(report[0]?.anonymized).toBe(0);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'privacy.retention.sweep_run' }),
    );
  });

  it('anonymizes a patient that is not held', async () => {
    const { service, patientUpdate } = makeMocks({
      policies: [
        { category: 'patient', retentionDays: 365, action: 'ANONYMIZE', enabled: true },
      ],
      heldPatientIds: [],
      patients: [{ id: 'pat-1' }],
    });

    const report = await service.runRetentionSweep(new Date('2026-01-01T00:00:00.000Z'));

    expect(patientUpdate).toHaveBeenCalledTimes(1);
    const data = patientUpdate.mock.calls[0][0].data;
    expect(data.firstName).toBe('ANONYMIZED');
    expect(data.phone).toBeNull();
    expect(data.status).toBe('ARCHIVED');
    expect(report[0]?.anonymized).toBe(1);
  });

  it('archives a patient when the policy action is ARCHIVE', async () => {
    const { service, patientUpdate } = makeMocks({
      policies: [
        { category: 'patient', retentionDays: 365, action: 'ARCHIVE', enabled: true },
      ],
      heldPatientIds: [],
      patients: [{ id: 'pat-1' }],
    });

    await service.runRetentionSweep(new Date('2026-01-01T00:00:00.000Z'));

    const data = patientUpdate.mock.calls[0][0].data;
    expect(data).toEqual({ status: 'ARCHIVED' });
  });

  it('changes nothing when the policy action is REVIEW', async () => {
    const { service, patientUpdate } = makeMocks({
      policies: [
        { category: 'patient', retentionDays: 365, action: 'REVIEW', enabled: true },
      ],
      heldPatientIds: [],
      patients: [{ id: 'pat-1' }],
    });

    const report = await service.runRetentionSweep(new Date('2026-01-01T00:00:00.000Z'));

    expect(patientUpdate).not.toHaveBeenCalled();
    expect(report[0]?.review).toBe(1);
    expect(report[0]?.processed).toBe(1);
  });

  it('never rewrites financial or audit records', async () => {
    const { service, patientUpdate } = makeMocks({
      policies: [
        { category: 'invoice', retentionDays: 365, action: 'ANONYMIZE', enabled: true },
        { category: 'audit_log', retentionDays: 365, action: 'ANONYMIZE', enabled: true },
      ],
      heldPatientIds: [],
      patients: [],
    });

    const report = await service.runRetentionSweep(new Date('2026-01-01T00:00:00.000Z'));

    expect(patientUpdate).not.toHaveBeenCalled();
    expect(report.every((r) => r.anonymized === 0)).toBe(true);
  });
});
