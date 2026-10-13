# Phase gates

Classification: **RELEASE BLOCKED**.

Client checks that ran are listed as PASS. Anything that needs a Supabase database, private Storage, the Supabase CLI, or a physical phone is BLOCKED. Skipped Vitest cases are not passes. The harness banner is a test double, not a working server.

Commands run in this workspace:

- `npx tsc --noEmit`
- `npx eslint . --max-warnings 0`
- `npx vitest run` — 30 passed (`tests/unit/domain.test.tsx`, `tests/unit/drafts.test.ts`)
- `npx vitest run --config vitest.integration.config.ts` — 1 passed, 20 skipped. The passing test only writes `test-artifacts/integration-blocked.json`.
- `npx playwright test` — 13 passed. JSON report: `test-artifacts/playwright.json`.
- `npm run check:secrets` — scanned 23 bare-build files; the service-role canary was not in the bundle.

## Phase 0 — Architecture and harness

Implemented: Vite + React + strict TypeScript, ESLint, Vitest, Playwright production previews, PWA shell, survey schema, Dexie model, sync states (`draft`, `queued`, `uploading`, `synced`, `failed`, `blocked`) separate from ingestion (`pending`, `complete`) and review status. Setup screen when `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing.

| ID | Status | Evidence |
| --- | --- | --- |
| P0-01 | PASS | Bare and e2e production builds completed inside Playwright and `check:secrets`. |
| P0-02 | PASS | `tsc --noEmit` |
| P0-03 | PASS | Vitest and Playwright both executed. |
| P0-04 | PASS | Bare preview heading "FieldSurvey needs configuration". |
| P0-05 | PASS | Secret scan log above. |

Defects: none in this phase.

**Gate: PASS**

## Phase 1 — Database, auth, authorization

Implemented: `supabase/migrations/20261013000000_init.sql` (tables, RLS, private buckets, immutability, last-owner trigger, atomic organization function, sync RPCs). `src/supabase/database.types.ts` is hand-written because `supabase gen types` could not run. The app calls those RPCs when real credentials exist. Without them the setup screen stays up.

| ID | Status |
| --- | --- |
| P1-01 through P1-10 | BLOCKED |

A static unit scan confirms the migration text enables RLS, contains the immutability and last-owner wording, and does not embed a service-role key. That scan does not execute policies.

Missing resource: Supabase project URL, anon key, service-role key, six test accounts, Docker, and the Supabase CLI.

**Gate: BLOCKED**

## Phase 2 — Form creation and publishing

Implemented: editor (add, edit, duplicate, delete, reorder), stable ids, declarative conditions, mobile preview, draft save, immutable version list. Three fixtures: site visit, wildlife count, infrastructure. Harness publish keeps version 1 readable after version 2.

| ID | Status |
| --- | --- |
| P2-01, P2-02, P2-03, P2-04, P2-06, P2-07 | PASS |
| P2-05 | BLOCKED. The harness mutex is in-process. `pg_advisory_xact_lock` was not executed. |
| P2-08 | BLOCKED. Direct server publish was not attempted. |

**Gate: BLOCKED**

## Phase 3 — Local drafts

Implemented: autosave after a successful IndexedDB write, version pin, validation, ArrayBuffer photos, cross-tab lock, per-user queries. Hidden answers stay on the draft and are omitted from the completed payload.

| ID | Status |
| --- | --- |
| P3-01 | PASS. Reload plus a second Chromium process on the same profile. |
| P3-02 through P3-10 | PASS. See `docs/requirements.md`. |

**Gate: PASS** for the automated browser and IndexedDB checks. Phone restart remains P9-02.

## Phase 4 — PWA and offline shell

Implemented: manifest, icons, precache with `clientsClaim`, Prepare for fieldwork, storage estimate, update prompt that waits out editing and uploads, first-use copy. Supabase hosts are `NetworkOnly`. Map tiles are not precached.

| ID | Status |
| --- | --- |
| P4-01 | PASS. `test-artifacts/p4-offline-shell.png` |
| P4-02 | PASS. Wildlife count completed after `context.setOffline(true)`. |
| P4-03 through P4-09 | PASS for the automated checks named in `docs/requirements.md`. |

**Gate: PASS** for the automated production-build browser checks. This is not a phone install.

## Phase 5 — GPS and online map

Implemented: explicit capture, accuracy, timeout, manual adjustment that keeps the original device fix, coordinates-only fallback, GeoJSON order `[longitude, latitude]`.

| ID | Status |
| --- | --- |
| P5-01 through P5-06 | PASS as logic or Chromium tests. They use a mocked or denied geolocation API. |
| P5-07 | BLOCKED. No executed browser assertion that a marker click opens the matching submission. |
| P5-08 | BLOCKED. No physical device. |

**Gate: BLOCKED**

## Phase 6 — Offline map package

Implemented: synthetic package `public/map-package` (id `synthetic-field-001`, zoom 2, four tiles, checksums, CC0 attribution). Download, resume, cancel, quota, and replacement behavior. Leaflet reads tile bytes from IndexedDB.

| ID | Status |
| --- | --- |
| P6-01 through P6-09 | PASS for the synthetic package. Screenshot: `test-artifacts/p6-offline-map.png`. Offline reload issued no `basemap.invalid` or `/map-package/` requests. |
| Real geographic coverage | BLOCKED. No licensed raster set is included. |

**Gate: BLOCKED** for real-world offline map readiness. Synthetic implementation tests passed.

## Phase 7 — Synchronization

Implemented: client protocol in `src/domain/sync/protocol.ts`, durable local status, idempotent RPCs in the migration, retry classes, cross-tab `navigator.locks` when the browser provides it. The UI says a record is synced only after confirmation.

| ID | Status |
| --- | --- |
| P7-01 through P7-09, P7-11, P7-12, P7-14 | BLOCKED against Postgres and Storage. Unit tests against `MemorySyncServer` passed and are not the gate. |
| P7-10, P7-13 | PASS for client classification only. |

The live scenarios are written in `tests/integration/supabase.integration.test.ts` and skip until credentials and a migrated database exist.

**Gate: BLOCKED**

## Phase 8 — Review and export

Implemented: submission list defaults to ingestion `complete`, pending rows labeled as not a completed result, review patch limited to `review_status`, CSV formula escaping, JSON and GeoJSON.

| ID | Status |
| --- | --- |
| P8-01, P8-05, P8-06, P8-08 | PASS in unit tests and the harness UI. |
| P8-02, P8-03, P8-04, P8-07 | BLOCKED for direct API and signed URL checks. |

**Gate: BLOCKED**

## Phase 9 — Pilot and release

Implemented: README setup and deployment, backup notes, limitations, cleanup controls, install help, responsive layout, axe check on sign-in.

| ID | Status |
| --- | --- |
| P9-01, P9-02, P9-03, P9-06 | BLOCKED. No device and no deployed update. |
| P9-04 | PASS for horizontal overflow in Chromium at 320, 360, 390, 430, and 768 px. BLOCKED for a phone virtual keyboard. |
| P9-05 | PASS for axe serious/critical on the sign-in page. BLOCKED for a device screen reader. |
| P9-07 | BLOCKED. Earlier mandatory server tests did not run. |
| P9-08 | PASS. `docs/known-limitations.md` and the in-app Help page. |

**Gate: BLOCKED**

## Outcome

RELEASE BLOCKED. Not DEVELOPMENT COMPLETE, because the Phase 1 database gate did not pass. Not PILOT VERIFIED, because no physical device was tested.
