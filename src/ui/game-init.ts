/*
 * game-init.ts - Game initialization GUI component
 *
 * Port of Freeserf's game-init.h and game-init.cc.
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

import { Game, GAME_MAX_PLAYER_COUNT } from '../game/game';
import { GameManager } from '../game/game-manager';
import { Map, MapGeometry } from '../game/map';
import type { PMap } from '../game/map';
import {
  ClassicMapGenerator,
  ClassicMissionMapGenerator,
  MapGenerator,
} from '../game/map-generator';
import { clamp } from '../game/misc';
import { GameInfo } from '../game/mission';
import type { PGameInfo, PPlayerInfo } from '../game/mission';
import { Random } from '../game/random';
import { GameStore } from '../game/savegame';
import { drawBoxFrame } from './box-frame';
import { Data } from './data-instance';
import { Color, Frame } from './gfx';
import { GuiObject } from './gui';
import type { Interface } from './interface';
import { ListSavedFiles } from './list';
import { Minimap } from './minimap';
import { PopupBoxType } from './popup';
import { TextInput } from './text-input';
import { _ } from './translation';

// PORT: version.h / version.cc are not ported. FREESERF_VERSION is
// VERSION_VCS there, the tag of the version control system written by the
// build; here it is the version of the project of the reference
// (CMakeLists.txt: project(FreeSerf VERSION 0.5.0)).
const FREESERF_VERSION = '0.5.0';

class RandomInput extends TextInput {
  protected savedText: string;

  constructor() {
    super();
    this.savedText = '';
    this.setFilter(RandomInput.textInputFilter);
    this.setSize(34, 34);
    this.setMaxLength(16);
  }

  setRandom(rnd: Random): void {
    const str = rnd.toString();
    this.setText(str);
  }

  getRandom(): Random {
    return new Random(this.text);
  }

  protected static textInputFilter(key: number, textInput: TextInput): boolean {
    if (key < 0x31 /* '1' */ || key > 0x38 /* '8' */) {
      return false;
    }

    if (textInput.getText().length > 16) {
      return false;
    }

    return true;
  }

  /* The 16 digits in 4 rows of 4, each centred in its cell of 8 pixels,
     as with the 8 pixels wide digits of the original font. */
  protected override internalDraw(): void {
    const frame = this.frame as Frame;
    frame.fillRect(0, 0, this.width, this.height, this.colorBackground);
    if (this.drawFocus && this.focused) {
      frame.drawRect(0, 0, this.width, this.height, this.colorFocus);
    }
    const origin = this.drawFocus ? 1 : 0;
    for (let i = 0; i < this.text.length && i < 16; i++) {
      const digit = this.text.substring(i, i + 1);
      const cx = origin + 8 * (i % 4) + Math.trunc((8 - frame.getStringWidth(digit)) / 2);
      const cy = origin + 8 * Math.trunc(i / 4);
      frame.drawString(cx, cy, digit, this.colorText);
    }
  }

  protected override handleClickLeft(cx: number, cy: number): boolean {
    super.handleClickLeft(cx, cy);
    this.savedText = this.text;
    this.text = '';
    return true;
  }

  protected override handleFocusLoose(): boolean {
    super.handleFocusLoose();
    if (this.text.length < 16 && this.savedText.length === 16) {
      this.text = this.savedText;
      this.savedText = '';
    }
    return true;
  }
}

// PORT: not in the C++. While the host of an online game sets it up, the
// box only offers a custom game with two human players (the host and the
// guest) and hands the result to start() instead of starting it. start()
// returns false to keep the box open; cancel() is the exit button.
export interface OnlineHostHooks {
  start(mission: PGameInfo): boolean;
  /* Go on from the save game of this path. */
  startSaved(path: string): boolean;
  cancel(): void;
}

let onlineHost: OnlineHostHooks | null = null;

/* Applies to the boxes made after the call. */
export function setOnlineHost(hooks: OnlineHostHooks | null): void {
  onlineHost = hooks;
}

