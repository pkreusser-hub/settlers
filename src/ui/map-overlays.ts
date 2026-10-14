// Overlays of the map view: the land of each player or team, how loaded the
// player's roads are, and a status badge over the player's buildings. Not
// part of Freeserf.
//
// Reading only: nothing here changes the game. The viewport draws the
// overlays as layers of its own picture (ViewportLayer.LayerTerritory,
// LayerTraffic, LayerBadges in viewport.ts), so they scroll, wrap and zoom
// with the map; a layer that is off is not computed and not drawn.
//
// What costs time is split in two. The roads and the buildings are read at
// most twice a second into small tables (refreshOverlayData); a draw only
// looks the visible points up in them.

import { BuildingType, ProductionHold } from '../game/building';
import type { Building } from '../game/building';
import type { Flag } from '../game/flag';
import type { Game } from '../game/game';
import { MapObject } from '../game/map';
import type { Map as GameMap, MapPos } from '../game/map';
import { Direction, reverseDirection } from '../game/map-geometry';
import type { Player } from '../game/player';
import { ResourceType } from '../game/resource';
import { isGuard, wantsWorker } from './alerts';
import { Graphics } from './gfx';
import type { Interface } from './interface';
import { prefSetString, prefString } from './prefs';
import { buildingName } from './production';
import { ViewportLayer } from './viewport';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/* The points of the map in and around the view, row by row: what the
   viewport hands to the draw functions. Point i of row j is at
   x = x0 + 32 * i (16 less in the odd rows), y[j * cols + i]. The outer
   ring of points is a margin: it is read, not drawn. */
export interface OverlayGrid {
  cols: number;
  rows: number;
  x0: number;
  pos: Int32Array;
  y: Int16Array;
  /* The point the patterns start at; it has to move with the map. */
  anchorX: number;
  anchorY: number;
  /* Device pixels per pixel of the map. */
  scale: number;
}

// ---------------------------------------------------------------------------
// Colours: the meaning colours of theme.css, read once.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const themeColors = new Map<string, Rgb>();

function themeColor(name: string, fallback: string): Rgb {
  const cached = themeColors.get(name);
  if (cached !== undefined) return cached;
  let text = '';
  try {
    text = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  } catch {
    text = '';
  }
  const hex = /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
  const rgb = {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
  themeColors.set(name, rgb);
  return rgb;
}

function rgba(c: Rgb, alpha: number): string {
  return `rgba(${c.r},${c.g},${c.b},${alpha})`;
}

function cssColor(c: Rgb): string {
  return `rgb(${c.r},${c.g},${c.b})`;
}

// ---------------------------------------------------------------------------
// Territory

export type TerritoryMode = 'players' | 'teams';

/* How a kind of land is told apart without its colour: the fill and the
   line of its border. */
export type LandStyle = 'own' | 'other' | 'neutral';

export interface LandClass {
  label: string;
  color: Rgb;
  style: LandStyle;
}

export function getTerritoryMode(): TerritoryMode {
  return prefString('view.territoryMode', 'players') === 'teams' ? 'teams' : 'players';
}

export function setTerritoryMode(mode: TerritoryMode): void {
  prefSetString('view.territoryMode', mode);
}

/* The mode in use: by team only in a game that has teams. */
export function territoryModeFor(game: Game): TerritoryMode {
  return getTerritoryMode() === 'teams' && game.hasTeams() ? 'teams' : 'players';
}

const MAX_PLAYERS = 4;

/* The classes of land of the game in the mode, and the class of each
   player (-1: not in the game). Also the legend of the overlay and the
   colours of the minimap panel. */
export function landClasses(
  game: Game,
  local: Player | null,
  mode: TerritoryMode,
): { classes: LandClass[]; ofPlayer: Int8Array } {
  const classes: LandClass[] = [];
  const ofPlayer = new Int8Array(MAX_PLAYERS).fill(-1);
  const me = local === null ? -1 : local.getIndex();

  if (mode === 'teams') {
    const own: LandClass = { label: 'Your team', color: themeColor('--gx-info', '#6fb7e8'), style: 'own' };
    const enemy: LandClass = { label: 'Enemy team', color: themeColor('--gx-bad', '#ff7d66'), style: 'other' };
    const none: LandClass = { label: 'No team', color: themeColor('--gx-warn', '#f0a23a'), style: 'neutral' };
    const all = [own, enemy, none];
    const used = [false, false, false];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const player = game.getPlayer(i);
      if (player === null) continue;
      let c: number;
      if (i === me || (me >= 0 && game.isAllied(me, i))) c = 0;
      else if (player.getTeam() !== 0) c = 1;
      else c = 2;
      used[c] = true;
      ofPlayer[i] = c;
    }
    /* Only the classes of this game, in the order above. */
    const index = [-1, -1, -1];
    for (let c = 0; c < 3; c++) {
      if (!used[c]) continue;
      index[c] = classes.length;
      classes.push(all[c]);
    }
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (ofPlayer[i] >= 0) ofPlayer[i] = index[ofPlayer[i]];
    }
    return { classes, ofPlayer };
  }

  for (let i = 0; i < MAX_PLAYERS; i++) {
    const player = game.getPlayer(i);
    if (player === null) continue;
    const color = player.getColor();
    ofPlayer[i] = classes.length;
    classes.push({
      label: i === me ? 'You' : `Player ${i + 1}`,
      color: { r: color.red, g: color.green, b: color.blue },
      style: i === me ? 'own' : 'other',
    });
  }
  return { classes, ofPlayer };
}

