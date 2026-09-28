import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { AuditService } from '../../database/audit.service';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf, type PageResult } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { ObjectStorageService } from '../../common/storage/object-storage.service';
import { EventTypes } from '../../events/catalog';
import type { Document, Prisma } from '@prisma/client';

interface InitiateInput {
  fileName: string;
  contentType: string;
  sizeBytes?: number;
  checksumSha256?: string;
  metadata?: Record<string, unknown>;
}

/** The verdicts that permit a presigned GET. FLAGGED is deliberately included. */
const SERVABLE: ReadonlySet<Document['scanStatus']> = new Set(['CLEAN', 'FLAGGED']);

/** Scan verdicts that permanently block serving, to keep the error honest. */
const REFUSED: ReadonlySet<Document['scanStatus']> = new Set(['INFECTED', 'REJECTED']);

/**
 * Documents are metadata rows for files held in S3/MinIO. The API never sees
 * the binary: initiate returns a short-lived presigned PUT URL, the client
 * uploads directly, and `complete` verifies the object then records state.
 * Storage keys are `${organizationId}/${documentId}` — per-tenant namespaced,
 * deterministic, and never derived from client-supplied strings.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
    private readonly txRunner: TxRunner,
    private readonly storage: ObjectStorageService,
  ) {}

  async initiate(input: InitiateInput) {
    const organizationId = this.tenantContext.requireOrg();
    const uploadedByUserId = this.tenantContext.requireUserId();

    const documentId = newId();
    const storageKey = `${organizationId}/${documentId}`;

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      const document = await ctx.db.document.create({
        data: {
          id: documentId,
          organizationId,
          uploadedByUserId,
          fileName: input.fileName,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes ?? null,
          checksumSha256: input.checksumSha256 ?? null,
          storageKey,
          status: 'PENDING_UPLOAD',
          metadata: (input.metadata ?? {}) as Prisma.InputJsonObject,
        },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'documents.initiate',
          resource: 'document',
          resourceId: documentId,
          reason: `Upload initiated for ${input.fileName}`,
          newState: { fileName: input.fileName, contentType: input.contentType },
        },
      });
      return document;
    });

    const upload = await this.storage.presignPut(storageKey, input.contentType);
    return { document: toDocumentResponse(result), upload };
  }

  /** Confirms the object exists in storage and finalises the document row. */
  async complete(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const doc = await this.getEntity(id, organizationId);

    if (doc.status !== 'PENDING_UPLOAD') {
      throw new AppError({
        code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
        message: `Cannot complete a document in status ${doc.status}.`,
        silent: true,
      });
    }

    const head = await this.storage.head(doc.storageKey);
    if (!head.exists) {
      throw new AppError({
        code: ErrorCodes.S3_UNAVAILABLE,
        message: 'The file was not uploaded before it expired; initiate again.',
        silent: true,
      });
    }
    if (doc.sizeBytes !== null && head.sizeBytes !== undefined && head.sizeBytes !== doc.sizeBytes) {
      throw new AppError({
        code: ErrorCodes.FILE_TOO_LARGE,
        message: `Uploaded size (${head.sizeBytes} bytes) does not match the declared size.`,
        silent: true,
      });
    }

    await this.txRunner.run(async (ctx: TxContext) => {
      await ctx.db.document.update({
        where: { id: doc.id },
        data: { status: 'UPLOADED', uploadedAt: new Date() },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'documents.complete',
          resource: 'document',
          resourceId: doc.id,
          reason: `Upload confirmed (${head.sizeBytes ?? 'unknown'} bytes)`,
          newState: { status: 'UPLOADED', sizeBytes: head.sizeBytes },
        },
      });
      ctx.emit({
        type: EventTypes.DocumentUploaded,
        aggregateType: 'document',
        aggregateId: doc.id,
        payload: {
          documentId: doc.id,
          storageKey: doc.storageKey,
          fileName: doc.fileName,
          sizeBytes: head.sizeBytes,
        },
      });
    });

    return toDocumentResponse({ ...doc, status: 'UPLOADED' as const });
  }

  async get(id: string) {
    const doc = await this.getEntity(id, this.tenantContext.requireOrg());
    if (doc.status === 'DELETED') {
      throw AppError.notFound('Document not found');
    }
    return toDocumentResponse(doc);
  }

  async downloadUrl(id: string) {
    const doc = await this.getEntity(id, this.tenantContext.requireOrg());
    if (doc.status !== 'UPLOADED') {
      throw new AppError({
        code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
        message: `Document is ${doc.status}; only uploaded documents are downloadable.`,
        silent: true,
      });
    }
    // The gate that gives the whole phase meaning: `complete` proved the object
    // exists, not that it is safe. A presigned GET minted before a scan verdict
    // exists would hand the bytes to the caller and make scanning advisory.
    // PENDING and ERROR are refusals in the same direction as INFECTED, only
    // with a different code — one is "refused", the other is "not yet known".
    if (!SERVABLE.has(doc.scanStatus)) {
      throw REFUSED.has(doc.scanStatus)
        ? new AppError({
            code: ErrorCodes.DOCUMENT_CONTENT_REJECTED,
            message: 'This document was refused by the content scan and cannot be downloaded.',
            silent: true,
          })
        : new AppError({
            code: ErrorCodes.DOCUMENT_NOT_CLEARED,
            message:
              doc.scanStatus === 'PENDING'
                ? 'This document is still being scanned; try again shortly.'
                : 'The content scan did not complete; the document is not downloadable until it is re-scanned.',
            silent: true,
          });
    }
    const { url, expiresIn } = await this.storage.presignGet(doc.storageKey, doc.fileName);
    return { documentId: doc.id, url, expiresIn };
  }

  async list(query: { page?: number; limit?: number; status?: string }): Promise<PageResult<unknown>> {
    const organizationId = this.tenantContext.requireOrg();
    const { page, limit } = paginate(query);

    const where: Prisma.DocumentWhereInput = { organizationId };
    if (query.status) {
      if (!['PENDING_UPLOAD', 'UPLOADED', 'DELETED'].includes(query.status)) {
        throw new AppError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Invalid status filter',
          silent: true,
        });
      }
      where.status = query.status as Document['status'];
    } else {
      // Default view excludes soft-deleted documents.
      where.status = { not: 'DELETED' };
    }

    const [total, rows] = await Promise.all([
      this.prisma.tenant.document.count({ where }),
      this.prisma.tenant.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return pageOf(rows.map(toDocumentResponse), total, page, limit);
  }

  /** Soft-deletes the row and removes the object from storage. */
  async remove(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const doc = await this.getEntity(id, organizationId);
    if (doc.status === 'DELETED') {
      throw AppError.notFound('Document not found');
    }

    await this.txRunner.run(async (ctx: TxContext) => {
      await ctx.db.document.update({
        where: { id: doc.id },
        data: { status: 'DELETED', uploadedAt: doc.uploadedAt },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'documents.delete',
          resource: 'document',
          resourceId: doc.id,
          reason: `Document deleted (${doc.fileName})`,
          previousState: { status: doc.status, storageKey: doc.storageKey },
          newState: { status: 'DELETED' },
        },
      });
    });

    await this.storage.remove(doc.storageKey);
  }

  /**
   * Persists a scan verdict (ADR-047).
   *
   * Called by the `Storage.DocumentUploaded` consumer, not by a controller, so
   * this does no tenant scoping of its own — the consumer is a system actor and
   * reaches the row by id. Written with a `many` guard so a duplicate event
   * (outbox at-least-once, or a re-scan racing a retry) cannot resurrect a
   * document that has since been deleted.
   */
  async recordScan(
    documentId: string,
    organizationId: string,
    result: {
      verdict: Document['scanStatus'];
      engine: string;
      detail?: string;
      scannedBytes: number;
      truncated: boolean;
      fingerprint?: string;
    },
  ): Promise<void> {
    const db = this.prisma.unscoped();
    const updated = await db.document.updateMany({
      where: { id: documentId, organizationId, status: { not: 'DELETED' } },
      data: {
        scanStatus: result.verdict,
        scannedAt: new Date(),
        scanEngine: result.engine,
        scanDetail: result.detail ?? null,
        scannedBytes: result.scannedBytes,
        scanTruncated: result.truncated,
        scanFingerprint: result.fingerprint ?? null,
      },
    });
    if (updated.count === 0) return;

    // Deliberately no document content in the audit row — only the verdict and
    // the rule name, so the audit trail of a scan carries no patient data.
    await db.auditLog.create({
      data: {
        id: newId(),
        organizationId,
        action: 'documents.scan',
        resource: 'document',
        resourceId: documentId,
        reason: `Content scan ${result.verdict} by ${result.engine}`,
        newState: {
          scanStatus: result.verdict,
          engine: result.engine,
          detail: result.detail ?? null,
          scannedBytes: result.scannedBytes,
          truncated: result.truncated,
        },
      },
    });
  }

  /**
   * Re-queues inspection of an already-uploaded document.
   *
   * Exists because historical rows were uploaded before any scanner ran and the
   * migration deliberately left them PENDING rather than claiming they were
   * clean. It also covers a document whose scan hit `ERROR`: the engine outage
   * is not the operator's problem to fix by hand-editing rows.
   *
   * Resets to PENDING first so the document is unservable for the duration of
   * the re-scan, then emits the same event `complete` does. That keeps one
   * scan code path instead of two.
   */
  async rescan(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const doc = await this.getEntity(id, organizationId);
    if (doc.status !== 'UPLOADED') {
      throw new AppError({
        code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
        message: `Cannot re-scan a document in status ${doc.status}.`,
        silent: true,
      });
    }

    await this.txRunner.run(async (ctx: TxContext) => {
      await ctx.db.document.update({
        where: { id: doc.id },
        data: {
          scanStatus: 'PENDING',
          scannedAt: null,
          scanEngine: null,
          scanDetail: null,
          scannedBytes: null,
          scanTruncated: false,
          scanFingerprint: null,
        },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'documents.rescan',
          resource: 'document',
          resourceId: doc.id,
          reason: `Re-scan requested (was ${doc.scanStatus})`,
          previousState: { scanStatus: doc.scanStatus },
          newState: { scanStatus: 'PENDING' },
        },
      });
      ctx.emit({
        type: EventTypes.DocumentUploaded,
        aggregateType: 'document',
        aggregateId: doc.id,
        payload: {
          documentId: doc.id,
          storageKey: doc.storageKey,
          fileName: doc.fileName,
          sizeBytes: doc.sizeBytes,
        },
      });
    });

    return { documentId: doc.id, scanStatus: 'PENDING' as const };
  }

  private async getEntity(id: string, organizationId: string): Promise<Document> {
    if (!id) throw AppError.notFound('Document not found');
    const doc = await this.prisma.tenant.document.findFirst({
      where: { id, organizationId },
    });
    if (!doc) throw AppError.notFound('Document not found');
    return doc;
  }
}

function toDocumentResponse(d: Document) {
  return {
    id: d.id,
    fileName: d.fileName,
    contentType: d.contentType,
    sizeBytes: d.sizeBytes,
    checksumSha256: d.checksumSha256,
    status: d.status,
    metadata: d.metadata,
    // Content-security state, so a client can tell "still scanning" from
    // "scanned and clean" without attempting a download. `scanDetail` is
    // surfaced: it is a rule name, never document content.
    scanStatus: d.scanStatus,
    scannedAt: d.scannedAt,
    scanEngine: d.scanEngine,
    scanDetail: d.scanDetail,
    scannedBytes: d.scannedBytes,
    scanTruncated: d.scanTruncated,
    downloadable: SERVABLE.has(d.scanStatus) && d.status === 'UPLOADED',
    uploadedAt: d.uploadedAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}