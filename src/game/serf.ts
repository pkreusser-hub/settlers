/*
 * serf.ts - Serf related implementation (port of serf.h + serf.cc)
 *
 * Copyright (C) 2013-2019  Jon Lund Steffensen <jonlst@gmail.com>
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

import { BIT, BIT_TEST, ExceptionFreeserf, i32, Log, NOT_REACHED, u16, u32 } from './misc';
import { GameObject } from './objects';
import { ResourceType } from './resource';
import {
  Direction,
  reverseDirection,
  cycleDirectionsCw,
  cycleDirectionsCcw,
} from './map-geometry';
import type { MapPos } from './map-geometry';
import { Map as GameMap, MapObject, MapMinerals, MapSpace, MapTerrain } from './map';
import { BuildingType } from './building';
import type { Building } from './building';
import { FlagSearch } from './flag';
import type { Flag } from './flag';
import type { Inventory } from './inventory';
import { MessageType } from './player';
import type { Game } from './game';
import type { SaveReaderText, SaveWriterText } from './savegame';

export enum SerfType {
  TypeNone = -1,
  TypeTransporter = 0, // 0
  TypeSailor,
  TypeDigger,
  TypeBuilder,
  TypeTransporterInventory,
  TypeLumberjack, // 5
  TypeSawmiller,
  TypeStonecutter,
  TypeForester,
  TypeMiner,
  TypeSmelter, // 10
  TypeFisher,
  TypePigFarmer,
  TypeButcher,
  TypeFarmer,
  TypeMiller, // 15
  TypeBaker,
  TypeBoatBuilder,
  TypeToolmaker,
  TypeWeaponSmith,
  TypeGeologist, // 20
  TypeGeneric,
  TypeKnight0,
  TypeKnight1,
  TypeKnight2,
  TypeKnight3, // 25
  TypeKnight4,
  TypeDead, // 27
}

export type SerfMap = Map<SerfType, number>;

/* The term FREE is used loosely in the following
 names to denote a state where the serf is not
 bound to a road or a flag. */
export enum SerfState {
  StateNull = 0,
  StateIdleInStock,
  StateWalking,
  StateTransporting,
  StateEnteringBuilding,
  StateLeavingBuilding /* 5 */,
  StateReadyToEnter,
  StateReadyToLeave,
  StateDigging,
  StateBuilding,
  StateBuildingCastle /* 10 */,
  StateMoveResourceOut,
  StateWaitForResourceOut,
  StateDropResourceOut,
  StateDelivering,
  StateReadyToLeaveInventory /* 15 */,
  StateFreeWalking,
  StateLogging,
  StatePlanningLogging,
  StatePlanningPlanting,
  StatePlanting /* 20 */,
  StatePlanningStoneCutting,
  StateStoneCutterFreeWalking,
  StateStoneCutting,
  StateSawing,
  StateLost /* 25 */,
  StateLostSailor,
  StateFreeSailing,
  StateEscapeBuilding,
  StateMining,
  StateSmelting /* 30 */,
  StatePlanningFishing,
  StateFishing,
  StatePlanningFarming,
  StateFarming,
  StateMilling /* 35 */,
  StateBaking,
  StatePigFarming,
  StateButchering,
  StateMakingWeapon,
  StateMakingTool /* 40 */,
  StateBuildingBoat,
  StateLookingForGeoSpot,
  StateSamplingGeoSpot,
  StateKnightEngagingBuilding,
  StateKnightPrepareAttacking /* 45 */,
  StateKnightLeaveForFight,
  StateKnightPrepareDefending,
  StateKnightAttacking,
  StateKnightDefending,
  StateKnightAttackingVictory /* 50 */,
  StateKnightAttackingDefeat,
  StateKnightOccupyEnemyBuilding,
  StateKnightFreeWalking,
  StateKnightEngageDefendingFree,
  StateKnightEngageAttackingFree /* 55 */,
  StateKnightEngageAttackingFreeJoin,
  StateKnightPrepareAttackingFree,
  StateKnightPrepareDefendingFree,
  StateKnightPrepareDefendingFreeWait,
  StateKnightAttackingFree /* 60 */,
  StateKnightDefendingFree,
  StateKnightAttackingVictoryFree,
  StateKnightDefendingVictoryFree,
  StateKnightAttackingFreeWait,
  StateKnightLeaveForWalkToFight /* 65 */,
  StateIdleOnPath,
  StateWaitIdleOnPath,
  StateWakeAtFlag,
  StateWakeOnPath,
  StateDefendingHut /* 70 */,
  StateDefendingTower,
  StateDefendingFortress,
  StateScatter,
  StateFinishedBuilding,
  StateDefendingCastle /* 75 */,

  /* Additional state: goes at the end to ease loading of
   original save game. */
  StateKnightAttackingDefeatFree,
}

// PORT: an out parameter (`Direction *dir`, `int *select`) is a one-field
// object the callee writes to.
export interface Ref<T> {
  value: T;
}

// The serf state union `s`.
//
// PORT: the C++ union overlays all variants on the same five 32-bit words,
// and the game relies on that in many places: a state switch usually sets
// only some fields of the new variant and the rest keep whatever the old
// variant left in those words. Each variant is therefore one object, all
// allocated up front and named as in the C++ (`s.walking.dir`), but its
// fields are accessors onto one shared Int32Array laid out as the C++
// structs are (every field is one 32-bit word, in declaration order).
// That makes every cross-variant read behave as in the C++, including the
// ones not marked. Places where the C++ source itself names a variant that
// does not belong to the state at hand are marked `// UNION ALIAS`.
// Fields declared `unsigned int` read back as unsigned.
function makeSerfStateUnion() {
  const w = new Int32Array(5);
  return {
    /* The raw words. */
    w,

    idleInStock: {
      get invIndex(): number { return w[0] >>> 0; } /* E */,
      set invIndex(v: number) { w[0] = v; },
    },

    /* States: walking, transporting, delivering */
    /* res: resource carried (when transporting), otherwise direction. */
    walking: {
      get dir1(): number { return w[0]; } /* B */,
      set dir1(v: number) { w[0] = v; },
      get dest(): number { return w[1] >>> 0; } /* C */,
      set dest(v: number) { w[1] = v; },
      get dir(): number { return w[2]; } /* E */,
      set dir(v: number) { w[2] = v; },
      get waitCounter(): number { return w[3]; } /* F */,
      set waitCounter(v: number) { w[3] = v; },
    },

    /* States: transporting, delivering */
    transporting: {
      get res(): ResourceType { return w[0]; } /* B */,
      set res(v: ResourceType) { w[0] = v; },
      get dest(): number { return w[1] >>> 0; } /* C */,
      set dest(v: number) { w[1] = v; },
      get dir(): number { return w[2]; } /* E */,
      set dir(v: number) { w[2] = v; },
      get waitCounter(): number { return w[3]; } /* F */,
      set waitCounter(v: number) { w[3] = v; },
    },

    enteringBuilding: {
      get fieldB(): number { return w[0]; } /* B */,
      set fieldB(v: number) { w[0] = v; },
      get slopeLen(): number { return w[1]; } /* C */,
      set slopeLen(v: number) { w[1] = v; },
    },

    /* States: leaving_building, ready_to_leave,
       leave_for_fight */
    leavingBuilding: {
      get fieldB(): number { return w[0]; } /* B */,
      set fieldB(v: number) { w[0] = v; },
      get dest(): number { return w[1] >>> 0; } /* C */,
      set dest(v: number) { w[1] = v; },
      get dest2(): number { return w[2]; } /* D */,
      set dest2(v: number) { w[2] = v; },
      get dir(): number { return w[3]; } /* E */,
      set dir(v: number) { w[3] = v; },
      get nextState(): SerfState { return w[4]; } /* F */,
      set nextState(v: SerfState) { w[4] = v; },
    },

    readyToEnter: {
      get fieldB(): number { return w[0]; } /* B */,
      set fieldB(v: number) { w[0] = v; },
    },

    digging: {
      get hIndex(): number { return w[0]; } /* B */,
      set hIndex(v: number) { w[0] = v; },
      get targetH(): number { return w[1] >>> 0; } /* C */,
      set targetH(v: number) { w[1] = v; },
      get digPos(): number { return w[2]; } /* D */,
      set digPos(v: number) { w[2] = v; },
      get substate(): number { return w[3]; } /* E */,
      set substate(v: number) { w[3] = v; },
    },

    /* mode: one of three substates (negative, positive, zero).
       bld_index: index of building. */
    building: {
      get mode(): number { return w[0]; } /* B */,
      set mode(v: number) { w[0] = v; },
      get bldIndex(): number { return w[1] >>> 0; } /* C */,
      set bldIndex(v: number) { w[1] = v; },
      get materialStep(): number { return w[2] >>> 0; } /* E */,
      set materialStep(v: number) { w[2] = v; },
      get counter(): number { return w[3] >>> 0; } /* F */,
      set counter(v: number) { w[3] = v; },
    },

    buildingCastle: {
      get invIndex(): number { return w[0] >>> 0; } /* C */,
      set invIndex(v: number) { w[0] = v; },
    },

    /* States: move_resource_out, drop_resource_out */
    moveResourceOut: {
      get res(): number { return w[0] >>> 0; } /* B */,
      set res(v: number) { w[0] = v; },
      get resDest(): number { return w[1] >>> 0; } /* C */,
      set resDest(v: number) { w[1] = v; },
      get nextState(): SerfState { return w[2]; } /* F */,
      set nextState(v: SerfState) { w[2] = v; },
    },

    /* No state: wait_for_resource_out */

    readyToLeaveInventory: {
      get mode(): number { return w[0]; } /* B */,
      set mode(v: number) { w[0] = v; },
      get dest(): number { return w[1] >>> 0; } /* C */,
      set dest(v: number) { w[1] = v; },
      get invIndex(): number { return w[2] >>> 0; } /* E */,
      set invIndex(v: number) { w[2] = v; },
    },

    /* States: free_walking, logging,
       planting, stonecutting, fishing,
       farming, sampling_geo_spot,
       knight_free_walking,
       knight_attacking_free,
       knight_attacking_free_wait */
    freeWalking: {
      get distCol(): number { return w[0]; } /* B */,
      set distCol(v: number) { w[0] = v; },
      get distRow(): number { return w[1]; } /* C */,
      set distRow(v: number) { w[1] = v; },
      get negDist1(): number { return w[2]; } /* D */,
      set negDist1(v: number) { w[2] = v; },
      get negDist2(): number { return w[3]; } /* E */,
      set negDist2(v: number) { w[3] = v; },
      get flags(): number { return w[4]; } /* F */,
      set flags(v: number) { w[4] = v; },
    },

    /* No state data: planning_logging,
       planning_planting, planning_stonecutting */

    sawing: {
      get mode(): number { return w[0]; } /* B */,
      set mode(v: number) { w[0] = v; },
    },

    lost: {
      get fieldB(): number { return w[0]; } /* B */,
      set fieldB(v: number) { w[0] = v; },
    },

    mining: {
      get substate(): number { return w[0] >>> 0; } /* B */,
      set substate(v: number) { w[0] = v; },
      get res(): number { return w[1]; } /* D */,
      set res(v: number) { w[1] = v; },
      get deposit(): MapMinerals { return w[2]; } /* E */,
      set deposit(v: MapMinerals) { w[2] = v; },
    },

    /* type: Type of smelter (0 is steel, else gold). */
    smelting: {
      get mode(): number { return w[0]; } /* B */,
      set mode(v: number) { w[0] = v; },
      get counter(): number { return w[1]; } /* C */,
      set counter(v: number) { w[1] = v; },
      get type(): number { return w[2] >>> 0; } /* D */,
      set type(v: number) { w[2] = v; },
    },

    /* No state data: planning_fishing,
       planning_farming */

    milling: {
      get mode(): number { return w[0]; } /* B */,
      set mode(v: number) { w[0] = v; },
    },

    baking: {
      get mode(): number { return w[0]; } /* B */,
      set mode(v: number) { w[0] = v; },
    },

    pigfarming: {
      get mode(): number { return w[0]; } /* B */,
      set mode(v: number) { w[0] = v; },
    },

    butchering: {
      get mode(): number { return w[0]; } /* B */,
      set mode(v: number) { w[0] = v; },
    },

    makingWeapon: {
      get mode(): number { return w[0]; } /* B */,
      set mode(v: number) { w[0] = v; },
    },

    makingTool: {
      get mode(): number { return w[0]; } /* B */,
      set mode(v: number) { w[0] = v; },
    },

    buildingBoat: {
      get mode(): number { return w[0]; } /* B */,
      set mode(v: number) { w[0] = v; },
    },

    /* No state data: looking_for_geo_spot */

    /* States: knight_engaging_building,
       knight_prepare_attacking,
       knight_prepare_defending_free_wait,
       knight_attacking_defeat_free,
       knight_attacking,
       knight_attacking_victory,
       knight_engage_attacking_free,
       knight_engage_attacking_free_join,
       knight_attacking_victory_free,
    */
    attacking: {
      get move(): number { return w[0]; } /* B */,
      set move(v: number) { w[0] = v; },
      get attackerWon(): number { return w[1]; } /* C */,
      set attackerWon(v: number) { w[1] = v; },
      get fieldD(): number { return w[2]; } /* D */,
      set fieldD(v: number) { w[2] = v; },
      get defIndex(): number { return w[3]; } /* E */,
      set defIndex(v: number) { w[3] = v; },
    },

    /* States: knight_attacking_victory_free,
     */
    attackingVictoryFree: {
      get move(): number { return w[0]; } /* B */,
      set move(v: number) { w[0] = v; },
      get distCol(): number { return w[1]; } /* C */,
      set distCol(v: number) { w[1] = v; },
      get distRow(): number { return w[2]; } /* D */,
      set distRow(v: number) { w[2] = v; },
      get defIndex(): number { return w[3]; } /* E */,
      set defIndex(v: number) { w[3] = v; },
    },

    /* States: knight_defending_free,
       knight_engage_defending_free */
    defendingFree: {
      get distCol(): number { return w[0]; } /* B */,
      set distCol(v: number) { w[0] = v; },
      get distRow(): number { return w[1]; } /* C */,
      set distRow(v: number) { w[1] = v; },
      get fieldD(): number { return w[2]; } /* D */,
      set fieldD(v: number) { w[2] = v; },
      get otherDistCol(): number { return w[3]; } /* E */,
      set otherDistCol(v: number) { w[3] = v; },
      get otherDistRow(): number { return w[4]; } /* F */,
      set otherDistRow(v: number) { w[4] = v; },
    },

    leaveForWalkToFight: {
      get distCol(): number { return w[0]; } /* B */,
      set distCol(v: number) { w[0] = v; },
      get distRow(): number { return w[1]; } /* C */,
      set distRow(v: number) { w[1] = v; },
      get fieldD(): number { return w[2]; } /* D */,
      set fieldD(v: number) { w[2] = v; },
      get fieldE(): number { return w[3]; } /* E */,
      set fieldE(v: number) { w[3] = v; },
      get nextState(): SerfState { return w[4]; } /* F */,
      set nextState(v: SerfState) { w[4] = v; },
    },

    /* States: idle_on_path, wait_idle_on_path,
       wake_at_flag, wake_on_path. */
    idleOnPath: {
      get flag(): number { return w[0]; } /* C */,
      set flag(v: number) { w[0] = v; },
      get fieldE(): number { return w[1]; } /* E */,
      set fieldE(v: number) { w[1] = v; },
      get revDir(): Direction { return w[2]; } /* B */,
      set revDir(v: Direction) { w[2] = v; },
    },

    /* No state data: finished_building */

    /* States: defending_hut, defending_tower,
       defending_fortress, defending_castle */
    defending: {
      get nextKnight(): number { return w[0]; } /* E */,
      set nextKnight(v: number) { w[0] = v; },
    },
  };
}

export type SerfStateUnion = ReturnType<typeof makeSerfStateUnion>;

const counterFromAnimation: number[] = [
  /* Walking (0-80) */
  511, 447, 383, 319, 255, 319, 511, 767, 1023,
  511, 447, 383, 319, 255, 319, 511, 767, 1023,
  511, 447, 383, 319, 255, 319, 511, 767, 1023,
  511, 447, 383, 319, 255, 319, 511, 767, 1023,
  511, 447, 383, 319, 255, 319, 511, 767, 1023,
  511, 447, 383, 319, 255, 319, 511, 767, 1023,
  511, 447, 383, 319, 255, 319, 511, 767, 1023,
  511, 447, 383, 319, 255, 319, 511, 767, 1023,
  511, 447, 383, 319, 255, 319, 511, 767, 1023,

  /* Waiting (81-86) */
  127, 127, 127, 127, 127, 127,

  /* Digging (87-88) */
  383, 383,

  255, 223, 191, 159, 127, 159, 255, 383, 511,

  /* Building (98) */
  255,

  /* Engage defending free (99) */
  255,

  /* Building large building (100) */
  255,

  0,

  /* Building (102-105) */
  767, 511, 511, 767,

  1023, 639, 639, 1023,

  /* Transporting (turning?) (110-115) */
  63, 63, 63, 63, 63, 63,

  /* Logging (116-120) */
  1023, 31, 767, 767, 255,

  /* Planting (121-122) */
  191, 127,

  /* Stonecutting (123) */
  1535,

  /* Sawing (124) */
  2367,

  /* Mining (125-128) */
  383, 303, 303, 383,

  /* Smelting (129-130) */
  383, 383,

  /* Fishing (131-134) */
  767, 767, 127, 127,

  /* Farming (135-136) */
  1471, 1983,

  /* Milling (137) */
  383,

  /* Baking (138) */
  767,

  /* Pig farming (139) */
  383,

  /* Butchering (140) */
  1535,

  /* Sampling geology (142) */
  783, 63,

  /* Making weapon (143) */
  575,

  /* Making tool (144) */
  1535,

  /* Building boat (145-146) */
  1407, 159,

  /* Attacking (147-156) */
  127, 127, 127, 127, 127, 127, 127, 127, 127, 127,

  /* Defending (157-166) */
  127, 127, 127, 127, 127, 127, 127, 127, 127, 127,

  /* Engage attacking (167) */
  191,

  /* Victory attacking (168) */
  7,

  /* Dying attacking (169-173) */
  255, 255, 255, 255, 255,

  /* Dying defending (174-178) */
  255, 255, 255, 255, 255,

  /* Occupy attacking (179) */
  127,

  /* Victory defending (180) */
  7,
];

const serfStateName: string[] = [
  'NULL', // SERF_STATE_NULL
  'IDLE IN STOCK', // SERF_STATE_IDLE_IN_STOCK
  'WALKING', // SERF_STATE_WALKING
  'TRANSPORTING', // SERF_STATE_TRANSPORTING
  'ENTERING BUILDING', // SERF_STATE_ENTERING_BUILDING
  'LEAVING BUILDING', // SERF_STATE_LEAVING_BUILDING
  'READY TO ENTER', // SERF_STATE_READY_TO_ENTER
  'READY TO LEAVE', // SERF_STATE_READY_TO_LEAVE
  'DIGGING', // SERF_STATE_DIGGING
  'BUILDING', // SERF_STATE_BUILDING
  'BUILDING CASTLE', // SERF_STATE_BUILDING_CASTLE
  'MOVE RESOURCE OUT', // SERF_STATE_MOVE_RESOURCE_OUT
  'WAIT FOR RESOURCE OUT', // SERF_STATE_WAIT_FOR_RESOURCE_OUT
  'DROP RESOURCE OUT', // SERF_STATE_DROP_RESOURCE_OUT
  'DELIVERING', // SERF_STATE_DELIVERING
  'READY TO LEAVE INVENTORY', // SERF_STATE_READY_TO_LEAVE_INVENTORY
  'FREE WALKING', // SERF_STATE_FREE_WALKING
  'LOGGING', // SERF_STATE_LOGGING
  'PLANNING LOGGING', // SERF_STATE_PLANNING_LOGGING
  'PLANNING PLANTING', // SERF_STATE_PLANNING_PLANTING
  'PLANTING', // SERF_STATE_PLANTING
  'PLANNING STONECUTTING', // SERF_STATE_PLANNING_STONECUTTING
  'STONECUTTER FREE WALKING', // SERF_STATE_STONECUTTER_FREE_WALKING
  'STONECUTTING', // SERF_STATE_STONECUTTING
  'SAWING', // SERF_STATE_SAWING
  'LOST', // SERF_STATE_LOST
  'LOST SAILOR', // SERF_STATE_LOST_SAILOR
  'FREE SAILING', // SERF_STATE_FREE_SAILING
  'ESCAPE BUILDING', // SERF_STATE_ESCAPE_BUILDING
  'MINING', // SERF_STATE_MINING
  'SMELTING', // SERF_STATE_SMELTING
  'PLANNING FISHING', // SERF_STATE_PLANNING_FISHING
  'FISHING', // SERF_STATE_FISHING
  'PLANNING FARMING', // SERF_STATE_PLANNING_FARMING
  'FARMING', // SERF_STATE_FARMING
  'MILLING', // SERF_STATE_MILLING
  'BAKING', // SERF_STATE_BAKING
  'PIGFARMING', // SERF_STATE_PIGFARMING
  'BUTCHERING', // SERF_STATE_BUTCHERING
  'MAKING WEAPON', // SERF_STATE_MAKING_WEAPON
  'MAKING TOOL', // SERF_STATE_MAKING_TOOL
  'BUILDING BOAT', // SERF_STATE_BUILDING_BOAT
  'LOOKING FOR GEO SPOT', // SERF_STATE_LOOKING_FOR_GEO_SPOT
  'SAMPLING GEO SPOT', // SERF_STATE_SAMPLING_GEO_SPOT
  'KNIGHT ENGAGING BUILDING', // SERF_STATE_KNIGHT_ENGAGING_BUILDING
  'KNIGHT PREPARE ATTACKING', // SERF_STATE_KNIGHT_PREPARE_ATTACKING
  'KNIGHT LEAVE FOR FIGHT', // SERF_STATE_KNIGHT_LEAVE_FOR_FIGHT
  'KNIGHT PREPARE DEFENDING', // SERF_STATE_KNIGHT_PREPARE_DEFENDING
  'KNIGHT ATTACKING', // SERF_STATE_KNIGHT_ATTACKING
  'KNIGHT DEFENDING', // SERF_STATE_KNIGHT_DEFENDING
  'KNIGHT ATTACKING VICTORY', // SERF_STATE_KNIGHT_ATTACKING_VICTORY
  'KNIGHT ATTACKING DEFEAT', // SERF_STATE_KNIGHT_ATTACKING_DEFEAT
  'KNIGHT OCCUPY ENEMY BUILDING', // SERF_STATE_KNIGHT_OCCUPY_ENEMY_BUILDING
  'KNIGHT FREE WALKING', // SERF_STATE_KNIGHT_FREE_WALKING
  'KNIGHT ENGAGE DEFENDING FREE', // SERF_STATE_KNIGHT_ENGAGE_DEFENDING_FREE
  'KNIGHT ENGAGE ATTACKING FREE', // SERF_STATE_KNIGHT_ENGAGE_ATTACKING_FREE
  'KNIGHT ENGAGE ATTACKING FREE JOIN',
  // SERF_STATE_KNIGHT_ENGAGE_ATTACKING_FREE_JOIN
  'KNIGHT PREPARE ATTACKING FREE', // SERF_STATE_KNIGHT_PREPARE_ATTACKING_FREE
  'KNIGHT PREPARE DEFENDING FREE', // SERF_STATE_KNIGHT_PREPARE_DEFENDING_FREE
  'KNIGHT PREPARE DEFENDING FREE WAIT',
  // SERF_STATE_KNIGHT_PREPARE_DEFENDING_FREE_WAIT
  'KNIGHT ATTACKING FREE', // SERF_STATE_KNIGHT_ATTACKING_FREE
  'KNIGHT DEFENDING FREE', // SERF_STATE_KNIGHT_DEFENDING_FREE
  'KNIGHT ATTACKING VICTORY FREE', // SERF_STATE_KNIGHT_ATTACKING_VICTORY_FREE
  'KNIGHT DEFENDING VICTORY FREE', // SERF_STATE_KNIGHT_DEFENDING_VICTORY_FREE
  'KNIGHT ATTACKING FREE WAIT', // SERF_STATE_KNIGHT_ATTACKING_FREE_WAIT
  'KNIGHT LEAVE FOR WALK TO FIGHT',
  // SERF_STATE_KNIGHT_LEAVE_FOR_WALK_TO_FIGHT
  'IDLE ON PATH', // SERF_STATE_IDLE_ON_PATH
  'WAIT IDLE ON PATH', // SERF_STATE_WAIT_IDLE_ON_PATH
  'WAKE AT FLAG', // SERF_STATE_WAKE_AT_FLAG
  'WAKE ON PATH', // SERF_STATE_WAKE_ON_PATH
  'DEFENDING HUT', // SERF_STATE_DEFENDING_HUT
  'DEFENDING TOWER', // SERF_STATE_DEFENDING_TOWER
  'DEFENDING FORTRESS', // SERF_STATE_DEFENDING_FORTRESS
  'SCATTER', // SERF_STATE_SCATTER
  'FINISHED BUILDING', // SERF_STATE_FINISHED_BUILDING
  'DEFENDING CASTLE', // SERF_STATE_DEFENDING_CASTLE
  'KNIGHT ATTACKING DEFEAT FREE', // SERF_STATE_KNIGHT_ATTACKING_DEFEAT_FREE
];

const serfTypeName: string[] = [
  'TRANSPORTER', // SERF_TRANSPORTER = 0,
  'SAILOR', // SERF_SAILOR,
  'DIGGER', // SERF_DIGGER,
  'BUILDER', // SERF_BUILDER,
  'TRANSPORTER_INVENTORY', // SERF_TRANSPORTER_INVENTORY,
  'LUMBERJACK', // SERF_LUMBERJACK,
  'SAWMILLER', // TypeSawmiller,
  'STONECUTTER', // TypeStonecutter,
  'FORESTER', // TypeForester,
  'MINER', // TypeMiner,
  'SMELTER', // TypeSmelter,
  'FISHER', // TypeFisher,
  'PIGFARMER', // TypePigFarmer,
  'BUTCHER', // TypeButcher,
  'FARMER', // TypeFarmer,
  'MILLER', // TypeMiller,
  'BAKER', // TypeBaker,
  'BOATBUILDER', // TypeBoatBuilder,
  'TOOLMAKER', // TypeToolmaker,
  'WEAPONSMITH', // TypeWeaponSmith,
  'GEOLOGIST', // TypeGeologist,
  'GENERIC', // TypeGeneric,
  'KNIGHT_0', // TypeKnight0,
  'KNIGHT_1', // TypeKnight1,
  'KNIGHT_2', // TypeKnight2,
  'KNIGHT_3', // TypeKnight3,
  'KNIGHT_4', // TypeKnight4,
  'DEAD', // TypeDead
];

const roadBuildingSlope: number[] = [
  /* Finished building */
  5, 18, 18, 15, 18, 22, 22, 22,
  22, 18, 16, 18, 1, 10, 1, 15,
  15, 16, 15, 15, 10, 15, 20, 15,
  18,
];

// C++ `bool * int` in the free walking offset computations.
const b2i = (b: boolean): number => (b ? 1 : 0);

export class Serf extends GameObject {
  static Type = SerfType;
  static State = SerfState;

  /* The computer player reads the fields as the original does. */
  /* The consistency check after loading reads them too. */
  // PORT: `protected` with `friend class AI` / `friend class IntegrityCheck`
  // in the C++; public here because TS has no friends.
  owner: number;
  type: SerfType;
  sound: boolean;
  animation: number; /* Index to animation table in data file. */
  counter: number;
  pos: MapPos;
  tick: number; /* uint16_t */
  state: SerfState;

  s: SerfStateUnion;

  constructor(game: Game, index: number) {
    super(game, index);
    this.state = SerfState.StateNull;
    this.owner = u32(-1);
    this.type = SerfType.TypeNone;
    this.sound = false;
    this.animation = 0;
    this.counter = 0;
    this.pos = u32(-1);
    this.tick = 0;
    this.s = makeSerfStateUnion();
  }

  // #define set_state(new_state)
  // PORT: the C++ macro also logs __FUNCTION__ and __LINE__.
  protected setState(newState: SerfState): void {
    if (Log.verbose) {
      Log.Verbose('serf', 'serf ' + this.index +
                  ' (' + Serf.getTypeName(this.getType()) + '): ' +
                  'state ' + Serf.getStateName(this.state) +
                  ' -> ' + Serf.getStateName(newState));
    }
    this.state = newState;
  }

  // #define set_other_state(other_serf, new_state)
  protected setOtherState(otherSerf: Serf, newState: SerfState): void {
    if (Log.verbose) {
      Log.Verbose('serf', 'serf ' + otherSerf.index +
                  ' (' + Serf.getTypeName(otherSerf.getType()) +
                  '): state ' +
                  Serf.getStateName(otherSerf.state) +
                  ' -> ' + Serf.getStateName(newState));
    }
    otherSerf.state = newState;
  }

  getOwner(): number { return this.owner; }
  setOwner(playerNum: number): void { this.owner = u32(playerNum); }

  getType(): SerfType { return this.type; }

  playingSfx(): boolean { return this.sound; }
  startPlayingSfx(): void { this.sound = true; }
  stopPlayingSfx(): void { this.sound = false; }

  getState(): SerfState { return this.state; }
  getAnimation(): number { return this.animation; }
  getCounter(): number { return this.counter; }

  getPos(): MapPos { return this.pos; }