/* The fills that are not flat, as tiles of 8 pixels: stripes for the land
   of the others, dots for land without a team. */
const patternTiles = new Map<string, HTMLCanvasElement>();

export function landPatternTile(c: LandClass): HTMLCanvasElement {
  const key = `${c.style}:${c.color.r},${c.color.g},${c.color.b}`;
  let tile = patternTiles.get(key);
  if (tile !== undefined) return tile;
  tile = document.createElement('canvas');
  tile.width = 8;
  tile.height = 8;
  const t = tile.getContext('2d');
  if (t !== null) {
    if (c.style === 'own') {
      t.fillStyle = rgba(c.color, 0.3);
      t.fillRect(0, 0, 8, 8);
    } else if (c.style === 'other') {
      t.fillStyle = rgba(c.color, 0.14);
      t.fillRect(0, 0, 8, 8);
      t.strokeStyle = rgba(c.color, 0.62);
      t.lineWidth = 2;
      t.beginPath();
      for (const off of [-8, 0, 8]) {
        t.moveTo(off - 1, 9);
        t.lineTo(off + 9, -1);
      }
      t.stroke();
    } else {
      t.fillStyle = rgba(c.color, 0.14);
      t.fillRect(0, 0, 8, 8);
      t.fillStyle = rgba(c.color, 0.7);
      t.fillRect(1, 1, 2, 2);
      t.fillRect(5, 5, 2, 2);
    }
  }
  patternTiles.set(key, tile);
  return tile;
}

const borderDash: Record<LandStyle, number[]> = {
  own: [],
  other: [7, 5],
  neutral: [2, 4],
};

export function landBorderDash(style: LandStyle): number[] {
  return borderDash[style];
}

/* Fill a grid with the points around a part of the map view: `base` is the
   point at (xOff, yOff) of the picture, which is width by height pixels.
   Two rows above and one column left of it, and as far below as the
   highest ground reaches up into the picture. The arrays of `store` are
   used again when they are large enough. */
export function fillGrid(
  map: GameMap,
  base: MapPos,
  xOff: number,
  yOff: number,
  width: number,
  height: number,
  store: { pos: Int32Array; y: Int16Array },
): OverlayGrid {
  const cols = Math.ceil(width / 32) + 5;
  const rows = Math.ceil((height + 4 * 31) / 20) + 6;
  if (store.pos.length < cols * rows) {
    store.pos = new Int32Array(cols * rows);
    store.y = new Int16Array(cols * rows);
  }
  const gridPos = store.pos;
  const gridY = store.y;

  let rowPos = map.moveLeft(map.moveUpLeft(map.moveUp(base)));
  let yBase = yOff - 40;
  let k = 0;
  for (let j = 0; j < rows; j++) {
    let pos = rowPos;
    for (let i = 0; i < cols; i++) {
      gridPos[k] = pos;
      gridY[k] = yBase - 4 * map.getHeight(pos);
      k += 1;
      pos = map.moveRight(pos);
    }
    rowPos = (j & 1) === 0 ? map.moveDown(rowPos) : map.moveDownRight(rowPos);
    yBase += 20;
  }
  return { cols, rows, x0: xOff - 32, pos: gridPos, y: gridY, anchorX: 0, anchorY: 0, scale: 1 };
}

let classOfCell = new Int8Array(0);

/* The class of land of each point of the grid, into classOfCell. The
   result tells the picture apart from another: it changes with the owners
   and the heights. 0: nobody owns a point of the grid. */
function classifyGrid(grid: OverlayGrid, map: GameMap, ofPlayer: Int8Array): number {
  const { cols, rows, pos, y } = grid;
  const cells = cols * rows;
  if (classOfCell.length < cells) classOfCell = new Int8Array(cells);
  const cls = classOfCell;
  let any = false;
  let signature = 0;
  for (let k = 0; k < cells; k++) {
    const p = pos[k];
    const c = map.hasOwner(p) ? ofPlayer[map.getOwner(p)] : -1;
    cls[k] = c;
    if (c >= 0) any = true;
    signature = (Math.imul(signature, 31) + (c + 2) * 4096 + y[k]) | 0;
  }
  if (!any) return 0;
  return signature === 0 ? 1 : signature;
}

