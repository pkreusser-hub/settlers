/*
 * interface.ts - Top-level GUI interface
 *
 * Port of Freeserf's interface.h and interface.cc.
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

import { BuildingType } from '../game/building';
import type { Game, PGame, Ref } from '../game/game';
import { GameManager } from '../game/game-manager';
import type { GameManagerHandler } from '../game/game-manager';
import { cycleDirectionsCw, Map, MapObject, MapSpace, Road } from '../game/map';
import type { Direction, MapPos } from '../game/map';
import { BIT, BIT_TEST, i32, idiv, Log, NOT_REACHED, u32 } from '../game/misc';
import { MessageType } from '../game/player';
import type { Player } from '../game/player';
import { Random } from '../game/random';
import { ResourceType } from '../game/resource';
import { GameStore } from '../game/savegame';
import { getLocalPlayer, hasCommandSink, setLocalPlayer, tickGame } from '../net/command';
import {
  addCommandListener,
  canReplaceBuilding,
  cmdBuildBuilding,
  cmdBuildCastle,
  cmdBuildFlag,
  cmdBuildRoad,
  cmdDemolishBuilding,
  cmdDemolishFlag,
  cmdReplaceBuilding,
  cmdSetPaused,
  cmdSpeedDecrease,
  cmdSpeedIncrease,
  cmdSpeedReset,
  removeCommandListener,
  RoadFlag,
} from '../net/commands';
import { AdvancedBox } from './advanced-box';
import { Audio, AudioTypeSfx } from './audio';
import { Data } from './data-instance';
import { Event, EventLoop, EventType } from './event-loop';
import { TICKS_PER_SEC } from './freeserf';
import { GameInitBox } from './game-init';
import { Color, Graphics } from './gfx';
import type { Frame } from './gfx';
import { GuiObject } from './gui';
import { NotificationBox } from './notification';
import type { MinimapGame } from './minimap';
import { PanelBar } from './panel';
import { PopupBox, PopupBoxType } from './popup';
import { Translation } from './translation';
import { Viewport, ViewportLayer } from './viewport';

export const mapBuildingSprite: number[] = [
  0, 0xa7, 0xa8, 0xae, 0xa9,
  0xa3, 0xa4, 0xa5, 0xa6,
  0xaa, 0xc0, 0xab, 0x9a, 0x9c, 0x9b, 0xbc,
  0xa2, 0xa0, 0xa1, 0x99, 0x9d, 0x9e, 0x98, 0x9f, 0xb2,
];

export enum InterfaceCursorType {
  CursorTypeNone = 0,
  CursorTypeFlag,
  CursorTypeRemovableFlag,
  CursorTypeBuilding,
  CursorTypePath,
  CursorTypeClearByFlag,
  CursorTypeClearByPath,
  CursorTypeClear,
}

export enum InterfaceBuildPossibility {
  BuildPossibilityNone = 0,
  BuildPossibilityFlag,
  BuildPossibilityMine,
  BuildPossibilitySmall,
  BuildPossibilityLarge,
  BuildPossibilityCastle,
}

// PORT: not in the C++. A box of the game that the page shows as a window
// (ui/menu/kit.ts) in place of the canvas popup. The interface holds it like
// the popup: closePopup() closes it, getPopupBox() answers for it.
export interface HtmlBox {
  getBox(): number;
  /* Take the window away. Called by the interface only. */
  close(): void;
  /* A command was applied: show the new state. */
  refresh?(): void;
}

// PORT: not in the C++. What the callers of getPopupBox() use of the box
// that is open, canvas popup or window. A window has no minimap.
export interface OpenBox {
  isDisplayed(): boolean;
  getBox(): PopupBoxType;
  getMinimap(): MinimapGame | null;
}

export enum InterfaceStatAspect {
  StatAspectAll = 0,
  StatAspectLand,
  StatAspectBuildings,
  StatAspectMilitary,
}

export enum InterfaceStatScale {
  StatScale30Min = 0,
  StatScale60Min,
  StatScale600Min,
  StatScale3000Min,
}

// Interface::SpriteLoc
export interface InterfaceSpriteLoc {
  sprite: number;
  x: number;
  y: number;
}

// PORT: advanced-box.h/.cc (class AdvancedBox) is not ported. These are its
// kWidth and kHeight, used by layout().
const advancedBoxWidth = 360;
const advancedBoxHeight = 256;

// TODO(savegame): settings.h/.cc (class Settings, the config file) is not
// ported. settingsGet() gives the default value, as Settings::get() does for
// a setting that is not in the file, and settingsSet() does nothing.
function settingsGet<T>(_section: string, _key: string, defaultValue: T): T {
  return defaultValue;
}

function settingsSet(_section: string, _key: string, _value: unknown): void {}

// PORT: the values of the attack box. The C++ keeps them in the Player
// (building_attacked, knights_attacking, attacking_knights,
// total_attacking_knights, attacking_building_count); the game reads them in
// Player::start_attack(), so the box has its own here and the startAttack
// command computes the player's again.
export interface InterfaceAttack {
  pos: MapPos; /* Position of the building to attack. */
  buildingAttacked: number;
  knightsAttacking: number;
  attackingKnights: number[];
  totalAttackingKnights: number;
  attackingBuildingCount: number;
}

// PORT: the copy of a Road (`Road old_road = building_road`); the class has
// no copy method.
function copyRoad(road: Road): Road {
  const copy = new Road();
  if (road.isValid()) {
    copy.start(road.getSource());
    for (const dir of road.getDirs()) {
      copy.extend(dir);
    }
  }
  return copy;
}

export class Interface extends GuiObject implements GameManagerHandler {
  static CursorType = InterfaceCursorType;
  static BuildPossibility = InterfaceBuildPossibility;
  static StatAspect = InterfaceStatAspect;
  static StatScale = InterfaceStatScale;

  protected game: Game | null;

  protected random: Random = new Random();

  protected viewport: Viewport | null;
  protected panel: PanelBar | null;
  protected popup: PopupBox | null;
  // PORT: not in the C++. The box that is open as a window of the page, and
  // its answer for getPopupBox(). Never set while `popup` is.
  protected htmlBox: HtmlBox | null = null;
  protected htmlBoxView: OpenBox | null = null;
  protected initBox: GameInitBox | null;
  // PORT: AdvancedBox is not ported, this is always null.
  protected advancedBox: GuiObject | null;
  protected notificationBox: NotificationBox | null;

  protected mapCursorPos: MapPos;
  protected mapCursorType: InterfaceCursorType;
  protected buildPossibility: InterfaceBuildPossibility;

  protected lastConstTick: number;

  protected buildingRoad: Road = new Road();
  protected buildingRoadValidDir: number;

  protected player: Player | null;
  /* The messages shown: 3 all, 2 most, 1 few, 0 none (config bits 3, 4
     and 5 of the original). */
  protected messageLevel: number;
  protected messageWaiting: boolean; /* A message to show in the queue. */
  protected messageOpened: boolean; /* A message was opened: skip the hidden ones. */
  protected returnArrow: boolean; /* The arrow back from the message is shown. */
  /* Advanced options (not in the original game). */
  protected invertScrolling: boolean;
  protected largeNumbers: boolean;
  protected stockBoxOccupied: boolean;
  protected autosaveMinutes: number; // 0: off
  protected autosaveLastTicks: number;
  protected autosaveLastGameTick: number;

  protected mapCursorSprites: InterfaceSpriteLoc[] = [];

  protected selectedStatScale: InterfaceStatScale;
  protected selectedStatAspect: InterfaceStatAspect;
  protected selectedStatResource: ResourceType;

