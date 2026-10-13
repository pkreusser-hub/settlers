/*
 * inventory.ts - Resources related implementations.
 * Port of Freeserf's inventory.h and inventory.cc.
 *
 * Copyright (C) 2015  Wicked_Digger <wicked_digger@mail.ru>
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

import { ExceptionFreeserf, i32, u32 } from './misc';
import { GameObject } from './objects';
import { ResourceType } from './resource';
import type { ResourceMap } from './resource';
import { SerfType } from './serf';
import type { Serf } from './serf';
import type { Flag } from './flag';
import type { Game } from './game';

// PORT: Serf::SerfMap (std::map<Serf::Type, unsigned int>). Declared here
// structurally so this module does not depend on how serf.ts spells it.
type SerfMap = Map<SerfType, number>;

export enum InventoryMode {
  ModeIn = 0, // 00
  ModeStop = 1, // 01
  ModeOut = 3, // 11
}

/* Resources waiting to be moved out */
export interface InventoryOutQueue {
  type: ResourceType;
  dest: number;
}

export class Inventory extends GameObject {
  static Mode = InventoryMode;

  // PORT: these fields are protected in the C++, with AI and IntegrityCheck
  // declared as friends. TS has no friends, so they are public.
  owner: number;
  /* Index of flag connected to this inventory */
  flag: number;
  /* Index of building containing this inventory */
  building: number;
  /* Count of resources */
  // PORT: std::map operator[] yields 0 for a missing key; res() does the same.
  resources: ResourceMap = new Map();
  /* Resources waiting to be moved out */
  outQueue: InventoryOutQueue[];
  /* Count of serfs waiting to move out */
  serfsOut: number;
  /* Count of generic serfs */
  genericCount: number;
  /* The modes of the resources and of the serfs (packed as "res_dir" in
     the saves: bits 0..1 and 2..3). */
  resourceMode: InventoryMode;
  serfMode: InventoryMode;
  /* Indices to serfs of each type */
  serfs: SerfMap = new Map();

  constructor(game: Game, index: number) {
    super(game, index);
    this.owner = 0;
    this.flag = 0;
    this.building = 0;
    this.outQueue = [
      { type: ResourceType.TypeNone, dest: 0 },
      { type: ResourceType.TypeNone, dest: 0 },
    ];
    this.serfsOut = 0;
    this.genericCount = 0;
    this.resourceMode = InventoryMode.ModeIn;
    this.serfMode = InventoryMode.ModeIn;
    for (let i = 0; i < 2; i++) {
      this.outQueue[i].type = ResourceType.TypeNone;
      this.outQueue[i].dest = 0;
    }
  }

  // PORT: this is the C++ destructor Inventory::~Inventory(). TS has no
  // destructors, so whoever erases an inventory from the game's collection
  // must call destroy() first.
  destroy(): void {
    for (let i = 0; i < 2 && this.outQueue[i].type !== ResourceType.TypeNone; i++) {
      const res = this.outQueue[i].type;
      const dest = this.outQueue[i].dest;

      this.game.cancelTransportedResource(res, dest);
      this.game.loseResource(res);
    }

    this.game.addGoldTotal(-i32(this.res(ResourceType.TypeGoldBar)));
    this.game.addGoldTotal(-i32(this.res(ResourceType.TypeGoldOre)));
  }

  // PORT: helpers standing in for std::map::operator[] on the two maps.
  private res(resource: ResourceType): number {
    return this.resources.get(resource) ?? 0;
  }

  private serfOf(type: SerfType): number {
    return this.serfs.get(type) ?? 0;
  }

  getOwner(): number {
    return this.owner;
  }
  setOwner(owner: number): void {
    this.owner = owner;
  }

  getFlagIndex(): number {
    return this.flag;
  }
  setFlagIndex(flagIndex: number): void {
    this.flag = flagIndex;
  }

  getBuildingIndex(): number {
    return this.building;
  }
  setBuildingIndex(buildingIndex: number): void {
    this.building = buildingIndex;
  }

