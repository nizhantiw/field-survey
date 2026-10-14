Build **FieldSurvey**, a mobile-first TypeScript PWA for creating surveys, collecting GPS-tagged records and photos offline, downloading maps, and synchronizing data with Supabase.

The app has no AI features.

Implement the project in the phases below. Each phase ends with a mandatory verification gate.

## A. Technical scope

Use:

- React, Vite, and strict TypeScript.
- Accessible responsive UI.
- Supabase Auth, PostgreSQL, and private Storage.
- Dexie and IndexedDB for offline records, attachments, and map tiles.
- A service worker for offline application loading.
- Leaflet for maps.
- Zod for runtime validation.
- Vitest for domain tests.
- Playwright for browser workflows.
- Local Supabase or a dedicated test project for integration tests.

Support:

- Organizations and projects.
- Roles: owner, admin, researcher, fieldworker, viewer.
- Project membership.
- Visual form creation and immutable published versions.
- Text, numbers, choices, dates, booleans, GPS, photos, and sections.
- Required fields, validation, and conditional visibility.
- Offline drafts and completed records.
- Explicit synchronization with retries and duplicate prevention.
- Predefined downloadable offline map areas.
- Submission review and exports.

Do not implement full ODK compatibility, continuous background GPS, clinical records, or arbitrary JavaScript expressions in forms.

Use our own versioned JSON survey format.

## B. Non-negotiable phase-gate rules

1. Implement only the current phase and prerequisites necessary for it.
2. Convert every acceptance requirement into a named test or documented manual check.
3. Run the current phase's tests and relevant regression tests.
4. Fix failures and rerun affected tests.
5. Do not weaken assertions, disable checks, or remove requirements merely to make tests pass.
6. Skipped, unexecuted, flaky, or mocked-only integration tests do not satisfy the gate.
7. Missing credentials, unavailable devices, and external resources must be marked BLOCKED.
8. A phase passes only when all mandatory requirements have verified evidence.
9. Never report a test as passed unless it actually ran successfully.
10. Never claim browser automation proves physical-device behavior.
11. Never perform destructive testing against production or real users' records.
12. Continue automatically after an objectively satisfied gate. Do not request routine approval between phases.
13. If a mandatory check requires unavailable resources, stop dependent work and report the exact missing resource. Continue independent fixes within the current phase.
14. Keep incomplete functionality visibly unavailable; do not present mock screens as working features.

At every phase gate, report:

- Implemented functionality.
- Test IDs and PASS/FAIL/BLOCKED status.
- Commands or manual procedures executed.
- Evidence locations.
- Remaining defects.
- Gate decision: PASS or BLOCKED.

A passing gate requires zero known defects that compromise access control, record preservation, submission correctness, or the required workflow.

## C. Test and evidence structure

Create:

- `docs/requirements.md`
- `docs/test-plan.md`
- `docs/phase-gates.md`
- `docs/known-limitations.md`
- `docs/device-test-matrix.md`

Maintain a requirements-to-tests mapping.

Store test reports and screenshots in a dedicated test-artifacts directory. Do not commit secrets or personal data.

Use synthetic data and isolated test accounts.

Do not depend on test execution order. Reset test fixtures safely between runs.

Use fixed seeds where randomized fixtures are useful.

For network-failure tests, inject failures at explicit boundaries rather than depending on timing guesses.

---

## Phase 0 — Define the architecture and test harness

### Implement

- Inspect repository instructions and existing work.
- Initialize the application if needed.
- Set up strict TypeScript, linting, build, unit tests, and browser tests.
- Establish a production-build preview for PWA tests.
- Define survey schema, local storage model, and sync state machine.
- Document supported browser and device targets.

Define the local sync states:

- draft
- queued
- uploading
- synced
- failed
- blocked

Define server ingestion states:

- pending
- complete

Separate ingestion status from researcher review status.

### Mandatory tests

**P0-01 — Build**
A clean installation produces a successful production build.

**P0-02 — Type safety**
Type checking passes without suppressing meaningful errors.

**P0-03 — Test execution**
Unit and browser tests execute against the intended environment.

**P0-04 — Configuration**
Missing required environment variables produce an actionable setup error.

**P0-05 — Secret handling**
No privileged database credential or server secret appears in browser assets.

### Gate

Build, type checking, linting, and the test harness pass. Architecture decisions and unsupported features are documented.

---

## Phase 1 — Database, authentication, and authorization

### Implement

Create migrations for:

- profiles
- organizations
- organization_members
- projects
- project_members
- forms
- form_versions
- submissions
- submission_attachments
- map_packages
- audit_events

Use UUIDs, foreign keys, appropriate indexes, timestamps, and constraints.

Published form versions must be immutable.

Submissions retain:

- Device-generated ID.
- Form version.
- Collector identity.
- Answers.
- Location and accuracy.
- Client capture timestamp.
- Server receipt timestamp.
- Payload hash.
- Ingestion and review status.

Enable row-level security on all exposed tables.

Use private storage buckets.

Organization creation must atomically create the owner membership.

Prevent role escalation and removal of the last owner.

### Mandatory tests

**P1-01 — Authentication**
Valid credentials sign in; invalid credentials fail without exposing sensitive details.

**P1-02 — Tenant isolation**
Users in Organization A cannot read or modify Organization B's records through direct API requests.

**P1-03 — Role boundaries**
Fieldworkers cannot publish forms, manage membership, or change review status.

**P1-04 — Project access**
An organization member without project access cannot retrieve restricted project resources.

**P1-05 — Escalation prevention**
A user cannot grant themselves a higher role by directly updating membership.

**P1-06 — Integrity**
A submission cannot reference a form version belonging to another project.

**P1-07 — Private files**
Unauthorized requests cannot retrieve attachments or map packages.

**P1-08 — Atomic organization creation**
A failed creation operation leaves neither an orphan organization nor partial membership.

**P1-09 — Last owner**
Attempts to remove or demote the final owner fail.

**P1-10 — Clean migration**
The schema can be recreated from migrations in a clean test environment.

### Gate

Run authorization tests against real Supabase policies using separate authenticated accounts. UI hiding and mocked responses do not satisfy this gate.

---

## Phase 2 — Form creation and publishing

### Implement

Build a visual form editor with:

- Question creation, editing, duplication, deletion, and ordering.
- Stable question and option IDs.
- Validation settings.
- Conditional visibility.
- Mobile preview.
- Draft saving.
- Immutable version publishing.

Use a declarative condition model. Do not use `eval`.

For the initial version, allow conditions to reference earlier questions only.

### Mandatory tests

**P2-01 — Schema round trip**
Saving and reopening a form preserves question IDs, order, choices, and rules.

**P2-02 — Invalid forms**
Duplicate IDs, invalid bounds, missing choice options, and unsupported question types cannot publish.

**P2-03 — Conditions**
Missing references and invalid condition operands are rejected.

**P2-04 — Version preservation**
Publishing version 2 leaves version 1 unchanged.

**P2-05 — Concurrent publishing**
Concurrent publish requests cannot create duplicate version numbers or inconsistent current-version references.

**P2-06 — Preview parity**
Preview and collection use the same validation and visibility logic.

**P2-07 — Untrusted text**
Labels containing HTML or script-like content display safely.

**P2-08 — Role enforcement**
Unauthorized direct publish requests fail server-side.

### Gate

Create, publish, and reopen three sample surveys. Their schemas and version history remain correct.

---

## Phase 3 — Form filling and durable local drafts

### Implement

- Download published forms.
- Render forms entirely from local definitions.
- Save drafts automatically.
- Resume drafts.
- Validate before completion.
- Store attachment blobs locally.
- Queue completed records.
- Pin each record to its original form version.

Save states must reflect completed local writes.

Hidden questions must not block completion. Define and test whether hidden answers are excluded from the final payload.

### Mandatory tests

**P3-01 — Persistence**
Answers survive page reload and browser-context restart using the same persistent profile.

**P3-02 — Version pinning**
Downloading a newer form does not alter an existing draft.

**P3-03 — Required fields**
Missing required visible answers prevent completion.

**P3-04 — Conditional fields**
Hidden required questions do not prevent completion.

**P3-05 — Boundaries**
Numeric and text limits behave correctly at, below, and above their boundaries.

**P3-06 — Attachment persistence**
Photo bytes remain readable after reopening; temporary preview URLs are not treated as stored files.

**P3-07 — Failed save**
A storage failure produces a visible error and no false "Saved" status.

**P3-08 — Atomic completion**
A record cannot become queued with missing required local attachments.

**P3-09 — Account isolation**
Switching accounts does not reveal another account's local drafts.

**P3-10 — Concurrent editing**
Two tabs cannot silently overwrite the same draft. Implement a lock or explicit conflict handling.

### Gate

A completed local record has valid answers, a fixed form version, and readable required attachments.

---

## Phase 4 — PWA provisioning and offline operation

### Implement

