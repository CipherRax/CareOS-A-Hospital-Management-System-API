import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Throttle } from '@nestjs/throttler';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { AuthService } from './auth.service';
import {
  AcceptInviteDto,
  ChangePasswordDto,
  LoginDto,
  LoginResultDto,
  LogoutDto,
  MfaConfirmDto,
  MfaDisableDto,
  MfaVerifyDto,
  RefreshDto,
  RequestPasswordResetDto,
  RequestResetResponseDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import type { RequestMeta } from './auth.types';

function requestMeta(req: FastifyRequest): RequestMeta {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = forwardedValue?.split(',')[0]?.trim() || req.ip || null;
  const agent = req.headers['user-agent'];
  return {
    ip,
    userAgent: typeof agent === 'string' ? agent : Array.isArray(agent) ? agent[0] : null,
  };
}

const LOGIN_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
const VERIFY_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
const PASSWORD_THROTTLE = { default: { limit: 15, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Throttle(LOGIN_THROTTLE)
  @ApiEndpoint({
    summary: 'Sign in with email + password',
    description:
      'Multi-tenant login. Returns token pair immediately, or a single-use MFA challenge when the account has TOTP enabled.',
    operationId: 'authLogin',
    public: true,
    responseType: LoginResultDto,
  })
  login(@Body() body: LoginDto, @Req() req: FastifyRequest) {
    return this.auth.login(
      {
        organizationId: body.organizationId,
        email: body.email,
        password: body.password,
      },
      requestMeta(req),
    );
  }

  @Post('mfa/verify')
  @Throttle(VERIFY_THROTTLE)
  @ApiEndpoint({
    summary: 'Complete a second-factor challenge',
    operationId: 'authMfaVerify',
    public: true,
    responseType: LoginResultDto,
    errors: [{ status: 401, description: 'MFA challenge invalid or already used' }],
  })
  mfaVerify(@Body() body: MfaVerifyDto, @Req() req: FastifyRequest) {
    return this.auth.verifyMfa(body, requestMeta(req));
  }

  @Post('refresh')
  @ApiEndpoint({
    summary: 'Rotate the refresh token and reissue an access token',
    description:
      'Refresh tokens rotate on every use. Presenting an already-rotated token revokes the whole session family.',
    operationId: 'authRefresh',
    public: true,
    responseType: LoginResultDto,
    errors: [
      {
        status: 401,
        description: 'Invalid refresh token — code: REFRESH_TOKEN_REUSE on reuse',
      },
    ],
  })
  refresh(@Body() body: RefreshDto, @Req() req: FastifyRequest) {
    return this.auth.refresh(body.refreshToken, requestMeta(req));
  }

  @Post('logout')
  @ApiEndpoint({
    summary: 'Sign out the device owning this refresh token',
    operationId: 'authLogout',
    public: true,
    statusCode: 204,
  })
  async logout(@Body() body: LogoutDto) {
    await this.auth.logout(body.refreshToken);
  }

  @Post('invites/accept')
  @ApiEndpoint({
    summary: 'Accept an invite and set the initial password',
    operationId: 'authAcceptInvite',
    public: true,
  })
  acceptInvite(@Body() body: AcceptInviteDto) {
    return this.auth.acceptInvite(body);
  }

  @Post('password/request')
  @Throttle(PASSWORD_THROTTLE)
  @ApiEndpoint({
    summary: 'Request a password reset token',
    description:
      'Always returns the same envelope whether or not the account exists (no enumeration). Tokens are only returned inline outside production.',
    operationId: 'authRequestPasswordReset',
    public: true,
    responseType: RequestResetResponseDto,
    statusCode: 202,
  })
  requestPasswordReset(@Body() body: RequestPasswordResetDto) {
    return this.auth.requestPasswordReset({
      organizationId: body.organizationId,
      email: body.email,
    });
  }

  @Post('password/reset')
  @Throttle(PASSWORD_THROTTLE)
  @ApiEndpoint({
    summary: 'Set a new password with a reset token',
    operationId: 'authResetPassword',
    public: true,
    statusCode: 204,
  })
  async resetPassword(@Body() body: ResetPasswordDto) {
    await this.auth.resetPassword(body);
  }

  @Post('password/change')
  @Throttle(PASSWORD_THROTTLE)
  @ApiEndpoint({
    summary: 'Change your own password (other sessions are revoked)',
    operationId: 'authChangePassword',
    authenticatedOnly: true,
    statusCode: 204,
  })
  async changePassword(@Body() body: ChangePasswordDto) {
    await this.auth.changePassword(body.currentPassword, body.newPassword);
  }

  @Post('mfa/setup')
  @ApiEndpoint({
    summary: 'Start TOTP enrolment (returns the shared secret + otpauth URI)',
    operationId: 'authMfaSetup',
    authenticatedOnly: true,
    statusCode: 201,
  })
  mfaSetup() {
    return this.auth.mfaSetup();
  }

  @Post('mfa/confirm')
  @ApiEndpoint({
    summary: 'Confirm TOTP enrolment and issue recovery codes (shown once)',
    operationId: 'authMfaConfirm',
    authenticatedOnly: true,
    statusCode: 201,
  })
  mfaConfirm(@Body() body: MfaConfirmDto) {
    return this.auth.mfaConfirm(body);
  }

  @Post('mfa/disable')
  @ApiEndpoint({
    summary: 'Disable TOTP after verifying the current code',
    operationId: 'authMfaDisable',
    authenticatedOnly: true,
    statusCode: 204,
  })
  async mfaDisable(@Body() body: MfaDisableDto) {
    await this.auth.mfaDisable(body.code);
  }

  @Get('mfa/status')
  @ApiEndpoint({
    summary: 'Current MFA state + remaining recovery codes',
    operationId: 'authMfaStatus',
    authenticatedOnly: true,
  })
  mfaStatus() {
    return this.auth.mfaStatus();
  }

  @Get('me')
  @ApiEndpoint({
    summary: 'Effective identity: profile, roles and resolved permissions',
    description:
      'Permissions are re-resolved from role assignments on every request, not from the JWT.',
    operationId: 'authMe',
    authenticatedOnly: true,
  })
  me() {
    return this.auth.me();
  }

  @Get('sessions')
  @ApiEndpoint({
    summary: 'List your active sessions (current one flagged)',
    operationId: 'authMySessions',
    authenticatedOnly: true,
  })
  mySessions() {
    return this.auth.mySessions();
  }

  @Post('sessions/revoke-others')
  @ApiEndpoint({
    summary: 'Revoke all your other sessions (keep this device)',
    operationId: 'authRevokeOtherSessions',
    authenticatedOnly: true,
  })
  revokeMyOtherSessions() {
    return this.auth.revokeMyOtherSessions();
  }

  @Post('sessions/:sessionId/revoke')
  @ApiEndpoint({
    summary: 'Revoke one of your sessions',
    operationId: 'authRevokeMySession',
    authenticatedOnly: true,
  })
  revokeMySession(@Param('sessionId') sessionId: string) {
    return this.auth.revokeMySession(sessionId);
  }
}