  protected returnTimeout: number;
  protected returnPos: number;

  /* Frames per second display (Ctrl+Shift+F). */
  protected showFps: boolean;
  protected fps: number;
  protected fpsFrames: number;
  protected fpsStart: number;

  // PORT: see InterfaceAttack.
  attack: InterfaceAttack = {
    pos: 0,
    buildingAttacked: 0,
    knightsAttacking: 0,
    attackingKnights: [0, 0, 0, 0],
    totalAttackingKnights: 0,
    attackingBuildingCount: 0,
  };

  // PORT: a command was applied to the game since the last update. In a
  // network game a command runs some updates after it was issued (and the
  // other player's commands arrive at any time), so what was derived from
  // the game state is derived again: see update().
  protected commandApplied = false;
  protected commandListener = (): void => {
    this.commandApplied = true;
  };

  constructor() {
    super();
    this.buildingRoadValidDir = 0;
    this.returnPos = 0;
    this.displayed = true;

    this.game = null;

    this.mapCursorPos = 0;
    this.mapCursorType = 0 as InterfaceCursorType;
    this.buildPossibility = InterfaceBuildPossibility.BuildPossibilityNone;

    this.player = null;

    /* Settings */
    this.messageLevel = 3;
    this.messageWaiting = false;
    this.messageOpened = false;
    this.returnArrow = false;
    this.invertScrolling = false;
    this.largeNumbers = false;
    this.stockBoxOccupied = false;
    this.autosaveMinutes = 5; // PORT: not in the C++. On unless turned off.
    this.autosaveLastTicks = 0;
    this.autosaveLastGameTick = 0;
    this.returnTimeout = 0;

    this.selectedStatScale = InterfaceStatScale.StatScale30Min;
    this.selectedStatAspect = InterfaceStatAspect.StatAspectAll;
    this.selectedStatResource = ResourceType.TypePlank;

    for (let i = 0; i < 7; i++) {
      this.mapCursorSprites.push({ sprite: 0, x: 0, y: 0 });
    }
    this.mapCursorSprites[0].sprite = 32;
    this.mapCursorSprites[1].sprite = 33;
    this.mapCursorSprites[2].sprite = 33;
    this.mapCursorSprites[3].sprite = 33;
    this.mapCursorSprites[4].sprite = 33;
    this.mapCursorSprites[5].sprite = 33;
    this.mapCursorSprites[6].sprite = 33;

    this.lastConstTick = 0;

    this.showFps = false;
    this.fps = 0;
    this.fpsFrames = 0;
    this.fpsStart = 0;

    this.viewport = null;
    this.panel = null;
    this.popup = null;
    this.initBox = null;
    this.advancedBox = null;
    this.notificationBox = null;

    addCommandListener(this.commandListener);

    GameManager.getInstance().addHandler(this);
    this.setGame(GameManager.getInstance().getCurrentGame());
  }

  // PORT: the destructor.
  override destroy(): void {
    GameManager.getInstance().delHandler(this);
    removeCommandListener(this.commandListener);
    this.setGame(null);

    if (this.viewport !== null) this.viewport.destroy();
    if (this.panel !== null) this.panel.destroy();
    if (this.popup !== null) this.popup.destroy();
    this.dropHtmlBox();
    if (this.initBox !== null) this.initBox.destroy();
    if (this.advancedBox !== null) this.advancedBox.destroy();
    if (this.notificationBox !== null) this.notificationBox.destroy();

    super.destroy();
  }

  // PORT: PGame is a shared_ptr that may be empty; the PGame type of game.ts
  // has no null, so test the result (`if (!iface.getGame())`) where the C++
  // does.
  getGame(): PGame {
    return this.game as PGame;
  }

  getViewport(): Viewport | null {
    return this.viewport;
  }

  getPanelBar(): PanelBar | null {
    return this.panel;
  }

  // PORT: PopupBox* in the C++. A box that is open as a window of the page
  // answers too: it is displayed, has the type of the box and no minimap.
  getPopupBox(): OpenBox | null {
    return this.popup ?? this.htmlBoxView;
  }

  getNotificationBox(): NotificationBox | null {
    return this.notificationBox;
  }

  getMessageLevel(): number {
    return this.messageLevel;
  }
  /* All, most, few, none, all again. */
  nextMessageLevel(): void {
    this.messageLevel = this.messageLevel === 0 ? 3 : this.messageLevel - 1;
  }
  /* Mouse dragging moves the map vertically the other way. */
  getInvertScrolling(): boolean {
    return this.invertScrolling;
  }
  switchInvertScrolling(): void {
    this.invertScrolling = !this.invertScrolling;
  }
  /* Counts over 999 in the boxes shortened (15K, .2M) instead of >999. */
  getLargeNumbers(): boolean {
    return this.largeNumbers;
  }
  switchLargeNumbers(): void {
    this.largeNumbers = !this.largeNumbers;
  }
  /* A new stock opens its building box until its serf has arrived, not
     the inventory box. */
  getStockBoxOccupied(): boolean {
    return this.stockBoxOccupied;
  }
  switchStockBoxOccupied(): void {
    this.stockBoxOccupied = !this.stockBoxOccupied;
  }
  /* Data source of the graphics, the sounds and the music (when the data
     of several versions is installed, see DataSourceMixed). */
  nextGraphicsSource(): void {
    this.nextDataSource(0);
  }
  nextSoundSource(): void {
    this.nextDataSource(1);
  }
  nextMusicSource(): void {
    this.nextDataSource(2);
  }

  /* Save the game every few minutes into one file (0: off). */
  getAutosaveMinutes(): number {
    return this.autosaveMinutes;
  }

  getMapCursorPos(): MapPos {
    return this.mapCursorPos;
  }
  getMapCursorType(): InterfaceCursorType {
    return this.mapCursorType;
  }
  getMapCursorSprite(i: number): number {
    return this.mapCursorSprites[i].sprite;
  }

  getRandom(): Random {
    return this.random;
  }

  hasReturnArrow(): boolean {
    return this.returnArrow;
  }

  getSelectedStatScale(): InterfaceStatScale {
    return this.selectedStatScale;
  }
  setSelectedStatScale(scale: InterfaceStatScale): void {
    this.selectedStatScale = scale;
  }
  getSelectedStatAspect(): InterfaceStatAspect {
    return this.selectedStatAspect;
  }
  setSelectedStatAspect(aspect: InterfaceStatAspect): void {
    this.selectedStatAspect = aspect;
  }
  getSelectedStatResource(): ResourceType {
    return this.selectedStatResource;
  }
  setSelectedStatResource(item: ResourceType): void {
    this.selectedStatResource = item;
  }

  getBuildPossibility(): InterfaceBuildPossibility {
    return this.buildPossibility;
  }

  getPlayer(): Player | null {
    return this.player;
  }

  isBuildingRoad(): boolean {
    return this.buildingRoad.isValid();
  }
  getBuildingRoad(): Road {
    return this.buildingRoad;
  }
  buildRoadReset(): void {
    this.buildRoadEnd();
    this.buildRoadBegin();
  }
  buildRoadIsValidDir(dir: Direction): boolean {
    return BIT_TEST(this.buildingRoadValidDir, dir) !== 0;
  }

