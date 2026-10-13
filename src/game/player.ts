/*
 * player.ts - Player related functions
 * Port of Freeserf's player.h and player.cc.
 *
 * Copyright (C) 2013-2017  Jon Lund Steffensen <jonlst@gmail.com>
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

import { BIT, BIT_TEST, ExceptionFreeserf, clamp, i32, idiv, u16, u32 } from './misc';
import { GameObject } from './objects';
import { ResourceType } from './resource';
import type { ResourceMap } from './resource';
import { SerfState, SerfType } from './serf';
import type { Serf } from './serf';
import { BuildingType, buildingGetScoreFromType } from './building';
import type { Building } from './building';
import { InventoryMode } from './inventory';
import type { Inventory } from './inventory';
import { MapObject, MapTerrain } from './map';
import type { MapPos } from './map-geometry';
import type { Game } from './game';
import { AI } from './ai';

// PORT: Serf::SerfMap (std::map<Serf::Type, unsigned int>). Declared here
// structurally so this module does not depend on how serf.ts spells it.
type SerfMap = Map<SerfType, number>;

export enum MessageType {
  TypeNone = 0,
  TypeUnderAttack = 1,
  TypeLoseFight = 2,
  TypeWinFight = 3,
  TypeMineEmpty = 4,
  TypeCallToLocation = 5,
  TypeKnightOccupied = 6,
  TypeNewStock = 7,
  TypeLostLand = 8,
  TypeLostBuildings = 9,
  TypeEmergencyActive = 10,
  TypeEmergencyNeutral = 11,
  TypeFoundGold = 12,
  TypeFoundIron = 13,
  TypeFoundCoal = 14,
  TypeFoundStone = 15,
  TypeCallToMenu = 16,
  Type30MSinceSave = 17,
  Type1HSinceSave = 18,
  TypeCallToStock = 19,
}

export class Message {
  static Type = MessageType;

  type: MessageType = MessageType.TypeNone;
  pos: MapPos = 0;
  data = 0;
}
export type Messages = Message[];

export class PosTimer {
  timeout = 0;
  pos: MapPos = 0;
}
export type PosTimers = PosTimer[];

// PORT: Player::Color.
export interface PlayerColor {
  red: number;
  green: number;
  blue: number;
}

// PORT: AIPoi, AILocation and PlayerAI come from ai.h. They are the data
// the player record carries, so they are defined here; ai.ts re-exports
// them.

/* Statistics of the area around the cursor (ai_scan_points_of_interest
   @0x2e88e, 88 bytes). */
export class AIPoi {
  field_0 = 0; /* +0x00 */
  field_2 = 0; /* +0x02 */
  field_4 = 0; /* +0x04 */
  field_6 = 0; /* +0x06 */
  field_8 = 0; /* +0x08 */
  bldCount: number[] = new Array<number>(25).fill(0); /* +0x0a buildings by type */
  trees = 0; /* +0x3c */
  field_3e = 0; /* +0x3e */
  stones = 0; /* +0x40 */
  deposit: number[] = new Array<number>(4).fill(0); /* +0x42 gold, iron, coal, stone */
  field_4a = 0; /* +0x4a */
  field_4c = 0; /* +0x4c */
  field_4e = 0; /* +0x4e */
  field_50 = 0; /* +0x50 */
  field_52 = 0; /* +0x52 */
  field_54 = 0; /* +0x54 */
  field_56 = 0; /* +0x56 */
}

export class AILocation {
  value = 0;
  col = 0;
  row = 0;
}

export const AI_LOCATION_CATEGORIES = 35;
export const AI_LOCATIONS_PER_CATEGORY = 8;

/* AI fields of the player record. */
export class PlayerAI {
  /* Cursor of the computer player (ptr+0xfc..0x101, the same fields the
     human player's panel uses). */
  cursorCol = 0; /* 0xfc */
  cursorRow = 0; /* 0xfe */
  mapCursorType = 0; /* 0x100 (byte), Interface::CursorType */
  panelBtnType = 0; /* 0x101 (byte), Interface::BuildPossibility */
  /* Unknown words 0x19a..0x1ac (road builder parameters etc.). */
  u_19a = 0; u_19c = 0; u_19e = 0; u_1a0 = 0; u_1a2 = 0; u_1a4 = 0; u_1a6 = 0; u_1a8 = 0;
  u_1aa = 0; u_1ac = 0;
  militaryRatio = 0; /* 0x186: own vs. others' military strength */
  u_1b0 = 0; /* 0x1b0 */
  u_1b2 = 0; /* 0x1b2 */
  phase = 0; /* 0x1b4: 0 place castle, 1 wait, 2 running, 3 off */
  counter = 0; /* 0x1b6 */
  buildThreshold = 0; /* 0x1b8 */
  /* Unknown words 0x1ba..0x1da. */
  u_1ba = 0; u_1bc = 0; u_1be = 0; u_1c0 = 0; u_1c2 = 0; u_1c4 = 0; u_1c6 = 0; u_1c8 = 0;
  u_1ca = 0; u_1cc = 0; u_1ce = 0; u_1d0 = 0; u_1d2 = 0; u_1d4 = 0; u_1d6 = 0; u_1d8 = 0;
  u_1da = 0;
  poi: AIPoi[] = []; /* 0x1dc, 0x234, 0x28c, 0x2e4, 0x33c */
  /* Unknown words 0x394..0x3ce. */
  u_394 = 0; u_396 = 0; u_398 = 0; u_39a = 0; u_39c = 0; u_39e = 0; u_3a0 = 0; u_3a2 = 0;
  u_3a4 = 0; u_3a6 = 0; u_3a8 = 0; u_3aa = 0; u_3ac = 0; u_3ae = 0; u_3b0 = 0; u_3b2 = 0;
  u_3b4 = 0; u_3b6 = 0; u_3b8 = 0; u_3ba = 0; u_3bc = 0; u_3be = 0; u_3c0 = 0; u_3c2 = 0;
  u_3c4 = 0; u_3c6 = 0; u_3c8 = 0; u_3ca = 0; u_3cc = 0; u_3ce = 0;
  buildWant: number[] = new Array<number>(25).fill(0); /* 0x3d0: index = building type - 1 */
  buildDamp: number[] = new Array<number>(25).fill(0); /* 0x402: index = building type - 1 */
  locations: AILocation[][] = []; /* 0x434 */

  constructor() {
    for (let i = 0; i < 5; i++) {
      this.poi.push(new AIPoi());
    }
    for (let i = 0; i < AI_LOCATION_CATEGORIES; i++) {
      const row: AILocation[] = [];
      for (let j = 0; j < AI_LOCATIONS_PER_CATEGORY; j++) {
        row.push(new AILocation());
      }
      this.locations.push(row);
    }
  }
}

function zeros(n: number): number[] {
  return new Array<number>(n).fill(0);
}

/* Player object. Holds the game state of a player. */
export class Player extends GameObject {
  /* The computer player reads the fields as the original does. */
  // PORT: the fields below are protected in the C++, with AI declared as a
  // friend. TS has no friends, so they are public.
  toolPrio: number[] = zeros(9);
  resourceCount: number[] = zeros(26);
  flagPrio: number[] = zeros(26);
  serfCount: number[] = zeros(27);
  knightOccupation: number[] = zeros(4);

  color: PlayerColor; /* ADDED */
  face: number;

  /* The flags of the player (packed as "flags" in the saves, the bits of
     the original). */
  castle = false; /* 0: has built its castle */
  strongest = false; /* 1: sends the strongest knights to fight */
  knightCycling = false; /* 2: cycling the knights */
  message = false; /* 3: a message in the queue */
  knightLevelReduced = false; /* 4: knights taken out while cycling */
  knightCyclingSecond = false; /* 5: second phase of the cycling */
  inGame = false; /* 6: takes turns in the game */
  computer = false; /* 7: a computer player */

  /* What the player may build at the cursor of the AI (packed as "build"
     in the saves). */
  noMilitary = false; /* 0: no military building there */
  noFlag = false; /* 1: no flag there */
  serfsSpawning = false; /* 2: new serfs are spawned in the castle */
  castleStanding = false; /* 3: the castle stands */
  waterRoads = false; /* 4: the AI builds roads on water */
  completedBuildingCount: number[] = zeros(24);
  incompleteBuildingCount: number[] = zeros(24);
  inventoryPrio: number[] = zeros(26);
  attackingBuildings: number[] = zeros(64);

