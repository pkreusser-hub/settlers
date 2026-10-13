/*
 * ai-core.cc - Computer player: phases, castle placement, site scan
 *
 * Copyright (C) 2026  Wicked_Digger <wicked_digger@mail.ru>
 *
 * This file is part of freeserf.
 *
 * freeserf is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * freeserf is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with freeserf.  If not, see <http://www.gnu.org/licenses/>.
 */

/* Port of the Amiga AI core: the phase machine update (0x28ee2) with
   its slot dispatch, the random site scan (0x2d162), the computer
   player's map cursor evaluation (0x19368), the settings/priority
   updates, the building statistics and the build step (0x2a5c4).
   All values are unsigned 16-bit as in the original: W() wraps, sadd()
   saturates (add + bcs -> 0xffff). */

// PORT: the C++ class AI::Core (ai-core.h) only has static members; they
// are the exported functions of this module.

import {
  AI_BUILDING, AI_CAN_BUILD_CASTLE, AI_CAN_BUILD_FLAG, AI_CAN_BUILD_LARGE,
  AI_CAN_BUILD_MINE, AI_CAN_BUILD_NONE, AI_CAN_BUILD_SMALL,
  AI_CURSOR_BUILDING, AI_CURSOR_CLEAR, AI_CURSOR_CLEAR_BY_FLAG,
  AI_CURSOR_CLEAR_BY_PATH, AI_CURSOR_FLAG, AI_CURSOR_NONE, AI_CURSOR_PATH,
  AI_CURSOR_POS, AI_CURSOR_REMOVABLE_FLAG, AI_FLAG, AI_GAME, AI_MAP,
  AI_SET_CURSOR, AI_SPACE_CASTLE, AI_SPACE_FLAG, AI_SPACE_IMPASSABLE,
  AI_SPACE_INVALID, AI_SPACE_LARGE_BUILDING, AI_SPACE_OPEN,
  AI_SPACE_SMALL_BUILDING, BUILDING_IS_ACTIVE, BUILDING_IS_BURNING,
  BUILDING_IS_DONE, BUILDING_PLAYER, BUILDING_STATE, BUILDING_TYPE,
  FLAG_HAS_BUILDING, MAP_HAS_FLAG, MAP_HAS_OWNER, MAP_HEIGHT, MAP_MOVE,
  MAP_MOVE_DOWN_RIGHT, MAP_OBJ, MAP_OBJ_INDEX, MAP_OWNER, MAP_PATHS, MAP_POS,
  MAP_POS_ADD_SPIRALLY, MAP_POS_COL, MAP_POS_ROW, MAP_SPACE, MAP_TYPE_DOWN,
  MAP_TYPE_UP, PLAYER_HAS_CASTLE, PLAYER_IS_ACTIVE, PLAYER_IS_AI, PLAYER_NUM,
  SERF_PLAYER, SERF_TYPE, aiGame, pendingGet, pendingSet, statGet, statSet,
} from './ai-internal';
import * as Manage from './ai-manage';
import * as Rate from './ai-rate';
import * as Road from './ai-road';
import * as Want from './ai-want';
import type { Building } from './building';
import { BuildingType } from './building';
import type { Flag } from './flag';
import { MapObject } from './map';
import type { MapPos } from './map-geometry';
import { DirectionDownRight, DirectionRight, DirectionUp, DirectionUpLeft } from './map-geometry';
import { BIT, i16, idiv, u32 } from './misc';
import type { AILocation, Player } from './player';
import { AI_LOCATIONS_PER_CATEGORY } from './player';
import { ResourceType } from './resource';
import { SerfState, SerfType } from './serf';

const W = (x: number): number => x & 0xffff;

/* Result of the map cursor evaluation (determine_map_cursor_type). */
export interface Cursor {
  cursorType: number;
  possibility: number;
  noFlag: number;
  noMilitary: number;
  militaryKnown: number;
}

/* Saturating unsigned 16-bit add. */
export function sadd(a: number, b: number): number {
  const r = W(a) + W(b);
  return r > 0xffff ? 0xffff : r;
}

/* Unsigned 16-bit subtract clamped at 0 (sub + bcs -> 0). */
export function ssub(a: number, b: number): number {
  return W(a) < W(b) ? 0 : W(a) - W(b);
}


/* ---- Amiga data ---- */


/* Site categories allowed per panel_btn_type 1..5 (0x2d234). */
const siteCategories: number[] = [
  0x1, 0x20001e0, 0x8a1e, 0xfffe1e, 0x1000000,
];

/* Knight occupation table of adjust_flags (0x2a4b0): 17 rows of
   occupation values for threat levels 3, 2, 1, 0. */
const occupationRows: number[][] = [
  [4, 4, 4, 4], [4, 4, 4, 3], [4, 4, 4, 2], [4, 4, 3, 2],
  [4, 4, 3, 1], [4, 4, 2, 1], [4, 3, 2, 1], [4, 3, 2, 0],
  [4, 3, 1, 0], [4, 3, 0, 0], [4, 2, 0, 0], [4, 1, 0, 0],
  [3, 1, 0, 0], [2, 1, 0, 0], [2, 0, 0, 0], [1, 0, 0, 0],
  [0, 0, 0, 0],
];

/* Knights per occupation value for hut, tower, fortress (0x2a4f4). */
const knightsPerLevel: number[][] = [
  [1, 1, 2, 2, 3], [1, 2, 3, 4, 6], [1, 3, 6, 9, 12],
];


/* ---- Access to the statistics words ---- */

/* Word at Amiga pointer-relative offset off (0x33c..0x3ce): poi[4]
   (used as statistics array) and u_394..u_3ce. Same layout as
   ai-want.cc reads. */
// PORT: returns the value instead of an `int *`; writes go through
// statSet (see ai-internal.ts).
export function stat(player: Player, off: number): number {
  return statGet(player, off);
}

/* ptr+0x33c + 2*slot: stock fill ratio. */
// PORT: the macros are lvalues in the C++; each has a SET_ twin here. FILL
// is only written in this file.
const SET_FILL = (player: Player, slot: number, v: number): void =>
  statSet(player, 0x33c + 2 * slot, v);
/* ptr+0x366 + 2*serf_type: serfs idle in inventories. */
const IDLE = (player: Player, type: number): number => stat(player, 0x366 + 2 * type);
const SET_IDLE = (player: Player, type: number, v: number): void =>
  statSet(player, 0x366 + 2 * type, v);
/* ptr+0x39c + 2*resource: resources in all inventories. */
const STOCK = (player: Player, res: number): number => stat(player, 0x39c + 2 * res);
const SET_STOCK = (player: Player, res: number, v: number): void =>
  statSet(player, 0x39c + 2 * res, v);

/* Pending road connections (ptr+0x1bc..0x1da): 8 x {col, row}, empty
   when col has bit 15 set (the original's tst.l bmi). Filled by the
   game when a knight of the AI player occupies an enemy building. */
// PORT: returns the value instead of an `int *`; writes go through
// pendingSet (see ai-internal.ts).
export function pending(player: Player, i: number, row: number): number {
  return pendingGet(player, 2 * i + row);
}


/* ---- Map helpers (Amiga tile bytes) ---- */

/* Owner bits of the original's height byte: bit 7 has owner, bits 5-6
   owner. */
export function ownerBits(pos: MapPos): number {
  if (!MAP_HAS_OWNER(pos)) return 0;
  return 0x80 | ((MAP_OWNER(pos) & 3) << 5);
}

/* Type byte of the original: up triangle in the high nibble. */
export function typeByte(pos: MapPos): number {
  return (MAP_TYPE_UP(pos) << 4) | MAP_TYPE_DOWN(pos);
}