  /* Open popup box */
  openPopup(box: number): void {
    // PORT: not in the C++. The menus of the page (ui/menu, build-menu.ts)
    // take the place of the boxes they have registered.
    if (this.popupHook !== null && this.popupHook(box, false)) {
      if (this.panel !== null) {
        this.panel.update();
      }
      return;
    }
    // PORT: not in the C++. The canvas popup replaces a window of the page.
    this.dropHtmlBox();
    if (this.popup === null) {
      this.popup = new PopupBox(this);
      this.addFloat(this.popup, 0, 0);
    }
    this.layout();
    this.popup.show(box as PopupBoxType);
    if (this.panel !== null) {
      this.panel.update();
    }
  }

  /* Close the current popup. */
  closePopup(): void {
    // PORT: a window of the page is closed the same way.
    if (this.popup === null && this.htmlBox === null) {
      return;
    }
    this.dropCanvasPopup();
    this.dropHtmlBox();
    this.updateMapCursorPos(this.mapCursorPos);
    if (this.panel !== null) {
      this.panel.update();
    }
  }

  // PORT: not in the C++. The body of close_popup() for the canvas popup.
  protected dropCanvasPopup(): void {
    if (this.popup === null) {
      return;
    }
    this.popup.hide();
    this.delFloat(this.popup);
    this.popup.destroy();
    this.popup = null;
  }

  // PORT: not in the C++.
  protected dropHtmlBox(): void {
    const box = this.htmlBox;
    if (box === null) {
      return;
    }
    this.htmlBox = null;
    this.htmlBoxView = null;
    box.close();
  }

  // PORT: not in the C++. A window of the page becomes the open box: it
  // replaces the canvas popup or the window before it, as show() of the
  // popup replaces its box (the panel sees no moment without a box).
  openHtmlBox(box: HtmlBox): void {
    this.dropCanvasPopup();
    this.dropHtmlBox();
    this.htmlBox = box;
    this.htmlBoxView = {
      isDisplayed: () => true,
      getBox: () => box.getBox() as PopupBoxType,
      getMinimap: () => null,
    };
    if (this.panel !== null) {
      this.panel.update();
    }
  }

  getHtmlBox(): HtmlBox | null {
    return this.htmlBox;
  }

  /* Open box for starting a new game */
  openGameInit(): void {
    if (this.initBox === null) {
      this.initBox = new GameInitBox(this);
      this.addFloat(this.initBox, 0, 0);
    }
    this.initBox.setDisplayed(true);
    this.initBox.setEnabled(true);
    if (this.panel !== null) {
      this.panel.setDisplayed(false);
    }
    this.viewport!.setEnabled(false);
    this.layout();
  }

  // PORT: not in the C++. The game init box with the saved games.
  openGameLoad(): void {
    this.openGameInit();
    this.initBox!.showLoad();
  }

  /* Settings kept between the runs (Settings): the options of the options
     and advanced boxes. */
  // TODO(savegame): there is no config file, every setting has its default.
  applySettings(): void {
    const audio = Audio.getInstance();
    const music = audio.getMusicPlayer();
    /* Without a setting the current state stays. */
    if (music) {
      music.enable(settingsGet('options', 'music', music.isEnabled()));
    }
    const sound = audio.getSoundPlayer();
    if (sound) {
      sound.enable(settingsGet('options', 'sound', sound.isEnabled()));
    }
    const volume = audio.getVolumeController();
    if (volume !== null) {
      const current = Math.trunc(Math.fround(Math.fround(volume.getVolume() * 100) + 0.5));
      volume.setVolume(Math.fround(settingsGet('options', 'volume', current) / 100));
    }

    /* Messages: 3 all, 2 most, 1 few, 0 none. */
    this.messageLevel = Math.max(
      0,
      Math.min(3, settingsGet('options', 'messages', this.messageLevel)),
    );

    this.invertScrolling = settingsGet('advanced', 'invert_scrolling', false);
    this.largeNumbers = settingsGet('advanced', 'large_numbers', false);
    this.stockBoxOccupied = settingsGet('advanced', 'stock_box_occupied', false);
    this.autosaveMinutes = settingsGet('advanced', 'autosave', 5);
    Translation.getInstance().setLanguage(settingsGet('advanced', 'language', ''));

    /* Data source of each category, by name (DOS, Amiga, Custom). */
    // PORT: there is no DataSourceMixed (DOS data only). The C++ calls
    // select_data_source(cat, kind) for the source named by the settings
    // "data", "graphics" / "sound" / "music"; without a setting none is
    // named.
  }

  // TODO(savegame): there is no config file, nothing is stored.
  storeSettings(): void {
    const audio = Audio.getInstance();
    const music = audio.getMusicPlayer();
    if (music) settingsSet('options', 'music', music.isEnabled());
    const sound = audio.getSoundPlayer();
    if (sound) settingsSet('options', 'sound', sound.isEnabled());
    const volume = audio.getVolumeController();
    if (volume !== null) {
      settingsSet(
        'options',
        'volume',
        Math.trunc(Math.fround(Math.fround(volume.getVolume() * 100) + 0.5)),
      );
    }
    settingsSet('options', 'fullscreen', Graphics.getInstance().isFullscreen());

    settingsSet('options', 'messages', this.messageLevel);

    settingsSet('advanced', 'invert_scrolling', this.invertScrolling);
    settingsSet('advanced', 'large_numbers', this.largeNumbers);
    settingsSet('advanced', 'stock_box_occupied', this.stockBoxOccupied);
    settingsSet('advanced', 'autosave', this.autosaveMinutes);
    settingsSet('advanced', 'language', Translation.getInstance().getLanguage());
    if (Data.getInstance().getMixedSource()) {
      settingsSet('data', 'graphics', this.getDataSourceName(0));
      settingsSet('data', 'sound', this.getDataSourceName(1));
      settingsSet('data', 'music', this.getDataSourceName(2));
    }

    // TODO(savegame): settings.save()
  }

  /* Box of the advanced options; closing it closes the options too. */
  openAdvanced(): void {
    if (this.advancedBox === null) {
      this.advancedBox = new AdvancedBox(this);
      this.addFloat(this.advancedBox, 0, 0);
    }
    this.advancedBox.setDisplayed(true);
    this.advancedBox.setEnabled(true);
    if (this.panel !== null) {
      this.panel.setEnabled(false);
    }
    this.viewport!.setEnabled(false);
    this.layout();
  }

  closeAdvanced(): void {
    if (this.advancedBox !== null) {
      this.advancedBox.setDisplayed(false);
      this.delFloat(this.advancedBox);
      this.advancedBox.destroy();
      this.advancedBox = null;
    }
    if (this.panel !== null) {
      this.panel.setEnabled(true);
    }
    this.viewport!.setEnabled(true);
    this.closePopup();
    this.layout();
    this.storeSettings();
  }

  closeGameInit(): void {
    if (this.initBox !== null) {
      this.initBox.setDisplayed(false);
      this.delFloat(this.initBox);
      this.initBox.destroy();
      this.initBox = null;
    }
    if (this.panel !== null) {
      this.panel.setDisplayed(true);
      this.panel.setEnabled(true);
    }
    this.viewport!.setEnabled(true);
    this.layout();

    this.updateMapCursorPos(this.mapCursorPos);
  }

