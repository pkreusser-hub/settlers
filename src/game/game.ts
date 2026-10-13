/*
 * game.ts - Gameplay related functions
 *
 * Port of Freeserf's game.h and game.cc.
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

/* The following are functions that concern the gameplay as
   a whole. Functions that only act on a specific game object should
   go in the respective source file. */

import {
  BIT,
  BIT_TEST,
  clamp,
  ExceptionFreeserf,
  i32,
  idiv,
  Log,
  NOT_REACHED,
  u16,
  u32,
} from './misc';
import { Collection } from './objects';
import { Random } from './random';
import { ResourceType } from './resource';
import {
  cycleDirectionsCcw,
  cycleDirectionsCw,
  Direction,
  MapGeometry,
  reverseDirection,
  turnDirection,
} from './map-geometry';
import type { MapPos } from './map-geometry';
// PORT: the C++ class is called Map, which shadows the JS Map used for
// std::map here, so it is imported under a local alias.
import { Map as GameMap, MapMinerals, MapObject, MapSpace, MapTerrain } from './map';
import type { MapPosRef, Road } from './map';
import { ClassicMissionMapGenerator } from './map-generator';
import { MessageType, Player } from './player';
// PORT: struct AILocation of ai.h lives in player.ts.
import type { AILocation, PlayerColor } from './player';
import { AI } from './ai';
import { Flag, FlagSearch, SerfPathInfo } from './flag';
import { Building, BuildingType } from './building';
import { Serf, SerfState, SerfType } from './serf';
import { Inventory, InventoryMode } from './inventory';

export const DEFAULT_GAME_SPEED = 2;

export const GAME_MAX_PLAYER_COUNT = 4;

const GROUND_ANALYSIS_RADIUS = 25;

export type ListSerfs = Serf[];
export type ListBuildings = Building[];
export type ListInventories = Inventory[];

type Values = Map<number, number>;

/* Game types of the original (Amiga game+0x352). */
export enum GameGameType {
  GameTypeMission = 0,
  GameTypeTutorial = 1,
  GameTypeOnePlayer = 2,
  GameTypeTwoPlayers = 3,
  GameTypeDemo = 4,
}

// PORT: these are exactly the static methods of the C++ class AI (ai.ts)
// that game.cc calls. Game holds the implementation in the field `ai`,
// which is the class AI unless setAI() replaces it.
export interface GameAI {
  /* Scheduler slots (Amiga update_scheduled @0xa864). */
  update(game: Game, player: Player): void; /* 33..48 */
  scanSites(game: Game, player: Player): void; /* 0..31 */
  updateBuildDampingAll(game: Game): void; /* 32 */
  /* A knight of the player occupied the enemy building with the flag at
     flag_pos: remember it to connect it by road later (Amiga @0xd68c). */
  buildingConquered(game: Game, player: Player, flagPos: MapPos): void;
}

// PORT: this is the C++ `struct GameAI` of ai.h (AI work fields of the game
// record, the type of Game::ai_game). The name GameAI is taken by the
// interface above, so the struct is called GameAIFields here.
export interface GameAIFields {
  g246: number; /* game+0x246 */
  g248: number; /* game+0x248 */
  g24a: number; /* game+0x24a (col of the road end / flag built) */
  g24c: number; /* game+0x24c (row) */
  g24e: number; /* game+0x24e */
  someLocation: AILocation | null; /* game+0x254 */
  buildBuildingType: number; /* game+0x27a */
  ticks288: number; /* game+0x288, ticks for update_build_damping */
  /* game+0x12c land_influence, used by the AI as a scratch byte array
     (indexed like the Amiga byte offsets). */
  landInfluence: Uint8Array;
}

// PORT: out parameters (`MapPos *dest`, `bool *water`, `int *select`)
// are passed as a box object.
export interface Ref<T> {
  value: T;
}

interface UpdateInventoriesData {
  resource: ResourceType;
  maxPrio: number[];
  flags: (Flag | null)[];
}

interface SendSerfToFlagData {
  inventory: Inventory | null;
  building: Building | null;
  serfType: number;
  destIndex: number;
  res1: ResourceType;
  res2: ResourceType;
}

// PORT: std::map iterates in key order; a JS Map iterates in insertion
// order, so the entries are sorted first.
function sortedEntries(values: Values): [number, number][] {
  return [...values.entries()].sort((a, b) => a[0] - b[0]);
}

/* Sum of a resource's production history (Amiga history_sum_120). */
export function historySum(player: Player, resource: ResourceType): number {
  const history = player.getResourceCountHistory(resource);
  let sum = 0;
  for (let i = 0; i < 120; i++) {
    sum = u32(sum + history[i]);
  }
  return sum;
}

/* For each corner of a flag (between the directions d and d + 1, where
   the flag has no paths): the neighbour and the direction of the path
   segment there that passes the corner. */
// PORT: written as numbers, so that loading this module does not touch
// the exports of map-geometry.
export const cornerNeighbour: Direction[] = [
  0 /* DirectionRight */, 2 /* DirectionDown */, 3 /* DirectionLeft */,
  3 /* DirectionLeft */, 5 /* DirectionUp */, 0 /* DirectionRight */,
];
export const cornerPath: Direction[] = [
  2 /* DirectionDown */, 0 /* DirectionRight */, 1 /* DirectionDownRight */,
  5 /* DirectionUp */, 3 /* DirectionLeft */, 4 /* DirectionUpLeft */,
];

export class Game {
  static GameType = GameGameType;

  // PORT: PMap is a shared_ptr that is empty until init(); typed non-null
  // here because every method of the C++ dereferences it unchecked.
  protected map!: GameMap;

  protected mapGoldMoraleFactor: number;
  protected goldTotal: number;

  protected players: Collection<Player>;
  protected flags: Collection<Flag>;
  // PORT: `friend class AI` in the C++; the computer player reads these
  // and gameSpeed, and calls demolishFlag_ and demolishBuilding_.
  inventories: Collection<Inventory>;
  buildings: Collection<Building>;
  serfs: Collection<Serf>;

  protected initMapRnd: Random = new Random();
  protected gameSpeedSave: number;
  gameSpeed: number;
  protected tick: number;
  protected lastTick: number;
  protected constTick: number;
  protected gameStatsCounter: number;
  protected historyCounter: number;
  protected rnd: Random = new Random();
  protected nextIndex: number; // uint16_t
  protected flagSearchCounter: number; // uint16_t

  protected updateMapLastTick: number; // uint16_t
  protected updateMapCounter: number; // int16_t
  protected updateMapInitialPos: MapPos;
  protected tickDiff: number;
  protected maxNextIndex: number; // uint16_t
  protected updateMap16Loop: number; // int16_t
  protected playerHistoryIndex: number[] = [0, 0, 0, 0];
  protected playerHistoryCounter: number[] = [0, 0, 0];
  protected resourceHistoryIndex: number;
  protected field340: number; // uint16_t
  protected field342: number; // uint16_t
  protected field344: Inventory | null;
  protected gameType: number;
  protected tutorialLevel: number;
  protected missionLevel: number;
  protected mapPreserveBugs: number;
  /* The clear leaders of the land and of the military, -1 none (packed as
     "player_score_leader" in the saves: bits 0..3 and 4..7). */
  protected landLeader: number;
  protected militaryLeader: number;
  protected winningPlayer: number;
  protected gameEndPending: boolean;

  /* Work fields of the computer players. */
  protected aiGame: GameAIFields;

  // PORT: the computer player, see GameAI.
  protected ai: GameAI = AI;

  protected knightMoraleCounter: number;
  protected inventoryScheduleCounter: number;

  constructor() {
    this.mapGoldMoraleFactor = 0;
    this.gameSpeedSave = 0;
    this.lastTick = 0;
    this.field340 = 0;
    this.field342 = 0;
    this.field344 = null;
    this.tutorialLevel = 0;
    this.missionLevel = 0;
    this.mapPreserveBugs = 0;
    this.landLeader = -1;
    this.militaryLeader = -1;
    this.winningPlayer = -1;
    this.gameEndPending = false;
    this.aiGame = {
      g246: 0,
      g248: 0,
      g24a: 0,
      g24c: 0,
      g24e: 0,
      someLocation: null,
      buildBuildingType: 0,
      ticks288: 0,
      landInfluence: new Uint8Array(8192),
    };

    this.players = new Collection<Player>(this, (g, i) => new Player(g, i));
    this.flags = new Collection<Flag>(this, (g, i) => new Flag(g, i));
    this.inventories = new Collection<Inventory>(this, (g, i) => new Inventory(g, i));
    this.buildings = new Collection<Building>(this, (g, i) => new Building(g, i));
    this.serfs = new Collection<Serf>(this, (g, i) => new Serf(g, i));

    /* Create NULL-serf */
    this.serfs.allocate();

    /* Create NULL-building (index 0 is undefined) */
    this.buildings.allocate();

    /* Create NULL-flag (index 0 is undefined) */
    this.flags.allocate();

    /* Initialize global lookup tables */
    this.gameSpeed = DEFAULT_GAME_SPEED;

    this.updateMapLastTick = 0;
    this.updateMapCounter = 0;
    this.updateMap16Loop = 0;
    this.updateMapInitialPos = 0;
    this.nextIndex = 0;

    this.playerHistoryIndex.fill(0);
    this.playerHistoryCounter.fill(0);
    this.resourceHistoryIndex = 0;

    this.tick = 0;
    this.constTick = 0;
    this.tickDiff = 0;

    this.maxNextIndex = 0;
    this.gameType = GameGameType.GameTypeOnePlayer;
    this.flagSearchCounter = 0;
    this.gameStatsCounter = 0;
    this.historyCounter = 0;

    this.knightMoraleCounter = 0;
    this.inventoryScheduleCounter = 0;

    this.goldTotal = 0;
  }

  // PORT: Game::~Game(). There are no destructors; call this to drop the
  // objects of a game.
  destroy(): void {
    this.serfs.clear();
    this.inventories.clear();
    this.buildings.clear();
    this.flags.clear();
    this.players.clear();
  }

  getMap(): GameMap {
    return this.map;
  }

  getTick(): number {
    return this.tick;
  }
  isPaused(): boolean {
    return this.gameSpeed === 0;
  }
  getAiGame(): GameAIFields {
    return this.aiGame;
  }
  setMaxNextIndex(value: number): void {
    this.maxNextIndex = u16(value);
  }

  // PORT: not in the C++, where the AI is a class of static methods.
  getAI(): GameAI {
    return this.ai;
  }
  setAI(ai: GameAI): void {
    this.ai = ai;
  }

  getGameType(): number {
    return this.gameType;
  }
  getMissionLevel(): number {
    return this.missionLevel;
  }
  getTutorialLevel(): number {
    return this.tutorialLevel;
  }
  /* The winner once the game is decided, -1 before. */
  getWinningPlayer(): number {
    return this.winningPlayer;
  }
  isGameEndPending(): boolean {
    return this.gameEndPending;
  }
  clearGameEndPending(): void {
    this.gameEndPending = false;
  }
  getConstTick(): number {
    return this.constTick;
  }
  getGoldMoraleFactor(): number {
    return u32(this.mapGoldMoraleFactor);
  }
  getGoldTotal(): number {
    return this.goldTotal;
  }

  getPlayerHistoryIndex(scale: number): number {
    return this.playerHistoryIndex[scale];
  }
  getResourceHistoryIndex(): number {
    return this.resourceHistoryIndex;
  }

  getSerf(index: number): Serf | null {
    return this.serfs.get(index);
  }
  getFlag(index: number): Flag | null {
    return this.flags.get(index);
  }
  getInventory(index: number): Inventory | null {
    return this.inventories.get(index);
  }
  getBuilding(index: number): Building | null {
    return this.buildings.get(index);
  }
  getPlayer(index: number): Player | null {
    return this.players.get(index);
  }

  /* Clear the serf request bit of all flags and buildings.
     This allows the flag or building to try and request a
     serf again. */
  protected clearSerfRequestFailure(): void {
    for (const building of this.buildings) {
      building.clearSerfRequestFailure();
    }

    for (const flag of this.flags) {
      flag.serfRequestClear();
    }
  }