- Manifest and icons.
- Service-worker application-shell caching.
- "Prepare for fieldwork" screen.
- Download progress and readiness checks.
- Storage estimation and persistence requests where supported.
- Safe application-update flow.
- Clear first-use and offline-login limitations.

Do not cache authenticated API responses indiscriminately.

Do not delete unsynchronized records to free space.

### Mandatory tests

**P4-01 — Offline launch**
After online provisioning, the production application opens with network access disabled.

**P4-02 — Offline collection**
A downloaded survey can be completed without server access.

**P4-03 — First-use limitation**
An unprepared device receives a clear explanation when offline.

**P4-04 — Interrupted provisioning**
A partial download is not labeled ready.

**P4-05 — Storage pressure**
Insufficient space stops provisioning safely without deleting existing records.

**P4-06 — Offline session**
Previously provisioned local collection works when token refresh is unavailable.

**P4-07 — Update safety**
An available app update does not force reload during editing or upload.

**P4-08 — Local migration**
Updating the local database preserves existing drafts and attachments.

**P4-09 — Logout safety**
Logout warns about unsynchronized work and follows the documented retention policy.

### Gate

Verify against a production build. Clearly distinguish automated browser restart checks from later physical-phone checks.

---

## Phase 5 — GPS and online map behavior

### Implement

- Explicit location capture action.
- Latitude, longitude, accuracy, timestamp, and source.
- Retry and timeout controls.
- Manual location adjustment where permitted.
- Preservation of original device readings.
- Online map and observation markers.
- Coordinates-only fallback.

### Mandatory tests

**P5-01 — Permission denial**
Denied location permission does not crash the survey or fabricate coordinates.

**P5-02 — Timeout**
A location timeout gives a retry action and preserves answers.

**P5-03 — Accuracy**
Reported accuracy is stored and displayed without implying greater precision.

**P5-04 — Manual adjustment**
Adjusted coordinates are labeled manual; original device coordinates remain available.

**P5-05 — Coordinate correctness**
Latitude/longitude and GeoJSON longitude/latitude ordering are handled correctly.

**P5-06 — Map failure**
Failed basemap loading does not prevent saving a location record.

**P5-07 — Marker details**
Selecting an observation opens the correct permitted record.

**P5-08 — Physical location**
A supported phone captures an actual location over HTTPS.

### Gate

Mocked coordinates satisfy logic tests only. Actual permission and device capture require a physical-device check.

---

## Phase 6 — Downloadable offline maps

### Implement

Start with one small predefined raster XYZ map package.

Use a source that permits offline distribution. Do not bulk-download public OpenStreetMap tiles.

Package manifests include:

- ID and version.
- Bounds.
- Zoom range.
- Tile list.
- File sizes and checksums.
- Attribution.
- License reference.

Store tiles locally and use a local tile adapter.

Support resumable downloads, cancellation, bounded concurrency, and verification.

### Mandatory tests

**P6-01 — Completeness**
Ready status requires all expected tiles to exist and pass verification.

**P6-02 — Interrupted download**
Resumption retains verified tiles and retrieves missing tiles.

**P6-03 — Corruption**
A checksum mismatch prevents readiness and supports replacement.

**P6-04 — Fully offline rendering**
Downloaded coverage renders with all network requests blocked.

**P6-05 — Coverage boundary**
Outside-area and unsupported-zoom states are understandable.

**P6-06 — Quota failure**
A map download failure leaves survey records intact.

**P6-07 — Attribution**
Required attribution remains visible offline.

**P6-08 — Version update**
A failed replacement package does not destroy a working older package.

**P6-09 — Cancellation**
Canceling a download produces an accurate resumable state.

### Gate

Inspect the rendered offline map and network logs. Seeing a map previously loaded online is insufficient evidence.

If licensed real map data is unavailable, use a clearly labeled synthetic package for implementation testing. Real geographic offline-map readiness remains blocked.

---

## Phase 7 — Reliable synchronization

### Implement

Use durable local jobs and device-generated UUIDs.

Protocol:

1. Validate local record.
2. Create or recover a pending server submission.
3. Register expected attachments.
4. Upload attachments.
5. Verify required files.
6. Finalize the server submission.
7. Mark local record synced only after confirmation.

Implement authenticated server endpoints or RPCs with server-side validation.

Use idempotency, payload hashes, bounded retries, backoff, and cross-tab locking.

Do not modify completed answers silently.

### Mandatory tests

**P7-01 — Successful upload**
One record and its attachments produce one complete server submission.

