import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../config/config.module';
import { OutboxPublisherService } from '../../database/outbox-publisher.service';
import { PrismaService } from '../../database/prisma.service';
import { NotificationDeliveryService } from '../notifications/notifications-delivery.service';
import { MaintenanceService } from '../operations/maintenance.service';
import { ReportsService } from '../insights/reports.service';

/** Queue carrying every time-based duty (ADR-044). */
export const SCHEDULER_QUEUE = 'scheduler';
export const OUTBOX_DRAIN_JOB = 'outbox-drain';
export const MAINTENANCE_REMINDER_JOB = 'maintenance-reminders';
export const IDEMPOTENCY_SWEEP_JOB = 'idempotency-sweep';
export const REPORT_EXPIRY_JOB = 'report-expiry';
export const NOTIFICATION_DELIVERY_JOB = 'notification-delivery';

/**
 * Row cap for one outbox claim, matching the batch the retired `worker.ts`
 * setInterval used. Small on purpose: a claim holds `FOR UPDATE SKIP LOCKED`
 * locks only for the claim transaction, and dispatch happens outside it, so the
 * claim must not queue more work than can be dispatched promptly.
 */
const OUTBOX_DRAIN_BATCH = 100;

export interface OutboxDrainResult {
  published: number;
}

export interface IdempotencySweepResult {
  /** Records reclaimed (COMPLETED past their window, or orphaned IN_PROGRESS). */
  deleted: number;
}

export interface ReportExpiryResult {
  expired: number;
}

export interface MaintenanceReminderResult {
  organizations: number;
  queued: number;
  skipped: number;
  /** Organizations whose pass threw — isolation: one bad org never stops the rest. */
  failed: number;
}

export interface NotificationDeliveryResult {
  attempted: number;
  sent: number;
  suppressed: number;
  /** Failed but still inside the retry ladder — `nextAttemptAt` was pushed out. */
  retrying: number;
  /** Failed terminally (permanent cause, or max attempts exhausted). */
  failed: number;
}

