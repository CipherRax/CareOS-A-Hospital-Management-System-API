# API contract gaps

**Status as of this slice:** the real contract is now in the frontend. The
hand-authored `openapi/careos.partial.json` has been deleted and replaced by
`openapi/careos.openapi.json`, a copy of the document exported from a **live,
booted** careOS API (`npm run openapi:export` in the API repository, against a
locally running PostgreSQL and Redis). `src/api/schema.d.ts` is regenerated from
it. This file is therefore a review of what the real document changed, not a
catalogue of guesses — the numbers are kept stable so earlier references hold.

Everything below that is still open is a real gap. Items marked **closed** or
**revised** are historical.

Two properties of the exported document are worth knowing before anything else:

- The facility search **200 body and the emergency intake 201 body are typed
  `unknown`** in the export, and the `q` query parameter is not modelled at all
  (`params.query` is `never`). Screens validate those `unknown` bodies in code
  (`extractListingItems`, the receipt validator) and the search uses a raw
  `fetch` with `q`.
- The API's descriptive error vocabulary was confirmed live: `VALIDATION_ERROR`,
  `UNAUTHORIZED`, `PERMISSION_DENIED`, `RESOURCE_NOT_FOUND`, `CONFLICT`,
  `RATE_LIMITED`, plus domain codes such as `FACILITY_NOT_ACCEPTING_REQUESTS`,
  `LOCATION_REQUIRED`, `EMERGENCY_CALL_NOW`, `PUBLIC_LISTING_NOT_PUBLISHED`.

---

## GAP-001 — No exported OpenAPI document

**Status: closed.** The API's `npm run openapi:export` was run against a live
backend and `docs/openapi.json` (339 paths) was copied into the frontend as
`openapi/careos.openapi.json`. `package.json`'s `api:types`/`api:check` scripts
and `src/api/schema.d.ts` now point at the real document.

---

## GAP-002 — Response envelope shape is assumed

**Status: revised.** The old assumption of `{ success, data, meta:{requestId} }`
was wrong. Confirmed live:

- `GET /public/facilities/search` → `{ success: true, data: [ ... ] }` — a flat
  array, no `items`/`total` wrapper, no `meta`.
- `POST /public/emergency-requests` → 201
  `{ success: true, data: { request: { id, referenceNumber, trackingToken }, contact, consentVersion } }`.

There is no `meta.requestId` envelope, and the brief's `sensitive`,
`unsubscribeToken` and `source` fields do not exist on the emergency response
(see GAP-005). The flat envelope is what the screens read now.

---

## GAP-003 — Error codes beyond the brief's nine are undefined

**Status: revised.** The catalogue in `src/lib/errors/catalog.ts` now reflects
the live vocabulary; the old `UNAUTHENTICATED`/`FORBIDDEN`/`NOT_FOUND` names are
gone, replaced by `UNAUTHORIZED`, `PERMISSION_DENIED`, `RESOURCE_NOT_FOUND`. The
remaining known-unmapped codes are listed in `UNMAPPED_ERROR_CODES`:

| Code                              | Surface            |
| --------------------------------- | ------------------ |
| `PUBLIC_LISTING_NOT_PUBLISHED`    | Facility directory |
| `FACILITY_NOT_ACCEPTING_REQUESTS` | Emergency intake   |
| `LOCATION_REQUIRED`               | Emergency intake   |
| `EMERGENCY_CALL_NOW`              | Emergency intake   |

**Resolution:** author a message for each once the screens that surface them
exist. The list is a to-do list, not a graveyard.

---

## GAP-004 — `/auth/me` returns the user twice

**Status: superseded.** The "returns the user twice" shape was an artefact of the
partial document. The exported document's `/auth/me` 200 response has an **empty
schema** (`"application/json": {}`). Verified live: with no session it returns
401 `{ success:false, error:{ code:'UNAUTHORIZED' } }`. The staff gate depends
only on a 2xx meaning "signed in", so it is correct against the real endpoint;
the actual success body must be captured from a real session when the auth UI is
built.

---

## GAP-005 — Emergency intake response shape is assumed

**Status: superseded.** The live 201 body is
`{ request: { id, referenceNumber, trackingToken }, contact, consentVersion }`.
The brief's `sensitive`, `unsubscribeToken` and `source` fields are **not in the
live contract**. That is an API-side discrepancy to raise: the unsubscribe and
"sensitive record" surfaces the brief requires cannot be built against an API
that does not return them.

---

## GAP-006 — `EmergencyStatus` and `FacilityType` enums are assumed

**Status: superseded.** There is no `FacilityType` enum and no `facilities.type`
field in the live contract. Facilities carry boolean capabilities
(`open24h`, `emergency24h`, `ambulanceAvailable`, `emergencyIntakeEnabled`); the
frontend renders those as words and filters by them client-side. The intake
`category` enum (`NOT_SURE | BREATHING_DIFFICULTY | SEVERE_INJURY | UNCONSCIOUS |
CHEST_PAIN | HEAVY_BLEEDING | OTHER`) is the only status-like enum in the public
surface, and it is expressly not a triage severity.

---