/* Tint the triangles of the landscape whose three corners belong to the
   same class (classOfCell), and draw a line where such land ends. The
   corners keep their heights, so the tint lies on the ground. */
function paintTerritory(ctx: Ctx, grid: OverlayGrid, classes: LandClass[], line: number): void {
  const { cols, rows, y } = grid;
  const cls = classOfCell;

  const fills: Path2D[] = classes.map(() => new Path2D());
  const edges: Path2D[] = classes.map(() => new Path2D());
  const used: boolean[] = classes.map(() => false);

  /* Everything is drawn relative to the anchor, so the patterns stay on
     the ground when the map moves. */
  const ax = grid.anchorX;
  const ay = grid.anchorY;
  const bx = grid.x0 - ax;

  for (let j = 1; j < rows - 2; j++) {
    const odd = j & 1;
    const row = j * cols;
    for (let i = 1; i < cols - 2; i++) {
      const k = row + i;
      const o = cls[k];
      if (o < 0) continue;
      const kR = k + 1;
      const kD = k + cols - odd;
      const kDR = kD + 1;
      const oR = cls[kR];
      const oD = cls[kD];
      const oDR = cls[kDR];
      if (oDR !== o || (oD !== o && oR !== o)) continue;

      const xP = bx + 32 * i - 16 * odd;
      const yP = y[k] - ay;
      const yDR = y[kDR] - ay;
      used[o] = true;

      if (oD === o) {
        /* The triangle below the point. */
        const yD = y[kD] - ay;
        const f = fills[o];
        f.moveTo(xP, yP);
        f.lineTo(xP + 16, yDR);
        f.lineTo(xP - 16, yD);
        f.closePath();
        const e = edges[o];
        if (oR !== o) {
          e.moveTo(xP, yP);
          e.lineTo(xP + 16, yDR);
        }
        if (cls[k + 2 * cols] !== o) {
          e.moveTo(xP + 16, yDR);
          e.lineTo(xP - 16, yD);
        }
        if (cls[k - 1] !== o) {
          e.moveTo(xP - 16, yD);
          e.lineTo(xP, yP);
        }
      }
      if (oR === o) {
        /* The triangle to the right of the point. */
        const yR = y[kR] - ay;
        const f = fills[o];
        f.moveTo(xP, yP);
        f.lineTo(xP + 32, yR);
        f.lineTo(xP + 16, yDR);
        f.closePath();
        const e = edges[o];
        if (cls[k - cols + 1 - odd] !== o) {
          e.moveTo(xP, yP);
          e.lineTo(xP + 32, yR);
        }
        if (cls[kDR + 1] !== o) {
          e.moveTo(xP + 32, yR);
          e.lineTo(xP + 16, yDR);
        }
        if (oD !== o) {
          e.moveTo(xP + 16, yDR);
          e.lineTo(xP, yP);
        }
      }
    }
  }

  ctx.save();
  ctx.translate(ax, ay);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  for (let c = 0; c < classes.length; c++) {
    if (!used[c]) continue;
    const pattern = ctx.createPattern(landPatternTile(classes[c]), 'repeat');
    ctx.fillStyle = pattern ?? rgba(classes[c].color, 0.3);
    ctx.fill(fills[c]);
  }
  for (let c = 0; c < classes.length; c++) {
    if (!used[c]) continue;
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = line + 2;
    ctx.stroke(edges[c]);
    ctx.setLineDash(borderDash[classes[c].style]);
    ctx.strokeStyle = rgba(classes[c].color, 0.95);
    ctx.lineWidth = line;
    ctx.stroke(edges[c]);
  }
  ctx.restore();
}

/* Filling thousands of triangles is too slow to do on every draw of the
   view (some 60 ms for a full screen), and the land changes seldom. So the
   tint is kept as pictures, cut the way the viewport cuts the landscape:
   tiles of 16 by 16 points of the map, 512 by 320 pixels. A draw copies
   the tiles in view. A tile is painted when it is first seen and again
   when its owners or heights changed, which is looked at twice a second. */
const TILE_COLS = 16;
const TILE_ROWS = 16;
const TILE_W = TILE_COLS * 32;
const TILE_H = TILE_ROWS * 20;
const TILE_CHECK_MS = 500;

interface TerritoryTile {
  /* Null: nobody owns land here. */
  canvas: HTMLCanvasElement | null;
  signature: number;
  checked: number;
  lastUse: number;
}

const territory = {
  map: null as GameMap | null,
  /* What all tiles were painted for: the classes and the line width. */
  key: '',
  tiles: new Map<number, TerritoryTile>(),
  use: 0,
  store: { pos: new Int32Array(0), y: new Int16Array(0) },
};

export function dropTerritoryTiles(): void {
  territory.tiles.clear();
  territory.map = null;
  territory.key = '';
}

