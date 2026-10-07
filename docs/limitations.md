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

### `MoneyText` is display-only, and that is a limitation

The component formats a decimal string exactly and performs **no arithmetic**. A
totals row, a balance calculation or a refund limit needs a decimal library
(`decimal.js`), which is not installed. Writing one as `a - b` on strings in a
billing screen would reintroduce the cent-level error this component exists to
prevent, so it refuses the job instead.

`Intl.NumberFormat.format` is typed to reject runtime strings, because the usual way
to pass one is `Number(s)`, which routes the value through a binary float —
`Number('12345678901234567890.99')` is `12345678901234567000`. The runtime is exact
per ECMA-402, so the cast is sound; it is pinned by tests over values a float cannot
represent, and would be unsound without the `DECIMAL_STRING` guard in front of it.

### Permission gating is UX, and the principal is still a guess

`Can` hides what a person cannot do. It is not a security control and the API remains
the authority — every gated screen still has to handle 403. The permission strings
themselves (`patients:read`, `lab:release`) are invented here because the real
`/auth/me` exists but its success body is **untyped** in the exported document and
no live session has been captured to inspect it (the seeded login is blocked — see
above); the wildcard semantics are ours, not the API's.

### Untranslated clinical strings

Swahili strings in `src/i18n/messages/sw.json` were written without review by a
native speaker, which brief §2.6 requires to be marked. `sw.json` now carries a
`_review` block listing every draft namespace. Nothing in that catalogue should ship
unreviewed.

## Incomplete

### Session starts and ends only through the proxy-owned cookie bridge

The staff gate fails closed: content renders only after `/auth/me` confirms a
session, and an unreachable API counts as signed out. `/login` and the header
`Sign out` complete this — the last F11 item is built (F1/F11B). The token pair
is deliberately never in page-reachable memory: the proxy lifts `data.tokens` out
of the login response into two HttpOnly cookies (`careos_session`,
`careos_refresh`, SameSite=Lax, Secure over TLS), translates the session cookie
into `Authorization: Bearer` upstream, rotates once through `/auth/refresh` on a
401, and injections the refresh token into logout the browser is never allowed to
know. See the route handler and `docs/decisions.md`.

This is still constrained by what the API will let us verify:

**Upstream defect: no seeded account can log in.** `POST /auth/login` requires
`organizationId` in uuid format, but the seed data assigns string ids
(`demo-org-nairobi`). The login that would exercise `/auth/me`'s success body
against the live API cannot be performed. Raised for the API side to decide; the
frontend does not paper over it. The bridge is verified end to end against the e2e
stub (real HTTP server upstream of the real proxy) and against MSW in unit tests.

**MFA sign-in has no UI.** The login form handles an `mfaRequired: true` reply by
showing the challenge notice (the API's contract for it, with no live session to
inspect) and no second-factor entry. Single-factor sign-in is the built path; MFA
is honest about not being one.

### The intake tracking page is built on a contract whose success body is untyped

`/request` is built against the live `POST /public/emergency-requests` contract
(body `SubmitEmergencyRequestDto`, slug-keyed; the receipt shows the real
`referenceNumber` and `trackingToken`). `/track` posts the real
`TrackEmergencyRequestDto` (`{ token }`) to `POST /public/emergency-requests/track`
and renders the API's own caller-safe copy (`statusLabel`, `message`, `disclaimer`,
national `numbers`) verbatim. The 200 body is typed `unknown` in the exported
document, so the tracker validates it structurally before rendering and fails to a
plain generic message rather than inventing a state.

The tracking token is treated as a secret: it travels in a POST body only, is never
persisted to storage or the URL, and is cleared from the field when the result
renders. `<trackingToken>` min-length mirror and live API validation were verified
against the service but not against a booted API (no seeded request exists to track;
the token mock value `ex-tok-00001`/`tok_example_track_0001` is `EXAMPLE`-marked).

For the same reason, when the facility list cannot be loaded the page renders a
plain "temporarily unavailable" notice with no list of phone numbers. Those numbers
would have to be invented, and a wrong number in an emergency is worse than none.

### Facility search is verified against the live endpoint, minus its data

`/facilities` now searches `GET /public/facilities/search` with a real `q` filter
through the real proxy, verified against a booted careOS API: `q` is a genuine
case-insensitive server-side text search (the old invented `type` filter and
`GET /public/facilities` path are both ghosts — the latter 404s). Facets are
applied client-side from the API's own booleans (`open24h`,
`emergency24h`, `ambulanceAvailable`). The exported document types the search
200 body as `unknown` and omits `q`, so the screen validates the body structurally
and the search fetches with a raw `fetch`; a result body that drifts again fails
into "directory unavailable" rather than an empty directory.

The directory has one published facility in the seeded database, so the app's
multi-result behaviour is exercised against `EXAMPLE` fixtures rather than real
data.

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

### The intake form is verified against a stub, not the live API

The end-to-end tests run against `e2e/stub-api.mjs`, which now answers the
**real** facilities and intake paths (`/public/facilities/search` with `q`, the
slug-keyed intake POST, the new 201 receipt, `UNAUTHORIZED` on `/auth/me`) and
404s everything else with `RESOURCE_NOT_FOUND`. That is real HTTP through the
real proxy and a real form submission, but it is not the careOS API: the stub has
no rate limiter and no validation beyond slug presence.

