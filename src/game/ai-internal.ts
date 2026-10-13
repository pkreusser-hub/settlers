/*
 * ai-internal.h - Computer player of the Amiga original, shared parts
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

/* The AI modules follow the original closely; these macros give them the
   original's view of the map and the game objects on top of the game
   classes. */

// PORT: the C++ macros are functions here and keep their upper-case names,
// so that the AI modules read like the C++. This module must not import a
// value from another game module (imports between them are circular), so
// enum values of other modules are written as numbers where needed.

import type { Building } from './building';
import type { Flag } from './flag';
import type { Game, GameAIFields } from './game';
import type { Inventory } from './inventory';
import type { Map as GameMap } from './map';
import type { Direction, MapPos } from './map-geometry';
import type { AIPoi, Player, PlayerAI } from './player';
import type { Serf } from './serf';

/* Values of PlayerAI::map_cursor_type (= Interface::CursorType). */
export const AI_CURSOR_NONE = 0;
export const AI_CURSOR_FLAG = 1;
export const AI_CURSOR_REMOVABLE_FLAG = 2;
export const AI_CURSOR_BUILDING = 3;
export const AI_CURSOR_PATH = 4;
export const AI_CURSOR_CLEAR_BY_FLAG = 5;
export const AI_CURSOR_CLEAR_BY_PATH = 6;
export const AI_CURSOR_CLEAR = 7;

/* Values of PlayerAI::panel_btn_type (= Interface::BuildPossibility). */
export const AI_CAN_BUILD_NONE = 0;
export const AI_CAN_BUILD_FLAG = 1;
export const AI_CAN_BUILD_MINE = 2;
export const AI_CAN_BUILD_SMALL = 3;
export const AI_CAN_BUILD_LARGE = 4;
export const AI_CAN_BUILD_CASTLE = 5;

/* Space taken by a map object, in the original's encoding (table
   @0x1f42). An open space allows constructions, a filled space (trees)
   roads but no constructions, an impassable space (stones, water
   objects, fields and seeds) neither. */
export enum AISpace {
  AI_SPACE_OPEN = 0,
  AI_SPACE_FILLED,
  AI_SPACE_IMPASSABLE,
  AI_SPACE_FLAG,
  AI_SPACE_SMALL_BUILDING,
  AI_SPACE_LARGE_BUILDING,
  AI_SPACE_CASTLE,
  AI_SPACE_INVALID = 0xff /* object 127 */,
}

export const AI_SPACE_OPEN = AISpace.AI_SPACE_OPEN;
export const AI_SPACE_FILLED = AISpace.AI_SPACE_FILLED;
export const AI_SPACE_IMPASSABLE = AISpace.AI_SPACE_IMPASSABLE;
export const AI_SPACE_FLAG = AISpace.AI_SPACE_FLAG;
export const AI_SPACE_SMALL_BUILDING = AISpace.AI_SPACE_SMALL_BUILDING;
export const AI_SPACE_LARGE_BUILDING = AISpace.AI_SPACE_LARGE_BUILDING;
export const AI_SPACE_CASTLE = AISpace.AI_SPACE_CASTLE;
export const AI_SPACE_INVALID = AISpace.AI_SPACE_INVALID;