  getFreeWalkingNegDist1(): number { return this.s.freeWalking.negDist1; }
  getFreeWalkingNegDist2(): number { return this.s.freeWalking.negDist2; }
  getLeavingBuildingNextState(): number {
    return this.s.leavingBuilding.nextState; }
  getLeavingBuildingFieldB(): number {
    return this.s.leavingBuilding.fieldB; }
  getMiningRes(): number { return this.s.mining.res; }
  getAttackingFieldD(): number { return this.s.attacking.fieldD; }
  getAttackingDefIndex(): number { return this.s.attacking.defIndex; }
  /* The packed words of the states stay one word each, as in the
     original: the states share their memory (see Serf::s). */
  /* Building: the step of the materials (bits 0..3), a tall building
     (bit 7, the builder on the scaffold). */
  getBuildingMaterialStep(): number {
    return this.s.building.materialStep & 0xf; }
  isBuildingTall(): boolean {
    return (this.s.building.materialStep & BIT(7)) !== 0; }
  setBuildingTall(): void { this.s.building.materialStep |= BIT(7); }
  /* Free walking around an obstacle: the direction index + 1 (bits 0..2, 0
     none), along the left edge (bit 3), the turns (bits 4..7). */
  getObstacleDirIndex(): number { return this.s.freeWalking.flags & 7; }
  isObstacleLeftEdge(): boolean {
    return (this.s.freeWalking.flags & BIT(3)) !== 0; }
  getObstacleTurns(): number { return (this.s.freeWalking.flags >> 4) & 0xf; }
  setObstacle(turns: number, leftEdge: boolean, dirIndex: number): void {
    this.s.freeWalking.flags = (turns << 4) | (leftEdge ? BIT(3) : 0) |
                               dirIndex; }
  clearObstacle(): void { this.s.freeWalking.flags = 0; }
  /* Fishing: the same word counts the attempts. */
  getFishingAttempts(): number { return this.s.freeWalking.flags; }
  resetFishingAttempts(): void { this.s.freeWalking.flags = 0; }
  countFishingAttempt(): void { this.s.freeWalking.flags += 1; }

  getWalkingWaitCounter(): number { return this.s.walking.waitCounter; }
  setWalkingWaitCounter(newCounter: number): void {
    this.s.walking.waitCounter = newCounter; }
  getWalkingDir(): number { return this.s.walking.dir; }
  getIdleInStockInvIndex(): number {
                                     return this.s.idleInStock.invIndex; }
  getMiningSubstate(): number { return this.s.mining.substate; }

  getNext(): number { return this.s.defending.nextKnight >>> 0; }
  setNext(next: number): void { this.s.defending.nextKnight = next; }

  // EXT: the building this knight defends was upgraded in place
  // (Building::finishUpgrade): he defends, and trains, as a knight of the
  // new type. False if he is not in a defending state (the list of the
  // building ends there).
  defendedBuildingUpgraded(type: BuildingType): boolean {
    if (this.state !== SerfState.StateDefendingHut &&
        this.state !== SerfState.StateDefendingTower &&
        this.state !== SerfState.StateDefendingFortress) {
      return false;
    }
    switch (type) {
      case BuildingType.TypeTower:
        this.setState(SerfState.StateDefendingTower);
        break;
      case BuildingType.TypeFortress:
        this.setState(SerfState.StateDefendingFortress);
        break;
      default:
        break;
    }
    return true;
  }

  // EXT: whether the building this worker stands in is paused or capped
  // (Building::isProductionHeld): he starts no new round of work then.
  protected workHeld(): boolean {
    const building = this.game.getBuildingAtPos(this.pos);
    return building != null && building.isProductionHeld();
  }

  // EXT: a worker who plans his next walk in a held building waits. The
  // tick is kept current so that no time piles up for the counter.
  protected planningHeld(): boolean {
    if (!this.workHeld()) return false;
    this.tick = u16(this.game.getTick());
    return true;
  }

  static getStateName(state: SerfState): string {
    return serfStateName[state];
  }

  static getTypeName(type: SerfType): string {
    return serfTypeName[type];
  }

  /* Change type of serf and update all global tables
     tracking serf types. */
  setType(newType: SerfType): void {
    if (newType === this.type) {
      return;
    }

    let oldType = this.type;
    this.type = newType;

    /* Register this type as transporter */
    if (newType === SerfType.TypeTransporterInventory) newType = SerfType.TypeTransporter;
    if (oldType === SerfType.TypeTransporterInventory) oldType = SerfType.TypeTransporter;

    const player = this.game.getPlayer(this.getOwner())!;
    if (oldType !== SerfType.TypeNone && oldType !== SerfType.TypeDead) {
      player.decreaseSerfCount(oldType);
    }
    if (this.type !== SerfType.TypeDead) {
      player.increaseSerfCount(newType);
    }

    if (oldType >= SerfType.TypeKnight0 &&
        oldType <= SerfType.TypeKnight4) {
      const value = 1 << (oldType - SerfType.TypeKnight0);
      player.decreaseMilitaryScore(value);
    }
    if (newType >= SerfType.TypeKnight0 &&
        newType <= SerfType.TypeKnight4) {
      const value = 1 << (this.type - SerfType.TypeKnight0);
      player.increaseMilitaryScore(value);
    }
    if (newType === SerfType.TypeTransporter) {
      this.counter = 0;
    }
  }

  addToDefendingQueue(nextKnightIndex: number, pause: boolean): void {
    this.setState(SerfState.StateDefendingCastle);
    this.s.defending.nextKnight = nextKnightIndex;
    if (pause) {
      this.counter = 6000;
    }
  }

  /* A knight of the building's owner, defending it from the start (Amiga
     tutorial_build_military_building @0x4b58). */
  initDefendingKnight(building: Building): void {
    this.setOwner(building.getOwner());
    this.setType(SerfType.TypeKnight0);
    this.pos = building.getPosition();
    this.tick = u16(this.game.getTick());
    this.counter = 6000;
    switch (building.getType()) {
      case BuildingType.TypeHut:
        this.setState(SerfState.StateDefendingHut);
        break;
      case BuildingType.TypeTower:
        this.setState(SerfState.StateDefendingTower);
        break;
      case BuildingType.TypeFortress:
        this.setState(SerfState.StateDefendingFortress);
        break;
      default:
        NOT_REACHED();
        break;
    }
    this.s.defending.nextKnight = building.getFirstKnight();
  }

  initGeneric(inventory: Inventory): void {
    this.setType(SerfType.TypeGeneric);
    this.setOwner(inventory.getOwner());
    const building = this.game.getBuilding(inventory.getBuildingIndex())!;
    this.pos = building.getPosition();
    this.tick = u16(this.game.getTick());
    this.state = SerfState.StateIdleInStock;
    this.s.idleInStock.invIndex = inventory.getIndex();
  }

  initInventoryTransporter(inventory: Inventory): void {
    this.setState(SerfState.StateBuildingCastle);
    this.s.buildingCastle.invIndex = inventory.getIndex();
  }

  resetTransport(flag: Flag): void {
    if (this.state === SerfState.StateWalking && this.s.walking.dest === flag.getIndex() &&
        this.s.walking.dir1 < 0) {
      this.s.walking.dir1 = -2;
      this.s.walking.dest = 0;
    } else if (this.state === SerfState.StateReadyToLeaveInventory &&
               this.s.readyToLeaveInventory.dest === flag.getIndex() &&
               this.s.readyToLeaveInventory.mode < 0) {
      this.s.readyToLeaveInventory.mode = -2;
      this.s.readyToLeaveInventory.dest = 0;
    } else if ((this.state === SerfState.StateLeavingBuilding || this.state === SerfState.StateReadyToLeave) &&
               this.s.leavingBuilding.nextState === SerfState.StateWalking &&
               this.s.leavingBuilding.dest === flag.getIndex() &&
               this.s.leavingBuilding.fieldB < 0) {
      this.s.leavingBuilding.fieldB = -2;
      this.s.leavingBuilding.dest = 0;
    } else if (this.state === SerfState.StateTransporting &&
               this.s.walking.dest === flag.getIndex()) {  // UNION ALIAS (walking.dest is transporting.dest)
      this.s.walking.dest = 0;
    } else if (this.state === SerfState.StateMoveResourceOut &&
               this.s.moveResourceOut.nextState === SerfState.StateDropResourceOut &&
               this.s.moveResourceOut.resDest === flag.getIndex()) {
      this.s.moveResourceOut.resDest = 0;
    } else if (this.state === SerfState.StateDropResourceOut &&
               this.s.moveResourceOut.resDest === flag.getIndex()) {
      this.s.moveResourceOut.resDest = 0;
    } else if (this.state === SerfState.StateLeavingBuilding &&
               this.s.leavingBuilding.nextState === SerfState.StateDropResourceOut &&
               this.s.leavingBuilding.dest === flag.getIndex()) {
      this.s.leavingBuilding.dest = 0;
    }
  }

  pathSplited(flag1: number, dir1: Direction,
              flag2: number, dir2: Direction,
              select: Ref<number>): boolean {
    if (this.state === SerfState.StateWalking) {
      if (this.s.walking.dest === flag1 && this.s.walking.dir1 === dir1) {
        select.value = 0;
        return true;
      } else if (this.s.walking.dest === flag2 && this.s.walking.dir1 === dir2) {
        select.value = 1;
        return true;
      }
    } else if (this.state === SerfState.StateReadyToLeaveInventory) {
      if (this.s.readyToLeaveInventory.dest === flag1 &&
          this.s.readyToLeaveInventory.mode === dir1) {
        select.value = 0;
        return true;
      } else if (this.s.readyToLeaveInventory.dest === flag2 &&
                 this.s.readyToLeaveInventory.mode === dir2) {
        select.value = 1;
        return true;
      }
    } else if ((this.state === SerfState.StateReadyToLeave || this.state === SerfState.StateLeavingBuilding) &&
               this.s.leavingBuilding.nextState === SerfState.StateWalking) {
      if (this.s.leavingBuilding.dest === flag1 &&
          this.s.leavingBuilding.fieldB === dir1) {
        select.value = 0;
        return true;
      } else if (this.s.leavingBuilding.dest === flag2 &&
                 this.s.leavingBuilding.fieldB === dir2) {
        select.value = 1;
        return true;
      }
    }

    return false;
  }

  isRelatedTo(dest: number, dir: Direction): boolean {
    let result = false;

    switch (this.state) {
      case SerfState.StateWalking:
        if (this.s.walking.dest === dest && this.s.walking.dir1 === dir) {
          result = true;
        }
        break;
      case SerfState.StateReadyToLeaveInventory:
        if (this.s.readyToLeaveInventory.dest === dest &&
            this.s.readyToLeaveInventory.mode === dir) {
          result = true;
        }
        break;
      case SerfState.StateLeavingBuilding:
      case SerfState.StateReadyToLeave:
        if (this.s.leavingBuilding.dest === dest &&
            this.s.leavingBuilding.fieldB === dir &&
            this.s.leavingBuilding.nextState === SerfState.StateWalking) {
          result = true;
        }
        break;
      default:
        break;
    }

    return result;
  }

  pathDeleted(dest: number, dir: Direction): void {
    switch (this.state) {
      case SerfState.StateWalking:
        if (this.s.walking.dest === dest && this.s.walking.dir1 === dir) {
          this.s.walking.dir1 = -2;
          this.s.walking.dest = 0;
        }
        break;
      case SerfState.StateReadyToLeaveInventory:
        if (this.s.readyToLeaveInventory.dest === dest &&
            this.s.readyToLeaveInventory.mode === dir) {
          this.s.readyToLeaveInventory.mode = -2;
          this.s.readyToLeaveInventory.dest = 0;
        }
        break;
      case SerfState.StateLeavingBuilding:
      case SerfState.StateReadyToLeave:
        if (this.s.leavingBuilding.dest === dest &&
            this.s.leavingBuilding.fieldB === dir &&
            this.s.leavingBuilding.nextState === SerfState.StateWalking) {
          this.s.leavingBuilding.fieldB = -2;
          this.s.leavingBuilding.dest = 0;
        }
        break;
      default:
        break;
    }
  }

  pathMerged(flag: Flag): void {
    if (this.state === SerfState.StateReadyToLeaveInventory &&
        this.s.readyToLeaveInventory.dest === flag.getIndex()) {
      this.s.readyToLeaveInventory.dest = 0;
      this.s.readyToLeaveInventory.mode = -2;
    } else if (this.state === SerfState.StateWalking && this.s.walking.dest === flag.getIndex()) {
      this.s.walking.dest = 0;
      this.s.walking.dir1 = -2;
    } else if (this.state === SerfState.StateIdleInStock && 1/*...*/) {
      /* TODO */
    } else if ((this.state === SerfState.StateLeavingBuilding || this.state === SerfState.StateReadyToLeave) &&
             this.s.leavingBuilding.dest === flag.getIndex() &&
             this.s.leavingBuilding.nextState === SerfState.StateWalking) {
      this.s.leavingBuilding.dest = 0;
      this.s.leavingBuilding.fieldB = -2;
    }
  }

  /* The road under the serf now leaves in new_dir instead of old_dir. */
  pathRerouted(oldDir: number, newDir: number): void {
    if (this.state !== SerfState.StateWalking && this.state !== SerfState.StateTransporting) {
      return;
    }

    // UNION ALIAS (walking.dir is transporting.dir)
    if (this.s.walking.dir === oldDir) {
      this.s.walking.dir = newDir;
    } else if (this.s.walking.dir === oldDir - 6) {
      /* Waiting to move in old_dir. */
      this.s.walking.dir = newDir - 6;
    }
  }

  pathMerged2(flag1: number, dir1: Direction,
              flag2: number, dir2: Direction): void {
    if (this.state === SerfState.StateReadyToLeaveInventory &&
        ((this.s.readyToLeaveInventory.dest === flag1 &&
          this.s.readyToLeaveInventory.mode === dir1) ||
         (this.s.readyToLeaveInventory.dest === flag2 &&
          this.s.readyToLeaveInventory.mode === dir2))) {
      this.s.readyToLeaveInventory.dest = 0;
      this.s.readyToLeaveInventory.mode = -2;
    } else if (this.state === SerfState.StateWalking &&
               ((this.s.walking.dest === flag1 && this.s.walking.dir1 === dir1) ||
                (this.s.walking.dest === flag2 && this.s.walking.dir1 === dir2))) {
      this.s.walking.dest = 0;
      this.s.walking.dir1 = -2;
    } else if (this.state === SerfState.StateIdleInStock) {
      /* TODO */
    } else if ((this.state === SerfState.StateLeavingBuilding || this.state === SerfState.StateReadyToLeave) &&
               ((this.s.leavingBuilding.dest === flag1 &&
                 this.s.leavingBuilding.fieldB === dir1) ||
                (this.s.leavingBuilding.dest === flag2 &&
                 this.s.leavingBuilding.fieldB === dir2)) &&
               this.s.leavingBuilding.nextState === SerfState.StateWalking) {
      this.s.leavingBuilding.dest = 0;
      this.s.leavingBuilding.fieldB = -2;
    }
  }

  flagDeleted(flagPos: MapPos): void {
    switch (this.state) {
      case SerfState.StateReadyToLeave:
      case SerfState.StateLeavingBuilding:
        this.s.leavingBuilding.nextState = SerfState.StateLost;
        break;
      case SerfState.StateFinishedBuilding:
      case SerfState.StateWalking:
        if (this.game.getMap().paths(flagPos) === 0) {
          this.setState(SerfState.StateLost);
        }
        break;
      default:
        break;
    }
  }

  buildingDeleted(buildingPos: MapPos, escape: boolean): boolean {
    if (this.pos === buildingPos &&
        (this.state === SerfState.StateIdleInStock || this.state === SerfState.StateReadyToLeaveInventory)) {
      if (escape) {
        /* Serf is escaping. */
        this.state = SerfState.StateEscapeBuilding;
      } else {
        /* Kill this serf. */
        this.setType(SerfType.TypeDead);
        this.game.deleteSerf(this);
      }
      return true;
    }

    return false;
  }

  castleDeleted(castlePos: MapPos, transporter: boolean): void {
    if ((!transporter || (this.getType() === SerfType.TypeTransporterInventory)) &&
        this.pos === castlePos) {
      if (transporter) {
        this.setType(SerfType.TypeTransporter);
      }
    }

    this.counter = 0;

    if (this.game.getMap().getSerfIndex(this.pos) === this.index) {
      this.setState(SerfState.StateLost);
      this.s.lost.fieldB = 0;
    } else {
      this.setState(SerfState.StateEscapeBuilding);
    }
  }

  changeTransporterStateAtPos(pos_: MapPos, _state: SerfState): boolean {
    /* Only the transporter resting on this road may change; check the
       current state, not the new one. */
    if (this.pos === pos_ &&
        (this.state === SerfState.StateWakeAtFlag || this.state === SerfState.StateWakeOnPath ||
         this.state === SerfState.StateWaitIdleOnPath || this.state === SerfState.StateIdleOnPath)) {
      this.setState(_state);
      return true;
    }
    return false;
  }

  restorePathSerfInfo(): void {
    if (this.state !== SerfState.StateWakeOnPath) {
      // UNION ALIAS: the caller has just put the serf in a transporting
      // state, the words still hold what the idle_on_path variant left
      // (transporting.res is idle_on_path.flag, transporting.dest is
      // idle_on_path.field_E).
      this.s.transporting.waitCounter = -1;
      if (this.s.transporting.res !== ResourceType.TypeNone) {
        const res = this.s.transporting.res;
        this.s.transporting.res = ResourceType.TypeNone;

        this.game.cancelTransportedResource(res, this.s.transporting.dest);
        this.game.loseResource(res);
      }
    } else {
      this.setState(SerfState.StateWakeAtFlag);
    }
  }

  clearDestination(dest: number): void {
    switch (this.state) {
      case SerfState.StateWalking:
        if (this.s.walking.dest === dest && this.s.walking.dir1 < 0) {
          this.s.walking.dir1 = -2;
          this.s.walking.dest = 0;
        }
        break;
      case SerfState.StateReadyToLeaveInventory:
        if (this.s.readyToLeaveInventory.dest === dest &&
            this.s.readyToLeaveInventory.mode < 0) {
          this.s.readyToLeaveInventory.mode = -2;
          this.s.readyToLeaveInventory.dest = 0;
        }
        break;
      case SerfState.StateLeavingBuilding:
      case SerfState.StateReadyToLeave:
        if (this.s.leavingBuilding.dest === dest &&
            this.s.leavingBuilding.fieldB < 0 &&
            this.s.leavingBuilding.nextState === SerfState.StateWalking) {
          this.s.leavingBuilding.fieldB = -2;
          this.s.leavingBuilding.dest = 0;
        }
        break;
      default:
        break;
    }
  }

  clearDestination2(dest: number): void {
    switch (this.state) {
      case SerfState.StateTransporting:
        // UNION ALIAS (walking.dest is transporting.dest)
        if (this.s.walking.dest === dest) {
          this.s.walking.dest = 0;
        }
        break;
      case SerfState.StateDropResourceOut:
        if (this.s.moveResourceOut.resDest === dest) {
          this.s.moveResourceOut.resDest = 0;
        }
        break;
      case SerfState.StateLeavingBuilding:
        if (this.s.leavingBuilding.dest === dest &&
            this.s.leavingBuilding.nextState === SerfState.StateDropResourceOut) {
          this.s.leavingBuilding.dest = 0;
        }
        break;
      case SerfState.StateMoveResourceOut:
        if (this.s.moveResourceOut.resDest === dest &&
            this.s.moveResourceOut.nextState === SerfState.StateDropResourceOut) {
          this.s.moveResourceOut.resDest = 0;
        }
        break;
      default:
        break;
    }
  }

  idleToWaitState(pos_: MapPos): boolean {
    if (this.pos === pos_ &&
        (this.getState() === SerfState.StateIdleOnPath || this.getState() === SerfState.StateWaitIdleOnPath ||
         this.getState() === SerfState.StateWakeAtFlag || this.getState() === SerfState.StateWakeOnPath)) {
      this.setState(SerfState.StateWakeAtFlag);
      return true;
    }
    return false;
  }

  getDelivery(): number {
    let res = 0;

    switch (this.state) {
      case SerfState.StateDelivering:
      case SerfState.StateTransporting:
        res = this.s.transporting.res + 1;
        break;
      case SerfState.StateEnteringBuilding:
        res = this.s.enteringBuilding.fieldB;
        break;
      case SerfState.StateLeavingBuilding:
        res = this.s.leavingBuilding.fieldB;
        break;
      case SerfState.StateReadyToEnter:
        res = this.s.readyToEnter.fieldB;
        break;
      case SerfState.StateMoveResourceOut:
      case SerfState.StateDropResourceOut:
        res = this.s.moveResourceOut.res | 0;
        break;

      default:
        break;
    }

    return res;
  }

  extractLastKnightFromList(): Serf {
    // PORT: `int *def_index` points at the local serf_index first and then
    // at the next_knight field of the previous knight in the list; here the
    // previous knight is kept instead (null while it is the local).
    let serfIndex = this.index;
    let prevSerf: Serf | null = null;
    let defSerf = this.game.getSerf(serfIndex)!;
    while (defSerf.s.defending.nextKnight !== 0) {
      prevSerf = defSerf;
      defSerf = this.game.getSerf(prevSerf.s.defending.nextKnight)!;
    }
    if (prevSerf !== null) {
      prevSerf.s.defending.nextKnight = 0;
    } else {
      serfIndex = 0;
    }

    return defSerf;
  }

  insertBefore(knight: Serf): void {
    this.s.defending.nextKnight = knight.getIndex();
  }

  // Commands
  goOutFromInventory(inventory: number, dest: MapPos, mode: number): void {
    this.setState(SerfState.StateReadyToLeaveInventory);
    this.s.readyToLeaveInventory.mode = mode;
    this.s.readyToLeaveInventory.dest = dest;
    this.s.readyToLeaveInventory.invIndex = inventory;
  }

  sendOffToFight(distCol: number, distRow: number): void {
    /* Send this serf off to fight. */
    this.setState(SerfState.StateKnightLeaveForWalkToFight);
    this.s.leaveForWalkToFight.distCol = distCol;
    this.s.leaveForWalkToFight.distRow = distRow;
    this.s.leaveForWalkToFight.fieldD = 0;
    this.s.leaveForWalkToFight.fieldE = 0;
    this.s.leaveForWalkToFight.nextState = SerfState.StateKnightFreeWalking;
  }

  stayIdleInStock(inventory: number): void {
    this.setState(SerfState.StateIdleInStock);
    this.s.idleInStock.invIndex = inventory;
  }

  goOutFromBuilding(dest: MapPos, dir: number, fieldB: number): void {
    this.setState(SerfState.StateReadyToLeave);
    this.s.leavingBuilding.fieldB = fieldB;
    this.s.leavingBuilding.dest = dest;
    this.s.leavingBuilding.dir = dir;
    this.s.leavingBuilding.nextState = SerfState.StateWalking;
  }

  /* Change serf state to lost, but make necessary clean up
     from any earlier state first. */
  setLostState(): void {
    if (this.state === SerfState.StateWalking) {
      if (this.s.walking.dir1 >= 0) {
        if (this.s.walking.dir1 !== 6) {
          const dir = this.s.walking.dir1 as Direction;
          const flag = this.game.getFlag(this.s.walking.dest)!;
          flag.cancelSerfRequest(dir);

          const otherDir = flag.getOtherEndDir(dir);
          flag.getOtherEndFlag(dir)!.cancelSerfRequest(otherDir);
        }
      } else if (this.s.walking.dir1 === -1) {
        const flag = this.game.getFlag(this.s.walking.dest)!;
        const building = flag.getBuilding()!;
        building.requestedSerfLost();
      }

      this.setState(SerfState.StateLost);
      this.s.lost.fieldB = 0;
    } else if (this.state === SerfState.StateTransporting || this.state === SerfState.StateDelivering) {
      if (this.s.transporting.res !== ResourceType.TypeNone) {
        const res = this.s.transporting.res;
        const dest = this.s.walking.dest | 0;  // UNION ALIAS (walking.dest is transporting.dest)

        this.game.cancelTransportedResource(res, dest);
        this.game.loseResource(res);
      }

      if (this.getType() !== SerfType.TypeSailor) {
        this.setState(SerfState.StateLost);
        this.s.lost.fieldB = 0;
      } else {
        this.setState(SerfState.StateLostSailor);
      }
    } else {
      this.setState(SerfState.StateLost);
      this.s.lost.fieldB = 0;
    }
  }

  /* Return true if serf is waiting for a position to be available.
     In this case, dir will be set to the desired direction of the serf,
     or DirectionNone if the desired direction cannot be determined. */
  protected isWaiting(dir: Ref<Direction>): boolean {
    const dirFromOffset: Direction[] = [
      Direction.DirectionUpLeft, Direction.DirectionUp,   Direction.DirectionNone,
      Direction.DirectionLeft,   Direction.DirectionNone, Direction.DirectionRight,
      Direction.DirectionNone,   Direction.DirectionDown, Direction.DirectionDownRight,
    ];

    if ((this.state === SerfState.StateTransporting || this.state === SerfState.StateWalking ||
         this.state === SerfState.StateDelivering) &&
        this.s.walking.dir < 0) {  // UNION ALIAS (walking.dir is transporting.dir)
      dir.value = (this.s.walking.dir + 6) as Direction;
      return true;
    } else if ((this.state === SerfState.StateFreeWalking ||
                this.state === SerfState.StateKnightFreeWalking ||
                this.state === SerfState.StateStoneCutterFreeWalking) &&
               this.animation === 82) {
      const dx = this.s.freeWalking.distCol;
      const dy = this.s.freeWalking.distRow;

      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 &&
          dirFromOffset[(dx+1) + 3*(dy+1)] > Direction.DirectionNone) {
        dir.value = dirFromOffset[(dx+1) + 3*(dy+1)];
      } else {
        dir.value = Direction.DirectionNone;
      }
      return true;
    } else if (this.state === SerfState.StateDigging && this.s.digging.substate < 0) {
      const d = this.s.digging.digPos;
      dir.value = ((d === 0) ? Direction.DirectionUp : 6-d) as Direction;
      return true;
    }