const PATHBITS = (pos: MapPos): number => MAP_PATHS(pos) & 0x3f;

/* Owner pattern of the height byte for the player. */
export function ownBits(player: Player): number {
  return 0x80 | ((PLAYER_NUM(player) & 3) << 5);
}

export function isBuildingObj(obj: number): boolean {
  return obj >= MapObject.ObjectSmallBuilding && obj <= MapObject.ObjectCastle;
}


/* ---- Map cursor of the original (determine_map_cursor_type @0x19368,
   shared with the human player's panel) ---- */

/* Owner pattern for player; a player without castle builds on land
   without owner. */
export function cursorOwn(player: Player): number {
  if (!PLAYER_HAS_CASTLE(player)) return 0;
  return ownBits(player);
}

/* determine_map_cursor_type_sub @0x196d8: 0 grass/desert, 1 mountain,
   2 water or other. */
export function cursorTriangleClass(type: number): number {
  if (type < 4) return 2;
  if (type < 8) return 0;
  if (type >= 11 && type < 15) return 1;
  return 2;
}

/* Military buildings in the second shell only (spiral 7..18). */
export function cursorMilitaryNear(pos: MapPos): number {
  for (let i = 7; i <= 18; i++) {
    const p = MAP_POS_ADD_SPIRALLY(pos, i);
    if (isBuildingObj(MAP_OBJ(p))) {
      const b = AI_BUILDING(MAP_OBJ_INDEX(p));
      const t = BUILDING_TYPE(b);
      if (t === BuildingType.TypeHut || t === BuildingType.TypeTower ||
          t === BuildingType.TypeFortress || t === BuildingType.TypeCastle) {
        return 1;
      }
    }
  }
  return 0;
}

/* determine_possible_building @0x19660. */
export function cursorPossibleBuilding(player: Player, pos: MapPos,
                                       own: number, c: Cursor): void {
  const hasCastle = PLAYER_HAS_CASTLE(player);

  for (let i = 1; i <= 6; i++) {
    if (ownerBits(MAP_POS_ADD_SPIRALLY(pos, i)) !== own) return;
  }

  const p4 = MAP_POS_ADD_SPIRALLY(pos, 4);
  const p5 = MAP_POS_ADD_SPIRALLY(pos, 5);
  const p6 = MAP_POS_ADD_SPIRALLY(pos, 6);
  const cls = cursorTriangleClass(typeByte(pos) >> 4) |
              cursorTriangleClass(typeByte(pos) & 0xf) |
              cursorTriangleClass(typeByte(p4) & 0xf) |
              cursorTriangleClass(typeByte(p5) >> 4) |
              cursorTriangleClass(typeByte(p5) & 0xf) |
              cursorTriangleClass(typeByte(p6) >> 4);
  if (cls >= 2) return;
  if (cls === 1) {
    /* Some mountain, the rest grass: a mine. */
    if (hasCastle) c.possibility = AI_CAN_BUILD_MINE;
    return;
  }
  if (hasCastle) c.possibility = AI_CAN_BUILD_SMALL;

  c.militaryKnown = 1;
  c.noMilitary = cursorMilitaryNear(pos);

  /* Large: the first shell passable (flags allowed), no large
     building or castle in the second, all grass, small enough
     height differences. */
  for (let i = 1; i <= 6; i++) {
    const sp = MAP_SPACE(MAP_POS_ADD_SPIRALLY(pos, i));
    if (sp >= AI_SPACE_IMPASSABLE && sp !== AI_SPACE_FLAG) return;
  }
  for (let i = 7; i <= 18; i++) {
    if (MAP_SPACE(MAP_POS_ADD_SPIRALLY(pos, i)) >= AI_SPACE_LARGE_BUILDING) {
      return;
    }
  }

  if (typeByte(pos) !== 0x55) return;
  if ((typeByte(p4) & 0xf) !== 5) return;
  if (typeByte(p5) !== 0x55) return;
  if ((typeByte(p6) & 0xf0) !== 0x50) return;

  let hMin = 31;
  let hMax = 0;
  for (let i = 7; i <= 18; i++) {
    const h = MAP_HEIGHT(MAP_POS_ADD_SPIRALLY(pos, i));
    if (h <= hMin) hMin = h;
    if (h > hMax) hMax = h;
  }
  for (let i = 19; i <= 36; i++) {
    const p = MAP_POS_ADD_SPIRALLY(pos, i);
    if (MAP_OBJ(p) !== MapObject.ObjectLargeBuilding) continue;
    const b = AI_BUILDING(MAP_OBJ_INDEX(p));
    if (BUILDING_IS_DONE(b) || b.progress !== 0) continue;
    const h = b.u.level & 0xff;
    if (h <= hMin) hMin = h;
    if (h > hMax) hMax = h;
  }
  if (((hMax - hMin) & 0xffff) >= 9) return;

  c.possibility = hasCastle ? AI_CAN_BUILD_LARGE : AI_CAN_BUILD_CASTLE;
}

/* Tail of determine_map_cursor_type from 0x194ee: flag and building
   possibilities once the cursor type is known. */
export function cursorBuildPossibility(player: Player, pos: MapPos,
                                       own: number, c: Cursor): void {
  if (MAP_SPACE(pos) !== AI_SPACE_OPEN) return;

  /* All six triangles water? */
  if (!(typeByte(pos) & 0xcc) &&
      !(typeByte(MAP_POS_ADD_SPIRALLY(pos, 4)) & 0x0c) &&
      !(typeByte(MAP_POS_ADD_SPIRALLY(pos, 5)) & 0xcc) &&
      !(typeByte(MAP_POS_ADD_SPIRALLY(pos, 6)) & 0xc0)) {
    return;
  }

  let flagNear = false;
  for (let i = 1; i <= 6; i++) {
    if (MAP_SPACE(MAP_POS_ADD_SPIRALLY(pos, i)) === AI_SPACE_FLAG) {
      flagNear = true;
      break;
    }
  }
  if (!flagNear) {
    c.noFlag = 0;
    if (PLAYER_HAS_CASTLE(player)) c.possibility = AI_CAN_BUILD_FLAG;
  }
  if (c.cursorType === AI_CURSOR_PATH) return;

  for (let i = 1; i <= 6; i++) {
    if (MAP_SPACE(MAP_POS_ADD_SPIRALLY(pos, i)) >= AI_SPACE_SMALL_BUILDING) {
      return;
    }
  }
  if (c.cursorType !== AI_CURSOR_CLEAR_BY_FLAG &&
      MAP_SPACE(MAP_POS_ADD_SPIRALLY(pos, 2)) !== AI_SPACE_OPEN) {
    return;
  }

  /* No other flag next to the building's flag. */
  const flagRing = [7, 8, 14, 1, 3];
  for (let i = 0; i < 5; i++) {
    if (MAP_SPACE(MAP_POS_ADD_SPIRALLY(pos, flagRing[i])) === AI_SPACE_FLAG) {
      return;
    }
  }

  /* Triangles around the building flag must be land (L12). */
  if (!(typeByte(MAP_POS_ADD_SPIRALLY(pos, 1)) & 0xc0) ||
      !(typeByte(MAP_POS_ADD_SPIRALLY(pos, 3)) & 0x0c) ||
      !(typeByte(MAP_POS_ADD_SPIRALLY(pos, 2)) & 0xc0) ||
      !(typeByte(MAP_POS_ADD_SPIRALLY(pos, 2)) & 0x0c)) {
    return;
  }

  cursorPossibleBuilding(player, pos, own, c);
}