  protected updateKnightMorale(): void {
    for (const player of this.players) {
      player.updateKnightMorale();
    }
  }

  protected static updateInventoriesCb(flag: Flag, data: UpdateInventoriesData): boolean {
    const inv: number = flag.getSearchDir();
    if (data.maxPrio[inv] < 255 && flag.hasBuilding()) {
      const building = flag.getBuilding()!;

      const bldPrio = building.getMaxPriorityForResource(data.resource, 16);
      if (bldPrio > data.maxPrio[inv]) {
        data.maxPrio[inv] = bldPrio;
        data.flags[inv] = flag;
      }
    }

    return false;
  }

  /* Update inventories as part of the game progression. Moves the appropriate
     resources that are needed outside of the inventory into the out queue. */
  protected updateInventories(): void {
    const arr1: ResourceType[] = [
      ResourceType.TypePlank,
      ResourceType.TypeStone,
      ResourceType.TypeSteel,
      ResourceType.TypeCoal,
      ResourceType.TypeLumber,
      ResourceType.TypeIronOre,
      ResourceType.GroupFood,
      ResourceType.TypePig,
      ResourceType.TypeFlour,
      ResourceType.TypeWheat,
      ResourceType.TypeGoldBar,
      ResourceType.TypeGoldOre,
      ResourceType.TypeNone,
    ];

    const arr2: ResourceType[] = [
      ResourceType.TypeStone,
      ResourceType.TypeIronOre,
      ResourceType.TypeGoldOre,
      ResourceType.TypeCoal,
      ResourceType.TypeSteel,
      ResourceType.TypeGoldBar,
      ResourceType.GroupFood,
      ResourceType.TypePig,
      ResourceType.TypeFlour,
      ResourceType.TypeWheat,
      ResourceType.TypeLumber,
      ResourceType.TypePlank,
      ResourceType.TypeNone,
    ];

    const arr3: ResourceType[] = [
      ResourceType.GroupFood,
      ResourceType.TypeWheat,
      ResourceType.TypePig,
      ResourceType.TypeFlour,
      ResourceType.TypeGoldBar,
      ResourceType.TypeStone,
      ResourceType.TypePlank,
      ResourceType.TypeSteel,
      ResourceType.TypeCoal,
      ResourceType.TypeLumber,
      ResourceType.TypeGoldOre,
      ResourceType.TypeIronOre,
      ResourceType.TypeNone,
    ];

    /* AI: TODO */

    let arr: ResourceType[];
    switch (this.randomInt() & 7) {
      case 0: arr = arr2; break;
      case 1: arr = arr3; break;
      default: arr = arr1; break;
    }

    // PORT: `arr += 1` on the pointer becomes the index a.
    let a = 0;
    while (arr[a] !== ResourceType.TypeNone) {
      for (const player of this.players) {
        const invs: Inventory[] = [];
        let n = 0;
        for (const inventory of this.inventories) {
          if (inventory.getOwner() === player.getIndex() &&
              !inventory.isQueueFull()) {
            const resDir = inventory.getResMode();
            if (resDir === InventoryMode.ModeIn || resDir === InventoryMode.ModeStop) {
              if (arr[a] === ResourceType.GroupFood) {
                if (inventory.hasFood()) {
                  invs[n++] = inventory;
                  if (n === 256) break;
                }
              } else if (inventory.getCountOf(arr[a]) !== 0) {
                invs[n++] = inventory;
                if (n === 256) break;
              }
            } else { /* Out mode */
              let prio = 0;
              let type: ResourceType = ResourceType.TypeNone;
              for (let i = 0; i < 26; i++) {
                if (inventory.getCountOf(i as ResourceType) !== 0 &&
                    player.getInventoryPrio(i) >= prio) {
                  prio = player.getInventoryPrio(i);
                  type = i as ResourceType;
                }
              }

              if (type !== ResourceType.TypeNone) {
                inventory.addToQueue(type, 0);
              }
            }
          }
        }

        if (n === 0) continue;

        const search = new FlagSearch(this);

        const maxPrio: number[] = new Array<number>(256);
        const flags_: (Flag | null)[] = new Array<Flag | null>(256);

        for (let i = 0; i < n; i++) {
          maxPrio[i] = 0;
          flags_[i] = null;
          const flag = this.flags.get(invs[i].getFlagIndex())!;
          flag.setSearchDir(i as Direction);
          search.addSource(flag);
        }

        const data: UpdateInventoriesData = {
          resource: arr[a],
          maxPrio: maxPrio,
          flags: flags_,
        };
        search.execute(Game.updateInventoriesCb, false, true, data);

        for (let i = 0; i < n; i++) {
          if (maxPrio[i] > 0) {
            Log.Verbose('game', ' dest for inventory ', i, 'found');
            const res: ResourceType = arr[a];

            const destBld = flags_[i]!.getBuilding()!;
            if (!destBld.addRequestedResource(res, false)) {
              throw new ExceptionFreeserf('Failed to request resource.');
            }

            /* Put resource in out queue */
            const srcInv = invs[i];
            srcInv.addToQueue(res, destBld.getFlagIndex());
          }
        }
      }
      a += 1;
    }
  }

  /* Update flags as part of the game progression. */
  protected updateFlags(): void {
    for (const flag of this.flags) {
      flag.update();
    }
  }

  protected static sendSerfToFlagSearchCb(flag: Flag, data: SendSerfToFlagData): boolean {
    if (!flag.hasInventory()) {
      return false;
    }

    /* Inventory reached */
    const building = flag.getBuilding()!;
    const inv = building.getInventory()!;

    const type = data.serfType;
    if (type < 0) {
      let knightType = -1;
      for (let i = 4; i >= -type - 1; i--) {
        if (inv.haveSerf((SerfType.TypeKnight0 + i) as SerfType)) {
          knightType = i;
          break;
        }
      }

      if (knightType >= 0) {
        /* Knight of appropriate type was found. */
        const serf = inv.callOutSerf((SerfType.TypeKnight0 + knightType) as SerfType) as Serf;

        data.building!.knightRequestGranted();

        serf.goOutFromInventory(inv.getIndex(),
                                data.building!.getFlagIndex(), -1);

        return true;
      } else if (type === -1) {
        /* See if a knight can be created here. */
        if (inv.haveSerf(SerfType.TypeGeneric) &&
            inv.getCountOf(ResourceType.TypeSword) > 0 &&
            inv.getCountOf(ResourceType.TypeShield) > 0) {
          data.inventory = inv;
          return true;
        }
      }
    } else {
      if (inv.haveSerf(type as SerfType)) {
        if (type !== SerfType.TypeGeneric || inv.freeSerfCount() > 4) {
          const serf = inv.callOutSerf(type as SerfType) as Serf;

          let mode = 0;

          if (type === SerfType.TypeGeneric) {
            mode = -2;
          } else if (type === SerfType.TypeGeologist) {
            mode = 6;
          } else {
            const destBld =
              flag.getGame().flags.get(data.destIndex)!.getBuilding()!;
            destBld.serfRequestGranted();
            mode = -1;
          }

          serf.goOutFromInventory(inv.getIndex(), data.destIndex, mode);

          return true;
        }
      } else {
        if (data.inventory == null &&
            inv.haveSerf(SerfType.TypeGeneric) &&
            (data.res1 === -1 || inv.getCountOf(data.res1) > 0) &&
            (data.res2 === -1 || inv.getCountOf(data.res2) > 0)) {
          data.inventory = inv;
          /* player_t *player = globals->player[SERF_PLAYER(serf)]; */
          /* game.field_340 = player->cont_search_after_non_optimal_find; */
          return true;
        }
      }
    }

    return false;
  }

  /* Dispatch serf from (nearest?) inventory to flag. */
  sendSerfToFlag(dest: Flag, type: SerfType, res1: ResourceType,
                 res2: ResourceType): boolean {
    let building: Building | null = null;
    if (dest.hasBuilding()) {
      building = dest.getBuilding();
    }

    /* If type is negative, building is non-NULL. */
    if ((type < 0) && (building != null)) {
      const player = this.players.get(building.getOwner())!;
      type = player.getCyclingSerfType(type);
    }

    const data: SendSerfToFlagData = {
      inventory: null,
      building: building,
      serfType: type,
      destIndex: dest.getIndex(),
      res1: res1,
      res2: res2,
    };

    const r = FlagSearch.single(dest, Game.sendSerfToFlagSearchCb, true, false,
                                data);
    if (!r) {
      return false;
    } else if (data.inventory != null) {
      const inventory: Inventory = data.inventory;
      const serf = inventory.callOutSerf(SerfType.TypeGeneric) as Serf;

      if ((type < 0) && (building != null)) {
        /* Knight */
        building.knightRequestGranted();

        serf.setType(SerfType.TypeKnight0);
        serf.goOutFromInventory(inventory.getIndex(),
                                building.getFlagIndex(), -1);

        inventory.popResource(ResourceType.TypeSword);
        inventory.popResource(ResourceType.TypeShield);
      } else {
        serf.setType(type);

        let mode = 0;

        if (type === SerfType.TypeGeologist) {
          mode = 6;
        } else {
          if (building == null) {
            return false;
          }
          building.serfRequestGranted();
          mode = -1;
        }

        serf.goOutFromInventory(inventory.getIndex(), dest.getIndex(),
                                mode);

        if (res1 !== ResourceType.TypeNone) inventory.popResource(res1);
        if (res2 !== ResourceType.TypeNone) inventory.popResource(res2);
      }

      return true;
    }

    return true;
  }

  /* Dispatch geologist to flag. */
  sendGeologist(dest: Flag): boolean {
    return this.sendSerfToFlag(dest, SerfType.TypeGeologist, ResourceType.TypeHammer,
                               ResourceType.TypeNone);
  }

  /* Update buildings as part of the game progression. */
  protected updateBuildings(): void {
    // PORT: the C++ iterates a copy of the collection; a snapshot of its
    // objects is the same thing.
    const blds = [...this.buildings];
    for (const building of blds) {
      building.update(this.tick);
    }
  }

  /* Update serfs as part of the game progression. */
  protected updateSerfs(): void {
    /* Updating a serf can delete other serfs (e.g. a lost fight) or create
       new ones, which invalidates iterators of the collection. Go through
       the indexes taken before and skip serfs deleted in the meantime. */
    const indexes: number[] = [];
    for (const serf of this.serfs) {
      indexes.push(serf.getIndex());
    }

    for (const index of indexes) {
      const serf = this.serfs.get(index);
      if (serf != null && serf.getIndex() !== 0) {
        serf.update();
      }
    }
  }

  /* Update historical player statistics for one measure. */
  protected recordPlayerHistory(maxLevel: number, aspect: number,
                                historyIndex: number[],
                                values: Values): void {
    const entries = sortedEntries(values);
    let total = 0;
    for (const value of entries) {
      total = u32(total + value[1]);
    }
    total = Math.max(1, total);

    for (let i = 0; i < maxLevel + 1; i++) {
      const mode = (aspect << 2) | i;
      const index = historyIndex[i];
      for (const value of entries) {
        const val = value[1];
        this.players.get(value[0])!.setPlayerStatHistory(mode, index,
                                                         i32(idiv(100 * val, total)));
      }
    }
  }

  setGameType(type: number, level: number): void {
    this.gameType = type;
    this.tutorialLevel = (type === GameGameType.GameTypeTutorial) ? level : 0;
    this.missionLevel = (type === GameGameType.GameTypeMission) ? level : 0;
  }

  /* Calculate whether one player has enough advantage to be
     considered a clear winner regarding one aspect: more than 74 percent,
     counted as (100 * value - 1) / total with the total scaled down to at
     most 0xfffe (Amiga record_player_history @0x895e).
     Return -1 if there is no clear winner. */
  protected calculateClearWinner(values: Values): number {
    const scaled = sortedEntries(values);
    // uint64_t in the C++; a sum of a few uint32 stays exact in a double.
    let total = 0;
    for (const value of scaled) {
      total += value[1];
    }
    while (total > 0xfffe) {
      total = Math.floor(total / 2);
      for (const value of scaled) {
        value[1] = value[1] >>> 1;
      }
    }
    total = Math.max(1, total);

    for (const value of scaled) {
      let val = 100 * value[1];
      if (val !== 0) val -= 1;
      if (idiv(val, total) > 74) return value[0];
    }

    return -1;
  }

