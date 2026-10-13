/*
 * building.ts - Building related functions.
 *
 * Port of Freeserf's building.h and building.cc.
 *
 * Copyright (C) 2012-2013  Jon Lund Steffensen <jonlst@gmail.com>
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

import { BIT, BIT_TEST, ExceptionFreeserf, NOT_REACHED, i32, u16, u32 } from './misc';
import { GameObject } from './objects';
import { ResourceType } from './resource';
import { MapObject } from './map';
import type { MapPos } from './map-geometry';
import { SerfType } from './serf';
import type { Serf } from './serf';
import { MessageType } from './player';
import type { Game } from './game';
import type { Inventory } from './inventory';
import type { SaveReaderText, SaveWriterText } from './savegame';

export enum BuildingType {
  TypeNone = 0,
  TypeFisher,
  TypeLumberjack,
  TypeBoatbuilder,
  TypeStonecutter,
  TypeStoneMine,
  TypeCoalMine,
  TypeIronMine,
  TypeGoldMine,
  TypeForester,
  TypeStock,
  TypeHut,
  TypeFarm,
  TypeButcher,
  TypePigFarm,
  TypeMill,
  TypeBaker,
  TypeSawmill,
  TypeSteelSmelter,
  TypeToolMaker,
  TypeWeaponSmith,
  TypeTower,
  TypeFortress,
  TypeGoldSmelter,
  TypeCastle,
}

export interface BuildingStock {
  type: ResourceType;
  prio: number;
  available: number;
  requested: number;
  maximum: number;
}

// UNION ALIAS: union u { unsigned int tick; unsigned int level; }. Both
// members are the same unsigned int, so tick and level read and write one
// value.
export class BuildingU {
  private value = 0;

  /* Used for burning building. */
  get tick(): number {
    return this.value;
  }
  set tick(v: number) {
    this.value = u32(v);
  }
  get level(): number {
    return this.value;
  }
  set level(v: number) {
    this.value = u32(v);
  }
}

export interface ConstructionInfo {
  mapObj: MapObject;
  planks: number;
  stones: number;
  phase1: number;
  phase2: number;
}

// PORT: `const_info[]` is a file-level table in the C++. It holds
// Map::Object values from another module, so it is built on first use
// instead of at module load (imports between game modules are circular).
let constInfoTable: ConstructionInfo[] | null = null;

export function constInfo(): ConstructionInfo[] {
  if (constInfoTable == null) {
    const row = (
      mapObj: MapObject,
      planks: number,
      stones: number,
      phase1: number,
      phase2: number,
    ): ConstructionInfo => ({ mapObj, planks, stones, phase1, phase2 });
    constInfoTable = [
      row(MapObject.ObjectNone, 0, 0, 0, 0), // BUILDING_NONE
      row(MapObject.ObjectSmallBuilding, 2, 0, 4096, 4096), // BUILDING_FISHER
      row(MapObject.ObjectSmallBuilding, 2, 0, 4096, 4096), // BUILDING_LUMBERJACK
      row(MapObject.ObjectSmallBuilding, 3, 0, 4096, 2048), // BUILDING_BOATBUILDER
      row(MapObject.ObjectSmallBuilding, 2, 0, 4096, 4096), // BUILDING_STONECUTTER
      row(MapObject.ObjectSmallBuilding, 4, 1, 2048, 1366), // BUILDING_STONEMINE
      row(MapObject.ObjectSmallBuilding, 5, 0, 2048, 1366), // BUILDING_COALMINE
      row(MapObject.ObjectSmallBuilding, 5, 0, 2048, 1366), // BUILDING_IRONMINE
      row(MapObject.ObjectSmallBuilding, 5, 0, 2048, 1366), // BUILDING_GOLDMINE
      row(MapObject.ObjectSmallBuilding, 2, 0, 4096, 4096), // BUILDING_FORESTER
      row(MapObject.ObjectLargeBuilding, 4, 3, 1366, 1024), // BUILDING_STOCK
      row(MapObject.ObjectSmallBuilding, 1, 1, 4096, 4096), // BUILDING_HUT
      row(MapObject.ObjectLargeBuilding, 4, 1, 2048, 1366), // BUILDING_FARM
      row(MapObject.ObjectLargeBuilding, 2, 1, 4096, 2048), // BUILDING_BUTCHER
      row(MapObject.ObjectLargeBuilding, 4, 1, 2048, 1366), // BUILDING_PIGFARM
      row(MapObject.ObjectSmallBuilding, 3, 1, 2048, 2048), // BUILDING_MILL
      row(MapObject.ObjectLargeBuilding, 2, 1, 4096, 2048), // BUILDING_BAKER
      row(MapObject.ObjectLargeBuilding, 3, 2, 2048, 1366), // BUILDING_SAWMILL
      row(MapObject.ObjectLargeBuilding, 3, 2, 2048, 1366), // BUILDING_STEELSMELTER
      row(MapObject.ObjectLargeBuilding, 3, 3, 2048, 1024), // BUILDING_TOOLMAKER
      row(MapObject.ObjectLargeBuilding, 2, 1, 4096, 2048), // BUILDING_WEAPONSMITH
      row(MapObject.ObjectLargeBuilding, 2, 3, 2048, 1366), // BUILDING_TOWER
      row(MapObject.ObjectLargeBuilding, 5, 5, 1024, 683), // BUILDING_FORTRESS
      row(MapObject.ObjectLargeBuilding, 4, 1, 2048, 1366), // BUILDING_GOLDSMELTER
      row(MapObject.ObjectCastle, 0, 0, 256, 256), // BUILDING_CASTLE
    ];
  }
  return constInfoTable;
}

// ---------------------------------------------------------------------------
// EXT: production controls and the upgrade of military buildings. Not part
// of Freeserf. Everything below up to the Building class is new.

// EXT: the steps of the output cap of a building: 0 is off.
export const productionCapSteps: number[] = [0, 10, 20, 50, 100, 200];

// EXT: the buildings whose worker makes or converts something: these can be
// paused. Not the military buildings, the castle or the storehouse.
export function isProductionBuilding(type: BuildingType): boolean {
  switch (type) {
    case BuildingType.TypeFisher:
    case BuildingType.TypeLumberjack:
    case BuildingType.TypeBoatbuilder:
    case BuildingType.TypeStonecutter:
    case BuildingType.TypeStoneMine:
    case BuildingType.TypeCoalMine:
    case BuildingType.TypeIronMine:
    case BuildingType.TypeGoldMine:
    case BuildingType.TypeForester:
    case BuildingType.TypeFarm:
    case BuildingType.TypeButcher:
    case BuildingType.TypePigFarm:
    case BuildingType.TypeMill:
    case BuildingType.TypeBaker:
    case BuildingType.TypeSawmill:
    case BuildingType.TypeSteelSmelter:
    case BuildingType.TypeToolMaker:
    case BuildingType.TypeWeaponSmith:
    case BuildingType.TypeGoldSmelter:
      return true;
    default:
      return false;
  }
}

// EXT: the one resource a production building hands out, which its output
// cap counts; TypeNone for the forester (no resource) and for the toolmaker
// and the weaponsmith (several outputs): these have no cap.
export function productionOutput(type: BuildingType): ResourceType {
  switch (type) {
    case BuildingType.TypeFisher: return ResourceType.TypeFish;
    case BuildingType.TypeLumberjack: return ResourceType.TypeLumber;
    case BuildingType.TypeBoatbuilder: return ResourceType.TypeBoat;
    case BuildingType.TypeStonecutter: return ResourceType.TypeStone;
    case BuildingType.TypeStoneMine: return ResourceType.TypeStone;
    case BuildingType.TypeCoalMine: return ResourceType.TypeCoal;
    case BuildingType.TypeIronMine: return ResourceType.TypeIronOre;
    case BuildingType.TypeGoldMine: return ResourceType.TypeGoldOre;
    case BuildingType.TypeFarm: return ResourceType.TypeWheat;
    case BuildingType.TypeButcher: return ResourceType.TypeMeat;
    case BuildingType.TypePigFarm: return ResourceType.TypePig;
    case BuildingType.TypeMill: return ResourceType.TypeFlour;
    case BuildingType.TypeBaker: return ResourceType.TypeBread;
    case BuildingType.TypeSawmill: return ResourceType.TypePlank;
    case BuildingType.TypeSteelSmelter: return ResourceType.TypeSteel;
    case BuildingType.TypeGoldSmelter: return ResourceType.TypeGoldBar;
    default: return ResourceType.TypeNone;
  }
}

// EXT: why production stands still (Building::getProductionHold).
export enum ProductionHold {
  None = 0,
  Paused,
  Capped,
}

// EXT: what a military building is upgraded to: guard hut to tower, tower
// to fortress. TypeNone for every other type.
export function upgradeTarget(type: BuildingType): BuildingType {
  switch (type) {
    case BuildingType.TypeHut: return BuildingType.TypeTower;
    case BuildingType.TypeTower: return BuildingType.TypeFortress;
    default: return BuildingType.TypeNone;
  }
}

