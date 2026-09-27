import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import type { EmergencyRequest, EmergencyRequestStatus } from '@prisma/client';
import { FieldEncryption } from '../../common/security/crypto';
import { EventTypes } from '../../events/catalog';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { newId } from '../../common/lib/uuidv7';
import { pageOf, paginate } from '../../common/pagination/pagination';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { RealtimeService } from '../../database/realtime.service';
import {
  EMERGENCY_REQUEST_COUNTER_KEY,
  callerAction,
  escalationDepth,
  formatEmergencyRequestReference,
  generateTrackingToken,
  levelDelayMs,
  normalizePhone,
  parseLevelSeconds,
} from './domain/escalation';
import { defaultNumbersFor } from './domain/numbers';
import {
  CancelEmergencyRequestDto,
  EmergencyContactPatchDto,
  EmergencyContactUpsertDto,
  EmergencyNumberUpsertDto,
  IntakePolicyUpdateDto,
  ListEmergencyRequestsQueryDto,
  PublicNoticeUpsertDto,
  StaffNoteDto,
  SubmitEmergencyRequestDto,
  TrackEmergencyRequestDto,
} from './dto/emergency-intake.dto';

export const ESCALATION_QUEUE = 'emergency-escalation';
export const ESCALATION_JOB = 'escalate';
export const REQUESTS_TOPIC = 'emergency-requests';

const REQUEST_STATUSES: EmergencyRequestStatus[] = [
  'RECEIVED',
  'ACKNOWLEDGED',
  'RESPONDING',
  'ESCALATED',
  'CLOSED',
  'CANCELLED',
];
const TERMINAL: readonly EmergencyRequestStatus[] = ['CLOSED', 'CANCELLED'];

