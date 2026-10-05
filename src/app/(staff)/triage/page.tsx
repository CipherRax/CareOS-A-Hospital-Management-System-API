import { TriageQueueScreen } from '@/components/staff/triage-queue-screen';

/**
 * /triage — the staff triage queue.
 *
 * Server component that renders a client screen. The queue itself is client state
 * because it polls and filters interactively, but the route stays a plain page so
 * adding a later server-side gate (session check, facility scoping) is a local
 * change rather than a restructuring.
 *
 * The data comes from MSW fixtures and is marked EXAMPLE throughout, so a
 * screenshot of this screen can never be mistaken for a real patient list. See
 * docs/limitations.md.
 */
export default function TriagePage() {
  return <TriageQueueScreen />;
}
