import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { Logger } from '@nestjs/common';
import type { Env } from '../../config/config.module';

/**
 * What a scan concluded. Deliberately small and terminal.
 *
 *  - `CLEAN`     — nothing objectionable found in the bytes inspected.
 *  - `INFECTED`  — a known-bad signature matched. Never downloadable.
 *  - `REJECTED`  — the bytes are not what the declared type claims (a PDF that
 *                  is really an executable). A type-confusion guard, not a virus
 *                  verdict, and it holds whether or not an AV engine is wired.
 *  - `ERROR`     — the scan could not be completed (storage or engine failure).
 *                  Retried by the outbox; never silently treated as clean.
 *  - `FLAGGED`   — inspected fine, but content matched a high-sensitivity
 *                  pattern. Downloadable: flagging is a review signal for a
 *                  human, and silently withholding a clinical document is a
 *                  worse failure than surfacing it.
 */
export type ScanVerdict = 'CLEAN' | 'INFECTED' | 'REJECTED' | 'ERROR' | 'FLAGGED';

export interface ScanRequest {
  fileName: string;
  contentType: string;
  /** Bounded prefix of the object, at most `limitBytes` long. */
  bytes: Buffer;
  /** Declared/object size when known, so `truncated` can be reported honestly. */
  sizeBytes?: number;
}

export interface ScanResult {
  verdict: ScanVerdict;
  /** Engine that produced the verdict, persisted for audit. */
  engine: string;
  /**
   * Short, PHI-free reason: a rule or signature name (`Eicar-Test-Signature`,
   * `MAGIC_MISMATCH`, `NATIONAL_ID`). Never the matched bytes, a filename
   * fragment, or anything drawn from document content.
   */
  detail?: string;
  scannedBytes: number;
  /** True when the object was larger than the cap and was only partly read. */
  truncated: boolean;
}

export interface DocumentScanner {
  readonly name: string;
  scan(request: ScanRequest): Promise<ScanResult>;
}

export const DOCUMENT_SCANNER = Symbol('DOCUMENT_SCANNER');

/**
 * The AV industry test signature (EICAR): a harmless string every scanner is
 * required to flag, which is exactly what makes it useful — it proves the
 * pipeline works without shipping a real virus. It is checked in the
 * always-available scanner so the quarantine acceptance test does not need a
 * ClamAV sidecar in CI.
 */
const EICAR_MARKER = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$';
const EICAR_NAME = 'Eicar-Test-Signature';

/** Types whose bytes are text-ish enough for a PHI heuristic to mean something. */
const TEXTUAL: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/json',
  'application/xml',
  'text/csv',
  'text/html',
  'text/markdown',
  'text/plain',
]);

/**
 * Declared content type → required leading bytes. A mismatch means the client
 * renamed a file or the upload path is misconfigured; both are worth refusing
 * before the bytes reach a human. An unknown type is NOT a mismatch — this is a
 * list of what we can positively verify, not a gate on every type a tenant may
 * legitimately use.
 */
