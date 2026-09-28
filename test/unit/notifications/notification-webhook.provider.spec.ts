import { createHmac } from 'node:crypto';
import {
  NotificationDeliveryError,
  OFFSITE_NOTIFICATION_CHANNELS,
  StubNotificationProvider,
  WebhookNotificationProvider,
  defaultProviders,
  parseOffsiteChannels,
  type NotificationSendRequest,
} from '../../../src/integrations/notifications/notifications.provider';
import { testEnv } from '../../support/test-env';

const REQUEST: NotificationSendRequest = {
  to: 'user-1@example.org',
  subject: 'A task was assigned',
  body: 'A task status changed. Reference: task-1.',
  variables: { taskId: 'task-1' },
  idempotencyKey: 'notif-1',
};

/** Minimal Response stand-in: only what the adapter touches. */
function response(init: {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => init.headers?.[name.toLowerCase()] ?? null },
    text: async () => init.body ?? '',
  } as unknown as Response;
}

function makeProvider(overrides: { url?: string; secret?: string; timeoutMs?: number } = {}) {
  return new WebhookNotificationProvider('EMAIL', {
    url: overrides.url ?? 'https://relay.example.org/hook',
    secret: overrides.secret ?? 'shhh',
    timeoutMs: overrides.timeoutMs ?? 5_000,
  });
}

describe('notification provider seam (patch P6)', () => {
  describe('parseOffsiteChannels', () => {
    it('normalises a configured list and drops anything unrecognised', () => {
      expect(parseOffsiteChannels('email, SMS , PUSH, carrier-pigeon')).toEqual([
        'EMAIL',
        'SMS',
        'PUSH',
      ]);
    });

    it('is empty for an unset list, so the default deployment is in-app only', () => {
      expect(parseOffsiteChannels('')).toEqual([]);
    });
  });

  describe('defaultProviders', () => {
    it('wires the real webhook adapter for off-system channels when a URL is configured', () => {
      const providers = defaultProviders(
        testEnv({ NOTIFICATION_WEBHOOK_URL: 'https://relay.example.org/hook' }),
      );

      for (const channel of OFFSITE_NOTIFICATION_CHANNELS) {
        const provider = providers.get(channel);
        expect(provider).toBeInstanceOf(WebhookNotificationProvider);
        expect(provider?.enabled).toBe(true);
      }
    });

    it('falls back to the structural stub when no endpoint is configured', () => {
      const providers = defaultProviders(testEnv());

      for (const channel of OFFSITE_NOTIFICATION_CHANNELS) {
        const provider = providers.get(channel);
        expect(provider).toBeInstanceOf(StubNotificationProvider);
        expect(provider?.enabled).toBe(false);
      }
      // IN_APP is always present: the row itself is the in-app delivery.
      expect(providers.get('IN_APP')?.enabled).toBe(false);
    });
  });

  describe('WebhookNotificationProvider', () => {
    it('POSTs the rendered notification with an HMAC signature over the raw body', async () => {
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(response({ headers: { 'x-careos-delivery-ref': 'mail-42' } }));

      const result = await makeProvider().send(REQUEST);

      expect(result).toEqual({ delivered: true, ref: 'mail-42' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://relay.example.org/hook');
      expect(init.method).toBe('POST');
      const body = String(init.body);
      expect(JSON.parse(body)).toEqual({
        channel: 'EMAIL',
        to: 'user-1@example.org',
        subject: 'A task was assigned',
        body: 'A task status changed. Reference: task-1.',
        variables: { taskId: 'task-1' },
        idempotencyKey: 'notif-1',
        sentAt: expect.any(String),
      });
      const headers = init.headers as Record<string, string>;
      expect(headers['x-careos-idempotency-key']).toBe('notif-1');
      expect(headers['x-careos-channel']).toBe('EMAIL');
      expect(headers['x-careos-signature']).toBe(
        `sha256=${createHmac('sha256', 'shhh').update(body).digest('hex')}`,
      );
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('omits the signature when no secret is configured', async () => {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({}));

      await makeProvider({ secret: '' }).send(REQUEST);

      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      expect((init.headers as Record<string, string>)['x-careos-signature']).toBeUndefined();
    });

    it('reads a receiver-side ref from a small JSON body', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(response({ body: JSON.stringify({ messageId: 'sms-7' }) }));

      await expect(makeProvider().send(REQUEST)).resolves.toEqual({
        delivered: true,
        ref: 'sms-7',
      });
    });

    it('treats a 5xx as a retryable provider outage', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({ status: 503 }));

      await expect(makeProvider().send(REQUEST)).rejects.toMatchObject({
        reason: 'PROVIDER_UNAVAILABLE',
      });
    });

    it('treats a 4xx as permanent — the receiver rejected the payload', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({ status: 422 }));

      await expect(makeProvider().send(REQUEST)).rejects.toMatchObject({
        reason: 'PROVIDER_REJECTED',
      });
    });

    it('raises a transport failure (timeout, DNS, refused) as retryable', async () => {
      jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch failed'));

      await expect(makeProvider().send(REQUEST)).rejects.toBeInstanceOf(NotificationDeliveryError);
      await expect(makeProvider().send(REQUEST)).rejects.toMatchObject({
        reason: 'PROVIDER_UNAVAILABLE',
      });
    });

    it('applies the configured timeout so one slow endpoint cannot stall a pass', async () => {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({}));

      await makeProvider({ timeoutMs: 1_234 }).send(REQUEST);

      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      const signal = init.signal as AbortSignal;
      expect(signal).toBeInstanceOf(AbortSignal);
    });

    it('logs the accepted ref but never the payload or the address', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(response({ headers: { 'x-careos-delivery-ref': 'mail-42' } }));
      // Nest's ConsoleLogger writes straight to stdout, so that is what has to
      // be captured to prove the adapter logs no recipient data.
      const writes: string[] = [];
      const stdout = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: unknown) => {
          writes.push(String(chunk));
          return true;
        });

      await makeProvider().send(REQUEST);
      stdout.mockRestore();

      const printed = writes.join('');
      expect(printed).toContain('ref=mail-42');
      expect(printed).not.toContain('user-1@example.org');
      expect(printed).not.toContain('task-1');
      expect(printed).not.toContain('A task was assigned');
    });
  });

  describe('StubNotificationProvider', () => {
    it('reports delivery without contacting anything', async () => {
      const provider = new StubNotificationProvider('SMS');

      expect(provider.enabled).toBe(false);
      await expect(provider.send(REQUEST)).resolves.toEqual({ delivered: true });
    });
  });
});
