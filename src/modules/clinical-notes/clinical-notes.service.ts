import { Injectable } from '@nestjs/common';
import type { ClinicalNote, ClinicalNoteTemplate, Prisma } from '@prisma/client';
import { PrismaService, type TenantClient } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { WorkflowsService } from '../workflows/workflows.service';
import { assertEncounterOpen } from '../encounters/domain/encounter-flow';
import {
  NOTE_SECTION_KEYS,
  assertNoteStatus,
  nextVersionNumber,
  validateNoteSections,
} from './domain/note-versioning';
import type {
  AmendClinicalNoteDto,
  CreateClinicalNoteDto,
  CreateClinicalNoteTemplateDto,
  FinalizeClinicalNoteDto,
  ListClinicalNotesQueryDto,
  ListClinicalNoteTemplatesQueryDto,
  UpdateClinicalNoteDto,
} from './dto/clinical-note.dto';

/**
 * Clinical notes + templates + versioning (brief Phase 4 §6.6). DRAFT is
 * editable; finalizing writes the ORIGINAL version; anything later goes through
 * the amendment path (new superseding version, full snapshot, reason). The
 * clinical record is append-only — nothing is deleted or silently rewritten.
 */
@Injectable()
export class ClinicalNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly workflows: WorkflowsService,
  ) {}

  async create(input: CreateClinicalNoteDto) {
    const organizationId = this.tenantContext.requireOrg();
    const authorId = this.tenantContext.requireUserId();

    const note = await this.txRunner.run(async (ctx: TxContext) => {
      const encounter = await this.requireOpenEncounter(ctx, organizationId, input.encounterId);

      let sections: Prisma.JsonObject;
      if (input.sections) {
        sections = validateNoteSections(input.sections);
      } else if (input.templateId) {
        sections = await this.sectionsFromTemplate(ctx, organizationId, input.templateId);
      } else {
        throw new AppError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: `Provide sections or a templateId; section keys: ${NOTE_SECTION_KEYS.join(', ')}`,
          silent: true,
        });
      }

      const created = await ctx.db.clinicalNote.create({
        data: {
          id: newId(),
          organizationId,
          patientId: encounter.patientId,
          encounterId: input.encounterId,
          authorId,
          status: 'DRAFT',
          title: input.title ?? null,
          sections,
          templateId: input.templateId ?? null,
        },
      });

      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'clinical_notes.created',
          resource: 'clinical_note',
          resourceId: created.id,
          newState: { encounterId: input.encounterId },
        },
      });
      ctx.emit({
        type: EventTypes.ClinicalNoteCreated,
        aggregateType: 'clinical_note',
        aggregateId: created.id,
        payload: { noteId: created.id, encounterId: input.encounterId, patientId: encounter.patientId },
      });
      return created;
    });

    return { note: serializeNote(note) };
  }

  /** Edit a DRAFT note in place (FINAL notes are never directly edited). */
  async update(id: string, input: UpdateClinicalNoteDto) {
    const organizationId = this.tenantContext.requireOrg();

    const note = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireNote(ctx.db, organizationId, id);
      assertNoteStatus('DRAFT', current.status);

      const sections: Prisma.InputJsonValue = input.sections
        ? validateNoteSections(input.sections)
        : (current.sections as Prisma.InputJsonValue);
      return ctx.db.clinicalNote.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          sections,
        },
      });
    });

    return { note: serializeNote(note) };
  }

  /** DRAFT → FINAL: writes the ORIGINAL version snapshot. */
  async finalize(id: string, _input: FinalizeClinicalNoteDto) {
    const organizationId = this.tenantContext.requireOrg();
    const authorId = this.tenantContext.requireUserId();

    const note = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireNote(ctx.db, organizationId, id);
      assertNoteStatus('DRAFT', current.status);
      await this.workflows.assertAllowed(ctx.db, organizationId, 'clinical_note', current.status, 'FINAL');

      const versioned = await ctx.db.clinicalNoteVersion.create({
        data: {
          id: newId(),
          organizationId,
          noteId: id,
          versionNumber: 1,
          kind: 'ORIGINAL',
          title: current.title,
          sections: current.sections as Prisma.InputJsonObject,
          authorId,
        },
      });

      const updated = await ctx.db.clinicalNote.update({
        where: { id },
        data: { status: 'FINAL', finalizedAt: new Date() },
      });

      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'clinical_notes.finalized',
          resource: 'clinical_note',
          resourceId: id,
          newState: { versionId: versioned.id, versionNumber: versioned.versionNumber },
        },
      });
      ctx.emit({
        type: EventTypes.ClinicalNoteFinalized,
        aggregateType: 'clinical_note',
        aggregateId: id,
        payload: { noteId: id, encounterId: current.encounterId, patientId: current.patientId },
      });
      return updated;
    });

    return { note: serializeNote(note) };
  }

  /**
   * FINAL → amendment: creates a NEW superseding version and updates the note's
   * working snapshot. A reason is mandatory. This is the only way a finalized
   * note changes after completion.
   */
  async amend(id: string, input: AmendClinicalNoteDto) {
    const organizationId = this.tenantContext.requireOrg();
    const authorId = this.tenantContext.requireUserId();

    const note = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireNote(ctx.db, organizationId, id);
      assertNoteStatus('FINAL', current.status);

      const sections = validateNoteSections(input.sections);
      const lastVersion = await ctx.db.clinicalNoteVersion.findFirst({
        where: { organizationId, noteId: id },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true, id: true },
      });
      const versionNumber = nextVersionNumber(lastVersion ? [lastVersion.versionNumber] : []);

      const versioned = await ctx.db.clinicalNoteVersion.create({
        data: {
          id: newId(),
          organizationId,
          noteId: id,
          versionNumber,
          kind: 'AMENDMENT',
          title: input.title ?? current.title,
          sections: sections as Prisma.InputJsonObject,
          reason: input.reason,
          authorId,
          supersedesVersionId: lastVersion?.id ?? null,
        },
      });

      const updated = await ctx.db.clinicalNote.update({
        where: { id },
        data: {
          title: input.title ?? current.title,
          sections: sections as Prisma.InputJsonObject,
          reason: input.reason,
        },
      });

      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'clinical_notes.amended',
          resource: 'clinical_note',
          resourceId: id,
          newState: {
            versionId: versioned.id,
            versionNumber: versioned.versionNumber,
            reason: input.reason,
          },
        },
      });
      ctx.emit({
        type: EventTypes.ClinicalNoteAmended,
        aggregateType: 'clinical_note',
        aggregateId: id,
        payload: { noteId: id, encounterId: current.encounterId, patientId: current.patientId },
      });
      return updated;
    });

    return { note: serializeNote(note) };
  }

  async list(query: ListClinicalNotesQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.ClinicalNoteWhereInput = {};
    if (query.patientId) where.patientId = query.patientId;
    if (query.encounterId) where.encounterId = query.encounterId;
    if (query.status) where.status = query.status;

    const [rows, total] = await Promise.all([
      db.clinicalNote.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.clinicalNote.count({ where }),
    ]);
    return pageOf(rows.map(serializeNote), total, page, limit);
  }

  /** Note with its full version history (reconstructable record). */
  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const note = await this.requireNote(db, organizationId, id);
    const versions = await db.clinicalNoteVersion.findMany({
      where: { organizationId, noteId: id },
      orderBy: { versionNumber: 'asc' },
    });
    return { note: { ...serializeNote(note), versions: versions.map(serializeVersion) } };
  }

  // --- templates ------------------------------------------------------------

  async createTemplate(input: CreateClinicalNoteTemplateDto) {
    const organizationId = this.tenantContext.requireOrg();
    const createdById = this.tenantContext.scope.userId ?? null;

    for (const key of input.sections) {
      if (!NOTE_SECTION_KEYS.includes(key as (typeof NOTE_SECTION_KEYS)[number])) {
        throw new AppError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: `Unknown note section '${key}'. Allowed: ${NOTE_SECTION_KEYS.join(', ')}`,
          silent: true,
        });
      }
    }

    const template = await this.txRunner.run(async (ctx: TxContext) => {
      const existing = await ctx.db.clinicalNoteTemplate.findFirst({
        where: { organizationId, name: input.name },
        select: { id: true },
      });
      if (existing) {
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: 'A template with this name already exists.',
          silent: true,
        });
      }
      return ctx.db.clinicalNoteTemplate.create({
        data: {
          id: newId(),
          organizationId,
          name: input.name,
          description: input.description ?? null,
          departmentId: input.departmentId ?? null,
          sections: input.sections as Prisma.InputJsonArray,
          createdById,
        },
      });
    });

    return { template: serializeTemplate(template) };
  }

  async listTemplates(query: ListClinicalNoteTemplatesQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.ClinicalNoteTemplateWhereInput = { isActive: true };
    if (query.departmentId) where.departmentId = query.departmentId;

    const [rows, total] = await Promise.all([
      db.clinicalNoteTemplate.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.clinicalNoteTemplate.count({ where }),
    ]);
    return pageOf(rows.map(serializeTemplate), total, page, limit);
  }

  // --- shared helpers -------------------------------------------------------

  private async requireOpenEncounter(ctx: TxContext, organizationId: string, encounterId: string) {
    const encounter = await ctx.db.encounter.findFirst({
      where: { id: encounterId, organizationId },
    });
    if (!encounter) throw notFound('Encounter not found');
    assertEncounterOpen(encounter.status);
    return encounter;
  }

  private async sectionsFromTemplate(
    ctx: TxContext,
    organizationId: string,
    templateId: string,
  ): Promise<Prisma.JsonObject> {
    const template = await ctx.db.clinicalNoteTemplate.findFirst({
      where: { id: templateId, organizationId, isActive: true },
      select: { sections: true },
    });
    if (!template) throw notFound('Template not found');
    const keys = template.sections as unknown as string[];
    const sections: Prisma.JsonObject = {};
    for (const key of keys) sections[key] = sectionLabel(key);
    return sections;
  }

  private async requireNote(
    db: TenantClient | TxContext['db'],
    organizationId: string,
    id: string,
  ) {
    const note = await db.clinicalNote.findFirst({ where: { id, organizationId } });
    if (!note) throw notFound('Clinical note not found');
    return note;
  }
}

