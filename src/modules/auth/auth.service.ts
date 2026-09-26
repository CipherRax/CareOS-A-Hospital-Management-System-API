import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ENV, type Env } from '../../config/config.module';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../database/audit.service';
import { FieldEncryption } from '../../common/security/crypto';
import {
  assertPasswordPolicy,
  burnPasswordTiming,
  hashPassword,
  LOCKOUT_MS,
  MAX_LOCKOUT_ATTEMPTS,
  verifyPassword,
} from '../../common/security/password';
import {
  generateHashedToken,
  hashToken,
  generateToken,
} from '../../common/security/token';
import { newId } from '../../common/lib/uuidv7';
import {
  generateTotpCode,
  generateTotpSecret,
  RECOVERY_CODE_COUNT,
  totpUri,
  verifyTotp,
} from '../../common/security/totp';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { TenantContext } from '../../database/tenant-context';
import { MFA_CHALLENGE_PURPOSE, MFA_CHALLENGE_TTL_SECONDS } from './auth.types';
import type {
  AuthUserSummary,
  LoginMfaChallenge,
  LoginResult,
  RequestMeta,
} from './auth.types';
import { AccessTokenService } from './access-token.service';
import { SessionService } from './sessions.service';
import { BruteForceService } from './brute-force.service';

export interface MfaVerifyInput {
  challengeToken: string;
  code?: string;
  recoveryCode?: string;
}

export interface LoginInput {
  organizationId: string;
  email: string;
  password: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function rolesOf(user: { userRoles: Array<{ role: { key: string } }> }): string[] {
  return user.userRoles.map((ur) => ur.role.key);
}

/**
 * Identity boundary: login, MFA, session rotation, password and invite flows.
 * An attacker-controlled request has NO tenant context (these routes are
 * public), so identity lookups happen either through the org-agnostic unscoped
 * client (bearer-capability lookups like token digests) or through a client
 * explicitly bound to the requested organization. All writes are pinned to the
 * organization that owns the identity row.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly accessToken: AccessTokenService,
    private readonly bruteForce: BruteForceService,
    private readonly encryption: FieldEncryption,
    private readonly tenantContext: TenantContext,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Returns plaintext tokens in dev/test only; production delivers OOB. */
  private returnCapabilityTokens(): boolean {
    return this.env.NODE_ENV !== 'production';
  }

  // -------------------------------------------------------------------------
  // Password login
  // -------------------------------------------------------------------------

  async login(input: LoginInput, meta: RequestMeta): Promise<LoginResult> {
    const email = normalizeEmail(input.email);
    const db = this.prisma.tenantFor(input.organizationId);
    const accountKey = this.bruteForce.accountKey(input.organizationId, email);

    const user = await db.user.findFirst({
      where: { email },
      include: {
        userRoles: { include: { role: true } },
        mfaCredential: true,
      },
    });

    if (!user) {
      await burnPasswordTiming(input.password);
      await this.bruteForce.recordFailure(accountKey);
      throw genericInvalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new AppError({
        code: ErrorCodes.ACCOUNT_LOCKED,
        message: 'Account temporarily locked. Try again later.',
        silent: true,
      });
    }

    if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
      throw new AppError({
        code: ErrorCodes.ACCOUNT_SUSPENDED,
        message: 'Account is not active.',
        silent: true,
      });
    }

    if (!user.passwordHash || user.status === 'INVITED') {
      await burnPasswordTiming(input.password);
      await this.bruteForce.recordFailure(accountKey);
      throw genericInvalidCredentials();
    }

    const passwordOk = await verifyPassword(input.password, user.passwordHash);
    if (!passwordOk) {
      const state = await this.bruteForce.recordFailure(accountKey);
      await this.audit.record({
        action: 'auth.login_failed',
        resource: 'auth',
        resourceId: user.id,
        userId: user.id,
        reason: 'password mismatch',
        organizationId: input.organizationId,
        metadata: { attempts: state.attempts },
      });
      if (state.shouldLock) {
        await db.user.update({
          where: { id: user.id },
          data: { lockedUntil: new Date(Date.now() + LOCKOUT_MS) },
        });
        await this.audit.record({
          action: 'auth.account_locked',
          resource: 'user',
          resourceId: user.id,
          userId: user.id,
          reason: `account locked after ${MAX_LOCKOUT_ATTEMPTS} failed logins`,
          organizationId: input.organizationId,
        });
      }
      throw genericInvalidCredentials();
    }