export enum GameInitBoxAction {
  ActionStartGame,
  ActionToggleGameType,
  ActionShowOptions,
  ActionIncrement,
  ActionDecrement,
  ActionClose,
  ActionGenRandom,
  ActionApplyRandom,
}

export enum GameInitBoxGameType {
  GameCustom = 0,
  GameMission = 1,
  GameTutorial = 2,
  GameLoad = 3,
}

const ActionStartGame = GameInitBoxAction.ActionStartGame;
const ActionToggleGameType = GameInitBoxAction.ActionToggleGameType;
const ActionShowOptions = GameInitBoxAction.ActionShowOptions;
const ActionIncrement = GameInitBoxAction.ActionIncrement;
const ActionDecrement = GameInitBoxAction.ActionDecrement;
const ActionClose = GameInitBoxAction.ActionClose;
const ActionGenRandom = GameInitBoxAction.ActionGenRandom;
const ActionApplyRandom = GameInitBoxAction.ActionApplyRandom;

const GameCustom = GameInitBoxGameType.GameCustom;
const GameMission = GameInitBoxGameType.GameMission;
const GameTutorial = GameInitBoxGameType.GameTutorial;
const GameLoad = GameInitBoxGameType.GameLoad;

export class GameInitBox extends GuiObject {
  static Action = GameInitBoxAction;
  static GameType = GameInitBoxGameType;

  protected interface: Interface;

  protected gameType: number;
  protected gameMission: number;
  protected gameTutorial: number;

  protected customMission: PGameInfo;
  protected mission: PGameInfo;

  protected randomInput: RandomInput;
  protected map: PMap | null;
  protected minimap: Minimap;
  protected fileList: ListSavedFiles;
  // PORT: see OnlineHostHooks.
  protected online: OnlineHostHooks | null;

  constructor(_interface: Interface) {
    super();
    this.randomInput = new RandomInput();
    this.minimap = new Minimap(null);
    this.fileList = new ListSavedFiles();
    this.map = null;
    this.interface = _interface;

    this.gameType = GameCustom;
    this.gameMission = 0;
    this.gameTutorial = 0;

    this.setSize(360, 254);

    this.customMission = new GameInfo(new Random());
    this.customMission.removeAllPlayers();
    this.customMission.addPlayer(12, { red: 0x00, green: 0xe3, blue: 0xe3 }, 40, 40, 40);
    this.online = onlineHost;
    if (this.online !== null) {
      /* The guest: a human player ('Friend') with the host's values. */
      this.customMission.addPlayer(13, { red: 0xcf, green: 0x63, blue: 0x63 }, 40, 40, 40);
    } else {
      this.customMission.addPlayer(1, { red: 0xcf, green: 0x63, blue: 0x63 }, 20, 30, 40);
    }
    this.mission = this.customMission;

    this.minimap.setDisplayed(true);
    this.minimap.setSize(150, 160);
    this.addFloat(this.minimap, 190, 55);

    this.generateMapPreview();

    this.randomInput.setRandom(this.customMission.getRandomBase());
    this.randomInput.setDisplayed(true);
    this.addFloat(this.randomInput, 19 + 31 * 8, 15);

    this.fileList.setSize(160, 160);
    this.fileList.setDisplayed(false);
    this.fileList.setSelectionHandler((item: string) => {
      const game = new Game();
      if (GameStore.getInstance().load(item, game)) {
        this.map = game.getMap();
        this.minimap.setMap(this.map);
      }
    });
    this.addFloat(this.fileList, 20, 55);
  }

  // PORT: the destructor is empty in the C++; the unique_ptr members delete
  // the random input, the minimap and the file list.
  override destroy(): void {
    this.randomInput.destroy();
    this.minimap.destroy();
    this.fileList.destroy();
    super.destroy();
  }

  protected drawBoxIcon(ix: number, iy: number, sprite: number): void {
    (this.frame as Frame).drawSprite(8 * ix + 20, iy + 16, Data.Resource.AssetIcon, sprite);
  }

