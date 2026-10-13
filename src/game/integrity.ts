/*
 * integrity.ts - Consistency check of the game state
 *
 * Port of Freeserf's integrity.h and integrity.cc.
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

import type { Game } from './game';
import { FLAG_MAX_RES_COUNT } from './flag';
import { Building } from './building';
import { SerfState } from './serf';
import { MapObject } from './map';
import { Direction } from './map-geometry';
import { ResourceType } from './resource';
import { i32, Log } from './misc';

// PORT: IntegrityCheck is a friend of Game, Flag, Building, Inventory and
// Serf in the C++. The fields it reads are public in the TS classes.

/* Checks that the links between the game objects agree with each other:
   map tiles and objects, building stocks and the resources on their way,
   flag slots and their schedule, serf references. Each problem is logged
   as a warning; with fix, the repairable ones are repaired. Returns the
   number of problems found. Run after loading a game. */
export class IntegrityCheck {
  static run(game: Game, fix: boolean): number {
    let problems = 0;
    problems += IntegrityCheck.checkMap(game);
    problems += IntegrityCheck.checkFlags(game, fix);
    problems += IntegrityCheck.checkRequests(game, fix);
    problems += IntegrityCheck.checkSerfs(game);
    // EXT: the offers and shipments of the trade (trade.ts).
    problems += IntegrityCheck.checkTrade(game, fix);
    if (problems !== 0) {
      Log.Warn('integrity', problems, ' problem(s) found in the game state',
               (fix ? ', repaired where possible.' : '.'));
    }
    return problems;
  }

  /* Flags and buildings are on their map tiles, and their links agree. */
  protected static checkMap(game: Game): number {
    const map = game.getMap();
    let problems = 0;

    for (const flag of game.flags) {
      if (flag.getIndex() === 0) continue;
      const pos = flag.getPosition();
      if (map.getObj(pos) !== MapObject.ObjectFlag ||
          map.getObjIndex(pos) !== flag.getIndex()) {
        Log.Warn('integrity', 'flag ', flag.getIndex(),
                 ' is not on its map tile ', pos);
        problems++;
      }
    }

    for (const building of game.buildings) {
      if (building.getIndex() === 0) continue;
      const pos = building.getPosition();
      const obj = map.getObj(pos);
      if (obj < MapObject.ObjectSmallBuilding || obj > MapObject.ObjectCastle ||
          map.getObjIndex(pos) !== building.getIndex()) {
        Log.Warn('integrity', 'building ', building.getIndex(),
                 ' is not on its map tile ', pos);
        problems++;
      }

      if (building.flag !== 0) {
        const flag = game.flags.get(building.flag);
        if (flag === null ||
            flag.getPosition() !== map.moveDownRight(pos)) {
          Log.Warn('integrity', 'building ', building.getIndex(),
                   ' has a wrong flag ', building.flag);
          problems++;
        }
      }

      if (building.hasInventory() && !building.isBurning() &&
          building.inventory !== null &&
          building.inventory.building !== building.getIndex()) {
        Log.Warn('integrity', 'inventory of building ',
                 building.getIndex(),
                 ' belongs to building ',
                 building.inventory.building);
        problems++;
      }
    }

    return problems;
  }

  /* Resources at flags are scheduled to existing roads, and a resource
     without a destination is not forgotten: a flag that is not marked to
     schedule it keeps it forever (#81). */
  protected static checkFlags(game: Game, fix: boolean): number {
    let problems = 0;

    for (const flag of game.flags) {
      if (flag.getIndex() === 0) continue;

      for (let i = 0; i < FLAG_MAX_RES_COUNT; i++) {
        if (flag.slot[i].type === ResourceType.TypeNone) continue;
        const dir = flag.slot[i].dir;
        if (dir !== Direction.DirectionNone && !flag.hasPath(dir)) {
          Log.Warn('integrity', 'flag ', flag.getIndex(), ' slot ',
                   i, ' is scheduled to a missing road');
          problems++;
          if (fix) {
            flag.slot[i].dir = Direction.DirectionNone;
            flag.resourcesWaiting = true;
          }
        } else if (dir === Direction.DirectionNone && flag.slot[i].dest === 0 &&
                   !flag.hasResources()) {
          /* A resource without a destination is either scheduled to a road
             or keeps the flag marked until it is; otherwise it is never
             looked at again. */
          Log.Warn('integrity', 'flag ', flag.getIndex(), ' slot ',
                   i, ' is never scheduled');
          problems++;
          if (fix) flag.resourcesWaiting = true;
        }
      }
    }

    return problems;
  }

