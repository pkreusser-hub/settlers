/*
 * flag.ts - Flag related functions.
 *
 * Port of Freeserf's flag.h and flag.cc.
 *
 * Copyright (C) 2013-2018  Jon Lund Steffensen <jonlst@gmail.com>
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

import { BIT, BIT_TEST, ExceptionFreeserf, Log, i32, u32 } from './misc';
import { GameObject } from './objects';
import { ResourceType } from './resource';
import {
  Direction,
  cycleDirectionsCcw,
  cycleDirectionsCw,
  reverseDirection,
} from './map-geometry';
import type { MapPos } from './map-geometry';
import { SerfState, SerfType } from './serf';
import type { Serf } from './serf';
import type { Building } from './building';
import type { Game } from './game';
import type { Player } from './player';
import type { Inventory } from './inventory';
import type { SaveReaderText, SaveWriterText } from './savegame';

// PORT: a struct in the C++ (declared uninitialised on the stack there);
// a class here so `new SerfPathInfo()` gives the 16 element serfs array.
export class SerfPathInfo {
  pathLen = 0;
  serfCount = 0;
  flagIndex = 0;
  flagDir: Direction = Direction.DirectionRight;
  serfs: number[] = new Array<number>(16).fill(0);
}

/* Max number of resources waiting at a flag */
export const FLAG_MAX_RES_COUNT = 8;

const SEARCH_MAX_DEPTH = 0x10000;

export class ResourceSlot {
  type: ResourceType = ResourceType.TypeNone;
  dir: Direction = Direction.DirectionNone;
  dest = 0; // unsigned int
}

// PORT: `void *data` of the C++ callbacks becomes a typed parameter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FlagSearchFunc<T = any> = (flag: Flag, data: T) => boolean;

// UNION ALIAS: union other_endpoint { Building *b[6]; Flag *f[6];
// void *v[6]; }. The three members are the same six pointers, so b, f and
// v all refer to one array. Code that reads f[] for a direction holding a
// building (or v[] for either) sees the same reference, as in the C++.
export interface FlagOtherEndpoint {
  b: (Building | null)[];
  f: (Flag | null)[];
  v: unknown[];
}

export class Flag extends GameObject {
  // PORT: these are `protected` in the C++, with AI, IntegrityCheck and
  // FlagSearch as friends. TS has no friends, so they are public.
  owner: number; // unsigned int
  pos: MapPos; /* ADDITION */
  pathCon: number; /* Directions with paths. */
  landPathSet: number; /* Directions with land paths. */
  buildingConnected: boolean; /* A building at the up left. */
  resourcesWaiting: boolean; /* Resources not yet scheduled. */
  slot: ResourceSlot[];

  searchNum: number;
  searchDir: Direction;
  transporterSet: number; /* Directions with transporters. */
  serfRequestFailed: boolean; /* A transporter was requested in vain. */
  /* Of each path. */
  freeTransporters: number[]; // unsigned int [6]
  pathLengthCategory: number[]; // unsigned int [6]
  transporterRequested: boolean[];
  otherEndpoint: FlagOtherEndpoint;
  pickupSlot: number[]; /* The slot scheduled for pickup. */
  otherEndDirection: Direction[];
  pickupScheduled: boolean[];

  /* Of the inventory of the building. */
  inventoryBuilding: boolean;
  serfsAccepted: boolean;
  resourcesAccepted: boolean;

  constructor(game: Game, index: number) {
    super(game, index);
    this.owner = u32(-1);
    this.pos = 0;
    this.pathCon = 0;
    this.landPathSet = 0;
    this.buildingConnected = false;
    this.resourcesWaiting = false;
    this.slot = [];
    this.searchNum = 0;
    this.searchDir = Direction.DirectionRight;
    this.transporterSet = 0;
    this.serfRequestFailed = false;
    this.freeTransporters = [0, 0, 0, 0, 0, 0];
    this.pathLengthCategory = [0, 0, 0, 0, 0, 0];
    this.transporterRequested = [false, false, false, false, false, false];
    const endpoints: unknown[] = [null, null, null, null, null, null];
    this.otherEndpoint = {
      b: endpoints as (Building | null)[],
      f: endpoints as (Flag | null)[],
      v: endpoints,
    };
    this.pickupSlot = [0, 0, 0, 0, 0, 0];
    // other_end_direction{} zero-initialises, and zero is DirectionRight.
    this.otherEndDirection = [
      Direction.DirectionRight,
      Direction.DirectionRight,
      Direction.DirectionRight,
      Direction.DirectionRight,
      Direction.DirectionRight,
      Direction.DirectionRight,
    ];
    this.pickupScheduled = [false, false, false, false, false, false];
    this.inventoryBuilding = false;
    this.serfsAccepted = false;
    this.resourcesAccepted = false;
    for (let j = 0; j < FLAG_MAX_RES_COUNT; j++) {
      const s = new ResourceSlot();
      s.type = ResourceType.TypeNone;
      s.dest = 0;
      s.dir = Direction.DirectionNone;
      this.slot.push(s);
    }
  }

  getPosition(): MapPos {
    return this.pos;
  }
  setPosition(pos: MapPos): void {
    this.pos = pos;
  }

  /* Bitmap of all directions with outgoing paths. */
  paths(): number {
    return this.pathCon & 0x3f;
  }

  addPath(dir: Direction, water: boolean): void {
    this.pathCon |= BIT(dir);
    if (water) {
      this.landPathSet &= ~BIT(dir);
    } else {
      this.landPathSet |= BIT(dir);
    }
    this.transporterSet &= ~BIT(dir);
  }

  delPath(dir: Direction): void {
    this.pathCon &= ~BIT(dir);
    this.landPathSet &= ~BIT(dir);
    this.transporterSet &= ~BIT(dir);

    if (this.serfRequested(dir)) {
      this.cancelSerfRequest(dir);
      const dest: number = this.game.getMap().getObjIndex(this.pos);
      for (const serf of this.game.getSerfsRelatedTo(dest, dir)) {
        serf.pathDeleted(dest, dir);
      }
    }

    this.pickupSlot[dir] = 0;
    this.pickupScheduled[dir] = false;
    this.otherEndpoint.f[dir] = null;

    /* Mark resource path for recalculation if they would
     have followed the removed path. */
    this.invalidateResourcePath(dir);
  }

