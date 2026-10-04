import { Injectable, Logger } from '@nestjs/common';
import { EventTypes } from '../../events/catalog';
import type {
  OutboxConsumer,
  OutboxConsumerContext,
} from '../../events/outbox-consumer/outbox-consumer.types';
import { PrismaService } from '../../database/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { callerAction, callerActionMessage } from './domain/caller-copy';
import { isOnCallAt } from './domain/on-call-window';

/**
 * Emergency intake notification fan-out (brief §6.15).
 *
 * Two rules shape everything here:
 *
 * 1. **No caller PHI in any payload.** Notifications are built from the request
 *    reference, branch, and escalation level only. No name, phone number,
 *    location, or description is ever rendered, because IN_APP rows are also
 *    fanned out to SMS/email on off-system channels where content cannot be
 *    recalled. Staff open the request to see caller detail.
 *
 * 2. **The final escalation is the important one.** When the chain runs out, the
 *    last thing careOS does is page the on-call contacts and, if the branch has a
 *    configured phone, tell the caller to call. It never claims an ambulance is
 *    coming or that any response is guaranteed.
 */
@Injectable()
export class EmergencyNotificationConsumer implements OutboxConsumer {
  readonly name = 'emergency-notifications';
  readonly eventTypes: ReadonlyArray<string> = [
    EventTypes.EmergencyRequestReceived,
    EventTypes.EmergencyRequestEscalated,
    EventTypes.EmergencyRequestFinalEscalation,
    EventTypes.EmergencyRequestCallback,
  ];

