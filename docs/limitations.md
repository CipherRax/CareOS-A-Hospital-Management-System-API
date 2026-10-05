# Known limitations

Phase F0. Everything here is a real, unverified, or unfinished thing — not a
placeholder for something that works.

---

## Verified in a browser

### Automated axe across both themes and both densities

`npm run test:a11y` runs Playwright with `@axe-core/playwright` against the real
production bundle and asserts zero violations for WCAG 2.0/2.1 A and AA, WCAG 2.2
AA, and best-practice rules, in all four theme/density combinations. It is part of
`npm run gate`.

The first run failed, and the failures were real:

- **No `main` landmark.** `/design-system` had no `<main>`, so there was no
  landmark entry point and all 101 content nodes were flagged as "not in a
  region".
- **Every filled button was at 2.6:1.** See the tailwind-merge entry under
  `docs/decisions.md` — the `text-on-fill` colour class was being deleted from the
  DOM, so filled buttons silently inherited the body text colour.
- **The checkbox had no accessible name at all.** `CheckboxField` passed
  `htmlFor={props.id}`, and `id` was `undefined` unless the caller supplied one.

The keyboard test is written to use Playwright's ARIA snapshot for accessible
names. An earlier version read `aria-label` and `textContent`, which reports a
label-associated input as "unlabelled" — it would have produced false positives,
and it nearly buried the genuinely nameless checkbox it was meant to catch.

### axe is necessary, not sufficient

A passing run is not a conformance claim. axe cannot judge tab order, focus
trapping, focus visibility against a real background image, screen-reader
announcement quality, or motion comfort. Those need manual review with assistive
technology and expert testing before any release.

---

## Unverified

### Layout at real viewport sizes and with real content

Rendering is verified in Chromium at the Playwright desktop viewport, against
synthetic content. Real patient data is longer than the specimen strings here —
long facility names, long free-text summaries, translated Swahili strings that
expand by 20-40%. Truncation and wrapping behaviour under realistic content is
reasoned about, not observed.

### Only one browser engine

The run is Chromium-only, on purpose: institutional deployments are managed
workstations with a known browser, and a cross-browser matrix before anything has
shipped would be theatre. Revisit when deployment data says otherwise. Nothing in
the token layer depends on engine-specific CSS, but that is an argument, not a
measurement.

### Token contrast is verified; layout and interaction are not

`npm run tokens:verify` proves 94 colour pairs meet their thresholds, and axe
proves the rendered colours meet theirs. Neither says anything about whether the
result is usable.

## Incomplete

### The staff shell has no session gate

`src/app/(staff)/layout.tsx` renders the nav rail and header for any visitor,
including an unauthenticated one. It exposes only fixture data today, so nothing
sensitive is reachable — but it must be gated before a real record is rendered,
and the header's identity area is empty until `/auth/me` returns something. The
seam is the staff layout. See GAP-010.

### The triage queue is fitted, not wired

`/triage` renders `EXAMPLE` fixtures, because the queue endpoint does not exist
(GAP-009). Column order, density, status treatment and long-text behaviour are all
reviewable; the data access is not. Row links point at `/triage/{reference}`, which
is also undefined (GAP-011) and will 404.

### The nav rail shows no counts

`NavItem.count` is implemented and tested, but nothing supplies a count. The
endpoint that would feed it is not in the contract, and a fabricated number in a
navigation bar is worse than none.

### The OpenAPI contract is hand-authored and partial

The careOS API generates its document at runtime and checks none in, so
`openapi/careos.partial.json` was written by hand from the brief and from the
backend's known contract. It covers the envelope, the error shape, `/public/config`,
`/public/facilities`, `/public/emergency-requests` and `/auth/me` — and nothing
else.

An export script now exists on the API side (`npm run openapi:export`), which
closes the gap properly, but it could not be run here: it needs a live PostgreSQL
and Redis, and no container runtime is available in this environment. Until it is
run and the real document replaces the partial one, treat every schema in
`src/api/schema.d.ts` as provisional. See `docs/api-contract-gaps.md`.

### No component tests for most primitives

`Button`, `Field`, `CheckboxField`, `StatusPill`, `NavRail` and `DataTable` have
behavioural tests. `Badge`, `Dialog`, `ConfirmDialog`, `Select`, `Tooltip`,
`Skeleton` and `Toaster` are unrendered by any unit test — they are exercised only
by the axe run against the design-system page, which proves they are reachable and
named but says nothing about their behaviour. `Badge` carries the never-colour-alone
rule and has no test of its own; `StatusPill` does, and the rule is duplicated
across the two components rather than shared.

### Signature components are a third done

`StatusPill`, `NavRail` and `DataTable` exist. The rest of the brief's list —
`Timeline`, `PatientHeader`, `TriageQueue`, `DisplayBoard`, `EmergencyForm` and the
others — have not been started, and `TriageQueue` is blocked on GAP-009.

### /design-system is reachable in production

An earlier draft of this file claimed Next excluded the route from production
builds. It does not: the route is in the production route table. It is `noindex`
and holds no patient data, so it is harmless today, but the moment real screens
land it must move behind the staff session check. Treat this as a scheduled item
for F1, not a non-issue.

### No test coverage threshold

Coverage is measured (`npm test -- --coverage`) but not enforced. Setting a
threshold before there are meaningful tests would lock in a low number and create
pressure to add tests that satisfy a metric rather than catch a defect.

### Signature components not started

F0 delivered tokens, foundations and the primitive layer. The ~15 signature
components — StatusPill, DataTable, Timeline, PatientHeader, TriageQueue,
DisplayBoard, EmergencyForm, and the rest — are F1 work, deliberately held until
the design direction is reviewed.

---

## Security debt

### Content-Security-Policy allows `'unsafe-inline'` for scripts

The theme bootstrap script must run before first paint and cannot wait for the
bundle, so it is inlined and the CSP cannot be tightened to `script-src 'self'`.

This is a known weakness in a product handling patient data. The fix is a
per-request nonce, which is a small change but needs care with the inline script's
position in the document head. Not done in F0.

`style-src` also allows `'unsafe-inline'`, which is less serious — Tailwind and
font CSS are same-origin — but would be tightened alongside the nonce work.

### /design-system is unauthenticated

See the note above. It renders design tokens and nothing sensitive, but it is the
only route in the app that a signed-out visitor can reach, and it stays that way
until F1 adds a session check.

### No authentication, authorisation, or PHI handling exists yet

Nothing in this repository touches patient data. There is no session handling, no
route protection, no authorisation, and no PHI in storage. `referrer: 'no-referrer'`
and a `noindex` robots directive are set as early defaults; they are not
substitutes for the real work, which starts with the auth layer.

### No audit logging

Brief section 8 requires an immutable audit trail of who did what. Nothing exists
yet. It belongs with the first feature that mutates data, not before — but it is
not optional and must not be deferred past F2.

---

## Environment

### No container runtime

Docker is unavailable in this environment, so the API cannot be booted, its
migrations cannot be applied, and the real OpenAPI document cannot be exported.
The API's own end-to-end suite cannot run either.

### Node 26 and npm 11

The local toolchain is ahead of what the ecosystem has settled on. `@types/node` is
pinned to `^26` to satisfy Vitest's peer range. Worth revisiting against CI's
actual runtime.
