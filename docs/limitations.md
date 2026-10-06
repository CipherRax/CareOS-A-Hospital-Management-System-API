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

### The Swahili catalogue was unreachable until this slice

Every user-visible string has resolved through `next-intl` since F0, and the Swahili
catalogue was complete from day one. Nothing ever set `careos-locale`, so the public
portal was reachable in one language only — on the surface people open in a hurry,
in a country where that is not an acceptable default. The catalogue being present is
not the same as the language being available, and no test would have said otherwise.

The switch is public-only by decision, not oversight. Staff workstations are managed
and the language follows the machine; an accidental switch mid-consultation is a cost
with no upside. The waiting-room board has no switch for the same reason — it is read
at distance by people who cannot be expected to find a language control.

Three defects surfaced while building it, none of which curl or the unit tests could
see:

- `<html lang>` was hardcoded to `en`, so a Swahili page was announced with an English
  screen-reader voice. A page's language is load-bearing for assistive technology, not
  metadata.
- `NextResponse.redirect` built an absolute `Location` from a `request.url` that Next
  had normalised to `localhost`, so a reader on `127.0.0.1` was redirected to a
  different host and the cookie never followed them. Now a relative `Location`.
- `next/link` navigates client-side over RSC, which arrives as
  `GET /locale?_rsc=…` with the query string dropped. The handler saw no locale and no
  target, silently fell back to English and `/`, and set a cookie the whole time.
  Setting a cookie is a state change and belongs in a full document navigation.

Only the browser test caught the last one.

## Incomplete

### A session cannot be started or ended

The staff gate fails closed: content renders only after `/auth/me` confirms a
session, and an unreachable API counts as signed out. What it cannot do is let
anyone _in_ or _out_ — no `/auth/login` and no `/auth/logout` exist (GAP-010), so
neither the signed-out page nor the header offers a control. Both would be links to
404s, and a link that looks like it works teaches staff it works.

This is the one item here that blocks a real deployment rather than merely being
unfinished. A shared clinical workstation with a session that cannot be ended is not
acceptable, and it is not fixable from the frontend.

### The intake form hands out a reference nobody can use

`/request` is built against `POST /public/emergency-requests`, the one fully
specified endpoint in the contract, so it is real work rather than a mock. But
`/public/emergency-requests/{reference}/track` does not exist (GAP-008), so the
reference it returns has no tracking page. The receipt tells a member of the public
to keep a number that currently does nothing.

The form deliberately offers no invented next steps and no "what happens next" list,
because a fabricated step in an emergency is the most damaging thing this screen
could say. That choice makes the missing endpoint more visible rather than less, which
is the correct direction.

For the same reason, when the facility list cannot be loaded the page renders a
plain "temporarily unavailable" notice with no list of phone numbers. Those numbers
would have to be invented, and a wrong number in an emergency is worse than none.

### Focus trapping is now verified, but only in Chromium

Dialog focus was previously listed as unverified. It is now driven the way a
keyboard user would — focus moves in on open, Tab and Shift+Tab stay inside, Escape
and Cancel close, and focus returns to the trigger — which found three real defects:
`aria-modal` was never set (Radix hides the background with `aria-hidden` but does
not set the attribute), the demo dialog's Cancel button closed nothing, and
`ConfirmDialog` rendered its consequence as an unassociated paragraph, so "this cannot
be undone" reached nobody not looking at the screen. `ConfirmDialog` also had no way
to confirm at all, so it required an `onConfirm` before it could be used.

That is Chromium only. Focus behaviour differs enough between engines that "verified"
here should not be read as "verified" anywhere else.

### The intake form is verified against a stub, not a real API

The end-to-end tests run against `e2e/stub-api.mjs`, which answers the documented
facilities and intake paths and 404s everything else. That is real HTTP through the
real proxy and a real form submission, but it is not the careOS API: no rate limiter,
no validation rules, no real reference format. Docker being unavailable is why the
exported contract and a live API are both out of reach.

The consent rules deserve a specific note. The schema requires
`consentToContact: true` literally, so the body always carries `true` — which means
consent is only real if the form _blocks the send_ when the box is unticked. That
check was initially missing, and the field was therefore recording consent nobody
gave. A test asserting the checkbox starts unticked and the send is refused caught it.
Any future edit to that path needs the same test.

### The display board is now unauthenticated, and that is the point

`/display` moved out of the `(staff)` group into its own `(display)` group with no
session check, because a waiting-room board exists for people who are not signed in
and behind the staff shell it showed nothing to the people it is for. It is
deliberately unlinked from the nav rail: a clinician has no use for it, and a link
is an invitation to wire in data the screen must never receive.

Moving it immediately broke the page's `main` landmark in all four theme/density
combinations, because the landmark had been inherited from the shell it left. That
is the argument for sweeping every route rather than a representative sample.

### The display board is in the wrong place, on purpose

`/display` currently sits inside the `(staff)` route group, so the waiting-room
board renders with the nav rail and behind a staff session. That is the opposite of
where it belongs: a board exists for people who are not signed in, and behind the
session it would show nothing to the people it is for.

It was left there rather than quietly built as an unauthenticated public route
because doing so means deciding the deployment story — resolution, authentication
for a display surface, and whether the board appears on a shared ward screen at all.
That is a decision to make, not one to sneak in while fitting a component. It is
also why the route is not linked from the rail: nothing should ship a link to a page
that will be moved.

### The patient record route will 404 for every real patient

`/triage/EX-0001` renders fixtures and `notFound()`s anything else, deliberately. A
page that showed EXAMPLE Achieng's record under any reference would be actively
dangerous the moment real data arrived. Until the record endpoint exists (GAP-011),
the queue's row links point at a 404 — which is why the axe sweep exercises the
fixture route directly rather than by clicking through.

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

### Signature components are under half done

Present and tested: `StatusPill`, `NavRail`, `DataTable`, `PatientHeader`,
`Timeline`, `DisplayBoard`. Not started: `EmergencyForm` and the public intake
components, all of which are blocked on the contract gaps they would need to
invent. `TriageQueue` is a screen rather than a component and remains on fixtures
(GAP-009).

`Timeline` has no timezone handling beyond rendering the ISO value it is given. It
formats in the server's locale and offset, and nothing tells a clinician which
offset they are looking at. A clinical timeline where two events appear an hour
apart without saying why is a defect waiting for a DST boundary to expose it.

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