  protected drawBoxString(sx: number, sy: number, str: string): void {
    (this.frame as Frame).drawString(8 * sx + 20, sy + 16, str, Color.green, Color.black);
  }

  protected drawBackground(): void {
    const frame = this.frame as Frame;
    // Background
    let icon = 290;
    for (let by = 0; by < this.height; by += 8) {
      for (let bx = 0; bx < this.width; bx += 40) {
        frame.drawSprite(bx, by, Data.Resource.AssetIcon, icon);
      }
      icon--;
      if (icon < 290) {
        icon = 294;
      }
    }
  }

  /* Get the sprite number for a face. */
  protected getPlayerFaceSprite(face: number): number {
    if (face !== 0) {
      return 0x10b + face;
    }
    return 0x119; /* sprite_face_none */
  }

  protected internalDraw(): void {
    this.drawBackground();
    drawBoxFrame(this.frame as Frame, this.width, this.height);

    const layout = [
      266, 0, 0,    // Start button
      267, 36, 0,   // Options button
      -1,
    ];

    let i = 0;
    while (layout[i] >= 0) {
      this.drawBoxIcon(layout[i + 1], layout[i + 2], layout[i]);
      i += 3;
    }

    /* Game type settings */
    switch (this.gameType) {
      case GameMission: {
        this.drawBoxIcon(5, 0, 260);  // Game type

        const level = String(this.gameMission + 1);

        this.drawBoxString(10, 2, _('Start mission'));
        this.drawBoxString(10, 18, _('Mission:'));
        this.drawBoxString(20, 18, level);

        this.drawBoxIcon(33, 0, 237);  // Up button
        this.drawBoxIcon(33, 16, 240);  // Down button

        break;
      }
      case GameTutorial: {
        this.drawBoxIcon(5, 0, 261);  // Game type

        const level = String(this.gameTutorial + 1);

        this.drawBoxString(10, 2, _('Start tutorial'));
        this.drawBoxString(10, 18, _('Tutorial:'));
        this.drawBoxString(20, 18, level);

        this.drawBoxIcon(33, 0, 237);  // Up button
        this.drawBoxIcon(33, 16, 240);  // Down button

        break;
      }
      case GameCustom: {
        this.drawBoxIcon(5, 0, 263);  // Game type

        const strMapSize = String(this.mission.getMapSize());

        this.drawBoxString(10, 2, this.online !== null ? _('Online game') : _('New game'));
        this.drawBoxString(10, 18, _('Mapsize:'));
        this.drawBoxString(18, 18, strMapSize);

        this.drawBoxIcon(25, 0, 265);

        break;
      }
      case GameLoad: {
        this.drawBoxIcon(5, 0, 316);  // Game type

        this.drawBoxString(10, 2, _('Load game'));

        break;
      }
    }

    /* Game info */
    if (this.gameType !== GameLoad) {
      let bx = 0;
      let by = 0;
      for (let i = 0; i < GAME_MAX_PLAYER_COUNT; i++) {
        this.drawPlayerBox(i, 10 * bx, 40 + by * 80);
        bx++;
        if (i === 1) {
          by++;
          bx = 0;
        }
      }
    }

    /* Display program name and version in caption */
    this.drawBoxString(0, 212, FREESERF_VERSION);

    this.drawBoxIcon(38, 208, 60); /* exit */
  }

