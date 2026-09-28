import { Inject, Injectable, Logger } from '@nestjs/common';
import { ObjectStorageService } from '../../common/storage/object-storage.service';
import { ENV, type Env } from '../../config/config.module';
import { EventTypes } from '../../events/catalog';
import type {
  OutboxConsumer,
  OutboxConsumerContext,
} from '../../events/outbox-consumer/outbox-consumer.types';
import {
  DOCUMENT_SCANNER,
  scanFingerprint,
  type DocumentScanner,
} from '../../integrations/documents/document-scanner';
import { DocumentsService } from './documents.service';

/**
 * The `Storage.DocumentUploaded` payload fields this consumer relies on. Declared
 * loosely on purpose: the payload arrives as already-serialised JSON from the
 * outbox and every field is re-checked at runtime below.
 */
interface DocumentUploadedPayload {
  documentId?: unknown;
  storageKey?: unknown;
  fileName?: unknown;
  sizeBytes?: unknown;
  contentType?: unknown;
}

/**
 * `Storage.DocumentUploaded` side-effect (patch P8, ADR-047).
 *
 * `complete` only ever asked whether the object existed and matched its declared
 * size, so nothing had ever read a document's bytes. Uploading an executable
 * renamed to `.pdf`, or a real malware sample, was accepted and then served to
 * anyone holding `documents.read`. This consumer is the first reader.
 *
 * Design points worth stating, because they are the ones a reviewer will probe:
 *
 *  - **Off the request path.** Scanning happens in the outbox dispatcher, not in
 *    `complete`, so a slow or unavailable AV engine cannot turn an upload into a
 *    timeout. The document is simply not downloadable until the verdict lands.
 *  - **Bounded, never whole-file.** The object is streamed and accumulated only
 *    up to `DOCUMENT_SCAN_MAX_BYTES`, so memory is a function of the cap and not
 *    of an attacker-chosen upload size. A scan that read a prefix records
 *    `truncated` rather than implying full coverage.
 *  - **`ERROR` is a real state, not a pass.** A storage read failure or an AV
 *    outage records `ERROR` and the document stays unservable. It is *not*
 *    retried by throwing, because a re-raised throw would make the outbox retry
 *    the same broken engine on a tight loop; the operator re-scans via
 *    `POST /documents/:id/rescan`, and `docs/limitations.md` says so. Throwing is
 *    reserved for a payload we cannot act on at all.
 *  - **No content leaves this function.** `scanDetail` is a rule name; the
 *    fingerprint is a truncated digest. Neither the bytes nor a filename
 *    fragment is persisted or logged.
 */
@Injectable()
export class DocumentScanConsumer implements OutboxConsumer {
  readonly name = 'document-scan';
  readonly eventTypes: ReadonlyArray<string> = [EventTypes.DocumentUploaded];

  private readonly logger = new Logger(DocumentScanConsumer.name);

  constructor(
    private readonly storage: ObjectStorageService,
    private readonly documents: DocumentsService,
    @Inject(ENV) private readonly env: Env,
    @Inject(DOCUMENT_SCANNER) private readonly scanner: DocumentScanner,
  ) {}

  async handle(ctx: OutboxConsumerContext): Promise<void> {
    const payload = (ctx.row.payload ?? {}) as DocumentUploadedPayload;
    const documentId = typeof payload.documentId === 'string' ? payload.documentId : ctx.row.aggregateId;
    const storageKey = typeof payload.storageKey === 'string' ? payload.storageKey : null;
    if (!documentId || !storageKey) {
      // Unactionable payload: retrying cannot make it valid, so ack it and log.
      this.logger.warn(`document upload ${ctx.row.id} carried no storageKey; scan skipped`);
      return;
    }

    // The row is the authority on what the document *is*; the payload is only a
    // hint about the object. Reading contentType from the row keeps a forged or
    // stale event from relabelling the type the scanner validates against.
    const doc = await ctx.db.document.findFirst({
      where: { id: documentId, organizationId: ctx.organizationId },
      select: {
        fileName: true,
        contentType: true,
        sizeBytes: true,
        status: true,
        scanStatus: true,
      },
    });
    if (!doc || doc.status === 'DELETED') {
      this.logger.warn(`document ${documentId} is gone; scan skipped`);
      return;
    }

    const limit = this.env.DOCUMENT_SCAN_MAX_BYTES;
    let bytes: Buffer;
    try {
      bytes = await this.readBounded(storageKey, limit);
    } catch (err) {
      this.logger.warn(
        `could not read ${storageKey} for scanning: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.documents.recordScan(documentId, ctx.organizationId, {
        verdict: 'ERROR',
        engine: this.scanner.name,
        detail: 'STORAGE_UNAVAILABLE',
        scannedBytes: 0,
        truncated: false,
      });
      return;
    }

    const result = await this.scanner.scan({
      fileName: doc.fileName,
      contentType: doc.contentType,
      bytes,
      sizeBytes: doc.sizeBytes ?? undefined,
    });

    // A verdict is recorded exactly as the engine returned it. In particular a
    // truncated scan is NOT relabelled: `CLEAN` with `scanTruncated: true` is
    // the honest reading ("clean as far as we read"), and the response and the
    // limitations doc both say so. Folding truncation into another verdict would
    // make `scanDetail` contradict what that verdict is defined to mean.
    await this.documents.recordScan(documentId, ctx.organizationId, {
      verdict: result.verdict,
      engine: result.engine,
      detail: result.detail,
      scannedBytes: result.scannedBytes,
      truncated: result.truncated,
      fingerprint: scanFingerprint(bytes),
    });

    if (result.verdict === 'INFECTED' || result.verdict === 'REJECTED') {
      // Name the verdict, never the bytes or the filename.
      this.logger.warn(
        `document ${documentId} refused by scan (${result.verdict}, ${result.detail ?? 'no detail'})`,
      );
    }
  }

  /** Accumulates at most `limit` bytes from the object, in memory. */
  private async readBounded(storageKey: string, limit: number): Promise<Buffer> {
    const stream = await this.storage.stream(storageKey, limit);
    const parts: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream.chunks) {
      parts.push(chunk);
      total += chunk.length;
      if (total >= limit) break;
    }
    return Buffer.concat(parts).subarray(0, limit);
  }
}
