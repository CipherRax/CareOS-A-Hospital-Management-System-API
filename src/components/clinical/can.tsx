import { type Principal, hasEveryPermission, hasPermission } from '@/lib/permissions';

/**
 * Permission gate.
 *
 * Renders `children` only when the principal holds the permission. Defaults to
 * rendering nothing rather than a fallback: a `fallback` prop makes it easy to
 * write `<Can permission="x" fallback={<DisabledThing/>}>`, and a disabled control
 * that looks disabled only sometimes is worse than an absent one.
 *
 * See `src/lib/permissions.ts` — this gates what a person is *offered*, never what
 * they are *allowed*. The API remains the authority and every gated screen still
 * has to handle 403.
 */

export interface CanProps {
  principal: Principal | null | undefined;
  permission?: string;
  /** All of these, rather than any. For actions that only make sense whole. */
  allOf?: readonly string[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function Can({ principal, permission, allOf, children, fallback = null }: CanProps) {
  const permitted = permission
    ? hasPermission(principal, permission)
    : allOf
      ? hasEveryPermission(principal, allOf)
      : false;

  if (!permitted) return <>{fallback}</>;
  return <>{children}</>;
}
