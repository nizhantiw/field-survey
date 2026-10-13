# Test plan

Tests are independent. Playwright uses a fresh browser context per test, except P3-01, which creates its own persistent profile and then relaunches that profile in a second process. Integration tests, when credentials exist, create synthetic users and delete them afterward. They refuse a non-local Supabase URL unless `SUPABASE_ALLOW_REMOTE_TEST=1`.

## Commands

| Command | What it runs |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` with `strict` and `noUncheckedIndexedAccess`. |
| `npm run lint` | ESLint, max warnings 0. `no-eval` is an error. |
| `npm test` | Vitest, jsdom, `tests/unit`. |
| `npm run test:integration` | Vitest, Node, `tests/integration`. |
| `npm run test:e2e` | Playwright Chromium. Bare preview on port 4174 (empty Supabase env). Harness preview on port 4173 (`VITE_LOCAL_HARNESS=1`). |
| `npm run check:secrets` | Production bare build with `SUPABASE_SERVICE_ROLE_KEY` set to a canary, then a scan of `dist-bare`. |

Reports and screenshots go in `test-artifacts/`. Do not commit `.env.local` or real keys.

## Layers

- Domain tests cover schema validation, visibility, sync classification, map verification, export escaping, and role rules. They use fake IndexedDB.
- The harness browser build exercises the UI without a Supabase project. It is labeled on screen. It does not satisfy Phase 1 or the live Phase 7 gate.
- `tests/integration/supabase.integration.test.ts` calls the real RPCs, RLS, and Storage when every variable in `.env.example` is set and the migration has been applied. Until then those cases are skipped and listed in `test-artifacts/integration-blocked.json`. A skip is not a pass.
- Network faults in unit tests and in the live transport wrapper are injected at named protocol boundaries (`create_or_recover`, `register_attachments`, `upload_attachment`, `verify_attachments`, `finalize`), before or after the call.
- Physical-device rows in `docs/device-test-matrix.md` stay BLOCKED until a person runs them on the named phones.

## Fixtures

- `fixtures/forms/site-visit.json`, `wildlife-count.json`, and `infrastructure.json` are the three sample surveys.
- `public/map-package/` is a synthetic XYZ package, zoom 2, tiles `2/0/0`, `2/0/1`, `2/1/0`, and `2/1/1`. Attribution says it is not for navigation. `npm run generate:assets` rebuilds it.