  protected drawPlayerBox(player: number, bx: number, by: number): void {
    const layout = [
      251, 0, 0,
      252, 0, 72,
      253, 0, 8,
      254, 5, 8,
      255, 9, 8,
      -1,
    ];

    let i = 0;
    while (layout[i] >= 0) {
      this.drawBoxIcon(bx + layout[i + 1], by + layout[i + 2], layout[i]);
      i += 3;
    }

    by += 8;
    bx += 1;

    let face = 0;
    if (player < this.mission.getPlayerCount()) {
      face = this.mission.getPlayer(player).getFace();
    }

    this.drawBoxIcon(bx, by, this.getPlayerFaceSprite(face));
    this.drawBoxIcon(bx + 5, by, 282);
    if (this.gameType === GameCustom) {
      this.drawBoxIcon(bx + 4, by, 308);
      this.drawBoxIcon(bx + 5, by, face === 0 ? 287 : 259);
    }

    if (player < this.mission.getPlayerCount()) {
      const frame = this.frame as Frame;
      bx *= 8;

      const pi: PPlayerInfo = this.mission.getPlayer(player);
      const supplies = pi.getSupplies();
      frame.fillRect(bx + 64, by + 76 - supplies, 4, supplies,
                     new Color(0x00, 0x93, 0x87));

      const intelligence = pi.getIntelligence();
      frame.fillRect(bx + 70, by + 76 - intelligence, 4, intelligence,
                     new Color(0x6b, 0xab, 0x3b));

      const reproduction = pi.getReproduction();
      frame.fillRect(bx + 76, by + 76 - reproduction, 4, reproduction,
                     new Color(0xa7, 0x27, 0x27));
    }
  }

  // PORT: not in the C++. Show the list of the saved games at once.
  showLoad(): void {
    if (this.online !== null) {
      return;
    }
    this.gameType = GameLoad;
    this.randomInput.setDisplayed(false);
    this.fileList.update();
    this.fileList.setDisplayed(true);
    this.setRedraw();
  }

  protected handleAction(action: number): void {
    switch (action) {
      case ActionStartGame: {
        if (this.online !== null) {
          if (this.gameType === GameLoad) {
            const path = this.fileList.getSelected();
            if (path.length === 0 || !this.online.startSaved(path)) {
              return;
            }
          } else if (!this.online.start(this.mission)) {
            return;
          }
          /* Closing deletes this box. */
          this.interface.closeGameInit();
          return;
        }
        if (this.gameType === GameLoad) {
          const path = this.fileList.getSelected();
          if (path.length === 0 || !GameManager.getInstance().loadGame(path)) {
            return;
          }
        } else {
          if (!GameManager.getInstance().startGame(this.mission)) {
            return;
          }
        }

        /* Closing deletes this box. */
        const iface = this.interface;
        const tutorial = this.gameType === GameTutorial;
        iface.closeGameInit();
        if (tutorial) {
          iface.openPopup(PopupBoxType.TypeTutorialOrders);
        }
        return;
      }
      case ActionToggleGameType:
        if (this.online !== null) {
          /* Missions and tutorials are for one player. */
          this.gameType = this.gameType === GameCustom ? GameLoad - 1 : GameLoad;
        }
        this.gameType++;
        if (this.gameType > GameLoad) {
          this.gameType = GameCustom;
        }
        switch (this.gameType) {
          case GameMission: {
            this.mission = GameInfo.getMission(this.gameMission) as PGameInfo;
            this.randomInput.setDisplayed(false);
            this.fileList.setDisplayed(false);
            this.generateMapPreview();
            break;
          }
          case GameTutorial: {
            this.mission = GameInfo.getTutorial(this.gameTutorial) as PGameInfo;
            this.randomInput.setDisplayed(false);
            this.fileList.setDisplayed(false);
            this.generateMapPreview();
            break;
          }
          case GameCustom: {
            this.mission = this.customMission;
            this.randomInput.setDisplayed(true);
            this.randomInput.setRandom(this.customMission.getRandomBase());
            this.fileList.setDisplayed(false);
            this.generateMapPreview();
            break;
          }
          case GameLoad: {
            this.randomInput.setDisplayed(false);
            this.fileList.update();
            this.fileList.setDisplayed(true);
            break;
          }
        }
        break;
      case ActionShowOptions: {
        if (this.interface) {
          this.interface.openPopup(PopupBoxType.TypeOptions);
        }
        break;
      }
      case ActionIncrement:
        switch (this.gameType) {
          case GameMission:
            this.gameMission = Math.min(this.gameMission + 1,
                                        GameInfo.getMissionCount() - 1);
            this.mission = GameInfo.getMission(this.gameMission) as PGameInfo;
            break;
          case GameTutorial:
            this.gameTutorial = Math.min(this.gameTutorial + 1,
                                         GameInfo.getTutorialCount() - 1);
            this.mission = GameInfo.getTutorial(this.gameTutorial) as PGameInfo;
            break;
          case GameCustom:
            this.customMission.setMapSize(Math.min(10,
                                                   this.customMission.getMapSize() + 1));
            break;
        }
        this.generateMapPreview();
        break;
      case ActionDecrement:
        switch (this.gameType) {
          case GameMission:
            this.gameMission = Math.max(0, this.gameMission - 1);
            this.mission = GameInfo.getMission(this.gameMission) as PGameInfo;
            break;
          case GameTutorial:
            this.gameTutorial = Math.max(0, this.gameTutorial - 1);
            this.mission = GameInfo.getTutorial(this.gameTutorial) as PGameInfo;
            break;
          case GameCustom:
            this.customMission.setMapSize(Math.max(3,
                                                   this.customMission.getMapSize() - 1));
            break;
        }
        this.generateMapPreview();
        break;
      case ActionClose:
        if (this.online !== null) {
          this.online.cancel();
          return;
        }
        this.interface.closeGameInit();
        break;
      case ActionGenRandom: {
        this.randomInput.setRandom(new Random());
        this.setRedraw();
        break;
      }
      case ActionApplyRandom: {
        const str = this.randomInput.getText();
        if (str.length === 16) {
          this.customMission.setRandomBase(this.randomInput.getRandom());
          if (this.online !== null) {
            /* The random base made player 1 a computer player: it is the
               guest, with the host's values. */
            const host: PPlayerInfo = this.customMission.getPlayer(0);
            const guest: PPlayerInfo = this.customMission.getPlayer(1);
            guest.setCharacter(13);
            guest.setIntelligence(host.getIntelligence());
            guest.setSupplies(host.getSupplies());
            guest.setReproduction(host.getReproduction());
          }
          this.mission = this.customMission;
          this.generateMapPreview();
        }
        break;
      }
      default:
        break;
    }
  }

