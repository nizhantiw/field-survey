import { sha256Hex } from '../hash';
import { tileKey, type ManifestTile, type MapManifest } from './manifest';

export interface StoredTile {
  key: string;
  checksum: string;
  bytes: number;
}

export interface TileStore {
  get(key: string): Promise<StoredTile | null>;
  put(input: { key: string; packageId: string; version: number; tile: ManifestTile; bytes: ArrayBuffer; checksum: string }): Promise<void>;
  list(packageId: string, version: number): Promise<StoredTile[]>;
}

export type PackageStatus = 'idle' | 'downloading' | 'verifying' | 'ready' | 'failed' | 'cancelled';

export class MapDownloadError extends Error {
  constructor(
    message: string,
    readonly code: 'quota' | 'checksum' | 'cancelled' | 'network' | 'incomplete',
  ) {
    super(message);
    this.name = 'MapDownloadError';
  }
}

export interface DownloadProgress {
  completed: number;
  total: number;
  bytesDownloaded: number;
  status: PackageStatus;
}

export async function verifyPackage(manifest: MapManifest, store: TileStore): Promise<{ ok: boolean; missing: string[]; mismatched: string[] }> {
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const tile of manifest.tiles) {
    const key = tileKey(manifest.id, manifest.version, tile);
    const stored = await store.get(key);
    if (!stored) {
      missing.push(key);
      continue;
    }
    if (stored.checksum !== tile.sha256 || stored.bytes !== tile.bytes) mismatched.push(key);
  }
  return { ok: missing.length === 0 && mismatched.length === 0, missing, mismatched };
}

export async function downloadMapPackage(options: {
  manifest: MapManifest;
  store: TileStore;
  fetchTile: (tile: ManifestTile, signal: AbortSignal) => Promise<ArrayBuffer>;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
  estimate?: { usage: number; quota: number } | null;
}): Promise<{ status: PackageStatus; verified: boolean }> {
  const { manifest, store } = options;
  const signal = options.signal ?? new AbortController().signal;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 4));
  const expectedBytes = manifest.tiles.reduce((sum, tile) => sum + tile.bytes, 0);
  if (options.estimate && options.estimate.quota - options.estimate.usage < expectedBytes) {
    throw new MapDownloadError('Not enough free space to download this map. Existing survey records were not deleted.', 'quota');
  }

  let completed = 0;
  let bytesDownloaded = 0;
  const report = (status: PackageStatus) => {
    options.onProgress?.({ completed, total: manifest.tiles.length, bytesDownloaded, status });
  };
  report('downloading');

  const pending = manifest.tiles.slice();
  const workers = Array.from({ length: concurrency }, async () => {
    while (pending.length > 0) {
      if (signal.aborted) throw new MapDownloadError('Map download cancelled', 'cancelled');
      const tile = pending.shift();
      if (!tile) return;
      const key = tileKey(manifest.id, manifest.version, tile);
      const existing = await store.get(key);
      if (existing && existing.checksum === tile.sha256 && existing.bytes === tile.bytes) {
        completed += 1;
        bytesDownloaded += existing.bytes;
        report('downloading');
        continue;
      }
      let bytes: ArrayBuffer;
      try {
        bytes = await options.fetchTile(tile, signal);
      } catch (error) {
        if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          throw new MapDownloadError('Map download cancelled', 'cancelled');
        }
        throw new MapDownloadError(error instanceof Error ? error.message : 'Tile download failed', 'network');
      }
      const checksum = await sha256Hex(bytes);
      if (checksum !== tile.sha256 || bytes.byteLength !== tile.bytes) {
        throw new MapDownloadError(`Checksum mismatch for tile ${tile.z}/${tile.x}/${tile.y}`, 'checksum');
      }
      try {
        await store.put({ key, packageId: manifest.id, version: manifest.version, tile, bytes, checksum });
      } catch (error) {
        if (error instanceof MapDownloadError && error.code === 'quota') throw error;
        throw new MapDownloadError(error instanceof Error ? error.message : 'Could not store a map tile', 'quota');
      }
      completed += 1;
      bytesDownloaded += bytes.byteLength;
      report('downloading');
    }
  });

  try {
    await Promise.all(workers);
  } catch (error) {
    if (error instanceof MapDownloadError && error.code === 'cancelled') {
      report('cancelled');
      return { status: 'cancelled', verified: false };
    }
    report('failed');
    throw error;
  }

  report('verifying');
  const verification = await verifyPackage(manifest, store);
  if (!verification.ok) {
    report('failed');
    throw new MapDownloadError('The map package is incomplete or failed verification', 'incomplete');
  }
  report('ready');
  return { status: 'ready', verified: true };
}

export function coverageMessage(manifest: MapManifest, latitude: number, longitude: number, zoom: number): string | null {
  const { west, south, east, north } = manifest.bounds;
  if (longitude < west || longitude > east || latitude < south || latitude > north) {
    return 'This location is outside the downloaded map.';
  }
  if (zoom < manifest.minZoom || zoom > manifest.maxZoom) {
    return 'This zoom level was not included in the downloaded map.';
  }
  return null;
}

export function activateReplacement(previousReady: boolean, replacement: { status: PackageStatus }): { current: 'previous' | 'replacement'; previousKept: boolean } {
  if (replacement.status === 'ready') return { current: 'replacement', previousKept: previousReady };
  return { current: 'previous', previousKept: previousReady };
}
