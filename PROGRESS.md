# careOS web — progress

Phases follow the brief's plan. Each phase ends with a passing gate, updated
documentation, and a commit.

---

## Roadmap

Status against the brief's phase table. "Blocked" means the API contract for the
work does not exist, so the screen cannot be built without inventing an endpoint.

| Phase                          | State                                                                                      | Blocked on                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| F0 Design system & foundations | **complete**, design review **passed** (F12)                                               | —                                                      |
| F1 Auth, session, shell        | **complete** — login/logout, proxy session bridge, gate, shell, nav rail                   | live round-trip awaiting a bootable API                |
| F2 Patients & reception        | **complete** — patient search, walk-in registration with duplicate guard, master record (banner + sections + timeline + access log), MSW fixtures, structural validators | shipped (`a185d69`, `8b6ce44`); live API round-trip Docker-gated; GAP-012–GAP-016 documented |
| F3 Scheduling, queue, nursing  | **complete** — reception queue slice (live queue board, walk-in ticket issuance, status/priority moves), appointment desk slice (day book, booking with slot search, appointment status moves, department waitlist), nursing vitals slice (patient chart, record/correct with BMI), schedule admin slice (weekly template CRUD + dated exceptions), and reschedule from the day book | live API round-trip Docker-gated; GAP-017–GAP-019 documented |
| F4 Doctor workspace            | encounters + clinical notes + prescriptions + results **complete** — encounter list (`/encounters`) with status/department filters, workspace (`/encounters/[id]`) with the workflow moves OPEN → IN_PROGRESS → COMPLETED (COMPLETED locked, stale 409 surfaced in place), the clinical-notes panel (structured DRAFT → Finalize → Amend with version history), the prescriptions panel (medication orders: DRAFT → issue → pharmacy dispense, cancel while un-/partially-dispensed), and the read-only results panel (released laboratory results + imaging reports); MSW fixtures + stub + e2e swept | live API round-trip Docker-gated; GAP-020 documented |
| F5 Laboratory & radiology      | **complete** — laboratory worklist + order workspace, radiology worklist + imaging workspace, and order entry from the encounter | billing |
| F6 Pharmacy & inventory        | **complete** — pharmacy dispense worklist (`/pharmacy`), stock control (`/pharmacy/stock`: on-hand, risk advisories, receiving) and wastage write-offs | transfers/counts/POs have no read endpoint (GAP-020) |
| F7 Billing & insurance         | **complete** — invoices desk (slice 1); insurance claims desk (slice 2): claims worklist (`/insurance`) + claim workspace (`/insurance/[id]`) with submit/approve/partial-approve/deny/pay and raise-claim from the invoice workspace; insurance administration (slice 3): payers management (`/insurance/payers`) and patient policy enrolment (Insurance tab on the patient record) | create-invoice needs a branch picker; M-PESA |
| F8 Inpatient & emergency       | **complete** — ward & bed board (slice 1), admissions desk (slice 2), emergency desk (slice 3) |                                                           |
| F9 Administration & audit      | in progress — users administration (slice 1), role management (slice 2), staff directory (slice 3)                   | organization profile (slice 4); audit-log viewing has no API endpoint |
| F10 Analytics & reports        | not started                                                                                | analytics, forecasts, reports                          |
| F11 Portal & queue display     | partial — display board done                                                               | portal read models                                     |
| F11B Public website            | **complete** — search, intake, tracking, and the session start/end UI on the live contract | —                                                      |
| F12 Hardening & release        | complete in this slice — strict CSP, deployment story, design review                       | image build unverified on a Docker-capable machine     |

**Signature components (brief §2.4): 20 of 20.**