/**
 * Time-based duties (patch P5, ADR-044).
 *
 * Every method here is a *sweep*: idempotent, batched, and safe to run from any
 * process at any time. The worker only decides *when* they run (repeatable BullMQ
 * jobs), so the duties can also be driven manually in tests or an operator
 * runbook (`npx tsx scripts/sweep.ts` style invocations) without Redis.
 *
 * All of them are cross-tenant by necessity (outbox delivery, expiring
 * idempotency records, per-org reminders, notification delivery), so they
 * read/write through `prisma.unscoped()` deliberately and re-enter the tenant
 * layer per row/org via `MaintenanceService.queueReminders({ organizationId })`
 * and `NotificationDeliveryService.send(row)`, which open properly
 * tenant-scoped, RLS-tied transactions.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  /**
   * Rotation cursor for the reminder sweep: the last organization visited.
   * Organization ids are UUIDv7, so lexicographic order is creation order and
   * "id > cursor" is a stable round-robin. Without it, a fleet with more orgs
   * than `SCHEDULER_ORG_BATCH` would starve every org past the first page.
   * Per-process by design: the sweep is idempotent, so uneven coverage across a
   * multi-process fleet self-corrects on the next pass.
   */
  private reminderCursor: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly maintenance: MaintenanceService,
    private readonly publisher: OutboxPublisherService,
    private readonly notifications: NotificationDeliveryService,
    private readonly reports: ReportsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Drain committed outbox events. Claims at most one batch per call so a tick
   * that runs while a large backlog exists simply repeats on the next one.
   * `OutboxPublisherService` owns the claim/dispatch contract (ADR-027); the
   * scheduler only supplies the cadence.
   */
  async drainOutbox(): Promise<OutboxDrainResult> {
    const published = await this.publisher.publishReadyEvents(OUTBOX_DRAIN_BATCH);
    return { published };
  }

  /**
   * Reclaim idempotency records past `expiresAt`. Two things are fixed:
   *  - COMPLETED records keep every stored response body alive forever today.
   *  - An IN_PROGRESS record orphaned by a crashed/flushed request answers 409
   *    forever, because the interceptor treats a live duplicate as a conflict
   *    until it expires — and nothing expired it.
   * Select-then-delete by id (rather than an unbounded delete) keeps the pass
   * bounded; a big backlog drains over several ticks.
   */
  async sweepIdempotencyRecords(now = new Date()): Promise<IdempotencySweepResult> {
    const db = this.prisma.unscoped();
    const stale = await db.idempotencyRecord.findMany({
      where: { expiresAt: { lte: now } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: this.env.SCHEDULER_SWEEP_BATCH,
    });
    if (stale.length === 0) return { deleted: 0 };
    const deleted = await db.idempotencyRecord.deleteMany({
      where: { id: { in: stale.map((row) => row.id) } },
    });
    return { deleted: deleted.count };
  }

  /**
   * Flip READY report exports to EXPIRED once `expiresAt` passes. The read path
   * already rejects expired artifacts lazily (`RESOURCE_EXPIRED`) — this makes
   * export listings honest without a read, and rides the
   * `(status, expiresAt)` index. PENDING/FAILED rows are left alone: a stalled
   * export is an operator problem, not an expiry.
   */
  async expireReportExports(now = new Date()): Promise<ReportExpiryResult> {
    const db = this.prisma.unscoped();
    const due = await db.reportExport.findMany({
      where: { status: 'READY', expiresAt: { lte: now } },
      select: { id: true, artifactKey: true },
      orderBy: { expiresAt: 'asc' },
      take: this.env.SCHEDULER_SWEEP_BATCH,
    });
    if (due.length === 0) return { expired: 0 };
    // Re-assert READY in the write: a concurrent pass or an operator action wins.
    const expired = await db.reportExport.updateMany({
      where: { id: { in: due.map((row) => row.id) }, status: 'READY' },
      data: { status: 'EXPIRED' },
    });
    // Removing the object is the point (patch P11): the bytes are patient data
    // in a bucket, and a row marked EXPIRED while the file is still there is a
    // retention promise the system has not kept. This runs for every due row,
    // not only the ones this pass won, so an object orphaned by a pass that died
    // between the update and the delete is still cleaned up. Both operations
    // are idempotent, and a row that something else revived keeps its object.
    await Promise.all(
      due.map((row) =>
        this.reports.expireArtifact(row.id, row.artifactKey).catch((err: unknown) => {
          this.logger.warn(
            `could not remove artifact for expired export ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }),
      ),
    );
    return { expired: expired.count };
  }

  /**
   * Attempt every notification delivery that is due (patch P6, ADR-045).
   *
   * `NotificationDeliveryService.send` is the *only* thing that writes delivery
   * state, so this duty is just a bounded driver of it: claim the PENDING rows
   * whose `nextAttemptAt` has passed (rides the `(status, nextAttemptAt)` index)
   * and attempt each one, oldest first.
   *
   * The claim is select-then-attempt rather than a locked claim, so a tick
   * overlapping another process can double-send a row. That is acceptable and
   * explicit: delivery is at-least-once, every provider call carries the
   * notification id as an idempotency key, and the bodies are PHI-neutral by
   * construction — the alternative (holding locks across a network call) would
   * stall the whole queue behind one slow endpoint. Rows are individually
   * isolated: a throw from one delivery never stops the pass.
   */
  async deliverDueNotifications(now = new Date()): Promise<NotificationDeliveryResult> {
    const db = this.prisma.unscoped();
    const due = await db.notification.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: this.env.NOTIFICATION_DELIVERY_BATCH,
    });

    const result: NotificationDeliveryResult = {
      attempted: 0,
      sent: 0,
      suppressed: 0,
      retrying: 0,
      failed: 0,
    };
    for (const row of due) {
      result.attempted += 1;
      try {
        const delivered = await this.notifications.send(row);
        if (delivered.status === 'SENT') result.sent += 1;
        else if (delivered.status === 'SUPPRESSED') result.suppressed += 1;
        else if (delivered.status === 'FAILED') result.failed += 1;
        else result.retrying += 1;
      } catch (err) {
        result.failed += 1;
        this.logger.error(
          `notification delivery threw for ${row.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return result;
  }

  /**
   * Materialise maintenance reminders for every organization, round-robin one
   * page per pass. `queueReminders` is itself idempotent per maintenance record
   * (unique organizationId+maintenanceId), so repeated passes are free and a
   * crashed pass leaves no partial state (one transaction per organization).
   */
  async queueMaintenanceReminders(): Promise<MaintenanceReminderResult> {
    const organizations = await this.nextOrganizationPage();
    let queued = 0;
    let skipped = 0;
    let failed = 0;
    for (const org of organizations) {
      try {
        // System-queued: no actor (queuedById is nullable), scoped explicitly.
        const result = await this.maintenance.queueReminders({
          organizationId: org.id,
          actorId: null,
        });
        queued += result.queued;
        skipped += result.skipped;
      } catch (err) {
        failed += 1;
        this.logger.error(
          `maintenance reminder pass failed for org ${org.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return { organizations: organizations.length, queued, skipped, failed };
  }

  /** Next page of organizations in stable UUIDv7 order, wrapping at the end. */
  private async nextOrganizationPage(): Promise<Array<{ id: string }>> {
    const db = this.prisma.unscoped();
    const take = this.env.SCHEDULER_ORG_BATCH;
    const after = this.reminderCursor;

    let page = await db.organization.findMany({
      where: after ? { id: { gt: after } } : undefined,
      select: { id: true },
      orderBy: { id: 'asc' },
      take,
    });

    if (page.length === 0 && after) {
      // Reached the end: wrap around to the first page next pass.
      this.reminderCursor = null;
      page = await db.organization.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
        take,
      });
    }

    this.reminderCursor = page.length > 0 ? (page[page.length - 1]?.id ?? null) : after;
    return page;
  }
}