    await this.bruteForce.reset(accountKey, this.bruteForce.ipKey(meta.ip ?? ''));
    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), loginFailureCount: 0, lockedUntil: null },
    });
    await this.audit.record({
      action: 'auth.login',
      resource: 'user',
      resourceId: user.id,
      userId: user.id,
      organizationId: input.organizationId,
      metadata: { ip: meta.ip },
    });

    if (user.mfaCredential) {
      const { challengeToken, challengeExpiresIn } = await this.issueMfaChallenge(
        input.organizationId,
        user.id,
      );
      const result: LoginMfaChallenge = {
        mfaRequired: true,
        challengeToken,
        challengeExpiresIn,
      };
      return result;
    }

    return this.issueSession(user, input.organizationId, meta);
  }

  async verifyMfa(input: MfaVerifyInput, meta: RequestMeta): Promise<LoginResult> {
    let challenge: {
      sub: string;
      org: string;
      jti: string;
    } | null = null;
    try {
      const verified = await this.accessToken.verify<typeof MFA_CHALLENGE_PURPOSE>(
        input.challengeToken,
      );
      if (
        verified.purpose !== MFA_CHALLENGE_PURPOSE ||
        !verified.jti ||
        !verified.sub ||
        !verified.org
      ) {
        throw new Error('malformed challenge');
      }
      challenge = { sub: verified.sub, org: verified.org, jti: verified.jti };
    } catch {
      throw mfaInvalid();
    }

    const mfaKey = `careos:mfa:challenge:${challenge.jti}`;
    if (!(await this.bruteForce.consumeOnce(mfaKey, MFA_CHALLENGE_TTL_SECONDS))) {
      throw mfaInvalid();
    }

    const db = this.prisma.tenantFor(challenge.org);
    const user = await db.user.findFirst({
      where: { id: challenge.sub },
      include: {
        userRoles: { include: { role: true } },
        mfaCredential: true,
        mfaRecoveryCodes: {
          where: { usedAt: null },
          select: { id: true, codeHash: true },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw mfaInvalid();
    }
    if (!user.mfaCredential) {
      throw mfaInvalid();
    }

    const credential = user.mfaCredential;
    let verified = false;

    if (input.code) {
      const secret = this.encryption.decrypt(credential.secretEncrypted);
      verified = verifyTotp(input.code, secret);
    } else if (input.recoveryCode) {
      const normalized = input.recoveryCode.trim().toUpperCase().replace(/\s+/g, '');
      const match = user.mfaRecoveryCodes.find(
        (c) => c.codeHash === hashToken(normalized),
      );
      if (match) {
        await db.mfaRecoveryCode.update({
          where: { id: match.id },
          data: { usedAt: new Date() },
        });
        verified = true;
      }
    }

    if (!verified) {
      await this.audit.record({
        action: 'auth.mfa_failed',
        resource: 'mfa',
        resourceId: user.id,
        userId: user.id,
        organizationId: challenge.org,
      });
      throw mfaInvalid();
    }

    await db.mfaCredential.update({
      where: { id: credential.id },
      data: { lastVerifiedAt: new Date() },
    });
    await this.audit.record({
      action: 'auth.mfa_verified',
      resource: 'mfa',
      resourceId: user.id,
      userId: user.id,
      organizationId: challenge.org,
      metadata: { via: this.mfaVia(input) },
    });

    return this.issueSession(user, challenge.org, meta, new Date());
  }

  private mfaVia(input: MfaVerifyInput): string {
    if (input.recoveryCode) return 'recovery_code';
    return 'totp';
  }

  private async issueMfaChallenge(
    organizationId: string,
    userId: string,
  ): Promise<Omit<LoginMfaChallenge, 'mfaRequired'>> {
    const jti = generateToken(16);
    const challengeToken = await this.accessToken.sign(
      {
        userId,
        organizationId,
        sessionId: '',
        roles: [],
        purpose: MFA_CHALLENGE_PURPOSE,
        jti,
      },
      MFA_CHALLENGE_TTL_SECONDS,
    );
    return { challengeToken, challengeExpiresIn: MFA_CHALLENGE_TTL_SECONDS };
  }

  private async issueSession(
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      status: string;
      userRoles: Array<{ role: { key: string } }>;
    },
    organizationId: string,
    meta: RequestMeta,
    mfaVerifiedAt?: Date,
  ): Promise<LoginResult> {
    const roles = rolesOf(user);
    const { pair, session } = await this.sessions.issue({
      organizationId,
      userId: user.id,
      roles,
      meta,
      mfaVerifiedAt,
    });
    const summary: AuthUserSummary = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles,
    };
    return { user: summary, session, tokens: pair };
  }

  // -------------------------------------------------------------------------
  // Refresh rotation / logout
  // -------------------------------------------------------------------------

  async refresh(refreshToken: string, meta: RequestMeta): Promise<LoginResult> {
    const rotated = await this.sessions.rotate({ refreshToken, meta });
    return {
      user: await this.summaryForRefresh(rotated),
      session: rotated.session,
      tokens: rotated.pair,
    };
  }

  private async summaryForRefresh(r: {
    organizationId: string;
    userId: string;
    roles: string[];
  }): Promise<AuthUserSummary> {
    const db = this.prisma.tenantFor(r.organizationId);
    const user = await db.user.findFirst({
      where: { id: r.userId },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    if (!user) throw genericInvalidCredentials();
    return { ...user, roles: r.roles };
  }

  async logout(refreshToken: string): Promise<void> {
    const digest = hashToken(refreshToken);
    const token = await this.prisma
      .unscoped()
      .refreshToken.findUnique({ where: { tokenHash: digest } });
    if (!token) return;

    const session = await this.prisma.tenantFor(token.organizationId).session.findUnique({
      where: { id: token.sessionId },
      select: { id: true, userId: true },
    });

    const revoked = await this.sessions.revokeSession(
      token.organizationId,
      token.sessionId,
    );
    if (revoked) {
      await this.audit.record({
        action: 'auth.logout',
        resource: 'session',
        resourceId: token.sessionId,
        userId: session?.userId,
        organizationId: token.organizationId,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Invite acceptance
  // -------------------------------------------------------------------------

  async acceptInvite(input: {
    inviteToken: string;
    firstName: string;
    lastName: string;
    otherNames?: string;
    phone?: string;
    password: string;
  }): Promise<{ user: AuthUserSummary }> {
    const digest = hashToken(input.inviteToken);
    const user = await this.prisma
      .unscoped()
      .user.findFirst({ where: { inviteTokenHash: digest } });

    if (
      !user ||
      user.status !== 'INVITED' ||
      !user.inviteTokenExpiresAt ||
      user.inviteTokenExpiresAt.getTime() <= Date.now()
    ) {
      throw new AppError({
        code: ErrorCodes.BAD_REQUEST,
        message: 'This invitation is invalid or has expired.',
        silent: true,
      });
    }

    assertPasswordPolicy(input.password);
    const passwordHash = await hashPassword(input.password);

    await this.prisma.tenantFor(user.organizationId).user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        otherNames: input.otherNames ?? null,
        phone: input.phone ?? null,
        status: 'ACTIVE',
        inviteTokenHash: null,
        inviteTokenExpiresAt: null,
        loginFailureCount: 0,
        lockedUntil: null,
      },
    });

    await this.audit.record({
      action: 'auth.invite_accepted',
      resource: 'user',
      resourceId: user.id,
      userId: user.id,
      organizationId: user.organizationId,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: input.firstName,
        lastName: input.lastName,
        roles: [],
      },
    };
  }

  // -------------------------------------------------------------------------
  // Password reset / change
  // -------------------------------------------------------------------------

  async requestPasswordReset(input: {
    organizationId: string;
    email: string;
  }): Promise<{ status: 'pending'; resetToken?: string }> {
    const email = normalizeEmail(input.email);
    const user = await this.prisma
      .tenantFor(input.organizationId)
      .user.findFirst({ where: { email } });

    if (!user) {
      // Indistinguishable response; burn a little time.
      await burnPasswordTiming('noop-not-a-password');
      return { status: 'pending' };
    }

    const { value, digest } = generateHashedToken();
    const expiresAt = new Date(Date.now() + this.env.PASSWORD_RESET_TTL_SECONDS * 1000);

    await this.prisma.tenantFor(input.organizationId).user.update({
      where: { id: user.id },
      data: {
        passwordResetTokenHash: digest,
        passwordResetTokenExpiresAt: expiresAt,
      },
    });

    await this.audit.record({
      action: 'auth.password_reset_requested',
      resource: 'user',
      resourceId: user.id,
      userId: user.id,
      organizationId: input.organizationId,
    });

    return {
      status: 'pending',
      ...(this.returnCapabilityTokens() ? { resetToken: value } : {}),
    };
  }

  async resetPassword(input: { resetToken: string; newPassword: string }): Promise<void> {
    const digest = hashToken(input.resetToken);
    const user = await this.prisma
      .unscoped()
      .user.findFirst({ where: { passwordResetTokenHash: digest } });

    if (
      !user ||
      !user.passwordResetTokenExpiresAt ||
      user.passwordResetTokenExpiresAt.getTime() <= Date.now()
    ) {
      throw new AppError({
        code: ErrorCodes.BAD_REQUEST,
        message: 'Invalid or expired password reset token.',
        silent: true,
      });
    }

    assertPasswordPolicy(input.newPassword);
    const passwordHash = await hashPassword(input.newPassword);

    await this.prisma.tenantFor(user.organizationId).user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetTokenExpiresAt: null,
        loginFailureCount: 0,
        lockedUntil: null,
      },
    });

    await this.sessions.revokeUserSessions(user.organizationId, user.id);

    await this.audit.record({
      action: 'auth.password_reset_completed',
      resource: 'user',
      resourceId: user.id,
      userId: user.id,
      organizationId: user.organizationId,
    });
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const organizationId = this.requireOrg();
    const userId = this.requireUserId();
    const db = this.prisma.tenantFor(organizationId);

    const user = await db.user.findFirst({ where: { id: userId } });
    if (!user || !user.passwordHash) {
      throw genericInvalidCredentials();
    }

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) {
      throw genericInvalidCredentials();
    }

    assertPasswordPolicy(newPassword);
    const passwordHash = await hashPassword(newPassword);

    await db.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    const sessionId = this.requireSessionIdOrUndefined();
    await this.sessions.revokeUserSessions(organizationId, userId, sessionId);

    await this.audit.record({
      action: 'auth.password_changed',
      resource: 'user',
      resourceId: userId,
      userId,
      organizationId,
    });
  }

  private requireOrg(): string {
    return this.tenantContext.requireOrg();
  }

  private requireUserId(): string {
    const userId = this.tenantContext.scope.userId;
    if (!userId) {
      throw new AppError({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Authentication required.',
        silent: true,
      });
    }
    return userId;
  }

  private requireSessionIdOrUndefined(): string | undefined {
    return this.tenantContext.scope.sessionId ?? undefined;
  }

  // -------------------------------------------------------------------------
  // Self-service MFA
  // -------------------------------------------------------------------------

  async mfaSetup(): Promise<{
    secret: string;
    otpauthUri: string;
    confirmHint: string;
  }> {
    const organizationId = this.requireOrg();
    const userId = this.requireUserId();
    const user = await this.prisma
      .tenantFor(organizationId)
      .user.findFirst({ where: { id: userId } });

    if (!user)
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'User not found',
        silent: true,
      });
    const existing = await this.prisma
      .tenantFor(organizationId)
      .mfaCredential.findUnique({ where: { userId } });
    if (existing) {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: 'MFA is already enabled. Disable it before re-enrolling.',
        silent: true,
      });
    }

    const secret = generateTotpSecret();
    const otpauthUri = totpUri(user.email, this.env.MFA_ISSUER, secret);
    return {
      secret,
      otpauthUri,
      confirmHint: 'POST /auth/mfa/confirm with a current code.',
    };
  }

  async mfaConfirm(input: {
    secret: string;
    code: string;
  }): Promise<{ enabled: true; recoveryCodes: string[] }> {
    const organizationId = this.requireOrg();
    const userId = this.requireUserId();
    const db = this.prisma.tenantFor(organizationId);

    if (!verifyTotp(input.code, input.secret)) {
      throw mfaInvalid();
    }

    const existing = await db.mfaCredential.findUnique({ where: { userId } });
    if (existing) {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: 'MFA is already enabled.',
        silent: true,
      });
    }

    const secretEncrypted = this.encryption.encrypt(input.secret);
    await db.mfaCredential.create({
      data: { id: newId(), organizationId, userId, secretEncrypted },
    });

    const recoveryCodes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const code = generateToken(9).toUpperCase(); // 18 hex upper → 18 alnum chars
      recoveryCodes.push(code);
      await db.mfaRecoveryCode.create({
        data: { id: newId(), organizationId, userId, codeHash: hashToken(code) },
      });
    }

    await this.audit.record({
      action: 'auth.mfa_enabled',
      resource: 'mfa',
      resourceId: userId,
      userId,
      organizationId,
      metadata: { recoveryCodesIssued: recoveryCodes.length },
    });

    return { enabled: true, recoveryCodes };
  }

  async mfaDisable(code: string): Promise<void> {
    const organizationId = this.requireOrg();
    const userId = this.requireUserId();
    const db = this.prisma.tenantFor(organizationId);

    const credential = await db.mfaCredential.findUnique({ where: { userId } });
    if (!credential) {
      throw new AppError({
        code: ErrorCodes.BAD_REQUEST,
        message: 'MFA is not enabled.',
        silent: true,
      });
    }

    const secret = this.encryption.decrypt(credential.secretEncrypted);
    if (!verifyTotp(code, secret)) {
      throw mfaInvalid();
    }

    await db.mfaCredential.delete({ where: { userId } });
    await db.mfaRecoveryCode.deleteMany({ where: { userId } });

    await this.audit.record({
      action: 'auth.mfa_disabled',
      resource: 'mfa',
      resourceId: userId,
      userId,
      organizationId,
    });
  }

  async mfaStatus(): Promise<{
    enabled: boolean;
    enabledAt?: string;
    lastVerifiedAt?: string;
    recoveryCodesRemaining: number;
  }> {
    const organizationId = this.requireOrg();
    const userId = this.requireUserId();
    const db = this.prisma.tenantFor(organizationId);

    const credential = await db.mfaCredential.findUnique({
      where: { userId },
      select: { enabledAt: true, lastVerifiedAt: true },
    });
    if (!credential) return { enabled: false, recoveryCodesRemaining: 0 };

    const remaining = await db.mfaRecoveryCode.count({
      where: { userId, usedAt: null },
    });
    return {
      enabled: true,
      enabledAt: credential.enabledAt.toISOString(),
      lastVerifiedAt: credential.lastVerifiedAt?.toISOString(),
      recoveryCodesRemaining: remaining,
    };
  }

  // -------------------------------------------------------------------------
  // Self-service identity: effective roles + permissions
  // -------------------------------------------------------------------------

  async me() {
    const organizationId = this.requireOrg();
    const userId = this.requireUserId();
    const db = this.prisma.tenantFor(organizationId);
    const sessionId = this.requireSessionIdOrUndefined();

    const user = await db.user.findFirst({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        otherNames: true,
        phone: true,
        status: true,
        passwordChangeRequired: true,
        mfaEnrolmentRequired: true,
      },
    });
    if (!user) {
      throw new AppError({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Account no longer exists.',
        silent: true,
      });
    }

    const [
      organization,
      roleRows,
      branchRows,
      mfaCredential,
      session,
      preference,
      activeBreakGlass,
    ] = await Promise.all([
      db.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          legalName: true,
          tradingName: true,
          country: true,
          timezone: true,
          currency: true,
          logoUrl: true,
          status: true,
          featureFlags: true,
        },
      }),
      db.userRole.findMany({
        where: { userId },
        select: { role: { select: { key: true, name: true } } },
      }),
      db.userBranch.findMany({
        where: { userId },
        select: { branch: { select: { id: true, name: true, code: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      db.mfaCredential.findUnique({
        where: { userId },
        select: { enabledAt: true, lastVerifiedAt: true },
      }),
      sessionId
        ? db.session.findUnique({
            where: { id: sessionId },
            select: { id: true, mfaVerifiedAt: true },
          })
        : Promise.resolve(null),
      db.userPreference.findUnique({ where: { userId } }),
      db.breakGlassGrant.findFirst({
        where: { requesterUserId: userId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
        orderBy: { grantedAt: 'desc' },
        select: { id: true, resourceType: true, resourceId: true, reason: true, grantedAt: true, expiresAt: true },
      }),
    ]);

    const roleSummary = roleRows.map((r) => r.role);

    // Security staging (ADR-042): a weak/strong signal the client can act on.
    // It is advisory — permissions still come from roles, both below.
    const mfaEnabled = mfaCredential !== null;
    const mfaVerifiedThisSession = session?.mfaVerifiedAt != null;
    const sessionStaging: string[] = [];
    if (!mfaEnabled) {
      sessionStaging.push(user.mfaEnrolmentRequired ? 'mfa_enrolment_required' : 'weaker');
    } else if (!mfaVerifiedThisSession) {
      sessionStaging.push('stronger');
    }

    const userStaging: string[] = [];
    if (user.passwordChangeRequired) userStaging.push('password_change_required');

    const allowed = branchRows.map((r) => r.branch);
    let currentBranchId = this.tenantContext.scope.branchId ?? null;
    if (
      currentBranchId === null &&
      preference?.defaultBranchId &&
      allowed.some((b) => b.id === preference.defaultBranchId)
    ) {
      currentBranchId = preference.defaultBranchId;
    }

    return {
      user: {
        ...user,
        organizationId,
        roleSummary,
        securityStaging: userStaging,
      },
      organization: organization
        ? {
            id: organization.id,
            name: organization.name,
            legalName: organization.legalName,
            tradingName: organization.tradingName,
            country: organization.country,
            timezone: organization.timezone,
            currency: organization.currency,
            logoUrl: organization.logoUrl,
            status: organization.status,
            features: organization.featureFlags ?? {},
          }
        : null,
      roles: roleSummary.map((r) => r.key),
      // Resolved at request time from role assignments (never from the JWT).
      // The parity guarantee with the permission guard is that both read this
      // same scope; the identity e2e asserts the deep-equal against role union.
      permissions: this.tenantContext.scope.permissions,
      patient: null,
      breakGlass: activeBreakGlass
        ? {
            id: activeBreakGlass.id,
            resourceType: activeBreakGlass.resourceType,
            resourceId: activeBreakGlass.resourceId,
            reason: activeBreakGlass.reason,
            grantedAt: activeBreakGlass.grantedAt.toISOString(),
            expiresAt: activeBreakGlass.expiresAt.toISOString(),
          }
        : null,
      session: {
        id: session?.id ?? null,
        mfaVerifiedAt: session?.mfaVerifiedAt?.toISOString() ?? null,
        mfaMethod: mfaEnabled ? 'TOTP' : null,
        securityStaging: sessionStaging,
        // These are fixed by configuration in this release (see limitations).
        idleTimeoutSeconds: this.env.JWT_ACCESS_TTL,
        lockAfterMinutes: Math.floor(this.env.SESSION_ABS_TTL_SECONDS / 60),
      },
      branch: {
        current: currentBranchId,
        allowed: allowed.map((b) => ({ id: b.id, name: b.name, code: b.code })),
      },
      preferences: preference
        ? {
            locale: preference.locale,
            density: preference.density,
            defaultBranchId: preference.defaultBranchId,
          }
        : null,
    };
  }

  /**
   * PATCH /auth/me/preferences. Preferences are settings, never grants: a
   * defaultBranchId is stored only when the user still holds the branch
   * (ADR-042) and is only honoured while that holds.
   */
  async getPreferences(): Promise<{
    locale: string | null;
    density: string | null;
    defaultBranchId: string | null;
  } | null> {
    const organizationId = this.requireOrg();
    const userId = this.requireUserId();
    const db = this.prisma.tenantFor(organizationId);
    const preference = await db.userPreference.findUnique({ where: { userId } });
    if (!preference) return null;
    return {
      locale: preference.locale,
      density: preference.density,
      defaultBranchId: preference.defaultBranchId,
    };
  }

  async setPreferences(input: {
    locale?: string;
    density?: string;
    defaultBranchId?: string;
  }) {
    const organizationId = this.requireOrg();
    const userId = this.requireUserId();
    const db = this.prisma.tenantFor(organizationId);

    if (input.defaultBranchId) {
      const assigned = await db.userBranch.findUnique({
        where: {
          organizationId_userId_branchId: {
            organizationId,
            userId,
            branchId: input.defaultBranchId,
          },
        },
        select: { id: true },
      });
      if (!assigned) {
        throw new AppError({
          code: ErrorCodes.TENANT_ACCESS_DENIED,
          message: 'This branch is not assigned to the current account.',
          silent: true,
        });
      }
    }

    const existing = await db.userPreference.findUnique({ where: { userId } });

    const saved = await db.userPreference.upsert({
      where: { userId },
      create: {
        id: newId(),
        organizationId,
        userId,
        locale: input.locale ?? null,
        density: input.density ?? null,
        defaultBranchId: input.defaultBranchId ?? null,
      },
      update: {
        locale: input.locale ?? existing?.locale ?? null,
        density: input.density ?? existing?.density ?? null,
        defaultBranchId: input.defaultBranchId ?? existing?.defaultBranchId ?? null,
      },
    });

    await this.audit.record({
      action: 'auth.preferences_updated',
      resource: 'user',
      resourceId: userId,
      userId,
      organizationId,
      metadata: { fields: Object.keys(input) },
    });

    return {
      locale: saved.locale,
      density: saved.density,
      defaultBranchId: saved.defaultBranchId,
    };
  }

  // -------------------------------------------------------------------------
  // Self-service sessions
  // -------------------------------------------------------------------------

  async mySessions() {
    const organizationId = this.requireOrg();
    const userId = this.requireUserId();
    const currentSessionId = this.requireSessionIdOrUndefined();
    const db = this.prisma.tenantFor(organizationId);

    const rows = await db.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        ip: true,
        userAgent: true,
        suspendedAt: true,
        suspectedReuse: true,
      },
    });

    const now = Date.now();
    return rows
      .filter((r) => r.expiresAt.getTime() > now)
      .map((r) => ({ ...r, current: r.id === currentSessionId }));
  }

  async revokeMySession(sessionId: string): Promise<{ revoked: boolean }> {
    const organizationId = this.requireOrg();
    const userId = this.requireUserId();
    const db = this.prisma.tenantFor(organizationId);

    const session = await db.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'Session not found.',
        silent: true,
      });
    }

    const revoked = await this.sessions.revokeSession(organizationId, sessionId);
    if (revoked) {
      await this.audit.record({
        action: 'auth.session_revoked_self',
        resource: 'session',
        resourceId: sessionId,
        userId,
        organizationId,
        metadata: { current: sessionId === this.requireSessionIdOrUndefined() },
      });
    }
    return { revoked };
  }

  async revokeMyOtherSessions(): Promise<{ revoked: number }> {
    const organizationId = this.requireOrg();
    const userId = this.requireUserId();
    const revoked = await this.sessions.revokeUserSessions(
      organizationId,
      userId,
      this.requireSessionIdOrUndefined(),
    );
    await this.audit.record({
      action: 'auth.sessions_revoked_self',
      resource: 'session',
      resourceId: userId,
      userId,
      organizationId,
      metadata: { revoked },
    });
    return { revoked };
  }

  async debugTotpCode(secret: string): Promise<string> {
    return generateTotpCode(secret);
  }
}

function genericInvalidCredentials(): AppError {
  return new AppError({
    code: ErrorCodes.UNAUTHORIZED,
    message: 'Invalid or missing credentials.',
    silent: true,
  });
}

function mfaInvalid(): AppError {
  return new AppError({
    code: ErrorCodes.MFA_INVALID,
    message: 'Invalid or expired authentication challenge.',
    silent: true,
  });
}
