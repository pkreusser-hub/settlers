/*
 * ai-manage.cc - Computer player: building management, stocks, attacks
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

// PORT: the C++ class AI::Manage (ai-manage.h) only has static members;
// they are the exported functions of this module.

import * as Core from './ai-core';
// EXT: the improved computer players (GameRules.aiLevel).
import * as Ext from './ai-ext';
import {
  AI_BUILDING, AI_CAN_BUILD_NONE, AI_CURSOR_POS, AI_FLAG, AI_GAME, AI_SERF,
  BUILDING_ALLOCATED, BUILDING_HAS_SERF, BUILDING_IS_ACTIVE,
  BUILDING_IS_BURNING, BUILDING_IS_DONE, BUILDING_PLAYER, BUILDING_STATE,
  BUILDING_TYPE, FLAG_ACCEPTS_RESOURCES, FLAG_ACCEPTS_SERFS, MAP_BLOCKED,
  MAP_HAS_OWNER, MAP_IN_WATER, MAP_MOVE, MAP_MOVE_DOWN, MAP_MOVE_LEFT,
  MAP_MOVE_RIGHT, MAP_MOVE_UP, MAP_MOVE_UP_LEFT, MAP_OBJ, MAP_OBJ_INDEX,
  MAP_OWNER, MAP_PATHS, MAP_POS, MAP_POS_ADD_SPIRALLY, MAP_RES_FISH,
  MAP_RES_TYPE, MAP_SPACE, MAP_TYPE_DOWN, MAP_TYPE_UP, MAP_WATER_MARK,
  PLAYER_NUM, SERF_TYPE, aiGame,
} from './ai-internal';
import * as Rate from './ai-rate';
import type { Building } from './building';
import { BuildingType } from './building';
import type { Flag } from './flag';
import { FlagSearch } from './flag';
import { GAME_MAX_PLAYER_COUNT } from './game';
import type { InventoryMode } from './inventory';
import { MapMinerals, MapObject } from './map';
import type { MapPos } from './map-geometry';
import { BIT, idiv, u32 } from './misc';
import type { AILocation, Player } from './player';
import { AI_LOCATIONS_PER_CATEGORY } from './player';
import { ResourceType } from './resource';
import { SerfType } from './serf';

/* Height byte of the original: bit 7 has owner, bits 5-6 owner.
   Compared with (player + 4) << 5 by the original. */
const AI_OWNED_BY = (pos: MapPos, num: number): boolean =>
  MAP_HAS_OWNER(pos) && MAP_OWNER(pos) === u32(num);

/* 16-bit unsigned add / double with saturation at 0xffff (the
   original's add.w; bcs -> moveq -1). */
export function satAdd16(a: number, b: number): number {
  const r = (a & 0xffff) + (b & 0xffff);
  return r > 0xffff ? 0xffff : r;
}

export function isMilitaryType(type: BuildingType): boolean {
  return type === BuildingType.TypeHut || type === BuildingType.TypeTower ||
         type === BuildingType.TypeFortress || type === BuildingType.TypeCastle;
}

/* The original's game.max_building_index: one past the highest allocated
   building index. The building collection does not keep it, so it is
   derived from the allocated buildings. */
export function maxBuildingIndex(): number {
  let max = 0;
  for (const b of AI_GAME().buildings) {
    if (b == null) continue;
    if (b.getIndex() >= max) max = b.getIndex() + 1;
  }
  return max;
}

/* 0x29a4c: demolish the building at pos (D3 in the original). */
export function demolishBuilding(pos: MapPos): void {
  AI_GAME().demolishBuilding_(pos);
}

/* The handlers below get the remaining work budget of
   manage_buildings (D7w) and return the new budget. -1 then
   subtracting marks "stop" after a demolition. */

/* 0x29590 */
export function manageFisher(player: Player, building: Building, budget: number): number {
  for (let i = 1; i <= 64; i++) {
    const pos = MAP_POS_ADD_SPIRALLY(building.pos, i);
    /* Water marker (obj bit 7), blocked bit and fish != 0
       (Amiga @0x295a4); the fish are read on water only, like
       map_update_hidden. */
    if (MAP_WATER_MARK(pos) && MAP_BLOCKED(pos) &&
        MAP_IN_WATER(pos) && MAP_RES_FISH(pos) !== 0) {
      return budget - 10;
    }
  }

  demolishBuilding(building.pos);
  return -1 - 10;
}

/* 0x295ca */
export function manageLumberjack(player: Player, building: Building,
                                 budget: number): number {
  for (let i = 1; i <= 128; i++) {
    const pos = MAP_POS_ADD_SPIRALLY(building.pos, i);
    const obj = MAP_OBJ(pos);
    if (obj >= MapObject.ObjectTree0 && obj < MapObject.ObjectTree0 + 16) {
      return budget - 20;
    }
  }

  demolishBuilding(building.pos);
  return -1 - 20;
}

