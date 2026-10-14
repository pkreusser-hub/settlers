// EXT (trading): the trader's caravan, drawn in code. A trader leads a horse
// that pulls a covered wagon; the cover and the trader's tunic take the
// colour of the player. No file of the original art is used: every pixel is
// set here, then a dark outline is drawn around the shapes, as the sprites
// of the game have.
//
// Views: 'side' (walking right; mirror for left), 'front' (walking down,
// toward the viewer), 'back' (walking up, away). Four walking frames each.

export type CaravanView = 'side' | 'front' | 'back';
export const CARAVAN_FRAMES = 4;

export interface Rgb { red: number; green: number; blue: number }

/* Colours, light from the upper left. */
const C = {
  outline: '#24140a',
  wood: '#7a4a24', woodLight: '#a8703a', woodDark: '#4e2e14',
  wheel: '#5a3618', hub: '#2e1a0c',
  cloth: '#e6d9ae', clothShade: '#c4b386', clothDark: '#9c8c62',
  horse: '#8c4c22', horseLight: '#b8703a', horseDark: '#5c2e12',
  mane: '#2e1a0c', hoof: '#1e120a', muzzle: '#c89a6a',
  skin: '#e0a878', skinShade: '#b87a50', hair: '#4a2a12',
  hat: '#5a3a1a', hatBand: '#2e1a0c', boots: '#2e1a0c', trousers: '#5a4630',
  harness: '#3a2410', gold: '#e8c050', inside: '#2e2014',
};

class Grid {
  readonly px: (string | null)[];
  /* ox: a margin on the left, so a shape at x = 0 keeps its outline. */
  constructor(readonly w: number, readonly h: number, readonly ox = 0) { this.px = new Array(w * h).fill(null); }
  set(x: number, y: number, c: string): void {
    x = Math.round(x) + this.ox; y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: string): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: string): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: string): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / (rx + 0.35), dy = (y - cy) / (ry + 0.35);
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
  }
  /* A dark line around every shape: each empty pixel next to a filled one. */
  outline(): void {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.px[y * this.w + x] !== null) continue;
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const nx = x + dx, ny = y + dy;
          return nx >= 0 && ny >= 0 && nx < this.w && ny < this.h &&
            this.px[ny * this.w + nx] !== null && this.px[ny * this.w + nx] !== C.outline;
        });
        if (near) add.push(y * this.w + x);
      }
    }
    for (const i of add) this.px[i] = C.outline;
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

/* Leg swing per frame for a four-beat walk: [front near, front far, back near, back far]. */
const HORSE_STEP = [[2, -1, -1, 1], [0, 1, 1, -1], [-2, 1, 1, -1], [0, -1, -1, 1]];
const PERSON_STEP = [2, 0, -2, 0];

/* A wheel seen from the side: rim, four spokes turning with the frame. */
function wheel(g: Grid, cx: number, cy: number, r: number, frame: number): void {
  g.ellipse(cx, cy, r, r, C.wheel);
  g.ellipse(cx, cy, r - 1.4, r - 1.4, C.woodDark);
  for (let s = 0; s < 4; s++) {
    const a = (s * Math.PI) / 4 * 2 / 2 + (frame * Math.PI) / 8;
    g.line(cx - Math.cos(a) * (r - 1), cy - Math.sin(a) * (r - 1), cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1), C.wood);
  }
  g.set(cx, cy, C.hub);
}