  protected override handleClickLeft(cx: number, cy: number): boolean {
    const clickmapMission = [
      ActionStartGame,        20,  16, 32, 32,
      ActionToggleGameType,   60,  16, 32, 32,
      ActionShowOptions,     308,  16, 32, 32,
      ActionIncrement,       284,  16, 16, 16,
      ActionDecrement,       284,  32, 16, 16,
      ActionClose,           324, 216, 16, 16,
      -1,
    ];

    const clickmapCustom = [
      ActionStartGame,        20,  16, 32, 32,
      ActionToggleGameType,   60,  16, 32, 32,
      ActionShowOptions,     308,  16, 32, 32,
      ActionIncrement,       220,  24, 24, 24,
      ActionDecrement,       220,  16,  8,  8,
      ActionGenRandom,       244,  16, 16,  8,
      ActionApplyRandom ,    244,  24, 16, 24,
      ActionClose,           324, 216, 16, 16,
      -1,
    ];

    const clickmapLoad = [
      ActionStartGame,        20,  16, 32, 32,
      ActionToggleGameType,   60,  16, 32, 32,
      ActionShowOptions,     308,  16, 32, 32,
      ActionClose,           324, 216, 16, 16,
      -1,
    ];

    let clickmap: number[] | null = null;
    switch (this.gameType) {
      case GameMission:
      case GameTutorial:
        clickmap = clickmapMission;
        break;
      case GameCustom:
        clickmap = clickmapCustom;
        break;
      case GameLoad:
        clickmap = clickmapLoad;
        break;
      default:
        return false;
    }

    let i = 0;
    while (clickmap[i] >= 0) {
      if (cx >= clickmap[i + 1] && cx < clickmap[i + 1] + clickmap[i + 3] &&
          cy >= clickmap[i + 2] && cy < clickmap[i + 2] + clickmap[i + 4]) {
        this.setRedraw();
        this.handleAction(clickmap[i]);
        return true;
      }
      i += 5;
    }

    /* Check player area */
    let lx = 0;
    let ly = 0;
    for (let i = 0; i < GAME_MAX_PLAYER_COUNT; i++) {
      const px = 20 + lx * 80;
      const py = 56 + ly * 80;
      if (cx > px && cx < px + 80 && cy > py && cy < py + 80) {
        if (this.handlePlayerClick(i, cx - px, cy - py)) {
          break;
        }
      }
      lx++;
      if (i === 1) {
        ly++;
        lx = 0;
      }
    }

    return true;
  }

