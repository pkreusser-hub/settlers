/*
 * game-manager.ts - Gameplay related functions
 *
 * Port of Freeserf's game-manager.h and game-manager.cc.
 *
 * Copyright (C) 2017-2018  Wicked_Digger <wicked_digger@mail.ru>
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

import { Game } from './game';
import { GameInfo } from './mission';
import type { PGameInfo } from './mission';
import { Random } from './random';
import { GameStore } from './savegame';

type PGame = Game | null;

export interface GameManagerHandler {
  onNewGame(game: Game): void;
  onEndGame(game: Game): void;
}

let gameManager: GameManager | null = null;

export class GameManager {
  protected currentGame: PGame = null;
  protected handlers: GameManagerHandler[] = [];

  protected constructor() {}

  // PORT: the C++ destructor calls set_current_game(nullptr) at program
  // exit. There is no destructor here; nothing calls it.

  static getInstance(): GameManager {
    if (gameManager === null) {
      gameManager = new GameManager();
    }
    return gameManager;
  }

  addHandler(handler: GameManagerHandler): void {
    this.handlers.push(handler);
  }

  delHandler(handler: GameManagerHandler): void {
    // std::list::remove removes every equal element.
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  getCurrentGame(): PGame {
    return this.currentGame;
  }

  protected setCurrentGame(newGame: PGame): void {
    if (this.currentGame) {
      for (const handler of this.handlers) {
        handler.onEndGame(this.currentGame);
      }
    }

    this.currentGame = newGame;
    if (!this.currentGame) {
      return;
    }

    for (const handler of this.handlers) {
      handler.onNewGame(this.currentGame);
    }
  }

  startRandomGame(): boolean {
    const gameInfo = new GameInfo(new Random());
    return this.startGame(gameInfo);
  }

  startGame(gameInfo: PGameInfo): boolean {
    const newGame = gameInfo.instantiate();
    if (!newGame) {
      return false;
    }

    this.setCurrentGame(newGame);

    return true;
  }

  loadGame(path: string): boolean {
    const newGame = new Game();
    if (!GameStore.getInstance().load(path, newGame)) {
      return false;
    }

    this.setCurrentGame(newGame);
    newGame.pause();

    return true;
  }

  // PORT: not in the C++. The game of an online match that goes on from a
  // save game: both sides build it from the same text.
  loadGameText(text: string): boolean {
    const newGame = new Game();
    if (!GameStore.getInstance().read(text, newGame)) {
      return false;
    }

    this.setCurrentGame(newGame);
    newGame.pause();

    return true;
  }
}
