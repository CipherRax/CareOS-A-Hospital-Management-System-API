import { PortalGate } from '@/components/portal/portal-gate';

/**
 * Patient portal route group.
 *
 * A group, not a path segment: `(portal)` contributes nothing to the URL, so
 * patient screens live under the flat `/portal` route the brief specifies and
 * share one layout. Keeping the portal in its own group — rather than under
 * `(public)` or `(staff)` — is the point: the patient surface has its own gate
 * and its own shell, and neither can be reached by editing a URL into another
 * group.
 *
 * `PortalGate` sits here, ahead of the shell, and fails closed. One place
 * requires a patient session for every portal route, so a new screen is gated by
 * being added to this group rather than by remembering to check.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <PortalGate>{children}</PortalGate>;
}
