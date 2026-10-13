import { useEffect, useState } from 'react';
import { RETENTION_POLICY } from '../domain/fieldwork/provision';
import { deleteSyncedRecords, unsyncedCount } from '../db/records';
import { useApp } from './provider';

export function SettingsScreen() {
  const app = useApp();
  const [unsynced, setUnsynced] = useState(0);
  const [estimate, setEstimate] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!app.user) return;
    void unsyncedCount(app.db, app.user.id).then(setUnsynced);
    void navigator.storage?.estimate?.().then((value) => {
      if (value.usage !== undefined && value.quota !== undefined) {
        setEstimate(`${value.usage} bytes used of ${value.quota}`);
      }
    });
  }, [app.db, app.user]);

  return (
    <section className="stack">
      <h1>Settings</h1>
      <p>{RETENTION_POLICY}</p>
      <p>Unsynchronized records: {unsynced}</p>
      <p>{estimate}</p>
      <button
        type="button"
        onClick={() => {
          const user = app.user;
          if (!user) return;
          void deleteSyncedRecords(app.db, user.id).then(async (count) => {
            setMessage(`Removed ${count} synced records. Unsynchronized work was kept.`);
            setUnsynced(await unsyncedCount(app.db, user.id));
          });
        }}
      >
        Delete synced local records
      </button>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          void app.db.tiles.clear().then(() => app.db.packages.clear()).then(() => setMessage('Offline map tiles were removed. Survey records were kept.'));
        }}
      >
        Remove downloaded maps
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
