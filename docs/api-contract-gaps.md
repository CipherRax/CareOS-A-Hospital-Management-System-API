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

**Status: superseded by F3.** Written while scoping F2, when only the patient
registry had been read. The exported document *does* carry the reception queue
(`/queue`, `/queue/entries`, `/queue/walk-ins/register`, `/queue/status`,
`/queue/metrics`, `/departments`); F3 builds on it. The endpoints exist and are
used, but their response bodies are mis-typed (see GAP-017), which is why F2's
original "no queue endpoint" reading was wrong. Nav counts stay empty until a
count is genuinely modelled.

## GAP-017 — Queue response bodies are typed as the request DTOs

**Status: open (contract export defect).** Every F3 queue operation has its 2xx
response schema set to the operation's *request* DTO rather than the actual body:

- `GET /queue` → `ListQueueQueryDto` (the real body is `{ items, meta }`).
- `GET /queue/metrics` → `ListQueueQueryDto` (real body: `{ stats }`).
- `GET /queue/status` → `ListQueueQueryDto` (real body:
  `{ queued, ticketNumber, position, estimate }`).
- `POST /queue/walk-ins/register` → `RegisterWalkInDto` (real 201 body is the
  ticket receipt `{ ticketNumber, visitId, position, status }`).
- The `PATCH` status/priority routes likewise echo their request DTOs.

The `GET /queue` and `GET /metrics` queries are also unmodelled (`query: never`),
so department/status filtering rides a raw fetch. Screens therefore read the
queue structurally (`src/lib/data/queue.ts`) instead of trusting the generated
types, exactly as the patient search does for GAP-012. The real row shape is
taken from `queue.service.ts` (`pageOf`, the joined `patient` display name, the
`enteredAt`/`calledAt`/`serviceStartedAt`/`completedAt` timestamps). The
transition graph in the same module (`queue-flow.ts`) is mirrored in
`QUEUE_TRANSITIONS` so the board offers only legal moves.

## GAP-018 — Appointments carry no joined names, and there is no branch source

**Status: open (two related F3 scheduling gaps).** The appointment desk needs two
things the contract does not provide.

**1. No display names on appointment rows.** `GET /appointments` serializes
`patientId` and `providerId` only — it is not joined to the patient registry or
the staff directory. The day book must therefore resolve each row's names itself.
The patient registry cannot even be batch-read into a map, because
`GET /patients` exposes only a free-text `q` and pagination, no id filter and no
"many by ids" lookup. The desk resolves patient names one row at a time through
`GET /patients/{id}` (`usePatientName`, cached and deduped by React Query) and
provider names from the catalogue already loaded for booking
(`GET /providers`). This is an N+1 workaround for a missing join, not a design
choice: a real day book would ship both names with the row, and the patient
registry would offer an id-keyed batch read.

**2. No branch source.** `BookAppointmentDto` and the slot query both *require* a
`branchId`, but nothing exposes the caller's permitted branches: `/auth/me`
returns `branch: { current: null }`, and departments serialize without a branch.
The desk is therefore single-branch and posts a constant
(`SCHEDULING_BRANCH_ID = 'br_example_0001'`), matching the queue board's
`QUEUE_BRANCH_ID`. A multi-branch deployment needs a branch selector fed by a
real source (a per-user branch list, or a branch on each department) before this
is correct.

## GAP-019 — Schedule overrides can be written but not listed

**Status: open (F3 schedule admin).** The schedules module exposes mutations for
dated exceptions — `POST /schedules/overrides`, `PATCH /schedules/overrides/{id}`
and `DELETE /schedules/overrides/{id}` — but no `GET /schedules/overrides` (nor a
read on a single override). The admin screen can therefore create an exception
and delete one by id, but it cannot enumerate the exceptions already set for a
provider. It cannot show a truthful list, and it cannot offer edit/delete for an
existing row without the operator pasting an id.

Rather than invent a list, `/schedules` states the limitation inline
(`schedules.overrideForm.gapNote`): it accepts a new exception and reports a
`409 CONFLICT` when the provider already has one on that date, which is the only
feedback the contract can give. Because `date` is typed `unknown` in the export,
the request body is built structurally. A complete screen needs a read endpoint
(`GET /schedules/overrides?providerId=&from=&to=` returning `{ items, meta }`,
mirroring templates) plus typed `date`/`startMinutes`/`endMinutes` fields.

## GAP-020 — Encounters and clinical-notes reads are mis-typed against what the service returns

**Status: open (F4 encounters).** Verified against `src/modules/encounters` and
the exported `schema.d.ts`:

- `GET /encounters` has `query: never` in the export (no query model) and its
  200 is typed as `ListEncountersQueryDto` — the request DTO, not a page. The
  handler is a genuine `PageResult` (unwrapped `data: [...]` + sibling `meta`),
  so the only safe read is the raw-fetch path: `fetchEncounters` in
  `src/lib/data/encounters.ts` validates each row structurally, exactly as
  GAP-017 did for queues.