function territoryTile(
  map: GameMap,
  tid: number,
  tc: number,
  tr: number,
  classes: LandClass[],
  ofPlayer: Int8Array,
  line: number,
  now: number,
): TerritoryTile {
  let tile = territory.tiles.get(tid);
  if (tile !== undefined && now - tile.checked < TILE_CHECK_MS) return tile;

  /* The point at the corner of the tile, as Viewport::get_tile_frame. */
  const col = (tc * TILE_COLS + ((tr * TILE_ROWS) >> 1)) % map.getCols();
  const grid = fillGrid(map, map.pos(col, tr * TILE_ROWS), 0, 0, TILE_W, TILE_H, territory.store);
  const signature = classifyGrid(grid, map, ofPlayer);
  if (tile !== undefined && tile.signature === signature) {
    tile.checked = now;
    return tile;
  }

  let canvas: HTMLCanvasElement | null = null;
  if (signature !== 0) {
    canvas = tile?.canvas ?? document.createElement('canvas');
    canvas.width = TILE_W;
    canvas.height = TILE_H;
    const ctx = canvas.getContext('2d');
    if (ctx !== null) paintTerritory(ctx, grid, classes, line);
  }
  /* Not all tiles are looked at in the same draw: each has its own phase. */
  const checked = tile !== undefined ? now : now - ((tid * 61) % TILE_CHECK_MS);
  tile = { canvas, signature, checked, lastUse: territory.use };
  territory.tiles.set(tid, tile);
  return tile;
}

/* Draw the tint over the view: (offsetX, offsetY) is the pixel of the map
   at its top left corner. The loop is the one of Viewport::draw_landscape. */
export function drawTerritory(
  ctx: Ctx,
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
  scale: number,
  game: Game,
  local: Player | null,
): void {
  const map = game.getMap();
  const { classes, ofPlayer } = landClasses(game, local, territoryModeFor(game));
  if (classes.length === 0) return;

  /* Lines of at least one and a half device pixels at every scale. */
  const line = scale < 1 ? 3 : 2;
  const key = `${line}|` + classes.map((c) => `${c.style}:${c.color.r},${c.color.g},${c.color.b}`).join('|') +
    `|${ofPlayer.join(',')}`;
  if (map !== territory.map || key !== territory.key) {
    territory.tiles.clear();
    territory.map = map;
    territory.key = key;
  }
  territory.use += 1;
  const now = performance.now();

  const horizTiles = Math.trunc(map.getCols() / TILE_COLS);
  const vertTiles = Math.trunc(map.getRows() / TILE_ROWS);
  const mapWidth = map.getCols() * 32;
  const mapHeight = map.getRows() * 20;
  let inView = 0;

  let my = offsetY;
  let ly = 0;
  let xBase = 0;
  while (ly < height) {
    while (my >= mapHeight) {
      my -= mapHeight;
      xBase += (map.getRows() * 32) >> 1;
    }
    const ty = my % TILE_H;
    let lx = 0;
    let mx = (offsetX + xBase) % mapWidth;
    while (lx < width) {
      const tx = mx % TILE_W;
      const tc = Math.trunc(mx / TILE_W) % horizTiles;
      const tr = Math.trunc(my / TILE_H) % vertTiles;
      const tile = territoryTile(map, tc + horizTiles * tr, tc, tr, classes, ofPlayer, line, now);
      tile.lastUse = territory.use;
      inView += 1;
      if (tile.canvas !== null) {
        const w = Math.min(TILE_W - tx, width - lx);
        const h = Math.min(TILE_H - ty, height - ly);
        ctx.drawImage(tile.canvas, tx, ty, w, h, lx, ly, w, h);
      }
      lx += TILE_W - tx;
      mx += TILE_W - tx;
    }
    ly += TILE_H - ty;
    my += TILE_H - ty;
  }

  /* Keep the tiles in view and about as many more. */
  const limit = Math.max(48, 2 * inView);
  if (territory.tiles.size > limit) {
    for (const [tid, tile] of territory.tiles) {
      if (tile.lastUse !== territory.use) territory.tiles.delete(tid);
      if (territory.tiles.size <= limit) break;
    }
  }
}

// ---------------------------------------------------------------------------
// Traffic

export const trafficLevels: { label: string; title: string; color: [string, string]; width: number }[] = [
  {
    label: 'Quiet',
    title: 'Nothing waits at the flags of the road',
    color: ['--gx-info', '#6fb7e8'],
    width: 2,
  },
  {
    label: 'Steady',
    title: 'Goods wait for a carrier now and then',
    color: ['--gx-warn', '#f0a23a'],
    width: 4,
  },
  {
    label: 'Congested',
    title: 'Three or more goods keep waiting at a flag of the road',
    color: ['--gx-bad', '#ff7d66'],
    width: 6,
  },
];

