/*
 * ai-want.cc - Computer player: build wants per building type
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

/* Port of the Amiga build-choice functions 0x2b8c4..0x2ccc6. Each
   ai_want_<type>() writes player->ai.build_want[type - 1] (and some
   write a preliminary value for a related type that a later call
   finishes). All arithmetic is unsigned 16-bit as in the original:
   W() wraps, sadd() saturates (the original's add + bcs -> 0xffff),
   mulhi() is mulu.w + swap. The inputs come from
   ai_update_building_stats (0x2ccc8):
     ptr+0x33c..0x364  (poi[4] words 0..20): stock fill ratios
                       (amount << 16) / capacity, 0xffff when full.
     ptr+0x366..0x39a  (poi[4] words 21..43, u_394..u_39a): number of
                       serfs per serf type idle in inventories.
     ptr+0x39c..0x3ce  (u_39c..u_3ce): resources per resource type in
                       all inventories of the player (saturated). */

// PORT: the C++ class AI::Want (ai-want.h) only has static members; they
// are the exported functions of this module. The macros of the C++ use
// the local `player` implicitly; here they take it as first argument.

import { statGet } from './ai-internal';
import { BuildingType } from './building';
import { idiv, u32 } from './misc';
import type { AILocation, Player } from './player';
import { ResourceType } from './resource';
import { SerfType } from './serf';

const W = (x: number): number => x & 0xffff;

/* Stock fill ratio slots (ptr+0x33c + 2 * slot). */
const FILL_BOATBUILDER_PLANK = 0;
const FILL_STONEMINE_FOOD = 1;
const FILL_COALMINE_FOOD = 2;
const FILL_IRONMINE_FOOD = 3;
const FILL_GOLDMINE_FOOD = 4;
const FILL_TOOLMAKER_PLANK = 11;

const DONE = (player: Player, type: number): number =>
  W(player.completedBuildingCount[type]);
const INCOMPLETE = (player: Player, type: number): number =>
  W(player.incompleteBuildingCount[type]);
const BOTH = (player: Player, type: number): number =>
  W(DONE(player, type) + INCOMPLETE(player, type));
const FILL = (player: Player, slot: number): number =>
  W(stat(player, 0x33c + 2 * slot));
const IDLE = (player: Player, serf: number): number =>
  W(stat(player, 0x366 + 2 * serf));
const STOCK = (player: Player, res: number): number =>
  W(stat(player, 0x39c + 2 * res));
// PORT: WANT(type) is an lvalue in the C++; SET_WANT writes it.
const WANT = (player: Player, type: number): number =>
  player.ai.buildWant[type - 1];
const SET_WANT = (player: Player, type: number, v: number): void => {
  player.ai.buildWant[type - 1] = v;
};
const DAMP = (player: Player, type: number): number =>
  W(player.ai.buildDamp[type - 1]);
const LOC = (player: Player, cat: number): AILocation[] =>
  player.ai.locations[cat];

/* Idle generic serfs (ptr+0x390). */
const IDLE_GENERIC = (player: Player): number => IDLE(player, SerfType.TypeGeneric);

/* Word at Amiga pointer-relative offset off (0x33c..0x3ce) of the
   statistics area: poi[4] and u_394..u_3ce. */
// PORT: returns the value instead of an `int *`; this file only reads
// the statistics (see ai-internal.ts).
export function stat(player: Player, off: number): number {
  return statGet(player, off);
}

export function sadd(a: number, b: number): number {
  a = W(a) + W(b);
  return a > 0xffff ? 0xffff : a;
}

export function mulhi(a: number, b: number): number {
  // PORT: the product needs all 32 bits; it is exact in a double.
  return (W(a) * W(b)) >>> 16;
}

export function min16(a: number, b: number): number {
  return W(a) < W(b) ? W(a) : W(b);
}

/* Recurring curve of the original: have (D1) against need (D0).
   have < need: ~((have << 16 >> shift) / need), else falling from
   base with the surplus. */
export function wantCurve(have: number, need: number,
                          shift: number, step: number, base: number): number {
  if (have < need) return W(~idiv(u32(have << 16) >>> shift, need));
  have -= need;
  if (have >= 0x10) return 0;
  return W(~(have << step) + base);
}

/* Shared tail of ai_want_fisher and ai_want_pigfarm: split want between
   the type itself (return value, D1) and the related type (*second,
   D2) by the site scales s1, s2. */
// PORT: `int *second` is a box object.
export function wantShare(want: number, s1: number,
                          s2: number, second: { value: number }): number {
  if (s1 === 0) {
    second.value = (s2 !== 0) ? want : 0;
    return 0;
  }
  if (s2 === 0) {
    /* The original leaves the site scale in D1 here, so the
       type gets the scale as want instead of want. */
    second.value = 0;
    return s1;
  }
  if (s1 === s2) {
    second.value = want;
    return want;
  }
  if (s2 > s1) {
    second.value = want;
    return mulhi(idiv(u32(s1 << 16), s2), want);
  }
  second.value = mulhi(idiv(u32(s2 << 16), s1), want);
  return want;
}