/* get_map_cursor_type @0x194ba: cursor on a free vertex. */
export function cursorClear(player: Player, pos: MapPos, own: number,
                            c: Cursor): void {
  const p2 = MAP_POS_ADD_SPIRALLY(pos, 2);

  if (MAP_SPACE(p2) === AI_SPACE_FLAG) {
    c.cursorType = AI_CURSOR_CLEAR_BY_FLAG;
  } else if (PATHBITS(p2) !== 0) {
    c.cursorType = AI_CURSOR_CLEAR_BY_PATH;
  } else {
    c.cursorType = AI_CURSOR_CLEAR;
  }
  cursorBuildPossibility(player, pos, own, c);
}

export function cursorReset(c: Cursor): void {
  c.cursorType = AI_CURSOR_NONE;
  c.possibility = AI_CAN_BUILD_NONE;
  c.noFlag = 1;
  c.noMilitary = 0;
  c.militaryKnown = 0;
}

// PORT: stands in for an uninitialised `Cursor c;` on the stack.
function newCursor(): Cursor {
  return { cursorType: 0, possibility: 0, noFlag: 0, noMilitary: 0, militaryKnown: 0 };
}

/* What the player can do at pos, as determine_map_cursor_type of the
   original decides it for the panel and the build actions. */
export function getMapCursor(player: Player, pos: MapPos, c: Cursor): void {
  const own = cursorOwn(player);
  cursorReset(c);

  if (ownerBits(pos) !== own) return;

  const sp = MAP_SPACE(pos);
  if (sp === AI_SPACE_FLAG) {
    if ((MAP_PATHS(pos) & BIT(DirectionUpLeft)) &&
        MAP_SPACE(MAP_POS_ADD_SPIRALLY(pos, 5)) >= AI_SPACE_SMALL_BUILDING) {
      c.cursorType = AI_CURSOR_FLAG;
      return;
    }
    if (PATHBITS(pos) === 0) {
      c.cursorType = AI_CURSOR_REMOVABLE_FLAG;
      return;
    }

    const flag = AI_FLAG(MAP_OBJ_INDEX(pos));
    let other: Flag | null = null;
    let paths = 0;
    for (let d = 5; d >= 0; d--) {
      if (!(flag.pathCon & BIT(d))) continue;
      if (!(flag.landPaths() & BIT(d))) {
        /* Water path */
        c.cursorType = AI_CURSOR_FLAG;
        return;
      }
      paths += 1;
      if (other == null) {
        other = flag.otherEndpoint.f[d];
      } else if (other === flag.otherEndpoint.f[d]) {
        c.cursorType = AI_CURSOR_FLAG;
        return;
      }
    }
    c.cursorType = (paths === 2) ? AI_CURSOR_REMOVABLE_FLAG :
                                   AI_CURSOR_FLAG;
    return;
  } else if (sp >= AI_SPACE_SMALL_BUILDING) {
    /* Original bug: object 127 is taken for a building. */
    if (sp === AI_SPACE_CASTLE || sp === AI_SPACE_INVALID) return;
    const b = AI_BUILDING(MAP_OBJ_INDEX(pos));
    if (BUILDING_IS_BURNING(b)) return;
    c.cursorType = AI_CURSOR_BUILDING;
    /* What could be built here instead (replace building). */
    cursorPossibleBuilding(player, pos, own, c);
    return;
  }

  const paths = PATHBITS(pos);
  if (paths === 0) {
    cursorClear(player, pos, own, c);
    return;
  }
  if (paths === BIT(DirectionDownRight) || paths === BIT(DirectionUpLeft)) {
    return;
  }
  c.cursorType = AI_CURSOR_PATH;
  cursorBuildPossibility(player, pos, own, c);
}

export function setCursorResult(player: Player, c: Cursor): void {
  player.ai.mapCursorType = c.cursorType;
  player.ai.panelBtnType = c.possibility;
  player.noFlag = c.noFlag !== 0;
  if (c.militaryKnown) {
    player.noMilitary = c.noMilitary !== 0;
  }
}

/* determine_map_cursor_type @0x19368 for the AI cursor. */
export function determineMapCursorType(player: Player): void {
  const c = newCursor();
  getMapCursor(player, AI_CURSOR_POS(player), c);
  setCursorResult(player, c);
}

/* get_map_cursor_type_at @0x1932e: get_map_cursor_type for pos
   without the checks of the center (the caller scan_sites made them);
   the owner pattern own is the caller's D3. The cursor is not moved. */
export function getMapCursorTypeAt(player: Player, pos: MapPos,
                                   own: number): void {
  const c = newCursor();
  cursorReset(c);
  cursorClear(player, pos, own, c);
  setCursorResult(player, c);
}


/* ---- Site scan and start ---- */

/* player_ai @0x2d162: map_regions * 8 random positions. The first own
   free site that allows a building is rated as building site, the
   first finished, active enemy military building of state 3 near own
   land as attack target; then the scan ends. */
export function scanSites(player: Player): void {
  const ai = player.ai;
  const n = W(AI_MAP().getRegionCount() * 8);
  const own = PLAYER_HAS_CASTLE(player) ? ownBits(player) : 0;

  for (let i = 0; i < n; i++) {
    let r = u32(AI_GAME().randomInt() << 16);
    r = u32(r | AI_GAME().randomInt());
    const pos = MAP_POS((r >>> 2) & AI_MAP().getColMask(),
                        (r >>> (AI_MAP().getRowShift() + 3)) &
                        AI_MAP().getRowMask());

    const owner = ownerBits(pos);
    if (owner === own) {
      if (MAP_SPACE(pos) !== 0 || PATHBITS(pos) !== 0) continue;

      getMapCursorTypeAt(player, pos, own);
      if (ai.mapCursorType < AI_CURSOR_CLEAR_BY_FLAG) continue;
      if (ai.panelBtnType === AI_CAN_BUILD_NONE) continue;

      AI_SET_CURSOR(player, pos);
      let cat = siteCategories[ai.panelBtnType - 1];
      if (player.noMilitary) cat &= ~0x600800; /* no military */
      if (player.noFlag) cat &= ~1; /* no flag */
      Rate.scanPointsOfInterest(player);
      Rate.rateBuildingSite(player, u32(cat));
      return;
    }

    if (!(owner & 0x80)) continue;
    // EXT: a building of an ally is no attack target.
    if (AI_GAME().isAllied(PLAYER_NUM(player), MAP_OWNER(pos))) continue;
    if (!isBuildingObj(MAP_OBJ(pos))) continue;

    const b = AI_BUILDING(MAP_OBJ_INDEX(pos));
    const t = BUILDING_TYPE(b);
    if (!BUILDING_IS_DONE(b) ||
        (t !== BuildingType.TypeHut && t !== BuildingType.TypeTower &&
         t !== BuildingType.TypeFortress && t !== BuildingType.TypeCastle)) {
      continue;
    }
    if (BUILDING_STATE(b) !== 3 || !BUILDING_IS_ACTIVE(b)) continue;

    let nearOwn = false;
    for (let j = 7; j < 7 + 0x102; j++) {
      if (ownerBits(MAP_POS_ADD_SPIRALLY(b.getPosition(), j)) ===
          ownBits(player)) {
        nearOwn = true;
        break;
      }
    }
    if (!nearOwn) continue;

    ai.panelBtnType = AI_CAN_BUILD_NONE;
    AI_SET_CURSOR(player, pos);
    Rate.scanPointsOfInterest(player);
    Rate.rateAttackTarget(player);
    return;
  }
}