function sectionLabel(key: string): string {
  const labels: Record<string, string> = {
    chiefComplaint: '',
    history: '',
    subjective: '',
    objective: '',
    assessment: '',
    plan: '',
    instructions: '',
    followUp: '',
  };
  return labels[key] ?? '';
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

function serializeTemplate(t: ClinicalNoteTemplate) {
  return {
    id: t.id,
    organizationId: t.organizationId,
    name: t.name,
    description: t.description,
    departmentId: t.departmentId,
    sections: t.sections as unknown as string[],
    isActive: t.isActive,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export function serializeNote(n: ClinicalNote) {
  return {
    id: n.id,
    organizationId: n.organizationId,
    patientId: n.patientId,
    encounterId: n.encounterId,
    authorId: n.authorId,
    status: n.status,
    title: n.title,
    sections: n.sections,
    reason: n.reason,
    templateId: n.templateId,
    finalizedAt: n.finalizedAt,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

function serializeVersion(v: {
  id: string;
  versionNumber: number;
  kind: string;
  title: string | null;
  sections: Prisma.JsonValue;
  reason: string | null;
  authorId: string;
  createdAt: Date;
}) {
  return {
    id: v.id,
    versionNumber: v.versionNumber,
    kind: v.kind,
    title: v.title,
    sections: v.sections,
    reason: v.reason,
    authorId: v.authorId,
    createdAt: v.createdAt,
  };
}