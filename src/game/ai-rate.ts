/*
 * ai-rate.cc - Computer player: site and attack ratings, area statistics
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

/* Ported from the Amiga original, 0x2b830 and 0x2d316..0x2edd6.

   ai_scan_points_of_interest() collects weighted statistics of the
   hexagonal rings around the AI cursor into player->ai.poi[]. poi[0]
   holds all rings, poi[1..3] snapshots taken after the outer, middle
   and inner ring groups (poi[3] = innermost). The evaluators combine
   these into a 16-bit score by a chain of 16x16 fixed point
   multiplications, starting from 0xffff (the D7 register of the
   original: mulu.w + swap).

   The poi fields are addressed by their Amiga byte offset (POI(p, off))
   so the evaluators can be compared with the disassembly:
     0x00 own land, 0x02 free land, 0x04 enemy land,
     0x06 grass (down triangle 4..7), 0x08 mountain (down 11..14),
     0x0a water vertices,
     0x0a + 2 * t buildings of type t (1..24):
       0c fisher, 0e lumberjack, 10 boatbuilder, 12 stonecutter,
       14 stonemine, 16 coalmine, 18 ironmine, 1a goldmine,
       1c forester, 1e stock, 20 hut, 22 farm, 24 butcher, 26 pigfarm,
       28 mill, 2a baker, 2c sawmill, 2e steelsmelter, 30 toolmaker,
       32 weaponsmith, 34 tower, 36 fortress, 38 goldsmelter, 3a castle,
     0x3c trees, 0x3e meadow (type 0x55), 0x40 stones,
     0x42..0x48 gold/iron/coal/stone signs,
     0x4a roads (or shore state, see poi_check_shore),
     0x4c..0x52 ground deposits gold/iron/coal/stone (castle scan),
     0x54 other objects, 0x56 empty signs. */

// PORT: the C++ class AI::Rate (ai-rate.h) only has static members; they
// are the exported functions of this module.

import {
  AI_BUILDING, AI_CAN_BUILD_CASTLE, AI_CAN_BUILD_FLAG, AI_CAN_BUILD_LARGE,
  AI_CAN_BUILD_MINE, AI_CAN_BUILD_SMALL, AI_CURSOR_POS, BUILDING_IS_DONE,
  BUILDING_TYPE, MAP_HAS_OWNER, MAP_MOVE, MAP_MOVE_DOWN_RIGHT, MAP_MOVE_RIGHT,
  MAP_MOVE_UP_LEFT, MAP_OBJ, MAP_OBJ_INDEX, MAP_OWNER, MAP_PATHS,
  MAP_RES_TYPE, MAP_TYPE_DOWN, MAP_TYPE_UP, PLAYER_NUM, POI, POI_SET, aiGame,
  poiClear, poiCopy,
} from './ai-internal';
import { MapObject } from './map';
import type { MapPos } from './map-geometry';
import { u32 } from './misc';
import type { AIPoi, Player } from './player';
import { AI_LOCATIONS_PER_CATEGORY } from './player';

/* Evaluator: returns the D7 register of the original. */
export type RateFn = (player: Player) => number;

/* Ring walk state (D1 position, D3 side length - 1, D4 weight, D7
   owner of the original). It carries over between the ring groups. */
export interface Ring {
  pos: MapPos;
  side: number;
  weight: number;
  owner: number;
  poi: AIPoi;
}

export type RingTileFn = (r: Ring, pos: MapPos) => void;

/* Number of location categories rated (0..34). */
export const categoryCount = 35;

/* Read a poi field as unsigned 16-bit word. */
const W = (p: AIPoi, off: number): number => POI(p, off) & 0xffff;

/* Value clamped like "cmpi.w #n; bcs; move.w #n-1". */
export function clampw(v: number, n: number): number {
  v &= 0xffff;
  return (v < n) ? v : n - 1;
}

/* Decreasing factor: lsl.w #s; not.w */
const FN = (v: number, s: number): number => (~(v << s)) & 0xffff;
/* Increasing factor: lsl.w #s; addi.w #a */
const FA = (v: number, s: number, a: number): number => ((v << s) + a) & 0xffff;

/* mulu.w D6w,D7; swap D7 */
export function mul(d7: number, d6: number): number {
  // PORT: the product needs all 32 bits; it is exact in a double.
  const r = (d7 & 0xffff) * (d6 & 0xffff);
  return ((r >>> 16) | (r << 16)) >>> 0;
}

/* ((p3 * 2 + p2) * 2 + p1) * 2 + p0 of one field. */
export function wsum(p: AIPoi[], off: number): number {
  let s = W(p[3], off);
  s = s + s + W(p[2], off);
  s = s + s + W(p[1], off);
  s = s + s + W(p[0], off);
  return s & 0xffff;
}

// PORT: the POIS(player) macro declares a0..a3 and ap[4]; here every
// evaluator takes them from player.ai.poi (ap is the array itself, of
// which only the first four entries are used).


/* ---- Attack target evaluators ---- */

/* attack_score_base @0x2d316 */
export function attackScoreBase(player: Player): number {
  const [a0, a1, a2] = player.ai.poi;
  const ap = player.ai.poi;
  let d7 = 0xffffffff;
  let d6: number;

  /* Military buildings (fortress + castle, tower, hut). */
  d6 = (((W(a2, 0x36) + W(a2, 0x3a)) * 2 + W(a2, 0x34)) * 2 + W(a2, 0x20));
  d7 = mul(d7, FN(clampw(d6, 0xc8), 8));
  d6 = (((W(a1, 0x36) + W(a1, 0x3a)) * 2 + W(a1, 0x34)) * 2 + W(a1, 0x20));
  d7 = mul(d7, FN(clampw(d6, 0x15e), 7));
  d6 = (((W(a0, 0x36) + W(a0, 0x3a)) * 2 + W(a0, 0x34)) * 2 + W(a0, 0x20));
  d7 = mul(d7, FN(clampw(d6, 0x258), 6));
  /* Stocks. */
  d6 = wsum(ap, 0x1e);
  d7 = mul(d7, FA(clampw(d6, 0x8c), 7, -0x4601));
  /* Land of the target's owner. */
  d7 = mul(d7, FA(clampw(W(a0, 0x00), 0x384), 6, 0x1eff));
  return d7;
}