/* 0x29606 */
export function manageStonecutter(player: Player, building: Building,
                                  budget: number): number {
  for (let i = 1; i <= 128; i++) {
    const pos = MAP_POS_ADD_SPIRALLY(building.pos, i);
    const obj = MAP_OBJ(pos);
    if (obj >= MapObject.ObjectStone0 && obj < MapObject.ObjectStone0 + 8) {
      return budget - 20;
    }
  }

  demolishBuilding(building.pos);
  return -1 - 20;
}

/* Shared body of the mine handlers 0x29640 (stone), 0x29672 (coal),
   0x296a4 (iron), 0x296d6 (gold): keep the mine while one of the 32
   nearest positions still has its deposit type. */
export function manageMine(player: Player, building: Building, budget: number,
                           deposit: MapMinerals): number {
  for (let i = 1; i <= 32; i++) {
    const pos = MAP_POS_ADD_SPIRALLY(building.pos, i);
    if (MAP_RES_TYPE(pos) === deposit) return budget - 5;
  }

  demolishBuilding(building.pos);
  return -1 - 5;
}

/* 0x29708 */
export function manageForester(player: Player, building: Building, budget: number): number {
  /* Original bug: the loop reuses D3 (the building position) as a
     scratch byte, so after the first position it scans around a
     corrupted base and finally demolishes at a corrupted position.
     The port scans around the building and demolishes it. */
  for (let i = 1; i <= 128; i++) {
    const pos = MAP_POS_ADD_SPIRALLY(building.pos, i);
    /* Paths byte & 0x7f == 0: no paths (bits 0-5) and not blocked
       (bit 6); type byte 0x55: both triangles of terrain type 5. */
    if (MAP_PATHS(pos) === 0 && !MAP_BLOCKED(pos) &&
        MAP_OBJ(pos) === MapObject.ObjectNone &&
        MAP_TYPE_UP(pos) === 5 && MAP_TYPE_DOWN(pos) === 5) {
      return budget - 20;
    }
  }

  demolishBuilding(building.pos);
  return -1 - 20;
}

/* Thresholds of manage_stock @0x298f0, indexed by the military
   state of the nearby military building: resource sum out / stop,
   generic serfs out / stop. */
const stockThresholds: number[][] = [
  [15000, 10000, 200, 100],
  [4000, 3000, 200, 100],
  [1000, 600, 200, 100],
  [500, 0, 0, 0],
];

export function findResDestCb(flag: Flag, data: unknown): boolean {
  return FLAG_ACCEPTS_RESOURCES(flag);
}

export function findSerfDestCb(flag: Flag, data: unknown): boolean {
  return FLAG_ACCEPTS_SERFS(flag);
}

/* 0x239fa as used by the AI: < 0 if the flag itself accepts resources
   or no other flag accepting resources is reachable over roads with
   transporters. (Legacy schedule_slot_to_unknown_dest is a different
   function.) */
export function findOtherResourceInventory(flag: Flag): number {
  if (FLAG_ACCEPTS_RESOURCES(flag)) return -1;
  return FlagSearch.single(flag, findResDestCb, false, true, null) ?
    0 : -1;
}

/* 0x238fa as used by the AI: < 0 if the flag itself accepts serfs or
   no other flag accepting serfs is reachable over land paths.
   Original bug: manage_stock (@0x29924) passes the flag in A1 while
   0x238fa reads the flag index from D0, which is left over from the
   caller, so the original searches from an unrelated flag; and 0x238fa
   counts the source flag itself as found. Here the search starts at
   the stock's flag and, like the resource variant 0x239fa, looks for
   another inventory. */
export function findOtherSerfInventory(flag: Flag): number {
  if (FLAG_ACCEPTS_SERFS(flag)) return -1;
  return FlagSearch.single(flag, findSerfDestCb, true, false, null) ?
    0 : -1;
}