/* ai_wait @0x2d082: phase 1. */
export function wait(player: Player): void {
  scanSites(player);
  player.ai.counter = W(player.ai.counter - 1);
  if (player.ai.counter === 0) {
    player.ai.phase = 2;
    player.ai.counter = 0xffff;
    player.ai.buildThreshold = 0;
  }
}

/* Best stored site of a category: highest value (first one wins),
   nullptr if all are 0. */
export function bestLocation(player: Player, category: number): AILocation | null {
  let best: AILocation | null = null;
  let value = 0;
  for (let i = 0; i < AI_LOCATIONS_PER_CATEGORY; i++) {
    const loc = player.ai.locations[category][i];
    if (W(loc.value) > value) {
      value = W(loc.value);
      best = loc;
    }
  }
  return best;
}

/* ai_place_castle @0x2d09e: phase 0. */
export function placeCastle(player: Player): void {
  scanSites(player);

  const tick = W(AI_GAME().getTick());
  if (tick < 2000) return;
  if (tick < 10000) {
    const r = AI_GAME().randomInt();
    if (tick < 6000) {
      if (r & 0x3f) return;
    } else if (tick < 9000) {
      if (r & 0x1f) return;
    } else {
      if (r & 0xf) return;
    }
  }

  while (true) {
    const loc = bestLocation(player, BuildingType.TypeCastle);
    if (loc == null) return;

    aiGame().someLocation = loc;
    loc.value = 0;
    player.ai.cursorCol = loc.col;
    player.ai.cursorRow = loc.row;
    determineMapCursorType(player);
    if (player.ai.panelBtnType !== AI_CAN_BUILD_CASTLE) continue;

    Rate.scanPointsOfInterest(player);
    const rating = W(Rate.rateSiteCastle(player));
    if (rating < W(aiGame().someLocation!.value)) {
      /* Never taken: the value was just cleared. */
      let better = false;
      for (let i = 0; i < AI_LOCATIONS_PER_CATEGORY; i++) {
        const l = player.ai.locations[BuildingType.TypeCastle][i];
        if (rating < W(l.value)) {
          better = true;
          break;
        }
      }
      if (better) {
        aiGame().someLocation!.value = rating;
        continue;
      }
    }

    player.ai.phase = 1;
    player.ai.counter = 24;
    AI_GAME().buildCastle(AI_CURSOR_POS(player), player);
    return;
  }
}


/* ---- Build damping (0xb094) ---- */

/* Shift of the elapsed ticks per building type 1..25
   (-1 = doubled). */
const dampShift: number[] = [
  3, 2, 4, 3, 1, 1, 1, 1, 2, 3, -1, 2, 2, 2, 2, 2,
  2, 2, 3, 2, 2, 2, 2, -1, 2,
];

/* ai_update_build_damping @0xb0c0: lower the build threshold by the
   elapsed ticks (but not below a value from the land/building ratio)
   and let the damping of every building type recover. */
export function updateBuildDamping(player: Player, elapsed: number): void {
  const shift = dampShift;
  const ai = player.ai;

  if (!PLAYER_IS_AI(player)) return;

  ai.buildThreshold = ssub(ai.buildThreshold, elapsed);

  if (player.totalBuildingScore !== 0) {
    const div = player.totalBuildingScore & 0xffff;
    const land = u32(u32(player.totalLandArea) << 7);
    /* Original bug: divu.w traps on a zero low word and leaves
       the dividend on overflow; both are skipped here. */
    if (div !== 0 && idiv(land, div) <= 0xffff) {
      const q = idiv(land, div);
      if (q < 0x400) {
        const v = W((q ^ 0x3ff) << 6);
        if (v >= W(ai.buildThreshold)) {
          ai.buildThreshold = v;
        }
      }
    }
  }

  for (let i = 0; i < 25; i++) {
    const inc = shift[i] < 0 ? W(elapsed << 1) :
                               W(elapsed) >> shift[i];
    ai.buildDamp[i] = sadd(ai.buildDamp[i], inc);
  }
}

/* ai_update_build_damping_all @0xb094 (scheduler slot 32). */
export function updateBuildDampingAll(): void {
  const elapsed = W(aiGame().ticks288); /* game+0x28a */
  aiGame().ticks288 = 0;

  for (let i = 0; i < 4; i++) {
    const player = AI_GAME().getPlayer(i);
    if (PLAYER_IS_ACTIVE(player)) {
      updateBuildDamping(player, elapsed);
    }
  }
}


/* ---- Settings (slot 0) ---- */

/* ai_adjust_flags @0x2a238: send-strongest flag, knight cycling,
   promotion of serfs to knights, castle knights and the knight
   occupation of the military buildings. */
export function adjustFlags(player: Player): void {
  const ai = player.ai;

  /* Send the strongest knights to fight, by chance. */
  player.strongest = (AI_GAME().randomInt() < W(player.aiValue4));

  if (ai.u_1b0 === 0 && player.knightCycleCounter === 0) {
    const k0 = W(player.serfCount[SerfType.TypeKnight0]);
    const k1 = W(player.serfCount[SerfType.TypeKnight1]);
    const k2 = W(player.serfCount[SerfType.TypeKnight2]);
    let v: number;

    /* Knights 2..4 idle in inventories. */
    v = W(IDLE(player, SerfType.TypeKnight4)) << 1;
    if (v <= 0xffff) v += W(IDLE(player, SerfType.TypeKnight3));
    if (v <= 0xffff) v <<= 1;
    if (v <= 0xffff) v += W(IDLE(player, SerfType.TypeKnight2));
    const d0 = v > 0xffff ? 0xffff : v;

    /* Knights 0..2 outside the inventories. */
    v = W(k0 - W(IDLE(player, SerfType.TypeKnight0))) << 1;
    if (v <= 0xffff) v += k1;
    if (v <= 0xffff) {
      v = W(W(v - W(IDLE(player, SerfType.TypeKnight1))) << 1) + k2;
      if (v <= 0xffff) v = W(v - W(IDLE(player, SerfType.TypeKnight2)));
    }
    const d1 = v > 0xffff ? 0xffff : v;

    /* Capacity of the military buildings. */
    v = W(player.completedBuildingCount[BuildingType.TypeFortress]) << 1;
    if (v <= 0xffff) {
      v += W(player.completedBuildingCount[BuildingType.TypeTower]);
    }
    if (v <= 0xffff) v <<= 1;
    if (v <= 0xffff) {
      v += W(player.completedBuildingCount[BuildingType.TypeHut]);
    }
    if (v <= 0xffff) v <<= 1;
    const d2 = v > 0xffff ? 0xffff : v;

    if (d2 < d1 && d2 < d0) {
      /* Start cycling the knights. */
      player.knightCycling = true;
      player.knightLevelReduced = true;
      player.knightCycleCounter = 1200;
      ai.u_1b0 = 15000;
    }
  }

  /* Promote generic serfs if swords and shields are there. */
  let generic = 0;
  let armed = 0;
  for (const inv of AI_GAME().inventories) {
    if ((inv.owner | 0) !== PLAYER_NUM(player)) continue;
    let n = W(inv.genericCount);
    generic = W(generic + n);
    if (n >= W(inv.resources.get(ResourceType.TypeSword) ?? 0)) {
      n = W(inv.resources.get(ResourceType.TypeSword) ?? 0);
    }
    if (n >= W(inv.resources.get(ResourceType.TypeShield) ?? 0)) {
      n = W(inv.resources.get(ResourceType.TypeShield) ?? 0);
    }
    armed = W(armed + n);
  }
  if (armed !== 0 && generic >= 10) {
    generic = W(generic - armed);
    if (generic >= 10) {
      player.promoteSerfsToKnights(armed);
    } else {
      generic = 10 - generic;
      if (armed > generic) {
        player.promoteSerfsToKnights(armed - generic);
      }
    }
  }

  /* Military buildings by type (hut, tower, fortress) and state
     (game+0x12c scratch in the original). */
  const count: number[][] = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (const b of AI_GAME().buildings) {
    /* Original bug: the bitmap bit is tested with D1 while D7
       (left from game_random_int) is counted down, so the wrong
       allocation bits are read. */
    if (BUILDING_PLAYER(b) !== PLAYER_NUM(player)) continue;
    /* Type byte & 0xfc: unfinished buildings never match. */
    if (!BUILDING_IS_DONE(b)) continue;
    let k: number;
    switch (BUILDING_TYPE(b)) {
      case BuildingType.TypeHut: k = 0; break;
      case BuildingType.TypeTower: k = 1; break;
      case BuildingType.TypeFortress: k = 2; break;
      default: continue;
    }
    count[k][BUILDING_STATE(b)] = W(count[k][BUILDING_STATE(b)] + 1);
  }

  /* Knights wanted in the castle. */
  let knights = W(player.serfCount[SerfType.TypeKnight0] +
                  player.serfCount[SerfType.TypeKnight1] +
                  player.serfCount[SerfType.TypeKnight2] +
                  player.serfCount[SerfType.TypeKnight3] +
                  player.serfCount[SerfType.TypeKnight4]);
  ai.u_1ac = knights;
  let wanted = (knights >> 2) + 3;
  if (wanted >= 30) {
    wanted = (wanted >> 1) + 15;
    if (wanted >= 50) wanted = (wanted >> 1) + 25;
  }
  if (wanted >= 100) wanted = 99;
  player.castleKnightsWanted = wanted;
  knights = ssub(knights, wanted);
  knights -= knights >> 3;

  /* Highest occupation row the remaining knights can fill. */
  let level = 0;
  for (let r = 0; r < 16; r++) {
    let need = 0;
    for (let k = 0; k < 4; k++) {
      const threat = 3 - k;
      const v = occupationRows[r][k];
      need += knightsPerLevel[0][v] * count[0][threat];
      need += knightsPerLevel[1][v] * count[1][threat];
      need += knightsPerLevel[2][v] * count[2][threat];
      need = W(need);
    }
    if (knights >= need) {
      level = 16 - r;
      break;
    }
  }
  ai.u_1aa = level;
  if (W(player.aiValue0) < u32(level)) {
    level = W(player.aiValue0);
  }

  const row = occupationRows[16 - level];
  for (let i = 3; i >= 0; i--) {
    const v = row[3 - i];
    const max = (v << 4) & 0xff;
    let min = v + i - 4;
    if (min < 0) min = 0;
    if (i === 3 && max === 0x30) min = 1;
    player.knightOccupation[i] = max | min;
  }
}

