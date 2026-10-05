/**
 * Display route group.
 *
 * Outside `(staff)` on purpose. The waiting-room board exists for people standing in
 * a room who are not signed in, so behind the staff shell it would show nothing to
 * the people it is for.
 *
 * A group rather than a path segment: `(display)` contributes nothing to the URL,
 * so `/display` stays flat while its own layout keeps the board free of staff
 * chrome. This is the seam for display-specific concerns — kiosk resolution,
 * rotation, a screensaver timeout — none of which belong on a clinician's screen.
 *
 * Deliberately carries no session check. That is the point of the group, and it is
 * also the reason nothing identifying may ever be rendered here; see
 * `DisplayBoard`, which accepts call numbers only.
 *
 * The `main` landmark is declared here rather than inherited. Leaving the staff
 * shell removed this page's only `main`, and axe caught it in all four
 * theme/density combinations the moment the board moved — which is precisely what
 * the per-route sweep is for. A layout that silently depends on an ancestor for its
 * landmarks is a layout that breaks when the ancestor changes.
 */
export default function DisplayLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh bg-canvas">{children}</main>;
}