/* 0x2974c: move resources and serfs out of a stock near the front. */
export function manageStock(player: Player, building: Building, budget: number): number {
  if (!BUILDING_HAS_SERF(building)) return budget;

  for (let i = 7; i < 7 + 0x102; i++) {
    const pos = MAP_POS_ADD_SPIRALLY(building.pos, i);
    const obj = MAP_OBJ(pos);
    if (obj < MapObject.ObjectSmallBuilding || obj > MapObject.ObjectCastle) continue;

    const mil = AI_BUILDING(MAP_OBJ_INDEX(pos));
    if (BUILDING_PLAYER(mil) !== PLAYER_NUM(player) ||
        !BUILDING_IS_ACTIVE(mil) ||
        !isMilitaryType(BUILDING_TYPE(mil))) {
      continue;
    }

    const thr = stockThresholds[BUILDING_STATE(mil)];
    const flag = AI_FLAG(building.flag);
    const inv = building.inventory!;
    // PORT: ResourceMap &r = inv->resources; operator[] yields 0 for a
    // missing key.
    const r = (res: ResourceType): number => inv.resources.get(res) ?? 0;

    /* Weighted resource sum, saturating at 0xffff. */
    let sum = r(ResourceType.TypeGoldBar);
    sum = satAdd16(sum, sum);
    sum = satAdd16(sum, r(ResourceType.TypeSword));
    sum = satAdd16(sum, r(ResourceType.TypeShield));
    sum = satAdd16(sum, r(ResourceType.TypeGoldOre));
    sum = satAdd16(sum, sum);
    for (let res: number = ResourceType.TypeShovel; res <= ResourceType.TypePincer; res++) {
      sum = satAdd16(sum, r(res as ResourceType));
    }
    sum = satAdd16(sum, sum);
    sum = satAdd16(sum, r(ResourceType.TypeIronOre));
    sum = satAdd16(sum, r(ResourceType.TypeSteel));
    sum = satAdd16(sum, r(ResourceType.TypeCoal));
    sum = satAdd16(sum, sum);
    sum = satAdd16(sum, r(ResourceType.TypeBoat));
    sum = satAdd16(sum, r(ResourceType.TypeStone));
    sum = satAdd16(sum, sum);
    sum = satAdd16(sum, sum);

    /* Resource mode (res_dir bits 0-1; the original sets the
       bits directly, without the panel's delivery cancelling). */
    let mode: number; /* 0 in, 1 stop, 3 out */
    if (sum >= thr[0]) {
      budget -= 100;
      if (findOtherResourceInventory(flag) < 0) {
        mode = 0;
      } else if ((inv.resourceMode & 2)) {
        mode = 3;
      } else if (player.ai.u_1b2 >= 10000) {
        /* Original bug: the original reads and writes
           (0x1b2,A4) with A4 = inventory pointer here.
           The player's counter ai.u_1b2 (decremented
           each tick at 0xa554) is meant. */
        mode = 1;
      } else {
        player.ai.u_1b2 += 9000;
        mode = 3;
      }
    } else if (sum >= thr[1]) {
      mode = 1;
    } else {
      mode = 0;
    }

    inv.resourceMode = mode as InventoryMode;
    flag.setAcceptsResources(mode === 0);

    /* Serf mode (res_dir bits 2-3) from the generic serfs. */
    const serfs = inv.genericCount & 0xffff;
    if (serfs >= thr[2]) {
      budget -= 100;
      /* Original bug: find_nearest_inventory takes a flag
         index in D0, which here still holds the building
         index of manage_buildings. The stock's flag is
         meant (A1 is set up for it). */
      if (findOtherSerfInventory(flag) < 0) {
        mode = 0;
      } else if ((inv.serfMode & 2)) {
        mode = 3;
      } else if (player.ai.u_1b2 >= 10000) {
        /* Original bug: A4 = inventory, as above. */
        mode = 1;
      } else {
        player.ai.u_1b2 += 3000;
        mode = 3;
      }
    } else if (serfs >= thr[3]) {
      mode = 1;
    } else {
      mode = 0;
    }

    inv.serfMode = mode as InventoryMode;
    flag.setAcceptsSerfs(mode === 0);

    return budget - 10;
  }

  return budget - 10;
}

/* 0x299b0: demolish farms when there is enough food. */
export function manageFarm(player: Player, building: Building, budget: number): number {
  /* ai.u_39c.. = resource totals by type (food: 0x39c..0x3a6). */
  let food = player.ai.u_39c & 0xffff;
  food = satAdd16(food, player.ai.u_39e);
  food = satAdd16(food, player.ai.u_3a0);
  food = satAdd16(food, player.ai.u_3a2);
  food = satAdd16(food, player.ai.u_3a4);
  food = satAdd16(food, player.ai.u_3a6);

  if (food < 500) return budget;

  let maxFarms: number;
  if (food < 600) {
    maxFarms = 8;
  } else if (food < 700) {
    maxFarms = 7;
  } else if (food < 800) {
    maxFarms = 6;
  } else if (food < 900) {
    maxFarms = 5;
  } else if (food < 1000) {
    maxFarms = 4;
  } else if (food < 1500) {
    maxFarms = 3;
  } else if (food < 2000) {
    maxFarms = 2;
  } else {
    maxFarms = 1;
  }

  const farms =
    player.completedBuildingCount[BuildingType.TypeFarm] & 0xffff;
  if (maxFarms < farms) demolishBuilding(building.pos);

  return budget;
}

