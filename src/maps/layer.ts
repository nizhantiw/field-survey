import L from 'leaflet';
import type { FieldSurveyDB } from '../db/db';
import { tileKey, type MapManifest } from '../domain/maps/manifest';

export function localTileLayer(db: FieldSurveyDB, manifest: MapManifest): L.GridLayer {
  const Layer = L.GridLayer.extend({
    createTile(coords: L.Coords, done: (error: Error | undefined, tile: HTMLElement) => void) {
      const element = document.createElement('img');
      element.alt = '';
      element.width = 256;
      element.height = 256;
      const key = tileKey(manifest.id, manifest.version, { z: coords.z, x: coords.x, y: coords.y });
      void db.tiles.get(key).then((row) => {
        if (!row) {
          done(new Error('missing tile'), element);
          return;
        }
        const url = URL.createObjectURL(new Blob([row.data], { type: 'image/png' }));
        element.onload = () => {
          URL.revokeObjectURL(url);
          done(undefined, element);
        };
        element.onerror = () => {
          URL.revokeObjectURL(url);
          done(new Error('tile decode failed'), element);
        };
        element.src = url;
      });
      return element;
    },
  });
  const Extended = Layer as new (options?: L.GridLayerOptions) => L.GridLayer;
  return new Extended({
    tileSize: 256,
    minZoom: manifest.minZoom,
    maxZoom: manifest.maxZoom,
  });
}
