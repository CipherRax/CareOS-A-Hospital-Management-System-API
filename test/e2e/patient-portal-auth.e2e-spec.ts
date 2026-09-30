import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../support/test-app';
import { PrismaService } from '../../src/database/prisma.service';
import { newId } from '../../src/common/lib/uuidv7';
import { hashPassword } from '../../src/common/security/password';
import { DEFAULT_ROLE_LIST, ROLE_KEYS } from '../../src/common/auth/role-matrix';
import { PERMISSION_GROUPS } from '../../src/common/auth/permissions.catalog';
import { ErrorCodes } from '../../src/common/errors/codes';

/**
 * The patient portal with real authentication (ADR-051).
 *
 * Every other e2e suite injects a principal through the test header seam, which
 * is exactly how `TenantScope.patientId` could go years without a production
 * writer: the portal's own tests set the value directly, so every assertion
 * passed while no real login could ever produce it. This suite therefore builds
 * the app *without* `TestPrincipalModule` and drives the genuine chain for every
 * patient request — `/auth/invites/accept` → `/auth/login` → `JwtAuthGuard` →
 * `TenantGuard` → `PermissionsGuard` → the service's self-scope checks.
 */
describe('patient portal real auth (P13)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  const PASSWORD = 'PortalPass123!';
  const url = (p: string): string => `/api/v1${p}`;
  const bearer = (token: string): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
  });

  let org: string;
  let adminId: string;
  let adminToken: string;
  const roleIds: Record<string, string> = {};
  let seq = 0;
  const uniq = (): string => `${newId().slice(0, 8)}${(seq += 1).toString(36)}`;
  /** Seeded role id, failing loudly rather than writing an undefined FK. */
  const roleId = (key: string): string => {
    const id = roleIds[key];
    if (!id) throw new Error(`role ${key} was not seeded`);
    return id;
  };

  beforeAll(async () => {
    // No `tenantHeaders`: the real guard chain is the point of this suite.
    app = await createTestApp();
    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  beforeAll(async () => {
    const sc = prisma.unscoped();
    org = newId();
    await sc.organization.create({ data: { id: org, name: 'Portal Org' } });

    // Seed the role matrix: provisioning resolves `PATIENT` by key, and a real
    // deployment always has these rows.
    for (const definition of DEFAULT_ROLE_LIST) {
      const row = await sc.role.create({
        data: {
          id: newId(),
          organizationId: org,
          key: definition.key,
          name: definition.name,
          permissions: definition.permissions,
          isSystem:
            ROLE_KEYS.includes(definition.key) &&
            ['SUPER_ADMIN', 'OWNER', 'HOSPITAL_ADMIN'].includes(definition.key),
        },
      });
      roleIds[definition.key] = row.id;
    }

    adminId = newId();
    await sc.user.create({
      data: {
        id: adminId,
        organizationId: org,
        email: 'portal.admin@test.local',
        firstName: 'Portal',
        lastName: 'Admin',
        status: 'ACTIVE',
        passwordHash: await hashPassword(PASSWORD),
      },
    });
    await sc.userRole.create({
      data: {
        id: newId(),
        organizationId: org,
        userId: adminId,
        roleId: roleId('SUPER_ADMIN'),
      },
    });

    const login = await app.inject({
      method: 'POST',
      url: url('/auth/login'),
      payload: {
        organizationId: org,
        email: 'portal.admin@test.local',
        password: PASSWORD,
      },
    });
    expect(login.statusCode).toBe(200);
    adminToken = login.json().data.tokens.accessToken;
  }, 60_000);

  /** A patient record with no portal login yet. */
  const makePatient = async (label: string): Promise<string> => {
    const id = newId();
    await prisma.unscoped().patient.create({
      data: {
        id,
        organizationId: org,
        patientNumber: `P-${label}-${uniq()}`,
        firstName: 'Pia',
        lastName: 'Patient',
        sex: 'FEMALE',
        dateOfBirth: new Date('1990-04-02T00:00:00.000Z'),
        email: `${label}.${uniq()}@test.local`,
        createdAt: new Date('2026-01-05T00:00:00.000Z'),
      },
    });
    return id;
  };

  /** The whole real patient journey: provision → accept invite → log in. */
  const provisionAndLogin = async (
    patientId: string,
  ): Promise<{
    accessToken: string;
    userId: string;
    email: string;
    inviteToken: string;
  }> => {
    const res = await app.inject({
      method: 'POST',
      url: url(`/patients/${patientId}/portal-access`),
      headers: bearer(adminToken),
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const { userId, email, inviteToken } = res.json().data;

    const accepted = await app.inject({
      method: 'POST',
      url: url('/auth/invites/accept'),
      payload: { inviteToken, firstName: 'Pia', lastName: 'Patient', password: PASSWORD },
    });
    expect(accepted.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: url('/auth/login'),
      payload: { organizationId: org, email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    return {
      accessToken: login.json().data.tokens.accessToken,
      userId,
      email,
      inviteToken,
    };
  };

  // ── provisioning ─────────────────────────────────────────────────────────

  it('creates an invited login linked to the record, and audits it', async () => {
    const patientId = await makePatient('prov');
    const res = await app.inject({
      method: 'POST',
      url: url(`/patients/${patientId}/portal-access`),
      headers: bearer(adminToken),
      payload: {},
    });
    expect(res.json().data).toMatchObject({ patientId, status: 'INVITED' });

    // The link is the mechanism; assert it in the database rather than inferring
    // it from the response body.
    const patient = await prisma.unscoped().patient.findUniqueOrThrow({
      where: { id: patientId },
      select: { userId: true },
    });
    expect(patient.userId).toBe(res.json().data.userId);

    const user = await prisma.unscoped().user.findUniqueOrThrow({
      where: { id: patient.userId! },
      select: { userRoles: { select: { role: { select: { key: true } } } } },
    });
    expect(user.userRoles.map((r) => r.role.key)).toEqual(['PATIENT']);

    const audit = await prisma.unscoped().auditLog.findFirstOrThrow({
      where: { organizationId: org, action: 'patients.portal_access.provision' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.resourceId).toBe(patientId);
    expect(audit.userId).toBe(adminId);
  });

  it('refuses to provision a second login for the same record', async () => {
    const patientId = await makePatient('twice');
    await app.inject({
      method: 'POST',
      url: url(`/patients/${patientId}/portal-access`),
      headers: bearer(adminToken),
      payload: {},
    });
    const res = await app.inject({
      method: 'POST',
      url: url(`/patients/${patientId}/portal-access`),
      headers: bearer(adminToken),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });

  it('refuses when the record has no email and none is supplied', async () => {
    const id = newId();
    await prisma.unscoped().patient.create({
      data: {
        id,
        organizationId: org,
        patientNumber: `P-noemail-${uniq()}`,
        firstName: 'No',
        lastName: 'Email',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: url(`/patients/${id}/portal-access`),
      headers: bearer(adminToken),
      payload: {},
    });
    expect(res.statusCode).toBe(400);

    // Supplied explicitly, it goes through.
    const ok = await app.inject({
      method: 'POST',
      url: url(`/patients/${id}/portal-access`),
      headers: bearer(adminToken),
      payload: { email: `supplied.${uniq()}@test.local` },
    });
    expect(ok.statusCode).toBe(201);
  });

  it('refuses a caller without the records-steward permission', async () => {
    // `patients.manage` is the control: it is the same authority that gates
    // merging a record and confirming a duplicate. A caller who cannot rewrite a
    // patient's identity must not be able to decide who logs in as them — and
    // note that holding `patients.read` is deliberately *not* enough, which is
    // why this is a route permission and not the subset test used elsewhere.
    const sc = prisma.unscoped();
    const email = `officer.${uniq()}@test.local`;
    const officer = await sc.user.create({
      data: {
        id: newId(),
        organizationId: org,
        email,
        firstName: 'Bill',
        lastName: 'Clerk',
        status: 'ACTIVE',
        passwordHash: await hashPassword(PASSWORD),
      },
    });
    await sc.userRole.create({
      data: {
        id: newId(),
        organizationId: org,
        userId: officer.id,
        roleId: roleId('RECORDS_OFFICER'),
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: url('/auth/login'),
      payload: { organizationId: org, email, password: PASSWORD },
    });

    const patientId = await makePatient('officer');
    const res = await app.inject({
      method: 'POST',
      url: url(`/patients/${patientId}/portal-access`),
      headers: bearer(login.json().data.tokens.accessToken),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe(ErrorCodes.PERMISSION_DENIED);
  });

  it('refuses a caller in another organization', async () => {
    const sc = prisma.unscoped();
    const otherOrg = newId();
    await sc.organization.create({ data: { id: otherOrg, name: 'Other Org' } });
    const email = `outsider.${uniq()}@test.local`;
    const outsider = await sc.user.create({
      data: {
        id: newId(),
        organizationId: otherOrg,
        email,
        firstName: 'Out',
        lastName: 'Sider',
        status: 'ACTIVE',
        passwordHash: await hashPassword(PASSWORD),
      },
    });
    await sc.userRole.create({
      data: {
        id: newId(),
        organizationId: otherOrg,
        userId: outsider.id,
        roleId: roleId('SUPER_ADMIN'),
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: url('/auth/login'),
      payload: { organizationId: otherOrg, email, password: PASSWORD },
    });
    const patientId = await makePatient('crossorg');
    const res = await app.inject({
      method: 'POST',
      url: url(`/patients/${patientId}/portal-access`),
      headers: bearer(login.json().data.tokens.accessToken),
      payload: {},
    });
    // A super admin elsewhere still cannot reach another hospital's record.
    expect(res.statusCode).toBe(404);
  });

  it('drops the link when a record with portal access is merged away', async () => {
    // Two records being merged are suspected to be the same person, so a live
    // login left on the source would point a real human at a MERGED duplicate.
    const sc = prisma.unscoped();
    const source = await makePatient('mergesrc');
    const journey = await provisionAndLogin(source);

    const before = await app.inject({
      method: 'GET',
      url: url('/portal/me'),
      headers: bearer(journey.accessToken),
    });
    expect(before.statusCode).toBe(200);

    const target = await makePatient('mergetgt');
    const merged = await app.inject({
      method: 'POST',
      url: url(`/patients/${target}/merge`),
      headers: bearer(adminToken),
      payload: { sourcePatientId: source, reason: 'Confirmed duplicate record' },
    });
    expect(merged.statusCode).toBe(200);

    const after = await sc.patient.findUniqueOrThrow({
      where: { id: source },
      select: { userId: true, status: true },
    });
    expect(after.userId).toBeNull();
    expect(after.status).toBe('MERGED');

    // And the still-unexpired token stops resolving to a patient, immediately.
    const me = await app.inject({
      method: 'GET',
      url: url('/portal/me'),
      headers: bearer(journey.accessToken),
    });
    expect(me.statusCode).toBe(403);
    expect(me.json().error.code).toBe(ErrorCodes.PATIENT_ACCESS_DENIED);
  });

  // ── the portal, authenticated for real ───────────────────────────────────

  it('reads its own record, and only demographics, through the portal', async () => {
    const patientId = await makePatient('me');
    const { accessToken } = await provisionAndLogin(patientId);

    const res = await app.inject({
      method: 'GET',
      url: url('/portal/me'),
      headers: bearer(accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.patient.id).toBe(patientId);
    // The projection is an allowlist, so assert the exact key set: a clinical
    // field appearing here would mean the serializer had been widened.
    expect(Object.keys(res.json().data.patient).sort()).toEqual(
      [
        'createdAt',
        'dateOfBirth',
        'email',
        'firstName',
        'id',
        'lastName',
        'patientNumber',
        'phone',
        'status',
      ].sort(),
    );
  });

  it('resolves the patient on /auth/me, which used to be hardcoded null', async () => {
    const patientId = await makePatient('authme');
    const { accessToken } = await provisionAndLogin(patientId);

    const res = await app.inject({
      method: 'GET',
      url: url('/auth/me'),
      headers: bearer(accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.patient).toMatchObject({ id: patientId });
    expect(res.json().data.roles).toEqual(['PATIENT']);
    // A staff login still resolves no patient, so the field did not just become
    // populated for everyone.
    const staff = await app.inject({
      method: 'GET',
      url: url('/auth/me'),
      headers: bearer(adminToken),
    });
    expect(staff.json().data.patient).toBeNull();
  });

  it('cannot read another patient record, though it holds patients.read', async () => {
    const mine = await makePatient('mine');
    const theirs = await makePatient('theirs');
    const { accessToken } = await provisionAndLogin(mine);

    const res = await app.inject({
      method: 'GET',
      url: url(`/patients/${theirs}`),
      headers: bearer(accessToken),
    });
    // Denied by ownership, not by permission: the role holds `patients.read`, so
    // this is the self-scope doing the narrowing.
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe(ErrorCodes.PATIENT_ACCESS_DENIED);
  });

  it('sees only itself in the patient list', async () => {
    const mine = await makePatient('listmine');
    await makePatient('listother');
    const { accessToken } = await provisionAndLogin(mine);

    const res = await app.inject({
      method: 'GET',
      url: url('/patients'),
      headers: bearer(accessToken),
    });
    expect(res.statusCode).toBe(200);
    // The transform unwraps the single-key page envelope, so `data` is the array.
    const rows = res.json().data as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(mine);
  });

  it('reaches the previously unreachable queue status', async () => {
    // This route needs `queue.read`, which PATIENT did not hold, so the
    // patient-aware branch could not run for a real principal (ADR-051).
    const { accessToken } = await provisionAndLogin(await makePatient('queue'));
    const res = await app.inject({
      method: 'GET',
      url: url('/queue/status'),
      headers: bearer(accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ queued: false });
  });

  it('loses its scope as soon as the link is removed, without waiting for expiry', async () => {
    // The reason patientId is resolved per request instead of being trusted from
    // a token claim: revocation is immediate, not effective at token expiry.
    const patientId = await makePatient('revoke');
    const { accessToken } = await provisionAndLogin(patientId);

    const before = await app.inject({
      method: 'GET',
      url: url('/portal/me'),
      headers: bearer(accessToken),
    });
    expect(before.statusCode).toBe(200);

    await prisma
      .unscoped()
      .patient.update({ where: { id: patientId }, data: { userId: null } });

    const after = await app.inject({
      method: 'GET',
      url: url('/portal/me'),
      headers: bearer(accessToken),
    });
    expect(after.statusCode).toBe(403);
    expect(after.json().error.code).toBe(ErrorCodes.PATIENT_ACCESS_DENIED);
  });

  it('withdraws the scope when the PATIENT role is removed, even with the link intact', async () => {
    // The conjunction: neither half alone grants a scope, so removing the role
    // has to be sufficient to withdraw it.
    const patientId = await makePatient('norole');
    const { accessToken, userId } = await provisionAndLogin(patientId);

    const before = await app.inject({
      method: 'GET',
      url: url('/portal/me'),
      headers: bearer(accessToken),
    });
    expect(before.statusCode).toBe(200);

    await prisma
      .unscoped()
      .userRole.deleteMany({ where: { userId, role: { key: 'PATIENT' } } });

    const after = await app.inject({
      method: 'GET',
      url: url('/portal/me'),
      headers: bearer(accessToken),
    });
    expect(after.statusCode).toBe(403);
  });

  it('gives a PATIENT-role login with no linked record no patient scope', async () => {
    const sc = prisma.unscoped();
    const email = `norecord.${uniq()}@test.local`;
    const user = await sc.user.create({
      data: {
        id: newId(),
        organizationId: org,
        email,
        firstName: 'No',
        lastName: 'Record',
        status: 'ACTIVE',
        passwordHash: await hashPassword(PASSWORD),
      },
    });
    await sc.userRole.create({
      data: {
        id: newId(),
        organizationId: org,
        userId: user.id,
        roleId: roleId('PATIENT'),
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: url('/auth/login'),
      payload: { organizationId: org, email, password: PASSWORD },
    });

    const res = await app.inject({
      method: 'GET',
      url: url('/portal/me'),
      headers: bearer(login.json().data.tokens.accessToken),
    });
    // Fails closed, rather than matching an empty query and reporting success.
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe(ErrorCodes.PATIENT_ACCESS_DENIED);
  });

  it('refuses an invite digest in place of the invite token', async () => {
    // Guards the assumption the whole journey rests on: only the emailed token
    // activates the account, so the stored hash is not itself a credential.
    const patientId = await makePatient('digest');
    const res = await app.inject({
      method: 'POST',
      url: url(`/patients/${patientId}/portal-access`),
      headers: bearer(adminToken),
      payload: {},
    });
    const digest = (
      await prisma
        .unscoped()
        .user.findUniqueOrThrow({
          where: { id: res.json().data.userId },
          select: { inviteTokenHash: true },
        })
    ).inviteTokenHash!;

    const accepted = await app.inject({
      method: 'POST',
      url: url('/auth/invites/accept'),
      payload: {
        inviteToken: digest,
        firstName: 'Pia',
        lastName: 'Patient',
        password: PASSWORD,
      },
    });
    expect(accepted.statusCode).toBe(400);
  });

  // ── separation ───────────────────────────────────────────────────────────

  it('refuses a staff token on the portal, because no staff role holds portal.read', async () => {
    const res = await app.inject({
      method: 'GET',
      url: url('/portal/me'),
      headers: bearer(adminToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('keeps every permission the PATIENT role holds inside its own data', () => {
    // A static check on the matrix, so widening the role later is a deliberate
    // edit rather than an accident.
    const patient = DEFAULT_ROLE_LIST.find((d) => d.key === 'PATIENT');
    expect(patient).toBeDefined();
    expect(patient!.permissions).toContain(PERMISSION_GROUPS.portal.read);
    expect(patient!.permissions).not.toContain(PERMISSION_GROUPS.patients.manage);
    expect(patient!.permissions).not.toContain(PERMISSION_GROUPS.users.manage);
    expect(patient!.permissions).not.toContain(PERMISSION_GROUPS.roles.manage);
  });
});
