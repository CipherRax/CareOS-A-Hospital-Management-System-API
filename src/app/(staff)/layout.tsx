import { StaffGate } from '@/components/staff/staff-gate';

/**
 * Staff route group.
 *
 * A group, not a path segment: `(staff)` contributes nothing to the URL, so these
 * screens keep the flat route structure the brief specifies while sharing one
 * layout. Staff screens and the patient portal will therefore be able to diverge
 * into separate shells without a routing migration.
 *
 * `StaffGate` sits here, ahead of the shell, and it fails closed: staff content
 * renders only once `/auth/me` has confirmed a session. One place requires a
 * session for every staff route, so a new screen is gated by being added to this
 * group rather than by remembering to check.
 *
 * `/display` is deliberately not in this group. It is unauthenticated by design —
 * see `src/app/(display)/layout.tsx`.
 */
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <StaffGate>{children}</StaffGate>;
}
