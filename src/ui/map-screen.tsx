import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import L from 'leaflet';
import { coverageMessage } from '../domain/maps/download';
import type { MapManifest } from '../domain/maps/manifest';
import { isLocation } from '../domain/survey/engine';
import { applySubmissionFilter, type ExportRecord } from '../domain/export/export';
import { formatAccuracy } from '../domain/gps/location';
import type { LocationReading } from '../domain/survey/types';
import { listRecordsForUser } from '../db/records';
import { packageIsReady } from '../fieldwork/download';
import { localTileLayer } from '../maps/layer';
import { useApp } from './provider';

interface MapPoint {
  key: string;
  id: string;
  label: string;
  reading: LocationReading;
  href: string;
}

export function MapScreen() {
  const app = useApp();
  const mapNode = useRef<HTMLDivElement | null>(null);
  const [manifest, setManifest] = useState<MapManifest | null>(null);
  const [ready, setReady] = useState(false);
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    void (async () => {
      const localPackages = await app.db.packages.toArray();
      const readyPackage = localPackages.find((item) => item.status === 'ready');
      const first = readyPackage?.manifest ?? (await app.backend.listMapManifests('local'))[0] ?? null;
      setManifest(first);
      if (first) setReady(readyPackage ? true : await packageIsReady(app.db, first));
      const gathered: MapPoint[] = [];
      if (app.user) {
        const local = await listRecordsForUser(app.db, app.user.id);
        for (const record of local) {
          const readings = gpsReadings(record.location, record.answers);
          readings.forEach((reading, index) => {
            gathered.push({
              key: `local:${record.id}:${index}`,
              id: record.id,
              label: record.definitionSnapshot.title,
              reading,
              href: `/drafts/${record.id}`,
            });
          });
        }
      }
      const orgs = await app.backend.listOrganizations();
      const all: ExportRecord[] = [];
      for (const org of orgs) {
        const projects = await app.backend.listProjects(org.id);
        for (const project of projects) {
          all.push(...(await app.backend.listSubmissions(project.id, { ingestion: 'complete' })));
        }
      }
      for (const record of applySubmissionFilter(all, { ingestion: 'complete' })) {
        if (!isLocation(record.location)) continue;
        if (gathered.some((point) => point.id === record.id)) continue;
        gathered.push({
          key: `server:${record.id}`,
          id: record.id,
          label: record.id,
          reading: record.location,
          href: `/projects/${record.projectId}/submissions/${record.id}`,
        });
      }
      setPoints(gathered);
    })();
  }, [app.backend, app.db, app.user]);

  const basemapUrl = app.config.basemapUrl;
  const showDownloaded = ready && manifest !== null;
  const showOnline = Boolean(basemapUrl) && navigator.onLine;
  const showMap = showDownloaded || showOnline || points.length > 0;

  useEffect(() => {
    if (!showMap || !mapNode.current) return;
    const node = mapNode.current;
    const map = L.map(node, { zoomControl: true });
    if (showOnline && basemapUrl) {
      L.tileLayer(basemapUrl, {
        attribution: app.config.basemapAttribution ?? '',
        maxZoom: 19,
      }).addTo(map);
    }
    if (showDownloaded && manifest) {
      localTileLayer(app.db, manifest).addTo(map);
      const center = L.latLng((manifest.bounds.north + manifest.bounds.south) / 2, (manifest.bounds.east + manifest.bounds.west) / 2);
      map.setView(center, manifest.minZoom);
      L.control.attribution({ prefix: false }).addAttribution(manifest.attribution).addTo(map);
    }
    const latLngs: L.LatLng[] = [];
    for (const point of points) {
      const latLng = L.latLng(point.reading.latitude, point.reading.longitude);
      latLngs.push(latLng);
      const marker = L.circleMarker(latLng, { radius: 8, color: '#0071e3', weight: 2, fillOpacity: 0.9 }).addTo(map);
      marker.on('click', () => setSelected(point.key));
      if (point.reading.accuracy && point.reading.accuracy > 0 && point.reading.accuracy < 5000) {
        L.circle(latLng, { radius: point.reading.accuracy, color: '#0071e3', weight: 1, fillOpacity: 0.08 }).addTo(map);
      }
    }
    if (!showDownloaded && latLngs.length > 0) {
      map.fitBounds(L.latLngBounds(latLngs).pad(0.4), { maxZoom: 16 });
    } else if (!showDownloaded) {
      map.setView([20, 78], 4);
    }
    const timer = window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      window.clearTimeout(timer);
      map.remove();
    };
  }, [app.config.basemapAttribution, app.db, basemapUrl, manifest, points, showDownloaded, showMap, showOnline]);

  const outside = manifest?.synthetic ? coverageMessage(manifest, 40, 40, manifest.minZoom) : null;
  const zoom = manifest?.synthetic ? coverageMessage(manifest, 10, 10, manifest.maxZoom + 4) : null;
  const selectedPoint = points.find((point) => point.key === selected) ?? null;
  return (
    <section className="stack">
      <h1>Map</h1>
      <p className="muted">GPS tags from forms on this device, plus completed records from the server.</p>
      {showDownloaded && manifest?.synthetic ? <p>{manifest.name}</p> : null}
      {showDownloaded && manifest ? <p>{manifest.attribution}</p> : null}
      {showDownloaded && manifest ? <p>License: {manifest.license}</p> : null}
      {showDownloaded && outside ? <p>{outside}</p> : null}
      {showDownloaded && zoom ? <p>{zoom}</p> : null}
      {!basemapUrl ? <p>Coordinates stay readable without a basemap. Add a licensed tile URL to draw streets.</p> : null}
      {showMap ? <div ref={mapNode} className="map-frame" role="region" aria-label="Downloaded map" /> : <p>Download the map from Prepare for fieldwork. A partial download is not ready.</p>}
      <h2>Observations</h2>
      {points.length === 0 ? <p>No GPS tags yet. Capture location on a form, then return here.</p> : null}
      <ul className="stack">
        {points.map((point) => (
          <li key={point.key} className="card">
            <button type="button" className="secondary" onClick={() => setSelected(point.key)}>
              {point.label}
            </button>
            <span className="status-pill" data-tone={point.reading.source === 'manual' ? 'warn' : 'info'}>
              {point.reading.source === 'manual' ? 'Manual' : 'Device'} {formatAccuracy(point.reading.accuracy)}
            </span>
          </li>
        ))}
      </ul>
      {selectedPoint ? (
        <p>
          Selected record {selectedPoint.id}. <Link to={selectedPoint.href}>Open record</Link>
        </p>
      ) : null}
    </section>
  );
}

function gpsReadings(location: unknown, answers: Record<string, unknown>): LocationReading[] {
  const readings: LocationReading[] = [];
  if (isLocation(location)) readings.push(location);
  for (const value of Object.values(answers)) {
    if (!isLocation(value)) continue;
    const duplicate = readings.some((item) => item.latitude === value.latitude && item.longitude === value.longitude && item.timestamp === value.timestamp);
    if (!duplicate) readings.push(value);
  }
  return readings;
}