/* 0x294ae: walk up to 500 finished buildings of the player starting at
   the cursor ai.u_19a and call the handler of their type (jump table
   0x2952a: types without a handler point to an rts). */
export function manageBuildings(player: Player): void {
  let budget = 500;
  let index = player.ai.u_19a & 0xffff;
  /* The handlers only start burning buildings, which keeps them
     allocated, so the limit does not change during the walk. */
  const maxIndex = maxBuildingIndex();

  if (index > maxIndex) {
    /* The original checks the (unallocated) entry, then wraps. */
    player.ai.u_19a = 0;
    return;
  }

  while (1) {
    if (index !== 0 && BUILDING_ALLOCATED(index)) {
      const building = AI_BUILDING(index);
      if (!BUILDING_IS_BURNING(building) &&
          BUILDING_IS_DONE(building) &&
          BUILDING_PLAYER(building) === PLAYER_NUM(player)) {
        switch (BUILDING_TYPE(building)) {
          case BuildingType.TypeFisher:
            budget = manageFisher(player, building, budget);
            break;
          case BuildingType.TypeLumberjack:
            budget = manageLumberjack(player, building, budget);
            break;
          case BuildingType.TypeStonecutter:
            budget = manageStonecutter(player, building, budget);
            break;
          case BuildingType.TypeStoneMine:
            budget = manageMine(player, building, budget,
                                MapMinerals.MineralsStone);
            break;
          case BuildingType.TypeCoalMine:
            budget = manageMine(player, building, budget,
                                MapMinerals.MineralsCoal);
            break;
          case BuildingType.TypeIronMine:
            budget = manageMine(player, building, budget,
                                MapMinerals.MineralsIron);
            break;
          case BuildingType.TypeGoldMine:
            budget = manageMine(player, building, budget,
                                MapMinerals.MineralsGold);
            break;
          case BuildingType.TypeForester:
            budget = manageForester(player, building, budget);
            break;
          case BuildingType.TypeStock:
            budget = manageStock(player, building, budget);
            break;
          case BuildingType.TypeFarm:
            budget = manageFarm(player, building, budget);
            break;
          default:
            break;
        }
      }
    }

    index += 1;
    budget -= 1;
    if (budget < 0) break;
    if (index > maxIndex) {
      index = 0;
      break;
    }
  }

  player.ai.u_19a = index;
}


/* Location lists of ai.locations, addressed as the original does: n
   consecutive entries starting at category first. */
export function locationEntry(player: Player, first: number, k: number): AILocation {
  const n = first * AI_LOCATIONS_PER_CATEGORY + k;
  return player.ai.locations[idiv(n, AI_LOCATIONS_PER_CATEGORY)]
    [n % AI_LOCATIONS_PER_CATEGORY];
}

/* 0x29ac8: small building sites must still be owned and free. */
export function validateLocationsSmall(player: Player, first: number, count: number): void {
  for (let k = 0; k < count; k++) {
    const loc = locationEntry(player, first, k);
    if (loc.value === 0) continue;

    let pos = MAP_POS(loc.col, loc.row);
    let ok = 0;
    if (AI_OWNED_BY(pos, PLAYER_NUM(player)) && MAP_SPACE(pos) < 2) {
      pos = MAP_MOVE_RIGHT(pos);
      if (MAP_SPACE(pos) < 3) {
        pos = MAP_MOVE_DOWN(pos);
        if (MAP_SPACE(pos) < 3) {
          pos = MAP_MOVE_LEFT(pos);
          if (MAP_SPACE(pos) < 3) {
            pos = MAP_MOVE_UP_LEFT(pos);
            if (MAP_SPACE(pos) < 4) {
              pos = MAP_MOVE_UP(pos);
              if (MAP_SPACE(pos) < 4) {
                pos = MAP_MOVE_RIGHT(pos);
                if (MAP_SPACE(pos) < 4) ok = 1;
              }
            }
          }
        }
      }
    }

    if (!ok) loc.value = 0;
  }
}