  /* The resources a building has requested are all on their way to it: at
     flags, carried by transporters, queued in inventories or carried out
     of them. A request without its resource would block the building's
     stock for good, a resource without a request would fail on delivery. */
  protected static checkRequests(game: Game, fix: boolean): number {
    // PORT: std::map<std::pair<unsigned int, int>, int>, keyed by
    // (flag index, stock type). It is only looked up, never iterated, so
    // the pair is one string key. A stock type that is not on the way
    // reads as 0, as operator[] gives.
    const key = (dest: number, res: number): string => dest + ',' + res;
    const onWay = new Map<string, number>();
    const add = (res: number, dest: number): void => {
      if (res < 0 || dest === 0) return;
      if (res === ResourceType.TypeFish || res === ResourceType.TypeMeat ||
          res === ResourceType.TypeBread) {
        res = ResourceType.GroupFood;
      }
      const k = key(dest, res);
      onWay.set(k, (onWay.get(k) ?? 0) + 1);
    };

    for (const flag of game.flags) {
      for (let i = 0; i < FLAG_MAX_RES_COUNT; i++) {
        add(flag.slot[i].type, flag.slot[i].dest);
      }
    }
    for (const inventory of game.inventories) {
      for (let i = 0; i < 2; i++) {
        add(inventory.outQueue[i].type, inventory.outQueue[i].dest);
      }
    }
    for (const serf of game.serfs) {
      switch (serf.state) {
        case SerfState.StateTransporting:
        case SerfState.StateDelivering:
          add(serf.s.transporting.res, serf.s.transporting.dest);
          break;
        case SerfState.StateMoveResourceOut:
        case SerfState.StateDropResourceOut:
          add(i32(serf.s.moveResourceOut.res) - 1,
              serf.s.moveResourceOut.resDest);
          break;
        case SerfState.StateLeavingBuilding:
        case SerfState.StateReadyToLeave:
          if (serf.s.leavingBuilding.nextState ===
              SerfState.StateDropResourceOut) {
            add(serf.s.leavingBuilding.fieldB - 1,
                serf.s.leavingBuilding.dest);
          }
          break;
        default:
          break;
      }
    }

    let problems = 0;
    for (const building of game.buildings) {
      if (building.getIndex() === 0 || building.hasInventory() ||
          building.isBurning() || building.flag === 0) {
        continue;
      }
      for (let i = 0; i < Building.kMaxStock; i++) {
        const stock = building.stock[i];
        if (stock.type === ResourceType.TypeNone) continue;
        /* The first stock of military buildings counts knights. */
        if (i === 0 && building.isMilitary()) continue;
        const count = onWay.get(key(building.flag, stock.type)) ?? 0;
        if (stock.requested !== count) {
          Log.Warn('integrity', 'building ', building.getIndex(),
                   ' stock ', i, ' requested ',
                   stock.requested, ' but ', count,
                   ' on the way');
          problems++;
          if (fix) stock.requested = count;
        }
      }
    }

    return problems;
  }

  /* EXT: the offers and shipments of the trade are ones the rule could have
     made. With fix the others are dropped. */
  protected static checkTrade(game: Game, fix: boolean): number {
    const problems = game.trade.countProblems(fix);
    if (problems !== 0) {
      Log.Warn('integrity', problems, ' trade offer(s) or shipment(s) are not valid');
    }
    return problems;
  }

  /* Serfs refer only to existing flags, inventories and serfs. */
  protected static checkSerfs(game: Game): number {
    let problems = 0;

    for (const serf of game.serfs) {
      if (serf.getIndex() === 0) continue;
      let dest = 0;
      switch (serf.state) {
        case SerfState.StateWalking:
          /* -2: the destination was cleared. */
          if (serf.s.walking.dir1 !== -2) dest = serf.s.walking.dest;
          break;
        case SerfState.StateTransporting:
        case SerfState.StateDelivering:
          /* Without a resource the destination is not used. */
          if (serf.s.transporting.res !== ResourceType.TypeNone) {
            dest = serf.s.transporting.dest;
          }
          break;
        case SerfState.StateIdleInStock:
          if (game.inventories.get(serf.s.idleInStock.invIndex) === null) {
            Log.Warn('integrity', 'serf ', serf.getIndex(),
                     ' idles in missing inventory ',
                     serf.s.idleInStock.invIndex);
            problems++;
          }
          break;
        default:
          break;
      }
      if (dest !== 0 && game.flags.get(dest) === null) {
        Log.Warn('integrity', 'serf ', serf.getIndex(),
                 ' goes to missing flag ', dest);
        problems++;
      }
    }

    for (const building of game.buildings) {
      if (!building.isMilitary() || building.isBurning()) continue;
      let knight = building.firstKnight;
      let count = 0;
      while (knight !== 0 && count < 100) {
        const serf = game.serfs.get(knight);
        if (serf === null) {
          Log.Warn('integrity', 'building ', building.getIndex(),
                   ' has missing knight ', knight);
          problems++;
          break;
        }
        /* Only a knight defending the building links to the next one. */
        if (serf.state !== SerfState.StateDefendingHut &&
            serf.state !== SerfState.StateDefendingTower &&
            serf.state !== SerfState.StateDefendingFortress &&
            serf.state !== SerfState.StateDefendingCastle) {
          break;
        }
        knight = serf.s.defending.nextKnight;
        count++;
      }
    }

    return problems;
  }
}
