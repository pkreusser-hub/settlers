/*
 * ai.cc - Computer player of the Amiga original
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

/* The computer player of the Amiga original (0x28ee2..0x2edd6). The
   original passes most values through fields of the player record and a
   few global game fields instead of arguments; the port keeps that
   structure. Field names give the original's offsets, relative to the
   Amiga player pointer (0x80 bytes into the record, as the hex comments
   in player.h). All values are 16-bit words in the original unless noted
   otherwise. */

// PORT: the structs of ai.h are elsewhere: AIPoi, AILocation and PlayerAI
// in player.ts (the player record holds them), GameAI as GameAIFields in
// game.ts. ai_space_from_obj and ai_map_blocked of ai.cc are in
// ai-internal.ts. They are re-exported here.
//
// The C++ nests the modules as classes AI::Core, AI::Rate, AI::Road,
// AI::Want and AI::Manage so that they share the friend access of AI. Here
// each is a module of functions (ai-core.ts and so on), also reachable as
// AI.Core and so on.

import * as Core from './ai-core';
import {
  AI_SET_CURSOR, MAP_POS_COL, MAP_POS_ROW, PLAYER_IS_AI, aiCall, pendingGet,
  pendingSet,
} from './ai-internal';
import * as Manage from './ai-manage';
import * as Rate from './ai-rate';
import * as Road from './ai-road';
import * as Want from './ai-want';
import type { Game } from './game';
import type { MapPos } from './map-geometry';
import type { Player } from './player';

export { AISpace, aiMapBlocked, aiSpaceFromObj } from './ai-internal';
export {
  AILocation, AIPoi, AI_LOCATIONS_PER_CATEGORY, AI_LOCATION_CATEGORIES, PlayerAI,
} from './player';
export type { GameAIFields } from './game';

export class AI {
  // PORT: getters, because the modules import each other in a circle and
  // may not be evaluated yet when this class is defined.
  static get Core(): typeof Core { return Core; }
  static get Rate(): typeof Rate { return Rate; }
  static get Road(): typeof Road { return Road; }
  static get Want(): typeof Want { return Want; }
  static get Manage(): typeof Manage { return Manage; }

  /* Game of the current AI call; the original reads the game record
     from A5. */
  // PORT: the static itself is aiCall.game in ai-internal.ts, where the
  // AI modules read it.
  static get game(): Game | null {
    return aiCall.game;
  }
  static set game(game: Game | null) {
    aiCall.game = game;
  }

  /* Scheduler slots (Amiga update_scheduled @0xa864). */
  static update(game_: Game, player: Player): void { /* 33..48 */
    AI.game = game_;
    Core.update(player);
  }

  static scanSites(game_: Game, player: Player): void { /* 0..31 */
    AI.game = game_;
    Core.scanSites(player);
  }

  static updateBuildDampingAll(game_: Game): void { /* 32 */
    AI.game = game_;
    Core.updateBuildDampingAll();
  }

  static calcMilitaryRatio(game_: Game, player: Player): number {
    AI.game = game_;
    return Manage.calcMilitaryRatio(player);
  }

  /* Game hooks. */
  /* A knight of the player occupied the enemy building with the flag at
     flag_pos: remember it to connect it by road later (Amiga @0xd68c). */
  static buildingConquered(game_: Game, player: Player, flagPos: MapPos): void {
    AI.game = game_;
    if (!PLAYER_IS_AI(player)) return;
    // PORT: `int *pending = &player->ai.u_1bc`, an array of 16 ints.
    for (let i = 0; i < 8; i++) {
      if (pendingGet(player, 2 * i) & 0x8000) {
        pendingSet(player, 2 * i, MAP_POS_COL(flagPos));
        pendingSet(player, 2 * i + 1, MAP_POS_ROW(flagPos));
        break;
      }
    }
  }

  /* The mission gives the castle position: skip the castle placement
     phase (Amiga @0x4b36). */
  static castleGiven(game_: Game, player: Player, pos: MapPos): void {
    AI.game = game_;
    AI_SET_CURSOR(player, pos);
    if (PLAYER_IS_AI(player)) {
      player.ai.phase = 1;
      player.ai.counter = 0x18;
    }
  }
}