/* Steps from the site and the space limit after each step. */
// PORT: the directions are written as numbers, so that loading this
// module does not touch the exports of map-geometry.
const validateSteps: { dir: number; limit: number }[] = [
  { dir: 0 /* DirectionRight */, limit: 2 }, { dir: 2 /* DirectionDown */, limit: 2 },
  { dir: 3 /* DirectionLeft */, limit: 2 }, { dir: 4 /* DirectionUpLeft */, limit: 2 },
  { dir: 5 /* DirectionUp */, limit: 2 }, { dir: 0 /* DirectionRight */, limit: 2 },
  { dir: 0 /* DirectionRight */, limit: 4 }, { dir: 1 /* DirectionDownRight */, limit: 4 },
  { dir: 2 /* DirectionDown */, limit: 4 }, { dir: 2 /* DirectionDown */, limit: 4 },
  { dir: 3 /* DirectionLeft */, limit: 4 }, { dir: 3 /* DirectionLeft */, limit: 4 },
  { dir: 4 /* DirectionUpLeft */, limit: 4 }, { dir: 4 /* DirectionUpLeft */, limit: 4 },
  { dir: 5 /* DirectionUp */, limit: 4 }, { dir: 5 /* DirectionUp */, limit: 4 },
  { dir: 0 /* DirectionRight */, limit: 4 }, { dir: 0 /* DirectionRight */, limit: 4 },
];

/* 0x29b92: large building sites. */
export function validateLocationsLarge(player: Player, first: number, count: number): void {
  const steps = validateSteps;

  for (let k = 0; k < count; k++) {
    const loc = locationEntry(player, first, k);
    if (loc.value === 0) continue;

    let pos = MAP_POS(loc.col, loc.row);
    let ok = AI_OWNED_BY(pos, PLAYER_NUM(player)) && MAP_SPACE(pos) < 2;
    for (let s = 0; ok && s < steps.length; s++) {
      pos = MAP_MOVE(pos, steps[s].dir);
      if (u32(MAP_SPACE(pos)) >= steps[s].limit) ok = false;
    }

    if (!ok) loc.value = 0;
  }
}

/* 0x29d80: attack targets must still be enemy buildings. */
export function validateLocationsEnd(player: Player, first: number, count: number): void {
  for (let k = 0; k < count; k++) {
    const loc = locationEntry(player, first, k);
    if (loc.value === 0) continue;

    const pos = MAP_POS(loc.col, loc.row);
    if (!MAP_HAS_OWNER(pos) ||
        MAP_OWNER(pos) === u32(PLAYER_NUM(player)) ||
        MAP_SPACE(pos) < 4) {
      loc.value = 0;
    }
    // EXT: nor a building of an ally.
    if (loc.value !== 0 && AI_GAME().isAllied(PLAYER_NUM(player), MAP_OWNER(pos))) {
      loc.value = 0;
    }
  }
}

/* 0x29a70: drop stored locations that are no longer usable. */
export function validateLocations(player: Player): void {
  validateLocationsSmall(player, 1, 72); /* 0x464: 1..9 */
  validateLocationsSmall(player, 11, 8); /* 0x644 */
  validateLocationsSmall(player, 15, 8); /* 0x704 */
  validateLocationsLarge(player, 10, 8); /* 0x614 */
  validateLocationsLarge(player, 12, 24); /* 0x674: 12..14 */
  validateLocationsLarge(player, 16, 64); /* 0x734: 16..23 */
  validateLocationsEnd(player, 26, 72); /* 0x914: 26..34 */
}


/* Military strength ratio of the player against all others, the word
   the original keeps at player ptr+0x186 (computed by
   player_update_knight_morale @0xb4bc..0xb542). update_knight_morale
   stores the result in player->ai.military_ratio. */
export function calcMilitaryRatio(player: Player): number {
  let own = u32(player.totalMilitaryScore);
  let morale = (player.knightMorale & 0xffff) >> 5;
  while (own >= 0x10000) {
    own >>>= 1;
    morale = (morale << 1) & 0xffff;
  }
  own = u32(Math.imul(own, morale)) >>> 7;

  let other = 0;
  for (let i = 0; i < GAME_MAX_PLAYER_COUNT; i++) {
    const p = AI_GAME().getPlayer(i);
    if (p == null || p === player) continue;
    // EXT: the strength of an ally does not count against the player.
    if (AI_GAME().isAllied(PLAYER_NUM(player), i)) continue;
    other = u32(other + p.totalMilitaryScore);
  }

  while (own >= 0x10000) {
    own >>>= 1;
    other >>>= 1;
  }
  while (other >= 0x10000) {
    own >>>= 1;
    other >>>= 1;
  }

  own = (own & 0xffff) >> 1;
  if (own === 0 || other === 0) return 0;
  if (((other - own) & 0x8000) !== 0) return 0xffff;

  /* Original bug: divu overflows when other == own and stores 0. */
  const q = idiv(u32(own << 16), other);
  return q > 0xffff ? 0xffff : q;
}

/* Attack chance factor by ai.u_1aa, table @0x29dc0. */
const attackFactor: number[] = [
  500, 700, 1000, 1400, 1900, 2500, 3000, 3500, 4096,
  5000, 7000, 10000, 15000, 21000, 28000, 36000, 45000,
];

