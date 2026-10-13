/*
 * popup.ts - Popup GUI component
 *
 * Port of Freeserf's popup.h and popup.cc.
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

import { Building, BuildingType } from '../game/building';
import { FLAG_MAX_RES_COUNT } from '../game/flag';
import { GAME_MAX_PLAYER_COUNT, GameGameType } from '../game/game';
import { InventoryMode } from '../game/inventory';
import { MapMinerals } from '../game/map';
import type { MapPos } from '../game/map-geometry';
import { cycleDirectionsCw } from '../game/map-geometry';
import { BIT_TEST, ExceptionFreeserf, Log, NOT_REACHED, idiv } from '../game/misc';
import { GameInfo } from '../game/mission';
import type { Player } from '../game/player';
import type { ResourceMap } from '../game/resource';
import { ResourceType } from '../game/resource';
import { GameStore } from '../game/savegame';
import { SerfType } from '../game/serf';
import {
  canPromoteSerfsToKnights,
  canSendGeologist,
  cmdChangeCastleKnightsWanted,
  cmdChangeKnightOccupation,
  cmdCycleKnights,
  cmdMovePriority,
  cmdPromoteSerfsToKnights,
  cmdPullRoadsThroughFlag,
  cmdResetPriority,
  cmdSendGeologist,
  cmdSetDistribution,
  cmdSetInventoryResourceMode,
  cmdSetInventorySerfMode,
  cmdSetPaused,
  cmdSetSendStrongest,
  cmdSetSerfToKnightRate,
  cmdSetToolPrio,
  cmdStartAttack,
} from '../net/commands';
import { Audio, AudioTypeSfx } from './audio';
import { Data } from './data-instance';
import { EventLoop } from './event-loop';
import { Color, Graphics } from './gfx';
import { GuiObject, guiGetSliderClickValue } from './gui';
import type { Interface } from './interface';
import { InterfaceStatAspect, InterfaceStatScale, mapBuildingSprite } from './interface';
import { ListSavedFiles } from './list';
import { MinimapGame, MinimapGameOwnershipMode } from './minimap';
import { TextInput } from './text-input';
import { C_, NC_, N_, _ } from './translation';
import { Viewport, ViewportLayer } from './viewport';

/* Action types that can be fired from
   clicks in the popup window. */
enum Action {
  ACTION_MINIMAP_CLICK = 0,
  ACTION_MINIMAP_MODE,
  ACTION_MINIMAP_ROADS,
  ACTION_MINIMAP_BUILDINGS,
  ACTION_MINIMAP_GRID,
  ACTION_BUILD_STONEMINE,
  ACTION_BUILD_COALMINE,
  ACTION_BUILD_IRONMINE,
  ACTION_BUILD_GOLDMINE,
  ACTION_BUILD_FLAG,
  ACTION_BUILD_STONECUTTER,
  ACTION_BUILD_HUT,
  ACTION_BUILD_LUMBERJACK,
  ACTION_BUILD_FORESTER,
  ACTION_BUILD_FISHER,
  ACTION_BUILD_MILL,
  ACTION_BUILD_BOATBUILDER,
  ACTION_BUILD_BUTCHER,
  ACTION_BUILD_WEAPONSMITH,
  ACTION_BUILD_STEELSMELTER,
  ACTION_BUILD_SAWMILL,
  ACTION_BUILD_BAKER,
  ACTION_BUILD_GOLDSMELTER,
  ACTION_BUILD_FORTRESS,
  ACTION_BUILD_TOWER,
  ACTION_BUILD_TOOLMAKER,
  ACTION_BUILD_FARM,
  ACTION_BUILD_PIGFARM,
  ACTION_BLD_FLIP_PAGE,
  ACTION_SHOW_STAT_1,
  ACTION_SHOW_STAT_2,
  ACTION_SHOW_STAT_8,
  ACTION_SHOW_STAT_BLD,
  ACTION_SHOW_STAT_6,
  ACTION_SHOW_STAT_7,
  ACTION_SHOW_STAT_4,
  ACTION_SHOW_STAT_3,
  ACTION_SHOW_STAT_SELECT,
  ACTION_STAT_BLD_FLIP,
  ACTION_CLOSE_BOX,
  ACTION_SETT_8_SET_ASPECT_ALL,
  ACTION_SETT_8_SET_ASPECT_LAND,
  ACTION_SETT_8_SET_ASPECT_BUILDINGS,
  ACTION_SETT_8_SET_ASPECT_MILITARY,
  ACTION_SETT_8_SET_SCALE_30_MIN,
  ACTION_SETT_8_SET_SCALE_60_MIN,
  ACTION_SETT_8_SET_SCALE_600_MIN,
  ACTION_SETT_8_SET_SCALE_3000_MIN,
  ACTION_STAT_7_SELECT_FISH,
  ACTION_STAT_7_SELECT_PIG,
  ACTION_STAT_7_SELECT_MEAT,
  ACTION_STAT_7_SELECT_WHEAT,
  ACTION_STAT_7_SELECT_FLOUR,
  ACTION_STAT_7_SELECT_BREAD,
  ACTION_STAT_7_SELECT_LUMBER,
  ACTION_STAT_7_SELECT_PLANK,
  ACTION_STAT_7_SELECT_BOAT,
  ACTION_STAT_7_SELECT_STONE,
  ACTION_STAT_7_SELECT_IRONORE,
  ACTION_STAT_7_SELECT_STEEL,
  ACTION_STAT_7_SELECT_COAL,
  ACTION_STAT_7_SELECT_GOLDORE,
  ACTION_STAT_7_SELECT_GOLDBAR,
  ACTION_STAT_7_SELECT_SHOVEL,
  ACTION_STAT_7_SELECT_HAMMER,
  ACTION_STAT_7_SELECT_ROD,
  ACTION_STAT_7_SELECT_CLEAVER,
  ACTION_STAT_7_SELECT_SCYTHE,
  ACTION_STAT_7_SELECT_AXE,
  ACTION_STAT_7_SELECT_SAW,
  ACTION_STAT_7_SELECT_PICK,
  ACTION_STAT_7_SELECT_PINCER,
  ACTION_STAT_7_SELECT_SWORD,
  ACTION_STAT_7_SELECT_SHIELD,
  ACTION_ATTACKING_KNIGHTS_DEC,
  ACTION_ATTACKING_KNIGHTS_INC,
  ACTION_START_ATTACK,
  ACTION_CLOSE_ATTACK_BOX,
  /* ... 78 - 91 ... */
  ACTION_CLOSE_SETT_BOX = 92,
  ACTION_SHOW_SETT_1,
  ACTION_SHOW_SETT_2,
  ACTION_SHOW_SETT_3,
  ACTION_SHOW_SETT_7,
  ACTION_SHOW_SETT_4,
  ACTION_SHOW_SETT_5,
  ACTION_SHOW_SETT_SELECT,
  ACTION_SETT_1_ADJUST_STONEMINE,
  ACTION_SETT_1_ADJUST_COALMINE,
  ACTION_SETT_1_ADJUST_IRONMINE,
  ACTION_SETT_1_ADJUST_GOLDMINE,
  ACTION_SETT_2_ADJUST_CONSTRUCTION,
  ACTION_SETT_2_ADJUST_BOATBUILDER,
  ACTION_SETT_2_ADJUST_TOOLMAKER_PLANKS,
  ACTION_SETT_2_ADJUST_TOOLMAKER_STEEL,
  ACTION_SETT_2_ADJUST_WEAPONSMITH,
  ACTION_SETT_3_ADJUST_STEELSMELTER,
  ACTION_SETT_3_ADJUST_GOLDSMELTER,
  ACTION_SETT_3_ADJUST_WEAPONSMITH,
  ACTION_SETT_3_ADJUST_PIGFARM,
  ACTION_SETT_3_ADJUST_MILL,
  ACTION_KNIGHT_LEVEL_CLOSEST_MIN_DEC,
  ACTION_KNIGHT_LEVEL_CLOSEST_MIN_INC,
  ACTION_KNIGHT_LEVEL_CLOSEST_MAX_DEC,
  ACTION_KNIGHT_LEVEL_CLOSEST_MAX_INC,
  ACTION_KNIGHT_LEVEL_CLOSE_MIN_DEC,
  ACTION_KNIGHT_LEVEL_CLOSE_MIN_INC,
  ACTION_KNIGHT_LEVEL_CLOSE_MAX_DEC,
  ACTION_KNIGHT_LEVEL_CLOSE_MAX_INC,
  ACTION_KNIGHT_LEVEL_FAR_MIN_DEC,
  ACTION_KNIGHT_LEVEL_FAR_MIN_INC,
  ACTION_KNIGHT_LEVEL_FAR_MAX_DEC,
  ACTION_KNIGHT_LEVEL_FAR_MAX_INC,
  ACTION_KNIGHT_LEVEL_FARTHEST_MIN_DEC,
  ACTION_KNIGHT_LEVEL_FARTHEST_MIN_INC,
  ACTION_KNIGHT_LEVEL_FARTHEST_MAX_DEC,
  ACTION_KNIGHT_LEVEL_FARTHEST_MAX_INC,
  ACTION_SETT_4_ADJUST_SHOVEL,
  ACTION_SETT_4_ADJUST_HAMMER,
  ACTION_SETT_4_ADJUST_AXE,
  ACTION_SETT_4_ADJUST_SAW,
  ACTION_SETT_4_ADJUST_SCYTHE,
  ACTION_SETT_4_ADJUST_PICK,
  ACTION_SETT_4_ADJUST_PINCER,
  ACTION_SETT_4_ADJUST_CLEAVER,
  ACTION_SETT_4_ADJUST_ROD,
  ACTION_SETT_5_6_ITEM_1,
  ACTION_SETT_5_6_ITEM_2,
  ACTION_SETT_5_6_ITEM_3,
  ACTION_SETT_5_6_ITEM_4,
  ACTION_SETT_5_6_ITEM_5,
  ACTION_SETT_5_6_ITEM_6,
  ACTION_SETT_5_6_ITEM_7,
  ACTION_SETT_5_6_ITEM_8,
  ACTION_SETT_5_6_ITEM_9,
  ACTION_SETT_5_6_ITEM_10,
  ACTION_SETT_5_6_ITEM_11,
  ACTION_SETT_5_6_ITEM_12,
  ACTION_SETT_5_6_ITEM_13,
  ACTION_SETT_5_6_ITEM_14,
  ACTION_SETT_5_6_ITEM_15,
  ACTION_SETT_5_6_ITEM_16,
  ACTION_SETT_5_6_ITEM_17,
  ACTION_SETT_5_6_ITEM_18,
  ACTION_SETT_5_6_ITEM_19,
  ACTION_SETT_5_6_ITEM_20,
  ACTION_SETT_5_6_ITEM_21,
  ACTION_SETT_5_6_ITEM_22,
  ACTION_SETT_5_6_ITEM_23,
  ACTION_SETT_5_6_ITEM_24,
  ACTION_SETT_5_6_ITEM_25,
  ACTION_SETT_5_6_ITEM_26,
  ACTION_SETT_5_6_TOP,
  ACTION_SETT_5_6_UP,
  ACTION_SETT_5_6_DOWN,
  ACTION_SETT_5_6_BOTTOM,
  ACTION_QUIT_CONFIRM,
  ACTION_QUIT_CANCEL,
  ACTION_NO_SAVE_QUIT_CONFIRM,
  ACTION_SHOW_QUIT,
  ActionShowOptions,
  ACTION_SHOW_SAVE,
  ACTION_SETT_8_CYCLE,
  ACTION_CLOSE_OPTIONS,
  ACTION_OPTIONS_PATHWAY_SCROLLING_1,
  ACTION_OPTIONS_PATHWAY_SCROLLING_2,
  ACTION_OPTIONS_FAST_MAP_CLICK_1,
  ACTION_OPTIONS_FAST_MAP_CLICK_2,
  ACTION_OPTIONS_FAST_BUILDING_1,
  ACTION_OPTIONS_FAST_BUILDING_2,
  ACTION_OPTIONS_MESSAGE_COUNT_1,
  ACTION_OPTIONS_MESSAGE_COUNT_2,
  ACTION_SHOW_SETT_SELECT_FILE, /* UNUSED */
  ACTION_SHOW_STAT_SELECT_FILE, /* UNUSED */
  ACTION_DEFAULT_SETT_1,
  ACTION_DEFAULT_SETT_2,
  ACTION_DEFAULT_SETT_5_6,
  ACTION_BUILD_STOCK,
  ACTION_SHOW_CASTLE_SERF,
  ACTION_SHOW_RESDIR,
  ACTION_SHOW_CASTLE_RES,
  ACTION_SEND_GEOLOGIST,
  ACTION_RES_MODE_IN,
  ACTION_RES_MODE_STOP,
  ACTION_RES_MODE_OUT,
  ACTION_SERF_MODE_IN,
  ACTION_SERF_MODE_STOP,
  ACTION_SERF_MODE_OUT,
  ACTION_SHOW_SETT_8,
  ACTION_SHOW_SETT_6,
  ACTION_SETT_8_ADJUST_RATE,
  ACTION_SETT_8_TRAIN_1,
  ACTION_SETT_8_TRAIN_5,
  ACTION_SETT_8_TRAIN_20,
  ACTION_SETT_8_TRAIN_100,
  ACTION_DEFAULT_SETT_3,
  ACTION_SETT_8_SET_COMBAT_MODE_WEAK,
  ACTION_SETT_8_SET_COMBAT_MODE_STRONG,
  ACTION_ATTACKING_SELECT_ALL_1,
  ACTION_ATTACKING_SELECT_ALL_2,
  ACTION_ATTACKING_SELECT_ALL_3,
  ACTION_ATTACKING_SELECT_ALL_4,
  ACTION_MINIMAP_BLD_1,
  ACTION_MINIMAP_BLD_2,
  ACTION_MINIMAP_BLD_3,
  ACTION_MINIMAP_BLD_4,
  ACTION_MINIMAP_BLD_5,
  ACTION_MINIMAP_BLD_6,
  ACTION_MINIMAP_BLD_7,
  ACTION_MINIMAP_BLD_8,
  ACTION_MINIMAP_BLD_9,
  ACTION_MINIMAP_BLD_10,
  ACTION_MINIMAP_BLD_11,
  ACTION_MINIMAP_BLD_12,
  ACTION_MINIMAP_BLD_13,
  ACTION_MINIMAP_BLD_14,
  ACTION_MINIMAP_BLD_15,
  ACTION_MINIMAP_BLD_16,
  ACTION_MINIMAP_BLD_17,
  ACTION_MINIMAP_BLD_18,
  ACTION_MINIMAP_BLD_19,
  ACTION_MINIMAP_BLD_20,
  ACTION_MINIMAP_BLD_21,
  ACTION_MINIMAP_BLD_22,
  ACTION_MINIMAP_BLD_23,
  ACTION_MINIMAP_BLD_FLAG,
  ACTION_MINIMAP_BLD_NEXT,
  ACTION_MINIMAP_BLD_EXIT,
  ACTION_CLOSE_MESSAGE,
  ACTION_DEFAULT_SETT_4,
  ACTION_SHOW_PLAYER_FACES,
  ACTION_MINIMAP_SCALE,
  ACTION_OPTIONS_RIGHT_SIDE,
  ACTION_CLOSE_GROUND_ANALYSIS,
  ACTION_UNKNOWN_TP_INFO_FLAG,
  ACTION_SETT_8_CASTLE_DEF_DEC,
  ACTION_SETT_8_CASTLE_DEF_INC,
  ACTION_OPTIONS_MUSIC,
  ACTION_OPTIONS_FULLSCREEN,
  ACTION_OPTIONS_VOLUME_MINUS,
  ACTION_OPTIONS_VOLUME_PLUS,
  ACTION_DEMOLISH,
  ACTION_OPTIONS_SFX,
  ACTION_SAVE,
  ACTION_OPTIONS_ADVANCED,
  ACTION_NEW_NAME,
}

export enum PopupBoxType {
  TypeNone = 0,
  TypeMap = 1,
  TypeMapOverlay, /* UNUSED */
  TypeMineBuilding,
  TypeBasicBld,
  TypeBasicBldFlip,
  TypeAdv1Bld,
  TypeAdv2Bld,
  TypeStatSelect,
  TypeStat4,
  TypeStatBld1,
  TypeStatBld2,
  TypeStatBld3,
  TypeStatBld4,
  TypeStat8,
  TypeStat7,
  TypeStat1,
  TypeStat2,
  TypeStat6,
  TypeStat3,
  TypeStartAttack,
  TypeStartAttackRedraw,
  TypeGroundAnalysis,
  TypeLoadArchive,
  TypeLoadSave,
  Type25,
  TypeDiskMsg,
  TypeSettSelect,
  TypeSett1,
  TypeSett2,
  TypeSett3,
  TypeKnightLevel,
  TypeSett4,
  TypeSett5,
  TypeQuitConfirm,
  TypeNoSaveQuitConfirm,
  TypeSettSelectFile, /* UNUSED */
  TypeOptions,
  TypeCastleRes,
  TypeMineOutput,
  TypeOrderedBld,
  TypeDefenders,
  TypeTransportInfo,
  TypeCastleSerf,
  TypeResDir,
  TypeSett8,
  TypeSett6,
  TypeBld1,
  TypeBld2,
  TypeBld3,
  TypeBld4,
  TypeMessage,
  TypeBldStock,
  TypePlayerFaces,
  TypeGameEnd,
  TypeDemolish,
  TypeJsCalib,
  TypeJsCalibUpLeft,
  TypeJsCalibDownRight,
  TypeJsCalibCenter,
  TypeCtrlsInfo,
  TypeTutorialOrders,
  // EXT: the trade window (menu/trade.ts). It has no canvas box.
  TypeTrade,
}

export enum PopupBoxBackgroundPattern {
  PatternStripedGreen = 129, // \\\.
  PatternDiagonalGreen = 310, // xxx
  PatternCheckerdDiagonalBrown = 311, // xxx
  PatternPlaidAlongGreen = 312, // ###
  PatternStaresGreen = 313, // * *
  PatternSquaresGreen = 314,
  PatternConstruction = 131, // many dots
  PatternOverallComparison = 132, // sward + building + land
  PatternRuralProperties = 133, // land
  PatternBuildings = 134, // buildings
  PatternCombatPower = 135, // sward
  PatternFish = 138,
  PatternPig = 139,
  PatternMeat = 140,
  PatternEheat = 141,
  PatternFlour = 142,
  PatternBread = 143,
  PatternLumber = 144,
  PatternPlank = 145,
  PatternBoat = 146,
  PatternStone = 147,
  PatternIronore = 148,
  PatternSteel = 149,
  PatternCoal = 150,
  PatternGoldore = 151,
  PatternGoldbar = 152,
  PatternShovel = 153,
  PatternHammer = 154,
  PatternRod = 155,
  PatternCleaver = 156,
  PatternScythe = 157,
  PatternAxe = 158,
  PatternSaw = 159,
  PatternPick = 160,
  PatternPincer = 161,
  PatternSword = 162,
  PatternShield = 163,
}

// PORT: std::getline() over the text: the lines between the '\n', without
// an empty line after a '\n' at the end.
function getLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

// PORT: unsigned int values[24][Building::kMaxStock][2] = {{{0}}}
function newGaugeValues(): number[][][] {
  const values: number[][][] = [];
  for (let i = 0; i < 24; i++) {
    const row: number[][] = [];
    for (let j = 0; j < Building.kMaxStock; j++) {
      row.push([0, 0]);
    }
    values.push(row);
  }
  return values;
}

function calculateGaugeValues(player: Player, values: number[][][]): void {
  for (const building of player.getGame().getPlayerBuildings(player)) {
    if (building.isBurning() || !building.hasSerf()) {
      continue;
    }

    let type: number = building.getType();
    if (!building.isDone()) type = 0;

    for (let i = 0; i < Building.kMaxStock; i++) {
      if (building.getMaximumInStock(i) > 0) {
        const v = 2 * building.getResCountInStock(i) + building.getRequestedInStock(i);
        values[type][i][0] += idiv(16 * v, 2 * building.getMaximumInStock(i));
        values[type][i][1] += 1;
      }
    }
  }
}

export class PopupBox extends GuiObject {
  static Type = PopupBoxType;
  static BackgroundPattern = PopupBoxBackgroundPattern;

  protected interface: Interface;
  protected minimap: MinimapGame;
  protected fileList: ListSavedFiles;
  protected fileField: TextInput;

  protected box: PopupBoxType;

  protected specialClick: boolean; // The current click is a special click
  /* The texts have a black shadow, on the green backgrounds as in the
     advanced box. */
  protected textShadow: boolean;

  protected currentSett5Item: number;
  /* Game end: 0 result picture, 1 result text, 2 mission picture. */
  protected gameEndStage: number;
  protected currentSett6Item: number;

  constructor(_interface: Interface) {
    super();
    this.minimap = new MinimapGame(_interface, _interface.getGame()!);
    this.fileList = new ListSavedFiles();
    this.fileField = new TextInput();
    this.box = PopupBoxType.TypeNone;
    this.specialClick = false;
    this.textShadow = false;
    this.interface = _interface;

    this.currentSett5Item = 8;
    this.currentSett6Item = 15;
    this.gameEndStage = 0;

    /* Initialize minimap */
    this.minimap.setDisplayed(false);
    this.minimap.setParent(this);
    this.minimap.setSize(128, 128);
    this.addFloat(this.minimap, 8, 9);

    this.fileList.setSize(120, 100);
    this.fileList.setDisplayed(false);
    this.fileList.setSelectionHandler((item: string) => {
      const p = Math.max(item.lastIndexOf('/'), item.lastIndexOf('\\'));
      const fileName = item.substring(p + 1, item.length);
      this.fileField.setText(fileName);
    });
    this.addFloat(this.fileList, 12, 22);

    this.fileField.setSize(120, 10);
    this.fileField.setDisplayed(false);
    this.addFloat(this.fileField, 12, 124);
  }

  // PORT: the destructor; its body is empty, the unique_ptr members delete
  // the minimap, the file list and the file field.
  override destroy(): void {
    this.fileField.destroy();
    this.fileList.destroy();
    this.minimap.destroy();
    super.destroy();
  }

  getBox(): PopupBoxType {
    return this.box;
  }

  getMinimap(): MinimapGame {
    return this.minimap;
  }