  /* The human player completes a tutorial with its goal (Amiga
     update_game_stats @0x86ac). */
  protected updateTutorial(): void {
    const player = this.getPlayer(0);
    if (this.winningPlayer >= 0 || player == null) {
      return;
    }

    let completed = false;
    switch (this.tutorialLevel) {
      case 1: // Military buildings
        completed =
          player.getCompletedBuildingCount(BuildingType.TypeHut) !== 0 &&
          player.getCompletedBuildingCount(BuildingType.TypeTower) !== 0 &&
          player.getCompletedBuildingCount(BuildingType.TypeFortress) !== 0;
        break;
      case 2: // Stone and planks
        completed = historySum(player, ResourceType.TypeStone) >= 5 &&
                    historySum(player, ResourceType.TypePlank) >= 5;
        break;
      case 3: // Food
        completed = historySum(player, ResourceType.TypeFish) >= 5 &&
                    historySum(player, ResourceType.TypeMeat) >= 5 &&
                    historySum(player, ResourceType.TypeBread) >= 5;
        break;
      case 4: // Steel and gold
        completed = historySum(player, ResourceType.TypeSteel) >= 5 &&
                    historySum(player, ResourceType.TypeGoldBar) >= 5;
        break;
      case 5: { // Weapons and tools
        const weapons = u32(historySum(player, ResourceType.TypeSword) +
                            historySum(player, ResourceType.TypeShield));
        let tools = 0;
        for (let r: number = ResourceType.TypeShovel; r <= ResourceType.TypePincer; r++) {
          tools = u32(tools + historySum(player, r as ResourceType));
        }
        completed = weapons >= 10 && tools >= 10;
        break;
      }
      default: { // Conquer the enemy's land
        const enemy = this.getPlayer(1);
        completed = (enemy == null) || (enemy.getLandArea() === 0);
        break;
      }
    }

    if (completed) {
      this.winningPlayer = 0;
      this.gameEndPending = true;
    }
  }

  /* A player leading both in land and in military wins once the players
     have 50 building points in total. In a mission, the human player can
     still win after a computer player has (Amiga update_game_stats
     @0x87fc). */
  protected updateWinner(): void {
    let buildingTotal = 0;
    for (const player of this.players) {
      buildingTotal += player.getBuildingScore();
    }
    if (buildingTotal < 50) {
      return;
    }

    /* The leader of both the land and the military. */
    let leader = -1;
    if (this.landLeader >= 0 && this.landLeader === this.militaryLeader &&
        this.players.get(this.landLeader) != null) {
      leader = this.landLeader;
    }

    if (this.winningPlayer < 0) {
      if (leader >= 0) {
        this.winningPlayer = leader;
        this.gameEndPending = true;
      }
    } else if (this.winningPlayer > 0 && this.gameType === GameGameType.GameTypeMission &&
               leader === 0) {
      this.winningPlayer = 0;
      this.gameEndPending = true;
    }
  }

  /* The leaders of a save, a bit for each player. */
  protected setScoreLeaderBits(bits: number): void {
    this.landLeader = -1;
    this.militaryLeader = -1;
    for (let i = 0; i < 4; i++) {
      if (BIT_TEST(bits, i) && this.landLeader < 0) this.landLeader = i;
      if (BIT_TEST(bits, i + 4) && this.militaryLeader < 0) this.militaryLeader = i;
    }
  }

  /* Update statistics of the game. */
  protected updateGameStats(): void {
    if (i32(this.gameStatsCounter) > this.tickDiff) {
      this.gameStatsCounter = u32(this.gameStatsCounter - this.tickDiff);
    } else {
      this.gameStatsCounter = u32(this.gameStatsCounter + 1500 - this.tickDiff);

      this.landLeader = -1;
      this.militaryLeader = -1;

      let updateLevel = 0;

      /* Update first level index */
      this.playerHistoryIndex[0] = this.playerHistoryIndex[0] + 1 < 112 ?
                                   this.playerHistoryIndex[0] + 1 : 0;

      this.playerHistoryCounter[0] -= 1;
      if (this.playerHistoryCounter[0] < 0) {
        updateLevel = 1;
        this.playerHistoryCounter[0] = 3;

        /* Update second level index */
        this.playerHistoryIndex[1] = this.playerHistoryIndex[1] + 1 < 112 ?
                                     this.playerHistoryIndex[1] + 1 : 0;

        this.playerHistoryCounter[1] -= 1;
        if (this.playerHistoryCounter[1] < 0) {
          updateLevel = 2;
          this.playerHistoryCounter[1] = 4;

          /* Update third level index */
          this.playerHistoryIndex[2] = this.playerHistoryIndex[2] + 1 < 112 ?
                                       this.playerHistoryIndex[2] + 1 : 0;

          this.playerHistoryCounter[2] -= 1;
          if (this.playerHistoryCounter[2] < 0) {
            updateLevel = 3;

            this.playerHistoryCounter[2] = 4;

            /* Update fourth level index */
            this.playerHistoryIndex[3] = this.playerHistoryIndex[3] + 1 < 112 ?
                                         this.playerHistoryIndex[3] + 1 : 0;
          }
        }
      }

      const values: Values = new Map<number, number>();

      /* Store land area stats in history. */
      for (const player of this.players) {
        values.set(player.getIndex(), u32(player.getLandArea()));
      }
      this.recordPlayerHistory(updateLevel, 1, this.playerHistoryIndex, values);
      this.landLeader = this.calculateClearWinner(values);

      /* Store building stats in history. */
      for (const player of this.players) {
        values.set(player.getIndex(), u32(player.getBuildingScore()));
      }
      this.recordPlayerHistory(updateLevel, 2, this.playerHistoryIndex, values);

      /* Store military stats in history. */
      for (const player of this.players) {
        values.set(player.getIndex(), u32(player.getMilitaryScore()));
      }
      this.recordPlayerHistory(updateLevel, 3, this.playerHistoryIndex, values);
      this.militaryLeader = this.calculateClearWinner(values);

      /* Store condensed score of all aspects in history. */
      for (const player of this.players) {
        values.set(player.getIndex(), u32(player.getScore()));
      }
      this.recordPlayerHistory(updateLevel, 0, this.playerHistoryIndex, values);

      if (this.gameType === GameGameType.GameTypeTutorial) {
        this.updateTutorial();
      } else {
        this.updateWinner();
      }
    }

    if (i32(this.historyCounter) > this.tickDiff) {
      this.historyCounter = u32(this.historyCounter - this.tickDiff);
    } else {
      this.historyCounter = u32(this.historyCounter + 6000 - this.tickDiff);

      const index = this.resourceHistoryIndex;

      for (let res = 0; res < 26; res++) {
        for (const player of this.players) {
          player.updateStats(res);
        }
      }

      this.resourceHistoryIndex = index + 1 < 120 ? index + 1 : 0;
    }
  }

  /* Update game state after tick increment. */
  update(): void {
    /* Increment tick counters */
    this.constTick = u32(this.constTick + 1);

    /* Update tick counters based on game speed */
    this.lastTick = this.tick;
    this.tick = u32(this.tick + this.gameSpeed);
    this.tickDiff = i32(this.tick - this.lastTick);
    this.aiGame.ticks288 = (this.aiGame.ticks288 + this.tickDiff) & 0xffff;

    this.clearSerfRequestFailure();
    this.map.update(this.tick, this.initMapRnd);

    /* Update players */
    for (const player of this.players) {
      player.update();
    }

    /* Scheduler of the original (Amiga update_scheduled @0xa864): next_index
       cycles through the slots once per update. Slots 0..31 run the AI site
       scan early in the game, slot 32 the AI build damping and the
       emergency programs unless the game is paused, slots 33..48 the AI
       players' updates. */
    this.nextIndex = u16(this.nextIndex + 1);
    if (this.nextIndex >= this.maxNextIndex) this.nextIndex = 0;
    if (this.nextIndex < 32) {
      if (this.gameSpeed !== 0 && this.flags.getMaxIndex() < 50) {
        const player = this.getPlayer(this.nextIndex & 3);
        if (player != null && player.isInGame() && player.isAi()) {
          this.ai.scanSites(this, player);
        }
      }
    } else if (this.nextIndex === 32) {
      if (this.gameSpeed !== 0) {
        this.ai.updateBuildDampingAll(this);
        for (const player of this.players) {
          player.updateEmergencyProgram();
        }
      }
    } else {
      /* A slot of a player that is not an AI player, or that loses the
         intelligence roll, passes on to the next slot. */
      while (true) {
        const player = this.getPlayer((this.nextIndex - 33) & 3);
        if (player != null && player.isInGame() && player.isAi() &&
            this.randomInt() < u16(player.getAiIntelligence())) {
          this.ai.update(this, player);
          break;
        }

        this.nextIndex = u16(this.nextIndex + 1);
        if (this.nextIndex >= this.maxNextIndex) {
          this.nextIndex = 0;
          break;
        }
      }
    }

    /* Update knight morale */
    this.knightMoraleCounter -= this.tickDiff;
    if (this.knightMoraleCounter < 0) {
      this.updateKnightMorale();
      this.knightMoraleCounter += 256;
    }

    /* Schedule resources to go out of inventories */
    this.inventoryScheduleCounter -= this.tickDiff;
    if (this.inventoryScheduleCounter < 0) {
      this.updateInventories();
      this.inventoryScheduleCounter += 64;
    }

    this.updateFlags();
    this.updateBuildings();
    this.updateSerfs();
    this.updateGameStats();
  }

  // PORT: not in the C++. Sets the speed directly (DEFAULT_GAME_SPEED is
  // normal speed); while paused it changes the speed the game resumes at.
  setSpeed(speed: number): void {
    if (speed < 1 || speed > 40) return;
    if (this.gameSpeed !== 0) {
      this.gameSpeed = speed;
    } else {
      this.gameSpeedSave = speed;
    }
    Log.Info('game', 'Game speed: ', this.gameSpeed);
  }

  /* Speed the game runs at, also while it is paused. */
  getSpeed(): number {
    return this.gameSpeed !== 0 ? this.gameSpeed : this.gameSpeedSave;
  }

  /* Pause or unpause the game. */
  pause(): void {
    if (this.gameSpeed !== 0) {
      this.gameSpeedSave = this.gameSpeed;
      this.gameSpeed = 0;
    } else {
      this.gameSpeed = this.gameSpeedSave;
    }

    Log.Info('game', 'Game speed: ', this.gameSpeed);
  }

  speedIncrease(): void {
    if (this.gameSpeed < 40) {
      this.gameSpeed += 1;
      Log.Info('game', 'Game speed: ', this.gameSpeed);
    }
  }

  speedDecrease(): void {
    if (this.gameSpeed >= 1) {
      this.gameSpeed -= 1;
      Log.Info('game', 'Game speed: ', this.gameSpeed);
    }
  }

  speedReset(): void {
    this.gameSpeed = DEFAULT_GAME_SPEED;
    Log.Info('game', 'Game speed: ', this.gameSpeed);
  }

  /* Generate an estimate of the amount of resources in the ground at map pos.*/
  protected getResourceEstimate(pos: MapPos, weight: number, estimates: number[]): void {
    const map = this.map;
    if ((map.getObj(pos) === MapObject.ObjectNone ||
         map.getObj(pos) >= MapObject.ObjectTree0) &&
         map.getResType(pos) !== MapMinerals.MineralsNone) {
      const value = weight * map.getResAmount(pos);
      estimates[map.getResType(pos)] += value;
    }
  }

