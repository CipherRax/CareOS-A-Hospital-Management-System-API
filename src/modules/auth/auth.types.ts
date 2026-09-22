export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  /** ISO timestamp when the refresh token expires. */
  refreshTokenExpiresAt: string;
}

export interface SessionOutput {
  id: string;
  familyId: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface AuthUserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
}

export interface LoginSuccess {
  user: AuthUserSummary;
  session: SessionOutput;
  tokens: IssuedTokenPair;
}

export interface LoginMfaChallenge {
  mfaRequired: true;
  /** Short-lived, single-use token exchanged at /auth/mfa/verify. */
  challengeToken: string;
  challengeExpiresIn: number;
}

export type LoginResult = LoginSuccess | LoginMfaChallenge;

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export const MFA_CHALLENGE_TTL_SECONDS = 300;
export const MFA_CHALLENGE_PURPOSE = 'mfa_challenge' as const;