| Delivered                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StatusPill`, `DataTable`, `Timeline`, `QueueTicket`, `NowServing`, `PatientBanner`, `EstimateBadge`, `MoneyText`, `AuditNote`, `BreakGlassDialog`, `AmendmentDialog`, `ConflictDialog`, `BedTile`, `WardBoard`, `BatchRow`, `CommandPalette`, `Can`, `EmptyState`, `FormSection`, `KeyValueGrid` |

Every component above is exercised on `/design-system` (login-gated and
MFA-protected since F1), which the F12 design review swept across all four
theme and density pairs — see `docs/design-review.md`. `CommandPalette` is
built in-house on the existing Radix `Dialog`; the `cmdk` dependency question
was resolved as "no new dependency".

Every workspace in F2–F9 is assembled from these, so they are the current work: it is
the only phase work that does not wait on the API.

### Two blockers gate the rest

1. **The seed/login org-id mismatch — fixed API-side (`main` `f8b8492`), awaiting
   a live API to verify the login end to end.** `/auth/login` used to require a
   uuid `organizationId` while `Organization.id` is an unconstrained `String`
   and the seeds are readable tenant names (`demo-org-nairobi`, …), so no
   seeded account could sign in. The login and password-reset DTOs now trim and
   accept any 1..128 character org id, matching the model (unit-covered in the
   API: 921 passing). The frontend session flow (F1) is verified against the
   stub; the live round-trip still needs a bootable API.
2. **No triage, queue or patient-record contracts verified against a running
   API.** `/triage` is fixture-fitted, which caps F2 and F3 until the API can
   boot here (Postgres/Redis — the Docker daemon on this machine is root-only)
   and its OpenAPI is regenerated and re-synced into the web client types.

---

## F0 — Design system and foundations

**Status:** complete, design review **passed** — see `docs/design-review.md`
for the F12 audit, findings and resolutions.

Review at `/design-system`; read `DESIGN.md` first.

### Delivered

**Token system**

- 33 colour tokens as a typed single source of truth (`src/design/tokens/palette.mts`)
- Generated CSS and Tailwind v4 `@theme inline` mapping (`npm run tokens:build`)
- 94 contrast pairs asserted in both themes (`npm run tokens:verify`, wired as `prebuild`)
- Authored scale: staff and public type scales, radius, motion, density
- Both themes, three theme preferences, two densities

**Corrections to the brief's palette.** Measured, not assumed — see DESIGN.md §8:

- `tertiary` retuned in both themes; the brief's values measure 3.88:1 and 3.97:1
- `control` added; no brief token identifies a control at the required 3:1
- `on-fill` corrected for dark theme; white on dark brand is 2.59:1

**Primitives**, all built from tokens only: Button (5 variants, 5 sizes),
Field/Label/Input/Textarea/Select, Checkbox, Badge, Panel, Separator, Tooltip,
Skeleton, Dialog, ConfirmDialog, Toaster.

**Foundations**

- Theme and density persisted in cookies, applied server-side, no flash on reload
- Error catalogue mapping API codes to messages, with `retryable` driving UI affordance
- i18n via `next-intl`, English and Swahili, unprefixed routes, no proxy
- Public language switch: `/locale` sets the `careos-locale` cookie and redirects back
- `/design-system` exercising every primitive, not just the token layer
- MSW handlers generated against the same spec as the client types
- Zod-validated environment, refusing mocks in production
- Security headers, `standalone` output, `no-referrer`, `noindex`
- Strict CSP with a per-request nonce, asserted from the proxy (ADR-010; no
  `unsafe-inline` for scripts)

**Tooling**: ESLint flat config, Prettier, Vitest, Testing Library, coverage,
Playwright with `@axe-core/playwright`, `npm run gate`.

### Verification

| Check                   | Result                                                                     |
| ----------------------- | -------------------------------------------------------------------------- |
| `npm run lint`          | pass                                                                       |
| `npm run typecheck`     | pass                                                                       |
| `npm test`              | 38 tests across 5 files, pass                                              |
| `npm run build`         | pass, 3 routes                                                             |
| `npm run tokens:verify` | 94 pairs pass; tightest 3.25:1 against a 3:1 floor                         |
| `npm run test:a11y`     | 8 tests, pass — zero axe violations in all four theme/density combinations |

### What the browser found

Wiring up Playwright was not a formality. The first axe run failed, and every
failure was a real defect that the previous checks had passed straight over:

- **Every filled button sat at 2.6:1.** `tailwind-merge` cannot see the project's
  `@theme`, so it collapsed `text-on-fill` (colour) and `text-meta` (font size) and
  deleted the colour class from the DOM. ADR-006.
- **No text colour compiled at all.** Tokens named `text-primary` and
  `border-control` could only ever produce `text-text-primary` and
  `border-border-control`, so nothing matched and everything inherited the body
  colour. ADR-007.
- **The standalone bundle served no CSS or JS.** `next build` passed, the server
  returned 200 with correct server-rendered theme attributes, and the page was
  unstyled and entirely non-interactive. Only loading it in a browser showed it.
  ADR-008.
- **The next-intl proxy redirect-looped every page.** With `localePrefix: 'never'`
  it still rewrote to `/<locale>/<path>`, which does not exist in a route tree
  without a `[locale]` segment. Removed; the locale now resolves from our own
  cookie. ADR-003.
- **`CheckboxField` produced a nameless checkbox.** `htmlFor={props.id}` with no
  generated id — a critical `button-name` failure.
- **`/design-system` had no `main` landmark.**

Each fix has a regression test. `DESIGN.md` token names and the generated header
were corrected alongside.

### Not verified

Layout under realistic content lengths, non-Chromium engines, and assistive
technology are still unverified. A passing axe run is not a conformance claim.
Full detail in `docs/limitations.md` — it is deliberately blunt about this.

### Contract

`openapi/careos.openapi.json` is a real export from a live careOS API (the API's
`npm run openapi:export`, run against a locally booted PostgreSQL, Redis and
prod build), replacing the hand-authored partial document. `src/api/schema.d.ts`
is regenerated from it. The real document confirmed the facility search and
intake shapes, corrected the error vocabulary, and revealed upstream quirks —
see `docs/api-contract-gaps.md`, which is now a review of those changes rather
than a list of assumptions.

### Related backend change

Working on the export script surfaced a boot-blocking bug in the API:
`EmergencyIntakeModule` provided `EmergencyNotificationConsumer` without exporting
it, while `OutboxModule` injects it — so the application could not start at all.
Fixed in API commit `2b00fc0`.

---

## F1 — Signature components and staff shell

**Status:** started. Shell, navigation and the first screen delivered; the rest
blocked on review and on the contract.

### Delivered

**Same-origin API proxy** (`src/app/api/v1/[...path]/route.ts`) — clears the last
F0 debt. Forwards method, path, query, cookies and body; returns the upstream
status unchanged; 15s timeout; typed error envelope on failure so the client has one
error path; `no-store` on every response so a shared cache cannot serve one
clinician's response to another. Rebinds upstream `Set-Cookie` to our origin, since
a cookie scoped to the API host is silently dropped by the browser. Eight tests
against a real HTTP server rather than a mocked `fetch`, because a stub would let a
dropped cookie or a body that never arrives pass as correct.

**Query defaults** (`src/lib/data/query-provider.tsx`) — no retry on any 4xx (a 401
is a decision, not a blip), no retry on writes at all (a retried clinical submission
can duplicate a record), `refetchOnWindowFocus` on (a queue left open on a second
monitor must not show data from an hour ago).

**Signature components**

- `StatusPill` — status is a mandatory word in the type signature, so colour-only
  status cannot be written. Each tone has a distinct silhouette, so meaning survives
  greyscale. Tested.
- `NavRail` — text-first, no resting icons, four simultaneous active-state signals,
  `aria-current` as the authoritative one. Counts announce as "3 awaiting review",
  not a bare numeral. Tested.
- `DataTable` — a real `<table>` with a `<caption>`, not a `role="grid"`
  reconstruction. Row navigation is a stretched link rather than an `onClick` on
  `<tr>`, which is unreachable by keyboard. Tabular figures, no zebra striping.
  Tested.
- Staff shell and `(staff)` route group — nav landmark, `banner`, `main`.

**Triage queue** (`/triage`) — the first screen. Fitted against `EXAMPLE` fixtures
with deliberately awkward text lengths, because long values are what actually break
a dense table.

**Patient record** (`/triage/[reference]`) — `PatientBanner` plus `Timeline`.

- `PatientBanner`: the patient name is the page's default `h1` (level is a prop; the
  design-system page renders several under an `h2`), and the reference is never
  truncated. Two patients can share a name; the reference is what disambiguates them,
  so ellipsising it defeats the purpose of showing it. Allergy and risk notices come
  first in document order, so a screen reader meets the allergy before the
  demographics rather than scrolling to find it.
- `Timeline`: an ordered list, because sequence _is_ the meaning — a handover note
  arriving before the triage decision reads as a different history. Sorts by
  timestamp rather than trusting input order, and that ordering is asserted with a
  deliberately reversed fixture. Absolute time is always visible with the ISO value
  retained in a `<time datetime>`: "2h ago" becomes ambiguous across a long shift
  and cannot be quoted in a handover. Every entry names its author, so a gap in the
  record is visible rather than implied.
- `notFound()` for any reference but the fixture. Rendering the same record under
  every reference would be dangerous the moment real data arrived.

**Safety-critical composition** — the five reason-gated dialogs and queue display.
The common thread is that none of them can be confirmed with a default and none of
them performs an action against the API before that action exists on the server.

- `QueueTicket`/`NowServing` — the wait-room call, `aria-atomic` on a plain `div`
  (see `docs/limitations.md`); a live region with `display: contents` does not
  reliably announce).
- `ReasonField` + the three dialogs (`BreakGlassDialog`, `AmendmentDialog`,
  `ConflictDialog`) — every confirm path requires a typed reason of at least
  `REASON_MIN_LENGTH` characters, so "Amend record" cannot be clicked as a reflex.
  Closing a dialog for any reason clears the partial reason, so a justification
  entered for one patient can never sit pre-filled for the next.
- `PatientBanner` — `AllergyState` is a discriminated union (`recorded`,
  `none-recorded`, `not-recorded`) rather than an optional array, so an unrecorded
  allergy list cannot be passed as an empty one and the type system will not let a
  caller ship the "no allergies" reading by forgetting to set a state. The three
  states are shown on the design-system page in sequence for exactly that reason.
  Legal hold and possible duplicate are separate props from clinical risk flags.
- `BreakGlassBanner` — minutes remaining is a prop the API supplies; the banner will
  not conjure a timer from nothing (GAP-008 has no track/cancel contract yet).

**Display board** (`/display`) — `DisplayBoard`, the only component here aimed at
distance. Larger public type scale, one moving element (the current call), status as
a word and a shape because a tint is invisible at that size, and call numbers only —
a public board showing names is a privacy incident waiting to happen. Deliberately
placed in the wrong route group for now; see `docs/limitations.md`.

**Staff session gate** (`StaffGate`) — the largest change in this phase, and the
one that makes the rest of it safe to build on.

- Fails closed. Staff content renders only after `/auth/me` confirms a session, and
  an unreachable API is treated as signed out rather than as a pass. A clinician
  locked out by a network blip is an inconvenience; a clinician looking at another
  clinician's session is an incident.
- The signed-out page picks its message by error code, so an expired session and a
  service outage read differently. Telling someone to sign in when the API is down
  wastes a support call and teaches people to ignore the message.
- It does not depend on the `/auth/me` success shape — verified live to return 401
  `UNAUTHORIZED` with no session, but its 200 body is untyped in the export — it
  needs only a 2xx to mean "signed in", so it stays correct regardless.
- Six unit tests drive the three states directly. A network abort in the browser was
  tried first and proved unreliable to apply, and a test that intermittently does not
  intercept proves nothing.

**Session start/end** (`/login`, `SignOutButton`) — the last F11 item, so F1 and
F11B are both now complete. The session UI is built on a **proxy-owned cookie
bridge** (`src/app/api/v1/[...path]/route.ts`), which is the one place the token
pair is handled:

- Login posts the real `LoginDto` through the proxy. On a 2xx the proxy lifts
  `data.tokens` into two HttpOnly cookies (`careos_session`, `careos_refresh`,
  SameSite=Lax, Secure over TLS), strips `tokens` from the body the browser sees,
  and the page never knows the pair existed. A same-origin `fetch` then proves the
  charm: cookies flow automatically, no header ever paginates JS into the secret.
- `POST /auth/mfa/verify` concludes a second-factor challenge exactly like login:
  the pair it returns is lifted into the cookies and stripped from the body, and
  its 401s (a refused or stale challenge) are never mistaken for a stale access
  token, so the proxy does not rotate there. The form takes either the 6-digit
  TOTP code or a recovery code, mirrors the DTO's one-of rule client-side, maps a
  refusal to its own message, and offers a way back to the credentials when the
  challenge has gone stale.
- Every proxied request carries `careos_session` as `Authorization: Bearer`
  upstream; the browser's own Authorization is still dropped. A 401 on a session
  request (never on login/logout/refresh themselves) rotates once through
  `/auth/refresh` with the refresh cookie and retries; a failed rotation clears both
  cookies so a dead session cannot linger on a shared workstation.
- Logout sends an empty body; the proxy injects the refresh token from the cookie
  (the browser cannot know it) and clears both cookies on a 2xx. The header's
  `Sign out` invalidates the session query and refreshes, and the gate lands on its
  signed-out page — which now earns a `Sign in` link to `/login`.
- Verified end to end: the e2e stub sits upstream of the real proxy, so sign-in,
  cookie→Bearer translation, logout and the 401/503 gate paths all run through the
  real route handler. Verifying inside MSW and the stub rather than against a live
  API would have proved nothing about the cookie bridge.

**Display board moved to its own unauthenticated route group** — a board for people
who are not signed in should not be behind the staff session. This broke its `main`
landmark in all four variants the moment it left the shell, which is the argument for
sweeping every route rather than a sample.

**A real defect in the data layer** — `unwrap` read the error code one level too
shallow. The body is `{ error: { code } }` and openapi-fetch returns a non-2xx body
as `error`, putting the code at `error.error.code`. Every nested error was silently
becoming `INTERNAL_ERROR`, telling clinicians "something went wrong" for problems
that had a specific, correct message waiting in the catalogue. Found because a new
test expected a specific message and got a generic one; fixed by recursing, and
pinned with eight tests.

**Two test-infrastructure fixes**

- `test:a11y` never built. Running it standalone validated the previous build, which
  is how a stale `/display` passed with no `main`. `pretest:a11y` now builds first,
  so the accessibility run cannot validate stale output.
- The suite count is cross-checked against `playwright test --list` on every run,
  not read off the summary line.

**Public emergency intake** (`/request`) — the patient-facing entry point, and the
first screen built against a fully documented endpoint. `POST
/public/emergency-requests` is specified, so there was nothing to invent.

- Server-fetched facility list. The facility is a required field, so a client fetch
  means a member of the public staring at an empty form on a bad connection — which
  is exactly when someone reaches for this page.
- **Nothing implies triage**, which the contract forbids in as many words. No
  self-assessment question, no queue position, no wait estimate, no "a clinician
  will review this". A public that believes it has been assessed is worse off than
  one that knows it has not. Asserted by testing the _absence_ of that language.
- **Consent is the API's act, not a checkbox.** The live body carries
  `consentVersion` recorded server-side; the old `consentToContact: true` checkbox
  does not exist upstream. The form no longer collects it, and a test asserts no
  such box is re-shipped as decoration that records nothing.
- Phone validated as a phone number and nothing else; a strict format gate rejects
  numbers that work.
- Details cleared from the screen after a successful send, and kept after a failed
  one. Losing a description someone spent two minutes writing because the service
  blipped is how people give up.
- 12 unit tests and 3 end-to-end tests, including that the API's diagnostic
  `message` never reaches the page.

**Dialog focus verified, and it found three real defects.** Focus trapping had been
recorded as unverified, which is the weakest kind of claim in a clinical UI — a modal
that lets focus wander behind it lets a keyboard user edit a record they believe they
dismissed. Driving it with the keyboard found:

- `aria-modal` was never set. Radix hides the background with `aria-hidden` but never
  sets the attribute, so the modal was announced as an ordinary dialog.
- The demo dialog's Cancel was a plain `Button` and closed nothing — a control that
  rendered as working and was not.
- `ConfirmDialog` rendered its consequence as an unassociated paragraph, so the
  accessible description was empty and "this cannot be undone" reached nobody who
  was not looking at the screen. It also had no way to confirm at all, so it now
  requires `onConfirm` rather than existing as a dialog that cannot be confirmed.
- Also: the accessibility run now builds inside the Playwright web server rather than
  relying on a `pretest` hook. Twice a run passed against the previous build — a
  route with no `main` landmark, and these very dialog assertions against already
  fixed primitives. Costs one redundant build in the gate; worth it.

### What this phase refused to do

The contract has no triage queue, no queue counts, and no staff session. Rather
than invent them:

- `GET /triage/counts` was written, rejected by the type checker, and deleted. The
  rail renders no count. A hard-coded number in a nav bar looks live and is not.
- The queue reads fixtures, labelled `EXAMPLE`, not a plausible-looking stub fetch.
- The staff layout has no session gate yet, and that is recorded as GAP-010 rather
  than hidden behind a redirect to nowhere.

Logged as GAP-009, GAP-010 and GAP-011.

### Verification

| Check               | Result                                                   |
| ------------------- | -------------------------------------------------------- |
| `npm run lint`      | pass                                                     |
| `npm run typecheck` | pass                                                     |
| `npm test`          | 62 tests across 7 files, pass                            |
| `npm run build`     | pass, 5 routes                                           |
| `npm run test:a11y` | 16 tests, pass — 3 routes × 4 theme/density combinations |

axe now sweeps every reachable route in all four variants, not just the design
system, because a status colour or focus ring that fails in dark mode only fails in
dark mode.

Two corrections worth recording, because both produced a false green:

- Adding the two new routes appeared to leave the suite at "16 passed". It had not.
  Eight were failing and a grep on the reporter's output missed them; the run was
  not actually clean. The test asserted a heading matching its own route label,
  while the real headings are the patient's name and the board's clinic name. Fixed
  by naming routes after their real `h1`. The count is now cross-checked against
  `playwright test --list` rather than read off the summary line.
- `pkill -f 'standalone/server.js'` matches the shell running it, so the cleanup
  step killed the gate it was meant to precede. Teardown now kills by listening
  port.

### Release blockers

1. The seed/login org-id mismatch (API-side): `POST /auth/login` requires a uuid
   `organizationId` but the seeds use string ids (`demo-org-nairobi`), so no
   seeded account can complete a real login. The frontend flow is built and
   verified (F1) but cannot run against the live API until this is resolved.
2. Row links still 404.

See `docs/limitations.md`.

## F11B — Public facility search

**Status:** complete. Facility search, emergency intake, intake tracking and the
session start/end UI (F1) are all built on the **live** contract.

`/facilities` is the `FacilitySearch` page — the second public screen, now built
against the real `GET /public/facilities/search` (the old typed `GET
/public/facilities` with `q`+`type` was a ghost: the real path 404s). `q` is a
genuine case-insensitive server-side text search, verified against a booted API.
Facets come from the API's own booleans — `open24h`, `emergency24h`,
`ambulanceAvailable` — applied client-side, with the `type`/`status` enum words
removed (the live model has neither). Every search state announces itself
(searching / count / no matches / directory unavailable), and a stale response can
never overwrite a newer search's result.

The exported document types the search 200 body as `unknown` and omits the `q`
param, so the search uses a raw `fetch` and validates the body structurally
(`extractListingItems`) — a body that drifts again fails into "directory
unavailable", never into an empty directory. `/request` likewise posts the real
`SubmitEmergencyRequestDto` (slug-keyed) and shows the real `referenceNumber` +
`trackingToken` receipt. Both screens' `EXAMPLE`-marked mock data, MSW handlers,
unit tests and e2e stub were re-aligned to the flat envelope and the live error
codes.

`/track` (F11B tracking page) posts the real `TrackEmergencyRequestDto`
(`{ token }` — keyed by the receipt token, never the reference), validates the
`unknown` body structurally before rendering, and shows the API's own
caller-safe copy (`statusLabel`, `message`, `disclaimer`, national `numbers`)
verbatim. The token is a secret: it lives in a POST body only, is cleared from the
field when the result renders, and never reaches storage or the URL. Errors map
by code to sentences a caller can act on; the API's diagnostic `message` never
renders. Covered by the MSW track handler (`tok_example_track_0001`), the e2e
stub (`ex-tok-00001`), unit tests and two e2e/a11y tests.

The F11B slice closed when `/login` shipped (F1): staff can now start and end a
session from this app, and the public website's last open item is gone.

## F12 — Hardening, first slice: strict CSP

**Status:** in progress. The F0 `unsafe-inline` debt is closed. The proxy
(`src/proxy.ts`) issues a nonce per request, asserts `script-src 'self'
'nonce-…'` (no `'unsafe-inline'`) and `style-src-attr 'unsafe-inline'` (style
attributes only, no `<style>` elements), and forwards the nonce as `x-nonce`
for Next to apply to its own inline scripts and for the layout to apply to the
theme bootstrap script. See ADR-010.

Enforced end to end and against a production build: the e2e security spec pins
the policy shape plus the header↔markup nonce binding, and the a11y suite (75
tests) runs the whole app under the strict policy. Remaining F12 work is the
design review of `/design-system`/`DESIGN.md` (deferred from F0/F1) and the
deployment story.

## F12 — Hardening, second slice: release

**Status:** in progress. The deployment story exists: a two-stage `Dockerfile`
ships the standalone bundle as an unprivileged process, and
`docs/deployment.md` records the env contract, TLS/cookie requirements and the
CSP constraints on a CDN/edge. `npm run gate` now builds with mocks explicitly
off (`build:prod`), so a developer sandbox `.env` with `NEXT_PUBLIC_ENABLE_MOCKS=true`
no longer fails the gate's build step; a bare `npm run gate` is green.

Open: the image itself has not been built on this machine (Docker daemon is
root-only here) — `docker build -t careos-web .` plus a container smoke test
(`/login` 200 with the nonce CSP header) are the tracked follow-up, on a
Docker-capable machine. The standalone bundle it wraps is verified: the e2e
harness boots exactly `npm run build && node .next/standalone/server.js`.

## F12 — Hardening, third slice: design review

**Status:** complete. The F0/F1 design review is done and recorded in
`docs/design-review.md`. Findings fixed in this slice:

- Four of the twenty signature components were absent from `/design-system`
  (`StatusPill`, `DataTable`, `Timeline`, `BedTile`), so the live review surface
  no longer covered the whole set; all four are now demonstrated there.
- `DESIGN.md` still opened with "awaiting design review" after five feature
  slices had shipped past the F0 gate; the status line now points at the review
  artefact instead.

Everything else the review could not assert by eye was already wired into the
build rather than left to process: contrast pairs (`tokens:verify`, tightest
passing pair 3.25:1), the single global focus rule, and the axe sweep of
`/design-system` in all four theme/density combinations. No contrast, shape,
motion or scale dependency was added to achieve the pass.

## F4 — Doctor workspace, slice 1: encounters

**Status:** complete. The encounter list and workspace are live against the
contract verified from the API source (`src/modules/encounters`):

- `/encounters` lists encounters with status and department filters, one row
  per visit (patient, opened time, type, department, status), named patients
  resolved on demand exactly like the day book (GAP-018).
- `/encounters/[id]` is the workspace: details (type, department, provider,
  opened/in-progress/completed stamps, note) and the workflow moves
  **OPEN → IN_PROGRESS → COMPLETED** mirroring the API's system edges, with
  COMPLETED locked. Completing asks for confirmation; a move the server now
  rejects (409 `INVALID_WORKFLOW_TRANSITION`, e.g. a stale tab) surfaces a
  status-specific alert instead of a generic failure.
- Move set, statuses and types are shared between the UI and the structural
  validators (`src/lib/data/encounters.ts`) so the workflow cannot drift from
  the screens.

Contract notes recorded against the source (`docs/api-contract-gaps.md`,
GAP-020): both `GET /encounters` and the single-encounter reads drift from
their export — the list's 200 is typed as the request DTO with no query model
(raw-fetched and validated structurally), and the detail/transition reads
answer `{ encounter }` while typed as the bare entity (unwrap + structural
read). Records are EXAMPLE-prefixed and duplicated deliberately between the
MSW registry and `e2e/stub-api.mjs`. Gate: lint, typecheck, 341 unit tests,
`build:prod`, 111 a11y/e2e — all green.

## F4 — Doctor workspace, slice 2: clinical notes

**Status:** complete. The clinical-notes panel is embedded in the encounter
workspace and follows the contract verified from the API source
(`src/modules/clinical-notes`):

- Notes are structured against `NOTE_SECTION_KEYS` (chief complaint, history,
  subjective, objective, assessment, plan, instructions, follow-up). A note is
  created as a DRAFT tied to an open encounter, edited in place while DRAFT,
  finalized into the ORIGINAL version, and afterwards only **amended** — a
  superseding version with a mandatory reason, never an in-place edit.
- The panel mirrors those edges exactly: DRAFT offers Edit + Finalize (with a
  confirmation), FINAL offers Amend, and a COMPLETED encounter offers neither
  creation nor edits. Create is offered only while the encounter is OPEN or
  IN_PROGRESS; a stale 409 `INVALID_WORKFLOW_TRANSITION` (finalized elsewhere,
  closed encounter) surfaces as a status-specific alert.
- A draft can start from a template (`GET /clinical-notes/templates`), which
  pre-fills the section set. Version history is loaded on demand from the one
  read that carries it (`GET /clinical-notes/{id}`) and shown when a card is
  expanded; the list read carries only the working snapshot.

The contract carries the same mis-typing as encounters (GAP-020, appended):
every list handler is `query: never` with the 200 typed as a request DTO, and
the single/write reads answer `{ note }` / `{ template }` while typed as the
bare entity. Records are EXAMPLE-prefixed and duplicated deliberately between
the MSW registry and `e2e/stub-api.mjs`. Data layer: 15 unit tests
(`src/lib/data/clinical-notes.test.ts`).

## F4 — Doctor workspace, slice 3: prescriptions (medication orders)

**Status:** complete. The prescriptions panel is embedded in the encounter
workspace and follows the contract verified from the API source
(`src/modules/prescriptions`):

- A prescription pins the patient, the issuing provider and the dispensing
  branch — **not** an encounter — so the panel shows the encounter patient's
  medication-order history (all prescriptions filter by `patientId`) and the
  doctor writes to it with the visit's patient. Creating is not gated on the
  encounter's status, because the API does not gate it.
- The lifecycle mirrors the API domain (`domain/prescription-flow.ts`): a
  prescription starts DRAFT, is **issued** (DRAFT → ISSUED; the issue answers
  201 and creates the pharmacy task), is dispensed by pharmacy (read-only here),
  and can be **cancelled** while the drug is un- or partially-dispensed.
  DISPENSED is terminal. Issue is offered only from DRAFT; cancel from DRAFT /
  ISSUED / PARTIALLY_DISPENSED, via a confirmation. A stale action answers 409
  `INVALID_WORKFLOW_TRANSITION` and surfaces as a status-specific alert.
- The composer picks medications from `GET /medications` (the catalog), with
  quantity, dosage, frequency, duration, and per-line instructions; lines
  carry only `medicationId`, named on demand via a `useMedicationName` lookup
  (GAP-018-style, exactly as patients). List rows resolve names the same way.

Contract notes recorded against the source (GAP-020, appended): the
prescription list 200 is typed as `ListPrescriptionsQueryDto` and the
medication list as `ListMedicationsQueryDto`, both with `query: never`
(raw-fetched and validated structurally); the single/write reads answer
`{ prescription }` / `{ medication }` while typed as the bare entity (unwrap +
structural read). The live `PrescriptionResponseSchema` also omits `createdAt`
entirely, so rows are ordered server-side and the UI never charts a created
stamp. Records are EXAMPLE-prefixed and duplicated deliberately between the MSW
registry and `e2e/stub-api.mjs`. Data layers: 14 unit tests
(`prescriptions.test.ts` + `medications.test.ts`).

## F4 — Doctor workspace, slice 4: laboratory & imaging results (read-only)

**Status:** complete. The results panel is embedded in the encounter workspace
below the prescriptions panel and follows the contract verified from the API
source (`src/modules/laboratory`, `src/modules/radiology`). It is read-only:
ordering and processing are the laboratory and radiology modules' work (F5), so
the doctor only reads what those modules have released for the encounter's
patient.

- **Laboratory.** `GET /lab/orders?patientId=…` is a **thin** projection: the
  API serializes the order header, the sample stub and each item's `testId` and
  **omits the results and test names**. So the panel splits the list — orders
  whose status is result-bearing (`RESULT_READY` / `VERIFIED` / `RELEASED`) are
  fetched by id via `GET /lab/orders/{id}`, which carries the named items and
  their results; earlier orders (ORDERED…PROCESSING, REJECTED, CANCELLED) render
  as a compact "in progress" list from the thin row alone. A result names its
  analyte only by `testFieldId` (the API's `LabResult` has no field metadata), so
  `GET /lab/tests` supplies the catalog that maps `testFieldId → name / unit /
  reference range` (GAP-018-style on-demand naming, one shared cached fetch).
  Abnormal and critical results carry a status pill each (a word, a shape and
  colour — never colour alone).
- **Imaging.** Unlike the laboratory list, `GET /radiology/orders` serializes
  the **full** order including the report (findings / summary / impression), so
  the list read alone backs the imaging section — no per-order fetch. Orders
  without a report show an "awaiting report" line.
- Ordering is by the API (`orderedAt` descending); no client-side sort that the
  wire does not guarantee.

Contract notes recorded against the source (GAP-020 family): `GET /lab/orders`
is typed as `ListLabOrdersQueryDto` and `GET /lab/tests` as
`ListLabTestsQueryDto`, both `query: never` (raw-fetched and validated
structurally); `GET /lab/orders/{id}` and `GET /radiology/orders/{id}` type the
bare entity while answering `{ order }`, and `GET /radiology/orders` is typed as
`ListRadiologyOrdersQueryDto` (raw-fetched). Records are EXAMPLE-prefixed and
duplicated deliberately between the MSW registry and `e2e/stub-api.mjs`. Data
layers: 21 unit tests (`laboratory.test.ts` + `radiology.test.ts`).

## F5 — Laboratory, slice 1: worklist and order workspace

**Status:** complete. `/lab` lists every laboratory order and `/lab/[id]` is the
lab bench's workspace for one order, at whatever point of the pipeline it sits.
Ordering and processing live here (the doctor's view of F4 slice 4 is read-only).

- **Worklist.** `GET /lab/orders` is the thin projection (no results, no test
  names, no criticals) and the export mis-types its 200 as the request DTO, so
  rows are validated structurally in `src/lib/data/laboratory.ts`. A status
  filter issues the server-side `status` query; rows carry only `patientId`, so
  names resolve on demand (GAP-018), the same as the day book.
- **Order workspace.** The single read answers `{ order }` with the item/result
  tree and the critical notifications; the reader joins `GET /lab/tests` to map
  each result's `testFieldId` to a name, unit and reference range.
- **Transitions.** The action bar is the server's transition graph
  (`LAB_ORDER_ACTIONS_BY_STATUS`): a move the server would refuse is never
  offered. `collect` / `receive` / `process` are one-click; `verify` and
  `release` confirm; `reject` and `cancel` require a reason (min 10 characters,
  `ReasonField`). Entering results is the in-section form shown while the order
  is PROCESSING (one field per active analyte across the ordered tests). A stale
  tab answers 409 `INVALID_WORKFLOW_TRANSITION` and surfaces as a status-specific
  alert; releasing before every critical result is acknowledged answers 409
  `LAB_RESULT_NOT_ACKNOWLEDGED` and says so. Critical results are acknowledged
  inline from the critical section, with an optional note.
- **Mutations** (`src/lib/data/queries.ts`): `useLabOrderTransition`,
  `useEnterLabResults`, `useAmendLabResult` (`PATCH /lab/results/{id}`) and
  `useAcknowledgeCritical` (`POST /lab/critical/{id}/acknowledge`), all
  invalidating `['lab-orders']`. Every response body is validated in the data
  layer, because the writes answer `{ order }` / `{ result }` / `{ criticalResult }`
  while the export types the bare entity (GAP-020).

Contract notes recorded against the source (GAP-020, appended): the transition
POSTs (`collect`/`receive`/`process`/`reject`/`cancel`/`verify`/`release`/
`results`), the amend `PATCH` and the acknowledge `POST` all type the bare
entity while answering an envelope; the transition POSTs answer 201. Records are
EXAMPLE-prefixed and duplicated deliberately between the MSW registry and
`e2e/stub-api.mjs`, with an order at every status so each transition can be
exercised. Data layers: 19 unit tests (`laboratory.test.ts`).

## F5 — Radiology, slice 2: worklist and imaging workspace

**Status:** complete. `/radiology` lists every imaging order and `/radiology/[id]`
is the radiology department's workspace for one order, at whatever point of the
pipeline it sits. Scheduling, performing, reporting and release live here (the
doctor's view of F4 slice 4 is read-only).

- **Worklist.** `GET /radiology/orders` serializes the full order including the
  report, but the export mis-types its 200 as the request DTO
  (`ListRadiologyOrdersQueryDto`, `query: never`), so rows are validated
  structurally in `src/lib/data/radiology.ts`. Status and modality filters narrow
  the list; rows carry only `patientId`, so names resolve on demand (GAP-018),
  the same as the day book. Modality is shown beside the region as the study.
- **Imaging workspace.** The single read answers `{ order }`; the reader was
  extended to read `cancelledById`, which the F4 row had omitted, so a cancelled
  study shows its cancellation reason. The report card renders findings, summary
  and impression with their entered/verified stamps, or an "awaiting report" line
  before one exists.
- **Transitions.** The action bar is the server's transition graph
  (`RADIOLOGY_ORDER_ACTIONS_BY_STATUS`): a move the server would refuse is never
  offered. `schedule` and `perform` are one-click; `verify` and `release` confirm;
  `cancel` requires a reason (min 10 characters, `ReasonField`). Writing the report
  is the in-section form shown while the study is PERFORMED — `findings` required,
  `summary` and `impression` optional — and it creates the 1:1 report that
  verification then signs off. A stale tab answers 409
  `INVALID_WORKFLOW_TRANSITION` and surfaces as a status-specific alert.
- **Mutations** (`src/lib/data/queries.ts`): `useRadiologyOrder` (single read),
  `useRadiologyOrderTransition` (schedule/perform/verify/release/cancel) and
  `useSubmitImagingReport` (`POST /radiology/orders/{id}/report`), all
  invalidating `['radiology-orders']`. Every response body is validated in the
  data layer, because the writes answer `{ order }` while the export types the
  bare entity (GAP-020).

Contract notes recorded against the source (GAP-020, appended): the transition
POSTs (`schedule`/`perform`/`report`/`verify`/`release`/`cancel`) all type the
bare entity while answering an envelope, and answer 201; `report` carries
`{ findings, summary?, impression? }` and `cancel` a `{ reason }`. Records are
EXAMPLE-prefixed and duplicated deliberately between the MSW registry and
`e2e/stub-api.mjs`, with an order at every status so each transition can be
exercised. Data layers: `radiology.test.ts` extended (cancelled-by reader +
transition map).

## F5 — Order entry, slice 3: laboratory and imaging requests

**Status:** complete. The encounter workspace now places the orders the F5
worklists process: `src/components/staff/orders-panel.tsx` adds an **Orders**
section beside the notes, prescriptions and results panels, so a doctor orders
laboratory tests and imaging from the visit without leaving `/encounters/[id]`.

- **Panel.** `OrdersPanel({ patientId, branchId, encounterId })` reads the
  encounter row's patient, branch and visit, and offers two inline composers
  (the same pattern as the prescription composer, not a modal): *Order
  laboratory tests* and *Order imaging*. A placed order closes its composer and
  reports the new order number in a `role="status"` line. Each composer mirrors
  the API body — priority from `LAB_ORDER_PRIORITIES` for labs, modality from
  `IMAGING_MODALITIES` for imaging, with optional clinical notes — and the
  laboratory picker lists the active catalogue from `GET /lab/tests` as a
  checkbox fieldset (submitting with none selected is caught client-side).
- **Mutations** (`src/lib/data/queries.ts`): `useCreateLabOrder` (`POST
  /lab/orders`, `{ patientId, branchId, encounterId, priority, clinicalNotes,
  testIds }`) and `useCreateRadiologyOrder` (`POST /radiology/orders`,
  `{ patientId, branchId, encounterId, modality, region?, clinicalNotes? }`),
  invalidating `['lab-orders']` and `['radiology-orders']` so the doctor's
  results panel and the worklists pick the new order up. Both writes answer
  `{ order }` while the export types the bare entity (GAP-020), so the body is
  validated through `extractLabOrderRecord` / `extractRadiologyOrderRecord`.
- **Mock and stub.** `src/mocks/laboratory-handlers.ts` and
  `src/mocks/radiology-handlers.ts` gained the create POSTs against their
  in-memory order lists (a lab create builds its stub sample from the first
  test's sample type); `e2e/stub-api.mjs` mirrors them, so an order placed in
  the UI is visible on the next worklist read.

The gate is green: lint clean, `tsc --noEmit` 0, unit 405, `build:prod` OK,
e2e/a11y 127. No new a11y route was needed — the existing
`/encounters/enc_example_6001` check now covers the panel (both composers are
closed on load). Contract note appended to GAP-020.

## F6 — Pharmacy, slice 1: dispense worklist

**Status:** complete. `/pharmacy` is the pharmacy's dispense queue: it lists
every prescription the pharmacy can act on (`ISSUED` or `PARTIALLY_DISPENSED`)
and lets the pharmacist adjust each outstanding line's quantity against the
branch's stock before dispensing.

- **Worklist** (`src/components/staff/pharmacy-worklist.tsx`). Reads
  prescriptions through the existing `usePrescriptions`, keeps the actionable
  statuses and renders each as a card with the patient name, status pill and
  version. Each outstanding line (ordered − dispensed) defaults to its full
  remaining quantity, shows the branch's stock on hand and turns the on-hand
  figure critical when it is short. `POST /pharmacy/stock/dispense` (FEFO across
  batches server-side) advances the prescription; the card reports the resulting
  status in a `role="status"` line, or the mapped code
  (`INSUFFICIENT_STOCK`, `INVALID_WORKFLOW_TRANSITION`, `VALIDATION_ERROR`) in a
  `role="alert"`.
- **Data layer** (`src/lib/data/inventory.ts`). `GET /pharmacy/stock/on-hand`
  carries `query: never` and a 200 typed as the request DTO (`OnHandQueryDto`)
  while the service answers `{ onHand: [...] }`, so it rides the raw-fetch path
  (`fetchStockOnHand`, `extractStockOnHand`, `readStockOnHandRow`). The dispense
  write answers a bare `{ prescriptionStatus, dispensedLines }` while the export
  fastens `InventoryResponseDto` to the 201, so `readDispenseResult` validates it
  structurally. Both are GAP-020. Note the controller base path is `pharmacy`,
  not `inventory` (`src/modules/inventory/inventory.controller.ts`).
- **Mutations** (`src/lib/data/queries.ts`). `useStockOnHand({ branchId? })`
  (key `['inventory','on-hand', branchId]`) and `useDispensePrescription`
  (`POST /pharmacy/stock/dispense`), invalidating `['prescriptions']` and
  `['inventory','on-hand']` on success.
- **Mocks/stub.** `src/mocks/fixtures/inventory-registry.ts` seeds branch stock
  (a controlled drug and a supply deliberately sit low);
  `src/mocks/inventory-handlers.ts` owns the mutable stock map and the dispense
  write, sharing the prescriptions live store (`LIVE`/`serialize` are now
  exported from `src/mocks/prescriptions-handlers.ts`). Two prescriptions were
  added (`prx_example_7005` ISSUED, `prx_example_7006` PARTIALLY_DISPENSED) so
  the queue has variety. The same seed and handlers are mirrored in
  `e2e/stub-api.mjs`.
- **Nav + i18n.** A *Pharmacy* entry sits after Radiology in the staff shell;
  the `pharmacy` namespace was added to `en.json` and `sw.json`.

Gate: lint clean, `tsc --noEmit` 0, unit 411 (`inventory.test.ts`, 6 new),
`build:prod` OK, e2e/a11y 131 (new `/pharmacy` route in both theme variants).
Contract note appended to GAP-020.

## F6 — Pharmacy, slice 2: stock control

**Status:** complete. `/pharmacy/stock` is the pharmacy's stock desk: it shows
the branch on-hand ledger, the risk advisories, and a receiving composer that
books new batches.

- **Screen** (`src/components/staff/pharmacy-stock.tsx`). The advisories panel
  renders `GET /pharmacy/stock/alerts` as a `DataTable` of medication, tier
  (`LOW_STOCK`/`REORDER_RISK`/`EXPIRY_RISK`) and the service's own detail text,
  using `StatusPill` for the tier; the on-hand panel renders
  `GET /pharmacy/stock/on-hand`. Both are read-only until the receiving
  composer (`ReceiveComposer`) opens — a multi-line form
  (`useMedications({ isActive: 'true' })` for the picker) with per-line
  medication, batch number, quantity, optional expiry and unit cost, adding and
  removing lines. It posts `POST /pharmacy/stock/receive` and invalidates both
  reads on success. There is no branch picker in the app, so the composer
  receives into the branch the on-hand read reports (`onHand[0].branchId`);
  without stock it says so instead of guessing.
- **Data layer** (`src/lib/data/inventory.ts`). `GET /pharmacy/stock/alerts`
  carries `query: never` and a 200 typed as the request DTO while the service
  answers `{ alerts: [...] }`, so it rides the raw-fetch path
  (`fetchStockAlerts`, `extractStockAlerts`, `readStockAlertRow`, which rejects
  an unknown tier). `POST /pharmacy/stock/receive` answers a bare
  `{ batches: [...] }` while the export types the 201 as
  `InventoryResponseDto`, so `readReceiveResult` validates it structurally. Both
  are GAP-020.
- **Mutations** (`src/lib/data/queries.ts`). `useStockAlerts({ branchId? })`
  (key `['inventory','alerts', branchId]`) and `useReceiveStock`
  (`POST /pharmacy/stock/receive`), invalidating `['inventory','on-hand']` and
  `['inventory','alerts']` on success.
- **Mocks/stub.** `src/mocks/inventory-handlers.ts` derives the advisories from
  the mutable stock map with fixed thresholds (≤5 `LOW_STOCK`, ≤15
  `REORDER_RISK`, expiry ≤30 days `EXPIRY_RISK`) and books receive batches into
  it (reusing a batch id per branch/medication/batch number). The registry seed
  gained an `expiryInDays` so one medication carries a near expiry. Both the
  advisory and receive handlers are mirrored in `e2e/stub-api.mjs`.
- **Nav + i18n.** `/pharmacy/stock` is linked from the dispense worklist header
  (no shell nav entry); the `pharmacy.stockControl` label and a `pharmacyStock`
  namespace were added to `en.json` and `sw.json`.

Gate: lint clean, `tsc --noEmit` 0, unit 415 (`inventory.test.ts` grown to 10),
`build:prod` OK, e2e/a11y 135. Contract note appended to GAP-020.

## F6 — Pharmacy, slice 3: wastage write-offs

**Status:** complete. The stock screen now offers a second movement alongside
receiving: a write-off composer that removes expired, damaged or unusable stock
from the branch.

- **Screen** (`src/components/staff/pharmacy-stock.tsx`). The header's single
  action became a pair (`Receive stock` / `Record write-off`) toggling the
  composer in place; `WriteOffComposer` takes one reason for the whole movement
  (`Textarea`, required, ≤500) and one or more lines of medication + quantity,
  showing the branch's on-hand quantity as each line's hint and refusing a line
  above it before the request goes out. It posts `POST /pharmacy/stock/write-off`
  and invalidates both reads on success.
- **Data layer** (`src/lib/data/inventory.ts`). The write-off endpoint is the
  most under-modelled of the family: the export declares **no response type** for
  the 201, yet the service answers a bare `{ writeOffId, branchId, quantity }`,
  so `readWriteOffResult` validates it structurally (GAP-020).
- **Mutation** (`src/lib/data/queries.ts`). `useWriteOffStock`
  (`POST /pharmacy/stock/write-off`), invalidating `['inventory','on-hand']` and
  `['inventory','alerts']` on success.
- **Mocks/stub.** `src/mocks/inventory-handlers.ts` validates the reason and each
  line, refuses a line above the branch's stock (`INSUFFICIENT_STOCK`), decrements
  the shared stock map and answers the bare write-off body; mirrored in
  `e2e/stub-api.mjs`.
- **i18n.** The `pharmacyStock` namespace gained a `writeOffStock` label and a
  `writeOff` block (title, intro, reason label/required, an ICU-plural `available`
  hint, exceeds/insufficient/failed bodies, save) in `en.json` and `sw.json`.

Gate: lint clean, `tsc --noEmit` 0, unit 417 (`inventory.test.ts` now 12),
`build:prod` OK, e2e/a11y 135. Contract note appended to GAP-020.

## F7 — Billing, slice 1: invoices desk

**Status:** complete. A front-office billing desk: every invoice, and one invoice
at any point of its lifecycle, with the moves the money actually needs — issue,
cancel, refund, and desk payments (record and refund).

- **Worklist** (`src/components/staff/billing-worklist.tsx`, `/billing`). Invoice
  number, patient (resolved on demand), total and balance due, issued date and a
  status pill, filterable by status. `GET /invoices` is a thin projection whose
  200 the export mis-types as the request DTO (GAP-020), so rows are validated
  structurally in `src/lib/data/billing.ts`. Money is rendered through `MoneyText`
  with the org currency from the session.
- **Workspace** (`src/components/staff/invoice-workspace.tsx`, `/billing/[id]`).
  Summary, totals (subtotal/discount/tax/total/balance — the server's numbers,
  never re-added here), a line-item table, and the payments list. The action bar
  offers only the moves the server's lifecycle allows — issue (DRAFT), cancel
  (DRAFT|ISSUED, reason required), refund (PAID, reason required), record payment
  (ISSUED|PARTIALLY_PAID) — and a refund action per completed payment. A move that
  races a stale tab resolves to a 409 rendered in place.
- **Data layer** (`src/lib/data/billing.ts`). Every money field is a decimal
  string and is validated as a string only (ADR-029) — nothing here parses or
  computes an amount. `readInvoice`/`readPayment` and the `extract*` helpers
  validate the `{ invoice }` / `{ payment }` envelopes the service answers while
  the export types the bare entity (GAP-020); the list omits payments, so
  `payments` defaults to empty.
- **Hooks** (`src/lib/data/queries.ts`). `useInvoices`, `useInvoice`,
  `useInvoiceAction` (issue/cancel/refund), `useRecordPayment`,
  `useRefundPayment`, each invalidating its reads on success, plus
  `useOrgCurrency` off the session.
- **Currency.** `/auth/me`'s `organization.currency` now flows into
  `SessionUser` (via `normaliseSessionUser`, falling back to `KES`) so `MoneyText`
  has a real ISO-4217 code; the MSW mock and `e2e/stub-api.mjs` both carry
  `currency: 'KES'`.
- **Mocks/stub.** `src/mocks/fixtures/billing-registry.ts` holds six EXAMPLE
  invoices spanning the whole lifecycle; `src/mocks/billing-handlers.ts` mirrors
  the service guards (DRAFT→ISSUED, DRAFT|ISSUED→CANCELLED, PAID→REFUNDED,
  payments on ISSUED|PARTIALLY_PAID, refunds on COMPLETED) and does all money in
  **integer cents** so a mock balance cannot drift. Mirrored in
  `e2e/stub-api.mjs`.
- **Nav + i18n + a11y.** A *Billing* entry sits under Administration in the staff
  shell; the `billing` namespace (worklist, workspace, actions, payment/refund
  dialogs, error copy) was added to `en.json` and `sw.json`; `/billing` and
  `/billing/inv_example_8001` joined the a11y route sweep.

Gate: lint clean, `tsc --noEmit` 0, unit 430 (`billing.test.ts` + 13,
`session.test.ts` + 1), `build:prod` OK, e2e/a11y 143. Contract note appended to
GAP-020.

## F7 — Insurance, slice 2: claims desk

**Status:** complete. A front-office insurance desk: every claim, and one claim at
any point of its lifecycle, with the moves a payer relationship needs — submit,
approve (full or partial), deny (reason required) and pay — plus raising a claim
against an issued invoice.

- **Worklist** (`src/components/staff/insurance-worklist.tsx`, `/insurance`). Claim
  number, patient (resolved on demand), claimed and approved amounts, submitted
  date and a status pill, filterable by status. `GET /insurance/claims` mis-types
  its 200 as the request DTO while the service answers a `PageResult` (GAP-020
  family), so rows are validated structurally in `src/lib/data/insurance.ts`.
- **Workspace** (`src/components/staff/claim-workspace.tsx`, `/insurance/[id]`).
  Summary (patient, policy, submitted/decided/paid dates), amounts (claimed and
  the server's approved amount — never computed here), notes and the denial reason,
  a link to the patient record and to the linked invoice. The action bar offers only
  the moves the server's lifecycle allows — submit (DRAFT); approve / partially
  approve / deny (SUBMITTED, deny reason required); pay
  (APPROVED|PARTIALLY_APPROVED) — and a move that races a stale tab resolves to a
  409 rendered in place. The approve dialog takes an amount: entering the full
  claim amount approves, entering less partially approves.
- **Raise a claim** (`src/components/staff/invoice-workspace.tsx`). An issued or
  partially paid invoice gains a *Raise insurance claim* action and an *Insurance
  claims* section listing the claims raised against it, each linking to the claim
  workspace. The dialog picks one of the patient's active policies and defaults the
  amount to the invoice total; the amount may not exceed that total.
- **Data layer** (`src/lib/data/insurance.ts`). Every amount is a decimal string
  validated as a string only (ADR-029). `readPayer`/`readPolicy`/`readClaim` and the
  `extract*` helpers validate the mis-typed list `PageResult`s and the `{ claim }`
  envelope the service answers while the export types the bare entity (GAP-020).
- **Hooks** (`src/lib/data/queries.ts`). `useInsurancePayers`, `useInsurancePolicies`
  (patient/payer scoped), `useClaims` (invoice/patient/status scoped), `useClaim`,
  `useCreateClaim` and `useClaimAction` (submit/approve/partial_approve/deny/pay),
  invalidating claims, the claim and the invoice reads on success — `pay` settles
  the invoice through an INSURANCE payment, so the invoice reads move too.
- **Mocks/stub.** `src/mocks/fixtures/insurance-registry.ts` holds two payers, three
  patient policies and six EXAMPLE claims spanning the whole lifecycle;
  `src/mocks/insurance-handlers.ts` mirrors the service's `CLAIM_ALLOWED_FROM`
  guards and create-time checks (policy patient matches the invoice, amount within
  the total), with money kept as decimal strings. Mirrored in `e2e/stub-api.mjs`.
  One deliberate simplification: the mock `pay` settles the claim only and does not
  rewrite the invoice balance, because the invoice ledger is owned by the billing
  handlers and the two modules share no mutable state.
- **Nav + i18n + a11y.** An *Insurance* entry sits under Administration after
  Billing; the `insurance` namespace (worklist, workspace, actions, decide/deny
  dialogs, error copy) was added to `en.json` and `sw.json`, and the create-claim
  copy joined the `billing` namespace; `/insurance` and
  `/insurance/claim_example_5001` joined the a11y route sweep.

Gate: lint clean, `tsc --noEmit` 0, unit 441 (`insurance.test.ts` + 11),
`build:prod` OK, e2e/a11y 151. Contract note appended to GAP-020.

## F7 — Insurance, slice 3: administration (payers and patient policies)

**Status:** complete. The registry the claims desk bills against: the facility's
insurers, and the policies that tie a patient to one.

- **Payers** (`src/components/staff/payers-worklist.tsx`, `/insurance/payers`). A
  list of payers (name, contact phone, email, active state) with an *Add payer*
  dialog. `GET /insurance/payers` types its 200 as the bare entity while the
  service answers a `PageResult` (GAP-020), so rows are validated structurally in
  `src/lib/data/insurance.ts`. Creating posts to `POST /insurance/payers`, which
  answers `{ payer }` and 409 `CONFLICT` on a duplicate name — the conflict is
  rendered in the dialog, not as a generic failure.
- **Patient policies** (`src/components/staff/patient-insurance.tsx`). A new
  *Insurance* tab on the patient master record (`src/components/staff/patient-master.tsx`)
  lists the patient's policies — policy number, payer name (resolved from the payer
  list), coverage, validity window and active state — with an *Enrol in a plan*
  dialog. Enrolling picks an active payer, a policy number, full/partial cover (a
  partial policy needs a coverage percent) and a validity window, and posts to
  `POST /insurance/policies` (`{ policy }`); an unknown payer or patient is a 404
  and a partial policy without a percent a 400, both surfaced in the dialog.
- **Data layer** (`src/lib/data/insurance.ts`). Added `CreateInsurancePayerInput`,
  `CreateInsurancePolicyInput` and the `extractPayerRecord`/`extractPolicyRecord`
  readers, which validate the `{ payer }`/`{ policy }` envelopes the service answers
  while the export types the bare entity (GAP-020). Coverage stays a number; money
  is untouched here.
- **Hooks** (`src/lib/data/queries.ts`). `useCreatePayer` and `useCreatePolicy`,
  each invalidating the payer/policy reads on success. The payer reader feeds the
  patient panel's payer-name resolution through `useInsurancePayers`.
- **Mocks/stub.** `src/mocks/insurance-handlers.ts` now mutates cloned payer and
  policy lists so a created payer is selectable when enrolling and a created policy
  is claimable (the claim-create guard reads the mutable policy list); duplicate
  names conflict and a partial policy needs a percent, mirroring the service.
  Mirrored in `e2e/stub-api.mjs`.
- **Nav + i18n + a11y.** An *Insurance payers* entry sits under Administration
  after *Insurance*; the `payers` and `policies` copy joined the `insurance`
  namespace and the tab label joined `record` (`en.json` and `sw.json`);
  `/insurance/payers` joined the a11y route sweep.

Gate: lint clean, `tsc --noEmit` 0, unit 445 (`insurance.test.ts` + 4),
`build:prod` OK, e2e/a11y 155. Contract note appended to GAP-020.

## F8 — Inpatient, slice 1: ward board and bed management

**Status:** complete. The ward board: every ward with its beds at a glance, and
one ward's rooms and beds laid out for management.

- **Worklist** (`src/components/staff/ward-worklist.tsx`, `/wards`). Every ward
  (name, code, floor, bed count, occupied, available, active state) with an
  *Active wards only* filter and an *Add ward* dialog. `GET /wards` types its 200
  as the request DTO while the service answers a `PageResult` (GAP-020), so rows
  are validated structurally in `src/lib/data/inpatient.ts`. Occupancy is derived
  from the row's own nested rooms and beds, never a second source that could
  disagree with the ward.
- **Workspace** (`src/components/staff/ward-workspace.tsx`, `/wards/[id]`). One
  ward: a live `WardBoard` of every bed, then its rooms and beds in a `DataTable`
  where a bed's status is changed. *Add room* and *Add bed* dialogs post to
  `POST /wards/{id}/rooms` and `POST /rooms/{id}/beds`. `OCCUPIED` is
  assignment-driven and cannot be chosen — the operator sets `AVAILABLE`,
  `RESERVED`, `CLEANING`, `MAINTENANCE` or `BLOCKED`.
- **Optimistic locking.** A bed-status change is a `PATCH /beds/{id}/status`
  carrying the version the operator saw; a tab that has gone stale resolves to a
  409 `OPTIMISTIC_LOCK_CONFLICT` rendered in the dialog rather than a silent
  overwrite.
- **Data layer** (`src/lib/data/inpatient.ts`). `readWard` (with nested
  `readRoom`/`readBed`), the `extractWardPage`/`extractWardRecord`/
  `extractRoomRecord`/`extractBedRecord` readers and the `fetchWards`/`fetchWard`
  raw reads. A body that drifts fails closed rather than rendering an empty
  board, which on a ward board reads as "no beds" — a dangerous lie.
  `MANUAL_BED_STATUSES` lists only operator-settable states.
- **Hooks** (`src/lib/data/queries.ts`). `useWards`, `useWard`, `useCreateWard`,
  `useCreateRoom`, `useCreateBed` and `useSetBedStatus`, each invalidating the
  ward reads on success. Wards the app creates use the EXAMPLE branch
  (`INPATIENT_BRANCH_ID`, GAP-018) because the session still reports no current
  branch.
- **Mocks/stub.** `src/mocks/fixtures/inpatient-registry.ts` holds three EXAMPLE
  wards (Medical active, Surgical active, Maternity inactive) with rooms and beds
  spanning every status; `src/mocks/inpatient-handlers.ts` mirrors the service's
  create guards (name required, EXAMPLE branch only, manual statuses only,
  version check) and is registered in `src/mocks/handlers.ts`. Mirrored in
  `e2e/stub-api.mjs`.
- **Nav + i18n + a11y.** A *Ward board* entry sits under the Ward section; the
  `inpatient` namespace was added to `en.json` and `sw.json`; `/wards` and
  `/wards/ward_example_3001` joined the a11y route sweep.

Gate: lint clean, `tsc --noEmit` 0, unit 456 (`inpatient.test.ts` + 11),
`build:prod` OK, e2e/a11y 163. Contract note appended to GAP-020.

## F8 — Inpatient, slice 2: admissions desk

**Status:** complete. Every inpatient admission, and one admission's bed
history, transfer and discharge.

- **Worklist** (`src/components/staff/admissions-worklist.tsx`, `/admissions`).
  Every admission (number, patient, current bed, source, admitted date, status)
  newest first, with a status filter and an *Admit patient* dialog.
  `GET /admissions` types its 200 as the request DTO while the service answers a
  `PageResult` (GAP-020), so rows are validated structurally in
  `src/lib/data/inpatient.ts`. Rows carry only `patientId`, so names resolve on
  demand (`usePatientName`, GAP-018), and the current bed is resolved from the
  admission's own assignment history against the ward tree rather than a second
  read.
- **Admit.** The dialog searches patients (`usePatientSearch`) and picks from the
  *available* beds, grouped by ward, then posts to `POST /admissions`. The
  service assigns the source (`OUTPATIENT_CLINIC` for this desk) and row-locks the
  bed, so the client cannot choose it. An already-admitted patient
  (`ADMISSION_ALREADY_ACTIVE`) or a taken bed (`BED_UNAVAILABLE`) is a 409 the
  dialog states explicitly rather than a generic failure.
- **Workspace** (`src/components/staff/admission-workspace.tsx`,
  `/admissions/[id]`). One admission: its summary, its bed-assignment history
  newest first, and any discharge record. A *Transfer bed* dialog moves the
  active assignment to another available bed; a *Discharge* dialog records
  summary, instructions, follow-up and outstanding billing. A transfer keeps the
  status (it moves the assignment) and a discharge is final, so the action bar
  offers only the moves the service allows. A released bed returns to `AVAILABLE`
  and a discharged bed to `CLEANING`, reflected on the ward board.
- **Data layer** (`src/lib/data/inpatient.ts`). `readAdmission` (with nested
  `readAssignment`/`readDischarge`/`readFollowUp`), `activeAssignment`,
  `collectBeds`, the `extractAdmissionPage`/`extractAdmissionRecord` readers and
  the `fetchAdmissions`/`fetchAdmission` raw reads. A body that drifts fails
  closed rather than showing a bed against the wrong patient.
- **Hooks** (`src/lib/data/queries.ts`). `useAdmissions`, `useAdmission`,
  `useAdmitPatient`, `useTransferAdmission` and `useDischargeAdmission`. Every
  admission write invalidates both the admission reads and the ward reads,
  because the write moves a bed the board shows.
- **Mocks/stub.** `src/mocks/fixtures/inpatient-registry.ts` added three EXAMPLE
  admissions (two ADMITTED holding the occupied beds, one DISCHARGED with a
  released assignment and a discharge); `src/mocks/inpatient-handlers.ts` mirrors
  the service's create/transfer/discharge guards (branch and bed checks, active
  admission conflict, unavailable bed, closed-admission transition) and moves the
  bed statuses. Mirrored in `e2e/stub-api.mjs`.
- **Nav + i18n + a11y.** An *Admissions* entry sits under the Ward section after
  *Ward board*; the admission copy joined the `inpatient` namespace (`en.json`
  and `sw.json`); `/admissions` and `/admissions/adm_example_9001` joined the
  a11y route sweep.

Gate: lint clean, `tsc --noEmit` 0, unit 467 (`inpatient.test.ts` + 11),
`build:prod` OK, e2e/a11y 171. Contract note appended to GAP-020.


## F8 — Inpatient, slice 3: emergency desk

**Status:** complete. The live ED board, and one emergency visit from arrival
through triage, assessment, treatment and one final disposition.

- **Worklist** (`src/components/staff/emergency-worklist.tsx`, `/emergency`).
  Every emergency visit (number, patient, priority, arrival time, status) newest
  first, with status and priority filters, a today's-metrics strip
  (`GET /emergency/summary`) and a *Register arrival* dialog.
  `GET /emergency/visits` types its 200 as the request DTO while the service
  answers a `PageResult` (GAP-020), so rows are validated structurally in
  `src/lib/data/emergency.ts`. Rows carry only `patientId`, so names resolve on
  demand (`usePatientName`, GAP-018). Registering posts to
  `POST /emergency/visits`; the app has no branch picker, so the EXAMPLE branch
  is used (GAP-018).
- **Workspace** (`src/components/staff/emergency-workspace.tsx`,
  `/emergency/[id]`). One visit: its summary (arrival, complaint, priority,
  assessment, treatment, disposition, admission link, referral) and a timeline of
  the recorded phases. The action bar offers only the moves the service allows —
  triage from `ARRIVED`, assess from `TRIAGED`, treat from `ASSESSED`, observe
  from `ASSESSED`/`IN_TREATMENT`, and one final disposition (admit, refer or
  discharge) from `ASSESSED`/`IN_TREATMENT`/`OBSERVATION` — plus a re-record of
  triage priority until the visit closes. A terminal visit is closed to every
  action (`EMERGENCY_VISIT_CLOSED`); a wrong source status is a 409
  `INVALID_WORKFLOW_TRANSITION`, both stated explicitly rather than generic.
- **Admit shares the ward state.** An *Admit* dialog picks from the available
  beds grouped by ward and posts to `POST /emergency/visits/{id}/admit`. The
  service creates the inpatient admission in the same transaction and row-locks
  the bed, so the admission and ward reads are invalidated too, and the new
  admission appears on the admissions desk and the ward board.
- **Data layer** (`src/lib/data/emergency.ts`). The status/priority/disposition
  enums, `isEmergencyTerminal`, `readEmergencyVisit`, the
  `extractEmergencyVisitPage`/`extractEmergencyVisitRecord`/`extractEmergencySummary`
  readers and the `fetchEmergencyVisits`/`fetchEmergencyVisit`/`fetchEmergencySummary`
  raw reads. A body that drifts fails closed rather than showing a visit with the
  wrong status or priority.
- **Hooks** (`src/lib/data/queries.ts`). `useEmergencyVisits`, `useEmergencyVisit`,
  `useEmergencySummary` and the visit writes — `useRegisterEmergencyVisit`,
  `useTriageEmergencyVisit`, `useSetEmergencyPriority`,
  `useAssessEmergencyVisit`, `useTreatEmergencyVisit`,
  `useObserveEmergencyVisit`, `useAdmitFromEmergency`, `useReferEmergencyVisit`
  and `useDischargeEmergencyVisit` — through one shared write path that
  invalidates the emergency reads (and the admission/ward reads on admit).
- **Mocks/stub.** `src/mocks/fixtures/emergency-registry.ts` added eight EXAMPLE
  visits covering the whole workflow (one per status) with a re-recorded
  priority; `src/mocks/emergency-handlers.ts` mirrors the service's
  `assertEmergencyAction` guards (closed visit, wrong transition) and shares the
  inpatient handlers' bed and admission state through an exported
  `admitFromEmergency`, which the admissions `POST` now also flows through.
  Mirrored in `e2e/stub-api.mjs`.
- **Nav + i18n + a11y.** An *Emergency* entry sits under the Clinical section; the
  emergency copy is its own `emergency` namespace (`en.json` and `sw.json`);
  `/emergency` and `/emergency/erv_example_7001` joined the a11y route sweep.

Gate: lint clean, `tsc --noEmit` 0, unit 483 (`emergency.test.ts` + 16),
`build:prod` OK, e2e/a11y 179. Contract note appended to GAP-020.

---

## F9 — Administration, slice 1: users administration

**Status:** in progress. The user directory and the single-user workspace. Roles,
staff profiles and the organization profile follow in later slices; the audit-log
viewing screen cannot be built — there is no audit-list endpoint (see the
roadmap's blocker column and `docs/api-contract-gaps.md`).

- **Worklist** (`src/components/staff/users-worklist.tsx`, `/users`). Every staff
  account (name, email, role pills, status, added date) with a server-side status
  filter and search (`q`), and an *Invite user* dialog. `GET /users` types its 200
  as the request DTO while the service answers a `PageResult` (GAP-020 family), so
  rows are validated structurally in `src/lib/data/admin.ts`. Inviting posts to
  `POST /users` and shows the returned invitation token; the app has no branch
  picker, so no branch or department is sent (GAP-018). Roles for the picker come
  from `GET /roles`.
- **Workspace** (`src/components/staff/user-workspace.tsx`, `/users/[id]`). One
  account: its identity, an editable profile (`PATCH /users/{id}`), the account
  status moves (activate/suspend via `PATCH`, deactivate via `DELETE /users/{id}`,
  a soft delete), session revocation (`POST /users/{id}/sessions/revoke`, showing
  how many were revoked) and role assignment (`POST /users/{id}/roles`). The
  service refuses self-management, so when the record is the signed-in user the
  mutation controls are replaced with a notice rather than left to fail.
- **Data layer** (`src/lib/data/admin.ts`). The `USER_STATUSES`/`EMPLOYMENT_STATUSES`
  enums, `UserRow`/`UserPage`/`RoleRow`/`RolePage`/`RoleCatalog` and their
  structural readers (`readUser`, `readRole`, `extractUserPage`, `extractRolePage`,
  `extractUserRecord`, `extractInvitedUser`, `extractRevoked`, `readRoleCatalog`,
  `extractRoleRecord`) plus the raw reads `fetchUsers`/`fetchUser`/`fetchRoles`/
  `fetchRoleCatalog`. `readRoleCatalog` flattens the service's nested
  `permissionGroups` into a sorted `{ key, permissions }[]` for the picker.
- **Hooks** (`src/lib/data/queries.ts`). `useUsers`, `useUser`, `useRoles`,
  `useRoleCatalog`, `useInviteUser`, `useUpdateUser`, `useSetUserRoles`,
  `useRevokeUserSessions` and `useDeactivateUser` (a 204 void unwrap), through one
  shared write path that invalidates the user reads.
- **Mocks/stub.** `src/mocks/fixtures/admin-registry.ts` adds nine EXAMPLE roles
  (system roles plus clinician/admin roles) and seven EXAMPLE users across every
  status; `src/mocks/admin-handlers.ts` mirrors the service's self-management
  guard and session-revocation behaviour. Mirrored in `e2e/stub-api.mjs`.
- **Nav + i18n + a11y.** A *Users* entry sits under Administration; the admin copy
  is its own `admin` namespace (`en.json` and `sw.json`); `/users` and
  `/users/usr_example_0002` joined the a11y route sweep.

Gate: lint clean, `tsc --noEmit` 0, unit 507 (`admin.test.ts` + 24),
`build:prod` OK, e2e/a11y 187. Contract note appended to GAP-020.

---

## F9 — Administration, slice 2: role management

**Status:** in progress. The role directory and the custom-role editor built on the
permission catalogue. Staff profiles and the organization profile follow in slice
3; the audit-log viewing screen still cannot be built — there is no audit-list
endpoint.

- **Worklist** (`src/components/staff/roles-worklist.tsx`, `/roles`). Every role
  (name, description, key, system/custom, permission count) with search (`q`).
  `GET /roles` types its 200 as the request DTO while the service answers a
  `PageResult` (GAP-020 family), so rows are validated structurally in
  `src/lib/data/admin.ts`. Creating and editing happen on their own screens rather
  than a dialog, because the permission editor needs the whole catalogue.
- **Create** (`src/components/staff/role-workspace.tsx`, `/roles/new`). Name, key
  (validated against the service's `^[A-Z][A-Z0-9_]*$`, with an optional template
  to prefill permissions) and the grouped permission editor, posting to
  `POST /roles`.
- **Workspace** (`/roles/[id]`). One role: an editable name and description
  (`PATCH /roles/{id}`), the permission editor, a system-role notice, and a guarded
  delete (`DELETE /roles/{id}`). The key is immutable after creation — the service's
  update DTO does not accept it. The service's guards are surfaced, not hidden: a
  role that would exceed the caller's own permissions, or a system-role edit
  without authority, is a 403 `PERMISSION_DENIED`; a duplicate key or name is a
  409 `CONFLICT`; and deleting a role someone still holds is a 409.
- **Permission editor** (`src/components/staff/permission-editor.tsx`). Permissions
  are grouped by the catalogue's own group keys and labelled with the API's
  vocabulary (`patients.read`, `clinical_notes.create`, …). A friendly paraphrase
  was deliberately rejected: a permission string is a real capability boundary, and
  a label that understates it is a safety problem.
- **Data layer** (`src/lib/data/admin.ts`). `CreateRoleInput`/`UpdateRoleInput`,
  the `ROLE_KEY_PATTERN` / `isValidRoleKey` guard mirroring `CreateRoleSchema`, and
  `fetchRole` for `GET /roles/{id}`. The `extractRoleRecord` reader was already in
  place for the `{ role }` write bodies.
- **Hooks** (`src/lib/data/queries.ts`). `useRole`, `useCreateRole`,
  `useUpdateRole` and `useDeleteRole` (a 204 void unwrap), invalidating the role
  reads.
- **Mocks/stub.** `src/mocks/admin-handlers.ts` gained the create/update/delete
  routes with the service's guards (key format, duplicate key/name, system-role
  protection, assigned-role delete refusal); mirrored in `e2e/stub-api.mjs`.
- **Nav + i18n + a11y.** A *Roles* entry sits under Administration beside *Users*;
  the role copy extends the `admin` namespace; `/roles`, `/roles/new` and
  `/roles/rol_example_0004` joined the a11y route sweep.

Gate: lint clean, `tsc --noEmit` 0, unit 510 (`admin.test.ts` + 3),
`build:prod` OK, e2e/a11y 199. Contract note appended to GAP-020.

## F9 — Administration, slice 3: staff directory

**Status:** in progress. The staff directory built on the admin user registry. The
organization profile follows in slice 4; the audit-log viewing screen still cannot
be built — there is no audit-list endpoint.

- **Directory** (`src/components/staff/staff-worklist.tsx`, `/staff`). Every staff
  profile (person + email, staff number, professional title/specialization, current
  branch and department assignments, employment-status pill) with a search (`q`) that
  the service filters by staff number, title, specialization, user name or email.
  There is no status filter because `GET /staff` accepts none. Staff profiles are
  created together with a user (the invite dialog), so the directory has no create
  action. `GET /staff` types its 200 as the request DTO while the service answers a
  `PageResult` (GAP-020 family), so rows are validated structurally in
  `src/lib/data/staff.ts`.
- **Workspace** (`src/components/staff/staff-workspace.tsx`, `/staff/[id]`). The
  read-only identity block (email, staff number, account status — owned by the user
  account), an editable professional profile (title, specialization, employment
  status, licence number; `PATCH /staff/{id}`), and the assignment editor. A read
  answers `{ staff }`, so the body is validated with `extractStaffRecord`.
- **Assignments** (`/staff/[id]`, `POST /staff/{id}/assignments`). Branch and
  department checkboxes replace the set wholesale; the service refuses the entire
  set (400 `VALIDATION_ERROR`) if any branch or department does not exist, and that
  outcome is surfaced rather than hidden. Branch options come from
  `useBranchOptions()` (`GET /branches`, typed `BranchListResponseDto` but answered
  as `pageOf`), departments from the existing `useDepartmentList()`.
- **Data layer** (`src/lib/data/staff.ts`, `staff.test.ts`). `StaffCallError`,
  `StaffRow`/`StaffPage`/`BranchOption`, the readers `readStaff`, `readBranchOption`,
  `extractStaffPage`, `extractStaffRecord`, `extractBranchList`, and the fetchers
  `fetchStaff`, `fetchStaffMember`, `fetchBranchOptions`. An unknown employment
  status falls back to `ACTIVE`; a drifted row fails closed to null. 16 unit tests.
- **Hooks** (`src/lib/data/queries.ts`). `useStaff`, `useStaffMember`,
  `useUpdateStaff` (200 `{ staff }`), `useSetStaffAssignments` (full-set replace) and
  `useBranchOptions`, with `StaffCallError` added to the `toQueryError` union and a
  `staffWriteError` helper for structurally invalid bodies.
- **Mocks/stub.** `src/mocks/fixtures/staff-registry.ts` derives `ADMIN_STAFF` from
  `ADMIN_USERS` so identity cannot drift; `src/mocks/staff-handlers.ts` adds the
  staff and branch routes with the service's guards (404 unknown staff, 400 unknown
  assignment ids, full-set replace), mirrored in `e2e/stub-api.mjs`.
- **Nav + i18n + a11y.** A *Staff* entry sits under Administration after *Roles*;
  the staff copy extends the `admin` namespace (including an `employmentStatus`
  block); `/staff` and `/staff/stf_example_0002` joined the a11y route sweep.

Gate: lint clean, `tsc --noEmit` 0, unit 526 (`staff.test.ts` + 16),
`build:prod` OK (routes `/staff`, `/staff/[id]`), e2e/a11y 207. Contract note
appended to GAP-020.






