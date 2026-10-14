// EXT (trading): the way a trader walks with his pack horse from one stock
// to the stock of the other player. Not part of Freeserf.
//
// He leaves by the flag of his castle or storehouse and follows the roads
// of his player to the flag of that network nearest to the other stock.
// From there he walks across country to the flag of the other player's
// roads nearest to him, then along those roads to the flag of the other
// stock. The way is worked out once, when the offer is accepted, and kept
// as a list of map positions one step apart: every client gets the same
// list, since it only reads the map and the roads.
//
// Integers only; the searches visit the directions in a fixed order.

import type { Game } from './game';
import type { Inventory } from './inventory';
import { MapObject, MapSpace, Map } from './map';
import type { MapPos } from './map';
import { reverseDirection } from './map-geometry';
import type { Direction } from './map-geometry';

// The JS Map, under another name: `Map` is the map of the game here.
const Map_ = globalThis.Map;
type Map_<K, V> = globalThis.Map<K, V>;

/* The most positions a cross-country search looks at, and the longest way
   kept: past these the trader walks straight. */
const CROSS_SEARCH_MAX = 200000;
export const TRADE_ROUTE_MAX = 4000;

/* Steps between two positions as a serf could walk them on open land. */
function stepDistance(game: Game, a: MapPos, b: MapPos): number {
  const map = game.getMap();
  const dx = map.distX(a, b);
  const dy = map.distY(a, b);
  if ((dx >= 0) === (dy >= 0)) return Math.max(Math.abs(dx), Math.abs(dy));
  return Math.abs(dx) + Math.abs(dy);
}

/* The flag in front of the building of an inventory, or -1. */
function stockFlag(game: Game, inventory: Inventory): MapPos {
  const building = game.getBuilding(inventory.getBuildingIndex());
  if (building === null) return -1;
  return game.getMap().moveDownRight(building.getPosition());
}

/* The road from the flag at pos in direction dir, as the positions after
   the flag up to and with the flag at its other end. null when the path
   leads to a building or does not end in a flag. */
function traceRoad(game: Game, pos: MapPos, dir: Direction): MapPos[] | null {
  const map = game.getMap();
  const out: MapPos[] = [];
  let p = map.move(pos, dir);
  let from = reverseDirection(dir);
  for (let n = 0; n < 1000; n++) {
    out.push(p);
    if (map.hasFlag(p)) return out;
    if (map.hasBuilding(p)) return null;
    let next = -1;
    for (let d = 0; d < 6; d++) {
      if (d !== from && map.hasPath(p, d as Direction)) { next = d; break; }
    }
    if (next < 0) return null;
    p = map.move(p, next as Direction);
    from = reverseDirection(next as Direction);
  }
  return null;
}

/* The roads that can be reached from the flag at start: for every flag the
   way there in positions (start first). Shortest by steps; among equal
   ways the one found first. */
function roadNetwork(game: Game, start: MapPos): Map_<MapPos, MapPos[]> {
  const ways = new Map_<MapPos, MapPos[]>();
  ways.set(start, [start]);
  /* A plain list kept in order of length: the networks are small. */
  const open: MapPos[] = [start];
  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      if (ways.get(open[i])!.length < ways.get(open[best])!.length) best = i;
    }
    const flag = open.splice(best, 1)[0];
    const way = ways.get(flag)!;
    for (let d = 0; d < 6; d++) {
      if (!game.getMap().hasPath(flag, d as Direction)) continue;
      const road = traceRoad(game, flag, d as Direction);
      if (road === null) continue;
      const end = road[road.length - 1];
      const known = ways.get(end);
      if (known !== undefined && known.length <= way.length + road.length) continue;
      if (known === undefined) open.push(end);
      ways.set(end, way.concat(road));
    }
  }
  return ways;
}

/* The flag of the network nearest to pos, its way from the start. */
function nearestFlag(game: Game, ways: Map_<MapPos, MapPos[]>, pos: MapPos): MapPos[] {
  let best: MapPos[] | null = null;
  let bestDist = 0;
  for (const [flag, way] of ways) {
    const dist = stepDistance(game, flag, pos);
    if (best === null || dist < bestDist || (dist === bestDist && way.length < best.length)) {
      best = way;
      bestDist = dist;
    }
  }
  return best!;
}