// EXT: planks and stones of the upgrade of a building of this type: the
// difference of the construction costs of the two types, at least 1 each
// (hut to tower 1 and 2, tower to fortress 3 and 2).
export function upgradeCost(type: BuildingType): { planks: number; stones: number } {
  const target = upgradeTarget(type);
  if (target === BuildingType.TypeNone) return { planks: 0, stones: 0 };
  const from = constInfo()[type];
  const to = constInfo()[target];
  return {
    planks: Math.max(1, to.planks - from.planks),
    stones: Math.max(1, to.stones - from.stones),
  };
}

// EXT: game ticks of work per plank or stone of an upgrade, counted once
// the last of them has arrived (hut to tower 3072 ticks, tower to fortress
// 5120; a game update at normal speed is 2 ticks).
export const kUpgradeWorkTicksPerUnit = 1024;

export function upgradeWorkTicks(type: BuildingType): number {
  const cost = upgradeCost(type);
  return kUpgradeWorkTicksPerUnit * (cost.planks + cost.stones);
}

// EXT: gold bars a military building holds (the maxGold of
// Building::set_first_knight and Building::update_military).
export function militaryMaxGold(type: BuildingType): number {
  switch (type) {
    case BuildingType.TypeHut: return 2;
    case BuildingType.TypeTower: return 4;
    case BuildingType.TypeFortress: return 8;
    default: return 0;
  }
}

// EXT: why Game::getUpgradeRefusal() says no.
export enum UpgradeRefusal {
  None = 0,
  /* No building of the player at the position. */
  NotOwn,
  /* Not a guard hut or a tower. */
  WrongType,
  NotFinished,
  Burning,
  /* No knight has moved in yet. */
  NotOccupied,
  /* An upgrade is under way already. */
  InProgress,
  /* A guard hut where no large building could stand. */
  NoRoom,
}

// EXT: end of the new tables.
// ---------------------------------------------------------------------------

export class Building extends GameObject {
  static Type = BuildingType;

  // Max number of different types of resources accepted by buildings.
  static readonly kMaxStock = 3;

  // PORT: these are `protected` in the C++, with AI and IntegrityCheck as
  // friends. TS has no friends, so they are public.
  /* Map position of building */
  pos: MapPos;
  /* Type of building */
  type: BuildingType;
  /* Building owner */
  owner: number;
  /* Building under construction */
  constructing: boolean;
  /* Flags */
  threatLevel: number;
  playingSfx: boolean;
  serfRequestFailed: boolean;
  serfRequested: boolean;
  burning: boolean;
  active: boolean;
  holder: boolean;
  /* Index of flag connected to this building */
  flag: number;
  /* Stock of this building */
  stock: BuildingStock[];
  firstKnight: number;
  burningCounter: number;
  /* The construction, or the history of the mining of a mine. */
  progress: number;
  /* A military building under attack (bit 0 of progress in the original
     and in the saves). */
  underAttack: boolean;
  /* Type to build on the site once this burning building is gone
     (replace building by a special click). */
  queuedType: BuildingType;
  u: BuildingU;
  inventory: Inventory | null;
  // EXT: production controls. extPaused: the worker starts no new work.
  // extCap: 0, or the worker starts no new work while the owner's
  // inventories hold this many of the building's output or more.
  extPaused: boolean;
  extCap: number;
  // EXT: upgrade in place. upgradeTo is the type the building becomes
  // (TypeNone: no upgrade under way). The planks, then the stones, come to
  // stock[2]. upgradeTimer is the work left in ticks once all have arrived
  // (0 before).
  upgradeTo: BuildingType;
  upgradeTimer: number;

  constructor(game: Game, index: number) {
    super(game, index);
    this.stock = [];
    this.type = BuildingType.TypeNone;
    this.constructing = true; /* Unfinished building */
    this.flag = 0;
    this.playingSfx = false;
    this.threatLevel = 0;
    this.owner = 0;
    this.serfRequested = false;
    this.serfRequestFailed = false;
    this.burning = false;
    this.active = false;
    this.holder = false;
    this.pos = 0;
    this.progress = 0;
    this.underAttack = false;
    this.u = new BuildingU();
    this.inventory = null;

    for (let j = 0; j < Building.kMaxStock; j++) {
      this.stock.push({
        type: ResourceType.TypeNone,
        prio: 0,
        available: 0,
        requested: 0,
        maximum: 0,
      });
    }

    this.firstKnight = 0;
    this.burningCounter = 0;
    this.queuedType = BuildingType.TypeNone;
    // EXT:
    this.extPaused = false;
    this.extCap = 0;
    this.upgradeTo = BuildingType.TypeNone;
    this.upgradeTimer = 0;
  }

  getPosition(): MapPos {
    return this.pos;
  }
  setPosition(position: MapPos): void {
    this.pos = position;
  }

  getFlagIndex(): number {
    return this.flag;
  }
  linkFlag(flagIndex: number): void {
    this.flag = flagIndex;
  }
  unlinkFlag(): void {
    this.flag = 0;
  }

  hasKnight(): boolean {
    return this.firstKnight !== 0;
  }
  getFirstKnight(): number {
    return this.firstKnight;
  }

  setFirstKnight(serf: number): void {
    this.firstKnight = serf;

    /* Test whether building is already occupied by knights */
    if (!this.active) {
      this.active = true;

      let milType = -1;
      let maxGold = -1;
      switch (this.type) {
        case BuildingType.TypeHut:
          milType = 0;
          maxGold = 2;
          break;
        case BuildingType.TypeTower:
          milType = 1;
          maxGold = 4;
          break;
        case BuildingType.TypeFortress:
          milType = 2;
          maxGold = 8;
          break;
        default:
          NOT_REACHED();
          break;
      }

      this.game
        .getPlayer(this.owner)!
        .addNotification(MessageType.TypeKnightOccupied, this.pos, milType);

      const f = this.game.getFlagAtPos(this.game.getMap().moveDownRight(this.pos))!;
      f.clearFlags();
      this.stockInit(1, ResourceType.TypeGoldBar, maxGold);
      this.game.buildingCaptured(this);
    }
  }

  /* Set up as occupied, then put knights in without the first knight's
     arrival (tutorial 6's enemy). */
  setOccupied(): void {
    this.active = true;
  }
  placeKnight(serf: number): void {
    this.firstKnight = serf;
    this.stock[0].available += 1;
  }

  getQueuedType(): BuildingType {
    return this.queuedType;
  }
  setQueuedType(type: BuildingType): void {
    this.queuedType = type;
  }

  getBurningCounter(): number {
    return this.burningCounter;
  }
  setBurningCounter(counter: number): void {
    this.burningCounter = counter;
  }
  decreaseBurningCounter(delta: number): void {
    this.burningCounter -= delta;
  }

  /* Type of building. */
  getType(): BuildingType {
    return this.type;
  }
  isMilitary(): boolean {
    return (
      this.type === BuildingType.TypeHut ||
      this.type === BuildingType.TypeTower ||
      this.type === BuildingType.TypeFortress ||
      this.type === BuildingType.TypeCastle
    );
  }
  /* Owning player of the building. */
  getOwner(): number {
    return this.owner;
  }
  setOwner(newOwner: number): void {
    // EXT: an upgrade does not survive the capture of the building.
    if (this.upgradeTo !== BuildingType.TypeNone && newOwner !== this.owner) {
      this.cancelUpgrade();
    }
    this.owner = newOwner;
  }
  /* Whether construction of the building is finished. */
  isDone(): boolean {
    return !this.constructing;
  }
  isLeveling(): boolean {
    return !this.isDone() && this.progress === 0;
  }

  doneLeveling(): void {
    this.progress = 1;
    this.holder = false;
    this.firstKnight = 0;
  }

  startBuilding(type: BuildingType): MapObject {
    this.type = type;
    const mapObj = constInfo()[this.type].mapObj;
    this.progress = mapObj === MapObject.ObjectLargeBuilding ? 0 : 1;

    if (this.type === BuildingType.TypeCastle) {
      this.active = true;
      this.holder = true;

      this.stock[0].available = 0xff;
      this.stock[0].requested = 0xff;
      this.stock[1].available = 0xff;
      this.stock[1].requested = 0xff;
    } else {
      this.stock[0].type = ResourceType.TypePlank;
      this.stock[0].prio = 0;
      this.stock[0].maximum = constInfo()[this.type].planks;
      this.stock[1].type = ResourceType.TypeStone;
      this.stock[1].prio = 0;
      this.stock[1].maximum = constInfo()[this.type].stones;
    }

    return mapObj;
  }

  getProgress(): number {
    return this.progress;
  }