  /* Whether a path exists in a given direction. */
  hasPath(dir: Direction): boolean {
    return (this.pathCon & (1 << dir)) !== 0;
  }

  prioritizePickup(dir: Direction, player: Player): void {
    let resNext = -1;
    let resPrio = -1;

    for (let i = 0; i < FLAG_MAX_RES_COUNT; i++) {
      if (this.slot[i].type !== ResourceType.TypeNone) {
        /* Use flag_prio to prioritize resource pickup. */
        const resDir = this.slot[i].dir;
        const resType = this.slot[i].type;
        if (resDir === dir && player.getFlagPrio(resType) > resPrio) {
          resNext = i;
          resPrio = player.getFlagPrio(resType);
        }
      }
    }

    this.pickupSlot[dir] = 0;
    this.pickupScheduled[dir] = false;
    if (resNext > -1) {
      this.pickupScheduled[dir] = true;
      this.pickupSlot[dir] = resNext;
    }
  }

  /* Owner of this flag. */
  getOwner(): number {
    return this.owner;
  }
  setOwner(owner: number): void {
    this.owner = u32(owner);
  }

  /* Bitmap showing whether the outgoing paths are land paths. */
  landPaths(): number {
    return this.landPathSet;
  }
  /* Whether the path in the given direction is a water path. */
  isWaterPath(dir: Direction): boolean {
    return !(this.landPathSet & (1 << dir));
  }
  /* Whether a building is connected to this flag. If so, the pointer to
   the other endpoint is a valid building pointer.
   (Always at UP LEFT direction). */
  hasBuilding(): boolean {
    return this.buildingConnected;
  }

  /* Whether resources exist that are not yet scheduled. */
  hasResources(): boolean {
    return this.resourcesWaiting;
  }

  /* Bitmap showing whether the outgoing paths have transporters
   servicing them. */
  transporters(): number {
    return this.transporterSet;
  }
  /* Whether the path in the given direction has a transporter
   serving it. */
  hasTransporter(dir: Direction): boolean {
    return (this.transporterSet & (1 << dir)) !== 0;
  }
  /* Whether this flag has tried to request a transporter without success. */
  serfRequestFail(): boolean {
    return this.serfRequestFailed;
  }
  serfRequestClear(): void {
    this.serfRequestFailed = false;
  }

  /* Current number of transporters on path. */
  freeTransporterCount(dir: Direction): number {
    return this.freeTransporters[dir];
  }
  transporterToServe(dir: Direction): void {
    this.freeTransporters[dir] = u32(this.freeTransporters[dir] - 1);
  }
  /* Length category of path determining max number of transporters. */
  lengthCategory(dir: Direction): number {
    return this.pathLengthCategory[dir];
  }
  /* Whether a transporter serf was successfully requested for this path. */
  serfRequested(dir: Direction): boolean {
    return this.transporterRequested[dir];
  }
  cancelSerfRequest(dir: Direction): void {
    this.transporterRequested[dir] = false;
  }
  completeSerfRequest(dir: Direction): void {
    this.transporterRequested[dir] = false;
    this.freeTransporters[dir] = u32(this.freeTransporters[dir] + 1);
  }

  /* The slot that is scheduled for pickup by the given path. */
  scheduledSlot(dir: Direction): number {
    return this.pickupSlot[dir];
  }
  /* The direction from the other endpoint leading back to this flag. */
  getOtherEndDir(dir: Direction): Direction {
    return this.otherEndDirection[dir];
  }
  getOtherEndFlag(dir: Direction): Flag | null {
    return this.otherEndpoint.f[dir];
  }
  /* Whether the given direction has a resource pickup scheduled. */
  isScheduled(dir: Direction): boolean {
    return this.pickupScheduled[dir];
  }

  // PORT: the C++ takes `Resource::Type *res, unsigned int *dest`
  // out-pointers. Here the caller passes an object with `res` and `dest`
  // fields that is written in place (the serf passes `this.s.transporting`,
  // whose fields the C++ pointed at).
  pickUpResource(fromSlot: number, out: { res: ResourceType; dest: number }): boolean {
    if (fromSlot >= FLAG_MAX_RES_COUNT) {
      throw new ExceptionFreeserf('Wrong flag slot index.');
    }

    if (this.slot[fromSlot].type === ResourceType.TypeNone) {
      return false;
    }

    out.res = this.slot[fromSlot].type;
    out.dest = this.slot[fromSlot].dest;
    this.slot[fromSlot].type = ResourceType.TypeNone;
    this.slot[fromSlot].dir = Direction.DirectionNone;

    this.fixScheduled();

    return true;
  }

  dropResource(res: ResourceType, dest: number): boolean {
    if (res < ResourceType.TypeNone || res > ResourceType.GroupFood) {
      throw new ExceptionFreeserf('Wrong resource type.');
    }

    for (let i = 0; i < FLAG_MAX_RES_COUNT; i++) {
      if (this.slot[i].type === ResourceType.TypeNone) {
        this.slot[i].type = res;
        this.slot[i].dest = dest;
        this.slot[i].dir = Direction.DirectionNone;
        this.resourcesWaiting = true;
        return true;
      }
    }

    return false;
  }

  /* Switch the resource of a transporter with the one in slot, in place
     (Amiga transporter_move_to_flag). An empty slot takes the transporter's
     resource and leaves it empty-handed. */
  // PORT: in/out pointers become an object with `res` and `dest` fields,
  // as in pickUpResource.
  switchResource(fromSlot: number, inout: { res: ResourceType; dest: number }): void {
    if (fromSlot >= FLAG_MAX_RES_COUNT) {
      throw new ExceptionFreeserf('Wrong flag slot index.');
    }

    this.resourcesWaiting = true;

    const tempRes = inout.res;
    const tempDest = inout.dest;
    inout.res = this.slot[fromSlot].type;
    inout.dest = this.slot[fromSlot].dest;
    this.slot[fromSlot].type = tempRes;
    this.slot[fromSlot].dest = tempDest;
    this.slot[fromSlot].dir = Direction.DirectionNone;
  }