/* Whether a trader can stand at pos on his way across country. */
function canCross(map: Map, pos: MapPos): boolean {
  if (map.isInWater(pos)) return false;
  const obj = map.getObj(pos);
  if (obj === MapObject.ObjectFlag) return true;
  return Map.mapSpaceFromObj[obj] < MapSpace.SpaceImpassable;
}

/* Straight toward b, one step at a time: the way when no other is found. */
function straightWay(game: Game, a: MapPos, b: MapPos): MapPos[] {
  const map = game.getMap();
  const out: MapPos[] = [a];
  let p = a;
  for (let n = 0; p !== b && n < TRADE_ROUTE_MAX; n++) {
    let best = p;
    let bestDist = stepDistance(game, p, b);
    for (let d = 0; d < 6; d++) {
      const q = map.move(p, d as Direction);
      const dist = stepDistance(game, q, b);
      if (dist < bestDist) { best = q; bestDist = dist; }
    }
    if (best === p) break;
    p = best;
    out.push(p);
  }
  return out;
}

/* Across country from a to b, the fewest steps around water, buildings and
   stones (a breadth-first search). a first, b last. */
function crossCountry(game: Game, a: MapPos, b: MapPos): MapPos[] {
  if (a === b) return [a];
  const map = game.getMap();
  const prev = new Int32Array(map.getCols() * map.getRows()).fill(-1);
  prev[a] = a;
  let queue: MapPos[] = [a];
  let seen = 1;
  while (queue.length > 0 && seen < CROSS_SEARCH_MAX) {
    const next: MapPos[] = [];
    for (const p of queue) {
      for (let d = 0; d < 6; d++) {
        const q = map.move(p, d as Direction);
        if (prev[q] !== -1) continue;
        if (q !== b && !canCross(map, q)) continue;
        prev[q] = p;
        seen += 1;
        if (q === b) {
          const out: MapPos[] = [b];
          let r = b;
          while (r !== a) { r = prev[r]; out.push(r); }
          return out.reverse();
        }
        next.push(q);
      }
    }
    queue = next;
  }
  return straightWay(game, a, b);
}

/* The way from the stock `from` to the stock `to`, positions one step
   apart, the flag of `from` first and the flag of `to` last. [] when a
   stock has no building. */
export function tradeRoute(game: Game, from: Inventory, to: Inventory): MapPos[] {
  const start = stockFlag(game, from);
  const end = stockFlag(game, to);
  if (start < 0 || end < 0) return [];
  const ours = nearestFlag(game, roadNetwork(game, start), end);
  const leave = ours[ours.length - 1];
  const theirs = nearestFlag(game, roadNetwork(game, end), leave);
  const enter = theirs[theirs.length - 1];
  const cross = crossCountry(game, leave, enter);
  const way = ours.concat(cross.slice(1), theirs.slice().reverse().slice(1));
  return way.length > TRADE_ROUTE_MAX ? straightWay(game, start, end) : way;
}

/* The direction from a to the next position b, or -1. */
export function stepDirection(game: Game, a: MapPos, b: MapPos): number {
  const map = game.getMap();
  for (let d = 0; d < 6; d++) {
    if (map.move(a, d as Direction) === b) return d;
  }
  return -1;
}

/* A way as text for the save: the directions as digits 0..5. */
export function routeToText(game: Game, way: MapPos[]): string {
  let text = '';
  for (let i = 1; i < way.length; i++) text += String(stepDirection(game, way[i - 1], way[i]));
  return text;
}

/* The way back from the save: null when the text is not one. */
export function routeFromText(game: Game, start: MapPos, text: string): MapPos[] | null {
  const map = game.getMap();
  if (!Number.isInteger(start) || start < 0 || start >= map.getCols() * map.getRows()) return null;
  if (text.length > TRADE_ROUTE_MAX || !/^[0-5]*$/.test(text)) return null;
  const way: MapPos[] = [start];
  let p = start;
  for (const c of text) {
    p = map.move(p, Number(c) as Direction);
    way.push(p);
  }
  return way;
}
