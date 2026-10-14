import { useEffect, useState } from 'react';
import { cacheForm } from '../db/records';
import { FIRST_USE_OFFLINE, isFieldReady } from '../domain/fieldwork/provision';
import { downloadManifestPackage, packageIsReady } from '../fieldwork/download';
import type { MapManifest } from '../domain/maps/manifest';
import { useApp } from './provider';

export function FieldworkScreen() {
  const app = useApp();
  const [formsReady, setFormsReady] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [shellReady, setShellReady] = useState(false);
  const [progress, setProgress] = useState('Not started');
  const [error, setError] = useState('');
  const [manifest, setManifest] = useState<MapManifest | null>(null);

  useEffect(() => {
    void navigator.serviceWorker?.ready.then(() => setShellReady(true)).catch(() => setShellReady(false));
    void (async () => {
      if (!app.user) return;
      const flag = await app.db.meta.get(`provisioned:${app.user.id}`);
      const manifests = await app.backend.listMapManifests('local');
      const first = manifests[0];
      if (first) {
        setManifest(first);
        setMapReady(await packageIsReady(app.db, first));
      }
      const forms = await app.db.forms.where('userId').equals(app.user.id).count();
      setFormsReady(forms > 0 && flag?.value === '1');
    })();
  }, [app.backend, app.db, app.user]);

  const ready = isFieldReady({
    appShellCached: shellReady,
    signedIn: Boolean(app.user),
    formsDownloaded: formsReady,
    mapReady,
    mapRequired: true,
  });

  return (
    <section className="stack">
      <h1>Prepare for fieldwork</h1>
      <p className={ready ? 'banner ok' : 'banner'} role="status">{ready ? 'Ready for offline collection.' : 'Not ready.'}</p>
      <ul>
        <li>Application shell cached: {shellReady ? 'yes' : 'no'}</li>
        <li>Forms downloaded: {formsReady ? 'yes' : 'no'}</li>
        <li>Offline map verified: {mapReady ? 'yes' : 'no'}</li>
      </ul>
      <p role="status">{progress}</p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {!ready ? <p>{FIRST_USE_OFFLINE}</p> : null}
      {manifest ? <p>{manifest.synthetic ? 'Synthetic test area — not real geography.' : manifest.name}</p> : null}
      {manifest ? <p>{manifest.attribution}</p> : null}
      <div className="row">
        <button type="button" onClick={() => void prepare()}>
          Download forms and map
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            window.__FS_FAULTS = { ...window.__FS_FAULTS, cancelDownload: true };
            setProgress('Cancelling');
          }}
        >
          Cancel download
        </button>
      </div>
    </section>
  );

  async function prepare() {
    if (!app.user) return;
    setError('');
    window.__FS_FAULTS = { ...window.__FS_FAULTS, cancelDownload: false };
    try {
      if (navigator.storage?.persist) await navigator.storage.persist();
      const orgs = await app.backend.listOrganizations();
      let count = 0;
      for (const org of orgs) {
        const projects = await app.backend.listProjects(org.id);
        for (const project of projects) {
          const versions = await app.backend.listPublishedVersions(project.id);
          for (const version of versions) {
            await cacheForm(app.db, {
              key: `${app.user.id}:${version.id}`,
              userId: app.user.id,
              formId: version.formId,
              projectId: version.projectId,
              versionId: version.id,
              versionNumber: version.versionNumber,
              title: version.definition.title,
              definition: version.definition,
              downloadedAt: new Date().toISOString(),
            });
            count += 1;
            setProgress(`Downloaded ${count} form versions`);
          }
        }
      }
      setFormsReady(count > 0);
      const manifests = await app.backend.listMapManifests('local');
      const next = manifests[0];
      if (!next) throw new Error('No map package is available');
      setManifest(next);
      const status = await downloadManifestPackage(app.db, next, {
        onProgress: (completed, total) => setProgress(`Map tiles ${completed} of ${total}`),
      });
      const verified = status === 'ready' && (await packageIsReady(app.db, next));
      setMapReady(verified);
      const registration = await navigator.serviceWorker?.ready.catch(() => undefined);
      const shell = Boolean(navigator.serviceWorker?.controller || registration?.active || shellReady);
      if (count > 0 && verified && shell && app.user) {
        await app.db.meta.put({ key: `provisioned:${app.user.id}`, value: '1' });
        setFormsReady(true);
        setProgress('Ready for offline collection.');
      } else {
        await app.db.meta.delete(`provisioned:${app.user.id}`);
        setProgress(status === 'cancelled' ? 'Download cancelled. Not ready.' : 'Not ready.');
      }
    } catch (reason) {
      await app.db.meta.delete(`provisioned:${app.user?.id ?? ''}`);
      setMapReady(false);
      setError(reason instanceof Error ? reason.message : 'Preparation failed');
      setProgress('Not ready.');
    }
  }
}
