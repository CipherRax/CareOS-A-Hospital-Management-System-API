import { OrganizationScreen } from '@/components/staff/organization-workspace';

/**
 * /organization — the organization profile (F9 administration).
 *
 * The read answers `{ organization }` while the export types the bare entity
 * (GAP-020), so the body is validated in `src/lib/data/admin.ts`. Only one
 * organization exists per account, so there is no directory or id.
 */
export default function OrganizationPage() {
  return <OrganizationScreen />;
}
