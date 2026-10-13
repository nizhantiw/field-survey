# FieldSurvey

FieldSurvey is a mobile-first offline PWA for creating surveys, collecting GPS-tagged records and photos, downloading a map package, and synchronizing with Supabase. It has no AI features and does not implement ODK, background GPS, or clinical records.

**Release status: RELEASE BLOCKED.** Automated browser and domain checks passed for the client. Live Row Level Security, private storage, and physical-device checks have not been executed. Do not treat a desktop demonstration as production verification. See `docs/phase-gates.md`.

## Setup

You need Node.js 22 or newer. A Supabase project is required before sign-in works. This repository does not contain a project URL, anon key, or service-role key.

1. Install dependencies: `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Create a Supabase project (hosted or local). Install Docker and the [Supabase CLI](https://supabase.com/docs/guides/cli) if you want a local stack. From this directory run `supabase init` only if `supabase/config.toml` is missing, and do not let it replace `supabase/migrations`.
4. Apply `supabase/migrations/20261013000000_init.sql` with `supabase db push` or the SQL editor on a dedicated project. Do not run it against a database that already holds unrelated data.
5. Put the project URL in `VITE_SUPABASE_URL` and the anon key in `VITE_SUPABASE_ANON_KEY`.
6. Leave `SUPABASE_SERVICE_ROLE_KEY` unset in the browser. Set it only in the shell that runs integration tests.
7. Start the app: `npm run dev`.

If either public variable is empty, the app shows **FieldSurvey needs configuration** and lists the missing names. It does not open a fake signed-in workspace.

### Credentials you must supply

| Variable | Where it is used |
| --- | --- |
| `VITE_SUPABASE_URL` | Browser. Project URL, for example `https://YOUR_PROJECT.supabase.co` or `http://127.0.0.1:54321`. |
| `VITE_SUPABASE_ANON_KEY` | Browser. The anon/publishable key. Safe to ship only because RLS is enabled. |
| `SUPABASE_SERVICE_ROLE_KEY` | Integration tests and server scripts only. Bypasses RLS. Never prefix it with `VITE_`. |
| `TEST_USER_OWNER_EMAIL` / `TEST_USER_OWNER_PASSWORD` | Integration tests. |
| `TEST_USER_ADMIN_EMAIL` / `TEST_USER_ADMIN_PASSWORD` | Integration tests. |
| `TEST_USER_RESEARCHER_EMAIL` / `TEST_USER_RESEARCHER_PASSWORD` | Integration tests. |
| `TEST_USER_FIELDWORKER_EMAIL` / `TEST_USER_FIELDWORKER_PASSWORD` | Integration tests. |
| `TEST_USER_VIEWER_EMAIL` / `TEST_USER_VIEWER_PASSWORD` | Integration tests. |
| `TEST_USER_OUTSIDER_EMAIL` / `TEST_USER_OUTSIDER_PASSWORD` | Integration tests. A second organization. |
| `SUPABASE_ALLOW_REMOTE_TEST` | Set to `1` only for a disposable remote test project. The suite refuses other remote hosts. |
| `VITE_BASEMAP_URL` / `VITE_BASEMAP_ATTRIBUTION` | Optional. Leave blank for coordinates-only collection. |

Create the test users in that project, or let `npm run test:integration` create them with the service role once the variables are set. Use synthetic accounts, not real people.

`VITE_LOCAL_HARNESS=1` is a browser-only stand-in used by Playwright. It stores data in `localStorage` and shows a banner. Never deploy a harness build.

## Scripts

- `npm run dev` — Vite dev server.
- `npm run build` — production build in `dist/`.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — ESLint.
- `npm test` — Vitest domain and draft tests.
- `npm run test:integration` — live Supabase checks. Without credentials it writes `test-artifacts/integration-blocked.json` and does not count those checks as passed.
- `npm run test:e2e` — Playwright against production previews.
- `npm run check:secrets` — builds with a service-role canary and fails if that value appears in `dist-bare`.
- `npm run verify` — lint, typecheck, unit tests, integration availability, and the secret scan.
- `npm run generate:assets` — regenerates icons and the synthetic map tiles.

## Deployment

Build with the public Supabase variables present at build time (`npm run build`). Host the `dist/` directory on HTTPS. The host must serve `index.html` for client-side routes. Service workers and GPS both require HTTPS.

Do not cache `*.supabase.co` responses in the service worker. The generated worker uses `NetworkOnly` for that host. Map package files under `map-package/` are not precached; the app stores verified tiles in IndexedDB.

## Backup and recovery

Supabase project backups are the server backup. Unsynchronized records live only in that browser's IndexedDB. Clearing site data, uninstalling the PWA, or the browser evicting storage deletes them. Logout keeps unsynchronized records and warns before sign-out. Settings can delete synced records and downloaded map tiles. It does not delete queued or failed records.

To recover a server: restore the Supabase database and the private `attachments` and `map-packages` buckets, then redeploy the static build. Devices that still hold queued records can upload again; identical payload hashes are recovered, and a different payload for the same id is a conflict.

## Architecture

- React, Vite, and strict TypeScript render the UI.
- Zod validates the versioned JSON survey document. Conditions are declarative and may reference only earlier questions. There is no `eval`.
- Dexie stores drafts, photo bytes, and map tiles. Local sync states are `draft`, `queued`, `uploading`, `synced`, `failed`, and `blocked`.
- Server ingestion is `pending` or `complete`. Review status is separate: `unreviewed`, `accepted`, `rejected`, `needs_followup`. A record is synced only after the server confirms `complete`.
- Leaflet draws the optional online basemap and the downloaded synthetic package.
- Supabase Auth, Postgres RLS, and private Storage are the multi-user backend. SQL lives in `supabase/migrations`. Hand-maintained row types live in `src/supabase/database.types.ts` because the CLI was not available to generate them.
- Roles, highest first: owner, admin, researcher, fieldworker, viewer. Project resources require project membership. Organization membership alone is not enough, except where an owner or admin is managing the organization.

## Tests

Evidence is in `docs/phase-gates.md`, `docs/requirements.md`, and `test-artifacts/`. Physical phone checks are not done.
