# Architecture decisions

Newest first. Each records what was decided, why, and what it costs.

---

## ADR-009 — The session token pair is owned by the proxy, never the page

**Context.** The live API is Bearer-only: `POST /auth/login` returns an access
token and a refresh token in the JSON body, and every staff endpoint reads
`Authorization: Bearer`. The web app promised the opposite — ADR-004's whole point
is that the session cookie stays first-party and HttpOnly, so JS can never read a
token. Logging in `fetch`-style and stashing the pair somewhere page-reachable
would break that promise (localStorage leaks, service workers leak), and a Bearer
header set from JS is exactly what ADR-004 exists to avoid.

**Decision.** The proxy owns the session. On a successful login the proxy lifts
`data.tokens` out of the response body, writes them to two HttpOnly cookies
(`careos_session`, `careos_refresh`; SameSite=Lax, Secure over TLS), and removes
`tokens` from what the browser sees. Every proxied request then carries
`careos_session` as `Authorization: Bearer` upstream — the browser's own
Authorization is still dropped. On a 401 the proxy rotates once through
`/auth/refresh` with the refresh cookie and retries; a failed rotation clears both
cookies. Logout is an empty client body; the proxy injects the refresh token and
clears both cookies on a 2xx.

**Alternatives considered.** (a) Tokens in page-accessible state/localStorage —
rejected: defeats ADR-004; (b) the API issuing session cookies — not possible
without an API change, and the API has no cookie middleware; (c) the browser
holding Bearer state — rejected, it is the exact leak pattern this design
removes.

**Consequences.** JS never sees a token, there is one place where the pair is
handled, and rotating is possible only where the secret is held (the proxy). The
cost: the proxy now has real session logic (tested in `route.test.ts` against a
real HTTP server), and a failure that leaves the refresh cookie set but the
access cookie clear self-heals on the next 401. JS-reachable code relies on the
proxy having set the bridge correctly, which is why the e2e stub sits upstream of
the real proxy so the whole chain is exercised.

---

## ADR-005 — Next.js 16 rather than the brief's Next.js 15

**Context.** The brief's stack table pins Next.js 15. `create-next-app` now
scaffolds 16.3.8, and building twelve phases on a superseded major was not
obviously right.

**Decision.** Use Next 16.3.8. React 19, Tailwind v4 and the App Router — every
other line of the brief's stack table — are satisfied unchanged.

**Consequences.** `middleware.ts` is now `proxy.ts`; Next renamed the convention.
Turbopack is the default bundler. This deviation is recorded in DESIGN.md §8.

---

## ADR-004 — Same-origin API access through a Next server proxy

**Context.** The brief sets the API base to `/api/v1`, which reads as a path on our
own origin. That reading is load-bearing for a product handling identifiable
patient information.

**Decision.** The browser calls `/api/v1/*` on our own origin. The Next server
proxies that prefix to `API_INTERNAL_URL`, which is server-side only.

**Consequences.** The API host never reaches the client bundle; there is no CORS
preflight on any request; the session cookie stays first-party and can be
`HttpOnly`; and a compromised or misconfigured client cannot be pointed at a
different backend. The cost is one proxy hop and a place for request handling to
be duplicated. Not implemented yet — the proxy route lands with the first feature
that calls the API.

---

## ADR-003 — All user-visible strings go through next-intl from day one

**Context.** The brief requires Swahili readiness with strings extracted from day
one, and the patient portal translated first.

**Decision.** `next-intl` with English and Swahili catalogues loaded statically,
and a locale cookie read server-side in `src/i18n/request.ts`.

**No next-intl proxy.** There is deliberately no middleware. With
`localePrefix: 'never'` it still rewrote every request to `/<locale>/<path>`, which
does not exist in a route tree without a `[locale]` segment — a permanent redirect
loop on every page, which is what the browser run exposed. Automatic detection was
unwanted regardless (`localeDetection: false`, and the app already owns the
preference alongside its theme and density cookies), so the proxy earned nothing
and cost correctness. See ADR-002 for the URL decision.

**Consequences.** Retrofitting extraction after the fact is the expensive path;
this makes it free. Static imports mean a missing translation is a build failure
rather than a silent English fallback in production.

One consequence of owning the locale directly: nothing writes `careos-locale` yet,
because no locale switcher exists until there is a real portal to switch. English
is the effective default. That is a gap in the plumbing, not a decision to leave
the app monolingual — the catalogue and the resolver are in place for F1.

---

## ADR-002 — Locale in a cookie, not in the URL

**Context.** The brief's route structure — `app/(public)/`, `app/(auth)/`,
`app/(staff)/` — has no `[locale]` segment. `next-intl`'s `localePrefix: 'never'`
gives exactly that.

**Decision.** No locale prefix. The locale lives in a cookie.