- `GET /encounters/{id}` and `PATCH /encounters/{id}/status` are typed as the
  bare `EncounterResponseDto`, but the service answers `{ encounter }`. The
  typed client is used for the URL/body, then the unwrapped body is passed
  through `extractEncounterRecord`. Get and transition therefore read the same
  validator the list uses, so a drift would fail in one place.

The workflow surface is not in doubt: statuses OPEN → IN_PROGRESS → COMPLETED
are enforced server-side (COMPLETED is terminal, illegal moves answer 409
`INVALID_WORKFLOW_TRANSITION`), and the UI mirrors exactly those edges. What the
contract fixes is the typed read shape and a query model (filters
patient/branch/department/provider/type/status/date range/page/limit are
already implemented server-side).

**Same drift under clinical notes (F4 slice 2).** Verified against
`src/modules/clinical-notes`:

- `GET /clinical-notes` and `GET /clinical-notes/templates` both carry
  `query: never` with the 200 typed as a request DTO. Both are genuine
  `PageResult`s, so `fetchClinicalNotes` / `fetchNoteTemplates` in
  `src/lib/data/clinical-notes.ts` use the raw-fetch path with structural row
  validation.
- `GET /clinical-notes/{id}` (which additionally carries `versions` from the
  service layer) plus the create/patch/finalize/amend writes are typed as the
  bare `ClinicalNoteResponseDto` / `NoteTemplateResponseDto`, but the service
  answers `{ note }` / `{ template }`. Those go through `extractNoteRecord` /
  `extractTemplateRecord` on the unwrapped body.
- The versioning surface is not in doubt: DRAFT → FINAL writes the ORIGINAL
  version and later changes are amendments (kind `AMENDMENT`) requiring a
  reason, all enforced server-side. What the contract fixes is the typed read
  shape and a query model.

**Same drift under prescriptions and the medication catalog (F4 slice 3).**
Verified against `src/modules/prescriptions` and `src/modules/medications`:

- `GET /prescriptions` and `GET /medications` both carry `query: never` with
  the 200 typed as their own request DTOs (`ListPrescriptionsQueryDto`,
  `ListMedicationsQueryDto`). Both are genuine `PageResult`s, so
  `fetchPrescriptions` / `fetchMedications` in `src/lib/data/prescriptions.ts` /
  `medications.ts` use the raw-fetch path with structural row validation.
- The create/action endpoints (`POST /prescriptions`,
  `POST /prescriptions/{id}/action`) and `GET /medications/{id}` are typed as
  the bare `PrescriptionResponseDto` / `MedicationResponseDto` but answer
  `{ prescription }` / `{ medication }`; those go through
  `extractPrescriptionRecord` / `extractMedicationRecord` on the unwrapped body.
- `PrescriptionResponseSchema` also carries **no `createdAt`/`updatedAt`**, so
  a prescription row has no created stamp to chart — rows are ordered
  server-side (createdAt desc) and the UI only shows issued/dispensed/cancelled
  stamps, which the DTO does expose.
- The workflow surface is not in doubt: DRAFT → ISSUED, cancel while un- or
  partially-dispensed, DISPENSED terminal — all enforced server-side. What the
  contract fixes is the typed read shape and a query model.

**Same drift under laboratory and radiology results (F4 slice 4).** Verified
against `src/modules/laboratory` and `src/modules/radiology`:

- `GET /lab/orders` and `GET /lab/tests` both carry `query: never` with the 200
  typed as their own request DTOs (`ListLabOrdersQueryDto`,
  `ListLabTestsQueryDto`), and `GET /radiology/orders` is typed as
  `ListRadiologyOrdersQueryDto`. All three are genuine `PageResult`s, so
  `fetchLabOrders` / `fetchLabTests` / `fetchRadiologyOrders` use the raw-fetch
  path with structural row validation.
- `GET /lab/orders/{id}` and `GET /radiology/orders/{id}` are typed as the bare
  `LabOrderResponseDto` / `RadiologyOrderResponseDto` but answer `{ order }`;
  those go through `extractLabOrderRecord` / `extractRadiologyOrderRecord` on the
  unwrapped body.
- `GET /lab/orders` is not just thin about the page envelope — it is a **projection**
  of the order: the service serializes the header, the sample stub and each
  item's `testId`, and **omits the results and test names** that the detail read
  carries. So a result-bearing order needs a second read (`GET /lab/orders/{id}`),
  and there is no field metadata on a result at all — only `testFieldId` — so the
  field name/unit/reference come from `GET /lab/tests` (the same on-demand-naming
  pattern as patients and medications). This is a modelling gap, not just a
  typing one.
