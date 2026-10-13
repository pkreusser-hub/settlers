/*
 * ai-road.cc - Computer player: road building
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

/* The road builder works on a 19x19 grid of map positions centered on
   the AI cursor (grid index = row * 19 + col, center 180). Each cell
   holds a byte:
     0x00..0x3f  cost of walking over the cell,
     0x40..0x4f  target: a flag (category 0),
     0x50..0x7e  target: a path tile or shore tile where a flag can
                 be built (category 1),
     0x7f        blocked, 0xff unreachable / not evaluated.
   A layered shortest path search (at most 21 steps) records the best
   path to each target; the roads are then built in order of cost. */

// PORT: the C++ class AI::Road (ai-road.h) only has static members; they
// are the exported functions of this module. The class name would also
// clash with the Road of map.ts, which is imported as MapRoad here (the
// C++ writes ::Road).

import * as Core from './ai-core';
import {
  AI_BUILDING, AI_CAN_BUILD_FLAG, AI_CAN_BUILD_LARGE, AI_CAN_BUILD_MINE,
  AI_CAN_BUILD_SMALL, AI_CURSOR_CLEAR, AI_CURSOR_CLEAR_BY_FLAG,
  AI_CURSOR_PATH, AI_CURSOR_POS, AI_FLAG, AI_GAME, AI_MAP, AI_SET_CURSOR,
  AI_SPACE_IMPASSABLE, BUILDING_PLAYER, BUILDING_TYPE, FLAG_HAS_INVENTORY,
  FLAG_PATHS, MAP_BLOCKED, MAP_HAS_FLAG, MAP_HAS_OWNER, MAP_HEIGHT,
  MAP_IN_WATER, MAP_MOVE, MAP_MOVE_DOWN, MAP_MOVE_DOWN_RIGHT, MAP_MOVE_LEFT,
  MAP_MOVE_RIGHT, MAP_MOVE_UP, MAP_MOVE_UP_LEFT, MAP_OBJ, MAP_OBJ_INDEX,
  MAP_OWNER, MAP_PATHS, MAP_POS, MAP_SPACE, MAP_TYPE_DOWN, MAP_TYPE_UP,
  PLAYER_ALLOW_FLAG, PLAYER_NUM, aiGame,
} from './ai-internal';
import { BuildingType } from './building';
import type { Flag } from './flag';
import { FlagSearch } from './flag';
import { MapObject, Road as MapRoad } from './map';
import type { Direction, MapPos } from './map-geometry';
import { DirectionNone, DirectionRight, DirectionUp } from './map-geometry';
import { BIT_TEST, Log, i16, idiv, u16 } from './misc';
import type { Player } from './player';

const GRID_SIZE = 19;
const GRID_CELLS = GRID_SIZE * GRID_SIZE;
const GRID_CENTER = 180;
const MAX_TARGETS = 63;

/* Amiga player->build bit 4: build water roads. */
const AI_BUILD_WATER = (player: Player): boolean => player.waterRoads;

/* Grid index offsets of the six directions (right, down right,
   down, left, up left, up). */
const gridDirOffset: number[] = [1, 20, 19, -1, -20, -19];

/* Extra cost around own farms (7x7, @0x2b152) and foresters
   (13x13, @0x2b183). */
const costFarm: number[] = [
  7, 7, 7, 7, 0, 0, 0,
  7, 8, 8, 8, 7, 0, 0,
  7, 8, 9, 9, 8, 7, 0,
  7, 8, 9, 9, 9, 8, 7,
  0, 7, 8, 9, 9, 8, 7,
  0, 0, 7, 8, 8, 8, 7,
  0, 0, 0, 7, 7, 7, 7,
];

const costForester: number[] = [
  4, 4, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 0,
  4, 5, 5, 5, 5, 5, 5, 4, 0, 0, 0, 0, 0,
  4, 5, 6, 6, 6, 6, 6, 5, 4, 0, 0, 0, 0,
  4, 5, 6, 7, 7, 7, 7, 6, 5, 4, 0, 0, 0,
  4, 5, 6, 7, 8, 8, 8, 7, 6, 5, 4, 0, 0,
  4, 5, 6, 7, 8, 9, 9, 8, 7, 6, 5, 4, 0,
  4, 5, 6, 7, 8, 9, 9, 9, 8, 7, 6, 5, 4,
  0, 4, 5, 6, 7, 8, 9, 9, 8, 7, 6, 5, 4,
  0, 0, 4, 5, 6, 7, 8, 8, 8, 7, 6, 5, 4,
  0, 0, 0, 4, 5, 6, 7, 7, 7, 7, 6, 5, 4,
  0, 0, 0, 0, 4, 5, 6, 6, 6, 6, 6, 5, 4,
  0, 0, 0, 0, 0, 4, 5, 5, 5, 5, 5, 5, 4,
  0, 0, 0, 0, 0, 0, 4, 4, 4, 4, 4, 4, 4,
];

