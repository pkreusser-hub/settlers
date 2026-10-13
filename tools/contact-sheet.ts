// Dev tool: decode sprites from SPAE.PA and write them to a PNG contact sheet.
// Usage: npx esbuild tools/contact-sheet.ts --bundle --platform=node --outfile=node_modules/.cache/contact-sheet.cjs
//        node node_modules/.cache/contact-sheet.cjs <asset name> <out.png> [first] [count]

import { readFileSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { Asset, getResourceCount, getResourceName } from '../src/data/data';
import { DataSourceDOS } from '../src/data/data-source-dos';
import { Sprite } from '../src/data/sprite';

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  out.set(body, 8);
  out.writeUInt32BE(crc32(out.subarray(4, body.length + 8)), body.length + 8);
  return out;
}

function png(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

const [name, outPath, firstArg, countArg] = process.argv.slice(2);
let asset = Asset.None;
for (let a = Asset.None; a <= Asset.Cursor; a++) {
  if (getResourceName(a) === name) asset = a;
}
if (asset === Asset.None || !outPath) {
  throw new Error('usage: contact-sheet <asset name> <out.png> [first] [count]');
}

const source = new DataSourceDOS(new Uint8Array(readFileSync('public/data/SPAE.PA')));
const first = Number(firstArg ?? 0);
const last = Math.min(getResourceCount(asset), first + Number(countArg ?? 1e9));
const sprites: Sprite[] = [];
for (let i = first; i < last; i++) {
  const s = source.getSprite(asset, i, { red: 0x00, green: 0xe3, blue: 0xe3, alpha: 0xff });
  if (s && s.width && s.height) sprites.push(s);
}

const SHEET_W = 1000;
let x = 0, y = 0, rowH = 0;
const places: [number, number][] = [];
for (const s of sprites) {
  if (x + s.width > SHEET_W && x > 0) { x = 0; y += rowH + 2; rowH = 0; }
  places.push([x, y]);
  x += s.width + 2;
  rowH = Math.max(rowH, s.height);
}
const sheetH = y + rowH;
const rgba = new Uint8Array(SHEET_W * sheetH * 4);
for (let i = 0; i < rgba.length; i += 4) { rgba[i] = rgba[i + 1] = rgba[i + 2] = 0x40; rgba[i + 3] = 0xff; }
sprites.forEach((s, n) => {
  const [px, py] = places[n];
  for (let sy = 0; sy < s.height; sy++) {
    for (let sx = 0; sx < Math.min(s.width, SHEET_W - px); sx++) {
      const src = (sy * s.width + sx) * 4;
      const a = s.data[src + 3] / 255;
      const dst = ((py + sy) * SHEET_W + px + sx) * 4;
      for (let k = 0; k < 3; k++) rgba[dst + k] = s.data[src + k] * a + rgba[dst + k] * (1 - a);
    }
  }
});
writeFileSync(outPath, png(SHEET_W, sheetH, rgba));
console.log(`${sprites.length} sprites, ${SHEET_W}x${sheetH} -> ${outPath}`);