  /* Open box for next message in the message queue */
  openMessage(): void {
    const player = this.player!;
    if (!player.hasNotification()) {
      this.playSound(AudioTypeSfx.TypeSfxClick);
      return;
    } else if (!this.returnArrow) {
      this.returnArrow = true;
      const pos = this.viewport!.getCurrentMapPos();
      this.returnPos = pos;
    }

    const message = player.popNotification();

    if (message.type === MessageType.TypeCallToMenu) {
      /* TODO */
    }

    if (this.notificationBox === null) {
      this.notificationBox = new NotificationBox(this);
      this.addFloat(this.notificationBox, 0, 0);
    }
    this.notificationBox.show(message);
    this.layout();

    if (BIT_TEST(0x8f3fe, message.type)) {
      /* Move screen to new position */
      this.viewport!.moveToMapPos(message.pos);
      this.updateMapCursorPos(message.pos);
    }

    this.messageOpened = true;
    this.returnTimeout = 60 * TICKS_PER_SEC;
    this.playSound(AudioTypeSfx.TypeSfxClick);
  }

  /* Whether a message of the type is shown at the message level: some
     always, the others from all (3), most (2) or few (1) messages. */
  showsMessage(type: MessageType): boolean {
    /* The least level that shows the type, 0 always (the config bits of the
       original, 3 to 5, for the levels 3 to 1). */
    const leastLevel = [
      4, 1, 1, 1, 2, 0, 2, 3, 2, 1,
      1, 1, 2, 2, 2, 2, 0, 0, 0, 0,
    ];
    return this.messageLevel >= leastLevel[type];
  }

  returnFromMessage(): void {
    if (this.returnArrow) {
      this.returnArrow = false;

      this.returnTimeout = 0;
      this.viewport!.moveToMapPos(this.returnPos);

      const box = this.getPopupBox();
      if (box !== null && box.getBox() === PopupBoxType.TypeMessage) {
        this.closePopup();
      }
      this.playSound(AudioTypeSfx.TypeSfxClick);
    }
  }

  closeMessage(): void {
    if (this.notificationBox === null) {
      return;
    }

    this.notificationBox.setDisplayed(false);
    this.delFloat(this.notificationBox);
    this.notificationBox.destroy();
    this.notificationBox = null;
    this.layout();
  }

  /* Return the cursor type and various related values of a MapPos. */
  // PORT: the overload get_map_cursor_type(player, pos, &bld_possibility,
  // &cursor_type). The out-parameters are the box objects bldPossibility and
  // cursorType: a value that the C++ leaves alone stays as it is.
  protected getMapCursorTypeAt(
    player_: Player | null,
    pos: MapPos,
    bldPossibility: Ref<InterfaceBuildPossibility>,
    cursorType: Ref<InterfaceCursorType>,
  ): void {
    const game = this.game!;
    const map = game.getMap();
    if (player_ === null) {
      bldPossibility.value = InterfaceBuildPossibility.BuildPossibilityNone;
      cursorType.value = InterfaceCursorType.CursorTypeClear;
      return;
    }

    if (game.canBuildCastle(pos, player_)) {
      bldPossibility.value = InterfaceBuildPossibility.BuildPossibilityCastle;
    } else if (
      game.canPlayerBuild(pos, player_) &&
      Map.mapSpaceFromObj[map.getObj(pos)] === MapSpace.SpaceOpen &&
      (game.canBuildFlag(map.moveDownRight(pos), player_) || map.hasFlag(map.moveDownRight(pos)))
    ) {
      if (game.canBuildMine(pos)) {
        bldPossibility.value = InterfaceBuildPossibility.BuildPossibilityMine;
      } else if (game.canBuildLarge(pos)) {
        bldPossibility.value = InterfaceBuildPossibility.BuildPossibilityLarge;
      } else if (game.canBuildSmall(pos)) {
        bldPossibility.value = InterfaceBuildPossibility.BuildPossibilitySmall;
      } else if (game.canBuildFlag(pos, player_)) {
        bldPossibility.value = InterfaceBuildPossibility.BuildPossibilityFlag;
      } else {
        bldPossibility.value = InterfaceBuildPossibility.BuildPossibilityNone;
      }
    } else if (game.canBuildFlag(pos, player_)) {
      bldPossibility.value = InterfaceBuildPossibility.BuildPossibilityFlag;
    } else {
      bldPossibility.value = InterfaceBuildPossibility.BuildPossibilityNone;
    }

    if (map.getObj(pos) === MapObject.ObjectFlag && map.getOwner(pos) === player_.getIndex()) {
      if (game.canDemolishFlag(pos, player_)) {
        cursorType.value = InterfaceCursorType.CursorTypeRemovableFlag;
      } else {
        cursorType.value = InterfaceCursorType.CursorTypeFlag;
      }
    } else if (!map.hasBuilding(pos) && !map.hasFlag(pos)) {
      const paths = map.paths(pos);
      if (paths === 0) {
        if (map.getObj(map.moveDownRight(pos)) === MapObject.ObjectFlag) {
          cursorType.value = InterfaceCursorType.CursorTypeClearByFlag;
        } else if (map.paths(map.moveDownRight(pos)) === 0) {
          cursorType.value = InterfaceCursorType.CursorTypeClear;
        } else {
          cursorType.value = InterfaceCursorType.CursorTypeClearByPath;
        }
      } else if (map.getOwner(pos) === player_.getIndex()) {
        cursorType.value = InterfaceCursorType.CursorTypePath;
      } else {
        cursorType.value = InterfaceCursorType.CursorTypeNone;
      }
    } else if (
      (map.getObj(pos) === MapObject.ObjectSmallBuilding ||
        map.getObj(pos) === MapObject.ObjectLargeBuilding) &&
      map.getOwner(pos) === player_.getIndex()
    ) {
      const bld = game.getBuildingAtPos(pos)!;
      if (!bld.isBurning()) {
        cursorType.value = InterfaceCursorType.CursorTypeBuilding;
        /* The build button offers the site's size for replacing the
           building by a special click (as in the original game). */
        switch (game.getReplaceSiteClass(pos, player_)) {
          case 0:
            bldPossibility.value = InterfaceBuildPossibility.BuildPossibilityMine;
            break;
          case 1:
            bldPossibility.value = InterfaceBuildPossibility.BuildPossibilitySmall;
            break;
          case 2:
            bldPossibility.value = InterfaceBuildPossibility.BuildPossibilityLarge;
            break;
          default:
            break;
        }
      } else {
        cursorType.value = InterfaceCursorType.CursorTypeNone;
      }
    } else {
      cursorType.value = InterfaceCursorType.CursorTypeNone;
    }
  }

  /* Update the interface_t object with the information returned
     in get_map_cursor_type(). */
  protected determineMapCursorType(): void {
    const bldPossibility: Ref<InterfaceBuildPossibility> = { value: this.buildPossibility };
    const cursorType: Ref<InterfaceCursorType> = { value: this.mapCursorType };
    this.getMapCursorTypeAt(this.player, this.mapCursorPos, bldPossibility, cursorType);
    this.buildPossibility = bldPossibility.value;
    this.mapCursorType = cursorType.value;
  }

  /* Update the interface_t object with the information returned
     in get_map_cursor_type(). This is sets the appropriate values
     when the player interface is in road construction mode. */
  protected determineMapCursorTypeRoad(): void {
    const game = this.game!;
    const map = game.getMap();
    const pos = this.mapCursorPos;
    const h = map.getHeight(pos);
    let validDir = 0;

    for (const d of cycleDirectionsCw()) {
      let sprite = 0;

      if (this.buildingRoad.isUndo(d)) {
        sprite = 45; /* undo */
        validDir |= BIT(d);
      } else if (map.isRoadSegmentValid(pos, d)) {
        if (this.buildingRoad.isValidExtension(map, d)) {
          const hDiff = map.getHeight(map.move(pos, d)) - h;
          sprite = 39 + hDiff; /* height indicators */
          validDir |= BIT(d);
        } else {
          sprite = 44;
        }
      } else if (
        game.canJoinRoad(pos, d, this.player!) &&
        this.buildingRoad.isValidExtension(map, d)
      ) {
        /* An existing road can be joined by a special click. */
        const hDiff = map.getHeight(map.move(pos, d)) - h;
        sprite = 39 + hDiff;
        validDir |= BIT(d);
      } else {
        sprite = 44; /* striped */
      }
      this.mapCursorSprites[d + 1].sprite = sprite;
    }

    this.buildingRoadValidDir = validDir;
  }