  buildProgress(): boolean {
    const frameFinished = BIT_TEST(this.progress, 15) !== 0 ? 1 : 0;
    this.progress +=
      frameFinished === 0 ? constInfo()[this.type].phase1 : constInfo()[this.type].phase2;

    if (this.progress <= 0xffff) {
      // Not finished yet
      return false;
    }

    this.progress = 0;
    this.constructing = false; /* Building finished */
    this.firstKnight = 0;

    if (this.type === BuildingType.TypeCastle) {
      return true;
    }

    this.holder = false;

    if (this.isMilitary()) {
      this.updateMilitaryFlagState();
    }

    const f = this.game.getFlag(this.getFlagIndex())!;

    this.stockInit(0, ResourceType.TypeNone, 0);
    this.stockInit(1, ResourceType.TypeNone, 0);
    f.clearFlags();

    /* Update player fields. */
    const player = this.game.getPlayer(this.owner)!;
    player.buildingBuilt(this);

    return true;
  }

  increaseMining(res: number): void {
    this.active = true;

    if (this.progress === 0x8000) {
      /* Handle empty mine. */
      const player = this.game.getPlayer(this.owner)!;
      if (player.isAi()) {
        /* TODO Burn building. */
      }

      player.addNotification(
        MessageType.TypeMineEmpty,
        this.pos,
        this.type - BuildingType.TypeStoneMine,
      );
    }

    this.progress = (this.progress << 1) & 0xffff;
    if (res > 0) {
      this.progress++;
    }
  }

  setUnderAttack(): void {
    this.underAttack = true;
  }
  isUnderAttack(): boolean {
    return this.underAttack;
  }

  /* The bit 0 of the progress of a finished military building of a save is
     whether it is under attack. */
  splitAttackBit(): void {
    if (!this.constructing && this.isMilitary()) {
      this.underAttack = BIT_TEST(this.progress, 0) !== 0;
      this.progress &= ~BIT(0);
    }
  }

  /* The threat level of the building. Higher values mean that
   the building is closer to the enemy. */
  getThreatLevel(): number {
    return this.threatLevel;
  }
  /* Building is currently playing back a sound effect. */
  isPlayingSfx(): boolean {
    return this.playingSfx;
  }
  startPlayingSfx(): void {
    this.playingSfx = true;
  }
  stopPlayingSfx(): void {
    this.playingSfx = false;
  }
  /* Building is active (specifics depend on building type). */
  isActive(): boolean {
    return this.active;
  }
  startActivity(): void {
    this.active = true;
  }
  stopActivity(): void {
    this.active = false;
  }
  /* Building is burning. */
  isBurning(): boolean {
    return this.burning;
  }

  burnup(): boolean {
    if (this.isBurning()) {
      return true;
    }

    this.burning = true;

    /* Remove lost gold stock from total count. */
    if (
      !this.constructing &&
      (this.getType() === BuildingType.TypeHut ||
        this.getType() === BuildingType.TypeTower ||
        this.getType() === BuildingType.TypeFortress ||
        this.getType() === BuildingType.TypeGoldSmelter)
    ) {
      const goldStock = i32(this.getResCountInStock(1));
      this.game.addGoldTotal(-goldStock);
    }

    /* Update land owner ship if the building is military. */
    if (!this.constructing && this.active && this.isMilitary()) {
      this.game.updateLandOwnership(this.pos);
    }

    if (
      !this.constructing &&
      (this.type === BuildingType.TypeCastle || this.type === BuildingType.TypeStock)
    ) {
      /* Cancel resources in the out queue and remove gold from map total. */
      if (this.active) {
        this.game.deleteInventory(this.inventory!);
        this.inventory = null;
      }

      /* Let some serfs escape while the building is burning. */
      let escapingSerfs = 0;
      for (const serf of this.game.getSerfsAtPos(this.pos)) {
        if (serf.buildingDeleted(this.pos, escapingSerfs < 12)) {
          escapingSerfs++;
        }
      }
    } else {
      this.active = false;
    }

    /* Remove stock from building. */
    this.removeStock();
    // EXT: and what came for an upgrade.
    if (this.upgradeTo !== BuildingType.TypeNone) {
      this.upgradeTo = BuildingType.TypeNone;
      this.upgradeTimer = 0;
      this.clearUpgradeStock();
    }

    this.stopPlayingSfx();

    let serfIndex = this.firstKnight;
    this.burningCounter = 2047;
    this.u.tick = this.game.getTick();

    const player = this.game.getPlayer(this.owner)!;
    player.buildingDemolished(this);

    if (this.holder) {
      this.holder = false;

      if (!this.constructing && this.type === BuildingType.TypeCastle) {
        this.setBurningCounter(8191);

        for (const serf of this.game.getSerfsAtPos(this.pos)) {
          serf.castleDeleted(this.pos, true);
        }
      }

      if (!this.constructing && this.isMilitary()) {
        while (serfIndex !== 0) {
          const serf = this.game.getSerf(serfIndex)!;
          serfIndex = serf.getNext();

          serf.castleDeleted(this.pos, false);
        }
      } else {
        const serf = this.game.getSerf(serfIndex)!;
        if (serf.getType() === SerfType.TypeTransporterInventory) {
          serf.setType(SerfType.TypeTransporter);
        }

        serf.castleDeleted(this.pos, false);
      }
    }

    const map = this.game.getMap();
    const flagPos = map.moveDownRight(this.pos);
    if (map.paths(flagPos) === 0 && map.getObj(flagPos) === MapObject.ObjectFlag) {
      this.game.demolishFlag(flagPos, player);
    }

    return true;
  }

  /* Building has an associated serf. */
  hasSerf(): boolean {
    return this.holder;
  }
  /* Building has succesfully requested a serf. */
  serfRequestGranted(): void {
    this.serfRequested = true;
  }

  requestedSerfLost(): void {
    if (this.serfRequested) {
      this.serfRequested = false;
    } else if (!this.hasInventory()) {
      this.decreaseRequestedForStock(0);
    }
  }

  requestedSerfReached(serf: Serf): void {
    this.holder = true;
    if (this.serfRequested) {
      this.firstKnight = serf.getIndex();
    }
    this.serfRequested = false;
  }

  /* Building has requested a serf but none was available. */
  clearSerfRequestFailure(): void {
    this.serfRequestFailed = false;
  }

  knightRequestGranted(): void {
    this.stock[0].requested += 1;
    this.serfRequested = false;
  }

  /* Building has inventory and the inventory pointer is valid. */
  hasInventory(): boolean {
    return this.inventory != null;
  }
  getInventory(): Inventory | null {
    return this.inventory;
  }
  setInventory(inventory: Inventory | null): void {
    this.inventory = inventory;
  }

  getLevel(): number {
    return this.u.level;
  }
  setLevel(level: number): void {
    this.u.level = level;
  }

  getTick(): number {
    return this.u.tick;
  }
  setTick(tick: number): void {
    this.u.tick = tick;
  }

  getKnightCount(): number {
    return this.waitingPlanks();
  }

  waitingStone(): number {
    return u32(this.stock[1].available); // Stone allways in stock #1
  }
  waitingPlanks(): number {
    return u32(this.stock[0].available); // Planks allways in stock #0
  }

  militaryGoldCount(): number {
    let count = 0;

    if (
      this.getType() === BuildingType.TypeHut ||
      this.getType() === BuildingType.TypeTower ||
      this.getType() === BuildingType.TypeFortress
    ) {
      for (let j = 0; j < Building.kMaxStock; j++) {
        if (this.stock[j].type === ResourceType.TypeGoldBar) {
          count = u32(count + this.stock[j].available);
        }
      }
    }

    return count;
  }

  cancelTransportedResource(res: ResourceType): void {
    if (
      res === ResourceType.TypeFish ||
      res === ResourceType.TypeMeat ||
      res === ResourceType.TypeBread
    ) {
      res = ResourceType.GroupFood;
    }

    let inStock = -1;
    for (let i = 0; i < Building.kMaxStock; i++) {
      if (this.stock[i].type === res) {
        inStock = i;
        break;
      }
    }

    if (inStock >= 0) {
      this.stock[inStock].requested -= 1;
      if (this.stock[inStock].requested < 0) {
        throw new ExceptionFreeserf('Failed to cancel unrequested resource delivery.');
      }
    }
  }

  callDefenderOut(): Serf {
    /* Remove knight from stats of defending building */
    if (this.hasInventory()) {
      /* Castle */
      this.game.getPlayer(this.getOwner())!.decreaseCastleKnights();
    } else {
      this.stock[0].available -= 1;
      this.stock[0].requested += 1;
    }

    /* The last knight in the list has to defend. */
    const firstSerf = this.game.getSerf(this.firstKnight)!;
    const defSerf: Serf = firstSerf.extractLastKnightFromList()!;

    if (defSerf.getIndex() === this.firstKnight) {
      this.firstKnight = 0;
    }

    return defSerf;
  }

  // The parameter is unnamed (and unused) in the C++.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  callAttackerOut(_knightIndex: number): Serf {
    this.stock[0].available -= 1;

    /* Unlink knight from list. */
    const firstSerf = this.game.getSerf(this.firstKnight)!;
    const defSerf: Serf = firstSerf.extractLastKnightFromList()!;

    if (defSerf.getIndex() === this.firstKnight) {
      this.firstKnight = 0;
    }