/* Space taken by a map object (Amiga map_space_from_obj @0x1f42). */
// PORT: defined in ai.cc. It is here so that ai.ts and the AI modules do
// not need each other's values while they load.
export const aiSpaceFromObj: AISpace[] = [
  AI_SPACE_OPEN, // NONE = 0,
  AI_SPACE_FLAG, // FLAG,
  AI_SPACE_SMALL_BUILDING, // SMALL_BUILDING,
  AI_SPACE_LARGE_BUILDING, // LARGE_BUILDING,
  AI_SPACE_CASTLE, // CASTLE,
  AI_SPACE_OPEN,
  AI_SPACE_OPEN,
  AI_SPACE_OPEN,

  AI_SPACE_FILLED, // TREE_0 = 8,
  AI_SPACE_FILLED, // TREE_1,
  AI_SPACE_FILLED, // TREE_2, /* 10 */
  AI_SPACE_FILLED, // TREE_3,
  AI_SPACE_FILLED, // TREE_4,
  AI_SPACE_FILLED, // TREE_5,
  AI_SPACE_FILLED, // TREE_6,
  AI_SPACE_FILLED, // TREE_7, /* 15 */

  AI_SPACE_FILLED, // PINE_0,
  AI_SPACE_FILLED, // PINE_1,
  AI_SPACE_FILLED, // PINE_2,
  AI_SPACE_FILLED, // PINE_3,
  AI_SPACE_FILLED, // PINE_4, /* 20 */
  AI_SPACE_FILLED, // PINE_5,
  AI_SPACE_FILLED, // PINE_6,
  AI_SPACE_FILLED, // PINE_7,

  AI_SPACE_FILLED, // PALM_0,
  AI_SPACE_FILLED, // PALM_1, /* 25 */
  AI_SPACE_FILLED, // PALM_2,
  AI_SPACE_FILLED, // PALM_3,

  AI_SPACE_IMPASSABLE, // WATER_TREE_0,
  AI_SPACE_IMPASSABLE, // WATER_TREE_1,
  AI_SPACE_IMPASSABLE, // WATER_TREE_2, /* 30 */
  AI_SPACE_IMPASSABLE, // WATER_TREE_3,
  AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN, /* 32 */
  AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN,
  AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN, /* 40 */
  AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN,
  AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN, /* 48 */
  AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN,
  AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN, /* 56 */
  AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN,
  AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN, /* 64 */
  AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN, AI_SPACE_OPEN,

  AI_SPACE_IMPASSABLE, // STONE_0 = 72,
  AI_SPACE_IMPASSABLE, // STONE_1,
  AI_SPACE_IMPASSABLE, // STONE_2,
  AI_SPACE_IMPASSABLE, // STONE_3, /* 75 */
  AI_SPACE_IMPASSABLE, // STONE_4,
  AI_SPACE_IMPASSABLE, // STONE_5,
  AI_SPACE_IMPASSABLE, // STONE_6,
  AI_SPACE_IMPASSABLE, // STONE_7,

  AI_SPACE_IMPASSABLE, // SANDSTONE_0, /* 80 */
  AI_SPACE_IMPASSABLE, // SANDSTONE_1,
  //
  AI_SPACE_FILLED, // CROSS,
  AI_SPACE_OPEN, // STUB,

  AI_SPACE_OPEN, // STONE,
  AI_SPACE_OPEN, // SANDSTONE_3, /* 85 */

  AI_SPACE_OPEN, // CADAVER_0,
  AI_SPACE_OPEN, // CADAVER_1,

  AI_SPACE_IMPASSABLE, // WATER_STONE_0,
  AI_SPACE_IMPASSABLE, // WATER_STONE_1,

  AI_SPACE_FILLED, // CACTUS_0, /* 90 */
  AI_SPACE_FILLED, // CACTUS_1,

  AI_SPACE_FILLED, // DEAD_TREE,

  AI_SPACE_FILLED, // FELLED_PINE_0,
  AI_SPACE_FILLED, // FELLED_PINE_1,
  AI_SPACE_FILLED, // FELLED_PINE_2, /* 95 */
  AI_SPACE_FILLED, // FELLED_PINE_3,
  AI_SPACE_OPEN, // FELLED_PINE_4,

  AI_SPACE_FILLED, // FELLED_TREE_0,
  AI_SPACE_FILLED, // FELLED_TREE_1,
  AI_SPACE_FILLED, // FELLED_TREE_2, /* 100 */
  AI_SPACE_FILLED, // FELLED_TREE_3,
  AI_SPACE_OPEN, // FELLED_TREE_4,

  AI_SPACE_FILLED, // NEW_PINE,
  AI_SPACE_FILLED, // NEW_TREE,

  AI_SPACE_IMPASSABLE, // SEEDS_0, /* 105 */
  AI_SPACE_IMPASSABLE, // SEEDS_1,
  AI_SPACE_IMPASSABLE, // SEEDS_2,
  AI_SPACE_IMPASSABLE, // SEEDS_3,
  AI_SPACE_IMPASSABLE, // SEEDS_4,
  AI_SPACE_IMPASSABLE, // SEEDS_5, /* 110 */
  AI_SPACE_OPEN, // FIELD_EXPIRED,

  AI_SPACE_OPEN, // SIGN_LARGE_GOLD,
  AI_SPACE_OPEN, // SIGN_SMALL_GOLD,
  AI_SPACE_OPEN, // SIGN_LARGE_IRON,
  AI_SPACE_OPEN, // SIGN_SMALL_IRON, /* 115 */
  AI_SPACE_OPEN, // SIGN_LARGE_COAL,
  AI_SPACE_OPEN, // SIGN_SMALL_COAL,
  AI_SPACE_OPEN, // SIGN_LARGE_STONE,
  AI_SPACE_OPEN, // SIGN_SMALL_STONE,

  AI_SPACE_OPEN, // SIGN_EMPTY, /* 120 */

  AI_SPACE_IMPASSABLE, // FIELD_0,
  AI_SPACE_IMPASSABLE, // FIELD_1,
  AI_SPACE_IMPASSABLE, // FIELD_2,
  AI_SPACE_IMPASSABLE, // FIELD_3,
  AI_SPACE_IMPASSABLE, // FIELD_4, /* 125 */
  AI_SPACE_IMPASSABLE, // FIELD_5,
  AI_SPACE_INVALID, // 127
];