/* rate_attack_steel_weapons @0x2d44c */
export function rateAttackSteelWeapons(player: Player): number {
  const ap = player.ai.poi;
  let d7 = attackScoreBase(player);
  const d3 = wsum(ap, 0x16) + wsum(ap, 0x18) + wsum(ap, 0x2e) +
    wsum(ap, 0x32);
  d7 = mul(d7, FA(clampw(d3, 0xc8), 8, 0x37ff));
  return d7 & 0xffff;
}

/* rate_attack_tools @0x2d4ca */
export function rateAttackTools(player: Player): number {
  const ap = player.ai.poi;
  let d7 = attackScoreBase(player);
  const d3 = wsum(ap, 0x16) + wsum(ap, 0x18) + wsum(ap, 0x2e) +
    wsum(ap, 0x30) + wsum(ap, 0x0e) + wsum(ap, 0x1c) +
    wsum(ap, 0x2c);
  d7 = mul(d7, FA(clampw(d3, 0x190), 7, 0x37ff));
  return d7 & 0xffff;
}

/* rate_attack_gold @0x2d590 */
export function rateAttackGold(player: Player): number {
  const ap = player.ai.poi;
  let d7 = attackScoreBase(player);
  const d3 = wsum(ap, 0x16) + wsum(ap, 0x1a) + wsum(ap, 0x38);
  d7 = mul(d7, FA(clampw(d3, 0xc8), 8, 0x37ff));
  return d7 & 0xffff;
}

/* rate_attack_food @0x2d5f6 */
export function rateAttackFood(player: Player): number {
  const ap = player.ai.poi;
  let d7 = attackScoreBase(player);
  const d3 = wsum(ap, 0x0c) + wsum(ap, 0x22) + wsum(ap, 0x24) +
    wsum(ap, 0x26) + wsum(ap, 0x28) + wsum(ap, 0x2a);
  d7 = mul(d7, FA(clampw(d3, 0x190), 7, 0x37ff));
  return d7 & 0xffff;
}

/* rate_attack_wood_stone @0x2d6a4 */
export function rateAttackWoodStone(player: Player): number {
  const ap = player.ai.poi;
  let d7 = attackScoreBase(player);
  const d3 = wsum(ap, 0x0e) + wsum(ap, 0x12) + wsum(ap, 0x1c) +
    wsum(ap, 0x14);
  d7 = mul(d7, FA(clampw(d3, 0xc8), 8, 0x37ff));
  return d7 & 0xffff;
}

/* rate_attack_gold_deposit @0x2d722 */
export function rateAttackGoldDeposit(player: Player): number {
  const ap = player.ai.poi;
  let d7 = attackScoreBase(player);
  const d6 = wsum(ap, 0x42) + wsum(ap, 0x1a);
  d7 = mul(d7, FA(clampw(d6, 0x7d), 9, 0x5ff));
  return d7 & 0xffff;
}

/* rate_attack_iron_deposit @0x2d770 */
export function rateAttackIronDeposit(player: Player): number {
  const ap = player.ai.poi;
  let d7 = attackScoreBase(player);
  const d6 = wsum(ap, 0x44) + wsum(ap, 0x18);
  d7 = mul(d7, FA(clampw(d6, 0xfa), 8, 0x5ff));
  return d7 & 0xffff;
}

/* rate_attack_coal_deposit @0x2d7bc */
export function rateAttackCoalDeposit(player: Player): number {
  const ap = player.ai.poi;
  let d7 = attackScoreBase(player);
  const d6 = wsum(ap, 0x46) + wsum(ap, 0x16);
  d7 = mul(d7, FA(clampw(d6, 0x1f4), 7, 0x5ff));
  return d7 & 0xffff;
}

/* rate_attack_stone_deposit @0x2d808 */
export function rateAttackStoneDeposit(player: Player): number {
  const a2 = player.ai.poi[2];
  const ap = player.ai.poi;
  let d7 = attackScoreBase(player);
  const d6 = wsum(ap, 0x48) + wsum(ap, 0x14) + W(a2, 0x40);
  d7 = mul(d7, FA(clampw(d6, 0xfa), 8, 0x5ff));
  return d7 & 0xffff;
}


/* ---- Location store ---- */

/* store_location @0x2da3e: remember the cursor with the given value
   in category's list of 8 locations. Updates the entry at the same
   position, else replaces the lowest entry if value is not lower. */
export function storeLocation(player: Player, category: number, value: number): void {
  const loc = player.ai.locations[category];
  const col = player.ai.cursorCol;
  const row = player.ai.cursorRow;
  let minLoc = loc[0];
  let min = 0xffff;

  value &= 0xffff;
  for (let i = 0; i < AI_LOCATIONS_PER_CATEGORY; i++) {
    const v = loc[i].value & 0xffff;
    if (!(min < v)) {
      min = v;
      minLoc = loc[i];
    }
    if (loc[i].col === col && loc[i].row === row) {
      loc[i].value = value;
      return;
    }
  }

  if (value >= (minLoc.value & 0xffff)) {
    minLoc.value = value;
    minLoc.col = col;
    minLoc.row = row;
  }
}


/* ---- Common site factors ---- */

/* Military buildings near: ((((3.fortress * 2 + 3.tower + 2.fortress) * 2
   + 3.hut + 2.tower) * 2 + 2.hut. */
export function militaryNear(a2: AIPoi, a3: AIPoi): number {
  let d6 = W(a3, 0x36);
  d6 = d6 + d6 + W(a3, 0x34) + W(a2, 0x36);
  d6 = d6 + d6 + W(a3, 0x20) + W(a2, 0x34);
  d6 = d6 + d6 + W(a2, 0x20);
  return d6 & 0xffff;
}

/* Economic buildings in poi a1 (tower/fortress rating). */
export function economyNear(a1: AIPoi): number {
  let d6 = W(a1, 0x1e);
  d6 = d6 + d6 + W(a1, 0x3a) + W(a1, 0x32) + W(a1, 0x30) +
    W(a1, 0x16) + W(a1, 0x18) + W(a1, 0x1a);
  d6 = d6 + d6 + W(a1, 0x22) + W(a1, 0x24) + W(a1, 0x26) +
    W(a1, 0x2a) + W(a1, 0x2c) + W(a1, 0x2e) + W(a1, 0x38) +
    W(a1, 0x14);
  d6 = d6 + d6 + W(a1, 0x0c) + W(a1, 0x0e) + W(a1, 0x10) +
    W(a1, 0x12) + W(a1, 0x1c) + W(a1, 0x28);
  return d6 & 0xffff;
}

