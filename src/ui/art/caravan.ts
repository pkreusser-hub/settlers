// EXT (trading): the trader and his pack horse, drawn in code. The trader
// leads the horse by the rein; the horse carries saddle bags on a blanket in
// the colour of the player, and the trader's tunic takes that colour too. No
// file of the original art is used: every pixel is set here. The sizes and
// shading follow the serfs of the game: the trader is as tall as a serf (12
// pixels), there is no dark outline, and the edges of a shape are a darker
// shade of its own colour.
//
// Views: 'side' (walking right; mirror for left), 'front' (walking down,
// toward the viewer), 'back' (walking up, away). Four walking frames each.
// The feet stand on the last row of every view.

export type CaravanView = 'side' | 'front' | 'back';
export const CARAVAN_FRAMES = 4;

export interface Rgb { red: number; green: number; blue: number }

/* Colours close to those of the serfs, light from the upper left. */
const C = {
  wood: '#87573b', woodLight: '#ab7b5b', woodDark: '#5f3723', woodDeep: '#432313',
  cloth: '#e7dbbb', clothShade: '#c7b393',
  horse: '#9f6f4f', horseLight: '#b38767', horseDark: '#734b33',
  mane: '#432313', hoof: '#432313', muzzle: '#cba37f',
  skin: '#efcfaf', skinShade: '#cba37f', hair: '#87573b',
  hat: '#936343', hatDark: '#5f3723', trousers: '#6b5b4b', trousersFar: '#4f4333',
  rein: '#5f3723', eye: '#000000',
};

class Grid {
  readonly px: (string | null)[];
  constructor(readonly w: number, readonly h: number) { this.px = new Array(w * h).fill(null); }
  set(x: number, y: number, c: string): void {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: string): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: string): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  }
  canvas(mirror: boolean): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = this.w; cv.height = this.h;
    const ctx = cv.getContext('2d')!;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.px[y * this.w + x];
        if (c === null) continue;
        ctx.fillStyle = c;
        ctx.fillRect(mirror ? this.w - 1 - x : x, y, 1, 1);
      }
    }
    return cv;
  }
}

function hex(c: Rgb, f = 1): string {
  const k = (v: number): string => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
  return `#${k(c.red)}${k(c.green)}${k(c.blue)}`;
}

/* A horse leg through one stride, by phase 0..3: reaching forward, planted
   under the body, pushed back, then lifted as it swings forward again.
   Diagonal legs move together, the other pair half a stride later. */
const LEG_DX = [1, 0, -1, 0];
const LEG_LIFT = [0, 0, 0, 1];
/* Lift seen head-on or from behind, where a swing shows only as height. */
const LEG_LIFT_FRONT = [1, 0, 0, 2];
const PERSON_STEP = [1, 0, -1, 0];

/* One horse leg from the side, from the body down to the hoof. */
function legSide(g: Grid, x: number, top: number, base: number, phase: number, c: string): void {
  const dx = LEG_DX[phase], lift = LEG_LIFT[phase];
  const foot = base - lift;
  /* a lifted leg bends at the knee: the hoof trails back a pixel */
  g.line(x, top, x + dx, foot - 1 - lift, c);
  if (lift > 0) g.set(x + dx - 1, foot - 1, c);
  g.set(lift > 0 ? x + dx - 1 : x + dx, foot, C.hoof);
}

/* One horse leg seen head-on or from behind. */
function legFront(g: Grid, x: number, top: number, base: number, phase: number, c: string): void {
  const lift = LEG_LIFT_FRONT[phase];
  g.rect(x, top, x, base - 1 - lift, c);
  g.set(x, base - lift, C.hoof);
}

/* The trader from the side, walking right, 5 wide and 12 tall, feet on base.
   The back hand holds the rein of the horse behind him. */
function personSide(g: Grid, x: number, base: number, frame: number, tunic: string, shade: string): void {
  const s = PERSON_STEP[frame];
  const top = base - 11;
  /* far leg, then near leg */
  g.line(x + 2, top + 8, x + 2 - s, base - 1, C.trousersFar); g.set(x + 2 - s, base, C.woodDeep);
  g.line(x + 1, top + 8, x + 1 + s, base - 1, C.trousers);
  g.set(x + 1 + s, base, C.woodDeep); g.set(x + 2 + s, base, C.woodDeep);
  /* tunic, darker at the back and the hem */
  g.rect(x + 1, top + 4, x + 3, top + 7, tunic);
  g.rect(x + 1, top + 4, x + 1, top + 7, shade);
  g.rect(x + 1, top + 7, x + 3, top + 7, shade);
  /* arm back, hand on the rein */
  g.set(x, top + 5, shade); g.set(x, top + 6, C.skinShade);
  /* head, hat */
  g.rect(x + 2, top + 2, x + 4, top + 3, C.skin);
  g.set(x + 2, top + 2, C.hair); g.set(x + 4, top + 3, C.skinShade);
  g.set(x + 3, top + 2, C.eye);
  g.rect(x + 2, top, x + 3, top, C.hat);
  g.rect(x + 1, top + 1, x + 4, top + 1, C.hatDark);
}