  hasEmptySlot(): boolean {
    let scheduledSlots = 0;
    for (let i = 0; i < FLAG_MAX_RES_COUNT; i++) {
      if (this.slot[i].type !== ResourceType.TypeNone) {
        scheduledSlots++;
      }
    }

    return scheduledSlots !== FLAG_MAX_RES_COUNT;
  }

  removeAllResources(): void {
    for (let i = 0; i < FLAG_MAX_RES_COUNT; i++) {
      if (this.slot[i].type !== ResourceType.TypeNone) {
        const res: number = this.slot[i].type;
        const dest = this.slot[i].dest;
        this.game.cancelTransportedResource(res as ResourceType, dest);
        this.game.loseResource(res as ResourceType);
      }
    }
  }

  getResourceAtSlot(slot: number): ResourceType {
    return this.slot[slot].type;
  }

  /* Whether this flag has an inventory building. */
  hasInventory(): boolean {
    return this.inventoryBuilding;
  }
  /* Whether this inventory accepts resources. */
  acceptsResources(): boolean {
    return this.resourcesAccepted;
  }
  /* Whether this inventory accepts serfs. */
  acceptsSerfs(): boolean {
    return this.serfsAccepted;
  }

  setHasInventory(): void {
    this.inventoryBuilding = true;
  }
  setAcceptsResources(accepts: boolean): void {
    this.resourcesAccepted = accepts;
  }
  setAcceptsSerfs(accepts: boolean): void {
    this.serfsAccepted = accepts;
  }
  clearFlags(): void {
    this.inventoryBuilding = false;
    this.serfsAccepted = false;
    this.resourcesAccepted = false;
  }

  // PORT: operator>> (SaveReaderBinary) is not ported (the binary reader
  // SaveReaderBinary is not ported).

  // PORT: operator>> (SaveReaderText &reader, Flag &flag).
  loadText(reader: SaveReaderText): void {
    let x = 0;
    let y = 0;
    x = reader.value('pos').at(0).readUint();
    y = reader.value('pos').at(1).readUint();
    this.pos = this.game.getMap().pos(x, y);
    this.searchNum = reader.value('search_num').readInt();
    this.searchDir = reader.value('search_dir').readInt();
    let val: number;
    val = reader.value('path_con').readUint();
    if (reader.hasValue('owner')) {
      this.pathCon = i32(val);
      this.owner = reader.value('owner').readUint();
    } else {
      this.pathCon = val & 0x3f;
      this.owner = (val >>> 6) & 3;
    }
    let bits = 0;
    bits = reader.value('endpoints').readInt();
    this.setEndpointBits(bits);
    bits = reader.value('transporter').readInt();
    this.setTransporterBits(bits);

    for (const i of cycleDirectionsCw()) {
      let len: number;
      len = reader.value('length').at(i).readInt();
      this.setLengthBits(i, len);
      let objIndex: number;
      objIndex = reader.value('other_endpoint').at(i).readUint();
      if (this.hasBuilding() && i === Direction.DirectionUpLeft) {
        this.otherEndpoint.b[Direction.DirectionUpLeft] =
          this.game.createBuilding(objIndex);
      } else {
        let otherFlag: Flag | null = null;
        if (objIndex !== 0) {
          otherFlag = this.game.createFlag(objIndex);
        }
        this.otherEndpoint.f[i] = otherFlag;
      }
      bits = reader.value('other_end_dir').at(i).readInt();
      this.setOtherEndBits(i, bits);
    }

    for (let i = 0; i < FLAG_MAX_RES_COUNT; i++) {
      this.slot[i].type = reader.value('slot.type').at(i).readInt();
      this.slot[i].dir = reader.value('slot.dir').at(i).readInt();
      this.slot[i].dest = reader.value('slot.dest').at(i).readUint();
    }

    bits = reader.value('bld_flags').readInt();
    this.inventoryBuilding = BIT_TEST(bits, 6) !== 0;
    this.serfsAccepted = BIT_TEST(bits, 7) !== 0;
    bits = reader.value('bld2_flags').readInt();
    this.resourcesAccepted = BIT_TEST(bits, 7) !== 0;
  }

  // PORT: operator<< (SaveWriterText &writer, Flag &flag).
  saveText(writer: SaveWriterText): void {
    writer.value('pos').writeUint(this.game.getMap().posCol(this.pos));
    writer.value('pos').writeUint(this.game.getMap().posRow(this.pos));
    writer.value('search_num').write(this.searchNum);
    writer.value('search_dir').write(this.searchDir);
    writer.value('path_con').write(this.pathCon);
    writer.value('owner').writeUint(this.owner);
    writer.value('endpoints').write(this.getEndpointBits());
    writer.value('transporter').write(this.getTransporterBits());

    for (const d of cycleDirectionsCw()) {
      writer.value('length').write(this.getLengthBits(d));
      if (d === Direction.DirectionUpLeft && this.hasBuilding()) {
        writer
          .value('other_endpoint')
          .writeUint(this.otherEndpoint.b[Direction.DirectionUpLeft]!.getIndex());
      } else {
        if (this.hasPath(d)) {
          writer.value('other_endpoint').writeUint(this.otherEndpoint.f[d]!.getIndex());
        } else {
          writer.value('other_endpoint').write(0);
        }
      }
      writer.value('other_end_dir').write(this.getOtherEndBits(d));
    }

    for (let i = 0; i < FLAG_MAX_RES_COUNT; i++) {
      writer.value('slot.type').write(this.slot[i].type);
      writer.value('slot.dir').write(this.slot[i].dir);
      writer.value('slot.dest').writeUint(this.slot[i].dest);
    }

    writer
      .value('bld_flags')
      .write((this.inventoryBuilding ? BIT(6) : 0) | (this.serfsAccepted ? BIT(7) : 0));
    writer.value('bld2_flags').write(this.resourcesAccepted ? BIT(7) : 0);
  }