/* site_score_base_b @0x2da84 */
export function siteScoreBaseB(player: Player, d7: number): number {
  const [a0, a1, a2, a3] = player.ai.poi;
  let d6: number;

  /* The original also shifts D5 here (lsl.w #2,D5w @0x2da88), a
     register that none of the callers uses afterwards. */
  d6 = (W(a3, 0x04) + W(a2, 0x04)) * 4 + W(a2, 0x02);
  d7 = mul(d7, FN(clampw(d6, 0xfa0), 4));
  d6 = W(a0, 0x04) * 4 + W(a0, 0x02);
  d7 = mul(d7, FN(clampw(d6, 0x4e20), 1));
  d7 = mul(d7, FA(clampw(militaryNear(a2, a3), 0x6e), 8, -0x6e01));
  d7 = mul(d7, FN(clampw(W(a3, 0x22), 0x10), 12));
  d7 = mul(d7, FN(clampw(W(a2, 0x1c), 0x20), 11));
  d6 = W(a1, 0x1e) + W(a1, 0x3a);
  d7 = mul(d7, FA(clampw(d6, 0x14), 10, -0x5001));
  return d7;
}

/* site_score_base_a @0x2db44 */
export function siteScoreBaseA(player: Player, d7: number): number {
  const [, a1, a2, a3] = player.ai.poi;
  let d6: number;

  d7 = mul(d7, FN(clampw(W(a1, 0x02), 0x800), 4));
  d7 = mul(d7, FN(clampw(W(a2, 0x04), 0x384), 6));
  d7 = mul(d7, FN(clampw(W(a1, 0x04), 0x400), 5));
  d6 = W(a3, 0x22) * 8 + W(a2, 0x22);
  d7 = mul(d7, FN(clampw(d6, 0x80), 9));
  d7 = mul(d7, FN(clampw(W(a2, 0x1c), 0x20), 11));
  return d7;
}

/* site_score_base_mine @0x2dbbe */
export function siteScoreBaseMine(player: Player, d7: number): number {
  const a1 = player.ai.poi[1];
  let d6: number;

  d7 = mul(d7, FN(clampw(W(a1, 0x02), 0x1000), 2));
  /* The original computes poi[2] enemy land * 4 here and overwrites
     it unused (@0x2dbd4). */
  d7 = mul(d7, FN(clampw(W(a1, 0x04), 0x1fff), 3));
  d6 = W(a1, 0x1e) + W(a1, 0x3a);
  d7 = mul(d7, FA(clampw(d6, 0x14), 10, -0x5001));
  return d7;
}


/* ---- Building site evaluators ----
   Each returns the D7 register of the original. The caller stores the
   low word if the returned value is non-zero (most evaluators end with
   tst.w D7w and return only the low word; the mine evaluators end with
   swap D7, so the whole register is tested). */

/* rate_site_none @0x2dc12: flag site (uses poi[0] only). */
export function rateSiteNone(player: Player): number {
  const a0 = player.ai.poi[0];
  let d6 = (W(a0, 0x02) + W(a0, 0x04)) & 0xffff;
  if (d6 !== 0) return 0;

  d6 = W(a0, 0x4a);
  if (d6 === 0) return 0x9c40;
  if (d6 !== 0xffff) return 0;
  if (W(a0, 0x0a) < 0x0c) return 0;
  /* (0x368,A4) = poi[4] sawmill count, (0x3ac,A4) = u_3ac. */
  if (W(player.ai.poi[4], 0x2c) === 0 &&
      (player.ai.u_3ac & 0xffff) === 0) {
    return 0;
  }
  return 0x88b8;
}

/* rate_site_fisher @0x2dc4c */
export function rateSiteFisher(player: Player): number {
  const [, a1, a2, a3] = player.ai.poi;
  let d7 = siteScoreBaseA(player, 0xffffffff);
  let d6 = W(a3, 0x0a);
  if (d6 < 0x50) return 0;
  d6 -= 0x50;
  d7 = mul(d7, FA(clampw(d6, 0x100), 8, 0));
  d7 = mul(d7, FA(clampw(W(a2, 0x0a), 0x200), 6, 0x7fff));
  d7 = mul(d7, FA(clampw(W(a1, 0x0a), 0x400), 4, -0x4001));
  d7 = mul(d7, FN(clampw(W(a2, 0x0c), 0x10), 12));
  return d7 & 0xffff;
}

/* rate_site_lumberjack @0x2dcbc */
export function rateSiteLumberjack(player: Player): number {
  const [, a1, a2, a3] = player.ai.poi;
  let d7 = siteScoreBaseA(player, 0xffffffff);
  let d6: number;

  d6 = W(a1, 0x1e) + W(a1, 0x3a);
  d7 = mul(d7, FA(clampw(d6, 0x14), 8, -0x1401));
  d6 = (W(a3, 0x1c) * 8 + W(a2, 0x1c)) * 2 + W(a1, 0x1c);
  d7 = mul(d7, FA(clampw(d6, 0x100), 6, -0x4001));
  d6 = (W(a3, 0x0e) * 8 + W(a2, 0x0e)) * 2 + W(a1, 0x0e);
  d7 = mul(d7, FN(clampw(d6, 0x100), 6));
  d7 = mul(d7, FA(clampw(W(a1, 0x2c), 0x14), 10, -0x5001));
  d7 = mul(d7, FN(clampw(W(a2, 0x4a), 0x7d0), 5));
  d7 = mul(d7, FA(clampw(W(a2, 0x3c), 0x800), 5, 0));
  return d7 & 0xffff;
}

/* rate_site_boatbuilder @0x2dd6c */
export function rateSiteBoatbuilder(player: Player): number {
  const a1 = player.ai.poi[1];
  let d7 = siteScoreBaseA(player, 0xffffffff);
  const d6 = W(a1, 0x1e) + W(a1, 0x3a);
  d7 = mul(d7, FA(clampw(d6, 0x14), 11, 0x5fff));
  d7 = mul(d7, FA(clampw(W(a1, 0x2c), 0x14), 11, 0x5fff));
  return d7 & 0xffff;
}

/* rate_site_stonecutter @0x2ddae */
export function rateSiteStonecutter(player: Player): number {
  const [, a1, a2, a3] = player.ai.poi;
  let d7 = siteScoreBaseA(player, 0xffffffff);
  const d6 = W(a1, 0x1e) + W(a1, 0x3a);
  d7 = mul(d7, FA(clampw(d6, 0x14), 8, -0x1401));
  d7 = mul(d7, FA(clampw(W(a2, 0x40), 0x100), 8, 0));
  if (W(a3, 0x12) !== 0) d7 = 0;
  d7 = mul(d7, FN(clampw(W(a2, 0x12), 0x20), 12));
  return d7 & 0xffff;
}