/* Stone needed by the incomplete buildings (0x2bc8c/0x2bdae). */
export function stoneNeeded(player: Player): number {
  let d1 = sadd(INCOMPLETE(player, BuildingType.TypeFortress),
                INCOMPLETE(player, BuildingType.TypeFortress));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeStock));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeFarm));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeButcher));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypePigFarm));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeMill));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeBaker));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeSawmill));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeSteelSmelter));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeToolMaker));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeWeaponSmith));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeTower));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeGoldSmelter));
  d1 = sadd(d1, d1);
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeStoneMine));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeHut));
  d1 = sadd(d1, 8);
  return d1;
}

/* Miners available for mine type with the stonecutter correction
   (common head of the four mine functions, 0x2bd4e). */
export function minersAvailable(player: Player): number {
  let d0 = min16(IDLE_GENERIC(player), STOCK(player, ResourceType.TypePick));
  let d1 = INCOMPLETE(player, BuildingType.TypeStonecutter);
  if (d1 >= IDLE(player, SerfType.TypeStonecutter)) {
    d1 -= IDLE(player, SerfType.TypeStonecutter);
    d0 = (d0 >= d1) ? d0 - d1 : 0;
  }
  return W(d0 + IDLE(player, SerfType.TypeMiner));
}

/* Incomplete mines of all four kinds. */
export function incompleteMines(player: Player): number {
  return W(INCOMPLETE(player, BuildingType.TypeStoneMine) +
           INCOMPLETE(player, BuildingType.TypeCoalMine) +
           INCOMPLETE(player, BuildingType.TypeIronMine) +
           INCOMPLETE(player, BuildingType.TypeGoldMine));
}

/* Knights available for military buildings (0x2c154). */
export function knightsAvailable(player: Player): number {
  let d0 = min16(IDLE_GENERIC(player), STOCK(player, ResourceType.TypeSword));
  d0 = min16(d0, STOCK(player, ResourceType.TypeShield));
  d0 = W(d0 + IDLE(player, SerfType.TypeKnight0) + IDLE(player, SerfType.TypeKnight1) +
         IDLE(player, SerfType.TypeKnight2) + IDLE(player, SerfType.TypeKnight3) +
         IDLE(player, SerfType.TypeKnight4));
  return d0;
}

export function incompleteMilitary(player: Player): number {
  return W(INCOMPLETE(player, BuildingType.TypeHut) + INCOMPLETE(player, BuildingType.TypeTower) +
           INCOMPLETE(player, BuildingType.TypeFortress));
}

/* ai_want_scale @0x2cc16: mean value of the 8 stored sites of a
   category. */
export function wantScale(loc: AILocation[]): number {
  let sum = 0;
  let i: number;
  for (i = 0; i < 8; i++) sum += W(loc[i].value);
  return W(sum >>> 3);
}

/* ai_want_scale_mine @0x2cc5c: mean of the two best stored sites of a
   category. */
export function wantScaleMine(loc: AILocation[]): number {
  let d6 = 0;
  let d7 = 0;
  let i: number;
  /* Original bug: the unrolled loop reads (A3) eight times without
     advancing, so the result is just the value of the first site.
     Each of the 8 sites is used here. */
  for (i = 0; i < 8; i++) {
    const v = W(loc[i].value);
    if (v > d6) {
      d6 = v;
      if (d6 > d7) {
        const t = d6;
        d6 = d7;
        d7 = t;
      }
    }
  }
  return W((d6 >> 1) + (d7 >> 1));
}

/* 0x2b8c4: type 25 (pseudo building type). */
export function wantType25(player: Player): void {
  if (W(IDLE(player, SerfType.TypeTransporter) + IDLE_GENERIC(player)) < 3) return;
  if (wantScale(LOC(player, 0)) === 0) return;
  SET_WANT(player, 25, mulhi(0xdac0, DAMP(player, 25)));
}

/* 0x2b8f0: fisher; also the preliminary want of farm (finished by
   ai_want_farm). */