  /* Set the appropriate sprites for the panel buttons and the map cursor. */
  protected updateInterface(): void {
    if (!this.buildingRoad.isValid()) {
      switch (this.mapCursorType) {
        case InterfaceCursorType.CursorTypeNone:
          this.mapCursorSprites[0].sprite = 32;
          this.mapCursorSprites[2].sprite = 33;
          break;
        case InterfaceCursorType.CursorTypeFlag:
          this.mapCursorSprites[0].sprite = 51;
          this.mapCursorSprites[2].sprite = 33;
          break;
        case InterfaceCursorType.CursorTypeRemovableFlag:
          this.mapCursorSprites[0].sprite = 51;
          this.mapCursorSprites[2].sprite = 33;
          break;
        case InterfaceCursorType.CursorTypeBuilding:
          this.mapCursorSprites[0].sprite = 32;
          this.mapCursorSprites[2].sprite = 33;
          break;
        case InterfaceCursorType.CursorTypePath:
          this.mapCursorSprites[0].sprite = 52;
          this.mapCursorSprites[2].sprite = 33;
          if (this.buildPossibility !== InterfaceBuildPossibility.BuildPossibilityNone) {
            this.mapCursorSprites[0].sprite = 47;
          }
          break;
        case InterfaceCursorType.CursorTypeClearByFlag:
          if (this.buildPossibility < InterfaceBuildPossibility.BuildPossibilityMine) {
            this.mapCursorSprites[0].sprite = 32;
            this.mapCursorSprites[2].sprite = 33;
          } else {
            this.mapCursorSprites[0].sprite = 46 + this.buildPossibility;
            this.mapCursorSprites[2].sprite = 33;
          }
          break;
        case InterfaceCursorType.CursorTypeClearByPath:
          if (this.buildPossibility !== InterfaceBuildPossibility.BuildPossibilityNone) {
            this.mapCursorSprites[0].sprite = 46 + this.buildPossibility;
            if (this.buildPossibility === InterfaceBuildPossibility.BuildPossibilityFlag) {
              this.mapCursorSprites[2].sprite = 33;
            } else {
              this.mapCursorSprites[2].sprite = 47;
            }
          } else {
            this.mapCursorSprites[0].sprite = 32;
            this.mapCursorSprites[2].sprite = 33;
          }
          break;
        case InterfaceCursorType.CursorTypeClear:
          if (this.buildPossibility) {
            if (this.buildPossibility === InterfaceBuildPossibility.BuildPossibilityCastle) {
              this.mapCursorSprites[0].sprite = 50;
            } else {
              this.mapCursorSprites[0].sprite = 46 + this.buildPossibility;
            }
            if (this.buildPossibility === InterfaceBuildPossibility.BuildPossibilityFlag) {
              this.mapCursorSprites[2].sprite = 33;
            } else {
              this.mapCursorSprites[2].sprite = 47;
            }
          } else {
            this.mapCursorSprites[0].sprite = 32;
            this.mapCursorSprites[2].sprite = 33;
          }
          break;
        default:
          NOT_REACHED();
          break;
      }
    }

    if (this.panel !== null) {
      this.panel.update();
    }
  }

  setGame(newGame: Game | null): void {
    if (this.viewport !== null) {
      this.delFloat(this.viewport);
      this.viewport.destroy();
      this.viewport = null;
    }

    // PORT: not in the C++. A window of the page shows the old game.
    this.dropHtmlBox();

    this.game = newGame;
    this.autosaveLastTicks = EventLoop.getInstance().getTicks();
    this.autosaveLastGameTick = 0;

    if (this.game) {
      this.viewport = new Viewport(this, this.game.getMap());
      this.viewport.setDisplayed(true);
      this.addFloat(this.viewport, 0, 0);
    }

    this.layout();

    // PORT: set_player(0) in the C++. The player of this browser is the
    // local player of the command layer (0 unless a network game says
    // otherwise).
    let playerIndex = getLocalPlayer();
    if (this.game && !hasCommandSink() && this.game.getPlayer(playerIndex) === null) {
      /* The local player was switched with 'j' in a game before. */
      playerIndex = 0;
      setLocalPlayer(0);
    }
    this.setPlayer(playerIndex);
  }

  /* Move the view and the map cursor to the player's castle (special click
     on the map button, as viewport_move_to_castle of the original). */
  moveToCastle(): void {
    if (!this.game || this.player === null) {
      return;
    }

    for (const building of this.game.getPlayerBuildings(this.player)) {
      if (building.getType() === BuildingType.TypeCastle) {
        this.updateMapCursorPos(building.getPosition());
        this.viewport!.moveToMapPos(this.mapCursorPos);
        return;
      }
    }
  }

  setPlayer(playerIndex: number): void {
    /* Nothing to do for the current player (checked before the panel is
       removed, or it would not be created again). */
    if (
      this.game &&
      this.player !== null &&
      this.panel !== null &&
      playerIndex === this.player.getIndex()
    ) {
      return;
    }

    if (this.panel !== null) {
      this.delFloat(this.panel);
      this.panel.destroy();
      this.panel = null;
    }

    if (!this.game) {
      this.player = null;
      return;
    }

    this.player = this.game.getPlayer(playerIndex);

    /* Move viewport to initial position */
    let initPos = this.game.getMap().pos(0, 0);

    if (this.player !== null) {
      this.panel = new PanelBar(this);
      this.panel.setDisplayed(true);
      this.addFloat(this.panel, 0, 0);
      this.layout();

      for (const building of this.game.getPlayerBuildings(this.player)) {
        if (building.getType() === BuildingType.TypeCastle) {
          initPos = building.getPosition();
        }
      }
    }

    this.updateMapCursorPos(initPos);
    this.viewport!.moveToMapPos(this.mapCursorPos);
  }

  getPlayerColor(playerIndex: number): Color {
    const playerColor = this.game!.getPlayer(playerIndex)!.getColor();
    const color = new Color(playerColor.red, playerColor.green, playerColor.blue);
    return color;
  }

  updateMapCursorPos(pos: MapPos): void {
    this.mapCursorPos = pos;
    if (this.buildingRoad.isValid()) {
      this.determineMapCursorTypeRoad();
    } else {
      this.determineMapCursorType();
    }
    this.updateInterface();
  }

  /* Start road construction mode for player interface. */
  buildRoadBegin(): void {
    this.determineMapCursorType();

    if (
      this.mapCursorType !== InterfaceCursorType.CursorTypeFlag &&
      this.mapCursorType !== InterfaceCursorType.CursorTypeRemovableFlag
    ) {
      this.updateInterface();
      return;
    }

    this.buildingRoad.invalidate();
    this.buildingRoad.start(this.mapCursorPos);
    this.updateMapCursorPos(this.mapCursorPos);

    this.panel!.update();
  }