  /* Prepare a ground analysis at position. */
  prepareGroundAnalysis(pos: MapPos, estimates: number[]): void {
    const map = this.map;
    for (let i = 0; i < 5; i++) estimates[i] = 0;

    /* Sample the cursor position with maximum weighting. */
    this.getResourceEstimate(pos, GROUND_ANALYSIS_RADIUS, estimates);

    /* Move outward in a spiral around the initial pos.
       The weighting of the samples attenuates linearly
       with the distance to the center. */
    for (let i = 0; i < GROUND_ANALYSIS_RADIUS - 1; i++) {
      pos = map.moveRight(pos);

      for (const d of cycleDirectionsCw(Direction.DirectionDown)) {
        for (let j = 0; j < i + 1; j++) {
          this.getResourceEstimate(pos, GROUND_ANALYSIS_RADIUS - i, estimates);
          pos = map.move(pos, d);
        }
      }
    }

    /* Process the samples. */
    for (let i = 0; i < 5; i++) {
      estimates[i] >>= 4;
      estimates[i] = Math.min(estimates[i], 999);
    }
  }

  protected roadSegmentInWater(pos: MapPos, dir: Direction): boolean {
    const map = this.map;
    if (dir > Direction.DirectionDown) {
      pos = map.move(pos, dir);
      dir = reverseDirection(dir);
    }

    let water = false;

    switch (dir) {
      case Direction.DirectionRight:
        if (map.typeDown(pos) <= MapTerrain.TerrainWater3 &&
            map.typeUp(map.moveUp(pos)) <= MapTerrain.TerrainWater3) {
          water = true;
        }
        break;
      case Direction.DirectionDownRight:
        if (map.typeUp(pos) <= MapTerrain.TerrainWater3 &&
            map.typeDown(pos) <= MapTerrain.TerrainWater3) {
          water = true;
        }
        break;
      case Direction.DirectionDown:
        if (map.typeUp(pos) <= MapTerrain.TerrainWater3 &&
            map.typeDown(map.moveLeft(pos)) <= MapTerrain.TerrainWater3) {
          water = true;
        }
        break;
      default:
        NOT_REACHED();
        break;
    }

    return water;
  }

  /* Test whether a given road can be constructed by player. The final
     destination will be returned in dest, and water will be set if the
     resulting path is a water path.
     This will return success even if the destination does _not_ contain
     a flag, and therefore partial paths can be validated with this function. */
  canBuildRoad(road: Road, player: Player, dest: Ref<MapPos> | null = null,
               water: Ref<boolean> | null = null): number {
    const map = this.map;
    /* Follow along path to other flag. Test along the way
       whether the path is on ground or in water. */
    let pos = road.getSource();
    let test = 0;

    if (!map.hasOwner(pos) || map.getOwner(pos) !== player.getIndex() ||
        !map.hasFlag(pos)) {
      return 0;
    }

    const dirs: Direction[] = [...road.getDirs()];
    for (let it = 0; it < dirs.length; it++) {
      if (!map.isRoadSegmentValid(pos, dirs[it])) {
        return -1;
      }

      if (map.roadSegmentInWater(pos, dirs[it])) {
        test |= BIT(1);
      } else {
        test |= BIT(0);
      }

      pos = map.move(pos, dirs[it]);

      /* Check that owner is correct, and that only the destination has a flag. */
      if (!map.hasOwner(pos) || map.getOwner(pos) !== player.getIndex() ||
          (map.hasFlag(pos) && it !== dirs.length - 1)) {
        return 0;
      }
    }

    const d = pos;
    if (dest != null) dest.value = d;

    /* Bit 0 indicates a ground path, bit 1 indicates
       water path. Abort if path went through both
       ground and water. */
    let w = false;
    if (BIT_TEST(test, 1)) {
      w = true;
      if (BIT_TEST(test, 0)) return 0;
    }
    if (water != null) water.value = w;

    return 1;
  }

  /* Construct a road spefified by a source and a list of directions. */
  buildRoad(road: Road, player: Player): boolean {
    if (road.getLength() === 0) return false;

    const dest: Ref<MapPos> = { value: 0 };
    const waterPath: Ref<boolean> = { value: false };
    if (!this.canBuildRoad(road, player, dest, waterPath)) {
      return false;
    }
    if (!this.map.hasFlag(dest.value)) return false;

    const dirs: Direction[] = [...road.getDirs()];
    const outDir = dirs[0];
    const inDir = reverseDirection(dirs[dirs.length - 1]);

    /* Actually place road segments */
    if (!this.map.placeRoadSegments(road)) return false;

    /* Connect flags */
    const srcFlag = this.getFlagAtPos(road.getSource())!;
    const destFlag = this.getFlagAtPos(dest.value)!;

    srcFlag.linkWithFlag(destFlag, waterPath.value, road.getLength(),
                         inDir, outDir);

    return true;
  }

  protected flagResetTransport(flag: Flag): void {
    /* Clear destination for any serf with resources for this flag. */
    for (const serf of this.serfs) {
      serf.resetTransport(flag);
    }

    /* Flag. */
    for (const otherFlag of this.flags) {
      flag.resetTransport(otherFlag);
    }

    /* Inventories. */
    for (const inventory of this.inventories) {
      inventory.resetQueueForDest(flag);
    }
  }

  protected buildingRemovePlayerRefs(building: Building): void {
    for (const player of this.players) {
      if (player.tempIndex === building.getIndex()) {
        player.tempIndex = 0;
      }
    }
  }

  protected pathSerfIdleToWaitState(pos: MapPos): boolean {
    /* Look through serf array for the corresponding serf. */
    for (const serf of this.serfs) {
      if (serf.idleToWaitState(pos)) {
        return true;
      }
    }

    return false;
  }

  protected removeRoadForwards(pos: MapPos, dir: Direction): void {
    const map = this.map;
    let inDir: Direction = Direction.DirectionNone;

    while (true) {
      if (map.getIdleSerf(pos)) {
        this.pathSerfIdleToWaitState(pos);
      }

      /* Only serfs moving along the removed road become lost: on the road
         walking or transporting serfs, at the flags only those heading onto
         the removed road (and a delivering serf at the far flag). Other
         serfs, e.g. a lumberjack passing by, are not affected. */
      if (map.hasSerf(pos)) {
        const serf = this.getSerfAtPos(pos)!;
        const walking = (serf.getState() === SerfState.StateWalking ||
                         serf.getState() === SerfState.StateTransporting);
        if (!map.hasFlag(pos)) {
          if (walking) {
            serf.setLostState();
          }
        } else if (walking || (inDir !== Direction.DirectionNone &&
                               serf.getState() === SerfState.StateDelivering)) {
          /* Direction of the removed road at this flag. */
          const roadDir: Direction = (inDir === Direction.DirectionNone) ?
                                     dir : reverseDirection(inDir);
          let d: number = serf.getWalkingDir();
          if (d < 0) d += 6;
          if (d === roadDir) {
            serf.setLostState();
          }
        }
      }

      if (map.hasFlag(pos)) {
        const flag = this.flags.get(map.getObjIndex(pos))!;
        flag.delPath(reverseDirection(inDir));
        break;
      }

      inDir = dir;
      // PORT: `MapPos *pos` is an in/out parameter, passed as a box.
      const posRef: MapPosRef = { pos: pos };
      dir = map.removeRoadSegment(posRef, dir);
      pos = posRef.pos;
    }
  }

  protected demolishRoad_(pos: MapPos): boolean {
    const map = this.map;
    /* TODO necessary?
    game.player[0]->knight_level_reduced = true;
    game.player[1]->knight_level_reduced = true;
    */

    if (!map.removeRoadBackrefs(pos)) {
      /* TODO */
      return false;
    }

    /* Find directions of path segments to be split. */
    let path1Dir: Direction = Direction.DirectionNone;
    for (const d of cycleDirectionsCw()) {
      if (map.hasPath(pos, d)) {
        path1Dir = d;
        break;
      }
    }

    let path2Dir: Direction = Direction.DirectionNone;
    for (let d: number = path1Dir + 1; d <= Direction.DirectionUp; d++) {
      if (map.hasPath(pos, d as Direction)) {
        path2Dir = d as Direction;
        break;
      }
    }

    /* If last segment direction is UP LEFT it could
       be to a building and the real path is at UP. */
    if (path2Dir === Direction.DirectionUpLeft && map.hasPath(pos, Direction.DirectionUp)) {
      path2Dir = Direction.DirectionUp;
    }

    this.removeRoadForwards(pos, path1Dir);
    this.removeRoadForwards(pos, path2Dir);

    return true;
  }

  /* Demolish road at position. */
  demolishRoad(pos: MapPos, player: Player): boolean {
    if (!this.canDemolishRoad(pos, player)) return false;

    return this.demolishRoad_(pos);
  }

  /* Whether a road passes the flag at pos around a corner, so that it can
     be led through the flag (the road merge button of the transport info
     box, as in the original game). */
  flagHasRoadCorner(pos: MapPos): boolean {
    const map = this.map;
    if (!map.hasFlag(pos)) {
      return false;
    }

    for (const d of cycleDirectionsCw()) {
      const next = turnDirection(d, 1);
      if (map.hasPath(pos, d) || map.hasPath(pos, next)) {
        continue;
      }
      if (map.hasPath(map.move(pos, cornerNeighbour[d]), cornerPath[d])) {
        return true;
      }
    }

    return false;
  }

  /* Lead the roads passing the flag at pos around a corner through the
     flag; roads that then start and end at this flag are removed. */
  pullRoadsThroughFlag(pos: MapPos, player: Player): boolean {
    const map = this.map;
    if (!map.hasFlag(pos)) {
      return false;
    }

    let rerouted = false;
    for (const d of cycleDirectionsCw()) {
      const next = turnDirection(d, 1);
      if (map.hasPath(pos, d) || map.hasPath(pos, next)) {
        continue;
      }
      if (map.hasPath(map.move(pos, cornerNeighbour[d]), cornerPath[d])) {
        this.reroutePathCorner(pos, d);
        rerouted = true;
      }
    }

    if (!rerouted) {
      return false;
    }

    const flag = this.flags.get(map.getObjIndex(pos))!;
    for (const d of cycleDirectionsCcw()) {
      if (flag.hasPath(d) && flag.getOtherEndFlag(d) === flag) {
        this.demolishRoad(map.move(pos, d), player);
      }
    }

    return true;
  }

  /* A road passes the flag at pos between its neighbours in direction dir
     and dir + 1. Lead it through the flag and split it there. */
  protected reroutePathCorner(pos: MapPos, dir: Direction): void {
    const map = this.map;
    const dir1 = dir;
    const dir2 = turnDirection(dir, 1);

    map.addPath(pos, dir1);
    map.addPath(pos, dir2);

    /* First neighbour: its segment turns from dir + 2 to dir + 3. */
    const pos1 = map.move(pos, dir1);
    let oldDir = turnDirection(dir1, 2);
    let newDir = turnDirection(oldDir, 1);
    map.delPath(pos1, oldDir);
    map.addPath(pos1, newDir);
    if (map.hasSerf(pos1)) {
      this.getSerfAtPos(pos1)!.pathRerouted(oldDir, newDir);
    }

    /* Second neighbour: its segment turns from dir + 5 to dir + 4. */
    const pos2 = map.move(pos, dir2);
    oldDir = turnDirection(dir2, 4);
    newDir = turnDirection(oldDir, -1);
    map.delPath(pos2, oldDir);
    map.addPath(pos2, newDir);
    if (map.hasSerf(pos2)) {
      this.getSerfAtPos(pos2)!.pathRerouted(oldDir, newDir);
    }

    this.splitPathAtFlag(pos, dir1, dir2);
  }

  /* Build flag on existing path. Path must be split in two segments. */
  protected buildFlagSplitPath(pos: MapPos): void {
    const map = this.map;
    /* Find directions of path segments to be split. */
    let path1Dir: Direction = Direction.DirectionNone;
    // PORT: the C++ shares one iterator between the two loops; `it` is its
    // offset into the cycle. operator++ does not move past the end.
    const cycle: Direction[] = [...cycleDirectionsCw()];
    let it = 0;
    for (; it !== cycle.length; ++it) {
      if (map.hasPath(pos, cycle[it])) {
        path1Dir = cycle[it];
        break;
      }
    }

    let path2Dir: Direction = Direction.DirectionNone;
    if (it < cycle.length) ++it;
    for (; it !== cycle.length; ++it) {
      if (map.hasPath(pos, cycle[it])) {
        path2Dir = cycle[it];
        break;
      }
    }

    /* If last segment direction is UP LEFT it could
       be to a building and the real path is at UP. */
    if (path2Dir === Direction.DirectionUpLeft && map.hasPath(pos, Direction.DirectionUp)) {
      path2Dir = Direction.DirectionUp;
    }

    this.splitPathAtFlag(pos, path1Dir, path2Dir);
  }

