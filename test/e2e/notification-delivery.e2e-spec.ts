import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createHmac } from 'node:crypto';
import { createTestApp } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { newId } from '../../src/common/lib/uuidv7';
import { SchedulerService } from '../../src/modules/scheduler/scheduler.service';
import { NotificationService } from '../../src/modules/notifications/notifications.service';
import { NotificationConsumer } from '../../src/modules/notifications/notifications.consumer';
import {
  clearRecordedDeliveries,
  recordedDeliveries,
  setWebhookMode,
} from '../support/webhook-recorder';
import { WEBHOOK_SECRET } from '../support/testcontainers';

/**
 * Off-system notification delivery acceptance (patch P6, ADR-045).
 *
 * The adapter is real here: `NOTIFICATION_WEBHOOK_URL` points at the in-process
 * recorder from the e2e global setup, so these tests exercise the actual signed
 * POST, the receiver's status handling and the retry ladder end to end — and the
 * scheduler sweep that drives it, rather than a mocked provider.
 */
describe('off-system notification delivery (patch P6)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let scheduler: SchedulerService;
  let notifications: NotificationService;
  let env: Env;
  let organizationId: string;
  let baseRetryMs: number;
  /** Fresh per test: opt-out rows persist in the shared e2e database, so a
   *  recipient created by an earlier test would suppress the rest of the run. */
  let recipientId: string;
  let maxAttempts: number;

  const sc = () => prisma.unscoped();

  /** Far enough ahead to make a backed-off row due without waiting for it. */
  const afterBackoff = () => new Date(Date.now() + 3_600_000);

  async function notificationFor(
    channel: 'EMAIL' | 'SMS' | 'IN_APP',
    userId = recipientId,
    templateKey = 'task.assigned',
  ): Promise<string> {
    const id = newId();
    await notifications.createForUser({
      id,
      userId,
      channel,
      templateKey,
      organizationId,
    });
    return id;
  }

  const emailNotification = (templateKey?: string, userId?: string) =>
    notificationFor('EMAIL', userId, templateKey);

  async function setOptOut(
    category: string,
    enabled: boolean,
    userId = recipientId,
  ): Promise<void> {
    await sc().notificationPreference.create({
      data: {
        id: newId(),
        organizationId,
        recipientUserId: userId,
        recipientPatientId: null,
        category,
        channel: 'EMAIL',
        enabled,
      },
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    scheduler = app.get(SchedulerService);
    notifications = app.get(NotificationService);
    env = app.get(ENV);
    baseRetryMs = env.NOTIFICATION_DELIVERY_RETRY_BASE_MS;
    maxAttempts = env.NOTIFICATION_DELIVERY_MAX_ATTEMPTS;

    organizationId = newId();
    await sc().organization.create({
      data: { id: organizationId, name: 'Notification Org' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    setWebhookMode('ok');
    clearRecordedDeliveries();
    // The delivery sweep is cross-tenant and take-bounded, so any PENDING row
    // left by another suite (or an earlier run of this one — the e2e database
    // is deliberately reused) would be claimed ahead of this test's row and
    // starve its assertions. Nothing this suite leaves PENDING may outlive the
    // test that made it, so clearing them first is the honest reset.
    await sc().notification.updateMany({
      where: { status: 'PENDING' },
      data: { status: 'FAILED', errorCode: 'E2E_STALE_BACKLOG' },
    });
    recipientId = newId();
    await sc().user.create({
      data: {
        id: recipientId,
        organizationId,
        email: `recipient-${recipientId}@test.local`,
        phone: '+254700000042',
        firstName: 'Notify',
        lastName: 'Recipient',
        status: 'ACTIVE',
      },
    });
  });

  it('runs against the real webhook adapter, with in-app-only fan-out by default', () => {
    expect(env.NOTIFICATION_WEBHOOK_URL).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/notifications$/,
    );
    // Fan-out is opt-in per deployment: nothing leaves the host unless an
    // operator turns it on.
    expect(env.NOTIFICATION_OFFSITE_CHANNELS).toBe('');
    expect(app.get(NotificationConsumer).channels()).toEqual(['IN_APP']);
  });

  it('suppresses a delivery the recipient opted out of, without contacting the receiver', async () => {
    await setOptOut('task.assigned', false);
    const id = await emailNotification();

    const result = await scheduler.deliverDueNotifications();

    expect(result.suppressed).toBeGreaterThanOrEqual(1);
    const row = await sc().notification.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('SUPPRESSED');
    expect(row.errorCode).toBe('RECIPIENT_OPTED_OUT');
    // A suppressed send is not a failure and never consumed an attempt.
    expect(row.attemptCount).toBe(0);
    expect(row.sentAt).toBeNull();
    expect(recordedDeliveries()).toHaveLength(0);
  });

  it('suppresses a channel with no address on file instead of retrying forever', async () => {
    // This recipient has an email but no phone, so SMS has nothing to send to.
    const addressless = newId();
    await sc().user.create({
      data: {
        id: addressless,
        organizationId,
        email: 'no.address@test.local',
        phone: null,
        firstName: 'No',
        lastName: 'Address',
        status: 'ACTIVE',
      },
    });
    const id = await notificationFor('SMS', addressless);

    await scheduler.deliverDueNotifications();

    expect(recordedDeliveries()).toHaveLength(0);
    const row = await sc().notification.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('SUPPRESSED');
    expect(row.errorCode).toBe('RECIPIENT_ADDRESS_MISSING');
  });

  it('delivers off-system, signed and idempotent, and records the receiver ref', async () => {
    await setOptOut('lab.result.released', false);
    const optedOutId = await emailNotification('lab.result.released');
    const id = await emailNotification();

    const result = await scheduler.deliverDueNotifications();

    const row = await sc().notification.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('SENT');
    expect(row.sentAt).toBeInstanceOf(Date);
    expect(row.attemptCount).toBe(1);
    expect(row.errorCode).toBeNull();
    // The receiver's own id, so an operator can trace the message downstream.
    expect(row.providerRef).toMatch(/^e2e-ref-\d+$/);

    const optedOutRow = await sc().notification.findUniqueOrThrow({
      where: { id: optedOutId },
    });
    expect(optedOutRow.status).toBe('SUPPRESSED');

    const delivered = recordedDeliveries();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      channel: 'EMAIL',
      // The address on file, not the recipient id the pre-P6 path passed.
      to: `recipient-${recipientId}@test.local`,
      idempotencyKey: id,
    });
    expect(result.sent).toBe(1);
  });

  it('signs the delivered body so the receiver can authenticate the platform', async () => {
    const id = await emailNotification();

    await scheduler.deliverDueNotifications();

    const deliveries = recordedDeliveries();
    expect(deliveries).toHaveLength(1);
    const delivery = deliveries[0]!;
    expect(delivery.idempotencyKey).toBe(id);
    // The signature covers the exact bytes the receiver got, so recomputing it
    // here proves the receiver can do the same.
    const expected = createHmac('sha256', WEBHOOK_SECRET)
      .update(delivery.raw)
      .digest('hex');
    expect(delivery.signature).toBe(`sha256=${expected}`);
  });

  it('retries a transient outage, then delivers once the receiver is back', async () => {
    setWebhookMode('unavailable');
    const id = await emailNotification();

    const first = await scheduler.deliverDueNotifications();

    const failed = await sc().notification.findUniqueOrThrow({ where: { id } });
    expect(first.retrying).toBeGreaterThanOrEqual(1);
    expect(failed.status).toBe('PENDING');
    expect(failed.attemptCount).toBe(1);
    // A retryable cause, and a next attempt pushed out instead of a hot loop.
    expect(failed.errorCode).toBe('PROVIDER_UNAVAILABLE');
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Nothing is due yet, so a tick in the meantime changes nothing.
    const idle = await scheduler.deliverDueNotifications();
    expect(idle.attempted).toBe(0);
    expect(
      (await sc().notification.findUniqueOrThrow({ where: { id } })).attemptCount,
    ).toBe(1);

    setWebhookMode('ok');
    const due = await scheduler.deliverDueNotifications(afterBackoff());
    expect(due.sent).toBeGreaterThanOrEqual(1);

    const recovered = await sc().notification.findUniqueOrThrow({ where: { id } });
    expect(recovered.status).toBe('SENT');
    expect(recovered.attemptCount).toBe(2);
    expect(recovered.errorCode).toBeNull();
    expect(recordedDeliveries()).toHaveLength(1);
  });

  it('fails a rejected payload permanently instead of burning the retry ladder', async () => {
    setWebhookMode('reject');
    const id = await emailNotification();

    await scheduler.deliverDueNotifications();

    const row = await sc().notification.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('FAILED');
    expect(row.errorCode).toBe('PROVIDER_REJECTED');
    // One attempt is enough: a 4xx will never succeed on retry.
    expect(row.attemptCount).toBe(1);
  });

  it('fails terminally once the attempt budget is spent and stops touching the row', async () => {
    setWebhookMode('unavailable');
    const id = await emailNotification();
    await sc().notification.update({
      where: { id },
      data: { attemptCount: maxAttempts - 1, nextAttemptAt: new Date() },
    });

    await scheduler.deliverDueNotifications();

    const row = await sc().notification.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('FAILED');
    expect(row.attemptCount).toBe(maxAttempts);
    expect(row.errorCode).toBe('PROVIDER_UNAVAILABLE');

    // A terminal row is not due again, however far the clock moves on.
    const later = await scheduler.deliverDueNotifications(afterBackoff());
    expect(later.attempted).toBe(0);
    expect(
      (await sc().notification.findUniqueOrThrow({ where: { id } })).attemptCount,
    ).toBe(maxAttempts);
  });

  it('still delivers in-app notifications through the same path', async () => {
    const id = await notificationFor('IN_APP');

    await scheduler.deliverDueNotifications();

    const row = await sc().notification.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('SENT');
    // IN_APP is the row itself: nothing leaves the host.
    expect(recordedDeliveries()).toHaveLength(0);
  });

  it('backs off from the configured base and reports the duty summary', async () => {
    setWebhookMode('unavailable');
    const id = await emailNotification();
    const before = Date.now();

    const result = await scheduler.deliverDueNotifications();

    const row = await sc().notification.findUniqueOrThrow({ where: { id } });
    const delay = row.nextAttemptAt.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(baseRetryMs - 1_000);
    expect(delay).toBeLessThanOrEqual(baseRetryMs * 2);
    expect(result.attempted).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);
  });
});
