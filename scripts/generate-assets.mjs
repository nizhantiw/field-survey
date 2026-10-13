import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function png(width, height, red, green, blue) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const index = row + 1 + x * 3;
      raw[index] = Math.min(255, red + (x < width / 2 ? 24 : 0));
      raw[index + 1] = green;
      raw[index + 2] = Math.min(255, blue + (y < height / 2 ? 16 : 0));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
mkdirSync('public/map-package/2/0', { recursive: true });
mkdirSync('public/map-package/2/1', { recursive: true });
writeFileSync('public/favicon.png', png(32, 32, 12, 79, 62));
writeFileSync('public/icons/icon-192.png', png(192, 192, 12, 79, 62));
writeFileSync('public/icons/icon-512.png', png(512, 512, 12, 79, 62));

const colors = [
  [12, 79, 62],
  [20, 90, 140],
  [140, 90, 30],
  [90, 40, 70],
];
const tiles = [
  { z: 2, x: 0, y: 0 },
  { z: 2, x: 1, y: 0 },
  { z: 2, x: 0, y: 1 },
  { z: 2, x: 1, y: 1 },
];
const tileMeta = tiles.map((tile, index) => {
  const color = colors[index] ?? colors[0];
  const bytes = png(256, 256, color[0], color[1], color[2]);
  writeFileSync(`public/map-package/${tile.z}/${tile.x}/${tile.y}.png`, bytes);
  return {
    ...tile,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
});

const manifest = {
  id: 'synthetic-field-001',
  version: 1,
  name: 'Synthetic test area (not real geography)',
  synthetic: true,
  bounds: { west: 0, south: 0, east: 20, north: 20 },
  minZoom: 2,
  maxZoom: 2,
  tiles: tileMeta,
  attribution: 'Synthetic FieldSurvey test tiles. Not for navigation.',
  license: 'CC0-1.0 synthetic test fixture',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
};
writeFileSync('public/map-package/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${tileMeta.length} synthetic tiles`);
