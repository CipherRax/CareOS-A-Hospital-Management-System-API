import * as argon2 from 'argon2';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/codes';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_POLICY_DESCRIPTION =
  'Password must be 8-128 characters and include lower-case, upper-case and a digit.';

// Pre-computed argon2id hash of a random value, used when the account does not
// exist so login timings do not reveal whether an email is registered.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$9X0jYb/CbVw1Lf6m7nEoRg$o1j5j+X9QoW3y9vM8b6kC7H2aB4dJ1eF0g3hI5lN6oP';

export const MAX_LOCKOUT_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  return argon2.verify(storedHash ?? DUMMY_PASSWORD_HASH, password);
}

/** Runs a dummy argon2 verify to equalise response time for unknown emails. */
export async function burnPasswordTiming(password: string): Promise<void> {
  await argon2.verify(DUMMY_PASSWORD_HASH, password);
}

export function assertPasswordPolicy(password: string): void {
  if (
    typeof password !== 'string' ||
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    throw new AppError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: PASSWORD_POLICY_DESCRIPTION,
      silent: true,
    });
  }
}

export function isPasswordPolicySatisfied(password: string): boolean {
  return (
    typeof password === 'string' &&
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password)
  );
}
