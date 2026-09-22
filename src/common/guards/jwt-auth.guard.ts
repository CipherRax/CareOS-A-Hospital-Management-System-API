import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/codes';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TenantContext } from '../../database/tenant-context';
import { ENV, type Env } from '../../config/config.module';

/** Verifies the bearer access token and stamps the caller identity into CLS. */
export interface AccessTokenPayload {
  /** userId */
  sub: string;
  /** organizationId */
  org: string;
  /** sessionId */
  sid: string;
  /** Role keys at signing time (permissions are re-resolved per request). */
  roles: string[];
  purpose: 'access';
}

function bearerToken(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Authenticates the identity. Prefers an already-established principal
 * (test-principal / platform scope); otherwise verifies the JWT and writes
 * organizationId/userId/sessionId/roles into the CLS scope. Permissions are NOT
 * trusted from the token — the TenantGuard re-resolves them from the DB.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly tenantContext: TenantContext,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    // A principal is already established (test middleware or platform scope).
    if (this.tenantContext.scope.userId !== null) return true;

    const token = bearerToken(
      context.switchToHttp().getRequest().headers?.['authorization'],
    );
    if (!token) {
      throw new AppError({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Invalid or missing credentials.',
        silent: true,
      });
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
        issuer: this.env.JWT_ISSUER,
        audience: this.env.JWT_AUDIENCE,
      });
    } catch {
      throw new AppError({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Invalid or expired session.',
        silent: true,
      });
    }

    if (payload.purpose !== 'access' || !payload.sub || !payload.org || !payload.sid) {
      throw new AppError({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Invalid or expired session.',
        silent: true,
      });
    }

    this.tenantContext.setScope({
      organizationId: payload.org,
      userId: payload.sub,
      sessionId: payload.sid,
      roles: payload.roles ?? [],
    });

    return true;
  }
}
