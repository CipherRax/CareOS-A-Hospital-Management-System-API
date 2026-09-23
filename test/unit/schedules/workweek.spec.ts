import { dayOfWeekForDate, businessDayKey, startOfBusinessDay } from '../../../src/modules/schedules/domain/workweek';

describe('workweek', () => {
  describe('dayOfWeekForDate', () => {
    it('maps Monday=0 ... Sunday=6 (UTC)', () => {
      expect(dayOfWeekForDate(new Date('2026-09-21T12:00:00Z'))).toBe(0); // Mon
      expect(dayOfWeekForDate(new Date('2026-09-22T12:00:00Z'))).toBe(1); // Tue
      expect(dayOfWeekForDate(new Date('2026-09-23T12:00:00Z'))).toBe(2); // Wed
      expect(dayOfWeekForDate(new Date('2026-09-24T12:00:00Z'))).toBe(3); // Thu
      expect(dayOfWeekForDate(new Date('2026-09-25T12:00:00Z'))).toBe(4); // Fri
      expect(dayOfWeekForDate(new Date('2026-09-26T12:00:00Z'))).toBe(5); // Sat
      expect(dayOfWeekForDate(new Date('2026-09-27T12:00:00Z'))).toBe(6); // Sun
    });
  });

  describe('startOfBusinessDay', () => {
    it('truncates an instant to UTC midnight of its day', () => {
      const d = startOfBusinessDay(new Date('2026-09-23T19:45:30Z'));
      expect(d.toISOString()).toBe('2026-09-23T00:00:00.000Z');
    });
  });

  describe('businessDayKey', () => {
    it('formats YYYY-MM-DD with zero padding', () => {
      expect(businessDayKey(new Date('2026-09-23T00:05:00Z'))).toBe('2026-09-23');
      expect(businessDayKey(new Date('2026-01-05T23:59:00Z'))).toBe('2026-01-05');
    });
  });
});