  /* Split the path through the flag at pos into the two paths that leave
     the flag in path_1_dir and path_2_dir. */
  protected splitPathAtFlag(pos: MapPos, path1Dir: Direction,
                            path2Dir: Direction): void {
    const path1Data = new SerfPathInfo();
    const path2Data = new SerfPathInfo();

    Flag.fillPathSerfInfo(this, pos, path1Dir, path1Data);
    Flag.fillPathSerfInfo(this, pos, path2Dir, path2Data);

    const flag2 = this.flags.get(path2Data.flagIndex)!;
    const dir2 = path2Data.flagDir;

    const select: Ref<number> = { value: -1 };
    if (flag2.serfRequested(dir2)) {
      for (const serf of this.serfs) {
        if (serf.pathSplited(path1Data.flagIndex, path1Data.flagDir,
                             path2Data.flagIndex, path2Data.flagDir,
                             select)) {
          break;
        }
      }

      let pathData = path1Data;
      if (select.value === 0) pathData = path2Data;

      const selectedFlag = this.flags.get(pathData.flagIndex)!;
      selectedFlag.cancelSerfRequest(pathData.flagDir);
    }

    const flag = this.flags.get(this.map.getObjIndex(pos))!;

    flag.restorePathSerfInfo(path1Dir, path1Data);
    flag.restorePathSerfInfo(path2Dir, path2Data);
  }

  /* Whether a road being built may step from pos in dir onto an existing
     road by placing a flag there, which splits that road (special click of
     the original game): the tile has paths but no flag, and a flag can be
     built on it. */
  canJoinRoad(pos: MapPos, dir: Direction, player: Player): boolean {
    const map = this.map;
    const otherPos = map.move(pos, dir);
    if (map.paths(otherPos) === 0 || map.hasFlag(otherPos)) {
      return false;
    }
    if (!map.isRoadSegmentValid(pos, dir, true)) {
      return false;
    }
    return this.canBuildFlag(otherPos, player);
  }

  /* Check whether player can build flag at pos. */
  canBuildFlag(pos: MapPos, player: Player): boolean {
    const map = this.map;
    /* Check owner of land */
    if (!map.hasOwner(pos) || map.getOwner(pos) !== player.getIndex()) {
      return false;
    }

    /* Check that land is clear */
    if (GameMap.mapSpaceFromObj[map.getObj(pos)] !== MapSpace.SpaceOpen) {
      return false;
    }

    /* Check whether cursor is in water */
    if (map.typeUp(pos) <= MapTerrain.TerrainWater3 &&
        map.typeDown(pos) <= MapTerrain.TerrainWater3 &&
        map.typeDown(map.moveLeft(pos)) <= MapTerrain.TerrainWater3 &&
        map.typeUp(map.moveUpLeft(pos)) <= MapTerrain.TerrainWater3 &&
        map.typeDown(map.moveUpLeft(pos)) <= MapTerrain.TerrainWater3 &&
        map.typeUp(map.moveUp(pos)) <= MapTerrain.TerrainWater3) {
      return false;
    }

    /* Check that no flags are nearby */
    for (const d of cycleDirectionsCw()) {
      if (map.getObj(map.move(pos, d)) === MapObject.ObjectFlag) {
        return false;
      }
    }

    return true;
  }

  /* Build flag at pos. */
  buildFlag(pos: MapPos, player: Player): boolean {
    if (!this.canBuildFlag(pos, player)) {
      return false;
    }

    return this.placeFlag(pos, player);
  }

  /* Build a flag without checking the site. */
  protected placeFlag(pos: MapPos, player: Player): boolean {
    const flag = this.flags.allocate();
    if (flag == null) return false;

    flag.setOwner(player.getIndex());
    flag.setPosition(pos);
    this.map.setObject(pos, MapObject.ObjectFlag, flag.getIndex());

    if (this.map.paths(pos) !== 0) {
      this.buildFlagSplitPath(pos);
    }

    return true;
  }

  /* Check whether military buildings are allowed at pos. */
  canBuildMilitary(pos: MapPos, ignorePos: boolean = false): boolean {
    const map = this.map;
    /* Check that no military buildings are nearby (ignore_pos: other than
       the one at pos, which is replaced). */
    for (let i = ignorePos ? 1 : 0; i < 1 + 6 + 12; i++) {
      const p = map.posAddSpirally(pos, i);
      if (map.getObj(p) >= MapObject.ObjectSmallBuilding &&
          map.getObj(p) <= MapObject.ObjectCastle) {
        const bld = this.buildings.get(map.getObjIndex(p))!;
        if (bld.isMilitary()) {
          return false;
        }
      }
    }

    return true;
  }

  /* Return the height that is needed before a large building can be built.
     Returns negative if the needed height cannot be reached. */
  getLevelingHeight(pos: MapPos): number {
    const map = this.map;
    /* Find min and max height */
    let hMin = 31;
    let hMax = 0;
    for (let i = 0; i < 12; i++) {
      const p = map.posAddSpirally(pos, 7 + i);
      const h = map.getHeight(p);
      if (hMin > h) hMin = h;
      if (hMax < h) hMax = h;
    }

    /* Adjust for height of adjacent unleveled buildings */
    for (let i = 0; i < 18; i++) {
      const p = map.posAddSpirally(pos, 19 + i);
      if (map.getObj(p) === MapObject.ObjectLargeBuilding) {
        const bld = this.buildings.get(map.getObjIndex(p))!;
        if (bld.isLeveling()) { /* Leveling in progress */
          const h = bld.getLevel();
          if (hMin > h) hMin = h;
          if (hMax < h) hMax = h;
        }
      }
    }

    /* Return if height difference is too big */
    if (hMax - hMin >= 9) return -1;

    /* Calculate "mean" height. Height of center is added twice. */
    let hMean = map.getHeight(pos);
    for (let i = 0; i < 7; i++) {
      const p = map.posAddSpirally(pos, i);
      hMean += map.getHeight(p);
    }
    hMean >>= 3;

    /* Calcualte height after leveling */
    const hNewMin = Math.max((hMax > 4) ? (hMax - 4) : 1, 1);
    const hNewMax = hMin + 4;
    const hNew = clamp(hNewMin, hMean, hNewMax);

    return hNew;
  }

  protected mapTypesWithin(pos: MapPos, low: MapTerrain, high: MapTerrain): boolean {
    const map = this.map;
    if ((map.typeUp(pos) >= low &&
         map.typeUp(pos) <= high) &&
        (map.typeDown(pos) >= low &&
         map.typeDown(pos) <= high) &&
        (map.typeDown(map.moveLeft(pos)) >= low &&
         map.typeDown(map.moveLeft(pos)) <= high) &&
        (map.typeUp(map.moveUpLeft(pos)) >= low &&
         map.typeUp(map.moveUpLeft(pos)) <= high) &&
        (map.typeDown(map.moveUpLeft(pos)) >= low &&
         map.typeDown(map.moveUpLeft(pos)) <= high) &&
        (map.typeUp(map.moveUp(pos)) >= low &&
         map.typeUp(map.moveUp(pos)) <= high)) {
      return true;
    }

    return false;
  }

  /* Checks whether a small building is possible at position.*/
  canBuildSmall(pos: MapPos): boolean {
    return this.mapTypesWithin(pos, MapTerrain.TerrainGrass0, MapTerrain.TerrainGrass3);
  }

  /* Checks whether a mine is possible at position. */
  canBuildMine(pos: MapPos): boolean {
    const map = this.map;
    let canBuild = false;

    const types: MapTerrain[] = [
      map.typeDown(pos),
      map.typeUp(pos),
      map.typeDown(map.moveLeft(pos)),
      map.typeUp(map.moveUpLeft(pos)),
      map.typeDown(map.moveUpLeft(pos)),
      map.typeUp(map.moveUp(pos)),
    ];

    for (let i = 0; i < 6; i++) {
      if (types[i] >= MapTerrain.TerrainTundra0 && types[i] <= MapTerrain.TerrainSnow0) {
        canBuild = true;
      } else if (!(types[i] >= MapTerrain.TerrainGrass0 &&
                   types[i] <= MapTerrain.TerrainGrass3)) {
        return false;
      }
    }

    return canBuild;
  }

  /* Checks whether a large building is possible at position. */
  canBuildLarge(pos: MapPos): boolean {
    const map = this.map;
    /* Check that surroundings are passable by serfs. */
    for (let i = 0; i < 6; i++) {
      const p = map.posAddSpirally(pos, 1 + i);
      const s = GameMap.mapSpaceFromObj[map.getObj(p)];
      if (s >= MapSpace.SpaceSemipassable) return false;
    }

    /* Check that buildings in the second shell aren't large or castle. */
    for (let i = 0; i < 12; i++) {
      const p = map.posAddSpirally(pos, 7 + i);
      if (map.getObj(p) >= MapObject.ObjectLargeBuilding &&
          map.getObj(p) <= MapObject.ObjectCastle) {
        return false;
      }
    }

    /* Check if center hexagon is not type grass. */
    if (map.typeUp(pos) !== MapTerrain.TerrainGrass1 ||
        map.typeDown(pos) !== MapTerrain.TerrainGrass1 ||
        map.typeDown(map.moveLeft(pos)) !== MapTerrain.TerrainGrass1 ||
        map.typeUp(map.moveUpLeft(pos)) !== MapTerrain.TerrainGrass1 ||
        map.typeDown(map.moveUpLeft(pos)) !== MapTerrain.TerrainGrass1 ||
        map.typeUp(map.moveUp(pos)) !== MapTerrain.TerrainGrass1) {
      return false;
    }

    /* Check that leveling is possible */
    const r = this.getLevelingHeight(pos);
    if (r < 0) return false;

    return true;
  }

  /* Checks whether a castle can be built by player at position. */
  canBuildCastle(pos: MapPos, player: Player): boolean {
    const map = this.map;
    if (player.hasCastle()) return false;

    /* Check owner of land around position */
    for (let i = 0; i < 7; i++) {
      const p = map.posAddSpirally(pos, i);
      if (map.hasOwner(p)) return false;
    }

    /* Check that land is clear at position */
    if (GameMap.mapSpaceFromObj[map.getObj(pos)] !== MapSpace.SpaceOpen ||
        map.paths(pos) !== 0) {
      return false;
    }

    const flagPos = map.moveDownRight(pos);

    /* Check that land is clear at position */
    if (GameMap.mapSpaceFromObj[map.getObj(flagPos)] !== MapSpace.SpaceOpen ||
        map.paths(flagPos) !== 0) {
      return false;
    }

    if (!this.canBuildLarge(pos)) return false;

    return true;
  }

  /* Check whether player is allowed to build anything
     at position. To determine if the initial castle can
     be built use can_build_castle() instead.

     TODO Existing buildings at position should be
     disregarded so this can be used to determine what
     can be built after the existing building has been
     demolished. */
  canPlayerBuild(pos: MapPos, player: Player): boolean {
    const map = this.map;
    if (!player.hasCastle()) return false;

    /* Check owner of land around position */
    for (let i = 0; i < 7; i++) {
      const p = map.posAddSpirally(pos, i);
      if (!map.hasOwner(p) || map.getOwner(p) !== player.getIndex()) {
        return false;
      }
    }

    /* Check whether cursor is in water */
    if (map.typeUp(pos) <= MapTerrain.TerrainWater3 &&
        map.typeDown(pos) <= MapTerrain.TerrainWater3 &&
        map.typeDown(map.moveLeft(pos)) <= MapTerrain.TerrainWater3 &&
        map.typeUp(map.moveUpLeft(pos)) <= MapTerrain.TerrainWater3 &&
        map.typeDown(map.moveUpLeft(pos)) <= MapTerrain.TerrainWater3 &&
        map.typeUp(map.moveUp(pos)) <= MapTerrain.TerrainWater3) {
      return false;
    }

    /* Check that no paths are blocking. */
    if (map.paths(pos) !== 0) return false;

    return true;
  }

