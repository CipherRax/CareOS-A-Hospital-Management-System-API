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
    uploadedAt: d.uploadedAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}