    return false;
  }

  /* Signal waiting serf that it is possible to move in direction
     while switching position with another serf. Returns 0 if the
     switch is not acceptable. */
  protected switchWaiting(dir: Direction): number {
    if ((this.state === SerfState.StateTransporting || this.state === SerfState.StateWalking ||
         this.state === SerfState.StateDelivering) &&
        this.s.walking.dir < 0) {  // UNION ALIAS (walking.dir is transporting.dir)
      this.s.walking.dir = reverseDirection(dir);
      return 1;
    } else if ((this.state === SerfState.StateFreeWalking ||
                this.state === SerfState.StateKnightFreeWalking ||
                this.state === SerfState.StateStoneCutterFreeWalking) &&
               this.animation === 82) {
      const dx = ((dir < 3) ? 1 : -1)*b2i((dir % 3) < 2);
      const dy = ((dir < 3) ? 1 : -1)*b2i((dir % 3) > 0);

      this.s.freeWalking.distCol -= dx;
      this.s.freeWalking.distRow -= dy;

      if (this.s.freeWalking.distCol === 0 && this.s.freeWalking.distRow === 0) {
        /* Arriving to destination */
        this.setObstacle(0, true, 0);
      }
      return 1;
    } else if (this.state === SerfState.StateDigging && this.s.digging.substate < 0) {
      return 0;
    }

    return 0;
  }

  trainKnight(p: number): number {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    while (this.counter < 0) {
      if (this.game.randomInt() < p) {
        /* Level up */
        const oldType = this.getType();
        this.setType((oldType + 1) as SerfType);
        this.counter = 6000;
        return 0;
      }
      this.counter += 6000;
    }

    return -1;
  }

  protected handleSerfIdleInStockState(): void {
    const inventory = this.game.getInventory(this.s.idleInStock.invIndex)!;

    if (inventory.getSerfMode() === 0
        || inventory.getSerfMode() === 1 /* in, stop */
        || inventory.getSerfQueueLength() >= 3) {
      switch (this.getType()) {
        case SerfType.TypeKnight0:
          inventory.knightTraining(this, 4000);
          break;
        case SerfType.TypeKnight1:
          inventory.knightTraining(this, 2000);
          break;
        case SerfType.TypeKnight2:
          inventory.knightTraining(this, 1000);
          break;
        case SerfType.TypeKnight3:
          inventory.knightTraining(this, 500);
          break;
        case SerfType.TypeSmelter: /* TODO ??? */
          break;
        default:
          inventory.serfIdleInStock(this);
          break;
      }
    } else { /* out */
      inventory.callOutSerf(this);

      this.setState(SerfState.StateReadyToLeaveInventory);
      this.s.readyToLeaveInventory.mode = -3;
      this.s.readyToLeaveInventory.invIndex = inventory.getIndex();
      /* TODO immediate switch to next state. */
    }
  }

  protected getWalkingAnimation(hDiff: number, dir: Direction, switchPos: number): number {
    let d: number = dir;
    if (switchPos && d < 3) d += 6;
    return 4 + hDiff + 9*d;
  }

  /* Preconditon: serf is in WALKING or TRANSPORTING state */
  protected changeDirection(dir: Direction, altEnd: number): void {
    const map = this.game.getMap();
    const newPos = map.move(this.pos, dir);

    if (!map.hasSerf(newPos)) {
      /* Change direction, not occupied. */
      map.setSerfIndex(this.pos, 0);
      this.animation = this.getWalkingAnimation(map.getHeight(newPos) -
                                                map.getHeight(this.pos), dir,
                                                0);
      this.s.walking.dir = reverseDirection(dir);
    } else {
      /* Direction is occupied. */
      const otherSerf = this.game.getSerfAtPos(newPos)!;
      const otherDir: Ref<Direction> = { value: Direction.DirectionNone };

      if (otherSerf.isWaiting(otherDir) &&
          (otherDir.value === reverseDirection(dir) || otherDir.value === Direction.DirectionNone) &&
          otherSerf.switchWaiting(reverseDirection(dir))) {
        /* Do the switch */
        otherSerf.pos = this.pos;
        map.setSerfIndex(otherSerf.pos, otherSerf.getIndex());
        otherSerf.animation =
             this.getWalkingAnimation(map.getHeight(otherSerf.pos) -
                                      map.getHeight(newPos),
                                      reverseDirection(dir), 1);
        otherSerf.counter = counterFromAnimation[otherSerf.animation];

        this.animation = this.getWalkingAnimation(map.getHeight(newPos) -
                                                  map.getHeight(this.pos),
                                                  dir, 1);
        this.s.walking.dir = reverseDirection(dir);
      } else {
        /* Wait for other serf */
        this.animation = 81 + dir;
        this.counter = counterFromAnimation[this.animation];
        this.s.walking.dir = dir-6;
        return;
      }
    }

    if (!altEnd) this.s.walking.waitCounter = 0;
    this.pos = newPos;
    map.setSerfIndex(this.pos, this.getIndex());
    this.counter += counterFromAnimation[this.animation];
    if (altEnd && this.counter < 0) {
      if (map.hasFlag(newPos)) {
        this.counter = 0;
      } else {
        Log.Debug('serf', 'unhandled jump to 31B82.');
      }
    }
  }

  /* Precondition: serf state is in WALKING or TRANSPORTING state */
  protected transporterMoveToFlag(flag: Flag): void {
    const dir = this.s.transporting.dir as Direction;
    if (flag.isScheduled(dir)) {
      /* Fetch resource from flag */
      this.s.transporting.waitCounter = 0;
      const resIndex = flag.scheduledSlot(dir);

      // PORT: `&s.transporting.res, &s.transporting.dest` is the
      // transporting variant itself, which the flag writes in place.
      if (this.s.transporting.res === ResourceType.TypeNone) {
        /* Pick up resource. */
        flag.pickUpResource(resIndex, this.s.transporting);
      } else {
        /* Switch resources and destination. */
        flag.switchResource(resIndex, this.s.transporting);
      }

      /* Find next resource to be picked up */
      const player = this.game.getPlayer(this.getOwner())!;
      flag.prioritizePickup(dir, player);
    } else if (this.s.transporting.res !== ResourceType.TypeNone) {
      /* Drop resource at flag */
      if (flag.dropResource(this.s.transporting.res, this.s.transporting.dest)) {
        this.s.transporting.res = ResourceType.TypeNone;
      }
    }

    this.changeDirection(dir, 1);
  }

  protected static handleSerfWalkingStateSearchCb(flag: Flag, data: unknown): boolean {
    const serf = data as Serf;
    const dest = flag.getGame().getFlag(serf.s.walking.dest);
    if (flag === dest) {
      Log.Verbose('serf', ' dest found: ', dest.getSearchDir());
      serf.changeDirection(dest.getSearchDir(), 0);
      return true;
    }

    return false;
  }

  protected startWalking(dir: Direction, slope: number, changePos: number): void {
    const map = this.game.getMap();
    const newPos = map.move(this.pos, dir);
    this.animation = this.getWalkingAnimation(map.getHeight(newPos) -
                                              map.getHeight(this.pos), dir, 0);
    this.counter += (slope * counterFromAnimation[this.animation]) >> 5;

    if (changePos) {
      map.setSerfIndex(this.pos, 0);
      map.setSerfIndex(newPos, this.getIndex());
    }

    this.pos = newPos;
  }

  /* Start entering building in direction up-left.
     If join_pos is set the serf is assumed to origin from
     a joined position so the source position will not have it's
     serf index cleared. */
  protected enterBuilding(fieldB: number, joinPos: number): void {
    this.setState(SerfState.StateEnteringBuilding);

    this.startWalking(Direction.DirectionUpLeft, 32, joinPos ? 0 : 1);
    if (joinPos) this.game.getMap().setSerfIndex(this.pos, this.getIndex());

    const building = this.game.getBuildingAtPos(this.pos)!;
    let slope = roadBuildingSlope[building.getType()];
    if (!building.isDone()) slope = 1;
    this.s.enteringBuilding.slopeLen = (slope * this.counter) >> 5;
    this.s.enteringBuilding.fieldB = fieldB;
  }

  /* Start leaving building by switching to LEAVING BUILDING and
     setting appropriate state. */
  protected leaveBuilding(joinPos: number): void {
    const building = this.game.getBuildingAtPos(this.pos)!;
    let slope = 31 - roadBuildingSlope[building.getType()];
    if (!building.isDone()) slope = 30;

    if (joinPos) this.game.getMap().setSerfIndex(this.pos, 0);
    this.startWalking(Direction.DirectionDownRight, slope, joinPos ? 0 : 1);

    this.setState(SerfState.StateLeavingBuilding);
  }

  protected handleSerfWalkingStateDestReached(): void {
    /* Destination reached. */
    if (this.s.walking.dir1 < 0) {
      const map = this.game.getMap();
      const building = this.game.getBuildingAtPos(map.moveUpLeft(this.pos))!;
      building.requestedSerfReached(this);

      if (map.hasSerf(map.moveUpLeft(this.pos))) {
        this.animation = 85;
        this.counter = 0;
        // The walking.dir1 word is read as ready_to_enter.field_B from here on.
        this.setState(SerfState.StateReadyToEnter);
      } else {
        this.enterBuilding(this.s.walking.dir1, 0);
      }
    } else if (this.s.walking.dir1 === 6) {
      this.setState(SerfState.StateLookingForGeoSpot);
      this.counter = 0;
    } else {
      const flag = this.game.getFlagAtPos(this.pos);
      if (flag === null) {
        throw new ExceptionFreeserf('Flag expected as destination of walking serf.');
      }
      const dir = this.s.walking.dir1 as Direction;
      const otherFlag = flag.getOtherEndFlag(dir);
      if (otherFlag === null) {
        throw new ExceptionFreeserf('Path has no other end flag in selected dir.');
      }
      const otherDir = flag.getOtherEndDir(dir);

      /* Increment transport serf count */
      flag.completeSerfRequest(dir);
      otherFlag.completeSerfRequest(otherDir);

      this.setState(SerfState.StateTransporting);
      this.s.transporting.res = ResourceType.TypeNone;
      this.s.transporting.dir = dir;
      this.s.transporting.waitCounter = 0;

      this.transporterMoveToFlag(flag);
    }
  }

  protected handleSerfWalkingStateWaiting(): void {
    /* Waiting for other serf. */
    let dir = (this.s.walking.dir + 6) as Direction;

    const map = this.game.getMap();
    /* Only check for loops once in a while: after 10 waits at a flag,
       50 elsewhere. */
    this.s.walking.waitCounter += 1;
    if ((map.hasFlag(this.pos) && this.s.walking.waitCounter >= 10) ||
        (!map.hasFlag(this.pos) && this.s.walking.waitCounter >= 50)) {
      let pos_ = this.pos;

      /* Follow the chain of serfs waiting for each other and
         see if there is a loop. */
      for (let i = 0; i < 100; i++) {
        pos_ = map.move(pos_, dir);

        if (!map.hasSerf(pos_)) {
          break;
        } else if (map.getSerfIndex(pos_) === this.index) {
          /* We have found a loop, try a different direction. */
          this.changeDirection(reverseDirection(dir), 0);
          return;
        }

        /* Get next serf and follow the chain */
        const otherSerf = this.game.getSerfAtPos(pos_)!;
        if (otherSerf.state !== SerfState.StateWalking &&
            otherSerf.state !== SerfState.StateTransporting) {
          break;
        }

        // UNION ALIAS (walking.dir is transporting.dir)
        if (otherSerf.s.walking.dir >= 0 ||
            (otherSerf.s.walking.dir + 6) === reverseDirection(dir)) {
          break;
        }

        dir = (otherSerf.s.walking.dir + 6) as Direction;
      }

      /* The counter is only reset after a check. */
      this.s.walking.waitCounter = 0;
    }

    /* Stick to the same direction */
    this.changeDirection((this.s.walking.dir + 6) as Direction, 0);
  }

  protected handleSerfWalkingState(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    while (this.counter < 0) {
      if (this.s.walking.dir < 0) {
        this.handleSerfWalkingStateWaiting();
        continue;
      }

      /* 301F0 */
      if (this.game.getMap().hasFlag(this.pos)) {
        /* Serf has reached a flag.
           Search for a destination if none is known. */
        if (this.s.walking.dest === 0) {
          const flagIndex = this.game.getMap().getObjIndex(this.pos);
          const src = this.game.getFlag(flagIndex)!;
          const r = src.findNearestInventoryForSerf();
          if (r < 0) {
            this.setState(SerfState.StateLost);
            this.s.lost.fieldB = 1;
            this.counter = 0;
            return;
          }
          this.s.walking.dest = r;
        }

        /* Check whether destination has been reached.
           If not, find out which direction to move in
           to reach the destination. */
        if (this.s.walking.dest === this.game.getMap().getObjIndex(this.pos)) {
          this.handleSerfWalkingStateDestReached();
          return;
        } else {
          const src = this.game.getFlagAtPos(this.pos)!;
          const search = new FlagSearch(this.game);
          for (const i of cycleDirectionsCcw()) {
            if (!src.isWaterPath(i)) {
              const otherFlag = src.getOtherEndFlag(i)!;
              otherFlag.setSearchDir(i);
              search.addSource(otherFlag);
            }
          }
          const r = search.execute(Serf.handleSerfWalkingStateSearchCb,
                                   true, false, this);
          if (r) continue;
        }
      } else {
        /* 30A37 */
        /* Serf is not at a flag. Just follow the road. */
        const paths = this.game.getMap().paths(this.pos) & ~BIT(this.s.walking.dir);
        let dir: Direction = Direction.DirectionNone;
        for (const d of cycleDirectionsCw()) {
          if (paths === BIT(d)) {
            dir = d;
            break;
          }
        }

        if (dir >= 0) {
          this.changeDirection(dir, 0);
          continue;
        }

        this.counter = 0;
      }

      /* Either the road is a dead end; or
         we are at a flag, but the flag search for
         the destination failed. */
      if (this.s.walking.dir1 < 0) {
        if (this.s.walking.dir1 < -1) {
          this.setState(SerfState.StateLost);
          this.s.lost.fieldB = 1;
          this.counter = 0;
          return;
        }

        const flag = this.game.getFlag(this.s.walking.dest)!;
        const building = flag.getBuilding()!;
        building.requestedSerfLost();
      } else if (this.s.walking.dir1 !== 6) {
        const flag = this.game.getFlag(this.s.walking.dest)!;
        const d = this.s.walking.dir1 as Direction;
        flag.cancelSerfRequest(d);
        flag.getOtherEndFlag(d)!.cancelSerfRequest(
                                       flag.getOtherEndDir(d));
      }

      this.s.walking.dir1 = -2;
      this.s.walking.dest = 0;
      this.counter = 0;
    }
  }

  protected handleSerfTransportingState(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    if (this.counter >= 0) return;

    if (this.s.transporting.dir < 0) {
      this.changeDirection((this.s.transporting.dir + 6) as Direction, 1);
    } else {
      const map = this.game.getMap();
      /* 31549 */
      if (map.hasFlag(this.pos)) {
        /* Current position occupied by waiting transporter */
        if (this.s.transporting.waitCounter < 0) {
          this.setState(SerfState.StateWalking);
          this.s.walking.waitCounter = 0;
          this.s.walking.dir1 = -2;
          this.s.walking.dest = 0;
          this.counter = 0;
          return;
        }

        /* 31590 */
        if (this.s.transporting.res !== ResourceType.TypeNone &&
            map.getObjIndex(this.pos) === this.s.transporting.dest) {
          /* At resource destination */
          this.setState(SerfState.StateDelivering);
          this.s.transporting.waitCounter = 0;

          const newPos = map.moveUpLeft(this.pos);
          this.animation = 3 + map.getHeight(newPos) - map.getHeight(this.pos) +
                           (Direction.DirectionUpLeft + 6) * 9;
          this.counter = counterFromAnimation[this.animation];
          /* TODO next call is actually into the middle of
             handle_serf_delivering_state().
             Why is a nice and clean state switch not enough???
             Just ignore this call and we'll be safe, I think... */
          /* handle_serf_delivering_state(serf); */
          return;
        }

        const flag = this.game.getFlagAtPos(this.pos)!;
        this.transporterMoveToFlag(flag);
      } else {
        // UNION ALIAS (walking.dir is transporting.dir, here and below)
        const paths = map.paths(this.pos) & ~BIT(this.s.walking.dir);
        let dir: Direction = Direction.DirectionNone;
        for (const d of cycleDirectionsCw()) {
          if (paths === BIT(d)) {
            dir = d;
            break;
          }
        }

        if (dir < 0) {
          this.setState(SerfState.StateLost);
          this.counter = 0;
          return;
        }

        if (!map.hasFlag(map.move(this.pos, dir)) ||
            this.s.transporting.res !== ResourceType.TypeNone ||
            this.s.transporting.waitCounter < 0) {
          this.changeDirection(dir, 1);
          return;
        }

        const flag = this.game.getFlagAtPos(map.move(this.pos, dir))!;
        const revDir = reverseDirection(dir);
        const otherFlag = flag.getOtherEndFlag(revDir)!;
        const otherDir = flag.getOtherEndDir(revDir);

        if (flag.isScheduled(revDir)) {
          this.changeDirection(dir, 1);
          return;
        }

        this.animation = 110 + this.s.walking.dir;
        this.counter = counterFromAnimation[this.animation];
        this.s.walking.dir -= 6;

        if (flag.freeTransporterCount(revDir) > 1) {
          this.s.transporting.waitCounter += 1;
          if (this.s.transporting.waitCounter > 3) {
            flag.transporterToServe(revDir);
            otherFlag.transporterToServe(otherDir);
            this.s.transporting.waitCounter = -1;
          }
        } else {
          if (!otherFlag.isScheduled(otherDir)) {
            /* TODO Don't use anim as state var */
            this.tick = u16((this.tick & 0xff00) | (this.s.walking.dir & 0xff));
            this.setState(SerfState.StateIdleOnPath);
            // The transporting.dest word stays as idle_on_path.field_E.
            this.s.idleOnPath.revDir = revDir;
            this.s.idleOnPath.flag = flag.getIndex();
            map.setIdleSerf(this.pos);
            map.setSerfIndex(this.pos, 0);
            return;
          }
        }
      }
    }
  }

  protected enterInventory(): void {
    this.game.getMap().setSerfIndex(this.pos, 0);
    const building = this.game.getBuildingAtPos(this.pos)!;
    this.setState(SerfState.StateIdleInStock);
    /*serf->s.idle_in_stock.field_B = 0;
      serf->s.idle_in_stock.field_C = 0;*/
    this.s.idleInStock.invIndex = building.getInventory()!.getIndex();
  }

  protected handleSerfEnteringBuildingState(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    if (this.counter < 0 || this.counter <= this.s.enteringBuilding.slopeLen) {
      if (this.game.getMap().getObjIndex(this.pos) === 0 ||
          this.game.getBuildingAtPos(this.pos)!.isBurning()) {
        /* Burning */
        this.setState(SerfState.StateLost);
        this.s.lost.fieldB = 0;
        this.counter = 0;
        return;
      }

      this.counter = this.s.enteringBuilding.slopeLen;
      const map = this.game.getMap();
      switch (this.getType()) {
        case SerfType.TypeTransporter:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            map.setSerfIndex(this.pos, 0);
            const flagIndex = map.getObjIndex(map.moveDownRight(this.pos));
            const flag = this.game.getFlag(flagIndex)!;

            /* Mark as inventory accepting resources and serfs. */
            flag.setHasInventory();
            flag.setAcceptsResources(true);
            flag.setAcceptsSerfs(true);

            this.setState(SerfState.StateWaitForResourceOut);
            this.counter = 63;
            this.setType(SerfType.TypeTransporterInventory);
          }
          break;
        case SerfType.TypeSailor:
          this.enterInventory();
          break;
        case SerfType.TypeDigger:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            this.setState(SerfState.StateDigging);
            this.s.digging.hIndex = 15;

            const building = this.game.getBuildingAtPos(this.pos)!;
            this.s.digging.digPos = 6;
            this.s.digging.targetH = building.getLevel();
            this.s.digging.substate = 1;
          }
          break;
        case SerfType.TypeBuilder:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            this.setState(SerfState.StateBuilding);
            this.animation = 98;
            this.counter = 127;
            this.s.building.mode = 1;
            this.s.building.bldIndex = map.getObjIndex(this.pos);
            this.s.building.materialStep = 0;

            const building = this.game.getBuilding(this.s.building.bldIndex)!;
            switch (building.getType()) {
              case BuildingType.TypeStock:
              case BuildingType.TypeSawmill:
              case BuildingType.TypeToolMaker:
              case BuildingType.TypeFortress:
                this.setBuildingTall();
                this.animation = 100;
                break;
              default:
                break;
            }
          }
          break;
        case SerfType.TypeTransporterInventory:
          map.setSerfIndex(this.pos, 0);
          this.setState(SerfState.StateWaitForResourceOut);
          this.counter = 63;
          break;
        case SerfType.TypeLumberjack:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            map.setSerfIndex(this.pos, 0);
            this.setState(SerfState.StatePlanningLogging);
          }
          break;
        case SerfType.TypeSawmiller:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            map.setSerfIndex(this.pos, 0);
            if (this.s.enteringBuilding.fieldB !== 0) {
              const building = this.game.getBuildingAtPos(this.pos)!;
              const flagIndex = map.getObjIndex(map.moveDownRight(this.pos));
              const flag = this.game.getFlag(flagIndex)!;
              flag.clearFlags();
              building.stockInit(1, ResourceType.TypeLumber, 8);
            }
            this.setState(SerfState.StateSawing);
            this.s.sawing.mode = 0;
          }
          break;
        case SerfType.TypeStonecutter:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            map.setSerfIndex(this.pos, 0);
            this.setState(SerfState.StatePlanningStoneCutting);
          }
          break;
        case SerfType.TypeForester:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            map.setSerfIndex(this.pos, 0);
            this.setState(SerfState.StatePlanningPlanting);
          }
          break;
        case SerfType.TypeMiner:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            map.setSerfIndex(this.pos, 0);
            const building = this.game.getBuildingAtPos(this.pos)!;
            const bldType = building.getType();

            /* A working stone mine ends the stone part of the emergency
               program (Amiga entering_building @0x12bf0). */
            if (bldType === BuildingType.TypeStoneMine) {
              this.game.getPlayer(this.getOwner())!.stoneMineWorking();
            }

            if (this.s.enteringBuilding.fieldB !== 0) {
              building.startActivity();
              building.stopPlayingSfx();

              const flag = this.game.getFlagAtPos(map.moveDownRight(this.pos))!;
              flag.clearFlags();
              building.stockInit(0, ResourceType.GroupFood, 8);
            }

            this.setState(SerfState.StateMining);
            this.s.mining.substate = 0;
            this.s.mining.deposit = (4 - (bldType -
                                          BuildingType.TypeStoneMine)) as MapMinerals;
            /*s.mining.field_C = 0;*/
            this.s.mining.res = 0;
          }
          break;
        case SerfType.TypeSmelter:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            map.setSerfIndex(this.pos, 0);

            const building = this.game.getBuildingAtPos(this.pos)!;

            if (this.s.enteringBuilding.fieldB !== 0) {
              const flag = this.game.getFlagAtPos(map.moveDownRight(this.pos))!;
              flag.clearFlags();
              building.stockInit(0, ResourceType.TypeCoal, 8);

              if (building.getType() === BuildingType.TypeSteelSmelter) {
                building.stockInit(1, ResourceType.TypeIronOre, 8);
              } else {
                building.stockInit(1, ResourceType.TypeGoldOre, 8);
              }
            }

            /* Switch to smelting state to begin work. */
            this.setState(SerfState.StateSmelting);

            if (building.getType() === BuildingType.TypeSteelSmelter) {
              this.s.smelting.type = 0;
            } else {
              this.s.smelting.type = -1;
            }

            this.s.smelting.mode = 0;
          }
          break;
        case SerfType.TypeFisher:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            map.setSerfIndex(this.pos, 0);
            this.setState(SerfState.StatePlanningFishing);
          }
          break;
        case SerfType.TypePigFarmer:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            map.setSerfIndex(this.pos, 0);

            if (this.s.enteringBuilding.fieldB !== 0) {
              const building = this.game.getBuildingAtPos(this.pos)!;
              const flag = this.game.getFlagAtPos(map.moveDownRight(this.pos))!;

              building.setInitialResInStock(1, 1);

              flag.clearFlags();
              building.stockInit(0, ResourceType.TypeWheat, 8);

              this.setState(SerfState.StatePigFarming);
              this.s.pigfarming.mode = 0;
            } else {
              this.setState(SerfState.StatePigFarming);
              this.s.pigfarming.mode = 6;
              this.counter = 0;
            }
          }
          break;
        case SerfType.TypeButcher:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            map.setSerfIndex(this.pos, 0);

            if (this.s.enteringBuilding.fieldB !== 0) {
              const building = this.game.getBuildingAtPos(this.pos)!;
              const flag = this.game.getFlagAtPos(map.moveDownRight(this.pos))!;
              flag.clearFlags();
              building.stockInit(0, ResourceType.TypePig, 8);
            }

            this.setState(SerfState.StateButchering);
            this.s.butchering.mode = 0;
          }
          break;
        case SerfType.TypeFarmer:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            map.setSerfIndex(this.pos, 0);
            this.setState(SerfState.StatePlanningFarming);
          }
          break;
        case SerfType.TypeMiller:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            map.setSerfIndex(this.pos, 0);

            if (this.s.enteringBuilding.fieldB !== 0) {
              const building = this.game.getBuildingAtPos(this.pos)!;
              const flag = this.game.getFlagAtPos(map.moveDownRight(this.pos))!;
              flag.clearFlags();
              building.stockInit(0, ResourceType.TypeWheat, 8);
            }

            this.setState(SerfState.StateMilling);
            this.s.milling.mode = 0;
          }
          break;
        case SerfType.TypeBaker:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            map.setSerfIndex(this.pos, 0);

            if (this.s.enteringBuilding.fieldB !== 0) {
              const building = this.game.getBuildingAtPos(this.pos)!;
              const flag = this.game.getFlagAtPos(map.moveDownRight(this.pos))!;
              flag.clearFlags();
              building.stockInit(0, ResourceType.TypeFlour, 8);
            }

            this.setState(SerfState.StateBaking);
            this.s.baking.mode = 0;
          }
          break;
        case SerfType.TypeBoatBuilder:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            map.setSerfIndex(this.pos, 0);
            if (this.s.enteringBuilding.fieldB !== 0) {
              const building = this.game.getBuildingAtPos(this.pos)!;
              const flag = this.game.getFlagAtPos(map.moveDownRight(this.pos))!;
              flag.clearFlags();
              building.stockInit(0, ResourceType.TypePlank, 8);
            }

            this.setState(SerfState.StateBuildingBoat);
            this.s.buildingBoat.mode = 0;
          }
          break;
        case SerfType.TypeToolmaker:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            map.setSerfIndex(this.pos, 0);
            if (this.s.enteringBuilding.fieldB !== 0) {
              const building = this.game.getBuildingAtPos(this.pos)!;
              const flag = this.game.getFlagAtPos(map.moveDownRight(this.pos))!;
              flag.clearFlags();
              building.stockInit(0, ResourceType.TypePlank, 8);
              building.stockInit(1, ResourceType.TypeSteel, 8);
            }

            this.setState(SerfState.StateMakingTool);
            this.s.makingTool.mode = 0;
          }
          break;
        case SerfType.TypeWeaponSmith:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            map.setSerfIndex(this.pos, 0);
            if (this.s.enteringBuilding.fieldB !== 0) {
              const building = this.game.getBuildingAtPos(this.pos)!;
              const flag = this.game.getFlagAtPos(map.moveDownRight(this.pos))!;
              flag.clearFlags();
              building.stockInit(0, ResourceType.TypeCoal, 8);
              building.stockInit(1, ResourceType.TypeSteel, 8);
            }

            this.setState(SerfState.StateMakingWeapon);
            this.s.makingWeapon.mode = 0;
          }
          break;
        case SerfType.TypeGeologist:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            this.setState(SerfState.StateLookingForGeoSpot); /* TODO Should never be reached */
            this.counter = 0;
          }
          break;
        case SerfType.TypeGeneric: {
          map.setSerfIndex(this.pos, 0);

          const building = this.game.getBuildingAtPos(this.pos)!;
          const inventory = building.getInventory();
          if (inventory === null) {
            throw new ExceptionFreeserf('Not inventory.');
          }
          inventory.serfComeBack();

          this.setState(SerfState.StateIdleInStock);
          this.s.idleInStock.invIndex = inventory.getIndex();
          break;
        }
        case SerfType.TypeKnight0:
        case SerfType.TypeKnight1:
        case SerfType.TypeKnight2:
        case SerfType.TypeKnight3:
        case SerfType.TypeKnight4:
          if (this.s.enteringBuilding.fieldB === -2) {
            this.enterInventory();
          } else {
            const building = this.game.getBuildingAtPos(this.pos)!;
            if (building.isBurning()) {
              this.setState(SerfState.StateLost);
              this.counter = 0;
            } else {
              map.setSerfIndex(this.pos, 0);

              if (building.hasInventory()) {
                this.setState(SerfState.StateDefendingCastle);
                this.counter = 6000;

                /* Prepend to knight list */
                this.s.defending.nextKnight = building.getFirstKnight();
                building.setFirstKnight(this.getIndex());

                this.game.getPlayer(
                                building.getOwner())!.increaseCastleKnights();
                return;
              }

              building.requestedKnightArrived();

              let nextState = -1 as SerfState;
              switch (building.getType()) {
                case BuildingType.TypeHut:
                  nextState = SerfState.StateDefendingHut;
                  break;
                case BuildingType.TypeTower:
                  nextState = SerfState.StateDefendingTower;
                  break;
                case BuildingType.TypeFortress:
                  nextState = SerfState.StateDefendingFortress;
                  break;
                default:
                  NOT_REACHED();
                  break;
              }

              /* Switch to defending state */
              this.setState(nextState);
              this.counter = 6000;

              /* Prepend to knight list */
              this.s.defending.nextKnight = building.getFirstKnight();
              building.setFirstKnight(this.getIndex());
            }
          }
          break;
        case SerfType.TypeDead:
          break;
        default:
          NOT_REACHED();
          break;
      }
    }
  }

  protected handleSerfLeavingBuildingState(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    if (this.counter < 0) {
      this.counter = 0;
      this.setState(this.s.leavingBuilding.nextState);

      /* Set field_F to 0, do this for individual states if necessary */
      // UNION ALIAS: the leaving_building words are read after the state
      // switch and written back through the variant of the new state. Words
      // not written keep the leaving_building value (walking.dir is
      // leaving_building.dest2, move_resource_out.next_state too).
      if (this.state === SerfState.StateWalking) {
        const mode = this.s.leavingBuilding.fieldB;
        const dest = this.s.leavingBuilding.dest;
        this.s.walking.dir1 = mode;
        this.s.walking.dest = dest;
        this.s.walking.waitCounter = 0;
      } else if (this.state === SerfState.StateDropResourceOut) {
        const res = this.s.leavingBuilding.fieldB >>> 0;
        const resDest = this.s.leavingBuilding.dest;
        this.s.moveResourceOut.res = res;
        this.s.moveResourceOut.resDest = resDest;
      } else if (this.state === SerfState.StateFreeWalking || this.state === SerfState.StateKnightFreeWalking ||
                 this.state === SerfState.StateStoneCutterFreeWalking) {
        const dist1 = this.s.leavingBuilding.fieldB;
        const dist2 = this.s.leavingBuilding.dest | 0;
        const negDist1 = this.s.leavingBuilding.dest2;
        const negDist2 = this.s.leavingBuilding.dir;
        this.s.freeWalking.distCol = dist1;
        this.s.freeWalking.distRow = dist2;
        this.s.freeWalking.negDist1 = negDist1;
        this.s.freeWalking.negDist2 = negDist2;
        this.clearObstacle();
      } else if (this.state === SerfState.StateKnightPrepareDefending || this.state === SerfState.StateScatter) {
        /* No state. */
      } else {
        Log.Debug('serf', 'unhandled next state when leaving building.');
      }
    }
  }

  protected handleSerfReadyToEnterState(): void {
    const newPos = this.game.getMap().moveUpLeft(this.pos);

    if (this.game.getMap().hasSerf(newPos)) {
      this.animation = 85;
      this.counter = 0;
      return;
    }

    this.enterBuilding(this.s.readyToEnter.fieldB, 0);
  }

  protected handleSerfReadyToLeaveState(): void {
    this.tick = u16(this.game.getTick());
    this.counter = 0;

    const map = this.game.getMap();
    const newPos = map.moveDownRight(this.pos);

    if ((map.getSerfIndex(this.pos) !== this.index && map.hasSerf(this.pos))
        || map.hasSerf(newPos)) {
      this.animation = 82;
      this.counter = 0;
      return;
    }

    this.leaveBuilding(0);
  }

  protected handleSerfDiggingState(): void {
    const hDiff: number[] = [
      -1, 1, -2, 2, -3, 3, -4, 4,
      -5, 5, -6, 6, -7, 7, -8, 8,
    ];

    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    const map = this.game.getMap();

    while (this.counter < 0) {
      this.s.digging.substate -= 1;
      if (this.s.digging.substate < 0) {
        Log.Verbose('serf', 'substate -1: wait for serf.');
        const d = this.s.digging.digPos;
        const dir = ((d === 0) ? Direction.DirectionUp : 6-d) as Direction;
        const newPos = map.move(this.pos, dir);

        if (map.hasSerf(newPos)) {
          const otherSerf = this.game.getSerfAtPos(newPos)!;
          const otherDir: Ref<Direction> = { value: Direction.DirectionNone };

          if (otherSerf.isWaiting(otherDir) &&
              otherDir.value === reverseDirection(dir) &&
              otherSerf.switchWaiting(otherDir.value)) {
            /* Do the switch */
            otherSerf.pos = this.pos;
            map.setSerfIndex(otherSerf.pos,
                             otherSerf.getIndex());
            otherSerf.animation =
              this.getWalkingAnimation(map.getHeight(otherSerf.pos) -
                                       map.getHeight(newPos),
                                       reverseDirection(dir), 1);
            otherSerf.counter = counterFromAnimation[otherSerf.animation];

            if (d !== 0) {
              this.animation =
                      this.getWalkingAnimation(map.getHeight(newPos) -
                                               map.getHeight(this.pos), dir, 1);
            } else {
              this.animation = map.getHeight(newPos) - map.getHeight(this.pos);
            }
          } else {
            this.counter = 127;
            this.s.digging.substate = 0;
            return;
          }
        } else {
          map.setSerfIndex(this.pos, 0);
          if (d !== 0) {
            this.animation =
                      this.getWalkingAnimation(map.getHeight(newPos) -
                                               map.getHeight(this.pos), dir, 0);
          } else {
            this.animation = map.getHeight(newPos) - map.getHeight(this.pos);
          }
        }

        map.setSerfIndex(newPos, this.getIndex());
        this.pos = newPos;
        this.s.digging.substate = 3;
        this.counter += counterFromAnimation[this.animation];
      } else if (this.s.digging.substate === 1) {
        /* 34CD6: Change height, head back to center */
        let h = map.getHeight(this.pos);
        h += (this.s.digging.hIndex & 1) ? -1 : 1;
        Log.Verbose('serf', 'substate 1: change height ',
                    ((this.s.digging.hIndex & 1) ? 'down.' : 'up.'));
        map.setHeight(this.pos, h);

        if (this.s.digging.digPos === 0) {
          this.s.digging.substate = 1;
        } else {
          const dir = reverseDirection((6-this.s.digging.digPos) as Direction);
          this.startWalking(dir, 32, 1);
        }
      } else if (this.s.digging.substate > 1) {
        Log.Verbose('serf', 'substate 2: dig.');
        /* 34E89 */
        this.animation = 88 - (this.s.digging.hIndex & 1);
        this.counter += 383;
      } else {
        /* 34CDC: Looking for a place to dig */
        Log.Verbose('serf', 'substate 0: looking for place to dig ',
                    this.s.digging.digPos, ', ', this.s.digging.hIndex);
        do {
          const h = (hDiff[this.s.digging.hIndex] + this.s.digging.targetH) | 0;
          if (this.s.digging.digPos >= 0 && h >= 0 && h < 32) {
            if (this.s.digging.digPos === 0) {
              const height = map.getHeight(this.pos);
              if (height !== h) {
                this.s.digging.digPos -= 1;
                continue;
              }
              /* Dig here */
              this.s.digging.substate = 2;
              if (this.s.digging.hIndex & 1) {
                this.animation = 87;
              } else {
                this.animation = 88;
              }
              this.counter += 383;
            } else {
              const dir = (6-this.s.digging.digPos) as Direction;
              const newPos = map.move(this.pos, dir);
              const newHeight = map.getHeight(newPos);
              if (newHeight !== h) {
                this.s.digging.digPos -= 1;
                continue;
              }
              Log.Verbose('serf', '  found at: ', this.s.digging.digPos, '.');
              /* Digging spot found */
              if (map.hasSerf(newPos)) {
                /* Occupied by other serf, wait */
                this.s.digging.substate = 0;
                this.animation = 87 - this.s.digging.digPos;
                this.counter = counterFromAnimation[this.animation];
                return;
              }

              /* Go to dig there */
              this.startWalking(dir, 32, 1);
              this.s.digging.substate = 3;
            }
            break;
          }

          this.s.digging.digPos = 6;
          this.s.digging.hIndex -= 1;
        } while (this.s.digging.hIndex >= 0);

        if (this.s.digging.hIndex < 0) {
          /* Done digging */
          const building =
                          this.game.getBuilding(this.game.getMap().getObjIndex(this.pos))!;
          building.doneLeveling();
          this.setState(SerfState.StateReadyToLeave);
          this.s.leavingBuilding.dest = 0;
          this.s.leavingBuilding.fieldB = -2;
          this.s.leavingBuilding.dir = 0;
          this.s.leavingBuilding.nextState = SerfState.StateWalking;
          this.handleSerfReadyToLeaveState();  // TODO(jonls): why isn't a
                                               // state switch enough?
          return;
        }
      }
    }
  }

  protected handleSerfBuildingState(): void {
    const materialOrder: number[] = [
      0, 0, 0, 0, 0, 4, 0, 0,
      0, 0, 0x38, 2, 8, 2, 8, 4,
      4, 0xc, 0x14, 0x2c, 2, 0x1c, 0x1f0, 4,
      0, 0, 0, 0, 0, 0, 0, 0,
    ];

    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    while (this.counter < 0) {
      const building = this.game.getBuilding(this.s.building.bldIndex)!;
      if (this.s.building.mode < 0) {
        if (building.buildProgress()) {
          this.counter = 0;
          this.setState(SerfState.StateFinishedBuilding);
          return;
        }

        this.s.building.counter -= 1;
        if (this.s.building.counter === 0) {
          this.s.building.mode = 1;
          this.animation = 98;
          if (this.isBuildingTall()) this.animation = 100;

          /* 353A5 */
          const materialStep = this.getBuildingMaterialStep();
          if (!BIT_TEST(materialOrder[building.getType()], materialStep)) {
            /* Planks */
            if (building.getResCountInStock(0) === 0) {
              this.counter += 256;
              if (this.counter < 0) this.counter = 255;
              return;
            }

            building.plankUsedForBuild();
          } else {
            /* Stone */
            if (building.getResCountInStock(1) === 0) {
              this.counter += 256;
              if (this.counter < 0) this.counter = 255;
              return;
            }

            building.stoneUsedForBuild();
          }

          this.s.building.materialStep += 1;
          this.s.building.counter = 8;
          this.s.building.mode = -1;
        }
      } else {
        if (this.s.building.mode === 0) {
          this.s.building.mode = 1;
          this.animation = 98;
          if (this.isBuildingTall()) this.animation = 100;
        }

        /* 353A5: Duplicate code */
        const materialStep = this.getBuildingMaterialStep();
        if (!BIT_TEST(materialOrder[building.getType()], materialStep)) {
          /* Planks */
          if (building.getResCountInStock(0) === 0) {
            this.counter += 256;
            if (this.counter < 0) this.counter = 255;
            return;
          }

          building.plankUsedForBuild();
        } else {
          /* Stone */
          if (building.getResCountInStock(1) === 0) {
            this.counter += 256;
            if (this.counter < 0) this.counter = 255;
            return;
          }

          building.stoneUsedForBuild();
        }

        this.s.building.materialStep += 1;
        this.s.building.counter = 8;
        this.s.building.mode = -1;
      }

      let rnd = (this.game.randomInt() & 3) + 102;
      if (this.isBuildingTall()) rnd += 4;
      this.animation = rnd;
      this.counter += counterFromAnimation[this.animation];
    }
  }

  protected handleSerfBuildingCastleState(): void {
    this.tick = u16(this.game.getTick());

    const inventory = this.game.getInventory(this.s.buildingCastle.invIndex)!;
    const building = this.game.getBuilding(inventory.getBuildingIndex())!;

    if (building.buildProgress()) { /* Finished */
      this.game.getMap().setSerfIndex(this.pos, 0);
      this.setState(SerfState.StateWaitForResourceOut);
    }
  }

  protected handleSerfMoveResourceOutState(): void {
    this.tick = u16(this.game.getTick());
    this.counter = 0;

    const map = this.game.getMap();
    if ((map.getSerfIndex(this.pos) !== this.index && map.hasSerf(this.pos)) ||
      map.hasSerf(map.moveDownRight(this.pos))) {
      /* Occupied by serf, wait */
      this.animation = 82;
      this.counter = 0;
      return;
    }

    const flag = this.game.getFlagAtPos(map.moveDownRight(this.pos))!;
    if (!flag.hasEmptySlot()) {
      /* All resource slots at flag are occupied, wait */
      this.animation = 82;
      this.counter = 0;
      return;
    }

    // UNION ALIAS: move_resource_out is read before the state switch and
    // written back as leaving_building after it (dest2 and dir keep the
    // old words).
    const res = this.s.moveResourceOut.res;
    const resDest = this.s.moveResourceOut.resDest;
    const nextState = this.s.moveResourceOut.nextState;

    this.leaveBuilding(0);
    this.s.leavingBuilding.nextState = nextState;
    this.s.leavingBuilding.fieldB = res;
    this.s.leavingBuilding.dest = resDest;
  }

  protected handleSerfWaitForResourceOutState(): void {
    if (this.counter !== 0) {
      const delta = u16(this.game.getTick() - this.tick);
      this.tick = u16(this.game.getTick());
      this.counter -= delta;

      if (this.counter >= 0) return;

      this.counter = 0;
    }

    const objIndex = this.game.getMap().getObjIndex(this.pos);
    const building = this.game.getBuilding(objIndex)!;
    const inventory = building.getInventory()!;
    if (inventory.getSerfQueueLength() > 0 ||
        !inventory.hasResourceInQueue()) {
      return;
    }

    this.setState(SerfState.StateMoveResourceOut);
    // PORT: the two out parameters come back as one object.
    const { res, dest } = inventory.getResourceFromQueue();
    this.s.moveResourceOut.res = res + 1;
    this.s.moveResourceOut.resDest = dest;
    this.s.moveResourceOut.nextState = SerfState.StateDropResourceOut;

    /* why isn't a state switch enough? */
    /*handle_serf_move_resource_out_state(serf);*/
  }

  protected handleSerfDropResourceOutState(): void {
    const flag = this.game.getFlag(this.game.getMap().getObjIndex(this.pos))!;

    const res = flag.dropResource((this.s.moveResourceOut.res-1) as ResourceType,
                                  this.s.moveResourceOut.resDest);
    if (!res) {
      throw new ExceptionFreeserf('Failed to drop resource.');
    }

    this.setState(SerfState.StateReadyToEnter);
    this.s.readyToEnter.fieldB = 0;
  }

  protected handleSerfDeliveringState(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    while (this.counter < 0) {
      if (this.s.transporting.waitCounter !== 0) {
        this.setState(SerfState.StateTransporting);
        this.s.transporting.waitCounter = 0;
        const flag = this.game.getFlag(this.game.getMap().getObjIndex(this.pos))!;
        this.transporterMoveToFlag(flag);
        return;
      }

      if (this.s.transporting.res !== ResourceType.TypeNone) {
        const res = this.s.transporting.res;
        this.s.transporting.res = ResourceType.TypeNone;
        const building =
                    this.game.getBuildingAtPos(this.game.getMap().moveUpLeft(this.pos))!;
        building.requestedResourceDelivered(res);
      }

      this.animation = 4 + 9 - (this.animation - (3 + 10*9));
      this.s.transporting.waitCounter = -this.s.transporting.waitCounter - 1;
      this.counter += counterFromAnimation[this.animation] >> 1;
    }
  }

  protected handleSerfReadyToLeaveInventoryState(): void {
    this.tick = u16(this.game.getTick());
    this.counter = 0;

    const map = this.game.getMap();
    if (map.hasSerf(this.pos) || map.hasSerf(map.moveDownRight(this.pos))) {
      this.animation = 82;
      this.counter = 0;
      return;
    }

    if (this.s.readyToLeaveInventory.mode === -1) {
      const flag = this.game.getFlag(this.s.readyToLeaveInventory.dest)!;
      if (flag.hasBuilding()) {
        const building = flag.getBuilding()!;
        if (map.hasSerf(building.getPosition())) {
          this.animation = 82;
          this.counter = 0;
          return;
        }
      }
    }

    const inventory =
                        this.game.getInventory(this.s.readyToLeaveInventory.invIndex)!;
    inventory.serfAway();

    let nextState = SerfState.StateWalking;
    if (this.s.readyToLeaveInventory.mode === -3) {
      nextState = SerfState.StateScatter;
    }

    // UNION ALIAS: ready_to_leave_inventory is read before the state switch
    // and written back as leaving_building after it (dest2 keeps the
    // inv_index word).
    const mode = this.s.readyToLeaveInventory.mode;
    const dest = this.s.readyToLeaveInventory.dest;

    this.leaveBuilding(0);
    this.s.leavingBuilding.nextState = nextState;
    this.s.leavingBuilding.fieldB = mode;
    this.s.leavingBuilding.dest = dest;
    this.s.leavingBuilding.dir = 0;
  }

  protected dropResource(res: ResourceType): void {
    const flag = this.game.getFlag(this.game.getMap().getObjIndex(this.pos))!;

    /* Resource is lost if no free slot is found */
    const result = flag.dropResource(res, 0);
    if (result) {
      const player = this.game.getPlayer(this.getOwner())!;
      player.increaseResCount(res);
    }
  }

  /* Serf will try to find the closest inventory from current position, either
     by following the roads if it is already at a flag, otherwise it will try
     to find a flag nearby. */
  protected findInventory(): void {
    const map = this.game.getMap();
    if (map.hasFlag(this.pos)) {
      const flag = this.game.getFlag(map.getObjIndex(this.pos))!;
      if ((flag.landPaths() !== 0 ||
           (flag.hasInventory() && flag.acceptsSerfs())) &&
            map.getOwner(this.pos) === this.getOwner()) {
        this.setState(SerfState.StateWalking);
        this.s.walking.dir1 = -2;
        this.s.walking.dest = 0;
        this.s.walking.dir = 0;
        this.counter = 0;
        return;
      }
    }

    this.setState(SerfState.StateLost);
    this.s.lost.fieldB = 0;
    this.counter = 0;
  }

  protected handleSerfFreeWalkingStateDestReached(): void {
    if (this.s.freeWalking.negDist1 === -128 &&
        this.s.freeWalking.negDist2 < 0) {
      this.findInventory();
      return;
    }

    const map = this.game.getMap();
    switch (this.getType()) {
      case SerfType.TypeLumberjack:
        if (this.s.freeWalking.negDist1 === -128) {
          if (this.s.freeWalking.negDist2 > 0) {
            this.dropResource(ResourceType.TypeLumber);
          }

          this.setState(SerfState.StateReadyToEnter);
          this.s.readyToEnter.fieldB = 0;
          this.counter = 0;
        } else {
          this.s.freeWalking.distCol = this.s.freeWalking.negDist1;
          this.s.freeWalking.distRow = this.s.freeWalking.negDist2;
          const obj: number = map.getObj(this.pos);
          if (obj >= MapObject.ObjectTree0 &&
              obj <= MapObject.ObjectPine7) {
            this.setState(SerfState.StateLogging);
            this.s.freeWalking.negDist1 = 0;
            this.s.freeWalking.negDist2 = 0;
            if (obj < 16) this.s.freeWalking.negDist1 = -1;
            this.animation = 116;
            this.counter = counterFromAnimation[this.animation];
          } else {
            /* The expected tree is gone */
            this.s.freeWalking.negDist1 = -128;
            this.s.freeWalking.negDist2 = 0;
            this.clearObstacle();
            this.counter = 0;
          }
        }
        break;
      case SerfType.TypeStonecutter:
        if (this.s.freeWalking.negDist1 === -128) {
          if (this.s.freeWalking.negDist2 > 0) {
            this.dropResource(ResourceType.TypeStone);
          }

          this.setState(SerfState.StateReadyToEnter);
          this.s.readyToEnter.fieldB = 0;
          this.counter = 0;
        } else {
          this.s.freeWalking.distCol = this.s.freeWalking.negDist1;
          this.s.freeWalking.distRow = this.s.freeWalking.negDist2;

          const newPos = map.moveUpLeft(this.pos);
          const obj: number = map.getObj(newPos);
          if (!map.hasSerf(newPos) &&
              obj >= MapObject.ObjectStone0 &&
              obj <= MapObject.ObjectStone7) {
            this.counter = 0;
            this.startWalking(Direction.DirectionUpLeft, 32, 1);

            this.setState(SerfState.StateStoneCutting);
            this.s.freeWalking.negDist2 = this.counter >> 2;
            this.s.freeWalking.negDist1 = 0;
          } else {
            /* The expected stone is gone or unavailable */
            this.s.freeWalking.negDist1 = -128;
            this.s.freeWalking.negDist2 = 0;
            this.clearObstacle();
            this.counter = 0;
          }
        }
        break;
      case SerfType.TypeForester:
        if (this.s.freeWalking.negDist1 === -128) {
          this.setState(SerfState.StateReadyToEnter);
          this.s.readyToEnter.fieldB = 0;
          this.counter = 0;
        } else {
          this.s.freeWalking.distCol = this.s.freeWalking.negDist1;
          this.s.freeWalking.distRow = this.s.freeWalking.negDist2;
          if (map.getObj(this.pos) === MapObject.ObjectNone) {
            this.setState(SerfState.StatePlanting);
            this.s.freeWalking.negDist2 = 0;
            this.animation = 121;
            this.counter = counterFromAnimation[this.animation];
          } else {
            /* The expected free space is no longer empty */
            this.s.freeWalking.negDist1 = -128;
            this.s.freeWalking.negDist2 = 0;
            this.clearObstacle();
            this.counter = 0;
          }
        }
        break;
      case SerfType.TypeFisher:
        if (this.s.freeWalking.negDist1 === -128) {
          if (this.s.freeWalking.negDist2 > 0) {
            this.dropResource(ResourceType.TypeFish);
          }

          this.setState(SerfState.StateReadyToEnter);
          this.s.readyToEnter.fieldB = 0;
          this.counter = 0;
        } else {
          this.s.freeWalking.distCol = this.s.freeWalking.negDist1;
          this.s.freeWalking.distRow = this.s.freeWalking.negDist2;

          let a = -1;
          if (map.paths(this.pos) === 0) {
            if (map.typeDown(this.pos) <= MapTerrain.TerrainWater3 &&
                map.typeUp(map.moveUpLeft(this.pos)) >= MapTerrain.TerrainGrass0) {
              a = 132;
            } else if (
                map.typeDown(map.moveLeft(this.pos)) <= MapTerrain.TerrainWater3 &&
                map.typeUp(map.moveUp(this.pos)) >= MapTerrain.TerrainGrass0) {
              a = 131;
            }
          }

          if (a < 0) {
            /* Cannot fish here after all. */
            this.s.freeWalking.negDist1 = -128;
            this.s.freeWalking.negDist2 = 0;
            this.clearObstacle();
            this.counter = 0;
          } else {
            this.setState(SerfState.StateFishing);
            this.s.freeWalking.negDist1 = 0;
            this.s.freeWalking.negDist2 = 0;
            this.resetFishingAttempts();
            this.animation = a;
            this.counter = counterFromAnimation[a];
          }
        }
        break;
      case SerfType.TypeFarmer:
        if (this.s.freeWalking.negDist1 === -128) {
          if (this.s.freeWalking.negDist2 > 0) {
            this.dropResource(ResourceType.TypeWheat);
          }

          this.setState(SerfState.StateReadyToEnter);
          this.s.readyToEnter.fieldB = 0;
          this.counter = 0;
        } else {
          this.s.freeWalking.distCol = this.s.freeWalking.negDist1;
          this.s.freeWalking.distRow = this.s.freeWalking.negDist2;

          if (map.getObj(this.pos) === MapObject.ObjectSeeds5 ||
              (map.getObj(this.pos) >= MapObject.ObjectField0 &&
               map.getObj(this.pos) <= MapObject.ObjectField5)) {
            /* Existing field. */
            this.animation = 136;
            this.s.freeWalking.negDist1 = 1;
            this.counter = counterFromAnimation[this.animation];
          } else if (map.getObj(this.pos) === MapObject.ObjectNone &&
                     map.paths(this.pos) === 0) {
            /* Empty space. */
            this.animation = 135;
            this.s.freeWalking.negDist1 = 0;
            this.counter = counterFromAnimation[this.animation];
          } else {
            /* Space not available after all. */
            this.s.freeWalking.negDist1 = -128;
            this.s.freeWalking.negDist2 = 0;
            this.clearObstacle();
            this.counter = 0;
            break;
          }

          this.setState(SerfState.StateFarming);
          this.s.freeWalking.negDist2 = 0;
        }
        break;
      case SerfType.TypeGeologist:
        if (this.s.freeWalking.negDist1 === -128) {
          if (map.getObj(this.pos) === MapObject.ObjectFlag &&
              map.getOwner(this.pos) === this.getOwner()) {
            this.setState(SerfState.StateLookingForGeoSpot);
            this.counter = 0;
          } else {
            this.setState(SerfState.StateLost);
            this.s.lost.fieldB = 0;
            this.counter = 0;
          }
        } else {
          this.s.freeWalking.distCol = this.s.freeWalking.negDist1;
          this.s.freeWalking.distRow = this.s.freeWalking.negDist2;
          if (map.getObj(this.pos) === MapObject.ObjectNone) {
            this.setState(SerfState.StateSamplingGeoSpot);
            this.s.freeWalking.negDist1 = 0;
            this.animation = 141;
            this.counter = counterFromAnimation[this.animation];
          } else {
            /* Destination is not a free space after all. */
            this.s.freeWalking.negDist1 = -128;
            this.s.freeWalking.negDist2 = 0;
            this.clearObstacle();
            this.counter = 0;
          }
        }
        break;
      case SerfType.TypeKnight0:
      case SerfType.TypeKnight1:
      case SerfType.TypeKnight2:
      case SerfType.TypeKnight3:
      case SerfType.TypeKnight4:
        if (this.s.freeWalking.negDist1 === -128) {
          this.findInventory();
        } else {
          this.setState(SerfState.StateKnightOccupyEnemyBuilding);
          this.counter = 0;
        }
        break;
      default:
        this.findInventory();
        break;
    }
  }

  protected handleSerfFreeWalkingSwitchOnDir(dir: Direction): void {
    // A suitable direction has been found; walk.
    if (dir < Direction.DirectionRight) {
      throw new ExceptionFreeserf('Wrong direction.');
    }
    const dx = ((dir < 3) ? 1 : -1)*b2i((dir % 3) < 2);
    const dy = ((dir < 3) ? 1 : -1)*b2i((dir % 3) > 0);

    Log.Verbose('serf', 'serf ', this.index, ': free walking: dest ',
                this.s.freeWalking.distCol, ', ',
                this.s.freeWalking.distRow,
                ', move ', dx, ', ', dy);

    this.s.freeWalking.distCol -= dx;
    this.s.freeWalking.distRow -= dy;

    this.startWalking(dir, 32, 1);

    if (this.s.freeWalking.distCol === 0 && this.s.freeWalking.distRow === 0) {
      /* Arriving to destination */
      this.setObstacle(0, true, 0);
    }
  }

  protected handleSerfFreeWalkingSwitchWithOther(): void {
    /* No free position can be found. Switch with
       other serf. */
    let newPos: MapPos = 0;
    let dir: Direction = Direction.DirectionNone;
    let otherSerf: Serf | null = null;
    const map = this.game.getMap();
    for (const i of cycleDirectionsCw()) {
      newPos = map.move(this.pos, i);
      if (map.hasSerf(newPos)) {
        otherSerf = this.game.getSerfAtPos(newPos)!;
        const otherDir: Ref<Direction> = { value: Direction.DirectionNone };

        if (otherSerf.isWaiting(otherDir) &&
            otherDir.value === reverseDirection(i) &&
            otherSerf.switchWaiting(otherDir.value)) {
          dir = i;
          break;
        }
      }
    }

    if (dir > Direction.DirectionNone) {
      const dx = ((dir < 3) ? 1 : -1)*b2i((dir % 3) < 2);
      const dy = ((dir < 3) ? 1 : -1)*b2i((dir % 3) > 0);

      Log.Verbose('serf', 'free walking (switch): dest ',
                  this.s.freeWalking.distCol, ', ',
                  this.s.freeWalking.distRow, ', move ',
                  dx, ', ', dy);

      this.s.freeWalking.distCol -= dx;
      this.s.freeWalking.distRow -= dy;

      if (this.s.freeWalking.distCol === 0 &&
          this.s.freeWalking.distRow === 0) {
        /* Arriving to destination */
        this.setObstacle(0, true, 0);
      }

      /* Switch with other serf. */
      map.setSerfIndex(this.pos, otherSerf!.index);
      map.setSerfIndex(newPos, this.index);

      otherSerf!.animation = this.getWalkingAnimation(map.getHeight(this.pos) -
                                                 map.getHeight(otherSerf!.pos),
                                            reverseDirection(dir), 1);
      this.animation = this.getWalkingAnimation(map.getHeight(newPos) -
                                                map.getHeight(this.pos),
                                                dir, 1);

      otherSerf!.counter = counterFromAnimation[otherSerf!.animation];
      this.counter = counterFromAnimation[this.animation];

      otherSerf!.pos = this.pos;
      this.pos = newPos;
    } else {
      this.animation = 82;
      this.counter = counterFromAnimation[this.animation];
    }
  }

  protected canPassMapPos(testPos: MapPos): boolean {
    return GameMap.mapSpaceFromObj[this.game.getMap().getObj(testPos)] <=
             MapSpace.SpaceSemipassable;
  }

  protected handleFreeWalkingFollowEdge(): number {
    const dirFromOffset: Direction[] = [
      Direction.DirectionUpLeft, Direction.DirectionUp,   Direction.DirectionNone,
      Direction.DirectionLeft,   Direction.DirectionNone, Direction.DirectionRight,
      Direction.DirectionNone,   Direction.DirectionDown, Direction.DirectionDownRight,
    ];

    /* Follow right-hand edge */
    const dirRightEdge: Direction[] = [
      Direction.DirectionDown, Direction.DirectionDownRight, Direction.DirectionRight, Direction.DirectionUp,
      Direction.DirectionUpLeft, Direction.DirectionLeft, Direction.DirectionLeft, Direction.DirectionDown,
      Direction.DirectionDownRight, Direction.DirectionRight, Direction.DirectionUp, Direction.DirectionUpLeft,
      Direction.DirectionUpLeft, Direction.DirectionLeft, Direction.DirectionDown, Direction.DirectionDownRight,
      Direction.DirectionRight, Direction.DirectionUp, Direction.DirectionUp, Direction.DirectionUpLeft, Direction.DirectionLeft,
      Direction.DirectionDown, Direction.DirectionDownRight, Direction.DirectionRight, Direction.DirectionRight,
      Direction.DirectionUp, Direction.DirectionUpLeft, Direction.DirectionLeft, Direction.DirectionDown,
      Direction.DirectionDownRight, Direction.DirectionDownRight, Direction.DirectionRight, Direction.DirectionUp,
      Direction.DirectionUpLeft, Direction.DirectionLeft, Direction.DirectionDown,
    ];

    /* Follow left-hand edge */
    const dirLeftEdge: Direction[] = [
      Direction.DirectionUpLeft, Direction.DirectionUp, Direction.DirectionRight, Direction.DirectionDownRight,
      Direction.DirectionDown, Direction.DirectionLeft, Direction.DirectionUp, Direction.DirectionRight,
      Direction.DirectionDownRight, Direction.DirectionDown, Direction.DirectionLeft, Direction.DirectionUpLeft,
      Direction.DirectionRight, Direction.DirectionDownRight, Direction.DirectionDown, Direction.DirectionLeft,
      Direction.DirectionUpLeft, Direction.DirectionUp, Direction.DirectionDownRight, Direction.DirectionDown,
      Direction.DirectionLeft, Direction.DirectionUpLeft, Direction.DirectionUp, Direction.DirectionRight, Direction.DirectionDown,
      Direction.DirectionLeft, Direction.DirectionUpLeft, Direction.DirectionUp, Direction.DirectionRight,
      Direction.DirectionDownRight, Direction.DirectionLeft, Direction.DirectionUpLeft, Direction.DirectionUp,
      Direction.DirectionRight, Direction.DirectionDownRight, Direction.DirectionDown,
    ];

    const water = (this.state === SerfState.StateFreeSailing);
    let dirIndex = -1;
    let dirArr: Direction[];

    if (this.isObstacleLeftEdge()) {
      /* Follow left-hand edge */
      dirArr = dirLeftEdge;
      dirIndex = this.getObstacleDirIndex() - 1;
    } else {
      /* Follow right-hand edge */
      dirArr = dirRightEdge;
      dirIndex = this.getObstacleDirIndex() - 1;
    }

    const d1 = this.s.freeWalking.distCol;
    const d2 = this.s.freeWalking.distRow;

    /* Check if dest is only one step away. */
    if (!water && Math.abs(d1) <= 1 && Math.abs(d2) <= 1 &&
        dirFromOffset[(d1+1) + 3*(d2+1)] > Direction.DirectionNone) {
      /* Convert offset in two dimensions to
         direction variable. */
      const dir = dirFromOffset[(d1+1) + 3*(d2+1)];
      const newPos = this.game.getMap().move(this.pos, dir);

      if (!this.canPassMapPos(newPos)) {
        if (this.state !== SerfState.StateKnightFreeWalking && this.s.freeWalking.negDist1 !== -128) {
          this.s.freeWalking.distCol += this.s.freeWalking.negDist1;
          this.s.freeWalking.distRow += this.s.freeWalking.negDist2;
          this.s.freeWalking.negDist1 = 0;
          this.s.freeWalking.negDist2 = 0;
          this.clearObstacle();
          this.animation = 82;
          this.counter = counterFromAnimation[this.animation];
        } else {
          this.setState(SerfState.StateLost);
          this.s.lost.fieldB = 0;
          this.counter = 0;
        }
        return 0;
      }

      if (this.state === SerfState.StateKnightFreeWalking && this.s.freeWalking.negDist1 !== -128 &&
          this.game.getMap().hasSerf(newPos)) {
        /* Wait for other serfs */
        this.clearObstacle();
        this.animation = 82;
        this.counter = counterFromAnimation[this.animation];
        return 0;
      }
    }

    const a0 = 6*dirIndex;  /* &dir_arr[6*dir_index] */
    let i0: Direction = Direction.DirectionNone;
    let dir: Direction = Direction.DirectionNone;
    const map = this.game.getMap();
    for (const i of cycleDirectionsCw()) {
      const newPos = map.move(this.pos, dirArr[a0 + i]);
      if (((water && map.getObj(newPos) === 0) ||
           (!water && !map.isInWater(newPos) &&
            this.canPassMapPos(newPos))) && !map.hasSerf(newPos)) {
        dir = dirArr[a0 + i];
        i0 = i;
        break;
      }
    }

    if (i0 > Direction.DirectionNone) {
      const upper = this.getObstacleTurns() + i0 - 2;
      if (i0 < 2 && upper < 0) {
        this.clearObstacle();
        this.handleSerfFreeWalkingSwitchOnDir(dir);
        return 0;
      } else if (i0 > 2 && upper > 15) {
        this.clearObstacle();
      } else {
        const dirIndex = dir+1;
        this.setObstacle(upper, this.isObstacleLeftEdge(), dirIndex);
        this.handleSerfFreeWalkingSwitchOnDir(dir);
        return 0;
      }
    } else {
      const dirIndex = 0;
      this.setObstacle(this.getObstacleTurns(), false, dirIndex);
      this.handleSerfFreeWalkingSwitchWithOther();
      return 0;
    }

    return -1;
  }

  protected handleFreeWalkingCommon(): void {
    const dirFromOffset: Direction[] = [
      Direction.DirectionUpLeft, Direction.DirectionUp,   Direction.DirectionNone,
      Direction.DirectionLeft,   Direction.DirectionNone, Direction.DirectionRight,
      Direction.DirectionNone,   Direction.DirectionDown, Direction.DirectionDownRight,
    ];

    /* Directions for moving forwards. Each of the 12 lines represents
       a general direction as shown in the diagram below.
       The lines list the local directions in order of preference for that
       general direction.

       *         1    0
       *    2   ________   11
       *       /\      /\
       *      /  \    /  \
       *  3  /    \  /    \  10
       *    /______\/______\
       *    \      /\      /
       *  4  \    /  \    /  9
       *      \  /    \  /
       *       \/______\/
       *    5             8
       *         6    7
       */
    const dirForward: Direction[] = [
      Direction.DirectionUp, Direction.DirectionUpLeft, Direction.DirectionRight, Direction.DirectionLeft,
      Direction.DirectionDownRight, Direction.DirectionDown, Direction.DirectionUpLeft, Direction.DirectionUp,
      Direction.DirectionLeft, Direction.DirectionRight, Direction.DirectionDown, Direction.DirectionDownRight,
      Direction.DirectionUpLeft, Direction.DirectionLeft, Direction.DirectionUp, Direction.DirectionDown, Direction.DirectionRight,
      Direction.DirectionDownRight, Direction.DirectionLeft, Direction.DirectionUpLeft, Direction.DirectionDown,
      Direction.DirectionUp, Direction.DirectionDownRight, Direction.DirectionRight, Direction.DirectionLeft,
      Direction.DirectionDown, Direction.DirectionUpLeft, Direction.DirectionDownRight, Direction.DirectionUp,
      Direction.DirectionRight, Direction.DirectionDown, Direction.DirectionLeft, Direction.DirectionDownRight,
      Direction.DirectionUpLeft, Direction.DirectionRight, Direction.DirectionUp, Direction.DirectionDown,
      Direction.DirectionDownRight, Direction.DirectionLeft, Direction.DirectionRight, Direction.DirectionUpLeft,
      Direction.DirectionUp, Direction.DirectionDownRight, Direction.DirectionDown, Direction.DirectionRight,
      Direction.DirectionLeft, Direction.DirectionUp, Direction.DirectionUpLeft, Direction.DirectionDownRight,
      Direction.DirectionRight, Direction.DirectionDown, Direction.DirectionUp, Direction.DirectionLeft, Direction.DirectionUpLeft,
      Direction.DirectionRight, Direction.DirectionDownRight, Direction.DirectionUp, Direction.DirectionDown,
      Direction.DirectionUpLeft, Direction.DirectionLeft, Direction.DirectionRight, Direction.DirectionUp,
      Direction.DirectionDownRight, Direction.DirectionUpLeft, Direction.DirectionDown, Direction.DirectionLeft,
      Direction.DirectionUp, Direction.DirectionRight, Direction.DirectionUpLeft, Direction.DirectionDownRight,
      Direction.DirectionLeft, Direction.DirectionDown,
    ];

    const water = (this.state === SerfState.StateFreeSailing);

    if (this.isObstacleLeftEdge() && this.getObstacleDirIndex() === 0) {
      /* Destination reached */
      this.handleSerfFreeWalkingStateDestReached();
      return;
    }

    if (this.getObstacleDirIndex() !== 0) {
      /* Obstacle encountered, follow along the edge */
      const r = this.handleFreeWalkingFollowEdge();
      if (r >= 0) return;
    }

    /* Move fowards */
    let dirIndex = -1;
    const d1 = this.s.freeWalking.distCol;
    const d2 = this.s.freeWalking.distRow;
    if (d1 < 0) {
      if (d2 < 0) {
        if (-d2 < -d1) {
          if (-2*d2 < -d1) {
            dirIndex = 3;
          } else {
            dirIndex = 2;
          }
        } else {
          if (-d2 < -2*d1) {
            dirIndex = 1;
          } else {
            dirIndex = 0;
          }
        }
      } else {
        if (d2 >= -d1) {
          dirIndex = 5;
        } else {
          dirIndex = 4;
        }
      }
    } else {
      if (d2 < 0) {
        if (-d2 >= d1) {
          dirIndex = 11;
        } else {
          dirIndex = 10;
        }
      } else {
        if (d2 < d1) {
          if (2*d2 < d1) {
            dirIndex = 9;
          } else {
            dirIndex = 8;
          }
        } else {
          if (d2 < 2*d1) {
            dirIndex = 7;
          } else {
            dirIndex = 6;
          }
        }
      }
    }

    /* Try to move directly in the preferred direction */
    const a0 = 6*dirIndex;  /* &dir_forward[6*dir_index] */
    let dir = dirForward[a0 + 0];
    const map = this.game.getMap();
    const newPos = map.move(this.pos, dir);
    if (((water && map.getObj(newPos) === 0) ||
         (!water && !map.isInWater(newPos) &&
          this.canPassMapPos(newPos))) &&
        !map.hasSerf(newPos)) {
      this.handleSerfFreeWalkingSwitchOnDir(dir);
      return;
    }

    /* Check if dest is only one step away. */
    if (!water && Math.abs(d1) <= 1 && Math.abs(d2) <= 1 &&
        dirFromOffset[(d1+1) + 3*(d2+1)] > Direction.DirectionNone) {
      /* Convert offset in two dimensions to
         direction variable. */
      const d = dirFromOffset[(d1+1) + 3*(d2+1)];
      const newPos = map.move(this.pos, d);

      if (!this.canPassMapPos(newPos)) {
        if (this.state !== SerfState.StateKnightFreeWalking && this.s.freeWalking.negDist1 !== -128) {
          this.s.freeWalking.distCol += this.s.freeWalking.negDist1;
          this.s.freeWalking.distRow += this.s.freeWalking.negDist2;
          this.s.freeWalking.negDist1 = 0;
          this.s.freeWalking.negDist2 = 0;
          this.clearObstacle();
        } else {
          this.setState(SerfState.StateLost);
          this.s.lost.fieldB = 0;
          this.counter = 0;
        }
        return;
      }

      if (this.state === SerfState.StateKnightFreeWalking && this.s.freeWalking.negDist1 !== -128
          && map.hasSerf(newPos)) {
        const otherSerf = this.game.getSerfAtPos(newPos)!;
        const otherDir: Ref<Direction> = { value: Direction.DirectionNone };

        if (otherSerf.isWaiting(otherDir) &&
            (otherDir.value === reverseDirection(d) || otherDir.value === Direction.DirectionNone) &&
            otherSerf.switchWaiting(reverseDirection(d))) {
          /* Do the switch */
          otherSerf.pos = this.pos;
          map.setSerfIndex(otherSerf.pos,
                           otherSerf.getIndex());
          otherSerf.animation =
            this.getWalkingAnimation(map.getHeight(otherSerf.pos) -
              map.getHeight(newPos),
                                     reverseDirection(d), 1);
          otherSerf.counter = counterFromAnimation[otherSerf.animation];

          this.animation = this.getWalkingAnimation(map.getHeight(newPos) -
                                                    map.getHeight(this.pos), d, 1);
          this.counter = counterFromAnimation[this.animation];

          this.pos = newPos;
          map.setSerfIndex(this.pos, this.index);
          return;
        }

        if (otherSerf.state === SerfState.StateWalking ||
            otherSerf.state === SerfState.StateTransporting) {
          this.s.freeWalking.negDist2 += 1;
          if (this.s.freeWalking.negDist2 >= 10) {
            this.s.freeWalking.negDist2 = 0;
            if (otherSerf.state === SerfState.StateTransporting) {
              if (map.hasFlag(newPos)) {
                // UNION ALIAS (walking.wait_counter is transporting.wait_counter)
                if (otherSerf.s.walking.waitCounter !== -1) {
//                int dir = other_serf->s.walking.dir;
//                if (dir < 0) dir += 6;
                  Log.Debug('serf', 'TODO remove ', otherSerf.getIndex(),
                            ' from path');
                }
                otherSerf.setLostState();
              }
            } else {
              otherSerf.setLostState();
            }
          }
        }

        this.animation = 82;
        this.counter = counterFromAnimation[this.animation];
        return;
      }
    }

    /* Look for another direction to go in. */
    let i0: number = Direction.DirectionNone;
    for (let i = 0; i < 5; i++) {
      dir = dirForward[a0 + 1+i];
      const newPos = map.move(this.pos, dir);
      if (((water && map.getObj(newPos) === 0) ||
           (!water && !map.isInWater(newPos) &&
            this.canPassMapPos(newPos))) && !map.hasSerf(newPos)) {
        i0 = i;
        break;
      }
    }

    if (i0 < 0) {
      this.handleSerfFreeWalkingSwitchWithOther();
      return;
    }

    let edge = 0;
    if (BIT_TEST(dirIndex ^ i0, 0)) edge = 1;
    const upper = Math.trunc(i0/2) + 1;

    this.setObstacle(upper, edge !== 0, dir + 1);

    this.handleSerfFreeWalkingSwitchOnDir(dir);
  }

  protected handleSerfFreeWalkingState(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    while (this.counter < 0) {
      this.handleFreeWalkingCommon();
    }
  }

  protected handleSerfLoggingState(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    while (this.counter < 0) {
      this.s.freeWalking.negDist2 += 1;

      let newObj = -1;
      if (this.s.freeWalking.negDist1 !== 0) {
        newObj = MapObject.ObjectFelledTree0 + this.s.freeWalking.negDist2 - 1;
      } else {
        newObj = MapObject.ObjectFelledPine0 + this.s.freeWalking.negDist2 - 1;
      }

      /* Change map object. */
      this.game.getMap().setObject(this.pos, newObj as MapObject, -1);

      if (this.s.freeWalking.negDist2 < 5) {
        this.animation = 116 + this.s.freeWalking.negDist2;
        this.counter += counterFromAnimation[this.animation];
      } else {
        this.setState(SerfState.StateFreeWalking);
        this.counter = 0;
        this.s.freeWalking.negDist1 = -128;
        this.s.freeWalking.negDist2 = 1;
        this.clearObstacle();
        return;
      }
    }
  }

  protected handleSerfPlanningLoggingState(): void {
    // EXT: the woodcutter of a paused or capped building stays in.
    if (this.planningHeld()) return;

    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    while (this.counter < 0) {
      const dist = (this.game.randomInt() & 0x7f) + 1;
      const pos_ = this.game.getMap().posAddSpirally(this.pos, dist);
      const obj: number = this.game.getMap().getObj(pos_);
      if (obj >= MapObject.ObjectTree0 && obj <= MapObject.ObjectPine7) {
        this.setState(SerfState.StateReadyToLeave);
        this.s.leavingBuilding.fieldB = GameMap.getSpiralPattern()[2 * dist] - 1;
        this.s.leavingBuilding.dest = GameMap.getSpiralPattern()[2 * dist + 1] - 1;
        this.s.leavingBuilding.dest2 = -GameMap.getSpiralPattern()[2 * dist] + 1;
        this.s.leavingBuilding.dir = -GameMap.getSpiralPattern()[2 * dist + 1] + 1;
        this.s.leavingBuilding.nextState = SerfState.StateFreeWalking;
        Log.Verbose('serf', 'planning logging: tree found, dist ',
                    this.s.leavingBuilding.fieldB, ', ',
                    this.s.leavingBuilding.dest, '.');
        return;
      }

      this.counter += 400;
    }
  }

  protected handleSerfPlanningPlantingState(): void {
    // EXT: the forester of a paused or capped building stays in.
    if (this.planningHeld()) return;

    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    const map = this.game.getMap();
    while (this.counter < 0) {
      const dist = (this.game.randomInt() & 0x7f) + 1;
      const pos_ = map.posAddSpirally(this.pos, dist);
      if (map.paths(pos_) === 0 &&
          map.getObj(pos_) === MapObject.ObjectNone &&
          map.typeUp(pos_) === MapTerrain.TerrainGrass1 &&
          map.typeDown(pos_) === MapTerrain.TerrainGrass1 &&
          map.typeUp(map.moveUpLeft(pos_)) === MapTerrain.TerrainGrass1 &&
          map.typeDown(map.moveUpLeft(pos_)) === MapTerrain.TerrainGrass1) {
        this.setState(SerfState.StateReadyToLeave);
        this.s.leavingBuilding.fieldB = GameMap.getSpiralPattern()[2 * dist] - 1;
        this.s.leavingBuilding.dest = GameMap.getSpiralPattern()[2 * dist + 1] - 1;
        this.s.leavingBuilding.dest2 = -GameMap.getSpiralPattern()[2 * dist] + 1;
        this.s.leavingBuilding.dir = -GameMap.getSpiralPattern()[2 * dist + 1] + 1;
        this.s.leavingBuilding.nextState = SerfState.StateFreeWalking;
        Log.Verbose('serf', 'planning planting: free space found, dist ',
                    this.s.leavingBuilding.fieldB, ', ',
                    this.s.leavingBuilding.dest, '.');
        return;
      }

      this.counter += 700;
    }
  }

  protected handleSerfPlantingState(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    const map = this.game.getMap();
    while (this.counter < 0) {
      if (this.s.freeWalking.negDist2 !== 0) {
        this.setState(SerfState.StateFreeWalking);
        this.s.freeWalking.negDist1 = -128;
        this.s.freeWalking.negDist2 = 0;
        this.clearObstacle();
        this.counter = 0;
        return;
      }

      /* Plant a tree */
      this.animation = 122;
      const newObj = (MapObject.ObjectNewPine +
                      (this.game.randomInt() & 1)) as MapObject;

      if (map.paths(this.pos) === 0 && map.getObj(this.pos) === MapObject.ObjectNone) {
        map.setObject(this.pos, newObj, -1);
      }

      this.s.freeWalking.negDist2 = -this.s.freeWalking.negDist2 - 1;
      this.counter += 128;
    }
  }

  protected handleSerfPlanningStonecutting(): void {
    // EXT: the stonecutter of a paused or capped building stays in.
    if (this.planningHeld()) return;

    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    const map = this.game.getMap();
    while (this.counter < 0) {
      const dist = (this.game.randomInt() & 0x7f) + 1;
      const pos_ = map.posAddSpirally(this.pos, dist);
      const obj: number = map.getObj(map.moveUpLeft(pos_));
      if (obj >= MapObject.ObjectStone0 && obj <= MapObject.ObjectStone7 &&
          this.canPassMapPos(pos_)) {
        this.setState(SerfState.StateReadyToLeave);
        this.s.leavingBuilding.fieldB = GameMap.getSpiralPattern()[2 * dist] - 1;
        this.s.leavingBuilding.dest = GameMap.getSpiralPattern()[2 * dist + 1] - 1;
        this.s.leavingBuilding.dest2 = -GameMap.getSpiralPattern()[2 * dist] + 1;
        this.s.leavingBuilding.dir = -GameMap.getSpiralPattern()[2 * dist + 1] + 1;
        this.s.leavingBuilding.nextState = SerfState.StateStoneCutterFreeWalking;
        Log.Verbose('serf', 'planning stonecutting: stone found, dist ',
                    this.s.leavingBuilding.fieldB, ', ',
                    this.s.leavingBuilding.dest, '.');
        return;
      }

      this.counter += 100;
    }
  }

  protected handleStonecutterFreeWalking(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    const map = this.game.getMap();
    while (this.counter < 0) {
      const pos_ = map.moveUpLeft(this.pos);
      if (!map.hasSerf(this.pos) && map.getObj(pos_) >= MapObject.ObjectStone0 &&
          map.getObj(pos_) <= MapObject.ObjectStone7) {
        this.s.freeWalking.negDist1 += this.s.freeWalking.distCol;
        this.s.freeWalking.negDist2 += this.s.freeWalking.distRow;
        this.s.freeWalking.distCol = 0;
        this.s.freeWalking.distRow = 0;
        this.setObstacle(0, true, 0);
      }

      this.handleFreeWalkingCommon();
    }
  }

  protected handleSerfStonecuttingState(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    if (this.s.freeWalking.negDist1 === 0) {
      if (this.counter > this.s.freeWalking.negDist2) return;
      this.counter -= this.s.freeWalking.negDist2 + 1;
      this.s.freeWalking.negDist1 = 1;
      this.animation = 123;
      this.counter += 1536;
    }

    while (this.counter < 0) {
      if (this.s.freeWalking.negDist1 !== 1) {
        this.setState(SerfState.StateFreeWalking);
        this.s.freeWalking.negDist1 = -128;
        this.s.freeWalking.negDist2 = 1;
        this.clearObstacle();
        this.counter = 0;
        return;
      }

      const map = this.game.getMap();
      if (map.hasSerf(map.moveDownRight(this.pos))) {
        this.counter = 0;
        return;
      }

      /* Decrement stone quantity or remove entirely if this
         was the last piece. */
      const obj: number = map.getObj(this.pos);
      if (obj <= MapObject.ObjectStone6) {
        map.setObject(this.pos, (obj + 1) as MapObject, -1);
      } else {
        map.setObject(this.pos, MapObject.ObjectNone, -1);
      }

      this.counter = 0;
      this.startWalking(Direction.DirectionDownRight, 24, 1);
      this.tick = u16(this.game.getTick());

      this.s.freeWalking.negDist1 = 2;
    }
  }

  protected handleSerfSawingState(): void {
    if (this.s.sawing.mode === 0) {
      const building =
                          this.game.getBuilding(this.game.getMap().getObjIndex(this.pos))!;
      // EXT: a paused or capped building starts no new round.
      if (building.isProductionHeld()) return;
      if (building.useResourceInStock(1)) {
        this.s.sawing.mode = 1;
        this.animation = 124;
        this.counter = counterFromAnimation[this.animation];
        this.tick = u16(this.game.getTick());
        this.game.getMap().setSerfIndex(this.pos, this.index);
      }
    } else {
      const delta = u16(this.game.getTick() - this.tick);
      this.tick = u16(this.game.getTick());
      this.counter -= delta;

      if (this.counter >= 0) return;

      this.game.getMap().setSerfIndex(this.pos, 0);
      this.setState(SerfState.StateMoveResourceOut);
      this.s.moveResourceOut.res = 1 + ResourceType.TypePlank;
      this.s.moveResourceOut.resDest = 0;
      this.s.moveResourceOut.nextState = SerfState.StateDropResourceOut;

      /* Update resource stats. */
      const player = this.game.getPlayer(this.getOwner())!;
      player.increaseResCount(ResourceType.TypePlank);
    }
  }

  protected handleSerfLostState(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    const map = this.game.getMap();
    while (this.counter < 0) {
      /* Try to find a suitable destination. */
      for (let i = 0; i < 258; i++) {
        const dist = (this.s.lost.fieldB === 0) ? 1+i : 258-i;
        const dest = map.posAddSpirally(this.pos, dist);

        if (map.hasFlag(dest)) {
          const flag = this.game.getFlag(map.getObjIndex(dest))!;
          if ((flag.landPaths() !== 0 ||
               (flag.hasInventory() && flag.acceptsSerfs())) &&
                map.hasOwner(dest) &&
                map.getOwner(dest) === this.getOwner()) {
            if (this.getType() >= SerfType.TypeKnight0 &&
                this.getType() <= SerfType.TypeKnight4) {
              this.setState(SerfState.StateKnightFreeWalking);
            } else {
              this.setState(SerfState.StateFreeWalking);
            }

            this.s.freeWalking.distCol = GameMap.getSpiralPattern()[2 * dist];
            this.s.freeWalking.distRow = GameMap.getSpiralPattern()[2 * dist +1];
            this.s.freeWalking.negDist1 = -128;
            this.s.freeWalking.negDist2 = -1;
            this.clearObstacle();
            this.counter = 0;
            return;
          }
        }
      }

      /* Choose a random destination */
      let size = 16;
      let tries = 10;

      while (1) {
        tries -= 1;
        if (tries < 0) {
          if (size < 64) {
            tries = 19;
            size *= 2;
          } else {
            tries = -1;
            size = 16;
          }
        }

        const r = this.game.randomInt();
        const col = ((r & (size-1)) - Math.trunc(size/2)) | 0;
        const row = (((r >> 8) & (size-1)) - Math.trunc(size/2)) | 0;

        const dest = map.posAdd(this.pos, col, row);
        if ((map.getObj(dest) === 0 && map.getHeight(dest) > 0) ||
            (map.hasFlag(dest) &&
             (map.hasOwner(dest) &&
               map.getOwner(dest) === this.getOwner()))) {
          if (this.getType() >= SerfType.TypeKnight0 && this.getType() <= SerfType.TypeKnight4) {
            this.setState(SerfState.StateKnightFreeWalking);
          } else {
            this.setState(SerfState.StateFreeWalking);
          }

          this.s.freeWalking.distCol = col;
          this.s.freeWalking.distRow = row;
          this.s.freeWalking.negDist1 = -128;
          this.s.freeWalking.negDist2 = -1;
          this.clearObstacle();
          this.counter = 0;
          return;
        }
      }
    }
  }

  protected handleLostSailor(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    const map = this.game.getMap();
    while (this.counter < 0) {
      /* Try to find a suitable destination. */
      for (let i = 0; i < 258; i++) {
        const dest = map.posAddSpirally(this.pos, i);

        if (map.hasFlag(dest)) {
          const flag = this.game.getFlag(map.getObjIndex(dest))!;
          if (flag.landPaths() !== 0 &&
              map.hasOwner(dest) &&
              map.getOwner(dest) === this.getOwner()) {
            this.setState(SerfState.StateFreeSailing);

            this.s.freeWalking.distCol = GameMap.getSpiralPattern()[2*i];
            this.s.freeWalking.distRow = GameMap.getSpiralPattern()[2*i+1];
            this.s.freeWalking.negDist1 = -128;
            this.s.freeWalking.negDist2 = -1;
            this.clearObstacle();
            this.counter = 0;
            return;
          }
        }
      }

      /* Choose a random, empty destination */
      while (1) {
        const r = this.game.randomInt();
        const col = (r & 0x1f) - 16;
        const row = ((r >> 8) & 0x1f) - 16;

        const dest = map.posAdd(this.pos, col, row);
        if (map.getObj(dest) === 0) {
          this.setState(SerfState.StateFreeSailing);

          this.s.freeWalking.distCol = col;
          this.s.freeWalking.distRow = row;
          this.s.freeWalking.negDist1 = -128;
          this.s.freeWalking.negDist2 = -1;
          this.clearObstacle();
          this.counter = 0;
          return;
        }
      }
    }
  }

  protected handleFreeSailing(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    while (this.counter < 0) {
      if (!this.game.getMap().isInWater(this.pos)) {
        this.setState(SerfState.StateLost);
        this.s.lost.fieldB = 0;
        return;
      }

      this.handleFreeWalkingCommon();
    }
  }

  protected handleSerfEscapeBuildingState(): void {
    if (!this.game.getMap().hasSerf(this.pos)) {
      this.game.getMap().setSerfIndex(this.pos, this.index);
      this.animation = 82;
      this.counter = 0;
      this.tick = u16(this.game.getTick());

      this.setState(SerfState.StateLost);
      this.s.lost.fieldB = 0;
    }
  }

  protected handleSerfMiningState(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    const map = this.game.getMap();
    while (this.counter < 0) {
      const building = this.game.getBuilding(map.getObjIndex(this.pos))!;

      Log.Verbose('serf', 'mining substate: ', this.s.mining.substate, '.');
      switch (this.s.mining.substate) {
        case 0: {
          // EXT: the miner of a paused or capped mine starts no new round
          // (and draws no random number); he looks again later.
          if (building.isProductionHeld()) {
            this.counter += 256;
            break;
          }
          /* There is a small chance that the miner will
             not require food and skip to state 2. */
          const r = this.game.randomInt();
          if ((r & 7) === 0) {
            this.s.mining.substate = 2;
          } else {
            this.s.mining.substate = 1;
          }
          this.counter += 100 + (r & 0x1ff);
          break;
        }
        case 1:
          if (building.useResourceInStock(0)) {
            /* Eat the food. */
            this.s.mining.substate = 3;
            map.setSerfIndex(this.pos, this.index);
            this.animation = 125;
            this.counter = counterFromAnimation[this.animation];
          } else {
            map.setSerfIndex(this.pos, this.index);
            this.animation = 98;
            this.counter += 256;
            if (this.counter < 0) this.counter = 255;
          }
          break;
        case 2:
          this.s.mining.substate = 3;
          map.setSerfIndex(this.pos, this.index);
          this.animation = 125;
          this.counter = counterFromAnimation[this.animation];
          break;
        case 3:
          this.s.mining.substate = 4;
          building.stopActivity();
          this.animation = 126;
          this.counter = counterFromAnimation[this.animation];
          break;
        // PORT: `case 4` falls through into `case 5` in the C++; the cases
        // are merged here and the code of case 4 runs first.
        case 4:
        case 5:
        case 6:
        case 7: {
          if (this.s.mining.substate === 4) {
            building.startPlayingSfx();
            map.setSerfIndex(this.pos, 0);
            /* fall through */
          }
          this.s.mining.substate += 1;

          /* Look for resource in ground. */
          const dest = map.posAddSpirally(this.pos,
                                          (this.game.randomInt() >> 2) & 0x1f);
          if ((map.getObj(dest) === MapObject.ObjectNone ||
               map.getObj(dest) > MapObject.ObjectCastle) &&
              map.getResType(dest) === this.s.mining.deposit &&
              map.getResAmount(dest) > 0) {
            /* Decrement resource count in ground. */
            map.removeGroundDeposit(dest, 1);

            /* Hand resource to miner. */
            const resFromMineType: ResourceType[] = [
              ResourceType.TypeGoldOre, ResourceType.TypeIronOre,
              ResourceType.TypeCoal, ResourceType.TypeStone,
            ];

            this.s.mining.res = resFromMineType[this.s.mining.deposit-1] + 1;
            this.s.mining.substate = 8;
          }

          this.counter += 1000;
          break;
        }
        case 8:
          map.setSerfIndex(this.pos, this.index);
          this.s.mining.substate = 9;
          building.stopPlayingSfx();
          this.animation = 127;
          this.counter = counterFromAnimation[this.animation];
          break;
        case 9:
          this.s.mining.substate = 10;
          building.increaseMining(this.s.mining.res);
          this.animation = 128;
          this.counter = counterFromAnimation[this.animation];
          break;
        case 10:
          map.setSerfIndex(this.pos, 0);
          if (this.s.mining.res === 0) {
            this.s.mining.substate = 0;
            this.counter = 0;
          } else {
            const res = this.s.mining.res >>> 0;
            map.setSerfIndex(this.pos, 0);

            this.setState(SerfState.StateMoveResourceOut);
            this.s.moveResourceOut.res = res;
            this.s.moveResourceOut.resDest = 0;
            this.s.moveResourceOut.nextState = SerfState.StateDropResourceOut;

            /* Update resource stats. */
            const player = this.game.getPlayer(this.getOwner())!;
            player.increaseResCount((res-1) as ResourceType);
            return;
          }
          break;
        default:
          NOT_REACHED();
          break;
      }
    }
  }

  protected handleSerfSmeltingState(): void {
    const building = this.game.getBuilding(this.game.getMap().getObjIndex(this.pos))!;

    if (this.s.smelting.mode === 0) {
      // EXT: a paused or capped building starts no new round.
      if (building.isProductionHeld()) return;
      if (building.useResourcesInStocks()) {
        building.startActivity();

        this.s.smelting.mode = 1;
        if (this.s.smelting.type === 0) {
          this.animation = 130;
        } else {
          this.animation = 129;
        }
        this.s.smelting.counter = 20;
        this.counter = counterFromAnimation[this.animation];
        this.tick = u16(this.game.getTick());

        this.game.getMap().setSerfIndex(this.pos, this.index);
      }
    } else {
      const delta = u16(this.game.getTick() - this.tick);
      this.tick = u16(this.game.getTick());
      this.counter -= delta;

      while (this.counter < 0) {
        this.s.smelting.counter -= 1;
        if (this.s.smelting.counter < 0) {
          building.stopActivity();

          let res = -1;
          if (this.s.smelting.type === 0) {
            res = 1 + ResourceType.TypeSteel;
          } else {
            res = 1 + ResourceType.TypeGoldBar;
          }

          this.setState(SerfState.StateMoveResourceOut);

          this.s.moveResourceOut.res = res;
          this.s.moveResourceOut.resDest = 0;
          this.s.moveResourceOut.nextState = SerfState.StateDropResourceOut;

          /* Update resource stats. */
          const player = this.game.getPlayer(this.getOwner())!;
          player.increaseResCount((res-1) as ResourceType);
          return;
        } else if (this.s.smelting.counter === 0) {
          this.game.getMap().setSerfIndex(this.pos, 0);
        }

        this.counter += 384;
      }
    }
  }

  protected handleSerfPlanningFishingState(): void {
    // EXT: the fisher of a paused or capped building stays in.
    if (this.planningHeld()) return;

    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    const map = this.game.getMap();
    while (this.counter < 0) {
      const dist = ((this.game.randomInt() >> 2) & 0x3f) + 1;
      const dest = map.posAddSpirally(this.pos, dist);

      if (map.getObj(dest) === MapObject.ObjectNone &&
          map.paths(dest) === 0 &&
          ((map.typeDown(dest) <= MapTerrain.TerrainWater3 &&
            map.typeUp(map.moveUpLeft(dest)) >= MapTerrain.TerrainGrass0) ||
           (map.typeDown(map.moveLeft(dest)) <= MapTerrain.TerrainWater3 &&
            map.typeUp(map.moveUp(dest)) >= MapTerrain.TerrainGrass0))) {
        this.setState(SerfState.StateReadyToLeave);
        this.s.leavingBuilding.fieldB = GameMap.getSpiralPattern()[2 * dist] - 1;
        this.s.leavingBuilding.dest = GameMap.getSpiralPattern()[2 * dist + 1] - 1;
        this.s.leavingBuilding.dest2 = -GameMap.getSpiralPattern()[2 * dist] + 1;
        this.s.leavingBuilding.dir = -GameMap.getSpiralPattern()[2 * dist +1] + 1;
        this.s.leavingBuilding.nextState = SerfState.StateFreeWalking;
        Log.Verbose('serf', 'planning fishing: lake found, dist ',
                    this.s.leavingBuilding.fieldB, ',',
                    this.s.leavingBuilding.dest);
        return;
      }

      this.counter += 100;
    }
  }

  protected handleSerfFishingState(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    while (this.counter < 0) {
      if (this.s.freeWalking.negDist2 !== 0 ||
          this.getFishingAttempts() === 10) {
        /* Stop fishing. Walk back. */
        this.setState(SerfState.StateFreeWalking);
        this.s.freeWalking.negDist1 = -128;
        this.clearObstacle();
        this.counter = 0;
        return;
      }

      this.s.freeWalking.negDist1 += 1;
      if ((this.s.freeWalking.negDist1 % 2) === 0) {
        this.animation -= 2;
        this.counter += 768;
        continue;
      }

      const map = this.game.getMap();
      let dir: Direction = Direction.DirectionNone;
      if (this.animation === 131) {
        if (map.isInWater(map.moveLeft(this.pos))) {
          dir = Direction.DirectionLeft;
        } else {
          dir = Direction.DirectionDown;
        }
      } else {
        if (map.isInWater(map.moveRight(this.pos))) {
          dir = Direction.DirectionRight;
        } else {
          dir = Direction.DirectionDownRight;
        }
      }

      const res = map.getResFish(map.move(this.pos, dir));
      if (res > 0 && (this.game.randomInt() & 0x3f) + 4 < res) {
        /* Caught a fish. */
        map.removeFish(map.move(this.pos, dir), 1);
        this.s.freeWalking.negDist2 = 1 + ResourceType.TypeFish;
      }

      this.countFishingAttempt();
      this.animation += 2;
      this.counter += 128;
    }
  }

  protected handleSerfPlanningFarmingState(): void {
    // EXT: the farmer of a paused or capped building stays in.
    if (this.planningHeld()) return;

    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;
    if (this.counter > 0) {
      return;
    }

    const map = this.game.getMap();
    while (true) {
      const dist = ((this.game.randomInt() >> 2) & 0x1f) + 7;
      const dest = map.posAddSpirally(this.pos, dist);

      /* If destination doesn't have an object it must be
         of the correct type and the surrounding spaces
         must not be occupied by large buildings.
         If it _has_ an object it must be an existing field. */
      if ((map.getObj(dest) === MapObject.ObjectNone &&
           (map.typeUp(dest) === MapTerrain.TerrainGrass1 &&
            map.typeDown(dest) === MapTerrain.TerrainGrass1 &&
            map.paths(dest) === 0 &&
            map.getObj(map.moveRight(dest)) !== MapObject.ObjectLargeBuilding &&
            map.getObj(map.moveRight(dest)) !== MapObject.ObjectCastle &&
           map.getObj(map.moveDownRight(dest)) !== MapObject.ObjectLargeBuilding &&
            map.getObj(map.moveDownRight(dest)) !== MapObject.ObjectCastle &&
            map.getObj(map.moveDown(dest)) !== MapObject.ObjectLargeBuilding &&
            map.getObj(map.moveDown(dest)) !== MapObject.ObjectCastle &&
            map.typeDown(map.moveLeft(dest)) === MapTerrain.TerrainGrass1 &&
            map.getObj(map.moveLeft(dest)) !== MapObject.ObjectLargeBuilding &&
            map.getObj(map.moveLeft(dest)) !== MapObject.ObjectCastle &&
            map.typeUp(map.moveUpLeft(dest)) === MapTerrain.TerrainGrass1 &&
            map.typeDown(map.moveUpLeft(dest)) === MapTerrain.TerrainGrass1 &&
            map.getObj(map.moveUpLeft(dest)) !== MapObject.ObjectLargeBuilding &&
            map.getObj(map.moveUpLeft(dest)) !== MapObject.ObjectCastle &&
            map.typeUp(map.moveUp(dest)) === MapTerrain.TerrainGrass1 &&
            map.getObj(map.moveUp(dest)) !== MapObject.ObjectLargeBuilding &&
            map.getObj(map.moveUp(dest)) !== MapObject.ObjectCastle)) ||
          map.getObj(dest) === MapObject.ObjectSeeds5 ||
          (map.getObj(dest) >= MapObject.ObjectField0 &&
           map.getObj(dest) <= MapObject.ObjectField5)) {
        this.setState(SerfState.StateReadyToLeave);
        this.s.leavingBuilding.fieldB = GameMap.getSpiralPattern()[2 * dist] - 1;
        this.s.leavingBuilding.dest = GameMap.getSpiralPattern()[2 * dist + 1] - 1;
        this.s.leavingBuilding.dest2 = -GameMap.getSpiralPattern()[2 * dist] + 1;
        this.s.leavingBuilding.dir = -GameMap.getSpiralPattern()[2 * dist + 1] + 1;
        this.s.leavingBuilding.nextState = SerfState.StateFreeWalking;
        Log.Verbose('serf', 'planning farming: field spot found, dist ',
                    this.s.leavingBuilding.fieldB, ', ',
                    this.s.leavingBuilding.dest, '.');
        return;
      }

      this.counter += 500;
      if (this.counter >= 65500) {
        return;
      }
    }
  }

  protected handleSerfFarmingState(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    if (this.counter >= 0) return;

    const map = this.game.getMap();
    let object: MapObject = map.getObj(this.pos);
    if (this.s.freeWalking.negDist1 === 0) {
      // Sowing
      if (object === MapObject.ObjectNone && map.paths(this.pos) === 0) {
        map.setObject(this.pos, MapObject.ObjectSeeds0, -1);
      }
    } else {
      // Harvesting
      this.s.freeWalking.negDist2 = 1;
      object = ((object as number) + 1) as MapObject;
      if (object === MapObject.ObjectFieldExpired) {
        object = MapObject.ObjectField0;
      } else if (object === MapObject.ObjectSignLargeGold || object === MapObject.Object127) {
        object = MapObject.ObjectFieldExpired;
      }
      map.setObject(this.pos, object, -1);
    }

    this.setState(SerfState.StateFreeWalking);
    this.s.freeWalking.negDist1 = -128;
    this.clearObstacle();
    this.counter = 0;
  }

  protected handleSerfMillingState(): void {
    const building = this.game.getBuilding(this.game.getMap().getObjIndex(this.pos))!;

    if (this.s.milling.mode === 0) {
      // EXT: a paused or capped building starts no new round.
      if (building.isProductionHeld()) return;
      if (building.useResourceInStock(0)) {
        building.startActivity();

        this.s.milling.mode = 1;
        this.animation = 137;
        this.counter = counterFromAnimation[this.animation];
        this.tick = u16(this.game.getTick());

        this.game.getMap().setSerfIndex(this.pos, this.index);
      }
    } else {
      const delta = u16(this.game.getTick() - this.tick);
      this.tick = u16(this.game.getTick());
      this.counter -= delta;

      while (this.counter < 0) {
        this.s.milling.mode += 1;
        if (this.s.milling.mode === 5) {
          /* Done milling. */
          building.stopActivity();
          this.setState(SerfState.StateMoveResourceOut);
          this.s.moveResourceOut.res = 1 + ResourceType.TypeFlour;
          this.s.moveResourceOut.resDest = 0;
          this.s.moveResourceOut.nextState = SerfState.StateDropResourceOut;

          const player = this.game.getPlayer(this.getOwner())!;
          player.increaseResCount(ResourceType.TypeFlour);
          return;
        } else if (this.s.milling.mode === 3) {
          this.game.getMap().setSerfIndex(this.pos, this.index);
          this.animation = 137;
          this.counter = counterFromAnimation[this.animation];
        } else {
          this.game.getMap().setSerfIndex(this.pos, 0);
          this.counter += 1500;
        }
      }
    }
  }

  protected handleSerfBakingState(): void {
    const building = this.game.getBuilding(this.game.getMap().getObjIndex(this.pos))!;

    if (this.s.baking.mode === 0) {
      // EXT: a paused or capped building starts no new round.
      if (building.isProductionHeld()) return;
      if (building.useResourceInStock(0)) {
        this.s.baking.mode = 1;
        this.animation = 138;
        this.counter = counterFromAnimation[this.animation];
        this.tick = u16(this.game.getTick());

        this.game.getMap().setSerfIndex(this.pos, this.index);
      }
    } else {
      const delta = u16(this.game.getTick() - this.tick);
      this.tick = u16(this.game.getTick());
      this.counter -= delta;

      while (this.counter < 0) {
        this.s.baking.mode += 1;
        if (this.s.baking.mode === 3) {
          /* Done baking. */
          building.stopActivity();

          this.setState(SerfState.StateMoveResourceOut);
          this.s.moveResourceOut.res = 1 + ResourceType.TypeBread;
          this.s.moveResourceOut.resDest = 0;
          this.s.moveResourceOut.nextState = SerfState.StateDropResourceOut;

          const player = this.game.getPlayer(this.getOwner())!;
          player.increaseResCount(ResourceType.TypeBread);
          return;
        } else {
          building.startActivity();
          this.game.getMap().setSerfIndex(this.pos, 0);
          this.counter += 1500;
        }
      }
    }
  }

  protected handleSerfPigfarmingState(): void {
    /* When the serf is present there is also at least one
       pig present and at most eight. */
    const breedingProb: number[] = [
      6000, 8000, 10000, 11000, 12000, 13000, 14000, 0,
    ];

    const building = this.game.getBuildingAtPos(this.pos)!;

    if (this.s.pigfarming.mode === 0) {
      // EXT: a paused or capped building starts no new round.
      if (building.isProductionHeld()) return;
      if (building.useResourceInStock(0)) {
        this.s.pigfarming.mode = 1;
        this.animation = 139;
        this.counter = counterFromAnimation[this.animation];
        this.tick = u16(this.game.getTick());

        this.game.getMap().setSerfIndex(this.pos, this.index);
      }
    } else {
      const delta = u16(this.game.getTick() - this.tick);
      this.tick = u16(this.game.getTick());
      this.counter -= delta;

      while (this.counter < 0) {
        this.s.pigfarming.mode += 1;
        if (this.s.pigfarming.mode & 1) {
          if (this.s.pigfarming.mode !== 7) {
            this.game.getMap().setSerfIndex(this.pos, this.index);
            this.animation = 139;
            this.counter = counterFromAnimation[this.animation];
          } else if (building.isProductionHeld()) {
            // EXT: at the end of a round a paused or capped pig farm
            // neither hands out a pig nor goes on without wheat (no random
            // number is drawn): the farmer waits in mode 0.
            this.s.pigfarming.mode = 0;
          } else if (building.pigsCount() === 8 ||
                     (building.pigsCount() > 3 &&
                      ((20*this.game.randomInt()) >> 16) < building.pigsCount())) {
            /* Pig is ready for the butcher. */
            building.sendPigToButcher();

            this.setState(SerfState.StateMoveResourceOut);
            this.s.moveResourceOut.res = 1 + ResourceType.TypePig;
            this.s.moveResourceOut.resDest = 0;
            this.s.moveResourceOut.nextState = SerfState.StateDropResourceOut;

            /* Update resource stats. */
            const player = this.game.getPlayer(this.getOwner())!;
            player.increaseResCount(ResourceType.TypePig);
          } else if (this.game.randomInt() & 0xf) {
            this.s.pigfarming.mode = 1;
            this.animation = 139;
            this.counter = counterFromAnimation[this.animation];
            this.tick = u16(this.game.getTick());
            this.game.getMap().setSerfIndex(this.pos, this.index);
          } else {
            this.s.pigfarming.mode = 0;
          }
          return;
        } else {
          this.game.getMap().setSerfIndex(this.pos, 0);
          if (building.pigsCount() < 8 &&
              this.game.randomInt() < breedingProb[building.pigsCount()-1]) {
            building.placeNewPig();
          }
          this.counter += 2048;
        }
      }
    }
  }

  protected handleSerfButcheringState(): void {
    const building = this.game.getBuilding(this.game.getMap().getObjIndex(this.pos))!;

    if (this.s.butchering.mode === 0) {
      // EXT: a paused or capped building starts no new round.
      if (building.isProductionHeld()) return;
      if (building.useResourceInStock(0)) {
        this.s.butchering.mode = 1;
        this.animation = 140;
        this.counter = counterFromAnimation[this.animation];
        this.tick = u16(this.game.getTick());

        this.game.getMap().setSerfIndex(this.pos, this.index);
      }
    } else {
      const delta = u16(this.game.getTick() - this.tick);
      this.tick = u16(this.game.getTick());
      this.counter -= delta;

      if (this.counter < 0) {
        /* Done butchering. */
        this.game.getMap().setSerfIndex(this.pos, 0);

        this.setState(SerfState.StateMoveResourceOut);
        this.s.moveResourceOut.res = 1 + ResourceType.TypeMeat;
        this.s.moveResourceOut.resDest = 0;
        this.s.moveResourceOut.nextState = SerfState.StateDropResourceOut;

        /* Update resource stats. */
        const player = this.game.getPlayer(this.getOwner())!;
        player.increaseResCount(ResourceType.TypeMeat);
      }
    }
  }

  protected handleSerfMakingWeaponState(): void {
    const building = this.game.getBuilding(this.game.getMap().getObjIndex(this.pos))!;

    if (this.s.makingWeapon.mode === 0) {
      /* One of each resource makes a sword and a shield.
         Bit 3 is set if a sword has been made and a
         shield can be made without more resources. */
      /* TODO Use of this bit overlaps with sfx check bit. */
      // EXT: a paused weaponsmith starts neither a sword nor the shield
      // that follows it.
      if (building.isProductionHeld()) return;
      if (!building.isPlayingSfx()) {
        if (!building.useResourcesInStocks()) {
          return;
        }
      }

      building.startActivity();

      this.s.makingWeapon.mode = 1;
      this.animation = 143;
      this.counter = counterFromAnimation[this.animation];
      this.tick = u16(this.game.getTick());

      this.game.getMap().setSerfIndex(this.pos, this.index);
    } else {
      const delta = u16(this.game.getTick() - this.tick);
      this.tick = u16(this.game.getTick());
      this.counter -= delta;

      while (this.counter < 0) {
        this.s.makingWeapon.mode += 1;
        if (this.s.makingWeapon.mode === 7) {
          /* Done making sword or shield. */
          building.stopActivity();
          this.game.getMap().setSerfIndex(this.pos, 0);

          const res = building.isPlayingSfx() ? ResourceType.TypeShield :
                                                ResourceType.TypeSword;
          if (building.isPlayingSfx()) {
            building.stopPlayingSfx();
          } else {
            building.startPlayingSfx();
          }

          this.setState(SerfState.StateMoveResourceOut);
          this.s.moveResourceOut.res = 1 + res;
          this.s.moveResourceOut.resDest = 0;
          this.s.moveResourceOut.nextState = SerfState.StateDropResourceOut;

          /* Update resource stats. */
          const player = this.game.getPlayer(this.getOwner())!;
          player.increaseResCount(res);
          return;
        } else {
          this.counter += 576;
        }
      }
    }
  }

  protected handleSerfMakingToolState(): void {
    const building = this.game.getBuilding(this.game.getMap().getObjIndex(this.pos))!;

    if (this.s.makingTool.mode === 0) {
      // EXT: a paused or capped building starts no new round.
      if (building.isProductionHeld()) return;
      if (building.useResourcesInStocks()) {
        this.s.makingTool.mode = 1;
        this.animation = 144;
        this.counter = counterFromAnimation[this.animation];
        this.tick = u16(this.game.getTick());

        this.game.getMap().setSerfIndex(this.pos, this.index);
      }
    } else {
      const delta = u16(this.game.getTick() - this.tick);
      this.tick = u16(this.game.getTick());
      this.counter -= delta;

      while (this.counter < 0) {
        this.s.makingTool.mode += 1;
        if (this.s.makingTool.mode === 4) {
          /* Done making tool. */
          this.game.getMap().setSerfIndex(this.pos, 0);

          const player = this.game.getPlayer(this.getOwner())!;
          let totalToolPrio = 0;
          for (let i = 0; i < 9; i++) totalToolPrio += player.getToolPrio(i);
          totalToolPrio >>= 4;

          let res = -1;
          if (totalToolPrio > 0) {
            /* Use defined tool priorities. */
            let prioOffset = Math.imul(totalToolPrio, this.game.randomInt()) >> 16;
            for (let i = 0; i < 9; i++) {
              prioOffset -= player.getToolPrio(i) >> 4;
              if (prioOffset < 0) {
                res = ResourceType.TypeShovel + i;
                break;
              }
            }
          } else {
            /* Completely random. */
            res = ResourceType.TypeShovel + ((9*this.game.randomInt()) >> 16);
          }

          this.setState(SerfState.StateMoveResourceOut);
          this.s.moveResourceOut.res = 1 + res;
          this.s.moveResourceOut.resDest = 0;
          this.s.moveResourceOut.nextState = SerfState.StateDropResourceOut;

          /* Update resource stats. */
          player.increaseResCount(res as ResourceType);
          return;
        } else {
          this.counter += 1536;
        }
      }
    }
  }

  protected handleSerfBuildingBoatState(): void {
    const map = this.game.getMap();
    const building = this.game.getBuilding(map.getObjIndex(this.pos))!;

    if (this.s.buildingBoat.mode === 0) {
      // EXT: a paused or capped building starts no new round.
      if (building.isProductionHeld()) return;
      if (!building.useResourceInStock(0)) return;
      building.boatClear();

      this.s.buildingBoat.mode = 1;
      this.animation = 146;
      this.counter = counterFromAnimation[this.animation];
      this.tick = u16(this.game.getTick());

      map.setSerfIndex(this.pos, this.index);
    } else {
      const delta = u16(this.game.getTick() - this.tick);
      this.tick = u16(this.game.getTick());
      this.counter -= delta;

      while (this.counter < 0) {
        this.s.buildingBoat.mode += 1;
        if (this.s.buildingBoat.mode === 9) {
          /* Boat done. */
          const newPos = map.moveDownRight(this.pos);
          if (map.hasSerf(newPos)) {
            /* Wait for flag to be free. */
            this.s.buildingBoat.mode -= 1;
            this.counter = 0;
          } else {
            /* Drop boat at flag. */
            building.boatClear();
            map.setSerfIndex(this.pos, 0);

            this.setState(SerfState.StateMoveResourceOut);
            this.s.moveResourceOut.res = 1 + ResourceType.TypeBoat;
            this.s.moveResourceOut.resDest = 0;
            this.s.moveResourceOut.nextState = SerfState.StateDropResourceOut;

            /* Update resource stats. */
            const player = this.game.getPlayer(this.getOwner())!;
            player.increaseResCount(ResourceType.TypeBoat);

            break;
          }
        } else {
          /* Continue building. */
          building.boatDo();
          this.animation = 145;
          this.counter += 1408;
        }
      }
    }
  }

  protected handleSerfLookingForGeoSpotState(): void {
    let tries = 2;
    const map = this.game.getMap();
    for (let i = 0; i < 8; i++) {
      const dist = ((this.game.randomInt() >> 2) & 0x3f) + 1;
      const dest = map.posAddSpirally(this.pos, dist);

      const obj: number = map.getObj(dest);
      if (obj === MapObject.ObjectNone) {
        const t1 = map.typeDown(dest);
        const t2 = map.typeUp(dest);
        const t3 = map.typeDown(map.moveUpLeft(dest));
        const t4 = map.typeUp(map.moveUpLeft(dest));
        if ((t1 >= MapTerrain.TerrainTundra0 && t1 <= MapTerrain.TerrainSnow0) ||
            (t2 >= MapTerrain.TerrainTundra0 && t2 <= MapTerrain.TerrainSnow0) ||
            (t3 >= MapTerrain.TerrainTundra0 && t3 <= MapTerrain.TerrainSnow0) ||
            (t4 >= MapTerrain.TerrainTundra0 && t4 <= MapTerrain.TerrainSnow0)) {
          this.setState(SerfState.StateFreeWalking);
          this.s.freeWalking.distCol = GameMap.getSpiralPattern()[2 * dist];
          this.s.freeWalking.distRow = GameMap.getSpiralPattern()[2 * dist + 1];
          this.s.freeWalking.negDist1 = -GameMap.getSpiralPattern()[2 * dist];
          this.s.freeWalking.negDist2 = -GameMap.getSpiralPattern()[2 * dist + 1];
          this.clearObstacle();
          this.tick = u16(this.game.getTick());
          Log.Verbose('serf', 'looking for geo spot: found, dist ',
                      this.s.freeWalking.distCol, ', ',
                      this.s.freeWalking.distRow, '.');
          return;
        }
      } else if (obj >= MapObject.ObjectSignLargeGold &&
                 obj <= MapObject.ObjectSignEmpty) {
        tries -= 1;
        if (tries === 0) break;
      }
    }

    this.setState(SerfState.StateWalking);
    this.s.walking.dest = 0;
    this.s.walking.dir1 = -2;
    this.s.walking.dir = 0;
    this.s.walking.waitCounter = 0;
    this.counter = 0;
  }

  protected handleSerfSamplingGeoSpotState(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    const map = this.game.getMap();
    while (this.counter < 0) {
      if (this.s.freeWalking.negDist1 === 0 &&
        map.getObj(this.pos) === MapObject.ObjectNone) {
        if (map.getResType(this.pos) === MapMinerals.MineralsNone ||
            map.getResAmount(this.pos) === 0) {
          /* No available resource here. Put empty sign. */
          map.setObject(this.pos, MapObject.ObjectSignEmpty, -1);
        } else {
          this.s.freeWalking.negDist1 = -1;
          this.animation = 142;

          /* Select small or large sign with the right resource depicted. */
          const obj = MapObject.ObjectSignLargeGold +
            2*(map.getResType(this.pos)-1) +
            (map.getResAmount(this.pos) < 12 ? 1 : 0);
          map.setObject(this.pos, obj as MapObject, -1);

          /* Check whether a new notification should be posted. */
          let showNotification = 1;
          for (let i = 0; i < 60; i++) {
            const pos_ = map.posAddSpirally(this.pos, 1+i);
            if ((map.getObj(pos_) >> 1) === (obj >> 1)) {
              showNotification = 0;
              break;
            }
          }

          /* Create notification for found resource. */
          if (showNotification) {
            let mtype: MessageType;
            switch (map.getResType(this.pos)) {
              case MapMinerals.MineralsCoal:
                mtype = MessageType.TypeFoundCoal;
                break;
              case MapMinerals.MineralsIron:
                mtype = MessageType.TypeFoundIron;
                break;
              case MapMinerals.MineralsGold:
                mtype = MessageType.TypeFoundGold;
                break;
              case MapMinerals.MineralsStone:
                mtype = MessageType.TypeFoundStone;
                break;
              default:
                NOT_REACHED();
            }
            this.game.getPlayer(this.getOwner())!.addNotification(mtype, this.pos,
                                                      map.getResType(this.pos) - 1);
          }

          this.counter += 64;
          continue;
        }
      }

      this.setState(SerfState.StateFreeWalking);
      this.s.freeWalking.negDist1 = -128;
      this.s.freeWalking.negDist2 = 0;
      this.clearObstacle();
      this.counter = 0;
    }
  }

  protected handleSerfKnightEngagingBuildingState(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    if (this.counter < 0) {
      const map = this.game.getMap();
      const obj = map.getObj(map.moveUpLeft(this.pos));
      if (obj >= MapObject.ObjectSmallBuilding &&
          obj <= MapObject.ObjectCastle) {
        const building = this.game.getBuilding(map.getObjIndex(
                                               map.moveUpLeft(this.pos)))!;
        if (building.isDone() &&
            building.isMilitary() &&
            building.getOwner() !== this.getOwner() &&
            building.hasKnight()) {
          if (building.isUnderAttack()) {
            this.game.getPlayer(building.getOwner())!.addNotification(
                                                   MessageType.TypeUnderAttack,
                                                         building.getPosition(),
                                                                     this.getOwner());
          }

          /* Change state of attacking knight */
          this.counter = 0;
          this.state = SerfState.StateKnightPrepareAttacking;
          this.animation = 168;

          const defSerf = building.callDefenderOut()!;

          this.s.attacking.defIndex = defSerf.getIndex();

          /* Change state of defending knight */
          this.setOtherState(defSerf, SerfState.StateKnightLeaveForFight);
          defSerf.s.leavingBuilding.nextState = SerfState.StateKnightPrepareDefending;
          defSerf.counter = 0;
          return;
        }
      }

      /* No one to defend this building. Occupy it. */
      this.setState(SerfState.StateKnightOccupyEnemyBuilding);
      this.animation = 179;
      this.counter = counterFromAnimation[this.animation];
      this.tick = u16(this.game.getTick());
    }
  }

  protected setFightOutcome(attacker: Serf, defender: Serf): void {
    /* Calculate "morale" for attacker. */
    const expFactor = 1 << (attacker.getType() - SerfType.TypeKnight0);
    let landFactor = 0x1000;
    if (attacker.getOwner() !== this.game.getMap().getOwner(attacker.pos)) {
      landFactor = this.game.getPlayer(attacker.getOwner())!.getKnightMorale();
    }

    const morale = Math.imul(0x400*expFactor, landFactor) >> 16;

    /* Calculate "morale" for defender. */
    const defExpFactor = 1 << (defender.getType() - SerfType.TypeKnight0);
    let defLandFactor = 0x1000;
    if (defender.getOwner() !== this.game.getMap().getOwner(defender.pos)) {
      defLandFactor =
                     this.game.getPlayer(defender.getOwner())!.getKnightMorale();
    }

    const defMorale = Math.imul(0x400*defExpFactor, defLandFactor) >> 16;

    let player = -1;
    let value = -1;
    const r = Math.imul(morale + defMorale, this.game.randomInt()) >> 16;
    if (r < morale) {
      player = defender.getOwner();
      value = defExpFactor;
      attacker.s.attacking.attackerWon = 1;
      Log.Debug('serf', 'Fight: ', morale, ' vs ', defMorale,
                ' (', r, '). Attacker winning.');
    } else {
      player = attacker.getOwner();
      value = expFactor;
      attacker.s.attacking.attackerWon = 0;
      Log.Debug('serf', 'Fight: ', morale, ' vs ', defMorale,
                ' (', r, '). Defender winning.');
    }

    this.game.getPlayer(player)!.decreaseMilitaryScore(value);
    attacker.s.attacking.move = this.game.randomInt() & 0x70;
  }

  protected handleSerfKnightPrepareAttacking(): void {
    const defSerf = this.game.getSerf(this.s.attacking.defIndex)!;
    if (defSerf.state === SerfState.StateKnightPrepareDefending) {
      /* Change state of attacker. */
      this.setState(SerfState.StateKnightAttacking);
      this.counter = 0;
      this.tick = u16(this.game.getTick());

      /* Change state of defender. */
      this.setOtherState(defSerf, SerfState.StateKnightDefending);
      defSerf.counter = 0;

      this.setFightOutcome(this, defSerf);
    }
  }

  protected handleSerfKnightLeaveForFightState(): void {
    this.tick = u16(this.game.getTick());
    this.counter = 0;

    if (this.game.getMap().getSerfIndex(this.pos) === this.index ||
        !this.game.getMap().hasSerf(this.pos)) {
      this.leaveBuilding(1);
    }
  }

  protected handleSerfKnightPrepareDefendingState(): void {
    this.counter = 0;
    this.animation = 84;
  }

  protected handleKnightAttacking(): void {
    const moves: number[] = [
      1, 2, 4, 2, 0, 2, 4, 2, 1, 0, 2, 2, 3, 0, 0, -1,
      3, 2, 2, 3, 0, 4, 1, 3, 2, 4, 2, 2, 3, 0, 0, -1,
      2, 1, 4, 3, 2, 2, 2, 3, 0, 3, 1, 2, 0, 2, 0, -1,
      2, 1, 3, 2, 4, 2, 3, 0, 0, 4, 2, 0, 2, 1, 0, -1,
      3, 1, 0, 2, 2, 1, 0, 2, 4, 2, 2, 3, 0, 0, -1,
      0, 3, 1, 2, 3, 4, 2, 1, 2, 0, 2, 4, 0, 2, 0, -1,
      0, 2, 1, 2, 4, 2, 3, 0, 2, 4, 3, 2, 0, 0, -1,
      0, 0, 1, 4, 3, 2, 2, 1, 2, 0, 0, 4, 3, 0, -1,
    ];

    const fightAnim: number[] = [
      24, 35, 41, 56, 67, 72, 83, 89, 100, 121, 0, 0, 0, 0, 0, 0,
      26, 40, 42, 57, 73, 74, 88, 104, 106, 120, 122, 0, 0, 0, 0, 0,
      17, 18, 23, 33, 34, 38, 39, 98, 102, 103, 113, 114, 118, 119, 0, 0,
      130, 133, 134, 135, 147, 148, 161, 162, 164, 166, 167, 0, 0, 0, 0, 0,
      50, 52, 53, 70, 129, 131, 132, 146, 149, 151, 0, 0, 0, 0, 0, 0,
    ];

    const fightAnimMax: number[] = [ 10, 11, 14, 11, 10 ];

    const defSerf = this.game.getSerf(this.s.attacking.defIndex)!;

    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    defSerf.tick = this.tick;
    this.counter -= delta;
    defSerf.counter = this.counter;

    while (this.counter < 0) {
      let move = moves[this.s.attacking.move];
      if (move < 0) {
        if (this.s.attacking.attackerWon === 0) {
          /* Defender won. */
          if (this.state === SerfState.StateKnightAttackingFree) {
            this.setOtherState(defSerf, SerfState.StateKnightDefendingVictoryFree);

            defSerf.animation = 180;
            defSerf.counter = 0;

            /* Attacker dies. */
            this.setState(SerfState.StateKnightAttackingDefeatFree);
            this.animation = 152 + this.getType();
            this.counter = 255;
            this.setType(SerfType.TypeDead);
          } else {
            /* Defender returns to building. */
            defSerf.enterBuilding(-1, 1);

            /* Attacker dies. */
            this.setState(SerfState.StateKnightAttackingDefeat);
            this.animation = 152 + this.getType();
            this.counter = 255;
            this.setType(SerfType.TypeDead);
          }
        } else {
          /* Attacker won. */
          if (this.state === SerfState.StateKnightAttackingFree) {
            this.setState(SerfState.StateKnightAttackingVictoryFree);
            this.animation = 168;
            this.counter = 0;

            // UNION ALIAS: attacking_victory_free overlays attacking (move
            // on move, dist_col on attacker_won, dist_row on field_D);
            // def_index keeps the value written as attacking.def_index.
            this.s.attackingVictoryFree.move = defSerf.s.defendingFree.fieldD;
            this.s.attackingVictoryFree.distCol =
                                        defSerf.s.defendingFree.otherDistCol;
            this.s.attackingVictoryFree.distRow =
                                        defSerf.s.defendingFree.otherDistRow;
          } else {
            this.setState(SerfState.StateKnightAttackingVictory);
            this.animation = 168;
            this.counter = 0;

            const obj = this.game.getMap().getObjIndex(
                                    this.game.getMap().moveUpLeft(defSerf.pos));
            const building = this.game.getBuilding(obj)!;
            building.requestedKnightDefeatOnWalk();
          }

          /* Defender dies. */
          defSerf.tick = u16(this.game.getTick());
          defSerf.animation = 147 + this.getType();
          defSerf.counter = 255;
          defSerf.setType(SerfType.TypeDead);
        }
      } else {
        /* Go to next move in fight sequence. */
        this.s.attacking.move += 1;
        if (this.s.attacking.attackerWon === 0) move = 4 - move;
        this.s.attacking.fieldD = move;

        const off = (this.game.randomInt() * fightAnimMax[move]) >> 16;
        const a = fightAnim[move*16 + off];

        this.animation = 146 + ((a >> 4) & 0xf);
        defSerf.animation = 156 + (a & 0xf);
        this.counter = 72 + (this.game.randomInt() & 0x18);
        defSerf.counter = this.counter;
      }
    }
  }

  protected handleSerfKnightAttackingVictoryState(): void {
    const defSerf = this.game.getSerf(this.s.attacking.defIndex)!;

    const delta = u16(this.game.getTick() - defSerf.tick);
    defSerf.tick = u16(this.game.getTick());
    defSerf.counter -= delta;

    if (defSerf.counter < 0) {
      this.game.deleteSerf(defSerf);
      this.s.attacking.defIndex = 0;

      this.setState(SerfState.StateKnightEngagingBuilding);
      this.tick = u16(this.game.getTick());
      this.counter = 0;
    }
  }

  protected handleSerfKnightAttackingDefeatState(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    if (this.counter < 0) {
      this.game.getMap().setSerfIndex(this.pos, 0);
      this.game.deleteSerf(this);
    }
  }

  protected handleKnightOccupyEnemyBuilding(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    if (this.counter >= 0) {
      return;
    }

    const building =
                    this.game.getBuildingAtPos(this.game.getMap().moveUpLeft(this.pos));
    if (building != null) {
      if (!building.isBurning() && building.isMilitary()) {
        if (building.getOwner() === this.owner) {
          /* Enter building if there is space. */
          if (building.getType() === BuildingType.TypeCastle) {
            this.enterBuilding(-2, 0);
            return;
          } else {
            if (building.isEnoughPlaceForKnight()) {
              /* Enter building */
              this.enterBuilding(-1, 0);
              building.knightOccupy();
              return;
            }
          }
        } else if (!building.hasKnight()) {
          /* Occupy the building. */
          this.game.occupyEnemyBuilding(building, this.getOwner());

          if (building.getType() === BuildingType.TypeCastle) {
            this.counter = 0;
          } else {
            /* Enter building */
            this.enterBuilding(-1, 0);
            building.knightOccupy();
          }
          return;
        } else {
          this.setState(SerfState.StateKnightEngagingBuilding);
          this.animation = 167;
          this.counter = 191;
          return;
        }
      }
    }

    /* Something is wrong. */
    this.setState(SerfState.StateLost);
    this.s.lost.fieldB = 0;
    this.counter = 0;
  }

  protected handleStateKnightFreeWalking(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    const map = this.game.getMap();
    while (this.counter < 0) {
      /* Check for enemy knights nearby. */
      for (const d of cycleDirectionsCw()) {
        let pos_ = map.move(this.pos, d);

        if (map.hasSerf(pos_)) {
          const other = this.game.getSerfAtPos(pos_)!;
          // EXT: knights of allies do not fight each other on the way.
          if (this.getOwner() !== other.getOwner() &&
              !this.game.isAllied(this.getOwner(), other.getOwner())) {
            if (other.state === SerfState.StateKnightFreeWalking) {
              pos_ = map.moveLeft(pos_);
              if (this.canPassMapPos(pos_)) {
                // UNION ALIAS: free_walking is read before the state switch
                // and written back as defending_free after it.
                const distCol = this.s.freeWalking.distCol;
                const distRow = this.s.freeWalking.distRow;

                this.setState(SerfState.StateKnightEngageDefendingFree);

                this.s.defendingFree.distCol = distCol;
                this.s.defendingFree.distRow = distRow;
                this.s.defendingFree.otherDistCol = other.s.freeWalking.distCol;
                this.s.defendingFree.otherDistRow = other.s.freeWalking.distRow;
                this.s.defendingFree.fieldD = 1;
                this.animation = 99;
                this.counter = 255;

                // UNION ALIAS: the other knight keeps its free_walking words
                // except the two written here as attacking (field_D over
                // neg_dist1, def_index over neg_dist2).
                this.setOtherState(other, SerfState.StateKnightEngageAttackingFree);
                other.s.attacking.fieldD = d;
                other.s.attacking.defIndex = this.getIndex();
                return;
              }
            } else if (other.state === SerfState.StateWalking &&
                       other.getType() >= SerfType.TypeKnight0 &&
                       other.getType() <= SerfType.TypeKnight4) {
              pos_ = map.moveLeft(pos_);
              if (this.canPassMapPos(pos_)) {
                // UNION ALIAS: as above; other_dist_col and other_dist_row
                // are not written and keep the free_walking words
                // (neg_dist2 and flags).
                const distCol = this.s.freeWalking.distCol;
                const distRow = this.s.freeWalking.distRow;

                this.setState(SerfState.StateKnightEngageDefendingFree);
                this.s.defendingFree.distCol = distCol;
                this.s.defendingFree.distRow = distRow;
                this.s.defendingFree.fieldD = 0;
                this.animation = 99;
                this.counter = 255;

                // PORT: the C++ dereferences the flag and its building
                // unchecked. The knight that is met may walk to a flag whose
                // building is gone (or to no flag); the port threw there in
                // games of computer players. Nothing is requested then.
                const dest = this.game.getFlag(other.s.walking.dest);
                const building = dest !== null ? dest.getBuilding() : null;
                if (building !== null && !building.hasInventory()) {
                  building.requestedKnightAttackingOnWalk();
                }

                // UNION ALIAS: the other knight keeps its walking words
                // except the two written here as attacking (field_D over
                // dir, def_index over wait_counter).
                this.setOtherState(other, SerfState.StateKnightEngageAttackingFree);
                other.s.attacking.fieldD = d;
                other.s.attacking.defIndex = this.getIndex();
                return;
              }
            }
          }
        }
      }

      this.handleFreeWalkingCommon();
    }
  }

  protected handleStateKnightEngageDefendingFree(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    while (this.counter < 0) this.counter += 256;
  }

  protected handleStateKnightEngageAttackingFree(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    if (this.counter < 0) {
      this.setState(SerfState.StateKnightEngageAttackingFreeJoin);
      this.animation = 167;
      this.counter += 191;
    }
  }

  protected handleStateKnightEngageAttackingFreeJoin(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    if (this.counter < 0) {
      this.setState(SerfState.StateKnightPrepareAttackingFree);
      this.animation = 168;
      this.counter = 0;

      const other = this.game.getSerf(this.s.attacking.defIndex)!;
      const otherPos = other.pos;
      this.setOtherState(other, SerfState.StateKnightPrepareDefendingFree);
      other.counter = this.counter;

      /* Adjust distance to final destination. */
      const d = this.s.attacking.fieldD as Direction;
      if (d === Direction.DirectionRight || d === Direction.DirectionDownRight) {
        other.s.defendingFree.distCol -= 1;
      } else if (d === Direction.DirectionLeft || d === Direction.DirectionUpLeft) {
        other.s.defendingFree.distCol += 1;
      }

      if (d === Direction.DirectionDownRight || d === Direction.DirectionDown) {
        other.s.defendingFree.distRow -= 1;
      } else if (d === Direction.DirectionUpLeft || d === Direction.DirectionUp) {
        other.s.defendingFree.distRow += 1;
      }

      other.startWalking(d, 32, 0);
      this.game.getMap().setSerfIndex(otherPos, 0);
    }
  }

  protected handleStateKnightPrepareAttackingFree(): void {
    const other = this.game.getSerf(this.s.attacking.defIndex)!;
    if (other.state === SerfState.StateKnightPrepareDefendingFreeWait) {
      this.setState(SerfState.StateKnightAttackingFree);
      this.counter = 0;

      this.setOtherState(other, SerfState.StateKnightDefendingFree);
      other.counter = 0;

      this.setFightOutcome(this, other);
    }
  }

  protected handleStateKnightPrepareDefendingFree(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    if (this.counter < 0) {
      this.setState(SerfState.StateKnightPrepareDefendingFreeWait);
      this.counter = 0;
    }
  }

  protected handleKnightAttackingVictoryFree(): void {
    const other = this.game.getSerf(this.s.attackingVictoryFree.defIndex)!;

    const delta = u16(this.game.getTick() - other.tick);
    other.tick = u16(this.game.getTick());
    other.counter -= delta;

    if (other.counter < 0) {
      this.game.deleteSerf(other);

      const distCol = this.s.attackingVictoryFree.distCol;
      const distRow = this.s.attackingVictoryFree.distRow;

      this.setState(SerfState.StateKnightAttackingFreeWait);

      this.s.freeWalking.distCol = distCol;
      this.s.freeWalking.distRow = distRow;
      this.s.freeWalking.negDist1 = 0;
      this.s.freeWalking.negDist2 = 0;

      // UNION ALIAS: attacking.move is the word free_walking.dist_col was
      // just written to, so this tests the new dist_col, as in the C++.
      if (this.s.attacking.move !== 0) {
        this.setObstacle(0, false, 1);
      } else {
        this.clearObstacle();
      }

      this.animation = 179;
      this.counter = 127;
      this.tick = u16(this.game.getTick());
    }
  }

  protected handleKnightDefendingVictoryFree(): void {
    this.animation = 180;
    this.counter = 0;
  }

  protected handleSerfKnightAttackingDefeatFreeState(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    if (this.counter < 0) {
      /* Change state of other. */
      const other = this.game.getSerf(this.s.attacking.defIndex)!;
      // UNION ALIAS: defending_free is read before the state switch of the
      // other knight and written back as free_walking after it.
      const distCol = other.s.defendingFree.distCol;
      const distRow = other.s.defendingFree.distRow;

      this.setOtherState(other, SerfState.StateKnightFreeWalking);

      other.s.freeWalking.distCol = distCol;
      other.s.freeWalking.distRow = distRow;
      other.s.freeWalking.negDist1 = 0;
      other.s.freeWalking.negDist2 = 0;
      other.clearObstacle();

      other.animation = 179;
      other.counter = 0;
      other.tick = u16(this.game.getTick());

      /* Remove itself. */
      this.game.getMap().setSerfIndex(this.pos, other.index);
      this.game.deleteSerf(this);
    }
  }

  protected handleKnightAttackingFreeWait(): void {
    const delta = u16(this.game.getTick() - this.tick);
    this.tick = u16(this.game.getTick());
    this.counter -= delta;

    if (this.counter < 0) {
      if (this.s.freeWalking.flags !== 0) {
        this.setState(SerfState.StateKnightFreeWalking);
      } else {
        this.setState(SerfState.StateLost);
      }

      this.counter = 0;
    }
  }

  protected handleSerfStateKnightLeaveForWalkToFight(): void {
    this.tick = u16(this.game.getTick());
    this.counter = 0;

    const map = this.game.getMap();
    if (map.getSerfIndex(this.pos) !== this.index && map.hasSerf(this.pos)) {
      this.animation = 82;
      this.counter = 0;
      return;
    }

    const building = this.game.getBuilding(map.getObjIndex(this.pos))!;
    const newPos = map.moveDownRight(this.pos);

    if (!map.hasSerf(newPos)) {
      /* For clean state change, save the values first. */
      /* TODO maybe knight_leave_for_walk_to_fight can
         share leaving_building state vars. */
      // UNION ALIAS: leave_for_walk_to_fight is read before the state switch
      // and written back as leaving_building after it.
      const distCol = this.s.leaveForWalkToFight.distCol;
      const distRow = this.s.leaveForWalkToFight.distRow;
      const fieldD = this.s.leaveForWalkToFight.fieldD;
      const fieldE = this.s.leaveForWalkToFight.fieldE;
      const nextState = this.s.leaveForWalkToFight.nextState;

      // The C++ passes pos as join_pos here (non-zero unless pos is 0).
      this.leaveBuilding(this.pos);
      /* TODO names for leaving_building vars make no sense here. */
      this.s.leavingBuilding.fieldB = distCol;
      this.s.leavingBuilding.dest = distRow;
      this.s.leavingBuilding.dest2 = fieldD;
      this.s.leavingBuilding.dir = fieldE;
      this.s.leavingBuilding.nextState = nextState;
    } else {
      const other = this.game.getSerfAtPos(newPos)!;
      if (this.getOwner() === other.getOwner()) {
        this.animation = 82;
        this.counter = 0;
      } else {
        /* Go back to defending the building. */
        switch (building.getType()) {
          case BuildingType.TypeHut:
            this.setState(SerfState.StateDefendingHut);
            break;
          case BuildingType.TypeTower:
            this.setState(SerfState.StateDefendingTower);
            break;
          case BuildingType.TypeFortress:
            this.setState(SerfState.StateDefendingFortress);
            break;
          default:
            NOT_REACHED();
            break;
        }

        if (!building.knightComeBackFromFight(this)) {
          this.animation = 82;
          this.counter = 0;
        }
      }
    }
  }

  protected handleSerfIdleOnPathState(): void {
    const flag = this.game.getFlag(this.s.idleOnPath.flag);
    if (flag == null) {
      this.setState(SerfState.StateLost);
      return;
    }
    const revDir = this.s.idleOnPath.revDir;

    /* Set walking dir in field_E. */
    if (flag.isScheduled(revDir)) {
      this.s.idleOnPath.fieldE = (this.tick & 0xff) + 6;
    } else {
      const otherFlag = flag.getOtherEndFlag(revDir);
      const otherDir = flag.getOtherEndDir(revDir);
      if (otherFlag && otherFlag.isScheduled(otherDir)) {
        this.s.idleOnPath.fieldE = reverseDirection(revDir);
      } else {
        return;
      }
    }

    const map = this.game.getMap();
    if (!map.hasSerf(this.pos)) {
      map.clearIdleSerf(this.pos);
      map.setSerfIndex(this.pos, this.index);

      // UNION ALIAS: idle_on_path.field_E is read before the state switch
      // and written back as transporting.dir after it; the word itself
      // stays behind as transporting.dest.
      const dir = this.s.idleOnPath.fieldE;

      this.setState(SerfState.StateTransporting);
      this.s.transporting.res = ResourceType.TypeNone;
      this.s.transporting.waitCounter = 0;
      this.s.transporting.dir = dir;
      this.tick = u16(this.game.getTick());
      this.counter = 0;
    } else {
      this.setState(SerfState.StateWaitIdleOnPath);
    }
  }

  protected handleSerfWaitIdleOnPathState(): void {
    const map = this.game.getMap();
    if (!map.hasSerf(this.pos)) {
      /* Duplicate code from handle_serf_idle_on_path_state() */
      map.clearIdleSerf(this.pos);
      map.setSerfIndex(this.pos, this.index);

      // UNION ALIAS: as in handleSerfIdleOnPathState().
      const dir = this.s.idleOnPath.fieldE;

      this.setState(SerfState.StateTransporting);
      this.s.transporting.res = ResourceType.TypeNone;
      this.s.transporting.waitCounter = 0;
      this.s.transporting.dir = dir;
      this.tick = u16(this.game.getTick());
      this.counter = 0;
    }
  }

  protected handleScatterState(): void {
    /* Choose a random, empty destination */
    while (1) {
      const r = this.game.randomInt();
      let col = (r & 0xf);
      if (col < 8) col -= 16;
      let row = ((r >> 8) & 0xf);
      if (row < 8) row -= 16;

      const map = this.game.getMap();
      const dest = map.posAdd(this.pos, col, row);
      if (map.getObj(dest) === 0 && map.getHeight(dest) > 0) {
        if (this.getType() >= SerfType.TypeKnight0 && this.getType() <= SerfType.TypeKnight4) {
          this.setState(SerfState.StateKnightFreeWalking);
        } else {
          this.setState(SerfState.StateFreeWalking);
        }

        this.s.freeWalking.distCol = col;
        this.s.freeWalking.distRow = row;
        this.s.freeWalking.negDist1 = -128;
        this.s.freeWalking.negDist2 = -1;
        this.clearObstacle();
        this.counter = 0;
        return;
      }
    }
  }

  protected handleSerfFinishedBuildingState(): void {
    const map = this.game.getMap();
    if (!map.hasSerf(map.moveDownRight(this.pos))) {
      this.setState(SerfState.StateReadyToLeave);
      this.s.leavingBuilding.dest = 0;
      this.s.leavingBuilding.fieldB = -2;
      this.s.leavingBuilding.dir = 0;
      this.s.leavingBuilding.nextState = SerfState.StateWalking;

      if (map.getSerfIndex(this.pos) !== this.index && map.hasSerf(this.pos)) {
        this.animation = 82;
      }
    }
  }

  protected handleSerfWakeAtFlagState(): void {
    const map = this.game.getMap();
    if (!map.hasSerf(this.pos)) {
      map.clearIdleSerf(this.pos);
      map.setSerfIndex(this.pos, this.index);
      this.tick = u16(this.game.getTick());
      this.counter = 0;

      if (this.getType() === SerfType.TypeSailor) {
        this.setState(SerfState.StateLostSailor);
      } else {
        this.setState(SerfState.StateLost);
        this.s.lost.fieldB = 0;
      }
    }
  }

  protected handleSerfWakeOnPathState(): void {
    this.setState(SerfState.StateWaitIdleOnPath);

    for (const d of cycleDirectionsCcw()) {
      if (BIT_TEST(this.game.getMap().paths(this.pos), d)) {
        this.s.idleOnPath.fieldE = d;
        break;
      }
    }
  }

  protected handleSerfDefendingState(trainingParams: number[]): void {
    switch (this.getType()) {
    case SerfType.TypeKnight0:
    case SerfType.TypeKnight1:
    case SerfType.TypeKnight2:
    case SerfType.TypeKnight3:
      this.trainKnight(trainingParams[this.getType()-SerfType.TypeKnight0]);
      // PORT: falls through into the TypeKnight4 case in the C++, which
      // only breaks.
      break;
    case SerfType.TypeKnight4: /* Cannot train anymore. */
      break;
    default:
      NOT_REACHED();
      break;
    }
  }

  protected handleSerfDefendingHutState(): void {
    const trainingParams: number[] = [ 250, 125, 62, 31 ];
    this.handleSerfDefendingState(trainingParams);
  }

  protected handleSerfDefendingTowerState(): void {
    const trainingParams: number[] = [ 1000, 500, 250, 125 ];
    this.handleSerfDefendingState(trainingParams);
  }

  protected handleSerfDefendingFortressState(): void {
    const trainingParams: number[] = [ 2000, 1000, 500, 250 ];
    this.handleSerfDefendingState(trainingParams);
  }

  protected handleSerfDefendingCastleState(): void {
    const trainingParams: number[] = [ 4000, 2000, 1000, 500 ];
    this.handleSerfDefendingState(trainingParams);
  }

  update(): void {
    switch (this.state) {
    case SerfState.StateNull: /* 0 */
      break;
    case SerfState.StateWalking:
      this.handleSerfWalkingState();
      break;
    case SerfState.StateTransporting:
      this.handleSerfTransportingState();
      break;
    case SerfState.StateIdleInStock:
      this.handleSerfIdleInStockState();
      break;
    case SerfState.StateEnteringBuilding:
      this.handleSerfEnteringBuildingState();
      break;
    case SerfState.StateLeavingBuilding: /* 5 */
      this.handleSerfLeavingBuildingState();
      break;
    case SerfState.StateReadyToEnter:
      this.handleSerfReadyToEnterState();
      break;
    case SerfState.StateReadyToLeave:
      this.handleSerfReadyToLeaveState();
      break;
    case SerfState.StateDigging:
      this.handleSerfDiggingState();
      break;
    case SerfState.StateBuilding:
      this.handleSerfBuildingState();
      break;
    case SerfState.StateBuildingCastle: /* 10 */
      this.handleSerfBuildingCastleState();
      break;
    case SerfState.StateMoveResourceOut:
      this.handleSerfMoveResourceOutState();
      break;
    case SerfState.StateWaitForResourceOut:
      this.handleSerfWaitForResourceOutState();
      break;
    case SerfState.StateDropResourceOut:
      this.handleSerfDropResourceOutState();
      break;
    case SerfState.StateDelivering:
      this.handleSerfDeliveringState();
      break;
    case SerfState.StateReadyToLeaveInventory: /* 15 */
      this.handleSerfReadyToLeaveInventoryState();
      break;
    case SerfState.StateFreeWalking:
      this.handleSerfFreeWalkingState();
      break;
    case SerfState.StateLogging:
      this.handleSerfLoggingState();
      break;
    case SerfState.StatePlanningLogging:
      this.handleSerfPlanningLoggingState();
      break;
    case SerfState.StatePlanningPlanting:
      this.handleSerfPlanningPlantingState();
      break;
    case SerfState.StatePlanting: /* 20 */
      this.handleSerfPlantingState();
      break;
    case SerfState.StatePlanningStoneCutting:
      this.handleSerfPlanningStonecutting();
      break;
    case SerfState.StateStoneCutterFreeWalking:
      this.handleStonecutterFreeWalking();
      break;
    case SerfState.StateStoneCutting:
      this.handleSerfStonecuttingState();
      break;
    case SerfState.StateSawing:
      this.handleSerfSawingState();
      break;
    case SerfState.StateLost: /* 25 */
      this.handleSerfLostState();
      break;
    case SerfState.StateLostSailor:
      this.handleLostSailor();
      break;
    case SerfState.StateFreeSailing:
      this.handleFreeSailing();
      break;
    case SerfState.StateEscapeBuilding:
      this.handleSerfEscapeBuildingState();
      break;
    case SerfState.StateMining:
      this.handleSerfMiningState();
      break;
    case SerfState.StateSmelting: /* 30 */
      this.handleSerfSmeltingState();
      break;
    case SerfState.StatePlanningFishing:
      this.handleSerfPlanningFishingState();
      break;
    case SerfState.StateFishing:
      this.handleSerfFishingState();
      break;
    case SerfState.StatePlanningFarming:
      this.handleSerfPlanningFarmingState();
      break;
    case SerfState.StateFarming:
      this.handleSerfFarmingState();
      break;
    case SerfState.StateMilling: /* 35 */
      this.handleSerfMillingState();
      break;
    case SerfState.StateBaking:
      this.handleSerfBakingState();
      break;
    case SerfState.StatePigFarming:
      this.handleSerfPigfarmingState();
      break;
    case SerfState.StateButchering:
      this.handleSerfButcheringState();
      break;
    case SerfState.StateMakingWeapon:
      this.handleSerfMakingWeaponState();
      break;
    case SerfState.StateMakingTool: /* 40 */
      this.handleSerfMakingToolState();
      break;
    case SerfState.StateBuildingBoat:
      this.handleSerfBuildingBoatState();
      break;
    case SerfState.StateLookingForGeoSpot:
      this.handleSerfLookingForGeoSpotState();
      break;
    case SerfState.StateSamplingGeoSpot:
      this.handleSerfSamplingGeoSpotState();
      break;
    case SerfState.StateKnightEngagingBuilding:
      this.handleSerfKnightEngagingBuildingState();
      break;
    case SerfState.StateKnightPrepareAttacking: /* 45 */
      this.handleSerfKnightPrepareAttacking();
      break;
    case SerfState.StateKnightLeaveForFight:
      this.handleSerfKnightLeaveForFightState();
      break;
    case SerfState.StateKnightPrepareDefending:
      this.handleSerfKnightPrepareDefendingState();
      break;
    case SerfState.StateKnightAttacking:
    case SerfState.StateKnightAttackingFree:
      this.handleKnightAttacking();
      break;
    case SerfState.StateKnightDefending:
    case SerfState.StateKnightDefendingFree:
      /* The actual fight update is handled for the attacking knight. */
      break;
    case SerfState.StateKnightAttackingVictory: /* 50 */
      this.handleSerfKnightAttackingVictoryState();
      break;
    case SerfState.StateKnightAttackingDefeat:
      this.handleSerfKnightAttackingDefeatState();
      break;
    case SerfState.StateKnightOccupyEnemyBuilding:
      this.handleKnightOccupyEnemyBuilding();
      break;
    case SerfState.StateKnightFreeWalking:
      this.handleStateKnightFreeWalking();
      break;
    case SerfState.StateKnightEngageDefendingFree:
      this.handleStateKnightEngageDefendingFree();
      break;
    case SerfState.StateKnightEngageAttackingFree:
      this.handleStateKnightEngageAttackingFree();
      break;
    case SerfState.StateKnightEngageAttackingFreeJoin:
      this.handleStateKnightEngageAttackingFreeJoin();
      break;
    case SerfState.StateKnightPrepareAttackingFree:
      this.handleStateKnightPrepareAttackingFree();
      break;
    case SerfState.StateKnightPrepareDefendingFree:
      this.handleStateKnightPrepareDefendingFree();
      break;
    case SerfState.StateKnightPrepareDefendingFreeWait:
      /* Nothing to do for this state. */
      break;
    case SerfState.StateKnightAttackingVictoryFree:
      this.handleKnightAttackingVictoryFree();
      break;
    case SerfState.StateKnightDefendingVictoryFree:
      this.handleKnightDefendingVictoryFree();
      break;
    case SerfState.StateKnightAttackingDefeatFree:
      this.handleSerfKnightAttackingDefeatFreeState();
      break;
    case SerfState.StateKnightAttackingFreeWait:
      this.handleKnightAttackingFreeWait();
      break;
    case SerfState.StateKnightLeaveForWalkToFight: /* 65 */
      this.handleSerfStateKnightLeaveForWalkToFight();
      break;
    case SerfState.StateIdleOnPath:
      this.handleSerfIdleOnPathState();
      break;
    case SerfState.StateWaitIdleOnPath:
      this.handleSerfWaitIdleOnPathState();
      break;
    case SerfState.StateWakeAtFlag:
      this.handleSerfWakeAtFlagState();
      break;
    case SerfState.StateWakeOnPath:
      this.handleSerfWakeOnPathState();
      break;
    case SerfState.StateDefendingHut: /* 70 */
      this.handleSerfDefendingHutState();
      break;
    case SerfState.StateDefendingTower:
      this.handleSerfDefendingTowerState();
      break;
    case SerfState.StateDefendingFortress:
      this.handleSerfDefendingFortressState();
      break;
    case SerfState.StateScatter:
      this.handleScatterState();
      break;
    case SerfState.StateFinishedBuilding:
      this.handleSerfFinishedBuildingState();
      break;
    case SerfState.StateDefendingCastle: /* 75 */
      this.handleSerfDefendingCastleState();
      break;
    default:
      Log.Debug('serf', 'Serf state ', this.state, " isn't processed");
      this.state = SerfState.StateNull;
    }
  }

  // PORT: operator >> (SaveReaderBinary &reader, Serf &serf), the reader of
  // the save games of the original DOS game, is not ported.

  loadText(reader: SaveReaderText): void {
    const type = reader.value('type').readInt();
    try {
      this.owner = reader.value('owner').readUint();
      this.type = type as SerfType;
    } catch (e) {
      this.type = ((type >> 2) & 0x1f) as SerfType;
      this.owner = type & 3;
    }

    this.animation = reader.value('animation').readInt();
    this.counter = reader.value('counter').readInt();
    const x = reader.value('pos').at(0).readInt();
    const y = reader.value('pos').at(1).readInt();
    this.pos = this.getGame().getMap().pos(x, y);
    this.tick = reader.value('tick').readU16();
    this.state = reader.value('state').readInt();
    /* Older saves have only the values of the current state. */
    if (reader.hasValue('state.raw')) {
      const rawValue = reader.value('state.raw');
      // PORT: the raw words are this.s.w (the shared storage of the union).
      // SaveReaderTextValue has no size() here; at(i) throws at
      // i >= size(), which ends the loop as `i < raw_value.size()` does.
      const raw = this.s.w;
      for (let i = 0; i < raw.length; i++) {
        let part;
        try {
          part = rawValue.at(i);
        } catch (e) {
          break;
        }
        raw[i] = part.readInt();
      }
    }

    switch (this.state) {
      case SerfState.StateIdleInStock:
        this.s.idleInStock.invIndex = reader.value('state.inventory').readUint();
        break;

      case SerfState.StateWalking:
        this.s.walking.dest = reader.value('state.dest').readUint();
        this.s.walking.dir = reader.value('state.dir').readInt();
        this.s.walking.waitCounter = reader.value('state.wait_counter').readInt();
        this.s.walking.dir1 = reader.value('state.other_dir').readInt();
        break;

      case SerfState.StateTransporting:
      case SerfState.StateDelivering:
        this.s.transporting.res = reader.value('state.res').readInt();
        this.s.transporting.dest = reader.value('state.dest').readUint();
        this.s.transporting.dir = reader.value('state.dir').readInt();
        this.s.transporting.waitCounter = reader.value('state.wait_counter').readInt();
        break;

      case SerfState.StateEnteringBuilding:
        this.s.enteringBuilding.fieldB = reader.value('state.field_B').readInt();
        this.s.enteringBuilding.slopeLen = reader.value('state.slope_len').readInt();
        break;

      case SerfState.StateLeavingBuilding:
      case SerfState.StateReadyToLeave:
      case SerfState.StateKnightLeaveForFight:
        this.s.leavingBuilding.fieldB = reader.value('state.field_B').readInt();
        this.s.leavingBuilding.dest = reader.value('state.dest').readUint();
        this.s.leavingBuilding.dest2 = reader.value('state.dest2').readInt();
        this.s.leavingBuilding.dir = reader.value('state.dir').readInt();
        this.s.leavingBuilding.nextState = reader.value('state.next_state').readInt();
        break;

      case SerfState.StateReadyToEnter:
        this.s.readyToEnter.fieldB = reader.value('state.field_B').readInt();
        break;

      case SerfState.StateDigging:
        this.s.digging.hIndex = reader.value('state.h_index').readInt();
        this.s.digging.targetH = reader.value('state.target_h').readUint();
        this.s.digging.digPos = reader.value('state.dig_pos').readInt();
        this.s.digging.substate = reader.value('state.substate').readInt();
        break;

      case SerfState.StateBuilding:
        this.s.building.mode = reader.value('state.mode').readInt();
        this.s.building.bldIndex = reader.value('state.bld_index').readUint();
        this.s.building.materialStep = reader.value('state.material_step').readUint();
        this.s.building.counter = reader.value('state.counter').readUint();
        break;

      case SerfState.StateBuildingCastle:
        this.s.buildingCastle.invIndex = reader.value('state.inv_index').readUint();
        break;

      case SerfState.StateMoveResourceOut:
      case SerfState.StateDropResourceOut:
        this.s.moveResourceOut.res = reader.value('state.res').readUint();
        this.s.moveResourceOut.resDest = reader.value('state.res_dest').readUint();
        this.s.moveResourceOut.nextState = reader.value('state.next_state').readInt();
        break;

      case SerfState.StateReadyToLeaveInventory:
        this.s.readyToLeaveInventory.mode = reader.value('state.mode').readInt();
        this.s.readyToLeaveInventory.dest = reader.value('state.dest').readUint();
        this.s.readyToLeaveInventory.invIndex = reader.value('state.inv_index').readUint();
        break;

      case SerfState.StateFreeWalking:
      case SerfState.StateLogging:
      case SerfState.StatePlanting:
      case SerfState.StateStoneCutting:
      case SerfState.StateStoneCutterFreeWalking:
      case SerfState.StateFishing:
      case SerfState.StateFarming:
      case SerfState.StateSamplingGeoSpot:
      case SerfState.StateKnightFreeWalking:
      case SerfState.StateKnightAttackingFree:
      case SerfState.StateKnightAttackingFreeWait:
        if (reader.hasValue('state.dist_col')) {
          this.s.freeWalking.distCol = reader.value('state.dist_col').readInt();
        } else {
          this.s.freeWalking.distCol = reader.value('state.dist1').readInt();
        }
        if (reader.hasValue('state.dist_row')) {
          this.s.freeWalking.distRow = reader.value('state.dist_row').readInt();
        } else {
          this.s.freeWalking.distRow = reader.value('state.dist2').readInt();
        }
        this.s.freeWalking.negDist1 = reader.value('state.neg_dist').readInt();
        this.s.freeWalking.negDist2 = reader.value('state.neg_dist2').readInt();
        this.s.freeWalking.flags = reader.value('state.flags').readInt();
        break;

      case SerfState.StateSawing:
        this.s.sawing.mode = reader.value('state.mode').readInt();
        break;

      case SerfState.StateLost:
        this.s.lost.fieldB = reader.value('state.field_B').readInt();
        break;

      case SerfState.StateMining:
        this.s.mining.substate = reader.value('state.substate').readUint();
        this.s.mining.res = reader.value('state.res').readInt();
        const deposit = reader.value('state.deposit').readUint();
        this.s.mining.deposit = deposit as MapMinerals;
        break;

      case SerfState.StateSmelting:
        this.s.smelting.mode = reader.value('state.mode').readInt();
        this.s.smelting.counter = reader.value('state.counter').readInt();
        this.s.smelting.type = reader.value('state.type').readUint();
        break;

      case SerfState.StateMilling:
        this.s.milling.mode = reader.value('state.mode').readInt();
        break;

      case SerfState.StateBaking:
        this.s.baking.mode = reader.value('state.mode').readInt();
        break;

      case SerfState.StatePigFarming:
        this.s.pigfarming.mode = reader.value('state.mode').readInt();
        break;

      case SerfState.StateButchering:
        this.s.butchering.mode = reader.value('state.mode').readInt();
        break;

      case SerfState.StateMakingWeapon:
        this.s.makingWeapon.mode = reader.value('state.mode').readInt();
        break;

      case SerfState.StateMakingTool:
        this.s.makingTool.mode = reader.value('state.mode').readInt();
        break;

      case SerfState.StateBuildingBoat:
        this.s.buildingBoat.mode = reader.value('state.mode').readInt();
        break;

      case SerfState.StateKnightEngagingBuilding:
      case SerfState.StateKnightPrepareAttacking:
      case SerfState.StateKnightPrepareDefendingFreeWait:
      case SerfState.StateKnightAttackingDefeatFree:
      case SerfState.StateKnightAttacking:
      case SerfState.StateKnightAttackingVictory:
      case SerfState.StateKnightEngageAttackingFree:
      case SerfState.StateKnightEngageAttackingFreeJoin:
        if (reader.hasValue('state.move')) {
          this.s.attacking.move = reader.value('state.move').readInt();
        } else {
          this.s.attacking.move = reader.value('state.field_B').readInt();
        }
        if (reader.hasValue('state.attacker_won')) {
          this.s.attacking.attackerWon = reader.value('state.attacker_won').readInt();
        } else {
          this.s.attacking.attackerWon = reader.value('state.field_C').readInt();
        }
        this.s.attacking.fieldD = reader.value('state.field_D').readInt();
        this.s.attacking.defIndex = reader.value('state.def_index').readInt();
        break;

      case SerfState.StateKnightAttackingVictoryFree:
        // PORT: the writer saves this state with the values of the
        // attacking group (no dist_col, dist_row or field_C), so the C++
        // fails to load its own file here. Such a file keeps the words of
        // "state.raw", read above.
        if (reader.hasValue('state.attacker_won') && !reader.hasValue('state.dist_col') &&
            !reader.hasValue('state.field_C')) {
          break;
        }
        if (reader.hasValue('state.move')) {
          this.s.attackingVictoryFree.move = reader.value('state.move').readInt();
        } else {
          this.s.attackingVictoryFree.move = reader.value('state.field_B').readInt();
        }
        if (reader.hasValue('state.dist_col')) {
          this.s.attackingVictoryFree.distCol = reader.value('state.dist_col').readInt();
        } else {
          this.s.attackingVictoryFree.distCol = reader.value('state.field_C').readInt();
        }
        if (reader.hasValue('state.dist_row')) {
          this.s.attackingVictoryFree.distRow = reader.value('state.dist_row').readInt();
        } else {
          this.s.attackingVictoryFree.distRow = reader.value('state.field_D').readInt();
        }
        this.s.attackingVictoryFree.defIndex = reader.value('state.def_index').readInt();
        break;

      case SerfState.StateKnightDefendingFree:
      case SerfState.StateKnightEngageDefendingFree:
        this.s.defendingFree.distCol = reader.value('state.dist_col').readInt();
        this.s.defendingFree.distRow = reader.value('state.dist_row').readInt();
        this.s.defendingFree.fieldD = reader.value('state.field_D').readInt();
        this.s.defendingFree.otherDistCol = reader.value('state.other_dist_col').readInt();
        this.s.defendingFree.otherDistRow = reader.value('state.other_dist_row').readInt();
        break;

      case SerfState.StateKnightLeaveForWalkToFight:
        this.s.leaveForWalkToFight.distCol = reader.value('state.dist_col').readInt();
        this.s.leaveForWalkToFight.distRow = reader.value('state.dist_row').readInt();
        this.s.leaveForWalkToFight.fieldD = reader.value('state.field_D').readInt();
        this.s.leaveForWalkToFight.fieldE = reader.value('state.field_E').readInt();
        this.s.leaveForWalkToFight.nextState = reader.value('state.next_state').readInt();
        break;

      case SerfState.StateIdleOnPath:
      case SerfState.StateWaitIdleOnPath:
      case SerfState.StateWakeAtFlag:
      case SerfState.StateWakeOnPath:
        this.s.idleOnPath.revDir = reader.value('state.rev_dir').readInt();
        const flagIdex = reader.value('state.flag').readUint();
        this.s.idleOnPath.flag = i32(flagIdex);
        this.s.idleOnPath.fieldE = reader.value('state.field_E').readInt();
        break;

      case SerfState.StateDefendingHut:
      case SerfState.StateDefendingTower:
      case SerfState.StateDefendingFortress:
      case SerfState.StateDefendingCastle:
        this.s.defending.nextKnight = reader.value('state.next_knight').readInt();
        break;

      default:
        break;
    }
  }

  saveText(writer: SaveWriterText): void {
    writer.value('type').write(this.type);
    writer.value('owner').write(this.owner);
    writer.value('animation').write(this.animation);
    writer.value('counter').write(this.counter);
    writer.value('pos').write(this.getGame().getMap().posCol(this.pos));
    writer.value('pos').write(this.getGame().getMap().posRow(this.pos));
    writer.value('tick').write(this.tick);
    writer.value('state').write(this.state);
    /* The whole memory of the states: a state may go on with the values that
       an earlier state left in it, as in the original. */
    // PORT: static_assert(sizeof(serf.s) % sizeof(int) == 0): the union is
    // an Int32Array here.
    const raw = this.s.w;
    for (let i = 0; i < raw.length; i++) {
      writer.value('state.raw').write(raw[i]);
    }

    switch (this.state) {
      case SerfState.StateIdleInStock:
        writer.value('state.inventory').write(this.s.idleInStock.invIndex);
        break;

      case SerfState.StateWalking:
        writer.value('state.dest').write(this.s.walking.dest);
        writer.value('state.dir').write(this.s.walking.dir);
        writer.value('state.wait_counter').write(this.s.walking.waitCounter);
        writer.value('state.other_dir').write(this.s.walking.dir1);
        break;

      case SerfState.StateTransporting:
      case SerfState.StateDelivering:
        writer.value('state.res').write(this.s.transporting.res);
        writer.value('state.dest').write(this.s.transporting.dest);
        writer.value('state.dir').write(this.s.transporting.dir);
        writer.value('state.wait_counter').write(this.s.transporting.waitCounter);
        break;

      case SerfState.StateEnteringBuilding:
        writer.value('state.field_B').write(this.s.enteringBuilding.fieldB);
        writer.value('state.slope_len').write(this.s.enteringBuilding.slopeLen);
        break;

      case SerfState.StateLeavingBuilding:
      case SerfState.StateReadyToLeave:
      case SerfState.StateKnightLeaveForFight:
        writer.value('state.field_B').write(this.s.leavingBuilding.fieldB);
        writer.value('state.dest').write(this.s.leavingBuilding.dest);
        writer.value('state.dest2').write(this.s.leavingBuilding.dest2);
        writer.value('state.dir').write(this.s.leavingBuilding.dir);
        writer.value('state.next_state').write(this.s.leavingBuilding.nextState);
        break;

      case SerfState.StateReadyToEnter:
        writer.value('state.field_B').write(this.s.readyToEnter.fieldB);
        break;

      case SerfState.StateDigging:
        writer.value('state.h_index').write(this.s.digging.hIndex);
        writer.value('state.target_h').write(this.s.digging.targetH);
        writer.value('state.dig_pos').write(this.s.digging.digPos);
        writer.value('state.substate').write(this.s.digging.substate);
        break;

      case SerfState.StateBuilding:
        writer.value('state.mode').write(this.s.building.mode);
        writer.value('state.bld_index').write(this.s.building.bldIndex);
        writer.value('state.material_step').write(this.s.building.materialStep);
        writer.value('state.counter').write(this.s.building.counter);
        break;

      case SerfState.StateBuildingCastle:
        writer.value('state.inv_index').write(this.s.buildingCastle.invIndex);
        break;

      case SerfState.StateMoveResourceOut:
      case SerfState.StateDropResourceOut:
        writer.value('state.res').write(this.s.moveResourceOut.res);
        writer.value('state.res_dest').write(this.s.moveResourceOut.resDest);
        writer.value('state.next_state').write(this.s.moveResourceOut.nextState);
        break;

      case SerfState.StateReadyToLeaveInventory:
        writer.value('state.mode').write(this.s.readyToLeaveInventory.mode);
        writer.value('state.dest').write(this.s.readyToLeaveInventory.dest);
        writer.value('state.inv_index').write(this.s.readyToLeaveInventory.invIndex);
        break;

      case SerfState.StateFreeWalking:
      case SerfState.StateLogging:
      case SerfState.StatePlanting:
      case SerfState.StateStoneCutting:
      case SerfState.StateStoneCutterFreeWalking:
      case SerfState.StateFishing:
      case SerfState.StateFarming:
      case SerfState.StateSamplingGeoSpot:
      case SerfState.StateKnightFreeWalking:
      case SerfState.StateKnightAttackingFree:
      case SerfState.StateKnightAttackingFreeWait:
        writer.value('state.dist_col').write(this.s.freeWalking.distCol);
        writer.value('state.dist_row').write(this.s.freeWalking.distRow);
        writer.value('state.neg_dist').write(this.s.freeWalking.negDist1);
        writer.value('state.neg_dist2').write(this.s.freeWalking.negDist2);
        writer.value('state.flags').write(this.s.freeWalking.flags);
        break;

      case SerfState.StateSawing:
        writer.value('state.mode').write(this.s.sawing.mode);
        break;

      case SerfState.StateLost:
        writer.value('state.field_B').write(this.s.lost.fieldB);
        break;

      case SerfState.StateMining:
        writer.value('state.substate').write(this.s.mining.substate);
        writer.value('state.res').write(this.s.mining.res);
        writer.value('state.deposit').write(this.s.mining.deposit);
        break;

      case SerfState.StateSmelting:
        writer.value('state.mode').write(this.s.smelting.mode);
        writer.value('state.counter').write(this.s.smelting.counter);
        writer.value('state.type').write(this.s.smelting.type);
        break;

      case SerfState.StateMilling:
        writer.value('state.mode').write(this.s.milling.mode);
        break;

      case SerfState.StateBaking:
        writer.value('state.mode').write(this.s.baking.mode);
        break;

      case SerfState.StatePigFarming:
        writer.value('state.mode').write(this.s.pigfarming.mode);
        break;

      case SerfState.StateButchering:
        writer.value('state.mode').write(this.s.butchering.mode);
        break;

      case SerfState.StateMakingWeapon:
        writer.value('state.mode').write(this.s.makingWeapon.mode);
        break;

      case SerfState.StateMakingTool:
        writer.value('state.mode').write(this.s.makingTool.mode);
        break;

      case SerfState.StateBuildingBoat:
        writer.value('state.mode').write(this.s.buildingBoat.mode);
        break;

      case SerfState.StateKnightEngagingBuilding:
      case SerfState.StateKnightPrepareAttacking:
      case SerfState.StateKnightPrepareDefendingFreeWait:
      case SerfState.StateKnightAttackingDefeatFree:
      case SerfState.StateKnightAttacking:
      case SerfState.StateKnightAttackingVictory:
      case SerfState.StateKnightEngageAttackingFree:
      case SerfState.StateKnightEngageAttackingFreeJoin:
      case SerfState.StateKnightAttackingVictoryFree:
        writer.value('state.move').write(this.s.attacking.move);
        writer.value('state.attacker_won').write(this.s.attacking.attackerWon);
        writer.value('state.field_D').write(this.s.attacking.fieldD);
        writer.value('state.def_index').write(this.s.attacking.defIndex);
        break;

      case SerfState.StateKnightDefendingFree:
      case SerfState.StateKnightEngageDefendingFree:
        writer.value('state.dist_col').write(this.s.defendingFree.distCol);
        writer.value('state.dist_row').write(this.s.defendingFree.distRow);
        writer.value('state.field_D').write(this.s.defendingFree.fieldD);
        writer.value('state.other_dist_col').write(this.s.defendingFree.otherDistCol);
        writer.value('state.other_dist_row').write(this.s.defendingFree.otherDistRow);
        break;

      case SerfState.StateKnightLeaveForWalkToFight:
        writer.value('state.dist_col').write(this.s.leaveForWalkToFight.distCol);
        writer.value('state.dist_row').write(this.s.leaveForWalkToFight.distRow);
        writer.value('state.field_D').write(this.s.leaveForWalkToFight.fieldD);
        writer.value('state.field_E').write(this.s.leaveForWalkToFight.fieldE);
        writer.value('state.next_state').write(this.s.leaveForWalkToFight.nextState);
        break;

      case SerfState.StateIdleOnPath:
      case SerfState.StateWaitIdleOnPath:
      case SerfState.StateWakeAtFlag:
      case SerfState.StateWakeOnPath:
        writer.value('state.rev_dir').write(this.s.idleOnPath.revDir);
        writer.value('state.flag').write(this.s.idleOnPath.flag);
        writer.value('state.field_E').write(this.s.idleOnPath.fieldE);
        break;

      case SerfState.StateDefendingHut:
      case SerfState.StateDefendingTower:
      case SerfState.StateDefendingFortress:
      case SerfState.StateDefendingCastle:
        writer.value('state.next_knight').write(this.s.defending.nextKnight);
        break;

      default: break;
    }
  }

  printState(): string {
    let res = '';

    res += Serf.getStateName(this.state) + '\n';

    switch (this.state) {
      case SerfState.StateIdleInStock:
        res += 'inventory' + '\t' + this.s.idleInStock.invIndex + '\n';
        break;

      case SerfState.StateWalking:
        res += 'dest' + '\t' + this.s.walking.dest + '\n';
        res += 'dir' + '\t' + this.s.walking.dir + '\n';
        res += 'wait_counter' + '\t' + this.s.walking.waitCounter + '\n';
        res += 'other_dir' + '\t' + this.s.walking.dir1 + '\n';
        break;

      case SerfState.StateTransporting:
      case SerfState.StateDelivering:
        res += 'res' + '\t' + this.s.transporting.res + '\n';
        res += 'dest' + '\t' + this.s.transporting.dest + '\n';
        res += 'dir' + '\t' + this.s.transporting.dir + '\n';
        res += 'wait_counter' + '\t' + this.s.transporting.waitCounter + '\n';
        break;

      case SerfState.StateEnteringBuilding:
        res += 'field_B' + '\t' + this.s.enteringBuilding.fieldB + '\n';
        res += 'slope_len' + '\t' + this.s.enteringBuilding.slopeLen + '\n';
        break;

      case SerfState.StateLeavingBuilding:
      case SerfState.StateReadyToLeave:
      case SerfState.StateKnightLeaveForFight:
        res += 'field_B' + '\t' + this.s.leavingBuilding.fieldB + '\n';
        res += 'dest' + '\t' + this.s.leavingBuilding.dest + '\n';
        res += 'dest2' + '\t' + this.s.leavingBuilding.dest2 + '\n';
        res += 'dir' + '\t' + this.s.leavingBuilding.dir + '\n';
        res += 'next_state' + '\t' + this.s.leavingBuilding.nextState + '\n';
        break;

      case SerfState.StateReadyToEnter:
        res += 'field_B' + '\t' + this.s.readyToEnter.fieldB + '\n';
        break;

      case SerfState.StateDigging:
        res += 'h_index' + '\t' + this.s.digging.hIndex + '\n';
        res += 'target_h' + '\t' + this.s.digging.targetH + '\n';
        res += 'dig_pos' + '\t' + this.s.digging.digPos + '\n';
        res += 'substate' + '\t' + this.s.digging.substate + '\n';
        break;

      case SerfState.StateBuilding:
        res += 'mode' + '\t' + this.s.building.mode + '\n';
        res += 'bld_index' + '\t' + this.s.building.bldIndex + '\n';
        res += 'material_step' + '\t' + this.s.building.materialStep + '\n';
        res += 'counter' + '\t' + this.s.building.counter + '\n';
        break;

      case SerfState.StateBuildingCastle:
        res += 'inv_index' + '\t' + this.s.buildingCastle.invIndex + '\n';
        break;

      case SerfState.StateMoveResourceOut:
      case SerfState.StateDropResourceOut:
        res += 'res' + '\t' + this.s.moveResourceOut.res + '\n';
        res += 'res_dest' + '\t' + this.s.moveResourceOut.resDest + '\n';
        res += 'next_state' + '\t' + this.s.moveResourceOut.nextState + '\n';
        break;

      case SerfState.StateReadyToLeaveInventory:
        res += 'mode' + '\t' + this.s.readyToLeaveInventory.mode + '\n';
        res += 'dest' + '\t' + this.s.readyToLeaveInventory.dest + '\n';
        res += 'inv_index' + '\t' + this.s.readyToLeaveInventory.invIndex
            + '\n';
        break;

      case SerfState.StateFreeWalking:
      case SerfState.StateLogging:
      case SerfState.StatePlanting:
      case SerfState.StateStoneCutting:
      case SerfState.StateStoneCutterFreeWalking:
      case SerfState.StateFishing:
      case SerfState.StateFarming:
      case SerfState.StateSamplingGeoSpot:
      case SerfState.StateKnightFreeWalking:
      case SerfState.StateKnightAttackingFree:
      case SerfState.StateKnightAttackingFreeWait:
        res += 'dist_col' + '\t' + this.s.freeWalking.distCol + '\n';
        res += 'dist_row' + '\t' + this.s.freeWalking.distRow + '\n';
        res += 'neg_dist' + '\t' + this.s.freeWalking.negDist1 + '\n';
        res += 'neg_dist2' + '\t' + this.s.freeWalking.negDist2 + '\n';
        res += 'flags' + '\t' + this.s.freeWalking.flags + '\n';
        break;

      case SerfState.StateSawing:
        res += 'mode' + '\t' + this.s.sawing.mode + '\n';
        break;

      case SerfState.StateLost:
        res += 'field_B' + '\t' + this.s.lost.fieldB + '\n';
        break;

      case SerfState.StateMining:
        res += 'substate' + '\t' + this.s.mining.substate + '\n';
        res += 'res' + '\t' + this.s.mining.res + '\n';
        res += 'deposit' + '\t' + this.s.mining.deposit + '\n';
        break;

      case SerfState.StateSmelting:
        res += 'mode' + '\t' + this.s.smelting.mode + '\n';
        res += 'counter' + '\t' + this.s.smelting.counter + '\n';
        res += 'type' + '\t' + this.s.smelting.type + '\n';
        break;

      case SerfState.StateMilling:
        res += 'mode' + '\t' + this.s.milling.mode + '\n';
        break;

      case SerfState.StateBaking:
        res += 'mode' + '\t' + this.s.baking.mode + '\n';
        break;

      case SerfState.StatePigFarming:
        res += 'mode' + '\t' + this.s.pigfarming.mode + '\n';
        break;

      case SerfState.StateButchering:
        res += 'mode' + '\t' + this.s.butchering.mode + '\n';
        break;

      case SerfState.StateMakingWeapon:
        res += 'mode' + '\t' + this.s.makingWeapon.mode + '\n';
        break;

      case SerfState.StateMakingTool:
        res += 'mode' + '\t' + this.s.makingTool.mode + '\n';
        break;

      case SerfState.StateBuildingBoat:
        res += 'mode' + '\t' + this.s.buildingBoat.mode + '\n';
        break;

      case SerfState.StateKnightEngagingBuilding:
      case SerfState.StateKnightPrepareAttacking:
      case SerfState.StateKnightPrepareDefendingFreeWait:
      case SerfState.StateKnightAttackingDefeatFree:
      case SerfState.StateKnightAttacking:
      case SerfState.StateKnightAttackingVictory:
      case SerfState.StateKnightEngageAttackingFree:
      case SerfState.StateKnightEngageAttackingFreeJoin:
      case SerfState.StateKnightAttackingVictoryFree:
        res += 'move' + '\t' + this.s.attacking.move + '\n';
        res += 'attacker_won' + '\t' + this.s.attacking.attackerWon + '\n';
        res += 'field_D' + '\t' + this.s.attacking.fieldD + '\n';
        res += 'def_index' + '\t' + this.s.attacking.defIndex + '\n';
        break;

      case SerfState.StateKnightDefendingFree:
      case SerfState.StateKnightEngageDefendingFree:
        res += 'dist_col' + '\t' + this.s.defendingFree.distCol + '\n';
        res += 'dist_row' + '\t' + this.s.defendingFree.distRow + '\n';
        res += 'field_D' + '\t' + this.s.defendingFree.fieldD + '\n';
        res += 'other_dist_col' + '\t' + this.s.defendingFree.otherDistCol
            + '\n';
        res += 'other_dist_row' + '\t' + this.s.defendingFree.otherDistRow
            + '\n';
        break;

      case SerfState.StateKnightLeaveForWalkToFight:
        res += 'dist_col' + '\t' + this.s.leaveForWalkToFight.distCol + '\n';
        res += 'dist_row' + '\t' + this.s.leaveForWalkToFight.distRow + '\n';
        res += 'field_D' + '\t' + this.s.leaveForWalkToFight.fieldD + '\n';
        res += 'field_E' + '\t' + this.s.leaveForWalkToFight.fieldE + '\n';
        res += 'next_state' + '\t' + this.s.leaveForWalkToFight.nextState
            + '\n';
        break;

      case SerfState.StateIdleOnPath:
      case SerfState.StateWaitIdleOnPath:
      case SerfState.StateWakeAtFlag:
      case SerfState.StateWakeOnPath:
        res += 'rev_dir' + '\t' + this.s.idleOnPath.revDir + '\n';
        res += 'flag' + '\t' + this.s.idleOnPath.flag + '\n';
        res += 'field_E' + '\t' + this.s.idleOnPath.fieldE + '\n';
        break;

      case SerfState.StateDefendingHut:
      case SerfState.StateDefendingTower:
      case SerfState.StateDefendingFortress:
      case SerfState.StateDefendingCastle:
        res += 'next_knight' + '\t' + this.s.defending.nextKnight + '\n';
        break;

      default: break;
    }
    return res;
  }
}
