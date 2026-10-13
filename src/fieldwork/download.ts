import { downloadMapPackage, verifyPackage, type TileStore } from '../domain/maps/download';
import { tileKey, type MapManifest } from '../domain/maps/manifest';
import type { FieldSurveyDB } from '../db/db';
import { MapDownloadError } from '../domain/maps/download';

export function dexieTileStore(db: FieldSurveyDB): TileStore {
  return {
    async get(key) {
      const row = await db.tiles.get(key);
      if (!row) return null;
      return { key, checksum: row.checksum, bytes: row.bytes };
    },
    async put(input) {
      const quota = typeof window !== 'undefined' ? window.__FS_FAULTS?.storageQuota : undefined;
      if (quota && quota.quota - quota.usage < input.bytes.byteLength) {
        throw new MapDownloadError('Not enough free space to store a map tile. Existing survey records were not deleted.', 'quota');
      }
      await db.tiles.put({
        key: input.key,
        packageId: input.packageId,
        version: input.version,
        z: input.tile.z,
        x: input.tile.x,
        y: input.tile.y,
        data: input.bytes,
        checksum: input.checksum,
        bytes: input.bytes.byteLength,
      });
    },
    async list(packageId, version) {
      const rows = await db.tiles.where('packageId').equals(packageId).and((row) => row.version === version).toArray();
      return rows.map((row) => ({ key: row.key, checksum: row.checksum, bytes: row.bytes }));
    },
  };
}

export async function downloadManifestPackage(
  db: FieldSurveyDB,
  manifest: MapManifest,
  options?: { signal?: AbortSignal; onProgress?: (completed: number, total: number) => void },
): Promise<'ready' | 'cancelled'> {
  const packageId = `${manifest.id}@${manifest.version}`;
  await db.packages.put({
    id: packageId,
    packageId: manifest.id,
    version: manifest.version,
    manifest,
    status: 'downloading',
    updatedAt: new Date().toISOString(),
  });
  try {
    const estimate = typeof window !== 'undefined' && window.__FS_FAULTS?.storageQuota ? window.__FS_FAULTS.storageQuota : await storageEstimate();
    const result = await downloadMapPackage({
      manifest,
      store: dexieTileStore(db),
      estimate,
      signal: options?.signal,
      concurrency: 3,
      onProgress: (progress) => options?.onProgress?.(progress.completed, progress.total),
      fetchTile: async (tile, signal) => {
        if (typeof window !== 'undefined' && window.__FS_FAULTS?.cancelDownload) {
          throw new DOMException('cancelled', 'AbortError');
        }
        const response = await fetch(`/map-package/${tile.z}/${tile.x}/${tile.y}.png`, { signal });
        if (!response.ok) throw new Error(`Tile ${tile.z}/${tile.x}/${tile.y} was not available`);
        return response.arrayBuffer();
      },
    });
    await db.packages.update(packageId, { status: result.status === 'ready' ? 'ready' : 'cancelled', updatedAt: new Date().toISOString() });
    return result.status === 'ready' ? 'ready' : 'cancelled';
  } catch (error) {
    await db.packages.update(packageId, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Map download failed',
      updatedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export async function packageIsReady(db: FieldSurveyDB, manifest: MapManifest): Promise<boolean> {
  const verification = await verifyPackage(manifest, dexieTileStore(db));
  return verification.ok;
}

export function expectedTileCount(manifest: MapManifest): number {
  return manifest.tiles.length;
}

export function tileStorageKey(manifest: MapManifest, z: number, x: number, y: number): string {
  return tileKey(manifest.id, manifest.version, { z, x, y });
}

async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  if (estimate.quota === undefined || estimate.usage === undefined) return null;
  return { usage: estimate.usage, quota: estimate.quota };
}