  // PORT: named schedule_known_dest_cb_ in the C++ (trailing underscore).
  scheduleKnownDestCb_(src: Flag, dest: Flag | null, slot: number): boolean {
    if (this === dest) {
      /* Destination found */
      if ((this.searchDir as number) !== 6) {
        if (!src.isScheduled(this.searchDir)) {
          /* Item is requesting to be fetched */
          src.pickupScheduled[this.searchDir] = true;
          src.pickupSlot[this.searchDir] = slot;
        } else {
          const player = this.game.getPlayer(this.getOwner())!;
          const prioOld = player.getFlagPrio(
            src.slot[src.pickupSlot[this.searchDir]].type,
          );
          const prioNew = player.getFlagPrio(src.slot[slot].type);
          if (prioNew > prioOld) {
            /* This item has the highest priority now */
            src.pickupSlot[this.searchDir] = slot;
          }
          src.slot[slot].dir = this.searchDir;
        }
      }
      return true;
    }

    return false;
  }

  resetTransport(other: Flag): void {
    for (let slot = 0; slot < FLAG_MAX_RES_COUNT; slot++) {
      if (
        other.slot[slot].type !== ResourceType.TypeNone &&
        other.slot[slot].dest === this.index
      ) {
        other.slot[slot].dest = 0;
        other.resourcesWaiting = true;

        if (other.slot[slot].dir !== Direction.DirectionNone) {
          const dir = other.slot[slot].dir;
          const player = this.game.getPlayer(other.getOwner())!;
          other.prioritizePickup(dir, player);
        }
      }
    }
  }

  resetDestinationOfStolenResources(): void {
    for (let i = 0; i < FLAG_MAX_RES_COUNT; i++) {
      if (this.slot[i].type !== ResourceType.TypeNone) {
        const res = this.slot[i].type;
        this.game.cancelTransportedResource(res, this.slot[i].dest);
        this.slot[i].dest = 0;
      }
    }
  }

  linkBuilding(building: Building): void {
    this.otherEndpoint.b[Direction.DirectionUpLeft] = building;
    this.buildingConnected = true;
  }

  unlinkBuilding(): void {
    this.otherEndpoint.b[Direction.DirectionUpLeft] = null;
    this.buildingConnected = false;
    this.clearFlags();
  }

  getBuilding(): Building | null {
    return this.otherEndpoint.b[Direction.DirectionUpLeft];
  }

  invalidateResourcePath(dir: Direction): void {
    for (let i = 0; i < FLAG_MAX_RES_COUNT; i++) {
      if (this.slot[i].type !== ResourceType.TypeNone && this.slot[i].dir === dir) {
        this.slot[i].dir = Direction.DirectionNone;
        this.resourcesWaiting = true;
      }
    }
  }

  /* Return the flag index of the inventory nearest to flag. */
  findNearestInventoryForResource(): number {
    // PORT: `Flag *dest` passed by address becomes a one-field box.
    const dest: { flag: Flag | null } = { flag: null };
    FlagSearch.single(this, findNearestInventorySearchCb, false, true, dest);
    if (dest.flag != null) return dest.flag.getIndex();

    return -1;
  }

  findNearestInventoryForSerf(): number {
    // PORT: `int dest_index` passed by address becomes a one-field box.
    const destIndex = { value: -1 };
    FlagSearch.single(this, flagSearchInventorySearchCb, true, false, destIndex);

    return destIndex.value;
  }

  linkWithFlag(
    destFlag: Flag,
    waterPath: boolean,
    length: number,
    inDir: Direction,
    outDir: Direction,
  ): void {
    destFlag.addPath(inDir, waterPath);
    this.addPath(outDir, waterPath);

    destFlag.otherEndDirection[inDir] = outDir;
    this.otherEndDirection[outDir] = inDir;

    const len = Flag.getRoadLengthValue(length);

    destFlag.setLengthBits(inDir, len << 4);
    this.setLengthBits(outDir, len << 4);

    destFlag.otherEndpoint.f[inDir] = this;
    this.otherEndpoint.f[outDir] = destFlag;
  }

  update(): void {
    const maxTransporters = [1, 2, 3, 4, 6, 8, 11, 15];

    /* Count and store in bitfield which directions
     have strictly more than 0,1,2,3 slots waiting. */
    const resWaiting = [0, 0, 0, 0];
    for (let j = 0; j < FLAG_MAX_RES_COUNT; j++) {
      if (
        this.slot[j].type !== ResourceType.TypeNone &&
        this.slot[j].dir !== Direction.DirectionNone
      ) {
        const resDir = this.slot[j].dir;
        for (let k = 0; k < 4; k++) {
          if (!BIT_TEST(resWaiting[k], resDir)) {
            resWaiting[k] |= BIT(resDir);
            break;
          }
        }
      }
    }

    /* Count of total resources waiting at flag */
    let waitingCount = 0;

    if (this.hasResources()) {
      this.resourcesWaiting = false;
      for (let slot = 0; slot < FLAG_MAX_RES_COUNT; slot++) {
        if (this.slot[slot].type !== ResourceType.TypeNone) {
          waitingCount += 1;

          /* Only schedule the slot if it has not already
           been scheduled for fetch. */
          const resDir: number = this.slot[slot].dir;
          if (resDir < 0) {
            if (this.slot[slot].dest !== 0) {
              /* Destination is known */
              this.scheduleSlotToKnownDest(slot, resWaiting);
            } else {
              /* Destination is not known */
              this.scheduleSlotToUnknownDest(slot);
            }
          }
        }
      }
    }

    /* Update transporter flags, decide if serf needs to be sent to road */
    for (const j of cycleDirectionsCcw()) {
      if (this.hasPath(j)) {
        if (this.serfRequested(j)) {
          if (BIT_TEST(resWaiting[2], j)) {
            if (waitingCount >= 7) {
              this.transporterSet &= ~BIT(j);
            }
          } else if (this.freeTransporterCount(j) !== 0) {
            this.transporterSet |= BIT(j);
          }
        } else if (this.freeTransporterCount(j) === 0 || BIT_TEST(resWaiting[2], j)) {
          const maxTr = maxTransporters[this.lengthCategory(j)];
          if (this.freeTransporterCount(j) < u32(maxTr) && !this.serfRequestFail()) {
            const r = this.callTransporter(j, this.isWaterPath(j));
            if (!r) this.serfRequestFailed = true;
          }
          if (waitingCount >= 7) {
            this.transporterSet &= ~BIT(j);
          }
        } else {
          this.transporterSet |= BIT(j);
        }
      }
    }
  }

