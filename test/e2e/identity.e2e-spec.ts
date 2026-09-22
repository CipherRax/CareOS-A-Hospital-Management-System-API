import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { newId } from '../../src/common/lib/uuidv7';
import { hashPassword } from '../../src/common/security/password';
import { generateTotpCode } from '../../src/common/security/totp';

const bearer = (token: string) => ({
  Authorization: `Bearer ${token}`,
});

/**
 * Real-auth acceptance for Phase 1: login/session/MFA flows run through the
 * actual guard chain (test-principal mode is OFF). Covers the three brief
 * security gates: cross-org denial, privilege-escalation denial, and
 * refresh-token reuse revoking the whole session family.
 */
let _recoveryCodes: string[] | undefined;

describe('identity & access (Phase 1)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let env: Env;
  let orgA: string;
  let orgB: string;
  let adminId: string;
  let adminRoleId: string;
  let doctorRoleId: string;
  let limitedRoleId: string;

  const url = (path: string): string => `${env.API_PREFIX}${path}`;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    env = app.get(ENV);
    const sc = prisma.unscoped();

    orgA = newId();
    orgB = newId();
    await sc.organization.createMany({
      data: [
        { id: orgA, name: 'Identity Org A' },
        { id: orgB, name: 'Identity Org B' },
      ],
    });

    const passwordHash = await hashPassword('DemoPass123!');

    // Org A admin: everything from the identity/access catalog.
    const adminRole = {
      id: newId(),
      organizationId: orgA,
      key: 'SUPER_ADMIN',
      name: 'Super Admin',
      permissions: [
        'organizations.read',
        'organizations.manage',
        'users.read',
        'users.manage',
        'roles.read',
        'roles.manage',
        'sessions.read',
        'sessions.manage',
        'staff.read',
        'staff.manage',
        'branches.read',
        'departments.read',
        'patients.read',
        'patients.create',
        'appointments.read',
        'clinical_notes.read',
        'reports.read',
      ],
      isSystem: true,
    };
    const doctorRole = {
      id: newId(),
      organizationId: orgA,
      key: 'DOCTOR',
      name: 'Doctor',
      permissions: [
        'patients.read',
        'patients.create',
        'appointments.read',
        'clinical_notes.read',
        'reports.read',
      ],
      isSystem: false,
    };
    const limitedRole = {
      id: newId(),
      organizationId: orgA,
      key: 'RECORDS_OFFICER',
      name: 'Records Officer',
      permissions: ['users.read'],
      isSystem: false,
    };
    adminRoleId = adminRole.id;
    doctorRoleId = doctorRole.id;
    limitedRoleId = limitedRole.id;
    await sc.role.createMany({
      data: [
        adminRole,
        doctorRole,
        limitedRole,
        {
          id: newId(),
          organizationId: orgB,
          key: 'SUPER_ADMIN',
          name: 'Super Admin',
          permissions: ['users.read'],
          isSystem: true,
        },
      ],
    });

    const admin = await sc.user.create({
      data: {
        id: newId(),
        organizationId: orgA,
        email: 'admin@identity.test',
        firstName: 'Admin',
        lastName: 'One',
        status: 'ACTIVE',
        passwordHash,
      },
    });
    adminId = admin.id;
    await sc.userRole.createMany({
      data: [
        { id: newId(), organizationId: orgA, userId: admin.id, roleId: adminRoleId },
      ],
    });

    // Org B user: a parallel "super admin" for the OTHER tenant.
    const otherOrg = await sc.user.create({
      data: {
        id: newId(),
        organizationId: orgB,
        email: 'admin-b@identity.test',
        firstName: 'Other',
        lastName: 'Admin',
        status: 'ACTIVE',
        passwordHash,
      },
    });
    const otherRole = await sc.role.findFirstOrThrow({
      where: { organizationId: orgB },
      select: { id: true },
    });
    await sc.userRole.create({
      data: {
        id: newId(),
        organizationId: orgB,
        userId: otherOrg.id,
        roleId: otherRole.id,
      },
    });

    // Limited user (users.read only).
    const limited = await sc.user.create({
      data: {
        id: newId(),
        organizationId: orgA,
        email: 'limited@identity.test',
        firstName: 'Lena',
        lastName: 'Read',
        status: 'ACTIVE',
        passwordHash,
      },
    });
    await sc.userRole.createMany({
      data: [
        { id: newId(), organizationId: orgA, userId: limited.id, roleId: limitedRoleId },
      ],
    });

    // Half-admin: can manage users/roles but holds no clinical permissions –
    // inviting a DOCTOR must trip the no-escalation rule.
    const halfAdminRoleId = newId();
    await sc.role.create({
      data: {
        id: halfAdminRoleId,
        organizationId: orgA,
        key: 'HALF_ADMIN',
        name: 'Half Admin',
        permissions: [
          'organizations.read',
          'users.read',
          'users.manage',
          'roles.read',
          'roles.manage',
          'staff.read',
        ],
        isSystem: false,
      },
    });
    const halfAdmin = await sc.user.create({
      data: {
        id: newId(),
        organizationId: orgA,
        email: 'half@identity.test',
        firstName: 'Hale',
        lastName: 'Admin',
        status: 'ACTIVE',
        passwordHash,
      },
    });
    await sc.userRole.createMany({
      data: [
        {
          id: newId(),
          organizationId: orgA,
          userId: halfAdmin.id,
          roleId: halfAdminRoleId,
        },
      ],
    });

    const mfaUser = await sc.user.create({
      data: {
        id: newId(),
        organizationId: orgA,
        email: 'mfa@identity.test',
        firstName: 'Mfa',
        lastName: 'User',
        status: 'ACTIVE',
        passwordHash,
      },
    });
    await sc.userRole.createMany({
      data: [
        { id: newId(), organizationId: orgA, userId: mfaUser.id, roleId: limitedRoleId },
      ],
    });

    // Dedicated account for the lockout test (its lock must not spill into MFA flows).
    const lockoutUser = await sc.user.create({
      data: {
        id: newId(),
        organizationId: orgA,
        email: 'lockout@identity.test',
        firstName: 'Lock',
        lastName: 'Out',
        status: 'ACTIVE',
        passwordHash,
      },
    });
    await sc.userRole.createMany({
      data: [
        {
          id: newId(),
          organizationId: orgA,
          userId: lockoutUser.id,
          roleId: limitedRoleId,
        },
      ],
    });
  }, 30_000);

  afterAll(async () => {
    // audit_logs + outbox are append-only/referencing; container is disposable.
    await app.close();
  });

  const login = async (email: string, password: string, organizationId: string) =>
    app.inject({
      method: 'POST',
      url: url('/auth/login'),
      payload: { organizationId, email, password },
    });

  async function adminLogin(): Promise<{ accessToken: string; refreshToken: string }> {
    const res = await login('admin@identity.test', 'DemoPass123!', orgA);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    return {
      accessToken: data.tokens.accessToken,
      refreshToken: data.tokens.refreshToken,
    };
  }

  it('logs in with correct credentials and reaches protected routes with the access token', async () => {
    const res = await login('admin@identity.test', 'DemoPass123!', orgA);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.user.email).toBe('admin@identity.test');
    expect(data.tokens.accessToken).toBeTruthy();
    expect(data.tokens.refreshToken).toBeTruthy();
    expect(data.session.familyId).toBeTruthy();

    const me = await app.inject({
      method: 'GET',
      url: url('/organizations/me'),
      headers: bearer(data.tokens.accessToken),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.organization.id).toBe(orgA);
  });

  it('refuses unknown credentials with a generic message and burns timing', async () => {
    const res = await login('admin@identity.test', 'NopeWrong!', orgA);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toContain('credentials');
  });

  it('locks the account after repeated failures (423 framework status)', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await login('lockout@identity.test', 'NopeWrong!', orgA);
      expect(res.statusCode).toBe(401);
    }
    // The next attempt trips the lockout check before password verification.
    const locked = await login('lockout@identity.test', 'DemoPass123!', orgA);
    expect(locked.statusCode).toBe(423);
    expect(locked.json().error.code).toBe('ACCOUNT_LOCKED');
  });

  it('denies a cross-organization read (404, never leaks foreign data)', async () => {
    const token = (await adminLogin()).accessToken;

    // Admin (org A) tries to read org B's user row by id.
    const foreign = await prisma.unscoped().user.findFirstOrThrow({
      where: { organizationId: orgB },
      select: { id: true },
    });
    const res = await app.inject({
      method: 'GET',
      url: url(`/users/${foreign.id}`),
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(404);

    // And org B's own admin cannot see org A's row either.
    const bLogin = await login('admin-b@identity.test', 'DemoPass123!', orgB);
    expect(bLogin.statusCode).toBe(200);
    const resB = await app.inject({
      method: 'GET',
      url: url(`/users/${adminId}`),
      headers: bearer(bLogin.json().data.tokens.accessToken),
    });
    expect(resB.statusCode).toBe(404);
  });

  it('denies protected management routes to a caller lacking the permission', async () => {
    const limited = await login('limited@identity.test', 'DemoPass123!', orgA);
    expect(limited.statusCode).toBe(200);
    const token = limited.json().data.tokens.accessToken;

    const res = await app.inject({
      method: 'POST',
      url: url('/users'),
      headers: bearer(token),
      payload: {
        email: 'nope@identity.test',
        firstName: 'N',
        lastName: 'O',
        roleIds: [limitedRoleId],
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERMISSION_DENIED');
  });

  it('rejects privilege escalation at the service level (no self-mint of a Doctor)', async () => {
    const half = await login('half@identity.test', 'DemoPass123!', orgA);
    expect(half.statusCode).toBe(200);
    const token = half.json().data.tokens.accessToken;

    const res = await app.inject({
      method: 'POST',
      url: url('/users'),
      headers: bearer(token),
      payload: {
        email: 'new-doc@identity.test',
        firstName: 'New',
        lastName: 'Doc',
        roleIds: [doctorRoleId], // DOCTOR holds patients.* which half lacks
        staff: { staffNumber: 'STAFF-X1' },
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERMISSION_DENIED');
    expect(res.json().error.details?.reason).toBe('PRIVILEGE_ESCALATION_DENIED');
  });

  it('invites a user, accepts the invite and the new account can log in', async () => {
    const token = (await adminLogin()).accessToken;
    const invite = await app.inject({
      method: 'POST',
      url: url('/users'),
      headers: bearer(token),
      payload: {
        email: 'dr.invited@identity.test',
        firstName: 'Invited',
        lastName: 'Doctor',
        roleIds: [doctorRoleId],
        staff: { staffNumber: 'STAFF-INV-1', professionalTitle: 'Physician' },
      },
    });
    expect(invite.statusCode).toBe(201);
    const inviteToken = invite.json().data.inviteToken as string;
    expect(inviteToken).toBeTruthy(); // dev/test inline

    const accept = await app.inject({
      method: 'POST',
      url: url('/auth/invites/accept'),
      payload: {
        inviteToken,
        firstName: 'Invited',
        lastName: 'Doctor',
        password: 'DemoPass123!',
      },
    });
    expect(accept.statusCode).toBe(200);

    const res = await login('dr.invited@identity.test', 'DemoPass123!', orgA);
    expect(res.statusCode).toBe(200);
  });

  it('rotates refresh tokens and burns the whole family on reuse', async () => {
    const first = await adminLogin();
    const refresh = (rt: string) =>
      app.inject({
        method: 'POST',
        url: url('/auth/refresh'),
        payload: { refreshToken: rt },
      });

    const r1 = await refresh(first.refreshToken);
    expect(r1.statusCode).toBe(200);
    const { accessToken, refreshToken: t2 } = r1.json().data.tokens;

    // The OLD token is now a reused rotation → burn the family.
    const reuse = await refresh(first.refreshToken);
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error.code).toBe('REFRESH_TOKEN_REUSE');

    // The newest token must also die with the family.
    const familyDead = await refresh(t2);
    expect(familyDead.statusCode).toBe(401);

    // And the access token from the burnt family is no longer accepted.
    const denied = await app.inject({
      method: 'GET',
      url: url('/organizations/me'),
      headers: bearer(accessToken),
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.json().error.code).toBe('SESSION_REVOKED');
  });

  it('enables MFA and then requires a challenge + TOTP code on login', async () => {
    const setupLogin = await login('mfa@identity.test', 'DemoPass123!', orgA);
    const tokens = setupLogin.json().data.tokens;
    const bearerHeaders = bearer(tokens.accessToken);

    const setup = await app.inject({
      method: 'POST',
      url: url('/auth/mfa/setup'),
      headers: bearerHeaders,
    });
    expect(setup.statusCode).toBe(201);
    const secret = setup.json().data.secret as string;
    expect(secret).toBeTruthy();

    const code = generateTotpCode(secret);
    const confirm = await app.inject({
      method: 'POST',
      url: url('/auth/mfa/confirm'),
      headers: bearerHeaders,
      payload: { secret, code },
    });
    expect(confirm.statusCode).toBe(201);
    const recoveryCodes = confirm.json().data.recoveryCodes as string[];
    expect(recoveryCodes).toHaveLength(10);
    _recoveryCodes = recoveryCodes;

    // Next login requires the challenge.
    const challenged = await login('mfa@identity.test', 'DemoPass123!', orgA);
    expect(challenged.statusCode).toBe(200);
    expect(challenged.json().data.mfaRequired).toBe(true);
    const { challengeToken } = challenged.json().data;

    const verify = await app.inject({
      method: 'POST',
      url: url('/auth/mfa/verify'),
      payload: { challengeToken, code },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().data.tokens.accessToken).toBeTruthy();

    // A wrong code is refused (challenge already consumed).
    const again = await login('mfa@identity.test', 'DemoPass123!', orgA);
    const c2 = again.json().data.challengeToken;
    const bad = await app.inject({
      method: 'POST',
      url: url('/auth/mfa/verify'),
      payload: { challengeToken: c2, code: '000000' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('MFA_INVALID');
  });

  it('accepts a recovery code at the MFA prompt and invalidates it', async () => {
    expect(_recoveryCodes?.length).toBe(10);
    const recoveryCode = _recoveryCodes![0];

    const challenged = await login('mfa@identity.test', 'DemoPass123!', orgA);
    const challengeToken = challenged.json().data.challengeToken as string;

    const verify = await app.inject({
      method: 'POST',
      url: url('/auth/mfa/verify'),
      payload: { challengeToken, recoveryCode },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().data.tokens.accessToken).toBeTruthy();

    const status = await app.inject({
      method: 'GET',
      url: url('/auth/mfa/status'),
      headers: bearer(verify.json().data.tokens.accessToken),
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().data.recoveryCodesRemaining).toBe(9);
  });

  it('logs out, revoking the refresh family and access (self-service sessions)', async () => {
    const { accessToken, refreshToken } = await adminLogin();

    const logout = await app.inject({
      method: 'POST',
      url: url('/auth/logout'),
      payload: { refreshToken },
    });
    expect(logout.statusCode).toBe(204);

    const denied = await app.inject({
      method: 'GET',
      url: url('/organizations/me'),
      headers: bearer(accessToken),
    });
    expect(denied.statusCode).toBe(401);
  });
});
