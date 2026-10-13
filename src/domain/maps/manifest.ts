import { z } from 'zod';

export const mapManifestSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    name: z.string().min(1),
    synthetic: z.boolean(),
    bounds: z
      .object({
        west: z.number(),
        south: z.number(),
        east: z.number(),
        north: z.number(),
      })
      .strict(),
    minZoom: z.number().int().nonnegative(),
    maxZoom: z.number().int().nonnegative(),
    tiles: z
      .array(
        z
          .object({
            z: z.number().int(),
            x: z.number().int(),
            y: z.number().int(),
            bytes: z.number().int().nonnegative(),
            sha256: z.string().length(64),
          })
          .strict(),
      )
      .min(1),
    attribution: z.string().min(1),
    license: z.string().min(1),
    licenseUrl: z.string().url(),
  })
  .strict();

export type MapManifest = z.infer<typeof mapManifestSchema>;
export type ManifestTile = MapManifest['tiles'][number];

export function tileKey(packageId: string, version: number, tile: Pick<ManifestTile, 'z' | 'x' | 'y'>): string {
  return `${packageId}:${version}:${tile.z}:${tile.x}:${tile.y}`;
}

export function parseManifest(input: unknown): MapManifest {
  return mapManifestSchema.parse(input);
}