  /* Get road length category value for real length.
   Determines number of serfs servicing the path segment.(?) */
  static getRoadLengthValue(length: number): number {
    if (length >= 24) return 7;
    else if (length >= 18) return 6;
    else if (length >= 13) return 5;
    else if (length >= 10) return 4;
    else if (length >= 7) return 3;
    else if (length >= 6) return 2;
    else if (length >= 4) return 1;
    return 0;
  }

  restorePathSerfInfo(dir: Direction, data: SerfPathInfo): void {
    const maxPathSerfs = [1, 2, 3, 4, 6, 8, 11, 15];

    const otherFlag = this.game.getFlag(data.flagIndex)!;
    const otherDir = data.flagDir;

    this.addPath(dir, otherFlag.isWaterPath(otherDir));

    otherFlag.transporterSet &= ~BIT(otherDir);

    const len = Flag.getRoadLengthValue(data.pathLen);

    /* The number of free transporters starts again, the request of the
       other end stays. */
    this.setLengthBits(dir, len << 4);
    otherFlag.freeTransporters[otherDir] = 0;
    otherFlag.pathLengthCategory[otherDir] = len;

    if (otherFlag.serfRequested(otherDir)) {
      this.transporterRequested[dir] = true;
    }

    this.otherEndDirection[dir] = otherDir;
    otherFlag.otherEndDirection[otherDir] = dir;

    this.otherEndpoint.f[dir] = otherFlag;
    otherFlag.otherEndpoint.f[otherDir] = this;

    let maxSerfs = maxPathSerfs[len];
    if (this.serfRequested(dir)) maxSerfs -= 1;

    if (data.serfCount > maxSerfs) {
      for (let i = 0; i < data.serfCount - maxSerfs; i++) {
        const serf = this.game.getSerf(data.serfs[i])!;
        serf.restorePathSerfInfo();
      }
    }

    if (Math.min(data.serfCount, maxSerfs) > 0) {
      /* There are still transporters on the paths. */
      this.transporterSet |= BIT(dir);
      otherFlag.transporterSet |= BIT(otherDir);

      this.freeTransporters[dir] = u32(
        this.freeTransporters[dir] | Math.min(data.serfCount, maxSerfs),
      );
      otherFlag.freeTransporters[otherDir] = u32(
        otherFlag.freeTransporters[otherDir] | Math.min(data.serfCount, maxSerfs),
      );
    }
  }

  setSearchDir(dir: Direction): void {
    this.searchDir = dir;
  }
  getSearchDir(): Direction {
    return this.searchDir;
  }
  clearSearchId(): void {
    this.searchNum = 0;
  }

  canDemolish(): boolean {
    let connected = 0;
    let otherEnd: unknown = null;

    for (const d of cycleDirectionsCw()) {
      if (this.hasPath(d)) {
        if (this.isWaterPath(d)) return false;

        connected += 1;

        if (otherEnd != null) {
          // UNION ALIAS: reads the endpoint as void*, whichever it is.
          if (this.otherEndpoint.v[d] === otherEnd) {
            return false;
          }
        } else {
          otherEnd = this.otherEndpoint.v[d];
        }
      }
    }

    if (connected === 2) return true;

    return false;
  }

  mergePaths(pos: MapPos): void {
    const maxTransporters = [1, 2, 3, 4, 6, 8, 11, 15];

    const map = this.game.getMap();
    if (!map.paths(pos)) {
      return;
    }

    let path1Dir: Direction = Direction.DirectionRight;
    let path2Dir: Direction = Direction.DirectionRight;

    /* Find first direction */
    for (const d of cycleDirectionsCw()) {
      if (map.hasPath(pos, d)) {
        path1Dir = d;
        break;
      }
    }

    /* Find second direction */
    for (const d of cycleDirectionsCcw()) {
      if (map.hasPath(pos, d)) {
        path2Dir = d;
        break;
      }
    }

    const path1Data = new SerfPathInfo();
    const path2Data = new SerfPathInfo();

    Flag.fillPathSerfInfo(this.game, pos, path1Dir, path1Data);
    Flag.fillPathSerfInfo(this.game, pos, path2Dir, path2Data);

    const flag1 = this.game.getFlag(path1Data.flagIndex)!;
    const flag2 = this.game.getFlag(path2Data.flagIndex)!;
    const dir1 = path1Data.flagDir;
    const dir2 = path2Data.flagDir;

    flag1.otherEndDirection[dir1] = dir2;
    flag2.otherEndDirection[dir2] = dir1;

    flag1.otherEndpoint.f[dir1] = flag2;
    flag2.otherEndpoint.f[dir2] = flag1;

    flag1.transporterSet &= ~BIT(dir1);
    flag2.transporterSet &= ~BIT(dir2);

    const len = Flag.getRoadLengthValue(path1Data.pathLen + path2Data.pathLen);
    flag1.setLengthBits(dir1, len << 4);
    flag2.setLengthBits(dir2, len << 4);

    const maxSerfs = maxTransporters[flag1.lengthCategory(dir1)];
    const serfCount = path1Data.serfCount + path2Data.serfCount;
    if (serfCount > 0) {
      flag1.transporterSet |= BIT(dir1);
      flag2.transporterSet |= BIT(dir2);

      if (serfCount > maxSerfs) {
        /* TODO 59B8B */
      }

      flag1.freeTransporters[dir1] = u32(flag1.freeTransporters[dir1] + serfCount);
      flag2.freeTransporters[dir2] = u32(flag2.freeTransporters[dir2] + serfCount);
    }

    /* Update serfs with reference to this flag. */
    const serfs1: Serf[] = this.game.getSerfsRelatedTo(flag1.getIndex(), dir1);
    const serfs2: Serf[] = this.game.getSerfsRelatedTo(flag2.getIndex(), dir2);
    const serfs: Serf[] = serfs1.concat(serfs2);
    for (const serf of serfs) {
      serf.pathMerged2(flag1.getIndex(), dir1, flag2.getIndex(), dir2);
    }
  }