  /* Checks whether a building of the specified type is possible at
     position. */
  canBuildBuilding(pos: MapPos, type: BuildingType,
                   player: Player): boolean {
    const map = this.map;
    if (!this.canPlayerBuild(pos, player)) return false;

    /* Check that space is clear */
    if (GameMap.mapSpaceFromObj[map.getObj(pos)] !== MapSpace.SpaceOpen) {
      return false;
    }

    /* Check that building flag is possible if it
       doesn't already exist. */
    const flagPos = map.moveDownRight(pos);
    if (!map.hasFlag(flagPos) && !this.canBuildFlag(flagPos, player)) {
      return false;
    }

    /* Check if building size is possible. */
    switch (type) {
      case BuildingType.TypeFisher:
      case BuildingType.TypeLumberjack:
      case BuildingType.TypeBoatbuilder:
      case BuildingType.TypeStonecutter:
      case BuildingType.TypeForester:
      case BuildingType.TypeHut:
      case BuildingType.TypeMill:
        if (!this.canBuildSmall(pos)) return false;
        break;
      case BuildingType.TypeStoneMine:
      case BuildingType.TypeCoalMine:
      case BuildingType.TypeIronMine:
      case BuildingType.TypeGoldMine:
        if (!this.canBuildMine(pos)) return false;
        break;
      case BuildingType.TypeStock:
      case BuildingType.TypeFarm:
      case BuildingType.TypeButcher:
      case BuildingType.TypePigFarm:
      case BuildingType.TypeBaker:
      case BuildingType.TypeSawmill:
      case BuildingType.TypeSteelSmelter:
      case BuildingType.TypeToolMaker:
      case BuildingType.TypeWeaponSmith:
      case BuildingType.TypeTower:
      case BuildingType.TypeFortress:
      case BuildingType.TypeGoldSmelter:
        if (!this.canBuildLarge(pos)) return false;
        break;
      default:
        NOT_REACHED();
        break;
    }

    /* Check if military building is possible */
    if ((type === BuildingType.TypeHut ||
         type === BuildingType.TypeTower ||
         type === BuildingType.TypeFortress) &&
        !this.canBuildMilitary(pos)) {
      return false;
    }

    return true;
  }

  /* Build building at position. */
  buildBuilding(pos: MapPos, type: BuildingType, player: Player): boolean {
    if (!this.canBuildBuilding(pos, type, player)) {
      return false;
    }

    if (type === BuildingType.TypeStock) {
      /* TODO Check that more stocks are allowed to be built */
    }

    return this.placeBuilding(pos, type, player) != null;
  }

  /* Build a building and its flag without checking the site, as the
     original's game_build_building, which relies on the map cursor type. */
  protected placeBuilding(pos: MapPos, type: BuildingType, player: Player): Building | null {
    const map = this.map;
    const bld = this.buildings.allocate();
    if (bld == null) {
      return null;
    }

    let flag = this.getFlagAtPos(map.moveDownRight(pos));
    if (flag == null) {
      if (!this.placeFlag(map.moveDownRight(pos), player)) {
        this.buildings.erase(bld.getIndex());
        return null;
      }
      flag = this.getFlagAtPos(map.moveDownRight(pos))!;
    }
    let flgIndex = flag.getIndex();

    bld.setLevel(this.getLevelingHeight(pos));
    bld.setPosition(pos);
    const mapObj = bld.startBuilding(type);
    player.buildingFounded(bld);
    player.designateEmergencyBuilding(bld);

    let splitPath = false;
    if (map.getObj(map.moveDownRight(pos)) !== MapObject.ObjectFlag) {
      flag.setOwner(player.getIndex());
      splitPath = (map.paths(map.moveDownRight(pos)) !== 0);
    } else {
      flgIndex = map.getObjIndex(map.moveDownRight(pos));
      flag = this.flags.get(flgIndex)!;
    }

    flag.setPosition(map.moveDownRight(pos));

    bld.linkFlag(flgIndex);
    flag.linkBuilding(bld);

    flag.clearFlags();

    map.clearIdleSerf(pos);

    map.setObject(pos, mapObj, bld.getIndex());
    map.addPath(pos, Direction.DirectionDownRight);

    if (map.getObj(map.moveDownRight(pos)) !== MapObject.ObjectFlag) {
      map.setObject(map.moveDownRight(pos), MapObject.ObjectFlag, flgIndex);
      map.addPath(map.moveDownRight(pos), Direction.DirectionUpLeft);
    }

    if (splitPath) this.buildFlagSplitPath(map.moveDownRight(pos));

    return bld;
  }

  /* Build castle at position. */
  buildCastle(pos: MapPos, player: Player): boolean {
    const map = this.map;
    if (!this.canBuildCastle(pos, player)) {
      return false;
    }

    const inventory = this.inventories.allocate();
    if (inventory == null) {
      return false;
    }

    const castle = this.buildings.allocate();
    if (castle == null) {
      this.inventories.erase(inventory.getIndex());
      return false;
    }

    const flag = this.flags.allocate();
    if (flag == null) {
      this.buildings.erase(castle.getIndex());
      this.inventories.erase(inventory.getIndex());
      return false;
    }

    castle.setInventory(inventory);

    inventory.setBuildingIndex(castle.getIndex());
    inventory.setFlagIndex(flag.getIndex());
    inventory.setOwner(player.getIndex());
    inventory.applySuppliesPreset(player.getInitialSupplies());

    /* Supplies of the tutorials (Amiga game_build_castle @0x15574). */
    if (this.gameType === GameGameType.GameTypeTutorial) {
      switch (this.tutorialLevel) {
        case 2:
          inventory.setCountOf(ResourceType.TypeLumber, 0);
          break;
        case 3:
          inventory.setCountOf(ResourceType.TypePig, 0);
          inventory.setCountOf(ResourceType.TypeWheat, 0);
          inventory.setCountOf(ResourceType.TypeFlour, 0);
          break;
        case 4:
          inventory.setCountOf(ResourceType.TypeIronOre, 0);
          inventory.setCountOf(ResourceType.TypeCoal, 0);
          inventory.setCountOf(ResourceType.TypeGoldOre, 0);
          break;
        case 5:
          inventory.setCountOf(ResourceType.TypeSteel, 200);
          inventory.setCountOf(ResourceType.TypeCoal, 200);
          break;
        case 6:
          inventory.setCountOf(ResourceType.TypeGoldBar, 30);
          break;
        default:
          break;
      }
    }

    /* Reserve of the emergency program: 7 planks and 2 stones are kept back
       from the castle (Amiga game_build_castle @0x155de). */
    const planks = Math.min(7,
                            inventory.getCountOf(ResourceType.TypePlank));
    const stone = Math.min(2,
                           inventory.getCountOf(ResourceType.TypeStone));
    inventory.setCountOf(ResourceType.TypePlank,
                         inventory.getCountOf(ResourceType.TypePlank) -
                         planks);
    inventory.setCountOf(ResourceType.TypeStone,
                         inventory.getCountOf(ResourceType.TypeStone) -
                         stone);
    player.startEmergencyProgram(planks, stone);

    this.addGoldTotal(i32(
      inventory.getCountOf(ResourceType.TypeGoldBar)));
    this.addGoldTotal(i32(
      inventory.getCountOf(ResourceType.TypeGoldOre)));

    castle.setPosition(pos);
    flag.setPosition(map.moveDownRight(pos));
    castle.setOwner(player.getIndex());
    castle.startBuilding(BuildingType.TypeCastle);

    flag.setOwner(player.getIndex());
    flag.setAcceptsSerfs(true);
    flag.setHasInventory();
    flag.setAcceptsResources(true);
    castle.linkFlag(flag.getIndex());
    flag.linkBuilding(castle);

    map.setObject(pos, MapObject.ObjectCastle, castle.getIndex());
    map.addPath(pos, Direction.DirectionDownRight);

    map.setObject(map.moveDownRight(pos), MapObject.ObjectFlag,
                  flag.getIndex());
    map.addPath(map.moveDownRight(pos), Direction.DirectionUpLeft);

    /* Level land in hexagon below castle */
    const h = this.getLevelingHeight(pos);
    map.setHeight(pos, h);
    for (const d of cycleDirectionsCw()) {
      map.setHeight(map.move(pos, d), h);
    }

    this.updateLandOwnership(pos);

    player.buildingFounded(castle);

    castle.updateMilitaryFlagState();

    return true;
  }

  protected flagRemovePlayerRefs(flag: Flag): void {
    for (const player of this.players) {
      if (player.tempIndex === flag.getIndex()) {
        player.tempIndex = 0;
      }
    }
  }

  /* Check whether road can be demolished. */
  canDemolishRoad(pos: MapPos, player: Player): boolean {
    const map = this.map;
    if (!map.hasOwner(pos) || map.getOwner(pos) !== player.getIndex()) {
      return false;
    }

    if (map.paths(pos) === 0 ||
        map.hasFlag(pos) ||
        map.hasBuilding(pos)) {
      return false;
    }

    return true;
  }

  /* Check whether flag can be demolished. */
  canDemolishFlag(pos: MapPos, player: Player): boolean {
    const map = this.map;
    if (map.getObj(pos) !== MapObject.ObjectFlag) return false;

    const flag = this.flags.get(map.getObjIndex(pos))!;

    if (flag.hasBuilding()) {
      return false;
    }

    if (map.paths(pos) === 0) return true;

    if (flag.getOwner() !== player.getIndex()) return false;

    return flag.canDemolish();
  }

  demolishFlag_(pos: MapPos): boolean {
    const map = this.map;
    /* Handle any serf at pos. */
    if (map.hasSerf(pos)) {
      const serf = this.getSerfAtPos(pos)!;
      serf.flagDeleted(pos);
    }

    const flag = this.flags.get(map.getObjIndex(pos))!;
    if (flag.hasBuilding()) {
      throw new ExceptionFreeserf('Failed to demolish flag with building.');
    }

    this.flagRemovePlayerRefs(flag);

    /* Handle connected flag. */
    flag.mergePaths(pos);

    /* Update serfs with reference to this flag. */
    for (const serf of this.serfs) {
      serf.pathMerged(flag);
    }

    map.setObject(pos, MapObject.ObjectNone, 0);

    /* Remove resources from flag. */
    flag.removeAllResources();

    this.flags.erase(flag.getIndex());

    return true;
  }

  /* Demolish flag at pos. */
  demolishFlag(pos: MapPos, player: Player): boolean {
    if (!this.canDemolishFlag(pos, player)) return false;

    return this.demolishFlag_(pos);
  }

  demolishBuilding_(pos: MapPos): boolean {
    const map = this.map;
    const building = this.buildings.get(map.getObjIndex(pos))!;
    if (building.burnup()) {
      this.buildingRemovePlayerRefs(building);

      /* Remove path to building. */
      map.delPath(pos, Direction.DirectionDownRight);
      map.delPath(map.moveDownRight(pos), Direction.DirectionUpLeft);

      /* Disconnect flag. */
      const flagIndex = building.getFlagIndex();
      if (flagIndex > 0) {
        const flag = this.flags.get(flagIndex)!;
        flag.unlinkBuilding();
        building.unlinkFlag();
        this.flagResetTransport(flag);
      }

      return true;
    }

    return false;
  }

  /* Demolish building at pos. */
  demolishBuilding(pos: MapPos, player: Player): boolean {
    const building = this.buildings.get(this.map.getObjIndex(pos))!;

    if (building.getOwner() !== player.getIndex()) return false;
    if (building.isBurning()) return false;

    return this.demolishBuilding_(pos);
  }