/* Tool priority from the stock of one tool (part of 0x2c906). */
export function toolValue(base: number, shift: number, stock: number): number {
  if (W(stock) === 0) return 16;
  return ssub((base >>> shift) + 1, stock);
}

const toolShift: number[] = [2, 0, 2, 3, 2, 2, 3, 1, 3];

/* ai_adjust_priorities @0x2c906: tool, planks, steel, coal, wheat
   and food distribution. */
export function adjustPriorities(player: Player): void {
  let d0: number;
  let d1: number;
  let d2: number;

  d0 = player.totalLandArea >= 0x1000 ? 0xfff :
                                        W(player.totalLandArea);
  if (d0 < 0x400) d0 = 0x400;
  d0 >>= 8;

  d2 = 0;
  for (let i = 0; i < 9; i++) {
    const v = toolValue(d0, toolShift[i],
                        STOCK(player, ResourceType.TypeShovel + i));
    if (i === 0 || v > d2) d2 = v;
    player.toolPrio[i] = W(v * 0xfff);
  }

  d1 = W(d2 * 0xfff);
  player.planksToolmaker = d1;
  player.steelToolmaker = d1;
  d1 = W(~d1);
  const d3 = sadd(d1, 0xfa0);

  d2 = 0xffff;
  switch (player.knightOccupation[3] & 0xf0) {
    case 0x40: d0 = 0; break;
    case 0x30: d0 = 0x7530; d2 = 0x7530; break;
    case 0x20: d0 = 0xc350; d2 = 0x4e20; break;
    case 0x10: d0 = 0xea60; d2 = 0x2710; break;
    default: d0 = 0xffff; d2 = 0x1388; break;
  }
  if (d1 >= d0) d0 = d1;
  player.steelWeaponsmith = d0;
  if (d3 >= d2) d2 = d3;
  if (W(STOCK(player, ResourceType.TypeSteel)) >= 10) d2 = 0xffff;
  player.coalGoldsmelter = d2;
  const d4 = d2;
  player.coalWeaponsmith = 0xafc8;

  d0 = W(STOCK(player, ResourceType.TypeSteel));
  if (d0 >= 0x80) d0 = 0x7f;
  player.coalSteelsmelter = W(((0x7f - d0) << 8) + 0x8000);

  d0 = sadd(sadd(STOCK(player, ResourceType.TypeFish), STOCK(player, ResourceType.TypeMeat)),
            STOCK(player, ResourceType.TypeBread));
  if (d0 >= 0x80) d0 = 0x7f;
  d0 = W(d0 << 9);
  if (d0 < 0x8000) {
    player.wheatMill = 0xffff;
    player.wheatPigfarm = W(d0 + 0x8000);
  } else {
    player.wheatPigfarm = 0xffff;
    player.wheatMill = W(W(~d0) + 0x8000);
  }

  d1 = 0xffff;
  d2 = W(ssub(8, STOCK(player, ResourceType.TypeBoat)) << 11);
  d0 = W(player.planksToolmaker);
  if (d0 >= 0xc000) {
    d2 = 0;
    d1 = W(~W((d0 - 0xc000) << 1));
  }
  player.planksConstruction = d1;
  player.planksBoatbuilder = d2;

  /* Food for the mines: iron ore vs. gold ore (coal read but
     overwritten in the original). */
  d1 = W(STOCK(player, ResourceType.TypeIronOre));
  d0 = d1 >> 2;
  d1 = W(W(d1 << 1) - d0);
  d1 = sadd(d1, STOCK(player, ResourceType.TypeGoldOre));
  d2 = W(STOCK(player, ResourceType.TypeSteel));
  d2 = W(d2 - (d2 >> 2));
  d1 = W(d1 + d2);
  if (d1 >= d0) {
    d1 -= d0;
    if (d1 >= 0xdc) d1 = 0xdb;
    d1 = W(~(d1 << 8));
    d0 = 0xffff;
  } else {
    d0 -= d1;
    if (d0 >= 0xdc) d0 = 0xdb;
    d0 = W(~(d0 << 8));
    d1 = 0xffff;
  }

  d2 = W(STOCK(player, ResourceType.TypeStone));
  if (d2 >= 0x18) d2 = 0x17;
  d2 = W(~(d2 << 11));
  player.foodStonemine = d2;
  if (d2 >= 0xafc8) {
    d0 >>= 1;
    d1 >>= 1;
    if (d2 >= 0xea60) {
      d0 >>= 1;
      d1 >>= 1;
    }
  }
  player.foodCoalmine = d0;
  player.foodIronmine = d1;
  player.foodGoldmine = d4 < d1 ? d4 : d1;
}

/* ai_update_settings @0x2c8fc: slot 0. */
export function updateSettings(player: Player): void {
  adjustFlags(player);
  adjustPriorities(player);
}