/* 0x29de2: decide whether to attack; otherwise scan for sites. */
export function attack(player: Player): void {
  // EXT: no attack during the peace; the turn goes to the site scan, as it
  // does when the player decides against an attack.
  if (AI_GAME().isPeace()) {
    // EXT: the improved computer player builds in the turn it has no use
    // for: one more step of the economy.
    if (Ext.isImproved(player)) {
      Core.wantAndBuild(player);
      return;
    }
    Core.scanSites(player);
    return;
  }

  const ratio = player.ai.militaryRatio & 0xffff;

  // EXT: the improved computer player rolls no dice here: it looks for a
  // target in every attack turn and lets the attack forecast decide (see
  // attackKnights() in ai-ext.ts below).
  if (ratio < 0x8000 && !Ext.isImproved(player)) {
    let d0: number;
    if (ratio >= 0x2000) {
      d0 = (ratio - 0x2000) * 2 + 0x1000;
    } else {
      d0 = ratio >> 1;
    }

    /* Original reads past the table for u_1aa > 16. */
    let fi = player.ai.u_1aa & 0xffff;
    if (fi > 16) fi = 16;
    const v = u32(Math.imul(d0, attackFactor[fi])) >>> 12;
    d0 = v >= 0x10000 ? 0xffff : v;

    /* Knights weighted by level (the first add wraps). */
    let k = (player.serfCount[SerfType.TypeKnight4] +
             player.serfCount[SerfType.TypeKnight3]) & 0xffff;
    k = satAdd16(k, k);
    if (k !== 0xffff) k = satAdd16(k, player.serfCount[SerfType.TypeKnight2]);
    if (k !== 0xffff) k = satAdd16(k, k);
    if (k !== 0xffff) k = satAdd16(k, k);
    if (k !== 0xffff) k = satAdd16(k, player.serfCount[SerfType.TypeKnight1]);
    if (k < 0x100) d0 = (u32(Math.imul(d0, k)) >>> 8) & 0xffff;

    const intel =
      ((0xffff - (player.aiIntelligence & 0xffff)) >> 1) + 0x8000;
    // PORT: uint64_t product; it stays below 2^34, exact in a double.
    const p = d0 * intel * 2;
    const hi = p > 0xffffffff ? 0xffff : u32(Math.floor(p / 0x10000));
    let chance = u32((u32(Math.imul(hi, player.aiValue2 & 0xffff)) >>> 16) * 2);
    if (chance > 0xffff) chance = 0xffff;

    if (AI_GAME().randomInt() >= chance) {
      Core.scanSites(player);
      return;
    }
  }

  /* Best value of each attack category 26..34. */
  const w: number[] = new Array<number>(9).fill(0);
  for (let c = 0; c < 9; c++) {
    let best = 0;
    for (let i = 0; i < AI_LOCATIONS_PER_CATEGORY; i++) {
      const val = player.ai.locations[26 + c][i].value & 0xffff;
      if (val > best) best = val;
    }
    w[c] = best;
  }

  /* Weight categories 31..34 by the resource totals
     (ai.u_3ae stone, u_3b0 iron ore, u_3b4 coal, u_3b6 gold ore). */
  const stone = player.ai.u_3ae & 0xffff;
  const ironore = player.ai.u_3b0 & 0xffff;
  const coal = player.ai.u_3b4 & 0xffff;
  const goldore = player.ai.u_3b6 & 0xffff;
  let d: number;
  let v: number;

  d = satAdd16(coal >> 1, 100);
  d = d >= goldore ? d - goldore : 0;
  if (d >= 400) d = 400;
  d = ((d + 50) << 6) & 0xffff;
  v = u32(Math.imul(d, w[5])) >>> 12;
  w[5] = v >= 0x10000 ? 0xffff : v;

  d = satAdd16(coal, 100);
  d = d >= ironore ? d - ironore : 0;
  if (d >= 400) d = 400;
  d = (d << 6) & 0xffff;
  v = u32(Math.imul(d, w[6])) >>> 12;
  w[6] = v >= 0x10000 ? 0xffff : v;

  d = satAdd16(ironore, goldore);
  if (d !== 0xffff) d = satAdd16(d, 50);
  d = d >= coal ? d - coal : 0;
  if (d >= 400) d = 400;
  d = (d << 5) & 0xffff;
  v = u32(Math.imul(d, w[7])) >>> 12;
  w[7] = v >= 0x10000 ? 0xffff : v;

  d = stone;
  if (d >= 300) d = 300;
  d = (d << 5) & 0xffff;
  v = u32(Math.imul(d, w[8])) >>> 12;
  w[8] = v >= 0x10000 ? 0xffff : v;

  /* Preferred categories (bits of ai_value_3) count four times. */
  for (let c = 0; c < 9; c++) {
    if (player.aiValue3 & BIT(c)) {
      let x = satAdd16(w[c], w[c]);
      if (x !== 0xffff) x = satAdd16(x, x);
      w[c] = x;
    }
  }

  const r = AI_GAME().randomInt();
  let cat: number;
  if (r & 1) {
    /* Best category. */
    let best = 0;
    cat = 0;
    for (let c = 0; c < 9; c++) {
      if (w[c] > best) {
        best = w[c];
        cat = c;
      }
    }
    if (best === 0) {
      Core.scanSites(player);
      return;
    }
  } else {
    /* Random category weighted by w; halve all while the sum
       overflows 16 bits. */
    let sum = 0;
    while (1) {
      sum = 0;
      let overflow = 0;
      for (let c = 0; c < 9; c++) {
        sum += w[c];
        if (sum > 0xffff) {
          overflow = 1;
          break;
        }
      }
      if (!overflow) break;
      for (let c = 0; c < 9; c++) w[c] >>= 1;
    }
    if (sum === 0) {
      Core.scanSites(player);
      return;
    }

    const pick = u32(Math.imul(sum, r & 0xffff)) >>> 16;
    let acc = 0;
    cat = 0;
    for (let c = 0; c < 9; c++) {
      acc += w[c];
      if (pick < acc) break;
      cat += 1;
    }
  }
  aiGame().buildBuildingType = cat + 26;

  /* Original: endless when the rating keeps refreshing a slot; the
     port bounds the number of retries. */
  for (let tries = 0; tries < 1000; tries++) {
    const list = player.ai.locations[aiGame().buildBuildingType];
    let bestLoc: AILocation | null = null;
    let best = 0;
    for (let i = 0; i < AI_LOCATIONS_PER_CATEGORY; i++) {
      if ((list[i].value & 0xffff) > best) {
        best = list[i].value & 0xffff;
        bestLoc = list[i];
      }
    }
    if (best === 0) return;

    aiGame().someLocation = bestLoc;
    bestLoc!.value = 0;
    player.ai.cursorCol = bestLoc!.col;
    player.ai.cursorRow = bestLoc!.row;

    const pos = AI_CURSOR_POS(player);
    if (!MAP_HAS_OWNER(pos) ||
        MAP_OWNER(pos) === u32(PLAYER_NUM(player))) {
      continue;
    }
    // EXT: never a building of an ally.
    if (AI_GAME().isAllied(PLAYER_NUM(player), MAP_OWNER(pos))) continue;
    const obj = MAP_OBJ(pos);
    if (obj < MapObject.ObjectSmallBuilding || obj > MapObject.ObjectCastle) continue;

    player.buildingAttacked = MAP_OBJ_INDEX(pos);
    let target = AI_BUILDING(player.buildingAttacked);
    /* Original bug: a non-military building branches into the
       middle of the maximum search (0x2a032) with stale
       registers; the port rejects it like the other checks. */
    if (!isMilitaryType(BUILDING_TYPE(target))) continue;
    if (!BUILDING_IS_ACTIVE(target) || BUILDING_STATE(target) !== 3) {
      continue;
    }

    /* Own land must be near the target. */
    let near = 0;
    for (let i = 7; i < 7 + 0x102; i++) {
      const p = MAP_POS_ADD_SPIRALLY(target.pos, i);
      if (AI_OWNED_BY(p, PLAYER_NUM(player))) {
        near = 1;
        break;
      }
    }
    if (!near) continue;

    player.ai.panelBtnType = AI_CAN_BUILD_NONE;
    Rate.scanPointsOfInterest(player);
    const rating = Rate.rateSiteDispatch(player) & 0xffff;

    if (rating < (aiGame().someLocation!.value & 0xffff)) {
      let lower = 0;
      for (let i = 0; i < AI_LOCATIONS_PER_CATEGORY; i++) {
        if (rating < (list[i].value & 0xffff)) {
          lower = 1;
          break;
        }
      }
      if (lower) {
        aiGame().someLocation!.value = rating;
        continue;
      }
    }

    /* Attack (0x2a15e). */
    player.knightsAvailableForAttack(AI_CURSOR_POS(player));

    // EXT: the improved computer player asks the attack forecast in place
    // of the estimate of the original below.
    if (Ext.isImproved(player)) {
      const send = Ext.attackKnights(player, AI_BUILDING(player.buildingAttacked));
      if (send === 0 || player.attackingBuildingCount === 0) return;
      player.knightsAttacking = send;
      player.startAttack();
      return;
    }

    /* Defenders of the target, weighted 1 << knight level. */
    target = AI_BUILDING(player.buildingAttacked);
    let def = 0;
    let si = target.firstKnight & 0xffff;
    while (si !== 0) {
      const serf = AI_SERF(si);
      def = u32(def + u32(1 << ((SERF_TYPE(serf) - SerfType.TypeKnight0) & 0x1f)));
      si = serf.s.defending.nextKnight & 0xffff;
    }
    def &= 0xffff;
    if (BUILDING_TYPE(target) === BuildingType.TypeCastle) {
      def = (def * 2) & 0xffff;
    }

    /* Original bug: divu by knight_morale overflows (or traps
       on 0); the port saturates. */
    const morale = player.knightMorale & 0xffff;
    let q = morale ? idiv(u32(def << 14), morale) : 0xffff;
    if (q > 0xffff) q = 0xffff;
    let need = u32(Math.imul(q, player.aiValue1 & 0xffff)) >>> 16;
    if (need === 0) need = 1;

    const score = u32(u32(player.totalMilitaryScore) << 4);
    let knights = 0;
    for (let i = 0; i < 5; i++) {
      knights = u32(knights + player.serfCount[SerfType.TypeKnight0 + i]);
    }
    knights &= 0xffff;
    if (knights === 0) return;

    /* Original bug: these divu can overflow (and trap when the
       strength per knight is 0); the need is sign extended. The
       port uses unsigned values, saturates and does not attack
       on a zero divisor. */
    let perKnight = idiv(score, knights);
    if (perKnight > 0xffff) perKnight = 0xffff;
    if (perKnight === 0) return;
    let n = idiv(u32(need << 4), perKnight);
    if (n > 0xffff) n = 0xffff;
    n += 1;

    if ((player.totalAttackingKnights & 0xffff) <
        n) {
      return;
    }
    player.knightsAttacking = n;
    if (player.attackingBuildingCount === 0) return;
    player.startAttack();
    return;
  }
}

