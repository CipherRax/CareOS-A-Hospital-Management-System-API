import { AuthService } from '../../../src/modules/auth/auth.service';

const ENV = {
  NODE_ENV: 'test',
  JWT_ACCESS_TTL: 900,
  SESSION_ABS_TTL_SECONDS: 43_200,
} as never;

const USER = {
  id: 'user-1',
  email: 'a@example.org',
  firstName: 'Amina',
  lastName: 'Otieno',
  otherNames: null,
  phone: '+254700111222',
  status: 'ACTIVE',
  passwordChangeRequired: false,
  mfaEnrolmentRequired: false,
};

const ORG = {
  id: 'org-1',
  name: 'Org',
  legalName: null,
  tradingName: null,
  country: 'KE',
  timezone: 'Africa/Nairobi',
  currency: 'KES',
  logoUrl: null,
  status: 'ACTIVE',
  featureFlags: { pharmacy: true },
};

function build(args: { branchRows?: unknown[]; scopeBranchId?: string | null; preference?: unknown } = {}) {
  const user = { findFirst: jest.fn().mockResolvedValue(USER) };
  const organization = { findUnique: jest.fn().mockResolvedValue(ORG) };
  const userRole = {
    findMany: jest.fn().mockResolvedValue([
      { role: { id: 'role-1', key: 'DOCTOR', name: 'Doctor' } },
    ]),
  };
  const patient = { findFirst: jest.fn().mockResolvedValue(null) };
  const userBranch = {
    findMany: jest.fn().mockResolvedValue(
      args.branchRows ?? [
        { branch: { id: 'branch-1', name: 'Main', code: 'MAIN' } },
        { branch: { id: 'branch-2', name: 'Annex', code: 'ANNEX' } },
      ],
    ),
  };
  const mfaCredential = { findUnique: jest.fn().mockResolvedValue({ enabledAt: new Date(), lastVerifiedAt: null }) };
  const session = {
    findUnique: jest
      .fn()
      .mockResolvedValue({ id: 's-1', mfaVerifiedAt: new Date(), createdAt: new Date('2026-01-01T00:00:00Z') }),
  };
  const userPreference = { findUnique: jest.fn().mockResolvedValue(args.preference ?? null) };
  const breakGlassGrant = { findFirst: jest.fn().mockResolvedValue(null) };

  const tenant = {
    user,
    organization,
    userRole,
    patient,
    userBranch,
    mfaCredential,
    session,
    userPreference,
    breakGlassGrant,
  };

  const tenantContext = {
    scope: {
      organizationId: 'org-1',
      userId: 'user-1',
      sessionId: 's-1',
      roles: ['DOCTOR'],
      permissions: ['patients.read'],
      branchId: args.scopeBranchId ?? null,
      patientId: null,
    },
    requireOrg: jest.fn(() => 'org-1'),
    requireUserId: jest.fn(() => 'user-1'),
    requireSessionIdOrUndefined: jest.fn(() => 's-1'),
  };

  const service = new AuthService(
    { tenantFor: jest.fn(() => tenant) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    tenantContext as never,
    ENV,
  );
  return { service, tenant, tenantContext };
}

describe('AuthService.me — branch context', () => {
  it('echoes an assigned X-Branch-Id as the current branch', async () => {
    const { service } = build({ scopeBranchId: 'branch-2' });
    const out = await service.me();
    expect(out.branch.current).toBe('branch-2');
  });

  it('never reports a branch the account does not hold', async () => {
    // Defence in depth behind the tenant guard: the client bootstraps navigation
    // from `branch.current`, so a scope value outside `branch.allowed` would put
    // the UI into a branch context the user cannot actually access.
    const { service } = build({ scopeBranchId: 'branch-somewhere-else' });
    const out = await service.me();
    expect(out.branch.current).toBeNull();
    expect(out.branch.allowed.map((b: { id: string }) => b.id)).toEqual(['branch-1', 'branch-2']);
  });

  it('leaves the branch unset when the header is absent', async () => {
    const { service } = build({ scopeBranchId: null });
    const out = await service.me();
    expect(out.branch.current).toBeNull();
  });

  it('falls back to the stored default branch when none is selected', async () => {
    const { service } = build({
      scopeBranchId: null,
      preference: { locale: 'en', density: 'comfortable', defaultBranchId: 'branch-2' },
    });
    const out = await service.me();
    expect(out.branch.current).toBe('branch-2');
  });

  it('ignores a default branch the user no longer holds', async () => {
    // Preferences are settings, not grants (ADR-042): a revoked branch must not
    // come back through the preference.
    const { service } = build({
      scopeBranchId: null,
      preference: { locale: 'en', density: 'comfortable', defaultBranchId: 'branch-revoked' },
    });
    const out = await service.me();
    expect(out.branch.current).toBeNull();
  });

  it('prefers the header over the preference when both are valid', async () => {
    const { service } = build({
      scopeBranchId: 'branch-1',
      preference: { locale: 'en', density: 'comfortable', defaultBranchId: 'branch-2' },
    });
    const out = await service.me();
    expect(out.branch.current).toBe('branch-1');
  });

  it('falls back to a valid preference when the header names an unheld branch', async () => {
    const { service } = build({
      scopeBranchId: 'branch-gone',
      preference: { locale: 'en', density: 'comfortable', defaultBranchId: 'branch-2' },
    });
    const out = await service.me();
    expect(out.branch.current).toBe('branch-2');
  });

  it('handles a user assigned to no branches at all', async () => {
    const { service } = build({ branchRows: [], scopeBranchId: 'branch-1' });
    const out = await service.me();
    expect(out.branch.current).toBeNull();
    expect(out.branch.allowed).toEqual([]);
  });
});

describe('AuthService.me — session bootstrap contract', () => {
  it('returns roles as key strings and permissions from the resolved scope', async () => {
    const { service } = build();
    const out = await service.me();
    expect(out.roles).toEqual(['DOCTOR']);
    expect(out.permissions).toEqual(['patients.read']);
  });

  it('exposes feature flags under `features`', async () => {
    const { service } = build();
    const out = await service.me();
    expect(out.organization).not.toBeNull();
    expect((out.organization as { features: unknown }).features).toEqual({ pharmacy: true });
  });

  it('reports no patient link rather than erroring when unprovisioned', async () => {
    const { service } = build();
    const out = await service.me();
    expect(out.patient).toBeNull();
  });

  it('signals that MFA is verified this session', async () => {
    const { service } = build();
    const out = await service.me();
    expect(out.session.mfaMethod).toBe('TOTP');
    expect(out.session.securityStaging).toEqual([]);
  });
});

/**
 * Brief §5.15 fixes the field names a client bootstraps from. These assert the
 * contract shape itself, because a silent rename here breaks every consumer at
 * once and the failure only shows up as an empty nav in the client.
 */
describe('AuthService.me — brief §5.15 contract fields', () => {
  it('exposes roles as objects with id, key and name', async () => {
    const { service } = build();
    const out = await service.me();
    expect(out.roleDetails).toEqual([{ id: 'role-1', key: 'DOCTOR', name: 'Doctor' }]);
  });

  it('puts role objects on the user, as the brief spells it', async () => {
    // The brief reads roles off the user. `user.roleSummary` holds the full role
    // rows; `user.roles` is the contract shape. Both must agree with the
    // top-level `roleDetails` — three spellings of one list is only safe while
    // they cannot drift.
    const { service } = build();
    const out = await service.me();
    const user = out.user as { roles: unknown; roleSummary: Array<{ key: string }> };
    expect(user.roles).toEqual([{ id: 'role-1', key: 'DOCTOR', name: 'Doctor' }]);
    expect(user.roles).toEqual(out.roleDetails);
    expect(user.roleSummary.map((r) => r.key)).toEqual(out.roles);
  });

  it('keeps the scalar role key list alongside the objects', async () => {
    const { service } = build();
    const out = await service.me();
    expect(out.roles).toEqual(['DOCTOR']);
  });

  it('exposes feature flags as featureFlags', async () => {
    const { service } = build();
    const out = await service.me();
    expect((out.organization as { featureFlags: unknown }).featureFlags).toEqual({ pharmacy: true });
  });

  it('exposes branches and activeBranchId', async () => {
    const { service } = build({ scopeBranchId: 'branch-2' });
    const out = await service.me();
    expect(out.branches).toEqual([
      { id: 'branch-1', name: 'Main', code: 'MAIN' },
      { id: 'branch-2', name: 'Annex', code: 'ANNEX' },
    ]);
    expect(out.activeBranchId).toBe('branch-2');
  });

  it('keeps activeBranchId consistent with branch.current', async () => {
    // Two spellings of one fact must never disagree, or the client's nav and its
    // scope selector would show different branches.
    const { service } = build({ scopeBranchId: 'branch-2' });
    const out = await service.me();
    expect(out.activeBranchId).toBe(out.branch.current);
  });

  it('reports a null activeBranchId when the account holds none', async () => {
    const { service } = build({ branchRows: [], scopeBranchId: 'branch-1' });
    const out = await service.me();
    expect(out.activeBranchId).toBeNull();
    expect(out.branches).toEqual([]);
  });

  it('exposes MFA under the user', async () => {
    const { service } = build();
    const out = await service.me();
    expect(out.user.mfa).toEqual({ enabled: true, required: false, verifiedThisSession: true });
  });

  it('exposes the security staging object', async () => {
    const { service } = build();
    const out = await service.me();
    expect(out.security).toMatchObject({
      passwordChangeRequired: false,
      mfaEnrolmentRequired: false,
    });
  });

  it('reports password-change state in both spellings', async () => {
    const { service } = build();
    const out = await service.me();
    expect(out.security.passwordChangeRequired).toBe(out.user.passwordChangeRequired);
  });

  it('exposes lockAfterSeconds in seconds, not minutes', async () => {
    // The brief specifies seconds; a client that multiplies by 1000 against a
    // minute value would lock a user out almost immediately.
    const { service } = build();
    const out = await service.me();
    expect(out.session.lockAfterSeconds).toBe(43_200);
  });

  it('derives the session expiry from its creation time', async () => {
    const { service } = build();
    const out = await service.me();
    expect(out.session.expiresAt).toBe('2026-01-01T12:00:00.000Z');
  });

  it('exposes patientLink as null when there is no linked record', async () => {
    const { service } = build();
    const out = await service.me();
    expect(out.patientLink).toBeNull();
  });

  it('exposes break-glass as a list', async () => {
    const { service } = build();
    const out = await service.me();
    expect(out.breakGlassGrants).toEqual([]);
  });
});