  private readonly logger = new Logger(EmergencyNotificationConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * On-call contacts for a branch, in escalation order. `active` and `onCall` are
   * both required: a contact who is off-shift must not be paged for an emergency,
   * and the intake enable guard refuses to enable intake when none are on call.
   *
   * `onCallWindows` (brief §6.15) is applied here rather than in SQL so the
   * facility-local shift boundary matches the operator's own clock. Contacts
   * outside their window are skipped; if that leaves nobody, the caller is
   * returned an empty list and the escalation continues to the next level rather
   * than paging whoever happens to be awake.
   */
  async onCallContacts(organizationId: string, branchId: string, at: Date = new Date()) {
    const contacts = await this.prisma
      .tenantFor(organizationId)
      .emergencyContact.findMany({
        where: { organizationId, branchId, active: true, onCall: true },
        orderBy: { order: 'asc' },
        select: {
          id: true,
          name: true,
          role: true,
          userId: true,
          phone: true,
          order: true,
          onCallWindows: true,
        },
      });
    return contacts.filter((c) => isOnCallAt(c.onCallWindows, at));
  }

  /**
   * Contacts level N to page. Each contact gets its own event-derived
   * notification id, so a retry after a partial failure is idempotent.
   */
  async notifyContacts(input: {
    organizationId: string;
    requestId: string;
    branchId: string;
    branchName: string;
    referenceNumber: string;
    level: number;
    templateKey: 'emergency.request_received' | 'emergency.escalation' | 'emergency.final_escalation';
  }): Promise<{ notified: number }> {
    const contacts = await this.onCallContacts(input.organizationId, input.branchId);
    const { templateKey } = input;

    let notified = 0;
    for (const contact of contacts) {
      if (!contact.userId) {
        // A phone-only contact has no in-product recipient. We still record the
        // gap rather than silently skipping, so operators can see that their
        // chain is partly unstaffed.
        this.logger.warn('emergency contact has no staff user; not paged in-app', {
          requestId: input.requestId,
          contactId: contact.id,
          order: contact.order,
        });
        continue;
      }
      const variables: Record<string, string> = {
        referenceNumber: input.referenceNumber,
        branchName: input.branchName,
      };
      if (templateKey === 'emergency.escalation') variables.level = String(input.level);

      await this.notifications.createForUser({
        // Per-contact suffix keeps a retry of one contact from colliding with
        // another contact's row.
        id: `notif-emerg-${input.requestId}-l${input.level}-${contact.id}`.slice(0, 120),
        userId: contact.userId,
        channel: 'IN_APP',
        templateKey,
        variables,
        organizationId: input.organizationId,
      });
      notified += 1;
    }

    return { notified };
  }

  async handle(ctx: OutboxConsumerContext): Promise<void> {
    const payload = asRecord(ctx.row.payload);
    const requestId = firstString(payload.requestId);
    if (!requestId) return;

    const db = this.prisma.tenantFor(ctx.organizationId);
    const request = await db.emergencyRequest.findFirst({
      where: { id: requestId, organizationId: ctx.organizationId },
      select: {
        id: true,
        referenceNumber: true,
        branchId: true,
        escalationLevel: true,
        status: true,
        acknowledgedAt: true,
        respondedAt: true,
        flagged: true,
        // No caller PII is selected here at all. See the class docblock.
      },
    });
    if (!request) return;

    const branch = await db.branch.findFirst({
      where: { id: request.branchId, organizationId: ctx.organizationId },
      select: { name: true, phone: true },
    });

    switch (ctx.row.type) {
      case EventTypes.EmergencyRequestReceived: {
        const notified = await this.notifyContacts({
          organizationId: ctx.organizationId,
          requestId: request.id,
          branchId: request.branchId,
          branchName: branch?.name ?? 'the facility',
          referenceNumber: request.referenceNumber,
          level: 0,
          templateKey: 'emergency.request_received',
        });
        this.logger.log(
          `emergency request ${request.referenceNumber} received; ${notified.notified} on-call contact(s) notified in-app`,
        );
        return;
      }

      case EventTypes.EmergencyRequestEscalated: {
        // Non-final levels only: the service emits FinalEscalation for the last
        // level of the chain, so this branch never has to guess whether the
        // policy's levelSeconds array has since been edited.
        const level = payload.level ? Number(payload.level) : request.escalationLevel;
        await this.notifyContacts({
          organizationId: ctx.organizationId,
          requestId: request.id,
          branchId: request.branchId,
          branchName: branch?.name ?? 'the facility',
          referenceNumber: request.referenceNumber,
          level,
          templateKey: 'emergency.escalation',
        });
        return;
      }

      case EventTypes.EmergencyRequestFinalEscalation: {
        // Only the facility's own phone is read here — never caller data.
        const policy = await db.emergencyIntakePolicy.findFirst({
          where: { branchId: request.branchId, organizationId: ctx.organizationId },
          select: { emergencyPhone: true },
        });
        await this.notifyContacts({
          organizationId: ctx.organizationId,
          requestId: request.id,
          branchId: request.branchId,
          branchName: branch?.name ?? 'the facility',
          referenceNumber: request.referenceNumber,
          level: request.escalationLevel,
          templateKey: 'emergency.final_escalation',
        });
        await this.finalCallerNudge(request.referenceNumber, policy?.emergencyPhone ?? branch?.phone ?? null);
        return;
      }

      case EventTypes.EmergencyRequestCallback: {
        // Only an unreachable caller is worth a separate page — staff who made
        // the attempt already know, and the inbox flag is the record.
        if (!request.flagged) return;
        const contacts = await this.onCallContacts(ctx.organizationId, request.branchId);
        for (const contact of contacts) {
          if (!contact.userId) continue;
          await this.notifications.createForUser({
            id: `notif-emerg-${request.id}-unreachable-${contact.id}`.slice(0, 120),
            userId: contact.userId,
            channel: 'IN_APP',
            templateKey: 'emergency.request_unreachable',
            variables: {
              referenceNumber: request.referenceNumber,
              branchName: branch?.name ?? 'the facility',
            },
            organizationId: ctx.organizationId,
          });
        }
        return;
      }

      default:
        return;
    }
  }

  /**
   * Final caller nudge. There is no outbound SMS integration here: careOS holds no
   * verified sender relationship with anonymous callers, and brief §6.15 only
   * promises caller-facing guidance through the tracking surface. So we log a
   * PHI-free line operators can act on; the caller receives the identical CALL_NOW
   * guidance the next time they poll their tracking token.
   */
  private async finalCallerNudge(referenceNumber: string, facilityPhone: string | null): Promise<void> {
    const action = callerAction({
      status: 'ESCALATED',
      escalationLevel: Number.MAX_SAFE_INTEGER,
      acknowledgedAt: null,
      respondedAt: null,
    });
    this.logger.warn(
      {
        referenceNumber,
        callerAction: action,
        callerGuidance: callerActionMessage(action),
        facilityPhonePresent: facilityPhone !== null,
        // Never the caller's phone number: it is encrypted at rest (ADR-041) and
        // must not reach logs.
      },
      'emergency request reached final escalation; caller copy now says call now',
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function firstString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}