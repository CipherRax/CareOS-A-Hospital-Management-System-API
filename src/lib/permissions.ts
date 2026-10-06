/**
 * Permission checks for UI gating.
 *
 * **This is UX, not security.** The brief says so explicitly and the server is the
 * authority: a control hidden here is still enforced by the API, and a control shown
 * here because of a stale permission list is still refused by the API. What this
 * buys is that a receptionist is not shown a "Release result" button that will
 * bounce, and a pharmacist is not shown a pricing view they cannot open.
 *
 * Failing closed matters even so. A permission check that returns `true` when it
 * cannot tell renders controls for people who will be denied them, which is both
 * confusing and a small information leak about what roles exist. An unknown
 * principal has no permissions.
 */

export interface Principal {
  readonly permissions: readonly string[];
}

/** Grants everything. Held by owner/superuser roles. */
const GLOBAL_WILDCARD = '*';

/** Namespace grant: `patients.*` covers `patients:read` and `patients:write`. */
const NAMESPACE_SEPARATOR = ':';

export function hasPermission(
  principal: Principal | null | undefined,
  permission: string,
): boolean {
  if (!principal) return false;
  const granted = principal.permissions;
  if (granted.includes(GLOBAL_WILDCARD)) return true;
  if (granted.includes(permission)) return true;

  const [namespace] = permission.split(NAMESPACE_SEPARATOR);
  if (!namespace) return false;
  return granted.includes(`${namespace}.${GLOBAL_WILDCARD}`);
}

/**
 * Whether the principal holds every one of the permissions.
 *
 * Used for actions that are only meaningful as a whole, such as releasing a
 * verified lab result, which needs both the result permission and the release
 * permission. "Any of" is the wrong default for those: showing the control and
 * having the server refuse it is the failure this module exists to prevent.
 */
export function hasEveryPermission(
  principal: Principal | null | undefined,
  permissions: readonly string[],
): boolean {
  return permissions.every((permission) => hasPermission(principal, permission));
}