  getResMode(): InventoryMode {
    return this.resourceMode;
  }
  setResMode(mode: InventoryMode): void {
    this.resourceMode = mode;
  }
  getSerfMode(): InventoryMode {
    return this.serfMode;
  }
  setSerfMode(mode: InventoryMode): void {
    this.serfMode = mode;
  }
  haveAnyOutMode(): boolean {
    return (this.resourceMode & 2) !== 0 || (this.serfMode & 2) !== 0;
  }

  getSerfQueueLength(): number {
    return this.serfsOut;
  }
  serfAway(): void {
    this.serfsOut = u32(this.serfsOut - 1);
  }

  // bool call_out_serf(Serf *serf) and Serf *call_out_serf(Serf::Type type)
  callOutSerf(serf: Serf): boolean;
  callOutSerf(type: SerfType): Serf | null;
  callOutSerf(arg: Serf | SerfType): boolean | Serf | null {
    if (typeof arg !== 'number') {
      const serf = arg;
      if (this.serfOf(serf.getType()) !== serf.getIndex()) {
        return false;
      }

      this.serfs.set(serf.getType(), 0);
      if (serf.getType() === SerfType.TypeGeneric) {
        this.genericCount--;
      }
      this.serfsOut = u32(this.serfsOut + 1);
      return true;
    }

    const type = arg;
    if (this.serfOf(type) === 0) {
      return null;
    }

    const serf: Serf = this.game.getSerf(this.serfOf(type))!;
    if (!this.callOutSerf(serf)) {
      return null;
    }

    return serf;
  }

  // bool call_internal(Serf *serf) and Serf *call_internal(Serf::Type type)
  callInternal(serf: Serf): boolean;
  callInternal(type: SerfType): Serf | null;
  callInternal(arg: Serf | SerfType): boolean | Serf | null {
    if (typeof arg !== 'number') {
      const serf = arg;
      if (this.serfOf(serf.getType()) !== serf.getIndex()) {
        return false;
      }

      this.serfs.set(serf.getType(), 0);

      return true;
    }

    const type = arg;
    if (this.serfOf(type) === 0) {
      return null;
    }

    const serf: Serf = this.game.getSerf(this.serfOf(type))!;
    this.serfs.set(type, 0);

    return serf;
  }

  serfComeBack(): void {
    this.genericCount++;
  }
  // PORT: returns size_t in the C++, so a negative generic_count reads as a
  // large positive number.
  freeSerfCount(): number {
    return u32(this.genericCount);
  }
  haveSerf(type: SerfType): boolean {
    return this.serfOf(type) !== 0;
  }

  getCountOf(resource: ResourceType): number {
    return this.res(resource);
  }
  // PORT: returns a copy, as the C++ does, with the keys in ascending order
  // (the iteration order of std::map).
  getAllResources(): ResourceMap {
    const keys = [...this.resources.keys()].sort((a, b) => a - b);
    const copy: ResourceMap = new Map();
    for (const key of keys) {
      copy.set(key, this.resources.get(key)!);
    }
    return copy;
  }
  setCountOf(resource: ResourceType, count: number): void {
    this.resources.set(resource, u32(count));
  }
  popResource(resource: ResourceType): void {
    this.resources.set(resource, u32(this.res(resource) - 1));
  }

  pushResource(resource: ResourceType): void {
    this.resources.set(resource, u32(this.res(resource) + (this.res(resource) < 50000 ? 1 : 0)));
  }

  hasResourceInQueue(): boolean {
    return this.outQueue[0].type !== ResourceType.TypeNone;
  }
  isQueueFull(): boolean {
    return this.outQueue[1].type !== ResourceType.TypeNone;
  }

  // PORT: the C++ signature is
  //   void get_resource_from_queue(Resource::Type *res, int *dest)
  // The two out parameters are returned as an object.
  getResourceFromQueue(): { res: ResourceType; dest: number } {
    const res = this.outQueue[0].type;
    const dest = i32(this.outQueue[0].dest);

    this.outQueue[0].type = this.outQueue[1].type;
    this.outQueue[0].dest = this.outQueue[1].dest;

    this.outQueue[1].type = ResourceType.TypeNone;
    this.outQueue[1].dest = 0;

    return { res, dest };
  }