  protected getNextCharacter(playerIndex: number): number {
    let inUse = false;
    const player: PPlayerInfo = this.mission.getPlayer(playerIndex);
    let next = player.getFace();
    do {
      next = (next + 1) % 14;
      next = Math.max(1, next);
      /* Check that face is not already in use by another player */
      inUse = false;
      for (let i = 0; i < this.mission.getPlayerCount(); i++) {
        if (playerIndex !== i && this.mission.getPlayer(i).getFace() === next) {
          inUse = true;
          break;
        }
      }
    } while (inUse);

    return next;
  }

  protected handlePlayerClick(playerIndex: number, cx: number, cy: number): boolean {
    if (this.gameType !== GameCustom) {
      return true;
    }

    if (cx < 8 || cx > 8 + 64 || cy < 8 || cy > 76) {
      return false;
    }

    if (cx < 8 + 32 && cy < 72) {
      if (playerIndex >= this.mission.getPlayerCount()) {
        return true;
      }
      if (this.online !== null && playerIndex < 2) {
        /* The host and the guest keep their faces. */
        return true;
      }
      const player: PPlayerInfo = this.mission.getPlayer(playerIndex);
      player.setCharacter(this.getNextCharacter(playerIndex));
    } else if (cx > 16 + 32 && cy < 24) {
      if (playerIndex >= this.mission.getPlayerCount()) {
        this.mission.addPlayer(0, { red: 0, green: 0, blue: 0 }, 20, 20, 20);
        this.mission.setDefaultColors();
        playerIndex = this.mission.getPlayerCount() - 1;
        const player: PPlayerInfo = this.mission.getPlayer(playerIndex);
        player.setCharacter(this.getNextCharacter(playerIndex));
      } else {
        if (playerIndex > (this.online !== null ? 1 : 0)) {
          this.mission.removePlayer(playerIndex);
          this.mission.setDefaultColors();
        }
      }
    } else {
      if (playerIndex >= this.mission.getPlayerCount()) {
        return true;
      }
      const player: PPlayerInfo = this.mission.getPlayer(playerIndex);
      cx -= 8 + 32 + 8 + 3;
      if (cx < 0) {
        return false;
      }
      if (cy >= 27 && cy < 69) {
        const value = clamp(0, 68 - cy, 40);
        if (cx > 0 && cx < 6) {
          /* Supplies */
          player.setSupplies(value);
        } else if (cx > 6 && cx < 12) {
          /* Intelligence */
          player.setIntelligence(value);
        } else if (cx > 12 && cx < 18) {
          /* Reproduction */
          player.setReproduction(value);
        }
      }
    }

    this.setRedraw();

    return true;
  }

  // PORT: apply_random(Random rnd) is declared in game-init.h but defined
  // and called nowhere; it is left out.

  protected generateMapPreview(): void {
    const map = new Map(new MapGeometry(this.mission.getMapSize()));
    this.map = map;
    if (this.gameType === GameMission || this.gameType === GameTutorial) {
      const generator = new ClassicMissionMapGenerator(map, this.mission.getRandomBase());
      generator.init();
      generator.generate();
      map.initTiles(generator);
    } else {
      const generator = new ClassicMapGenerator(map, this.mission.getRandomBase());
      generator.init(MapGenerator.HeightGenerator.HeightGeneratorMidpoints, true);
      generator.generate();
      map.initTiles(generator);
    }

    this.minimap.setMap(this.map);

    this.setRedraw();
  }
}
