import { useEffect, useState } from 'react';
import { listRecordsForUser } from '../db/records';
import type { LocalRecord } from '../db/db';
import { syncUserQueue } from '../sync/local-sync';
import { useApp } from './provider';

export function SyncScreen() {
  const app = useApp();
  const [rows, setRows] = useState<LocalRecord[]>([]);
  const [message, setMessage] = useState('');

  const reload = async () => {
    if (!app.user) return;
    setRows(await listRecordsForUser(app.db, app.user.id));
  };

  useEffect(() => {
    if (!app.user) return;
    void listRecordsForUser(app.db, app.user.id).then(setRows);
  }, [app.db, app.user]);

  return (
    <section className="stack">
      <h1>Sync</h1>
      <p>Uploads run only while FieldSurvey is open. A record is marked synced only after the server confirms complete ingestion.</p>
      {app.offlineSession ? <p className="banner">Sign in again to upload. Local answers were kept.</p> : null}
      <button
        type="button"
        onClick={() => {
          if (!app.user) return;
          app.setUploading(true);
          setMessage('Uploading');
          void syncUserQueue(app.db, app.backend, app.user.id)
            .then(reload)
            .then(() => setMessage('Sync finished'))
            .catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : 'Sync failed'))
            .finally(() => app.setUploading(false));
        }}
      >
        Upload queued records
      </button>
      <p role="status">{message}</p>
      <ul className="stack">
        {rows.map((row) => (
          <li key={row.id} className="card">
            <strong>{row.definitionSnapshot.title}</strong>
            <span className="status-pill">{row.status === 'synced' ? 'Synced' : row.status}</span>
            {row.lastError ? <p>{row.lastError}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
