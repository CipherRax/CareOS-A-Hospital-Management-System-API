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

**Status:** not started. Blocked on design review.

Will add the ~15 signature components — StatusPill, DataTable, Timeline,
PatientHeader, TriageQueue, DisplayBoard, EmergencyForm and the rest — plus the
staff shell with the nav rail, once the token and type direction is signed off.
