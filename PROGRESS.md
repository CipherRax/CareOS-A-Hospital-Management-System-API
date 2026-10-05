# careOS web — progress

Phases follow the brief's plan. Each phase ends with a passing gate, updated
documentation, and a commit.

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
- `/design-system` exercising every primitive, not just the token layer
- MSW handlers generated against the same spec as the client types
- Zod-validated environment, refusing mocks in production
- Security headers, CSP, `standalone` output, `no-referrer`, `noindex`

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

`openapi/careos.partial.json` is hand-authored and partial; the API checks no
document in. The API repository gained `npm run openapi:export` to close this
properly, but it needs a live PostgreSQL and Redis and could not be run here.
Eight gaps are recorded in `docs/api-contract-gaps.md`.

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

### Not verified

The shell renders for unauthenticated visitors. It shows only fixture data, so
nothing sensitive is reachable, but the session gate must exist before a real record
is. Row links 404. See `docs/limitations.md`.