  messages: Messages = [];
  timers: PosTimers = [];

  building: number;
  castleInventory: number;

  /* Emergency program (Amiga player_update_emergency_program @0xb23c,
     packed as "emergency_flags" in the saves). */
  emergencyOver = false; /* 0 */
  outOfPlanks = false; /* 1 */
  outOfStone = false; /* 2 */
  emergencyLumberjack = false; /* 3: its lumberjack is ready */
  emergencySawmill = false; /* 4: its sawmill is ready */
  emergencyStone = false; /* 5: its stonecutter or a stone mine */
  emergencyActive = false; /* 6 */
  emergencyCounter: number;
  extraPlanks: number;
  extraStone: number;
  lumberjackIndex: number;
  sawmillIndex: number;
  stonecutterIndex: number;

  /* Computer player (Amiga ptr+0xfc..0x1013). */
  ai: PlayerAI;
  contSearchAfterNonOptimalFind: number;
  knightsToSpawn: number;
  totalLandArea: number;
  totalBuildingScore: number;
  totalMilitaryScore: number;
  lastTick: number;

  reproductionCounter: number;
  reproductionReset: number;
  serfToKnightRate: number;
  serfToKnightCounter: number; /* Overflow is important */
  analysisGoldore: number;
  analysisIronore: number;
  analysisCoal: number;
  analysisStone: number;

  foodStonemine = 0; /* Food delivery priority of food for mines. */
  foodCoalmine = 0;
  foodIronmine = 0;
  foodGoldmine = 0;
  planksConstruction = 0; /* Planks delivery priority. */
  planksBoatbuilder = 0;
  planksToolmaker = 0;
  steelToolmaker = 0;
  steelWeaponsmith = 0;
  coalSteelsmelter = 0;
  coalGoldsmelter = 0;
  coalWeaponsmith = 0;
  wheatPigfarm = 0;
  wheatMill = 0;

  /* +1 for every castle defeated,
     -1 for own castle lost. */
  castleScore: number;
  sendGenericDelay: number;
  initialSupplies: number;
  serfIndex: number;
  knightCycleCounter: number;
  sendKnightDelay: number;
  militaryMaxGold: number;

  knightMorale: number;
  goldDeposited: number;
  castleKnightsWanted: number;
  castleKnights: number;
  aiValue0: number;
  aiValue1: number;
  aiValue2: number;
  aiValue3: number;
  aiValue4: number;
  aiValue5: number;
  aiIntelligence: number;

  playerStatHistory: number[][] = [];
  resourceCountHistory: number[][] = [];

  // TODO(Digger): remove it to UI
  buildingAttacked: number;
  knightsAttacking: number;
  attackingBuildingCount: number;
  attackingKnights: number[] = zeros(4);
  totalAttackingKnights: number;
  tempIndex: number;