/* Mines @0x2de08..0x2dede: signs in poi[3] (sign_off), mines of the
   same type in poi[2] (mine_off). */
export function rateSiteMine(player: Player, signOff: number, mineOff: number): number {
  const [, , a2, a3] = player.ai.poi;
  let d7 = siteScoreBaseMine(player, 0xffffffff);
  d7 = mul(d7, FA(clampw(W(a3, signOff), 0x10), 12, 0));
  d7 = mul(d7, FN(clampw(W(a2, mineOff), 0x1f), 11));
  return d7;
}

/* rate_site_stonemine @0x2de08 */
export function rateSiteStonemine(player: Player): number {
  return rateSiteMine(player, 0x48, 0x14);
}

/* rate_site_coalmine @0x2de3e */
export function rateSiteCoalmine(player: Player): number {
  return rateSiteMine(player, 0x46, 0x16);
}

/* rate_site_ironmine @0x2de74 */
export function rateSiteIronmine(player: Player): number {
  return rateSiteMine(player, 0x44, 0x18);
}

/* rate_site_goldmine @0x2deaa */
export function rateSiteGoldmine(player: Player): number {
  return rateSiteMine(player, 0x42, 0x1a);
}

/* rate_site_forester @0x2dee0 */
export function rateSiteForester(player: Player): number {
  const [, a1, a2, a3] = player.ai.poi;
  let d7 = siteScoreBaseB(player, 0xffffffff);
  let d6: number;

  d6 = W(a2, 0x1c) * 16 + W(a1, 0x1c);
  d7 = mul(d7, FN(clampw(d6, 0x100), 8));
  d6 = (W(a3, 0x0e) * 8 + W(a2, 0x0e)) * 2 + W(a1, 0x0e);
  d7 = mul(d7, FA(clampw(d6, 0x100), 7, 0x7fff));
  d7 = mul(d7, FA(clampw(W(a3, 0x0e), 0x0f), 12, 0xfff));
  d7 = mul(d7, FA(clampw(W(a1, 0x2c), 0x14), 9, -0x2801));
  d7 = mul(d7, FN(clampw(W(a2, 0x4a), 0x400), 6));
  d7 = mul(d7, FN(clampw(W(a2, 0x3c), 0x800), 3));
  return d7 & 0xffff;
}

/* rate_site_stock @0x2df8a */
export function rateSiteStock(player: Player): number {
  const [a0, a1, a2] = player.ai.poi;
  let d7 = siteScoreBaseB(player, 0xffffffff);
  let d6: number;

  d6 = W(a2, 0x1e) * 2 + W(a1, 0x1e) + W(a1, 0x3a);
  d7 = mul(d7, FN(clampw(d6, 0x1e), 11));
  d6 = (W(a2, 0x04) * 2 + W(a2, 0x02)) & 0xffff;
  if (d6 !== 0) d7 = 0;
  d6 = W(a1, 0x04) * 2 + W(a1, 0x02);
  d7 = mul(d7, FN(clampw(d6, 0x1ff), 7));
  d6 = W(a0, 0x04) * 2 + W(a0, 0x02);
  d7 = mul(d7, FN(clampw(d6, 0x1000), 4));
  return d7 & 0xffff;
}

/* rate_site_hut @0x2dffc */
export function rateSiteHut(player: Player): number {
  const [, , a2, a3] = player.ai.poi;
  let d7 = 0xffffffff;
  let d6: number;

  d6 = W(a3, 0x02) + W(a3, 0x04);
  d7 = mul(d7, FA(clampw(d6, 0x7f), 9, 0x1ff));
  d6 = W(a2, 0x02) + W(a2, 0x04);
  d7 = mul(d7, FA(clampw(d6, 0x1f4), 7, 0x5ff));
  d7 = mul(d7, FA(clampw(W(a3, 0x02), 0x64), 8, -0x6401));
  d7 = mul(d7, FA(clampw(W(a2, 0x02), 0x1f4), 6, -0x7d01));
  if (W(a3, 0x20) !== 0) d7 = 0;
  d7 = mul(d7, FN(clampw(W(a2, 0x20), 0x50), 8));
  return d7 & 0xffff;
}

/* rate_site_farm @0x2e08a */
export function rateSiteFarm(player: Player): number {
  const [, a1, a2, a3] = player.ai.poi;
  let d7 = siteScoreBaseB(player, 0xffffffff);

  d7 = mul(d7, FN(clampw(W(a3, 0x4a), 0x1f4), 7));
  d7 = mul(d7, FA(clampw(W(a3, 0x3e), 0x1f4), 7, 0x5ff));
  d7 = mul(d7, FN(clampw(W(a2, 0x22), 0x1e), 11));
  d7 = mul(d7, FA(clampw(W(a1, 0x28), 0x28), 9, -0x5001));
  d7 = mul(d7, FA(clampw(W(a1, 0x26), 0x28), 8, -0x2801));
  const d6 = W(a1, 0x24) + W(a1, 0x2a);
  d7 = mul(d7, FA(clampw(d6, 0x28), 6, -0xa01));
  return d7 & 0xffff;
}

/* rate_site_butcher @0x2e128 */
export function rateSiteButcher(player: Player): number {
  const a1 = player.ai.poi[1];
  let d7 = siteScoreBaseB(player, 0xffffffff);
  d7 = mul(d7, FA(clampw(W(a1, 0x26), 0x14), 11, 0x5fff));
  d7 = mul(d7, FA(clampw(W(a1, 0x22), 0x14), 9, -0x2801));
  d7 = mul(d7, FN(clampw(W(a1, 0x24), 0x14), 11));
  return d7 & 0xffff;
}

/* rate_site_pigfarm @0x2e17e */
export function rateSitePigfarm(player: Player): number {
  const a1 = player.ai.poi[1];
  let d7 = siteScoreBaseB(player, 0xffffffff);
  d7 = mul(d7, FA(clampw(W(a1, 0x22), 0x14), 11, 0x5fff));
  d7 = mul(d7, FA(clampw(W(a1, 0x24), 0x14), 10, -0x5001));
  return d7 & 0xffff;
}

