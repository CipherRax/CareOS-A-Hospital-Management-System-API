import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Field, Input } from '@/components/ui/field';
import { CheckboxField } from '@/components/ui/primitives';

/**
 * The accessibility contract of a form field: a label that is programmatically
 * associated, hints and errors announced with the control, and validation that
 * never depends on colour alone.
 */
describe('Field', () => {
  it('associates the label with the control', () => {
    render(
      <Field id="patient-name" label="Patient name">
        {({ controlId }) => <Input id={controlId} />}
      </Field>,
    );
    expect(screen.getByLabelText('Patient name')).toBeInTheDocument();
  });

  it('links the hint to the control via aria-describedby', () => {
    render(
      <Field id="mrn" label="Medical record number" hint="As printed on the patient card.">
        {({ controlId, describedBy }) => <Input id={controlId} aria-describedby={describedBy} />}
      </Field>,
    );
    const input = screen.getByLabelText('Medical record number');
    expect(input).toHaveAccessibleDescription('As printed on the patient card.');
  });

  it('sets aria-invalid and links the error when validation fails', () => {
    render(
      <Field id="mrn" label="Medical record number" error="Enter a medical record number.">
        {({ controlId, describedBy, invalid }) => (
          <Input id={controlId} aria-describedby={describedBy} invalid={invalid} />
        )}
      </Field>,
    );
    const input = screen.getByLabelText('Medical record number');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a medical record number.');
  });

  it('combines hint and error descriptions when both are present', () => {
    render(
      <Field id="mrn" label="MRN" hint="From the patient card." error="Required.">
        {({ controlId, describedBy, invalid }) => (
          <Input id={controlId} aria-describedby={describedBy} invalid={invalid} />
        )}
      </Field>,
    );
    const input = screen.getByLabelText(/MRN/);
    const described = input.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(described).toHaveLength(2);
  });

  it('announces a required field in text, not only with an asterisk', async () => {
    const user = userEvent.setup();
    render(
      <Field id="reason" label="Reason" required>
        {({ controlId }) => <Input id={controlId} />}
      </Field>,
    );
    // The asterisk is aria-hidden; the "(required)" text is what is announced.
    expect(await screen.findByText('(required)')).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Reason/));
  });
});

describe('Field invalid state', () => {
  it('renders the error with an icon so it is not colour-only', () => {
    const { container } = render(
      <Field id="dose" label="Dose" error="Enter a dose.">
        {({ controlId, describedBy, invalid }) => (
          <Input id={controlId} aria-describedby={describedBy} invalid={invalid} />
        )}
      </Field>,
    );
    const error = screen.getByText('Enter a dose.');
    // The icon lives inside the error paragraph and is hidden from the tree, so
    // the message is announced once and read as text.
    expect(error).toBeInTheDocument();
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('leaves aria-invalid unset when there is no error', () => {
    render(
      <Field id="dose" label="Dose">
        {({ controlId, invalid }) => <Input id={controlId} invalid={invalid} />}
      </Field>,
    );
    expect(screen.getByLabelText('Dose')).not.toHaveAttribute('aria-invalid');
  });
});

describe('Input', () => {
  it('forwards the native disabled attribute', () => {
    render(<Input aria-label="Notes" disabled />);
    expect(screen.getByLabelText('Notes')).toBeDisabled();
  });

  it('does not register a click handler when the onClick spy is never given', () => {
    const spy = vi.fn();
    render(<Input aria-label="Notes" onChange={spy} />);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('CheckboxField', () => {
  // Regression guard. The label association was `htmlFor={props.id}`, so a caller
  // that omitted `id` produced a checkbox with no accessible name at all — a
  // critical axe `button-name` failure that no jsdom assertion had caught.
  it('gives the checkbox an accessible name without requiring an id from the caller', () => {
    render(<CheckboxField label="Send the patient a notification" />);
    expect(screen.getByRole('checkbox', { name: 'Send the patient a notification' })).toBeVisible();
  });

  it('wires the description to the control', () => {
    render(<CheckboxField label="Notify" description="Uses the contact preference." />);
    const checkbox = screen.getByRole('checkbox', { name: 'Notify' });
    expect(checkbox).toHaveAccessibleDescription('Uses the contact preference.');
  });

  it('honours a caller-supplied id', () => {
    render(<CheckboxField id="notify" label="Notify" />);
    expect(screen.getByRole('checkbox', { name: 'Notify' })).toHaveAttribute('id', 'notify');
  });
});