  constructor(game: Game, index: number) {
    super(game, index);
    for (let i = 0; i < 16; i++) {
      this.playerStatHistory.push(zeros(112));
    }
    for (let i = 0; i < 26; i++) {
      this.resourceCountHistory.push(zeros(120));
    }

    this.setBuildBits(0);
    this.color = { red: 0, green: 0, blue: 0 };
    // PORT: face is a size_t set to -1 in the C++. It is kept as the 32-bit
    // unsigned value so that it still compares above every real face.
    this.face = u32(-1);
    this.setFlagsBits(0);
    this.castleInventory = 0;
    this.reproductionCounter = 0;
    this.reproductionReset = 0;
    this.analysisCoal = 0;
    this.analysisStone = 0;
    this.analysisIronore = 0;
    this.analysisGoldore = 0;
    this.initialSupplies = 0;
    this.knightCycleCounter = 0;
    this.knightMorale = 0;
    this.goldDeposited = 0;
    this.aiValue0 = 0;
    this.aiValue1 = 0;
    this.aiValue2 = 0;
    this.aiValue3 = 0;
    this.aiValue4 = 0;
    this.aiValue5 = 0;
    this.aiIntelligence = 0;
    this.tempIndex = 0;

    this.building = 0;
    /* No emergency program. */
    this.setEmergencyBits(0);
    this.emergencyOver = true;
    this.emergencyCounter = 0;
    this.extraPlanks = 0;
    this.extraStone = 0;
    this.lumberjackIndex = 0;
    this.sawmillIndex = 0;
    this.stonecutterIndex = 0;
    this.ai = new PlayerAI();
    this.contSearchAfterNonOptimalFind = 7;
    this.knightsToSpawn = 0;
    this.totalLandArea = 0;
    this.totalMilitaryScore = 0;
    this.totalBuildingScore = 0;

    this.lastTick = 0;

    this.serfToKnightRate = 20000;
    this.serfToKnightCounter = 0x8000;

    this.knightOccupation[0] = 0x10;
    this.knightOccupation[1] = 0x21;
    this.knightOccupation[2] = 0x32;
    this.knightOccupation[3] = 0x43;

    this.totalAttackingKnights = 0;
    for (let i = 0; i < 4; i++) {
      this.attackingKnights[i] = 0;
    }

    this.attackingBuildingCount = 0;
    for (let i = 0; i < 64; i++) {
      this.attackingBuildings[i] = 0;
    }

    this.buildingAttacked = 0;
    this.knightsAttacking = 0;

    this.resetFoodPriority();
    this.resetPlanksPriority();
    this.resetSteelPriority();
    this.resetCoalPriority();
    this.resetWheatPriority();
    this.resetToolPriority();

    this.resetFlagPriority();
    this.resetInventoryPriority();

    this.militaryMaxGold = 0;

    this.castleKnightsWanted = 3;
    this.castleKnights = 0;
    this.sendKnightDelay = 0;
    this.sendGenericDelay = 0;
    this.serfIndex = 0;

    this.castleScore = 0;

    for (let i = 0; i < 26; i++) {
      this.resourceCount[i] = 0;
    }

    for (let i = 0; i < 24; i++) {
      this.completedBuildingCount[i] = 0;
      this.incompleteBuildingCount[i] = 0;
    }

    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 112; j++) {
        this.playerStatHistory[i][j] = 0;
      }
    }

    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 120; j++) {
        this.resourceCountHistory[i][j] = 0;
      }
    }

    for (let i = 0; i < 27; i++) {
      this.serfCount[i] = 0;
    }

    /* Computer player state (Amiga player_init_all @0x5468). */
    for (let i = 0; i < 25; i++) this.ai.buildDamp[i] = 0xffff;
    // PORT: the C++ takes `int *pending = &ai.u_1bc` and writes 16 ints
    // through it, which covers the fields u_1bc..u_1da.
    this.ai.u_1bc = 0xffff;
    this.ai.u_1be = 0xffff;
    this.ai.u_1c0 = 0xffff;
    this.ai.u_1c2 = 0xffff;
    this.ai.u_1c4 = 0xffff;
    this.ai.u_1c6 = 0xffff;
    this.ai.u_1c8 = 0xffff;
    this.ai.u_1ca = 0xffff;
    this.ai.u_1cc = 0xffff;
    this.ai.u_1ce = 0xffff;
    this.ai.u_1d0 = 0xffff;
    this.ai.u_1d2 = 0xffff;
    this.ai.u_1d4 = 0xffff;
    this.ai.u_1d6 = 0xffff;
    this.ai.u_1d8 = 0xffff;
    this.ai.u_1da = 0xffff;
  }

  // Initialize player values.
  //
  // Supplies and reproduction are usually limited to 0-40 in random map games.
  //
  // Args:
  //     face: the face image that represents this player.
  //           1-12 is AI, 13-14 is human player.
  //     color: Color of player as palette color index.
  //     supplies: Initial resource supplies at castle (0-50).
  //     reproduction: How quickly new serfs spawn during the game (0-60).
  //     intelligence: AI only (unused) (0-40).
  init(_intelligence: number, _supplies: number, _reproduction: number): void {
    this.setFlagsBits(0);
    this.inGame = true; /* Amiga player_init_all @0x54c4 */

    this.initialSupplies = _supplies;
    this.reproductionReset = u32(Math.imul(60 - _reproduction, 50));
    this.aiIntelligence = u32(Math.imul(1300, _intelligence) + 13535);
    this.reproductionCounter = i32(this.reproductionReset);
  }

  initView(_color: PlayerColor, _face: number): void {
    this.face = _face;

    if (this.face < 12) { /* AI player */
      this.computer = true;
      /* With an AI player the scheduler cycle is 49 updates
         (Amiga player_init_all @0x54e2). */
      this.game.setMaxNextIndex(49);
    }

    if (this.isAi()) this.initAiValues(this.face);

    this.color = { red: _color.red, green: _color.green, blue: _color.blue };
  }

  /* Tutorial 6's enemy: without a face, with a castle but not in the game,
     its military buildings fully occupied (Amiga game_init_start_castles
     @0x4a78). */
  initPassive(_color: PlayerColor): void {
    this.face = 0;
    this.color = { red: _color.red, green: _color.green, blue: _color.blue };
    this.setFlagsBits(0);
    this.castle = true;
    for (let i = 0; i < 4; i++) {
      this.knightOccupation[i] = 0x44;
    }
  }

  getColor(): PlayerColor {
    return { red: this.color.red, green: this.color.green, blue: this.color.blue };
  }
  getFace(): number {
    return this.face;
  }

  /* Whether player has built the initial castle. */
  hasCastle(): boolean {
    return this.castle;
  }
  /* Chance of an AI step per scheduler slot, out of 0x10000. */
  getAiIntelligence(): number {
    return u32(this.aiIntelligence);
  }
  /* Whether the strongest knight should be sent to fight. */
  sendStrongest(): boolean {
    return this.strongest;
  }
  dropSendStrongest(): void {
    this.strongest = false;
  }
  setSendStrongest(): void {
    this.strongest = true;
  }
  /* Whether cycling of knights is in progress. */
  cyclingKnight(): boolean {
    return this.knightCycling;
  }
  /* Whether a message is queued for this player. */
  hasMessage(): boolean {
    return this.message;
  }
  dropMessage(): void {
    this.message = false;
  }
  /* Whether the knight level of military buildings is temporarily
   reduced bacause of cycling of the knights. */
  reducedKnightLevel(): boolean {
    return this.knightLevelReduced;
  }
  /* Whether the cycling of knights is in the second phase. */
  cyclingSecond(): boolean {
    return this.knightCyclingSecond;
  }
  /* Whether this player is a computer controlled opponent. */
  /* Only the players in the game take turns; tutorial 6's enemy does not
     (Amiga player flag bit 6). */
  isInGame(): boolean {
    return this.inGame;
  }
  isAi(): boolean {
    return this.computer;
  }

  isEmergencyActive(): boolean {
    return this.emergencyActive;
  }
  isOutOfPlanks(): boolean {
    return this.outOfPlanks;
  }
  isOutOfStone(): boolean {
    return this.outOfStone;
  }
  isEmergencyDesignated(index: number): boolean {
    return (
      index !== 0 &&
      (index === this.lumberjackIndex || index === this.sawmillIndex || index === this.stonecutterIndex)
    );
  }
  stoneMineWorking(): void {
    this.emergencyStone = true;
  }

  /* Whether player is prohibited from building military
   buildings at current position. */
  allowMilitary(): boolean {
    return !this.noMilitary;
  }
  /* Whether player is prohibited from building flag at
   current position. */
  allowFlag(): boolean {
    return !this.noFlag;
  }
  /* Whether player can spawn new serfs. */
  canSpawn(): boolean {
    return this.serfsSpawning;
  }

  getSerfCount(type: number): number {
    return u32(this.serfCount[type]);
  }

  // int get_flag_prio(int res) const and int *get_flag_prio()
  getFlagPrio(res: number): number;
  getFlagPrio(): number[];
  getFlagPrio(res?: number): number | number[] {
    if (res === undefined) return this.flagPrio;
    return this.flagPrio[res];
  }

  /* Initialize AI parameters. */
  protected initAiValues(face_: number): void {
    const aiValues0 = [13, 10, 16, 9, 10, 8, 6, 10, 12, 5, 8];
    const aiValues1 = [10000, 13000, 16000, 16000, 18000, 20000,
      19000, 18000, 30000, 23000, 26000];
    const aiValues2 = [10000, 35000, 20000, 27000, 37000, 25000,
      40000, 30000, 50000, 35000, 40000];
    const aiValues3 = [0, 36, 0, 31, 8, 480, 3, 16, 0, 193, 39];
    const aiValues4 = [0, 30000, 5000, 40000, 50000, 20000, 45000,
      35000, 65000, 25000, 30000];
    const aiValues5 = [60000, 61000, 60000, 65400, 63000, 62000,
      65000, 63000, 64000, 64000, 64000];

    // PORT: face 0 reads one element before each table in the C++ (undefined
    // behaviour); here it yields undefined.
    this.aiValue0 = aiValues0[face_ - 1];
    this.aiValue1 = aiValues1[face_ - 1];
    this.aiValue2 = aiValues2[face_ - 1];
    this.aiValue3 = aiValues3[face_ - 1];
    this.aiValue4 = aiValues4[face_ - 1];
    this.aiValue5 = aiValues5[face_ - 1];
  }

  /* Enqueue a new notification message for player. */
  addNotification(type: MessageType, pos: MapPos, data: number): void {
    this.message = true;
    const newMessage = new Message();
    newMessage.type = type;
    newMessage.pos = pos;
    newMessage.data = data;
    this.messages.push(newMessage);
  }

  hasNotification(): boolean {
    return this.messages.length > 0;
  }

  popNotification(): Message {
    const message = this.messages[0];
    this.messages.shift();
    return message;
  }

  peekNotification(): Message {
    const message = this.messages[0];
    return message;
  }

  addTimer(timeout: number, pos: MapPos): void {
    const newTimer = new PosTimer();
    newTimer.timeout = timeout;
    newTimer.pos = pos;
    this.timers.push(newTimer);
  }

  /* Set defaults for food distribution priorities. */
  resetFoodPriority(): void {
    this.foodStonemine = 13100;
    this.foodCoalmine = 45850;
    this.foodIronmine = 45850;
    this.foodGoldmine = 65500;
  }

  /* Set defaults for planks distribution priorities. */
  resetPlanksPriority(): void {
    this.planksConstruction = 65500;
    this.planksBoatbuilder = 3275;
    this.planksToolmaker = 19650;
  }

  /* Set defaults for steel distribution priorities. */
  resetSteelPriority(): void {
    this.steelToolmaker = 45850;
    this.steelWeaponsmith = 65500;
  }

  /* Set defaults for coal distribution priorities. */
  resetCoalPriority(): void {
    this.coalSteelsmelter = 32750;
    this.coalGoldsmelter = 65500;
    this.coalWeaponsmith = 52400;
  }

  /* Set defaults for coal distribution priorities. */
  resetWheatPriority(): void {
    this.wheatPigfarm = 65500;
    this.wheatMill = 32750;
  }

  /* Set defaults for tool production priorities. */
  resetToolPriority(): void {
    this.toolPrio[0] = 9825; /* SHOVEL */
    this.toolPrio[1] = 65500; /* HAMMER */
    this.toolPrio[2] = 13100; /* ROD */
    this.toolPrio[3] = 6550; /* CLEAVER */
    this.toolPrio[4] = 13100; /* SCYTHE */
    this.toolPrio[5] = 26200; /* AXE */
    this.toolPrio[6] = 32750; /* SAW */
    this.toolPrio[7] = 45850; /* PICK */
    this.toolPrio[8] = 6550; /* PINCER */
  }

  /* Set defaults for flag priorities. */
  resetFlagPriority(): void {
    this.flagPrio[ResourceType.TypeGoldOre] = 1;
    this.flagPrio[ResourceType.TypeGoldBar] = 2;
    this.flagPrio[ResourceType.TypeWheat] = 3;
    this.flagPrio[ResourceType.TypeFlour] = 4;
    this.flagPrio[ResourceType.TypePig] = 5;

    this.flagPrio[ResourceType.TypeBoat] = 6;
    this.flagPrio[ResourceType.TypePincer] = 7;
    this.flagPrio[ResourceType.TypeScythe] = 8;
    this.flagPrio[ResourceType.TypeRod] = 9;
    this.flagPrio[ResourceType.TypeCleaver] = 10;

    this.flagPrio[ResourceType.TypeSaw] = 11;
    this.flagPrio[ResourceType.TypeAxe] = 12;
    this.flagPrio[ResourceType.TypePick] = 13;
    this.flagPrio[ResourceType.TypeShovel] = 14;
    this.flagPrio[ResourceType.TypeHammer] = 15;

    this.flagPrio[ResourceType.TypeShield] = 16;
    this.flagPrio[ResourceType.TypeSword] = 17;
    this.flagPrio[ResourceType.TypeBread] = 18;
    this.flagPrio[ResourceType.TypeMeat] = 19;
    this.flagPrio[ResourceType.TypeFish] = 20;

    this.flagPrio[ResourceType.TypeIronOre] = 21;
    this.flagPrio[ResourceType.TypeLumber] = 22;
    this.flagPrio[ResourceType.TypeCoal] = 23;
    this.flagPrio[ResourceType.TypeSteel] = 24;
    this.flagPrio[ResourceType.TypeStone] = 25;
    this.flagPrio[ResourceType.TypePlank] = 26;
  }

  /* Set defaults for inventory priorities. */
  resetInventoryPriority(): void {
    this.inventoryPrio[ResourceType.TypeWheat] = 1;
    this.inventoryPrio[ResourceType.TypeFlour] = 2;
    this.inventoryPrio[ResourceType.TypePig] = 3;
    this.inventoryPrio[ResourceType.TypeBread] = 4;
    this.inventoryPrio[ResourceType.TypeFish] = 5;

    this.inventoryPrio[ResourceType.TypeMeat] = 6;
    this.inventoryPrio[ResourceType.TypeLumber] = 7;
    this.inventoryPrio[ResourceType.TypePlank] = 8;
    this.inventoryPrio[ResourceType.TypeBoat] = 9;
    this.inventoryPrio[ResourceType.TypeStone] = 10;

    this.inventoryPrio[ResourceType.TypeCoal] = 11;
    this.inventoryPrio[ResourceType.TypeIronOre] = 12;
    this.inventoryPrio[ResourceType.TypeSteel] = 13;
    this.inventoryPrio[ResourceType.TypeShovel] = 14;
    this.inventoryPrio[ResourceType.TypeHammer] = 15;

    this.inventoryPrio[ResourceType.TypeRod] = 16;
    this.inventoryPrio[ResourceType.TypeCleaver] = 17;
    this.inventoryPrio[ResourceType.TypeScythe] = 18;
    this.inventoryPrio[ResourceType.TypeAxe] = 19;
    this.inventoryPrio[ResourceType.TypeSaw] = 20;

    this.inventoryPrio[ResourceType.TypePick] = 21;
    this.inventoryPrio[ResourceType.TypePincer] = 22;
    this.inventoryPrio[ResourceType.TypeShield] = 23;
    this.inventoryPrio[ResourceType.TypeSword] = 24;
    this.inventoryPrio[ResourceType.TypeGoldOre] = 25;
    this.inventoryPrio[ResourceType.TypeGoldBar] = 26;
  }

  getKnightOccupation(threatLevel: number): number {
    return this.knightOccupation[threatLevel];
  }

  changeKnightOccupation(index_: number, adjustMax: number, delta: number): void {
    let max = (this.knightOccupation[index_] >> 4) & 0xf;
    let min = this.knightOccupation[index_] & 0xf;

    if (adjustMax) {
      max = clamp(min, max + delta, 4);
    } else {
      min = clamp(0, min + delta, max);
    }

    this.knightOccupation[index_] = (max << 4) | min;
  }

  setKnightOccupation(threatLevel: number, value: number): void {
    this.knightOccupation[threatLevel] = value;
  }
  increaseCastleKnights(): void {
    this.castleKnights++;
  }
  decreaseCastleKnights(): void {
    this.castleKnights--;
  }
  getCastleKnights(): number {
    return this.castleKnights;
  }
  getCastleKnightsWanted(): number {
    return this.castleKnightsWanted;
  }
  getKnightMorale(): number {
    return this.knightMorale;
  }
  getGoldDeposited(): number {
    return this.goldDeposited;
  }

  /* Turn a number of serfs into knight for the given player. */
  promoteSerfsToKnights(number: number): number {
    let promoted = 0;

    const serfs: Serf[] = this.game.getPlayerSerfs(this);
    for (const serf of serfs) {
      if (serf.getState() === SerfState.StateIdleInStock && serf.getType() === SerfType.TypeGeneric) {
        const inv: Inventory = this.game.getInventory(serf.getIdleInStockInvIndex())!;
        if (inv.promoteSerfToKnight(serf)) {
          promoted += 1;
          number -= 1;
        }
      }
    }

    return promoted;
  }

  protected availableKnightsAtPos(pos: MapPos, index_: number, dist: number): number {
    const minLevelHut = [1, 1, 2, 2, 3];
    const minLevelTower = [1, 2, 3, 4, 6];
    const minLevelFortress = [1, 3, 6, 9, 12];

    const map = this.game.getMap();
    if (
      map.getOwner(pos) !== this.index ||
      map.typeUp(pos) <= MapTerrain.TerrainWater3 ||
      map.typeDown(pos) <= MapTerrain.TerrainWater3 ||
      map.getObj(pos) < MapObject.ObjectSmallBuilding ||
      map.getObj(pos) > MapObject.ObjectCastle
    ) {
      return index_;
    }

    const bldIndex: number = map.getObjIndex(pos);
    for (let i = 0; i < index_; i++) {
      if (this.attackingBuildings[i] === bldIndex) {
        return index_;
      }
    }

    const building_: Building = this.game.getBuilding(bldIndex)!;
    if (!building_.isDone() || building_.isBurning()) {
      return index_;
    }

    let minLevel: number[];
    switch (building_.getType()) {
      case BuildingType.TypeHut: minLevel = minLevelHut; break;
      case BuildingType.TypeTower: minLevel = minLevelTower; break;
      case BuildingType.TypeFortress: minLevel = minLevelFortress; break;
      default: return index_;
    }

    if (index_ >= 64) return index_;

    this.attackingBuildings[index_] = bldIndex;

    const state: number = building_.getThreatLevel();
    const knightsPresent: number = building_.getKnightCount();
    const toSend = knightsPresent - minLevel[this.knightOccupation[state] & 0xf];

    if (toSend > 0) this.attackingKnights[dist] += toSend;

    return index_ + 1;
  }

  knightsAvailableForAttack(pos: MapPos): number {
    /* Reset counters. */
    for (let i = 0; i < 4; i++) {
      this.attackingKnights[i] = 0;
    }

    let count = 0;
    const map = this.game.getMap();

    /* Iterate each shell around the position.*/
    for (let i = 0; i < 32; i++) {
      pos = map.moveRight(pos);
      for (let j = 0; j < i + 1; j++) {
        count = this.availableKnightsAtPos(pos, count, i >> 3);
        pos = map.moveDown(pos);
      }
      for (let j = 0; j < i + 1; j++) {
        count = this.availableKnightsAtPos(pos, count, i >> 3);
        pos = map.moveLeft(pos);
      }
      for (let j = 0; j < i + 1; j++) {
        count = this.availableKnightsAtPos(pos, count, i >> 3);
        pos = map.moveUpLeft(pos);
      }
      for (let j = 0; j < i + 1; j++) {
        count = this.availableKnightsAtPos(pos, count, i >> 3);
        pos = map.moveUp(pos);
      }
      for (let j = 0; j < i + 1; j++) {
        count = this.availableKnightsAtPos(pos, count, i >> 3);
        pos = map.moveRight(pos);
      }
      for (let j = 0; j < i + 1; j++) {
        count = this.availableKnightsAtPos(pos, count, i >> 3);
        pos = map.moveDownRight(pos);
      }
    }

    this.attackingBuildingCount = count;

    this.totalAttackingKnights = 0;
    for (let i = 0; i < 4; i++) {
      this.totalAttackingKnights += this.attackingKnights[i];
    }

    return this.totalAttackingKnights;
  }

  startAttack(): void {
    const minLevelHut = [1, 1, 2, 2, 3];
    const minLevelTower = [1, 2, 3, 4, 6];
    const minLevelFortress = [1, 3, 6, 9, 12];

    const target: Building = this.game.getBuilding(this.buildingAttacked)!;
    if (!target.isDone() || !target.isMilitary() || !target.isActive() || target.getThreatLevel() !== 3) {
      return;
    }

    const map = this.game.getMap();
    for (let i = 0; i < this.attackingBuildingCount; i++) {
      /* TODO building index may not be valid any more(?). */
      const b: Building = this.game.getBuilding(this.attackingBuildings[i])!;
      if (b.isBurning() || map.getOwner(b.getPosition()) !== this.index) {
        continue;
      }

      const flagPos: MapPos = map.moveDownRight(b.getPosition());
      if (map.hasSerf(flagPos)) {
        /* Check if building is under siege. */
        const s: Serf = this.game.getSerfAtPos(flagPos)!;
        if (s.getOwner() !== this.index) continue;
      }

      let minLevel: number[];
      switch (b.getType()) {
        case BuildingType.TypeHut: minLevel = minLevelHut; break;
        case BuildingType.TypeTower: minLevel = minLevelTower; break;
        case BuildingType.TypeFortress: minLevel = minLevelFortress; break;
        default: continue;
      }

      const state: number = b.getThreatLevel();
      const knightsPresent: number = b.getKnightCount();
      const toSend = knightsPresent - minLevel[this.knightOccupation[state] & 0xf];

      for (let j = 0; j < toSend; j++) {
        /* Find most approriate knight to send according to player settings. */
        let bestType: number = this.sendStrongest() ? SerfType.TypeKnight0 : SerfType.TypeKnight4;
        let bestIndex = -1;

        let knightIndex: number = b.getFirstKnight();
        while (knightIndex !== 0) {
          const knight: Serf = this.game.getSerf(knightIndex)!;
          if (this.sendStrongest()) {
            if (knight.getType() >= bestType) {
              bestIndex = knightIndex;
              bestType = knight.getType();
            }
          } else {
            if (knight.getType() <= bestType) {
              bestIndex = knightIndex;
              bestType = knight.getType();
            }
          }

          knightIndex = knight.getNext();
        }

        const defSerf: Serf = b.callAttackerOut(bestIndex)!;

        target.setUnderAttack();

        /* Calculate distance to target. */
        const distCol: number = map.distX(target.getPosition(), defSerf.getPos());
        const distRow: number = map.distY(target.getPosition(), defSerf.getPos());

        /* Send this serf off to fight. */
        defSerf.sendOffToFight(distCol, distRow);

        this.knightsAttacking -= 1;
        if (this.knightsAttacking === 0) return;
      }
    }
  }

  /* The flags as the bits of the original, for the saves. */
  getFlagsBits(): number {
    return (
      (this.castle ? BIT(0) : 0) | (this.strongest ? BIT(1) : 0) |
      (this.knightCycling ? BIT(2) : 0) | (this.message ? BIT(3) : 0) |
      (this.knightLevelReduced ? BIT(4) : 0) |
      (this.knightCyclingSecond ? BIT(5) : 0) | (this.inGame ? BIT(6) : 0) |
      (this.computer ? BIT(7) : 0)
    );
  }

  setFlagsBits(bits: number): void {
    this.castle = BIT_TEST(bits, 0) !== 0;
    this.strongest = BIT_TEST(bits, 1) !== 0;
    this.knightCycling = BIT_TEST(bits, 2) !== 0;
    this.message = BIT_TEST(bits, 3) !== 0;
    this.knightLevelReduced = BIT_TEST(bits, 4) !== 0;
    this.knightCyclingSecond = BIT_TEST(bits, 5) !== 0;
    this.inGame = BIT_TEST(bits, 6) !== 0;
    this.computer = BIT_TEST(bits, 7) !== 0;
  }

  getBuildBits(): number {
    return (
      (this.noMilitary ? BIT(0) : 0) | (this.noFlag ? BIT(1) : 0) |
      (this.serfsSpawning ? BIT(2) : 0) | (this.castleStanding ? BIT(3) : 0) |
      (this.waterRoads ? BIT(4) : 0)
    );
  }

  setBuildBits(bits: number): void {
    this.noMilitary = BIT_TEST(bits, 0) !== 0;
    this.noFlag = BIT_TEST(bits, 1) !== 0;
    this.serfsSpawning = BIT_TEST(bits, 2) !== 0;
    this.castleStanding = BIT_TEST(bits, 3) !== 0;
    this.waterRoads = BIT_TEST(bits, 4) !== 0;
  }

  getEmergencyBits(): number {
    return (
      (this.emergencyOver ? BIT(0) : 0) | (this.outOfPlanks ? BIT(1) : 0) |
      (this.outOfStone ? BIT(2) : 0) | (this.emergencyLumberjack ? BIT(3) : 0) |
      (this.emergencySawmill ? BIT(4) : 0) | (this.emergencyStone ? BIT(5) : 0) |
      (this.emergencyActive ? BIT(6) : 0)
    );
  }

  setEmergencyBits(bits: number): void {
    this.emergencyOver = BIT_TEST(bits, 0) !== 0;
    this.outOfPlanks = BIT_TEST(bits, 1) !== 0;
    this.outOfStone = BIT_TEST(bits, 2) !== 0;
    this.emergencyLumberjack = BIT_TEST(bits, 3) !== 0;
    this.emergencySawmill = BIT_TEST(bits, 4) !== 0;
    this.emergencyStone = BIT_TEST(bits, 5) !== 0;
    this.emergencyActive = BIT_TEST(bits, 6) !== 0;
  }

  /* Begin cycling knights by sending knights from military buildings
     to inventories. The knights can then be replaced by more experienced
     knights. */
  cycleKnights(): void {
    this.knightCycling = true;
    this.knightLevelReduced = true;
    this.knightCycleCounter = 2400;
  }

  increaseCastleKnightsWanted(): void {
    this.castleKnightsWanted = Math.min(this.castleKnightsWanted + 1, 99);
  }

  decreaseCastleKnightsWanted(): void {
    this.castleKnightsWanted = Math.max(1, this.castleKnightsWanted - 1);
  }

  /* The castle of a save that did not keep it. */
  restoreCastle(castle: Building): void {
    if (this.building === 0) {
      this.building = castle.getIndex();
      if (castle.getInventory() != null) {
        this.castleInventory = castle.getInventory()!.getIndex();
      }
    }
  }

  buildingFounded(building_: Building): void {
    building_.setOwner(this.index);

    if (building_.getType() === BuildingType.TypeCastle) {
      this.castle = true;
      this.castleStanding = true;
      this.totalBuildingScore = u32(this.totalBuildingScore + buildingGetScoreFromType(BuildingType.TypeCastle));
      this.castleInventory = building_.getInventory()!.getIndex();
      this.building = building_.getIndex();
      this.createInitialCastleSerfs(building_);
      this.lastTick = u16(this.game.getTick());
    } else {
      this.incompleteBuildingCount[building_.getType()] += 1;
    }
  }

  buildingBuilt(building_: Building): void {
    const type: BuildingType = building_.getType();
    this.totalBuildingScore = u32(this.totalBuildingScore + buildingGetScoreFromType(type));
    this.completedBuildingCount[type] += 1;
    this.incompleteBuildingCount[type] -= 1;
  }

  buildingCaptured(building_: Building): void {
    const defPlayer: Player = this.game.getPlayer(building_.getOwner())!;

    defPlayer.addNotification(MessageType.TypeLoseFight, building_.getPosition(), this.index);
    this.addNotification(MessageType.TypeWinFight, building_.getPosition(), this.index);

    if (building_.getType() === BuildingType.TypeCastle) {
      this.castleScore += 1;
    } else {
      /* Update player scores. */
      defPlayer.totalBuildingScore = u32(
        defPlayer.totalBuildingScore - buildingGetScoreFromType(building_.getType()),
      );
      defPlayer.totalLandArea = u32(defPlayer.totalLandArea - 7);
      defPlayer.completedBuildingCount[building_.getType()] -= 1;

      this.totalBuildingScore = u32(this.totalBuildingScore + buildingGetScoreFromType(building_.getType()));
      this.totalLandArea = u32(this.totalLandArea + 7);
      this.completedBuildingCount[building_.getType()] += 1;

      /* Change owner of building */
      building_.setOwner(this.index);

      if (this.isAi()) {
        /* TODO AI */
      }
    }
  }

  buildingDemolished(building_: Building): void {
    /* Update player fields. */
    if (building_.isDone()) {
      this.totalBuildingScore = u32(this.totalBuildingScore - buildingGetScoreFromType(building_.getType()));

      if (building_.getType() !== BuildingType.TypeCastle) {
        this.completedBuildingCount[building_.getType()] -= 1;
      } else {
        this.castleStanding = false;
        this.castleScore -= 1;
      }
    } else {
      this.incompleteBuildingCount[building_.getType()] -= 1;
    }
  }

  getCompletedBuildingCount(type: number): number {
    return this.completedBuildingCount[type];
  }
  getIncompleteBuildingCount(type: number): number {
    return this.incompleteBuildingCount[type];
  }

  getToolPrio(type: number): number {
    return this.toolPrio[type];
  }
  setToolPrio(type: number, prio: number): void {
    this.toolPrio[type] = prio;
  }

  // int get_inventory_prio(int type) const and int *get_inventory_prio()
  getInventoryPrio(type: number): number;
  getInventoryPrio(): number[];
  getInventoryPrio(type?: number): number | number[] {
    if (type === undefined) return this.inventoryPrio;
    return this.inventoryPrio[type];
  }

  getTotalMilitaryScore(): number {
    return i32(this.totalMilitaryScore);
  }

  spawnSerfGeneric(): Serf | null {
    const serf: Serf | null = this.game.createSerf();
    if (serf == null) return null;

    serf.setOwner(this.index);

    this.serfCount[SerfType.TypeGeneric] += 1;

    return serf;
  }

  // Spawn new serf. Returns true on success.
  // The serf_t object and inventory are returned if non-NULL.
  // PORT: the C++ signature is
  //   bool spawn_serf(Serf **serf, Inventory **inventory, bool want_knight)
  // The two out parameters are the fields of `out`; pass null where the C++
  // passes nullptr for both.
  protected spawnSerf(
    out: { serf: Serf | null; inventory: Inventory | null } | null,
    wantKnight: boolean,
  ): boolean {
    if (!this.canSpawn()) {
      return false;
    }

    const inventories: Inventory[] = this.game.getPlayerInventories(this);
    if (inventories.length < 1) {
      return false;
    }

    let inv: Inventory | null = null;
    for (const loopInv of inventories) {
      if (loopInv.getSerfMode() === InventoryMode.ModeIn) {
        if (
          wantKnight &&
          (loopInv.getCountOf(ResourceType.TypeSword) === 0 || loopInv.getCountOf(ResourceType.TypeShield) === 0)
        ) {
          continue;
        } else if (loopInv.freeSerfCount() === 0) {
          inv = loopInv;
          break;
        } else if (inv == null || loopInv.freeSerfCount() < inv.freeSerfCount()) {
          inv = loopInv;
        }
      }
    }

    if (inv == null) {
      if (wantKnight) {
        return this.spawnSerf(out, false);
      } else {
        return false;
      }
    }

    const s = inv.spawnSerfGeneric();
    if (s == null) {
      return false;
    }

    if (out != null) {
      out.serf = s;
    }
    if (out != null) {
      out.inventory = inv;
    }

    return true;
  }

  tickSendGenericDelay(): boolean {
    this.sendGenericDelay -= 1;
    if (this.sendGenericDelay < 0) {
      this.sendGenericDelay = 5;
      return true;
    }
    return false;
  }

  tickSendKnightDelay(): boolean {
    this.sendKnightDelay -= 1;
    if (this.sendKnightDelay < 0) {
      this.sendKnightDelay = 5;
      return true;
    }
    return false;
  }

  getCyclingSerfType(type: SerfType): SerfType {
    if (this.cyclingSecond()) {
      type = -((this.knightCycleCounter >> 8) + 1) as SerfType;
    }
    return type;
  }

  increaseSerfCount(type: SerfType): void {
    this.serfCount[type]++;
  }

  decreaseSerfCount(type: SerfType): void {
    if (this.serfCount[type] === 0) {
      throw new ExceptionFreeserf('Failed to decrease serf count');
    }
    this.serfCount[type]--;
  }

  getSerfs(): number[] {
    return this.serfCount;
  }

  increaseResCount(type: ResourceType): void {
    this.resourceCount[type]++;
  }
  decreaseResCount(type: ResourceType): void {
    this.resourceCount[type]--;
  }

  /* Create the initial serfs that occupies the castle. */
  protected createInitialCastleSerfs(castle: Building): void {
    this.serfsSpawning = true;

    /* Spawn serf 4 */
    const inventory: Inventory = castle.getInventory()!;
    let serf: Serf | null = inventory.spawnSerfGeneric();
    if (serf == null) {
      return;
    }
    inventory.specializeSerf(serf, SerfType.TypeTransporterInventory);
    serf.initInventoryTransporter(inventory);

    this.game.getMap().setSerfIndex(serf.getPos(), serf.getIndex());

    const building_: Building = this.game.getBuilding(this.building)!;
    building_.setFirstKnight(serf.getIndex());

    /* Spawn generic serfs */
    for (let i = 0; i < 5; i++) {
      this.spawnSerf(null, false);
    }

    /* Spawn three knights */
    for (let i = 0; i < 3; i++) {
      serf = inventory.spawnSerfGeneric();
      if (serf == null) return;
      inventory.promoteSerfToKnight(serf);
    }

    /* Spawn toolmaker */
    serf = inventory.spawnSerfGeneric();
    if (serf == null) return;
    inventory.specializeSerf(serf, SerfType.TypeToolmaker);

    /* Spawn timberman */
    serf = inventory.spawnSerfGeneric();
    if (serf == null) return;
    inventory.specializeSerf(serf, SerfType.TypeLumberjack);

    /* Spawn sawmiller */
    serf = inventory.spawnSerfGeneric();
    if (serf == null) return;
    inventory.specializeSerf(serf, SerfType.TypeSawmiller);

    /* Spawn stonecutter */
    serf = inventory.spawnSerfGeneric();
    if (serf == null) return;
    inventory.specializeSerf(serf, SerfType.TypeStonecutter);

    /* Spawn digger */
    serf = inventory.spawnSerfGeneric();
    if (serf == null) return;
    inventory.specializeSerf(serf, SerfType.TypeDigger);

    /* Spawn builder */
    serf = inventory.spawnSerfGeneric();
    if (serf == null) return;
    inventory.specializeSerf(serf, SerfType.TypeBuilder);

    /* Spawn fisherman */
    serf = inventory.spawnSerfGeneric();
    if (serf == null) return;
    inventory.specializeSerf(serf, SerfType.TypeFisher);

    /* Spawn two geologists */
    for (let i = 0; i < 2; i++) {
      serf = inventory.spawnSerfGeneric();
      if (serf == null) return;
      inventory.specializeSerf(serf, SerfType.TypeGeologist);
    }

    /* Spawn two miners */
    for (let i = 0; i < 2; i++) {
      serf = inventory.spawnSerfGeneric();
      if (serf == null) return;
      inventory.specializeSerf(serf, SerfType.TypeMiner);
    }
  }

  /* The castle keeps a reserve of planks and stone back (Amiga
     game_build_castle @0x155de). */
  startEmergencyProgram(planks: number, stone: number): void {
    this.extraPlanks = planks;
    this.extraStone = stone;
    this.emergencyOver = false;
    this.outOfPlanks = false;
    this.outOfStone = false;
    this.emergencyLumberjack = false;
    this.emergencySawmill = false;
    this.emergencyStone = false;
    this.emergencyCounter = 0;
    this.lumberjackIndex = 0;
    this.sawmillIndex = 0;
    this.stonecutterIndex = 0;
  }

  /* Until the program is over the first lumberjack, sawmill and stonecutter
     are designated (Amiga game_build_building @0x18752). */
  designateEmergencyBuilding(bld: Building): void {
    if (this.emergencyOver) {
      return;
    }

    switch (bld.getType()) {
      case BuildingType.TypeLumberjack:
        if (this.lumberjackIndex === 0) this.lumberjackIndex = bld.getIndex();
        break;
      case BuildingType.TypeSawmill:
        if (this.sawmillIndex === 0) this.sawmillIndex = bld.getIndex();
        break;
      case BuildingType.TypeStonecutter:
        if (this.stonecutterIndex === 0) this.stonecutterIndex = bld.getIndex();
        break;
      default:
        break;
    }
  }

  /* A deleted building is no longer designated (the original keeps
     reading the stale record). */
  buildingDeleted(index: number): void {
    if (this.lumberjackIndex === index) this.lumberjackIndex = 0;
    if (this.sawmillIndex === index) this.sawmillIndex = 0;
    if (this.stonecutterIndex === index) this.stonecutterIndex = 0;
  }

  /* Emergency program: when the castle runs out of planks or stone, only
     the designated lumberjack, sawmill and stonecutter are built, until
     they are ready (Amiga player_update_emergency_program @0xb23c). */
  updateEmergencyProgram(): void {
    if (!this.isInGame() || this.emergencyOver || !this.hasCastle()) {
      return;
    }
    const inventory: Inventory | null = this.game.getInventory(this.castleInventory);
    /* After the castle is lost the original keeps reading its freed
       inventory record. */
    if (inventory == null || inventory.getOwner() !== this.index) {
      return;
    }

    if (!this.outOfPlanks && inventory.getCountOf(ResourceType.TypePlank) === 0) {
      this.outOfPlanks = true;
      if (!this.outOfStone) {
        this.emergencyActive = true;
        this.addNotification(MessageType.TypeEmergencyActive, 0, 0);
      }
      this.emergencyCounter = 2;
    }

    if (!this.outOfStone && inventory.getCountOf(ResourceType.TypeStone) === 0) {
      this.outOfStone = true;
      if (!this.outOfPlanks) {
        this.emergencyActive = true;
        this.addNotification(MessageType.TypeEmergencyActive, 0, 0);
      }
      this.emergencyCounter = 2;
    }

    /* After two cycles the reserve of the missing material is released. */
    if (this.emergencyCounter !== 0) {
      this.emergencyCounter -= 1;
      if (this.emergencyCounter === 0) {
        if (this.outOfPlanks && this.extraPlanks !== 0) {
          inventory.setCountOf(
            ResourceType.TypePlank,
            u32(inventory.getCountOf(ResourceType.TypePlank) + this.extraPlanks),
          );
          this.extraPlanks = 0;
        }
        if (this.outOfStone && this.extraStone !== 0) {
          inventory.setCountOf(
            ResourceType.TypeStone,
            u32(inventory.getCountOf(ResourceType.TypeStone) + this.extraStone),
          );
          this.extraStone = 0;
        }
      }
    }

    if (
      !this.emergencyLumberjack && this.lumberjackIndex !== 0 &&
      emergencyBuildingReady(this.game, this.lumberjackIndex)
    ) {
      this.emergencyLumberjack = true;
      this.lumberjackIndex = 0;
    }
    if (
      !this.emergencySawmill && this.sawmillIndex !== 0 &&
      emergencyBuildingReady(this.game, this.sawmillIndex)
    ) {
      this.emergencySawmill = true;
      this.sawmillIndex = 0;
    }
    if (
      !this.emergencyStone && this.stonecutterIndex !== 0 &&
      emergencyBuildingReady(this.game, this.stonecutterIndex)
    ) {
      this.emergencyStone = true;
      this.stonecutterIndex = 0;
    }

    if (this.emergencyLumberjack && this.emergencySawmill && this.emergencyStone) {
      this.emergencyOver = true;
      if (this.outOfPlanks || this.outOfStone) {
        this.emergencyActive = false;
        this.addNotification(MessageType.TypeEmergencyNeutral, 0, 0);
      }
      this.outOfPlanks = false;
      this.outOfStone = false;
      inventory.setCountOf(
        ResourceType.TypePlank,
        u32(inventory.getCountOf(ResourceType.TypePlank) + this.extraPlanks),
      );
      this.extraPlanks = 0;
      inventory.setCountOf(
        ResourceType.TypeStone,
        u32(inventory.getCountOf(ResourceType.TypeStone) + this.extraStone),
      );
      this.extraStone = 0;
    }
  }

  /* Update player game state as part of the game progression. */
  update(): void {
    const delta = u16(this.game.getTick() - this.lastTick);
    this.lastTick = u16(this.game.getTick());

    if (this.totalLandArea > 0xffff0000) this.totalLandArea = 0;
    if (this.totalMilitaryScore > 0xffff0000) this.totalMilitaryScore = 0;
    if (this.totalBuildingScore > 0xffff0000) this.totalBuildingScore = 0;

    if (!this.isInGame()) return;

    if (this.isAi()) {
      if (this.ai.u_1b2 !== 0) this.ai.u_1b2 -= 1;
      if (this.ai.u_1b0 !== 0) this.ai.u_1b0 -= 1;
    }

    if (this.cyclingKnight()) {
      this.knightCycleCounter -= delta;
      if (this.knightCycleCounter < 1) {
        this.knightCyclingSecond = false;
        this.knightCycling = false;
      } else if (this.knightCycleCounter < 2048 && this.reducedKnightLevel()) {
        this.knightCyclingSecond = true;
        this.knightLevelReduced = false;
      }
    }

    if (this.hasCastle()) {
      this.reproductionCounter -= delta;

      while (this.reproductionCounter < 0) {
        this.serfToKnightCounter = u16(this.serfToKnightCounter + this.serfToKnightRate);
        if (this.serfToKnightCounter < this.serfToKnightRate) {
          this.knightsToSpawn += 1;
          if (this.knightsToSpawn > 2) this.knightsToSpawn = 2;
        }

        if (this.knightsToSpawn === 0) {
          // Create unassigned serf
          this.spawnSerf(null, false);
        } else {
          // Create knight serf
          const out: { serf: Serf | null; inventory: Inventory | null } = { serf: null, inventory: null };
          if (this.spawnSerf(out, true)) {
            const serf = out.serf!;
            const inventory = out.inventory!;
            if (
              inventory.getCountOf(ResourceType.TypeSword) !== 0 &&
              inventory.getCountOf(ResourceType.TypeShield) !== 0
            ) {
              this.knightsToSpawn -= 1;
              inventory.specializeSerf(serf, SerfType.TypeKnight0);
            }
          }
        }

        this.reproductionCounter += i32(this.reproductionReset);
      }
    }

    /* Update timers */
    let it = 0;
    while (it !== this.timers.length) {
      this.timers[it].timeout -= delta;
      if (this.timers[it].timeout < 0) {
        /* Timer has expired. */
        /* TODO box (+ pos) timer */
        this.addNotification(MessageType.TypeCallToLocation, this.timers[it].pos, 0);
        this.timers.splice(it, 1);
      } else {
        ++it;
      }
    }
  }

  updateStats(res: number): void {
    const index: number = this.game.getResourceHistoryIndex();
    this.resourceCountHistory[res][index] = this.resourceCount[res];
    this.resourceCount[res] = 0;
  }

  // Stats
  updateKnightMorale(): void {
    let inventoryGold = 0;
    let militaryGold = 0;

    /* Sum gold collected in inventories */
    const inventories: Inventory[] = this.game.getPlayerInventories(this);
    for (const inventory of inventories) {
      inventoryGold = u32(inventoryGold + inventory.getCountOf(ResourceType.TypeGoldBar));
    }

    /* Sum gold deposited in military buildings */
    const buildings: Building[] = this.game.getPlayerBuildings(this);
    for (const building of buildings) {
      militaryGold = u32(militaryGold + building.militaryGoldCount());
    }

    let depot = u32(inventoryGold + militaryGold);
    this.goldDeposited = i32(inventoryGold + militaryGold);

    /* Calculate according to gold collected. */
    let totalGold: number = u32(this.game.getGoldTotal());
    if (totalGold !== 0) {
      while (totalGold > 0xffff) {
        totalGold >>>= 1;
        depot >>>= 1;
      }
      depot = Math.min(depot, u32(totalGold - 1));
      this.knightMorale = i32(
        1024 + idiv(u32(Math.imul(this.game.getGoldMoraleFactor(), depot)), totalGold),
      );
    } else {
      this.knightMorale = 4096;
    }

    /* Adjust based on castle score. */
    if (this.castleScore < 0) {
      this.knightMorale = Math.max(1, this.knightMorale - 1023);
    } else if (this.castleScore > 0) {
      this.knightMorale = Math.min(this.knightMorale + 1024 * this.castleScore, 0xffff);
    }

    /* Military strength against the other players, used by the AI (Amiga
       player_update_knight_morale @0xb4bc). */
    this.ai.militaryRatio = AI.calcMilitaryRatio(this.game, this);

    this.militaryMaxGold = 0;
  }

  getLandArea(): number {
    return i32(this.totalLandArea);
  }
  increaseLandArea(): void {
    this.totalLandArea = u32(this.totalLandArea + 1);
  }
  decreaseLandArea(): void {
    this.totalLandArea = u32(this.totalLandArea - 1);
  }
  getBuildingScore(): number {
    return i32(this.totalBuildingScore);
  }

  /* Calculate condensed score from military score and knight morale:
     ((military << 6) * (0x800 + (morale >> 1))) >> 16, at least 1 when there
     is any military score (as the original game). */
  getMilitaryScore(): number {
    // PORT: the C++ does this in uint64_t. The product stays below 2^53 for
    // any non-negative morale, so doubles hold it exactly.
    const military = u32(this.totalMilitaryScore << 6);
    let score = Math.floor((military * (2048 + (this.knightMorale >> 1))) / 65536);
    if (score === 0 && this.totalMilitaryScore !== 0) {
      score = 1;
    }
    return i32(score);
  }

  increaseMilitaryScore(val: number): void {
    this.totalMilitaryScore = u32(this.totalMilitaryScore + val);
  }
  decreaseMilitaryScore(val: number): void {
    this.totalMilitaryScore = u32(this.totalMilitaryScore - val);
  }
  increaseMilitaryMaxGold(val: number): void {
    this.militaryMaxGold += val;
  }

  getScore(): number {
    const milScore = this.getMilitaryScore();
    return i32(this.totalBuildingScore + (u32(this.totalLandArea + milScore) >>> 4));
  }

  getInitialSupplies(): number {
    return this.initialSupplies;
  }
  getResourceCountHistory(type: ResourceType): number[] {
    return this.resourceCountHistory[type];
  }
  setPlayerStatHistory(mode: number, ind: number, val: number): void {
    this.playerStatHistory[mode][ind] = val;
  }
  getPlayerStatHistory(mode: number): number[] {
    return this.playerStatHistory[mode];
  }

  getStatsResources(): ResourceMap {
    const resources: ResourceMap = new Map();

    /* Sum up resources of all inventories. */
    const inventories: Inventory[] = this.game.getPlayerInventories(this);
    for (const inventory of inventories) {
      for (let j = 0; j < 26; j++) {
        resources.set(
          j as ResourceType,
          u32((resources.get(j as ResourceType) ?? 0) + inventory.getCountOf(j as ResourceType)),
        );
      }
    }

    return resources;
  }

  getStatsSerfsIdle(): SerfMap {
    const res: SerfMap = new Map();

    /* Sum up all existing serfs. */
    const serfs: Serf[] = this.game.getPlayerSerfs(this);
    for (const serf of serfs) {
      if (serf.getState() === SerfState.StateIdleInStock) {
        res.set(serf.getType(), (res.get(serf.getType()) ?? 0) + 1);
      }
    }

    // PORT: a std::map iterates in key order, so the result is rebuilt with
    // its keys ascending.
    const sorted: SerfMap = new Map();
    for (const key of [...res.keys()].sort((a, b) => a - b)) {
      sorted.set(key, res.get(key)!);
    }
    return sorted;
  }

  getStatsSerfsPotential(): SerfMap {
    const res: SerfMap = new Map();

    /* Sum up potential serfs of all inventories. */
    const inventories: Inventory[] = this.game.getPlayerInventories(this);
    for (const inventory of inventories) {
      if (inventory.freeSerfCount() > 0) {
        for (let i = 0; i < 27; i++) {
          res.set(
            i as SerfType,
            u32((res.get(i as SerfType) ?? 0) + inventory.serfPotentialCount(i as SerfType)),
          );
        }
      }
    }

    return res;
  }

  // Settings
  getSerfToKnightRate(): number {
    return this.serfToKnightRate;
  }
  setSerfToKnightRate(rate: number): void {
    this.serfToKnightRate = rate;
  }

  getFoodForBuilding(bldType: number): number {
    let res = 0;
    switch (bldType) {
      case BuildingType.TypeStoneMine:
        res = this.getFoodStonemine();
        break;
      case BuildingType.TypeCoalMine:
        res = this.getFoodCoalmine();
        break;
      case BuildingType.TypeIronMine:
        res = this.getFoodIronmine();
        break;
      case BuildingType.TypeGoldMine:
        res = this.getFoodGoldmine();
        break;
      default:
        break;
    }
    return res;
  }

  getFoodStonemine(): number {
    return this.foodStonemine;
  }
  setFoodStonemine(val: number): void {
    this.foodStonemine = val;
  }
  getFoodCoalmine(): number {
    return this.foodCoalmine;
  }
  setFoodCoalmine(val: number): void {
    this.foodCoalmine = val;
  }
  getFoodIronmine(): number {
    return this.foodIronmine;
  }
  setFoodIronmine(val: number): void {
    this.foodIronmine = val;
  }
  getFoodGoldmine(): number {
    return this.foodGoldmine;
  }
  setFoodGoldmine(val: number): void {
    this.foodGoldmine = val;
  }
  getPlanksConstruction(): number {
    return this.planksConstruction;
  }
  setPlanksConstruction(val: number): void {
    this.planksConstruction = val;
  }
  getPlanksBoatbuilder(): number {
    return this.planksBoatbuilder;
  }
  setPlanksBoatbuilder(val: number): void {
    this.planksBoatbuilder = val;
  }
  getPlanksToolmaker(): number {
    return this.planksToolmaker;
  }
  setPlanksToolmaker(val: number): void {
    this.planksToolmaker = val;
  }
  getSteelToolmaker(): number {
    return this.steelToolmaker;
  }
  setSteelToolmaker(val: number): void {
    this.steelToolmaker = val;
  }
  getSteelWeaponsmith(): number {
    return this.steelWeaponsmith;
  }
  setSteelWeaponsmith(val: number): void {
    this.steelWeaponsmith = val;
  }
  getCoalSteelsmelter(): number {
    return this.coalSteelsmelter;
  }
  setCoalSteelsmelter(val: number): void {
    this.coalSteelsmelter = val;
  }
  getCoalGoldsmelter(): number {
    return this.coalGoldsmelter;
  }
  setCoalGoldsmelter(val: number): void {
    this.coalGoldsmelter = val;
  }
  getCoalWeaponsmith(): number {
    return this.coalWeaponsmith;
  }
  setCoalWeaponsmith(val: number): void {
    this.coalWeaponsmith = val;
  }
  getWheatPigfarm(): number {
    return this.wheatPigfarm;
  }
  setWheatPigfarm(val: number): void {
    this.wheatPigfarm = val;
  }
  getWheatMill(): number {
    return this.wheatMill;
  }
  setWheatMill(val: number): void {
    this.wheatMill = val;
  }

  // TODO(savegame)
}

/* A designated building counts as ready when it is finished or has all
   its construction material (Amiga @0xb31a). */
function emergencyBuildingReady(game: Game, index: number): boolean {
  const building: Building | null = game.getBuilding(index);
  if (building == null) return true;
  if (building.isDone()) return true;
  return (
    u32(building.getResCountInStock(0) + building.getResCountInStock(1)) ===
    u32(building.getMaximumInStock(0) + building.getMaximumInStock(1))
  );
}
