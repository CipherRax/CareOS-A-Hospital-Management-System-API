import { StaffShell } from '@/components/staff/staff-shell';

/**
 * Staff route group.
 *
 * A group, not a path segment: `(staff)` contributes nothing to the URL, so these
 * screens keep the flat route structure the brief specifies while sharing one
 * layout. Staff screens and the patient portal will therefore be able to diverge
 * into separate shells without a routing migration.
 *
 * The session check belongs here, ahead of the shell, when authentication lands.
 * It is the natural seam — one place to require a session for every staff route.
 */
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <StaffShell>{children}</StaffShell>;
}