  resetQueueForDest(flag_: Flag): void {
    if (this.outQueue[1].type !== ResourceType.TypeNone && this.outQueue[1].dest === flag_.getIndex()) {
      this.pushResource(this.outQueue[1].type);
      this.outQueue[1].type = ResourceType.TypeNone;
    }
    if (this.outQueue[0].type !== ResourceType.TypeNone && this.outQueue[0].dest === flag_.getIndex()) {
      this.pushResource(this.outQueue[0].type);
      this.outQueue[0].type = this.outQueue[1].type;
      this.outQueue[0].dest = this.outQueue[1].dest;
      this.outQueue[1].type = ResourceType.TypeNone;
    }
  }

  hasFood(): boolean {
    return (
      this.res(ResourceType.TypeFish) !== 0 ||
      this.res(ResourceType.TypeMeat) !== 0 ||
      this.res(ResourceType.TypeBread) !== 0
    );
  }

  /* Take resource from inventory and put in out queue.
   The resource must be present.*/
  addToQueue(type: ResourceType, dest: number): void {
    if (type === ResourceType.GroupFood) {
      /* Select the food resource with highest amount available */
      if (this.res(ResourceType.TypeMeat) > this.res(ResourceType.TypeBread)) {
        if (this.res(ResourceType.TypeMeat) > this.res(ResourceType.TypeFish)) {
          type = ResourceType.TypeMeat;
        } else {
          type = ResourceType.TypeFish;
        }
      } else if (this.res(ResourceType.TypeBread) > this.res(ResourceType.TypeFish)) {
        type = ResourceType.TypeBread;
      } else {
        type = ResourceType.TypeFish;
      }
    }

    if (this.res(type) === 0) {
      throw new ExceptionFreeserf('No resource with type.');
    }

    this.resources.set(type, u32(this.res(type) - 1));
    if (this.outQueue[0].type === ResourceType.TypeNone) {
      this.outQueue[0].type = type;
      this.outQueue[0].dest = dest;
    } else {
      this.outQueue[1].type = type;
      this.outQueue[1].dest = dest;
    }
  }

  /* Create initial resources */
  applySuppliesPreset(supplies: number): void {
    const suppliesTemplate: number[][] = [
      [0, 0, 0, 0, 0, 0, 0, 7, 0, 2, 0, 0, 0, 0, 0, 1,
        6, 1, 0, 0, 1, 2, 3, 0, 10, 10],
      [2, 1, 1, 3, 2, 1, 0, 25, 1, 8, 4, 3, 8, 2, 1, 3,
        12, 2, 1, 1, 2, 3, 4, 1, 30, 30],
      [3, 2, 2, 10, 3, 1, 0, 40, 2, 20, 12, 8, 20, 4, 2, 5,
        20, 3, 1, 2, 3, 4, 6, 2, 60, 60],
      [8, 4, 6, 20, 7, 5, 3, 80, 5, 40, 20, 40, 50, 8, 4, 10,
        30, 5, 2, 4, 6, 6, 12, 4, 100, 100],
      [30, 10, 30, 50, 10, 30, 10, 200, 10, 100, 30, 150, 100, 10, 5, 20,
        50, 10, 5, 10, 20, 20, 50, 10, 200, 200],
    ];

    let template1: number[];
    let template2: number[];
    if (supplies < 10) {
      template1 = suppliesTemplate[0];
      template2 = suppliesTemplate[1];
    } else if (supplies < 20) {
      template1 = suppliesTemplate[1];
      template2 = suppliesTemplate[2];
      supplies -= 10;
    } else if (supplies < 30) {
      template1 = suppliesTemplate[2];
      template2 = suppliesTemplate[3];
      supplies -= 20;
    } else if (supplies < 40) {
      template1 = suppliesTemplate[3];
      template2 = suppliesTemplate[4];
      supplies -= 30;
    } else {
      template1 = suppliesTemplate[4];
      template2 = suppliesTemplate[4];
      supplies -= 40;
    }

    for (let i = 0; i < 26; i++) {
      let t1 = template1[i];
      const n = u32(Math.imul(template2[i] - template1[i], Math.imul(supplies, 6554)));
      if (n >= 0x8000) t1 += 1;
      this.resources.set(i as ResourceType, u32(t1 + (n >>> 16)));
    }
  }