/* ---- Statistics (slots 1, 5, 9, 13) ---- */

/* ai_stock*_fill_* @0x2cef2..0x2cf7e: requested + 2 * available. */
export function stockFill(b: Building, i: number): number {
  return W(b.stock[i].requested + 2 * b.stock[i].available);
}

/* Fill slot per building type: stock 0 and stock 1
   (-1 none), capacity of stock 1 for the military buildings. */
const bldSlots: { slot0: number; slot1: number; cap1: number }[] = [
  { slot0: -1, slot1: -1, cap1: 0 }, /* NONE */
  { slot0: -1, slot1: -1, cap1: 0 }, /* FISHER */
  { slot0: -1, slot1: -1, cap1: 0 }, /* LUMBERJACK */
  { slot0: 0, slot1: -1, cap1: 0 }, /* BOATBUILDER */
  { slot0: -1, slot1: -1, cap1: 0 }, /* STONECUTTER */
  { slot0: 1, slot1: -1, cap1: 0 }, /* STONEMINE */
  { slot0: 2, slot1: -1, cap1: 0 }, /* COALMINE */
  { slot0: 3, slot1: -1, cap1: 0 }, /* IRONMINE */
  { slot0: 4, slot1: -1, cap1: 0 }, /* GOLDMINE */
  { slot0: -1, slot1: -1, cap1: 0 }, /* FORESTER */
  { slot0: -1, slot1: -1, cap1: 0 }, /* STOCK */
  { slot0: -1, slot1: 5, cap1: 4 }, /* HUT */
  { slot0: -1, slot1: -1, cap1: 0 }, /* FARM */
  { slot0: 7, slot1: -1, cap1: 0 }, /* BUTCHER */
  { slot0: 6, slot1: -1, cap1: 0 }, /* PIGFARM */
  { slot0: 8, slot1: -1, cap1: 0 }, /* MILL */
  { slot0: 9, slot1: -1, cap1: 0 }, /* BAKER */
  { slot0: -1, slot1: 10, cap1: 16 }, /* SAWMILL */
  { slot0: 15, slot1: 16, cap1: 16 }, /* STEELSMELTER */
  { slot0: 11, slot1: 12, cap1: 16 }, /* TOOLMAKER */
  { slot0: 14, slot1: 13, cap1: 16 }, /* WEAPONSMITH */
  { slot0: -1, slot1: 5, cap1: 8 }, /* TOWER */
  { slot0: -1, slot1: 5, cap1: 16 }, /* FORTRESS */
  { slot0: 17, slot1: 18, cap1: 16 }, /* GOLDSMELTER */
];

/* ai_update_building_stats @0x2ccc8. */
export function updateBuildingStats(player: Player): void {
  const fill: number[] = new Array<number>(21).fill(0);
  const cap: number[] = new Array<number>(21).fill(0);

  for (const b of AI_GAME().buildings) {
    if (BUILDING_PLAYER(b) !== PLAYER_NUM(player)) continue;

    if (!BUILDING_IS_DONE(b)) {
      /* Construction material: planks, stone. */
      fill[19] = W(fill[19] + stockFill(b, 0));
      cap[19] = W(cap[19] + ((2 * b.stock[0].maximum) & 0xff));
      fill[20] = W(fill[20] + stockFill(b, 1));
      cap[20] = W(cap[20] + ((2 * b.stock[1].maximum) & 0xff));
      continue;
    }

    const t = BUILDING_TYPE(b);
    if (t >= 24) continue;
    if (bldSlots[t].slot0 >= 0) {
      const s = bldSlots[t].slot0;
      fill[s] = W(fill[s] + stockFill(b, 0));
      cap[s] = W(cap[s] + 16);
    }
    if (bldSlots[t].slot1 >= 0) {
      const s = bldSlots[t].slot1;
      fill[s] = W(fill[s] + stockFill(b, 1));
      cap[s] = W(cap[s] + bldSlots[t].cap1);
    }
  }

  for (let s = 0; s < 21; s++) {
    let v: number;
    if (fill[s] === cap[s]) {
      v = 0xffff;
    } else if (cap[s] === 0 || fill[s] > cap[s]) {
      /* Original bug: divu.w traps on 0 and on overflow
         (fill > capacity) leaves 0. Taken as full here. */
      v = 0xffff;
    } else {
      v = idiv(fill[s] * 0x10000, cap[s]);
    }
    SET_FILL(player, s, v);
  }

  /* Serfs idle in inventories by type. */
  for (let t = 0; t < 27; t++) SET_IDLE(player, t, 0);
  for (const serf of AI_GAME().serfs) {
    if (serf.state !== SerfState.StateIdleInStock) continue;
    if (SERF_PLAYER(serf) !== PLAYER_NUM(player)) continue;
    SET_IDLE(player, SERF_TYPE(serf), W(IDLE(player, SERF_TYPE(serf)) + 1));
  }

  /* Resources in all inventories, plus the emergency reserve. */
  for (let r = 0; r < 26; r++) SET_STOCK(player, r, 0);
  /* Original bug: the original adds these to build_want[7] and
     build_want[9] (A1 already past the cleared array). */
  SET_STOCK(player, ResourceType.TypePlank,
            W(STOCK(player, ResourceType.TypePlank) +
              (player.extraPlanks & 0xff)));
  SET_STOCK(player, ResourceType.TypeStone,
            W(STOCK(player, ResourceType.TypeStone) +
              (player.extraStone & 0xff)));
  for (const inv of AI_GAME().inventories) {
    if ((inv.owner | 0) !== PLAYER_NUM(player)) continue;
    for (let r = 25; r >= 0; r--) {
      SET_STOCK(player, r, sadd(STOCK(player, r),
                                inv.resources.get(r as ResourceType) ?? 0));
    }
  }
}


/* ---- Building ---- */

/* ai_check_construction_limit @0x2a504: < 0 if no builder can be
   had or too many buildings are under construction. */
export function checkConstructionLimit(player: Player): number {
  const transporters = W(IDLE(player, SerfType.TypeTransporter));
  const generic = W(IDLE(player, SerfType.TypeGeneric));

  if (W(IDLE(player, SerfType.TypeBuilder)) !== 0) {
    if (W(transporters + generic) < 2) return -1;
  } else {
    if (W(STOCK(player, ResourceType.TypeHammer)) === 0) return -1;
    if (generic === 0) return -1;
    if (W(generic + transporters) < 3) return -1;
  }

  let incomplete = 0;
  for (let t = BuildingType.TypeFisher; t <= BuildingType.TypeGoldSmelter; t++) {
    incomplete = W(incomplete + player.incompleteBuildingCount[t]);
  }

  let limit =
    W((W(player.completedBuildingCount[BuildingType.TypeStock]) + 3) << 2);
  let v = (W(STOCK(player, ResourceType.TypePlank)) >> 2) + 6;
  if (v < limit) limit = v;
  v = (W(STOCK(player, ResourceType.TypeStone)) >> 1) + 8;
  if (v < limit) limit = v;

  return limit < incomplete ? -1 : 0;
}

/* Road builder parameters set before Road::build_road. */
export function roadParams(player: Player, u_1ba: number, u_19c: number, u_1a8: number,
                           u_1a4: number, u_19e: number): void {
  player.ai.u_1ba = u_1ba;
  player.ai.u_19c = u_19c;
  player.ai.u_1a8 = u_1a8;
  player.ai.u_1a4 = u_1a4;
  player.ai.u_19e = u_19e;
}