/* A person walking, seen from the side, feet on y = base. */
function personSide(g: Grid, x: number, base: number, frame: number, tunic: string, tunicShade: string): void {
  const step = PERSON_STEP[frame];
  const bob = step === 0 ? 1 : 0;
  const top = base - 17 + bob;
  /* legs */
  g.line(x + 1, top + 11, x + 1 + step, base - 1, C.trousers);
  g.line(x + 2, top + 11, x + 2 - step, base - 1, C.trousers);
  g.set(x + 1 + step, base, C.boots); g.set(x + 2 + step, base, C.boots);
  g.set(x + 2 - step, base, C.boots); g.set(x + 3 - step, base, C.boots);
  /* tunic */
  g.rect(x, top + 5, x + 3, top + 11, tunic);
  g.rect(x, top + 9, x + 3, top + 11, tunicShade);
  g.set(x + 1, top + 9, C.harness); g.set(x + 2, top + 9, C.harness); /* belt */
  /* arm forward, holding the rein */
  g.line(x + 3, top + 6, x + 4, top + 8, tunicShade);
  g.set(x + 4, top + 9, C.skin);
  /* head and hat */
  g.rect(x + 1, top + 2, x + 3, top + 4, C.skin);
  g.set(x + 3, top + 3, C.skinShade);
  g.set(x + 1, top + 4, C.hair);
  g.rect(x, top + 1, x + 4, top + 1, C.hat);
  g.rect(x + 1, top, x + 3, top, C.hat);
  g.set(x + 2, top + 1, C.hatBand);
}

function drawSide(frame: number, color: Rgb): Grid {
  const g = new Grid(66, 32, 1);
  const base = 29;
  const cover = hex(color), coverShade = hex(color, 0.72);
  const step = HORSE_STEP[frame];
  const bob = frame % 2 === 1 ? 1 : 0;

  /* far wheel, behind the box */
  wheel(g, 9, base - 4, 4, frame + 1);
  /* covered top: an arch of cloth on hoops, the player's stripe along it,
     the side away from the light in shade */
  for (let x = 3; x <= 24; x++) {
    const top = 16 - Math.round(Math.sqrt(Math.max(0, 1 - ((x - 13.5) / 11) ** 2)) * 10);
    for (let y = top; y <= 16; y++) {
      const stripe = y === 9 || y === 10 ? cover : y === 11 ? coverShade : null;
      g.set(x, y, stripe ?? (x >= 17 || y >= 14 ? C.clothShade : C.cloth));
    }
  }
  for (const hx of [8, 13, 18]) g.line(hx, 7, hx, 15, C.clothDark);
  /* wagon box, plank lines */
  g.rect(2, 16, 25, 22, C.wood);
  g.rect(2, 16, 25, 16, C.woodLight);
  g.rect(2, 21, 25, 22, C.woodDark);
  for (let x = 7; x < 25; x += 6) g.line(x, 17, x, 20, C.woodDark);
  /* a barrel lashed on at the back */
  g.rect(0, 14, 2, 18, C.woodLight); g.set(1, 15, C.woodDark); g.set(1, 17, C.woodDark);
  /* near wheels */
  wheel(g, 8, base - 4, 5, frame);
  wheel(g, 21, base - 3, 4, frame);
  /* shafts to the horse */
  g.line(25, 19, 33, 17 + bob, C.woodDark);

  /* horse: far legs first, darker */
  const hx = 32;
  const legTop = 21 + bob;
  g.line(hx + 3, legTop, hx + 3 + step[3], base - 1, C.horseDark); g.set(hx + 3 + step[3], base, C.hoof);
  g.line(hx + 13, legTop, hx + 13 + step[1], base - 1, C.horseDark); g.set(hx + 13 + step[1], base, C.hoof);
  /* body */
  g.ellipse(hx + 8, 17 + bob, 8, 4.5, C.horse);
  g.rect(hx + 2, 14 + bob, hx + 13, 15 + bob, C.horseLight);
  g.rect(hx + 2, 20 + bob, hx + 14, 21 + bob, C.horseDark);
  /* harness: collar and strap */
  g.line(hx + 13, 13 + bob, hx + 14, 21 + bob, C.harness);
  g.line(hx + 3, 16 + bob, hx + 13, 16 + bob, C.harness);
  g.set(hx + 8, 16 + bob, C.gold);
  /* neck and head */
  g.line(hx + 14, 15 + bob, hx + 18, 9 + bob, C.horse);
  g.line(hx + 15, 16 + bob, hx + 19, 10 + bob, C.horse);
  g.line(hx + 13, 14 + bob, hx + 17, 9 + bob, C.mane);
  g.rect(hx + 17, 7 + bob, hx + 22, 10 + bob, C.horse);
  g.rect(hx + 21, 9 + bob, hx + 23, 11 + bob, C.muzzle);
  g.set(hx + 18, 6 + bob, C.horseDark); /* ear */
  g.set(hx + 20, 8 + bob, C.hoof); /* eye */
  /* tail */
  g.line(hx, 15 + bob, hx - 2, 21 + bob, C.mane);
  g.line(hx - 1, 15 + bob, hx - 3, 20 + bob, C.mane);
  /* near legs */
  g.line(hx + 4, legTop, hx + 4 + step[2], base - 1, C.horse); g.set(hx + 4 + step[2], base, C.hoof);
  g.line(hx + 14, legTop, hx + 14 + step[0], base - 1, C.horse); g.set(hx + 14 + step[0], base, C.hoof);

  /* the trader walks at the horse's head, rein in hand */
  personSide(g, 57, base, frame, cover, coverShade);
  g.line(hx + 22, 11 + bob, 61, 21 - (PERSON_STEP[frame] === 0 ? 0 : 1), C.harness);

  g.outline();
  return g;
}