/* rate_site_mill @0x2e1bc */
export function rateSiteMill(player: Player): number {
  const a1 = player.ai.poi[1];
  let d7 = siteScoreBaseA(player, 0xffffffff);
  const d6 = W(a1, 0x1e) + W(a1, 0x3a);
  d7 = mul(d7, FA(clampw(d6, 0x1e), 10, -0x7801));
  d7 = mul(d7, FA(clampw(W(a1, 0x22), 0x14), 11, 0x5fff));
  d7 = mul(d7, FA(clampw(W(a1, 0x2a), 0x14), 10, -0x5001));
  d7 = mul(d7, FN(clampw(W(a1, 0x28), 0x14), 11));
  return d7 & 0xffff;
}

/* rate_site_baker @0x2e230 */
export function rateSiteBaker(player: Player): number {
  const a1 = player.ai.poi[1];
  let d7 = siteScoreBaseB(player, 0xffffffff);
  d7 = mul(d7, FA(clampw(W(a1, 0x28), 0x14), 11, 0x5fff));
  d7 = mul(d7, FA(clampw(W(a1, 0x22), 0x14), 9, -0x2801));
  d7 = mul(d7, FN(clampw(W(a1, 0x2a), 0x14), 11));
  return d7 & 0xffff;
}

/* rate_site_sawmill @0x2e286 */
export function rateSiteSawmill(player: Player): number {
  const a1 = player.ai.poi[1];
  let d7 = siteScoreBaseB(player, 0xffffffff);
  d7 = mul(d7, FA(clampw(W(a1, 0x0e), 0x14), 10, -0x5001));
  d7 = mul(d7, FA(clampw(W(a1, 0x1c), 0x14), 9, -0x2801));
  d7 = mul(d7, FN(clampw(W(a1, 0x2c), 0x14), 11));
  return d7 & 0xffff;
}

/* rate_site_steelsmelter @0x2e2dc */
export function rateSiteSteelsmelter(player: Player): number {
  const [, a1, a2] = player.ai.poi;
  let d7 = siteScoreBaseB(player, 0xffffffff);
  d7 = mul(d7, FA(clampw(W(a1, 0x18), 0x1a), 11, 0x2fff));
  d7 = mul(d7, FA(clampw(W(a1, 0x16), 0x1a), 11, 0x2fff));
  d7 = mul(d7, FN(clampw(W(a2, 0x2e), 0x14), 11));
  d7 = mul(d7, FA(clampw(W(a1, 0x30), 0x14), 10, -0x5001));
  d7 = mul(d7, FA(clampw(W(a1, 0x32), 0x14), 10, -0x5001));
  return d7 & 0xffff;
}

/* rate_site_toolmaker @0x2e366 */
export function rateSiteToolmaker(player: Player): number {
  const [, a1, a2] = player.ai.poi;
  let d7 = siteScoreBaseB(player, 0xffffffff);
  d7 = mul(d7, FA(clampw(W(a1, 0x2c), 0x12), 11, 0x6fff));
  d7 = mul(d7, FA(clampw(W(a1, 0x2e), 0x12), 11, 0x6fff));
  d7 = mul(d7, FN(clampw(W(a2, 0x30), 0x14), 11));
  return d7 & 0xffff;
}

/* rate_site_weaponsmith @0x2e3bc */
export function rateSiteWeaponsmith(player: Player): number {
  const [, a1, a2] = player.ai.poi;
  let d7 = siteScoreBaseB(player, 0xffffffff);
  d7 = mul(d7, FA(clampw(W(a1, 0x16), 0x1a), 11, 0x2fff));
  d7 = mul(d7, FA(clampw(W(a1, 0x2e), 0x16), 11, 0x4fff));
  d7 = mul(d7, FN(clampw(W(a2, 0x32), 0x14), 11));
  return d7 & 0xffff;
}

/* rate_site_tower @0x2e412 */
export function rateSiteTower(player: Player): number {
  const [a0, a1, a2, a3] = player.ai.poi;
  let d7 = 0xffffffff;
  let d6: number;

  d6 = W(a2, 0x04) * 4 + W(a2, 0x02);
  d7 = mul(d7, FN(clampw(d6, 0x3b6), 6));
  d6 = W(a0, 0x04) * 4 + W(a0, 0x02);
  d7 = mul(d7, FN(clampw(d6, 0xfa0), 3));
  d7 = mul(d7, FA(clampw(militaryNear(a2, a3), 0x6e), 9, 0x23ff));
  d7 = mul(d7, FA(clampw(economyNear(a1), 0x200), 7, 0));
  return d7 & 0xffff;
}

/* rate_site_fortress @0x2e4ee */
export function rateSiteFortress(player: Player): number {
  const [a0, a1, a2, a3] = player.ai.poi;
  let d7 = 0xffffffff;
  let d6: number;

  d6 = W(a2, 0x04) * 4 + W(a2, 0x02);
  d7 = mul(d7, FN(clampw(d6, 0x1f4), 7));
  d6 = W(a0, 0x04) * 4 + W(a0, 0x02);
  d7 = mul(d7, FN(clampw(d6, 0xbb8), 4));
  d7 = mul(d7, FA(clampw(militaryNear(a2, a3), 0x32), 10, 0x37ff));
  d7 = mul(d7, FA(clampw(economyNear(a1), 0x200), 7, 0));
  return d7 & 0xffff;
}

/* rate_site_goldsmelter @0x2e5ca */
export function rateSiteGoldsmelter(player: Player): number {
  const [, a1, a2] = player.ai.poi;
  let d7 = siteScoreBaseB(player, 0xffffffff);
  d7 = mul(d7, FA(clampw(W(a1, 0x1a), 0x1a), 11, 0x2fff));
  d7 = mul(d7, FA(clampw(W(a1, 0x16), 0x1a), 11, 0x2fff));
  d7 = mul(d7, FN(clampw(W(a2, 0x38), 0x14), 11));
  return d7 & 0xffff;
}

/* rate_site_geologist @0x2e620 */
export function rateSiteGeologist(player: Player): number {
  const [, , a2, a3] = player.ai.poi;
  let d7 = siteScoreBaseMine(player, 0xffffffff);
  let d6: number;

  d6 = W(a3, 0x14) + W(a3, 0x16) + W(a3, 0x18) + W(a3, 0x1a);
  d7 = mul(d7, FN(clampw(d6, 0x40), 9));
  d6 = W(a3, 0x42) + W(a3, 0x44) + W(a3, 0x46) + W(a3, 0x48) +
    W(a3, 0x56);
  d6 = d6 + d6 + W(a2, 0x42) + W(a2, 0x44) + W(a2, 0x46) +
    W(a2, 0x48) + W(a2, 0x56);
  d7 = mul(d7, FN(clampw(d6, 0xff), 8));
  return d7 & 0xffff;
}