**Consequences.** URLs stay stable and shareable. The trade is explicit: a link
pasted into a chat opens in the recipient's locale, not the sender's. That is the
right default here — patients in one catchment share languages far more often than
staff, and clinical URLs get read aloud and retyped, where a prefix is a liability.
If that turns out to be wrong for a specific surface, the fix is a locale segment
on that surface only, not a global reversal.

---

## ADR-001 — Theme and density in cookies, not localStorage

**Context.** The obvious client-side choice is localStorage. It cannot be read on
the server.

**Decision.** `careos-theme` and `careos-density` cookies, read in the root layout
via `cookies()`.

**Consequences.** `<html>` carries `data-theme` and `data-density` in the SSR
response, so the first paint is already correct — no flash, no layout shift, and
density cannot visibly jump on reload. The cost is that the layout is dynamic and
cannot be statically prerendered; for an authenticated clinical application that is
a trade worth making. `system` is the one value the server cannot resolve, so the
server emits `light` as a deterministic baseline and a tiny inline script corrects
it before paint.

---

## ADR-000 — Colour tokens are generated and verified, not hand-written CSS

**Context.** The brief's palette does not meet WCAG 2.2 AA in several places.
Hand-corrected CSS values drift back toward the brief within a few commits, and a
contrast requirement nobody can check is a requirement nobody checks.

**Decision.** `src/design/tokens/palette.mts` is the single source of truth.
`npm run tokens:build` generates the CSS custom properties and the Tailwind v4
`@theme inline` mapping. `npm run tokens:verify` asserts all 94 contrast pairs and
exits non-zero on failure, and runs as `prebuild` so it cannot be skipped.

Every token that deviates from the brief carries a `deviation` note explaining the
measurement. Every token must either appear in `CONTRAST_CHECKS` or in
`CONTRAST_EXEMPT` with a stated reason — adding a colour and forgetting to check it
fails the gate.

Consequences: colour is impossible to add without proving it is readable; the
tokens are reviewable as data in a diff; and the corrections are documented rather
than invisible.

## ADR-006 — tailwind-merge is configured with the project's own type and colour scales

**Context.** `text-*` is overloaded in Tailwind: it sets font size or colour, and
which one is resolved from `@theme` at build time. `tailwind-merge` resolves it from
a hardcoded class list and cannot see our theme, so it treated every unknown
`text-*` as the same utility and kept only the last.

`<Button variant="primary" size="sm">` emits `text-on-fill` (colour) and `text-meta`
(font size). Merge deleted the colour class outright — the class was in the source
and absent from the DOM. Every filled button then inherited the body text colour
and sat at 2.6:1 against the brand fill. Unit tests passed throughout; axe caught
it, and only once CSS was actually loading.

**Decision.** `src/lib/cn.ts` extends `tailwind-merge` with explicit `font-size`
and `text-color` class groups listing every step of the type scale and every text
colour in the palette. Adding a token or a type step means adding it to one of
those lists.

The alternative — abandoning `tailwind-merge`, or renaming tokens so they dodge the
`text-` prefix — trades a real bug for a permanent naming workaround. The lists are
the cost, and the cost is visible.

## ADR-007 — Token names drop the redundant Tailwind namespace prefix

**Context.** Tailwind builds a utility by prepending the namespace to the variable
name: `--color-brand-teal` yields `bg-brand-teal`. So a token literally named
`text-primary` could only ever produce `text-text-primary`, and `border-control`
could only produce `border-border-control`. Neither matched the class names used in
the components, so Tailwind generated nothing for them and every text colour in the
app silently fell back to the inherited body colour.

**Decision.** Token names drop the redundant prefix — `text-primary` is `primary`,
`text-on-fill` is `on-fill`, `border-control` is `control`. The `--c-*` custom
property names follow, and the Tailwind utilities the components already used
(`text-primary`, `border-control`) now resolve correctly.

Token _names_ describe the role; the utility namespace says how to apply it. Two
places to look is acceptable; a palette whose every text colour silently fails to
compile is not.

## ADR-008 — The standalone bundle copies its own static assets in `postbuild`

**Context.** `output: 'standalone'` emits a self-contained server but deliberately
omits `.next/static` and `public/`. Running it returns correct HTML with a correct
theme and a 404 for every stylesheet and script.

This is the worst kind of bug to ship: a 200 response, valid markup, correct
server-rendered `data-theme`, and a page that is unstyled and completely
non-interactive. It is invisible to `next build`, to typecheck, to lint and to unit
tests. It only appears when something loads it in a browser — which is exactly what
the axe run is for.

**Decision.** `scripts/copy-standalone-assets.mjs` runs as `postbuild` and copies
both trees into `.next/standalone/`. Playwright then serves the standalone bundle
rather than `next start`, so the accessibility run exercises the artefact that
actually ships.

The verification is the point. A deployment target nobody loads is not verified.