function drawFront(frame: number, color: Rgb): Grid {
  const g = new Grid(36, 38);
  const base = 35;
  const cover = hex(color), coverShade = hex(color, 0.72);
  const step = HORSE_STEP[frame];
  const bob = frame % 2 === 1 ? 1 : 0;

  /* the wagon behind the horse: cover, box, wheels at the sides */
  g.ellipse(16, 12, 11, 9, C.cloth);
  g.rect(5, 12, 27, 20, C.cloth);
  g.rect(5, 6, 27, 8, cover);
  g.rect(5, 8, 27, 8, coverShade);
  /* the front of the cover, drawn together round a small opening */
  g.ellipse(16, 11, 4, 3, C.inside);
  for (const [x0, x1] of [[8, 12], [24, 20]]) g.line(x0, 5, x1, 12, C.clothShade);
  g.rect(5, 12, 27, 18, C.clothShade);
  g.rect(5, 19, 27, 24, C.wood);
  g.rect(5, 19, 27, 19, C.woodLight);
  g.rect(3, 18, 5, 29, C.wheel); g.rect(27, 18, 29, 29, C.wheel);
  g.line(4, 19 + (frame % 2), 4, 28 - (frame % 2), C.woodDark);
  g.line(28, 19 + (frame % 2), 28, 28 - (frame % 2), C.woodDark);

  /* horse coming toward the viewer */
  g.rect(12, 20 + bob, 20, 27 + bob, C.horse);
  g.rect(12, 20 + bob, 13, 27 + bob, C.horseLight);
  g.line(12, 21 + bob, 20, 21 + bob, C.harness);
  g.set(16, 21 + bob, C.gold);
  /* legs, alternating */
  g.rect(13, 28 + bob, 14, base - 1 - Math.max(0, step[0]), C.horse);
  g.rect(18, 28 + bob, 19, base - 1 - Math.max(0, step[1]), C.horse);
  g.set(13, base - Math.max(0, step[0]), C.hoof); g.set(14, base - Math.max(0, step[0]), C.hoof);
  g.set(18, base - Math.max(0, step[1]), C.hoof); g.set(19, base - Math.max(0, step[1]), C.hoof);
  /* head */
  g.rect(14, 13 + bob, 18, 21 + bob, C.horse);
  g.rect(14, 19 + bob, 18, 21 + bob, C.muzzle);
  g.line(16, 12 + bob, 16, 16 + bob, C.mane);
  g.set(14, 12 + bob, C.horseDark); g.set(18, 12 + bob, C.horseDark);
  g.set(14, 16 + bob, C.hoof); g.set(18, 16 + bob, C.hoof);

  /* the trader at the horse's side, facing the viewer */
  const tx = 25, ps = PERSON_STEP[frame], pb = ps === 0 ? 1 : 0;
  const top = base - 17 + pb;
  g.rect(tx + 1, top + 11, tx + 1, base - 1 - (ps > 0 ? 1 : 0), C.trousers);
  g.rect(tx + 3, top + 11, tx + 3, base - 1 - (ps < 0 ? 1 : 0), C.trousers);
  g.set(tx + 1, base - (ps > 0 ? 1 : 0), C.boots); g.set(tx + 3, base - (ps < 0 ? 1 : 0), C.boots);
  g.rect(tx, top + 5, tx + 4, top + 11, cover);
  g.rect(tx, top + 9, tx + 4, top + 11, coverShade);
  g.rect(tx, top + 9, tx + 4, top + 9, C.harness);
  g.rect(tx + 1, top + 2, tx + 3, top + 4, C.skin);
  g.set(tx + 1, top + 3, C.hoof); g.set(tx + 3, top + 3, C.hoof);
  g.rect(tx, top + 1, tx + 4, top + 1, C.hat); g.rect(tx + 1, top, tx + 3, top, C.hat);
  g.line(tx - 1, top + 7, 18, 19 + bob, C.harness);

  g.outline();
  return g;
}