- Radologically the list already serializes the report, so no follow-up read is
  needed; the write surface (schedule/perform/report/verify/release) is a
  radiology-department responsibility and stays out of the doctor's read-only
  view.

**Same drift under the laboratory write surface (F5 slice 1).** Verified against
`src/modules/laboratory`:

- Every transition POST — `collect`, `receive`, `process`, `reject`, `cancel`,
  `verify`, `release`, `results` under `/lab/orders/{id}` — is typed as the bare
  `LabOrderResponseDto` but answers `{ order }`, and answers **201**. `collect` /
  `receive` / `process` / `verify` / `release` carry `requestBody?: never`;
  `reject` / `cancel` take a `{ reason }` body; `results` takes
  `{ comments?, results: [{ testFieldId, value }] }`.
- `PATCH /lab/results/{id}` (amend) is typed as the bare `LabResultResponseDto`
  but answers `{ result }` (200); `POST /lab/critical/{id}/acknowledge` is typed
  as the bare `CriticalResultResponseDto` but answers `{ criticalResult }` (201).
- The reads keep their earlier shape: the list is a thin projection and the
  detail answers `{ order }`; the service, not the DTO, is authority. The
  client validates every body in `src/lib/data/laboratory.ts` regardless.
- The workflow itself is not in doubt: the transition guards mirror
  `domain/lab-flow.ts`, and releasing before every critical result is
  acknowledged is refused with 409 `LAB_RESULT_NOT_ACKNOWLEDGED`, a wrong-state
  move with 409 `INVALID_WORKFLOW_TRANSITION`.

**Same drift under the radiology write surface (F5 slice 2).** Verified against
`src/modules/radiology`:

- Every transition POST — `schedule`, `perform`, `report`, `verify`, `release`,
  `cancel` under `/radiology/orders/{id}` — is typed as the bare
  `RadiologyOrderResponseDto` but answers `{ order }`, and answers **201**.
  `schedule` / `perform` / `verify` / `release` carry `requestBody?: never`;
  `report` takes `{ findings, summary?, impression? }`; `cancel` takes
  `{ reason }`.
- `POST /radiology/orders` (create) is typed as the bare entity but answers
  `{ order }`; the client unwraps and validates it through
  `extractRadiologyOrderRecord` (wired in F5 slice 3).
- The reads keep their earlier shape: the list serializes the full order
  including the report and the single read answers `{ order }`; the service, not
  the DTO, is authority. The client validates every body in
  `src/lib/data/radiology.ts` regardless — the reads through
  `readRadiologyOrder` / `extractRadiologyOrderRecord`, and the writes through
  the same record validator on the unwrapped `{ order }`.
- `RadiologyOrderResponseDto` exposes `cancelledById` but the F4 row reader did
  not read it; it is now part of `RadiologyOrderRow`, so a cancelled study can
  show who cancelled it.
- The workflow itself is not in doubt: the transition guards mirror
  `domain/radiology-flow.ts` (`RAD_ALLOWED_FROM`), and a wrong-state move is
  refused with 409 `INVALID_WORKFLOW_TRANSITION`. A report is required before
  verification (the 1:1 report is created by `report`).

**Same drift under the order-entry creates (F5 slice 3).** Verified against
`src/modules/laboratory` and `src/modules/radiology`:

- `POST /lab/orders` is typed as the bare `LabOrderResponseDto` but answers
  `{ order }` (201); the body is `CreateLabOrderDto`
  (`{ patientId, branchId, encounterId?, priority?, clinicalNotes?, testIds }`
  with `testIds` 1–50). The client validates the unwrapped body through
  `extractLabOrderRecord`.
- `POST /radiology/orders` matches the `report`/`cancel` pattern above: bare
  entity typed, `{ order }` (201) answered, body `CreateRadiologyOrderDto`
  (`{ patientId, branchId, encounterId?, modality, region?, clinicalNotes?,
  requestedAt? }`). Validated through `extractRadiologyOrderRecord`.
- Both creates default `orderedById`/`orderedAt` server-side and return the new
  order at status `ORDERED`, which is what the worklists then process. The
  export carries the request DTOs correctly for once — the drift is envelope-only.
  The active test catalogue for the picker still comes from `GET /lab/tests`
  (page-typed DTO, raw-fetched), and the modality list from
  `domain/radiology-flow.ts` constants mirrored in the client.

**Same drift under the pharmacy inventory reads/writes (F6 slice 1).** Verified
against `src/modules/inventory` — note the controller base path is **`pharmacy`**,
not `inventory` (`@Controller('pharmacy')` in `inventory.controller.ts`), even
though the module is `inventory`:

- `GET /pharmacy/stock/on-hand` carries `query: never` in the export and types
  the 200 as the request DTO (`OnHandQueryDto`) while the service answers
  `{ onHand: [{ medicationId, name, unit, branchId, quantity }] }`. The client
  rides the raw-fetch path (`fetchStockOnHand`/`extractStockOnHand`/
  `readStockOnHandRow`).
