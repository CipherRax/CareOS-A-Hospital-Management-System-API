import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ENV, type Env } from '../../config/config.module';
import { PrismaService } from '../../database/prisma.service';
import { newId } from '../../common/lib/uuidv7';
import { generateHashedToken, hashToken } from '../../common/security/token';
import {
  classifySession,
  classifyRefreshToken,
} from '../../common/auth/refresh-rotation';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { AccessTokenService } from './access-token.service';
import type { IssuedTokenPair, RequestMeta, SessionOutput } from './auth.types';

/**
 * Owns session + rotating refresh-token state. Token values are opaque and only
 * their SHA-256 digests are persisted. Lookup by digest is inherently
 * org-agnostic (the token is a bearer capability), so the initial read uses the
 * unscoped client WITHIN the identity boundary; all subsequent writes are
 * pinned to the token's own organization via the tenant client.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessToken: AccessTokenService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async issue(params: {
    organizationId: string;
    userId: string;
    roles: string[];
    meta: RequestMeta;
    mfaVerifiedAt?: Date;
  }): Promise<{ pair: IssuedTokenPair; session: SessionOutput }> {
    const { organizationId, userId, roles, meta } = params;
    const db = this.prisma.tenantFor(organizationId);
    const now = new Date();

    const familyId = newId();
    const sessionExpiresAt = secondsFromNow(now, this.env.SESSION_ABS_TTL_SECONDS);
    const refreshExpiresAt = new Date(
      Math.min(
        sessionExpiresAt.getTime(),
        secondsFromNow(now, this.env.JWT_REFRESH_TTL_SECONDS).getTime(),
      ),
    );

    const { value, digest } = generateHashedToken();

    const sessionId = newId();
    await db.session.create({
      data: {
        id: sessionId,
        organizationId,
        userId,
        familyId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        mfaVerifiedAt: params.mfaVerifiedAt ?? null,
        expiresAt: sessionExpiresAt,
      },
    });

    await db.refreshToken.create({
      data: {
        id: newId(),
        organizationId,
        sessionId,
        familyId,
        tokenHash: digest,
        expiresAt: refreshExpiresAt,
      },
    });

    const accessToken = await this.accessToken.sign(
      {
        userId,
        organizationId,
        sessionId,
        roles,
        purpose: 'access',
      },
      this.env.JWT_ACCESS_TTL,
    );

    return {
      pair: {
        accessToken,
        refreshToken: value,
        expiresIn: this.env.JWT_ACCESS_TTL,
        refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
      },
      session: {
        id: sessionId,
        familyId,
        createdAt: now,
        expiresAt: sessionExpiresAt,
      },
    };
  }

  async rotate(params: {
    refreshToken: string;
    meta: RequestMeta;
  }): Promise<{
    pair: IssuedTokenPair;
    session: SessionOutput;
    userId: string;
    organizationId: string;
    roles: string[];
  }> {
    const { meta } = params;
    const digest = hashDigest(params.refreshToken);
    const now = new Date();

    // Identity-boundary lookup: a refresh token is a bearer capability.
    const token = await this.prisma
      .unscoped()
      .refreshToken.findUnique({ where: { tokenHash: digest } });

    if (!token) {
      throw genericUnauthorized();
    }

    const verdict = classifyRefreshToken(token, now);
    if (verdict === 'reuse') {
      await this.revokeFamily(token.organizationId, token.sessionId, token.familyId);
      throw reuseDetected();
    }
    if (verdict === 'unknown') {
      throw genericUnauthorized();
    }

    const db = this.prisma.tenantFor(token.organizationId);

    const session = await db.session.findUnique({
      where: { id: token.sessionId },
      include: {
        user: {
          include: { userRoles: { include: { role: true } } },
        },
      },
    });

    if (!session || !session.user) throw genericUnauthorized();

    if (classifySession(session, now) === 'revoked') {
      throw new AppError({
        code: ErrorCodes.SESSION_REVOKED,
        message: 'Session has been revoked.',
        silent: true,
      });
    }
    if (classifySession(session, now) === 'expired') {
      throw new AppError({
        code: ErrorCodes.SESSION_EXPIRED,
        message: 'Session has expired.',
        silent: true,
      });
    }

    const { user } = session;
    if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
      throw new AppError({
        code: ErrorCodes.ACCOUNT_SUSPENDED,
        message: 'Account is not active.',
        silent: true,
      });
    }
    if (user.status !== 'ACTIVE') {
      throw new AppError({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Account activation is incomplete.',
        silent: true,
      });
    }

    const roles = user.userRoles.map((ur) => ur.role.key);
    const newTokenId = newId();
    const newHashed = generateHashedToken();
    const refreshExpiresAt = new Date(
      Math.min(
        session.expiresAt.getTime(),
        secondsFromNow(now, this.env.JWT_REFRESH_TTL_SECONDS).getTime(),
      ),
    );

    // Atomic rotation: only the still-current token may be rotated. If right
    // now this token is already used/revoked, another party rotated it first →
    // treat as reuse and burn the family.
    const rotated = await db.refreshToken.updateMany({
      where: { id: token.id, usedAt: null, revokedAt: null },
      data: { usedAt: now, replacedById: newTokenId },
    });

    if (rotated.count === 0) {
      await this.revokeFamily(token.organizationId, token.sessionId, token.familyId);
      throw reuseDetected();
    }

    await db.refreshToken.create({
      data: {
        id: newTokenId,
        organizationId: token.organizationId,
        sessionId: token.sessionId,
        familyId: token.familyId,
        tokenHash: newHashed.digest,
        rotatesFromId: token.id,
        expiresAt: refreshExpiresAt,
      },
    });

    await db.session.update({
      where: { id: token.sessionId },
      data: {
        lastSeenAt: now,
        lastSeenIp: meta.ip,
        refreshCount: { increment: 1 },
      },
    });

    const accessToken = await this.accessToken.sign(
      {
        userId: user.id,
        organizationId: token.organizationId,
        sessionId: token.sessionId,
        roles,
        purpose: 'access',
      },
      this.env.JWT_ACCESS_TTL,
    );

    return {
      pair: {
        accessToken,
        refreshToken: newHashed.value,
        expiresIn: this.env.JWT_ACCESS_TTL,
        refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
      },
      session: {
        id: token.sessionId,
        familyId: token.familyId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      },
      userId: user.id,
      organizationId: token.organizationId,
      roles,
    };
  }

  /** Logs out by cancelling the session + the whole token family. */
  async revokeByToken(refreshToken: string): Promise<boolean> {
    const digest = hashDigest(refreshToken);
    const token = await this.prisma
      .unscoped()
      .refreshToken.findUnique({ where: { tokenHash: digest } });
    if (!token) return false;

    return this.revokeSession(token.organizationId, token.sessionId, {
      revokeFamily: true,
      markSuspected: false,
    });
  }

  async revokeSession(
    organizationId: string,
    sessionId: string,
    options: { revokeFamily?: boolean; markSuspected?: boolean } = {},
  ): Promise<boolean> {
    const db = this.prisma.tenantFor(organizationId);
    const session = await db.session.findUnique({ where: { id: sessionId } });
    if (!session) return false;

    await db.session.update({
      where: { id: sessionId },
      data: {
        revokedAt: new Date(),
        suspectedReuse: options.markSuspected === true,
      },
    });

    if (options.revokeFamily !== false) {
      await db.refreshToken.updateMany({
        where: { familyId: session.familyId },
        data: { revokedAt: new Date() },
      });
    }
    return true;
  }

  async revokeUserSessions(
    organizationId: string,
    userId: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const db = this.prisma.tenantFor(organizationId);
    const sessions = await db.session.findMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      select: { id: true, familyId: true },
    });
    const now = new Date();
    for (const s of sessions) {
      await db.session.update({
        where: { id: s.id },
        data: { revokedAt: now },
      });
      await db.refreshToken.updateMany({
        where: { familyId: s.familyId },
        data: { revokedAt: now },
      });
    }
    return sessions.length;
  }

  /** Reuse (a previously-rotated token was presented) → burn the family. */
  private async revokeFamily(
    organizationId: string,
    sessionId: string,
    familyId: string,
  ): Promise<void> {
    const db = this.prisma.tenantFor(organizationId);
    await db.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), suspectedReuse: true },
    });
    await db.refreshToken.updateMany({
      where: { familyId },
      data: { revokedAt: new Date() },
    });
  }
}

function secondsFromNow(now: Date, seconds: number): Date {
  return new Date(now.getTime() + seconds * 1000);
}

function hashDigest(token: string): string {
  return hashToken(token);
}

function genericUnauthorized(): AppError {
  return new AppError({
    code: ErrorCodes.UNAUTHORIZED,
    message: 'Invalid or expired session.',
    silent: true,
  });
}

function reuseDetected(): AppError {
  return new AppError({
    code: ErrorCodes.REFRESH_TOKEN_REUSE,
    message: 'Session compromised; all connected devices were signed out.',
    silent: true,
  });
}