  /* Map pos is lost to the owner, demolish everything. */
  protected surrenderLand(pos: MapPos): void {
    const map = this.map;
    /* Remove building. */
    if (map.getObj(pos) >= MapObject.ObjectSmallBuilding &&
        map.getObj(pos) <= MapObject.ObjectCastle) {
      this.demolishBuilding_(pos);
    }

    if (!map.hasFlag(pos) && map.paths(pos) !== 0) {
      this.demolishRoad_(pos);
    }

    const removeRoads = map.hasFlag(pos);

    /* Remove roads and building around pos. */
    for (const d of cycleDirectionsCw()) {
      const p = map.move(pos, d);

      if (map.getObj(p) >= MapObject.ObjectSmallBuilding &&
          map.getObj(p) <= MapObject.ObjectCastle) {
        this.demolishBuilding_(p);
      }

      if (removeRoads &&
          (map.paths(p) & BIT(reverseDirection(d)))) {
        this.demolishRoad_(p);
      }
    }

    /* Remove flag. */
    if (map.getObj(pos) === MapObject.ObjectFlag) {
      this.demolishFlag_(pos);
    }
  }

  /* Initialize land ownership for whole map. */
  initLandOwnership(): void {
    for (const building of this.buildings) {
      if (building.isMilitary()) {
        this.updateLandOwnership(building.getPosition());
      }
    }
  }

  /* Update land ownership around map position. */
  updateLandOwnership(initPos: MapPos): void {
    const map = this.map;
    /* Currently the below algorithm will only work when
       both influence_radius and calculate_radius are 8. */
    const influenceRadius = 8;
    const influenceDiameter = 1 + 2 * influenceRadius;

    const calculateRadius = influenceRadius;
    const calculateDiameter = 1 + 2 * calculateRadius;

    const tempArrSize = calculateDiameter * calculateDiameter *
                        this.players.size();
    const tempArr = new Int32Array(tempArrSize);

    const militaryInfluence = [
      0, 1, 2, 4, 7, 12, 18, 29, -1, -1,  /* hut */
      0, 3, 5, 8, 11, 15, 22, 30, -1, -1,  /* tower */
      0, 6, 10, 14, 19, 23, 27, 31, -1, -1,  /* fortress */
    ];

    const mapCloseness = [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
      1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 0, 0, 0, 0, 0, 0, 0,
      1, 2, 3, 3, 3, 3, 3, 3, 3, 2, 1, 0, 0, 0, 0, 0, 0,
      1, 2, 3, 4, 4, 4, 4, 4, 4, 3, 2, 1, 0, 0, 0, 0, 0,
      1, 2, 3, 4, 5, 5, 5, 5, 5, 4, 3, 2, 1, 0, 0, 0, 0,
      1, 2, 3, 4, 5, 6, 6, 6, 6, 5, 4, 3, 2, 1, 0, 0, 0,
      1, 2, 3, 4, 5, 6, 7, 7, 7, 6, 5, 4, 3, 2, 1, 0, 0,
      1, 2, 3, 4, 5, 6, 7, 8, 8, 7, 6, 5, 4, 3, 2, 1, 0,
      1, 2, 3, 4, 5, 6, 7, 8, 9, 8, 7, 6, 5, 4, 3, 2, 1,
      0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 7, 6, 5, 4, 3, 2, 1,
      0, 0, 1, 2, 3, 4, 5, 6, 7, 7, 7, 6, 5, 4, 3, 2, 1,
      0, 0, 0, 1, 2, 3, 4, 5, 6, 6, 6, 6, 5, 4, 3, 2, 1,
      0, 0, 0, 0, 1, 2, 3, 4, 5, 5, 5, 5, 5, 4, 3, 2, 1,
      0, 0, 0, 0, 0, 1, 2, 3, 4, 4, 4, 4, 4, 4, 3, 2, 1,
      0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 3, 3, 2, 1,
      0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1,
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    ];

    /* Find influence from buildings in 33*33 square
       around the center. */
    for (let i = -(influenceRadius + calculateRadius);
         i <= influenceRadius + calculateRadius; i++) {
      for (let j = -(influenceRadius + calculateRadius);
           j <= influenceRadius + calculateRadius; j++) {
        const pos = map.posAdd(initPos, j, i);

        if (map.getObj(pos) >= MapObject.ObjectSmallBuilding &&
            map.getObj(pos) <= MapObject.ObjectCastle &&
            map.hasPath(pos,
                        Direction.DirectionDownRight)) {  // TODO(_): Why wouldn't this be set?
          const building = this.getBuildingAtPos(pos)!;
          let milType = -1;

          if (building.getType() === BuildingType.TypeCastle) {
            /* Castle has military influence even when not done. */
            milType = 2;
          } else if (building.isDone() && building.isActive()) {
            switch (building.getType()) {
              case BuildingType.TypeHut: milType = 0; break;
              case BuildingType.TypeTower: milType = 1; break;
              case BuildingType.TypeFortress: milType = 2; break;
              default: break;
            }
          }

          if (milType >= 0 && !building.isBurning()) {
            // PORT: the pointers influence, closeness and arr become
            // offsets into militaryInfluence, mapCloseness and tempArr.
            const influence = 10 * milType;
            let closeness = influenceDiameter * Math.max(-i, 0) +
                            Math.max(-j, 0);
            let arr =
              (building.getOwner() * calculateDiameter * calculateDiameter) +
              calculateDiameter * Math.max(i, 0) + Math.max(j, 0);

            for (let k = 0; k < influenceDiameter - Math.abs(i); k++) {
              for (let l = 0; l < influenceDiameter - Math.abs(j); l++) {
                const inf = militaryInfluence[influence + mapCloseness[closeness]];
                if (inf < 0) {
                  tempArr[arr] = 128;
                } else if (tempArr[arr] < 128) {
                  tempArr[arr] = Math.min(tempArr[arr] + inf, 127);
                }

                closeness += 1;
                arr += 1;
              }
              closeness += Math.abs(j);
              arr += Math.abs(j);
            }
          }
        }
      }
    }

    /* Update owner of 17*17 square. */
    for (let i = -calculateRadius; i <= calculateRadius; i++) {
      for (let j = -calculateRadius; j <= calculateRadius; j++) {
        let maxVal = 0;
        let playerIndex = -1;
        for (const player of this.players) {
          const arr =
            player.getIndex() * calculateDiameter * calculateDiameter +
            calculateDiameter * (i + calculateRadius) + (j + calculateRadius);
          if (tempArr[arr] > maxVal) {
            maxVal = tempArr[arr];
            playerIndex = player.getIndex();
          }
        }

        const pos = map.posAdd(initPos, j, i);
        let oldPlayer = -1;
        if (map.hasOwner(pos)) oldPlayer = map.getOwner(pos);

        if (oldPlayer >= 0 && playerIndex !== oldPlayer) {
          this.players.get(oldPlayer)!.decreaseLandArea();
          this.surrenderLand(pos);
        }

        if (playerIndex >= 0) {
          if (playerIndex !== oldPlayer) {
            this.players.get(playerIndex)!.increaseLandArea();
            map.setOwner(pos, playerIndex);
          }
        } else {
          map.delOwner(pos);
        }
      }
    }

    /* Update military building flag state. */
    for (let i = -25; i <= 25; i++) {
      for (let j = -25; j <= 25; j++) {
        const pos = map.posAdd(initPos, i, j);

        if (map.getObj(pos) >= MapObject.ObjectSmallBuilding &&
            map.getObj(pos) <= MapObject.ObjectCastle &&
            map.hasPath(pos, Direction.DirectionDownRight)) {
          const building = this.buildings.get(map.getObjIndex(pos))!;
          if (building.isDone() && building.isMilitary()) {
            building.updateMilitaryFlagState();
          }
        }
      }
    }
  }

  protected demolishFlagAndRoads(pos: MapPos): void {
    const map = this.map;
    if (map.hasFlag(pos)) {
      /* Remove roads around pos. */
      for (const d of cycleDirectionsCw()) {
        const p = map.move(pos, d);

        if (map.paths(p) & BIT(reverseDirection(d))) {
          this.demolishRoad_(p);
        }
      }

      if (map.getObj(pos) === MapObject.ObjectFlag) {
        this.demolishFlag_(pos);
      }
    } else if (map.paths(pos) !== 0) {
      this.demolishRoad_(pos);
    }
  }

  /* The given building has been defeated and is being
     occupied by player. */
  occupyEnemyBuilding(building: Building, playerNum: number): void {
    const map = this.map;
    /* Take the building. */
    const player = this.players.get(playerNum)!;

    player.buildingCaptured(building);

    if (building.getType() === BuildingType.TypeCastle) {
      this.demolishBuilding_(building.getPosition());
    } else {
      const flag = this.flags.get(building.getFlagIndex())!;
      this.flagResetTransport(flag);

      /* Demolish nearby buildings. */
      for (let i = 0; i < 12; i++) {
        const pos = map.posAddSpirally(building.getPosition(), 7 + i);
        if (map.getObj(pos) >= MapObject.ObjectSmallBuilding &&
            map.getObj(pos) <= MapObject.ObjectCastle) {
          this.demolishBuilding_(pos);
        }
      }

      /* Change owner of land and remove roads and flags
         except the flag associated with the building. */
      map.setOwner(building.getPosition(), playerNum);

      for (const d of cycleDirectionsCw()) {
        const pos = map.move(building.getPosition(), d);
        map.setOwner(pos, playerNum);
        if (pos !== flag.getPosition()) {
          this.demolishFlagAndRoads(pos);
        }
      }

      /* Change owner of flag. */
      flag.setOwner(playerNum);

      /* Reset destination of stolen resources. */
      flag.resetDestinationOfStolenResources();

      /* Remove paths from flag. */
      for (const d of cycleDirectionsCw()) {
        if (flag.hasPath(d)) {
          this.demolishRoad_(map.move(flag.getPosition(), d));
        }
      }

      this.updateLandOwnership(building.getPosition());

      this.ai.buildingConquered(this, player, flag.getPosition());
    }
  }

  /* mode: 0: IN, 1: STOP, 2: OUT */
  setInventoryResourceMode(inventory: Inventory, mode: number): void {
    const flag = this.flags.get(inventory.getFlagIndex())!;

    if (mode === 0) {
      inventory.setResMode(InventoryMode.ModeIn);
    } else if (mode === 1) {
      inventory.setResMode(InventoryMode.ModeStop);
    } else {
      inventory.setResMode(InventoryMode.ModeOut);
    }

    if (mode > 0) {
      flag.setAcceptsResources(false);

      /* Clear destination of serfs with resources destined
         for this inventory. */
      const dest = flag.getIndex();
      for (const serf of this.serfs) {
        serf.clearDestination2(dest);
      }
    } else {
      flag.setAcceptsResources(true);
    }
  }

  /* mode: 0: IN, 1: STOP, 2: OUT */
  setInventorySerfMode(inventory: Inventory, mode: number): void {
    const flag = this.flags.get(inventory.getFlagIndex())!;

    if (mode === 0) {
      inventory.setSerfMode(InventoryMode.ModeIn);
    } else if (mode === 1) {
      inventory.setSerfMode(InventoryMode.ModeStop);
    } else {
      inventory.setSerfMode(InventoryMode.ModeOut);
    }

    if (mode > 0) {
      flag.setAcceptsSerfs(false);

      /* Clear destination of serfs destined for this inventory. */
      const dest = flag.getIndex();
      for (const serf of this.serfs) {
        serf.clearDestination(dest);
      }
    } else {
      flag.setAcceptsSerfs(true);
    }
  }

  // Add new player to the game. Returns the player number.
  addPlayer(intelligence: number, supplies: number,
            reproduction: number): number {
    /* Allocate object */
    const player = this.players.allocate();
    if (player == null) {
      throw new ExceptionFreeserf('Failed to create new player.');
    }

    player.init(intelligence, supplies, reproduction);

    /* Update map values dependent on player count */
    this.mapGoldMoraleFactor = 10 * 1024 * i32(this.players.size());

    return player.getIndex();
  }

