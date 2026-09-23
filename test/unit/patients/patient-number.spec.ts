import {
  PATIENT_NUMBER_COUNTER_KEY,
  formatPatientNumber,
  nextPatientSequence,
} from '../../../src/modules/patients/domain/patient-number';

const orgId = 'org-test-0001';

function mockTx(returnedValue: bigint) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ value: returnedValue }]),
  } as unknown as Parameters<typeof nextPatientSequence>[0];
}

describe('patient-number', () => {
  describe('formatPatientNumber', () => {
    it('pads to six digits and embeds the year', () => {
      expect(formatPatientNumber(1, 2026)).toBe('PAT-2026-000001');
      expect(formatPatientNumber(42, 2026)).toBe('PAT-2026-000042');
      expect(formatPatientNumber(123456, 2026)).toBe('PAT-2026-123456');
    });
  });

  describe('nextPatientSequence', () => {
    it('returns the raw counter value for the org', async () => {
      const db = mockTx(7n);
      await expect(nextPatientSequence(db, orgId)).resolves.toBe(7n);
      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('passes the org-scoped deterministic counter id and key', async () => {
      const db = mockTx(1n);
      await nextPatientSequence(db, orgId);
      const sql: TemplateStringsArray = (db.$queryRaw as jest.Mock).mock.calls[0][0];
      expect(sql.join('')).toContain('INSERT INTO "counters"');
      expect(sql.join('')).toContain('ON CONFLICT ("organizationId", "key")');
      expect((db.$queryRaw as jest.Mock).mock.calls[0][1]).toBe(
        `cnt-${orgId}-${PATIENT_NUMBER_COUNTER_KEY}`,
      );
      expect((db.$queryRaw as jest.Mock).mock.calls[0][2]).toBe(orgId);
      expect((db.$queryRaw as jest.Mock).mock.calls[0][3]).toBe(PATIENT_NUMBER_COUNTER_KEY);
    });

    it('falls back to 1 when raw returns no rows', async () => {
      const db = { $queryRaw: jest.fn().mockResolvedValue([]) } as unknown as Parameters<
        typeof nextPatientSequence
      >[0];
      await expect(nextPatientSequence(db, orgId)).resolves.toBe(1n);
    });
  });
});