/* The game, map and AI work fields of the current AI call. */
// PORT: `Game *AI::game` (ai.cc). The static lives here, AI.game in ai.ts
// reads and writes it.
export const aiCall: { game: Game | null } = { game: null };

export function AI_GAME(): Game {
  return aiCall.game!;
}
export function AI_MAP(): GameMap {
  return aiCall.game!.getMap();
}
export function aiGame(): GameAIFields {
  return aiCall.game!.getAiGame();
}

/* Original's "blocked" bit (paths bit 6): lake water, the impassable
   objects the map generator keeps, and buildings. The game classes do
   not store it, so it is derived from those. */
// PORT: defined in ai.cc, see aiSpaceFromObj.
export function aiMapBlocked(pos: MapPos): boolean {
  if (MAP_IN_WATER(pos)) {
    return true;
  }
  const space = MAP_SPACE(pos);
  return space >= AI_SPACE_IMPASSABLE && space !== AI_SPACE_FLAG;
}

/* Map positions. */
export function MAP_POS(x: number, y: number): MapPos {
  return AI_MAP().pos(x, y);
}
export function MAP_POS_COL(pos: MapPos): number {
  return AI_MAP().posCol(pos);
}
export function MAP_POS_ROW(pos: MapPos): number {
  return AI_MAP().posRow(pos);
}
export function MAP_POS_ADD(pos: MapPos, off: MapPos): MapPos {
  return AI_MAP().posAdd(pos, off);
}
export function MAP_POS_ADD_SPIRALLY(pos: MapPos, i: number): MapPos {
  return AI_MAP().posAddSpirally(pos, i);
}
export function MAP_MOVE(pos: MapPos, dir: number): MapPos {
  return AI_MAP().move(pos, dir as Direction);
}
export function MAP_MOVE_RIGHT(pos: MapPos): MapPos {
  return AI_MAP().moveRight(pos);
}
export function MAP_MOVE_DOWN_RIGHT(pos: MapPos): MapPos {
  return AI_MAP().moveDownRight(pos);
}
export function MAP_MOVE_DOWN(pos: MapPos): MapPos {
  return AI_MAP().moveDown(pos);
}
export function MAP_MOVE_LEFT(pos: MapPos): MapPos {
  return AI_MAP().moveLeft(pos);
}
export function MAP_MOVE_UP_LEFT(pos: MapPos): MapPos {
  return AI_MAP().moveUpLeft(pos);
}
export function MAP_MOVE_UP(pos: MapPos): MapPos {
  return AI_MAP().moveUp(pos);
}