// PORT: a path is a uint64_t in the C++ (up to 21 steps of 3 bits), so it
// is a bigint here.
type RoadPath = bigint;

/* Work tables of ai_build_road (Amiga: inside game->land_influence,
   the cost grid itself is ai_game.land_influence[0..360]). */
// PORT: file statics, shared by all games as in the C++. build_road
// resets them on every call.
const gridPos: MapPos[] = new Array<MapPos>(GRID_CELLS).fill(0); /* +0x16c */
const gridBest = new Uint16Array(GRID_CELLS); /* +0x710 */
const targetPath: RoadPath[] = new Array<RoadPath>(MAX_TARGETS + 1).fill(0n); /* +0x9e2 */
const targetCost = new Uint16Array(MAX_TARGETS + 1); /* +0xbda */

/* Search queue entry (Amiga 12 bytes at game+0x120/0x124). The path is
   a list of 3-bit direction codes (dir + 1), first step in the most
   significant used group. */
interface RoadQueue {
  cost: number; // uint16_t
  index: number;
  path: RoadPath;
}

const ROAD_QUEUE_SIZE = GRID_CELLS * 6;
// PORT: `static RoadQueue road_queue[2][ROAD_QUEUE_SIZE]` is zero
// initialised; the entries are created on first use here.
const roadQueue: RoadQueue[][] = [[], []];

function roadQueueEntry(queue: RoadQueue[], i: number): RoadQueue {
  let e = queue[i];
  if (e === undefined) {
    e = { cost: 0, index: 0, path: 0n };
    queue[i] = e;
  }
  return e;
}

// PORT: `static Flag *flag_queue[2][FLAG_QUEUE_SIZE]` with
// FLAG_QUEUE_SIZE 1024. The arrays grow as needed here;
// find_flag_connection stops a layer after 0x3e2 entries as in the C++.
const flagQueue: Flag[][] = [[], []];


/* Move the AI cursor to pos and evaluate it (determine_map_cursor_type
   @0x19368 with ptr+0xfc/0xfe). */
export function cursorAt(player: Player, pos: MapPos): void {
  AI_SET_CURSOR(player, pos);
  Core.determineMapCursorType(player);
}

/* Amiga obj bit 7 (map_mark_water_tiles): the vertex' own up or down
   triangle is water. legacy keeps no marker. */
export function waterMarker(pos: MapPos): boolean {
  return MAP_TYPE_UP(pos) < 4 || MAP_TYPE_DOWN(pos) < 4;
}

/* Amiga paths bit 6 ("blocked": lake water, kept impassable objects,
   buildings). */
export function tileBlocked(pos: MapPos): boolean {
  return MAP_BLOCKED(pos);
}

export function ownedBy(pos: MapPos, player: Player): boolean {
  return MAP_HAS_OWNER(pos) &&
         (MAP_OWNER(pos) | 0) === PLAYER_NUM(player);
}

/* ai_road_tile_cost @0x2b4d8: evaluate grid cell index at map pos in
   ring ring. Clears *found when the cell became passable. */