  callTransporter(water: boolean): Serf | null {
    let serf: Serf | null = null;

    if (water) {
      if (this.serfOf(SerfType.TypeSailor) !== 0) {
        serf = this.game.getSerf(this.serfOf(SerfType.TypeSailor));
        this.serfs.set(SerfType.TypeSailor, 0);
      } else {
        if (this.serfOf(SerfType.TypeGeneric) !== 0 && this.res(ResourceType.TypeBoat) > 0) {
          serf = this.game.getSerf(this.serfOf(SerfType.TypeGeneric));
          this.serfs.set(SerfType.TypeGeneric, 0);
          this.resources.set(ResourceType.TypeBoat, u32(this.res(ResourceType.TypeBoat) - 1));
          serf!.setType(SerfType.TypeSailor);
          this.genericCount -= 1;
        } else {
          return null;
        }
      }
    } else {
      if (this.serfOf(SerfType.TypeTransporter) !== 0) {
        serf = this.game.getSerf(this.serfOf(SerfType.TypeTransporter));
        this.serfs.set(SerfType.TypeTransporter, 0);
      } else {
        if (this.serfOf(SerfType.TypeGeneric) !== 0) {
          serf = this.game.getSerf(this.serfOf(SerfType.TypeGeneric));
          this.serfs.set(SerfType.TypeGeneric, 0);
          serf!.setType(SerfType.TypeTransporter);
          this.genericCount -= 1;
        } else {
          return null;
        }
      }
    }

    this.serfsOut = u32(this.serfsOut + 1);

    return serf;
  }

  promoteSerfToKnight(serf: Serf): boolean {
    if (serf.getType() !== SerfType.TypeGeneric) {
      return false;
    }

    if (this.res(ResourceType.TypeSword) === 0 || this.res(ResourceType.TypeShield) === 0) {
      return false;
    }

    this.popResource(ResourceType.TypeSword);
    this.popResource(ResourceType.TypeShield);
    this.genericCount--;
    this.serfs.set(SerfType.TypeGeneric, 0);

    serf.setType(SerfType.TypeKnight0);

    return true;
  }

  spawnSerfGeneric(): Serf | null {
    const serf: Serf | null = this.game.getPlayer(this.owner)!.spawnSerfGeneric();

    if (serf != null) {
      serf.initGeneric(this);

      this.genericCount++;
      if (this.serfOf(SerfType.TypeGeneric) === 0) {
        this.serfs.set(SerfType.TypeGeneric, serf.getIndex());
      }
    }

    return serf;
  }

  specializeSerf(serf: Serf, type: SerfType): boolean {
    if (serf.getType() !== SerfType.TypeGeneric) {
      return false;
    }

    /* Don't make another specialist while one is waiting in the stock.
       Knights are the exception: new knights must be made even when some are
       in the stock (the slot only refers to one idle serf of the type). */
    if (this.serfOf(type) !== 0 && (type < SerfType.TypeKnight0 || type > SerfType.TypeKnight4)) {
      return false;
    }

    if (resNeeded[type * 2] !== ResourceType.TypeNone && this.res(resNeeded[type * 2]) === 0) {
      return false;
    }
    if (resNeeded[type * 2 + 1] !== ResourceType.TypeNone && this.res(resNeeded[type * 2 + 1]) === 0) {
      return false;
    }

    if (this.serfOf(SerfType.TypeGeneric) === serf.getIndex()) {
      this.serfs.set(SerfType.TypeGeneric, 0);
    }
    this.genericCount--;

    if (resNeeded[type * 2] !== ResourceType.TypeNone) {
      this.resources.set(resNeeded[type * 2], u32(this.res(resNeeded[type * 2]) - 1));
    }
    if (resNeeded[type * 2 + 1] !== ResourceType.TypeNone) {
      this.resources.set(resNeeded[type * 2 + 1], u32(this.res(resNeeded[type * 2 + 1]) - 1));
    }

    serf.setType(type);

    this.serfs.set(type, serf.getIndex());

    return true;
  }