- `POST /pharmacy/stock/dispense` is typed as `InventoryResponseDto` but answers a
  **bare** `{ prescriptionStatus, dispensedLines }` (201). Body is `DispenseDto`
  (`{ prescriptionId, branchId, lines: [{ medicationId, quantity }] }`, 1–100
  lines). The service FEFOs across the branch's batches under a row lock and
  derives the new status from cumulative dispensed quantity
  (`statusAfterDispense`: `DISPENSED` when fully dispensed, else
  `PARTIALLY_DISPENSED`); a line above the outstanding balance is a 400, a stock
  shortfall or a non-`ISSUED`/`PARTIALLY_DISPENSED` prescription a 409. The client
  validates the unwrapped body through `readDispenseResult`.

**Stock control reads/writes (F6 slice 2).** Same drift, same controller:

- `GET /pharmacy/stock/alerts` carries `query: never` and types the 200 as the
  request DTO while the service answers
  `{ alerts: [{ medicationId, name, label, detail }] }`, `label` one of
  `LOW_STOCK | REORDER_RISK | EXPIRY_RISK`. The client rides the raw-fetch path
  (`fetchStockAlerts`/`extractStockAlerts`/`readStockAlertRow`, which rejects an
  unknown tier).
- `POST /pharmacy/stock/receive` is typed as `InventoryResponseDto` but answers a
  **bare** `{ batches: [{ id, batchNumber, medicationId, quantity }] }` (201).
  Body is `ReceiveStockDto` (`{ branchId, lines: [{ medicationId, quantity,
  batchNumber, expiryDate?, unitCost? }] }`, 1–100 lines, `batchNumber` 1–200).
  The client validates the unwrapped body through `readReceiveResult`.
- `POST /pharmacy/stock/write-off` declares **no** `responseType` at all, yet the
  service answers a **bare** `{ writeOffId, branchId, quantity }` (201). Body is
  `WriteOffDto` (`{ branchId, reason (1–500), lines: [{ medicationId, quantity }]
  }`, 1–100 lines). The client validates the unwrapped body through
  `readWriteOffResult`.

**The procurement reads (F6 slice 4).** `GET /purchase-orders` is the same
mis-typing in its purest form: the export fastens the *request* DTO
(`ListPurchaseOrdersQueryDto`) onto the 200 while `PurchaseOrdersService.list`
answers `pageOf(rows.map(serializePo), …)`. `GET /suppliers` drifts the same way
(`ListSuppliersQueryDto` over a `pageOf(...)` of supplier rows). Both ride the
raw-fetch path (`src/lib/data/purchase-orders.ts`: `readPurchaseOrder`,
`extractPurchaseOrderPage`, `readSupplier`, `extractSupplierPage`) and fail closed
on a body that is not the page the service answers. The order projection carries
`unitCost` as a Prisma `Decimal` serialized to a decimal string (ADR-029); the
reader deliberately does not touch it, because the screen reports coverage
(ordered against received), not value.

Three F6 write loops still have **no read counterpart**, so they are not wired:

- `POST /pharmacy/transfers` (+ `/:id/action`, `/:id/receive`) and
  `POST /pharmacy/stock/counts` (+ `/:countId/items/:itemId`, `/:id/apply`) expose
  only writes — there is no `GET /pharmacy/transfers` or `GET /pharmacy/stock/counts`
  to list what exists, and the app has no branch picker to choose a transfer
  destination. A client cannot render a durable transfers or counts desk without
  one of those.
- `POST /purchase-orders` (+ `/:id/action`, `/:id/receive`) has a list read now but
  no composer on the client: raising or receiving an order needs a supplier
  catalogue, a line composer and the optimistic-lock version bump, which is more
  than the read slice covers.

**Same drift under the billing reads/writes (F7 slice 1).** Verified against
`src/modules/billing` — the controller is declared `@Controller()` (empty base
path), so the invoice and payment routes sit at the API root:

- `GET /invoices` carries `query: never` and types the 200 as the request DTO
  (`ListInvoicesQueryDto`) while the service answers a `PageResult`
  (`pageOf(rows.map(serializeInvoice), …)`). The client rides the raw-fetch path
  (`fetchInvoices`/`extractInvoicePage`/`readInvoice`). The list serializes items
  but **omits payments** (`payments: []`), so the row reader defaults `payments`
  to empty.
- `GET /invoices/{id}` is typed as the bare `InvoiceResponseDto` but answers
  `{ invoice }`; the issue/cancel/refund writes (`POST /invoices/{id}/issue`,
  `/cancel`, `/refund`, body `ActionInvoiceDto` `{ reason? }`) are typed the same
  bare way, answer `{ invoice }`, and answer **201** for the lifecycle moves on
  the typed client. All go through `extractInvoiceRecord` on the unwrapped body.
