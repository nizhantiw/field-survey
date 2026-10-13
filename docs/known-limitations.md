# Known limitations

FieldSurvey is not production-ready. The release classification is **RELEASE BLOCKED**.

## Not verified

- Row Level Security, private Storage, and the sync RPCs have not been executed against Postgres. Docker and the Supabase CLI are not available in the environment that produced this build, and no project credentials were supplied.
- No Android device and no iPhone were used. Browser automation does not prove home-screen install, camera permission, or a real GPS fix.
- The offline map is a synthetic four-tile package. It is not geographic coverage and must not be used for navigation.

## Product limits

- Browser storage can be wiped by the device. Unsynchronized records and photos are not a backup.
- A new install has to load once while online, sign in, and finish Prepare for fieldwork before it can collect offline.
- Synchronization runs in the foreground while the app is open. There is no background upload.
- Location is captured only when someone taps Capture location. There is no continuous background GPS.
- The survey format is FieldSurvey JSON schema version 1. It is not an ODK form.
- Conditions cannot run JavaScript. They can only reference earlier questions.
- The app is not for clinical records.
- If `VITE_BASEMAP_URL` is empty, or the tile request fails, coordinates are still saved and the screen says the basemap is unavailable.
- The local test harness (`VITE_LOCAL_HARNESS=1`) is for Playwright. Data stays in the browser. The banner says it is not a Supabase server.
- `window.__FS_FAULTS` can force a failed save, a cancelled map download, or a storage-quota failure. It does nothing unless a test sets it. It cannot grant access to another account.

## Update behavior

An application update is offered when the service worker has a waiting update. Apply stays disabled while a draft is open or an upload is running. The update does not reload the page by itself.
