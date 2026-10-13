// Dev tool: the two directions of the projection of the "Globe" map view
// against each other.
// Usage: npx esbuild tools/globe-test.ts --bundle --platform=node --outfile=node_modules/.cache/globe-test.cjs && node node_modules/.cache/globe-test.cjs
//
// For several sizes of the view and every pixel of the screen:
//  1. screen -> flat -> screen comes back within half a pixel, and a point
//     in the sky has no flat point;
//  2. the flat point is inside the flat picture;
//  3. the strips the view draws put each row of the picture where
//     forward() says, at several scales of the map.

import { Globe } from '../src/ui/globe';

let failed = false;
const check = (ok: boolean, text: string): void => {
  if (!ok) {
    failed = true;
    console.log('FAIL ' + text);
  }
};

const sizes: Array<[number, number]> = [
  [960, 540], [1280, 720], [641, 353], [3840, 2160], [400, 300], [1707, 961], [320, 900],
];

for (const [w, h] of sizes) {
  const g = new Globe(w, h);
  let worst = 0;
  let land = 0;
  let sky = 0;
  let outside = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const flat = g.inverse(px, py);
      if (flat === null) {
        sky++;
        continue;
      }
      land++;
      if (flat[0] < 0 || flat[0] >= g.flatWidth || flat[1] < 0 || flat[1] >= g.flatHeight) outside++;
      const back = g.forward(flat[0], flat[1]);
      if (back === null) {
        worst = Infinity;
        continue;
      }
      worst = Math.max(worst, Math.abs(back[0] - px), Math.abs(back[1] - py));
    }
  }

  /* flat -> screen -> flat, where the point is on the screen. */
  let worstFlat = 0;
  for (let v = 0; v < g.flatHeight; v += 3) {
    for (let u = 0; u < g.flatWidth; u += 3) {
      const p = g.forward(u + 0.5, v + 0.5);
      if (p === null || p[0] < 0 || p[0] >= w || p[1] < 0 || p[1] >= h) continue;
      const flat = g.inverse(p[0], p[1]);
      if (flat === null) {
        worstFlat = Infinity;
        continue;
      }
      worstFlat = Math.max(worstFlat, Math.abs(flat[0] - (u + 0.5)), Math.abs(flat[1] - (v + 0.5)));
    }
  }

  /* The strips against forward(): the middle of each strip. */
  let worstStrip = 0;
  for (const scale of [0.5, 0.75, 1, 1.5, 2, 3, 4]) {
    const s = g.strips(scale);
    check(Number.isInteger(g.y0 * scale), `${w}x${h} scale ${scale}: y0 on a whole device pixel`);
    check(s.bottom === g.y0 * scale, `${w}x${h} scale ${scale}: strips end at y0`);
    for (let i = 0; i < s.bottom - s.top; i++) {
      if (s.h[i] <= 0) continue;
      /* The middle of the row of device pixels: the strip draws the point
         u of the picture at x + w * u / flatWidth, and takes the rows
         v .. v + h of the picture. */
      const y = (s.top + i + 0.5) / scale;
      for (const x of [0.5, w / 3, w / 2, w - 0.5]) {
        const flat = g.inverse(x, y);
        if (flat === null) continue;
        const dx = s.x[i] + (s.w[i] * flat[0]) / g.flatWidth;
        worstStrip = Math.max(worstStrip, Math.abs(dx - x * scale));
        worstStrip = Math.max(worstStrip, Math.max(0, s.v[i] - flat[1], flat[1] - (s.v[i] + s.h[i])));
      }
    }
  }

  console.log(
    `${w}x${h}: flat ${g.flatWidth}x${g.flatHeight}, y0 ${g.y0}, top ${g.yTop.toFixed(1)}, ` +
      `land ${land}, sky ${sky}; screen round trip ${worst.toExponential(2)} px, ` +
      `flat round trip ${worstFlat.toExponential(2)} px, strips ${worstStrip.toFixed(3)} device px`,
  );
  check(worst < 0.5, `${w}x${h}: screen round trip`);
  check(worstFlat < 0.5, `${w}x${h}: flat round trip`);
  check(outside === 0, `${w}x${h}: ${outside} flat points outside of the picture`);
  check(worstStrip < 0.5, `${w}x${h}: strips`);
  check(sky > 0 && land > sky, `${w}x${h}: land and sky`);
}

console.log(failed ? 'FAILED' : 'OK');
process.exit(failed ? 1 : 0);