- `POST /invoices/{id}/payments` (create) and `POST /payments/{id}/refund` are
  typed as the bare `PaymentResponseDto` but answer `{ payment }`, and answer
  **201**. Body is `CreatePaymentDto` / `RefundPaymentDto`; the client validates
  the unwrapped body through `extractPaymentRecord`. `GET /invoices/{id}/payments`
  and `GET /payments` are genuine page-typed reads the desk does not need yet.
- Every money field is a decimal string (ADR-029, `Decimal(12,2)`); the client
  validates it as a string and never parses or computes it. On the list read the
  service can omit `items` if the query does not eager-load them, so the reader
  defaults `items` and `payments` to empty arrays.
- The lifecycle itself is not in doubt and mirrors the service: `issue` from
  `DRAFT`, `cancel` from `DRAFT|ISSUED`, `refund` from `PAID` (refunding an
  invoice also refunds its completed payments and restores `balanceDue = total`);
  payments are accepted only on `ISSUED|PARTIALLY_PAID` (a payment above the
  balance is a 409, a wrong-state invoice a 409 `INVALID_WORKFLOW_TRANSITION`),
  and a single payment refunds only while `COMPLETED` (else 409
  `PAYMENT_ALREADY_PROCESSED`), adding its amount back to the balance. The service
  truncates the settled status with `settleInvoiceStatus(total, balanceDue)`
  (`PAID` at zero balance, else `PARTIALLY_PAID`).
- **Not built this slice:** `POST /invoices` (create) needs a `branchId` and the
  app still has no branch picker; the whole insurance surface
  (`/insurance/payers`, `/insurance/policies`, `/insurance/claims`) followed in
  slice 2, below.

**Same drift under the insurance reads/writes (F7 slice 2).** Verified against the
same `src/modules/billing` controller (base path empty; the insurance routes also
sit at the API root):

- `GET /insurance/payers` is typed as the bare `InsurancePayerResponseDto` while
  the service answers a `PageResult` (`pageOf(rows.map(serializePayer), …)`, total
  forced to the row count); the client rides the raw-fetch path
  (`fetchPayers`/`extractPayerPage`/`readPayer`).
- `GET /insurance/policies` and `GET /insurance/claims` are typed as their request
  DTOs (`ListPoliciesQueryDto` / `ListClaimsQueryDto`) while the service answers a
  `PageResult`; both ride the raw-fetch path
  (`extractPolicyPage`/`readPolicy`, `extractClaimPage`/`readClaim`).
- `GET /insurance/claims/{id}` is typed as the bare entity but answers
  `{ claim }`; `POST /insurance/claims` (create, `CreateClaimDto`) and
  `POST /insurance/claims/{id}/action` (`ActionClaimDto` `{ action, approvedAmount?,
  reason? }`) are typed the same bare way, answer `{ claim }`, and answer **201**.
  All go through `extractClaimRecord` on the unwrapped body.
- A claim's `amount` and `approvedAmount` (nullable) are decimal strings
  (ADR-029); the client validates them as strings and never parses or computes
  them. `serializeClaim` returns `approvedAmount: null` until a decision sets it.
- The lifecycle mirrors the service's `CLAIM_ALLOWED_FROM`: `submit` from `DRAFT`,
  `approve`/`partial_approve`/`deny` from `SUBMITTED`, `pay` from
  `APPROVED|PARTIALLY_APPROVED`. Create-time guards: the policy's patient must
  match the invoice's, and the amount may not exceed the invoice total; `approve`
  may not exceed the claim amount and `partial_approve` must sit below it; `deny`
  requires a reason. `pay` settles an INSURANCE-method payment against the invoice
  (invoice must be `ISSUED|PARTIALLY_PAID`, payout within the balance), so a `pay`
  invalidates the invoice reads as well as the claim's.
- `POST /insurance/payers` (`CreateInsurancePayerDto`) and `POST
  /insurance/policies` (`CreatePatientInsurancePolicyDto`) are typed as the bare
  response entity but answer `{ payer }` / `{ policy }` and answer **201**
  (GAP-020 family). The client validates the unwrapped body through
  `extractPayerRecord`/`extractPolicyRecord`. Create guards mirror the service: a
  duplicate payer name is a 409 `CONFLICT`; a policy's payer must be active (404
  otherwise) and a `PARTIAL` coverage policy without a `coveragePercent` is a 400.
  `POST /insurance/policies` is the `GET /insurance/policies` counterpart, still a
  `PageResult` read.
- **Not built:** M-PESA; and `POST /invoices` (create), which still needs the
  branch picker.

**Same drift under the inpatient reads/writes (F8 slice 1).** Verified against
`src/modules/inpatient` — the controller is declared `@Controller()` (empty base
path), so the ward, room, admission and emergency routes sit at the API root:

- `GET /wards` carries `query: never` and types the 200 as the request DTO
  (`ListWardsQueryDto`) while the service answers a `PageResult` whose each row
  nests its `rooms` and each room its `beds`. The client rides the raw-fetch path
  (`fetchWards`/`extractWardPage`/`readWard`), validating the whole nested shape
  so a drift fails closed rather than rendering an empty board.
- `GET /wards/{id}` is typed as the bare `WardResponseDto` but answers
  `{ ward }`; the create/room/bed writes are typed the same bare way and answer
  **201** (`POST /wards` → `{ ward }`, `POST /wards/{id}/rooms` → `{ room }`,
  `POST /rooms/{id}/beds` → `{ bed }`), and `PATCH /beds/{id}/status` answers
  `{ bed }` with 200. All go through `extractWardRecord`/`extractRoomRecord`/
  `extractBedRecord` on the unwrapped body.
- The bed status is `BedStatus` (`AVAILABLE | OCCUPIED | RESERVED | CLEANING |
  MAINTENANCE | BLOCKED`); `OCCUPIED` is assignment-driven, so the operator may
  set only `MANUAL_BED_STATUSES` (`AVAILABLE | RESERVED | CLEANING | MAINTENANCE |
  BLOCKED`). A `PATCH /beds/{id}/status` is an optimistic-lock write: the version
  the operator saw travels with the change and a mismatch is a 409
  `OPTIMISTIC_LOCK_CONFLICT`.
- **Not built this slice:** admissions (`POST|GET /admissions`,
  `/admissions/{id}/transfer`, `/admissions/{id}/discharge`) and the emergency
  desk (`/emergency/visits…`) follow in slices 2 and 3. `POST /wards` posts to the
  EXAMPLE branch (`INPATIENT_BRANCH_ID`) because the session still reports no
  current branch (GAP-018); a real deployment reads it from the session.

**Admissions (F8 slice 2).** Same GAP-020 family under `src/modules/inpatient`:

- `GET /admissions` carries `query: never` and types the 200 as the request DTO
  (`ListAdmissionsQueryDto`) while the service answers a `PageResult`; each row is
  an admission that nests its `assignments` and its `discharge`. The client rides
  the raw-fetch path (`fetchAdmissions`/`extractAdmissionPage`/`readAdmission`),
  validating the whole nested shape so a drift fails closed.
- `GET /admissions/{id}` is typed as the bare `AdmissionResponseDto` but answers
  `{ admission }`; `POST /admissions`, `POST /admissions/{id}/transfer` and
  `POST /admissions/{id}/discharge` are typed the same bare way and answer
  **201** with `{ admission }`. All go through `extractAdmissionRecord` on the
  unwrapped body.
- `serializeAssignment` exposes only `bedId` — not the bed number, room or ward —
  so the desk resolves a bed's label from the ward tree (`GET /wards`) rather than
  a second admission sub-resource. The assignment history is the admission's own
  list, newest first.
- Create/transfer/discharge guards mirror the service: `POST /admissions` assigns
  the source (`OUTPATIENT_CLINIC` for this desk — the emergency desk admits with
  `EMERGENCY` in the same transaction) and row-locks the bed, so the source is not
  in `CreateAdmissionDto`; an already-active patient is a 409
  `ADMISSION_ALREADY_ACTIVE` and an unavailable bed a 409 `BED_UNAVAILABLE`. A
  transfer moves the active assignment and never changes the status (a discharged
  admission is a 409 `INVALID_WORKFLOW_TRANSITION`); a discharge is final and
  releases the bed to `CLEANING`. `POST /admissions` posts to the EXAMPLE branch
  (`INPATIENT_BRANCH_ID`, GAP-018).
- **Not built this slice:** the emergency desk (`/emergency/visits…`), slice 3
  (built — see below).

**Emergency (F8 slice 3).** Same GAP-020 family under `src/modules/emergency`:

- `GET /emergency/visits` types its 200 as the request DTO
  (`ListEmergencyVisitsQueryDto`) while the service answers a `PageResult`; the
  client rides the raw-fetch path (`fetchEmergencyVisits`/`extractEmergencyVisitPage`/
  `readEmergencyVisit`), validating each row so a drift fails closed.
- `GET /emergency/visits/{id}` is typed as the bare `EmergencyVisitResponseDto`
  but answers `{ visit }`; every write — `POST /emergency/visits`,
  `POST /emergency/visits/{id}/{triage|assess|treat|observe|admit|refer|discharge}`
  — answers **201** with `{ visit }`, and `PATCH /emergency/visits/{id}/priority`
  answers **200** with `{ visit }`. All go through `extractEmergencyVisitRecord`
  on the unwrapped body; the summary body is read by `extractEmergencySummary`.
