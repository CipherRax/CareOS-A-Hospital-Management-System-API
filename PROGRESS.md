# careOS web — progress

Phases follow the brief's plan. Each phase ends with a passing gate, updated
documentation, and a commit.

---

## Roadmap

Status against the brief's phase table. "Blocked" means the API contract for the
work does not exist, so the screen cannot be built without inventing an endpoint.

| Phase                          | State                                                                                      | Blocked on                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| F0 Design system & foundations | **complete**, awaiting design review                                                       | —                                                         |
| F1 Auth, session, shell        | **complete** — login/logout, proxy session bridge, gate, shell, nav rail                   | seed login org-id mismatch; design review deferred to F12 |
| F2 Patients & reception        | stub — banner + timeline only                                                              | patient search, registration, master record               |
| F3 Scheduling, queue, nursing  | not started                                                                                | appointments, slots, waitlist, queue, vitals              |
| F4 Doctor workspace            | not started                                                                                | encounters, notes, orders, results                        |
| F5 Laboratory & radiology      | not started                                                                                | lab orders, samples, results                              |
| F6 Pharmacy & inventory        | not started                                                                                | dispensing, stock, batches, POs                           |
| F7 Billing & insurance         | not started                                                                                | invoices, payments, M-PESA, claims                        |
| F8 Inpatient & emergency       | not started                                                                                | wards, beds, admissions                                   |
| F9 Administration & audit      | not started                                                                                | org, users, permissions, audit log                        |
| F10 Analytics & reports        | not started                                                                                | analytics, forecasts, reports                             |
| F11 Portal & queue display     | partial — display board done                                                               | portal read models                                        |
| F11B Public website            | **complete** — search, intake, tracking, and the session start/end UI on the live contract | —                                                         |
| F12 Hardening & release        | partial — strict nonce-based CSP + deployment story in; design review pending              | image build unverified on a Docker-capable machine        |

**Signature components (brief §2.4): 20 of 20.**

| Delivered                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StatusPill`, `DataTable`, `Timeline`, `QueueTicket`, `NowServing`, `PatientBanner`, `EstimateBadge`, `MoneyText`, `AuditNote`, `BreakGlassDialog`, `AmendmentDialog`, `ConflictDialog`, `BedTile`, `WardBoard`, `BatchRow`, `CommandPalette`, `Can`, `EmptyState`, `FormSection`, `KeyValueGrid` |

Every one is un-reviewed and unexercised against a real record; the tally counts
existence, not verification.

Every workspace in F2–F9 is assembled from these, so they are the current work: it is
the only phase work that does not wait on the API.

### Three blockers gate the rest

1. **The seed/login org-id mismatch.** `/auth/login` requires a uuid
   `organizationId`, but the seeds are string ids (`demo-org-nairobi`), so no
   seeded account can log in through the API. The frontend session flow is fully
   built (F1) and verified against the stub; this defect is API-side and is what
   stops a real end-to-end login.
2. **No triage, queue or patient-record contracts.** `/triage` is fixture-fitted,
   which caps F2 and F3.
3. **The signature set is complete but un-reviewed** (20 of 20). `CommandPalette`
   was built in-house on the existing Radix `Dialog`, so the `cmdk` dependency
   question is resolved as "no new dependency".

(2) needs API work. (1) is an API-side defect recorded for decision.

### Open decision

The brief gates F1 on design review of `/design-system` and `DESIGN.md`. F0 is
complete and five feature slices have since been built past that gate. Either review
F0 now, or record explicitly that review is deferred to F12.

---

## F0 — Design system and foundations

**Status:** complete, **awaiting design review**. No feature workspace started.

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