export function wantFisher(player: Player): void {
  let d0: number;
  let d1: number;
  let d2: number;
  let d3: number;
  const farm = { value: 0 };

  /* Food demand of the mines weighted by their food stock fill. */
  d1 = BOTH(player, BuildingType.TypeStoneMine);
  d3 = (d1 < 0x2000 ? d1 : 0x1fff) << 3;
  d0 = mulhi(d3, FILL(player, FILL_STONEMINE_FOOD));

  d2 = BOTH(player, BuildingType.TypeCoalMine);
  d1 = W(d1 + d2);
  d3 = (d2 < 0x2000 ? d2 : 0x1fff) << 3;
  d0 = W(d0 + mulhi(d3, FILL(player, FILL_COALMINE_FOOD)));

  d2 = BOTH(player, BuildingType.TypeIronMine);
  d1 = W(d1 + d2);
  d3 = (d2 < 0x2000 ? d2 : 0x1fff) << 3;
  d0 = W(d0 + mulhi(d3, FILL(player, FILL_IRONMINE_FOOD)));

  d2 = BOTH(player, BuildingType.TypeGoldMine);
  d1 = W(d1 + d2);
  d3 = (d2 < 0x2000 ? d2 : 0x1fff) << 3;
  d0 = sadd(d0, mulhi(d3, FILL(player, FILL_GOLDMINE_FOOD)));

  /* Food in stock. */
  d0 = sadd(d0, STOCK(player, ResourceType.TypeFish));
  d0 = sadd(d0, STOCK(player, ResourceType.TypeMeat));
  d0 = sadd(d0, STOCK(player, ResourceType.TypeBread));
  if (DONE(player, BuildingType.TypeButcher) !== 0) d0 = sadd(d0, STOCK(player, ResourceType.TypePig));
  if (DONE(player, BuildingType.TypeBaker) !== 0) {
    d0 = sadd(d0, STOCK(player, ResourceType.TypeFlour));
    if (DONE(player, BuildingType.TypeMill) !== 0) {
      d0 = sadd(d0, STOCK(player, ResourceType.TypeWheat));
    }
  }

  if (d1 < 8) {
    d0 = W(d0 + d0);
    if (d1 < 4) {
      d0 = W(d0 + d0);
      if (d1 < 2) d0 = W(d0 + d0);
    }
  }

  if (d1 >= 0x2000) d1 = 0x1fff;
  d1 <<= 3;
  d0 = (d0 >= d1) ? d0 - d1 : 0;

  if (d0 < 0x20) {
    d0 = W(~(d0 << 10));
  } else if (d0 < 0x50) {
    d0 = W(~(d0 << 9) - 0x4000);
  } else if (d0 < 0x70) {
    d0 = W(~(d0 << 8) + 0x7001);
  } else {
    d0 = 0;
  }

  const s1 = wantScale(LOC(player, 1));
  const s2 = wantScale(LOC(player, 12));
  d1 = wantShare(d0, s1, s2, farm);
  SET_WANT(player, BuildingType.TypeFarm, farm.value);

  d0 = min16(IDLE_GENERIC(player), STOCK(player, ResourceType.TypeRod));
  d0 = W(d0 + IDLE(player, SerfType.TypeFisher));
  if (INCOMPLETE(player, BuildingType.TypeFisher) >= d0) return;

  SET_WANT(player, BuildingType.TypeFisher, mulhi(d1, DAMP(player, BuildingType.TypeFisher)));
}

/* 0x2ba88: lumberjack. */
export function wantLumberjack(player: Player): void {
  let d0: number;
  let d1: number;
  let d2: number;

  d0 = min16(IDLE_GENERIC(player), STOCK(player, ResourceType.TypeAxe));
  d0 = W(d0 + IDLE(player, SerfType.TypeLumberjack));
  if (INCOMPLETE(player, BuildingType.TypeLumberjack) >= d0) return;

  if (BOTH(player, BuildingType.TypeLumberjack) === 0) {
    SET_WANT(player, BuildingType.TypeLumberjack, 0xffff);
    return;
  }

  /* Planks and lumber available. */
  d0 = sadd(STOCK(player, ResourceType.TypeLumber), STOCK(player, ResourceType.TypePlank));
  d2 = DONE(player, BuildingType.TypeBoatbuilder);
  d2 = (d2 < 0x2000 ? d2 : 0x1fff) << 3;
  d0 = sadd(d0, mulhi(d2, FILL(player, FILL_BOATBUILDER_PLANK)));
  d2 = DONE(player, BuildingType.TypeToolMaker);
  d2 = (d2 < 0x2000 ? d2 : 0x1fff) << 3;
  d0 = sadd(d0, mulhi(d2, FILL(player, FILL_TOOLMAKER_PLANK)));

  /* Planks needed. */
  d1 = sadd(DONE(player, BuildingType.TypeToolMaker), INCOMPLETE(player, BuildingType.TypeFortress));
  d1 = sadd(d1, d1);
  d1 = sadd(d1, DONE(player, BuildingType.TypeBoatbuilder));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeStoneMine));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeCoalMine));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeIronMine));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeGoldMine));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeStock));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeFarm));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeButcher));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypePigFarm));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeMill));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeBaker));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeSawmill));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeSteelSmelter));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeToolMaker));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeWeaponSmith));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeTower));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeGoldSmelter));
  d1 = sadd(d1, d1);
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeFisher));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeLumberjack));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeBoatbuilder));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeStonecutter));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeForester));
  d1 = sadd(d1, INCOMPLETE(player, BuildingType.TypeHut));

  d0 = (d0 >= d1) ? d0 - d1 : 0;

  if (d0 < 0x40) {
    d0 = W(~(d0 << 9));
  } else if (d0 < 0x70) {
    /* Original bug: subtracts 0x4000 here as well (copied from
       ai_want_fisher), which wraps for 0x60..0x6f to nearly
       0xffff. Without it the curve joins both neighbours. */
    d0 = W(~(d0 << 9));
  } else if (d0 < 0x90) {
    d0 = W(~(d0 << 8) - 0x6fff);
  } else {
    d0 = 0;
  }

  SET_WANT(player, BuildingType.TypeLumberjack, mulhi(d0, DAMP(player, BuildingType.TypeLumberjack)));
}

/* 0x2bbe0: boatbuilder; also sets the planks priority of
   boatbuilders. */
export function wantBoatbuilder(player: Player): void {
  let d0: number;

  d0 = min16(IDLE_GENERIC(player), STOCK(player, ResourceType.TypeHammer));
  d0 = W(d0 + IDLE(player, SerfType.TypeBoatBuilder));
  if (INCOMPLETE(player, BuildingType.TypeBoatbuilder) >= d0) return;

  d0 = STOCK(player, ResourceType.TypeBoat);
  if (d0 === 0) {
    d0 = 0x88b8;
  } else if (d0 < 2) {
    d0 = 0x4e20;
  } else if (d0 < 8) {
    d0 = W(~(d0 << 10) + 0x2800);
  } else {
    d0 = 0;
  }

  player.planksBoatbuilder = d0;
  SET_WANT(player, BuildingType.TypeBoatbuilder, mulhi(d0, DAMP(player, BuildingType.TypeBoatbuilder)));
}