function drawBack(frame: number, color: Rgb): Grid {
  const g = new Grid(38, 36, 2);
  const base = 33;
  const cover = hex(color), coverShade = hex(color, 0.72);
  const bob = frame % 2 === 1 ? 1 : 0;

  /* the horse ahead shows only its ears and back above the cover */
  g.rect(15, 2 + bob, 15, 3 + bob, C.horseDark); g.rect(18, 2 + bob, 18, 3 + bob, C.horseDark);
  g.rect(14, 4 + bob, 19, 6 + bob, C.horse);
  /* wagon from behind */
  g.ellipse(17, 14, 12, 9, C.cloth);
  g.rect(5, 14, 29, 22, C.cloth);
  g.rect(5, 8, 29, 10, cover);
  g.rect(5, 10, 29, 10, coverShade);
  g.ellipse(17, 17, 7, 5, C.inside);
  g.rect(12, 18, 15, 21, C.woodLight); g.set(13, 19, C.woodDark); /* a crate inside */
  g.rect(18, 19, 21, 21, C.clothDark); /* a sack */
  g.rect(5, 21, 29, 26, C.wood);
  g.rect(5, 21, 29, 21, C.woodLight);
  g.line(5, 24, 29, 24, C.woodDark);
  g.rect(3, 20, 5, 31, C.wheel); g.rect(29, 20, 31, 31, C.wheel);
  g.line(4, 21 + (frame % 2), 4, 30 - (frame % 2), C.woodDark);
  g.line(30, 21 + (frame % 2), 30, 30 - (frame % 2), C.woodDark);

  /* the trader at the left, walking away */
  const tx = 0, ps = PERSON_STEP[frame], pb = ps === 0 ? 1 : 0;
  const top = base - 17 + pb;
  g.rect(tx + 1, top + 11, tx + 1, base - 1 - (ps > 0 ? 1 : 0), C.trousers);
  g.rect(tx + 3, top + 11, tx + 3, base - 1 - (ps < 0 ? 1 : 0), C.trousers);
  g.set(tx + 1, base - (ps > 0 ? 1 : 0), C.boots); g.set(tx + 3, base - (ps < 0 ? 1 : 0), C.boots);
  g.rect(tx, top + 5, tx + 4, top + 11, cover);
  g.rect(tx, top + 9, tx + 4, top + 11, coverShade);
  g.rect(tx + 1, top + 2, tx + 3, top + 4, C.hair);
  g.rect(tx, top + 1, tx + 4, top + 1, C.hat); g.rect(tx + 1, top, tx + 3, top, C.hat);

  g.outline();
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
