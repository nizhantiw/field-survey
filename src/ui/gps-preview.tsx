import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { formatAccuracy, formatCoordinate } from '../domain/gps/location';
import type { LocationReading } from '../domain/survey/types';

export function GpsPreview(props: { reading: LocationReading; basemapUrl: string | null; attribution: string | null }) {
  const node = useRef<HTMLDivElement | null>(null);
  const reading = props.reading;

  useEffect(() => {
    if (!props.basemapUrl || !navigator.onLine || !node.current) return;
    const map = L.map(node.current, { zoomControl: true, attributionControl: true });
    L.tileLayer(props.basemapUrl, {
      attribution: props.attribution ?? '',
      maxZoom: 19,
    }).addTo(map);
    const point = L.latLng(reading.latitude, reading.longitude);
    L.circleMarker(point, { radius: 8, color: '#0071e3', weight: 2, fillOpacity: 0.9 }).addTo(map);
    if (reading.accuracy && reading.accuracy > 0) {
      L.circle(point, { radius: reading.accuracy, color: '#0071e3', weight: 1, fillOpacity: 0.12 }).addTo(map);
    }
    map.setView(point, 16);
    const timer = window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      window.clearTimeout(timer);
      map.remove();
    };
  }, [props.attribution, props.basemapUrl, reading.accuracy, reading.latitude, reading.longitude]);

  if (!props.basemapUrl || !navigator.onLine) return null;
  return (
    <div className="stack">
      <p className="muted">
        {formatCoordinate(reading.latitude, reading.accuracy)}, {formatCoordinate(reading.longitude, reading.accuracy)} {formatAccuracy(reading.accuracy)}
      </p>
      <div ref={node} className="map-frame" role="region" aria-label="Captured location" />
    </div>
  );
}
