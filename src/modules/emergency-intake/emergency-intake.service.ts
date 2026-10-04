import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import type { EmergencyRequest, EmergencyRequestStatus } from '@prisma/client';
import { ENV, type Env } from '../../config/config.module';
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
  escalationDepth,
  formatEmergencyRequestReference,
  generateTrackingToken,
  levelDelayMs,
  normalizePhone,
  parseLevelSeconds,
} from './domain/escalation';
import { defaultNumbersFor } from './domain/numbers';
import { EMERGENCY_CONSENT_VERSION } from './domain/consent';
import {
  callerAction,
  callerActionMessage,
  callerStatusLabel,
  emergencyCallNowError,
  EMERGENCY_DISCLAIMER,
  isTerminalStatus,
  stopsEscalation,
} from './domain/caller-copy';
import {
  evaluateIntakeReadiness,
  intakeReadinessMessages,
} from './domain/intake-readiness';
import { isOnCallAt, parseOnCallWindows } from './domain/on-call-window';
import {
  CancelEmergencyRequestDto,
  EmergencyContactPatchDto,
  EmergencyContactUpsertDto,
  EmergencyNumberUpsertDto,
  IntakePolicyUpdateDto,
  LinkArrivalVisitDto,
  ListEmergencyRequestsQueryDto,
  MergeRequestDto,
  PublicNoticeUpsertDto,
  RecordCallbackDto,
  SetRequestStatusDto,
  StaffNoteDto,
  SubmitEmergencyRequestDto,
  TrackEmergencyRequestDto,
  UpdateCallerEmergencyRequestDto,
} from './dto/emergency-intake.dto';

export const ESCALATION_QUEUE = 'emergency-escalation';
export const ESCALATION_JOB = 'escalate';
export const MAINTENANCE_JOB = 'maintenance';
export const REQUESTS_TOPIC = 'emergency-requests';

const REQUEST_STATUSES: EmergencyRequestStatus[] = [
  'RECEIVED',
  'ACKNOWLEDGED',
  'CONTACTED',
  'RESPONDING',
  'ESCALATED',
  'REDIRECTED',
  'UNREACHABLE',
  'DUPLICATE',
  'NOT_ACTIONABLE',
  'CLOSED',
  'CANCELLED',
];
/**
 * Closed or cancelled: the two states a facility/actor explicitly finished with a
 * close stamp. The other four finished dispositions (redirected, unreachable, not
 * actionable, duplicate) are tracked in `domain/caller-copy.ts` because they mean
 * different things to a caller, and they cannot be reopened
 * (`isTerminalStatus`).
 */
const TERMINAL: readonly EmergencyRequestStatus[] = ['CLOSED', 'CANCELLED'];

/**
 * Every status the facility is finished with, whether or not it carries a close
 * stamp. This is the set the retention sweep reaps: a request in one of these
 * states can never be reopened, so holding the caller's encrypted name, phone,
 * description and landmark past the retention window serves no audit purpose —
 * the events and reference number survive anonymization (ADR-055).
 *
 * `dispositionAt` is written when a request enters one of these, so the sweep can
 * key off a single timestamp instead of guessing from three nullable columns.
 */
const DISPOSITIONS: readonly EmergencyRequestStatus[] = [
  'CLOSED',
  'CANCELLED',
  'UNREACHABLE',
  'REDIRECTED',
  'NOT_ACTIONABLE',
  'DUPLICATE',
];

/** Statuses a caller can no longer edit or withdraw. */
const CALLER_LOCKED: readonly EmergencyRequestStatus[] = [
  'RESPONDING',
  'CLOSED',
  'CANCELLED',
  'NOT_ACTIONABLE',
  'REDIRECTED',
  'UNREACHABLE',
  'DUPLICATE',
];

/**
 * How long a caller may poll and update their request before the token stops
 * resolving the row. The row and its audit history are retained far longer (see
 * EMERGENCY_RETENTION_DAYS); this only bounds the anonymous bearer capability,
 * since a tracking token is a long-lived, forwardable secret.
 */
const TRACKING_TOKEN_TTL_DAYS = 30;

/**
 * ED arrivals attached to a request, for the staff view. Selected separately so
 * the list/read paths do not pay for it.
 */
const ARRIVAL_INCLUDE = {
  linkedArrivals: { select: { id: true, visitNumber: true, arrivedAt: true } },
} satisfies Prisma.EmergencyRequestInclude;

/** Audit payload for a write to the cross-tenant emergency reference tables. */
interface ReferenceAuditEntry {
  action: string;
  resource: string;
  resourceId: string;
  previous?: Record<string, unknown>;
  next?: Record<string, unknown>;
}

/** Field NAMES a caller changed — never the values (they are caller PII). */
function callerUpdateFields(input: UpdateCallerEmergencyRequestDto): string[] {
  const fields: string[] = [];
  if (input.callerPhone !== undefined) fields.push('callerPhone');
  if (input.callerName !== undefined) fields.push('callerName');
  if (input.location?.lat !== undefined || input.location?.lng !== undefined) {
    fields.push('location');
  }
  if (input.location?.landmark !== undefined) fields.push('landmark');
  if (input.preferredContact !== undefined) fields.push('preferredContact');
  if (input.consentVersion !== undefined) fields.push('consentVersion');
  return fields;
}

export interface RequestView {
  id: string;
  referenceNumber: string;
  status: string;
  statusLabel: string;
  escalationLevel: number;
  branchId: string;
  source: string;
  callerName: string | null;
  callerPhone: string | null;
  description: string | null;
  callerCategory: string;
  forSelf: boolean;
  peopleCount: number;
  preferredContact: string;
  consentVersion: string | null;
  consentAt: Date | null;
  location: {
    lat: number | null;
    lng: number | null;
    landmark: string | null;
    accuracyM: number | null;
    source: string;
  };
  staffNote: string | null;
  flagged: boolean;
  flagReason: string | null;
  mergedCount: number;
  mergedIntoId: string | null;
  firstCallbackAt: Date | null;
  linkedArrivals: Array<{ id: string; visitNumber: string; arrivedAt: Date }>;
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
    @Inject(ENV) private readonly env: Env,
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
    // Every "we cannot take this" path returns CALL_NOW plus national numbers
    // rather than a bare refusal: the caller has told us they need help.
    const notAccepting = () =>
      emergencyCallNowError({
        message:
          'This facility is not currently accepting emergency help requests. Call the facility or your national emergency number now.',
        details: { facilityPhone: projection.phone ?? null },
      });

    if (!projection.emergencyIntakeEnabled) {
      throw notAccepting();
    }
    // A published listing must be resolvable to its tenant branch to write the
    // request; if the projection has no source (imported feed), fall through to
    // the call-them instead path rather than erroring.
    if (!projection.sourceOrganizationId || !projection.sourceBranchId) {
      throw notAccepting();
    }
    const organizationId = projection.sourceOrganizationId;
    const branchId = projection.sourceBranchId;

    // Defence in depth for branches enabled before the readiness guard existed,
    // and for a projection flag left on after contacts were removed.
    await this.assertBranchIntakeReady(organizationId, branchId);

    const { lat, lng, landmark, accuracyM } = input.location ?? {};
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

    // Idempotency: a retry or double-tap that carries the same client key
    // returns the original request rather than paging a second team.
    if (input.clientRequestId) {
      const existing = await this.prisma
        .tenantFor(organizationId)
        .emergencyRequest.findFirst({
          where: {
            organizationId,
            branchId,
            clientRequestId: input.clientRequestId,
          },
          select: { id: true, referenceNumber: true },
        });
      if (existing) {
        return {
          request: {
            id: existing.id,
            referenceNumber: existing.referenceNumber,
            // The token was only ever returned on the first call, so a retry
            // cannot be given a fresh one; say so rather than invent one.
            trackingToken: null,
            trackingTokenAlreadyIssued: true,
            duplicate: true,
          },
          contact: projection.phone ?? null,
          consentVersion: EMERGENCY_CONSENT_VERSION,
          disclaimer: EMERGENCY_DISCLAIMER,
        };
      }
    }

