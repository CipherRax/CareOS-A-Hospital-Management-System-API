import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * In-process webhook receiver for e2e (patch P6).
 *
 * The off-system notification adapter POSTs to `NOTIFICATION_WEBHOOK_URL`. e2e
 * points that at this recorder — started once in the jest globalSetup process
 * (which stays alive for the whole run, exactly like the s3rver S3 stub) and
 * reached over localhost by the test workers.
 *
 * State lives in a JSON file because globalSetup and the workers are separate
 * processes, and the response mode is a file rather than a URL path because the
 * endpoint is fixed at boot: a test switches it to `reject`/`unavailable` to
 * drive the real failure paths through the real adapter.
 */
export type WebhookMode = 'ok' | 'reject' | 'unavailable';

export interface RecordedDelivery {
  channel: string;
  to: string;
  subject: string;
  body: string;
  idempotencyKey: string;
  /** Raw `x-careos-signature` header, so a test can verify the HMAC itself. */
  signature: string | null;
  /** The exact body received, which is what the signature covers. */
  raw: string;
  receivedAt: string;
}

interface WebhookState {
  mode: WebhookMode;
  deliveries: RecordedDelivery[];
}

const STATE_FILE = join(__dirname, '..', '.e2e.webhook.json');

function readState(): WebhookState {
  if (!existsSync(STATE_FILE)) return { mode: 'ok', deliveries: [] };
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as WebhookState;
}

function writeState(state: WebhookState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Switches the recorder's next response: accept, reject (422), or outage (503). */
export function setWebhookMode(mode: WebhookMode): void {
  writeState({ ...readState(), mode });
}

/** Every payload the adapter delivered since the last clear, oldest first. */
export function recordedDeliveries(): RecordedDelivery[] {
  return readState().deliveries;
}

export function clearRecordedDeliveries(): void {
  writeState({ ...readState(), deliveries: [] });
}

export interface WebhookRecorder {
  url: string;
  close(): Promise<void>;
}

export async function startWebhookRecorder(): Promise<WebhookRecorder> {
  clearRecordedDeliveries();
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const state = readState();
      if (state.mode === 'reject') {
        res.writeHead(422, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'rejected by test' }));
        return;
      }
      if (state.mode === 'unavailable') {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unavailable' }));
        return;
      }

      const raw = Buffer.concat(chunks).toString('utf8');
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        payload = {};
      }
      const ref = `e2e-ref-${state.deliveries.length + 1}`;
      state.deliveries.push({
        channel: String(payload.channel ?? ''),
        to: String(payload.to ?? ''),
        subject: String(payload.subject ?? ''),
        body: String(payload.body ?? ''),
        idempotencyKey: String(payload.idempotencyKey ?? ''),
        signature: req.headers['x-careos-signature']?.toString() ?? null,
        raw,
        receivedAt: new Date().toISOString(),
      });
      writeState(state);
      res.writeHead(200, {
        'content-type': 'application/json',
        'x-careos-delivery-ref': ref,
      });
      res.end(JSON.stringify({ ref }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/notifications`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
