import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const organizationId = z
  .string()
  .uuid()
  .describe('The organization the user belongs to (multi-tenant login)');

export const LoginSchema = z.object({
  organizationId,
  email: z.string().email().describe('User email'),
  password: z.string().min(1).max(200).describe('Account password'),
});
export class LoginDto extends createZodDto(LoginSchema) {}

export const MfaVerifySchema = z
  .object({
    challengeToken: z.string().min(1),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    recoveryCode: z.string().min(1).max(32).optional(),
  })
  .refine((v) => (v.code?.length ?? 0) > 0 || (v.recoveryCode?.length ?? 0) > 0, {
    message: 'Provide either a TOTP code or a recovery code.',
    path: ['code'],
  });
export class MfaVerifyDto extends createZodDto(MfaVerifySchema) {}

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1).describe('Current refresh token'),
});
export class RefreshDto extends createZodDto(RefreshSchema) {}

export const LogoutSchema = z.object({
  refreshToken: z.string().min(1),
});
export class LogoutDto extends createZodDto(LogoutSchema) {}

export const RequestPasswordResetSchema = z.object({
  organizationId,
  email: z.string().email(),
});
export class RequestPasswordResetDto extends createZodDto(RequestPasswordResetSchema) {}

export const ResetPasswordSchema = z.object({
  resetToken: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}

export const AcceptInviteSchema = z.object({
  inviteToken: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  otherNames: z.string().max(128).optional(),
  phone: z.string().max(32).optional(),
  password: z.string().min(8).max(128),
});
export class AcceptInviteDto extends createZodDto(AcceptInviteSchema) {}

export const MfaSetupSchema = z.object({
  secret: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});
export class MfaConfirmDto extends createZodDto(MfaSetupSchema) {}

export const MfaDisableSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});
export class MfaDisableDto extends createZodDto(MfaDisableSchema) {}

const UserSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  roles: z.array(z.string()),
});

const TokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
  refreshTokenExpiresAt: z.string(),
});

const SessionSchema = z.object({
  id: z.string().uuid(),
  familyId: z.string().uuid(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const LoginResultSchema = z.discriminatedUnion('mfaRequired', [
  z.object({
    mfaRequired: z.literal(false),
    user: UserSummarySchema,
    session: SessionSchema,
    tokens: TokensSchema,
  }),
  z.object({
    mfaRequired: z.literal(true),
    challengeToken: z.string(),
    challengeExpiresIn: z.number(),
  }),
]);
/** Discriminated union (mfa-required vs full login); not a ZodObject — used as a response TYPE only. */
export class LoginResultDto {}

export const RequestResetResponseSchema = z.object({
  status: z.literal('pending'),
  resetToken: z.string().optional(),
});
export class RequestResetResponseDto extends createZodDto(RequestResetResponseSchema) {}
