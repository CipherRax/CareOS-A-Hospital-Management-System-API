import {
  formatInpatientNumber,
  INPATIENT_COUNTER_KEYS,
} from '../../../src/modules/inpatient/domain/inpatient-number';
import {
  formatEmergencyNumber,
  EMERGENCY_COUNTER_KEYS,
} from '../../../src/modules/emergency/domain/emergency-number';

describe('inpatient-number', () => {
  it('formats the ADM series with a zero-padded sequence', () => {
    expect(formatInpatientNumber('admission', 1)).toMatch(/^ADM-\d{4}-000001$/);
    expect(formatInpatientNumber('admission', 123456, 2027)).toBe('ADM-2027-123456');
  });

  it('never resets the sequence across a year rollover', () => {
    expect(formatInpatientNumber('admission', 2, 2026)).toBe('ADM-2026-000002');
    expect(formatInpatientNumber('admission', 3, 2027)).toBe('ADM-2027-000003');
  });

  it('exposes a stable counter key', () => {
    expect(INPATIENT_COUNTER_KEYS.admission).toBe('admission_number');
  });
});

describe('emergency-number', () => {
  it('formats the ER series with a zero-padded sequence', () => {
    expect(formatEmergencyNumber('visit', 1)).toMatch(/^ER-\d{4}-000001$/);
    expect(formatEmergencyNumber('visit', 42, 2027)).toBe('ER-2027-000042');
  });

  it('never resets the sequence across a year rollover', () => {
    expect(formatEmergencyNumber('visit', 7, 2026)).toBe('ER-2026-000007');
    expect(formatEmergencyNumber('visit', 8, 2027)).toBe('ER-2027-000008');
  });

  it('exposes a stable counter key', () => {
    expect(EMERGENCY_COUNTER_KEYS.visit).toBe('emergency_visit_number');
  });
});