  /* Tutorial 6: a passive enemy, player 1, with a finished hut, fortress,
     tower and hut manned by level 0 knights (Amiga game_init_start_castles
     @0x49ca). The original's enemy is not an added player, so the gold
     morale factor stays the one of a single player. */
  initTutorialEnemy(color: PlayerColor): void {
    const human = this.getPlayer(0)!;
    for (let i = 0; i < 4; i++) {
      human.setKnightOccupation(i, 0x40);
    }

    const goldMoraleFactor = this.mapGoldMoraleFactor;
    const enemy = this.getPlayer(this.addPlayer(0, 0, 0))!;
    this.mapGoldMoraleFactor = goldMoraleFactor;
    enemy.initPassive(color);

    const sites: { col: number; row: number; type: BuildingType }[] = [
      { col: 20, row: 26, type: BuildingType.TypeHut },
      { col: 21, row: 33, type: BuildingType.TypeFortress },
      { col: 25, row: 34, type: BuildingType.TypeTower },
      { col: 30, row: 38, type: BuildingType.TypeHut },
    ];
    for (const site of sites) {
      this.buildOccupiedMilitary(this.map.pos(site.col, site.row), site.type, enemy);
    }
  }

  /* A finished military building with its knights (Amiga
     tutorial_build_military_building @0x4b58). */
  protected buildOccupiedMilitary(pos: MapPos, type: BuildingType,
                                  player: Player): void {
    const building = this.placeBuilding(pos, type, player);
    if (building == null) {
      return;
    }

    while (!building.buildProgress()) {}
    building.setOccupied();

    let knights = 12;
    if (type === BuildingType.TypeHut) {
      knights = 3;
    } else if (type === BuildingType.TypeTower) {
      knights = 6;
    }
    for (let i = 0; i < knights; i++) {
      const knight = this.createSerf();
      if (knight == null) {
        break;
      }
      knight.initDefendingKnight(building);
      building.placeKnight(knight.getIndex());
    }

    this.updateLandOwnership(pos);
  }

  init(mapSize: number, random: Random): boolean {
    this.initMapRnd = random.clone();

    this.map = new GameMap(new MapGeometry(mapSize));
    const generator = new ClassicMissionMapGenerator(this.map, this.initMapRnd);
    generator.init();
    generator.generate();
    this.map.initTiles(generator);
    this.goldTotal = this.map.getGoldDeposit();

    /* Slots of the scheduler (Amiga game_init); 49 once an AI player is
       added. */
    this.maxNextIndex = 33;

    return true;
  }

  /* Cancel a resource being transported to destination. This
     ensures that the destination can request a new resource. */
  cancelTransportedResource(res: ResourceType, dest: number): void {
    if (dest === 0) {
      return;
    }

    /* The destination building may be gone already (demolished while the
       resource was on its way); then nothing is requested any more. */
    const flag = this.flags.get(dest)!;
    if (!flag.hasBuilding()) {
      return;
    }
    const building = flag.getBuilding()!;
    building.cancelTransportedResource(res);
  }

  /* Called when a resource is lost forever from the game. This will
     update any global state keeping track of that resource. */
  loseResource(res: ResourceType): void {
    if (res === ResourceType.TypeGoldOre || res === ResourceType.TypeGoldBar) {
      this.addGoldTotal(-1);
    }
  }

  randomInt(): number {
    return this.rnd.random();
  }

  // PORT: not in the C++, where the random numbers of a game start from the
  // clock. In an online game both sides set the same seed right after
  // making the game, so that both simulations draw the same numbers.
  setRandom(seed: Random): void {
    this.rnd = new Random(seed);
  }

  nextSearchId(): number {
    this.flagSearchCounter = u16(this.flagSearchCounter + 1);

    /* If we're back at zero the counter has overflown,
     everything needs a reset to be safe. */
    if (this.flagSearchCounter === 0) {
      this.flagSearchCounter = u16(this.flagSearchCounter + 1);
      this.clearSearchId();
    }

    return this.flagSearchCounter;
  }

  createSerf(index: number = -1): Serf {
    if (index === -1) {
      return this.serfs.allocate();
    } else {
      return this.serfs.getOrInsert(index);
    }
  }

  deleteSerf(serf: Serf): void {
    this.serfs.erase(serf.getIndex());
  }

  createFlag(index: number = -1): Flag {
    if (index === -1) {
      return this.flags.allocate();
    } else {
      return this.flags.getOrInsert(index);
    }
  }

  createInventory(index: number = -1): Inventory {
    if (index === -1) {
      return this.inventories.allocate();
    } else {
      return this.inventories.getOrInsert(index);
    }
  }

  deleteInventory(inventory: Inventory): void {
    this.inventories.erase(inventory.getIndex());
  }

  createBuilding(index: number = -1): Building {
    if (index === -1) {
      return this.buildings.allocate();
    } else {
      return this.buildings.getOrInsert(index);
    }
  }

  deleteBuilding(building: Building): void {
    for (const player of this.players) {
      player.buildingDeleted(building.getIndex());
    }
    this.map.setObject(building.getPosition(), MapObject.ObjectNone, 0);
    this.buildings.erase(building.getIndex());
  }

  /* A burned down building is removed; a building queued by replacing it
     is built on the site, if the site still allows it (as in the original
     game). */
  buildingBurnedDown(building: Building): void {
    const pos = building.getPosition();
    const type = building.getQueuedType();
    const player = this.getPlayer(building.getOwner());

    this.deleteBuilding(building);

    if ((type !== BuildingType.TypeNone) && (player != null)) {
      this.buildBuilding(pos, type, player);
    }
  }

  /* Size class of the site of the player's own building at pos, as the
     build buttons offer it for replacing the building: 0 mine, 1 small,
     2 large, -1 none. The building on the site and its path to the flag
     are not in the way. */
  getReplaceSiteClass(pos: MapPos, player: Player): number {
    const map = this.map;
    if (!player.hasCastle()) return -1;
    if (map.getObj(pos) !== MapObject.ObjectSmallBuilding &&
        map.getObj(pos) !== MapObject.ObjectLargeBuilding) {
      return -1;
    }

    const building = this.buildings.get(map.getObjIndex(pos));
    if ((building == null) || building.isBurning() ||
        building.getOwner() !== player.getIndex() ||
        building.getType() === BuildingType.TypeCastle) {
      return -1;
    }

    /* Own land around the site. */
    for (let i = 0; i < 7; i++) {
      const p = map.posAddSpirally(pos, i);
      if (!map.hasOwner(p) || map.getOwner(p) !== player.getIndex()) {
        return -1;
      }
    }

    if (this.canBuildMine(pos)) return 0;
    if (this.canBuildLarge(pos)) return 2;
    if (this.canBuildSmall(pos)) return 1;
    return -1;
  }

  /* Replace the player's own building at pos (special click on a build
     button, as in the original game): it is demolished, and the new type
     is built on the site once it has burned down. A mine needs a mine
     site, other buildings a site of at least their size. */
  replaceBuilding(pos: MapPos, type: BuildingType, player: Player): boolean {
    const site = this.getReplaceSiteClass(pos, player);
    if (site < 0) return false;

    let need = 1;
    switch (type) {
      case BuildingType.TypeStoneMine:
      case BuildingType.TypeCoalMine:
      case BuildingType.TypeIronMine:
      case BuildingType.TypeGoldMine:
        need = 0;
        break;
      case BuildingType.TypeFisher:
      case BuildingType.TypeLumberjack:
      case BuildingType.TypeBoatbuilder:
      case BuildingType.TypeStonecutter:
      case BuildingType.TypeForester:
      case BuildingType.TypeHut:
      case BuildingType.TypeMill:
        need = 1;
        break;
      default:
        need = 2;
        break;
    }
    if ((need === 0) ? (site !== 0) : (site === 0 || site < need)) {
      return false;
    }

    if ((type === BuildingType.TypeHut || type === BuildingType.TypeTower ||
         type === BuildingType.TypeFortress) && !this.canBuildMilitary(pos, true)) {
      return false;
    }

    const building = this.buildings.get(this.map.getObjIndex(pos))!;
    if (!this.demolishBuilding(pos, player)) {
      return false;
    }

    building.setQueuedType(type);
    return true;
  }

  getPlayerSerfs(player: Player): ListSerfs {
    const playerSerfs: ListSerfs = [];

    for (const serf of this.serfs) {
      if (serf.getOwner() === player.getIndex()) {
        playerSerfs.push(serf);
      }
    }

    return playerSerfs;
  }

  getPlayerBuildings(player: Player): ListBuildings {
    const playerBuildings: ListBuildings = [];

    for (const building of this.buildings) {
      if (building.getOwner() === player.getIndex()) {
        playerBuildings.push(building);
      }
    }

    return playerBuildings;
  }

  getPlayerInventories(player: Player): ListInventories {
    const playerInventories: ListInventories = [];

    for (const inventory of this.inventories) {
      if (inventory.getOwner() === player.getIndex()) {
        playerInventories.push(inventory);
      }
    }

    return playerInventories;
  }

  getSerfsAtPos(pos: MapPos): ListSerfs {
    const result: ListSerfs = [];

    for (const serf of this.serfs) {
      if (serf.getPos() === pos) {
        result.push(serf);
      }
    }

    return result;
  }

  getSerfsInInventory(inventory: Inventory): ListSerfs {
    const result: ListSerfs = [];

    for (const serf of this.serfs) {
      if (serf.getState() === SerfState.StateIdleInStock &&
          inventory.getIndex() === serf.getIdleInStockInvIndex()) {
        result.push(serf);
      }
    }

    return result;
  }

  getSerfsRelatedTo(dest: number, dir: Direction): ListSerfs {
    const result: ListSerfs = [];

    for (const serf of this.serfs) {
      if (serf.isRelatedTo(dest, dir)) {
        result.push(serf);
      }
    }

    return result;
  }

  getNextPlayer(player: Player): Player {
    // PORT: iterator arithmetic on the collection becomes an index into a
    // snapshot of its objects. The C++ runs off the end if player is not
    // in the collection; here that throws.
    const all = [...this.players];
    let p = 0;
    while (all[p] !== player) {
      ++p;
      if (p >= all.length) {
        throw new ExceptionFreeserf('Player is not in the game.');
      }
    }
    ++p;
    if (p === all.length) {
      p = 0;
    }

    return all[p];
  }

  buildingCaptured(building: Building): void {
    /* Save amount of land and buildings for each player */
    const landBefore = new Map<number, number>();
    const buildingsBefore = new Map<number, number>();
    for (const player of this.players) {
      landBefore.set(player.getIndex(), player.getLandArea());
      buildingsBefore.set(player.getIndex(), player.getBuildingScore());
    }

    /* Update land ownership */
    this.updateLandOwnership(building.getPosition());

    /* Create notfications for lost land and buildings */
    for (const player of this.players) {
      if ((buildingsBefore.get(player.getIndex()) ?? 0) > player.getBuildingScore()) {
        player.addNotification(MessageType.TypeLostBuildings,
                               building.getPosition(),
                               building.getOwner());
      } else if ((landBefore.get(player.getIndex()) ?? 0) > player.getLandArea()) {
        player.addNotification(MessageType.TypeLostLand,
                               building.getPosition(),
                               building.getOwner());
      }
    }
  }

  clearSearchId(): void {
    for (const flag of this.flags) {
      flag.clearSearchId();
    }
  }

  // TODO(savegame): operator>> (SaveReaderBinary, SaveReaderText),
  // operator<< (SaveWriterText), load_serfs, load_flags, load_buildings and
  // load_inventories.

  addGoldTotal(delta: number): void {
    if (delta < 0) {
      if (i32(this.goldTotal) < -delta) {
        throw new ExceptionFreeserf('Failed to decrease global gold counter.');
      }
    }
    this.goldTotal = u32(this.goldTotal + delta);
  }

  getBuildingAtPos(pos: MapPos): Building | null {
    const mapObj = this.map.getObj(pos);
    if (mapObj >= MapObject.ObjectSmallBuilding && mapObj <= MapObject.ObjectCastle) {
      return this.buildings.get(this.map.getObjIndex(pos));
    }
    return null;
  }

  getFlagAtPos(pos: MapPos): Flag | null {
    if (this.map.getObj(pos) !== MapObject.ObjectFlag) {
      return null;
    }

    return this.flags.get(this.map.getObjIndex(pos));
  }

  getSerfAtPos(pos: MapPos): Serf | null {
    return this.serfs.get(this.map.getSerfIndex(pos));
  }
}

export type PGame = Game;