/* 0x2bc38: stonecutter. */
export function wantStonecutter(player: Player): void {
  let d0: number;
  let d1: number;

  /* Picks are kept for missing coal and iron mines and for the
     miners needed by incomplete mines. */
  d0 = min16(IDLE_GENERIC(player), STOCK(player, ResourceType.TypePick));
  if (DONE(player, BuildingType.TypeCoalMine) === 0 && d0 > 0) d0 -= 1;
  if (DONE(player, BuildingType.TypeIronMine) === 0 && d0 > 0) d0 -= 1;
  d1 = incompleteMines(player);
  if (d1 >= IDLE(player, SerfType.TypeMiner)) {
    d1 -= IDLE(player, SerfType.TypeMiner);
    d0 = (d0 >= d1) ? d0 - d1 : 0;
  }
  d0 = W(d0 + IDLE(player, SerfType.TypeStonecutter));
  if (INCOMPLETE(player, BuildingType.TypeStonecutter) >= d0) return;

  d0 = STOCK(player, ResourceType.TypeStone);
  d1 = stoneNeeded(player);
  d0 = (d0 >= d1) ? d0 - d1 : 0;

  if (d0 < 0x10) {
    d0 = W(~(d0 << 11));
  } else if (d0 < 0x40) {
    d0 = W(~(d0 << 9) - 0x6000);
  } else if (d0 < 0x140) {
    d0 = W(~(d0 << 5) + 0x2801);
  } else {
    d0 = 0;
  }

  d1 = wantScale(LOC(player, 4));
  if (d1 >= 0x400) d1 = 0x3ff;
  d0 = mulhi(d0, d1 << 6);
  SET_WANT(player, BuildingType.TypeStonecutter, mulhi(d0, DAMP(player, BuildingType.TypeStonecutter)));
}

/* 0x2bd4e: stonemine. */
export function wantStonemine(player: Player): void {
  let d0: number;
  let d1: number;

  d0 = minersAvailable(player);
  if (DONE(player, BuildingType.TypeCoalMine) === 0) {
    if (d0 === 0) return;
    d0 -= 1;
  }
  if (DONE(player, BuildingType.TypeIronMine) === 0) {
    if (d0 === 0) return;
    d0 -= 1;
  }
  if (d0 <= incompleteMines(player)) return;

  d0 = wantScaleMine(LOC(player, 5));
  const d2 = STOCK(player, ResourceType.TypeStone);
  d1 = stoneNeeded(player);
  if (d2 < d1) {
    if (d0 >= 0xff0) d0 = 0xfef;
    d0 <<= 4;
  } else {
    if (d0 >= 0x1f40) d0 = 0x1f3f;
    d1 = W(STOCK(player, ResourceType.TypeStone) << 4);
    d0 = (d0 >= d1) ? d0 - d1 : 0;
    d0 = W(d0 << 3);
  }

  SET_WANT(player, BuildingType.TypeStoneMine, mulhi(d0, DAMP(player, BuildingType.TypeStoneMine)));
}

/* 0x2be4a: coalmine. */
export function wantCoalmine(player: Player): void {
  let d0: number;

  d0 = minersAvailable(player);
  if (DONE(player, BuildingType.TypeIronMine) === 0) {
    if (d0 === 0) return;
    d0 -= 1;
  }
  if (incompleteMines(player) >= d0) return;

  d0 = wantScaleMine(LOC(player, 6));
  if (d0 >= 0x1f40) d0 = 0x1f3f;
  const d1 = W(STOCK(player, ResourceType.TypeCoal) << 2);
  d0 = (d0 >= d1) ? d0 - d1 : 0;
  d0 <<= 3;
  if (d0 > 0xffff) d0 = 0xffff;

  SET_WANT(player, BuildingType.TypeCoalMine, mulhi(d0, DAMP(player, BuildingType.TypeCoalMine)));
}

/* 0x2bec0: ironmine. */
export function wantIronmine(player: Player): void {
  let d0: number;

  d0 = minersAvailable(player);
  if (DONE(player, BuildingType.TypeCoalMine) === 0) {
    if (d0 === 0) return;
    d0 -= 1;
  }
  if (incompleteMines(player) >= d0) return;

  d0 = wantScaleMine(LOC(player, 7));
  if (d0 >= 0x1f40) d0 = 0x1f3f;
  const d1 = W(STOCK(player, ResourceType.TypeIronOre) << 3);
  d0 = (d0 >= d1) ? d0 - d1 : 0;
  d0 <<= 3;
  if (d0 > 0xffff) d0 = 0xffff;

  SET_WANT(player, BuildingType.TypeIronMine, mulhi(d0, DAMP(player, BuildingType.TypeIronMine)));
}

