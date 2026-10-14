// Dev tool: draw the caravan frames of src/ui/art/caravan.ts into a PNG sheet.
// Usage: npx esbuild tools/caravan-png.ts --bundle --platform=node --outfile=node_modules/.cache/caravan-png.cjs && node node_modules/.cache/caravan-png.cjs out.png [scale]
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { CARAVAN_FRAMES, caravanPixels } from '../src/ui/art/caravan';
import type { CaravanView } from '../src/ui/art/caravan';

const out = process.argv[2] ?? 'caravan.png';
const S = Number(process.argv[3] ?? 6);
const grass = [0x3f, 0x7a, 0x2a];
const colours = [
  { red: 0x00, green: 0xe3, blue: 0xe3 }, { red: 0xcf, green: 0x63, blue: 0x63 },
  { red: 0xdf, green: 0x7f, blue: 0xef }, { red: 0xef, green: 0xef, blue: 0x8f },
];
const rows: [CaravanView, boolean, number][] = [
  ['side', false, 0], ['side', true, 1], ['front', false, 2], ['back', false, 3],
];
const cellW = 66, cellH = 40, pad = 2;
const W = (cellW * CARAVAN_FRAMES + pad * (CARAVAN_FRAMES + 1)) * S;
const H = (cellH * rows.length + pad * (rows.length + 1)) * S;
const img = new Uint8Array(W * H * 3);
for (let i = 0; i < W * H; i++) img.set(grass, i * 3);
rows.forEach(([view, mirror, colour], r) => {
  for (let f = 0; f < CARAVAN_FRAMES; f++) {
    const p = caravanPixels(view, f, colours[colour], mirror);
    const ox = (pad + f * (cellW + pad)) * S, oy = (pad + r * (cellH + pad) + cellH - p.h) * S;
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const c = p.px[y * p.w + x];
      if (c === null) continue;
      const rgb = [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
      for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) img.set(rgb, ((oy + y * S + dy) * W + ox + x * S + dx) * 3);
    }
  }
});
/* PNG: 8-bit RGB, no filter. */
const raw = new Uint8Array(H * (W * 3 + 1));
for (let y = 0; y < H; y++) raw.set(img.subarray(y * W * 3, (y + 1) * W * 3), y * (W * 3 + 1) + 1);
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Uint8Array): number => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Uint8Array): Buffer => {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); Buffer.from(data).copy(b, 8);
  b.writeUInt32BE(crc(b.subarray(4, 8 + data.length)), 8 + data.length);
  return b;
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]));
console.log(`${out}: ${W}x${H}`);