/* rate_site_castle @0x2e68a */
export function rateSiteCastleD7(player: Player): number {
  const [a0, a1, a2] = player.ai.poi;
  let d7 = 0xffffffff;
  let d6: number;

  d7 = mul(d7, FN(clampw(W(a0, 0x04), 0x3b6), 6));
  d7 = mul(d7, FN(clampw(W(a2, 0x04), 0xfc), 8));
  d6 = W(a0, 0x06) + W(a0, 0x08);
  d7 = mul(d7, FA(clampw(d6, 0x1b58), 2, -0x6d61));
  d7 = mul(d7, FA(clampw(W(a0, 0x0a), 0xa0), 7, -0x5001));
  d7 = mul(d7, FA(clampw(W(a1, 0x3c), 0x800), 5, 0));
  d7 = mul(d7, FA(clampw(W(a0, 0x3c), 0x800), 4, 0x7fff));
  d7 = mul(d7, FA(clampw(W(a2, 0x3e), 0x800), 5, 0));
  d7 = mul(d7, FA(clampw(W(a0, 0x3e), 0x1770), 2, -0x5dc1));
  d6 = (W(a1, 0x52) >> 1) + W(a1, 0x40);
  d7 = mul(d7, FA(clampw(d6, 0xff), 8, 0xff));
  d6 = (W(a0, 0x52) >> 1) + W(a0, 0x40);
  d7 = mul(d7, FA(clampw(d6, 0x400), 4, -0x4001));
  d7 = mul(d7, FA(clampw(W(a1, 0x40), 0x40), 10, 0));
  d7 = mul(d7, FA(clampw(W(a0, 0x4c), 0xfa), 8, 0x5ff));
  d7 = mul(d7, FA(clampw(W(a0, 0x4e), 0xfa), 8, 0x5ff));
  d7 = mul(d7, FA(clampw(W(a0, 0x50), 0x1f4), 7, 0x5ff));
  d7 = mul(d7, FA(clampw(W(a0, 0x52), 0x64), 7, -0x3201));

  /* (0x162,A4) byte = initial supplies. */
  const supplies =
    u32(player.initialSupplies) & 0xff;
  if (supplies < 0x0f) {
    if (supplies >= 0x08) {
      d7 = mul(d7, FA(clampw(W(a1, 0x4e), 0x7f), 8, -0x7f01));
      d7 = mul(d7, FA(clampw(W(a1, 0x50), 0xff), 7, -0x7f81));
    } else {
      d7 = mul(d7, FA(clampw(W(a2, 0x4e), 0x3f), 9, -0x7e01));
      d7 = mul(d7, FA(clampw(W(a2, 0x50), 0x7f), 8, -0x7f01));
      d6 = W(a2, 0x0a) * 4 + W(a1, 0x0a);
      d7 = mul(d7, FA(clampw(d6, 0xff), 8, 0xff));
    }
  }
  return d7 & 0xffff;
}

/* rate_site_castle @0x2e68a, for ai_place_castle @0x2d09e. Rates
   the cursor site from player->ai.poi[] (scan with
   ai_scan_points_of_interest first) and returns D7w. */
export function rateSiteCastle(player: Player): number {
  return (rateSiteCastleD7(player) & 0xffff) | 0;
}


/* ---- Dispatch ---- */

/* Evaluators by location category (the index of ai.locations[] and
   of the bits of rate_building_site's mask). */
export const rateByCategory: RateFn[] = [
  rateSiteNone, /* 0 flag */
  rateSiteFisher,
  rateSiteLumberjack,
  rateSiteBoatbuilder,
  rateSiteStonecutter,
  rateSiteStonemine, /* 5 */
  rateSiteCoalmine,
  rateSiteIronmine,
  rateSiteGoldmine,
  rateSiteForester,
  rateSiteStock, /* 10 */
  rateSiteHut,
  rateSiteFarm,
  rateSiteButcher,
  rateSitePigfarm,
  rateSiteMill, /* 15 */
  rateSiteBaker,
  rateSiteSawmill,
  rateSiteSteelsmelter,
  rateSiteToolmaker,
  rateSiteWeaponsmith, /* 20 */
  rateSiteTower,
  rateSiteFortress,
  rateSiteGoldsmelter,
  rateSiteCastleD7,
  rateSiteGeologist, /* 25 */
  rateAttackSteelWeapons,
  rateAttackTools,
  rateAttackGold,
  rateAttackFood,
  rateAttackWoodStone, /* 30 */
  rateAttackGoldDeposit,
  rateAttackIronDeposit,
  rateAttackCoalDeposit,
  rateAttackStoneDeposit, /* 34 */
];

/* rate_site_dispatch @0x2b830: rating of the cursor site (after
   ai_scan_points_of_interest) for category ai_game.build_building_type.
   The callers compare the result (D7w) unsigned with the values of
   ai.locations[build_building_type]. */
export function rateSiteDispatch(player: Player): number {
  const type = aiGame().buildBuildingType;

  /* Original bug: the jump table has 34 entries without the castle
     (24 = geologist, 25..33 = the attack evaluators), while the
     stores (rate_building_site, rate_attack_target) and the
     callers' location lists use 24 = castle, 25 = geologist,
     26..34 = attack. So 24..33 rated with the evaluator of the
     neighbouring category and 34 (set by ai_attack @0x2a016) jumped
     past the table into ai_want_type25. Dispatched here by the
     store numbering instead. */
  if (type < 0 || type >= categoryCount) {
    return 0;
  }
  return (rateByCategory[type](player) & 0xffff) | 0;
}


/* ---- Rating of the cursor site ---- */

/* rate_attack_target @0x2d3de: rates the enemy building at the
   cursor for the attack categories 26..34. */
export function rateAttackTarget(player: Player): void {
  for (let cat = 26; cat <= 34; cat++) {
    const d7 = rateByCategory[cat](player);
    if (d7 & 0xffff) storeLocation(player, cat, d7);
  }
}

/* rate_building_site @0x2d858: rates the cursor site for every
   category whose bit is set in categories (bit 0 flag, bits 1..23
   building types, 24 castle, 25 geologist). */