/* Move the AI cursor by (dc, dr) with wrap-around. */
export function moveCursor(player: Player, dc: number, dr: number): void {
  player.ai.cursorCol = (player.ai.cursorCol + dc) &
                        AI_MAP().getColMask();
  player.ai.cursorRow = (player.ai.cursorRow + dr) &
                        AI_MAP().getRowMask();
}

/* ai_build_building @0x2a5c4: build ai_game.build_building_type at
   the best stored site that is still possible. Type 25 builds only a
   flag (category 0), type 24 sends a geologist (category 25) once the
   castle exists. */
export function buildBuilding(player: Player): void {
  const ai = player.ai;
  let mode = 2; /* D5: -1 flag, 0 geologist, 2/3 building */
  let allowed = 0x18; /* D6: panel_btn_type bits */
  const type = aiGame().buildBuildingType;

  if ((0x3ff7400 >> (type & 31)) & 1) {
    if (type >= 24) {
      if (type === 25) {
        aiGame().buildBuildingType = 0;
        mode = -1;
        allowed = BIT(AI_CAN_BUILD_FLAG);
      } else if (PLAYER_HAS_CASTLE(player)) {
        aiGame().buildBuildingType = 25;
        mode = 0;
        allowed = BIT(AI_CAN_BUILD_MINE);
      } else {
        mode = 3;
        allowed = BIT(AI_CAN_BUILD_LARGE);
      }
    } else {
      mode = 3;
      allowed = BIT(AI_CAN_BUILD_LARGE);
    }
  } else if (type >= 5 && type < 9) {
    allowed = BIT(AI_CAN_BUILD_MINE);
  }
  aiGame().g24a = mode;
  aiGame().g24c = allowed;

  let rating: number;
  while (true) {
    const category = aiGame().buildBuildingType;
    const loc = bestLocation(player, category);
    if (loc == null) return;

    aiGame().someLocation = loc;
    loc.value = 0;
    ai.cursorCol = loc.col;
    ai.cursorRow = loc.row;
    determineMapCursorType(player);
    if (ai.mapCursorType < AI_CURSOR_CLEAR_BY_FLAG) continue;
    if (!(allowed & BIT(ai.panelBtnType & 7))) continue;
    if (player.noMilitary &&
        (category === BuildingType.TypeHut || category === BuildingType.TypeTower ||
         category === BuildingType.TypeFortress)) {
      continue;
    }

    Rate.scanPointsOfInterest(player);
    rating = W(Rate.rateSiteDispatch(player));
    if (rating < W(aiGame().someLocation!.value)) {
      /* Never taken: the value was just cleared. */
      let better = false;
      for (let i = 0; i < AI_LOCATIONS_PER_CATEGORY; i++) {
        if (rating < W(ai.locations[category][i].value)) {
          better = true;
          break;
        }
      }
      if (better) {
        aiGame().someLocation!.value = rating;
        continue;
      }
    }
    break;
  }

  if (rating === 0) return;

  if (mode < 0) {
    /* Flag only */
    AI_GAME().buildFlag(AI_CURSOR_POS(player), player);
    if (rating < 0x9470) {
      Road.pullRoadsThroughFlag(player);
      player.waterRoads = true;
      roadParams(player, 0, 0, 0, 0, -1);
    } else {
      player.waterRoads = false;
      roadParams(player, 0, 0, 0, 6, -1);
    }
    Road.buildRoad(player);
    return;
  }

  roadParams(player, 0, 0, 12, ai.u_1a4, -1);
  if (ai.mapCursorType !== AI_CURSOR_CLEAR) {
    let flagWithPaths = true;
    if (ai.mapCursorType === AI_CURSOR_CLEAR_BY_FLAG) {
      const fp = MAP_POS((ai.cursorCol + 1) & AI_MAP().getColMask(),
                         (ai.cursorRow + 1) & AI_MAP().getRowMask());
      flagWithPaths = PATHBITS(fp) !== 0;
    }
    if (flagWithPaths) {
      ai.u_19e = 0;
      ai.u_1ba = 30;
      ai.u_19c = 12;
    }
  }

  if (mode === 0) {
    /* Geologist: flag at the building flag position. */
    moveCursor(player, 1, 1);
    if (ai.mapCursorType >= AI_CURSOR_CLEAR_BY_PATH) {
      if (ai.mapCursorType === AI_CURSOR_CLEAR_BY_PATH) {
        /* build_flag splits the path. */
        ai.mapCursorType = AI_CURSOR_PATH;
      }
      AI_GAME().buildFlag(AI_CURSOR_POS(player), player);
      if (Road.pullRoadsThroughFlag(player) >= 0) {
        ai.u_1ba = 50;
        ai.u_19c = 8;
        ai.u_19e = 0;
      }
      ai.u_1a4 = 0;
      if (ai.u_19c !== 0) {
        ai.u_19c = 8;
      } else {
        ai.u_1a8 = 8;
      }
      player.waterRoads = false;
      if (Road.buildRoad(player) < 0) {
        /* build_flag may have refused. */
        const fpos = AI_CURSOR_POS(player);
        if (MAP_OBJ(fpos) === MapObject.ObjectFlag &&
            !FLAG_HAS_BUILDING(AI_FLAG(MAP_OBJ_INDEX(fpos)))) {
          AI_GAME().demolishFlag_(fpos);
        }
        return;
      }
    }
    const pos = AI_CURSOR_POS(player);
    if (MAP_HAS_FLAG(pos)) {
      AI_GAME().sendGeologist(AI_FLAG(MAP_OBJ_INDEX(pos)));
    }
    return;
  }

  /* Building: raise the threshold for the next one. */
  const land = player.totalLandArea >= 0x1000 ? 0xfff :
                                               W(player.totalLandArea);
  ai.buildThreshold = sadd(ai.buildThreshold, W(0x3000 - 2 * land));

  AI_GAME().buildBuilding(
    AI_CURSOR_POS(player),
    aiGame().buildBuildingType as BuildingType, player);
  moveCursor(player, 1, 1);
  if (Road.pullRoadsThroughFlag(player) >= 0) {
    ai.u_1ba = 70;
    ai.u_19c = 12;
    ai.u_19e = 0;
  }
  ai.u_1a4 = 0;
  player.waterRoads = false;
  if (Road.buildRoad(player) < 0) {
    const pos = MAP_POS((ai.cursorCol - 1) & AI_MAP().getColMask(),
                        (ai.cursorRow - 1) & AI_MAP().getRowMask());
    /* build_building may have refused. */
    if (isBuildingObj(MAP_OBJ(pos))) {
      AI_GAME().demolishBuilding_(pos);
    }
  }
}

/* Slots 2, 6, 10, 11, 14 of update (0x28f66): compute the build
   wants and build the most wanted type. */
