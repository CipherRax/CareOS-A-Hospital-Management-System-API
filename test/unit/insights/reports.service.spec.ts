import { ReportsService } from '../../../src/modules/insights/reports.service';

const ORG = '01a0f091-ad65-7000-816e-c52688b71240';
const EXPORT = '01a0f091-ad70-7000-816e-c52688b71241';

function pendingRow(over: Record<string, unknown> = {}) {
  return {
    id: EXPORT,
    organizationId: ORG,
    reportType: 'PATIENT' as const,
    format: 'PDF' as const,
    status: 'PENDING' as const,
    from: new Date('2026-09-01T00:00:00.000Z'),
    to: new Date('2026-09-30T00:00:00.000Z'),
    branchId: 'branch-1',
    createdAt: new Date('2026-09-30T12:00:00.000Z'),
    ...over,
  };
}

/** The single stored artifact, asserting exactly one upload happened. */
function onlyArtifact(stored: Array<{ key: string; body: Buffer; contentType?: string }>) {
  expect(stored).toHaveLength(1);
  const [only] = stored;
  if (!only) throw new Error('no artifact stored');
  return only;
}

/** Gives the report builders some patients to summarise. */
function withPatients(tenant: Record<string, unknown>, count: number): void {
  (tenant.patient as { findMany: jest.Mock }).findMany.mockResolvedValue(
    Array.from({ length: count }, (_, i) => ({
      patientNumber: `P-${i}`,
      firstName: `First${i}`,
      lastName: `Last${i}`,
      sex: 'F',
      county: 'Nairobi',
      createdAt: new Date('2026-09-15T00:00:00.000Z'),
    })),
  );
}

/** The row's contentType is fixed at request time, so derive it from format. */
function rowFor(format: 'JSON' | 'CSV' | 'PDF', over: Record<string, unknown> = {}) {
  const contentType = { PDF: 'application/pdf', CSV: 'text/csv', JSON: 'application/json' }[format];
  return pendingRow({ format, contentType, ...over });
}

function makeService(over: { row?: unknown } = {}) {
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const reportExport = {
    findFirst: jest.fn().mockResolvedValue(over.row === undefined ? pendingRow() : over.row),
    updateMany,
  };
  // The report builders read whatever tables their report type touches. These
  // tests are about the export lifecycle, not about each builder's queries, so
  // any table resolves empty rather than enumerating them here.
  const emptyTable = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    groupBy: jest.fn().mockResolvedValue([]),
    aggregate: jest.fn().mockResolvedValue({ _count: 0, _sum: { total: 0 } }),
  };
  const tenant: Record<string, unknown> = { reportExport };
  for (const table of [
    'patient',
    'appointment',
    'encounter',
    'observation',
    'labOrder',
    'prescription',
    'invoice',
    'payment',
    'claim',
    'admission',
    'bed',
    'department',
  ]) {
    tenant[table] = emptyTable;
  }
  const stored: Array<{ key: string; body: Buffer; contentType?: string }> = [];
  const storage = {
    // A real consumer of the stream, so backpressure and the end-of-stream
    // handshake are exercised rather than short-circuited by a mock that
    // resolves without reading.
    putStream: jest.fn(async (key: string, body: NodeJS.ReadableStream, contentType?: string) => {
      const parts: Buffer[] = [];
      for await (const chunk of body) parts.push(Buffer.from(chunk as Buffer));
      const buf = Buffer.concat(parts);
      stored.push({ key, body: buf, contentType });
      return buf.length;
    }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    tenantFor: jest.fn(() => tenant),
    unscoped: jest.fn(() => ({ reportExport })),
  };
  const service = new ReportsService(
    prisma as never,
    { requireOrg: () => ORG, requireUserId: () => 'user-1' } as never,
    storage as never,
    { run: jest.fn() } as never,
  );
  return { service, storage, stored, reportExport, updateMany, tenant };
}