export function rateBuildingSite(player: Player, categories: number): void {
  for (let cat = 0; cat <= 25; cat++) {
    if (!((categories >>> cat) & 1)) continue;
    const d7 = rateByCategory[cat](player);
    /* beq after the evaluator: tests the whole register for the
       mine evaluators (they end with swap), else the low word. */
    if (d7 !== 0) storeLocation(player, cat, d7);
  }
}


/* ---- Area statistics ---- */

/* Table at 0x2e9d2: poi byte offset counted for each map object.
   0 = nothing (meadow test), 0xff = building (counted by type). */
const poiObjField: number[] = [
  0x00, 0x54, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, /* 0 */
  0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, /* 8 trees */
  0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, /* 16 pines */
  0x54, 0x54, 0x54, 0x54, 0x54, 0x54, 0x54, 0x54, /* 24 palms, water trees */
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, /* 32 */
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, /* 40 */
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, /* 48 */
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, /* 56 */
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, /* 64 */
  0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40, /* 72 stones */
  0x54, 0x54, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, /* 80 */
  0x54, 0x54, 0x54, 0x54, 0x54, 0x54, 0x54, 0x54, /* 88 */
  0x54, 0x00, 0x54, 0x54, 0x54, 0x54, 0x00, 0x54, /* 96 */
  0x54, 0x54, 0x54, 0x54, 0x54, 0x54, 0x54, 0x00, /* 104 */
  0x42, 0x42, 0x44, 0x44, 0x46, 0x46, 0x48, 0x48, /* 112 signs */
  0x56, 0x54, 0x54, 0x54, 0x54, 0x54, 0x54, 0xff, /* 120 */
];

export function poiAdd(poi: AIPoi, off: number, w: number): void {
  POI_SET(poi, off, (POI(poi, off) + w) & 0xffff);
}

/* Amiga obj bit 7 (set by map_mark_water_tiles): own up or down
   triangle is water. */
export function waterVertex(pos: MapPos): boolean {
  return MAP_TYPE_UP(pos) < 4 || MAP_TYPE_DOWN(pos) < 4;
}

/* Ownership part shared by all ring counters. */
export function ringCountOwner(r: Ring, pos: MapPos): void {
  if (!MAP_HAS_OWNER(pos)) {
    poiAdd(r.poi, 0x02, r.weight);
  } else if ((MAP_OWNER(pos) | 0) === r.owner) {
    poiAdd(r.poi, 0x00, r.weight);
  } else {
    poiAdd(r.poi, 0x04, r.weight);
  }
}

/* Count a building at pos by its type; done_only skips unfinished. */
export function ringCountBuilding(r: Ring, pos: MapPos, doneOnly: number): void {
  /* Table entry 0xff of obj 127 would read a bogus index. */
  if (MAP_OBJ(pos) < MapObject.ObjectSmallBuilding ||
      MAP_OBJ(pos) > MapObject.ObjectCastle) {
    return;
  }
  const building = AI_BUILDING(MAP_OBJ_INDEX(pos));
  if (doneOnly && !BUILDING_IS_DONE(building)) return;
  poiAdd(r.poi, 0x0a + 2 * (BUILDING_TYPE(building) | 0),
         r.weight);
}

/* Tile of poi_count_rings_deposits @0x2ea52 */
export function ringTileDeposits(r: Ring, pos: MapPos): void {
  ringCountOwner(r, pos);

  if (waterVertex(pos)) {
    poiAdd(r.poi, 0x0a, r.weight);
  } else {
    const field = poiObjField[MAP_OBJ(pos)];
    let deposits = 1;
    if (field === 0) {
      if (MAP_TYPE_UP(pos) === 5 && MAP_TYPE_DOWN(pos) === 5) {
        poiAdd(r.poi, 0x3e, r.weight);
      }
    } else if (field & 0x80) {
      deposits = 0;
    } else {
      poiAdd(r.poi, field, r.weight);
    }

    /* Original bug: on a flag the original reads the low byte
       of the flag index (field-2 word 0) as the deposit byte;
       its deposit was moved to the neighbours when the flag
       was built. Nothing is counted for flags here. */
    if (MAP_OBJ(pos) === MapObject.ObjectFlag) deposits = 0;

    if (deposits) {
      const res = MAP_RES_TYPE(pos);
      /* Types above 4 do not occur (0x4a + 2 * 7 would
         reach the next poi in the original). */
      if (res !== 0 && res <= 6) {
        poiAdd(r.poi, 0x4a + 2 * res, r.weight);
      }
    }
  }

  const down = MAP_TYPE_DOWN(pos);
  if (down >= 4 && down < 8) {
    poiAdd(r.poi, 0x06, r.weight);
  } else if (down >= 11 && down < 15) {
    poiAdd(r.poi, 0x08, r.weight);
  }
}

/* Tile of poi_count_rings @0x2eaf4 */
export function ringTileFull(r: Ring, pos: MapPos): void {
  ringCountOwner(r, pos);

  if (waterVertex(pos)) {
    poiAdd(r.poi, 0x0a, r.weight);
  } else {
    const field = poiObjField[MAP_OBJ(pos)];
    if (field === 0) {
      if (MAP_TYPE_UP(pos) === 5 && MAP_TYPE_DOWN(pos) === 5) {
        poiAdd(r.poi, 0x3e, r.weight);
      }
    } else if (field & 0x80) {
      ringCountBuilding(r, pos, 0);
    } else {
      poiAdd(r.poi, field, r.weight);
    }
  }

  if (MAP_PATHS(pos) !== 0) poiAdd(r.poi, 0x4a, r.weight);
}

/* Tile of poi_count_rings_no_grass @0x2eb86 */
export function ringTileNoGrass(r: Ring, pos: MapPos): void {
  ringCountOwner(r, pos);

  if (waterVertex(pos)) {
    poiAdd(r.poi, 0x0a, r.weight);
  } else {
    const field = poiObjField[MAP_OBJ(pos)];
    if (field === 0) {
      /* nothing */
    } else if (field & 0x80) {
      ringCountBuilding(r, pos, 0);
    } else {
      poiAdd(r.poi, field, r.weight);
    }
  }

  if (MAP_PATHS(pos) !== 0) poiAdd(r.poi, 0x4a, r.weight);
}

/* Tile of poi_count_rings_owner @0x2ec0a */
export function ringTileOwner(r: Ring, pos: MapPos): void {
  ringCountOwner(r, pos);
}