// PORT: `int *found` is a box object; the `goto out` of the C++ is the
// labelled block.
export function roadTileCost(player: Player, index: number, pos: MapPos, ring: number,
                             found: { value: number }): void {
  const grid = aiGame().landInfluence;

  out: {
    /* Only cells next to an already passable cell. */
    if (grid[index - 1] >= 0x40 && grid[index - 19] >= 0x40 &&
        grid[index - 20] >= 0x40 && grid[index + 1] >= 0x40 &&
        grid[index + 19] >= 0x40 && grid[index + 20] >= 0x40) {
      break out;
    }

    if (!ownedBy(pos, player)) break out;

    if (MAP_HAS_FLAG(pos)) {
      /* Flag: a category 0 target. */
      if (i16(player.ai.u_1a4) < 0) {
        /* Connecting a flag (ai_find_flag_connection): skip
           flags of its own network; with u_1a4 = -2 only
           those found in the first three search layers. */
        const flag = AI_FLAG(MAP_OBJ_INDEX(pos));
        if (i16(player.ai.u_1a4) === -1 ||
            (flag.searchDir as number) === 0) {
          if ((flag.searchNum & 0xffff) ===
              (player.ai.u_1a6 & 0xffff)) {
            break out;
          }
        }
      }

      if (aiGame().g24a === 0x50) break out;
      grid[index] = aiGame().g24a;
      aiGame().g24a += 1;
      break out;
    }

    if (AI_BUILD_WATER(player)) {
      /* Water road. */
      if (MAP_PATHS(pos) !== 0) break out;
      if (MAP_OBJ(pos) !== 0) break out;

      /* Original bug: the test of the UP neighbour's up triangle
         (@0x2b57a) loads the type into D7 and tests the stale D6,
         so it always passes. Test all six triangles. */
      if (MAP_IN_WATER(pos)) {
        grid[index] = 2;
        found.value = 0;
        break out;
      }

      /* Shore: a category 1 target where a flag can be built. */
      if (ring < 3) break out;
      cursorAt(player, pos);
      if ((player.ai.mapCursorType === AI_CURSOR_CLEAR ||
           player.ai.mapCursorType === AI_CURSOR_PATH) &&
          player.ai.panelBtnType === AI_CAN_BUILD_FLAG &&
          PLAYER_ALLOW_FLAG(player) &&
          aiGame().g24c !== 0x7f) {
        grid[index] = aiGame().g24c;
        aiGame().g24c += 1;
      }
      break out;
    }

    if (tileBlocked(pos)) break out;
    if (MAP_OBJ(pos) !== 0 &&
        MAP_SPACE(pos) >= AI_SPACE_IMPASSABLE) {
      break out;
    }

    if (MAP_PATHS(pos) !== 0) {
      /* Path: a category 1 target (a flag splits the road). */
      if (i16(player.ai.u_1a4) < 0) break out;
      cursorAt(player, pos);
      if (player.ai.mapCursorType === AI_CURSOR_PATH &&
          player.ai.panelBtnType === AI_CAN_BUILD_FLAG &&
          PLAYER_ALLOW_FLAG(player) &&
          aiGame().g24c !== 0x7f) {
        grid[index] = aiGame().g24c;
        aiGame().g24c += 1;
      }
      break out;
    }

    /* Free tile. */
    cursorAt(player, pos);
    if (player.ai.mapCursorType >= AI_CURSOR_CLEAR_BY_FLAG &&
        player.ai.panelBtnType >= AI_CAN_BUILD_MINE) {
      /* Keep building sites free (mine and large sites more). */
      if (player.ai.panelBtnType >= AI_CAN_BUILD_LARGE) {
        grid[index] = 20;
      } else if (player.ai.panelBtnType >= AI_CAN_BUILD_SMALL) {
        grid[index] = 3;
      } else {
        grid[index] = 20;
      }
    } else if (waterMarker(pos) ||
               waterMarker(MAP_MOVE_UP_LEFT(pos))) {
      grid[index] = 4;
    } else if (ownedBy(MAP_MOVE_UP_LEFT(pos), player) &&
               ownedBy(MAP_MOVE_UP(pos), player) &&
               ownedBy(MAP_MOVE_RIGHT(pos), player) &&
               ownedBy(MAP_MOVE_DOWN_RIGHT(pos), player) &&
               ownedBy(MAP_MOVE_DOWN(pos), player) &&
               ownedBy(MAP_MOVE_LEFT(pos), player)) {
      /* Inside own land. */
      grid[index] = 0;
    } else {
      /* At the border. */
      grid[index] = 3;
    }
    found.value = 0;
  }

  gridPos[index] = pos;
}

/* Number of steps of a path. */
export function roadPathLength(path: RoadPath): number {
  let length = 0;
  while (path !== 0n) {
    path >>= 3n;
    length += 1;
  }
  return length;
}