/* 0x2bf36: goldmine. */
export function wantGoldmine(player: Player): void {
  let d0: number;

  d0 = minersAvailable(player);
  if (DONE(player, BuildingType.TypeCoalMine) === 0) {
    if (d0 === 0) return;
    d0 -= 1;
  }
  if (DONE(player, BuildingType.TypeIronMine) === 0) {
    if (d0 === 0) return;
    d0 -= 1;
  }
  if (incompleteMines(player) >= d0) return;

  d0 = wantScaleMine(LOC(player, 8));
  if (d0 >= 0x7f8) d0 = 0x7f7;
  const d1 = STOCK(player, ResourceType.TypeGoldOre);
  d0 = (d0 >= d1) ? d0 - d1 : 0;
  d0 <<= 5;
  if (d0 > 0xffff) d0 = 0xffff;

  SET_WANT(player, BuildingType.TypeGoldMine, mulhi(d0, DAMP(player, BuildingType.TypeGoldMine)));
}

/* 0x2bfb6: forester. */
export function wantForester(player: Player): void {
  let d0: number;

  d0 = W(IDLE_GENERIC(player) + IDLE(player, SerfType.TypeForester));
  if (INCOMPLETE(player, BuildingType.TypeForester) >= d0) return;

  d0 = BOTH(player, BuildingType.TypeLumberjack);
  const d1 = BOTH(player, BuildingType.TypeForester);
  if (d1 < d0) {
    d0 = wantScale(LOC(player, 9));
    if (d0 >= 0x7d0) d0 = 0x7cf;
    d0 <<= 5;
  } else if (d1 === 0) {
    SET_WANT(player, BuildingType.TypeForester, 0);
    return;
  } else if (d0 === 0) {
    /* Original bug: ((0 << 16) - 1) / d1 overflows divu, which
       leaves 0xffffffff and gives a want of 0x7ff * damp. No
       lumberjacks means no foresters are wanted. */
    d0 = 0;
  } else {
    d0 = idiv(u32(d0 << 16) - 1, d1) >>> 5;
  }

  SET_WANT(player, BuildingType.TypeForester, mulhi(d0, DAMP(player, BuildingType.TypeForester)));
}

/* 0x2c012: stock. */
export function wantStock(player: Player): void {
  let d0: number;
  let d1: number;

  if (INCOMPLETE(player, BuildingType.TypeStock) >= IDLE_GENERIC(player)) return;

  /* Large buildings count double. */
  d0 = W(BOTH(player, BuildingType.TypeStoneMine) + BOTH(player, BuildingType.TypeCoalMine) +
         BOTH(player, BuildingType.TypeIronMine) + BOTH(player, BuildingType.TypeGoldMine) +
         BOTH(player, BuildingType.TypeSteelSmelter) + BOTH(player, BuildingType.TypeToolMaker) +
         BOTH(player, BuildingType.TypeWeaponSmith) + BOTH(player, BuildingType.TypeGoldSmelter));
  d0 = sadd(d0, d0);
  d0 = sadd(d0, INCOMPLETE(player, BuildingType.TypeFisher));
  d0 = sadd(d0, DONE(player, BuildingType.TypeFisher));
  d0 = sadd(d0, INCOMPLETE(player, BuildingType.TypeLumberjack));
  d0 = sadd(d0, DONE(player, BuildingType.TypeLumberjack));
  d0 = sadd(d0, INCOMPLETE(player, BuildingType.TypeBoatbuilder));
  d0 = sadd(d0, DONE(player, BuildingType.TypeBoatbuilder));
  d0 = sadd(d0, INCOMPLETE(player, BuildingType.TypeStonecutter));
  d0 = sadd(d0, DONE(player, BuildingType.TypeStonecutter));
  d0 = sadd(d0, INCOMPLETE(player, BuildingType.TypeFarm));
  d0 = sadd(d0, DONE(player, BuildingType.TypeFarm));
  d0 = sadd(d0, INCOMPLETE(player, BuildingType.TypeButcher));
  d0 = sadd(d0, DONE(player, BuildingType.TypeButcher));
  d0 = sadd(d0, INCOMPLETE(player, BuildingType.TypePigFarm));
  d0 = sadd(d0, DONE(player, BuildingType.TypePigFarm));
  d0 = sadd(d0, INCOMPLETE(player, BuildingType.TypeMill));
  d0 = sadd(d0, DONE(player, BuildingType.TypeMill));
  d0 = sadd(d0, INCOMPLETE(player, BuildingType.TypeBaker));
  d0 = sadd(d0, DONE(player, BuildingType.TypeBaker));
  d0 = sadd(d0, INCOMPLETE(player, BuildingType.TypeSawmill));
  d0 = sadd(d0, DONE(player, BuildingType.TypeSawmill));

  if (STOCK(player, ResourceType.TypePlank) >= 0x50) {
    d0 = (d0 >> 4) + 4;
  } else if (STOCK(player, ResourceType.TypePlank) >= 0x28) {
    d0 = (d0 >> 4) + 2;
  } else if (d0 < 0x20) {
    d0 = 0;
  } else if (d0 < 0x40) {
    d0 = ((d0 - 0x20) >> 3) + 2;
  } else {
    d0 = (d0 >> 4) + 2;
  }

  d1 = BOTH(player, BuildingType.TypeStock);
  d1 = wantCurve(d1, d0, 2, 8, 0x1001);
  if (d1 >= 0xfeb0) d1 = 0xfeaf;

  SET_WANT(player, BuildingType.TypeStock, mulhi(d1, DAMP(player, BuildingType.TypeStock)));
}