  static fillPathSerfInfo(game: Game, pos: MapPos, dir: Direction, data: SerfPathInfo): void {
    const map = game.getMap();
    if (map.getIdleSerf(pos)) wakeTransporterAtFlag(game, pos);

    let serfCount = 0;
    let pathLen = 0;

    /* Handle first position. */
    if (map.hasSerf(pos)) {
      const serf = game.getSerfAtPos(pos)!;
      if (
        serf.getState() === SerfState.StateTransporting &&
        serf.getWalkingWaitCounter() !== -1
      ) {
        let d: number = serf.getWalkingDir();
        if (d < 0) d += 6;

        if (dir === d) {
          serf.setWalkingWaitCounter(0);
          data.serfs[serfCount++] = serf.getIndex();
        }
      }
    }

    /* Trace along the path to the flag at the other end. */
    let paths = 0;
    while (true) {
      pathLen += 1;
      pos = map.move(pos, dir);
      paths = map.paths(pos);
      paths &= ~BIT(reverseDirection(dir));

      if (map.hasFlag(pos)) break;

      /* Find out which direction the path follows. */
      for (const d of cycleDirectionsCw()) {
        if (BIT_TEST(paths, d)) {
          dir = d;
          break;
        }
      }

      /* Check if there is a transporter waiting here. */
      if (map.getIdleSerf(pos)) {
        const index = wakeTransporterOnPath(game, pos);
        if (index >= 0) data.serfs[serfCount++] = index;
      }

      /* Check if there is a serf occupying this space. */
      if (map.hasSerf(pos)) {
        const serf = game.getSerfAtPos(pos)!;
        if (
          serf.getState() === SerfState.StateTransporting &&
          serf.getWalkingWaitCounter() !== -1
        ) {
          serf.setWalkingWaitCounter(0);
          data.serfs[serfCount++] = serf.getIndex();
        }
      }
    }

    /* Handle last position. */
    if (map.hasSerf(pos)) {
      const serf = game.getSerfAtPos(pos)!;
      if (
        (serf.getState() === SerfState.StateTransporting &&
          serf.getWalkingWaitCounter() !== -1) ||
        serf.getState() === SerfState.StateDelivering
      ) {
        let d: number = serf.getWalkingDir();
        if (d < 0) d += 6;

        if (d === reverseDirection(dir)) {
          serf.setWalkingWaitCounter(0);
          data.serfs[serfCount++] = serf.getIndex();
        }
      }
    }

    /* Fill the rest of the struct. */
    data.pathLen = pathLen;
    data.serfCount = serfCount;
    data.flagIndex = map.getObjIndex(pos);
    data.flagDir = reverseDirection(dir);
  }

  /* The bytes of the original: the land paths in bits 0..5 with the
     building (6) and the resources waiting (7); the transporters with the
     failed request (7); the free transporters (0..3), the length category
     (4..6) and the requested transporter (7) of a path; the pickup slot
     (0..2), the direction at the other end (3..5) and the scheduled pickup
     (7). */
  getEndpointBits(): number {
    return (
      this.landPathSet |
      (this.buildingConnected ? BIT(6) : 0) |
      (this.resourcesWaiting ? BIT(7) : 0)
    );
  }

  setEndpointBits(bits: number): void {
    this.landPathSet = bits & 0x3f;
    this.buildingConnected = BIT_TEST(bits, 6) !== 0;
    this.resourcesWaiting = BIT_TEST(bits, 7) !== 0;
  }

  getTransporterBits(): number {
    return this.transporterSet | (this.serfRequestFailed ? BIT(7) : 0);
  }

  setTransporterBits(bits: number): void {
    this.transporterSet = bits & 0x3f;
    this.serfRequestFailed = BIT_TEST(bits, 7) !== 0;
  }

  getLengthBits(dir: number): number {
    return (
      (this.freeTransporters[dir] | (this.pathLengthCategory[dir] << 4)) |
      (this.transporterRequested[dir] ? BIT(7) : 0)
    );
  }

  setLengthBits(dir: number, bits: number): void {
    this.freeTransporters[dir] = bits & 0xf;
    this.pathLengthCategory[dir] = (bits >> 4) & 7;
    this.transporterRequested[dir] = BIT_TEST(bits, 7) !== 0;
  }

  getOtherEndBits(dir: number): number {
    return (
      (this.pickupSlot[dir] | (this.otherEndDirection[dir] << 3)) |
      (this.pickupScheduled[dir] ? BIT(7) : 0)
    );
  }

  setOtherEndBits(dir: number, bits: number): void {
    this.pickupSlot[dir] = bits & 7;
    this.otherEndDirection[dir] = ((bits >> 3) & 7) as Direction;
    this.pickupScheduled[dir] = BIT_TEST(bits, 7) !== 0;
  }

  fixScheduled(): void {
    let scheduledSlots = 0;
    for (let i = 0; i < FLAG_MAX_RES_COUNT; i++) {
      if (this.slot[i].type !== ResourceType.TypeNone) {
        scheduledSlots++;
      }
    }

    if (scheduledSlots) {
      this.resourcesWaiting = true;
    } else {
      this.resourcesWaiting = false;
    }
  }