/* ai_road_path_step @0x2b44a: decode the direction list. */
export function roadPathDirs(path: RoadPath, dirs: Direction[]): number {
  const length = roadPathLength(path);
  for (let i = 0; i < length; i++) {
    dirs[i] = (Number((path >> BigInt(3 * (length - 1 - i))) & 7n) - 1) as Direction;
  }
  return length;
}

/* ai_build_road_along_path @0x2b22c: build the road from the cursor
   along path. category (game+0x248) is 1 if the end is a path or
   shore tile that needs a flag first. The original writes the path
   bits itself (ai_road_finish @0x2b424 only redraws the tiles,
   redraw_map_pos_panels @0x1d20e); here Game::build_road builds the
   road. Returns < 0 on failure. */
export function buildRoadAlongPath(player: Player, path: RoadPath,
                                   category: number): number {
  const dirs: Direction[] = [];
  const length = roadPathDirs(path, dirs);
  const source = AI_CURSOR_POS(player);

  /* The tiles between the ends must be free of paths. */
  let pos = source;
  for (let i = 0; i < length; i++) {
    pos = MAP_MOVE(pos, dirs[i]);
    if (i < length - 1 && MAP_PATHS(pos) !== 0) return -1;
  }
  const dest = pos;

  /* Not in the original: the game checks the segments (objects, owner,
     water/land changes) more strictly than the AI cost grid. Check
     the part that does not depend on the end flag before anything
     is changed. */
  if (category === 0) {
    const road = new MapRoad();
    road.start(source);
    for (let i = 0; i < length; i++) road.extend(dirs[i]);
    if (AI_GAME().canBuildRoad(road, player, null, null) <= 0) {
      return -1;
    }
  } else if (length > 1) {
    const road = new MapRoad();
    road.start(source);
    for (let i = 0; i < length - 1; i++) road.extend(dirs[i]);
    if (AI_GAME().canBuildRoad(road, player, null, null) <= 0) {
      return -1;
    }
  }

  if (category !== 0) {
    /* Place the end flag. */
    aiGame().g24a = player.ai.cursorCol;
    aiGame().g24c = player.ai.cursorRow;
    cursorAt(player, dest);

    let ok = 0;
    if (player.ai.mapCursorType === AI_CURSOR_PATH) {
      if (player.ai.panelBtnType >= AI_CAN_BUILD_FLAG &&
          PLAYER_ALLOW_FLAG(player)) {
        AI_GAME().buildFlag(dest, player);
        ok = 1;
      }
    } else if (AI_BUILD_WATER(player) &&
               player.ai.mapCursorType === AI_CURSOR_CLEAR &&
               player.ai.panelBtnType >= AI_CAN_BUILD_FLAG &&
               PLAYER_ALLOW_FLAG(player)) {
      AI_GAME().buildFlag(dest, player);
      pullRoadsThroughFlag(player);
      ok = 1;
    }

    player.ai.cursorCol = aiGame().g24a;
    player.ai.cursorRow = aiGame().g24c;
    if (!ok) return -1;
  }

  /* Adjust the limits for the next roads of this call. */
  if (i16(player.ai.u_1a4) > 0) {
    player.ai.u_1a4 -= 1;
    if (player.ai.u_1a4 === 0) {
      player.ai.u_1ba = 70;
      player.ai.u_19c = 10;
    }
  } else {
    if ((player.ai.u_1ba & 0xffff) === 0) {
      let limit = (aiGame().g24e * 2) & 0xffff;
      if (limit >= 70) limit = 70;
      player.ai.u_1ba = limit;
    }
    if ((player.ai.u_19c & 0xffff) === 0) {
      player.ai.u_19c = player.ai.u_1a8;
    }
  }

  /* The original cannot fail here; the game may still refuse the last
     segment (the end flag stays then). */
  const road = new MapRoad();
  road.start(source);
  for (let i = 0; i < length; i++) road.extend(dirs[i]);
  if (!AI_GAME().buildRoad(road, player)) {
    Log.Debug('ai', 'player ', PLAYER_NUM(player),
              ': road from ', source, ' failed');
    return -1;
  }

  return 0;
}

/* ai_build_road @0x2a8f2: build roads from the flag at the AI cursor.
   Parameters:
     u_1ba  max. cost of a road (0 = no limit; set from the first road),
     u_19c  max. average cost per step (0 = no limit),
     u_1a8  value for u_19c after the first road if it was 0,
     u_1a4  > 0: number of roads until the limits become 70/10,
            -1/-2: connecting a flag (ai_find_flag_connection, the
            flag search id is in u_1a6),
     u_19e  set to 0 when a road was built (callers set -1),
     player->water_roads (build bit 4): water roads.
   Returns u_19e (< 0: no road built). */