    return defSerf;
  }

  addRequestedResource(res: ResourceType, fixPriority: boolean): boolean {
    for (let j = 0; j < Building.kMaxStock; j++) {
      if (this.stock[j].type === res) {
        if (fixPriority) {
          let prio = this.stock[j].prio;
          if ((prio & 1) === 0) prio = 0;
          this.stock[j].prio = prio >> 1;
        } else {
          this.stock[j].prio = 0;
        }
        this.stock[j].requested += 1;
        return true;
      }
    }

    return false;
  }

  isStockActive(stockNum: number): boolean {
    return this.stock[stockNum].type > 0;
  }
  getResCountInStock(stockNum: number): number {
    return u32(this.stock[stockNum].available);
  }
  getResTypeInStock(stockNum: number): ResourceType {
    return this.stock[stockNum].type;
  }

  stockInit(stockNum: number, resType: ResourceType, maximum: number): void {
    this.stock[stockNum].type = resType;
    this.stock[stockNum].prio = 0;
    this.stock[stockNum].maximum = maximum;
  }

  removeStock(): void {
    this.stock[0].available = 0;
    this.stock[0].requested = 0;
    this.stock[1].available = 0;
    this.stock[1].requested = 0;
  }

  getMaxPriorityForResource(resource: ResourceType, minimum = 0): number {
    let maxPrio = -1;

    for (let i = 0; i < Building.kMaxStock; i++) {
      if (
        this.stock[i].type === resource &&
        this.stock[i].prio >= minimum &&
        this.stock[i].prio > maxPrio
      ) {
        maxPrio = this.stock[i].prio;
      }
    }

    return maxPrio;
  }

  getMaximumInStock(stockNum: number): number {
    return this.stock[stockNum].maximum;
  }
  getRequestedInStock(stockNum: number): number {
    return this.stock[stockNum].requested;
  }
  setPriorityInStock(stockNum: number, priority: number): void {
    this.stock[stockNum].prio = priority;
  }
  setInitialResInStock(stockNum: number, count: number): void {
    this.stock[stockNum].available = count;
  }

  requestedResourceDelivered(resource: ResourceType): void {
    if (this.burning) {
      return;
    }
    if (this.hasInventory()) {
      this.inventory!.pushResource(resource);
    } else {
      if (
        resource === ResourceType.TypeFish ||
        resource === ResourceType.TypeMeat ||
        resource === ResourceType.TypeBread
      ) {
        resource = ResourceType.GroupFood;
      }

      /* Add to building stock */
      for (let i = 0; i < Building.kMaxStock; i++) {
        if (this.stock[i].type === resource) {
          this.stock[i].available += 1;
          this.stock[i].requested -= 1;
          if (this.stock[i].requested < 0) {
            throw new ExceptionFreeserf('Delivered more resources than requested.');
          }
          return;
        }
      }

      throw new ExceptionFreeserf('Delivered unexpected resource.');
    }
  }

  plankUsedForBuild(): void {
    this.stock[0].available -= 1;
    this.stock[0].maximum -= 1;
  }
  stoneUsedForBuild(): void {
    this.stock[1].available -= 1;
    this.stock[1].maximum -= 1;
  }

  useResourceInStock(stockNum: number): boolean {
    if (this.stock[stockNum].available > 0) {
      this.stock[stockNum].available -= 1;
      return true;
    }
    return false;
  }

  useResourcesInStocks(): boolean {
    if (this.stock[0].available > 0 && this.stock[1].available > 0) {
      this.stock[0].available -= 1;
      this.stock[1].available -= 1;
      return true;
    }
    return false;
  }

  decreaseRequestedForStock(stockNum: number): void {
    this.stock[stockNum].requested -= 1;
  }

  pigsCount(): number {
    return this.stock[1].available;
  }
  sendPigToButcher(): void {
    this.stock[1].available -= 1;
  }
  placeNewPig(): void {
    this.stock[1].available += 1;
  }

  boatClear(): void {
    this.stock[1].available = 0;
  }
  boatDo(): void {
    this.stock[1].available++;
  }

  requestedKnightArrived(): void {
    this.stock[0].available += 1;
    this.stock[0].requested -= 1;
  }
  requestedKnightAttackingOnWalk(): void {
    this.stock[0].requested -= 1;
  }
  requestedKnightDefeatOnWalk(): void {
    if (!this.hasInventory()) this.stock[0].requested -= 1;
  }

  isEnoughPlaceForKnight(): boolean {
    let maxCapacity = -1;
    switch (this.getType()) {
      case BuildingType.TypeHut:
        maxCapacity = 3;
        break;
      case BuildingType.TypeTower:
        maxCapacity = 6;
        break;
      case BuildingType.TypeFortress:
        maxCapacity = 12;
        break;
      default:
        NOT_REACHED();
        break;
    }

    const totalKnights = this.stock[0].requested + this.stock[0].available;
    return totalKnights < maxCapacity;
  }

  knightComeBackFromFight(knight: Serf): boolean {
    if (this.isEnoughPlaceForKnight()) {
      this.stock[0].available += 1;
      const serf = this.game.getSerf(this.firstKnight);
      // PORT: the C++ passes the pointer on as is (it is null when
      // first_knight is 0 and the slot is empty).
      knight.insertBefore(serf as Serf);
      this.firstKnight = knight.getIndex();
      return true;
    }

    return false;
  }

  knightOccupy(): void {
    if (!this.hasKnight()) {
      this.stock[0].available = 0;
      this.stock[0].requested = 1;
    } else {
      this.stock[0].requested += 1;
    }
  }

  /* Calculate the flag state of military buildings (distance to enemy). */
  updateMilitaryFlagState(): void {
    const borderCheckOffsets = [
      31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42,
      100, 101, 102, 103, 104, 105, 106, 107, 108,
      259, 260, 261, 262, 263, 264,
      241, 242, 243, 244, 245, 246,
      217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228,
      247, 248, 249, 250, 251, 252,
      -1,

      265, 266, 267, 268, 269, 270, 271, 272, 273, 274, 275, 276,
      -1,

      277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288,
      289, 290, 291, 292, 293, 294,
      -1,
    ];

    let f: number;
    let k: number;
    const map = this.game.getMap();
    for (f = 3, k = 0; f > 0; f--) {
      let offset: number;
      while ((offset = borderCheckOffsets[k++]) >= 0) {
        const checkPos = map.posAddSpirally(this.getPosition(), offset);
        // EXT: the land of an ally is no threat.
        if (map.hasOwner(checkPos) && map.getOwner(checkPos) !== this.owner &&
            !this.game.isAllied(this.owner, map.getOwner(checkPos))) {
          this.threatLevel = f;
          return;
        }
      }
    }
  }

  setThreatLevel(level: number): void {
    this.threatLevel = level;
  }

  // -------------------------------------------------------------------------
  // EXT: production controls.

  setProductionPaused(paused: boolean): void {
    this.extPaused = paused;
  }
  isProductionPaused(): boolean {
    return this.extPaused;
  }
  setProductionCap(cap: number): void {
    this.extCap = cap;
  }
  getProductionCap(): number {
    return this.extCap;
  }

  /* Why the worker starts no new work: paused by the player, or the
     owner's inventories hold the cap of the output or more. The serf state
     handlers and the stock requests of update() ask this. */
  getProductionHold(): ProductionHold {
    if (this.extPaused) return ProductionHold.Paused;
    if (this.extCap > 0) {
      const res = productionOutput(this.type);
      if (res !== ResourceType.TypeNone &&
          this.game.getStockCount(this.owner, res) >= this.extCap) {
        return ProductionHold.Capped;
      }
    }
    return ProductionHold.None;
  }
  isProductionHeld(): boolean {
    /* The common case first: nothing set, nothing read. */
    if (!this.extPaused && this.extCap === 0) return false;
    return this.getProductionHold() !== ProductionHold.None;
  }

  // -------------------------------------------------------------------------
  // EXT: upgrade in place (guard hut to tower to fortress).

  getUpgradeTo(): BuildingType {
    return this.upgradeTo;
  }
  isUpgrading(): boolean {
    return this.upgradeTo !== BuildingType.TypeNone;
  }
  getUpgradeTimer(): number {
    return this.upgradeTimer;
  }

  /* Planks and stones that have arrived for the upgrade under way. */
  getUpgradeDelivered(): { planks: number; stones: number } {
    if (this.upgradeTo === BuildingType.TypeNone) return { planks: 0, stones: 0 };
    const cost = upgradeCost(this.type);
    const s = this.stock[2];
    if (s.type === ResourceType.TypePlank) return { planks: s.available, stones: 0 };
    if (s.type === ResourceType.TypeStone) return { planks: cost.planks, stones: s.available };
    return cost;
  }

  /* Begin the upgrade; Game::upgradeBuilding has checked that it is
     allowed and reserves the site. The planks come first. */
  startUpgrade(): void {
    this.upgradeTo = upgradeTarget(this.type);
    this.upgradeTimer = 0;
    const s = this.stock[2];
    s.type = ResourceType.TypePlank;
    s.prio = 0;
    s.available = 0;
    s.requested = 0;
    s.maximum = upgradeCost(this.type).planks;
  }

  private clearUpgradeStock(): void {
    const s = this.stock[2];
    s.type = ResourceType.TypeNone;
    s.prio = 0;
    s.available = 0;
    s.requested = 0;
    s.maximum = 0;
  }

  /* Give the upgrade up (the building was captured). What was delivered
     is lost; a guard hut is a small building on the map again. */
  cancelUpgrade(): void {
    if (this.upgradeTo === BuildingType.TypeNone) return;
    this.upgradeTo = BuildingType.TypeNone;
    this.upgradeTimer = 0;
    this.clearUpgradeStock();
    if (constInfo()[this.type].mapObj === MapObject.ObjectSmallBuilding &&
        this.game.getMap().getObj(this.pos) === MapObject.ObjectLargeBuilding) {
      this.game.getMap().setObject(this.pos, MapObject.ObjectSmallBuilding, this.getIndex());
    }
  }

  /* Part of update_military() while an upgrade is under way: ask for the
     planks, then for the stones, then count the work down. */
  private updateUpgrade(): void {
    const s = this.stock[2];

    if (this.upgradeTimer > 0) {
      this.upgradeTimer -= this.game.getTickDiff();
      if (this.upgradeTimer <= 0) this.finishUpgrade();
      return;
    }

    if (s.available >= s.maximum) {
      /* All of this material is here (so none is on the way). */
      if (s.type === ResourceType.TypePlank) {
        s.type = ResourceType.TypeStone;
        s.prio = 0;
        s.available = 0;
        s.requested = 0;
        s.maximum = upgradeCost(this.type).stones;
      } else {
        this.upgradeTimer = upgradeWorkTicks(this.type);
        this.clearUpgradeStock();
      }
      return;
    }

    /* Request like a construction site with its builder (update_unfinished):
       nothing during the emergency of that material. */
    const player = this.game.getPlayer(this.getOwner())!;
    const total = s.requested + s.available;
    const emergency = s.type === ResourceType.TypePlank ? player.isOutOfPlanks() : player.isOutOfStone();
    if (!emergency && total < s.maximum) {
      s.prio = (0xff >> total) & ~BIT(0);
    } else {
      s.prio = 0;
    }
  }

  /* The building becomes the new type where it stands: its knights and
     its gold stay, its land grows by the rule of the new type. */
  private finishUpgrade(): void {
    const newType = this.upgradeTo;
    const player = this.game.getPlayer(this.owner)!;

    /* The counts and the score of the player: the old type goes as a
       demolished one does, the new comes as a finished site does. */
    player.buildingDemolished(this);
    this.type = newType;
    player.incompleteBuildingCount[newType] += 1;
    player.buildingBuilt(this);

    this.upgradeTo = BuildingType.TypeNone;
    this.upgradeTimer = 0;
    this.clearUpgradeStock();

    /* More room for gold (stock 1 keeps what lies there). */
    this.stock[1].maximum = militaryMaxGold(newType);

    /* The knights inside train as those of the new type. */
    let serfIndex = this.firstKnight;
    for (let guard = 0; serfIndex !== 0 && guard < 1000; guard++) {
      const serf = this.game.getSerf(serfIndex);
      if (serf == null) break;
      if (!serf.defendedBuildingUpgraded(newType)) break;
      serfIndex = serf.getNext();
    }

    /* The land of the new type, with the messages about lost land for the
       others, as when knights occupy a new building (set_first_knight). */
    this.game.buildingCaptured(this);
  }

  update(tick: number): void {
    if (this.burning) {
      const delta = u16(tick - this.u.tick);
      this.u.tick = tick;
      if (this.burningCounter >= delta) {
        this.burningCounter -= delta;
      } else {
        this.game.buildingBurnedDown(this);
      }
    } else {
      this.updateNoTick();
    }
  }

  // PORT: operator>> (SaveReaderBinary) is not ported (the binary reader
  // SaveReaderBinary is not ported).

  // PORT: operator>> (SaveReaderText &reader, Building &building).
  loadText(reader: SaveReaderText): void {
    let x = 0;
    let y = 0;
    x = reader.value('pos').at(0).readUint();
    y = reader.value('pos').at(1).readUint();
    this.pos = this.game.getMap().pos(x, y);
    this.type = reader.value('type').readInt();
    try {
      this.owner = reader.value('owner').readUint();
      let temp: number;
      temp = reader.value('constructing').readInt();
      this.constructing = temp !== 0;
    } catch {
      let n: number;
      n = reader.value('bld').readUint();
      this.owner = n & 3;
      this.constructing = (n & 0x80) !== 0;
    }
    try {
      this.threatLevel = reader.value('military_state').readUint();
      let temp: number;
      temp = reader.value('serf_request_failed').readInt();
      this.serfRequestFailed = temp !== 0;
      temp = reader.value('playing_sfx').readInt();
      this.playingSfx = temp !== 0;
      temp = reader.value('active').readInt();
      this.active = temp !== 0;
      temp = reader.value('burning').readInt();
      this.burning = temp !== 0;
      /* Older saves did not keep it: the fire ends at once. */
      if (reader.hasValue('burning_counter')) {
        this.burningCounter = reader.value('burning_counter').readInt();
      }
      temp = reader.value('holder').readInt();
      this.holder = temp !== 0;
      temp = reader.value('serf_requested').readInt();
      this.serfRequested = temp !== 0;
    } catch {
      let n: number;
      n = reader.value('serf').readUint();
      this.threatLevel = n & 3;
      this.serfRequestFailed = (n & 4) !== 0;
      this.playingSfx = (n & 8) !== 0;
      this.active = (n & 16) !== 0;
      this.burning = (n & 32) !== 0;
      this.holder = (n & 64) !== 0;
      this.serfRequested = (n & 128) !== 0;
    }
    this.flag = reader.value('flag').readUint();

    this.stock[0].type = reader.value('stock[0].type').readInt();
    this.stock[0].prio = reader.value('stock[0].prio').readInt();
    this.stock[0].available = reader.value('stock[0].available').readInt();
    this.stock[0].requested = reader.value('stock[0].requested').readInt();
    this.stock[0].maximum = reader.value('stock[0].maximum').readInt();

    this.stock[1].type = reader.value('stock[1].type').readInt();
    this.stock[1].prio = reader.value('stock[1].prio').readInt();
    this.stock[1].available = reader.value('stock[1].available').readInt();
    this.stock[1].requested = reader.value('stock[1].requested').readInt();
    this.stock[1].maximum = reader.value('stock[1].maximum').readInt();

    this.firstKnight = reader.value('serf_index').readUint();
    this.progress = reader.value('progress').readInt();
    this.splitAttackBit();
    if (reader.hasValue('queued_type')) {
      let queuedType: number;
      queuedType = reader.value('queued_type').readUint();
      this.queuedType = queuedType as BuildingType;
    }
    // EXT: written only when set; older saves have none of them.
    if (reader.hasValue('ext_paused')) {
      this.extPaused = reader.value('ext_paused').readInt() !== 0;
    }
    if (reader.hasValue('ext_cap')) {
      this.extCap = reader.value('ext_cap').readInt();
    }
    if (reader.hasValue('ext_upgrade')) {
      this.upgradeTo = reader.value('ext_upgrade').readInt() as BuildingType;
      this.upgradeTimer = reader.value('ext_upgrade_timer').readInt();
      this.stock[2].type = reader.value('stock[2].type').readInt();
      this.stock[2].prio = reader.value('stock[2].prio').readInt();
      this.stock[2].available = reader.value('stock[2].available').readInt();
      this.stock[2].requested = reader.value('stock[2].requested').readInt();
      this.stock[2].maximum = reader.value('stock[2].maximum').readInt();
    }

    if (reader.hasValue('inventory')) {
      let inventoryIndex: number;
      inventoryIndex = reader.value('inventory').readUint();
      this.inventory = this.game.createInventory(inventoryIndex);
    } else if (this.burning) {
      this.u.tick = reader.value('tick').readUint();
    } else {
      this.u.level = reader.value('level').readUint();
    }
  }

  // PORT: operator<< (SaveWriterText &writer, Building &building).
  saveText(writer: SaveWriterText): void {
    writer.value('pos').writeUint(this.game.getMap().posCol(this.pos));
    writer.value('pos').writeUint(this.game.getMap().posRow(this.pos));
    writer.value('type').write(this.type);
    writer.value('owner').writeUint(this.owner);
    writer.value('constructing').write(this.constructing);

    writer.value('military_state').writeUint(this.threatLevel);
    writer.value('playing_sfx').write(this.playingSfx);
    writer.value('serf_request_failed').write(this.serfRequestFailed);
    writer.value('serf_requested').write(this.serfRequested);
    writer.value('burning').write(this.burning);
    writer.value('burning_counter').write(this.burningCounter);
    writer.value('active').write(this.active);
    writer.value('holder').write(this.holder);

    writer.value('flag').writeUint(this.flag);

    writer.value('stock[0].type').write(this.stock[0].type);
    writer.value('stock[0].prio').write(this.stock[0].prio);
    writer.value('stock[0].available').write(this.stock[0].available);
    writer.value('stock[0].requested').write(this.stock[0].requested);
    writer.value('stock[0].maximum').write(this.stock[0].maximum);

    writer.value('stock[1].type').write(this.stock[1].type);
    writer.value('stock[1].prio').write(this.stock[1].prio);
    writer.value('stock[1].available').write(this.stock[1].available);
    writer.value('stock[1].requested').write(this.stock[1].requested);
    writer.value('stock[1].maximum').write(this.stock[1].maximum);

    writer.value('serf_index').writeUint(this.firstKnight);
    writer.value('progress').write(this.progress | (this.underAttack ? BIT(0) : 0));
    if (this.queuedType !== BuildingType.TypeNone) {
      writer.value('queued_type').write(this.queuedType);
    }
    // EXT:
    if (this.extPaused) {
      writer.value('ext_paused').write(this.extPaused);
    }
    if (this.extCap !== 0) {
      writer.value('ext_cap').write(this.extCap);
    }
    if (this.upgradeTo !== BuildingType.TypeNone) {
      writer.value('ext_upgrade').write(this.upgradeTo);
      writer.value('ext_upgrade_timer').write(this.upgradeTimer);
      writer.value('stock[2].type').write(this.stock[2].type);
      writer.value('stock[2].prio').write(this.stock[2].prio);
      writer.value('stock[2].available').write(this.stock[2].available);
      writer.value('stock[2].requested').write(this.stock[2].requested);
      writer.value('stock[2].maximum').write(this.stock[2].maximum);
    }

    if (this.inventory !== null) {
      writer.value('inventory').writeUint(this.inventory.getIndex());
    } else if (this.isBurning()) {
      writer.value('tick').writeUint(this.u.tick);
    } else {
      writer.value('level').writeUint(this.u.level);
    }
  }

  // PORT: the private overload `void update()` of the C++. TS has no
  // overloads by arity with different visibility, so it has its own name.
  private updateNoTick(): void {
    const stock = this.stock;
    if (!this.constructing) {
      this.requestSerfIfNeeded();

      switch (this.getType()) {
        case BuildingType.TypeBoatbuilder:
          if (this.holder) {
            const player = this.game.getPlayer(this.getOwner())!;
            const totalTree = stock[0].requested + stock[0].available;
            if (totalTree < stock[0].maximum) {
              /* No planks during a planks emergency (Amiga @0xc6c0). */
              stock[0].prio = player.isOutOfPlanks()
                ? 0
                : player.getPlanksBoatbuilder() >> (8 + totalTree);
            } else {
              stock[0].prio = 0;
            }
          }
          break;
        case BuildingType.TypeStoneMine:
          if (this.holder) {
            const totalFood = stock[0].requested + stock[0].available;
            if (totalFood < stock[0].maximum) {
              const player = this.game.getPlayer(this.getOwner())!;
              stock[0].prio = player.getFoodStonemine() >> (8 + totalFood);
            } else {
              stock[0].prio = 0;
            }
          }
          break;
        case BuildingType.TypeCoalMine:
          if (this.holder) {
            const totalFood = stock[0].requested + stock[0].available;
            if (totalFood < stock[0].maximum) {
              const player = this.game.getPlayer(this.getOwner())!;
              stock[0].prio = player.getFoodCoalmine() >> (8 + totalFood);
            } else {
              stock[0].prio = 0;
            }
          }
          break;
        case BuildingType.TypeIronMine:
          if (this.holder) {
            const totalFood = stock[0].requested + stock[0].available;
            if (totalFood < stock[0].maximum) {
              const player = this.game.getPlayer(this.getOwner())!;
              stock[0].prio = player.getFoodIronmine() >> (8 + totalFood);
            } else {
              stock[0].prio = 0;
            }
          }
          break;
        case BuildingType.TypeGoldMine:
          if (this.holder) {
            const totalFood = stock[0].requested + stock[0].available;
            if (totalFood < stock[0].maximum) {
              const player = this.game.getPlayer(this.getOwner())!;
              stock[0].prio = player.getFoodGoldmine() >> (8 + totalFood);
            } else {
              stock[0].prio = 0;
            }
          }
          break;
        case BuildingType.TypeStock:
          if (!this.isActive()) {
            const inv: Inventory | null = this.game.createInventory();
            if (inv == null) return;

            inv.setOwner(this.getOwner());
            inv.setBuildingIndex(this.getIndex());
            inv.setFlagIndex(this.flag);

            this.inventory = inv;
            stock[0].requested = 0xff;
            stock[0].available = 0xff;
            stock[1].requested = 0xff;
            stock[1].available = 0xff;
            this.active = true;

            this.game
              .getPlayer(this.getOwner())!
              .addNotification(MessageType.TypeNewStock, this.pos, 0);
          } else {
            if (!this.serfRequestFailed && !this.holder && !this.serfRequested) {
              this.sendSerfToBuilding(
                SerfType.TypeTransporter,
                ResourceType.TypeNone,
                ResourceType.TypeNone,
              );
            }

            const player = this.game.getPlayer(this.getOwner())!;
            const inventory = this.inventory!;
            // The C++ condition is `!inventory->have_any_out_mode() == 0`,
            // which is true when an OUT mode IS set (the castle code below
            // tests the opposite). Kept as written.
            if (
              this.holder &&
              Number(!inventory.haveAnyOutMode()) === 0 && // Not serf or
              // res OUT mode
              inventory.freeSerfCount() === 0
            ) {
              if (player.tickSendGenericDelay()) {
                this.sendSerfToBuilding(
                  SerfType.TypeGeneric,
                  ResourceType.TypeNone,
                  ResourceType.TypeNone,
                );
              }
            }

            /* TODO Following code looks like a hack */
            const map = this.game.getMap();
            const flagPos = map.moveDownRight(this.pos);
            if (map.hasSerf(flagPos)) {
              const serf = this.game.getSerfAtPos(flagPos)!;
              if (serf.getPos() !== flagPos) {
                map.setSerfIndex(flagPos, 0);
              }
            }
          }
          break;
        case BuildingType.TypeHut:
        case BuildingType.TypeTower:
        case BuildingType.TypeFortress:
          this.updateMilitary();
          break;
        case BuildingType.TypeButcher:
          if (this.holder) {
            /* Request more of that delicious meat. */
            const totalStock = stock[0].requested + stock[0].available;
            if (totalStock < stock[0].maximum) {
              stock[0].prio = 0xff >> totalStock;
            } else {
              stock[0].prio = 0;
            }
          }
          break;
        case BuildingType.TypePigFarm:
          if (this.holder) {
            /* Request more wheat. */
            const totalStock = stock[0].requested + stock[0].available;
            if (totalStock < stock[0].maximum) {
              const player = this.game.getPlayer(this.getOwner())!;
              stock[0].prio = player.getWheatPigfarm() >> (8 + totalStock);
            } else {
              stock[0].prio = 0;
            }
          }
          break;
        case BuildingType.TypeMill:
          if (this.holder) {
            /* Request more wheat. */
            const totalStock = stock[0].requested + stock[0].available;
            if (totalStock < stock[0].maximum) {
              const player = this.game.getPlayer(this.getOwner())!;
              stock[0].prio = player.getWheatMill() >> (8 + totalStock);
            } else {
              stock[0].prio = 0;
            }
          }
          break;
        case BuildingType.TypeBaker:
          if (this.holder) {
            /* Request more flour. */
            const totalStock = stock[0].requested + stock[0].available;
            if (totalStock < stock[0].maximum) {
              stock[0].prio = 0xff >> totalStock;
            } else {
              stock[0].prio = 0;
            }
          }
          break;
        case BuildingType.TypeSawmill:
          if (this.holder) {
            /* Request more lumber */
            const totalStock = stock[1].requested + stock[1].available;
            if (totalStock < stock[1].maximum) {
              stock[1].prio = 0xff >> totalStock;
            } else {
              stock[1].prio = 0;
            }
          }
          break;
        case BuildingType.TypeSteelSmelter:
          if (this.holder) {
            /* Request more coal */
            const totalCoal = stock[0].requested + stock[0].available;
            if (totalCoal < stock[0].maximum) {
              const player = this.game.getPlayer(this.getOwner())!;
              stock[0].prio = player.getCoalSteelsmelter() >> (8 + totalCoal);
            } else {
              stock[0].prio = 0;
            }

            /* Request more iron ore */
            const totalIronore = stock[1].requested + stock[1].available;
            if (totalIronore < stock[1].maximum) {
              stock[1].prio = 0xff >> totalIronore;
            } else {
              stock[1].prio = 0;
            }
          }
          break;
        case BuildingType.TypeToolMaker:
          if (this.holder) {
            /* Request more planks. */
            const player = this.game.getPlayer(this.getOwner())!;
            const totalTree = stock[0].requested + stock[0].available;
            if (totalTree < stock[0].maximum) {
              /* No planks during a planks emergency (Amiga @0xc72c). */
              stock[0].prio = player.isOutOfPlanks()
                ? 0
                : player.getPlanksToolmaker() >> (8 + totalTree);
            } else {
              stock[0].prio = 0;
            }

            /* Request more steel. */
            const totalSteel = stock[1].requested + stock[1].available;
            if (totalSteel < stock[1].maximum) {
              stock[1].prio = player.getSteelToolmaker() >> (8 + totalSteel);
            } else {
              stock[1].prio = 0;
            }
          }
          break;
        case BuildingType.TypeWeaponSmith:
          if (this.holder) {
            /* Request more coal. */
            const player = this.game.getPlayer(this.getOwner())!;
            const totalCoal = stock[0].requested + stock[0].available;
            if (totalCoal < stock[0].maximum) {
              stock[0].prio = player.getCoalWeaponsmith() >> (8 + totalCoal);
            } else {
              stock[0].prio = 0;
            }

            /* Request more steel. */
            const totalSteel = stock[1].requested + stock[1].available;
            if (totalSteel < stock[1].maximum) {
              stock[1].prio = player.getSteelWeaponsmith() >> (8 + totalSteel);
            } else {
              stock[1].prio = 0;
            }
          }
          break;
        case BuildingType.TypeGoldSmelter:
          if (this.holder) {
            /* Request more coal. */
            const player = this.game.getPlayer(this.getOwner())!;
            const totalCoal = stock[0].requested + stock[0].available;
            if (totalCoal < stock[0].maximum) {
              stock[0].prio = player.getCoalGoldsmelter() >> (8 + totalCoal);
            } else {
              stock[0].prio = 0;
            }

            /* Request more gold ore. */
            const totalGoldore = stock[1].requested + stock[1].available;
            if (totalGoldore < stock[1].maximum) {
              stock[1].prio = 0xff >> totalGoldore;
            } else {
              stock[1].prio = 0;
            }
          }
          break;
        case BuildingType.TypeCastle:
          this.updateCastle();
          break;
        default:
          break;
      }

      // EXT: a paused or capped building asks for no more input. What is
      // on the way still arrives.
      if (this.isProductionHeld()) {
        stock[0].prio = 0;
        stock[1].prio = 0;
      }
    } else {
      /* Unfinished */
      switch (this.type) {
        case BuildingType.TypeNone:
        case BuildingType.TypeCastle:
          break;
        case BuildingType.TypeFisher:
        case BuildingType.TypeLumberjack:
        case BuildingType.TypeBoatbuilder:
        case BuildingType.TypeStonecutter:
        case BuildingType.TypeStoneMine:
        case BuildingType.TypeCoalMine:
        case BuildingType.TypeIronMine:
        case BuildingType.TypeGoldMine:
        case BuildingType.TypeForester:
        case BuildingType.TypeHut:
        case BuildingType.TypeMill:
          this.updateUnfinished();
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
          this.updateUnfinishedAdv();
          break;
        default:
          NOT_REACHED();
          break;
      }
    }
  }

  /* Update unfinished building as part of the game progression. */
  private updateUnfinished(): void {
    const stock = this.stock;
    const player = this.game.getPlayer(this.getOwner())!;

    /* During an emergency only the designated buildings get a builder and
       planks or stone (Amiga update_unfinished_building @0xc01e). */
    const designated: boolean = player.isEmergencyDesignated(this.getIndex());

    /* Request builder serf */
    if (!this.serfRequestFailed && !this.holder && !this.serfRequested) {
      this.progress = 1;
      if (player.isEmergencyActive() && !designated) {
        this.serfRequestFailed = true;
        return;
      }
      this.serfRequestFailed = !this.sendSerfToBuilding(
        SerfType.TypeBuilder,
        ResourceType.TypeHammer,
        ResourceType.TypeNone,
      );
    }

    /* During a planks or stone emergency computer players demolish
       construction sites at random, the less progress the more likely
       (Amiga @0xc07a / 0xc10e). In the stone branch the original tests the
       designated stonecutter the wrong way round (bne @0xc10c); not
       reproduced. */
    if ((player.isOutOfPlanks() || player.isOutOfStone()) && !designated && player.isAi()) {
      const rolls = (player.isOutOfPlanks() ? 1 : 0) + (player.isOutOfStone() ? 1 : 0);
      const limit = u16(~this.progress) >> 5;
      for (let i = 0; i < rolls; i++) {
        if (this.game.randomInt() < limit) {
          this.game.demolishBuilding(this.pos, player);
          return;
        }
      }
    }

    /* Request planks */
    const totalPlanks = stock[0].requested + stock[0].available;
    if (player.isOutOfPlanks() && !designated) {
      stock[0].prio = 0;
    } else if (totalPlanks < stock[0].maximum) {
      let planksPrio: number = player.getPlanksConstruction() >> (8 + totalPlanks);
      if (!this.holder) planksPrio >>= 2;
      stock[0].prio = planksPrio & ~BIT(0);
    } else {
      stock[0].prio = 0;
    }

    /* Request stone */
    const totalStone = stock[1].requested + stock[1].available;
    if (player.isOutOfStone() && !designated) {
      stock[1].prio = 0;
    } else if (totalStone < stock[1].maximum) {
      let stonePrio = 0xff >> totalStone;
      if (!this.holder) stonePrio >>= 2;
      stock[1].prio = stonePrio & ~BIT(0);
    } else {
      stock[1].prio = 0;
    }
  }

  private updateUnfinishedAdv(): void {
    if (this.progress > 0) {
      this.updateUnfinished();
      return;
    }

    if (this.holder || this.serfRequested) {
      return;
    }

    /* Check whether building needs leveling */
    let needLeveling = 0;
    // `unsigned int height = game->get_leveling_height(pos)` (an int).
    const height = u32(this.game.getLevelingHeight(this.pos));
    for (let i = 0; i < 7; i++) {
      const pos = this.game.getMap().posAddSpirally(this.pos, i);
      if (this.game.getMap().getHeight(pos) !== height) {
        needLeveling = 1;
        break;
      }
    }

    if (!needLeveling) {
      /* Already at the correct level, don't send digger */
      this.progress = 1;
      this.updateUnfinished();
      return;
    }

    /* Request digger; during an emergency only for the lumberjack,
       stonecutter and sawmill sites (Amiga @0xbfc0). */
    if (!this.serfRequestFailed) {
      const player = this.game.getPlayer(this.getOwner())!;
      if (
        player.isEmergencyActive() &&
        this.type !== BuildingType.TypeLumberjack &&
        this.type !== BuildingType.TypeStonecutter &&
        this.type !== BuildingType.TypeSawmill
      ) {
        this.serfRequestFailed = true;
        return;
      }
      this.serfRequestFailed = !this.sendSerfToBuilding(
        SerfType.TypeDigger,
        ResourceType.TypeShovel,
        ResourceType.TypeNone,
      );
    }
  }

  /* Update castle as part of the game progression. */
  private updateCastle(): void {
    const player = this.game.getPlayer(this.getOwner())!;
    const inventory = this.inventory!;
    if (player.getCastleKnights() === player.getCastleKnightsWanted()) {
      let bestKnight: Serf | null = null;
      let lastKnight: Serf | null = null;
      let nextSerfIndex = this.firstKnight;
      while (nextSerfIndex !== 0) {
        const serf: Serf | null = this.game.getSerf(nextSerfIndex);
        if (serf == null) {
          throw new ExceptionFreeserf('Index of nonexistent serf in the queue.');
        }
        if (bestKnight == null || serf.getType() < bestKnight.getType()) {
          bestKnight = serf;
        }
        lastKnight = serf;
        nextSerfIndex = serf.getNext();
      }

      if (bestKnight != null) {
        const knightType: number = bestKnight.getType();
        for (let t: number = SerfType.TypeKnight0; t <= SerfType.TypeKnight4; t++) {
          if (knightType > t) {
            inventory.callInternal(bestKnight);
          }
        }

        /* Switch types */
        const tmp = bestKnight.getType();
        bestKnight.setType(lastKnight!.getType());
        lastKnight!.setType(tmp);
      }
    } else if (player.getCastleKnights() < player.getCastleKnightsWanted()) {
      let knightType: SerfType = SerfType.TypeNone;
      for (let t: number = SerfType.TypeKnight4; t >= SerfType.TypeKnight0; t--) {
        if (inventory.haveSerf(t as SerfType)) {
          knightType = t as SerfType;
          break;
        }
      }

      if ((knightType as number) < 0) {
        /* None found */
        if (
          inventory.haveSerf(SerfType.TypeGeneric) &&
          inventory.getCountOf(ResourceType.TypeSword) !== 0 &&
          inventory.getCountOf(ResourceType.TypeShield) !== 0
        ) {
          const serf: Serf = inventory.specializeFreeSerf(SerfType.TypeKnight0)!;
          inventory.callInternal(serf);

          serf.addToDefendingQueue(this.firstKnight, false);
          this.firstKnight = serf.getIndex();
          player.increaseCastleKnights();
        } else {
          if (player.tickSendKnightDelay()) {
            this.sendSerfToBuilding(
              SerfType.TypeNone,
              ResourceType.TypeNone,
              ResourceType.TypeNone,
            );
          }
        }
      } else {
        /* Prepend to knights list */
        // PORT: Inventory::call_internal is overloaded on (Serf*) and
        // (Serf::Type); this is the Serf::Type one, which returns the serf.
        const serf: Serf = inventory.callInternal(knightType)!;
        serf.addToDefendingQueue(this.firstKnight, true);
        this.firstKnight = serf.getIndex();
        player.increaseCastleKnights();
      }
    } else {
      player.decreaseCastleKnights();

      const serfIndex = this.firstKnight;
      const serf = this.game.getSerf(serfIndex)!;
      this.firstKnight = serf.getNext();

      serf.stayIdleInStock(inventory.getIndex());
    }

    if (
      this.holder &&
      !inventory.haveAnyOutMode() /* Not serf or res OUT mode */ &&
      inventory.freeSerfCount() === 0
    ) {
      if (player.tickSendGenericDelay()) {
        this.sendSerfToBuilding(
          SerfType.TypeGeneric,
          ResourceType.TypeNone,
          ResourceType.TypeNone,
        );
      }
    }

    const map = this.game.getMap();
    const flagPos = map.moveDownRight(this.pos);
    if (map.hasSerf(flagPos)) {
      const serf = this.game.getSerfAtPos(flagPos)!;
      if (serf.getPos() !== flagPos) {
        map.setSerfIndex(flagPos, 0);
      }
    }
  }

  private updateMilitary(): void {
    const stock = this.stock;
    const hutOccupantsFromLevel = [1, 1, 2, 2, 3, 1, 1, 1, 1, 2];

    const towerOccupantsFromLevel = [1, 2, 3, 4, 6, 1, 1, 2, 3, 4];

    const fortressOccupantsFromLevel = [1, 3, 6, 9, 12, 1, 2, 4, 6, 8];

    const player = this.game.getPlayer(this.getOwner())!;
    let maxOccLevel = (player.getKnightOccupation(this.threatLevel) >> 4) & 0xf;
    if (player.reducedKnightLevel()) maxOccLevel += 5;
    if (maxOccLevel > 9) maxOccLevel = 9;

    let neededOccupants = -1;
    let maxGold = -1;
    switch (this.getType()) {
      case BuildingType.TypeHut:
        neededOccupants = hutOccupantsFromLevel[maxOccLevel];
        maxGold = 2;
        break;
      case BuildingType.TypeTower:
        neededOccupants = towerOccupantsFromLevel[maxOccLevel];
        maxGold = 4;
        break;
      case BuildingType.TypeFortress:
        neededOccupants = fortressOccupantsFromLevel[maxOccLevel];
        maxGold = 8;
        break;
      default:
        NOT_REACHED();
        break;
    }

    const totalKnights = stock[0].requested + stock[0].available;
    const presentKnights = stock[0].available;
    if (totalKnights < neededOccupants) {
      if (!this.serfRequestFailed) {
        this.serfRequestFailed = !this.sendSerfToBuilding(
          SerfType.TypeNone,
          ResourceType.TypeNone,
          ResourceType.TypeNone,
        );
      }
    } else if (
      neededOccupants < presentKnights &&
      !this.game.getMap().hasSerf(this.game.getMap().moveDownRight(this.pos))
    ) {
      /* Kick least trained knight out. */
      let leavingSerf: Serf | null = null;
      let serfIndex = this.firstKnight;
      while (serfIndex !== 0) {
        const serf: Serf | null = this.game.getSerf(serfIndex);
        if (serf == null) {
          throw new ExceptionFreeserf('Index of nonexistent serf in the queue.');
        }
        if (leavingSerf == null || serf.getType() < leavingSerf.getType()) {
          leavingSerf = serf;
        }
        serfIndex = serf.getNext();
      }

      if (leavingSerf != null) {
        /* Remove leaving serf from list. */
        if (leavingSerf.getIndex() === this.firstKnight) {
          this.firstKnight = leavingSerf.getNext();
        } else {
          serfIndex = this.firstKnight;
          while (serfIndex !== 0) {
            const serf = this.game.getSerf(serfIndex)!;
            if (serf.getNext() === leavingSerf.getIndex()) {
              serf.setNext(leavingSerf.getNext());
              break;
            }
            serfIndex = serf.getNext();
          }
        }

        /* Update serf state. */
        leavingSerf.goOutFromBuilding(0, 0, -2);

        stock[0].available -= 1;
      }
    }

    /* Request gold */
    if (this.holder) {
      const totalGold = stock[1].requested + stock[1].available;
      player.increaseMilitaryMaxGold(maxGold);

      if (totalGold < maxGold) {
        stock[1].prio = ((0xfe >> totalGold) + 1) & 0xfe;
      } else {
        stock[1].prio = 0;
      }
    }

    // EXT: the material and the work of an upgrade.
    if (this.upgradeTo !== BuildingType.TypeNone) {
      this.updateUpgrade();
    }
  }

  private requestSerfIfNeeded(): void {
    interface Request {
      serfType: SerfType;
      resType1: ResourceType;
      resType2: ResourceType;
    }
    const rq = (serfType: SerfType, resType1: ResourceType, resType2: ResourceType): Request => ({
      serfType,
      resType1,
      resType2,
    });

    const requests: Request[] = [
      rq(SerfType.TypeNone, ResourceType.TypeNone, ResourceType.TypeNone),
      rq(SerfType.TypeFisher, ResourceType.TypeRod, ResourceType.TypeNone),
      rq(SerfType.TypeLumberjack, ResourceType.TypeAxe, ResourceType.TypeNone),
      rq(SerfType.TypeBoatBuilder, ResourceType.TypeHammer, ResourceType.TypeNone),
      rq(SerfType.TypeStonecutter, ResourceType.TypePick, ResourceType.TypeNone),
      rq(SerfType.TypeMiner, ResourceType.TypePick, ResourceType.TypeNone),
      rq(SerfType.TypeMiner, ResourceType.TypePick, ResourceType.TypeNone),
      rq(SerfType.TypeMiner, ResourceType.TypePick, ResourceType.TypeNone),
      rq(SerfType.TypeMiner, ResourceType.TypePick, ResourceType.TypeNone),
      rq(SerfType.TypeForester, ResourceType.TypeNone, ResourceType.TypeNone),
      rq(SerfType.TypeNone, ResourceType.TypeNone, ResourceType.TypeNone),
      rq(SerfType.TypeNone, ResourceType.TypeNone, ResourceType.TypeNone),
      rq(SerfType.TypeFarmer, ResourceType.TypeScythe, ResourceType.TypeNone),
      rq(SerfType.TypeButcher, ResourceType.TypeCleaver, ResourceType.TypeNone),
      rq(SerfType.TypePigFarmer, ResourceType.TypeNone, ResourceType.TypeNone),
      rq(SerfType.TypeMiller, ResourceType.TypeNone, ResourceType.TypeNone),
      rq(SerfType.TypeBaker, ResourceType.TypeNone, ResourceType.TypeNone),
      rq(SerfType.TypeSawmiller, ResourceType.TypeSaw, ResourceType.TypeNone),
      rq(SerfType.TypeSmelter, ResourceType.TypeNone, ResourceType.TypeNone),
      rq(SerfType.TypeToolmaker, ResourceType.TypeHammer, ResourceType.TypeSaw),
      rq(SerfType.TypeWeaponSmith, ResourceType.TypeHammer, ResourceType.TypePincer),
      rq(SerfType.TypeNone, ResourceType.TypeNone, ResourceType.TypeNone),
      rq(SerfType.TypeNone, ResourceType.TypeNone, ResourceType.TypeNone),
      rq(SerfType.TypeSmelter, ResourceType.TypeNone, ResourceType.TypeNone),
      rq(SerfType.TypeNone, ResourceType.TypeNone, ResourceType.TypeNone),
    ];

    if (!this.serfRequestFailed && !this.holder && !this.serfRequested) {
      if (requests[this.type].serfType !== SerfType.TypeNone) {
        this.serfRequestFailed = !this.sendSerfToBuilding(
          requests[this.type].serfType,
          requests[this.type].resType1,
          requests[this.type].resType2,
        );
      }
    }
  }

  /* Dispatch serf to building. */
  private sendSerfToBuilding(serfType: SerfType, res1: ResourceType, res2: ResourceType): boolean {
    const dest = this.game.getFlag(this.flag)!;
    return this.game.sendSerfToFlag(dest, serfType, res1, res2);
  }
}

export function buildingGetScoreFromType(type: BuildingType): number {
  const buildingScoreFromType = [
    2, 2, 2, 2, 5, 5, 5, 5, 2, 10,
    3, 6, 4, 6, 5, 4, 7, 7, 9, 4,
    8, 15, 6, 20,
  ];

  return buildingScoreFromType[type - 1];
}
