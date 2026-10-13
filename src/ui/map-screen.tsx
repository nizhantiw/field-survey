import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import L from 'leaflet';
import { coverageMessage } from '../domain/maps/download';
import type { MapManifest } from '../domain/maps/manifest';
import { isLocation } from '../domain/survey/engine';
import { applySubmissionFilter, type ExportRecord } from '../domain/export/export';
import { packageIsReady } from '../fieldwork/download';
import { localTileLayer } from '../maps/layer';
import { useApp } from './provider';

export function MapScreen() {
  const app = useApp();
  const mapNode = useRef<HTMLDivElement | null>(null);
  const [manifest, setManifest] = useState<MapManifest | null>(null);
  const [ready, setReady] = useState(false);
  const [records, setRecords] = useState<ExportRecord[]>([]);
  const [selected, setSelected] = useState<string>('');

  useEffect(() => {
    void (async () => {
      const localPackages = await app.db.packages.toArray();
      const readyPackage = localPackages.find((item) => item.status === 'ready');
      const first = readyPackage?.manifest ?? (await app.backend.listMapManifests('local'))[0] ?? null;
      setManifest(first);
      if (first) setReady(readyPackage ? true : await packageIsReady(app.db, first));
      const orgs = await app.backend.listOrganizations();
      const all: ExportRecord[] = [];
      for (const org of orgs) {
        const projects = await app.backend.listProjects(org.id);
        for (const project of projects) {
          all.push(...(await app.backend.listSubmissions(project.id, { ingestion: 'complete' })));
        }
      }
      setRecords(applySubmissionFilter(all, { ingestion: 'complete' }));
    })();
  }, [app.backend, app.db]);

  useEffect(() => {
    if (!ready || !manifest || !mapNode.current) return;
    const node = mapNode.current;
    const map = L.map(node, { zoomControl: true });
    const center = L.latLng((manifest.bounds.north + manifest.bounds.south) / 2, (manifest.bounds.east + manifest.bounds.west) / 2);
    map.setView(center, manifest.minZoom);
    localTileLayer(app.db, manifest).addTo(map);
    L.control.attribution({ prefix: false }).addAttribution(manifest.attribution).addTo(map);
    for (const record of records) {
      if (!isLocation(record.location)) continue;
      const marker = L.circleMarker([record.location.latitude, record.location.longitude]).addTo(map);
      marker.on('click', () => setSelected(record.id));
    }
    return () => {
      map.remove();
    };
  }, [app.db, manifest, ready, records]);

  const outside = manifest ? coverageMessage(manifest, 40, 40, manifest.minZoom) : null;
  const zoom = manifest ? coverageMessage(manifest, 10, 10, manifest.maxZoom + 4) : null;
  return (
    <section className="stack">
      <h1>Offline map</h1>
      <p>Synthetic test area — not real geography.</p>
      {manifest ? <p>{manifest.attribution}</p> : null}
      {manifest ? <p>License: {manifest.license}</p> : null}
      {outside ? <p>{outside}</p> : null}
      {zoom ? <p>{zoom}</p> : null}
      {ready && manifest ? <div ref={mapNode} className="map-frame" role="region" aria-label="Downloaded map" /> : <p>Download the map from Prepare for fieldwork. A partial download is not ready.</p>}
      <h2>Observations</h2>
      <ul>
        {records.map((record) => (
          <li key={record.id}>
            <button type="button" className="secondary" onClick={() => setSelected(record.id)}>
              {record.id}
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <p>
          Selected record {selected}.{' '}
          <Link to={`/projects/${records.find((record) => record.id === selected)?.projectId ?? ''}/submissions/${selected}`}>Open record</Link>
        </p>
      ) : null}
    </section>
  );
}