- The visit is one row that accumulates the whole encounter; the workflow guards
  mirror `assertEmergencyAction` — a terminal status
  (`DISCHARGED | ADMITTED | REFERRED`) is closed to every action
  (`EMERGENCY_VISIT_CLOSED`) and a wrong source status is a 409
  `INVALID_WORKFLOW_TRANSITION`. Admit creates the inpatient admission in the
  same transaction and row-locks the bed, so the client invalidates the
  admission and ward reads too and the admission appears on the admissions desk.
  Registering posts to the EXAMPLE branch (`EMERGENCY_BRANCH_ID`, GAP-018).
- `serializeVisit` exposes only `patientId`; the desk resolves names on demand
  (`usePatientName`, GAP-018). The admitted admission is linked by id.

**Users and roles (F9 slice 1).** Same GAP-020 family under `src/modules/users`
and `src/modules/roles`:

- `GET /users` types its 200 as the request DTO (`ListUsersQueryDto`) while the
  service answers a `PageResult`; the client rides the raw-fetch path
  (`fetchUsers`/`extractUserPage`/`readUser`), validating each row so a drift
  fails closed. Search (`q`) covers email/first/last and `status` is an
  exact-match filter.
- `GET /users/{id}` is typed as the bare entity but answers `{ user }`;
  `POST /users` answers **201** with `{ user, inviteToken? }`; `PATCH /users/{id}`
  and `POST /users/{id}/roles` answer **200** with `{ user }`; `POST
  /users/{id}/sessions/revoke` answers `{ revoked }`; `DELETE /users/{id}` answers
  **204** (a soft delete that revokes sessions). All go through
  `extractUserRecord`/`extractInvitedUser`/`extractRevoked` on the unwrapped body,
  and the 204 through the void unwrap.
- `GET /roles` is the same mis-typed `PageResult` (`fetchRoles`/
  `extractRolePage`/`readRole`); `GET /roles/{id}` is typed as the bare entity but
  answers `{ role }`. `GET /roles/permissions` answers `{ groups, systemRoles,
  permissionGroups }` where `permissionGroups` is nested per group and per action;
  `readRoleCatalog` flattens it into a sorted `{ key, permissions }[]`.