  /* End road construction mode for player interface. */
  buildRoadEnd(): void {
    this.mapCursorSprites[1].sprite = 33;
    this.mapCursorSprites[2].sprite = 33;
    this.mapCursorSprites[3].sprite = 33;
    this.mapCursorSprites[4].sprite = 33;
    this.mapCursorSprites[5].sprite = 33;
    this.mapCursorSprites[6].sprite = 33;

    this.buildingRoad.invalidate();
    this.updateMapCursorPos(this.mapCursorPos);

    this.panel!.update();
  }

  /* Build a single road segment. Return -1 on fail, 0 on successful
     construction, and 1 if this segment completed the path. */
  buildRoadSegment(dir: Direction, special: boolean = false): number {
    if (!this.buildingRoad.isExtendable()) {
      /* Max length reached */
      return -1;
    }

    const game = this.game!;
    const player = this.player!;

    /* A step onto an existing road (paths, no flag) joins it with a special
       click, as in the original game: a flag is built there, which splits
       that road, and the new road ends at it. A normal click is refused. */
    const map = game.getMap();
    const target = map.move(this.mapCursorPos, dir);
    if (map.paths(target) !== 0 && !map.hasFlag(target)) {
      if (!special || !game.canJoinRoad(this.mapCursorPos, dir, player)) {
        return -1;
      }

      // PORT: the C++ builds the flag here (game->build_flag(target)), goes
      // on below with the flag in place and connects the road to it. The
      // flag and the road are one command now, and the result is decided
      // before: the road up to the cursor is valid (every step was
      // checked), can_join_road() has checked the last step and the flag,
      // and what is left of can_build_road() is that a road is not partly
      // in water.
      let valid = true;
      if (this.buildingRoad.getLength() > 0) {
        const water: Ref<boolean> = { value: false };
        valid =
          game.canBuildRoad(this.buildingRoad, player, null, water) > 0 &&
          map.roadSegmentInWater(this.mapCursorPos, dir) === water.value;
      }

      this.buildingRoad.extend(dir);
      cmdBuildRoad(game, this.buildingRoad, RoadFlag.Join);

      if (!valid) {
        /* Invalid construction, undo (the flag is built, as before). */
        return this.removeRoadSegment();
      }

      this.buildRoadEnd();
      this.updateMapCursorPos(target);
      return 1;
    }

    this.buildingRoad.extend(dir);

    // PORT: `MapPos dest;` is not initialized in the C++.
    const dest: Ref<MapPos> = { value: 0 };
    const r = game.canBuildRoad(this.buildingRoad, player, dest, null);
    if (r <= 0) {
      /* Invalid construction, undo. */
      return this.removeRoadSegment();
    }

    if (game.getMap().getObj(dest.value) === MapObject.ObjectFlag) {
      /* Existing flag at destination, try to connect. */
      // PORT: the C++ returns -1 if game->build_road() fails. The road was
      // just validated by can_build_road() and the command runs later, so
      // the result is not waited for.
      cmdBuildRoad(game, this.buildingRoad, RoadFlag.None);
      this.buildRoadEnd();
      this.updateMapCursorPos(dest.value);
      return 1;
    } else if (game.getMap().paths(dest.value) === 0) {
      /* No existing paths at destination, build segment. A special click
         also builds a flag there and finishes the road. */
      if (special && game.canBuildFlag(dest.value, player)) {
        cmdBuildRoad(game, this.buildingRoad, RoadFlag.End);
        this.buildRoadEnd();
        this.updateMapCursorPos(dest.value);
        return 1;
      }

      this.updateMapCursorPos(dest.value);

      /* TODO Pathway scrolling */
    } else {
      return -1;
    }

    return 0;
  }

  removeRoadSegment(): number {
    const dest: Ref<MapPos> = { value: this.buildingRoad.getSource() };
    let res = 0;
    this.buildingRoad.undo();
    if (
      this.buildingRoad.getLength() === 0 ||
      this.game!.canBuildRoad(this.buildingRoad, this.player!, dest, null) === 0
    ) {
      /* Road construction is no longer valid, abort. */
      this.buildRoadEnd();
      res = -1;
    }

    this.updateMapCursorPos(dest.value);

    /* TODO Pathway scrolling */

    return res;
  }

  /* Extend currently constructed road with an array of directions. */
  extendRoad(road: Road): number {
    const oldRoad = copyRoad(this.buildingRoad);
    for (const dir of road.getDirs()) {
      const r = this.buildRoadSegment(dir);
      if (r < 0) {
        this.buildingRoad = copyRoad(oldRoad);
        return -1;
      } else if (r === 1) {
        this.buildingRoad.invalidate();
        return 1;
      }
    }

    return 0;
  }

  demolishObject(): void {
    this.determineMapCursorType();

    const game = this.game!;

    if (this.mapCursorType === InterfaceCursorType.CursorTypeRemovableFlag) {
      this.playSound(AudioTypeSfx.TypeSfxClick);
      cmdDemolishFlag(game, this.mapCursorPos);
    } else if (this.mapCursorType === InterfaceCursorType.CursorTypeBuilding) {
      const building = game.getBuildingAtPos(this.mapCursorPos)!;

      if (
        building.isDone() &&
        (building.getType() === BuildingType.TypeHut ||
          building.getType() === BuildingType.TypeTower ||
          building.getType() === BuildingType.TypeFortress)
      ) {
        /* TODO */
      }

      this.playSound(AudioTypeSfx.TypeSfxAhhh);
      cmdDemolishBuilding(game, this.mapCursorPos);
    } else {
      this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
      this.updateInterface();
    }
  }

  /* Build new flag. */
  buildFlag(): void {
    if (!this.game!.canBuildFlag(this.mapCursorPos, this.player!)) {
      this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
      return;
    }
    cmdBuildFlag(this.game!, this.mapCursorPos);

    this.updateMapCursorPos(this.mapCursorPos);
  }

  /* Build a new building. */
  buildBuilding(type: BuildingType, special: boolean = false): void {
    const game = this.game!;
    const player = this.player!;

    if (this.mapCursorType === InterfaceCursorType.CursorTypeBuilding) {
      /* Only a special click replaces the building at the cursor. */
      if (!special) {
        return;
      }
      if (!canReplaceBuilding(game, this.mapCursorPos, type, player)) {
        this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
        return;
      }
      cmdReplaceBuilding(game, this.mapCursorPos, type);
      this.playSound(AudioTypeSfx.TypeSfxAccepted);
      this.closePopup();
      this.determineMapCursorType();
      return;
    }

    if (!game.canBuildBuilding(this.mapCursorPos, type, player)) {
      this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
      return;
    }
    cmdBuildBuilding(game, this.mapCursorPos, type);

    this.playSound(AudioTypeSfx.TypeSfxAccepted);
    this.closePopup();

    /* Move cursor to flag. */
    const flagPos = game.getMap().moveDownRight(this.mapCursorPos);
    this.updateMapCursorPos(flagPos);
  }

  /* Build castle. */
  buildCastle(): void {
    if (!this.game!.canBuildCastle(this.mapCursorPos, this.player!)) {
      this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
      return;
    }
    cmdBuildCastle(this.game!, this.mapCursorPos);

    this.playSound(AudioTypeSfx.TypeSfxAccepted);
    this.updateMapCursorPos(this.mapCursorPos);
  }

  // PORT: the caller (a double click on the end of the road) has built a
  // flag at the cursor in the C++, and the flag is demolished here if the
  // road fails. The flag, the road and the demolition are one command
  // (RoadFlag.EndOrUndo); the caller only checks that the flag can be built
  // and the road is checked here before.
  buildRoad(): void {
    const game = this.game!;
    const r =
      this.buildingRoad.getLength() > 0 &&
      game.canBuildRoad(this.buildingRoad, this.player!, null, null) > 0;
    cmdBuildRoad(game, this.buildingRoad, RoadFlag.EndOrUndo);
    if (!r) {
      this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
    } else {
      this.playSound(AudioTypeSfx.TypeSfxAccepted);
      this.buildRoadEnd();
    }
  }