  scheduleSlotToUnknownDest(slotNum: number): void {
    /* Resources which should be routed directly to
     buildings requesting them. Resources not listed
     here will simply be moved to an inventory. */
    const routable = [
      1, // RESOURCE_FISH
      1, // RESOURCE_PIG
      1, // RESOURCE_MEAT
      1, // RESOURCE_WHEAT
      1, // RESOURCE_FLOUR
      1, // RESOURCE_BREAD
      1, // RESOURCE_LUMBER
      1, // RESOURCE_PLANK
      0, // RESOURCE_BOAT
      1, // RESOURCE_STONE
      1, // RESOURCE_IRONORE
      1, // RESOURCE_STEEL
      1, // RESOURCE_COAL
      1, // RESOURCE_GOLDORE
      1, // RESOURCE_GOLDBAR
      0, // RESOURCE_SHOVEL
      0, // RESOURCE_HAMMER
      0, // RESOURCE_ROD
      0, // RESOURCE_CLEAVER
      0, // RESOURCE_SCYTHE
      0, // RESOURCE_AXE
      0, // RESOURCE_SAW
      0, // RESOURCE_PICK
      0, // RESOURCE_PINCER
      0, // RESOURCE_SWORD
      0, // RESOURCE_SHIELD
      0, // RESOURCE_GROUP_FOOD
    ];

    let res = this.slot[slotNum].type;
    if (routable[res]) {
      const search = new FlagSearch(this.game);
      search.addSource(this);

      /* Handle food as one resource group */
      if (
        res === ResourceType.TypeMeat ||
        res === ResourceType.TypeFish ||
        res === ResourceType.TypeBread
      ) {
        res = ResourceType.GroupFood;
      }

      const data: ScheduleUnknownDestData = {
        resource: res,
        flag: null,
        maxPrio: 0,
      };

      search.execute(scheduleUnknownDestCb, false, true, data);
      if (data.flag != null) {
        // PORT: the C++ streams `slot` here, which is the slot array (its
        // address gets printed). The slot number is logged instead.
        Log.Verbose(
          'game',
          'dest for flag ',
          this.index,
          ' res ',
          slotNum,
          ' found: flag ',
          data.flag.getIndex(),
        );
        const destBld = data.flag.otherEndpoint.b[Direction.DirectionUpLeft]!;

        if (!destBld.addRequestedResource(res, true)) {
          throw new ExceptionFreeserf('Failed to request resource.');
        }

        this.slot[slotNum].dest = destBld.getFlagIndex();
        this.resourcesWaiting = true;
        return;
      }
    }

    /* Either this resource cannot be routed to a destination
     other than an inventory or such destination could not be
     found. Send to inventory instead. */
    const r = this.findNearestInventoryForResource();
    if (r < 0 || r === (this.index | 0)) {
      /* No path to inventory was found, or
       resource is already at destination.
       In the latter case we need to move it
       forth and back once before it can be delivered. */
      if (this.transporters() === 0) {
        this.resourcesWaiting = true;
      } else {
        let dir: Direction = Direction.DirectionNone;
        for (const d of cycleDirectionsCcw()) {
          if (this.hasTransporter(d)) {
            dir = d;
            break;
          }
        }

        if (dir < Direction.DirectionRight || dir > Direction.DirectionUp) {
          throw new ExceptionFreeserf('Failed to request resource.');
        }

        if (!this.isScheduled(dir)) {
          this.pickupScheduled[dir] = true;
          this.pickupSlot[dir] = slotNum;
        }
        this.slot[slotNum].dir = dir;
      }
    } else {
      this.slot[slotNum].dest = r;
      this.resourcesWaiting = true;
    }
  }

  scheduleSlotToKnownDest(slot: number, resWaiting: number[]): void {
    const search = new FlagSearch(this.game);

    this.searchNum = search.getId();
    this.searchDir = Direction.DirectionNone;
    let tr = this.transporters();

    let sources = 0;

    /* Directions where transporters are idle (zero slots waiting) */
    let flags = (resWaiting[0] ^ 0x3f) & this.transporterSet;

    if (flags !== 0) {
      for (const k of cycleDirectionsCcw()) {
        if (BIT_TEST(flags, k)) {
          tr &= ~BIT(k);
          const otherFlag = this.otherEndpoint.f[k]!;
          if (otherFlag.searchNum !== search.getId()) {
            otherFlag.searchDir = k;
            search.addSource(otherFlag);
            sources += 1;
          }
        }
      }
    }

    if (tr !== 0) {
      for (let j = 0; j < 3; j++) {
        flags = resWaiting[j] ^ resWaiting[j + 1];
        for (const k of cycleDirectionsCcw()) {
          if (BIT_TEST(flags, k)) {
            tr &= ~BIT(k);
            const otherFlag = this.otherEndpoint.f[k]!;
            if (otherFlag.searchNum !== search.getId()) {
              otherFlag.searchDir = k;
              search.addSource(otherFlag);
              sources += 1;
            }
          }
        }
      }

      if (tr !== 0) {
        flags = resWaiting[3];
        for (const k of cycleDirectionsCcw()) {
          if (BIT_TEST(flags, k)) {
            tr &= ~BIT(k);
            const otherFlag = this.otherEndpoint.f[k]!;
            if (otherFlag.searchNum !== search.getId()) {
              otherFlag.searchDir = k;
              search.addSource(otherFlag);
              sources += 1;
            }
          }
        }
        if (flags === 0) return;
      }
    }

    if (sources > 0) {
      const data: ScheduleKnownDestData = {
        src: this,
        dest: this.game.getFlag(this.slot[slot].dest),
        slot: slot,
      };
      const r = search.execute(scheduleKnownDestCb, false, true, data);
      if (!r || data.dest === this) {
        /* Unable to deliver */
        this.game.cancelTransportedResource(this.slot[slot].type, this.slot[slot].dest);
        this.slot[slot].dest = 0;
        this.resourcesWaiting = true;
      }
    } else {
      this.resourcesWaiting = true;
    }
  }

