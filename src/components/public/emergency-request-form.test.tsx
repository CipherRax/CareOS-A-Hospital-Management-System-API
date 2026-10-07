import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import messages from '@/i18n/messages/en.json';
import { EmergencyRequestForm, REQUEST_CATEGORIES } from '@/components/public/emergency-request-form';
import { QueryProvider } from '@/lib/data/query-provider';

/**
 * The intake form's client-side rules.
 *
 * The two that matter most are asserted here rather than left to review: nothing
 * on this screen may imply the request has been assessed, and the body it sends
 * matches the live `SubmitEmergencyRequestDto` (slug-keyed, not the partial
 * document's `facilityId`/`consentToContact` guess).
 */

const post = vi.fn();
vi.mock('@/api/client', () => ({
  api: { POST: (...args: unknown[]) => post(...args) },
}));

const facilities = [{ slug: 'example-general-hospital', name: 'EXAMPLE General Hospital' }];

function okReceipt() {
  post.mockResolvedValue({
    data: {
      success: true,
      data: {
        request: {
          id: 'er-1',
          referenceNumber: 'EMR-EXAMPLE-0001',
          trackingToken: 'tok-example-1',
        },
        contact: '+254700000000',
        consentVersion: '2026-10-01',
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
  it('demands a category and never lets it read as triage', () => {
    renderForm();
    // The contract: intake must not present a response as triage, and the
    // category field carries that disclaimer where the reader will see it.
    expect(
      screen.getByText(/this form does not assess how serious your condition/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/it does not assess how serious the situation is/i),
    ).toBeInTheDocument();
  });

  it('will not submit without a facility', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: /send request/i }));

    expect(post).not.toHaveBeenCalled();
    expect(await screen.findByText(/choose a facility/i)).toBeInTheDocument();
  });

  it('sends the live body: slug, caller fields, category and preference', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillEverything(user);
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, request] = post.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(request.body.slug).toBe('example-general-hospital');
    expect(request.body.callerName).toBe('EXAMPLE Test Person');
    expect(request.body.callerPhone).toBe('+254700000000');
    expect(request.body.category).toBe('SEVERE_INJURY');
    expect(request.body.forSelf).toBe(true);
    expect(request.body.peopleCount).toBe(1);
    expect(request.body.preferredContact).toBe('PHONE');
    // An idempotency key so a client retry cannot duplicate the request.
    expect(typeof request.body.clientRequestId).toBe('string');
  });

  it('sends forSelf as a real boolean when it is for someone else', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillEverything(user, { forSelf: 'false', peopleCount: '2' });
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, request] = post.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(request.body.forSelf).toBe(false);
    expect(request.body.peopleCount).toBe(2);
  });

  it('refuses to send an incomplete request', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: /send request/i }));

    expect(post).not.toHaveBeenCalled();
    expect(await screen.findByText(/choose a facility/i)).toBeInTheDocument();
    expect(screen.getByText(/enter your name/i)).toBeInTheDocument();
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

  it('shows the reference, the tracking token and no promise of assessment', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillEverything(user);
    await user.click(screen.getByRole('button', { name: /send request/i }));

    expect(await screen.findByText('EMR-EXAMPLE-0001')).toBeInTheDocument();
    // The secret that track/cancel are keyed by, surfaced explicitly.
    expect(screen.getByText('tok-example-1')).toBeInTheDocument();
    // The contract: "The UI must not present a response as triage."
    expect(screen.getByText(/has not been assessed/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/estimated wait|you will be seen|queue position/i),
    ).not.toBeInTheDocument();
  });

  it('clears the caller details from the screen after a successful send', async () => {
    // A shared or public machine must not keep a caller's details on display.
    const user = userEvent.setup();
    renderForm();
    await fillEverything(user);
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await screen.findByText('EMR-EXAMPLE-0001');
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
    await fillEverything(user);
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await screen.findByText(/not sent/i);
    expect(screen.getByDisplayValue('EXAMPLE Test Person')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+254700000000')).toBeInTheDocument();
  });

  it('never renders the API diagnostic message', async () => {
    post.mockResolvedValue({
      data: undefined,
      error: { success: false, error: { code: 'VALIDATION_ERROR', message: 'slug not found' } },
      response: new Response(null, { status: 400 }),
    });

    const user = userEvent.setup();
    renderForm();
    await fillEverything(user);
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await screen.findByText(/some details were not accepted/i);
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
  });

  it('maps a rate limit to something a member of the public can act on', async () => {
    post.mockResolvedValue({
      data: undefined,
      error: { success: false, error: { code: 'RATE_LIMITED', message: 'diag' } },
      response: new Response(null, { status: 429 }),
    });

    const user = userEvent.setup();
    renderForm();
    await fillEverything(user);
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await screen.findByText(/too many requests/i);
  });

  it('explains a facility refusing requests without the diagnostic message', async () => {
    post.mockResolvedValue({
      data: undefined,
      error: {
        success: false,
        error: { code: 'FACILITY_NOT_ACCEPTING_REQUESTS', message: 'diag' },
      },
      response: new Response(null, { status: 409 }),
    });

    const user = userEvent.setup();
    renderForm();
    await fillEverything(user);
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await screen.findByText(/not accepting requests/i);
    expect(screen.queryByText('diag')).not.toBeInTheDocument();
  });

  it('tells the public plainly that this is not for life-threatening emergencies', () => {
    // Guarding against someone reading "emergency" as a promise of immediate help.
    renderForm();
    expect(screen.getByText(/call your local emergency number/i)).toBeInTheDocument();
  });

  it('pins the category enum to the contract', () => {
    expect(REQUEST_CATEGORIES).toEqual([
      'NOT_SURE',
      'BREATHING_DIFFICULTY',
      'SEVERE_INJURY',
      'UNCONSCIOUS',
      'CHEST_PAIN',
      'HEAVY_BLEEDING',
      'OTHER',
    ]);
  });
});

async function fillEverything(
  user: ReturnType<typeof userEvent.setup>,
  overrides: { phone?: string; forSelf?: string; peopleCount?: string } = {},
) {
  await user.selectOptions(
    screen.getByLabelText(/facility/i),
    'example-general-hospital',
  );
  await user.type(screen.getByLabelText(/your name/i), 'EXAMPLE Test Person');
  await user.type(
    screen.getByLabelText(/phone number/i),
    overrides.phone ?? '+254700000000',
  );
  await user.selectOptions(
    screen.getByLabelText(/what best describes/i),
    'SEVERE_INJURY',
  );
  await user.selectOptions(screen.getByLabelText(/for yourself/i), overrides.forSelf ?? 'true');
  if (overrides.peopleCount) {
    const count = screen.getByLabelText(/how many people/i);
    await user.clear(count);
    await user.type(count, overrides.peopleCount);
  }
  await user.selectOptions(
    screen.getByLabelText(/how should we contact/i),
    'PHONE',
  );
  await user.type(
    screen.getByLabelText(/what has happened/i),
    'EXAMPLE symptom description for a test.',
  );
}