/* The trader facing the viewer (or away), 4 wide and 12 tall. */
function personFront(g: Grid, x: number, base: number, frame: number, tunic: string, shade: string, away: boolean): void {
  const s = PERSON_STEP[frame];
  const top = base - 11;
  g.rect(x + 1, top + 8, x + 1, base - 1 - (s > 0 ? 1 : 0), C.trousers);
  g.rect(x + 2, top + 8, x + 2, base - 1 - (s < 0 ? 1 : 0), C.trousersFar);
  g.set(x + 1, base - (s > 0 ? 1 : 0), C.woodDeep); g.set(x + 2, base - (s < 0 ? 1 : 0), C.woodDeep);
  g.rect(x, top + 4, x + 3, top + 7, tunic);
  g.rect(x + 3, top + 4, x + 3, top + 7, shade);
  g.rect(x, top + 7, x + 3, top + 7, shade);
  g.rect(x, top + 2, x + 3, top + 3, away ? C.hair : C.skin);
  if (!away) { g.set(x + 1, top + 2, C.eye); g.set(x + 2, top + 2, C.eye); g.set(x + 3, top + 3, C.skinShade); }
  g.rect(x + 1, top, x + 2, top, C.hat);
  g.rect(x, top + 1, x + 3, top + 1, C.hatDark);
}

function drawSide(frame: number, color: Rgb): Grid {
  const g = new Grid(21, 16);
  const base = 15;
  const cover = hex(color), coverShade = hex(color, 0.78);
  /* the body rises a pixel while two legs stand under it */
  const bob = frame % 2 === 1 ? 0 : 1;
  const hx = 1;
  const a = frame, b = (frame + 2) % 4;

  /* far legs, darker */
  legSide(g, hx + 1, 11 + bob, base, a, C.horseDark);
  legSide(g, hx + 8, 11 + bob, base, b, C.horseDark);
  /* body */
  g.rect(hx, 7 + bob, hx + 9, 10 + bob, C.horse);
  g.rect(hx + 1, 7 + bob, hx + 8, 7 + bob, C.horseLight);
  g.rect(hx, 10 + bob, hx + 9, 10 + bob, C.horseDark);
  g.set(hx, 7 + bob, C.horseDark);
  /* tail */
  g.line(hx - 1, 8 + bob, hx - 1, 11 + bob, C.mane);
  /* neck, head, muzzle, ear, eye */
  g.line(hx + 9, 7 + bob, hx + 10, 4 + bob, C.horse);
  g.line(hx + 10, 7 + bob, hx + 11, 4 + bob, C.horse);
  g.line(hx + 8, 5 + bob, hx + 9, 3 + bob, C.mane);
  g.rect(hx + 10, 2 + bob, hx + 12, 4 + bob, C.horse);
  g.rect(hx + 10, 2 + bob, hx + 11, 2 + bob, C.horseLight);
  g.rect(hx + 13, 3 + bob, hx + 13, 4 + bob, C.muzzle);
  g.set(hx + 10, 1 + bob, C.horseDark);
  g.set(hx + 11, 3 + bob, C.eye);
  /* the load: a bundle on a blanket, a leather bag hanging at the side */
  g.rect(hx + 3, 5 + bob, hx + 6, 5 + bob, C.cloth);
  g.set(hx + 6, 5 + bob, C.clothShade);
  g.rect(hx + 2, 6 + bob, hx + 7, 6 + bob, cover);
  g.rect(hx + 2, 7 + bob, hx + 7, 7 + bob, coverShade);
  g.rect(hx + 3, 8 + bob, hx + 6, 11 + bob, C.woodLight);
  g.rect(hx + 3, 8 + bob, hx + 6, 8 + bob, C.wood);
  g.rect(hx + 3, 11 + bob, hx + 6, 11 + bob, C.wood);
  g.set(hx + 6, 9 + bob, C.wood); g.set(hx + 6, 10 + bob, C.wood);
  g.set(hx + 4, 9 + bob, C.woodDeep);
  /* near legs */
  legSide(g, hx + 2, 11 + bob, base, b, C.horse);
  legSide(g, hx + 9, 11 + bob, base, a, C.horse);

  /* the trader ahead of the horse, the rein from the bit to his hand */
  const tx = hx + 15;
  personSide(g, tx, base, frame, cover, coverShade);
  g.line(hx + 13, 5 + bob, tx, base - 5, C.rein);
  return g;
}