  specializeFreeSerf(type: SerfType): Serf | null {
    if (this.serfOf(SerfType.TypeGeneric) === 0) {
      return null;
    }

    const serf: Serf = this.game.getSerf(this.serfOf(SerfType.TypeGeneric))!;

    if (!this.specializeSerf(serf, type)) {
      return null;
    }

    return serf;
  }

  serfPotentialCount(type: SerfType): number {
    let count = u32(this.genericCount);

    if (resNeeded[type * 2] !== ResourceType.TypeNone) {
      count = Math.min(count, this.res(resNeeded[type * 2]));
    }
    if (resNeeded[type * 2 + 1] !== ResourceType.TypeNone) {
      count = Math.min(count, this.res(resNeeded[type * 2 + 1]));
    }

    return count;
  }

  serfIdleInStock(serf: Serf): void {
    this.serfs.set(serf.getType(), serf.getIndex());
  }

  knightTraining(serf: Serf, p: number): void {
    const oldType: SerfType = serf.getType();
    const r: number = serf.trainKnight(p);
    if (r === 0) this.serfs.set(oldType, 0);

    this.serfIdleInStock(serf);
  }

  // TODO(savegame)
}

export const resNeeded: ResourceType[] = [
  ResourceType.TypeNone, ResourceType.TypeNone, // SERF_TRANSPORTER = 0,
  ResourceType.TypeBoat, ResourceType.TypeNone, // SERF_SAILOR,
  ResourceType.TypeShovel, ResourceType.TypeNone, // SERF_DIGGER,
  ResourceType.TypeHammer, ResourceType.TypeNone, // SERF_BUILDER,
  ResourceType.TypeNone, ResourceType.TypeNone, // SERF_TRANSPORTER_INVENTORY,
  ResourceType.TypeAxe, ResourceType.TypeNone, // SERF_LUMBERJACK,
  ResourceType.TypeSaw, ResourceType.TypeNone, // TypeSawmiller,
  ResourceType.TypePick, ResourceType.TypeNone, // TypeStonecutter,
  ResourceType.TypeNone, ResourceType.TypeNone, // TypeForester,
  ResourceType.TypePick, ResourceType.TypeNone, // TypeMiner,
  ResourceType.TypeNone, ResourceType.TypeNone, // TypeSmelter,
  ResourceType.TypeRod, ResourceType.TypeNone, // TypeFisher,
  ResourceType.TypeNone, ResourceType.TypeNone, // TypePigFarmer,
  ResourceType.TypeCleaver, ResourceType.TypeNone, // TypeButcher,
  ResourceType.TypeScythe, ResourceType.TypeNone, // TypeFarmer,
  ResourceType.TypeNone, ResourceType.TypeNone, // TypeMiller,
  ResourceType.TypeNone, ResourceType.TypeNone, // TypeBaker,
  ResourceType.TypeHammer, ResourceType.TypeNone, // TypeBoatBuilder,
  ResourceType.TypeHammer, ResourceType.TypeSaw, // TypeToolmaker,
  ResourceType.TypeHammer, ResourceType.TypePincer, // TypeWeaponSmith,
  ResourceType.TypeHammer, ResourceType.TypeNone, // TypeGeologist,
  ResourceType.TypeNone, ResourceType.TypeNone, // TypeGeneric,
  ResourceType.TypeSword, ResourceType.TypeShield, // TypeKnight0,
  ResourceType.TypeNone, ResourceType.TypeNone, // TypeKnight1,
  ResourceType.TypeNone, ResourceType.TypeNone, // TypeKnight2,
  ResourceType.TypeNone, ResourceType.TypeNone, // TypeKnight3,
  ResourceType.TypeNone, ResourceType.TypeNone, // TypeKnight4,
  ResourceType.TypeNone, ResourceType.TypeNone, // TypeDead
];