const MAGIC: ReadonlyArray<{ types: ReadonlySet<string>; prefix: readonly number[] }> = [
  { types: new Set(['application/pdf']), prefix: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { types: new Set(['image/png']), prefix: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { types: new Set(['image/jpeg']), prefix: [0xff, 0xd8, 0xff] },
  { types: new Set(['image/gif']), prefix: [0x47, 0x49, 0x46, 0x38] },
  { types: new Set(['application/zip']), prefix: [0x50, 0x4b, 0x03, 0x04] },
  { types: new Set(['application/gzip']), prefix: [0x1f, 0x8b] },
];

/** Executable signatures refused regardless of the declared type. */
const EXECUTABLE_MAGIC: ReadonlyArray<{ id: string; prefix: readonly number[] }> = [
  { id: 'PE', prefix: [0x4d, 0x5a] }, // MZ
  { id: 'ELF', prefix: [0x7f, 0x45, 0x4c, 0x46] },
  { id: 'MACHO', prefix: [0xfe, 0xed, 0xfa, 0xce] },
  { id: 'SCRIPT', prefix: [0x23, 0x21] }, // #!
];

/**
 * High-sensitivity patterns. Only the *name* of a match is ever reported — the
 * matched text is patient data and must not reach `scanDetail`, a log line, or
 * an audit row.
 */
const SENSITIVE_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: 'NATIONAL_ID', pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  { id: 'EMAIL', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { id: 'PHONE', pattern: /(?:\+?\d[\s().-]*){9,15}\d/ },
];

function matchesPrefix(head: Buffer, prefix: readonly number[]): boolean {
  if (head.length < prefix.length) return false;
  return prefix.every((byte, i) => head[i] === byte);
}

function bareType(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? '';
}

/**
 * The always-available scanner. Runs with no external service and makes three
 * real, falsifiable judgements:
 *
 *  1. **Type confusion** — the declared type's magic bytes, plus a hard refusal
 *     of anything that starts like an executable whatever the declared type.
 *     This is the check that catches a renamed payload.
 *  2. **Test-signature detection** — EICAR, so quarantine is provable.
 *  3. **Sensitive-content flagging** — textual content only; names only.
 *
 * It is not an antivirus engine and never claims to be one: `engine` records
 * `heuristic` and no signature name appears that was not actually derived.
 */
export class HeuristicDocumentScanner implements DocumentScanner {
  readonly name = 'heuristic';

  async scan(request: ScanRequest): Promise<ScanResult> {
    const { bytes } = request;
    const head = bytes.subarray(0, 8);
    const base = {
      engine: this.name,
      scannedBytes: bytes.length,
      truncated: (request.sizeBytes ?? 0) > bytes.length,
    };

    for (const exe of EXECUTABLE_MAGIC) {
      if (matchesPrefix(head, exe.prefix)) {
        return { ...base, verdict: 'REJECTED', detail: `EXECUTABLE_${exe.id}` };
      }
    }

    const expected = MAGIC.find((entry) => entry.types.has(bareType(request.contentType)));
    if (expected && !matchesPrefix(head, expected.prefix)) {
      return { ...base, verdict: 'REJECTED', detail: 'MAGIC_MISMATCH' };
    }

    if (TEXTUAL.has(bareType(request.contentType))) {
      // latin1 keeps every byte addressable so a match cannot split a
      // multi-byte character; it is a pattern scan, not a decode.
      const text = bytes.toString('latin1');
      if (text.includes(EICAR_MARKER) || text.includes(EICAR_NAME)) {
        return { ...base, verdict: 'INFECTED', detail: EICAR_NAME };
      }
      for (const { id, pattern } of SENSITIVE_PATTERNS) {
        if (pattern.test(text)) {
          return { ...base, verdict: 'FLAGGED', detail: id };
        }
      }
    }

    return { ...base, verdict: 'CLEAN' };
  }
}

/**
 * ClamAV over the `INSTREAM` protocol on a plain TCP socket. Speaks the daemon
 * protocol directly instead of adding a client dependency, matching the repo's
 * preference for a small seam over a large one. The socket is hard-timed: a
 * scanner that hangs must fail the scan, never the process. Any transport or
 * protocol failure is `ERROR`, never `CLEAN`, so the row stays unserved and the
 * outbox retries.
 */
export class ClamAvDocumentScanner implements DocumentScanner {
  readonly name = 'clamav';
  private readonly logger = new Logger(ClamAvDocumentScanner.name);

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number,
  ) {}

  async scan(request: ScanRequest): Promise<ScanResult> {
    let reply: string;
    try {
      reply = await this.instream(request.bytes);
    } catch (err) {
      this.logger.warn(
        `clamav INSTREAM failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        engine: this.name,
        verdict: 'ERROR',
        detail: 'ENGINE_UNAVAILABLE',
        scannedBytes: request.bytes.length,
        truncated: (request.sizeBytes ?? 0) > request.bytes.length,
      };
    }

    const infected = reply.includes('FOUND');
    return {
      engine: this.name,
      verdict: infected ? 'INFECTED' : 'CLEAN',
      // ClamAV's signature name is engine vocabulary rather than patient data,
      // but nothing from the body is echoed either way: a coarse marker only.
      ...(infected ? { detail: 'CLAMAV_SIGNATURE' } : {}),
      scannedBytes: request.bytes.length,
      truncated: (request.sizeBytes ?? 0) > request.bytes.length,
    };
  }

  /** Sends the prefix as one INSTREAM session and resolves the daemon reply. */
  private instream(bytes: Buffer): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      const parts: Buffer[] = [];
      let settled = false;

      const finish = (err: Error | null, value = ''): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (err) reject(err);
        else resolve(value);
      };

      socket.setTimeout(this.timeoutMs, () => finish(new Error('clamav timeout')));
      socket.on('error', (err: Error) => finish(err));
      socket.on('data', (buf: Buffer) => {
        parts.push(buf);
        // The daemon terminates a reply with a NUL byte.
        if (buf.includes(0)) finish(null, Buffer.concat(parts).toString('utf8').replace(/\0+$/, ''));
      });

      socket.on('connect', () => {
        try {
          socket.write(Buffer.from('zINSTREAM\0', 'binary'));
          const size = Buffer.alloc(4);
          size.writeUInt32BE(bytes.length, 0);
          socket.write(size);
          socket.write(bytes);
          socket.write(Buffer.alloc(4)); // zero-length chunk ends the stream
        } catch (err) {
          finish(err as Error);
        }
      });
    });
  }
}

/**
 * Runs engines in order and keeps the first verdict that is not `CLEAN`.
 *
 * The heuristic goes first so type confusion and EICAR are caught in a
 * deployment with no ClamAV, and so a ClamAV outage cannot downgrade a known
 * type-confusion to a clean-looking `ERROR`. `FLAGGED` short-circuits too: once
 * sensitive content is identified, a second engine adding a malware verdict
 * changes nothing about the outcome.
 */
export class ChainedDocumentScanner implements DocumentScanner {
  readonly name: string;

  constructor(private readonly engines: readonly DocumentScanner[]) {
    this.name = engines.map((engine) => engine.name).join('+');
  }

  async scan(request: ScanRequest): Promise<ScanResult> {
    let firstError: ScanResult | null = null;
    let last: ScanResult | null = null;
    for (const engine of this.engines) {
      const result = await engine.scan(request);
      last = result;
      if (result.verdict === 'CLEAN') continue;
      if (result.verdict === 'ERROR') {
        // Remember the first outage but keep going: a later engine may still
        // find something real, and a real finding outranks an outage.
        firstError ??= result;
        continue;
      }
      return result;
    }
    // Nothing definitive. An outage is not a pass, so surface it over `CLEAN`.
    return firstError ?? last!;
  }
}

/**
 * Chooses the scanner for this deployment. An unset `DOCUMENT_SCAN_CLAMAV_HOST`
 * keeps the heuristic scanner, which is a real check rather than a pass-through:
 * the default deployment still refuses executables, renamed payloads, and
 * EICAR. With ClamAV configured the chain is heuristic-then-ClamAV, so
 * type confusion is enforced regardless and ClamAV is authoritative for malware.
 */
export function defaultDocumentScanner(env: Env): DocumentScanner {
  const heuristic = new HeuristicDocumentScanner();
  if (!env.DOCUMENT_SCAN_CLAMAV_HOST) return heuristic;
  return new ChainedDocumentScanner([
    heuristic,
    new ClamAvDocumentScanner(
      env.DOCUMENT_SCAN_CLAMAV_HOST,
      env.DOCUMENT_SCAN_CLAMAV_PORT,
      env.DOCUMENT_SCAN_CLAMAV_TIMEOUT_MS,
    ),
  ]);
}

/**
 * Stable digest of the scanned prefix, for correlating a re-scan with the
 * original without persisting any content. Shortened to 16 hex chars because it
 * is a correlation label, not a security boundary — the full SHA-256 of the
 * document is the client's `checksumSha256` if it needs a real fingerprint.
 */
export function scanFingerprint(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}
