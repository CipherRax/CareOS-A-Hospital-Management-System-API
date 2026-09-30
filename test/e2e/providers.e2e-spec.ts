import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, principalHeaders } from '../support/test-app';
import { PrismaService } from '../../src/database/prisma.service';
import { newId } from '../../src/common/lib/uuidv7';
import { ErrorCodes } from '../../src/common/errors/codes';

let seq = 0;
/** Unique per spec run: a uuidv7 prefix alone collides within a millisecond. */
const uniq = (): string => `${newId().slice(0, 8)}${(seq += 1).toString(36)}`;

const READ = ['providers.read'];

/**
 * The next Monday as both a date and a template index. Schedules index days as
 * a `WorkdayIndex` with Monday = 0, which is not the same as `Date.getDay()`,
 * so the two are computed together rather than by hand at each call site.
 */
const nextMonday = (): { date: string; dayOfWeek: number } => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((1 - d.getUTCDay() + 7) % 7 || 7));
  return { date: d.toISOString().slice(0, 10), dayOfWeek: 0 };
};
const MANAGE = ['providers.manage'];

/** The provider directory, onboarding, and the bookability gate (ADR-050). */
describe('provider directory & onboarding (P12)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  let org: string;
  let user: string;
  let branch: string;
  let department: string;
  let patient: string;

  const url = (p: string): string => `/api/v1${p}`;

  beforeAll(async () => {
    app = await createTestApp({ tenantHeaders: true });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const sc = prisma.unscoped();
    org = newId();
    user = newId();
    branch = newId();
    department = newId();
    patient = newId();

    await sc.organization.create({ data: { id: org, name: `Org ${org.slice(0, 6)}` } });
    await sc.user.create({
      data: {
        id: user,
        organizationId: org,
        email: `admin.${org}@test.local`,
        firstName: 'Ada',
        lastName: 'Admin',
        status: 'ACTIVE',
      },
    });
    await sc.branch.create({
      data: { id: branch, organizationId: org, name: 'Main', code: 'M' },
    });
    await sc.department.create({
      data: { id: department, organizationId: org, name: 'Outpatient', kind: 'STANDARD' },
    });
    await sc.patient.create({
      data: {
        id: patient,
        organizationId: org,
        patientNumber: `P-${patient.slice(0, 8)}`,
        firstName: 'Pat',
        lastName: 'Ient',
        sex: 'FEMALE',
        createdAt: new Date('2026-09-15T00:00:00.000Z'),
      },
    });

    // The clinician role that makes someone a provider at all.
    await sc.role.create({
      data: { id: newId(), organizationId: org, key: 'DOCTOR', name: 'Doctor' },
    });
  });

  // Return type left to inference, as the other e2e specs do: annotating it
  // means hand-maintaining a shape that drifts from the API.
  const onboard = (over: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: url('/providers'),
      headers: principalHeaders({
        organizationId: org,
        userId: user,
        permissions: MANAGE,
      }),
      payload: {
        email: `doc.${uniq()}@test.local`,
        firstName: 'Bea',
        lastName: 'Doctor',
        staffNumber: `S-${uniq()}`,
        professionalTitle: 'Physician',
        specialization: 'General Practice',
        roleKeys: ['DOCTOR'],
        branchIds: [branch],
        departmentIds: [department],
        ...over,
      },
    });

  // ── onboarding ───────────────────────────────────────────────────────────

  it('onboards a provider with profile, role, assignments and audit in one write', async () => {
    const res = await onboard();
    expect(res.statusCode).toBe(201);
    const provider = res.json().data;

    expect(provider.id).toBeDefined();
    expect(provider.roleKeys).toEqual(['DOCTOR']);
    expect(provider.staffNumber).toBeDefined();
    expect(provider.specialization).toBe('General Practice');
    expect(provider.branchIds).toEqual([branch]);
    expect(provider.departmentIds).toEqual([department]);
    // Activation is the identity proof, so a fresh provider is invited, not
    // bookable. The directory reports that rather than pretending otherwise.
    expect(provider.status).toBe('INVITED');
    expect(provider.bookable).toBe(false);
    expect(provider.ineligibleReason).toBe('USER_NOT_ACTIVE');

    const audit = await prisma.unscoped().auditLog.findFirstOrThrow({
      where: { organizationId: org, action: 'providers.onboarded' },
    });
    expect(audit.resourceId).toBe(provider.id);
  });

  it('seeds an availability template as part of onboarding', async () => {
    const res = await onboard({
      availability: [
        {
          dayOfWeek: 1,
          startMinutes: 540,
          endMinutes: 720,
          slotDurationMinutes: 30,
          capacity: 2,
          branchId: branch,
          departmentId: department,
        },
      ],
    });
    expect(res.statusCode).toBe(201);
    const detail = await app.inject({
      method: 'GET',
      url: url(`/providers/${res.json().data.id}`),
      headers: principalHeaders({ organizationId: org, userId: user, permissions: READ }),
    });
    expect(detail.json().data.availability).toHaveLength(1);
    expect(detail.json().data.availability[0]).toMatchObject({
      dayOfWeek: 1,
      startMinutes: 540,
      capacity: 2,
    });
  });

  it('refuses to seed availability for a branch the provider was not given', async () => {
    // Otherwise the template would point at a branch the provider does not
    // practise in, and the slot would be unreachable by anyone.
    const other = newId();
    await prisma.unscoped().branch.create({
      data: { id: other, organizationId: org, name: 'Annex', code: 'A' },
    });
    const res = await onboard({
      availability: [
        {
          dayOfWeek: 1,
          startMinutes: 540,
          endMinutes: 600,
          slotDurationMinutes: 30,
          branchId: other,
          departmentId: department,
        },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('refuses a duplicate email and a duplicate staff number, naming the fix', async () => {
    const first = await onboard();
    expect(first.statusCode).toBe(201);
    const email = `dup.${uniq()}@test.local`;

    const a = await onboard({ email, staffNumber: `S-${uniq()}` });
    expect(a.statusCode).toBe(201);
    const b = await onboard({ email, staffNumber: `S-${uniq()}` });
    expect(b.statusCode).toBe(409);
    expect(b.json().error.message).toMatch(/PATCH \/providers\/:id/);

    const c = await onboard({
      email: `x.${uniq()}@t.local`,
      staffNumber: first.json().data.staffNumber,
    });
    expect(c.statusCode).toBe(409);
    expect(c.json().error.message).toMatch(/staff number/i);
  });

  it('refuses a role that does not exist rather than onboarding someone unroled', async () => {
    const res = await onboard({ roleKeys: ['NURSE'] });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe(ErrorCodes.RESOURCE_NOT_FOUND);
  });

  it('creates nothing when onboarding fails partway', async () => {
    const before = await prisma.unscoped().user.count({ where: { organizationId: org } });
    await onboard({ roleKeys: ['NURSE'] });
    const after = await prisma.unscoped().user.count({ where: { organizationId: org } });
    // One transaction, or this is a provider with no profile and no roles.
    expect(after).toBe(before);
  });

  // ── directory ────────────────────────────────────────────────────────────

  it('lists only providers, and hides the invited ones by default', async () => {
    const plain = newId();
    await prisma.unscoped().user.create({
      data: {
        id: plain,
        organizationId: org,
        email: `plain.${org}@test.local`,
        firstName: 'Not',
        lastName: 'AProvider',
        status: 'ACTIVE',
      },
    });
    await onboard();

    const listed = await app.inject({
      method: 'GET',
      url: url('/providers'),
      headers: principalHeaders({ organizationId: org, userId: user, permissions: READ }),
    });
    expect(listed.statusCode).toBe(200);
    // The non-provider user is not in a provider directory, however active.
    expect(listed.json().data).toHaveLength(0);
  });

  it('shows a non-bookable provider with the reason when asked for all', async () => {
    await onboard();
    const all = await app.inject({
      method: 'GET',
      url: url('/providers?bookableOnly=false'),
      headers: principalHeaders({ organizationId: org, userId: user, permissions: READ }),
    });
    expect(all.json().data).toHaveLength(1);
    expect(all.json().data[0]).toMatchObject({
      bookable: false,
      ineligibleReason: 'USER_NOT_ACTIVE',
    });
  });

  it('searches across name, staff number and specialization', async () => {
    await onboard({ firstName: 'Bea', lastName: 'Doctor', staffNumber: 'STAFF-77' });
    for (const term of ['Doctor', 'STAFF-77', 'General Practice']) {
      const res = await app.inject({
        method: 'GET',
        url: url(`/providers?q=${encodeURIComponent(term)}&bookableOnly=false`),
        headers: principalHeaders({
          organizationId: org,
          userId: user,
          permissions: READ,
        }),
      });
      expect(res.json().data).toHaveLength(1);
    }
  });

  it('activates a provider so they become bookable, and the reason clears', async () => {
    const created = (await onboard()).json().data;
    await prisma
      .unscoped()
      .user.update({ where: { id: created.id }, data: { status: 'ACTIVE' } });

    const res = await app.inject({
      method: 'GET',
      url: url(`/providers/${created.id}`),
      headers: principalHeaders({ organizationId: org, userId: user, permissions: READ }),
    });
    expect(res.json().data).toMatchObject({ bookable: true, status: 'ACTIVE' });
    expect(res.json().data.ineligibleReason).toBeUndefined();
  });

  it('reports each distinct ineligibility reason', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ employmentStatus: 'TERMINATED' }, 'TERMINATED'],
      [{ availability: false }, 'UNAVAILABLE'],
    ];
    for (const [patch, reason] of cases) {
      const created = (await onboard()).json().data;
      await prisma
        .unscoped()
        .user.update({ where: { id: created.id }, data: { status: 'ACTIVE' } });
      const patched = await app.inject({
        method: 'PATCH',
        url: url(`/providers/${created.id}`),
        headers: principalHeaders({
          organizationId: org,
          userId: user,
          permissions: MANAGE,
        }),
        payload: patch,
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().data.bookable).toBe(false);
      expect(patched.json().data.ineligibleReason).toBe(reason);
    }
  });

  // ── tenancy and permissions ──────────────────────────────────────────────

  it('does not leak a provider across organizations', async () => {
    const created = (await onboard()).json().data;

    const otherOrg = newId();
    const otherUser = newId();
    await prisma
      .unscoped()
      .organization.create({ data: { id: otherOrg, name: 'Other' } });
    await prisma.unscoped().user.create({
      data: {
        id: otherUser,
        organizationId: otherOrg,
        email: `o.${otherOrg}@test.local`,
        firstName: 'Ot',
        lastName: 'Her',
        status: 'ACTIVE',
      },
    });

    const got = await app.inject({
      method: 'GET',
      url: url(`/providers/${created.id}`),
      headers: principalHeaders({
        organizationId: otherOrg,
        userId: otherUser,
        permissions: READ,
      }),
    });
    expect(got.statusCode).toBe(404);
  });

  it('requires providers.read to browse and providers.manage to onboard', async () => {
    // No principal at all is unauthenticated (401). 403 is for an authenticated
    // caller lacking the permission, which the two cases below cover.
    const anon = await app.inject({ method: 'GET', url: url('/providers') });
    expect(anon.statusCode).toBe(401);

    const readOnly = await app.inject({
      method: 'POST',
      url: url('/providers'),
      headers: principalHeaders({ organizationId: org, userId: user, permissions: READ }),
      payload: {},
    });
    expect(readOnly.statusCode).toBe(403);
  });

  // ── the gate the whole patch exists for ──────────────────────────────────

  it('stops offering slots once a provider stops being bookable', async () => {
    const monday = nextMonday();
    const created = (
      await onboard({
        availability: [
          {
            dayOfWeek: monday.dayOfWeek,
            startMinutes: 540,
            endMinutes: 720,
            slotDurationMinutes: 30,
            capacity: 2,
            branchId: branch,
            departmentId: department,
          },
        ],
      })
    ).json().data;
    await prisma
      .unscoped()
      .user.update({ where: { id: created.id }, data: { status: 'ACTIVE' } });

    const slots = () =>
      app.inject({
        method: 'GET',
        url: url(
          `/schedules/slots?providerId=${created.id}&branchId=${branch}` +
            `&departmentId=${department}&date=${monday.date}`,
        ),
        // Slot discovery is a separate permission from directory browsing: the
        // roster is not the schedule.
        headers: principalHeaders({
          organizationId: org,
          userId: user,
          permissions: [...READ, 'schedules.read'],
        }),
      });

    // Employed and available, so there is something to book.
    const before = await slots();
    expect(before.statusCode).toBe(200);
    // 540→720 at 30 minutes is six slots, each with room for two bookings.
    expect(before.json().data.slots).toHaveLength(6);
    expect(before.json().data.slots[0]).toMatchObject({ capacity: 2 });

    // The directory still shows them, and says why they cannot be booked.
    const gone = await app.inject({
      method: 'PATCH',
      url: url(`/providers/${created.id}`),
      headers: principalHeaders({
        organizationId: org,
        userId: user,
        permissions: MANAGE,
      }),
      payload: { employmentStatus: 'TERMINATED' },
    });
    expect(gone.json().data).toMatchObject({
      bookable: false,
      ineligibleReason: 'TERMINATED',
    });

    // Silence, not an empty list: an empty array reads as "they are free, try
    // another date", which is how a terminated provider keeps getting booked.
    const after = await slots();
    expect(after.statusCode).toBe(409);
    expect(after.json().error.code).toBe(ErrorCodes.PROVIDER_NOT_BOOKABLE);
  });

  it('will not return a detail view for a user who is not a provider', async () => {
    // Same 404 as a missing id. Distinguishing them would confirm that an
    // unrelated staff member exists in this organization.
    const plain = newId();
    await prisma.unscoped().user.create({
      data: {
        id: plain,
        organizationId: org,
        email: `reception.${org}@test.local`,
        firstName: 'Rec',
        lastName: 'Eptionist',
        status: 'ACTIVE',
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: url(`/providers/${plain}`),
      headers: principalHeaders({ organizationId: org, userId: user, permissions: READ }),
    });
    expect(res.statusCode).toBe(404);
  });

  it('will not let a manager edit someone who is not a provider', async () => {
    const plain = newId();
    await prisma.unscoped().user.create({
      data: {
        id: plain,
        organizationId: org,
        email: `billing.${org}@test.local`,
        firstName: 'Bil',
        lastName: 'Ler',
        status: 'ACTIVE',
      },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: url(`/providers/${plain}`),
      headers: principalHeaders({
        organizationId: org,
        userId: user,
        permissions: MANAGE,
      }),
      payload: { specialization: 'Billing' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires at least one branch and department', async () => {
    // Bookings are scoped to a branch and department, so a provider assigned to
    // neither could never be offered a slot — onboarded but unusable.
    // A schema rejection, so it surfaces as BAD_REQUEST rather than the
    // service-thrown VALIDATION_ERROR; both are 400.
    const noBranch = await onboard({ branchIds: [] });
    expect(noBranch.statusCode).toBe(400);
    expect(noBranch.json().error.code).toBe(ErrorCodes.BAD_REQUEST);

    const noDepartment = await onboard({ departmentIds: [] });
    expect(noDepartment.statusCode).toBe(400);

    const omitted = await app.inject({
      method: 'POST',
      url: url('/providers'),
      headers: principalHeaders({
        organizationId: org,
        userId: user,
        permissions: MANAGE,
      }),
      payload: {
        email: `nob.${uniq()}@test.local`,
        firstName: 'No',
        lastName: 'Branch',
        staffNumber: `S-${uniq()}`,
        roleKeys: ['DOCTOR'],
        departmentIds: [department],
      },
    });
    expect(omitted.statusCode).toBe(400);
  });

  it('requires a read-only caller from onboarding even with manage elsewhere', async () => {
    // Guard sanity: a caller holding staff.manage is not implicitly a provider
    // administrator.
    const res = await app.inject({
      method: 'POST',
      url: url('/providers'),
      headers: principalHeaders({
        organizationId: org,
        userId: user,
        permissions: ['staff.manage', 'appointments.create'],
      }),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});