export function buildRoad(player: Player): number {
  const grid = aiGame().landInfluence;

  grid.fill(0xff, 0, GRID_CELLS);
  /* The original keeps these tables in a scratch area shared with
     other routines; start from a defined state so that a loaded
     game continues exactly like the saved one. */
  gridPos.fill(0);
  gridBest.fill(0);
  targetPath.fill(0n);
  targetCost.fill(0);

  aiGame().g24e = player.ai.cursorCol;
  aiGame().g246 = player.ai.cursorRow;

  let pos = AI_CURSOR_POS(player);
  let index = GRID_CENTER;

  aiGame().g24a = 0x40;
  aiGame().g24c = 0x50;
  grid[index] = 0;
  gridPos[index] = pos;

  /* Evaluate rings around the cursor while they have passable
     cells (at most 8 rings). */
  for (let ring = 0; ring < 8; ring++) {
    const found = { value: -1 };
    pos = MAP_MOVE_RIGHT(pos);
    index += 1;

    for (let i = 0; i <= ring; i++) {
      roadTileCost(player, index, pos, ring, found);
      pos = MAP_MOVE_DOWN(pos);
      index += 19;
    }
    for (let i = 0; i <= ring; i++) {
      roadTileCost(player, index, pos, ring, found);
      pos = MAP_MOVE_LEFT(pos);
      index -= 1;
    }
    for (let i = 0; i <= ring; i++) {
      roadTileCost(player, index, pos, ring, found);
      pos = MAP_MOVE_UP_LEFT(pos);
      index -= 20;
    }
    for (let i = 0; i <= ring; i++) {
      roadTileCost(player, index, pos, ring, found);
      pos = MAP_MOVE_UP(pos);
      index -= 19;
    }
    for (let i = 0; i <= ring; i++) {
      roadTileCost(player, index, pos, ring, found);
      pos = MAP_MOVE_RIGHT(pos);
      index += 1;
    }
    for (let i = 0; i <= ring; i++) {
      roadTileCost(player, index, pos, ring, found);
      pos = MAP_MOVE_DOWN_RIGHT(pos);
      index += 20;
    }

    if (found.value < 0) break;
  }

  /* The start is blocked, its neighbours (where no flag can be
     placed anyway) get 30 more. */
  grid[GRID_CENTER] = 0x7f;
  for (let d = 0; d < 6; d++) {
    const order = gridDirOffset; /* { 1, 20, 19, -1, -20, -19 } */
    const vi = GRID_CENTER + order[d];
    if (grid[vi] < 0x80) {
      let c = grid[vi] + 30;
      if (c >= 0x40) c = 0x3f;
      grid[vi] = c;
    }
  }

  /* Extra cost around own foresters and farms. */
  const startCol = aiGame().g24e;
  const startRow = aiGame().g246;
  for (let y = -6; y < 25; y++) {
    for (let x = -6; x < 25; x++) {
      const p = MAP_POS((startCol + x - 9) & AI_MAP().getColMask(),
                        (startRow + y - 9) & AI_MAP().getRowMask());
      let table: number[];
      let width: number;

      if (MAP_OBJ(p) === MapObject.ObjectSmallBuilding) {
        const b = AI_BUILDING(MAP_OBJ_INDEX(p));
        /* Original bug: compares (type<<2|player) & 0x3f
           with 0x24 and then the player, so only player 0
           ever matched. */
        if (BUILDING_TYPE(b) !== BuildingType.TypeForester ||
            BUILDING_PLAYER(b) !== PLAYER_NUM(player)) {
          continue;
        }
        table = costForester;
        width = 13;
      } else if (MAP_OBJ(p) === MapObject.ObjectLargeBuilding) {
        const b = AI_BUILDING(MAP_OBJ_INDEX(p));
        /* Original bug: same as above (0x30). */
        if (BUILDING_TYPE(b) !== BuildingType.TypeFarm ||
            BUILDING_PLAYER(b) !== PLAYER_NUM(player)) {
          continue;
        }
        table = costFarm;
        width = 7;
      } else {
        continue;
      }

      const half = idiv(width, 2);
      for (let ty = 0; ty < width; ty++) {
        const gy = y - half + ty;
        if (gy < 0 || gy >= GRID_SIZE) continue;
        for (let tx = 0; tx < width; tx++) {
          const gx = x - half + tx;
          if (gx < 0 || gx >= GRID_SIZE) continue;
          const vi = gy * GRID_SIZE + gx;
          if (grid[vi] < 0x40) {
            let c = grid[vi] + table[ty * width + tx];
            if (c >= 0x40) c = 0x3f;
            grid[vi] = c;
          }
        }
      }
    }
  }

  /* Shortest paths, one layer per step, at most 21 steps. */
  for (let i = 0; i < GRID_CELLS; i++) gridBest[i] = 0xffff;
  targetCost.fill(0);

  let sel = 0;
  let count = 1;
  const first = roadQueueEntry(roadQueue[0], 0);
  first.cost = 0xffff;
  first.index = GRID_CENTER;
  first.path = 0n;

  let layers = 21;
  while (1) {
    const inq = roadQueue[sel];
    const out = roadQueue[sel ^ 1];
    let outCount = 0;

    for (let e = 0; e < count; e++) {
      const idx = inq[e].index;
      if (gridBest[idx] !== inq[e].cost) continue;

      /* 16 bit: the start entry (0xffff) wraps to 2. */
      const cost = u16(inq[e].cost + 3);
      const path = inq[e].path << 3n;
      const h = MAP_HEIGHT(gridPos[idx]);

      for (let d = 0; d < 6; d++) {
        const nb = idx + gridDirOffset[d];
        const c = grid[nb];
        if (c >= 0x7f) continue;
        if (cost >= gridBest[nb]) continue;

        let newCost = u16(cost + c);
        let dh = (MAP_HEIGHT(gridPos[nb]) | 0) - h;
        if (dh < 0) dh = -dh;
        if (dh === 2) {
          newCost = u16(newCost + 1);
        } else if (dh === 3) {
          newCost = u16(newCost + 3);
        } else if (dh > 3) {
          newCost = u16(newCost + 8);
        }

        if (newCost >= gridBest[nb]) continue;
        gridBest[nb] = newCost;

        const newPath = path | BigInt(d + 1);
        if (c >= 0x40) {
          targetCost[c - 0x40] = newCost;
          targetPath[c - 0x40] = newPath;
        } else if (outCount < ROAD_QUEUE_SIZE) {
          const o = roadQueueEntry(out, outCount);
          o.cost = newCost;
          o.index = nb;
          o.path = newPath;
          outCount += 1;
        }
      }
    }

    sel = sel ^ 1;
    layers -= 1;
    if (layers === 0) break;
    count = outCount;
    if (count === 0) break;
  }
  aiGame().g24a = -1;
  aiGame().g248 = layers;

  player.ai.cursorCol = aiGame().g24e;
  player.ai.cursorRow = aiGame().g246;

  /* Candidates: cost minus target code, path/shore targets 1.5x. */
  const candCost = new Uint16Array(MAX_TARGETS);
  const candCat: number[] = new Array<number>(MAX_TARGETS).fill(0);
  const candPath: RoadPath[] = new Array<RoadPath>(MAX_TARGETS).fill(0n);
  let candCount = 0;
  for (let k = 0; k < MAX_TARGETS; k++) {
    if (targetCost[k] === 0) continue;
    let cost = u16(targetCost[k] - (0x40 + k));
    let cat = 0;
    if (0x40 + k >= 0x50) {
      cost = u16(cost + (cost >> 1));
      cat = 1;
    }
    candCost[candCount] = cost;
    candCat[candCount] = cat;
    candPath[candCount] = targetPath[k];
    candCount += 1;
  }

  /* Build the roads, cheapest first. */
  while (1) {
    let best = -1;
    let bestCost = 0xffff;
    for (let i = 0; i < candCount; i++) {
      if (candCost[i] & 0x8000) break; /* end marker */
      if (candCost[i] === 0) continue;
      if (candCost[i] < bestCost) {
        bestCost = candCost[i];
        best = i;
      }
    }
    if (best < 0 || (bestCost & 0x8000)) break;

    if ((player.ai.u_1ba & 0xffff) !== 0 &&
        bestCost >= (player.ai.u_1ba & 0xffff)) {
      break;
    }

    if ((player.ai.u_19c & 0xffff) !== 0) {
      const length = roadPathLength(candPath[best]);
      const limit = Math.imul(player.ai.u_19c, length) & 0xffff;
      if (bestCost >= limit) {
        /* Too much detour. */
        candCost[best] = 0;
        continue;
      }
    }

    aiGame().g24e = bestCost;
    candCost[best] = 0;
    aiGame().g248 = candCat[best];
    if (buildRoadAlongPath(player, candPath[best],
                           candCat[best]) >= 0) {
      player.ai.u_19e = 0;
    }
  }

  return i16(player.ai.u_19e);
}