  /* Draw the frame around the popup box. */
  protected drawPopupBoxFrame(): void {
    this.frame!.drawSprite(0, 0, Data.Resource.AssetFramePopup, 0);
    this.frame!.drawSprite(0, 153, Data.Resource.AssetFramePopup, 1);
    this.frame!.drawSprite(0, 9, Data.Resource.AssetFramePopup, 2);
    this.frame!.drawSprite(136, 9, Data.Resource.AssetFramePopup, 3);
  }

  /* Draw icon in a popup frame. */
  protected drawPopupIcon(x_: number, y_: number, sprite: number): void {
    this.frame!.drawSprite(8 * x_ + 8, y_ + 9, Data.Resource.AssetIcon, sprite);
  }

  /* Draw building in a popup frame. */
  protected drawPopupBuilding(x_: number, y_: number, sprite: number): void {
    const player = this.interface.getPlayer()!;
    const color: Color = this.interface.getPlayerColor(player.getIndex());
    this.frame!.drawSprite(8 * x_ + 8, y_ + 9, Data.Resource.AssetMapObject, sprite, false, color);
  }

  /* Fill the background of a popup frame. */
  protected drawBoxBackground(sprite: PopupBoxBackgroundPattern): void {
    this.textShadow =
      sprite === PopupBoxBackgroundPattern.PatternStripedGreen ||
      sprite === PopupBoxBackgroundPattern.PatternDiagonalGreen ||
      sprite === PopupBoxBackgroundPattern.PatternPlaidAlongGreen ||
      sprite === PopupBoxBackgroundPattern.PatternStaresGreen ||
      sprite === PopupBoxBackgroundPattern.PatternSquaresGreen;
    for (let iy = 0; iy < 144; iy += 16) {
      for (let ix = 0; ix < 16; ix += 2) {
        this.drawPopupIcon(ix, iy, sprite);
      }
    }
  }

  /* Fill one row of a popup frame. */
  protected drawBoxRow(sprite: number, iy: number): void {
    for (let ix = 0; ix < 16; ix += 2) {
      this.drawPopupIcon(ix, iy, sprite);
    }
  }

  /* Draw a green string in a popup frame. */
  protected drawGreenString(sx: number, sy: number, str: string): void {
    this.frame!.drawString(
      8 * sx + 8,
      sy + 9,
      str,
      Color.green,
      this.textShadow ? Color.black : Color.transparent,
    );
  }

  /* The lines of a text (split at '\n'), line_height pixels apart: from
     the column sx, or each centred in the box, or centred at the pixel cx
     of the box. */
  /* Draw the lines of a green text in a popup frame. */
  protected drawGreenLines(sx: number, sy: number, text: string, lineHeight = 10): void {
    for (const line of getLines(text)) {
      this.drawGreenString(sx, sy, line);
      sy += lineHeight;
    }
  }

  /* Draw the lines of a green text in a popup frame, each centred in the
     16 columns of the box. */
  protected drawGreenCentered(sy: number, text: string, lineHeight = 10): void {
    for (const line of getLines(text)) {
      this.drawGreenCenteredAt(8 + 64, sy, line);
      sy += lineHeight;
    }
  }

  /* Draw a green string in a popup frame, centred at the pixel cx. */
  protected drawGreenCenteredAt(cx: number, sy: number, str: string): void {
    this.frame!.drawString(
      cx - idiv(this.frame!.getStringWidth(str), 2),
      sy + 9,
      str,
      Color.green,
      this.textShadow ? Color.black : Color.transparent,
    );
  }

  /* Draw a green number in a popup frame.
     n must be non-negative. If > 999 simply draw ">999" (three characters). */
  protected drawGreenNumber(sx: number, sy: number, n: number): void {
    if (n >= 1000 && this.interface.getLargeNumbers()) {
      /* Advanced option: shortened to the three characters of the field. */
      this.frame!.drawString(
        8 * sx + 8,
        9 + sy,
        PopupBox.formatCount(n),
        Color.green,
        this.textShadow ? Color.black : Color.transparent,
      );
    } else if (n >= 1000) {
      this.drawPopupIcon(sx, sy, 0xd5); /* Draw >999 */
      this.drawPopupIcon(sx + 1, sy, 0xd6);
      this.drawPopupIcon(sx + 2, sy, 0xd7);
    } else {
      this.frame!.drawNumber(
        8 * sx + 8,
        9 + sy,
        n,
        Color.green,
        this.textShadow ? Color.black : Color.transparent,
      );
    }
  }

  /* A count of 1000 or more in at most three characters: thousands (1K to
     99K), tenths of a million (.1M to .9M), millions (1M to 99M), rounded. */
  static formatCount(n: number): string {
    if (n < 1000) return String(n);
    const thousands = idiv(n + 500, 1000);
    if (thousands < 100) {
      return String(thousands) + C_('thousands', 'K');
    }
    const tenths = idiv(n + 50000, 100000);
    if (tenths < 10) {
      return '.' + String(tenths) + C_('millions', 'M');
    }
    const millions = Math.min(idiv(n + 500000, 1000000), 99);
    return String(millions) + C_('millions', 'M');
  }

  /* Draw a green number in a popup frame.
     No limits on n. */
  protected drawGreenLargeNumber(sx: number, sy: number, n: number): void {
    this.frame!.drawNumber(
      8 * sx + 8,
      9 + sy,
      n,
      Color.green,
      this.textShadow ? Color.black : Color.transparent,
    );
  }

  /* Draw small green number. */
  protected drawAdditionalNumber(ix: number, iy: number, n: number): void {
    if (n > 0) {
      this.drawPopupIcon(ix, iy, 240 + Math.min(n, 10));
    }
  }

  /* Get the sprite number for a face. */
  protected getPlayerFaceSprite(face: number): number {
    if (face !== 0) {
      return (0x10b + face) >>> 0;
    }
    return 0x119; /* sprite_face_none */
  }

  /* Draw player face in popup frame. */
  protected drawPlayerFace(ix: number, iy: number, player: number): void {
    let color = new Color();
    let face = 0;
    const p = this.interface.getGame()!.getPlayer(player);
    if (p !== null) {
      color = this.interface.getPlayerColor(player);
      face = p.getFace();
    }

    this.frame!.fillRect(8 * ix, iy + 5, 48, 72, color);
    this.drawPopupIcon(ix, iy, this.getPlayerFaceSprite(face));
  }

  /* Draw a layout of buildings in a popup box. */
  // PORT: the C++ advances the pointer `sprites` by three until the -1; here
  // an index into the array (the callers pass a slice to skip entries).
  protected drawCustomBldBox(sprites: number[]): void {
    let i = 0;
    while (sprites[i] > 0) {
      const sx = sprites[i + 1];
      const sy = sprites[i + 2];
      this.frame!.drawSprite(8 * sx + 8, sy + 9, Data.Resource.AssetMapObject, sprites[i], false);
      i += 3;
    }
  }

  /* Draw a layout of icons in a popup box. */
  protected drawCustomIconBox(sprites: number[]): void {
    let i = 0;
    while (sprites[i] > 0) {
      this.drawPopupIcon(sprites[i + 1], sprites[i + 2], sprites[i]);
      i += 3;
    }
  }

  /* Translate resource amount to text. */
  protected prepareResAmountText(amount: number): string {
    if (amount === 0) return C_('ground analysis', 'Not Present');
    else if (amount < 100) return C_('ground analysis', 'Minimum');
    else if (amount < 180) return C_('ground analysis', 'Very Few');
    else if (amount < 240) return C_('ground analysis', 'Few');
    else if (amount < 300) return C_('ground analysis', 'Below Average');
    else if (amount < 400) return C_('ground analysis', 'Average');
    else if (amount < 500) return C_('ground analysis', 'Above Average');
    else if (amount < 600) return C_('ground analysis', 'Much');
    else if (amount < 800) return C_('ground analysis', 'Very Much');
    return C_('ground analysis', 'Perfect');
  }

  protected drawMapBox(): void {
    /* Icons */
    this.drawPopupIcon(0, 128, this.minimap.getOwnershipMode()); // Mode
    this.drawPopupIcon(4, 128, this.minimap.getDrawRoads() ? 3 : 4); // Roads
    if (this.minimap.getAdvanced() >= 0) { // Unknown mode
      this.drawPopupIcon(8, 128, this.minimap.getAdvanced() === 0 ? 306 : 305);
    } else { // Buildings
      this.drawPopupIcon(8, 128, this.minimap.getDrawBuildings() ? 5 : 6);
    }
    this.drawPopupIcon(12, 128, this.minimap.getDrawGrid() ? 7 : 8); // Grid
    this.drawPopupIcon(14, 128, this.minimap.getScale() === 1 ? 91 : 92); // Scale
  }

  /* Draw building mine popup box. */
  protected drawMineBuildingBox(): void {
    const layout = [
      0xa3, 2, 8,
      0xa4, 8, 8,
      0xa5, 4, 77,
      0xa6, 10, 77,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternConstruction);

    if (
      this.interface.getGame()!.canBuildFlag(
        this.interface.getMapCursorPos(),
        this.interface.getPlayer()!,
      )
    ) {
      this.drawPopupBuilding(2, 114, 0x80 + 4 * this.interface.getPlayer()!.getIndex());
    }

    this.drawCustomBldBox(layout);
  }

  /* Draw .. popup box... */
  protected drawBasicBuildingBox(flip: number): void {
    const layout = [
      0xab, 10, 13, /* hut */
      0xa9, 2, 13,
      0xa8, 0, 58,
      0xaa, 6, 56,
      0xa7, 12, 55,
      0xbc, 2, 85,
      0xae, 10, 87,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternConstruction);

    let l = layout;
    if (!this.interface.getGame()!.canBuildMilitary(this.interface.getMapCursorPos())) {
      l = l.slice(3); /* Skip hut */
    }

    this.drawCustomBldBox(l);

    if (
      this.interface.getGame()!.canBuildFlag(
        this.interface.getMapCursorPos(),
        this.interface.getPlayer()!,
      )
    ) {
      this.drawPopupBuilding(8, 108, 0x80 + 4 * this.interface.getPlayer()!.getIndex());
    }

    if (flip) this.drawPopupIcon(0, 128, 0x3d);
  }

  protected drawAdv1BuildingBox(): void {
    const layout = [
      0x9c, 0, 15,
      0x9d, 8, 15,
      0xa1, 0, 50,
      0xa0, 8, 50,
      0xa2, 2, 100,
      0x9f, 10, 96,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternConstruction);
    this.drawCustomBldBox(layout);
    this.drawPopupIcon(0, 128, 0x3d);
  }