/* Map tiles. */
export function MAP_OBJ(pos: MapPos): number {
  return AI_MAP().getObj(pos);
}
export function MAP_OBJ_INDEX(pos: MapPos): number {
  return AI_MAP().getObjIndex(pos);
}
export function MAP_PATHS(pos: MapPos): number {
  return AI_MAP().paths(pos);
}
export function MAP_HAS_FLAG(pos: MapPos): boolean {
  return AI_MAP().hasFlag(pos);
}
export function MAP_HAS_OWNER(pos: MapPos): boolean {
  return AI_MAP().hasOwner(pos);
}
export function MAP_OWNER(pos: MapPos): number {
  return AI_MAP().getOwner(pos);
}
export function MAP_HEIGHT(pos: MapPos): number {
  return AI_MAP().getHeight(pos);
}
export function MAP_IDLE_SERF(pos: MapPos): boolean {
  return AI_MAP().getIdleSerf(pos);
}
export function MAP_SERF_INDEX(pos: MapPos): number {
  return AI_MAP().getSerfIndex(pos);
}
export function MAP_TYPE_UP(pos: MapPos): number {
  return AI_MAP().typeUp(pos) >>> 0;
}
export function MAP_TYPE_DOWN(pos: MapPos): number {
  return AI_MAP().typeDown(pos) >>> 0;
}
export function MAP_WATER_MARK(pos: MapPos): boolean {
  return MAP_TYPE_UP(pos) < 4 || MAP_TYPE_DOWN(pos) < 4;
}
export function MAP_IN_WATER(pos: MapPos): boolean {
  return AI_MAP().isInWater(pos);
}
export function MAP_RES_TYPE(pos: MapPos): number {
  return AI_MAP().getResType(pos);
}
export function MAP_RES_FISH(pos: MapPos): number {
  return AI_MAP().getResFish(pos);
}
export function MAP_BLOCKED(pos: MapPos): boolean {
  return aiMapBlocked(pos);
}
export function MAP_SPACE(pos: MapPos): AISpace {
  return aiSpaceFromObj[MAP_OBJ(pos)];
}

/* Game objects by index; index 0 is never allocated. */
// PORT: the C++ dereferences these unchecked, so they are typed non-null.
export function AI_BUILDING(i: number): Building {
  return AI_GAME().getBuilding(i)!;
}
export function AI_FLAG(i: number): Flag {
  return AI_GAME().getFlag(i)!;
}
export function AI_SERF(i: number): Serf {
  return AI_GAME().getSerf(i)!;
}
export function AI_INVENTORY(i: number): Inventory {
  return AI_GAME().getInventory(i)!;
}
export function BUILDING_ALLOCATED(i: number): boolean {
  return i !== 0 && AI_GAME().getBuilding(i) != null;
}
export function SERF_ALLOCATED(i: number): boolean {
  return i !== 0 && AI_GAME().getSerf(i) != null;
}
export function INVENTORY_ALLOCATED(i: number): boolean {
  return AI_GAME().getInventory(i) != null;
}

/* Buildings. */
export function BUILDING_TYPE(b: Building): number {
  return b.getType();
}
export function BUILDING_PLAYER(b: Building): number {
  return b.getOwner() | 0;
}
export function BUILDING_IS_DONE(b: Building): boolean {
  return b.isDone();
}
export function BUILDING_IS_BURNING(b: Building): boolean {
  return b.isBurning();
}
export function BUILDING_IS_ACTIVE(b: Building): boolean {
  return b.isActive();
}
export function BUILDING_HAS_SERF(b: Building): boolean {
  return b.hasSerf();
}
/* The military state: higher values are closer to the enemy. */
export function BUILDING_STATE(b: Building): number {
  return b.getThreatLevel() | 0;
}