- `PATCH /users/{id}` refuses self-management (a 400, "Cannot self-manage through
  this endpoint"), so the workspace disables its own mutation controls for the
  signed-in account rather than letting the write fail. `SetUserRolesDto.roleIds`
  is `min(1)` and `UpdateUserDto` refines to at least one field.
- `POST /users` posts to no branch or department: the app has no branch picker
  (GAP-018), and both arrays are optional. The invite dialog and the roles picker
  read `GET /roles` rather than a hardcoded list.
- **Role writes (F9 slice 2).** `POST /roles` is typed as the bare `RoleDto` but
  answers **201** with `{ role }`; `PATCH /roles/{id}` answers **200** with
  `{ role }`; `DELETE /roles/{id}` answers **204**. All go through
  `extractRoleRecord` on the unwrapped body and the void unwrap for the delete. The
  service guards are surfaced rather than hidden: `CreateRoleSchema.key` is
  `^[A-Z][A-Z0-9_]*$` and `permissions` is `min(1)`, a role that would exceed the
  caller's own permissions (or a system-role permission edit without authority) is
  a **403 `PERMISSION_DENIED`**, a duplicate key/name is a **409 `CONFLICT`**, and
  deleting a role still assigned to a user is a **409**. The update DTO has no
  `key`, so a role's key is immutable; the workspace shows it read-only. The client
  mirrors the key rule with `ROLE_KEY_PATTERN`/`isValidRoleKey` so the form rejects
  a bad key before posting.
- **Staff (F9 slice 3).** Same GAP-020 family under `src/modules/staff`.
  `GET /staff` is typed as the bare request DTO but answers a `PageResult` (typed
  `StaffListResponseDto` as `{ staff, meta }`), so the rows are validated
  structurally in `src/lib/data/staff.ts`. `GET /staff/{id}` answers `{ staff }` and
  the writes `PATCH /staff/{id}` and `POST /staff/{id}/assignments` answer **200**
  with `{ staff }`; all three go through `extractStaffRecord` on the unwrapped body.
  `SetStaffAssignmentsDto` replaces the branch/department set wholesale and the
  service refuses the whole set with a **400 `VALIDATION_ERROR`** if any id does not
  exist, so the failure is surfaced rather than hidden. `GET /branches` is typed
  `BranchListResponseDto` but the service answers `pageOf` (its interceptor unwraps
  it to `{ data: items }`), so branch options are read with `extractBranchList`.
- **Organization (F9 slice 4).** Same GAP-020 family under
  `src/modules/organizations`. `GET /organizations/me` answers `{ organization }`
  (the export types the bare entity) and `PATCH /organizations/me` answers **200**
  with `{ organization }`; both go through `extractOrganizationRecord`. The update
  DTO refines to at least one field; a change whose email collides with another
  account is a **409 `CONFLICT`**, and a patch that contains no editable keys is a
  **400 `VALIDATION_ERROR`** ("Nothing to update.").
- **Reports (F10 slice 1).** Same GAP-020 family under `src/modules/insights`.
  `GET /reports/exports` is typed as the request DTO but the service answers a
  `PageResult` (`pageOf`), so the rows are validated structurally in
  `src/lib/data/reports.ts`. `GET /reports/exports/{id}` answers the bare record
  and `POST /reports/export` answers **202** with the bare record; both go through
  `extractReportRecord` on the unwrapped body. The list query parameter is
  `pageSize`, not `limit`. Generation is asynchronous — a request returns a
  PENDING row that the desk polls — and `GET /reports/exports/{id}/download`
  returns a stream that is **409** while not READY and **410** once expired; the
  desk only offers the link for a READY, unexpired row, so those outcomes are not
  reachable from the UI.
- **Analytics metrics (F10 slice 2).** `GET /analytics/metrics` types its 200 as
  `unknown` (a large, nested object — scope, period, granularity, a daily series, a
  headline summary and a set of point-in-time snapshots), so it rides the raw-fetch
  path. The **series** and **summary** are validated structurally in
  `src/lib/data/analytics.ts` and fail closed on drift; the **snapshots** block is
  deliberately left loose and rendered generically, because it is an open set of
  labelled measurements that the API adds to over time and a new block should
  appear on the dashboard rather than blank it. The API's own `label` on each
  snapshot (and on the payload) is surfaced verbatim rather than paraphrased.
- **Journey bottleneck & capacity (F10 slice 3).** Same family:
  `GET /analytics/bottleneck` and `GET /analytics/capacity` are large nested
  `unknown` payloads on the raw-fetch path, validated in `src/lib/data/analytics.ts`.
  Bottleneck stages and every capacity block fail closed on drift; the one
  exception is the **embedded appointment-demand forecast** inside
  `capacity.appointmentDemand`: a malformed forecast leaves the rest of the panel
  readable with `forecast: null`, since it is a labelled estimate riding along with
  otherwise-solid measurements. The forecast's model name/version, fit period,
  horizon, uncertainty band and the service's `notes` are all rendered — a forecast
  is not a promise.
- **Forecasts, patient experience & staff (F10 slice 4).** Same family:
  `GET /analytics/forecasts/{series}`, `GET /analytics/patient-experience` and
  `GET /analytics/staff` are nested `unknown` payloads validated in
  `src/lib/data/analytics.ts`, all failing closed on drift. An unknown forecast
  series is **not** a 4xx: the service answers 200 with a labelled forecast whose
  `notes` state the series is unknown, so the page renders it like any other.
  The patient-experience payload carries its own `weights` alongside each
  component's `score` and `raw` inputs, and the staff payload carries the
  service's "not for individual employment decisions" caveat as
  `interpretation`; both are surfaced verbatim rather than paraphrased.
- **Patient portal (F11 slices 1–4).** Same GAP-020 family under
  `src/modules/portal`, on all three reads:
  * `GET /portal/me` is typed as unknown and answers `{ patient }` — the
    `toPublicPatient` demographics allowlist (no clinical fields, no `otherNames`/
    `sex`).
  * `GET /portal/me/appointments` is typed as the singular
    `PortalAppointmentResponseDto` while the service returns `pageOf(...)` of
    `toPublicAppointment` rows.
  * `GET /portal/me/lab-results` is typed as the singular
    `PortalLabResultResponseDto` while the service returns `pageOf(...)` of
    `toPublicLabResult` rows (released orders only).

  Each is therefore read with the raw fetch + structural validation path
  (`src/lib/data/portal.ts`, `readPortal*`/`extractPortal*`) and fails closed on
  drift. Both projections are ids only (`departmentId`/`providerId`, `testId`/
  `orderId` — no names, no provider or department lookup in the portal), and the
  lab projection carries values with their reference range rather than a verdict.
  The fourth endpoint, `POST /portal/me/feedback`, *is* typed correctly
  (`SubmitPortalFeedbackDto` → 201 `FeedbackResponseDto`), so it uses the normal
  `api.POST` + `unwrap` path; only the 201 body is re-read structurally.
  Every endpoint is self-scoped: the patient id is derived from the session
  (`resolvePatientScope`, `src/common/auth/patient-scope.ts`), never the URL — so
  the client sends no id and a staff principal with no self-scope is a **403
  `PATIENT_ACCESS_DENIED`**. On feedback the id is stamped server-side, and
  `branchId` is left unset because the portal has no branch picker (GAP-018).
  `/auth/me` gained `roles` and `patientLink`, which is how the client tells a
  patient principal (role **and** link) from staff.
- **Not built:** the audit-log viewing screen is **not buildable**: there is no
  audit-list endpoint (writes happen inside the API via
  `src/database/audit.service.ts`).



