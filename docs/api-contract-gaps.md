# API contract gaps

The careOS API generates its OpenAPI document at runtime and does not check one
into the repository. `openapi/careos.partial.json` is therefore **hand-authored
from the brief**, not exported from a running API. Everything below is what that
costs.

The rule from the brief is that nothing here gets invented silently. Each gap is
recorded, mocked behind MSW, and flagged.

An export path now exists on the API side — `npm run openapi:export` in the API
repository writes `docs/openapi.json`. It could not be run in this environment: it
requires a live PostgreSQL and Redis, and no container runtime is available. When
it is run, the real document should replace `openapi/careos.partial.json`, and
this file becomes a diff to review rather than a list of assumptions.

---

## GAP-001 — No exported OpenAPI document

**Status:** tooling available, unrun.

The API serves Swagger UI at `/docs` from a document built at runtime. Nothing is
checked in, so there is no stable artifact to generate types from.

**Resolution:** `npm run openapi:export` in the API repository. Verified only as
far as the point where it needs a database — dependency injection resolves, the
Nest application builds, then Redis refuses the connection.

**Impact:** every schema in `src/api/schema.d.ts` is provisional.

---

## GAP-002 — Response envelope shape is assumed

**Assumed:**

```json
{ "success": true, "data": {}, "meta": { "requestId": "req_..." } }
```

**Impact:** if the real envelope differs, every response type is wrong. The
`sensitive`, `unsubscribeToken` and `source` fields the brief mentions for the
emergency intake response are **not** modelled at all, because their shapes are
undefined.

**Resolution:** confirm against the exported document.

---

## GAP-003 — Error codes beyond the brief's nine are undefined

The catalogue in `src/lib/errors/catalog.ts` covers the codes the brief lists. The
API can return others; the catalogue has no message for them, so `resolveApiError`
returns `null` and the UI must not invent one.

These are known-unmapped and are listed explicitly in `UNMAPPED_ERROR_CODES`:

| Code                          | Surface                   |
| ----------------------------- | ------------------------- |
| `EMERGENCY_REQUEST_NOT_FOUND` | Public emergency tracking |
| `DISPLAY_PAIRING_INVALID`     | Display pairing           |
| `DISPLAY_OFFLINE`             | Display health            |
| `DIRECTORY_UNAVAILABLE`       | Public directory          |

**Resolution:** author a message for each once the real codes are known. The list
is a to-do list, not a graveyard.

---

## GAP-004 — `/auth/me` returns the user twice

The API returns a top-level identity _and_ a nested `user` object:

```json
{
  "id": "...",
  "email": "...",
  "roles": ["ADMIN"],
  "user": { "id": "...", "email": "...", "roles": [{ "role": "...", "facilityId": "..." }] },
  "breakGlass": null,
  "breakGlassGrants": []
}
```

`roles` exists in two shapes: a legacy flat string array, and `user.roles` as
grant objects. `breakGlass` is a legacy single object; `breakGlassGrants` is an
array. Both were made additive on the backend in Phase 12 rather than changed,
because changing them would break existing consumers.

**Impact:** the frontend must read `user.roles` and `breakGlassGrants`. Reading
the legacy fields will silently under-report access. Both shapes are modelled in
the partial spec so the ambiguity is visible rather than hidden.

**Resolution:** confirm the deprecation timeline for the legacy fields.

---

## GAP-005 — `/public/emergency-requests` response shape is assumed

The brief requires the intake response to carry `sensitive`, `unsubscribeToken`
and `source`. Their types are undefined, so they are absent from the schema.

**Impact:** the unsubscribe path and the "sensitive record" warning cannot be
implemented until these are defined. Both are required by the brief, so this gap
blocks a specified feature rather than merely being untidy.

---

## GAP-006 — `EmergencyStatus` and `FacilityType` enums are assumed

The brief names these enums but does not enumerate their members. The partial spec
guesses `GENERAL / REFERRAL / SPECIALIST / CLINIC / PRIMARY_CARE` for facilities and
omits emergency statuses entirely.

**Impact:** a guess that turns out wrong produces a UI that renders an unknown
status with no chip and no colour. Safer than a wrong chip, but still wrong.

**Resolution:** read both from the exported document. Emergency status also needs
its colour mapping, which depends on knowing whether statuses partition into
clinically distinct severity bands.

---

## GAP-007 — Pagination shape is undefined

The brief requires pagination everywhere a list can grow. No page size, cursor
format, or total-count field is specified.

**Assumed:** `{ items: [], total: n }`, from the mock handlers.

**Impact:** every list view's data-access layer is provisional.

---

## GAP-008 — No contract for the endpoints F0 does not touch

Not modelled at all: `/public/emergency-requests/{reference}/track`,
`/public/emergency-requests/{reference}/cancel`, display pairing and health, the
notice feed, on-call rotas, SLA alerts, and the entire staff surface.

**Impact:** expected. F0 is foundations only. Each is logged here as it is needed
rather than speculatively specified — a speculative schema is a wrong schema.
