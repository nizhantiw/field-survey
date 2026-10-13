import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router';
import { readPublicConfig, setupMessage } from './config/env';
import { applyAppUpdate, onAppUpdate } from './pwa/register';
import { FIRST_USE_OFFLINE } from './domain/fieldwork/provision';
import { mayApplyAppUpdate } from './domain/fieldwork/provision';
import { logoutWarning } from './domain/fieldwork/provision';
import { unsyncedCount } from './db/records';
import { AppProvider, useApp } from './ui/provider';
import { CollectScreen } from './ui/collect-screen';
import { EditorScreen } from './ui/editor-screen';
import { FieldworkScreen } from './ui/fieldwork-screen';
import { MapScreen } from './ui/map-screen';
import { ProjectScreens } from './ui/project-screens';
import { ReviewScreens } from './ui/review-screens';
import { SettingsScreen } from './ui/settings-screen';
import { SyncScreen } from './ui/sync-screen';

export function App() {
  const config = readPublicConfig();
  if (!config.ok) return <SetupScreen missing={config.missing} message={config.message} />;
  return (
    <AppProvider config={config}>
      <Routes>
        <Route path="/login" element={<LoginScreen />} />
        <Route element={<Shell />}>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/orgs/:orgId" element={<ProjectScreens mode="org" />} />
          <Route path="/projects/:projectId" element={<ProjectScreens mode="project" />} />
          <Route path="/projects/:projectId/forms/:formId" element={<EditorScreen />} />
          <Route path="/drafts" element={<DraftsScreen />} />
          <Route path="/drafts/:recordId" element={<CollectScreen />} />
          <Route path="/sync" element={<SyncScreen />} />
          <Route path="/map" element={<MapScreen />} />
          <Route path="/fieldwork" element={<FieldworkScreen />} />
          <Route path="/projects/:projectId/submissions" element={<ReviewScreens mode="list" />} />
          <Route path="/projects/:projectId/submissions/:submissionId" element={<ReviewScreens mode="detail" />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/help" element={<HelpScreen />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppProvider>
  );
}

export function SetupScreen(props: { missing: string[]; message: string }) {
  return (
    <main className="app-shell stack">
      <h1>FieldSurvey needs configuration</h1>
      <p role="alert">{props.message || setupMessage(props.missing)}</p>
      <ul>
        {props.missing.map((name) => (
          <li key={name}>
            <code>{name}</code>
          </li>
        ))}
      </ul>
      <p>{FIRST_USE_OFFLINE}</p>
      <ol>
        <li>Copy .env.example to .env.local.</li>
        <li>Create a Supabase project and apply supabase/migrations.</li>
        <li>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</li>
        <li>Keep SUPABASE_SERVICE_ROLE_KEY out of the browser and out of any VITE_ variable.</li>
        <li>Restart the dev server. The README section Setup has the full checklist.</li>
      </ol>
    </main>
  );
}

function Shell() {
  const app = useApp();
  const navigate = useNavigate();
  const [warning, setWarning] = useState<string | null>(null);
  const [updateWaiting, setUpdateWaiting] = useState(false);

  useEffect(() => onAppUpdate(() => setUpdateWaiting(true)), []);

  if (!app.ready) return <main className="app-shell">Loading FieldSurvey…</main>;
  if (!app.user) return <Navigate to="/login" replace />;
  const updateAllowed = mayApplyAppUpdate({ editing: app.editing, uploading: app.uploading });
  return (
    <>
      <a className="skip" href="#content">
        Skip to content
      </a>
      <div className="app-shell">
        <header className="topbar">
          <Link className="wordmark" to="/">
            FieldSurvey
          </Link>
          <button type="button" className="secondary" onClick={() => void beginLogout()}>
            Sign out
          </button>
        </header>
        {app.config.localHarness ? (
          <p className="banner" role="status">
            Local test harness. Data is not on a Supabase server. Do not use this build for real fieldwork.
          </p>
        ) : null}
        {app.offlineSession || !navigator.onLine ? (
          <p className="banner" role="status">
            Offline session. Uploads wait until you can sign in again. Saved records on this device stay here.
          </p>
        ) : null}
        {updateWaiting ? (
          <p className="banner" role="status">
            An application update is ready.
            <button type="button" disabled={!updateAllowed} onClick={() => applyAppUpdate()}>
              Apply update
            </button>
            {!updateAllowed ? ' The update waits until editing and uploads finish.' : ''}
          </p>
        ) : null}
        {warning ? (
          <div className="card stack" role="dialog" aria-labelledby="logout-title">
            <h2 id="logout-title">Sign out?</h2>
            <p>{warning}</p>
            <div className="row">
              <button type="button" className="secondary" onClick={() => setWarning(null)}>
                Stay signed in
              </button>
              <button type="button" onClick={() => void confirmLogout()}>
                Sign out anyway
              </button>
            </div>
          </div>
        ) : null}
        <main id="content">
          <Outlet />
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Primary">
        <NavLink to="/" end>
          Projects
        </NavLink>
        <NavLink to="/drafts">Drafts</NavLink>
        <NavLink to="/sync">Sync</NavLink>
        <NavLink to="/map">Map</NavLink>
        <NavLink to="/fieldwork">Prepare</NavLink>
      </nav>
    </>
  );

  async function beginLogout() {
    if (!app.user) return;
    const count = await unsyncedCount(app.db, app.user.id);
    const text = logoutWarning(count);
    if (text) setWarning(text);
    else await confirmLogout();
  }

  async function confirmLogout() {
    await app.backend.signOut();
    setWarning(null);
    await app.refresh();
    navigate('/login');
  }
}

function LoginScreen() {
  const app = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  if (!app.ready) return <main className="app-shell">Loading…</main>;
  if (app.user) return <Navigate to="/" replace />;
  return (
    <main className="app-shell stack">
      <h1>Sign in</h1>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setError('');
          void app.backend
            .signIn(email, password)
            .then(() => app.refresh())
            .then(() => navigate('/'))
            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Sign-in failed. Check your email and password.'));
        }}
      >
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit">Sign in</button>
      </form>
      {app.config.localHarness ? (
        <p className="muted">Harness accounts use the shared test password. Example: fieldworker@fieldsurvey.test</p>
      ) : null}
      {!navigator.onLine ? <p>{FIRST_USE_OFFLINE}</p> : null}
    </main>
  );
}