## GAP-007 — Pagination shape is undefined

**Status: revised.** `GET /public/facilities/search` returns a flat array with no
page size, cursor or total. The search is single-page by nature; any future list
endpoint (staff triage queue, records) must still have its pagination confirmed
from the exported document rather than assumed.

---

## GAP-008 — No contract for the endpoints F0 does not touch

**Status: revised.** The emergency track/cancel/update endpoints **exist in the
live contract** as static POSTs — `/public/emergency-requests/track|cancel|update`,
keyed by `token` (not reference). What does not exist is a **tracking UI**: the
intake receipt now hands out a real `referenceNumber` and a real `trackingToken`,
but no page consumes them yet (F11B candidate, not built). Display pairing and
health, the notice feed, on-call rotas, SLA alerts and the entire staff surface
remain unmodelled in the frontend.

---

## GAP-009 — No triage queue endpoint

**Status: unchanged, still open.** `GET /triage/counts` and `GET /triage/queue`
are not in the exported document. `/triage` still renders `EXAMPLE` fixtures and
the nav rail renders no counts. **Not assumed**, for the same reason as before: a
fabricated queue looks like data and is not.

---

## GAP-010 — No staff authentication contract

**Status: closed.** The document has `/auth/login`, `/auth/logout`,
`/auth/refresh`, `/auth/me`, `/auth/me/preferences`, MFA and password endpoints,
and the frontend now builds the session on them: `/login` (posts the real
`LoginDto`), the proxy-owned HttpOnly cookie bridge, and the header `Sign out`.
Second-factor sign-in posts the real `MfaVerifyDto` to `/auth/mfa/verify` (TOTP
code or recovery code) and the proxy concludes it exactly like login. The staff
gate fails closed on `/auth/me`, the signed-out page earns a real `Sign in` link,
and the whole flow — including the MFA challenge, its refusal, and cookie→Bearer
translation — is verified end to end against the e2e stub through the real proxy.

**Upstream defect discovered while verifying (still open):** `POST /auth/login`
requires `organizationId` in **uuid format**, but the seed data uses string ids
(`demo-org-nairobi`). No seeded account can log in through the live API. Reported
for the API team's decision; documented in `docs/limitations.md`. Until it is
decided, the frontend's login cannot be exercised against real data — only via
the stub.

---

## GAP-011 — No record detail endpoint

**Status: unchanged, still open.** `/triage/{reference}` remains undefined in the
exported document. `/triage/EX-0001` renders fixtures and `notFound()`s anything
else; the queue's row links still point at a 404.

---

## GAP-012 — Patient search `q` is not modelled

**Status: narrowed to patient search; still open.** The exported document's
patient search (`GET /patients`) has no `q` query parameter, and the 200 body is
typed `unknown`. The frontend therefore searches with a raw `fetch` (`q` + the
proxy cookie) and validates the page structurally (`extractPatientList`,
`src/lib/data/patients.ts`). A genuinely empty `items` array reads as a
no-result search; a drifted row rejects the whole page rather than showing a
half-rendered table. Same stance as facility search.

## GAP-013 — Master record body is underspecified

**Status: open.** `GET /patients/{id}/master` is exported with a 200 body typed
`PatientResponseDto` (a plain patient), **not** the `{ patient, sections }`
envelope the live API returns (`patients.service.ts#masterRecord`). The frontend
validates the envelope structurally. Consequence: a missing `sections` block (or
section key) is treated as a drifted body and the record fails closed rather
than presenting itself as "no allergies" from an absence; explicit empty arrays
do read as "no data recorded".

## GAP-014 — Sub-entity rows are raw contract rows

**Status: open.** Guardians, consents, allergies, medical history, timeline and
access-log rows are all unmodelled in the export (the endpoints exist; their row
serialization is internal). The frontend reads them structurally:
`readTimelineEvent` accepts the export field names (`title`, `occurredAt`) and
the legacy fixture names (`summary`, `createdAt`, `author.displayName`); the
access log reads `{ id, action, section, createdAt }` plus the live API's
`{ userId, reason, ip }`. The banner's allergy state follows the rows: a present
list renders the substances; an empty list renders "not recorded", never "no
allergies" — an absence in the raw data cannot be read as a checked-and-clear.

## GAP-015 — Patient numbers are not route keys

**Status: open.** The master, timeline and access-log endpoints key on the
patient **id** (`requirePatient` looks up `where: { id }`); a patient number
(`PAT-YYYY-NNNNNN`) is not accepted. Routes therefore use the uuid id:
`/patients/[id]`, with a shape guard (4–64 word chars) that `notFound()`s
malformed ids before the API is reached. Patient numbers are shown and copyable
but are display-only. A future "can I type the number in the URL?" change needs
an API lookup-by-number endpoint first.

## GAP-016 — No check-in / queue endpoint for reception

**Status: open (unmodelled feature gap).** The patient registry has search,
register and the duplicate-resolution flow, but nothing the reception queue
would sit on (check-in, arrival, waitlist count) is in the exported document.
The nav rail's patient/queue counts stay empty for now; arrival status remains a
future slice rather than a fabricated one.