/* Tile of poi_count_rings_objects @0x2ec48 */
export function ringTileObjects(r: Ring, pos: MapPos): void {
  ringCountOwner(r, pos);

  if (waterVertex(pos)) {
    poiAdd(r.poi, 0x0a, r.weight);
  } else {
    const field = poiObjField[MAP_OBJ(pos)];
    if (field === 0) {
      /* nothing */
    } else if (field & 0x80) {
      ringCountBuilding(r, pos, 1);
    } else {
      poiAdd(r.poi, field, r.weight);
    }
  }
}

/* Tile of the ring part of poi_check_shore @0x2ed38 */
export function ringTileShore(r: Ring, pos: MapPos): void {
  if (waterVertex(pos)) poiAdd(r.poi, 0x0a, r.weight);
  ringCountOwner(r, pos);
  if (MAP_PATHS(pos) !== 0) poiAdd(r.poi, 0x4a, r.weight);
}

// PORT: the directions are written as numbers, so that loading this
// module does not touch the exports of map-geometry.
const ringSides: number[] = [
  5 /* DirectionUp */, 4 /* DirectionUpLeft */, 3 /* DirectionLeft */,
  2 /* DirectionDown */, 1 /* DirectionDownRight */, 0 /* DirectionRight */,
];

/* Ring walk of 0x2ea52..0x2ed88: each ring starts down-right of the
   previous start and walks six sides (up, up-left, left, down,
   down-right, right) of side + 1 vertices. The weight drops by one per
   ring. The centre itself is never counted. */
export function poiCountRingsGeneric(r: Ring, rings: number, fn: RingTileFn): void {
  const sides = ringSides;

  for (let i = 0; i < rings; i++) {
    r.pos = MAP_MOVE_DOWN_RIGHT(r.pos);
    for (let s = 0; s < 6; s++) {
      for (let j = 0; j <= r.side; j++) {
        r.pos = MAP_MOVE(r.pos, sides[s]);
        fn(r, r.pos);
      }
    }
    r.side += 1;
    r.weight = (r.weight - 1) & 0xffff;
  }
}

/* poi_check_shore @0x2ecc2: shore state of a flag site in field
   0x4a (100 = not at a shore, then no rings are counted; 0xffff =
   shore), then counts the rings. */
export function poiCheckShore(r: Ring, rings: number): void {
  const pos = r.pos;
  const down = MAP_TYPE_DOWN(pos);

  if (down < 8 || down >= 11) {
    let p = MAP_MOVE_UP_LEFT(pos);
    let shore: boolean;
    if (MAP_TYPE_UP(pos) < 4) {
      if (MAP_TYPE_UP(p) >= 4 || MAP_TYPE_DOWN(p) >= 4) {
        shore = true;
      } else {
        p = MAP_MOVE_RIGHT(p);
        shore = (MAP_TYPE_UP(p) >= 4);
      }
    } else {
      if (MAP_TYPE_UP(p) < 4 || MAP_TYPE_DOWN(p) < 4) {
        shore = true;
      } else {
        p = MAP_MOVE_RIGHT(p);
        shore = (MAP_TYPE_UP(p) < 4);
      }
    }

    if (!shore) {
      POI_SET(r.poi, 0x4a, 100);
      return;
    }
    POI_SET(r.poi, 0x4a, 0xffff);
  }

  poiCountRingsGeneric(r, rings, ringTileShore);
}

/* poi_copy_to_slot1/2/3 @0x2eda0/0x2ed98/0x2ed90 */
export function poiCopyToSlot(player: Player, slot: number): void {
  poiCopy(player.ai.poi[slot], player.ai.poi[0]);
}

/* ai_scan_points_of_interest @0x2e88e */
export function scanPointsOfInterest(player: Player): void {
  poiClear(player.ai.poi[0]);

  const r: Ring = {
    pos: AI_CURSOR_POS(player),
    side: 0,
    weight: 18,
    owner: PLAYER_NUM(player),
    poi: player.ai.poi[0],
  };

  /* The original compares the byte with cmpi.b for 3 and 2 and with
     cmpi.w for 4, 1 and 5 (upper byte of D5 is 0 in practice). */
  switch (player.ai.panelBtnType & 0xff) {
    case AI_CAN_BUILD_SMALL:
      poiCountRingsGeneric(r, 3, ringTileFull);
      poiCopyToSlot(player, 3);
      poiCountRingsGeneric(r, 4, ringTileFull);
      poiCopyToSlot(player, 2);
      poiCountRingsGeneric(r, 5, ringTileNoGrass);
      poiCopyToSlot(player, 1);
      break;
    case AI_CAN_BUILD_MINE:
      poiCountRingsGeneric(r, 1, ringTileNoGrass);
      poiCopyToSlot(player, 3);
      poiCountRingsGeneric(r, 3, ringTileNoGrass);
      poiCopyToSlot(player, 2);
      poiCountRingsGeneric(r, 8, ringTileNoGrass);
      poiCopyToSlot(player, 1);
      break;
    case AI_CAN_BUILD_LARGE:
      poiCountRingsGeneric(r, 3, ringTileFull);
      poiCopyToSlot(player, 3);
      poiCountRingsGeneric(r, 4, ringTileFull);
      poiCopyToSlot(player, 2);
      poiCountRingsGeneric(r, 5, ringTileNoGrass);
      poiCopyToSlot(player, 1);
      poiCountRingsGeneric(r, 6, ringTileOwner);
      break;
    case AI_CAN_BUILD_FLAG:
      poiCheckShore(r, 3);
      break;
    case AI_CAN_BUILD_CASTLE:
      poiCountRingsGeneric(r, 3, ringTileDeposits);
      poiCopyToSlot(player, 3);
      poiCountRingsGeneric(r, 4, ringTileDeposits);
      poiCopyToSlot(player, 2);
      poiCountRingsGeneric(r, 5, ringTileDeposits);
      poiCopyToSlot(player, 1);
      poiCountRingsGeneric(r, 6, ringTileDeposits);
      break;
    default:
      /* Attack target: own = owner of the centre vertex. */
      r.owner = MAP_OWNER(r.pos) | 0;
      poiCountRingsGeneric(r, 2, ringTileObjects);
      poiCopyToSlot(player, 3);
      poiCountRingsGeneric(r, 2, ringTileObjects);
      poiCopyToSlot(player, 2);
      poiCountRingsGeneric(r, 2, ringTileObjects);
      poiCopyToSlot(player, 1);
      poiCountRingsGeneric(r, 3, ringTileObjects);
      break;
  }
}