Consent works differently from the old draft contract, and the form reflects it:
the live body carries `consentVersion` (recorded server-side), and there is no
`consentToContact` checkbox to tick. The retired checkbox was a consent record
nobody could verify; a test now asserts no such box exists on the public form, so
re-shipping it as decoration is caught rather than silent. The rate-limit path is
still exercised against the stub's cookie.

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

### The queue live-region uses a plain `div`, not `display: contents`

The waiting-room call in `NowServing` announces through `aria-live`/`aria-atomic`
on an ordinary element. `display: contents` was rejected for its classic pitfall —
removing the element's own box — and engines have historically dropped the
`display: contents` element's accessibility subtree. A public board is a poor place
to discover a screen-reader regression, so the wrapper stays.

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

### The contract is real and regenerated from a live API

The careOS API generates its OpenAPI document at runtime; the frontend now checks in
a copy of the real export as `openapi/careos.openapi.json`, produced by the API's
`npm run openapi:export` against a locally booted PostgreSQL, Redis and API process
(this environment turned out to have them — no container runtime was needed after
all). `src/api/schema.d.ts` is regenerated from it on `npm run api:types`.

Two export quirks flow into the build: the facility-search 200 and emergency 201
bodies are typed `unknown`, and the `q` parameter is absent from the document (so
the search sends it via a raw `fetch`). Both are handled — see
`docs/api-contract-gaps.md`. Swahili copy remains unreviewed and marked as a draft.

### No component tests for most primitives

`Button`, `Field`, `CheckboxField`, `StatusPill`, `NavRail` and `DataTable` have
behavioural tests. `Badge`, `Dialog`, `ConfirmDialog`, `Select`, `Tooltip`,
`Skeleton` and `Toaster` are unrendered by any unit test — they are exercised only
by the axe run against the design-system page, which proves they are reachable and
named but says nothing about their behaviour. `Badge` carries the never-colour-alone
rule and has no test of its own; `StatusPill` does, and the rule is duplicated
across the two components rather than shared.

### Signature components: 20 of 20, none exercised against a real record

The brief's §2.4 list is complete — `StatusPill`, `DataTable`, `Timeline`,
`QueueTicket`, `NowServing`, `PatientBanner`, `EstimateBadge`, `MoneyText`,
`AuditNote`, `BreakGlassDialog`, `AmendmentDialog`, `ConflictDialog`, `BedTile`,
`WardBoard`, `BatchRow`, `CommandPalette`, `Can`, `EmptyState`, `FormSection`,
`KeyValueGrid`.

Every delivered component is verified against synthetic data only. None has met a
real record, a real conflict, a real bed, or a real queue, because the contracts
those would come from do not exist (GAP-008/009/011). `CommandPalette` was built
in-house on the existing Radix `Dialog` rather than `cmdk`, so the keyboard model
is a conventional combobox/listbox with `aria-activedescendant` and there is no new
dependency to audit.

The reason gating is client-side. It prevents a reflex click within this app, but
the API remains the authority and must enforce the same requirement on every
endpoint these dialogs compose — otherwise the UI is polite and the data path is
not.

`BreakGlassBanner` accepts `minutesRemaining` as an optional prop and renders no
countdown when it is absent. Nothing in the frontend supplies it yet — the staff
triage surface is not built against the API — so a banner with no timer is the
honest state, not a gap in this component.

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

### No authorisation, PHI handling, or audit logging exists yet

Nothing in this repository touches patient data. The staff surface now has a real
sign-in/sign-out, session cookies held by the proxy, and a fails-closed gate, but
there is still **no authorisation** (permissions are invented `Can`/wildcard
strings; the API remains the authority), and no PHI in storage. `referrer:
'no-referrer'` and a `noindex` robots directive are set as early defaults; they
are not substitutes for real authorisation, which must follow the auth layer.

### No audit logging

Brief section 8 requires an immutable audit trail of who did what. Nothing exists
yet. It belongs with the first feature that mutates data, not before — but it is
not optional and must not be deferred past F2.

---

## Environment

### No container runtime, but a live API was reachable anyway

Docker is unavailable in this environment, so the API cannot be booted in a
container and its own end-to-end suite cannot run. In this slice the API was
instead booted directly: a locally built PostgreSQL 16.6 (`~/.local/pg/bin`),
Redis 7.2.5, and the NestJS/Fastify prod build at `http://localhost:3000`, with
all 26 migrations applied (one PG16 enum bug worked around) and the seed loaded.
That yielded the real OpenAPI at `docs/openapi.json` and live verification of the
facility search, intake 201, `/auth/me` 401, and the seed/login org-id mismatch.
The boot recipe is not yet codified in a script; reproducing it needs the same
manual steps.

### Node 26 and npm 11

The local toolchain is ahead of what the ecosystem has settled on. `@types/node` is
pinned to `^26` to satisfy Vitest's peer range. Worth revisiting against CI's
actual runtime.