/* Flags. */
export function FLAG_PATHS(f: Flag): number {
  return f.pathCon & 0x3f;
}
export function FLAG_HAS_PATH(f: Flag, d: number): boolean {
  return f.hasPath(d as Direction);
}
export function FLAG_IS_WATER_PATH(f: Flag, d: number): boolean {
  return f.isWaterPath(d as Direction);
}
export function FLAG_HAS_BUILDING(f: Flag): boolean {
  return f.hasBuilding();
}
export function FLAG_HAS_INVENTORY(f: Flag): boolean {
  return f.hasInventory();
}
export function FLAG_ACCEPTS_SERFS(f: Flag): boolean {
  return f.acceptsSerfs();
}
export function FLAG_ACCEPTS_RESOURCES(f: Flag): boolean {
  return f.acceptsResources();
}
export function FLAG_SERF_REQUESTED(f: Flag, d: number): boolean {
  return f.serfRequested(d as Direction);
}

/* Serfs. */
export function SERF_TYPE(s: Serf): number {
  return s.getType();
}
export function SERF_PLAYER(s: Serf): number {
  return s.getOwner() | 0;
}
export function SERF_INDEX(s: Serf): number {
  return s.getIndex() | 0;
}

/* Players. */
export function PLAYER_NUM(p: Player): number {
  return p.getIndex() | 0;
}
export function PLAYER_IS_ACTIVE(p: Player | null): p is Player {
  return p != null;
}
export function PLAYER_IN_GAME(p: Player | null): boolean {
  return p != null && p.isInGame();
}
export function PLAYER_IS_AI(p: Player): boolean {
  return p.isAi();
}
export function PLAYER_HAS_CASTLE(p: Player): boolean {
  return p.hasCastle();
}
export function PLAYER_ALLOW_FLAG(p: Player): boolean {
  return p.allowFlag();
}

/* Cursor of the computer player. */
export function AI_CURSOR_POS(player: Player): MapPos {
  return MAP_POS(player.ai.cursorCol, player.ai.cursorRow);
}
export function AI_SET_CURSOR(player: Player, pos: MapPos): void {
  player.ai.cursorCol = MAP_POS_COL(pos);
  player.ai.cursorRow = MAP_POS_ROW(pos);
}

// PORT: the helpers below stand in for pointer arithmetic of the C++.

/* The poi struct is 44 words in the original, 44 ints here. */
// PORT: POI(p, off) of ai-rate.cc reinterprets an AIPoi as int[44] and is
// an lvalue; here POI reads the word at Amiga byte offset off and POI_SET
// writes it.
export function poiWord(p: AIPoi, w: number): number {
  if (w >= 5 && w < 30) return p.bldCount[w - 5];
  if (w >= 33 && w < 37) return p.deposit[w - 33];
  switch (w) {
    case 0: return p.field_0;
    case 1: return p.field_2;
    case 2: return p.field_4;
    case 3: return p.field_6;
    case 4: return p.field_8;
    case 30: return p.trees;
    case 31: return p.field_3e;
    case 32: return p.stones;
    case 37: return p.field_4a;
    case 38: return p.field_4c;
    case 39: return p.field_4e;
    case 40: return p.field_50;
    case 41: return p.field_52;
    case 42: return p.field_54;
    default: return p.field_56;
  }
}