export interface RequestView {
  id: string;
  referenceNumber: string;
  status: string;
  escalationLevel: number;
  branchId: string;
  source: string;
  callerName: string | null;
  callerPhone: string | null;
  description: string | null;
  location: { lat: number | null; lng: number | null; landmark: string | null };
  staffNote: string | null;
  acknowledgedAt: Date | null;
  respondedAt: Date | null;
  closedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class EmergencyIntakeService {
  private readonly logger = new Logger(EmergencyIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly realtime: RealtimeService,
    @Inject(FieldEncryption) private readonly encryption: FieldEncryption,
    @InjectQueue(ESCALATION_QUEUE) private readonly escalationQueue: Queue,
  ) {}

  // ---------------------------------------------------------------------------
  // Anonymous public surface
  // ---------------------------------------------------------------------------

  /** ADR-038/040: reads only the PUBLISHED projection, then writes the tenant request. */
  async submitPublic(input: SubmitEmergencyRequestDto) {
    const projection = await this.prisma.unscoped().publicFacilityListing.findFirst({
      where: { slug: input.slug },
    });

    if (!projection || projection.status !== 'PUBLISHED') {
      throw new AppError({
        code: ErrorCodes.PUBLIC_LISTING_NOT_PUBLISHED,
        message: 'Facility not found for that slug.',
        silent: true,
      });
    }
    if (!projection.emergencyIntakeEnabled) {
      throw new AppError({
        code: ErrorCodes.FACILITY_NOT_ACCEPTING_REQUESTS,
        message:
          'This facility is not currently accepting emergency help requests. Call the facility or your national emergency number instead.',
        silent: true,
      });
    }
    // A published listing must be resolvable to its tenant branch to write the
    // request; if the projection has no source (imported feed), fall through to
    // the call-them instead path rather than erroring.
    if (!projection.sourceOrganizationId || !projection.sourceBranchId) {
      throw new AppError({
        code: ErrorCodes.FACILITY_NOT_ACCEPTING_REQUESTS,
        message:
          'This facility is not currently accepting emergency help requests. Call the facility or your national emergency number instead.',
        silent: true,
      });
    }
    const organizationId = projection.sourceOrganizationId;
    const branchId = projection.sourceBranchId;

    const { lat, lng, landmark } = input.location ?? {};
    if (input.location && (lat === undefined) !== (lng === undefined)) {
      throw new AppError({
        code: ErrorCodes.INVALID_COORDINATES,
        message: 'Both latitude and longitude are required together.',
        silent: true,
      });
    }
    // A facility we cannot locate on the map needs a reported location so
    // responders can find the caller.
    if (!projection.locationLat || !projection.locationLng) {
      if (lat === undefined || lng === undefined) {
        throw new AppError({
          code: ErrorCodes.LOCATION_REQUIRED,
          message: 'Provide your current location so responders can find you.',
          silent: true,
        });
      }
    }

    const callerPhoneIndex =
      input.callerPhone !== undefined ? normalizePhone(input.callerPhone) : null;
    const { token, tokenHash } = generateTrackingToken();

    const request = await this.txRunner.run<EmergencyRequest>(
      async (ctx: TxContext) => {
        const seq = await this.nextRequestSequence(ctx, organizationId);
        const id = newId();
        const row = await ctx.db.emergencyRequest.create({
          data: {
            id,
            organizationId: organizationId,
            branchId: branchId,
            referenceNumber: formatEmergencyRequestReference(seq),
            trackingTokenHash: tokenHash,
            status: 'RECEIVED',
            escalationLevel: 0,
            source: 'PUBLIC',
            callerNameEnc: input.callerName ? this.encryption.encrypt(input.callerName) : null,
            callerPhoneEnc: input.callerPhone ? this.encryption.encrypt(input.callerPhone) : null,
            callerPhoneIndex,
            descriptionEnc: input.description ? this.encryption.encrypt(input.description) : null,
            locationLat: lat ?? null,
            locationLng: lng ?? null,
            landmarkEnc: landmark ? this.encryption.encrypt(landmark) : null,
          },
          select: { id: true, trackingTokenHash: true },
        });

        ctx.emit({
          type: EventTypes.EmergencyRequestReceived,
          aggregateType: 'emergency_request',
          aggregateId: row.id,
          payload: { requestId: row.id },
        });

        await ctx.db.emergencyRequestEvent.create({
          data: {
            id: newId(),
            organizationId: organizationId,
            requestId: row.id,
            type: 'RECEIVED',
            level: 0,
            actor: 'CALLER',
          },
        });

        return ctx.db.emergencyRequest.findFirstOrThrow({
          where: { id: row.id, organizationId: organizationId },
        });
      },
      { organizationId: organizationId },
    );

    // SLA timer: only when the branch's policy enables autonomous escalation.
    const policy = await this.prisma
      .tenantFor(organizationId)
      .emergencyIntakePolicy.findFirst({
        where: { branchId: branchId, organizationId: organizationId },
        select: { enabled: true, autoEscalate: true },
      });
    if (policy?.enabled && policy.autoEscalate) {
      await this.scheduleEscalation(request.id, organizationId, 1);
    }

    this.realtime.publish(organizationId, REQUESTS_TOPIC, {
      event: EventTypes.EmergencyRequestReceived,
      version: 1,
      aggregateId: request.id,
      payload: { requestId: request.id, referenceNumber: request.referenceNumber },
    });

    // The token is returned exactly once; only its SHA-256 hash is persisted.
    return {
      request: {
        id: request.id,
        referenceNumber: request.referenceNumber,
        trackingToken: token,
      },
      contact: projection.phone ?? null,
    };
  }

  /** Caller tracking: the token hash resolves the request with no tenant reads. */
  async trackPublic(input: TrackEmergencyRequestDto) {
    const tokenHash = this.hashToken(input.token);
    const request = await this.prisma
      .unscoped()
      .emergencyRequest.findFirst({ where: { trackingTokenHash: tokenHash } });
    if (!request) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'No request found for that tracking token.',
        silent: true,
      });
    }
    const action = callerAction(request);
    const facility = await this.prisma
      .unscoped()
      .publicFacilityListing.findFirst({
        where: {
          sourceOrganizationId: request.organizationId,
          sourceBranchId: request.branchId,
        },
        select: { name: true, slug: true, phone: true },
      });
    const messages: Record<string, string> = {
      WAIT: 'We have notified the facility. Keep this token to check again as your request advances.',
      CALL_NOW:
        'No responder has confirmed this request yet. Call the facility or your national emergency number right now.',
      HELP_ON_WAY: 'A response team has taken this request. Stay where you are and keep your phone ready.',
    };
    return {
      referenceNumber: request.referenceNumber,
      receivedAt: request.createdAt,
      status: request.status,
      action,
      message: messages[action],
      level: request.escalationLevel,
      facility: {
        name: facility?.name ?? null,
        slug: facility?.slug ?? null,
        phone: facility?.phone ?? null,
      },
    };
  }

  /** Caller-initiated cancel. Closed requests are a no-op; responding blocks it. */
  async cancelPublic(input: CancelEmergencyRequestDto) {
    const tokenHash = this.hashToken(input.token);
    const found = await this.prisma.unscoped().emergencyRequest.findFirst({
      where: { trackingTokenHash: tokenHash },
      select: { id: true, organizationId: true },
    });
    if (!found) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'No request found for that tracking token.',
        silent: true,
      });
    }

    const result = await this.txRunner.run(
      async (ctx: TxContext) => {
        const current = await ctx.db.emergencyRequest.findFirst({
          where: { id: found.id, organizationId: found.organizationId },
        });
        if (!current) throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Request not found' });
        if (current.status === 'RESPONDING') {
          throw new AppError({
            code: ErrorCodes.EMERGENCY_CALL_NOW,
            message:
              'A responder is already on the way for this request. Do not cancel — call the facility for updates instead.',
            silent: true,
          });
        }
        if (TERMINAL.includes(current.status)) {
          return { status: current.status, already: true };
        }
        await ctx.db.emergencyRequest.update({
          where: { id: found.id },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        });
        ctx.emit({
          type: EventTypes.EmergencyRequestCancelled,
          aggregateType: 'emergency_request',
          aggregateId: found.id,
          payload: { requestId: found.id },
        });
        await ctx.db.emergencyRequestEvent.create({
          data: {
            id: newId(),
            organizationId: found.organizationId,
            requestId: found.id,
            type: 'CANCELLED',
            actor: 'CALLER',
          },
        });
        return { status: 'CANCELLED', already: false };
      },
      { organizationId: found.organizationId },
    );

    if (!result.already) {
      this.realtime.publish(found.organizationId, REQUESTS_TOPIC, {
        event: EventTypes.EmergencyRequestCancelled,
        version: 1,
        aggregateId: found.id,
        payload: { requestId: found.id },
      });
    }
    return { status: result.status };
  }

  async listPublicNumbers() {
    const rows = await this.prisma
      .unscoped()
      .emergencyNumber.findMany({
        where: { public: true },
        orderBy: { purpose: 'asc' },
        select: { country: true, purpose: true, label: true, phone: true, hours: true },
      });
    const seeded = rows.length > 0;
    const fallbacks = defaultNumbersFor('KE').filter(
      (fb) => !rows.some((r) => r.purpose === fb.purpose && r.country === fb.country),
    );
    const numbers = seeded
      ? rows.map((r) => ({
          country: r.country,
          purpose: r.purpose,
          label: r.label,
          phone: r.phone,
          hours: r.hours ?? null,
        }))
      : [...fallbacks];
    return { numbers, source: seeded ? 'reference' : 'default' };
  }

  async getPublicNotice() {
    const now = new Date();
    const notice = await this.prisma.unscoped().publicNotice.findFirst({
      where: {
        active: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      orderBy: { startsAt: 'desc' },
    });
    if (!notice) {
      return {
        notice: {
          title: 'Emergency services are available',
          message:
            'Emergency help requests are routed to the listed facilities. In immediate danger, call your national emergency number.',
          severity: 'INFO',
        },
      };
    }
    return {
      notice: {
        title: notice.title,
        message: notice.message,
        severity: notice.severity,
        startsAt: notice.startsAt.toISOString(),
        endsAt: notice.endsAt?.toISOString() ?? null,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Staff inbox
  // ---------------------------------------------------------------------------

  async listRequests(query: ListEmergencyRequestsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const { page, limit } = paginate(query);
    const where: Prisma.EmergencyRequestWhereInput = { organizationId };
    if (query.status && REQUEST_STATUSES.includes(query.status)) {
      where.status = query.status;
    }
    if (query.branchId) {
      await this.ensureBranch(organizationId, query.branchId);
      where.branchId = query.branchId;
    }
    const db = this.prisma.tenantFor(organizationId);
    const [total, rows] = await Promise.all([
      db.emergencyRequest.count({ where }),
      db.emergencyRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { items: rows.map((r) => this.toStaffView(r)), meta: pageOf([], total, page, limit).meta };
  }

  async getRequest(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const [row, events] = await Promise.all([
      db.emergencyRequest.findFirst({ where: { id, organizationId } }),
      db.emergencyRequestEvent.findMany({
        where: { requestId: id, organizationId },
        orderBy: { occurredAt: 'asc' },
      }),
    ]);
    if (!row) throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Request not found' });
    return {
      item: this.toStaffView(row),
      events: events.map((e) => ({
        type: e.type,
        level: e.level ?? null,
        actor: e.actor,
        occurredAt: e.occurredAt,
      })),
    };
  }

  async acknowledgeRequest(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const request = await this.txRunner.run(
      (ctx) => this.transitionRequest(ctx, organizationId, actorId, id, 'ACKNOWLEDGED'),
      { organizationId },
    );
    this.realtime.publish(organizationId, REQUESTS_TOPIC, {
      event: EventTypes.EmergencyRequestAcknowledged,
      version: 1,
      aggregateId: id,
      payload: { requestId: id },
    });
    return { item: request };
  }

  async respondRequest(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const request = await this.txRunner.run(
      (ctx) => this.transitionRequest(ctx, organizationId, actorId, id, 'RESPONDING'),
      { organizationId },
    );
    this.realtime.publish(organizationId, REQUESTS_TOPIC, {
      event: EventTypes.EmergencyRequestResponding,
      version: 1,
      aggregateId: id,
      payload: { requestId: id },
    });
    return { item: request };
  }

  async closeRequest(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const request = await this.txRunner.run(
      (ctx) => this.transitionRequest(ctx, organizationId, actorId, id, 'CLOSED'),
      { organizationId },
    );
    this.realtime.publish(organizationId, REQUESTS_TOPIC, {
      event: EventTypes.EmergencyRequestClosed,
      version: 1,
      aggregateId: id,
      payload: { requestId: id },
    });
    return { item: request };
  }

  async noteRequest(id: string, input: StaffNoteDto) {
    const organizationId = this.tenantContext.requireOrg();
    const request = await this.txRunner.run(
      async (ctx: TxContext) => {
        const current = await ctx.db.emergencyRequest.findFirst({
          where: { id, organizationId },
          select: { id: true },
        });
        if (!current) throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Request not found' });
        await ctx.db.emergencyRequest.update({
          where: { id },
          data: { staffNoteEnc: this.encryption.encrypt(input.note) },
        });
        await ctx.db.auditLog.create({
          data: {
            id: newId(),
            organizationId,
            action: 'emergency_request.note_added',
            resource: 'emergency_request',
            resourceId: id,
            newState: {},
          },
        });
        return this.toStaffView(
          await ctx.db.emergencyRequest.findFirstOrThrow({ where: { id, organizationId } }),
        );
      },
      { organizationId },
    );
    return { item: request };
  }

  // ---------------------------------------------------------------------------
  // Intake settings & escalation chain (branch-scoped)
  // ---------------------------------------------------------------------------

  async getPolicy(forBranchId?: string) {
    const branchId = await this.resolveBranchId(forBranchId);
    const organizationId = this.tenantContext.requireOrg();
    const policy = await this.prisma
      .tenantFor(organizationId)
      .emergencyIntakePolicy.findFirst({ where: { branchId, organizationId } });
    return {
      branchId,
      policy: {
        enabled: policy?.enabled ?? false,
        autoEscalate: policy?.autoEscalate ?? true,
        requireDescription: policy?.requireDescription ?? false,
        allowAnonymousCaller: policy?.allowAnonymousCaller ?? false,
        levelSeconds: policy?.levelSeconds ? parseLevelSeconds(policy.levelSeconds) : [120, 300, 900],
        depth: escalationDepth(policy?.levelSeconds ?? undefined),
        emergencyPhone: policy?.emergencyPhone ?? null,
        updatedAt: policy?.updatedAt ?? null,
        version: policy?.version ?? 0,
      },
    };
  }

  async updatePolicy(input: IntakePolicyUpdateDto, forBranchId?: string) {
    const branchId = await this.resolveBranchId(forBranchId);
    const organizationId = this.tenantContext.requireOrg();
    await this.ensureBranch(organizationId, branchId);

    const policy = await this.txRunner.run(
      async (ctx: TxContext) => {
        const existing = await ctx.db.emergencyIntakePolicy.findFirst({
          where: { branchId, organizationId },
        });
        const levelSeconds = input.levelSeconds ?? (existing?.levelSeconds ?? undefined);
        const data = {
          enabled: input.enabled ?? existing?.enabled ?? false,
          autoEscalate: input.autoEscalate ?? existing?.autoEscalate ?? true,
          requireDescription: input.requireDescription ?? existing?.requireDescription ?? false,
          allowAnonymousCaller: input.allowAnonymousCaller ?? existing?.allowAnonymousCaller ?? false,
          emergencyPhone:
            input.emergencyPhone !== undefined ? input.emergencyPhone : (existing?.emergencyPhone ?? null),
          levelSeconds: levelSeconds ?? [120, 300, 900],
        };
        const saved = await ctx.db.emergencyIntakePolicy.upsert({
          where: { organizationId_branchId: { organizationId, branchId } },
          create: { id: newId(), organizationId, branchId, ...data },
          update: { ...data, version: { increment: 1 } },
        });
        await ctx.db.auditLog.create({
          data: {
            id: newId(),
            organizationId,
            action: 'emergency_intake_policy.updated',
            resource: 'emergency_intake_policy',
            resourceId: saved.id,
            newState: { branchId, enabled: data.enabled, autoEscalate: data.autoEscalate },
          },
        });
        return saved;
      },
      { organizationId },
    );
    return {
      branchId,
      policy: {
        enabled: policy.enabled,
        autoEscalate: policy.autoEscalate,
        requireDescription: policy.requireDescription,
        allowAnonymousCaller: policy.allowAnonymousCaller,
        levelSeconds: parseLevelSeconds(policy.levelSeconds),
        depth: escalationDepth(policy.levelSeconds),
        emergencyPhone: policy.emergencyPhone,
        updatedAt: policy.updatedAt,
        version: policy.version,
      },
    };
  }

  async listContacts(forBranchId?: string) {
    const branchId = await this.resolveBranchId(forBranchId);
    const organizationId = this.tenantContext.requireOrg();
    const rows = await this.prisma
      .tenantFor(organizationId)
      .emergencyContact.findMany({
        where: { branchId, organizationId },
        orderBy: { order: 'asc' },
      });
    return {
      branchId,
      contacts: rows.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        role: c.role,
        order: c.order,
        active: c.active,
        notes: c.notes ?? null,
        version: c.version,
      })),
    };
  }

  async upsertContact(input: EmergencyContactUpsertDto, forBranchId?: string) {
    const branchId = await this.resolveBranchId(forBranchId);
    const organizationId = this.tenantContext.requireOrg();
    await this.ensureBranch(organizationId, branchId);

    await this.txRunner.run(
      async (ctx: TxContext) => {
        const existing = await ctx.db.emergencyContact.findFirst({
          where: { branchId, organizationId, order: input.order },
        });
        const id = existing?.id ?? newId();
        const data = {
          name: input.name,
          phone: input.phone,
          role: input.role?.trim() || 'Responder',
          notes: input.notes ?? null,
          active: existing?.active ?? true,
        };
        if (existing) {
          await ctx.db.emergencyContact.update({
            where: { id },
            data: { ...data, version: { increment: 1 } },
          });
        } else {
          await ctx.db.emergencyContact.create({
            data: { id, organizationId, branchId, order: input.order, ...data },
          });
        }
        await ctx.db.auditLog.create({
          data: {
            id: newId(),
            organizationId,
            action: 'emergency_contact.upserted',
            resource: 'emergency_contact',
            resourceId: id,
            newState: { branchId, name: input.name, order: input.order },
          },
        });
      },
      { organizationId },
    );
    return { ok: true };
  }

  async patchContact(id: string, input: EmergencyContactPatchDto, forBranchId?: string) {
    const branchId = await this.resolveBranchId(forBranchId);
    const organizationId = this.tenantContext.requireOrg();
    await this.txRunner.run(
      async (ctx: TxContext) => {
        const existing = await ctx.db.emergencyContact.findFirst({
          where: { id, organizationId, branchId },
        });
        if (!existing) throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Contact not found' });
        await ctx.db.emergencyContact.update({
          where: { id },
          data: { ...input, version: { increment: 1 } },
        });
        await ctx.db.auditLog.create({
          data: {
            id: newId(),
            organizationId,
            action: 'emergency_contact.updated',
            resource: 'emergency_contact',
            resourceId: id,
            newState: { branchId, name: input.name ?? existing.name },
          },
        });
      },
      { organizationId },
    );
    return { ok: true };
  }

  async deleteContact(id: string, forBranchId?: string) {
    const branchId = await this.resolveBranchId(forBranchId);
    const organizationId = this.tenantContext.requireOrg();
    await this.txRunner.run(
      async (ctx: TxContext) => {
        const existing = await ctx.db.emergencyContact.findFirst({
          where: { id, organizationId, branchId },
        });
        if (!existing) throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Contact not found' });
        await ctx.db.emergencyContact.delete({ where: { id } });
        await ctx.db.auditLog.create({
          data: {
            id: newId(),
            organizationId,
            action: 'emergency_contact.deleted',
            resource: 'emergency_contact',
            resourceId: id,
            newState: { branchId },
          },
        });
      },
      { organizationId },
    );
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Platform reference data (national numbers / public notices)
  // ---------------------------------------------------------------------------

  async listNumbers() {
    const rows = await this.prisma
      .unscoped()
      .emergencyNumber.findMany({ orderBy: [{ country: 'asc' }, { purpose: 'asc' }] });
    return {
      numbers: rows.map((r) => ({
        id: r.id,
        country: r.country,
        purpose: r.purpose,
        label: r.label,
        phone: r.phone,
        hours: r.hours ?? null,
        public: r.public,
      })),
    };
  }

  async setNumber(input: EmergencyNumberUpsertDto, id?: string) {
    if (id) {
      const existing = await this.prisma.unscoped().emergencyNumber.findUnique({ where: { id } });
      if (!existing) throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Number not found' });
      await this.prisma
        .unscoped()
        .emergencyNumber.update({ where: { id }, data: { ...input } });
      return { ok: true };
    }
    const dup = await this.prisma
      .unscoped()
      .emergencyNumber.findFirst({ where: { country: input.country, purpose: input.purpose } });
    if (dup) throw new AppError({ code: ErrorCodes.CONFLICT, message: 'A number for that country/purpose already exists.' });
    await this.prisma
      .unscoped()
      .emergencyNumber.create({ data: { id: newId(), ...input } });
    return { ok: true };
  }

  async deleteNumber(id: string) {
    const existing = await this.prisma.unscoped().emergencyNumber.findUnique({ where: { id } });
    if (!existing) throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Number not found' });
    await this.prisma.unscoped().emergencyNumber.delete({ where: { id } });
    return { ok: true };
  }

  async listNotices() {
    const rows = await this.prisma
      .unscoped()
      .publicNotice.findMany({ orderBy: { startsAt: 'desc' } });
    return {
      notices: rows.map((r) => ({
        id: r.id,
        title: r.title,
        message: r.message,
        severity: r.severity,
        active: r.active,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt?.toISOString() ?? null,
      })),
    };
  }

  async setNotice(input: PublicNoticeUpsertDto, id?: string) {
    if (id) {
      const existing = await this.prisma.unscoped().publicNotice.findUnique({ where: { id } });
      if (!existing) throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Notice not found' });
      await this.prisma.unscoped().publicNotice.update({ where: { id }, data: { ...input } });
      return { ok: true };
    }
    await this.prisma.unscoped().publicNotice.create({ data: { id: newId(), ...input } });
    return { ok: true };
  }

  async deleteNotice(id: string) {
    const existing = await this.prisma.unscoped().publicNotice.findUnique({ where: { id } });
    if (!existing) throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Notice not found' });
    await this.prisma.unscoped().publicNotice.delete({ where: { id } });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Escalation worker (BullMQ). The guarded updateMany makes each level exactly
  // once regardless of retries/delivery overlap; acknowledgement or a terminal
  // state stops further progress without needing to delete pending jobs.
  // ---------------------------------------------------------------------------

  async attemptEscalation(
    requestId: string,
    organizationId: string,
    level: number,
  ): Promise<'advanced' | 'noop'> {
    const db = this.prisma.tenantFor(organizationId);
    const request = await db.emergencyRequest.findFirst({
      where: { id: requestId, organizationId },
      select: { id: true, status: true, branchId: true, escalationLevel: true },
    });
    if (!request || request.status !== 'RECEIVED' || request.escalationLevel >= level) {
      return 'noop';
    }
    const policy = await db.emergencyIntakePolicy.findFirst({
      where: { branchId: request.branchId, organizationId },
      select: { enabled: true, autoEscalate: true, levelSeconds: true },
    });
    if (!policy?.enabled || !policy.autoEscalate) return 'noop';
    const levels = parseLevelSeconds(policy.levelSeconds);
    if (level > levels.length) return 'noop';

    const won = await db.emergencyRequest.updateMany({
      where: { id: requestId, organizationId, escalationLevel: level - 1, status: 'RECEIVED' },
      data: { escalationLevel: level, status: 'ESCALATED' },
    });
    if (won.count !== 1) return 'noop';

    await this.txRunner.run(
      async (ctx: TxContext) => {
        ctx.emit({
          type: EventTypes.EmergencyRequestEscalated,
          aggregateType: 'emergency_request',
          aggregateId: requestId,
          payload: { requestId, level },
        });
        await ctx.db.emergencyRequestEvent.create({
          data: {
            id: newId(),
            organizationId,
            requestId,
            type: 'ESCALATED',
            level,
            actor: 'SYSTEM',
            payload: { level },
          },
        });
        await ctx.db.auditLog.create({
          data: {
            id: newId(),
            organizationId,
            action: `emergency_request.escalated_level_${level}`,
            resource: 'emergency_request',
            resourceId: requestId,
            newState: { level },
          },
        });
      },
      { organizationId },
    );

    if (level < levels.length) {
      await this.scheduleEscalation(requestId, organizationId, level + 1);
    }
    return 'advanced';
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Applies a lifecycle transition and exactly once records its event. A second
   * call for the same transition (idempotent retry) leaves the row untouched.
   */
  private async transitionRequest(
    ctx: TxContext,
    organizationId: string,
    actorId: string,
    id: string,
    to: 'ACKNOWLEDGED' | 'RESPONDING' | 'CLOSED',
  ): Promise<RequestView> {
    const current = await ctx.db.emergencyRequest.findFirst({ where: { id, organizationId } });
    if (!current) throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Request not found' });
    if (TERMINAL.includes(current.status)) {
      throw new AppError({ code: ErrorCodes.CONFLICT, message: 'Request is already closed or cancelled.' });
    }
    const timestamp = new Date();

    if (to === 'ACKNOWLEDGED' && !current.acknowledgedAt) {
      await ctx.db.emergencyRequest.update({
        where: { id },
        data: { status: 'ACKNOWLEDGED', acknowledgedAt: timestamp, acknowledgedById: actorId },
      });
      ctx.emit({
        type: EventTypes.EmergencyRequestAcknowledged,
        aggregateType: 'emergency_request',
        aggregateId: id,
        payload: { requestId: id },
      });
      await this.recordEvent(ctx, organizationId, id, 'ACKNOWLEDGED', actorId);
    } else if (to === 'RESPONDING' && current.status !== 'RESPONDING') {
      await ctx.db.emergencyRequest.update({
        where: { id },
        data: { status: 'RESPONDING', respondedAt: timestamp, respondedById: actorId },
      });
      ctx.emit({
        type: EventTypes.EmergencyRequestResponding,
        aggregateType: 'emergency_request',
        aggregateId: id,
        payload: { requestId: id },
      });
      await this.recordEvent(ctx, organizationId, id, 'RESPONDING', actorId, current.escalationLevel);
    } else if (to === 'CLOSED' && current.status !== 'CLOSED') {
      await ctx.db.emergencyRequest.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: timestamp, closedById: actorId },
      });
      ctx.emit({
        type: EventTypes.EmergencyRequestClosed,
        aggregateType: 'emergency_request',
        aggregateId: id,
        payload: { requestId: id },
      });
      await this.recordEvent(ctx, organizationId, id, 'CLOSED', actorId, current.escalationLevel);
    }

    return this.toStaffView(
      await ctx.db.emergencyRequest.findFirstOrThrow({ where: { id, organizationId } }),
    );
  }

  private async recordEvent(
    ctx: TxContext,
    organizationId: string,
    requestId: string,
    type: 'ACKNOWLEDGED' | 'RESPONDING' | 'CLOSED',
    actorId?: string | null,
    level = 0,
  ) {
    await ctx.db.emergencyRequestEvent.create({
      data: {
        id: newId(),
        organizationId,
        requestId,
        type,
        level,
        actor: actorId ? 'STAFF' : 'SYSTEM',
        actorId: actorId ?? null,
      },
    });
  }

  private async scheduleEscalation(requestId: string, organizationId: string, level: number) {
    const db = this.prisma.tenantFor(organizationId);
    const request = await db.emergencyRequest.findFirst({
      where: { id: requestId, organizationId },
      select: { branchId: true },
    });
    if (!request) return;
    const policy = await db.emergencyIntakePolicy.findFirst({
      where: { branchId: request.branchId, organizationId },
      select: { levelSeconds: true, autoEscalate: true },
    });
    if (!policy?.autoEscalate) return;
    const levels = parseLevelSeconds(policy.levelSeconds);
    if (level > levels.length) return;
    const delay = levelDelayMs(levels[level - 1] ?? levels[0] ?? 5000);
    await this.escalationQueue.add(
      ESCALATION_JOB,
      { requestId, organizationId, level },
      { jobId: `${requestId}-${level}`, delay, removeOnComplete: 500, removeOnFail: 200 },
    );
  }

  private async nextRequestSequence(ctx: TxContext, organizationId: string): Promise<bigint> {
    const key = EMERGENCY_REQUEST_COUNTER_KEY;
    const rows = await ctx.db.$queryRaw<Array<{ value: bigint }>>`
      INSERT INTO "counters" ("id", "organizationId", "key", "value", "updatedAt")
      VALUES (${`cnt-${organizationId}-${key}`}, ${organizationId}, ${key}, 1, NOW())
      ON CONFLICT ("organizationId", "key")
      DO UPDATE SET "value" = "counters"."value" + 1, "updatedAt" = NOW()
      RETURNING "value"
    `;
    return rows[0]?.value ?? 1n;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async resolveBranchId(forBranchId?: string): Promise<string> {
    const organizationId = this.tenantContext.requireOrg();
    if (forBranchId) {
      await this.ensureBranch(organizationId, forBranchId);
      return forBranchId;
    }
    if (this.tenantContext.scope.branchId) {
      await this.ensureBranch(organizationId, this.tenantContext.scope.branchId);
      return this.tenantContext.scope.branchId;
    }
    const first = await this.prisma
      .tenantFor(organizationId)
      .branch.findFirst({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
    if (!first) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'No branch in this organization.',
        silent: true,
      });
    }
    return first.id;
  }

  private async ensureBranch(organizationId: string, branchId: string): Promise<void> {
    const branch = await this.prisma
      .tenantFor(organizationId)
      .branch.findFirst({ where: { id: branchId, organizationId }, select: { id: true } });
    if (!branch) throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Branch not found' });
  }

  private toStaffView(row: EmergencyRequest): RequestView {
    return {
      id: row.id,
      referenceNumber: row.referenceNumber,
      status: row.status,
      escalationLevel: row.escalationLevel,
      branchId: row.branchId,
      source: row.source,
      callerName: row.callerNameEnc ? this.encryption.decrypt(row.callerNameEnc) : null,
      callerPhone: row.callerPhoneEnc ? this.encryption.decrypt(row.callerPhoneEnc) : (row.callerPhoneIndex ?? null),
      description: row.descriptionEnc ? this.encryption.decrypt(row.descriptionEnc) : null,
      location: {
        lat: row.locationLat,
        lng: row.locationLng,
        landmark: row.landmarkEnc ? this.encryption.decrypt(row.landmarkEnc) : null,
      },
      staffNote: row.staffNoteEnc ? this.encryption.decrypt(row.staffNoteEnc) : null,
      acknowledgedAt: row.acknowledgedAt,
      respondedAt: row.respondedAt,
      closedAt: row.closedAt,
      cancelledAt: row.cancelledAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}