  protected static updateMapHeight(pos: MapPos, data: unknown): void {
    const iface = data as Interface;
    iface.viewport!.redrawMapPos(pos);
  }

  protected internalDraw(): void {}

  protected override layout(): void {
    let panelX = 0;
    let panelY = this.height;

    if (this.panel !== null) {
      const panelWidth = 352;
      const panelHeight = 40;
      panelX = idiv(this.width - panelWidth, 2);
      panelY = this.height - panelHeight;
      this.panel.moveTo(panelX, panelY);
      this.panel.setSize(panelWidth, panelHeight);
    }

    if (this.popup !== null) {
      const popupWidth = 144;
      const popupHeight = 160;
      const popupX = idiv(this.width - popupWidth, 2);
      const popupY = idiv(this.height - popupHeight, 2);
      this.popup.moveTo(popupX, popupY);
      this.popup.setSize(popupWidth, popupHeight);
    }

    if (this.initBox !== null) {
      const initBoxWidth = 360;
      const initBoxHeight = 256;
      const initBoxX = idiv(this.width - initBoxWidth, 2);
      const initBoxY = idiv(this.height - initBoxHeight, 2);
      this.initBox.moveTo(initBoxX, initBoxY);
      this.initBox.setSize(initBoxWidth, initBoxHeight);
    }

    if (this.advancedBox !== null) {
      this.advancedBox.moveTo(
        idiv(this.width - advancedBoxWidth, 2),
        idiv(this.height - advancedBoxHeight, 2),
      );
    }

    if (this.notificationBox !== null) {
      const notificationBoxWidth = 200;
      const notificationBoxHeight = 88;
      const notificationBoxX = panelX + 40;
      const notificationBoxY = panelY - notificationBoxHeight;
      this.notificationBox.moveTo(notificationBoxX, notificationBoxY);
      this.notificationBox.setSize(notificationBoxWidth, notificationBoxHeight);
    }

    if (this.viewport !== null) {
      /* The map view is magnified further than the panel and the boxes. */
      const mapZoom = Math.fround(Graphics.getInstance().getMapZoom());
      this.viewport.setZoom(mapZoom);
      this.viewport.setSize(
        // PORT: rounded up, not to the nearest: the view draws its pixels
        // in one size (Viewport.draw()) and has to reach the edges.
        Math.ceil(Math.fround(this.width / mapZoom)),
        Math.ceil(Math.fround(this.height / mapZoom)),
      );
    }

    this.setRedraw();
  }

  /* Random ambient sounds: birds by the trees in view, waves louder with
     more water in view and a faint wind (Amiga play_ambient_sounds
     @0xa494). */
  playAmbientSounds(): void {
    if (this.viewport === null) {
      return;
    }

    const audio = Audio.getInstance();
    const r = this.random.random();

    const trees = this.viewport.getTreesInView();
    if (trees !== 0 && (r & 0x3ff) <= trees) {
      audio.enqueueSfx(AudioTypeSfx.TypeSfxBirdChirp0 + (r & 0xc));
    }

    const water = this.viewport.getWaterInView();
    if (water !== 0 && (r & 0xf00) === 0) {
      audio.setSfxVolume(AudioTypeSfx.TypeSfxWaves, Math.min(water >> 2, 30) + 2);
      audio.enqueueSfx(AudioTypeSfx.TypeSfxWaves);
    }

    if ((r & 0x3000) === 0) {
      audio.setSfxVolume(AudioTypeSfx.TypeSfxWind, (r & 1) + 1);
      audio.enqueueSfx(AudioTypeSfx.TypeSfxWind);
    }
  }

  /* Whether a source has data of the category: custom data often has no
     sounds and no music. */
  // PORT: the static function source_has(mixed, category, kind) of
  // interface.cc needs DataSourceMixed, which does not exist here (DOS data
  // only). It is left out; its three callers below return before they reach
  // it, as the C++ does without a mixed source.

  getDataSourceName(_category: number): string {
    const mixed = Data.getInstance().getMixedSource();
    if (!mixed) return '';
    // PORT: not reached, there is no DataSourceMixed. The C++ returns
    // DataSourceMixed::get_kind_name(mixed->get_selected(category)).
    return '';
  }

  /* Use another source for a category at once: the images and sounds of the
     old one are forgotten and everything is drawn again. */
  selectDataSource(_category: number, _kind: number): void {
    const mixed = Data.getInstance().getMixedSource();
    if (!mixed) {
      return;
    }
    // PORT: not reached, there is no DataSourceMixed. The C++ selects the
    // source and then calls Graphics::data_changed() and invalidate() for
    // the graphics, Audio::data_changed(true, false) for the sounds and
    // Audio::data_changed(false, true) for the music.
  }

  /* The next source that has data of the category. */
  nextDataSource(_category: number): void {
    const mixed = Data.getInstance().getMixedSource();
    if (!mixed) return;
    // PORT: not reached, there is no DataSourceMixed. The C++ calls
    // select_data_source() for the next kind that has data of the category.
  }

  /* The next language with a translation, then the original English. */
  nextLanguage(): void {
    const translation = Translation.getInstance();
    const languages = translation.getLanguages();
    // PORT: std::sort of std::string compares the bytes; the language codes
    // are ASCII, so the code units are compared.
    languages.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    languages.unshift('');
    const it = languages.indexOf(translation.getLanguage());
    const next = it === -1 ? 0 : (it + 1) % languages.length;
    translation.setLanguage(languages[next]);
    /* All the texts again. */
    this.invalidate();
  }

  /* Advanced option: off, then every 5, 10, 20, 30 or 60 minutes. */
  nextAutosaveInterval(): void {
    const intervals = [0, 5, 10, 20, 30, 60];
    const count = intervals.length;
    let i = 0;
    while (i < count && intervals[i] !== this.autosaveMinutes) i++;
    this.autosaveMinutes = intervals[(i + 1) % count];
    this.autosaveLastTicks = EventLoop.getInstance().getTicks();
  }

  /* Save the game into the autosave files of the save folder when the
     interval has passed (in real time), unless nothing happened since the
     last save: the game was paused or the game init box is open. */
  // PORT: not in the C++. The last three autosaves are kept: autosave-1.save
  // is the newest, autosave-3.save the oldest. In an online game each
  // browser saves for itself; saving only reads the game.
  autosave(): void {
    if (this.autosaveMinutes === 0) return;
    const now = EventLoop.getInstance().getTicks();
    if (u32(now - this.autosaveLastTicks) < this.autosaveMinutes * 60 * 1000) return;
    this.autosaveLastTicks = now;

    if (this.initBox !== null || this.game!.getTick() === this.autosaveLastGameTick) {
      return;
    }
    this.autosaveLastGameTick = this.game!.getTick();

    GameStore.getInstance().autosave(this.game!);
  }

  /* Count the drawn frames and show the rate of the last second in the top
     left corner of the screen. */
  drawFps(frame: Frame): void {
    if (!this.showFps) {
      return;
    }

    this.fpsFrames++;
    const now = EventLoop.getInstance().getTicks();
    const elapsed = u32(now - this.fpsStart);
    if (elapsed >= 1000) {
      this.fps = idiv(this.fpsFrames * 1000, elapsed);
      this.fpsFrames = 0;
      this.fpsStart = now;
    }

    frame.drawString(4, 4, 'FPS ' + this.fps, Color.black);
  }