  protected drawAdv2BuildingBox(): void {
    const layout = [
      0x9e, 2, 99, /* tower */
      0x98, 8, 84, /* fortress */
      0x99, 0, 1,
      0xc0, 0, 46,
      0x9a, 8, 1,
      0x9b, 8, 45,
      -1,
    ];

    let l = layout;
    if (!this.interface.getGame()!.canBuildMilitary(this.interface.getMapCursorPos())) {
      l = l.slice(2 * 3); /* Skip tower and fortress */
    }

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternConstruction);
    this.drawCustomBldBox(l);
    this.drawPopupIcon(0, 128, 0x3d);
  }

  /* Draw generic popup box of resources. */
  protected drawResourcesBox(resources: ResourceMap): void {
    const layout = [
      0x28, 1, 0, /* resources */
      0x29, 1, 16,
      0x2a, 1, 32,
      0x2b, 1, 48,
      0x2e, 1, 64,
      0x2c, 1, 80,
      0x2d, 1, 96,
      0x2f, 1, 112,
      0x30, 1, 128,
      0x31, 6, 0,
      0x32, 6, 16,
      0x36, 6, 32,
      0x37, 6, 48,
      0x35, 6, 64,
      0x38, 6, 80,
      0x39, 6, 96,
      0x34, 6, 112,
      0x33, 6, 128,
      0x3a, 11, 0,
      0x3b, 11, 16,
      0x22, 11, 32,
      0x23, 11, 48,
      0x24, 11, 64,
      0x25, 11, 80,
      0x26, 11, 96,
      0x27, 11, 112,
      -1,
    ];

    this.drawCustomIconBox(layout);

    const layoutRes = [
      3, 4, ResourceType.TypeLumber,
      3, 20, ResourceType.TypePlank,
      3, 36, ResourceType.TypeBoat,
      3, 52, ResourceType.TypeStone,
      3, 68, ResourceType.TypeCoal,
      3, 84, ResourceType.TypeIronOre,
      3, 100, ResourceType.TypeSteel,
      3, 116, ResourceType.TypeGoldOre,
      3, 132, ResourceType.TypeGoldBar,
      8, 4, ResourceType.TypeShovel,
      8, 20, ResourceType.TypeHammer,
      8, 36, ResourceType.TypeAxe,
      8, 52, ResourceType.TypeSaw,
      8, 68, ResourceType.TypeScythe,
      8, 84, ResourceType.TypePick,
      8, 100, ResourceType.TypePincer,
      8, 116, ResourceType.TypeCleaver,
      8, 132, ResourceType.TypeRod,
      13, 4, ResourceType.TypeSword,
      13, 20, ResourceType.TypeShield,
      13, 36, ResourceType.TypeFish,
      13, 52, ResourceType.TypePig,
      13, 68, ResourceType.TypeMeat,
      13, 84, ResourceType.TypeWheat,
      13, 100, ResourceType.TypeFlour,
      13, 116, ResourceType.TypeBread,
    ];

    for (let i = 0; i < idiv(layoutRes.length, 3); i++) {
      const resType = layoutRes[i * 3 + 2] as ResourceType;
      const it = resources.get(resType);
      let value = 0;
      if (it !== undefined) {
        value = it | 0;
      }
      this.drawGreenNumber(layoutRes[i * 3], layoutRes[i * 3 + 1], value);
    }
  }

  /* Draw generic popup box of serfs. */
  protected drawSerfsBox(serfs: number[], total: number): void {
    const layout = [
      0x9, 1, 0, /* serfs */
      0xa, 1, 16,
      0xb, 1, 32,
      0xc, 1, 48,
      0x21, 1, 64,
      0x20, 1, 80,
      0x1f, 1, 96,
      0x1e, 1, 112,
      0x1d, 1, 128,
      0xd, 6, 0,
      0xe, 6, 16,
      0x12, 6, 32,
      0xf, 6, 48,
      0x10, 6, 64,
      0x11, 6, 80,
      0x19, 6, 96,
      0x1a, 6, 112,
      0x1b, 6, 128,
      0x13, 11, 0,
      0x14, 11, 16,
      0x15, 11, 32,
      0x16, 11, 48,
      0x17, 11, 64,
      0x18, 11, 80,
      0x1c, 11, 96,
      0x82, 11, 112,
      -1,
    ];

    this.drawCustomIconBox(layout);

    /* First column */
    this.drawGreenNumber(3, 4, serfs[SerfType.TypeTransporter]);
    this.drawGreenNumber(3, 20, serfs[SerfType.TypeSailor]);
    this.drawGreenNumber(3, 36, serfs[SerfType.TypeDigger]);
    this.drawGreenNumber(3, 52, serfs[SerfType.TypeBuilder]);
    this.drawGreenNumber(3, 68, serfs[SerfType.TypeKnight4]);
    this.drawGreenNumber(3, 84, serfs[SerfType.TypeKnight3]);
    this.drawGreenNumber(3, 100, serfs[SerfType.TypeKnight2]);
    this.drawGreenNumber(3, 116, serfs[SerfType.TypeKnight1]);
    this.drawGreenNumber(3, 132, serfs[SerfType.TypeKnight0]);

    /* Second column */
    this.drawGreenNumber(8, 4, serfs[SerfType.TypeLumberjack]);
    this.drawGreenNumber(8, 20, serfs[SerfType.TypeSawmiller]);
    this.drawGreenNumber(8, 36, serfs[SerfType.TypeSmelter]);
    this.drawGreenNumber(8, 52, serfs[SerfType.TypeStonecutter]);
    this.drawGreenNumber(8, 68, serfs[SerfType.TypeForester]);
    this.drawGreenNumber(8, 84, serfs[SerfType.TypeMiner]);
    this.drawGreenNumber(8, 100, serfs[SerfType.TypeBoatBuilder]);
    this.drawGreenNumber(8, 116, serfs[SerfType.TypeToolmaker]);
    this.drawGreenNumber(8, 132, serfs[SerfType.TypeWeaponSmith]);

    /* Third column */
    this.drawGreenNumber(13, 4, serfs[SerfType.TypeFisher]);
    this.drawGreenNumber(13, 20, serfs[SerfType.TypePigFarmer]);
    this.drawGreenNumber(13, 36, serfs[SerfType.TypeButcher]);
    this.drawGreenNumber(13, 52, serfs[SerfType.TypeFarmer]);
    this.drawGreenNumber(13, 68, serfs[SerfType.TypeMiller]);
    this.drawGreenNumber(13, 84, serfs[SerfType.TypeBaker]);
    this.drawGreenNumber(13, 100, serfs[SerfType.TypeGeologist]);
    this.drawGreenNumber(13, 116, serfs[SerfType.TypeGeneric]);

    if (total >= 0) {
      this.drawGreenLargeNumber(11, 132, total);
    }
  }

  protected drawStatSelectBox(): void {
    const layout = [
      72, 1, 12,
      73, 6, 12,
      77, 11, 12,
      74, 1, 56,
      76, 6, 56,
      75, 11, 56,
      71, 1, 100,
      70, 6, 100,
      61, 12, 104, /* Flip */
      60, 14, 128, /* Exit */
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStripedGreen);
    this.drawCustomIconBox(layout);
  }

  protected drawStat4Box(): void {
    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStripedGreen);

    /* Sum up resources of all inventories. */
    const resources: ResourceMap = this.interface.getPlayer()!.getStatsResources();

    this.drawResourcesBox(resources);

    this.drawPopupIcon(14, 128, 60); /* exit */
  }

  protected drawBuildingCount(x_: number, y_: number, type: number): void {
    const player = this.interface.getPlayer()!;
    this.drawGreenNumber(x_, y_, player.getCompletedBuildingCount(type as BuildingType));
    this.drawAdditionalNumber(x_ + 1, y_, player.getIncompleteBuildingCount(type as BuildingType));
  }

  protected drawStatBld1Box(): void {
    const bldLayout = [
      192, 0, 5,
      171, 2, 77,
      158, 8, 7,
      152, 6, 69,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStripedGreen);

    this.drawCustomBldBox(bldLayout);

    this.drawBuildingCount(2, 105, BuildingType.TypeHut);
    this.drawBuildingCount(10, 53, BuildingType.TypeTower);
    this.drawBuildingCount(9, 130, BuildingType.TypeFortress);
    this.drawBuildingCount(4, 61, BuildingType.TypeStock);

    this.drawPopupIcon(0, 128, 61); /* flip */
    this.drawPopupIcon(14, 128, 60); /* exit */
  }

  protected drawStatBld2Box(): void {
    const bldLayout = [
      153, 0, 4,
      160, 8, 6,
      157, 0, 68,
      169, 8, 65,
      174, 12, 57,
      170, 4, 105,
      168, 8, 107,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStripedGreen);

    this.drawCustomBldBox(bldLayout);

    this.drawBuildingCount(3, 54, BuildingType.TypeToolMaker);
    this.drawBuildingCount(10, 48, BuildingType.TypeSawmill);
    this.drawBuildingCount(3, 95, BuildingType.TypeWeaponSmith);
    this.drawBuildingCount(8, 95, BuildingType.TypeStonecutter);
    this.drawBuildingCount(12, 95, BuildingType.TypeBoatbuilder);
    this.drawBuildingCount(5, 132, BuildingType.TypeForester);
    this.drawBuildingCount(9, 132, BuildingType.TypeLumberjack);

    this.drawPopupIcon(0, 128, 61); /* flip */
    this.drawPopupIcon(14, 128, 60); /* exit */
  }

  protected drawStatBld3Box(): void {
    const bldLayout = [
      155, 0, 2,
      154, 8, 3,
      167, 0, 61,
      156, 8, 60,
      188, 4, 75,
      162, 8, 100,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStripedGreen);

    this.drawCustomBldBox(bldLayout);

    this.drawBuildingCount(3, 48, BuildingType.TypePigFarm);
    this.drawBuildingCount(11, 48, BuildingType.TypeFarm);
    this.drawBuildingCount(0, 92, BuildingType.TypeFisher);
    this.drawBuildingCount(11, 87, BuildingType.TypeButcher);
    this.drawBuildingCount(5, 134, BuildingType.TypeMill);
    this.drawBuildingCount(10, 134, BuildingType.TypeBaker);

    this.drawPopupIcon(0, 128, 61); /* flip */
    this.drawPopupIcon(14, 128, 60); /* exit */
  }

  protected drawStatBld4Box(): void {
    const bldLayout = [
      163, 0, 4,
      164, 4, 4,
      165, 8, 4,
      166, 12, 4,
      161, 2, 90,
      159, 8, 90,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStripedGreen);

    this.drawCustomBldBox(bldLayout);

    this.drawBuildingCount(0, 71, BuildingType.TypeStoneMine);
    this.drawBuildingCount(4, 71, BuildingType.TypeCoalMine);
    this.drawBuildingCount(8, 71, BuildingType.TypeIronMine);
    this.drawBuildingCount(12, 71, BuildingType.TypeGoldMine);
    this.drawBuildingCount(4, 130, BuildingType.TypeSteelSmelter);
    this.drawBuildingCount(9, 130, BuildingType.TypeGoldSmelter);

    this.drawPopupIcon(0, 128, 61); /* flip */
    this.drawPopupIcon(14, 128, 60); /* exit */
  }

  protected drawPlayerStatChart(data: number[], index: number, color: Color): void {
    const lx = 8;
    const ly = 9;
    const lw = 112;
    const lh = 100;

    let prevValue = data[index];

    for (let i = 0; i < lw; i++) {
      const value = data[index];
      index = index > 0 ? index - 1 : lw - 1;

      if (value > 0 || prevValue > 0) {
        if (value > prevValue) {
          let diff = value - prevValue;
          const h = idiv(diff, 2);
          this.frame!.fillRect(lx + lw - i, ly + lh - h - prevValue, 1, h, color);
          diff -= h;
          this.frame!.fillRect(lx + lw - i - 1, ly + lh - value, 1, diff, color);
        } else if (value === prevValue) {
          this.frame!.fillRect(lx + lw - i - 1, ly + lh - value, 2, 1, color);
        } else {
          let diff = prevValue - value;
          const h = idiv(diff, 2);
          this.frame!.fillRect(lx + lw - i, ly + lh - prevValue, 1, h, color);
          diff -= h;
          this.frame!.fillRect(lx + lw - i - 1, ly + lh - value - diff, 1, diff, color);
        }
      }

      prevValue = value;
    }
  }

  protected drawStat8Box(): void {
    const layout = [
      0x58, 14, 0,
      0x59, 0, 100,
      0x41, 8, 112,
      0x42, 10, 112,
      0x43, 8, 128,
      0x44, 10, 128,
      0x45, 2, 112,
      0x40, 4, 112,
      0x3e, 2, 128,
      0x3f, 4, 128,
      0x133, 14, 112,

      0x3c, 14, 128, /* exit */
      -1,
    ];

    const scale: InterfaceStatScale = this.interface.getSelectedStatScale();
    const aspect: InterfaceStatAspect = this.interface.getSelectedStatAspect();

    /* Draw background */
    this.drawBoxRow(132 + aspect, 0);
    this.drawBoxRow(132 + aspect, 16);
    this.drawBoxRow(132 + aspect, 32);
    this.drawBoxRow(132 + aspect, 48);
    this.drawBoxRow(132 + aspect, 64);
    this.drawBoxRow(132 + aspect, 80);
    this.drawBoxRow(132 + aspect, 96);

    this.drawBoxRow(136, 108);
    this.drawBoxRow(129, 116);
    this.drawBoxRow(137, 132);

    this.drawCustomIconBox(layout);

    /* Draw checkmarks to indicate current settings. */
    this.drawPopupIcon(
      !BIT_TEST(aspect, 0) ? 1 : 6,
      !BIT_TEST(aspect, 1) ? 116 : 132,
      106,
    ); /* checkmark */

    this.drawPopupIcon(
      !BIT_TEST(scale, 0) ? 7 : 12,
      !BIT_TEST(scale, 1) ? 116 : 132,
      106,
    ); /* checkmark */

    /* Correct numbers on time scale. */
    this.drawPopupIcon(2, 103, 94 + 3 * scale + 0);
    this.drawPopupIcon(6, 103, 94 + 3 * scale + 1);
    this.drawPopupIcon(10, 103, 94 + 3 * scale + 2);

    /* Draw chart */
    const game = this.interface.getGame()!;
    const index = game.getPlayerHistoryIndex(scale);
    for (let i = 0; i < GAME_MAX_PLAYER_COUNT; i++) {
      if (game.getPlayer(GAME_MAX_PLAYER_COUNT - i - 1) !== null) {
        const player = game.getPlayer(GAME_MAX_PLAYER_COUNT - i - 1)!;
        const color: Color = this.interface.getPlayerColor(GAME_MAX_PLAYER_COUNT - i - 1);
        const mode = (aspect << 2) | scale;
        this.drawPlayerStatChart(player.getPlayerStatHistory(mode), index, color);
      }
    }
  }

  protected drawStat7Box(): void {
    const layout = [
      0x81, 6, 80,
      0x81, 8, 80,
      0x81, 6, 96,
      0x81, 8, 96,

      0x59, 0, 64,
      0x5a, 14, 0,

      0x28, 0, 75, /* lumber */
      0x29, 2, 75, /* plank */
      0x2b, 4, 75, /* stone */
      0x2e, 0, 91, /* coal */
      0x2c, 2, 91, /* ironore */
      0x2f, 4, 91, /* goldore */
      0x2a, 0, 107, /* boat */
      0x2d, 2, 107, /* iron */
      0x30, 4, 107, /* goldbar */
      0x3a, 7, 83, /* sword */
      0x3b, 7, 99, /* shield */
      0x31, 10, 75, /* shovel */
      0x32, 12, 75, /* hammer */
      0x36, 14, 75, /* axe */
      0x37, 10, 91, /* saw */
      0x38, 12, 91, /* pick */
      0x35, 14, 91, /* scythe */
      0x34, 10, 107, /* cleaver */
      0x39, 12, 107, /* pincer */
      0x33, 14, 107, /* rod */
      0x22, 1, 125, /* fish */
      0x23, 3, 125, /* pig */
      0x24, 5, 125, /* meat */
      0x25, 7, 125, /* wheat */
      0x26, 9, 125, /* flour */
      0x27, 11, 125, /* bread */

      0x3c, 14, 128, /* exitbox */
      -1,
    ];

    this.drawBoxRow(129, 64);
    this.drawBoxRow(129, 112);
    this.drawBoxRow(129, 128);

    this.drawCustomIconBox(layout);

    const item: ResourceType = this.interface.getSelectedStatResource();

    /* Draw background of chart */
    for (let iy = 0; iy < 64; iy += 16) {
      for (let ix = 0; ix < 14; ix += 2) {
        this.drawPopupIcon(ix, iy, 138 + item);
      }
    }

    const sampleWeights = [4, 6, 8, 9, 10, 9, 8, 6, 4];

    /* Create array of historical counts */
    const historicalData: number[] = new Array<number>(112);
    let maxVal = 0;
    let index = this.interface.getGame()!.getResourceHistoryIndex();

    for (let i = 0; i < 112; i++) {
      historicalData[i] = 0;
      let j = index;
      for (let k = 0; k < 9; k++) {
        historicalData[i] +=
          sampleWeights[k] * this.interface.getPlayer()!.getResourceCountHistory(item)[j];
        j = j > 0 ? j - 1 : 119;
      }

      if (historicalData[i] > maxVal) {
        maxVal = historicalData[i];
      }

      index = index > 0 ? index - 1 : 119;
    }

    const axisIcons1 = [110, 109, 108, 107];
    const axisIcons2 = [112, 111, 110, 108];
    const axisIcons3 = [114, 113, 112, 110];
    const axisIcons4 = [117, 116, 114, 112];
    const axisIcons5 = [120, 119, 118, 115];
    const axisIcons6 = [122, 121, 120, 118];
    const axisIcons7 = [125, 124, 122, 120];
    const axisIcons8 = [128, 127, 126, 123];

    let axisIcons: number[];
    let multiplier = 0;

    /* TODO chart background pattern */

    if (maxVal <= 64) {
      axisIcons = axisIcons1;
      multiplier = 0x8000;
    } else if (maxVal <= 128) {
      axisIcons = axisIcons2;
      multiplier = 0x4000;
    } else if (maxVal <= 256) {
      axisIcons = axisIcons3;
      multiplier = 0x2000;
    } else if (maxVal <= 512) {
      axisIcons = axisIcons4;
      multiplier = 0x1000;
    } else if (maxVal <= 1280) {
      axisIcons = axisIcons5;
      multiplier = 0x666;
    } else if (maxVal <= 2560) {
      axisIcons = axisIcons6;
      multiplier = 0x333;
    } else if (maxVal <= 5120) {
      axisIcons = axisIcons7;
      multiplier = 0x199;
    } else {
      axisIcons = axisIcons8;
      multiplier = 0xa3;
    }

    /* Draw axis icons */
    for (let i = 0; i < 4; i++) {
      this.drawPopupIcon(14, i * 16, axisIcons[i]);
    }

    /* Draw chart */
    for (let i = 0; i < 112; i++) {
      const value = Math.min(Math.imul(historicalData[i], multiplier) >> 16, 64);
      if (value > 0) {
        this.frame!.fillRect(119 - i, 73 - value, 1, value, new Color(0xcf, 0x63, 0x63));
      }
    }
  }

  protected drawGaugeBalance(lx: number, ly: number, value: number, count: number): void {
    let sprite = 0xd3;
    if (count > 0) {
      const v = idiv(16 * value, count);
      if (v >= 230) {
        sprite = 0xd2;
      } else if (v >= 207) {
        sprite = 0xd1;
      } else if (v >= 184) {
        sprite = 0xd0;
      } else if (v >= 161) {
        sprite = 0xcf;
      } else if (v >= 138) {
        sprite = 0xce;
      } else if (v >= 115) {
        sprite = 0xcd;
      } else if (v >= 92) {
        sprite = 0xcc;
      } else if (v >= 69) {
        sprite = 0xcb;
      } else if (v >= 46) {
        sprite = 0xca;
      } else if (v >= 23) {
        sprite = 0xc9;
      } else {
        sprite = 0xc8;
      }
    }

    this.drawPopupIcon(lx, ly, sprite);
  }

  protected drawGaugeFull(lx: number, ly: number, value: number, count: number): void {
    let sprite = 0xc7;
    if (count > 0) {
      const v = idiv(16 * value, count);
      if (v >= 230) {
        sprite = 0xc6;
      } else if (v >= 207) {
        sprite = 0xc5;
      } else if (v >= 184) {
        sprite = 0xc4;
      } else if (v >= 161) {
        sprite = 0xc3;
      } else if (v >= 138) {
        sprite = 0xc2;
      } else if (v >= 115) {
        sprite = 0xc1;
      } else if (v >= 92) {
        sprite = 0xc0;
      } else if (v >= 69) {
        sprite = 0xbf;
      } else if (v >= 46) {
        sprite = 0xbe;
      } else if (v >= 23) {
        sprite = 0xbd;
      } else {
        sprite = 0xbc;
      }
    }

    this.drawPopupIcon(lx, ly, sprite);
  }

  protected drawStat1Box(): void {
    const layout = [
      0x18, 0, 0, /* baker */
      0xb4, 0, 16,
      0xb3, 0, 24,
      0xb2, 0, 32,
      0xb3, 0, 40,
      0xb2, 0, 48,
      0xb3, 0, 56,
      0xb2, 0, 64,
      0xb3, 0, 72,
      0xb2, 0, 80,
      0xb3, 0, 88,
      0xd4, 0, 96,
      0xb1, 0, 112,
      0x13, 0, 120, /* fisher */
      0x15, 2, 48, /* butcher */
      0xb4, 2, 64,
      0xb3, 2, 72,
      0xd4, 2, 80,
      0xa4, 2, 96,
      0xa4, 2, 112,
      0xae, 4, 4,
      0xae, 4, 36,
      0xa6, 4, 80,
      0xa6, 4, 96,
      0xa6, 4, 112,
      0x26, 6, 0, /* flour */
      0x23, 6, 32, /* pig */
      0xb5, 6, 64,
      0x24, 6, 76, /* meat */
      0x27, 6, 92, /* bread */
      0x22, 6, 108, /* fish */
      0xb6, 6, 124,
      0x17, 8, 0, /* miller */
      0x14, 8, 32, /* pigfarmer */
      0xa6, 8, 64,
      0xab, 8, 88,
      0xab, 8, 104,
      0xa6, 8, 128,
      0xba, 12, 8,
      0x11, 12, 56, /* miner */
      0x11, 12, 80, /* miner */
      0x11, 12, 104, /* miner */
      0x11, 12, 128, /* miner */
      0x16, 14, 0, /* farmer */
      0x25, 14, 16, /* wheat */
      0x2f, 14, 56, /* goldore */
      0x2e, 14, 80, /* coal */
      0x2c, 14, 104, /* ironore */
      0x2b, 14, 128, /* stone */
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStripedGreen);

    this.drawCustomIconBox(layout);

    const values = newGaugeValues();
    calculateGaugeValues(this.interface.getPlayer()!, values);

    this.drawGaugeBalance(10, 0, values[BuildingType.TypeMill][0][0], values[BuildingType.TypeMill][0][1]);
    this.drawGaugeBalance(2, 0, values[BuildingType.TypeBaker][0][0], values[BuildingType.TypeBaker][0][1]);
    this.drawGaugeFull(10, 32, values[BuildingType.TypePigFarm][0][0], values[BuildingType.TypePigFarm][0][1]);
    this.drawGaugeBalance(2, 32, values[BuildingType.TypeButcher][0][0], values[BuildingType.TypeButcher][0][1]);
    this.drawGaugeFull(10, 56, values[BuildingType.TypeGoldMine][0][0], values[BuildingType.TypeGoldMine][0][1]);
    this.drawGaugeFull(10, 80, values[BuildingType.TypeCoalMine][0][0], values[BuildingType.TypeCoalMine][0][1]);
    this.drawGaugeFull(10, 104, values[BuildingType.TypeIronMine][0][0], values[BuildingType.TypeIronMine][0][1]);
    this.drawGaugeFull(10, 128, values[BuildingType.TypeStoneMine][0][0], values[BuildingType.TypeStoneMine][0][1]);
  }

  protected drawStat2Box(): void {
    const layout = [
      0x11, 0, 0, /* miner */
      0x11, 0, 24, /* miner */
      0x11, 0, 56, /* miner */
      0xd, 0, 80, /* lumberjack */
      0x11, 0, 104, /* miner */
      0xf, 0, 128, /* stonecutter */
      0x2f, 2, 0, /* goldore */
      0x2e, 2, 24, /* coal */
      0xb0, 2, 40,
      0x2c, 2, 56, /* ironore */
      0x28, 2, 80, /* lumber */
      0x2b, 2, 104, /* stone */
      0x2b, 2, 128, /* stone */
      0xaa, 4, 4,
      0xab, 4, 24,
      0xad, 4, 32,
      0xa8, 4, 40,
      0xac, 4, 60,
      0xaa, 4, 84,
      0xbb, 4, 108,
      0xa4, 6, 32,
      0xe, 6, 96, /* sawmiller */
      0xa5, 6, 132,
      0x30, 8, 0, /* gold */
      0x12, 8, 16, /* smelter */
      0xa4, 8, 32,
      0x2d, 8, 40, /* steel */
      0x12, 8, 56, /* smelter */
      0xb8, 8, 80,
      0x29, 8, 96, /* planks */
      0xaf, 8, 112,
      0xa5, 8, 132,
      0xaa, 10, 4,
      0xb9, 10, 24,
      0xab, 10, 40,
      0xb7, 10, 48,
      0xa6, 10, 80,
      0xa9, 10, 96,
      0xa6, 10, 112,
      0xa7, 10, 132,
      0x21, 14, 0, /* knight 4 */
      0x1b, 14, 28, /* weaponsmith */
      0x1a, 14, 64, /* toolmaker */
      0x19, 14, 92, /* boatbuilder */
      0xc, 14, 120, /* builder */
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStripedGreen);

    this.drawCustomIconBox(layout);

    const values = newGaugeValues();
    calculateGaugeValues(this.interface.getPlayer()!, values);

    this.drawGaugeBalance(6, 0, values[BuildingType.TypeGoldSmelter][1][0], values[BuildingType.TypeGoldSmelter][1][1]);
    this.drawGaugeBalance(6, 16, values[BuildingType.TypeGoldSmelter][0][0], values[BuildingType.TypeGoldSmelter][0][1]);
    this.drawGaugeBalance(6, 40, values[BuildingType.TypeSteelSmelter][0][0], values[BuildingType.TypeSteelSmelter][0][1]);
    this.drawGaugeBalance(6, 56, values[BuildingType.TypeSteelSmelter][1][0], values[BuildingType.TypeSteelSmelter][1][1]);

    this.drawGaugeBalance(6, 80, values[BuildingType.TypeSawmill][1][0], values[BuildingType.TypeSawmill][1][1]);

    const goldValue =
      values[BuildingType.TypeHut][1][0] +
      values[BuildingType.TypeTower][1][0] +
      values[BuildingType.TypeFortress][1][0];
    const goldCount =
      values[BuildingType.TypeHut][1][1] +
      values[BuildingType.TypeTower][1][1] +
      values[BuildingType.TypeFortress][1][1];
    this.drawGaugeFull(12, 0, goldValue, goldCount);

    this.drawGaugeBalance(12, 20, values[BuildingType.TypeWeaponSmith][0][0], values[BuildingType.TypeWeaponSmith][0][1]);
    this.drawGaugeBalance(12, 36, values[BuildingType.TypeWeaponSmith][1][0], values[BuildingType.TypeWeaponSmith][1][1]);

    this.drawGaugeBalance(12, 56, values[BuildingType.TypeToolMaker][1][0], values[BuildingType.TypeToolMaker][1][1]);
    this.drawGaugeBalance(12, 72, values[BuildingType.TypeToolMaker][0][0], values[BuildingType.TypeToolMaker][0][1]);

    this.drawGaugeBalance(12, 92, values[BuildingType.TypeBoatbuilder][0][0], values[BuildingType.TypeBoatbuilder][0][1]);

    this.drawGaugeFull(12, 112, values[0][0][0], values[0][0][1]);
    this.drawGaugeFull(12, 128, values[0][1][0], values[0][1][1]);
  }

  protected drawStat6Box(): void {
    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStripedGreen);

    let total = 0;
    for (let i = 0; i < 27; i++) {
      if (i !== SerfType.TypeTransporterInventory) {
        total += this.interface.getPlayer()!.getSerfCount(i);
      }
    }

    this.drawSerfsBox(this.interface.getPlayer()!.getSerfs(), total);

    this.drawPopupIcon(14, 128, 60); /* exit */
  }

  protected drawStat3Meter(lx: number, ly: number, value: number): void {
    let sprite = 0xc6;
    if (value < 1) {
      sprite = 0xbc;
    } else if (value < 2) {
      sprite = 0xbe;
    } else if (value < 3) {
      sprite = 0xc0;
    } else if (value < 4) {
      sprite = 0xc1;
    } else if (value < 5) {
      sprite = 0xc2;
    } else if (value < 7) {
      sprite = 0xc3;
    } else if (value < 10) {
      sprite = 0xc4;
    } else if (value < 20) {
      sprite = 0xc5;
    }
    this.drawPopupIcon(lx, ly, sprite);
  }

  protected drawStat3Box(): void {
    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStripedGreen);

    // PORT: std::map::operator[] gives 0 for a missing key; `serfs` becomes
    // the array of the 27 values after the sum.
    const serfsIdle = this.interface.getPlayer()!.getStatsSerfsIdle();
    const serfsPotential = this.interface.getPlayer()!.getStatsSerfsPotential();
    const serfs: number[] = [];
    for (let i = 0; i < 27; ++i) {
      serfs[i] = (serfsIdle.get(i as SerfType) ?? 0) + (serfsPotential.get(i as SerfType) ?? 0);
    }

    const layout = [
      0x9, 1, 0, /* serfs */
      0xa, 1, 16,
      0xb, 1, 32,
      0xc, 1, 48,
      0x21, 1, 64,
      0x20, 1, 80,
      0x1f, 1, 96,
      0x1e, 1, 112,
      0x1d, 1, 128,
      0xd, 6, 0,
      0xe, 6, 16,
      0x12, 6, 32,
      0xf, 6, 48,
      0x10, 6, 64,
      0x11, 6, 80,
      0x19, 6, 96,
      0x1a, 6, 112,
      0x1b, 6, 128,
      0x13, 11, 0,
      0x14, 11, 16,
      0x15, 11, 32,
      0x16, 11, 48,
      0x17, 11, 64,
      0x18, 11, 80,
      0x1c, 11, 96,
      0x82, 11, 112,
      -1,
    ];

    this.drawCustomIconBox(layout);

    /* First column */
    this.drawStat3Meter(3, 0, serfs[SerfType.TypeTransporter]);
    this.drawStat3Meter(3, 16, serfs[SerfType.TypeSailor]);
    this.drawStat3Meter(3, 32, serfs[SerfType.TypeDigger]);
    this.drawStat3Meter(3, 48, serfs[SerfType.TypeBuilder]);
    this.drawStat3Meter(3, 64, serfs[SerfType.TypeKnight4]);
    this.drawStat3Meter(3, 80, serfs[SerfType.TypeKnight3]);
    this.drawStat3Meter(3, 96, serfs[SerfType.TypeKnight2]);
    this.drawStat3Meter(3, 112, serfs[SerfType.TypeKnight1]);
    this.drawStat3Meter(3, 128, serfs[SerfType.TypeKnight0]);

    /* Second column */
    this.drawStat3Meter(8, 0, serfs[SerfType.TypeLumberjack]);
    this.drawStat3Meter(8, 16, serfs[SerfType.TypeSawmiller]);
    this.drawStat3Meter(8, 32, serfs[SerfType.TypeSmelter]);
    this.drawStat3Meter(8, 48, serfs[SerfType.TypeStonecutter]);
    this.drawStat3Meter(8, 64, serfs[SerfType.TypeForester]);
    this.drawStat3Meter(8, 80, serfs[SerfType.TypeMiner]);
    this.drawStat3Meter(8, 96, serfs[SerfType.TypeBoatBuilder]);
    this.drawStat3Meter(8, 112, serfs[SerfType.TypeToolmaker]);
    this.drawStat3Meter(8, 128, serfs[SerfType.TypeWeaponSmith]);

    /* Third column */
    this.drawStat3Meter(13, 0, serfs[SerfType.TypeFisher]);
    this.drawStat3Meter(13, 16, serfs[SerfType.TypePigFarmer]);
    this.drawStat3Meter(13, 32, serfs[SerfType.TypeButcher]);
    this.drawStat3Meter(13, 48, serfs[SerfType.TypeFarmer]);
    this.drawStat3Meter(13, 64, serfs[SerfType.TypeMiller]);
    this.drawStat3Meter(13, 80, serfs[SerfType.TypeBaker]);
    this.drawStat3Meter(13, 96, serfs[SerfType.TypeGeologist]);
    this.drawStat3Meter(13, 112, serfs[SerfType.TypeGeneric]);

    this.drawPopupIcon(14, 128, 60); /* exit */
  }

  protected drawStartAttackRedrawBox(): void {
    /* TODO Should overwrite the previously drawn number.
       Just use fill_rect(), perhaps? */
    this.drawGreenString(6, 116, '    ');
    this.drawGreenNumber(7, 116, this.interface.attack.knightsAttacking);
  }

  protected drawStartAttackBox(): void {
    const buildingLayout = [
      0x0, 2, 33,
      0xa, 6, 30,
      0x7, 10, 33,
      0xc, 14, 30,
      0xe, 2, 36,
      0x2, 6, 39,
      0xb, 10, 36,
      0x4, 12, 39,
      0x8, 8, 42,
      0xf, 12, 42,
      -1,
    ];

    const iconLayout = [
      216, 1, 80,
      217, 5, 80,
      218, 9, 80,
      219, 13, 80,
      220, 4, 112,
      221, 10, 112,
      222, 0, 128,
      60, 14, 128,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternConstruction);

    for (let i = 0; buildingLayout[i] >= 0; i += 3) {
      this.drawPopupBuilding(buildingLayout[i + 1], buildingLayout[i + 2], buildingLayout[i]);
    }

    const building = this.interface.getGame()!.getBuilding(
      this.interface.attack.buildingAttacked,
    )!;
    let ly = 0;

    switch (building.getType()) {
      case BuildingType.TypeHut: ly = 50; break;
      case BuildingType.TypeTower: ly = 32; break;
      case BuildingType.TypeFortress: ly = 17; break;
      case BuildingType.TypeCastle: ly = 0; break;
      default: NOT_REACHED();
    }

    this.drawPopupBuilding(0, ly, mapBuildingSprite[building.getType()]);
    this.drawCustomIconBox(iconLayout);

    /* Draw number of knight at each distance. */
    for (let i = 0; i < 4; i++) {
      this.drawGreenNumber(1 + 4 * i, 96, this.interface.attack.attackingKnights[i]);
    }

    this.drawStartAttackRedrawBox();
  }

  protected drawGroundAnalysisBox(): void {
    const layout = [
      0x1c, 7, 10,
      0x2f, 1, 50,
      0x2c, 1, 70,
      0x2e, 1, 90,
      0x2b, 1, 110,
      0x3c, 14, 128,
      -1,
    ];

    const pos: MapPos = this.interface.getMapCursorPos();
    const estimates: number[] = [0, 0, 0, 0, 0];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStripedGreen);
    this.drawCustomIconBox(layout);
    this.interface.getGame()!.prepareGroundAnalysis(pos, estimates);
    this.drawGreenString(0, 30, _('GROUND-ANALYSIS:'));

    /* Gold */
    let s = this.prepareResAmountText(2 * estimates[MapMinerals.MineralsGold]);
    this.drawGreenString(3, 54, s);

    /* Iron */
    s = this.prepareResAmountText(estimates[MapMinerals.MineralsIron]);
    this.drawGreenString(3, 74, s);

    /* Coal */
    s = this.prepareResAmountText(estimates[MapMinerals.MineralsCoal]);
    this.drawGreenString(3, 94, s);

    /* Stone */
    s = this.prepareResAmountText(2 * estimates[MapMinerals.MineralsStone]);
    this.drawGreenString(3, 114, s);
  }

  protected drawSettSelectBox(): void {
    const layout = [
      230, 1, 8,
      231, 6, 8,
      232, 11, 8,
      234, 1, 48,
      235, 6, 48,
      299, 11, 48,
      233, 1, 88,
      298, 6, 88,
      61, 12, 104,
      60, 14, 128,

      285, 4, 128,
      286, 0, 128,
      224, 8, 128,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternCheckerdDiagonalBrown);
    this.drawCustomIconBox(layout);
  }

  /* Draw slide bar in a popup box. */
  protected drawSlideBar(lx: number, ly: number, value: number): void {
    this.drawPopupIcon(lx, ly, 236);

    const lwidth = idiv(value, 1310);
    if (lwidth > 0) {
      this.frame!.fillRect(8 * lx + 15, ly + 11, lwidth, 4, new Color(0x6b, 0xab, 0x3b));
    }
  }

  protected drawSett1Box(): void {
    const bldLayout = [
      163, 12, 21,
      164, 8, 41,
      165, 4, 61,
      166, 0, 81,
      -1,
    ];

    const layout = [
      34, 4, 1,
      36, 7, 1,
      39, 10, 1,
      60, 14, 128,
      295, 1, 8,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternCheckerdDiagonalBrown);
    this.drawCustomBldBox(bldLayout);
    this.drawCustomIconBox(layout);

    const player = this.interface.getPlayer()!;

    const prioLayout = [
      4, 21, BuildingType.TypeStoneMine,
      0, 41, BuildingType.TypeCoalMine,
      8, 114, BuildingType.TypeIronMine,
      4, 133, BuildingType.TypeGoldMine,
    ];

    for (let i = 0; i < 4; i++) {
      this.drawSlideBar(
        prioLayout[i * 3],
        prioLayout[i * 3 + 1],
        player.getFoodForBuilding(prioLayout[i * 3 + 2]),
      );
    }
  }

  protected drawSett2Box(): void {
    const bldLayout = [
      186, 2, 0,
      174, 2, 41,
      153, 8, 54,
      157, 0, 102,
      -1,
    ];

    const layout = [
      41, 9, 25,
      45, 9, 119,
      60, 14, 128,
      295, 13, 8,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternCheckerdDiagonalBrown);
    this.drawCustomBldBox(bldLayout);
    this.drawCustomIconBox(layout);

    const player = this.interface.getPlayer()!;

    this.drawSlideBar(0, 26, player.getPlanksConstruction());
    this.drawSlideBar(0, 36, player.getPlanksBoatbuilder());
    this.drawSlideBar(8, 44, player.getPlanksToolmaker());
    this.drawSlideBar(8, 103, player.getSteelToolmaker());
    this.drawSlideBar(0, 130, player.getSteelWeaponsmith());
  }

  protected drawSett3Box(): void {
    const bldLayout = [
      161, 0, 1,
      159, 10, 0,
      157, 4, 56,
      188, 12, 61,
      155, 0, 101,
      -1,
    ];

    const layout = [
      46, 7, 19,
      37, 8, 101,
      60, 14, 128,
      295, 1, 60,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternCheckerdDiagonalBrown);
    this.drawCustomBldBox(bldLayout);
    this.drawCustomIconBox(layout);

    const player = this.interface.getPlayer()!;

    this.drawSlideBar(0, 39, player.getCoalSteelsmelter());
    this.drawSlideBar(8, 39, player.getCoalGoldsmelter());
    this.drawSlideBar(4, 47, player.getCoalWeaponsmith());
    this.drawSlideBar(0, 92, player.getWheatPigfarm());
    this.drawSlideBar(8, 118, player.getWheatMill());
  }

  protected drawKnightLevelBox(): void {
    const levelStr = [
      NC_('knight occupation', 'Minimum'), NC_('knight occupation', 'Weak'),
      NC_('knight occupation', 'Medium'), NC_('knight occupation', 'Good'),
      NC_('knight occupation', 'Full'), 'ERROR', 'ERROR', 'ERROR',
    ];

    const layout = [
      226, 0, 2,
      227, 0, 36,
      228, 0, 70,
      229, 0, 104,

      220, 4, 2, /* minus */
      221, 6, 2, /* plus */
      220, 4, 18, /* ... */
      221, 6, 18,
      220, 4, 36,
      221, 6, 36,
      220, 4, 52,
      221, 6, 52,
      220, 4, 70,
      221, 6, 70,
      220, 4, 86,
      221, 6, 86,
      220, 4, 104,
      221, 6, 104,
      220, 4, 120,
      221, 6, 120,

      60, 14, 128, /* exit */
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternCheckerdDiagonalBrown);

    const player = this.interface.getPlayer()!;

    for (let i = 0; i < 4; i++) {
      const ly = 8 + 34 * i;
      this.drawGreenString(
        8,
        ly,
        C_('knight occupation', levelStr[(player.getKnightOccupation(3 - i) >> 4) & 0x7]),
      );
      this.drawGreenString(
        8,
        ly + 11,
        C_('knight occupation', levelStr[player.getKnightOccupation(3 - i) & 0x7]),
      );
    }

    this.drawCustomIconBox(layout);
  }

  protected drawSett4Box(): void {
    const layout = [
      49, 1, 0, /* shovel */
      50, 1, 16, /* hammer */
      54, 1, 32, /* axe */
      55, 1, 48, /* saw */
      53, 1, 64, /* scythe */
      56, 1, 80, /* pick */
      57, 1, 96, /* pincer */
      52, 1, 112, /* cleaver */
      51, 1, 128, /* rod */

      60, 14, 128, /* exit*/
      295, 13, 8, /* default */
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternCheckerdDiagonalBrown);
    this.drawCustomIconBox(layout);

    const player = this.interface.getPlayer()!;
    this.drawSlideBar(4, 4, player.getToolPrio(0)); /* shovel */
    this.drawSlideBar(4, 20, player.getToolPrio(1)); /* hammer */
    this.drawSlideBar(4, 36, player.getToolPrio(5)); /* axe */
    this.drawSlideBar(4, 52, player.getToolPrio(6)); /* saw */
    this.drawSlideBar(4, 68, player.getToolPrio(4)); /* scythe */
    this.drawSlideBar(4, 84, player.getToolPrio(7)); /* pick */
    this.drawSlideBar(4, 100, player.getToolPrio(8)); /* pincer */
    this.drawSlideBar(4, 116, player.getToolPrio(3)); /* cleaver */
    this.drawSlideBar(4, 132, player.getToolPrio(2)); /* rod */
  }

  /* Draw generic popup box of resource stairs. */
  protected drawPopupResourceStairs(order: number[]): void {
    const spiralLayout = [
      5, 4,
      7, 6,
      9, 8,
      11, 10,
      13, 12,
      13, 28,
      11, 30,
      9, 32,
      7, 34,
      5, 36,
      3, 38,
      1, 40,
      1, 56,
      3, 58,
      5, 60,
      7, 62,
      9, 64,
      11, 66,
      13, 68,
      13, 84,
      11, 86,
      9, 88,
      7, 90,
      5, 92,
      3, 94,
      1, 96,
    ];

    for (let i = 0; i < 26; i++) {
      const pos = 26 - order[i];
      this.drawPopupIcon(spiralLayout[2 * pos], spiralLayout[2 * pos + 1], 34 + i);
    }
  }

  protected drawSett5Box(): void {
    const layout = [
      237, 1, 120, /* up */
      238, 3, 120, /* smallup */
      239, 9, 120, /* smalldown */
      240, 11, 120, /* down */
      295, 1, 4, /* default*/
      60, 14, 128, /* exit */
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternCheckerdDiagonalBrown);
    this.drawCustomIconBox(layout);
    this.drawPopupResourceStairs(this.interface.getPlayer()!.getFlagPrio());

    this.drawPopupIcon(6, 120, 33 + this.currentSett5Item);
  }

  protected drawQuitConfirmBox(): void {
    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternDiagonalGreen);

    this.drawGreenCentered(10, _('Do you want\nto quit\nthis game?'));
    /* Over the buttons. */
    this.drawGreenCenteredAt(36, 45, _('Yes'));
    this.drawGreenCenteredAt(112, 45, _('No'));
  }

  protected drawNoSaveQuitConfirmBox(): void {
    this.drawGreenCentered(
      70,
      _('The game has not\nbeen saved\nrecently.\n' + 'Are you\nsure?'),
    );
    this.drawGreenCenteredAt(36, 125, _('Yes'));
    this.drawGreenCenteredAt(112, 125, _('No'));
  }

  protected drawOptionsBox(): void {
    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternDiagonalGreen);

    this.drawGreenString(1, 14, _('Music'));
    this.drawGreenLines(1, 30, _('Sound\neffects'), 9);
    this.drawGreenString(1, 54, _('Volume'));

    const audio = Audio.getInstance();
    let player = audio.getMusicPlayer();
    // Music
    this.drawPopupIcon(13, 10, player && player.isEnabled() ? 288 : 220);
    player = audio.getSoundPlayer();
    // Sfx
    this.drawPopupIcon(13, 30, player && player.isEnabled() ? 288 : 220);
    this.drawPopupIcon(11, 50, 220); /* Volume minus */
    this.drawPopupIcon(13, 50, 221); /* Volume plus */

    let volume = 0;
    const volumeController = audio.getVolumeController();
    if (volumeController !== null) {
      volume = Math.fround(99 * volumeController.getVolume());
    }
    const str = String(Math.trunc(volume));
    this.drawGreenString(8, 54, str);

    this.drawGreenLines(1, 70, _('Fullscreen\nvideo'), 9);

    this.drawPopupIcon(
      13,
      70, /* Fullscreen mode */
      Graphics.getInstance().isFullscreen() ? 288 : 220,
    );

    const levels = [
      NC_('messages', 'None'), NC_('messages', 'Few'),
      NC_('messages', 'Most'), NC_('messages', 'All'),
    ];
    const value = levels[this.interface.getMessageLevel()];
    this.drawGreenString(1, 94, _('Messages'));
    this.drawGreenString(11, 94, C_('messages', value));

    /* Advanced options (not in the original game) */
    // PORT: hosted builds leave the button image out; the label stands in.
    if (!this.frame!.drawResourceImage(8 * 0 + 8, 128 + 9, 'button-advanced.png')) {
      this.drawGreenString(1, 128 + 13, _('Advanced'));
    }
    this.drawPopupIcon(14, 128, 60); /* exit */
  }

  protected drawCastleResBox(): void {
    const layout = [
      0x3d, 12, 128, /* flip */
      0x3c, 14, 128, /* exit */
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternPlaidAlongGreen);
    this.drawCustomIconBox(layout);

    if (this.interface.getPlayer()!.tempIndex === 0) {
      this.interface.closePopup();
      return;
    }

    const building = this.interface.getGame()!.getBuilding(this.interface.getPlayer()!.tempIndex)!;
    if (building.isBurning()) {
      this.interface.closePopup();
      return;
    }

    if (
      building.getType() !== BuildingType.TypeStock &&
      building.getType() !== BuildingType.TypeCastle
    ) {
      this.interface.closePopup();
      return;
    }

    const inventory = building.getInventory()!;
    const resources: ResourceMap = inventory.getAllResources();
    this.drawResourcesBox(resources);
  }

  protected drawMineOutputBox(): void {
    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternPlaidAlongGreen);

    if (this.interface.getPlayer()!.tempIndex === 0) {
      this.interface.closePopup();
      return;
    }

    const building = this.interface.getGame()!.getBuilding(this.interface.getPlayer()!.tempIndex)!;
    if (building.isBurning()) {
      this.interface.closePopup();
      return;
    }

    const type: BuildingType = building.getType();

    if (
      type !== BuildingType.TypeStoneMine &&
      type !== BuildingType.TypeCoalMine &&
      type !== BuildingType.TypeIronMine &&
      type !== BuildingType.TypeGoldMine
    ) {
      this.interface.closePopup();
      return;
    }

    /* Draw building */
    this.drawPopupBuilding(6, 60, mapBuildingSprite[type]);

    /* Draw serf icon */
    let sprite = 0xdc; /* minus box */
    if (building.hasSerf()) sprite = 0x11; /* miner */

    this.drawPopupIcon(10, 75, sprite);

    /* Draw food present at mine */
    const stock = building.getResCountInStock(0);
    const stockLeftCol = (stock + 1) >> 1;
    const stockRightCol = stock >> 1;

    /* Left column */
    for (let i = 0; i < stockLeftCol; i++) {
      this.drawPopupIcon(1, 90 - 8 * stockLeftCol + i * 16, 0x24); /* meat (food) sprite */
    }

    /* Right column */
    for (let i = 0; i < stockRightCol; i++) {
      this.drawPopupIcon(13, 90 - 8 * stockRightCol + i * 16, 0x24); /* meat (food) sprite */
    }

    /* Calculate output percentage (simple WMA) */
    const outputWeight = [10, 10, 9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 3, 2, 1];
    let output = 0;
    for (let i = 0; i < 15; i++) {
      output += (BIT_TEST(building.getProgress(), i) !== 0 ? 1 : 0) * outputWeight[i];
    }

    /* Print output precentage */
    let lx = 7;
    if (output >= 100) lx += 1;
    if (output >= 10) lx += 1;
    this.drawGreenString(lx, 38, '%');
    this.drawGreenNumber(6, 38, output);

    this.drawGreenLines(1, 14, _('MINING\nOUTPUT:'));

    /* Exit box */
    this.drawPopupIcon(14, 128, 0x3c);
  }

  protected drawOrderedBuildingBox(): void {
    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternPlaidAlongGreen);

    if (this.interface.getPlayer()!.tempIndex === 0) {
      this.interface.closePopup();
      return;
    }

    const building = this.interface.getGame()!.getBuilding(this.interface.getPlayer()!.tempIndex)!;
    if (building.isBurning()) {
      this.interface.closePopup();
      return;
    }

    const type: BuildingType = building.getType();

    const sprite = mapBuildingSprite[type];
    let lx = 6;
    if (sprite === 0xc0 /*stock*/ || sprite < 0x9e /*tower*/) lx = 4;
    this.drawPopupBuilding(lx, 40, sprite);

    this.drawGreenLines(2, 4, _('Ordered\nBuilding'));

    if (building.hasSerf()) {
      if (building.getProgress() === 0) { /* Digger */
        this.drawPopupIcon(2, 100, 0xb);
      } else { /* Builder */
        this.drawPopupIcon(2, 100, 0xc);
      }
    } else {
      this.drawPopupIcon(2, 100, 0xdc); /* Minus box */
    }

    this.drawPopupIcon(14, 128, 0x3c); /* Exit box */
  }

  protected drawDefendersBox(): void {
    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternPlaidAlongGreen);

    const player = this.interface.getPlayer()!;
    if (player.tempIndex === 0) {
      this.interface.closePopup();
      return;
    }

    const building = this.interface.getGame()!.getBuilding(player.tempIndex)!;
    if (building.isBurning()) {
      this.interface.closePopup();
      return;
    }

    if (building.getOwner() !== player.getIndex()) {
      this.interface.closePopup();
      return;
    }

    if (
      building.getType() !== BuildingType.TypeHut &&
      building.getType() !== BuildingType.TypeTower &&
      building.getType() !== BuildingType.TypeFortress
    ) {
      this.interface.closePopup();
      return;
    }

    /* Draw building sprite */
    const sprite = mapBuildingSprite[building.getType()];
    let lx = 0;
    let ly = 0;
    switch (building.getType()) {
      case BuildingType.TypeHut:
        lx = 6;
        ly = 20;
        break;
      case BuildingType.TypeTower:
        lx = 4;
        ly = 6;
        break;
      case BuildingType.TypeFortress:
        lx = 4;
        ly = 1;
        break;
      default:
        NOT_REACHED();
    }

    this.drawPopupBuilding(lx, ly, sprite);

    /* Draw gold stock */
    if (building.getResCountInStock(1) > 0) {
      const left = idiv(building.getResCountInStock(1) + 1, 2);
      for (let i = 0; i < left; i++) {
        this.drawPopupIcon(1, 32 - 8 * left + 16 * i, 0x30);
      }

      const right = idiv(building.getResCountInStock(1), 2);
      for (let i = 0; i < right; i++) {
        this.drawPopupIcon(13, 32 - 8 * right + 16 * i, 0x30);
      }
    }

    /* Draw heading string */
    this.drawGreenString(3, 62, _('Defenders:'));

    /* Draw knights */
    let nextKnight = building.getFirstKnight();
    for (let i = 0; nextKnight !== 0; i++) {
      const serf = this.interface.getGame()!.getSerf(nextKnight)!;
      this.drawPopupIcon(3 + 4 * (i % 3), 72 + 16 * idiv(i, 3), 7 + serf.getType());
      nextKnight = serf.getNext();
    }

    this.drawGreenString(0, 128, _('State:'));
    this.drawGreenNumber(7, 128, building.getThreatLevel() | 0);

    this.drawPopupIcon(14, 128, 0x3c); /* Exit box */
  }

  protected drawTransportInfoBox(): void {
    const layout = [
      9, 24,
      5, 24,
      3, 44,
      5, 64,
      9, 64,
      11, 44,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternPlaidAlongGreen);

    if (this.interface.getPlayer()!.tempIndex === 0) {
      this.interface.closePopup();
      return;
    }

    const flag = this.interface.getGame()!.getFlag(this.interface.getPlayer()!.tempIndex)!;

    /* Draw viewport of flag */
    const flagView = new Viewport(this.interface, this.interface.getGame()!.getMap());
    flagView.switchLayer(ViewportLayer.LayerLandscape);
    flagView.switchLayer(ViewportLayer.LayerSerfs);
    flagView.switchLayer(ViewportLayer.LayerCursor);
    flagView.setDisplayed(true);

    flagView.setParent(this);
    flagView.setSize(128, 64);
    flagView.moveToMapPos(flag.getPosition());
    flagView.moveByPixels(0, -10);

    flagView.moveTo(8, 24);
    flagView.draw(this.frame!);
    // PORT: the #else branch of the C++ (a static flag instead of the
    // viewport) is disabled with #if 1 and left out:
    //   draw_popup_building(8, 40, 0x80 + 4*popup->interface->player->player_num);

    for (const d of cycleDirectionsCw()) {
      const index = 5 - d;
      const lx = layout[2 * index];
      const ly = layout[2 * index + 1];
      if (flag.hasPath(d)) {
        let sprite = 0xdc; /* Minus box */
        if (flag.hasTransporter(d)) {
          sprite = 0x120; /* Check box */
        }
        this.drawPopupIcon(lx, ly, sprite);
      }
    }

    /* Road merge button: a road passes the flag around a corner and can be
       led through it (as in the original game). */
    if (
      !this.interface.getPlayer()!.isAi() &&
      this.interface.getGame()!.flagHasRoadCorner(flag.getPosition())
    ) {
      this.drawPopupIcon(7, 51, 0x135);
    }

    this.drawGreenString(0, 4, _('Transport Info:'));
    this.drawPopupIcon(2, 96, 0x1c); /* Geologist */
    this.drawPopupIcon(14, 128, 0x3c); /* Exit box */

    /* Draw list of resources */
    for (let i = 0; i < FLAG_MAX_RES_COUNT; i++) {
      if (flag.getResourceAtSlot(i) !== ResourceType.TypeNone) {
        this.drawPopupIcon(7 + 2 * (i & 3), 88 + 16 * (i >> 2), 0x22 + flag.getResourceAtSlot(i));
      }
    }

    this.drawGreenString(0, 128, _('Index:'));
    this.drawGreenNumber(7, 128, flag.getIndex() | 0);

    // PORT: flag_view is a local object of the C++, destroyed at the end of
    // the function.
    flagView.destroy();
  }

  protected drawCastleSerfBox(): void {
    const layout = [
      0x3d, 12, 128, /* flip */
      0x3c, 14, 128, /* exit */
      -1,
    ];

    const serfs: number[] = new Array<number>(27).fill(0);

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternPlaidAlongGreen);
    this.drawCustomIconBox(layout);

    if (this.interface.getPlayer()!.tempIndex === 0) {
      this.interface.closePopup();
      return;
    }

    const building = this.interface.getGame()!.getBuilding(this.interface.getPlayer()!.tempIndex)!;
    if (building.isBurning()) {
      this.interface.closePopup();
      return;
    }

    const type: BuildingType = building.getType();
    if (type !== BuildingType.TypeStock && type !== BuildingType.TypeCastle) {
      this.interface.closePopup();
      return;
    }

    const inventory = building.getInventory()!;
    for (const serf of this.interface.getGame()!.getSerfsInInventory(inventory)) {
      serfs[serf.getType()] += 1;
    }

    this.drawSerfsBox(serfs, -1);
  }

  protected drawResdirBox(): void {
    const layout = [
      0x128, 4, 16,
      0x129, 4, 80,
      0xdc, 9, 16,
      0xdc, 9, 32,
      0xdc, 9, 48,
      0xdc, 9, 80,
      0xdc, 9, 96,
      0xdc, 9, 112,
      0x3d, 12, 128,
      0x3c, 14, 128,
      -1,
    ];

    const knightsLayout = [
      0x21, 12, 16,
      0x20, 12, 36,
      0x1f, 12, 56,
      0x1e, 12, 76,
      0x1d, 12, 96,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternPlaidAlongGreen);
    this.drawCustomIconBox(layout);

    if (this.interface.getPlayer()!.tempIndex === 0) {
      this.interface.closePopup();
      return;
    }

    const building = this.interface.getGame()!.getBuilding(this.interface.getPlayer()!.tempIndex)!;
    if (building.isBurning()) {
      this.interface.closePopup();
      return;
    }

    const type: BuildingType = building.getType();
    if (type === BuildingType.TypeCastle) {
      const knights = [0, 0, 0, 0, 0];
      this.drawCustomIconBox(knightsLayout);

      /* Follow linked list of knights on duty */
      let serfIndex = building.getFirstKnight();
      while (serfIndex !== 0) {
        const serf = this.interface.getGame()!.getSerf(serfIndex)!;
        const serfType: SerfType = serf.getType();
        if (serfType < SerfType.TypeKnight0 || serfType > SerfType.TypeKnight4) {
          throw new ExceptionFreeserf('Not a knight among the castle defenders.');
        }
        knights[serfType - SerfType.TypeKnight0] += 1;
        serfIndex = serf.getNext();
      }

      this.drawGreenNumber(14, 20, knights[4]);
      this.drawGreenNumber(14, 40, knights[3]);
      this.drawGreenNumber(14, 60, knights[2]);
      this.drawGreenNumber(14, 80, knights[1]);
      this.drawGreenNumber(14, 100, knights[0]);
    } else if (type !== BuildingType.TypeStock) {
      this.interface.closePopup();
      return;
    }

    /* Draw resource mode checkbox */
    const inventory = building.getInventory()!;
    const resMode: InventoryMode = inventory.getResMode();
    if (resMode === InventoryMode.ModeIn) { /* in */
      this.drawPopupIcon(9, 16, 0x120);
    } else if (resMode === InventoryMode.ModeStop) { /* stop */
      this.drawPopupIcon(9, 32, 0x120);
    } else { /* out */
      this.drawPopupIcon(9, 48, 0x120);
    }

    /* Draw serf mode checkbox */
    const serfMode: InventoryMode = inventory.getSerfMode();
    if (serfMode === InventoryMode.ModeIn) { /* in */
      this.drawPopupIcon(9, 80, 0x120);
    } else if (serfMode === InventoryMode.ModeStop) { /* stop */
      this.drawPopupIcon(9, 96, 0x120);
    } else { /* out */
      this.drawPopupIcon(9, 112, 0x120);
    }
  }

  protected drawSett8Box(): void {
    const layout = [
      9, 2, 8,
      29, 12, 8,
      300, 2, 28,
      59, 7, 44,
      130, 8, 28,
      58, 9, 44,
      304, 3, 64,
      303, 11, 64,
      302, 2, 84,
      220, 6, 84,
      220, 6, 100,
      301, 10, 84,
      220, 3, 120,
      221, 9, 120,
      60, 14, 128,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternCheckerdDiagonalBrown);
    this.drawCustomIconBox(layout);

    const player = this.interface.getPlayer()!;

    this.drawSlideBar(4, 12, player.getSerfToKnightRate());
    this.drawGreenString(8, 63, '%');
    this.drawGreenNumber(6, 63, idiv(100 * player.getKnightMorale(), 0x1000));

    this.drawGreenLargeNumber(6, 73, player.getGoldDeposited());

    this.drawGreenNumber(6, 119, player.getCastleKnightsWanted());
    this.drawGreenNumber(6, 129, player.getCastleKnights());

    if (!player.sendStrongest()) {
      this.drawPopupIcon(6, 84, 288); /* checkbox */
    } else {
      this.drawPopupIcon(6, 100, 288); /* checkbox */
    }

    let convertibleToKnights = 0;
    for (const inv of this.interface.getGame()!.getPlayerInventories(player)) {
      const c = Math.min(
        inv.getCountOf(ResourceType.TypeSword),
        inv.getCountOf(ResourceType.TypeShield),
      );
      convertibleToKnights += Math.max(0, Math.min(c, inv.freeSerfCount()));
    }

    this.drawGreenNumber(12, 40, convertibleToKnights | 0);
  }

  protected drawSett6Box(): void {
    const layout = [
      237, 1, 120,
      238, 3, 120,
      239, 9, 120,
      240, 11, 120,

      295, 1, 4, /* default */
      60, 14, 128, /* exit */
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternCheckerdDiagonalBrown);
    this.drawCustomIconBox(layout);
    this.drawPopupResourceStairs(this.interface.getPlayer()!.getInventoryPrio());

    this.drawPopupIcon(6, 120, 33 + this.currentSett6Item);
  }

  protected drawBld1Box(): void {
    const layout = [
      0xc0, 0, 5, /* stock */
      0xab, 2, 77, /* hut */
      0x9e, 8, 7, /* tower */
      0x98, 6, 69, /* fortress */
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStaresGreen);

    this.drawPopupBuilding(4, 112, 0x80 + 4 * this.interface.getPlayer()!.getIndex());
    this.drawCustomBldBox(layout);

    this.drawPopupIcon(0, 128, 0x3d); /* flipbox */
    this.drawPopupIcon(14, 128, 0x3c); /* exit */
  }

  protected drawBld2Box(): void {
    const layout = [
      153, 0, 4,
      160, 8, 6,
      157, 0, 68,
      169, 8, 65,
      174, 12, 57,
      170, 4, 105,
      168, 8, 107,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStaresGreen);

    this.drawCustomBldBox(layout);

    this.drawPopupIcon(0, 128, 0x3d); /* flipbox */
    this.drawPopupIcon(14, 128, 0x3c); /* exit */
  }

  protected drawBld3Box(): void {
    const layout = [
      155, 0, 2,
      154, 8, 3,
      167, 0, 61,
      156, 8, 60,
      188, 4, 75,
      162, 8, 100,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStaresGreen);

    this.drawCustomBldBox(layout);

    this.drawPopupIcon(0, 128, 0x3d); /* flipbox */
    this.drawPopupIcon(14, 128, 0x3c); /* exit */
  }

  protected drawBld4Box(): void {
    const layout = [
      163, 0, 4,
      164, 4, 4,
      165, 8, 4,
      166, 12, 4,
      161, 2, 90,
      159, 8, 90,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStaresGreen);

    this.drawCustomBldBox(layout);

    this.drawPopupIcon(0, 128, 0x3d); /* flipbox */
    this.drawPopupIcon(14, 128, 0x3c); /* exit */
  }

  protected drawBuildingStockBox(): void {
    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternPlaidAlongGreen);

    if (this.interface.getPlayer()!.tempIndex === 0) {
      this.interface.closePopup();
      return;
    }

    const building = this.interface.getGame()!.getBuilding(this.interface.getPlayer()!.tempIndex)!;
    if (building.isBurning()) {
      this.interface.closePopup();
      return;
    }

    /* Draw list of resources */
    for (let j = 0; j < Building.kMaxStock; j++) {
      if (building.isStockActive(j)) {
        const stock = building.getResCountInStock(j);
        if (stock > 0) {
          const sprite = 34 + building.getResTypeInStock(j);
          for (let i = 0; i < stock; i++) {
            this.drawPopupIcon(8 - stock + 2 * i, 110 - j * 20, sprite);
          }
        } else {
          this.drawPopupIcon(7, 110 - j * 20, 0xdc); /* minus box */
        }
      }
    }

    const mapBuildingSerfSprite = [
      -1, 0x13, 0xd, 0x19,
      0xf, -1, -1, -1,
      -1, 0x10, -1, -1,
      0x16, 0x15, 0x14, 0x17,
      0x18, 0xe, 0x12, 0x1a,
      0x1b, -1, -1, 0x12,
      -1,
    ];

    /* Draw picture of serf present */
    let serfSprite = 0xdc; /* minus box */
    if (building.hasSerf()) {
      serfSprite = mapBuildingSerfSprite[building.getType()];
    }

    this.drawPopupIcon(1, 36, serfSprite);

    /* Draw building */
    const bldSprite = mapBuildingSprite[building.getType()];
    let lx = 6;
    if (bldSprite === 0xc0 /*stock*/ || bldSprite < 0x9e /*tower*/) lx = 4;
    this.drawPopupBuilding(lx, 30, bldSprite);

    this.drawGreenLines(1, 4, _('Stock of\nthis building:'));

    this.drawPopupIcon(14, 128, 0x3c); /* exit box */
  }

  protected drawPlayerFacesBox(): void {
    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStripedGreen);

    this.drawPlayerFace(2, 4, 0);
    this.drawPlayerFace(10, 4, 1);
    this.drawPlayerFace(2, 76, 2);
    this.drawPlayerFace(10, 76, 3);
  }

  /* Picture of the current game end stage, or -1: first the result (the
     human player won, player 2 won a two player game, lost), then after a
     won mission the mission's picture from the table @0x1d943, by the
     mission number (Amiga @0x1d6e8). */
  protected getGameEndPicture(): number {
    const game = this.interface.getGame()!;
    const winner = Math.max(0, game.getWinningPlayer());
    if (this.gameEndStage === 0) {
      if (winner === 0) return 0;
      if (game.getGameType() === GameGameType.GameTypeTwoPlayers && winner === 1) {
        return 1;
      }
      return 2;
    } else if (this.gameEndStage === 2) {
      const missionPicture = [
        -1, 3, -1, -1, 4, -1, -1, 5, -1, -1, 6, -1, -1, 7, -1, -1,
        8, -1, -1, 9, -1, -1, 10, -1, -1, 11, -1, -1, 12, -1, 13,
      ];
      const mission = game.getMissionLevel() + 1;
      if (
        game.getGameType() !== GameGameType.GameTypeMission ||
        winner !== 0 ||
        mission < 1 ||
        mission > 30
      ) {
        return -1;
      }
      return missionPicture[mission];
    }
    return -1;
  }

  /* End of the game: the result picture, then the winner and the result
     with the texts of the original, then the mission's picture (Amiga popup
     box 54 @0x1d6e8). */
  protected drawGameEndBox(): void {
    if (this.gameEndStage !== 1) {
      const picture = this.getGameEndPicture();
      if (picture >= 0) {
        this.frame!.drawSprite(8, 9, Data.Resource.AssetArtBox, picture);
      }
      return;
    }

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStripedGreen);

    const game = this.interface.getGame()!;
    const winner = Math.max(0, game.getWinningPlayer());
    this.drawPlayerFace(6, 60, winner);

    switch (game.getGameType()) {
      case GameGameType.GameTypeMission:
        if (winner === 0) {
          this.drawGreenCentered(4, _('CONGRATULATIONS.'));
          this.drawGreenCentered(
            16,
            _('YOUR ENEMIES\nRESIGN. YOU\nHAVE WON THIS\n' + 'MISSION.'),
          );

          /* The password is the name of the next mission. */
          const next = GameInfo.getMission(game.getMissionLevel() + 1);
          if (next) {
            this.drawGreenCentered(126, _('NEW PASSWORD:'));
            this.drawGreenString(4, 135, next.getName());
          }
        } else {
          this.drawGreenCentered(
            6,
            _(
              'SORRY, ONLY ONE\nOF YOUR ENEMIES\n' +
                'HAS GAINED THE\nSUPERIORITY IN\n' +
                'THIS MISSION',
            ),
          );
        }
        break;
      case GameGameType.GameTypeTutorial:
        this.drawGreenCentered(4, _('WELL DONE.'));
        this.drawGreenCentered(16, _('YOU COMPLETED\nTHIS TUTORIAL\nGAME.'));
        break;
      default: {
        /* The whole sentence for each color, for the grammar of the
           translations. */
        const won = [
          N_('THE BLUE\nSETTLERS HAVE\nGAINED THE\nSUPERIORITY'),
          N_('THE RED\nSETTLERS HAVE\nGAINED THE\nSUPERIORITY'),
          N_('THE VIOLET\nSETTLERS HAVE\nGAINED THE\nSUPERIORITY'),
          N_('THE YELLOW\nSETTLERS HAVE\nGAINED THE\nSUPERIORITY'),
        ];
        this.drawGreenCentered(6, _(won[winner & 3]));
        break;
      }
    }
  }

  /* The task of the tutorial, shown when it starts. The original only
     gives it in the manual; these are the goals the game checks. */
  protected drawTutorialOrdersBox(): void {
    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternStripedGreen);

    const orders = [
      N_('Build a guard hut and a guard tower and a fortress.'),
      N_('Produce five planks and five stones.'),
      N_('Produce five fish and five meat and five bread.'),
      N_('Smelt five steel bars and five gold bars.'),
      N_('Make ten weapons and ten tools.'),
      N_('Conquer all the land of the enemy.'),
    ];

    const game = this.interface.getGame()!;
    const level = game.getTutorialLevel();
    if (level < 1 || level > 6) {
      return;
    }

    /* TRANSLATORS: %d is the number of the tutorial. */
    let title = _('TUTORIAL %d');
    const number = title.indexOf('%d');
    if (number !== -1) {
      title = title.substring(0, number) + String(level) + title.substring(number + 2);
    }
    this.drawGreenCentered(6, title);
    this.drawGreenCentered(26, _('ORDERS:'));

    /* Word wrap to the width of the box. */
    const words = _(orders[level - 1]).split(/\s+/).filter((w) => w.length > 0);
    let line = '';
    let y = 46;
    for (const word of words) {
      const longer = line + (line.length === 0 ? '' : ' ') + word;
      if (line.length !== 0 && this.frame!.getStringWidth(longer) > 128) {
        this.drawGreenString(0, y, line);
        y += 10;
        line = word;
      } else {
        line = longer;
      }
    }
    if (line.length !== 0) {
      this.drawGreenString(0, y, line);
    }
  }

  protected drawDemolishBox(): void {
    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternSquaresGreen);

    this.drawPopupIcon(14, 128, 60); /* Exit */
    this.drawPopupIcon(7, 45, 288); /* Checkbox */

    this.drawGreenCentered(10, _('Demolish:'));
    this.drawGreenCentered(30, _('Click here'));
    this.drawGreenCentered(68, _('if you are\nsure'), 18);
  }

  protected drawSaveBox(): void {
    const layout = [
      224, 0, 128,
      -1,
    ];

    this.drawBoxBackground(PopupBoxBackgroundPattern.PatternDiagonalGreen);
    this.drawCustomIconBox(layout);

    this.drawGreenCentered(2, _('Save Game'));

    this.drawPopupIcon(14, 128, 60); /* Exit */
  }

  protected override internalDraw(): void {
    this.drawPopupBoxFrame();
    this.textShadow = false;

    /* Dispatch to one of the popup box functions above. */
    switch (this.box) {
      case PopupBoxType.TypeMap:
        this.drawMapBox();
        break;
      case PopupBoxType.TypeMineBuilding:
        this.drawMineBuildingBox();
        break;
      case PopupBoxType.TypeBasicBld:
        this.drawBasicBuildingBox(0);
        break;
      case PopupBoxType.TypeBasicBldFlip:
        this.drawBasicBuildingBox(1);
        break;
      case PopupBoxType.TypeAdv1Bld:
        this.drawAdv1BuildingBox();
        break;
      case PopupBoxType.TypeAdv2Bld:
        this.drawAdv2BuildingBox();
        break;
      case PopupBoxType.TypeStatSelect:
        this.drawStatSelectBox();
        break;
      case PopupBoxType.TypeStat4:
        this.drawStat4Box();
        break;
      case PopupBoxType.TypeStatBld1:
        this.drawStatBld1Box();
        break;
      case PopupBoxType.TypeStatBld2:
        this.drawStatBld2Box();
        break;
      case PopupBoxType.TypeStatBld3:
        this.drawStatBld3Box();
        break;
      case PopupBoxType.TypeStatBld4:
        this.drawStatBld4Box();
        break;
      case PopupBoxType.TypeStat8:
        this.drawStat8Box();
        break;
      case PopupBoxType.TypeStat7:
        this.drawStat7Box();
        break;
      case PopupBoxType.TypeStat1:
        this.drawStat1Box();
        break;
      case PopupBoxType.TypeStat2:
        this.drawStat2Box();
        break;
      case PopupBoxType.TypeStat6:
        this.drawStat6Box();
        break;
      case PopupBoxType.TypeStat3:
        this.drawStat3Box();
        break;
      case PopupBoxType.TypeStartAttack:
        this.drawStartAttackBox();
        break;
      case PopupBoxType.TypeStartAttackRedraw:
        this.drawStartAttackRedrawBox();
        break;
      case PopupBoxType.TypeGroundAnalysis:
        this.drawGroundAnalysisBox();
        break;
      /* TODO */
      case PopupBoxType.TypeSettSelect:
        this.drawSettSelectBox();
        break;
      case PopupBoxType.TypeSett1:
        this.drawSett1Box();
        break;
      case PopupBoxType.TypeSett2:
        this.drawSett2Box();
        break;
      case PopupBoxType.TypeSett3:
        this.drawSett3Box();
        break;
      case PopupBoxType.TypeKnightLevel:
        this.drawKnightLevelBox();
        break;
      case PopupBoxType.TypeSett4:
        this.drawSett4Box();
        break;
      case PopupBoxType.TypeSett5:
        this.drawSett5Box();
        break;
      case PopupBoxType.TypeQuitConfirm:
        this.drawQuitConfirmBox();
        break;
      case PopupBoxType.TypeNoSaveQuitConfirm:
        this.drawNoSaveQuitConfirmBox();
        break;
      case PopupBoxType.TypeOptions:
        this.drawOptionsBox();
        break;
      case PopupBoxType.TypeCastleRes:
        this.drawCastleResBox();
        break;
      case PopupBoxType.TypeMineOutput:
        this.drawMineOutputBox();
        break;
      case PopupBoxType.TypeOrderedBld:
        this.drawOrderedBuildingBox();
        break;
      case PopupBoxType.TypeDefenders:
        this.drawDefendersBox();
        break;
      case PopupBoxType.TypeTransportInfo:
        this.drawTransportInfoBox();
        break;
      case PopupBoxType.TypeCastleSerf:
        this.drawCastleSerfBox();
        break;
      case PopupBoxType.TypeResDir:
        this.drawResdirBox();
        break;
      case PopupBoxType.TypeSett8:
        this.drawSett8Box();
        break;
      case PopupBoxType.TypeSett6:
        this.drawSett6Box();
        break;
      case PopupBoxType.TypeBld1:
        this.drawBld1Box();
        break;
      case PopupBoxType.TypeBld2:
        this.drawBld2Box();
        break;
      case PopupBoxType.TypeBld3:
        this.drawBld3Box();
        break;
      case PopupBoxType.TypeBld4:
        this.drawBld4Box();
        break;
      case PopupBoxType.TypeBldStock:
        this.drawBuildingStockBox();
        break;
      case PopupBoxType.TypePlayerFaces:
        this.drawPlayerFacesBox();
        break;
      case PopupBoxType.TypeDemolish:
        this.drawDemolishBox();
        break;
      case PopupBoxType.TypeGameEnd:
        this.drawGameEndBox();
        break;
      case PopupBoxType.TypeTutorialOrders:
        this.drawTutorialOrdersBox();
        break;
      case PopupBoxType.TypeLoadSave:
        this.drawSaveBox();
        break;
      default:
        break;
    }
  }

  protected activateSett56Item(index: number): void {
    if (this.box === PopupBoxType.TypeSett5) {
      let i: number;
      for (i = 0; i < 26; i++) {
        if (this.interface.getPlayer()!.getFlagPrio(i) === index) break;
      }
      this.currentSett5Item = i + 1;
    } else {
      let i: number;
      for (i = 0; i < 26; i++) {
        if (this.interface.getPlayer()!.getInventoryPrio(i) === index) break;
      }
      this.currentSett6Item = i + 1;
    }
  }

  // PORT: the C++ changes the priorities of the player here; that is the
  // movePriority command now (its handler in net/commands.ts has the code).
  protected moveSett56Item(up: number, toEnd: number): void {
    let inventory: boolean;
    let cur = -1;

    if (this.interface.getPopupBox()!.getBox() === PopupBoxType.TypeSett5) {
      inventory = false;
      cur = this.currentSett5Item - 1;
    } else {
      inventory = true;
      cur = this.currentSett6Item - 1;
    }

    cmdMovePriority(this.interface.getGame()!, inventory, cur, up !== 0, toEnd !== 0);
  }

  protected handleSendGeologist(): void {
    const pos: MapPos = this.interface.getMapCursorPos();
    const game = this.interface.getGame()!;

    // PORT: the C++ plays the sound by the result of game->send_geologist().
    // The command runs later, so the sound goes by a check before:
    // canSendGeologist() does not look for the road from the inventory to
    // the flag (see there), so without one the accepted sound is played and
    // no geologist comes.
    if (!canSendGeologist(game, pos, this.interface.getPlayer()!)) {
      this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
    } else {
      cmdSendGeologist(game, pos);
      this.playSound(AudioTypeSfx.TypeSfxAccepted);
      this.interface.closePopup();
    }
  }

  protected sett8Train(number: number): void {
    // PORT: the C++ plays the sound by the number of promoted serfs; the
    // command runs later, so by a check before.
    const game = this.interface.getGame()!;
    const r = canPromoteSerfsToKnights(game, this.interface.getPlayer()!) ? 1 : 0;
    cmdPromoteSerfsToKnights(game, number);

    if (r === 0) {
      this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
    } else {
      this.playSound(AudioTypeSfx.TypeSfxAccepted);
    }
  }

  protected setInventoryResourceMode(mode: number): void {
    const building = this.interface.getGame()!.getBuilding(this.interface.getPlayer()!.tempIndex)!;
    cmdSetInventoryResourceMode(this.interface.getGame()!, building.getPosition(), mode);
  }

  protected setInventorySerfMode(mode: number): void {
    const building = this.interface.getGame()!.getBuilding(this.interface.getPlayer()!.tempIndex)!;
    cmdSetInventorySerfMode(this.interface.getGame()!, building.getPosition(), mode);
  }

  protected handleAction(action: number, x_: number, _y: number): void {
    this.setRedraw();

    // PORT: `player` in the C++; every change of the player is a command.
    const game = this.interface.getGame()!;
    const attack = this.interface.attack;

    switch (action) {
      case Action.ACTION_MINIMAP_CLICK:
        /* Not handled here, event is passed to minimap. */
        break;
      case Action.ACTION_MINIMAP_MODE: {
        let mode = this.minimap.getOwnershipMode() + 1;
        if (mode > MinimapGameOwnershipMode.OwnershipModeLast) {
          mode = MinimapGameOwnershipMode.OwnershipModeNone;
        }
        this.minimap.setOwnershipMode(mode as MinimapGameOwnershipMode);
        this.setBox(PopupBoxType.TypeMap);
        break;
      }
      case Action.ACTION_MINIMAP_ROADS:
        this.minimap.setDrawRoads(!this.minimap.getDrawRoads());
        this.setBox(PopupBoxType.TypeMap);
        break;
      case Action.ACTION_MINIMAP_BUILDINGS:
        /* A special click opens the building filter (as the original). */
        if (this.specialClick) {
          this.setBox(PopupBoxType.TypeBld1);
          break;
        }
        if (this.minimap.getAdvanced() >= 0) {
          this.minimap.setAdvanced(-1);
          this.minimap.setDrawBuildings(true);
        } else {
          this.minimap.setDrawBuildings(!this.minimap.getDrawBuildings());
        }
        this.setBox(PopupBoxType.TypeMap);
        break;
      case Action.ACTION_MINIMAP_GRID:
        this.minimap.setDrawGrid(!this.minimap.getDrawGrid());
        this.setBox(PopupBoxType.TypeMap);
        break;
      case Action.ACTION_BUILD_STONEMINE:
        this.interface.buildBuilding(BuildingType.TypeStoneMine, this.specialClick);
        break;
      case Action.ACTION_BUILD_COALMINE:
        this.interface.buildBuilding(BuildingType.TypeCoalMine, this.specialClick);
        break;
      case Action.ACTION_BUILD_IRONMINE:
        this.interface.buildBuilding(BuildingType.TypeIronMine, this.specialClick);
        break;
      case Action.ACTION_BUILD_GOLDMINE:
        this.interface.buildBuilding(BuildingType.TypeGoldMine, this.specialClick);
        break;
      case Action.ACTION_BUILD_FLAG:
        this.interface.buildFlag();
        this.interface.closePopup();
        break;
      case Action.ACTION_BUILD_STONECUTTER:
        this.interface.buildBuilding(BuildingType.TypeStonecutter, this.specialClick);
        break;
      case Action.ACTION_BUILD_HUT:
        this.interface.buildBuilding(BuildingType.TypeHut, this.specialClick);
        break;
      case Action.ACTION_BUILD_LUMBERJACK:
        this.interface.buildBuilding(BuildingType.TypeLumberjack, this.specialClick);
        break;
      case Action.ACTION_BUILD_FORESTER:
        this.interface.buildBuilding(BuildingType.TypeForester, this.specialClick);
        break;
      case Action.ACTION_BUILD_FISHER:
        this.interface.buildBuilding(BuildingType.TypeFisher, this.specialClick);
        break;
      case Action.ACTION_BUILD_MILL:
        this.interface.buildBuilding(BuildingType.TypeMill, this.specialClick);
        break;
      case Action.ACTION_BUILD_BOATBUILDER:
        this.interface.buildBuilding(BuildingType.TypeBoatbuilder, this.specialClick);
        break;
      case Action.ACTION_BUILD_BUTCHER:
        this.interface.buildBuilding(BuildingType.TypeButcher, this.specialClick);
        break;
      case Action.ACTION_BUILD_WEAPONSMITH:
        this.interface.buildBuilding(BuildingType.TypeWeaponSmith, this.specialClick);
        break;
      case Action.ACTION_BUILD_STEELSMELTER:
        this.interface.buildBuilding(BuildingType.TypeSteelSmelter, this.specialClick);
        break;
      case Action.ACTION_BUILD_SAWMILL:
        this.interface.buildBuilding(BuildingType.TypeSawmill, this.specialClick);
        break;
      case Action.ACTION_BUILD_BAKER:
        this.interface.buildBuilding(BuildingType.TypeBaker, this.specialClick);
        break;
      case Action.ACTION_BUILD_GOLDSMELTER:
        this.interface.buildBuilding(BuildingType.TypeGoldSmelter, this.specialClick);
        break;
      case Action.ACTION_BUILD_FORTRESS:
        this.interface.buildBuilding(BuildingType.TypeFortress, this.specialClick);
        break;
      case Action.ACTION_BUILD_TOWER:
        this.interface.buildBuilding(BuildingType.TypeTower, this.specialClick);
        break;
      case Action.ACTION_BUILD_TOOLMAKER:
        this.interface.buildBuilding(BuildingType.TypeToolMaker, this.specialClick);
        break;
      case Action.ACTION_BUILD_FARM:
        this.interface.buildBuilding(BuildingType.TypeFarm, this.specialClick);
        break;
      case Action.ACTION_BUILD_PIGFARM:
        this.interface.buildBuilding(BuildingType.TypePigFarm, this.specialClick);
        break;
      case Action.ACTION_BLD_FLIP_PAGE:
        this.setBox(
          this.box + 1 <= PopupBoxType.TypeAdv2Bld
            ? ((this.box + 1) as PopupBoxType)
            : PopupBoxType.TypeBasicBldFlip,
        );
        break;
      case Action.ACTION_SHOW_STAT_1:
        this.setBox(PopupBoxType.TypeStat1);
        break;
      case Action.ACTION_SHOW_STAT_2:
        this.setBox(PopupBoxType.TypeStat2);
        break;
      case Action.ACTION_SHOW_STAT_8:
        this.setBox(PopupBoxType.TypeStat8);
        break;
      case Action.ACTION_SHOW_STAT_BLD:
        this.setBox(PopupBoxType.TypeStatBld1);
        break;
      case Action.ACTION_SHOW_STAT_6:
        this.setBox(PopupBoxType.TypeStat6);
        break;
      case Action.ACTION_SHOW_STAT_7:
        this.setBox(PopupBoxType.TypeStat7);
        break;
      case Action.ACTION_SHOW_STAT_4:
        this.setBox(PopupBoxType.TypeStat4);
        break;
      case Action.ACTION_SHOW_STAT_3:
        this.setBox(PopupBoxType.TypeStat3);
        break;
      case Action.ACTION_SHOW_STAT_SELECT:
        this.setBox(PopupBoxType.TypeStatSelect);
        break;
      case Action.ACTION_STAT_BLD_FLIP:
        this.setBox(
          this.box + 1 <= PopupBoxType.TypeStatBld4
            ? ((this.box + 1) as PopupBoxType)
            : PopupBoxType.TypeStatBld1,
        );
        break;
      case Action.ACTION_CLOSE_BOX:
      case Action.ACTION_CLOSE_SETT_BOX:
      case Action.ACTION_CLOSE_GROUND_ANALYSIS:
        this.interface.closePopup();
        break;
      case Action.ACTION_SETT_8_SET_ASPECT_ALL:
        this.interface.setSelectedStatAspect(InterfaceStatAspect.StatAspectAll);
        break;
      case Action.ACTION_SETT_8_SET_ASPECT_LAND:
        this.interface.setSelectedStatAspect(InterfaceStatAspect.StatAspectLand);
        break;
      case Action.ACTION_SETT_8_SET_ASPECT_BUILDINGS:
        this.interface.setSelectedStatAspect(InterfaceStatAspect.StatAspectBuildings);
        break;
      case Action.ACTION_SETT_8_SET_ASPECT_MILITARY:
        this.interface.setSelectedStatAspect(InterfaceStatAspect.StatAspectMilitary);
        break;
      case Action.ACTION_SETT_8_SET_SCALE_30_MIN:
        this.interface.setSelectedStatScale(InterfaceStatScale.StatScale30Min);
        break;
      case Action.ACTION_SETT_8_SET_SCALE_60_MIN:
        this.interface.setSelectedStatScale(InterfaceStatScale.StatScale60Min);
        break;
      case Action.ACTION_SETT_8_SET_SCALE_600_MIN:
        this.interface.setSelectedStatScale(InterfaceStatScale.StatScale600Min);
        break;
      case Action.ACTION_SETT_8_SET_SCALE_3000_MIN:
        this.interface.setSelectedStatScale(InterfaceStatScale.StatScale3000Min);
        break;
      case Action.ACTION_STAT_7_SELECT_FISH:
      case Action.ACTION_STAT_7_SELECT_PIG:
      case Action.ACTION_STAT_7_SELECT_MEAT:
      case Action.ACTION_STAT_7_SELECT_WHEAT:
      case Action.ACTION_STAT_7_SELECT_FLOUR:
      case Action.ACTION_STAT_7_SELECT_BREAD:
      case Action.ACTION_STAT_7_SELECT_LUMBER:
      case Action.ACTION_STAT_7_SELECT_PLANK:
      case Action.ACTION_STAT_7_SELECT_BOAT:
      case Action.ACTION_STAT_7_SELECT_STONE:
      case Action.ACTION_STAT_7_SELECT_IRONORE:
      case Action.ACTION_STAT_7_SELECT_STEEL:
      case Action.ACTION_STAT_7_SELECT_COAL:
      case Action.ACTION_STAT_7_SELECT_GOLDORE:
      case Action.ACTION_STAT_7_SELECT_GOLDBAR:
      case Action.ACTION_STAT_7_SELECT_SHOVEL:
      case Action.ACTION_STAT_7_SELECT_HAMMER:
      case Action.ACTION_STAT_7_SELECT_ROD:
      case Action.ACTION_STAT_7_SELECT_CLEAVER:
      case Action.ACTION_STAT_7_SELECT_SCYTHE:
      case Action.ACTION_STAT_7_SELECT_AXE:
      case Action.ACTION_STAT_7_SELECT_SAW:
      case Action.ACTION_STAT_7_SELECT_PICK:
      case Action.ACTION_STAT_7_SELECT_PINCER:
      case Action.ACTION_STAT_7_SELECT_SWORD:
      case Action.ACTION_STAT_7_SELECT_SHIELD: {
        const resource = (action - Action.ACTION_STAT_7_SELECT_FISH) as ResourceType;
        this.interface.setSelectedStatResource(resource);
        this.setRedraw();
        break;
      }
      case Action.ACTION_ATTACKING_KNIGHTS_DEC:
        attack.knightsAttacking = Math.max(attack.knightsAttacking - 1, 0);
        break;
      case Action.ACTION_ATTACKING_KNIGHTS_INC:
        attack.knightsAttacking = Math.min(
          attack.knightsAttacking + 1,
          Math.min(attack.totalAttackingKnights, 100),
        );
        break;
      case Action.ACTION_START_ATTACK:
        if (attack.knightsAttacking > 0) {
          if (attack.attackingBuildingCount > 0) {
            this.playSound(AudioTypeSfx.TypeSfxAccepted);
            cmdStartAttack(game, attack.pos, attack.knightsAttacking);
          }
          this.interface.closePopup();
        } else {
          this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
        }
        break;
      case Action.ACTION_CLOSE_ATTACK_BOX:
        this.interface.closePopup();
        break;
      /* TODO */
      case Action.ACTION_SHOW_SETT_1:
        this.setBox(PopupBoxType.TypeSett1);
        break;
      case Action.ACTION_SHOW_SETT_2:
        this.setBox(PopupBoxType.TypeSett2);
        break;
      case Action.ACTION_SHOW_SETT_3:
        this.setBox(PopupBoxType.TypeSett3);
        break;
      case Action.ACTION_SHOW_SETT_7:
        this.setBox(PopupBoxType.TypeKnightLevel);
        break;
      case Action.ACTION_SHOW_SETT_4:
        this.setBox(PopupBoxType.TypeSett4);
        break;
      case Action.ACTION_SHOW_SETT_5:
        this.setBox(PopupBoxType.TypeSett5);
        break;
      case Action.ACTION_SHOW_SETT_SELECT:
        this.setBox(PopupBoxType.TypeSettSelect);
        break;
      case Action.ACTION_SETT_1_ADJUST_STONEMINE:
        this.interface.openPopup(PopupBoxType.TypeSett1);
        cmdSetDistribution(game, 'setFoodStonemine', guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_1_ADJUST_COALMINE:
        this.interface.openPopup(PopupBoxType.TypeSett1);
        cmdSetDistribution(game, 'setFoodCoalmine', guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_1_ADJUST_IRONMINE:
        this.interface.openPopup(PopupBoxType.TypeSett1);
        cmdSetDistribution(game, 'setFoodIronmine', guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_1_ADJUST_GOLDMINE:
        this.interface.openPopup(PopupBoxType.TypeSett1);
        cmdSetDistribution(game, 'setFoodGoldmine', guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_2_ADJUST_CONSTRUCTION:
        this.interface.openPopup(PopupBoxType.TypeSett2);
        cmdSetDistribution(game, 'setPlanksConstruction', guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_2_ADJUST_BOATBUILDER:
        this.interface.openPopup(PopupBoxType.TypeSett2);
        cmdSetDistribution(game, 'setPlanksBoatbuilder', guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_2_ADJUST_TOOLMAKER_PLANKS:
        this.interface.openPopup(PopupBoxType.TypeSett2);
        cmdSetDistribution(game, 'setPlanksToolmaker', guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_2_ADJUST_TOOLMAKER_STEEL:
        this.interface.openPopup(PopupBoxType.TypeSett2);
        cmdSetDistribution(game, 'setSteelToolmaker', guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_2_ADJUST_WEAPONSMITH:
        this.interface.openPopup(PopupBoxType.TypeSett2);
        cmdSetDistribution(game, 'setSteelWeaponsmith', guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_3_ADJUST_STEELSMELTER:
        this.interface.openPopup(PopupBoxType.TypeSett3);
        cmdSetDistribution(game, 'setCoalSteelsmelter', guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_3_ADJUST_GOLDSMELTER:
        this.interface.openPopup(PopupBoxType.TypeSett3);
        cmdSetDistribution(game, 'setCoalGoldsmelter', guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_3_ADJUST_WEAPONSMITH:
        this.interface.openPopup(PopupBoxType.TypeSett3);
        cmdSetDistribution(game, 'setCoalWeaponsmith', guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_3_ADJUST_PIGFARM:
        this.interface.openPopup(PopupBoxType.TypeSett3);
        cmdSetDistribution(game, 'setWheatPigfarm', guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_3_ADJUST_MILL:
        this.interface.openPopup(PopupBoxType.TypeSett3);
        cmdSetDistribution(game, 'setWheatMill', guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_KNIGHT_LEVEL_CLOSEST_MIN_DEC:
        cmdChangeKnightOccupation(game, 3, false, -1);
        this.interface.openPopup(PopupBoxType.TypeKnightLevel);
        break;
      case Action.ACTION_KNIGHT_LEVEL_CLOSEST_MIN_INC:
        cmdChangeKnightOccupation(game, 3, false, 1);
        this.interface.openPopup(PopupBoxType.TypeKnightLevel);
        break;
      case Action.ACTION_KNIGHT_LEVEL_CLOSEST_MAX_DEC:
        cmdChangeKnightOccupation(game, 3, true, -1);
        this.interface.openPopup(PopupBoxType.TypeKnightLevel);
        break;
      case Action.ACTION_KNIGHT_LEVEL_CLOSEST_MAX_INC:
        cmdChangeKnightOccupation(game, 3, true, 1);
        this.interface.openPopup(PopupBoxType.TypeKnightLevel);
        break;
      case Action.ACTION_KNIGHT_LEVEL_CLOSE_MIN_DEC:
        cmdChangeKnightOccupation(game, 2, false, -1);
        this.interface.openPopup(PopupBoxType.TypeKnightLevel);
        break;
      case Action.ACTION_KNIGHT_LEVEL_CLOSE_MIN_INC:
        cmdChangeKnightOccupation(game, 2, false, 1);
        this.interface.openPopup(PopupBoxType.TypeKnightLevel);
        break;
      case Action.ACTION_KNIGHT_LEVEL_CLOSE_MAX_DEC:
        cmdChangeKnightOccupation(game, 2, true, -1);
        this.interface.openPopup(PopupBoxType.TypeKnightLevel);
        break;
      case Action.ACTION_KNIGHT_LEVEL_CLOSE_MAX_INC:
        cmdChangeKnightOccupation(game, 2, true, 1);
        this.interface.openPopup(PopupBoxType.TypeKnightLevel);
        break;
      case Action.ACTION_KNIGHT_LEVEL_FAR_MIN_DEC:
        cmdChangeKnightOccupation(game, 1, false, -1);
        this.interface.openPopup(PopupBoxType.TypeKnightLevel);
        break;
      case Action.ACTION_KNIGHT_LEVEL_FAR_MIN_INC:
        cmdChangeKnightOccupation(game, 1, false, 1);
        this.interface.openPopup(PopupBoxType.TypeKnightLevel);
        break;
      case Action.ACTION_KNIGHT_LEVEL_FAR_MAX_DEC:
        cmdChangeKnightOccupation(game, 1, true, -1);
        this.interface.openPopup(PopupBoxType.TypeKnightLevel);
        break;
      case Action.ACTION_KNIGHT_LEVEL_FAR_MAX_INC:
        cmdChangeKnightOccupation(game, 1, true, 1);
        this.interface.openPopup(PopupBoxType.TypeKnightLevel);
        break;
      case Action.ACTION_KNIGHT_LEVEL_FARTHEST_MIN_DEC:
        cmdChangeKnightOccupation(game, 0, false, -1);
        this.interface.openPopup(PopupBoxType.TypeKnightLevel);
        break;
      case Action.ACTION_KNIGHT_LEVEL_FARTHEST_MIN_INC:
        cmdChangeKnightOccupation(game, 0, false, 1);
        this.interface.openPopup(PopupBoxType.TypeKnightLevel);
        break;
      case Action.ACTION_KNIGHT_LEVEL_FARTHEST_MAX_DEC:
        cmdChangeKnightOccupation(game, 0, true, -1);
        this.interface.openPopup(PopupBoxType.TypeKnightLevel);
        break;
      case Action.ACTION_KNIGHT_LEVEL_FARTHEST_MAX_INC:
        cmdChangeKnightOccupation(game, 0, true, 1);
        this.interface.openPopup(PopupBoxType.TypeKnightLevel);
        break;
      case Action.ACTION_SETT_4_ADJUST_SHOVEL:
        this.interface.openPopup(PopupBoxType.TypeSett4);
        cmdSetToolPrio(game, 0, guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_4_ADJUST_HAMMER:
        this.interface.openPopup(PopupBoxType.TypeSett4);
        cmdSetToolPrio(game, 1, guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_4_ADJUST_AXE:
        this.interface.openPopup(PopupBoxType.TypeSett4);
        cmdSetToolPrio(game, 5, guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_4_ADJUST_SAW:
        this.interface.openPopup(PopupBoxType.TypeSett4);
        cmdSetToolPrio(game, 6, guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_4_ADJUST_SCYTHE:
        this.interface.openPopup(PopupBoxType.TypeSett4);
        cmdSetToolPrio(game, 4, guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_4_ADJUST_PICK:
        this.interface.openPopup(PopupBoxType.TypeSett4);
        cmdSetToolPrio(game, 7, guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_4_ADJUST_PINCER:
        this.interface.openPopup(PopupBoxType.TypeSett4);
        cmdSetToolPrio(game, 8, guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_4_ADJUST_CLEAVER:
        this.interface.openPopup(PopupBoxType.TypeSett4);
        cmdSetToolPrio(game, 3, guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_4_ADJUST_ROD:
        this.interface.openPopup(PopupBoxType.TypeSett4);
        cmdSetToolPrio(game, 2, guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_5_6_ITEM_1:
      case Action.ACTION_SETT_5_6_ITEM_2:
      case Action.ACTION_SETT_5_6_ITEM_3:
      case Action.ACTION_SETT_5_6_ITEM_4:
      case Action.ACTION_SETT_5_6_ITEM_5:
      case Action.ACTION_SETT_5_6_ITEM_6:
      case Action.ACTION_SETT_5_6_ITEM_7:
      case Action.ACTION_SETT_5_6_ITEM_8:
      case Action.ACTION_SETT_5_6_ITEM_9:
      case Action.ACTION_SETT_5_6_ITEM_10:
      case Action.ACTION_SETT_5_6_ITEM_11:
      case Action.ACTION_SETT_5_6_ITEM_12:
      case Action.ACTION_SETT_5_6_ITEM_13:
      case Action.ACTION_SETT_5_6_ITEM_14:
      case Action.ACTION_SETT_5_6_ITEM_15:
      case Action.ACTION_SETT_5_6_ITEM_16:
      case Action.ACTION_SETT_5_6_ITEM_17:
      case Action.ACTION_SETT_5_6_ITEM_18:
      case Action.ACTION_SETT_5_6_ITEM_19:
      case Action.ACTION_SETT_5_6_ITEM_20:
      case Action.ACTION_SETT_5_6_ITEM_21:
      case Action.ACTION_SETT_5_6_ITEM_22:
      case Action.ACTION_SETT_5_6_ITEM_23:
      case Action.ACTION_SETT_5_6_ITEM_24:
      case Action.ACTION_SETT_5_6_ITEM_25:
      case Action.ACTION_SETT_5_6_ITEM_26:
        this.activateSett56Item(26 - (action - Action.ACTION_SETT_5_6_ITEM_1));
        break;
      case Action.ACTION_SETT_5_6_TOP:
        this.moveSett56Item(1, 1);
        break;
      case Action.ACTION_SETT_5_6_UP:
        this.moveSett56Item(1, 0);
        break;
      case Action.ACTION_SETT_5_6_DOWN:
        this.moveSett56Item(0, 0);
        break;
      case Action.ACTION_SETT_5_6_BOTTOM:
        this.moveSett56Item(0, 1);
        break;
      case Action.ACTION_QUIT_CONFIRM:
        //    if (0/* TODO suggest save game*/) {
        //      set_box(TypeNoSaveQuitConfirm);
        //    } else {
        this.playSound(AudioTypeSfx.TypeSfxAhhh);
        EventLoop.getInstance().quit();
        //    }
        break;
      case Action.ACTION_QUIT_CANCEL:
        this.interface.closePopup();
        break;
      case Action.ACTION_NO_SAVE_QUIT_CONFIRM:
        this.playSound(AudioTypeSfx.TypeSfxAhhh);
        EventLoop.getInstance().quit();
        break;
      case Action.ACTION_SHOW_QUIT:
        this.interface.openPopup(PopupBoxType.TypeQuitConfirm);
        break;
      case Action.ActionShowOptions:
        this.interface.openPopup(PopupBoxType.TypeOptions);
        break;
      /* TODO */
      case Action.ACTION_SETT_8_CYCLE:
        cmdCycleKnights(game);
        this.playSound(AudioTypeSfx.TypeSfxAccepted);
        break;
      case Action.ACTION_CLOSE_OPTIONS:
        /* Closing the box deletes it: no members after it. */
        this.interface.storeSettings();
        this.interface.closePopup();
        break;
      case Action.ACTION_OPTIONS_ADVANCED:
        this.playSound(AudioTypeSfx.TypeSfxClick);
        this.interface.openAdvanced();
        break;
      case Action.ACTION_OPTIONS_MESSAGE_COUNT_1:
        this.interface.nextMessageLevel();
        break;
      case Action.ACTION_DEFAULT_SETT_1:
        this.interface.openPopup(PopupBoxType.TypeSett1);
        cmdResetPriority(game, 'resetFoodPriority');
        break;
      case Action.ACTION_DEFAULT_SETT_2:
        this.interface.openPopup(PopupBoxType.TypeSett2);
        cmdResetPriority(game, 'resetPlanksPriority');
        cmdResetPriority(game, 'resetSteelPriority');
        break;
      case Action.ACTION_DEFAULT_SETT_5_6:
        switch (this.box) {
          case PopupBoxType.TypeSett5:
            cmdResetPriority(game, 'resetFlagPriority');
            break;
          case PopupBoxType.TypeSett6:
            cmdResetPriority(game, 'resetInventoryPriority');
            break;
          default:
            NOT_REACHED();
        }
        break;
      case Action.ACTION_BUILD_STOCK:
        this.interface.buildBuilding(BuildingType.TypeStock, this.specialClick);
        break;
      case Action.ACTION_SHOW_CASTLE_SERF:
        this.setBox(PopupBoxType.TypeCastleSerf);
        break;
      case Action.ACTION_SHOW_RESDIR:
        this.setBox(PopupBoxType.TypeResDir);
        break;
      case Action.ACTION_SHOW_CASTLE_RES:
        this.setBox(PopupBoxType.TypeCastleRes);
        break;
      case Action.ACTION_SEND_GEOLOGIST:
        this.handleSendGeologist();
        break;
      case Action.ACTION_UNKNOWN_TP_INFO_FLAG: {
        /* Road merge button: lead the roads around the flag through it. */
        // PORT: the C++ plays the sound by the result of
        // pull_roads_through_flag(), which is true when a road passes the
        // flag around a corner: flag_has_road_corner() says so before.
        const flag = this.interface.getGame()!.getFlag(this.interface.getPlayer()!.tempIndex);
        if (flag !== null && game.flagHasRoadCorner(flag.getPosition())) {
          cmdPullRoadsThroughFlag(game, flag.getPosition());
          this.playSound(AudioTypeSfx.TypeSfxAccepted);
        } else {
          this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
        }
        this.interface.closePopup();
        break;
      }
      case Action.ACTION_RES_MODE_IN:
      case Action.ACTION_RES_MODE_STOP:
      case Action.ACTION_RES_MODE_OUT:
        /* Stop and out need a special click (as the original). */
        if (action !== Action.ACTION_RES_MODE_IN && !this.specialClick) {
          break;
        }
        this.setInventoryResourceMode(action - Action.ACTION_RES_MODE_IN);
        break;
      case Action.ACTION_SERF_MODE_IN:
      case Action.ACTION_SERF_MODE_STOP:
      case Action.ACTION_SERF_MODE_OUT:
        if (action !== Action.ACTION_SERF_MODE_IN && !this.specialClick) {
          break;
        }
        this.setInventorySerfMode(action - Action.ACTION_SERF_MODE_IN);
        break;
      case Action.ACTION_SHOW_SETT_8:
        this.setBox(PopupBoxType.TypeSett8);
        break;
      case Action.ACTION_SHOW_SETT_6:
        this.setBox(PopupBoxType.TypeSett6);
        break;
      case Action.ACTION_SETT_8_ADJUST_RATE:
        cmdSetSerfToKnightRate(game, guiGetSliderClickValue(x_));
        break;
      case Action.ACTION_SETT_8_TRAIN_1:
        this.sett8Train(1);
        break;
      case Action.ACTION_SETT_8_TRAIN_5:
        this.sett8Train(5);
        break;
      case Action.ACTION_SETT_8_TRAIN_20:
        this.sett8Train(20);
        break;
      case Action.ACTION_SETT_8_TRAIN_100:
        this.sett8Train(100);
        break;
      case Action.ACTION_DEFAULT_SETT_3:
        this.interface.openPopup(PopupBoxType.TypeSett3);
        cmdResetPriority(game, 'resetCoalPriority');
        cmdResetPriority(game, 'resetWheatPriority');
        break;
      case Action.ACTION_SETT_8_SET_COMBAT_MODE_WEAK:
        cmdSetSendStrongest(game, false);
        this.playSound(AudioTypeSfx.TypeSfxAccepted);
        break;
      case Action.ACTION_SETT_8_SET_COMBAT_MODE_STRONG:
        cmdSetSendStrongest(game, true);
        this.playSound(AudioTypeSfx.TypeSfxAccepted);
        break;
      case Action.ACTION_ATTACKING_SELECT_ALL_1:
        attack.knightsAttacking = attack.attackingKnights[0];
        break;
      case Action.ACTION_ATTACKING_SELECT_ALL_2:
        attack.knightsAttacking = attack.attackingKnights[0] + attack.attackingKnights[1];
        break;
      case Action.ACTION_ATTACKING_SELECT_ALL_3:
        attack.knightsAttacking =
          attack.attackingKnights[0] + attack.attackingKnights[1] + attack.attackingKnights[2];
        break;
      case Action.ACTION_ATTACKING_SELECT_ALL_4:
        attack.knightsAttacking =
          attack.attackingKnights[0] +
          attack.attackingKnights[1] +
          attack.attackingKnights[2] +
          attack.attackingKnights[3];
        break;
      case Action.ACTION_MINIMAP_BLD_1:
      case Action.ACTION_MINIMAP_BLD_2:
      case Action.ACTION_MINIMAP_BLD_3:
      case Action.ACTION_MINIMAP_BLD_4:
      case Action.ACTION_MINIMAP_BLD_5:
      case Action.ACTION_MINIMAP_BLD_6:
      case Action.ACTION_MINIMAP_BLD_7:
      case Action.ACTION_MINIMAP_BLD_8:
      case Action.ACTION_MINIMAP_BLD_9:
      case Action.ACTION_MINIMAP_BLD_10:
      case Action.ACTION_MINIMAP_BLD_11:
      case Action.ACTION_MINIMAP_BLD_12:
      case Action.ACTION_MINIMAP_BLD_13:
      case Action.ACTION_MINIMAP_BLD_14:
      case Action.ACTION_MINIMAP_BLD_15:
      case Action.ACTION_MINIMAP_BLD_16:
      case Action.ACTION_MINIMAP_BLD_17:
      case Action.ACTION_MINIMAP_BLD_18:
      case Action.ACTION_MINIMAP_BLD_19:
      case Action.ACTION_MINIMAP_BLD_20:
      case Action.ACTION_MINIMAP_BLD_21:
      case Action.ACTION_MINIMAP_BLD_22:
      case Action.ACTION_MINIMAP_BLD_23:
        this.minimap.setAdvanced(action - Action.ACTION_MINIMAP_BLD_1 + 1);
        this.minimap.setDrawBuildings(true);
        this.setBox(PopupBoxType.TypeMap);
        break;
      case Action.ACTION_MINIMAP_BLD_FLAG:
        this.minimap.setAdvanced(0);
        this.setBox(PopupBoxType.TypeMap);
        break;
      case Action.ACTION_MINIMAP_BLD_NEXT:
        this.setBox((this.box + 1) as PopupBoxType);
        if (this.box > PopupBoxType.TypeBld4) {
          this.setBox(PopupBoxType.TypeBld1);
        }
        break;
      case Action.ACTION_MINIMAP_BLD_EXIT:
        this.setBox(PopupBoxType.TypeMap);
        break;
      case Action.ACTION_DEFAULT_SETT_4:
        this.interface.openPopup(PopupBoxType.TypeSett4);
        cmdResetPriority(game, 'resetToolPriority');
        break;
      case Action.ACTION_SHOW_PLAYER_FACES:
        this.setBox(PopupBoxType.TypePlayerFaces);
        break;
      case Action.ACTION_MINIMAP_SCALE: {
        this.minimap.setScale(this.minimap.getScale() === 1 ? 2 : 1);
        this.setBox(PopupBoxType.TypeMap);
        break;
      }
      /* TODO */
      case Action.ACTION_SETT_8_CASTLE_DEF_DEC:
        cmdChangeCastleKnightsWanted(game, -1);
        break;
      case Action.ACTION_SETT_8_CASTLE_DEF_INC:
        cmdChangeCastleKnightsWanted(game, 1);
        break;
      case Action.ACTION_OPTIONS_MUSIC: {
        const audio = Audio.getInstance();
        const player = audio.getMusicPlayer();
        if (player) {
          player.enable(!player.isEnabled());
        }
        this.playSound(AudioTypeSfx.TypeSfxClick);
        break;
      }
      case Action.ACTION_OPTIONS_SFX: {
        const audio = Audio.getInstance();
        const player = audio.getSoundPlayer();
        if (player) {
          player.enable(!player.isEnabled());
        }
        this.playSound(AudioTypeSfx.TypeSfxClick);
        break;
      }
      case Action.ACTION_OPTIONS_FULLSCREEN:
        Graphics.getInstance().setFullscreen(!Graphics.getInstance().isFullscreen());
        this.playSound(AudioTypeSfx.TypeSfxClick);
        break;
      case Action.ACTION_OPTIONS_VOLUME_MINUS: {
        const audio = Audio.getInstance();
        const volumeController = audio.getVolumeController();
        if (volumeController !== null) {
          volumeController.volumeDown();
        }
        this.playSound(AudioTypeSfx.TypeSfxClick);
        break;
      }
      case Action.ACTION_OPTIONS_VOLUME_PLUS: {
        const audio = Audio.getInstance();
        const volumeController = audio.getVolumeController();
        if (volumeController !== null) {
          volumeController.volumeUp();
        }
        this.playSound(AudioTypeSfx.TypeSfxClick);
        break;
      }
      case Action.ACTION_DEMOLISH:
        this.interface.demolishObject();
        this.interface.closePopup();
        break;
      case Action.ACTION_SHOW_SAVE:
        this.fileList.update();
        this.fileList.setDisplayed(true);
        this.fileField.setDisplayed(true);
        this.setBox(PopupBoxType.TypeLoadSave);
        break;
      case Action.ACTION_SAVE: {
        let fileName = this.fileField.getText();
        const p = fileName.lastIndexOf('.');
        let fileExt = '';
        if (p !== -1) {
          fileExt = fileName.substring(p + 1, fileName.length);
          if (fileExt !== 'save') {
            fileExt = '';
          }
        }
        if (fileExt.length === 0) {
          fileName += '.save';
        }
        const filePath = this.fileList.getFolderPath() + '/' + fileName;
        const saved = GameStore.getInstance().save(filePath, this.interface.getGame()!);
        if (saved) {
          this.interface.closePopup();
        }
        break;
      }
      default:
        Log.Warn('popup', 'unhandled action ', action);
        break;
    }
  }

  /* Generic handler for clicks in popup boxes. */
  // PORT: the C++ advances the pointer `clkmap` by five until the -1; here
  // an index into the array.
  protected handleClickmap(x_: number, y_: number, clkmap: number[]): number {
    let i = 0;
    while (clkmap[i] >= 0) {
      if (
        clkmap[i + 1] <= x_ &&
        x_ < clkmap[i + 1] + clkmap[i + 3] &&
        clkmap[i + 2] <= y_ &&
        y_ < clkmap[i + 2] + clkmap[i + 4]
      ) {
        this.playSound(AudioTypeSfx.TypeSfxClick);

        const action = clkmap[i] as Action;
        this.handleAction(action, x_ - clkmap[i + 1], y_ - clkmap[i + 2]);
        return 0;
      }
      i += 5;
    }

    return -1;
  }

  protected handleBoxCloseClk(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_CLOSE_BOX, 112, 128, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleBoxOptionsClk(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_OPTIONS_MUSIC, 106, 10, 16, 16,
      Action.ACTION_OPTIONS_SFX, 106, 30, 16, 16,
      Action.ACTION_OPTIONS_VOLUME_MINUS, 90, 50, 16, 16,
      Action.ACTION_OPTIONS_VOLUME_PLUS, 106, 50, 16, 16,
      Action.ACTION_OPTIONS_FULLSCREEN, 106, 70, 16, 16,
      Action.ACTION_OPTIONS_MESSAGE_COUNT_1, 90, 90, 32, 16,
      Action.ACTION_CLOSE_OPTIONS, 112, 126, 16, 16,
      Action.ACTION_OPTIONS_ADVANCED, 0, 126, 56, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleMineBuildingClk(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_BUILD_STONEMINE, 16, 8, 33, 65,
      Action.ACTION_BUILD_COALMINE, 64, 8, 33, 65,
      Action.ACTION_BUILD_IRONMINE, 32, 77, 33, 65,
      Action.ACTION_BUILD_GOLDMINE, 80, 77, 33, 65,
      Action.ACTION_BUILD_FLAG, 10, 114, 17, 21,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleBasicBuildingClk(cx: number, cy: number, flip: number): void {
    const clkmap = [
      Action.ACTION_BLD_FLIP_PAGE, 0, 129, 16, 15,
      Action.ACTION_BUILD_STONECUTTER, 16, 13, 33, 29,
      Action.ACTION_BUILD_HUT, 80, 13, 33, 27,
      Action.ACTION_BUILD_LUMBERJACK, 0, 58, 33, 24,
      Action.ACTION_BUILD_FORESTER, 48, 56, 33, 26,
      Action.ACTION_BUILD_FISHER, 96, 55, 33, 30,
      Action.ACTION_BUILD_MILL, 16, 92, 33, 46,
      Action.ACTION_BUILD_FLAG, 58, 108, 17, 21,
      Action.ACTION_BUILD_BOATBUILDER, 80, 87, 33, 53,
      -1,
    ];

    let c = clkmap;
    if (!flip) c = c.slice(5); /* Skip flip button */

    this.handleClickmap(cx, cy, c);
  }

  protected handleAdv1BuildingClk(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_BLD_FLIP_PAGE, 0, 129, 16, 15,
      Action.ACTION_BUILD_BUTCHER, 0, 15, 65, 26,
      Action.ACTION_BUILD_WEAPONSMITH, 64, 15, 65, 26,
      Action.ACTION_BUILD_STEELSMELTER, 0, 50, 49, 39,
      Action.ACTION_BUILD_SAWMILL, 64, 50, 49, 41,
      Action.ACTION_BUILD_BAKER, 16, 100, 49, 33,
      Action.ACTION_BUILD_GOLDSMELTER, 80, 96, 49, 40,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleAdv2BuildingClk(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_BLD_FLIP_PAGE, 0, 129, 16, 15,
      Action.ACTION_BUILD_FORTRESS, 64, 87, 64, 56,
      Action.ACTION_BUILD_TOWER, 16, 99, 48, 43,
      Action.ACTION_BUILD_TOOLMAKER, 0, 1, 64, 48,
      Action.ACTION_BUILD_FARM, 64, 1, 64, 42,
      Action.ACTION_BUILD_PIGFARM, 64, 45, 64, 41,
      Action.ACTION_BUILD_STOCK, 0, 50, 48, 48,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleStatSelectClick(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_SHOW_STAT_1, 8, 12, 32, 32,
      Action.ACTION_SHOW_STAT_2, 48, 12, 32, 32,
      Action.ACTION_SHOW_STAT_3, 88, 12, 32, 32,
      Action.ACTION_SHOW_STAT_4, 8, 56, 32, 32,
      Action.ACTION_SHOW_STAT_BLD, 48, 56, 32, 32,
      Action.ACTION_SHOW_STAT_6, 88, 56, 32, 32,
      Action.ACTION_SHOW_STAT_7, 8, 100, 32, 32,
      Action.ACTION_SHOW_STAT_8, 48, 100, 32, 32,
      Action.ACTION_CLOSE_BOX, 112, 128, 16, 16,
      Action.ACTION_SHOW_SETT_SELECT, 96, 104, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleStat12346Click(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_SHOW_STAT_SELECT, 0, 0, 128, 144,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleStatBldClick(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_SHOW_STAT_SELECT, 112, 128, 16, 16,
      Action.ACTION_STAT_BLD_FLIP, 0, 128, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleStat8Click(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_SETT_8_SET_ASPECT_ALL, 16, 112, 16, 16,
      Action.ACTION_SETT_8_SET_ASPECT_LAND, 32, 112, 16, 16,
      Action.ACTION_SETT_8_SET_ASPECT_BUILDINGS, 16, 128, 16, 16,
      Action.ACTION_SETT_8_SET_ASPECT_MILITARY, 32, 128, 16, 16,

      Action.ACTION_SETT_8_SET_SCALE_30_MIN, 64, 112, 16, 16,
      Action.ACTION_SETT_8_SET_SCALE_60_MIN, 80, 112, 16, 16,
      Action.ACTION_SETT_8_SET_SCALE_600_MIN, 64, 128, 16, 16,
      Action.ACTION_SETT_8_SET_SCALE_3000_MIN, 80, 128, 16, 16,

      Action.ACTION_SHOW_PLAYER_FACES, 112, 112, 16, 14,
      Action.ACTION_SHOW_STAT_SELECT, 112, 128, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleStat7Click(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_STAT_7_SELECT_LUMBER, 0, 75, 16, 16,
      Action.ACTION_STAT_7_SELECT_PLANK, 16, 75, 16, 16,
      Action.ACTION_STAT_7_SELECT_STONE, 32, 75, 16, 16,
      Action.ACTION_STAT_7_SELECT_COAL, 0, 91, 16, 16,
      Action.ACTION_STAT_7_SELECT_IRONORE, 16, 91, 16, 16,
      Action.ACTION_STAT_7_SELECT_GOLDORE, 32, 91, 16, 16,
      Action.ACTION_STAT_7_SELECT_BOAT, 0, 107, 16, 16,
      Action.ACTION_STAT_7_SELECT_STEEL, 16, 107, 16, 16,
      Action.ACTION_STAT_7_SELECT_GOLDBAR, 32, 107, 16, 16,

      Action.ACTION_STAT_7_SELECT_SWORD, 56, 83, 16, 16,
      Action.ACTION_STAT_7_SELECT_SHIELD, 56, 99, 16, 16,

      Action.ACTION_STAT_7_SELECT_SHOVEL, 80, 75, 16, 16,
      Action.ACTION_STAT_7_SELECT_HAMMER, 96, 75, 16, 16,
      Action.ACTION_STAT_7_SELECT_AXE, 112, 75, 16, 16,
      Action.ACTION_STAT_7_SELECT_SAW, 80, 91, 16, 16,
      Action.ACTION_STAT_7_SELECT_PICK, 96, 91, 16, 16,
      Action.ACTION_STAT_7_SELECT_SCYTHE, 112, 91, 16, 16,
      Action.ACTION_STAT_7_SELECT_CLEAVER, 80, 107, 16, 16,
      Action.ACTION_STAT_7_SELECT_PINCER, 96, 107, 16, 16,
      Action.ACTION_STAT_7_SELECT_ROD, 112, 107, 16, 16,

      Action.ACTION_STAT_7_SELECT_FISH, 8, 125, 16, 16,
      Action.ACTION_STAT_7_SELECT_PIG, 24, 125, 16, 16,
      Action.ACTION_STAT_7_SELECT_MEAT, 40, 125, 16, 16,
      Action.ACTION_STAT_7_SELECT_WHEAT, 56, 125, 16, 16,
      Action.ACTION_STAT_7_SELECT_FLOUR, 72, 125, 16, 16,
      Action.ACTION_STAT_7_SELECT_BREAD, 88, 125, 16, 16,

      Action.ACTION_SHOW_STAT_SELECT, 112, 128, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleStartAttackClick(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_ATTACKING_KNIGHTS_DEC, 32, 112, 16, 16,
      Action.ACTION_ATTACKING_KNIGHTS_INC, 80, 112, 16, 16,
      Action.ACTION_START_ATTACK, 0, 128, 32, 16,
      Action.ACTION_CLOSE_ATTACK_BOX, 112, 128, 16, 16,
      Action.ACTION_ATTACKING_SELECT_ALL_1, 8, 80, 16, 24,
      Action.ACTION_ATTACKING_SELECT_ALL_2, 40, 80, 16, 24,
      Action.ACTION_ATTACKING_SELECT_ALL_3, 72, 80, 16, 24,
      Action.ACTION_ATTACKING_SELECT_ALL_4, 104, 80, 16, 24,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleGroundAnalysisClk(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_CLOSE_GROUND_ANALYSIS, 112, 128, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleSettSelectClk(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_SHOW_QUIT, 0, 128, 32, 16,
      Action.ActionShowOptions, 32, 128, 32, 16,
      Action.ACTION_SHOW_SAVE, 64, 128, 32, 16,

      Action.ACTION_SHOW_SETT_1, 8, 8, 32, 32,
      Action.ACTION_SHOW_SETT_2, 48, 8, 32, 32,
      Action.ACTION_SHOW_SETT_3, 88, 8, 32, 32,
      Action.ACTION_SHOW_SETT_4, 8, 48, 32, 32,
      Action.ACTION_SHOW_SETT_5, 48, 48, 32, 32,
      Action.ACTION_SHOW_SETT_6, 88, 48, 32, 32,
      Action.ACTION_SHOW_SETT_7, 8, 88, 32, 32,
      Action.ACTION_SHOW_SETT_8, 48, 88, 32, 32,

      Action.ACTION_CLOSE_SETT_BOX, 112, 128, 16, 16,
      Action.ACTION_SHOW_STAT_SELECT, 96, 104, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleSett1Click(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_SETT_1_ADJUST_STONEMINE, 32, 22, 64, 6,
      Action.ACTION_SETT_1_ADJUST_COALMINE, 0, 42, 64, 6,
      Action.ACTION_SETT_1_ADJUST_IRONMINE, 64, 115, 64, 6,
      Action.ACTION_SETT_1_ADJUST_GOLDMINE, 32, 134, 64, 6,

      Action.ACTION_SHOW_SETT_SELECT, 112, 128, 16, 16,
      Action.ACTION_DEFAULT_SETT_1, 8, 8, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleSett2Click(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_SETT_2_ADJUST_CONSTRUCTION, 0, 27, 64, 6,
      Action.ACTION_SETT_2_ADJUST_BOATBUILDER, 0, 37, 64, 6,
      Action.ACTION_SETT_2_ADJUST_TOOLMAKER_PLANKS, 64, 45, 64, 6,
      Action.ACTION_SETT_2_ADJUST_TOOLMAKER_STEEL, 64, 104, 64, 6,
      Action.ACTION_SETT_2_ADJUST_WEAPONSMITH, 0, 131, 64, 6,

      Action.ACTION_SHOW_SETT_SELECT, 112, 128, 16, 16,
      Action.ACTION_DEFAULT_SETT_2, 104, 8, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleSett3Click(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_SETT_3_ADJUST_STEELSMELTER, 0, 40, 64, 6,
      Action.ACTION_SETT_3_ADJUST_GOLDSMELTER, 64, 40, 64, 6,
      Action.ACTION_SETT_3_ADJUST_WEAPONSMITH, 32, 48, 64, 6,
      Action.ACTION_SETT_3_ADJUST_PIGFARM, 0, 93, 64, 6,
      Action.ACTION_SETT_3_ADJUST_MILL, 64, 119, 64, 6,

      Action.ACTION_SHOW_SETT_SELECT, 112, 128, 16, 16,
      Action.ACTION_DEFAULT_SETT_3, 8, 60, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleKnightLevelClick(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_KNIGHT_LEVEL_CLOSEST_MAX_DEC, 32, 2, 16, 16,
      Action.ACTION_KNIGHT_LEVEL_CLOSEST_MAX_INC, 48, 2, 16, 16,
      Action.ACTION_KNIGHT_LEVEL_CLOSEST_MIN_DEC, 32, 18, 16, 16,
      Action.ACTION_KNIGHT_LEVEL_CLOSEST_MIN_INC, 48, 18, 16, 16,
      Action.ACTION_KNIGHT_LEVEL_CLOSE_MAX_DEC, 32, 36, 16, 16,
      Action.ACTION_KNIGHT_LEVEL_CLOSE_MAX_INC, 48, 36, 16, 16,
      Action.ACTION_KNIGHT_LEVEL_CLOSE_MIN_DEC, 32, 52, 16, 16,
      Action.ACTION_KNIGHT_LEVEL_CLOSE_MIN_INC, 48, 52, 16, 16,
      Action.ACTION_KNIGHT_LEVEL_FAR_MAX_DEC, 32, 70, 16, 16,
      Action.ACTION_KNIGHT_LEVEL_FAR_MAX_INC, 48, 70, 16, 16,
      Action.ACTION_KNIGHT_LEVEL_FAR_MIN_DEC, 32, 86, 16, 16,
      Action.ACTION_KNIGHT_LEVEL_FAR_MIN_INC, 48, 86, 16, 16,
      Action.ACTION_KNIGHT_LEVEL_FARTHEST_MAX_DEC, 32, 104, 16, 16,
      Action.ACTION_KNIGHT_LEVEL_FARTHEST_MAX_INC, 48, 104, 16, 16,
      Action.ACTION_KNIGHT_LEVEL_FARTHEST_MIN_DEC, 32, 120, 16, 16,
      Action.ACTION_KNIGHT_LEVEL_FARTHEST_MIN_INC, 48, 120, 16, 16,

      Action.ACTION_SHOW_SETT_SELECT, 112, 128, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleSett4Click(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_SETT_4_ADJUST_SHOVEL, 32, 4, 64, 8,
      Action.ACTION_SETT_4_ADJUST_HAMMER, 32, 20, 64, 8,
      Action.ACTION_SETT_4_ADJUST_AXE, 32, 36, 64, 8,
      Action.ACTION_SETT_4_ADJUST_SAW, 32, 52, 64, 8,
      Action.ACTION_SETT_4_ADJUST_SCYTHE, 32, 68, 64, 8,
      Action.ACTION_SETT_4_ADJUST_PICK, 32, 84, 64, 8,
      Action.ACTION_SETT_4_ADJUST_PINCER, 32, 100, 64, 8,
      Action.ACTION_SETT_4_ADJUST_CLEAVER, 32, 116, 64, 8,
      Action.ACTION_SETT_4_ADJUST_ROD, 32, 132, 64, 8,

      Action.ACTION_SHOW_SETT_SELECT, 112, 128, 16, 16,
      Action.ACTION_DEFAULT_SETT_4, 104, 8, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleSett56Click(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_SETT_5_6_ITEM_1, 40, 4, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_2, 56, 6, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_3, 72, 8, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_4, 88, 10, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_5, 104, 12, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_6, 104, 28, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_7, 88, 30, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_8, 72, 32, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_9, 56, 34, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_10, 40, 36, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_11, 24, 38, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_12, 8, 40, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_13, 8, 56, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_14, 24, 58, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_15, 40, 60, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_16, 56, 62, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_17, 72, 64, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_18, 88, 66, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_19, 104, 68, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_20, 104, 84, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_21, 88, 86, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_22, 72, 88, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_23, 56, 90, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_24, 40, 92, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_25, 24, 94, 16, 16,
      Action.ACTION_SETT_5_6_ITEM_26, 8, 96, 16, 16,

      Action.ACTION_SETT_5_6_TOP, 8, 120, 16, 16,
      Action.ACTION_SETT_5_6_UP, 24, 120, 16, 16,
      Action.ACTION_SETT_5_6_DOWN, 72, 120, 16, 16,
      Action.ACTION_SETT_5_6_BOTTOM, 88, 120, 16, 16,

      Action.ACTION_SHOW_SETT_SELECT, 112, 128, 16, 16,
      Action.ACTION_DEFAULT_SETT_5_6, 8, 4, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleQuitConfirmClick(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_QUIT_CONFIRM, 8, 45, 32, 8,
      Action.ACTION_QUIT_CANCEL, 88, 45, 32, 8,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleNoSaveQuitConfirmClick(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_NO_SAVE_QUIT_CONFIRM, 8, 125, 32, 8,
      Action.ACTION_QUIT_CANCEL, 88, 125, 32, 8,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleCastleResClk(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_CLOSE_BOX, 112, 128, 16, 16,
      Action.ACTION_SHOW_CASTLE_SERF, 96, 128, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleTransportInfoClk(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_UNKNOWN_TP_INFO_FLAG, 56, 51, 16, 15,
      Action.ACTION_SEND_GEOLOGIST, 16, 96, 16, 16,
      Action.ACTION_CLOSE_BOX, 112, 128, 16, 16,
      -1,
    ];

    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleCastleSerfClk(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_CLOSE_BOX, 112, 128, 16, 16,
      Action.ACTION_SHOW_RESDIR, 96, 128, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleResdirClk(cx: number, cy: number): void {
    const modeClkmap = [
      Action.ACTION_RES_MODE_IN, 72, 16, 16, 16,
      Action.ACTION_RES_MODE_STOP, 72, 32, 16, 16,
      Action.ACTION_RES_MODE_OUT, 72, 48, 16, 16,
      Action.ACTION_SERF_MODE_IN, 72, 80, 16, 16,
      Action.ACTION_SERF_MODE_STOP, 72, 96, 16, 16,
      Action.ACTION_SERF_MODE_OUT, 72, 112, 16, 16,

      Action.ACTION_SHOW_CASTLE_RES, 96, 128, 16, 16,
      Action.ACTION_CLOSE_BOX, 112, 128, 16, 16,

      -1,
    ];

    this.handleClickmap(cx, cy, modeClkmap);
  }

  protected handleSett8Click(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_SETT_8_ADJUST_RATE, 32, 12, 64, 8,

      Action.ACTION_SETT_8_TRAIN_1, 16, 28, 16, 16,
      Action.ACTION_SETT_8_TRAIN_5, 32, 28, 16, 16,
      Action.ACTION_SETT_8_TRAIN_20, 16, 44, 16, 16,
      Action.ACTION_SETT_8_TRAIN_100, 32, 44, 16, 16,

      Action.ACTION_SETT_8_SET_COMBAT_MODE_WEAK, 48, 84, 16, 16,
      Action.ACTION_SETT_8_SET_COMBAT_MODE_STRONG, 48, 100, 16, 16,

      Action.ACTION_SETT_8_CYCLE, 80, 84, 32, 32,

      Action.ACTION_SETT_8_CASTLE_DEF_DEC, 24, 120, 16, 16,
      Action.ACTION_SETT_8_CASTLE_DEF_INC, 72, 120, 16, 16,

      Action.ACTION_SHOW_SETT_SELECT, 112, 128, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleMessageClk(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_CLOSE_MESSAGE, 112, 128, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handlePlayerFacesClick(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_SHOW_STAT_8, 0, 0, 128, 144,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  /* Every click advances to the next picture (Amiga wait_for_mouse_click).
     At the end the game resumes and asks whether to quit (@0x1d982). */
  protected handleGameEndClick(_cx: number, _cy: number): void {
    this.gameEndStage += 1;
    if (this.gameEndStage === 2 && this.getGameEndPicture() < 0) {
      this.gameEndStage += 1;
    }
    if (this.gameEndStage <= 2) {
      this.setRedraw();
      return;
    }

    const game = this.interface.getGame()!;
    const iface = this.interface;
    iface.closePopup();
    if (game.isPaused()) {
      cmdSetPaused(game, false);
    }
    iface.openPopup(PopupBoxType.TypeQuitConfirm);
  }

  protected handleTutorialOrdersClick(_cx: number, _cy: number): void {
    this.interface.closePopup();
  }

  protected handleBoxDemolishClk(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_CLOSE_BOX, 112, 128, 16, 16,
      Action.ACTION_DEMOLISH, 56, 45, 16, 16,
      -1,
    ];
    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleMinimapClk(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_MINIMAP_CLICK, 0, 0, 128, 128,
      Action.ACTION_MINIMAP_MODE, 0, 128, 32, 16,
      Action.ACTION_MINIMAP_ROADS, 32, 128, 32, 16,
      Action.ACTION_MINIMAP_BUILDINGS, 64, 128, 32, 16,
      Action.ACTION_MINIMAP_GRID, 96, 128, 16, 16,
      Action.ACTION_MINIMAP_SCALE, 112, 128, 16, 16,
      -1,
    ];

    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleBoxBld1(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_MINIMAP_BLD_1, 0, 0, 64, 51,
      Action.ACTION_MINIMAP_BLD_2, 64, 0, 48, 51,
      Action.ACTION_MINIMAP_BLD_3, 16, 64, 32, 32,
      Action.ACTION_MINIMAP_BLD_4, 48, 60, 64, 71,
      Action.ACTION_MINIMAP_BLD_FLAG, 25, 110, 16, 34,
      Action.ACTION_MINIMAP_BLD_NEXT, 0, 128, 16, 16,
      Action.ACTION_MINIMAP_BLD_EXIT, 112, 128, 16, 16,
      -1,
    ];

    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleBoxBld2(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_MINIMAP_BLD_5, 0, 0, 64, 56,
      Action.ACTION_MINIMAP_BLD_6, 64, 0, 32, 51,
      Action.ACTION_MINIMAP_BLD_7, 0, 64, 64, 32,
      Action.ACTION_MINIMAP_BLD_8, 64, 64, 32, 32,
      Action.ACTION_MINIMAP_BLD_9, 96, 60, 32, 36,
      Action.ACTION_MINIMAP_BLD_10, 32, 104, 32, 36,
      Action.ACTION_MINIMAP_BLD_11, 64, 104, 32, 36,
      Action.ACTION_MINIMAP_BLD_NEXT, 0, 128, 16, 16,
      Action.ACTION_MINIMAP_BLD_EXIT, 112, 128, 16, 16,
      -1,
    ];

    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleBoxBld3(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_MINIMAP_BLD_12, 0, 0, 64, 48,
      Action.ACTION_MINIMAP_BLD_13, 64, 0, 64, 48,
      Action.ACTION_MINIMAP_BLD_14, 0, 56, 32, 34,
      Action.ACTION_MINIMAP_BLD_15, 32, 86, 32, 54,
      Action.ACTION_MINIMAP_BLD_16, 64, 56, 64, 34,
      Action.ACTION_MINIMAP_BLD_17, 64, 100, 48, 40,
      Action.ACTION_MINIMAP_BLD_NEXT, 0, 128, 16, 16,
      Action.ACTION_MINIMAP_BLD_EXIT, 112, 128, 16, 16,
      -1,
    ];

    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleBoxBld4(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_MINIMAP_BLD_18, 0, 0, 32, 64,
      Action.ACTION_MINIMAP_BLD_19, 32, 0, 32, 64,
      Action.ACTION_MINIMAP_BLD_20, 61, 0, 35, 64,
      Action.ACTION_MINIMAP_BLD_21, 96, 0, 32, 64,
      Action.ACTION_MINIMAP_BLD_22, 16, 95, 48, 41,
      Action.ACTION_MINIMAP_BLD_23, 64, 95, 48, 41,
      Action.ACTION_MINIMAP_BLD_NEXT, 0, 128, 16, 16,
      Action.ACTION_MINIMAP_BLD_EXIT, 112, 128, 16, 16,
      -1,
    ];

    this.handleClickmap(cx, cy, clkmap);
  }

  protected handleSaveClk(cx: number, cy: number): void {
    const clkmap = [
      Action.ACTION_SAVE, 0, 128, 32, 64,
      Action.ACTION_CLOSE_BOX, 112, 128, 16, 16,
      -1,
    ];

    this.handleClickmap(cx, cy, clkmap);
  }

  /* A special click (right button) is handled like a click with the
     special click flag set, where the original has a special action. */
  protected override handleClickRight(cx: number, cy: number): boolean {
    switch (this.box) {
      case PopupBoxType.TypeMap:
      case PopupBoxType.TypeResDir:
      case PopupBoxType.TypeMineBuilding:
      case PopupBoxType.TypeBasicBld:
      case PopupBoxType.TypeBasicBldFlip:
      case PopupBoxType.TypeAdv1Bld:
      case PopupBoxType.TypeAdv2Bld:
        this.specialClick = true;
        this.handleClickLeft(cx, cy);
        this.specialClick = false;
        return true;
      default:
        return false;
    }
  }

  protected override handleClickLeft(cx: number, cy: number): boolean {
    cx -= 8;
    cy -= 8;

    switch (this.box) {
      case PopupBoxType.TypeMap:
        this.handleMinimapClk(cx, cy);
        break;
      case PopupBoxType.TypeMineBuilding:
        this.handleMineBuildingClk(cx, cy);
        break;
      case PopupBoxType.TypeBasicBld:
        this.handleBasicBuildingClk(cx, cy, 0);
        break;
      case PopupBoxType.TypeBasicBldFlip:
        this.handleBasicBuildingClk(cx, cy, 1);
        break;
      case PopupBoxType.TypeAdv1Bld:
        this.handleAdv1BuildingClk(cx, cy);
        break;
      case PopupBoxType.TypeAdv2Bld:
        this.handleAdv2BuildingClk(cx, cy);
        break;
      case PopupBoxType.TypeStatSelect:
        this.handleStatSelectClick(cx, cy);
        break;
      case PopupBoxType.TypeStat1:
      case PopupBoxType.TypeStat2:
      case PopupBoxType.TypeStat3:
      case PopupBoxType.TypeStat4:
      case PopupBoxType.TypeStat6:
        this.handleStat12346Click(cx, cy);
        break;
      case PopupBoxType.TypeStatBld1:
      case PopupBoxType.TypeStatBld2:
      case PopupBoxType.TypeStatBld3:
      case PopupBoxType.TypeStatBld4:
        this.handleStatBldClick(cx, cy);
        break;
      case PopupBoxType.TypeStat8:
        this.handleStat8Click(cx, cy);
        break;
      case PopupBoxType.TypeStat7:
        this.handleStat7Click(cx, cy);
        break;
      case PopupBoxType.TypeStartAttack:
      case PopupBoxType.TypeStartAttackRedraw:
        this.handleStartAttackClick(cx, cy);
        break;
      /* TODO */
      case PopupBoxType.TypeGroundAnalysis:
        this.handleGroundAnalysisClk(cx, cy);
        break;
      /* TODO ... */
      case PopupBoxType.TypeSettSelect:
        this.handleSettSelectClk(cx, cy);
        break;
      case PopupBoxType.TypeSett1:
        this.handleSett1Click(cx, cy);
        break;
      case PopupBoxType.TypeSett2:
        this.handleSett2Click(cx, cy);
        break;
      case PopupBoxType.TypeSett3:
        this.handleSett3Click(cx, cy);
        break;
      case PopupBoxType.TypeKnightLevel:
        this.handleKnightLevelClick(cx, cy);
        break;
      case PopupBoxType.TypeSett4:
        this.handleSett4Click(cx, cy);
        break;
      case PopupBoxType.TypeSett5:
        this.handleSett56Click(cx, cy);
        break;
      case PopupBoxType.TypeQuitConfirm:
        this.handleQuitConfirmClick(cx, cy);
        break;
      case PopupBoxType.TypeNoSaveQuitConfirm:
        this.handleNoSaveQuitConfirmClick(cx, cy);
        break;
      case PopupBoxType.TypeOptions:
        this.handleBoxOptionsClk(cx, cy);
        break;
      case PopupBoxType.TypeCastleRes:
        this.handleCastleResClk(cx, cy);
        break;
      case PopupBoxType.TypeMineOutput:
        this.handleBoxCloseClk(cx, cy);
        break;
      case PopupBoxType.TypeOrderedBld:
        this.handleBoxCloseClk(cx, cy);
        break;
      case PopupBoxType.TypeDefenders:
        this.handleBoxCloseClk(cx, cy);
        break;
      case PopupBoxType.TypeTransportInfo:
        this.handleTransportInfoClk(cx, cy);
        break;
      case PopupBoxType.TypeCastleSerf:
        this.handleCastleSerfClk(cx, cy);
        break;
      case PopupBoxType.TypeResDir:
        this.handleResdirClk(cx, cy);
        break;
      case PopupBoxType.TypeSett8:
        this.handleSett8Click(cx, cy);
        break;
      case PopupBoxType.TypeSett6:
        this.handleSett56Click(cx, cy);
        break;
      case PopupBoxType.TypeBld1:
        this.handleBoxBld1(cx, cy);
        break;
      case PopupBoxType.TypeBld2:
        this.handleBoxBld2(cx, cy);
        break;
      case PopupBoxType.TypeBld3:
        this.handleBoxBld3(cx, cy);
        break;
      case PopupBoxType.TypeBld4:
        this.handleBoxBld4(cx, cy);
        break;
      case PopupBoxType.TypeMessage:
        this.handleMessageClk(cx, cy);
        break;
      case PopupBoxType.TypeBldStock:
        this.handleBoxCloseClk(cx, cy);
        break;
      case PopupBoxType.TypePlayerFaces:
        this.handlePlayerFacesClick(cx, cy);
        break;
      case PopupBoxType.TypeDemolish:
        this.handleBoxDemolishClk(cx, cy);
        break;
      case PopupBoxType.TypeGameEnd:
        this.handleGameEndClick(cx, cy);
        break;
      case PopupBoxType.TypeTutorialOrders:
        this.handleTutorialOrdersClick(cx, cy);
        break;
      case PopupBoxType.TypeLoadSave:
        this.handleSaveClk(cx, cy);
        break;
      default:
        Log.Debug('popup', 'unhandled box: ', this.box);
        break;
    }

    return true;
  }

  show(box_: PopupBoxType): void {
    if (box_ === PopupBoxType.TypeGameEnd) {
      /* No result picture in a demo game. */
      const game = this.interface.getGame()!;
      this.gameEndStage = game.getGameType() === GameGameType.GameTypeDemo ? 1 : 0;
    }
    this.setBox(box_);
    this.setDisplayed(true);
  }

  hide(): void {
    this.setBox(0 as PopupBoxType);
    this.setDisplayed(false);
  }

  protected setBox(box_: PopupBoxType): void {
    // PORT: not in the C++. A box that the page shows as a window (ui/menu)
    // opens there, also when this popup switches to it by itself. The window
    // replaces this popup: Interface.openHtmlBox() destroys it, so nothing
    // of it is used after.
    if (
      box_ !== PopupBoxType.TypeNone &&
      this.displayed &&
      this.interface.popupHook !== null &&
      this.interface.popupHook(box_, true)
    ) {
      return;
    }
    this.box = box_;
    if (this.box === PopupBoxType.TypeMap) {
      this.minimap.setDisplayed(true);
    } else {
      this.minimap.setDisplayed(false);
    }
    this.setRedraw();
  }
}
