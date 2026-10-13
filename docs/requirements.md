# Requirements to tests

Status is PASS only when that check ran and succeeded in this workspace. BLOCKED means the required resource was absent, so the check did not run. A Vitest skip is BLOCKED, not PASS.

| ID | Requirement | Test | Status |
| --- | --- | --- | --- |
| P0-01 | Production build succeeds | `npm run build` during `npm run check:secrets` and the Playwright web servers | PASS |
| P0-02 | Typecheck without suppressed errors | `npm run typecheck` | PASS |
| P0-03 | Unit and browser tests execute | `npm test`, `npm run test:e2e` | PASS |
| P0-04 | Missing env shows an actionable setup error | `tests/e2e/bare/config.spec.ts`, `tests/unit/domain.test.tsx` | PASS |
| P0-05 | Service-role secret is absent from the browser bundle | `npm run check:secrets` | PASS |
| P1-01 | Valid sign-in works; invalid sign-in leaks no sensitive detail | Harness e2e for the generic error. Live Auth in `tests/integration/supabase.integration.test.ts` | BLOCKED for real Supabase Auth. Harness invalid-password text passed. |
| P1-02 | Organization A cannot read organization B through the API | Integration test, skipped | BLOCKED |
| P1-03 | Fieldworker cannot publish, manage members, or review | Harness hides Edit. Live RPC test skipped | BLOCKED for the server. UI hiding passed and does not satisfy the gate. |
| P1-04 | Org member without project membership cannot read the project | Integration test, skipped | BLOCKED |
| P1-05 | A user cannot grant themselves a higher role | Integration test, skipped. Role helpers covered in unit tests | BLOCKED for direct API |
| P1-06 | Submission cannot cite another project's form version | Integration test, skipped. SQL trigger exists | BLOCKED |
| P1-07 | Unauthorized clients cannot read attachments or map packages | Integration test, skipped | BLOCKED |
| P1-08 | Failed organization creation leaves no orphan | Integration test calls `test_failing_org_creation`, skipped | BLOCKED |
| P1-09 | Last owner cannot be removed or demoted | Integration test, skipped. SQL trigger text scanned in unit tests | BLOCKED for execution |
| P1-10 | Schema rebuilds from migrations on a clean database | `it.skip` until `supabase db reset` can run | BLOCKED |
| P2-01 | Schema round trip preserves ids, order, choices, rules | `tests/unit/domain.test.tsx` | PASS |
| P2-02 | Invalid forms cannot publish | Unit schema tests | PASS |
| P2-03 | Bad condition references and operands are rejected | Unit schema tests | PASS |
| P2-04 | Version 2 leaves version 1 unchanged | Harness unit test and editor e2e snapshot | PASS in the harness. Database immutability trigger not executed. |
| P2-05 | Concurrent publishes cannot duplicate version numbers | In-process mutex unit test. `pg_advisory_xact_lock` not executed | BLOCKED for the database |
| P2-06 | Preview and collection share visibility and validation | Unit engine test plus editor preview e2e | PASS |
| P2-07 | HTML-like labels render as text | Unit render and editor e2e | PASS |
| P2-08 | Unauthorized direct publish fails on the server | Integration test, skipped | BLOCKED |
| P3-01 | Answers survive reload and a persistent-profile restart | `tests/e2e/harness/workflows.spec.ts` and `tests/e2e/harness/restart-profile.mjs` | PASS in Chromium. Not a phone restart. |
| P3-02 | A newer download does not change an existing draft | `tests/unit/drafts.test.ts` | PASS |
| P3-03 | Missing required visible answers block completion | Unit engine test and fieldworker e2e | PASS |
| P3-04 | Hidden required questions do not block completion | Unit engine test. Wildlife e2e hides the photo when Sign is No | PASS |
| P3-05 | Numeric and text limits at, below, and above the bound | Unit engine test | PASS |
| P3-06 | Photo bytes reopen; blob URLs are not the stored file | `tests/unit/drafts.test.ts` | PASS |
| P3-07 | A storage failure is visible and is not labeled saved | Playwright sets `__FS_FAULTS.failSave` | PASS |
| P3-08 | A record cannot queue without required local attachment bytes | `tests/unit/drafts.test.ts` | PASS |
| P3-09 | Another account does not see local drafts | Unit test and the P3-01 viewer sign-in | PASS |
| P3-10 | A second tab cannot overwrite a fresh lock | `tests/unit/drafts.test.ts` | PASS |
| P4-01 | Production shell opens with the network disabled | Bare Playwright project, `test-artifacts/p4-offline-shell.png` | PASS in Chromium |
| P4-02 | A downloaded survey completes with the network disabled | Harness e2e after Prepare | PASS in Chromium |
| P4-03 | An unprepared offline device explains first use | Bare offline reload | PASS |
| P4-04 | A partial or cancelled download is not ready | Map unit test expects `cancelled` and `verified: false` | PASS |
| P4-05 | Low storage stops the map download and does not delete survey records | `downloadMapPackage` unit test | PASS |
| P4-06 | Collection still works when the browser is offline | P4-02 after the session is already open | PASS for browser offline. A Supabase JWT expiry was not executed. |
| P4-07 | An update does not reload during edit or upload | `mayApplyAppUpdate` unit test. Apply button is disabled in the shell | PASS for the gate function. A second deployed build was not installed. |
| P4-08 | Dexie v2 keeps drafts and attachment bytes | `tests/unit/drafts.test.ts` | PASS |
| P4-09 | Logout warns and keeps unsynced work | P3-01 clicks Sign out anyway. `logoutWarning` unit test | PASS |
| P5-01 | Denied location does not fabricate coordinates | Unit geolocation mock and Playwright `grantPermissions([])` | PASS for the logic test. Not a phone permission sheet. |
| P5-02 | Timeout offers retry and keeps answers | Unit test | PASS for the logic test |
| P5-03 | Accuracy is stored and display precision is reduced | `formatCoordinate` unit test | PASS |
| P5-04 | Manual coordinates are labeled and the device fix is kept | Unit test and Playwright manual latitude/longitude | PASS |
| P5-05 | GeoJSON is longitude, latitude | Export unit test expects `[7.25, 12.5]` | PASS |
| P5-06 | Basemap failure still allows a location | Playwright expects the basemap-unavailable or coordinates-only message, then saves a manual fix | PASS |
| P5-07 | A marker opens the permitted record | Map screen links the selected id. Not covered by an executed browser click | BLOCKED |
| P5-08 | A phone captures a real HTTPS location | Device matrix | BLOCKED |
| P6-01 | Ready requires every tile checksum | Map unit test | PASS for the synthetic package |
| P6-02 | Resume keeps verified tiles | Map unit test | PASS |
| P6-03 | Checksum mismatch blocks ready and replacement can keep the old package | Map unit test | PASS |
| P6-04 | Downloaded coverage renders with the network blocked | Playwright, `test-artifacts/p6-offline-map.png` | PASS for the synthetic package |
| P6-05 | Outside-area and unsupported zoom are explained | Unit messages and the map screen | PASS |
| P6-06 | Quota failure leaves survey records | Unit test | PASS |
| P6-07 | Attribution remains visible offline | Playwright after `setOffline` | PASS |
| P6-08 | Failed replacement does not destroy the previous package | `activateReplacement` unit test | PASS |
| P6-09 | Cancel leaves a resumable, not-ready state | Unit abort test | PASS |
| P6-real | Licensed real-world offline coverage | No licensed package is bundled | BLOCKED |
| P7-01 | One record and its files become one complete submission | Live integration, skipped. Memory server unit test passed | BLOCKED for the database |
| P7-02 | Duplicate attempts do not duplicate rows | Same split | BLOCKED for the database |
| P7-03 | Same id and different hash is a visible conflict | Same split | BLOCKED for the database |
| P7-04 | Lost response after create can be recovered | InjectingTransport unit test. Live test skipped | BLOCKED for the database |
| P7-05 | Partial attachment upload can resume | Unit transport. Live test skipped | BLOCKED for Storage |
| P7-06 | Lost finalize does not create a second row | Unit transport. Live test skipped | BLOCKED for the database |
| P7-07 | Server refuses completion when an attachment is missing | Unit transport. Live test skipped | BLOCKED for the database |
| P7-08 | Expired auth keeps local work | Unit transport. Live test skipped | BLOCKED for Auth |
| P7-09 | Revoked membership keeps local work | Unit transport. Live test skipped | BLOCKED for RLS |
| P7-10 | Temporary failures retry; permanent ones stop | `classifyStatus` / `shouldRetry` unit test | PASS for classification. Live 5xx injection was not run. |
| P7-11 | Two workers cannot duplicate a row | Live test skipped. No two-tab browser test | BLOCKED |
| P7-12 | Closing during upload recovers the queue | Dexie keeps queued rows. Live reopen test skipped | BLOCKED for a server round trip |
| P7-13 | Unreachable server is handled while the browser says online | Unit TypeError injection | PASS for the client classifier. Live socket failure not run. |
| P7-14 | Uploaded records remain until cleanup | Settings copy and `deleteSyncedRecords` only deletes `synced`. No live retention test | BLOCKED for server retention |
| P8-01 | Pending ingestion is not a completed result | Unit filter and review e2e | PASS in the harness |
| P8-02 | Only permitted roles change review | Integration test, skipped. Fieldworker UI says review is unavailable | BLOCKED for the API |
| P8-03 | Review does not change answers | `reviewPatch` unit test returns only `review_status`. Live row compare skipped | BLOCKED for the database |
| P8-04 | Export and direct reads enforce project access | Integration test, skipped | BLOCKED |
| P8-05 | CSV, JSON, and GeoJSON represent choices, nulls, time, location, and version | Unit export test | PASS |
| P8-06 | Formula-leading CSV cells are quoted and prefixed | Unit test and review e2e. The preview contains an apostrophe before `=cmd` | PASS |
| P8-07 | Unauthorized file access fails; expired signed URLs are refused | Integration test, skipped | BLOCKED |
| P8-08 | Table and map use the same complete-ingestion filter | `applySubmissionFilter` on the review list and the map query | PASS in the harness |
| P9-01 | Full phone expedition | Device matrix | BLOCKED |
| P9-02 | Phone restart | Device matrix | BLOCKED |
| P9-03 | Phone permission recovery | Device matrix | BLOCKED |
| P9-04 | No overflow at the target widths; phone keyboard usable | Playwright widths passed. Virtual keyboard BLOCKED | PARTIAL. Width check PASS. Phone keyboard BLOCKED |
| P9-05 | Accessibility on device and in automation | axe on sign-in passed. Screen reader BLOCKED | PARTIAL |
| P9-06 | Deployed update preserves local work | Not deployed | BLOCKED |
| P9-07 | Full regression of every earlier mandatory test | Client commands passed. Live and device rows did not | BLOCKED |
| P9-08 | Limitations are documented | This file, `docs/known-limitations.md`, in-app Help | PASS |