  /* Called periodically when the game progresses. */
  update(): void {
    Audio.getInstance().updateSfx();

    if (!this.game) {
      return;
    }
    const game = this.game;

    tickGame(game);

    // PORT: commands were applied (now or since the last update): the map
    // cursor, the panel buttons and the open box show the new state. The
    // C++ does this where it changes the game, right away.
    if (this.commandApplied) {
      this.commandApplied = false;
      if (this.viewport !== null) {
        this.updateMapCursorPos(this.mapCursorPos);
      }
      if (this.popup !== null) {
        this.popup.setRedraw();
      }
      if (this.htmlBox !== null) {
        this.htmlBox.refresh?.();
      }
    }

    this.playAmbientSounds();
    this.autosave();

    /* Show the end of the game, unless a file, quit or options box is open
       (Amiga clear_serf_request_failure @0xa3aa). */
    if (game.isGameEndPending()) {
      let box = 0;
      const openBox = this.getPopupBox();
      if (openBox !== null && openBox.isDisplayed()) {
        box = openBox.getBox();
      }
      if (
        !(
          (box >= PopupBoxType.TypeLoadArchive && box <= PopupBoxType.TypeDiskMsg) ||
          box === PopupBoxType.TypeQuitConfirm ||
          box === PopupBoxType.TypeNoSaveQuitConfirm ||
          box === PopupBoxType.TypeOptions
        )
      ) {
        // PORT: the pending flag only tells the interface to show the box
        // (the game sets it and never reads it); it is cleared here, not by
        // a command. The pause is a command.
        game.clearGameEndPending();
        if (!game.isPaused()) {
          cmdSetPaused(game, true);
        }
        this.openPopup(PopupBoxType.TypeGameEnd);
      }
    }

    const tickDiff = i32(game.getConstTick() - this.lastConstTick);
    this.lastConstTick = game.getConstTick();

    /* Clear return arrow after a timeout */
    if (this.returnTimeout < tickDiff) {
      this.returnArrow = false;
      this.returnTimeout = 0;
    } else {
      this.returnTimeout -= tickDiff;
    }

    /* Handle newly enqueued messages */
    if (this.player !== null && this.player.hasMessage()) {
      this.player.dropMessage();
      while (this.player.hasNotification()) {
        const message = this.player.peekNotification();
        if (this.showsMessage(message.type)) {
          this.playSound(AudioTypeSfx.TypeSfxMessage);
          this.messageWaiting = true;
          break;
        }
        this.player.popNotification();
      }
    }

    if (this.player !== null && this.messageOpened) {
      this.messageOpened = false;
      while (1) {
        if (!this.player.hasNotification()) {
          this.messageWaiting = false;
          break;
        }

        const message = this.player.peekNotification();
        if (this.showsMessage(message.type)) break;
        this.player.popNotification();
      }
    }

    this.viewport!.update();
    this.setRedraw();
  }

  // PORT: not in the C++. The page overlays (build-menu.ts, alerts.ts) add
  // their keys here. A key hook that returns true has used the key. The
  // hooks only read the game and call the methods of the interface, which
  // issue commands.
  keyHooks: ((key: number, modifier: number) => boolean)[] = [];
  // PORT: not in the C++. The registry of the menus of the page
  // (ui/menu/kit.ts) is the one popup hook: asked by openPopup() and, with
  // fromCanvas, by the canvas popup when it switches to another box. True:
  // the box is shown by the page.
  popupHook: ((box: number, fromCanvas?: boolean) => boolean) | null = null;

  /* The game init box is open: the keys of the overlays are off. */
  isGameInitOpen(): boolean {
    return this.initBox !== null;
  }

  protected override handleKeyPressed(key: number, modifier: number): boolean {
    for (const hook of this.keyHooks) {
      if (hook(key, modifier)) {
        return true;
      }
    }

    switch (key) {
      /* Interface control */
      case 0x09: {
        // '\t'
        if (modifier & 2) {
          this.returnFromMessage();
        } else {
          this.openMessage();
        }
        break;
      }
      case 27: {
        if (this.notificationBox !== null && this.notificationBox.isDisplayed()) {
          this.closeMessage();
        } else if ((this.popup !== null && this.popup.isDisplayed()) || this.htmlBox !== null) {
          this.closePopup();
        } else if (this.buildingRoad.isValid()) {
          this.buildRoadEnd();
        }
        break;
      }

      case 0x66: {
        // 'f'
        if ((modifier & 3) === 3) {
          /* Ctrl+Shift+F */
          this.showFps = !this.showFps;
          this.fpsFrames = 0;
          this.fpsStart = EventLoop.getInstance().getTicks();
        }
        break;
      }

      /* Game speed */
      case 0x2b: {
        // '+'
        cmdSpeedIncrease(this.game!);
        break;
      }
      case 0x2d: {
        // '-'
        cmdSpeedDecrease(this.game!);
        break;
      }
      case 0x30: {
        // '0'
        cmdSpeedReset(this.game!);
        break;
      }
      case 0x70: {
        // 'p'
        cmdSetPaused(this.game!, !this.game!.isPaused());
        break;
      }

      /* Audio */
      case 0x73: {
        // 's'
        const audio = Audio.getInstance();
        const splayer = audio.getSoundPlayer();
        if (splayer) {
          splayer.enable(!splayer.isEnabled());
        }
        break;
      }
      case 0x6d: {
        // 'm'
        const audio = Audio.getInstance();
        const splayer = audio.getMusicPlayer();
        if (splayer) {
          splayer.enable(!splayer.isEnabled());
        }
        break;
      }

      /* Debug */
      case 0x67: {
        // 'g'
        this.viewport!.switchLayer(ViewportLayer.LayerGrid);
        break;
      }

      /* Game control */
      case 0x62: {
        // 'b'
        this.viewport!.switchLayer(ViewportLayer.LayerBuilds);
        break;
      }
      case 0x6a: {
        // 'j'
        // PORT: commands are issued for the local player, so that is
        // switched too. Not in a network game: the other player is not
        // this browser's to control.
        if (hasCommandSink()) {
          break;
        }
        const index = this.game!.getNextPlayer(this.player!).getIndex();
        setLocalPlayer(index);
        this.setPlayer(index);
        Log.Debug('main', 'Switched to player #', index);
        break;
      }
      case 0x7a: // 'z'
        if (modifier & 1) {
          GameStore.getInstance().quickSave('quicksave', this.game!);
        }
        break;
      case 0x6e: // 'n'
        if (modifier & 1) {
          this.openGameInit();
        }
        break;
      case 0x63: // 'c'
        if (modifier & 1) {
          this.openPopup(PopupBoxType.TypeQuitConfirm);
        }
        break;

      default:
        return false;
    }

    return true;
  }

  override handleEvent(event: Event): boolean {
    switch (event.type) {
      case EventType.TypeResize:
        this.setSize(event.dx, event.dy);
        break;
      case EventType.TypeUpdate:
        this.update();
        break;
      case EventType.TypeDraw:
        this.draw(event.object as Frame);
        this.drawFps(event.object as Frame);
        break;
      case EventType.TypeInvalidate:
        this.invalidate();
        break;

      default:
        return super.handleEvent(event);
        break;
    }

    return true;
  }

  // GameManager::Handler implementation
  onNewGame(newGame: Game): void {
    this.setGame(newGame);
  }

  onEndGame(_game: Game): void {
    this.setGame(null);
  }
}