// ---------------------------------------------------------------------------
// EXT: trading between players (trade.ts). Not part of the original: how a
// computer player answers the offers made to it. It never makes one.

/* What a computer player keeps of a resource it is asked for: it gives
   only what it holds above this, and above what it gives. */
export const AI_TRADE_KEEP = 10;
/* The same for building materials (lumber, planks, stone). */
export const AI_TRADE_KEEP_MATERIAL = 30;

/* Whether the computer player gives wantCount of the resource want for
   giveCount of another, from the stock that holds `have` of it:
   - never a weapon (sword, shield) or a tool (shovel to pincer);
   - not more than twice what it gets;
   - only from a clear surplus: after the trade the stock still holds at
     least what was given plus AI_TRADE_KEEP (AI_TRADE_KEEP_MATERIAL of
     lumber, planks and stone). */
export function tradeSwapAccepted(want: ResourceType, wantCount: number,
                                  giveCount: number, have: number): boolean {
  if (want >= ResourceType.TypeShovel && want <= ResourceType.TypeShield) return false;
  if (wantCount > 2 * giveCount) return false;
  const material = want === ResourceType.TypeLumber || want === ResourceType.TypePlank ||
                   want === ResourceType.TypeStone;
  const keep = material ? AI_TRADE_KEEP_MATERIAL : AI_TRADE_KEEP;
  return have >= 2 * wantCount + keep;
}