/* 0x2c154: hut. */
export function wantHut(player: Player): void {
  let d0: number;

  if (incompleteMilitary(player) >= knightsAvailable(player)) {
    return;
  }

  d0 = wantScale(LOC(player, 11));
  if (d0 >= 0x4000) d0 = 0x3fff;
  d0 <<= 2;
  if (d0 >= W(player.aiValue5)) d0 = W(player.aiValue5);

  SET_WANT(player, BuildingType.TypeHut, mulhi(d0, DAMP(player, BuildingType.TypeHut)));
}

/* 0x2c1c0: farm (want prepared by ai_want_fisher). */
export function wantFarm(player: Player): void {
  let d0: number;

  d0 = min16(IDLE_GENERIC(player), STOCK(player, ResourceType.TypeScythe));
  d0 = W(d0 + IDLE(player, SerfType.TypeFarmer));
  if (INCOMPLETE(player, BuildingType.TypeFarm) >= d0) {
    SET_WANT(player, BuildingType.TypeFarm, 0);
    return;
  }

  SET_WANT(player, BuildingType.TypeFarm, mulhi(WANT(player, BuildingType.TypeFarm),
                                                DAMP(player, BuildingType.TypeFarm)));
}

/* 0x2c1f0: butcher. */
export function wantButcher(player: Player): void {
  let d0: number;
  let d1: number;

  d0 = min16(IDLE_GENERIC(player), STOCK(player, ResourceType.TypeCleaver));
  d0 = W(d0 + IDLE(player, SerfType.TypeButcher));
  if (INCOMPLETE(player, BuildingType.TypeButcher) >= d0) return;

  d0 = BOTH(player, BuildingType.TypePigFarm);
  d1 = BOTH(player, BuildingType.TypeButcher);
  if (d1 >= 0x4000) d1 = 0x3fff;
  d1 <<= 2;
  d1 = wantCurve(d1, d0, 2, 7, 0x801);

  d0 = STOCK(player, ResourceType.TypePig);
  if (d0 >= 0x200) d0 = 0x1ff;
  d0 = sadd(d0 << 7, d1);

  SET_WANT(player, BuildingType.TypeButcher, mulhi(d0, DAMP(player, BuildingType.TypeButcher)));
}

/* 0x2c26e: pigfarm; also the preliminary want of mill (finished by
   ai_want_mill). */
export function wantPigfarm(player: Player): void {
  let d0: number;
  let d1: number;
  let d2: number;
  const mill = { value: 0 };

  d0 = W(IDLE_GENERIC(player) + IDLE(player, SerfType.TypePigFarmer));
  if (INCOMPLETE(player, BuildingType.TypePigFarm) >= d0) return;

  /* Wheat production. */
  d0 = BOTH(player, BuildingType.TypeFarm);
  if (d0 >= 0x4000) d0 = 0x3fff;
  if (d0 === 0) return;
  d0 <<= 2;
  d1 = sadd(STOCK(player, ResourceType.TypeWheat), 0x20) >> 6;
  d0 = sadd(d0, d1);

  /* Wheat consumption: 12 per mill, 3 per pigfarm. */
  d1 = BOTH(player, BuildingType.TypeMill);
  d1 = sadd(d1, d1);
  d1 = sadd(d1, d1);
  d2 = d1;
  d1 = sadd(d1, d1);
  d1 = sadd(d1, d2);
  d2 = BOTH(player, BuildingType.TypePigFarm) * 3;
  d1 = (d2 > 0xffff) ? 0xffff : sadd(d1, d2);

  d1 = wantCurve(d1, d0, 2, 7, 0x801);

  d0 = STOCK(player, ResourceType.TypeWheat);
  if (d0 >= 0x200) d0 = 0x1ff;
  d0 = sadd(d0 << 7, d1);

  const s1 = wantScale(LOC(player, 14));
  const s2 = wantScale(LOC(player, 15));
  d1 = wantShare(d0, s1, s2, mill);
  SET_WANT(player, BuildingType.TypeMill, mill.value);

  SET_WANT(player, BuildingType.TypePigFarm, mulhi(d1, DAMP(player, BuildingType.TypePigFarm)));
}

/* 0x2c382: mill (want prepared by ai_want_pigfarm). */
export function wantMill(player: Player): void {
  const d0 = W(IDLE_GENERIC(player) + IDLE(player, SerfType.TypeMiller));
  if (INCOMPLETE(player, BuildingType.TypeMill) >= d0) {
    SET_WANT(player, BuildingType.TypeMill, 0);
    return;
  }

  SET_WANT(player, BuildingType.TypeMill, mulhi(WANT(player, BuildingType.TypeMill),
                                                DAMP(player, BuildingType.TypeMill)));
}

/* 0x2c3a8: baker. */
export function wantBaker(player: Player): void {
  let d0: number;
  let d1: number;

  d0 = W(IDLE_GENERIC(player) + IDLE(player, SerfType.TypeBaker));
  if (INCOMPLETE(player, BuildingType.TypeBaker) >= d0) return;

  d0 = BOTH(player, BuildingType.TypeMill);
  d1 = BOTH(player, BuildingType.TypeBaker);
  d1 = wantCurve(d1, d0, 2, 7, 0x801);

  d0 = STOCK(player, ResourceType.TypeFlour);
  if (d0 >= 0x200) d0 = 0x1ff;
  d0 = sadd(d0 << 7, d1);

  SET_WANT(player, BuildingType.TypeBaker, mulhi(d0, DAMP(player, BuildingType.TypeBaker)));
}