describe('ReportsService.generate', () => {
  it('stores the artifact under a tenant-scoped key', async () => {
    const { service, stored } = makeService();
    // A flat key would let one organization's report be fetched by another if a
    // key were ever mixed up in a log or a bug.
    await service.generate(EXPORT, ORG);
    expect(stored).toHaveLength(1);
    expect(onlyArtifact(stored).key).toBe(`reports/${ORG}/${EXPORT}.pdf`);
    expect(onlyArtifact(stored).contentType).toBe('application/pdf');
  });

  it('streams a real PDF to storage', async () => {
    const { service, stored } = makeService();
    await service.generate(EXPORT, ORG);
    // Proof the sink received finished PDF bytes, not an empty or truncated body.
    const artifact = onlyArtifact(stored);
    expect(artifact.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(artifact.body.subarray(-6).toString('latin1')).toContain('%%EOF');
  });

  it('records the streamed byte count as sizeBytes', async () => {
    const { service, stored, updateMany } = makeService();
    await service.generate(EXPORT, ORG);
    // The count comes from what the upload actually took, not an estimate.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sizeBytes: onlyArtifact(stored).body.length }),
      }),
    );
  });

  it('records size, summary and completion, keyed on still-PENDING', async () => {
    const { service, updateMany } = makeService();
    await service.generate(EXPORT, ORG);
    // The status guard is what makes a duplicate delivery harmless.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EXPORT, status: 'PENDING' },
        data: expect.objectContaining({
          status: 'READY',
          sizeBytes: expect.any(Number),
          completedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('does not re-render an export that is already ready', async () => {
    // The outbox is at-least-once. Re-rendering would overwrite a good artifact
    // and reset completedAt for no reason.
    const { service, stored } = makeService({ row: pendingRow({ status: 'READY' }) });
    await service.generate(EXPORT, ORG);
    expect(stored).toHaveLength(0);
  });

  it('does not re-render a failed export either', async () => {
    const { service, stored } = makeService({ row: pendingRow({ status: 'FAILED' }) });
    await service.generate(EXPORT, ORG);
    expect(stored).toHaveLength(0);
  });

  it('throws when the export does not exist', async () => {
    const { service, stored } = makeService({ row: null });
    await expect(service.generate(EXPORT, ORG)).rejects.toThrow();
    expect(stored).toHaveLength(0);
  });

  it('uses the window recorded on the row, not a freshly resolved one', async () => {
    // resolveWindow fills defaults relative to now, so a consumer recomputing it
    // minutes later would produce a different report than the one requested.
    const { service } = makeService();
    const build = jest.spyOn(service as never as { build: () => unknown }, 'build');
    await service.generate(EXPORT, ORG);
    expect(build).toHaveBeenCalledWith(
      'PATIENT',
      expect.objectContaining({
        from: new Date('2026-09-01T00:00:00.000Z'),
        to: new Date('2026-09-30T00:00:00.000Z'),
        branchId: 'branch-1',
      }),
      // The same client that read the row, so the builders never reach for
      // ambient tenant state a background consumer does not have.
      expect.objectContaining({ reportExport: expect.anything() }),
    );
  });
});

describe('ReportsService.generate — row formats', () => {
  it('streams CSV with a header and one line per row', async () => {
    const { service, stored, tenant } = makeService({ row: rowFor('CSV') });
    withPatients(tenant, 3);
    await service.generate(EXPORT, ORG);
    const artifact = onlyArtifact(stored);
    expect(artifact.contentType).toBe('text/csv');
    expect(artifact.key.endsWith('.csv')).toBe(true);
    const lines = artifact.body.toString('utf8').split('\n').filter(Boolean);
    expect(lines[0]).toContain('patientNumber');
    // One header plus one line per patient.
    expect(lines).toHaveLength(4);
  });

  it('streams an empty CSV as an empty body when there are no rows', async () => {
    const { service, stored } = makeService({ row: rowFor('CSV') });
    await service.generate(EXPORT, ORG);
    // A zero-row report has no columns, so there is no header to invent.
    expect(onlyArtifact(stored).body.length).toBe(0);
  });

  it('streams JSON that parses to the same document the buffered form made', async () => {
    const { service, stored } = makeService({ row: rowFor('JSON') });
    await service.generate(EXPORT, ORG);
    expect(onlyArtifact(stored).contentType).toBe('application/json');
    const parsed = JSON.parse(onlyArtifact(stored).body.toString('utf8'));
    expect(Array.isArray(parsed.rows)).toBe(true);
    expect(parsed.summary).toBeDefined();
  });
});

describe('ReportsService.failGeneration', () => {
  it('flips a pending export to FAILED with a reason', async () => {
    const { service, updateMany } = makeService();
    await service.failGeneration(EXPORT, ORG, 'font cannot render U+4E2D (a table cell)');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: EXPORT, organizationId: ORG, status: 'PENDING' },
      data: {
        status: 'FAILED',
        error: 'font cannot render U+4E2D (a table cell)',
        completedAt: expect.any(Date),
      },
    });
  });
});

describe('ReportsService.expireArtifact', () => {
  it('removes the object and clears the pointer', async () => {
    const { service, storage, updateMany } = makeService();
    await service.expireArtifact(EXPORT, `reports/${ORG}/${EXPORT}.pdf`);
    expect(storage.remove).toHaveBeenCalledWith(`reports/${ORG}/${EXPORT}.pdf`);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: EXPORT, status: 'EXPIRED' },
      data: { artifactKey: null },
    });
  });

  it('clears the pointer even when the delete fails', async () => {
    // Refusing to mark the row expired because S3 was briefly unavailable would
    // leave a downloadable row, and the lifecycle policy is the backstop for
    // the orphaned object.
    const { service, storage, updateMany } = makeService();
    storage.remove.mockRejectedValueOnce(new Error('S3 unavailable'));
    await expect(service.expireArtifact(EXPORT, 'k')).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalled();
  });

  it('skips the delete when there is no key, and still scopes the write', async () => {
    // A PENDING or FAILED row holds no object, and the write is guarded on
    // status so it cannot clobber a row something else revived.
    const { service, storage, updateMany } = makeService();
    await service.expireArtifact(EXPORT, null);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: EXPORT, status: 'EXPIRED' },
      data: { artifactKey: null },
    });
  });
});
