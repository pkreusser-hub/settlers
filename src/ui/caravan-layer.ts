// EXT (trading): caravans walking on the map, drawn by the viewport after
// the game objects. Display only: a walker is a list of map positions and a
// pace; where it stands is worked out from the clock when the map is drawn.
// The trade rule decides the walks; until then a walk can be started by hand
// (window.settlers.caravans in a dev build) to see the art in the game.

import { caravanSprite } from './art/caravan';
import type { Rgb } from './art/caravan';

export interface CaravanWalk {
  path: number[];       /* map positions, one step apart */
  color: Rgb;
  startMs: number;
  msPerStep: number;
  loop?: boolean;
}

export const caravanWalks: CaravanWalk[] = [];

/* map position -> screen pixel of its centre, as the viewport draws it */
export type ToScreen = (pos: number) => [number, number];

export function drawCaravans(ctx: CanvasRenderingContext2D, toScreen: ToScreen, scale: number, now: number): boolean {
  let any = false;
  for (let i = caravanWalks.length - 1; i >= 0; i--) {
    const w = caravanWalks[i];
    const steps = w.path.length - 1;
    if (steps < 1) { caravanWalks.splice(i, 1); continue; }
    let t = (now - w.startMs) / w.msPerStep;
    if (t >= steps) {
      if (!w.loop) { caravanWalks.splice(i, 1); continue; }
      t %= steps;
    }
    any = true;
    const k = Math.floor(t), f = t - k;
    const [x0, y0] = toScreen(w.path[k]);
    const [x1, y1] = toScreen(w.path[k + 1]);
    const x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f;
    const dx = x1 - x0, dy = y1 - y0;
    const view = Math.abs(dx) >= Math.abs(dy) * 0.6 ? 'side' : dy > 0 ? 'front' : 'back';
    const frame = Math.floor((now - w.startMs) / 160);
    const s = caravanSprite(view, frame, w.color, view === 'side' && dx < 0);
    /* feet on the point, the middle of the caravan over it */
    ctx.drawImage(s, Math.round(x - (s.width * scale) / 2), Math.round(y - (s.height - 3) * scale),
                  s.width * scale, s.height * scale);
  }
  return any;
}