function HomeScreen() {
  const app = useApp();
  const [orgs, setOrgs] = useState<{ id: string; name: string; role: string }[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void app.backend.listOrganizations().then(setOrgs).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load organizations'));
  }, [app.backend]);
  return (
    <section className="stack">
      <h1>Projects</h1>
      <p>
        Signed in as {app.user?.displayName}. <Link to="/help">Installation help</Link> · <Link to="/settings">Settings</Link>
      </p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <ul className="stack">
        {orgs.map((org) => (
          <li key={org.id} className="card">
            <Link to={`/orgs/${org.id}`}>{org.name}</Link>
            <span className="status-pill">{org.role}</span>
          </li>
        ))}
      </ul>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void app.backend.createOrganization(name).then((org) => {
            setName('');
            setOrgs((current) => [...current, org]);
          }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not create the organization'));
        }}
      >
        <label>
          New organization
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit">Create organization</button>
      </form>
    </section>
  );
}

function DraftsScreen() {
  const app = useApp();
  const [rows, setRows] = useState<{ id: string; status: string; title: string }[]>([]);
  useEffect(() => {
    if (!app.user) return;
    void app.db.records
      .where('userId')
      .equals(app.user.id)
      .toArray()
      .then((records) => setRows(records.map((record) => ({ id: record.id, status: record.status, title: record.definitionSnapshot.title }))));
  }, [app.db, app.user]);
  return (
    <section className="stack">
      <h1>Drafts</h1>
      {rows.length === 0 ? <p>No local records for this account.</p> : null}
      <ul className="stack">
        {rows.map((row) => (
          <li key={row.id} className="card">
            <Link to={`/drafts/${row.id}`}>{row.title}</Link> <span className="status-pill">{row.status}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HelpScreen() {
  return (
    <section className="stack">
      <h1>Installation and limits</h1>
      <h2>Add to the home screen</h2>
      <p>On Android Chrome, open the browser menu and choose Install app or Add to Home screen. On iPhone Safari, use Share, then Add to Home Screen. The app must be loaded once online before it can open offline.</p>
      <h2>What this app does not do</h2>
      <ul>
        <li>Browser storage can be wiped by the device. Unsynchronized records are not a backup.</li>
        <li>A new install needs a network connection to sign in and finish Prepare for fieldwork.</li>
        <li>The included offline map is a synthetic test package, not real geographic coverage.</li>
        <li>Synchronization runs in the foreground while the app is open. There is no background upload.</li>
        <li>Signing out keeps unsynchronized work for that account on this device until you explicitly erase it.</li>
      </ul>
    </section>
  );
}
