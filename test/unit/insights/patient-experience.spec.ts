import {
  DEFAULT_EXPERIENCE_WEIGHTS,
  parseExperienceWeights,
} from '../../../src/modules/insights/patient-experience.service';
import { resolveWindow, round2 } from '../../../src/modules/insights/domain/window';

describe('parseExperienceWeights', () => {
  it('falls back to defaults when no setting is present', () => {
    expect(parseExperienceWeights(null)).toEqual(DEFAULT_EXPERIENCE_WEIGHTS);
    expect(parseExperienceWeights(undefined)).toEqual(DEFAULT_EXPERIENCE_WEIGHTS);
  });

  it('merges partial overrides', () => {
    const parsed = parseExperienceWeights({ patientExperience: { weights: { feedback: 0.5 } } });
    expect(parsed.feedback).toBe(0.5);
    expect(parsed.waitingTime).toBe(DEFAULT_EXPERIENCE_WEIGHTS.waitingTime);
  });

  it('uses explicit values when provided', () => {
    const parsed = parseExperienceWeights({
      patientExperience: {
        weights: {
          waitingTime: 0.2,
          feedback: 0.2,
          appointmentReliability: 0.3,
          serviceCompletion: 0.3,
        },
      },
    });
    expect(parsed).toEqual({
      waitingTime: 0.2,
      feedback: 0.2,
      appointmentReliability: 0.3,
      serviceCompletion: 0.3,
    });
  });
});

describe('resolveWindow / round2', () => {
  it('defaults to the last 30 days', () => {
    const to = new Date('2026-09-26T12:00:00.000Z');
    jest.useFakeTimers().setSystemTime(to);
    const { from } = resolveWindow();
    expect(from.toISOString()).toBe('2026-08-27T12:00:00.000Z');
    jest.useRealTimers();
  });

  it('honours explicit bounds and rounding', () => {
    const { from, to } = resolveWindow(new Date('2026-09-01T00:00:00.000Z'), new Date('2026-09-10T00:00:00.000Z'));
    expect(from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-09-10T00:00:00.000Z');
    expect(round2(1.006)).toBe(1.01);
    expect(round2(2)).toBe(2);
  });
});