function drawFront(frame: number, color: Rgb): Grid {
  const g = new Grid(14, 16);
  const base = 15;
  const cover = hex(color), coverShade = hex(color, 0.78);
  const bob = frame % 2 === 1 ? 0 : 1;

  /* legs, then the chest, the bags at both sides, the head on top */
  legFront(g, 3, 12 + bob, base, frame, C.horse);
  legFront(g, 6, 12 + bob, base, (frame + 2) % 4, C.horseDark);
  g.rect(3, 7 + bob, 6, 11 + bob, C.horse);
  g.rect(3, 7 + bob, 3, 11 + bob, C.horseLight);
  g.rect(6, 7 + bob, 6, 11 + bob, C.horseDark);
  g.rect(2, 7 + bob, 7, 7 + bob, cover);
  for (const x of [1, 7]) {
    g.rect(x, 8 + bob, x + 1, 11 + bob, C.woodLight);
    g.rect(x, 8 + bob, x + 1, 8 + bob, coverShade);
    g.rect(x, 11 + bob, x + 1, 11 + bob, C.wood);
  }
  g.rect(8, 9 + bob, 8, 11 + bob, C.wood);
  g.rect(4, 3 + bob, 5, 9 + bob, C.horse);
  g.rect(4, 3 + bob, 5, 4 + bob, C.mane);
  g.rect(4, 8 + bob, 5, 9 + bob, C.muzzle);
  g.set(5, 5 + bob, C.horseDark); g.set(5, 6 + bob, C.horseDark);
  g.set(3, 2 + bob, C.horseDark); g.set(6, 2 + bob, C.horseDark);
  g.set(3, 5 + bob, C.eye); g.set(6, 5 + bob, C.eye);

  /* the trader beside the horse */
  const tx = 10;
  personFront(g, tx, base, frame, cover, coverShade, false);
  g.line(tx - 1, base - 6, 5, 9 + bob, C.rein);
  return g;
}

function drawBack(frame: number, color: Rgb): Grid {
  const g = new Grid(14, 16);
  const base = 15;
  const cover = hex(color), coverShade = hex(color, 0.78);
  const bob = frame % 2 === 1 ? 0 : 1;

  /* the head ahead, seen from behind: ears and the back of the neck */
  g.set(7, 1 + bob, C.horseDark); g.set(10, 1 + bob, C.horseDark);
  g.rect(7, 2 + bob, 10, 3 + bob, C.horse);
  g.rect(8, 2 + bob, 9, 6 + bob, C.mane);
  /* hind legs, the rump, the tail */
  legFront(g, 6, 12 + bob, base, frame, C.horse);
  legFront(g, 11, 12 + bob, base, (frame + 2) % 4, C.horseDark);
  g.rect(6, 7 + bob, 11, 11 + bob, C.horse);
  g.rect(6, 7 + bob, 6, 11 + bob, C.horseLight);
  g.rect(11, 7 + bob, 11, 11 + bob, C.horseDark);
  g.rect(6, 4 + bob, 11, 4 + bob, C.cloth);
  g.rect(6, 5 + bob, 11, 5 + bob, C.clothShade);
  g.rect(5, 6 + bob, 12, 6 + bob, cover);
  for (const x of [4, 12]) {
    g.rect(x, 7 + bob, x + 1, 10 + bob, C.woodLight);
    g.rect(x, 7 + bob, x + 1, 7 + bob, coverShade);
    g.rect(x, 10 + bob, x + 1, 10 + bob, C.wood);
  }
  g.rect(8, 7 + bob, 9, 12 + bob, C.mane);
  g.set(9, 13 + bob, C.mane);

  /* the trader at the left, walking away */
  personFront(g, 0, base, frame, cover, coverShade, true);
  return g;
}

const cache = new Map<string, HTMLCanvasElement>();

/* One frame of the caravan. 'side' faces right; mirror it for left. */
export function caravanSprite(view: CaravanView, frame: number, color: Rgb, mirror = false): HTMLCanvasElement {
  const f = ((frame % CARAVAN_FRAMES) + CARAVAN_FRAMES) % CARAVAN_FRAMES;
  const key = `${view}|${f}|${color.red},${color.green},${color.blue}|${mirror}`;
  let cv = cache.get(key);
  if (cv === undefined) {
    const g = view === 'side' ? drawSide(f, color) : view === 'front' ? drawFront(f, color) : drawBack(f, color);
    cv = g.canvas(mirror && view === 'side');
    cache.set(key, cv);
  }
  return cv;
}

/* The pixels of one frame, for tools that work without a page
   (tools/caravan-png.ts): colours as '#rrggbb', null where empty. */
export function caravanPixels(view: CaravanView, frame: number, color: Rgb, mirror = false):
    { w: number; h: number; px: (string | null)[] } {
  const f = ((frame % CARAVAN_FRAMES) + CARAVAN_FRAMES) % CARAVAN_FRAMES;
  const g = view === 'side' ? drawSide(f, color) : view === 'front' ? drawFront(f, color) : drawBack(f, color);
  if (!(mirror && view === 'side')) return { w: g.w, h: g.h, px: g.px.slice() };
  const px: (string | null)[] = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) px.push(g.px[y * g.w + (g.w - 1 - x)]);
  return { w: g.w, h: g.h, px };
}
