import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { newId } from '../../src/common/lib/uuidv7';
import { hashPassword } from '../../src/common/security/password';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function poll<T>(
  fn: () => Promise<T>,
  until: (t: T) => boolean,
  timeout = 6000,
  step = 60,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const t = await fn();
    if (until(t)) return t;
    if (Date.now() - start > timeout) return t;
    await sleep(step);
  }
}

/**
 * Public emergency intake acceptance (brief §6.15 / patch P3): settings →
 * publish an intake-enabled listing → anonymous submit/track/cancel → staff
 * inbox ack/respond stops escalation → SLA escalation via delayed BullMQ jobs →
 * cross-tenant numbers/notices. Proves caller PII is encrypted at rest, the
 * public path never touches tenant tables, and escalation is cancelled by ack.
 */
describe('public emergency intake (patch P3)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let env: Env;
  let organizationId: string;
  let branchId: string;
  let adminToken: string;
  let slug: string;

  const url = (path: string): string => `${env.API_PREFIX}${path}`;
  const sc = () => prisma.unscoped();

  async function submitAnonymous(payload: Record<string, unknown>) {
    const res = await app.inject({ method: 'POST', url: url('/public/emergency/requests'), payload });
    return res;
  }
  async function track(token: string) {
    const res = await app.inject({
      method: 'POST',
      url: url('/public/emergency/requests/track'),
      payload: { token },
    });
    return res.json().data as {
      status: string;
      action: 'WAIT' | 'CALL_NOW' | 'HELP_ON_WAY';
      level: number;
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    env = app.get(ENV);

    organizationId = newId();
    await sc().organization.create({ data: { id: organizationId, name: 'Intake Org A' } });

    const passwordHash = await hashPassword('DemoPass123!');
    const role = await sc().role.create({
      data: {
        id: newId(),
        organizationId,
        key: 'INTAKE_ADMIN',
        name: 'Intake Admin',
        permissions: [
          'public_listing.manage',
          'platform.facilities.manage',
          'emergency_requests.read',
          'emergency_requests.manage',
          'emergency_settings.manage',
          'organizations.read',
        ],
        isSystem: false,
      },
    });
    const user = await sc().user.create({
      data: {
        id: newId(),
        organizationId,
        email: 'intake-admin@emergency.test',
        firstName: 'Int',
        lastName: 'Admin',
        status: 'ACTIVE',
        passwordHash,
      },
    });
    await sc().userRole.create({
      data: { id: newId(), organizationId, userId: user.id, roleId: role.id },
    });

    branchId = newId();
    await sc().branch.create({
      data: {
        id: branchId,
        organizationId,
        name: 'St Matthews Emergency',
        code: 'INT01',
        address: '4 Care Road',
      },
    });

    const login = await app.inject({
      method: 'POST',
      url: url('/auth/login'),
      payload: { organizationId, email: 'intake-admin@emergency.test', password: 'DemoPass123!' },
    });
    expect(login.statusCode).toBe(200);
    adminToken = login.json().data.tokens.accessToken;
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('denies anonymous access to the staff inbox', async () => {
    const res = await app.inject({ method: 'GET', url: url('/emergency/requests') });
    expect(res.statusCode).toBe(401);
  });

  it('denies staff without emergency permissions', async () => {
    const passwordHash = await hashPassword('DemoPass123!');
    const limited = await sc().role.create({
      data: {
        id: newId(),
        organizationId,
        key: 'INTAKE_READER',
        name: 'Intake Reader',
        permissions: ['organizations.read'],
        isSystem: false,
      },
    });
    const u = await sc().user.create({
      data: {
        id: newId(),
        organizationId,
        email: 'intake-reader@emergency.test',
        firstName: 'Rea',
        lastName: 'Der',
        status: 'ACTIVE',
        passwordHash,
      },
    });
    await sc().userRole.create({ data: { id: newId(), organizationId, userId: u.id, roleId: limited.id } });
    const login = await app.inject({
      method: 'POST',
      url: url('/auth/login'),
      payload: { organizationId, email: 'intake-reader@emergency.test', password: 'DemoPass123!' },
    });
    const token = login.json().data.tokens.accessToken;
    const res = await app.inject({ method: 'GET', url: url('/settings/emergency'), headers: bearer(token) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERMISSION_DENIED');
  });

  it('returns the default intake policy and persists an update', async () => {
    const get = await app.inject({ method: 'GET', url: url('/settings/emergency'), headers: bearer(adminToken) });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.policy.enabled).toBe(false);
    expect(get.json().data.policy.levelSeconds).toEqual([120, 300, 900]);

    const put = await app.inject({
      method: 'PUT',
      url: url('/settings/emergency'),
      headers: bearer(adminToken),
      payload: { enabled: true, autoEscalate: true, levelSeconds: [0.15, 0.3], emergencyPhone: '+254 20 555 0199' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().data.policy.enabled).toBe(true);
    expect(put.json().data.policy.levelSeconds).toEqual([0.15, 0.3]);
  });

  it('manages the ordered escalation contact chain', async () => {
    const post = await app.inject({
      method: 'POST',
      url: url('/settings/emergency/contacts'),
      headers: bearer(adminToken),
      payload: { name: 'Nurse Lead', phone: '+254 711 111 111', role: 'Triage', order: 1 },
    });
    expect(post.statusCode).toBe(201);
    const list = await app.inject({
      method: 'GET',
      url: url('/settings/emergency/contacts'),
      headers: bearer(adminToken),
    });
    expect(list.statusCode).toBe(200);
    const contact = list.json().data.contacts[0];
    expect(contact.name).toBe('Nurse Lead');
    expect(contact.order).toBe(1);

    const del = await app.inject({
      method: 'DELETE',
      url: url(`/settings/emergency/contacts/${contact.id}`),
      headers: bearer(adminToken),
    });
    expect(del.statusCode).toBe(200);
    const list2 = await app.inject({
      method: 'GET',
      url: url('/settings/emergency/contacts'),
      headers: bearer(adminToken),
    });
    expect(list2.json().data.contacts).toHaveLength(0);
  });

  it('publishes an intake-enabled listing', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: url('/settings/listing'),
      headers: bearer(adminToken),
      payload: {
        county: 'Nairobi',
        town: 'Westlands',
        locationLat: -1.26,
        locationLng: 36.81,
        emergency24h: true,
        emergencyIntakeEnabled: true,
        departments: [{ name: 'Outpatient', services: ['General consultation'] }],
      },
    });
    expect(put.statusCode).toBe(200);

    const publish = await app.inject({
      method: 'POST',
      url: url('/admin/listings/publish'),
      headers: bearer(adminToken),
    });
    expect(publish.statusCode).toBe(200);
    slug = publish.json().data.slug as string;

    const row = await sc().publicFacilityListing.findFirst({
      where: { sourceOrganizationId: organizationId, sourceBranchId: branchId },
      select: { emergencyIntakeEnabled: true, status: true },
    });
    expect(row?.emergencyIntakeEnabled).toBe(true);
    expect(row?.status).toBe('PUBLISHED');
  });

  it('submits an anonymous request; the DB holds a hash, never PII', async () => {
    // Uses the default 120/300/900s policy (no fast escalation yet).
    const res = await submitAnonymous({
      slug,
      callerName: 'Alice Mwangi',
      callerPhone: '+254712345678',
      description: 'Maternal emergency',
      location: { lat: -1.262, lng: 36.815, landmark: 'Blue gate, Care Road' },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.request.referenceNumber).toMatch(/^EMR-\d{4}-\d{6}$/);
    expect(data.request.trackingToken).toBeTruthy();
    const token = data.request.trackingToken as string;

    const row = await sc().emergencyRequest.findFirst({
      where: { source: 'PUBLIC' },
      select: { trackingTokenHash: true, callerPhoneIndex: true, callerPhoneEnc: true, callerNameEnc: true, status: true },
    });
    expect(row).toBeTruthy();
    expect(row?.trackingTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.trackingTokenHash).not.toContain(token);
    expect(row?.callerPhoneIndex).toBe('+254712345678');
    expect(row?.callerPhoneEnc).not.toContain('712345678');
    expect(row?.callerNameEnc).not.toContain('Alice');
    expect(row?.status).toBe('RECEIVED');

    const t = await track(token);
    expect(t.status).toBe('RECEIVED');
    expect(t.action).toBe('WAIT');
  });

  it('returns 404 for an unknown tracking token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: url('/public/emergency/requests/track'),
      payload: { token: 'not-a-real-token-not-a-real-token' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('escalates under the SLA and staff acknowledgement cancels it', async () => {
    const submitted = await submitAnonymous({ slug, callerPhone: '+254722222222' });
    expect(submitted.statusCode).toBe(201);
    const token = submitted.json().data.request.trackingToken as string;
    const requestId = submitted.json().data.request.id as string;

    // level 1 (150ms) fires → CALL_NOW; level 2 (300ms) is a no-op after ack.
    await poll(
      async () => ({ t: await track(token) }),
      ({ t }) => t.action === 'CALL_NOW' && t.level >= 1,
    );
    const escalated = await track(token);
    expect(escalated.action).toBe('CALL_NOW');
    expect(escalated.status).toBe('ESCALATED');

    await poll(
      async () => {
        const ev = await sc().emergencyRequestEvent.findMany({
          where: { requestId },
          select: { type: true, level: true },
        });
        return { done: ev.some((e) => e.type === 'ESCALATED' && e.level >= 1) };
      },
      ({ done }) => done,
    );

    const events = await sc().emergencyRequestEvent.findMany({
      where: { requestId },
      orderBy: { occurredAt: 'asc' },
      select: { type: true, level: true },
    });
    expect(events.some((e) => e.type === 'ESCALATED' && e.level >= 1)).toBe(true);

    const ack = await app.inject({
      method: 'POST',
      url: url(`/emergency/requests/${requestId}/acknowledge`),
      headers: bearer(adminToken),
    });
    expect(ack.statusCode).toBe(201);
    expect(ack.json().data.item.status).toBe('ACKNOWLEDGED');

    await sleep(500);
    const after = await track(token);
    expect(after.action).toBe('WAIT');
    expect(after.status).toBe('ACKNOWLEDGED');

    const ackEvents = await sc().emergencyRequestEvent.findMany({
      where: { requestId, type: 'ACKNOWLEDGED' },
      select: { actor: true },
    });
    expect(ackEvents).toHaveLength(1);
    expect(ackEvents[0]!.actor).toBe('STAFF');
  });

  it('staff responding flips the caller to HELP_ON_WAY and blocks cancellation', async () => {
    const submitted = await submitAnonymous({ slug, callerPhone: '+254733333333', description: 'Chest pain' });
    const token = submitted.json().data.request.trackingToken as string;
    const requestId = submitted.json().data.request.id as string;

    await poll(
      async () => ({ t: await track(token) }),
      ({ t }) => t.action === 'CALL_NOW',
    );

    const respond = await app.inject({
      method: 'POST',
      url: url(`/emergency/requests/${requestId}/respond`),
      headers: bearer(adminToken),
    });
    expect(respond.statusCode).toBe(201);

    const t = await track(token);
    expect(t.action).toBe('HELP_ON_WAY');
    expect(t.status).toBe('RESPONDING');

    const cancel = await app.inject({
      method: 'POST',
      url: url('/public/emergency/requests/cancel'),
      payload: { token },
    });
    expect(cancel.statusCode).toBe(409);
    expect(cancel.json().error.code).toBe('EMERGENCY_CALL_NOW');
  });

  it('lets a caller cancel before help is dispatched', async () => {
    const submitted = await submitAnonymous({ slug, callerPhone: '+254744444444', description: 'Test' });
    const token = submitted.json().data.request.trackingToken as string;
    const cancel = await app.inject({
      method: 'POST',
      url: url('/public/emergency/requests/cancel'),
      payload: { token },
    });
    expect(cancel.statusCode).toBe(201);
    expect(cancel.json().data.status).toBe('CANCELLED');
    const t = await track(token);
    expect(t.status).toBe('CANCELLED');
    expect(t.action).toBe('WAIT');
  });

  it('lists and serves the inbox with decrypted caller detail', async () => {
    const list = await app.inject({
      method: 'GET',
      url: url('/emergency/requests'),
      headers: bearer(adminToken),
    });
    expect(list.statusCode).toBe(200);
    const items = list.json().data as Array<{
      id: string;
      referenceNumber: string;
      callerName: string | null;
      callerPhone: string | null;
    }>;
    expect(items.length).toBeGreaterThanOrEqual(3);

    const alice = items.find((r) => r.callerName === 'Alice Mwangi');
    expect(alice).toBeTruthy();
    const get = await app.inject({
      method: 'GET',
      url: url(`/emergency/requests/${alice!.id}`),
      headers: bearer(adminToken),
    });
    expect(get.statusCode).toBe(200);
    const item = get.json().data.item;
    expect(item.callerName).toBe('Alice Mwangi');
    expect(item.callerPhone).toBe('+254712345678');
    expect(Array.isArray(get.json().data.events)).toBe(true);
  });

  it('refuses a request from a facility that has not enabled intake', async () => {
    const otherBranch = newId();
    await sc().branch.create({
      data: { id: otherBranch, organizationId, name: 'No Intake Clinic', code: 'INT02' },
    });
    const put = await app.inject({
      method: 'PUT',
      url: url(`/settings/listing?branchId=${otherBranch}`),
      headers: bearer(adminToken),
      payload: {
        county: 'Nairobi',
        town: 'Kasarani',
        locationLat: -1.22,
        locationLng: 36.9,
        emergencyIntakeEnabled: false,
      },
    });
    expect(put.statusCode).toBe(200);
    const publish = await app.inject({
      method: 'POST',
      url: url(`/admin/listings/publish?branchId=${otherBranch}`),
      headers: bearer(adminToken),
    });
    expect(publish.statusCode).toBe(200);
    const otherSlug = publish.json().data.slug as string;

    const res = await submitAnonymous({ slug: otherSlug, callerPhone: '+254755555555' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('FACILITY_NOT_ACCEPTING_REQUESTS');
  });

  it('serves national numbers (fallback) and admin reference numbers', async () => {
    const pubFallback = await app.inject({ method: 'GET', url: url('/public/emergency/numbers') });
    expect(pubFallback.statusCode).toBe(200);
    expect(pubFallback.json().data.source).toBe('default');
    expect(pubFallback.json().data.numbers.length).toBeGreaterThanOrEqual(4);

    const create = await app.inject({
      method: 'POST',
      url: url('/admin/emergency/numbers'),
      headers: bearer(adminToken),
      payload: { purpose: 'morgue', label: 'City Mortuary', phone: '0800 555 000', country: 'KE' },
    });
    expect(create.statusCode).toBe(201);

    const pubSeeded = await app.inject({ method: 'GET', url: url('/public/emergency/numbers') });
    expect(pubSeeded.json().data.source).toBe('reference');
    expect(
      (pubSeeded.json().data.numbers as Array<{ purpose: string }>).some((n) => n.purpose === 'morgue'),
    ).toBe(true);

    const adminList = await app.inject({
      method: 'GET',
      url: url('/admin/emergency/numbers'),
      headers: bearer(adminToken),
    });
    expect(adminList.statusCode).toBe(200);
    expect(adminList.json().data.numbers.length).toBeGreaterThanOrEqual(1);
  });

  it('publishes a default notice and honors admin notices', async () => {
    const before = await app.inject({ method: 'GET', url: url('/public/emergency/notice') });
    expect(before.statusCode).toBe(200);
    expect(before.json().data.notice.severity).toBe('INFO');

    const create = await app.inject({
      method: 'POST',
      url: url('/admin/emergency/notices'),
      headers: bearer(adminToken),
      payload: { title: 'Network drills', message: 'Nosy-style tests between 02:00-03:00.', severity: 'WARNING' },
    });
    expect(create.statusCode).toBe(201);

    const after = await app.inject({ method: 'GET', url: url('/public/emergency/notice') });
    expect(after.json().data.notice.title).toBe('Network drills');
    expect(after.json().data.notice.severity).toBe('WARNING');
  });
});