/* A colour of theme.css as "rgb(r,g,b)". */
export function themeCss(color: [string, string]): string {
  return cssColor(themeColor(color[0], color[1]));
}

/* What is known of the roads and buildings of the local player. */
interface OverlayData {
  game: Game | null;
  player: Player | null;
  /* Traffic: the level (1 to 3, 0 no road of the player) of the road
     segment that leaves a point to the right, down right and down. */
  segments: Uint8Array;
  hasTraffic: boolean;
  /* How long goods have been waiting at each end of each road, by
     flag index * 8 + direction: see roadHeat(). */
  heat: Map<number, number>;
  heatTick: number;
  /* Badges: the kind for the position of each building that has one. */
  badges: Map<MapPos, BadgeKind>;
  hasBadges: boolean;
  signature: number;
}

const data: OverlayData = {
  game: null,
  player: null,
  segments: new Uint8Array(0),
  hasTraffic: false,
  heat: new Map(),
  heatTick: -1,
  badges: new Map(),
  hasBadges: false,
  signature: 0,
};

const HEAT_MAX = 12;
const HEAT_CONGESTED = 8;
const HEAT_STEADY = 2;

/* The goods at the flag that wait for the road in the direction. */
function waitingFor(flag: Flag, dir: Direction): number {
  let n = 0;
  for (const slot of flag.slot) {
    if (slot.type !== ResourceType.TypeNone && slot.dir === dir) n += 1;
  }
  return n;
}

/* One look at a flag is a moment: three goods wait at any busy flag now
   and then. The heat of a road end rises while goods wait there and falls
   when none do, so a road is congested only when it stays crowded for
   some seconds. step: the game went on since the last look. */
function roadHeat(old: number, waiting: number, step: boolean): number {
  if (!step) return old;
  if (waiting >= 3) return Math.min(HEAT_MAX, old + 3);
  if (waiting >= 1) return old < 4 ? old + 1 : old - 1;
  return Math.max(0, old - 2);
}

function readTraffic(game: Game, player: Player): number {
  const map = game.getMap();
  const size = (map.pos(map.getCols() - 1, map.getRows() - 1) + 1) * 3;
  if (data.segments.length !== size) data.segments = new Uint8Array(size);
  else data.segments.fill(0);
  const segments = data.segments;

  const tick = game.getTick();
  const step = tick !== data.heatTick;
  data.heatTick = tick;
  const heat = new Map<number, number>();
  const busyRule = game.hasBusyRoads();
  const owner = player.getIndex();
  let signature = 0;

  for (const flag of game.flags) {
    if (flag.getIndex() === 0 || flag.getOwner() !== owner) continue;
    for (let d: Direction = Direction.DirectionRight; d <= Direction.DirectionUp; d++) {
      if (!flag.hasPath(d)) continue;
      /* The step up left to a building is no road. */
      if (d === Direction.DirectionUpLeft && flag.hasBuilding()) continue;

      const key = flag.getIndex() * 8 + d;
      const h = roadHeat(data.heat.get(key) ?? 0, waitingFor(flag, d), step);
      if (h > 0) heat.set(key, h);

      /* With the rule of the extra carriers the game measures the load
         itself (Flag.extLoad, extRoadBusy); without it, and for the roads
         the rule leaves out, the goods that wait tell. */
      let level = 1;
      if (h >= HEAT_CONGESTED || (busyRule && flag.extRoadBusy(d))) level = 3;
      else if (h >= HEAT_STEADY || (busyRule && flag.extLoad[d] > 0)) level = 2;

      /* Follow the road to its other flag. Both ends do: the higher level
         stays. */
      let p = flag.getPosition();
      let dir = d;
      for (let n = 0; n < 512; n++) {
        const q = map.move(p, dir);
        const at = dir <= Direction.DirectionDown ? p * 3 + dir : q * 3 + reverseDirection(dir);
        if (segments[at] < level) segments[at] = level;
        signature = (Math.imul(signature, 31) + at * 4 + level) | 0;
        p = q;
        if (map.hasFlag(p)) break;
        const next = map.paths(p) & ~(1 << reverseDirection(dir));
        if (next === 0) break;
        dir = (31 - Math.clz32(next & -next)) as Direction;
      }
    }
  }
  data.heat = heat;
  data.hasTraffic = true;
  return signature;
}

const levelPaths: Path2D[] = [];

