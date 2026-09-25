import type { AppError } from '../../../src/common/errors/app-error';
import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  BUILT_IN_TEMPLATES,
  ensureNeutralBody,
  renderTemplate,
} from '../../../src/modules/notifications/domain/notification-templates';

describe('notification templates', () => {
  it('renders allowlisted neutral variables', () => {
    const template = BUILT_IN_TEMPLATES['appointment.booked']!;
    const rendered = renderTemplate(template, { appointmentId: 'appointment-ref-1' });

    expect(rendered).toEqual({
      subject: 'A new appointment was booked',
      body: 'An appointment was booked. Reference: appointment-ref-1.',
    });
    expect(rendered.body).not.toContain('patientId');
  });

  it('rejects variables outside the allowlist', () => {
    const template = BUILT_IN_TEMPLATES['appointment.booked']!;
    try {
      renderTemplate(template, {
        appointmentId: 'appointment-ref-1',
        patientId: 'patient-ref-1',
      });
      throw new Error('expected render to fail');
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCodes.NOTIFICATION_TEMPLATE_FORBIDDEN);
    }
  });

  it('detects contact data in otherwise neutral content', () => {
    const tokens = ensureNeutralBody(
      'Account update',
      'Contact person@example.com or +254 712 345 678. National ID 123-45-6789.',
    );

    expect(tokens).toEqual(
      expect.arrayContaining(['person@example.com', '+254 712 345 678', '123-45-6789']),
    );
  });

  it('does not flag uuidv7 reference suffixes as contact data', () => {
    const tokens = ensureNeutralBody('A new appointment was booked', 'Reference: 01a0d849-253a-7000-b2c0-ec268312027d.');

    expect(tokens).toEqual([]);
  });

  it('still flags a real phone number beside an entity id', () => {
    const tokens = ensureNeutralBody('Account update', 'Ref 01a0d849-253a-7000-b2c0-ec268312027d. Call 0712 345 678.');

    expect(tokens).toEqual(['0712 345 678']);
  });
});