export function poiSetWord(p: AIPoi, w: number, v: number): void {
  if (w >= 5 && w < 30) {
    p.bldCount[w - 5] = v;
    return;
  }
  if (w >= 33 && w < 37) {
    p.deposit[w - 33] = v;
    return;
  }
  switch (w) {
    case 0: p.field_0 = v; break;
    case 1: p.field_2 = v; break;
    case 2: p.field_4 = v; break;
    case 3: p.field_6 = v; break;
    case 4: p.field_8 = v; break;
    case 30: p.trees = v; break;
    case 31: p.field_3e = v; break;
    case 32: p.stones = v; break;
    case 37: p.field_4a = v; break;
    case 38: p.field_4c = v; break;
    case 39: p.field_4e = v; break;
    case 40: p.field_50 = v; break;
    case 41: p.field_52 = v; break;
    case 42: p.field_54 = v; break;
    default: p.field_56 = v; break;
  }
}

export function POI(p: AIPoi, off: number): number {
  return poiWord(p, off >> 1);
}
export function POI_SET(p: AIPoi, off: number, v: number): void {
  poiSetWord(p, off >> 1, v);
}

// PORT: `*dst = *src` on AIPoi structs.
export function poiCopy(dst: AIPoi, src: AIPoi): void {
  for (let w = 0; w < 44; w++) poiSetWord(dst, w, poiWord(src, w));
}

// PORT: memset(poi, 0, sizeof(*poi)).
export function poiClear(p: AIPoi): void {
  for (let w = 0; w < 44; w++) poiSetWord(p, w, 0);
}

type UKey = {
  [K in keyof PlayerAI]: K extends `u_${string}` ? K : never
}[keyof PlayerAI];

const statUKeys: UKey[] = [
  'u_394', 'u_396', 'u_398', 'u_39a', 'u_39c', 'u_39e', 'u_3a0', 'u_3a2',
  'u_3a4', 'u_3a6', 'u_3a8', 'u_3aa', 'u_3ac', 'u_3ae', 'u_3b0', 'u_3b2',
  'u_3b4', 'u_3b6', 'u_3b8', 'u_3ba', 'u_3bc', 'u_3be', 'u_3c0', 'u_3c2',
  'u_3c4', 'u_3c6', 'u_3c8', 'u_3ca', 'u_3cc', 'u_3ce',
];

/* Word at Amiga pointer-relative offset off (0x33c..0x3ce) of the
   statistics area: poi[4] and u_394..u_3ce. */
// PORT: AI::Core::stat and AI::Want::stat return an `int *` into the
// player record. Both are the same function; this is its read side and
// statSet its write side.
export function statGet(player: Player, off: number): number {
  if (off >= 0x394) {
    return player.ai[statUKeys[(off - 0x394) >> 1]];
  }
  return poiWord(player.ai.poi[4], (off - 0x33c) >> 1);
}

export function statSet(player: Player, off: number, v: number): void {
  if (off >= 0x394) {
    player.ai[statUKeys[(off - 0x394) >> 1]] = v;
    return;
  }
  poiSetWord(player.ai.poi[4], (off - 0x33c) >> 1, v);
}

const pendingKeys: UKey[] = [
  'u_1bc', 'u_1be', 'u_1c0', 'u_1c2', 'u_1c4', 'u_1c6', 'u_1c8', 'u_1ca',
  'u_1cc', 'u_1ce', 'u_1d0', 'u_1d2', 'u_1d4', 'u_1d6', 'u_1d8', 'u_1da',
];

/* Pending road connections (ptr+0x1bc..0x1da): 8 x {col, row}, empty
   when col has bit 15 set (the original's tst.l bmi). Filled by the
   game when a knight of the AI player occupies an enemy building. */
// PORT: AI::Core::pending returns an `int *`, and AI::building_conquered
// indexes `&ai.u_1bc` as an array of 16 ints; these read and write word n
// of that array.
export function pendingGet(player: Player, n: number): number {
  return player.ai[pendingKeys[n]];
}
export function pendingSet(player: Player, n: number, v: number): void {
  player.ai[pendingKeys[n]] = v;
}