/* 0x2c410: sawmill. */
export function wantSawmill(player: Player): void {
  let d0: number;
  let d1: number;

  d0 = min16(IDLE_GENERIC(player), STOCK(player, ResourceType.TypeSaw));
  d0 = W(d0 + IDLE(player, SerfType.TypeSawmiller));
  if (INCOMPLETE(player, BuildingType.TypeSawmill) >= d0) return;

  d0 = BOTH(player, BuildingType.TypeLumberjack);
  d1 = sadd(STOCK(player, ResourceType.TypeLumber), 0x20) >> 5;
  d0 = sadd(d0, d1);

  d1 = BOTH(player, BuildingType.TypeSawmill) * 3;
  if (d1 > 0xffff) d1 = 0xffff;
  d1 = wantCurve(d1, d0, 2, 7, 0x801);

  d0 = STOCK(player, ResourceType.TypeLumber);
  if (d0 >= 0x200) d0 = 0x1ff;
  d0 = sadd(d0 << 7, d1);

  SET_WANT(player, BuildingType.TypeSawmill, mulhi(d0, DAMP(player, BuildingType.TypeSawmill)));
}

/* 0x2c4a2: steelsmelter. */
export function wantSteelsmelter(player: Player): void {
  let d0: number;
  let d1: number;

  d0 = W(IDLE_GENERIC(player) + IDLE(player, SerfType.TypeSmelter));
  d1 = W(INCOMPLETE(player, BuildingType.TypeSteelSmelter) +
         INCOMPLETE(player, BuildingType.TypeGoldSmelter));
  if (d1 >= d0) return;

  d0 = min16(BOTH(player, BuildingType.TypeCoalMine), BOTH(player, BuildingType.TypeIronMine));
  d1 = min16(STOCK(player, ResourceType.TypeIronOre), STOCK(player, ResourceType.TypeCoal)) >> 4;
  d0 = W(d0 + d1 + 1) >> 1;

  d1 = BOTH(player, BuildingType.TypeSteelSmelter);
  d1 = wantCurve(d1, d0, 2, 7, 0x801);

  d0 = STOCK(player, ResourceType.TypeIronOre);
  if (d0 >= 0x400) d0 = 0x3ff;
  d0 = sadd(d0 << 6, d1);

  SET_WANT(player, BuildingType.TypeSteelSmelter,
           mulhi(d0, DAMP(player, BuildingType.TypeSteelSmelter)));
}

/* 0x2c532: toolmaker. */
export function wantToolmaker(player: Player): void {
  let d0: number;
  let d1: number;
  let d2: number;
  let i: number;

  d0 = min16(IDLE_GENERIC(player), STOCK(player, ResourceType.TypeSaw));
  d0 = min16(d0, STOCK(player, ResourceType.TypeHammer));
  d0 = W(d0 + IDLE(player, SerfType.TypeToolmaker));
  if (INCOMPLETE(player, BuildingType.TypeToolMaker) >= d0) return;

  /* Highest tool priority. */
  d2 = W(player.toolPrio[0]);
  for (i = 1; i < 9; i++) {
    if (W(player.toolPrio[i]) > d2) d2 = W(player.toolPrio[i]);
  }

  d0 = d2;
  if (BOTH(player, BuildingType.TypeToolMaker) !== 0) {
    d1 = min16(STOCK(player, ResourceType.TypePlank), STOCK(player, ResourceType.TypeSteel));
    d2 = min16(BOTH(player, BuildingType.TypeLumberjack), BOTH(player, BuildingType.TypeIronMine));
    d1 = W(d1 + W(d2 << 4));
    d2 = W(BOTH(player, BuildingType.TypeToolMaker) << 6);
    d1 = (d1 >= d2) ? d1 - d2 : 0;
    if (d1 >= 0x10) d1 = 0xf;
    d0 = mulhi(d0, d1 << 12);
  }

  SET_WANT(player, BuildingType.TypeToolMaker, mulhi(d0, DAMP(player, BuildingType.TypeToolMaker)));
}

/* 0x2c610: weaponsmith. */
export function wantWeaponsmith(player: Player): void {
  let d0: number;
  let d1: number;
  let d2: number;

  d0 = min16(IDLE_GENERIC(player), STOCK(player, ResourceType.TypePincer));
  d0 = min16(d0, STOCK(player, ResourceType.TypeHammer));
  d0 = W(d0 + IDLE(player, SerfType.TypeWeaponSmith));
  if (INCOMPLETE(player, BuildingType.TypeWeaponSmith) >= d0) return;

  d0 = min16(STOCK(player, ResourceType.TypeSword), STOCK(player, ResourceType.TypeShield));
  if (d0 < 0x40) {
    d0 = W(~(d0 << 9));
  } else if (d0 < 0x100) {
    d0 = W(~(d0 << 7) - 0x6000);
  } else if (d0 < 0x500) {
    d0 = W(~(d0 << 3) + 0x2801);
  } else {
    d0 = 0;
  }

  d1 = W(min16(STOCK(player, ResourceType.TypeSteel), STOCK(player, ResourceType.TypeCoal)) + 7);
  d2 = min16(BOTH(player, BuildingType.TypeCoalMine), BOTH(player, BuildingType.TypeIronMine));
  d1 = W(d1 + W(d2 << 3));
  d2 = W(BOTH(player, BuildingType.TypeWeaponSmith) << 4);
  d1 = (d1 >= d2) ? d1 - d2 : 0;
  if (d1 >= 0x10) d1 = 0xf;
  d1 = (d1 << 12) + 0xfa0;
  d0 = mulhi(d0, d1);

  SET_WANT(player, BuildingType.TypeWeaponSmith, mulhi(d0, DAMP(player, BuildingType.TypeWeaponSmith)));
}

