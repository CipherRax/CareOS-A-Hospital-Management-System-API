import { PortalProfile } from '@/components/portal/portal-profile';

/**
 * /portal — the patient portal profile (F11).
 *
 * The read answers `{ patient }`, the demographics allowlist `toPublicPatient`
 * projects upstream; the body is validated in `src/lib/data/portal.ts` (GAP-020
 * family: the export types it as unknown). Self-scoped — the API derives the
 * patient id from the session, so this route takes no id.
 */
export default function PortalPage() {
  return <PortalProfile />;
}