/* Answer the offers made to the computer player: a gift is taken, a swap
   by tradeSwapAccepted(), with the stock that holds the most of what is
   asked (the first of them). Draws no random number. */
export function answerTradeOffers(player: Player): void {
  const game = AI_GAME();
  const trade = game.trade;
  if (trade.offers.length === 0) return;

  for (const offer of trade.offers.slice()) {
    if (offer.to !== PLAYER_NUM(player)) continue;

    if (offer.wantCount === 0) {
      /* A gift goes to the castle, or to the first storehouse. An offer
         that can not be accepted now stays until it expires. */
      const stock = trade.findStock(PLAYER_NUM(player), 0);
      if (stock === null) continue;
      const building = game.getBuilding(stock.getBuildingIndex());
      if (building !== null) trade.acceptOffer(player, offer.id, building.getPosition());
      continue;
    }

    let best: Building | null = null;
    let have = 0;
    for (const inventory of game.getPlayerInventories(player)) {
      if (trade.getStock(PLAYER_NUM(player), inventory.getIndex()) === null) continue;
      const count = inventory.getCountOf(offer.want);
      if (best === null || count > have) {
        best = game.getBuilding(inventory.getBuildingIndex());
        have = count;
      }
    }
    if (best !== null &&
        tradeSwapAccepted(offer.want, offer.wantCount, offer.giveCount, have) &&
        trade.acceptOffer(player, offer.id, best.getPosition())) {
      continue;
    }
    trade.declineOffer(player, offer.id);
  }
}

// EXT: end of the trade block.