/* ai_find_flag_connection @0x29316: connect the flag at the AI cursor
   to another flag. A flag search over the land roads first looks for
   an inventory within the network (three layers, then layer by
   layer). Found: road to a flag outside the near part of the network
   (u_1a4 = -2, limits 100/20). Not found: road to a flag of another
   network (u_1a4 = -1).
   The original gets the flag in A0 and its position in D0/D1 and sets
   the cursor to it; here the caller sets the cursor to the flag.
   Returns 1 if the flag already has all six paths (nothing done, the
   caller's D7 is unchanged), 0 if a road was built (the original sets
   D7 = 0), -1 if not (the original subtracts 600 from D7). */
export function findFlagConnection(player: Player): number {
  const pos = AI_CURSOR_POS(player);
  const flag = AI_FLAG(MAP_OBJ_INDEX(pos));

  if (FLAG_PATHS(flag) === 0x3f) return 1;

  const search = new FlagSearch(AI_GAME());
  const id = search.getId();

  let sel = 0;
  let count = 1;
  flagQueue[0][0] = flag;

  let layers = 2;
  let layerDir: Direction = DirectionRight; /* 0 */
  let found = 0;
  let connected = 0;

  while (1) {
    const inq = flagQueue[sel];
    const out = flagQueue[sel ^ 1];
    let outCount = 0;

    for (let i = 0; i < count; i++) {
      const f = inq[i];
      f.searchDir = layerDir;
      for (let d: number = DirectionUp; d >= DirectionRight; d--) {
        if (!BIT_TEST(f.landPaths(), d)) continue;
        // UNION ALIAS: other_endpoint.f[d] is read for every land path,
        // whatever was stored there. The C++ dereferences it unchecked.
        const other = f.otherEndpoint.f[d]!;
        if (other.searchNum === id) continue;
        if (FLAG_HAS_INVENTORY(other)) found = 1;
        other.searchNum = id;
        out[outCount++] = other;
      }
      if (outCount > 0x3e2) break;
    }

    sel = sel ^ 1;
    layers -= 1;
    if (layers < 0) {
      /* Original stores 0xff; only != 0 is tested. */
      layerDir = DirectionNone;
      if (found) {
        connected = 1;
        break;
      }
    }

    count = outCount;
    if (count === 0) break;
  }

  // PORT: the static flag_queue of the C++ keeps its stale pointers; they
  // are dropped here so that the flags can be collected.
  flagQueue[0].length = 0;
  flagQueue[1].length = 0;

  if (connected) {
    player.ai.u_1ba = 100;
    player.ai.u_19c = 20;
    player.ai.u_1a4 = -2;
    player.ai.u_1a6 = id;
    player.ai.u_19e = 0;
  } else {
    player.ai.u_1ba = 0;
    player.ai.u_19c = 0;
    player.ai.u_1a8 = 12;
    player.ai.u_1a4 = -1;
    player.ai.u_1a6 = id;
    player.ai.u_19e = -1;
  }

  AI_SET_CURSOR(player, pos);
  player.waterRoads = false;
  if (buildRoad(player) < 0) return -1;
  return 0;
}

/* ai_pull_roads_through_flag @0x271d4: roads passing the flag at the
   AI cursor around a corner are led through the flag (the game part,
   flag_has_road_corner @0x270fe and the rerouting @0x2738c, is
   Game::pull_roads_through_flag). Returns 0 if a road was rerouted,
   -1 if not. */
export function pullRoadsThroughFlag(player: Player): number {
  return AI_GAME().pullRoadsThroughFlag(AI_CURSOR_POS(player), player) ?
         0 : -1;
}