export function wantAndBuild(player: Player): void {
  const ai = player.ai;

  if (checkConstructionLimit(player) < 0) {
    /* Original bug: the stale want of type 25 is tested here. */
    ai.buildWant[24] = 0;
    Want.wantType25(player);
    if (ai.buildWant[24] !== 0) {
      aiGame().buildBuildingType = 25;
      buildBuilding(player);
      return;
    }
    Want.wantCastle(player);
    if (W(ai.buildWant[23]) < 10000) {
      scanSites(player);
      return;
    }
    aiGame().buildBuildingType = 24;
    buildBuilding(player);
    return;
  }

  /* Original bug: only the first 24 words are cleared (0x28f9e), so
     the want of type 25 stays set and wins every later choice. */
  for (let i = 0; i < 25; i++) ai.buildWant[i] = 0;

  if (player.emergencyActive) {
    if (!player.emergencyLumberjack &&
        W(player.lumberjackIndex) === 0) {
      Want.wantLumberjack(player);
    }
    if (!player.emergencySawmill &&
        W(player.sawmillIndex) === 0) {
      Want.wantSawmill(player);
    }
    if (!player.emergencyStone &&
        W(player.stonecutterIndex) === 0) {
      Want.wantStonecutter(player);
    }
  } else {
    Want.wantType25(player);
    Want.wantCastle(player);
    Want.wantFisher(player);
    Want.wantLumberjack(player);
    Want.wantBoatbuilder(player);
    Want.wantStonecutter(player);
    Want.wantStonemine(player);
    Want.wantGoldmine(player);
    Want.wantCoalmine(player);
    Want.wantIronmine(player);
    Want.wantForester(player);
    Want.wantHut(player);
    Want.wantFarm(player);
    Want.wantPigfarm(player);
    Want.wantMill(player);
    if (W(IDLE(player, SerfType.TypeDigger)) === 0 &&
        W(STOCK(player, ResourceType.TypeShovel)) === 0) {
      /* No leveling possible. */
      ai.buildWant[BuildingType.TypeFarm - 1] = 0;
      ai.buildWant[BuildingType.TypePigFarm - 1] = 0;
    } else {
      Want.wantStock(player);
      Want.wantButcher(player);
      Want.wantBaker(player);
      Want.wantSawmill(player);
      Want.wantSteelsmelter(player);
      Want.wantToolmaker(player);
      Want.wantWeaponsmith(player);
      Want.wantTower(player);
      Want.wantFortress(player);
      Want.wantGoldsmelter(player);
    }
  }

  let best = 0;
  let type = -1;
  for (let t = 1; t <= 25; t++) {
    if (W(ai.buildWant[t - 1]) > best) {
      best = W(ai.buildWant[t - 1]);
      type = t;
    }
  }
  if (type < 0) return;
  if (best < W(ai.buildThreshold)) return;

  aiGame().buildBuildingType = type;
  ai.buildDamp[type - 1] = W(ai.buildDamp[type - 1]) >> 1;
  buildBuilding(player);
}

/* Road::find_flag_connection on the flag at pos (the original passes
   it in A0 and D0/D1). budget is the caller's D7: 0 when a road was
   built, -600 on failure, unchanged if the flag has all paths. */
// PORT: `int *budget` is a box object.
export function findFlagConnectionAt(player: Player, pos: MapPos,
                                     budget: { value: number }): void {
  AI_SET_CURSOR(player, pos);
  const r = Road.findFlagConnection(player);
  if (r === 0) {
    budget.value = 0;
  } else if (r < 0) {
    budget.value = i16(W(budget.value - 600));
  }
}

export function asr1(v: number): number {
  return v < 0 ? -idiv(1 - v, 2) : idiv(v, 2);
}

/* Slots 7 and 15 of update (0x290b0): connect the pending
   positions (conquered buildings) to the own road network, then try
   to connect own flags found by a linear map scan. */
export function connectRoads(player: Player): void {
  const ai = player.ai;
  const budget = { value: 1000 }; /* D7 */
  const cols = AI_MAP().getCols();
  const rows = AI_MAP().getRows();

  for (let e = 0; e < 8; e++) {
    const pcol = pending(player, e, 0);
    const prow = pending(player, e, 1);
    if (pcol & 0x8000) break;

    const ecol = pcol & AI_MAP().getColMask();
    const erow = prow & AI_MAP().getRowMask();
    const epos = MAP_POS(ecol, erow);

    /* Nearest own flag on the rings 1..16. */
    let pos = epos;
    let ring = -1;
    for (let r = 0; r < 16 && ring < 0; r++) {
      pos = MAP_MOVE_DOWN_RIGHT(pos);
      for (let d: number = DirectionUp; d >= DirectionRight && ring < 0; d--) {
        for (let s = 0; s <= r; s++) {
          pos = MAP_MOVE(pos, d);
          if (MAP_HAS_FLAG(pos) && ownerBits(pos) === ownBits(player)) {
            ring = r;
            break;
          }
        }
      }
    }

    if (ring < 0) {
      budget.value = i16(W(budget.value - 50));
    } else if (ring < 8) {
      ai.cursorCol = ecol;
      ai.cursorRow = erow;
      roadParams(player, 0, 0, 12, 0, -1);
      player.waterRoads = false;
      Road.buildRoad(player);
      budget.value = -1;
    } else {
      /* Flag halfway to the found flag. */
      let dc = (MAP_POS_COL(pos) - ecol) & AI_MAP().getColMask();
      if (dc >= idiv(cols, 2)) dc -= cols;
      let dr = (MAP_POS_ROW(pos) - erow) & AI_MAP().getRowMask();
      if (dr >= idiv(rows, 2)) dr -= rows;
      const mid = MAP_POS((ecol + asr1(dc)) & AI_MAP().getColMask(),
                          (erow + asr1(dr)) & AI_MAP().getRowMask());

      let built = false;
      for (let i = 0; i < 37; i++) {
        const p = MAP_POS_ADD_SPIRALLY(mid, i);
        AI_SET_CURSOR(player, p);
        determineMapCursorType(player);
        if (ai.mapCursorType < AI_CURSOR_PATH ||
            ai.panelBtnType < AI_CAN_BUILD_FLAG ||
            player.noFlag) {
          continue;
        }

        AI_GAME().buildFlag(p, player);
        ai.cursorCol = ecol;
        ai.cursorRow = erow;
        roadParams(player, 0, 0, 12, 0, -1);
        player.waterRoads = false;
        Road.buildRoad(player);
        if (MAP_HAS_FLAG(p)) {
          const dummy = { value: budget.value };
          findFlagConnectionAt(player, p, dummy);
        }
        budget.value = -1;
        built = true;
        break;
      }
      if (!built) budget.value = i16(W(budget.value - 50));
    }

    pendingSet(player, 2 * e + 0, -1);
    pendingSet(player, 2 * e + 1, -1);
  }

  if (budget.value < 0) return;

  if (W(IDLE(player, SerfType.TypeTransporter) + IDLE(player, SerfType.TypeGeneric)) < 2) {
    scanSites(player);
    return;
  }

  /* Linear scan of budget + 1 positions from ptr+0x1a0. */
  let pos = u32(ai.u_1a0) & (AI_MAP().getSize() - 1);
  do {
    if (MAP_HAS_FLAG(pos) && ownerBits(pos) === ownBits(player)) {
      findFlagConnectionAt(player, pos, budget);
    }
    pos = (pos + 1) & (AI_MAP().getSize() - 1);
    budget.value = i16(W(budget.value - 1));
  } while (budget.value >= 0);
  ai.u_1a0 = pos;
}


/* ---- Phase machine ---- */

/* ai_update @0x28ee2: one step of the computer player. */
export function update(player: Player): void {
  const ai = player.ai;

  if (AI_GAME().gameSpeed === 0) return;

  switch (ai.phase) {
    case 0: placeCastle(player); return;
    case 1: wait(player); return;
    case 2: break;
    default: return;
  }

  ai.counter = W(ai.counter + 1);
  if (ai.counter & 7) {
    scanSites(player);
    return;
  }

  switch ((ai.counter & 0x78) >> 3) {
    case 0: updateSettings(player); break;
    case 1: case 5: case 9: case 13:
      updateBuildingStats(player);
      break;
    case 2: case 6: case 10: case 11: case 14:
      wantAndBuild(player);
      break;
    case 3: Manage.manageBuildings(player); break;
    case 4: case 12: Manage.attack(player); break;
    case 7: case 15: connectRoads(player); break;
    case 8: Manage.validateLocations(player); break;
  }
}
