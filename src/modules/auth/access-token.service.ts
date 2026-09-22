import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Inject } from '@nestjs/common';
import { ENV, type Env } from '../../config/config.module';

export interface SignClaims {
  userId: string;
  organizationId: string;
  sessionId: string;
  roles: string[];
  purpose: 'access' | 'mfa_challenge';
  jti?: string;
}

export interface VerifiedToken<T> {
  sub: string;
  org: string;
  sid: string;
  roles: string[];
  purpose: T;
  jti?: string;
}

/**
 * Wraps JWT signing/verification with the server-wide issuer/audience and the
 * access secret. Access tokens are short-lived; sessions carry the revocation
 * authority.
 */
@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async sign(claims: SignClaims, expiresInSeconds: number): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: claims.userId,
        org: claims.organizationId,
        sid: claims.sessionId,
        roles: claims.roles,
        purpose: claims.purpose,
        jti: claims.jti,
      },
      {
        secret: this.env.JWT_ACCESS_SECRET,
        expiresIn: expiresInSeconds,
        issuer: this.env.JWT_ISSUER,
        audience: this.env.JWT_AUDIENCE,
      },
    );
  }

  async verify<T extends string>(token: string): Promise<VerifiedToken<T>> {
    const payload = await this.jwt.verifyAsync<VerifiedToken<T>>(token, {
      secret: this.env.JWT_ACCESS_SECRET,
      issuer: this.env.JWT_ISSUER,
      audience: this.env.JWT_AUDIENCE,
    });
    return payload;
  }
}