export function drawTraffic(ctx: Ctx, grid: OverlayGrid, game: Game, local: Player | null): void {
  if (local === null) return;
  ensureOverlayData(game, local, true, false);
  const segments = data.segments;
  const { cols, rows, pos, y, x0 } = grid;

  let any = 0;
  for (let l = 0; l < 3; l++) levelPaths[l] = new Path2D();
  for (let j = 1; j < rows - 1; j++) {
    const odd = j & 1;
    const row = j * cols;
    for (let i = 1; i < cols - 1; i++) {
      const k = row + i;
      const at = pos[k] * 3;
      const right = segments[at];
      const downRight = segments[at + 1];
      const down = segments[at + 2];
      if ((right | downRight | down) === 0) continue;
      any = 1;
      const xP = x0 + 32 * i - 16 * odd;
      const yP = y[k];
      const kD = k + cols - odd;
      if (right !== 0) {
        levelPaths[right - 1].moveTo(xP, yP);
        levelPaths[right - 1].lineTo(xP + 32, y[k + 1]);
      }
      if (downRight !== 0) {
        levelPaths[downRight - 1].moveTo(xP, yP);
        levelPaths[downRight - 1].lineTo(xP + 16, y[kD + 1]);
      }
      if (down !== 0) {
        levelPaths[down - 1].moveTo(xP, yP);
        levelPaths[down - 1].lineTo(xP - 16, y[kD]);
      }
    }
  }
  if (any === 0) return;

  const grow = grid.scale < 1 ? 2 : 0;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  /* A dark edge under each line: the colours read on grass, sand and
     snow alike. */
  for (let l = 0; l < 3; l++) {
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = trafficLevels[l].width + grow + 2;
    ctx.stroke(levelPaths[l]);
  }
  for (let l = 0; l < 3; l++) {
    ctx.strokeStyle = themeCss(trafficLevels[l].color);
    ctx.lineWidth = trafficLevels[l].width + grow;
    ctx.stroke(levelPaths[l]);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Badges

/* In the order that decides which one a building shows. */
export enum BadgeKind {
  None = 0,
  Paused = 1,
  Capped = 2,
  Upgrading = 3,
  NoWorker = 4,
  Materials = 5,
  NoKnight = 6,
}

export const badgeKinds: { kind: BadgeKind; label: string; shape: string; color: [string, string] }[] = [
  { kind: BadgeKind.Paused, label: 'Paused', shape: 'two bars', color: ['--gx-warn', '#f0a23a'] },
  { kind: BadgeKind.Capped, label: 'Output cap reached', shape: 'a box under a line', color: ['--gx-info', '#6fb7e8'] },
  { kind: BadgeKind.Upgrading, label: 'Upgrading', shape: 'an arrow up', color: ['--gx-good', '#7fdc5c'] },
  { kind: BadgeKind.NoWorker, label: 'No worker yet', shape: 'an empty figure', color: ['--gx-text-strong', '#fff6d8'] },
  { kind: BadgeKind.Materials, label: 'Waiting for materials', shape: 'an hourglass', color: ['--gx-accent', '#e2c770'] },
  { kind: BadgeKind.NoKnight, label: 'No knight inside', shape: 'an empty shield', color: ['--gx-bad', '#ff7d66'] },
];

export function badgeLabel(kind: BadgeKind): string {
  return badgeKinds.find((b) => b.kind === kind)?.label ?? '';
}

/* The one badge of a building, BadgeKind.None without. The tests are the
   ones of the alerts (alerts.ts) and of the building window
   (menu/building-info.ts), without their waiting times: a badge shows the
   state of now. */
export function badgeOf(building: Building): BadgeKind {
  if (building.isBurning()) return BadgeKind.None;
  const type = building.getType();
  if (type === BuildingType.TypeNone || type === BuildingType.TypeCastle) return BadgeKind.None;

  if (building.isProductionPaused()) return BadgeKind.Paused;
  const done = building.isDone();
  const hold = done ? building.getProductionHold() : ProductionHold.None;
  if (hold === ProductionHold.Capped) return BadgeKind.Capped;
  if (building.isUpgrading()) return BadgeKind.Upgrading;

  if (!done) {
    /* A site: the digger or the builder is not here, or he is and has
       nothing to build with (planks are stock 0 and stones stock 1,
       `maximum` is what is still to come). */
    if (!building.hasSerf()) return BadgeKind.NoWorker;
    let wanted = 0;
    let there = 0;
    for (let j = 0; j < 2; j++) {
      if (building.getMaximumInStock(j) <= 0) continue;
      wanted += 1;
      if (building.getResCountInStock(j) > 0) there += 1;
    }
    return wanted > 0 && there === 0 ? BadgeKind.Materials : BadgeKind.None;
  }

  if (isGuard(type)) {
    return building.getKnightCount() === 0 ? BadgeKind.NoKnight : BadgeKind.None;
  }
  if (!building.hasSerf()) {
    return wantsWorker(type) ? BadgeKind.NoWorker : BadgeKind.None;
  }
  if (type === BuildingType.TypeStock) return BadgeKind.None;
  /* An input stock is empty: the work stands still. */
  for (let j = 0; j < 2; j++) {
    if (!building.isStockActive(j)) continue;
    if (building.getMaximumInStock(j) > 0 && building.getResCountInStock(j) === 0) {
      return BadgeKind.Materials;
    }
  }
  return BadgeKind.None;
}

function readBadges(game: Game, player: Player): number {
  const badges = new Map<MapPos, BadgeKind>();
  const owner = player.getIndex();
  let signature = 0;
  for (const building of game.buildings) {
    if (building.getIndex() === 0 || building.getOwner() !== owner) continue;
    const kind = badgeOf(building);
    if (kind === BadgeKind.None) continue;
    const pos = building.getPosition();
    badges.set(pos, kind);
    signature = (Math.imul(signature, 31) + pos * 8 + kind) | 0;
  }
  data.badges = badges;
  data.hasBadges = true;
  return signature;
}

/* The pictures of the badges: a dark plate with a shape in the colour of
   the kind, drawn here. `size` is the edge in pixels. */
const badgeCanvases = new Map<number, HTMLCanvasElement>();

export function badgeCanvas(kind: BadgeKind, size: number): HTMLCanvasElement {
  const key = kind * 1024 + size;
  let canvas = badgeCanvases.get(key);
  if (canvas !== undefined) return canvas;
  canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  const info = badgeKinds.find((b) => b.kind === kind);
  if (c !== null && info !== undefined) {
    const color = themeCss(info.color);
    /* All shapes are laid out on a square of 16. */
    c.scale(size / 16, size / 16);
    c.fillStyle = 'rgba(18,20,12,0.94)';
    c.strokeStyle = color;
    c.lineWidth = 1.25;
    c.beginPath();
    c.roundRect(0.75, 0.75, 14.5, 14.5, 3);
    c.fill();
    c.stroke();
    c.fillStyle = color;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.lineWidth = 1.5;
    c.beginPath();
    switch (kind) {
      case BadgeKind.Paused:
        c.rect(4.5, 4, 2.5, 8);
        c.rect(9, 4, 2.5, 8);
        c.fill();
        break;
      case BadgeKind.Capped:
        c.rect(3.5, 3.5, 9, 1.5);
        c.rect(5, 7, 6, 5.5);
        c.fill();
        break;
      case BadgeKind.Upgrading:
        c.moveTo(8, 3);
        c.lineTo(12.5, 8.5);
        c.lineTo(9.5, 8.5);
        c.lineTo(9.5, 13);
        c.lineTo(6.5, 13);
        c.lineTo(6.5, 8.5);
        c.lineTo(3.5, 8.5);
        c.closePath();
        c.fill();
        break;
      case BadgeKind.NoWorker:
        c.arc(8, 5.6, 2.1, 0, Math.PI * 2);
        c.moveTo(4.2, 12.8);
        c.quadraticCurveTo(4.2, 8.8, 8, 8.8);
        c.quadraticCurveTo(11.8, 8.8, 11.8, 12.8);
        c.stroke();
        break;
      case BadgeKind.Materials:
        c.moveTo(4.5, 3.5);
        c.lineTo(11.5, 3.5);
        c.lineTo(4.5, 12.5);
        c.lineTo(11.5, 12.5);
        c.closePath();
        c.stroke();
        c.beginPath();
        c.moveTo(8, 9);
        c.lineTo(10.6, 12.2);
        c.lineTo(5.4, 12.2);
        c.closePath();
        c.fill();
        break;
      case BadgeKind.NoKnight:
        c.moveTo(4, 3.5);
        c.lineTo(12, 3.5);
        c.lineTo(12, 8);
        c.quadraticCurveTo(12, 11.5, 8, 13);
        c.quadraticCurveTo(4, 11.5, 4, 8);
        c.closePath();
        c.stroke();
        break;
      default:
        break;
    }
  }
  badgeCanvases.set(key, canvas);
  return canvas;
}

/* Where the badges of the last draw are, in pixels of the map view: the
   pointer asks (badgeAt). */
interface BadgeHit {
  x: number;
  y: number;
  size: number;
  pos: MapPos;
  kind: BadgeKind;
}

let badgeHits: BadgeHit[] = [];

export function drawBadges(ctx: Ctx, grid: OverlayGrid, game: Game, local: Player | null): void {
  badgeHits = [];
  if (local === null) return;
  ensureOverlayData(game, local, false, true);
  const badges = data.badges;
  if (badges.size === 0) return;

  const map = game.getMap();
  const { cols, rows, pos, y, x0 } = grid;
  /* About 12 device pixels at the smallest scale of the map. */
  const size = grid.scale < 1 ? 24 : 16;
  for (let j = 1; j < rows - 1; j++) {
    const odd = j & 1;
    const row = j * cols;
    for (let i = 1; i < cols - 1; i++) {
      const k = row + i;
      const kind = badges.get(pos[k]);
      if (kind === undefined) continue;
      /* Above the roof: the large buildings are taller. */
      const lift = map.getObj(pos[k]) === MapObject.ObjectSmallBuilding ? 30 : 46;
      const bx = x0 + 32 * i - 16 * odd - (size >> 1);
      const by = y[k] - lift - size;
      ctx.drawImage(badgeCanvas(kind, size), bx, by);
      badgeHits.push({ x: bx, y: by, size, pos: pos[k], kind });
    }
  }
}

/* The badge at a point of the map view, as words: "Sawmill: paused". */
export function badgeAt(game: Game, x: number, y: number): string {
  for (const hit of badgeHits) {
    if (x < hit.x - 2 || y < hit.y - 2 || x > hit.x + hit.size + 2 || y > hit.y + hit.size + 2) continue;
    const building = game.getBuildingAtPos(hit.pos);
    const name = building === null ? 'Building' : buildingName(building.getType());
    return `${name}: ${badgeLabel(hit.kind).toLowerCase()}`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Reading the game

/* Read what the layers that are on need. True: something changed. */
export function refreshOverlayData(
  game: Game,
  player: Player,
  traffic: boolean,
  badges: boolean,
): boolean {
  if (game !== data.game || player !== data.player) {
    data.game = game;
    data.player = player;
    data.heat = new Map();
    data.heatTick = -1;
    data.hasTraffic = false;
    data.hasBadges = false;
    data.badges = new Map();
    data.signature = 0;
  }
  let signature = 0;
  if (traffic) signature = readTraffic(game, player);
  else data.hasTraffic = false;
  if (badges) signature = (Math.imul(signature, 31) + readBadges(game, player)) | 0;
  else if (data.hasBadges) {
    data.hasBadges = false;
    data.badges = new Map();
  }
  const changed = signature !== data.signature;
  data.signature = signature;
  return changed;
}

/* Forget the game: nothing of it is kept while every layer is off. */
export function dropOverlayData(): void {
  if (data.game === null) return;
  data.game = null;
  data.player = null;
  data.segments = new Uint8Array(0);
  data.heat = new Map();
  data.badges = new Map();
  data.hasTraffic = false;
  data.hasBadges = false;
  data.signature = 0;
  badgeHits = [];
}

/* A draw that comes before the first reading (a layer was just switched
   on, a game just started) reads at once. */
function ensureOverlayData(game: Game, player: Player, traffic: boolean, badges: boolean): void {
  if (game !== data.game || player !== data.player) {
    refreshOverlayData(game, player, traffic, badges);
    return;
  }
  if (traffic && !data.hasTraffic) data.signature ^= readTraffic(game, player);
  if (badges && !data.hasBadges) data.signature ^= readBadges(game, player);
}

/* Device pixels of the map view under a point of the page: the pixels of
   the viewport's own picture (as Chat.mapPosAt of net/chat.ts). */
function viewPixel(canvas: HTMLCanvasElement, clientX: number, clientY: number): [number, number] | null {
  const gfx = Graphics.getInstance();
  const [fx, fy] = gfx.getScreenFactor();
  const scale = gfx.getMapZoom() / gfx.getZoomFactor();
  if (!(scale > 0) || !(fx > 0) || !(fy > 0)) return null;
  const rect = canvas.getBoundingClientRect();
  return [
    Math.trunc(((clientX - rect.left) * fx) / scale),
    Math.trunc(((clientY - rect.top) * fy) / scale),
  ];
}

let installed = false;

/* Keep the tables fresh while a layer needs them, and name the badge
   under the pointer. */
export function initMapOverlays(iface: Interface): void {
  if (installed) return;
  installed = true;

  window.setInterval(() => {
    const viewport = iface.getViewport();
    const game = iface.getGame();
    const player = iface.getPlayer();
    const traffic = viewport !== null && viewport.hasLayer(ViewportLayer.LayerTraffic);
    const badges = viewport !== null && viewport.hasLayer(ViewportLayer.LayerBadges);
    if (viewport === null || !game || player === null || (!traffic && !badges) || iface.isGameInitOpen()) {
      dropOverlayData();
      return;
    }
    if (refreshOverlayData(game, player, traffic, badges)) viewport.setRedraw();
  }, 500);

  /* The name of the badge under the pointer, as the tooltip of the map. */
  let shown = '';
  const canvas = document.getElementById('screen');
  if (canvas instanceof HTMLCanvasElement) {
    canvas.addEventListener(
      'mousemove',
      (event) => {
        let text = '';
        const game = iface.getGame();
        if (badgeHits.length > 0 && game && event.buttons === 0) {
          const at = viewPixel(canvas, event.clientX, event.clientY);
          if (at !== null) text = badgeAt(game, at[0], at[1]);
        }
        if (text === shown) return;
        shown = text;
        if (text === '') canvas.removeAttribute('title');
        else canvas.title = text;
      },
      { passive: true },
    );
  }
}