**P7-02 — Duplicate attempts**
Repeated identical requests produce no duplicate submissions.

**P7-03 — Conflicting payload**
The same ID with different content produces a visible conflict.

**P7-04 — Metadata interruption**
A lost response after metadata creation can be recovered.

**P7-05 — Attachment interruption**
Partial attachment upload resumes or retries safely.

**P7-06 — Finalization interruption**
A lost finalization response does not create a second record or leave the client permanently uncertain.

**P7-07 — Missing attachment**
The server refuses completion when an expected attachment is absent or invalid.

**P7-08 — Expired authentication**
Local work remains intact while reauthentication is requested.

**P7-09 — Revoked membership**
Upload is rejected securely and local work remains recoverable.

**P7-10 — Retry classification**
Temporary failures retry; permanent validation failures do not retry endlessly.

**P7-11 — Multiple tabs**
Concurrent workers cannot corrupt or duplicate a submission.

**P7-12 — App closure**
Closing during upload and reopening recovers the durable queue.

**P7-13 — False connectivity**
An unreachable server is handled even when the browser reports online.

**P7-14 — Local retention**
Successfully uploaded records remain available until explicit cleanup.

### Gate

Run against actual database and storage integrations. Inject failures at every protocol boundary.

No record may display "Uploaded" before server confirmation of complete ingestion.

---

## Phase 8 — Dashboard, review, and exports

### Implement

- Submission list and detail.
- Map view.
- Filters.
- Review status.
- CSV, JSON, and GeoJSON exports.
- Authorized attachment access.

### Mandatory tests

**P8-01 — Ingestion visibility**
Pending incomplete records do not appear as completed results.

**P8-02 — Review permissions**
Only permitted roles can change review status.

**P8-03 — Answer integrity**
Review does not modify collected answers.

**P8-04 — Export permissions**
Direct export requests enforce organization and project access.

**P8-05 — Export correctness**
Choices, missing values, timestamps, locations, and form versions are represented consistently.

**P8-06 — Spreadsheet safety**
CSV values beginning with formula-triggering characters are escaped safely.

**P8-07 — Attachment security**
Unauthorized file access fails; expired signed links are handled.

**P8-08 — Filtering**
Table and map filters produce matching record sets.

### Gate

Compare exported files against known fixtures and inspect the dashboard using multiple roles.

---

## Phase 9 — Mobile pilot and release gate

### Implement

- Deployment instructions.
- Backup and recovery guidance.
- Known-limitations documentation.
- Storage cleanup controls.
- Installation help.
- Final accessibility and responsive fixes.

### Mandatory physical-device checks

Test Android Chrome and iPhone Safari/Home Screen mode if both are advertised as supported.

**P9-01 — Full expedition workflow**

1. Sign in online.
2. Download form and map.
3. Enable airplane mode.
4. Reopen the app.
5. Capture a location and photo.
6. Save a draft.
7. Close and reopen.
8. Complete the record.
9. Restore connectivity.
10. Upload.
11. Confirm exactly one complete server record.
12. View and export it.

**P9-02 — Phone restart**
Unsynchronized records and photos survive a restart on each tested device.

**P9-03 — Permission behavior**
Camera and location denial and later recovery behave correctly.

**P9-04 — Responsive interface**
No unusable controls or horizontal overflow at 320, 360, 390, 430, and 768 px widths. Test virtual-keyboard behavior on phones.

**P9-05 — Accessibility**
Keyboard navigation, labels, focus states, contrast, and status announcements work.

**P9-06 — Update with local work**
A deployed update preserves unsynchronized records.

**P9-07 — Full regression**
All earlier mandatory automated tests pass on the release candidate.

**P9-08 — Honest limitations**
Documentation explains browser-storage loss risks, initial online provisioning, offline map coverage, and foreground synchronization requirements.

### Final gate

Classify the outcome accurately:

- DEVELOPMENT COMPLETE: automated implementation gates passed.
- PILOT VERIFIED: required physical-device checks also passed.
- RELEASE BLOCKED: any mandatory requirement remains failed or unverified.

Do not describe the app as production-ready solely because a desktop browser demonstration works.

## D. Final handover

Deliver:

- Source code.
- SQL migrations and RLS policies.
- Generated database types.
- Survey schema and sample forms.
- Offline map manifest and test package.
- Test fixtures and reports.
- Phase-gate evidence.
- Setup and deployment instructions.
- Device compatibility matrix.
- Known limitations.
- Remaining operational responsibilities and external costs.

Begin with Phase 0. Work through the phases in order, advancing only when the current gate passes.