/* 0x2c6ce: tower; also the preliminary want of fortress (finished by
   ai_want_fortress). */
export function wantTower(player: Player): void {
  let d0: number;
  let d1: number;

  if (W(player.ai.u_1aa) < 8) return;
  if (incompleteMilitary(player) >= knightsAvailable(player)) {
    return;
  }

  /* Buildings to protect. */
  d0 = W(DONE(player, BuildingType.TypeStoneMine) + DONE(player, BuildingType.TypeCoalMine) +
         DONE(player, BuildingType.TypeIronMine) + DONE(player, BuildingType.TypeGoldMine) +
         DONE(player, BuildingType.TypeFarm) + DONE(player, BuildingType.TypeButcher) +
         DONE(player, BuildingType.TypePigFarm) + DONE(player, BuildingType.TypeBaker) +
         DONE(player, BuildingType.TypeSawmill) + DONE(player, BuildingType.TypeSteelSmelter) +
         DONE(player, BuildingType.TypeToolMaker) + DONE(player, BuildingType.TypeWeaponSmith) +
         DONE(player, BuildingType.TypeGoldSmelter));
  d1 = DONE(player, BuildingType.TypeStock);
  d1 = (d1 < 0x2000 ? d1 : 0x1fff) << 3;
  d0 = sadd(d0, d1);

  /* Large military buildings. */
  d1 = W(DONE(player, BuildingType.TypeFortress) + 1);
  d1 = sadd(d1, d1);
  d1 = sadd(d1, DONE(player, BuildingType.TypeTower));
  if (d1 >= 0x800) d1 = 0x7ff;
  d1 <<= 3;
  d1 = wantCurve(d1, d0, 1, 7, 0x801);

  SET_WANT(player, BuildingType.TypeFortress, d1);
  SET_WANT(player, BuildingType.TypeTower, mulhi(d1, DAMP(player, BuildingType.TypeTower)));
}

/* 0x2c7b2: fortress (want prepared by ai_want_tower). */
export function wantFortress(player: Player): void {
  if (W(player.ai.u_1aa) < 10) return;
  if (incompleteMilitary(player) >= knightsAvailable(player)) {
    SET_WANT(player, BuildingType.TypeFortress, 0);
    return;
  }

  SET_WANT(player, BuildingType.TypeFortress, mulhi(WANT(player, BuildingType.TypeFortress),
                                                    DAMP(player, BuildingType.TypeFortress)));
}

/* 0x2c80e: goldsmelter. */
export function wantGoldsmelter(player: Player): void {
  let d0: number;
  let d1: number;

  d0 = W(IDLE_GENERIC(player) + IDLE(player, SerfType.TypeSmelter));
  d1 = W(INCOMPLETE(player, BuildingType.TypeSteelSmelter) +
         INCOMPLETE(player, BuildingType.TypeGoldSmelter));
  if (d1 >= d0) return;

  d0 = min16(BOTH(player, BuildingType.TypeCoalMine), BOTH(player, BuildingType.TypeGoldMine));
  d1 = min16(STOCK(player, ResourceType.TypeGoldOre), STOCK(player, ResourceType.TypeCoal)) >> 4;
  d0 = W(d0 + d1 + 1) >> 1;

  d1 = BOTH(player, BuildingType.TypeGoldSmelter);
  d1 = wantCurve(d1, d0, 2, 7, 0x801);

  d0 = STOCK(player, ResourceType.TypeGoldOre);
  if (d0 >= 0x400) d0 = 0x3ff;
  d0 = sadd(d0 << 6, d1);

  SET_WANT(player, BuildingType.TypeGoldSmelter, mulhi(d0, DAMP(player, BuildingType.TypeGoldSmelter)));
}

/* 0x2c89e: castle. */
export function wantCastle(player: Player): void {
  let d1: number;

  if (IDLE(player, SerfType.TypeGeologist) !== 0) {
    if (W(IDLE(player, SerfType.TypeTransporter) + IDLE_GENERIC(player)) < 2) return;
  } else {
    const d0 = W((player.totalLandArea >>> 7) + 3);
    if (d0 < W(player.serfCount[SerfType.TypeGeologist])) return;
    if (STOCK(player, ResourceType.TypeHammer) === 0) return;
    if (IDLE_GENERIC(player) === 0) return;
    if (W(IDLE_GENERIC(player) + IDLE(player, SerfType.TypeTransporter)) < 3) return;
  }

  d1 = wantScale(LOC(player, 25));
  if (d1 >= 0x3a98) d1 = 0x3a97;
  d1 <<= 2;

  SET_WANT(player, BuildingType.TypeCastle, mulhi(d1, DAMP(player, BuildingType.TypeCastle)));
}
