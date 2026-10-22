import {
  DataExportService,
  MAX_EXPORT_ARTIFACT_BYTES,
} from '../../../src/modules/privacy/data-export.service';
import type { PrismaService } from '../../../src/database/prisma.service';
import type { TenantContext } from '../../../src/database/tenant-context';
import type { ObjectStorageService } from '../../../src/common/storage/object-storage.service';

interface ExportRow {
  id: string;
  organizationId: string;
  patientId: string | null;
  status: 'PENDING' | 'READY' | 'FAILED' | 'EXPIRED';
  storageKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  failureReason: string | null;
}

/**
 * Builds a patient payload big enough to blow the artifact cap. The collector
 * is stubbed so the test is about the cap, not about how much data a hospital
 * happens to hold.
 */
function makeMocks(opts: { patients?: unknown[]; row?: Partial<ExportRow> } = {}) {
  const patients = opts.patients ?? [
    {
      id: 'pat-1',
      patientNumber: 'P-1',
      firstName: 'A',
      lastName: 'B',
      otherNames: null,
      dateOfBirth: null,
      sex: null,
      phone: null,
      email: null,
      address: null,
      county: null,
      town: null,
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      allergies: [],
      medicalHistory: [],
      consents: [],
      appointments: [],
      encounters: [],
    },
  ];

  const row: ExportRow = {
    id: 'exp-1',
    organizationId: 'org-1',
    patientId: null,
    status: 'PENDING',
    storageKey: null,
    contentType: null,
    sizeBytes: null,
    failureReason: null,
    ...opts.row,
  };

  const update = jest.fn().mockResolvedValue({});
  const create = jest.fn().mockResolvedValue({});
  const patientFindMany = jest.fn().mockResolvedValue(patients);
  const dataExportFindFirst = jest.fn().mockResolvedValue(row);

  const tenant = {
    dataExport: { findFirst: dataExportFindFirst, update },
    patient: { findMany: patientFindMany },
  };
  const prisma = {
    tenantFor: jest.fn(() => tenant),
    unscoped: jest.fn(() => ({ outboxEvent: { create } })),
  };
  const tenantContext = {
    scope: { organizationId: 'org-1', userId: 'user-1' },
    requireOrg: jest.fn(() => 'org-1'),
  };
  const storage = {
    put: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };

  const service = new DataExportService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContext,
    storage as unknown as ObjectStorageService,
  );
  return { service, update, create, put: storage.put, row, tenant };
}

describe('DataExportService.build', () => {
  it('stores the artifact and marks the export ready', async () => {
    const { service, update, create, put } = makeMocks();

    await service.build('exp-1', 'org-1');

    expect(put).toHaveBeenCalledWith(
      'exports/org-1/exp-1.json',
      expect.any(Buffer),
      'application/json',
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'exp-1' },
      data: expect.objectContaining({
        status: 'READY',
        storageKey: 'exports/org-1/exp-1.json',
        contentType: 'application/json',
      }),
    });
    expect(create).toHaveBeenCalled();
  });

  it('refuses to store an artifact over the cap and marks the export failed', async () => {
    // One patient with a field big enough to push the artifact past the cap.
    const huge = 'x'.repeat(MAX_EXPORT_ARTIFACT_BYTES + 1024);
    const { service, update, put } = makeMocks({
      patients: [
        {
          id: 'pat-1',
          firstName: 'A',
          lastName: 'B',
          otherNames: null,
          dateOfBirth: null,
          sex: null,
          phone: null,
          email: null,
          address: huge,
          county: null,
          town: null,
          status: 'ACTIVE',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          allergies: [],
          medicalHistory: [],
          consents: [],
          appointments: [],
          encounters: [],
        },
      ],
    });

    await service.build('exp-1', 'org-1');

    // The oversized artifact is never written.
    expect(put).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'exp-1' },
      data: expect.objectContaining({
        status: 'FAILED',
        failureReason: expect.stringContaining('over the'),
      }),
    });
  });

  it('leaves an export that is no longer pending alone', async () => {
    const { service, update, put } = makeMocks({ row: { status: 'READY' } });

    await service.build('exp-1', 'org-1');

    expect(put).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
