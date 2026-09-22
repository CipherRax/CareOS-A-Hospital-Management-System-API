import { SetMetadata } from '@nestjs/common';

export const IS_AUTHENTICATED_ONLY_KEY = 'isAuthenticatedOnly';

/**
 * Marks a route as requiring an asserted principal + valid session but NO role
 * permission (e.g. changing your own password, managing your own MFA). The
 * identity guards still run; only the permission check is elided. Deliberately
 * NOT public: it must never be reachable without a valid token/session.
 */
export function AuthenticatedOnly(): MethodDecorator {
  return SetMetadata(IS_AUTHENTICATED_ONLY_KEY, true);
}
