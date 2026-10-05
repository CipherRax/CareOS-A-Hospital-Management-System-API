import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import messages from '@/i18n/messages/en.json';
import { EmergencyRequestForm } from '@/components/public/emergency-request-form';
import { QueryProvider } from '@/lib/data/query-provider';

/**
 * The intake form's client-side rules.
 *
 * The two that matter most are asserted here rather than left to review: nothing on
 * this screen may imply the request has been assessed, and consent may not start
 * ticked. Both are in the contract rather than in taste, and both are easy to break
 * in a later edit without any test noticing.
 */

const post = vi.fn();
vi.mock('@/api/client', () => ({
  api: { POST: (...args: unknown[]) => post(...args) },
}));

const facilities = [{ id: 'fac-example-1', name: 'EXAMPLE General Hospital' }];

function okReceipt() {
  post.mockResolvedValue({
    data: {
      success: true,
      data: {
        id: 'er-1',
        reference: 'EX-EM-00001',
        status: 'RECEIVED',
        createdAt: '2026-10-05T08:00:00Z',
      },
    },
    response: new Response(null, { status: 201 }),
  });
}

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {/* The real provider, not a bare client: the retry policy is part of what is
          under test, since a retried submission can create a duplicate request. */}
      <QueryProvider>
        <EmergencyRequestForm facilities={facilities} />
      </QueryProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  post.mockReset();
  okReceipt();
});

describe('EmergencyRequestForm', () => {
  it('never starts with consent ticked', () => {
    renderForm();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('will not submit without consent', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillEverything(user, { consent: false });
    await user.click(screen.getByRole('button', { name: /send request/i }));

    expect(post).not.toHaveBeenCalled();
    expect(await screen.findByText(/before sending/i)).toBeInTheDocument();
  });

  it('sends consentToContact as literal true, not merely as truthy', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillEverything(user, {});
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    // The schema is `{ const: true }`. Sending the checked state directly would send
    // a string or boolean-valued object depending on the checkbox library.
    const [, request] = post.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(request.body.consentToContact).toBe(true);
  });

  it('refuses to send an incomplete request', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: /send request/i }));

    expect(post).not.toHaveBeenCalled();
    expect(await screen.findByText(/choose a facility/i)).toBeInTheDocument();
    expect(screen.getByText(/enter the patient's name/i)).toBeInTheDocument();
    expect(screen.getByText(/enter a phone number/i)).toBeInTheDocument();
  });

  it('rejects a phone number with no digits without being fussy about format', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillEverything(user, { phone: 'abc' });
    await user.click(screen.getByRole('button', { name: /send request/i }));

    expect(post).not.toHaveBeenCalled();
    expect(await screen.findByText(/including the area code/i)).toBeInTheDocument();
  });

  it('accepts an awkwardly formatted but valid number', async () => {
    // A strict format gate rejects numbers that work. This one is in the field
    // because the public will type it on a phone.
    const user = userEvent.setup();
    renderForm();
    await fillEverything(user, { phone: '+254 (0)20 555 0134' });
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
  });

  it('shows the reference and no promise of assessment', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillEverything(user, {});
    await user.click(screen.getByRole('button', { name: /send request/i }));

    expect(await screen.findByText('EX-EM-00001')).toBeInTheDocument();
    // The contract: "The UI must not present a response as triage."
    expect(screen.getByText(/has not been assessed/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/estimated wait|you will be seen|queue position/i),
    ).not.toBeInTheDocument();
  });

  it('clears the details from the screen after a successful send', async () => {
    // A shared or public machine must not keep a patient's details on display.
    const user = userEvent.setup();
    renderForm();
    await fillEverything(user, {});
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await screen.findByText('EX-EM-00001');
    expect(screen.queryByDisplayValue('EXAMPLE Test Person')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('+254700000000')).not.toBeInTheDocument();
  });

  it('keeps what was typed when the submission is rejected', async () => {
    // Losing a description someone took two minutes to write, because the service
    // was briefly unavailable, is the kind of failure that makes people give up.
    post.mockResolvedValue({
      data: undefined,
      error: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'diag' } },
      response: new Response(null, { status: 503 }),
    });

    const user = userEvent.setup();
    renderForm();
    await fillEverything(user, {});
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await screen.findByText(/not sent/i);
    expect(screen.getByDisplayValue('EXAMPLE Test Person')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+254700000000')).toBeInTheDocument();
  });

  it('never renders the API diagnostic message', async () => {
    post.mockResolvedValue({
      data: undefined,
      error: {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'facilityId is not a UUID' },
      },
      response: new Response(null, { status: 400 }),
    });

    const user = userEvent.setup();
    renderForm();
    await fillEverything(user, {});
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await screen.findByText(/some details were not accepted/i);
    expect(screen.queryByText(/not a UUID/i)).not.toBeInTheDocument();
  });

  it('maps a rate limit to something a member of the public can act on', async () => {
    post.mockResolvedValue({
      data: undefined,
      error: { success: false, error: { code: 'RATE_LIMITED', message: 'diag' } },
      response: new Response(null, { status: 429 }),
    });

    const user = userEvent.setup();
    renderForm();
    await fillEverything(user, {});
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await screen.findByText(/too many requests/i);
  });

  it('tells the public plainly that this is not for life-threatening emergencies', () => {
    // Guarding against someone reading "emergency" as a promise of immediate help.
    renderForm();
    expect(screen.getByText(/call your local emergency number/i)).toBeInTheDocument();
  });
});

async function fillEverything(
  user: ReturnType<typeof userEvent.setup>,
  overrides: { phone?: string; consent?: boolean },
) {
  await user.selectOptions(screen.getByLabelText(/facility/i), 'fac-example-1');
  await user.type(screen.getByLabelText(/patient name/i), 'EXAMPLE Test Person');
  await user.type(screen.getByLabelText(/phone number/i), overrides.phone ?? '+254700000000');
  await user.type(
    screen.getByLabelText(/what has happened/i),
    'EXAMPLE symptom description for a test.',
  );
  if (overrides.consent !== false) await user.click(screen.getByRole('checkbox'));
}