  callTransporter(dir: Direction, water: boolean): boolean {
    const src2 = this.otherEndpoint.f[dir]!;
    const dir2 = this.getOtherEndDir(dir);

    this.searchDir = Direction.DirectionRight;
    src2.searchDir = Direction.DirectionDownRight;

    const search = new FlagSearch(this.game);
    search.addSource(this);
    search.addSource(src2);

    const data: SendSerfToRoadData = {
      inventory: null,
      water: water ? 1 : 0,
    };
    search.execute(sendSerfToRoadSearchCb, true, false, data);
    const inventory = data.inventory;
    if (inventory == null) {
      return false;
    }

    const serf: Serf = data.inventory!.callTransporter(water)!;

    const destFlag = this.game.getFlag(inventory.getFlagIndex())!;

    this.transporterRequested[dir] = true;
    src2.transporterRequested[dir2] = true;

    let src: Flag = this;
    if (destFlag.searchDir === src2.searchDir) {
      src = src2;
      dir = dir2;
    }

    serf.goOutFromInventory(inventory.getIndex(), src.getIndex(), dir);

    return true;
  }
}

export interface ScheduleUnknownDestData {
  resource: ResourceType;
  maxPrio: number;
  flag: Flag | null;
}

export function scheduleUnknownDestCb(flag: Flag, destData: ScheduleUnknownDestData): boolean {
  if (flag.hasBuilding()) {
    const building = flag.getBuilding()!;

    const bldPrio = building.getMaxPriorityForResource(destData.resource);
    if (bldPrio > destData.maxPrio) {
      destData.maxPrio = bldPrio;
      destData.flag = flag;
    }

    if (destData.maxPrio > 204) return true;
  }

  return false;
}

export function findNearestInventorySearchCb(flag: Flag, dest: { flag: Flag | null }): boolean {
  if (flag.acceptsResources()) {
    dest.flag = flag;
    return true;
  }
  return false;
}

export function flagSearchInventorySearchCb(flag: Flag, destIndex: { value: number }): boolean {
  if (flag.acceptsSerfs()) {
    const building = flag.getBuilding()!;
    destIndex.value = building.getFlagIndex();
    return true;
  }

  return false;
}

export interface ScheduleKnownDestData {
  src: Flag;
  dest: Flag | null;
  slot: number;
}

export function scheduleKnownDestCb(flag: Flag, destData: ScheduleKnownDestData): boolean {
  return flag.scheduleKnownDestCb_(destData.src, destData.dest, destData.slot);
}

/* Find a transporter at pos and change it to state. */
export function changeTransporterStateAtPos(game: Game, pos: MapPos, state: SerfState): number {
  for (const serf of game.getSerfsAtPos(pos)) {
    if (serf.changeTransporterStateAtPos(pos, state)) {
      return serf.getIndex();
    }
  }

  return -1;
}

export function wakeTransporterAtFlag(game: Game, pos: MapPos): number {
  return changeTransporterStateAtPos(game, pos, SerfState.StateWakeAtFlag);
}

export function wakeTransporterOnPath(game: Game, pos: MapPos): number {
  return changeTransporterStateAtPos(game, pos, SerfState.StateWakeOnPath);
}

export interface SendSerfToRoadData {
  inventory: Inventory | null;
  water: number;
}

export function sendSerfToRoadSearchCb(flag: Flag, roadData: SendSerfToRoadData): boolean {
  if (flag.hasInventory()) {
    /* Inventory reached */
    const building = flag.getBuilding()!;
    const inventory = building.getInventory()!;
    if (!roadData.water) {
      if (inventory.haveSerf(SerfType.TypeTransporter)) {
        roadData.inventory = inventory;
        return true;
      }
    } else {
      if (inventory.haveSerf(SerfType.TypeSailor)) {
        roadData.inventory = inventory;
        return true;
      }
    }

    if (
      roadData.inventory == null &&
      inventory.haveSerf(SerfType.TypeGeneric) &&
      (!roadData.water || inventory.getCountOf(ResourceType.TypeBoat) > 0)
    ) {
      roadData.inventory = inventory;
    }
  }

  return false;
}

export class FlagSearch {
  protected game: Game;
  protected queue: Flag[] = [];
  protected id: number;

  constructor(game: Game) {
    this.game = game;
    this.id = game.nextSearchId();
  }

  getId(): number {
    return this.id;
  }

  addSource(flag: Flag): void {
    this.queue.push(flag);
    flag.searchNum = this.id;
  }

  execute<T>(callback: FlagSearchFunc<T>, land: boolean, transporter: boolean, data: T): boolean {
    for (let i = 0; i < SEARCH_MAX_DEPTH && this.queue.length > 0; i++) {
      const flag = this.queue.shift()!;

      if (callback(flag, data)) {
        /* Clean up */
        this.queue = [];
        return true;
      }

      for (const i of cycleDirectionsCcw()) {
        // UNION ALIAS: other_endpoint.f[i] is read for every direction
        // that passes the path tests, whatever was stored there. The C++
        // dereferences it unchecked.
        if (
          (!land || !flag.isWaterPath(i)) &&
          (!transporter || flag.hasTransporter(i)) &&
          flag.otherEndpoint.f[i]!.searchNum !== this.id
        ) {
          flag.otherEndpoint.f[i]!.searchNum = this.id;
          flag.otherEndpoint.f[i]!.searchDir = flag.searchDir;
          const otherFlag = flag.otherEndpoint.f[i]!;
          this.queue.push(otherFlag);
        }
      }
    }

    /* Clean up */
    this.queue = [];

    return false;
  }

  static single<T>(
    src: Flag,
    callback: FlagSearchFunc<T>,
    land: boolean,
    transporter: boolean,
    data: T,
  ): boolean {
    const search = new FlagSearch(src.getGame());
    search.addSource(src);
    return search.execute(callback, land, transporter, data);
  }
}