    // ADR-043: collapse repeat submissions from the same normalized phone while
    // the earlier request is still open and inside the dedupe window. Unlike
    // HTTP idempotency keys (the interceptor only guards tenant-scoped routes)
    // this guards the anonymous surface at the payload level and prevents a
    // retry or double-tap from creating a second incident. The repeat is
    // APPENDED to the original request's history rather than dropped, so staff
    // can see the caller submitted again.
    if (callerPhoneIndex !== null) {
      const recent = await this.prisma
        .tenantFor(organizationId)
        .emergencyRequest.findFirst({
          where: {
            organizationId: organizationId,
            branchId: branchId,
            callerPhoneIndex,
            status: { in: ['RECEIVED', 'ESCALATED'] },
            createdAt: {
              gte: new Date(Date.now() - this.env.EMERGENCY_DEDUPE_SECONDS * 1000),
            },
          },
          select: { id: true, referenceNumber: true },
          orderBy: { createdAt: 'desc' },
        });
      if (recent) {
        await this.appendRepeatSubmission(organizationId, recent.id, input.clientRequestId);
        this.realtime.publish(organizationId, REQUESTS_TOPIC, {
          event: EventTypes.EmergencyRequestDuplicate,
          version: 1,
          aggregateId: recent.id,
          payload: { requestId: recent.id, referenceNumber: recent.referenceNumber },
        });
        return {
          request: {
            id: recent.id,
            referenceNumber: recent.referenceNumber,
            trackingToken: null,
            trackingTokenAlreadyIssued: true,
            duplicate: true,
          },
          contact: projection.phone ?? null,
          consentVersion: EMERGENCY_CONSENT_VERSION,
          disclaimer: EMERGENCY_DISCLAIMER,
        };
      }
    }

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
            trackingTokenExpiresAt: new Date(Date.now() + TRACKING_TOKEN_TTL_DAYS * 86_400_000),
            clientRequestId: input.clientRequestId ?? null,
            status: 'RECEIVED',
            escalationLevel: 0,
            source: 'PUBLIC',
            callerNameEnc: input.callerName ? this.encryption.encrypt(input.callerName) : null,
            callerPhoneEnc: input.callerPhone ? this.encryption.encrypt(input.callerPhone) : null,
            callerPhoneIndex,
            descriptionEnc: input.description ? this.encryption.encrypt(input.description) : null,
            callerCategory: input.category ?? 'NOT_SURE',
            forSelf: input.forSelf ?? true,
            peopleCount: input.peopleCount ?? 1,
            preferredContact: input.preferredContact ?? 'PHONE',
            locale: input.locale ?? null,
            consentVersion: input.consentVersion ?? null,
            consentAt: input.consentVersion ? new Date() : null,
            locationLat: lat ?? null,
            locationLng: lng ?? null,
            // Accuracy and provenance are recorded so staff can judge how much to
            // trust the point. The coordinates stay approximate: never a home
            // address, and never an address geocoded from them.
            locationAccuracyM: accuracyM ?? null,
            locationSource: lat !== undefined && lng !== undefined ? 'DEVICE_GPS' : 'NONE',
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
        // The caller needs this before they close the page, or they cannot poll.
        tokenExpiresAt: request.trackingTokenExpiresAt,
      },
      contact: projection.phone ?? null,
      consentVersion: EMERGENCY_CONSENT_VERSION,
      disclaimer: EMERGENCY_DISCLAIMER,
    };
  }

  /**
   * Records a repeat anonymous submission against the original request.
   *
   * Deliberately payload-free: the repeat may contain a different phone number
   * or location, and this is an append-only audit trail, not a second copy of
   * caller PII. The repeat's own details are discarded; the caller can correct
   * the original through the token-scoped update endpoint instead.
   */
  private async appendRepeatSubmission(
    organizationId: string,
    requestId: string,
    clientRequestId?: string,
  ): Promise<void> {
    await this.txRunner.run(
      async (ctx: TxContext) => {
        await ctx.db.emergencyRequest.update({
          where: { id: requestId },
          data: { mergedCount: { increment: 1 } },
        });
        await ctx.db.emergencyRequestEvent.create({
          data: {
            id: newId(),
            organizationId,
            requestId,
            type: 'DUPLICATE',
            actor: 'CALLER',
            // Whether the retry carried an idempotency key tells staff whether
            // the frontend retried a known request or the caller submitted again.
            payload: { resubmitted: true, hadClientRequestId: Boolean(clientRequestId) },
          },
        });
      },
      { organizationId },
    );
  }

  /**
   * Refuses anonymous intake when the branch cannot actually page anyone
   * (brief §6.15). Called on submit as defence in depth: enabling intake is
   * guarded, but a policy row or its contacts can be edited afterwards.
   */
  private async assertBranchIntakeReady(organizationId: string, branchId: string): Promise<void> {
    const readiness = await this.readinessFor(organizationId, branchId);
    if (!readiness.ready) {
      throw emergencyCallNowError({
        message:
          'This facility cannot accept an online request right now. Call the facility or your national emergency number now.',
        details: {
          facilityIntakeReady: false,
          reasons: readiness.reasons,
          messages: intakeReadinessMessages(readiness.reasons),
        },
      });
    }
  }

  /** Intake readiness for a branch: contacts, chain length, escalation on/off. */
  private async readinessFor(organizationId: string, branchId: string) {
    const db = this.prisma.tenantFor(organizationId);
    const [policy, contacts] = await Promise.all([
      db.emergencyIntakePolicy.findFirst({ where: { organizationId, branchId } }),
      db.emergencyContact.findMany({
        where: { organizationId, branchId },
        select: { active: true, onCall: true, phone: true, userId: true, onCallWindows: true },
      }),
    ]);
    const at = new Date();
    return evaluateIntakeReadiness({
      enabled: policy?.enabled ?? false,
      autoEscalate: policy?.autoEscalate ?? true,
      levelSeconds: parseLevelSeconds(policy?.levelSeconds ?? undefined),
      contacts: contacts.map((c) => ({
        active: c.active,
        onCall: c.onCall,
        // A contact resolves to a phone if it carries its own number or points
        // at a staff user (whose phone is the user's).
        hasChannel: Boolean(c.phone) || Boolean(c.userId),
        onShiftAt: (instant: Date) => isOnCallAt(c.onCallWindows, instant),
      })),
      at,
    });
  }

  /**
   * Caller corrections to an open request (brief §6.15). Same token as tracking,
   * so a caller who mistyped a number or has moved can fix it without a phone
   * call and without opening a second incident.
   */
  async updateByCaller(input: UpdateCallerEmergencyRequestDto) {
    const tokenHash = this.hashToken(input.token);
    const found = await this.prisma.unscoped().emergencyRequest.findFirst({
      where: { trackingTokenHash: tokenHash },
      select: { id: true, organizationId: true, status: true, trackingTokenExpiresAt: true },
    });
    if (!found || !this.tokenIsLive(found)) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'No request found for that tracking token.',
        silent: true,
      });
    }

    if (CALLER_LOCKED.includes(found.status)) {
      throw new AppError({
        code: ErrorCodes.EMERGENCY_REQUEST_LOCKED,
        message:
          'This request can no longer be changed. Call the facility if the details you gave are now wrong.',
        silent: true,
      });
    }

    const { lat, lng, landmark, accuracyM } = input.location ?? {};
    if (input.location && (lat === undefined) !== (lng === undefined)) {
      throw new AppError({
        code: ErrorCodes.INVALID_COORDINATES,
        message: 'Both latitude and longitude are required together.',
        silent: true,
      });
    }

    await this.txRunner.run(
      async (ctx: TxContext) => {
        await ctx.db.emergencyRequest.update({
          where: { id: found.id },
          data: {
            callerPhoneEnc:
              input.callerPhone !== undefined ? this.encryption.encrypt(input.callerPhone) : undefined,
            callerPhoneIndex:
              input.callerPhone !== undefined ? normalizePhone(input.callerPhone) : undefined,
            callerNameEnc:
              input.callerName !== undefined
                ? this.encryption.encrypt(input.callerName)
                : undefined,
            locationLat: lat ?? undefined,
            locationLng: lng ?? undefined,
            locationAccuracyM: accuracyM ?? undefined,
            locationSource: lat !== undefined && lng !== undefined ? 'DEVICE_GPS' : undefined,
            landmarkEnc: landmark !== undefined ? this.encryption.encrypt(landmark) : undefined,
            preferredContact: input.preferredContact ?? undefined,
            consentVersion: input.consentVersion ?? undefined,
            consentAt: input.consentVersion ? new Date() : undefined,
          },
        });
        // Append-only record of what changed. Field NAMES only — the values are
        // caller PII and stay out of the event payload and the audit log.
        await ctx.db.emergencyRequestEvent.create({
          data: {
            id: newId(),
            organizationId: found.organizationId,
            requestId: found.id,
            type: 'CALLER_UPDATED',
            actor: 'CALLER',
            payload: { fields: callerUpdateFields(input) },
          },
        });
        ctx.emit({
          type: EventTypes.EmergencyRequestCallerUpdated,
          aggregateType: 'emergency_request',
          aggregateId: found.id,
          payload: { requestId: found.id },
        });
      },
      { organizationId: found.organizationId },
    );

    this.realtime.publish(found.organizationId, REQUESTS_TOPIC, {
      event: EventTypes.EmergencyRequestCallerUpdated,
      version: 1,
      aggregateId: found.id,
      payload: { requestId: found.id },
    });

    return {
      updated: true,
      status: found.status,
      statusLabel: callerStatusLabel(found.status),
      action: callerAction({
        status: found.status,
        escalationLevel: 0,
        acknowledgedAt: found.status !== 'RECEIVED' ? new Date() : null,
        respondedAt: null,
      }),
      message: callerActionMessage(
        callerAction({
          status: found.status,
          escalationLevel: 0,
          acknowledgedAt: found.status !== 'RECEIVED' ? new Date() : null,
          respondedAt: null,
        }),
      ),
    };
  }

  /**
   * A tracking token stops resolving once it expires. Retention is handled by
   * rewriting the hash to a `retired:<id>` sentinel, which can never match a real
   * SHA-256 digest, so the token lookup above already excludes retained rows.
   */
  private tokenIsLive(row: { trackingTokenExpiresAt?: Date | null }): boolean {
    if (!row.trackingTokenExpiresAt) return true;
    return row.trackingTokenExpiresAt.getTime() >= Date.now();
  }

  /** Caller tracking: the token hash resolves the request with no tenant reads. */
  async trackPublic(input: TrackEmergencyRequestDto) {
    const tokenHash = this.hashToken(input.token);
    const request = await this.prisma
      .unscoped()
      .emergencyRequest.findFirst({ where: { trackingTokenHash: tokenHash } });
    if (!request || !this.tokenIsLive(request)) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'No request found for that tracking token.',
        silent: true,
      });
    }
    const action = callerAction(request);
    const [facility, policy] = await Promise.all([
      this.prisma.unscoped().publicFacilityListing.findFirst({
        where: {
          sourceOrganizationId: request.organizationId,
          sourceBranchId: request.branchId,
        },
        select: { name: true, slug: true, phone: true },
      }),
      // Branch policy, cross-tenant by nature: it only holds facility-level
      // settings, never caller data.
      this.prisma
        .unscoped()
        .emergencyIntakePolicy.findFirst({
          where: { organizationId: request.organizationId, branchId: request.branchId },
          select: { emergencyPhone: true, serviceArea: true, autoReplyTemplate: true },
        }),
    ]);
    // The caller always gets a way to reach a human, whatever the request state.
    const numbers = await this.listPublicNumbers();
    return {
      referenceNumber: request.referenceNumber,
      receivedAt: request.createdAt,
      status: request.status,
      statusLabel: callerStatusLabel(request.status),
      action,
      message: callerActionMessage(action),
      level: request.escalationLevel,
      facility: {
        name: facility?.name ?? null,
        slug: facility?.slug ?? null,
        phone: policy?.emergencyPhone ?? facility?.phone ?? null,
      },
      serviceArea: policy?.serviceArea ?? null,
      guidance: policy?.autoReplyTemplate ?? null,
      numbers: numbers.numbers,
      numbersSource: numbers.source,
      disclaimer: EMERGENCY_DISCLAIMER,
      consentVersion: EMERGENCY_CONSENT_VERSION,
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
          // Help is already coming: withdrawing would be the dangerous outcome,
          // so this returns the same CALL_NOW framing as every other refusal.
          throw emergencyCallNowError({
            message:
              'A responder is already on the way for this request. Do not cancel — call the facility for updates instead.',
            details: { reason: 'RESPONDER_ASSIGNED' },
          });
        }
        if (TERMINAL.includes(current.status)) {
          return { status: current.status, already: true };
        }
        // A request the facility could not reach, redirected, or closed as not
        // actionable is no longer the caller's to withdraw.
        if (isTerminalStatus(current.status) && current.status !== 'CANCELLED') {
          throw new AppError({
            code: ErrorCodes.EMERGENCY_REQUEST_LOCKED,
            message:
              'The facility has already finished with this request. Call them if you still need help.',
            silent: true,
          });
        }
        await ctx.db.emergencyRequest.update({
          where: { id: found.id },
          data: { status: 'CANCELLED', cancelledAt: new Date(), dispositionAt: new Date() },
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
        // A retired number must never reach a caller: `active` is the switch the
        // brief describes for withdrawing one without losing its audit trail.
        where: { public: true, active: true },
        orderBy: { purpose: 'asc' },
        select: {
          country: true,
          purpose: true,
          label: true,
          phone: true,
          hours: true,
          verified: true,
          verifiedAt: true,
          channel: true,
          note: true,
        },
      });
    const seeded = rows.length > 0;
    // A missing reference row must not remove a number the caller needs, so the
    // built-in fallback fills any purpose the table does not cover.
    const fallbacks = defaultNumbersFor('KE').filter(
      (fb) => !rows.some((r) => r.purpose === fb.purpose && r.country === fb.country),
    );
    const numbers = [
      ...(seeded
        ? rows.map((r) => ({
            country: r.country,
            purpose: r.purpose,
            label: r.label,
            phone: r.phone,
            hours: r.hours ?? null,
            // Unverified is surfaced, not hidden: operators must confirm these
            // against their local authority, and so should anyone reading them.
            verified: r.verified,
            verifiedAt: r.verifiedAt ?? null,
            channel: r.channel,
            note: r.note ?? null,
          }))
        : []),
      ...fallbacks.map((fb) => ({
        country: fb.country,
        purpose: fb.purpose,
        label: fb.label,
        phone: fb.phone,
        hours: fb.hours ?? null,
        // Built-in defaults are reference values, not operator-verified data.
        verified: false,
        verifiedAt: null,
        channel: 'VOICE',
        note: 'Verify this number against your local authority before relying on it.',
      })),
    ];
    return {
      numbers,
      source: seeded ? 'reference' : 'default',
      disclaimer: EMERGENCY_DISCLAIMER,
      allVerified: numbers.every((n) => n.verified),
    };
  }

  /**
 * Active public service notice, or a safe default.
 *
 * A WARNING/CRITICAL notice always names the national emergency numbers as
 * their own block rather than only in prose: an operator trying to say "call
 * instead" must not be the only reason a caller has a number to hand.
 */
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
    const numbers = await this.listPublicNumbers();
    if (!notice) {
      return {
        notice: {
          title: 'Emergency services are available',
          message:
            'Emergency help requests are routed to the listed facilities. In immediate danger, call your national emergency number.',
          severity: 'INFO',
        },
        numbers: numbers.numbers,
        disclaimer: EMERGENCY_DISCLAIMER,
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
      // An active WARNING/CRITICAL notice is an operator saying "call instead",
      // so the numbers travel with it as structured data.
      ...(notice.severity === 'WARNING' || notice.severity === 'CRITICAL'
        ? { numbers: numbers.numbers, action: 'CALL_NOW' as const }
        : {}),
      disclaimer: EMERGENCY_DISCLAIMER,
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
    // Inbox triage: surface requests whose caller could not be reached.
    if (query.flagged !== undefined) {
      where.flagged = query.flagged;
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
      db.emergencyRequest.findFirst({ where: { id, organizationId }, include: ARRIVAL_INCLUDE }),
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

  /**
   * Records a callback attempt (brief §6.15).
   *
   * A failed first attempt flags the request so the inbox surfaces callers who
   * could not be reached — an unreachable caller is a safety problem, not just a
   * closed loop. A later successful attempt clears the flag: the caller was
   * reached, so the warning is no longer true.
   *
   * The caller's phone number is never written to the event payload or the audit
   * log; `firstCallbackAt` records that a human tried.
   */
  async recordCallback(id: string, input: RecordCallbackDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const request = await this.txRunner.run(
      async (ctx: TxContext) => {
        const current = await ctx.db.emergencyRequest.findFirst({ where: { id, organizationId } });
        if (!current) {
          throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Request not found' });
        }
        if (TERMINAL.includes(current.status)) {
          throw new AppError({
            code: ErrorCodes.EMERGENCY_INVALID_TRANSITION,
            message: 'A closed request cannot take a callback attempt.',
            silent: true,
          });
        }
        const now = new Date();
        await ctx.db.emergencyRequest.update({
          where: { id },
          data: {
            firstCallbackAt: current.firstCallbackAt ?? now,
            flagged: !input.reachedCaller,
            flagReason: input.reachedCaller ? null : (input.note ?? 'Callback attempt did not reach the caller.'),
          },
        });
        await ctx.db.emergencyRequestEvent.create({
          data: {
            id: newId(),
            organizationId,
            requestId: id,
            type: 'CALLBACK',
            actor: 'STAFF',
            actorId,
            // Outcome only. No phone number, no note text (both may contain PII).
            payload: { reachedCaller: input.reachedCaller },
          },
        });
        await ctx.db.auditLog.create({
          data: {
            id: newId(),
            organizationId,
            action: 'emergency_request.callback_recorded',
            resource: 'emergency_request',
            resourceId: id,
            newState: { reachedCaller: input.reachedCaller },
          },
        });
        ctx.emit({
          type: EventTypes.EmergencyRequestCallback,
          aggregateType: 'emergency_request',
          aggregateId: id,
          payload: { requestId: id, reachedCaller: input.reachedCaller },
        });
        return this.toStaffView(
          await ctx.db.emergencyRequest.findFirstOrThrow({ where: { id, organizationId } }),
        );
      },
      { organizationId },
    );
    return { item: request };
  }

  /**
   * Staff status change for the non-lifecycle states (brief §6.15): unreachable,
   * redirected, or not actionable.
   *
   * REDIRECTED and NOT_ACTIONABLE require a reason, because the caller copy
   * shows it. careOS does not decide where someone should go — staff record that
   * they told the caller to call elsewhere, and the copy says exactly that.
   */
  async setRequestStatus(id: string, input: SetRequestStatusDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    if (input.status !== 'UNREACHABLE' && !input.reason) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'A reason is required when marking a request redirected or not actionable.',
        silent: true,
      });
    }

    const request = await this.txRunner.run(
      async (ctx: TxContext) => {
        const current = await ctx.db.emergencyRequest.findFirst({ where: { id, organizationId } });
        if (!current) {
          throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Request not found' });
        }
        if (TERMINAL.includes(current.status)) {
          throw new AppError({
            code: ErrorCodes.EMERGENCY_INVALID_TRANSITION,
            message: 'This request is already closed or cancelled.',
            silent: true,
          });
        }
        if (current.status === input.status) {
          return this.toStaffView(current);
        }
        await ctx.db.emergencyRequest.update({
          where: { id },
          data: {
            status: input.status,
            statusReason: input.reason ?? null,
            // These three are finished for the facility (isTerminalStatus blocks
            // reopening), so the retention clock starts here. Without this the
            // request kept its encrypted caller PII indefinitely, because the
            // sweep could not tell it was done. `closedAt` is deliberately NOT
            // set: staff did not close this request, and the two facts are
            // reported separately.
            dispositionAt: current.dispositionAt ?? new Date(),
            // An unreachable caller stays flagged so the inbox keeps showing it.
            flagged: input.status === 'UNREACHABLE' ? true : current.flagged,
            flagReason: input.status === 'UNREACHABLE' ? (input.reason ?? 'Caller unreachable.') : current.flagReason,
          },
        });
        await ctx.db.emergencyRequestEvent.create({
          data: {
            id: newId(),
            organizationId,
            requestId: id,
            type: 'STATUS_CHANGED',
            actor: 'STAFF',
            actorId,
            payload: { from: current.status, to: input.status, hasReason: Boolean(input.reason) },
          },
        });
        await ctx.db.auditLog.create({
          data: {
            id: newId(),
            organizationId,
            action: `emergency_request.status_${input.status.toLowerCase()}`,
            resource: 'emergency_request',
            resourceId: id,
            newState: { from: current.status, to: input.status },
          },
        });
        return this.toStaffView(
          await ctx.db.emergencyRequest.findFirstOrThrow({ where: { id, organizationId } }),
        );
      },
      { organizationId },
    );

    this.realtime.publish(organizationId, REQUESTS_TOPIC, {
      event: EventTypes.EmergencyRequestAcknowledged,
      version: 1,
      aggregateId: id,
      payload: { requestId: id, status: request.status },
    });
    return { item: request };
  }

  /**
   * Marks a request as contacted without changing who is responsible
   * (brief §6.15). Distinct from RESPONDING: this records that a human reached
   * the caller, not that help is coming.
   */
  async markContacted(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const request = await this.txRunner.run(
      (ctx) => this.transitionRequest(ctx, organizationId, actorId, id, 'CONTACTED'),
      { organizationId },
    );
    return { item: request };
  }

  /**
   * Links an anonymous request to the ED arrival it produced (brief §6.15).
   *
   * This is the only join between a caller-free public request and a clinical
   * workflow, and it is staff-initiated and permission-gated. The visit must
   * belong to the same organization and branch as the request; a cross-tenant
   * link would leak one facility's incident into another's record.
   */
  async linkArrivalVisit(id: string, input: LinkArrivalVisitDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const request = await this.txRunner.run(
      async (ctx: TxContext) => {
        const current = await ctx.db.emergencyRequest.findFirst({
          where: { id, organizationId },
          select: { id: true, branchId: true },
        });
        if (!current) {
          throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Request not found' });
        }
        const visit = await ctx.db.emergencyVisit.findFirst({
          where: { id: input.visitId, organizationId },
          select: { id: true, branchId: true, visitNumber: true },
        });
        if (!visit) {
          throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Emergency visit not found' });
        }
        if (visit.branchId !== current.branchId) {
          throw new AppError({
            code: ErrorCodes.EMERGENCY_INVALID_TRANSITION,
            message: 'The visit belongs to a different branch than this request.',
            silent: true,
          });
        }
        const alreadyLinked = await ctx.db.emergencyVisit.findFirst({
          where: { emergencyRequestId: id, organizationId },
          select: { id: true },
        });
        if (alreadyLinked) {
          throw new AppError({
            code: ErrorCodes.CONFLICT,
            message: 'This request is already linked to an arrival.',
            silent: true,
          });
        }
        await ctx.db.emergencyVisit.update({
          where: { id: visit.id },
          data: { emergencyRequestId: id },
        });
        await ctx.db.emergencyRequestEvent.create({
          data: {
            id: newId(),
            organizationId,
            requestId: id,
            type: 'LINKED_ARRIVAL',
            actor: 'STAFF',
            actorId,
            payload: { visitId: visit.id, visitNumber: visit.visitNumber },
          },
        });
        await ctx.db.auditLog.create({
          data: {
            id: newId(),
            organizationId,
            action: 'emergency_request.arrival_linked',
            resource: 'emergency_request',
            resourceId: id,
            newState: { visitId: visit.id },
          },
        });
        ctx.emit({
          type: EventTypes.EmergencyRequestArrivalLinked,
          aggregateType: 'emergency_request',
          aggregateId: id,
          payload: { requestId: id, visitId: visit.id },
        });
        return this.toStaffView(
          await ctx.db.emergencyRequest.findFirstOrThrow({
            where: { id, organizationId },
            include: ARRIVAL_INCLUDE,
          }),
        );
      },
      { organizationId },
    );
    return { item: request };
  }

  /**
   * Merges a duplicate request into the canonical one (brief §6.15).
   *
   * The duplicate becomes DUPLICATE and points at the target; its own event
   * history stays intact (append-only, ADR-040) and staff keep a pointer to the
   * canonical request. PII on the duplicate is NOT copied across — the target is
   * the record of truth, and copying encrypted caller fields between rows would
   * widen the blast radius of a retention sweep.
   */
  async mergeRequest(id: string, input: MergeRequestDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    if (input.intoRequestId === id) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'A request cannot be merged into itself.',
        silent: true,
      });
    }

    const merged = await this.txRunner.run(
      async (ctx: TxContext) => {
        const [current, target] = await Promise.all([
          ctx.db.emergencyRequest.findFirst({
            where: { id, organizationId },
            select: { id: true, branchId: true, status: true, mergedIntoId: true },
          }),
          ctx.db.emergencyRequest.findFirst({
            where: { id: input.intoRequestId, organizationId },
            select: { id: true, branchId: true, mergedIntoId: true },
          }),
        ]);
        if (!current) {
          throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Request not found' });
        }
        if (!target) {
          throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Target request not found' });
        }
        if (current.mergedIntoId) {
          throw new AppError({
            code: ErrorCodes.CONFLICT,
            message: 'This request has already been merged.',
            silent: true,
          });
        }
        if (target.mergedIntoId) {
          throw new AppError({
            code: ErrorCodes.CONFLICT,
            message: 'The target request was itself merged into another request.',
            silent: true,
          });
        }
        if (current.branchId !== target.branchId) {
          throw new AppError({
            code: ErrorCodes.EMERGENCY_INVALID_TRANSITION,
            message: 'Requests can only be merged within the same branch.',
            silent: true,
          });
        }

        await ctx.db.emergencyRequest.update({
          where: { id },
          data: {
            status: 'DUPLICATE',
            statusReason: `Merged into ${target.id}.`,
            mergedIntoId: target.id,
            closedAt: new Date(),
            // A merged duplicate keeps the caller's encrypted PII, so the
            // retention clock has to start here or it would never be reaped.
            dispositionAt: new Date(),
            closedById: actorId,
          },
        });
        await ctx.db.emergencyRequest.update({
          where: { id: target.id },
          data: { mergedCount: { increment: 1 } },
        });
        await ctx.db.emergencyRequestEvent.create({
          data: {
            id: newId(),
            organizationId,
            requestId: id,
            type: 'MERGED',
            actor: 'STAFF',
            actorId,
            payload: { mergedIntoId: target.id, hasNote: Boolean(input.note) },
          },
        });
        await ctx.db.emergencyRequestEvent.create({
          data: {
            id: newId(),
            organizationId,
            requestId: target.id,
            type: 'MERGED',
            actor: 'STAFF',
            actorId,
            payload: { mergedFromId: id },
          },
        });
        await ctx.db.auditLog.create({
          data: {
            id: newId(),
            organizationId,
            action: 'emergency_request.merged',
            resource: 'emergency_request',
            resourceId: id,
            newState: { mergedIntoId: target.id },
          },
        });
        ctx.emit({
          type: EventTypes.EmergencyRequestMerged,
          aggregateType: 'emergency_request',
          aggregateId: id,
          payload: { requestId: id, mergedIntoId: target.id },
        });
        return this.toStaffView(
          await ctx.db.emergencyRequest.findFirstOrThrow({
            where: { id, organizationId },
            include: ARRIVAL_INCLUDE,
          }),
        );
      },
      { organizationId },
    );

    this.realtime.publish(organizationId, REQUESTS_TOPIC, {
      event: EventTypes.EmergencyRequestMerged,
      version: 1,
      aggregateId: id,
      payload: { requestId: id, mergedIntoId: input.intoRequestId },
    });
    return { item: merged };
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
    const [policy, readiness] = await Promise.all([
      this.prisma.tenantFor(organizationId).emergencyIntakePolicy.findFirst({ where: { branchId, organizationId } }),
      this.readinessFor(organizationId, branchId),
    ]);
    return {
      branchId,
      policy: this.policyView(policy),
      // Whether the branch can safely accept anonymous requests right now, and
      // what is missing if not. Operators see this before they try to enable.
      readiness: {
        ready: readiness.ready,
        reachableContacts: readiness.reachableContacts,
        reasons: readiness.reasons,
        messages: intakeReadinessMessages(readiness.reasons),
      },
    };
  }

  /**
   * Enables/updates the branch intake policy.
   *
   * The safety-critical part is the enable guard (brief §6.15): intake cannot be
   * switched on unless someone is genuinely reachable and a chain exists. It is
   * evaluated against the POST-update state, so a single request that both adds
   * a contact and enables intake succeeds.
   */
  async updatePolicy(input: IntakePolicyUpdateDto, forBranchId?: string) {
    const branchId = await this.resolveBranchId(forBranchId);
    const organizationId = this.tenantContext.requireOrg();
    await this.ensureBranch(organizationId, branchId);

    const result = await this.txRunner.run(
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
          ackSlaSeconds:
            input.ackSlaSeconds !== undefined
              ? input.ackSlaSeconds
              : (existing?.ackSlaSeconds ?? null),
          ambulanceAvailable:
            input.ambulanceAvailable ?? existing?.ambulanceAvailable ?? false,
          serviceArea:
            input.serviceArea !== undefined ? input.serviceArea : (existing?.serviceArea ?? null),
          autoReplyTemplate:
            input.autoReplyTemplate !== undefined
              ? input.autoReplyTemplate
              : (existing?.autoReplyTemplate ?? null),
          emergencyPhone:
            input.emergencyPhone !== undefined ? input.emergencyPhone : (existing?.emergencyPhone ?? null),
          levelSeconds: levelSeconds ?? [120, 300, 900],
        };

        // The guard reads contacts and the chain as they will be AFTER this
        // write, so enabling intake and adding the first contact in one request
        // works, while enabling it with no reachable contact is refused.
        if (data.enabled) {
          const contacts = await ctx.db.emergencyContact.findMany({
            where: { organizationId, branchId },
            select: { active: true, onCall: true, phone: true, userId: true, onCallWindows: true },
          });
          const at = new Date();
          const readiness = evaluateIntakeReadiness({
            enabled: true,
            autoEscalate: data.autoEscalate,
            levelSeconds: parseLevelSeconds(data.levelSeconds),
            contacts: contacts.map((c) => ({
              active: c.active,
              onCall: c.onCall,
              hasChannel: Boolean(c.phone) || Boolean(c.userId),
              onShiftAt: (instant: Date) => isOnCallAt(c.onCallWindows, instant),
            })),
            at,
          });
          if (!readiness.ready) {
            throw new AppError({
              code: ErrorCodes.EMERGENCY_INTAKE_NOT_READY,
              message: 'Emergency intake cannot be enabled for this branch yet.',
              details: {
                reasons: readiness.reasons,
                messages: intakeReadinessMessages(readiness.reasons),
              },
              silent: true,
            });
          }
        }

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

    // Readiness is re-read after the write so the response reflects the state
    // the next submit will see, including the public projection mirror.
    const readiness = await this.readinessFor(organizationId, branchId);
    return {
      branchId,
      policy: this.policyView(result),
      readiness: {
        ready: readiness.ready,
        reachableContacts: readiness.reachableContacts,
        reasons: readiness.reasons,
        messages: intakeReadinessMessages(readiness.reasons),
      },
    };
  }

  /** Operator-facing policy shape. Shared by get/update so they cannot drift. */
  private policyView(policy: {
    enabled: boolean;
    autoEscalate: boolean;
    requireDescription: boolean;
    allowAnonymousCaller: boolean;
    levelSeconds: Prisma.JsonValue;
    ackSlaSeconds: number | null;
    ambulanceAvailable: boolean;
    serviceArea: string | null;
    autoReplyTemplate: string | null;
    emergencyPhone: string | null;
    updatedAt: Date | null;
    version: number;
  } | null) {
    return {
      enabled: policy?.enabled ?? false,
      autoEscalate: policy?.autoEscalate ?? true,
      requireDescription: policy?.requireDescription ?? false,
      allowAnonymousCaller: policy?.allowAnonymousCaller ?? false,
      levelSeconds: parseLevelSeconds(policy?.levelSeconds ?? undefined),
      depth: escalationDepth(policy?.levelSeconds ?? undefined),
      ackSlaSeconds: policy?.ackSlaSeconds ?? null,
      // Informational only. careOS never dispatches.
      ambulanceAvailable: policy?.ambulanceAvailable ?? false,
      serviceArea: policy?.serviceArea ?? null,
      autoReplyTemplate: policy?.autoReplyTemplate ?? null,
      emergencyPhone: policy?.emergencyPhone ?? null,
      updatedAt: policy?.updatedAt ?? null,
      version: policy?.version ?? 0,
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
        // A contact bound to a staff user resolves to that user's phone, which
        // is the single source of truth rather than a separately-typed number.
        phone: c.phone ?? null,
        userId: c.userId ?? null,
        role: c.role,
        order: c.order,
        active: c.active,
        onCall: c.onCall,
        // Usable windows only: a malformed entry is dropped rather than shown.
        onCallWindows: parseOnCallWindows(c.onCallWindows),
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
        // A bound staff user must belong to this organization, or escalation
        // would page someone from another tenant.
        if (input.userId) {
          const user = await ctx.db.user.findFirst({
            where: { id: input.userId, organizationId },
            select: { id: true },
          });
          if (!user) {
            throw new AppError({
              code: ErrorCodes.RESOURCE_NOT_FOUND,
              message: 'Staff user not found in this organization.',
              silent: true,
            });
          }
        }
        const id = existing?.id ?? newId();
        const data = {
          name: input.name,
          phone: input.phone ?? null,
          userId: input.userId ?? null,
          role: input.role?.trim() || 'Responder',
          notes: input.notes ?? null,
          active: existing?.active ?? true,
          onCall: input.onCall ?? existing?.onCall ?? true,
          // No windows configured means always on call (see domain/on-call-window.ts).
          onCallWindows: (input.onCallWindows ?? existing?.onCallWindows ?? []) as never,
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
        if (input.userId) {
          const user = await ctx.db.user.findFirst({
            where: { id: input.userId, organizationId },
            select: { id: true },
          });
          if (!user) {
            throw new AppError({
              code: ErrorCodes.RESOURCE_NOT_FOUND,
              message: 'Staff user not found in this organization.',
              silent: true,
            });
          }
        }
        // Prisma cannot accept a spread of the DTO here: `userId` is both a
        // scalar on this model and a relation, so the value is copied
        // explicitly rather than spread.
        await ctx.db.emergencyContact.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            ...(input.userId !== undefined ? { userId: input.userId } : {}),
            ...(input.role !== undefined ? { role: input.role } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
            ...(input.onCall !== undefined ? { onCall: input.onCall } : {}),
            ...(input.onCallWindows !== undefined
              ? { onCallWindows: input.onCallWindows as never }
              : {}),
            version: { increment: 1 },
          },
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
    // Warn (not block) when the last reachable contact is removed or taken off
    // call: intake is already enabled, so blocking the edit would be worse than
    // surfacing that the branch is now unstaffed. Submit-time readiness still
    // refuses the request.
    const readiness = await this.readinessFor(organizationId, branchId);
    return {
      ok: true,
      readiness: {
        ready: readiness.ready,
        reachableContacts: readiness.reachableContacts,
        reasons: readiness.reasons,
        messages: intakeReadinessMessages(readiness.reasons),
      },
    };
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
    // Same reasoning as patchContact: report post-delete readiness so operators
    // see immediately if they just unstaffed an enabled branch.
    const readiness = await this.readinessFor(organizationId, branchId);
    return {
      ok: true,
      readiness: {
        ready: readiness.ready,
        reachableContacts: readiness.reachableContacts,
        reasons: readiness.reasons,
        messages: intakeReadinessMessages(readiness.reasons),
      },
    };
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
        // Operators must confirm each number against the official source before
        // it is presented as trustworthy on the caller surface.
        verified: r.verified,
        verifiedAt: r.verifiedAt ?? null,
        channel: r.channel,
        active: r.active,
        note: r.note ?? null,
      })),
    };
  }

  /**
   * Cross-tenant reference data: this table is what the anonymous public surface
   * tells a distressed caller to phone, so every write is audited in the SAME
   * transaction as the change. A number can never change without a record of who
   * changed it and what it was before.
   *
   * The audit row is tenant-scoped in the schema, so it lands in the acting
   * operator's organization while the effect is global.
   */
  private async withReferenceAudit<T>(
    work: (db: TxContext['db']) => Promise<{ result: T; audit: ReferenceAuditEntry }>,
  ): Promise<T> {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    return this.txRunner.run(
      async (ctx) => {
        const { result, audit } = await work(ctx.db);
        await ctx.db.auditLog.create({
          data: {
            id: newId(),
            organizationId,
            userId: actorId,
            action: audit.action,
            resource: audit.resource,
            resourceId: audit.resourceId,
            previousState: (audit.previous ?? null) as never,
            newState: (audit.next ?? null) as never,
          },
          select: { id: true },
        });
        return result;
      },
      { organizationId },
    );
  }

  async setNumber(input: EmergencyNumberUpsertDto, id?: string) {
    // `verifiedAt` arrives as an ISO string; Prisma needs a Date. Keeping the
    // boolean `verified` in sync here means an operator can confirm a number
    // with one field and the audit trail still records when.
    const verifiedAt =
      input.verifiedAt === null
        ? null
        : input.verifiedAt !== undefined
          ? new Date(input.verifiedAt)
          : undefined;
    const verified = verifiedAt ? true : input.verified;
    const data = { ...input, verified, ...(verifiedAt !== undefined ? { verifiedAt } : {}) };
    if (id) {
      const existing = await this.prisma.unscoped().emergencyNumber.findUnique({ where: { id } });
      if (!existing) throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Number not found' });
      return this.withReferenceAudit(async (db) => {
        await db.emergencyNumber.update({ where: { id }, data });
        return {
          result: { ok: true as const },
          audit: {
            action: 'emergency.number_updated',
            resource: 'emergency_number',
            resourceId: id,
            previous: {
              phone: existing.phone,
              verified: existing.verified,
              verifiedAt: existing.verifiedAt ?? null,
              public: existing.public,
              active: existing.active,
            },
            next: {
              phone: data.phone,
              verified: data.verified,
              verifiedAt: verifiedAt ?? null,
              public: data.public,
              active: data.active,
            },
          },
        };
      });
    }
    const dup = await this.prisma
      .unscoped()
      .emergencyNumber.findFirst({ where: { country: input.country, purpose: input.purpose } });
    if (dup) throw new AppError({ code: ErrorCodes.CONFLICT, message: 'A number for that country/purpose already exists.' });
    const rowId = newId();
    return this.withReferenceAudit(async (db) => {
await db.emergencyNumber.create({ data: { id: rowId, ...data } });
        return {
          result: { ok: true as const },
          audit: {
            action: 'emergency.number_created',
            resource: 'emergency_number',
            resourceId: rowId,
            next: {
              country: data.country,
              purpose: data.purpose,
              verified: data.verified ?? false,
              channel: data.channel ?? 'VOICE',
              active: data.active ?? true,
            },
          },
        };
    });
  }

  async deleteNumber(id: string) {
    const existing = await this.prisma.unscoped().emergencyNumber.findUnique({ where: { id } });
    if (!existing) throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Number not found' });
    return this.withReferenceAudit(async (db) => {
      await db.emergencyNumber.delete({ where: { id } });
      return {
        result: { ok: true as const },
        audit: {
          action: 'emergency.number_deleted',
          resource: 'emergency_number',
          resourceId: id,
          previous: { country: existing.country, purpose: existing.purpose, phone: existing.phone },
        },
      };
    });
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
        // Reviewer provenance travels with the row (brief §6.14) so an operator
        // can see who published copy a distressed caller was shown.
        reviewedBy: r.reviewedBy ?? null,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
      })),
    };
  }

  async setNotice(input: PublicNoticeUpsertDto, id?: string) {
    // Brief §6.14 requires published copy to carry who reviewed it and when. We
    // stamp the acting operator rather than trusting the request body, and
    // refresh the timestamp on every edit so an edit counts as a new review.
    const reviewerId = this.tenantContext.requireUserId();
    const reviewedAt = input.active === false ? undefined : new Date();
    const data = {
      ...input,
      ...(reviewedAt ? { reviewedBy: reviewerId, reviewedAt } : {}),
      ...(input.reviewedAt !== undefined ? { reviewedAt: input.reviewedAt ? new Date(input.reviewedAt) : null } : {}),
    };
    if (id) {
      const existing = await this.prisma.unscoped().publicNotice.findUnique({ where: { id } });
      if (!existing) throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Notice not found' });
      return this.withReferenceAudit(async (db) => {
        await db.publicNotice.update({ where: { id }, data });
        return {
          result: { ok: true as const },
          audit: {
            action: 'emergency.notice_updated',
            resource: 'public_notice',
            resourceId: id,
            previous: {
              active: existing.active,
              severity: existing.severity,
              reviewedBy: existing.reviewedBy ?? null,
            },
            next: {
              active: data.active,
              severity: data.severity,
              reviewedBy: data.reviewedBy ?? null,
            },
          },
        };
      });
    }
    const rowId = newId();
    return this.withReferenceAudit(async (db) => {
      await db.publicNotice.create({ data: { id: rowId, ...data } });
      return {
        result: { ok: true as const },
        audit: {
          action: 'emergency.notice_created',
          resource: 'public_notice',
          resourceId: rowId,
          next: {
            severity: data.severity,
            active: data.active,
            reviewedBy: data.reviewedBy ?? null,
          },
        },
      };
    });
  }

  async deleteNotice(id: string) {
    const existing = await this.prisma.unscoped().publicNotice.findUnique({ where: { id } });
    if (!existing) throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Notice not found' });
    return this.withReferenceAudit(async (db) => {
      await db.publicNotice.delete({ where: { id } });
      return {
        result: { ok: true as const },
        audit: {
          action: 'emergency.notice_deleted',
          resource: 'public_notice',
          resourceId: id,
          previous: { severity: existing.severity, active: existing.active },
        },
      };
    });
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
    // A keyboard request is RECEIVED or ESCALATED (each level flips the status
    // read-model to ESCALATED); ACKNOWLEDGED/RESPONDING/CLOSED/CANCELLED stop
    // the chain. The `escalationLevel === level - 1` guard is what makes each
    // level exactly once, so accepting ESCALATED here lets levels >= 2 advance
    // (and lets the maintenance sweep re-promote a lost later-level job).
    if (!request || stopsEscalation(request.status) || request.escalationLevel >= level) {
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
      where: {
        id: requestId,
        organizationId,
        escalationLevel: level - 1,
        status: { in: ['RECEIVED', 'ESCALATED'] },
      },
      data: { escalationLevel: level, status: 'ESCALATED' },
    });
    if (won.count !== 1) return 'noop';

    // Exactly ONE escalation event per level. The final level emits
    // `FinalEscalation` instead of `Escalated` so the notification consumer can
    // act on it without re-deriving "is this the last level" from policy JSON —
    // policy may have been edited since the level was scheduled.
    const final = level >= levels.length;
    const type = final
      ? EventTypes.EmergencyRequestFinalEscalation
      : EventTypes.EmergencyRequestEscalated;

    await this.txRunner.run(
      async (ctx: TxContext) => {
        ctx.emit({ type, aggregateType: 'emergency_request', aggregateId: requestId, payload: { requestId, level } });
        await ctx.db.emergencyRequestEvent.create({
          data: {
            id: newId(),
            organizationId,
            requestId,
            type: 'ESCALATED',
            level,
            actor: 'SYSTEM',
            payload: final ? { level, final: true } : { level },
          },
        });
        await ctx.db.auditLog.create({
          data: {
            id: newId(),
            organizationId,
            action: final ? 'emergency_request.final_escalation' : `emergency_request.escalated_level_${level}`,
            resource: 'emergency_request',
            resourceId: requestId,
            newState: { level },
          },
        });
      },
      { organizationId },
    );
    this.realtime.publish(organizationId, REQUESTS_TOPIC, {
      event: type,
      version: 1,
      aggregateId: requestId,
      payload: { requestId, level },
    });

    if (final) {
      // The chain is exhausted and nobody confirmed a responder. This is the last
      // automated step careOS takes; the consumer pages the on-call contacts and
      // the caller copy tells the caller to phone.
      this.logger.warn(
        { requestId, level },
        'emergency request reached final escalation with no responder confirmed',
      );
    } else {
      await this.scheduleEscalation(requestId, organizationId, level + 1);
    }
    return 'advanced';
  }

  // ---------------------------------------------------------------------------
  // P4 hardening — maintenance sweep (ADR-043). Called by the repeatable worker
  // job outside NODE_ENV=test; both sweeps are guarded/idempotent so they can
  // race the normal delayed jobs, restarts, or a second worker instance.
  // ---------------------------------------------------------------------------

  /**
   * Watchdog for lost SLA job-books: re-promotes any open request whose next
   * escalation level is overdue but whose delayed BullMQ job never fired
   * (Redis restart, eviction, manual drain). `attemptEscalation`'s guarded
   * `updateMany` makes this exactly-once even when the original job still
   * exists — a level can only ever advance by one writer.
   */
  async reconcileEscalations(now = new Date()): Promise<{ scanned: number; advanced: number }> {
    const db = this.prisma.unscoped();
    const policies = await db.emergencyIntakePolicy.findMany({
      where: { enabled: true, autoEscalate: true },
      select: { organizationId: true, branchId: true, levelSeconds: true },
    });
    const policyKey = (organizationId: string, branchId: string) =>
      `${organizationId}:${branchId}`;
    const byBranch = new Map(
      policies.map((p) => [policyKey(p.organizationId, p.branchId), p]),
    );
    if (byBranch.size === 0) return { scanned: 0, advanced: 0 };

    const open = await db.emergencyRequest.findMany({
      where: { status: { in: ['RECEIVED', 'ESCALATED'] } },
      select: {
        id: true,
        organizationId: true,
        branchId: true,
        status: true,
        escalationLevel: true,
        createdAt: true,
        updatedAt: true,
      },
      take: 100,
    });

    let advanced = 0;
    for (const request of open) {
      const policy = byBranch.get(policyKey(request.organizationId, request.branchId));
      if (!policy) continue;
      const levels = parseLevelSeconds(policy.levelSeconds);
      let dueLevel: number | null = null;

      if (request.status === 'RECEIVED') {
        const firstDelay = levelDelayMs(levels[0] ?? levels[levels.length - 1] ?? 5000);
        if (now.getTime() - request.createdAt.getTime() < firstDelay) continue;
        dueLevel = 1;
      } else if (request.escalationLevel < levels.length) {
        const last = await db.emergencyRequestEvent.findFirst({
          where: { requestId: request.id, type: 'ESCALATED', level: request.escalationLevel },
          orderBy: { occurredAt: 'desc' },
          select: { occurredAt: true },
        });
        const triggerAt = last?.occurredAt ?? request.updatedAt;
        const nextDelay = levelDelayMs(
          levels[request.escalationLevel] ??
            levels[levels.length - 1] ??
            5000,
        );
        if (now.getTime() - triggerAt.getTime() < nextDelay) continue;
        dueLevel = request.escalationLevel + 1;
      }

      if (dueLevel === null) continue;
      const outcome = await this.attemptEscalation(request.id, request.organizationId, dueLevel);
      if (outcome === 'advanced') advanced += 1;
    }

    return { scanned: open.length, advanced };
  }

  /**
   * Retention hook (ADR-043): anonymize caller PII and retire the tracking
   * token for terminal requests past the configured window. The incident's
   * reference number and append-only event history remain for audit; only the
   * PII columns and the token link are dropped. Guarded on `retainedAt` so two
   * sweep instances can never double-process a row.
   */
  async applyRetention(
    now = new Date(),
    retentionDays = this.env.EMERGENCY_RETENTION_DAYS,
  ): Promise<{ scanned: number; retained: number }> {
    if (retentionDays <= 0) return { scanned: 0, retained: 0 };
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
    const db = this.prisma.unscoped();
    const candidates = await db.emergencyRequest.findMany({
      where: {
        // Every finished disposition, not just the two that carry a close stamp.
        // A request the facility is done with can never be reopened
        // (isTerminalStatus), so its caller PII must age out with everything else.
        status: { in: [...DISPOSITIONS] },
        retainedAt: null,
        // `dispositionAt` is written at the moment the request becomes finished.
        // The fallback columns cover rows written before that column existed,
        // whose disposition is only inferable from the old timestamps.
        OR: [
          { dispositionAt: { lt: cutoff } },
          { dispositionAt: null, closedAt: { lt: cutoff } },
          { dispositionAt: null, cancelledAt: { lt: cutoff } },
        ],
      },
      select: { id: true, organizationId: true, referenceNumber: true },
      take: 200,
    });

    let retained = 0;
    for (const candidate of candidates) {
      let auditApplied = false;
      await this.txRunner.run(
        async (ctx: TxContext) => {
          const updated = await ctx.db.emergencyRequest.updateMany({
            where: { id: candidate.id, organizationId: candidate.organizationId },
            data: {
              retainedAt: now,
              // Deterministic sentinel that can never collide with a real
              // SHA-256 token hash, so the request stops matching any token.
              trackingTokenHash: `retired:${candidate.id}`,
              callerNameEnc: null,
              callerPhoneEnc: null,
              callerPhoneIndex: null,
              descriptionEnc: null,
              landmarkEnc: null,
              staffNoteEnc: null,
            },
          });
          if (updated.count !== 1) return;
          auditApplied = true;
          ctx.emit({
            type: EventTypes.EmergencyRequestRetained,
            aggregateType: 'emergency_request',
            aggregateId: candidate.id,
            payload: { requestId: candidate.id },
          });
          await ctx.db.emergencyRequestEvent.create({
            data: {
              id: newId(),
              organizationId: candidate.organizationId,
              requestId: candidate.id,
              type: 'RETENTION',
              level: null,
              actor: 'SYSTEM',
              payload: { retainedAt: now.toISOString() },
            },
          });
          await ctx.db.auditLog.create({
            data: {
              id: newId(),
              organizationId: candidate.organizationId,
              action: 'emergency_request.pii_retained',
              resource: 'emergency_request',
              resourceId: candidate.id,
              newState: { referenceNumber: candidate.referenceNumber },
            },
          });
        },
        { organizationId: candidate.organizationId },
      );
      if (!auditApplied) continue;
      this.realtime.publish(candidate.organizationId, REQUESTS_TOPIC, {
        event: EventTypes.EmergencyRequestRetained,
        version: 1,
        aggregateId: candidate.id,
        payload: { requestId: candidate.id, retainedAt: now.toISOString() },
      });
      retained += 1;
    }

    return { scanned: candidates.length, retained };
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
    to: 'ACKNOWLEDGED' | 'CONTACTED' | 'RESPONDING' | 'CLOSED',
  ): Promise<RequestView> {
    const current = await ctx.db.emergencyRequest.findFirstOrThrow({
      where: { id, organizationId },
    });
    if (TERMINAL.includes(current.status)) {
      throw new AppError({ code: ErrorCodes.CONFLICT, message: 'Request is already closed or cancelled.' });
    }
    // A request the facility already finished with (redirected, unreachable,
    // not actionable, merged) must not be silently reopened by a lifecycle
    // transition: the caller was told the facility is done with it.
    if (isTerminalStatus(current.status)) {
      throw new AppError({
        code: ErrorCodes.EMERGENCY_INVALID_TRANSITION,
        message: `This request is already ${callerStatusLabel(current.status).toLowerCase()} and cannot be reopened.`,
        silent: true,
      });
    }
    const timestamp = new Date();

    if (to === 'ACKNOWLEDGED' && current.status !== 'ACKNOWLEDGED') {
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
    } else if (to === 'CONTACTED' && current.status !== 'CONTACTED') {
      // Distinct from RESPONDING: records that a human reached the caller, not
      // that help is coming. Keeps the caller copy honest.
      await ctx.db.emergencyRequest.update({
        where: { id },
        data: {
          status: 'CONTACTED',
          firstCallbackAt: current.firstCallbackAt ?? timestamp,
          // Reaching the caller clears an "unreachable" flag.
          flagged: false,
          flagReason: null,
        },
      });
      await this.recordEvent(ctx, organizationId, id, 'CONTACTED', actorId, current.escalationLevel);
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
        data: { status: 'CLOSED', closedAt: timestamp, closedById: actorId, dispositionAt: timestamp },
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
      await ctx.db.emergencyRequest.findFirstOrThrow({
        where: { id, organizationId },
        include: ARRIVAL_INCLUDE,
      }),
    );
  }

  private async recordEvent(
    ctx: TxContext,
    organizationId: string,
    requestId: string,
    type: 'ACKNOWLEDGED' | 'CONTACTED' | 'RESPONDING' | 'CLOSED',
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

  private toStaffView(
    row: EmergencyRequest & { linkedArrivals?: Array<{ id: string; visitNumber: string; arrivedAt: Date }> },
  ): RequestView {
    return {
      id: row.id,
      referenceNumber: row.referenceNumber,
      status: row.status,
      statusLabel: callerStatusLabel(row.status),
      escalationLevel: row.escalationLevel,
      branchId: row.branchId,
      source: row.source,
      callerName: row.callerNameEnc ? this.encryption.decrypt(row.callerNameEnc) : null,
      callerPhone: row.callerPhoneEnc ? this.encryption.decrypt(row.callerPhoneEnc) : (row.callerPhoneIndex ?? null),
      description: row.descriptionEnc ? this.encryption.decrypt(row.descriptionEnc) : null,
      // Caller-stated, not a clinical assessment. Staff read it as context; it
      // never drives routing or prioritization.
      callerCategory: row.callerCategory,
      forSelf: row.forSelf,
      peopleCount: row.peopleCount,
      preferredContact: row.preferredContact,
      consentVersion: row.consentVersion,
      consentAt: row.consentAt,
      location: {
        lat: row.locationLat,
        lng: row.locationLng,
        landmark: row.landmarkEnc ? this.encryption.decrypt(row.landmarkEnc) : null,
        accuracyM: row.locationAccuracyM,
        source: row.locationSource,
      },
      staffNote: row.staffNoteEnc ? this.encryption.decrypt(row.staffNoteEnc) : null,
      flagged: row.flagged,
      flagReason: row.flagReason,
      mergedCount: row.mergedCount,
      mergedIntoId: row.mergedIntoId,
      firstCallbackAt: row.firstCallbackAt,
      linkedArrivals: (row.linkedArrivals ?? []).map((v) => ({
        id: v.id,
        visitNumber: v.visitNumber,
        arrivedAt: v.arrivedAt,
      })),
      acknowledgedAt: row.acknowledgedAt,
      respondedAt: row.respondedAt,
      closedAt: row.closedAt,
      cancelledAt: row.cancelledAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}