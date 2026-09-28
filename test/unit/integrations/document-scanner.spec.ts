import {
  ChainedDocumentScanner,
  ClamAvDocumentScanner,
  HeuristicDocumentScanner,
  defaultDocumentScanner,
  scanFingerprint,
  type DocumentScanner,
  type ScanRequest,
  type ScanResult,
} from '../../../src/integrations/documents/document-scanner';
import type { Env } from '../../../src/config/config.module';

/**
 * Unit coverage for the scanner seam (ADR-047).
 *
 * The e2e suite proves the pipeline end to end against the default
 * configuration. These tests cover what e2e cannot reach cheaply: the ClamAV
 * transport, its failure modes, and the chain semantics that decide what
 * happens when one engine is down and the other is not.
 */
describe('document scanner', () => {
  const pdfHeader = Buffer.from('%PDF-1.4\n', 'ascii');

  const req = (over: Partial<ScanRequest> = {}): ScanRequest => ({
    fileName: 'note.txt',
    contentType: 'text/plain',
    bytes: Buffer.from('ordinary clinical note', 'utf8'),
    ...over,
  });

  describe('HeuristicDocumentScanner', () => {
    const scanner = new HeuristicDocumentScanner();

    it('passes ordinary text as CLEAN', async () => {
      const result = await scanner.scan(req());
      expect(result.verdict).toBe('CLEAN');
      expect(result.engine).toBe('heuristic');
      expect(result.detail).toBeUndefined();
    });

    it('refuses an executable regardless of the declared content type', async () => {
      // The declared type is text/plain here on purpose: a renamed payload is
      // exactly the case the executable check must catch independently.
      const result = await scanner.scan(
        req({ bytes: Buffer.from([0x4d, 0x5a, 0x00, 0x00, 0x41]) }),
      );
      expect(result.verdict).toBe('REJECTED');
      expect(result.detail).toBe('EXECUTABLE_PE');
    });

    it('refuses a shell script', async () => {
      const result = await scanner.scan(
        req({ bytes: Buffer.from('#!/bin/sh\nrm -rf /\n', 'utf8') }),
      );
      expect(result.verdict).toBe('REJECTED');
      expect(result.detail).toBe('EXECUTABLE_SCRIPT');
    });

    it('flags a magic-byte mismatch on a verifiable type', async () => {
      const result = await scanner.scan(
        req({ fileName: 'x.pdf', contentType: 'application/pdf', bytes: Buffer.from('not a pdf') }),
      );
      expect(result.verdict).toBe('REJECTED');
      expect(result.detail).toBe('MAGIC_MISMATCH');
    });

    it('accepts a type it cannot verify rather than guessing', async () => {
      // An unlisted content type must not fail magic checking — tenants may use
      // legitimate types this table has never heard of.
      const result = await scanner.scan(
        req({ contentType: 'application/x-dicom', bytes: Buffer.from([0x44, 0x49, 0x43, 0x4d]) }),
      );
      expect(result.verdict).toBe('CLEAN');
    });

    it('accepts a well-formed PDF header', async () => {
      const result = await scanner.scan(
        req({ fileName: 'scan.pdf', contentType: 'application/pdf', bytes: pdfHeader }),
      );
      expect(result.verdict).toBe('CLEAN');
    });

    it('detects EICAR in textual content', async () => {
      const result = await scanner.scan(
        req({ bytes: Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$rest', 'binary') }),
      );
      expect(result.verdict).toBe('INFECTED');
      expect(result.detail).toBe('Eicar-Test-Signature');
    });

    it('flags a national ID but does not report the matched value', async () => {
      const result = await scanner.scan(
        req({ bytes: Buffer.from('id 123-45-6789 on file', 'utf8') }),
      );
      expect(result.verdict).toBe('FLAGGED');
      expect(result.detail).toBe('NATIONAL_ID');
      // The PHI is the whole point of not putting it in `detail`.
      expect(JSON.stringify(result)).not.toContain('123-45-6789');
    });

    it('flags an email address in textual content', async () => {
      const result = await scanner.scan(
        req({ bytes: Buffer.from('reach me at a.person@example.org', 'utf8') }),
      );
      expect(result.verdict).toBe('FLAGGED');
      expect(result.detail).toBe('EMAIL');
    });

    it('does not run text heuristics over binary content types', async () => {
      // A national-ID-shaped byte run inside a PNG is not a document finding.
      const result = await scanner.scan(
        req({
          fileName: 'image.png',
          contentType: 'image/png',
          bytes: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('123-45-6789')]),
        }),
      );
      expect(result.verdict).toBe('CLEAN');
    });

    it('reports truncation when the object exceeds the inspected prefix', async () => {
      const result = await scanner.scan(req({ bytes: pdfHeader, sizeBytes: 50_000_000 }));
      expect(result.truncated).toBe(true);
      expect(result.scannedBytes).toBe(pdfHeader.length);
    });

    it('reports no truncation when the whole object was inspected', async () => {
      const bytes = Buffer.from('short note', 'utf8');
      const result = await scanner.scan(req({ bytes, sizeBytes: bytes.length }));
      expect(result.truncated).toBe(false);
    });
  });

  describe('scanFingerprint', () => {
    it('is stable for the same bytes and different across content', () => {
      expect(scanFingerprint(Buffer.from('abc'))).toBe(scanFingerprint(Buffer.from('abc')));
      expect(scanFingerprint(Buffer.from('abc'))).not.toBe(scanFingerprint(Buffer.from('abd')));
    });

    it('is short enough to be a correlation label', () => {
      expect(scanFingerprint(Buffer.from('abc'))).toHaveLength(16);
    });
  });

  describe('ChainedDocumentScanner', () => {
    const stub = (name: string, result: ScanResult): DocumentScanner => ({
      name,
      scan: async () => result,
    });
    const ok = (name: string): DocumentScanner => stub(name, { ...blank(), verdict: 'CLEAN', engine: name });

    it('returns CLEAN when every engine is clean', async () => {
      const chain = new ChainedDocumentScanner([ok('a'), ok('b')]);
      expect((await chain.scan(req())).verdict).toBe('CLEAN');
      expect(chain.name).toBe('a+b');
    });

    it('returns the first real finding and stops', async () => {
      const calls: string[] = [];
      const first = stub('a', { ...blank(), verdict: 'INFECTED', engine: 'a', detail: 'X' });
      const second: DocumentScanner = {
        name: 'b',
        scan: async () => {
          calls.push('b');
          return { ...blank(), verdict: 'CLEAN', engine: 'b' };
        },
      };
      const chain = new ChainedDocumentScanner([first, second]);
      const result = await chain.scan(req());
      expect(result.verdict).toBe('INFECTED');
      expect(calls).toHaveLength(0);
    });

    it('prefers a real finding over an engine outage', async () => {
      // Order matters: the engine that is down must not mask a detection.
      const down = stub('a', { ...blank(), verdict: 'ERROR', engine: 'a', detail: 'ENGINE_UNAVAILABLE' });
      const finder = stub('b', { ...blank(), verdict: 'INFECTED', engine: 'b' });
      const chain = new ChainedDocumentScanner([down, finder]);
      expect((await chain.scan(req())).verdict).toBe('INFECTED');
    });

    it('surfaces the outage when nothing was definitively found', async () => {
      // A failed scan must never be reported as a pass.
      const down = stub('a', { ...blank(), verdict: 'ERROR', engine: 'a', detail: 'ENGINE_UNAVAILABLE' });
      const chain = new ChainedDocumentScanner([down, ok('b')]);
      const result = await chain.scan(req());
      expect(result.verdict).toBe('ERROR');
      expect(result.detail).toBe('ENGINE_UNAVAILABLE');
    });
  });

  describe('ClamAvDocumentScanner', () => {
    // Points at a port nothing is listening on, so `connect` fails fast.
    const dead = (): ClamAvDocumentScanner => new ClamAvDocumentScanner('127.0.0.1', 1, 250);

    it('returns ERROR, never CLEAN, when the daemon is unreachable', async () => {
      const result = await dead().scan(req({ bytes: Buffer.from('x') }));
      expect(result.verdict).toBe('ERROR');
      expect(result.detail).toBe('ENGINE_UNAVAILABLE');
    });

    it('times out rather than hanging when the daemon never answers', async () => {
      // Bound by an explicit short timeout so the test cannot stall the suite.
      const scanner = new ClamAvDocumentScanner('10.255.255.1', 3310, 150);
      const result = await scanner.scan(req({ bytes: Buffer.from('x') }));
      expect(result.verdict).toBe('ERROR');
    }, 10_000);
  });

  describe('defaultDocumentScanner', () => {
    const env = (over: Partial<Env> = {}): Env => ({ DOCUMENT_SCAN_CLAMAV_HOST: '', ...over }) as Env;

    it('uses the in-process heuristic when no ClamAV host is set', () => {
      expect(defaultDocumentScanner(env()).name).toBe('heuristic');
    });

    it('chains heuristic then ClamAV when a host is configured', () => {
      const scanner = defaultDocumentScanner(env({ DOCUMENT_SCAN_CLAMAV_HOST: 'clamav' }));
      expect(scanner.name).toBe('heuristic+clamav');
    });
  });
});

/** A neutral result body; every field is overridden by the stub under test. */
function blank(): Omit<ScanResult, 'verdict'> {
  return { engine: 'test', scannedBytes: 0, truncated: false };
}
