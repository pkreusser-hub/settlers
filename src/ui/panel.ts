// panel.h + panel.cc - Panel GUI component

import { NOT_REACHED } from '../game/misc';
import type { Player } from '../game/player';
import { cmdAddTimer, cmdDemolishRoad } from '../net/commands';
import { AudioTypeSfx } from './audio';
import { Data } from './data-instance';
import { Timer, TimerHandler } from './event-loop';
import { TICKS_PER_SEC } from './freeserf';
import type { Frame } from './gfx';
import { GuiObject } from './gui';
import type { Interface } from './interface';
import { InterfaceBuildPossibility, InterfaceCursorType } from './interface';
import { PopupBoxType } from './popup';
import { ViewportLayer } from './viewport';

export enum PanelBarButton {
  ButtonBuildInactive = 0,
  ButtonBuildFlag,
  ButtonBuildMine,
  ButtonBuildSmall,
  ButtonBuildLarge,
  ButtonBuildCastle,
  ButtonDestroy,
  ButtonDestroyInactive,
  ButtonBuildRoad,
  ButtonMapInactive,
  ButtonMap,
  ButtonStatsInactive,
  ButtonStats,
  ButtonSettInactive,
  ButtonSett,
  ButtonDestroyRoad,
  ButtonGroundAnalysis,
  ButtonBuildSmallStarred,
  ButtonBuildLargeStarred,
  ButtonMapStarred,
  ButtonStatsStarred,
  ButtonSettStarred,
  ButtonGroundAnalysisStarred,
  ButtonBuildMineStarred,
  ButtonBuildRoadStarred,
}

export class PanelBar extends GuiObject implements TimerHandler {
  static Button = PanelBarButton;

  // PORT: `interface` is the field name of the C++; it is a reserved word
  // only as a binding name, so the constructor parameter is _interface.
  protected interface: Interface;
  protected panelBtns: number[] = [0, 0, 0, 0, 0];
  protected blinkTimer: Timer | null;
  protected blinkTrigger: boolean;

  constructor(_interface: Interface) {
    super();
    this.interface = _interface;

    this.panelBtns[0] = PanelBarButton.ButtonBuildInactive;
    this.panelBtns[1] = PanelBarButton.ButtonDestroyInactive;
    this.panelBtns[2] = PanelBarButton.ButtonMap;
    this.panelBtns[3] = PanelBarButton.ButtonStats;
    this.panelBtns[4] = PanelBarButton.ButtonSett;

    this.blinkTimer = Timer.create(1, 700, this);
    if (this.blinkTimer !== null) {
      this.blinkTimer.run();
    }
    this.blinkTrigger = false;
  }

  // PORT: the destructor.
  override destroy(): void {
    if (this.blinkTimer !== null) {
      this.blinkTimer.destroy();
      this.blinkTimer = null;
    }
    super.destroy();
  }

  /* Draw the frame around action buttons. */
  protected drawPanelFrame(): void {
    const bottomSvgaLayout = [
      6, 0, 0,
      0, 40, 0,
      20, 48, 0,

      7, 64, 0,
      8, 64, 36,
      21, 96, 0,

      9, 112, 0,
      10, 112, 36,
      22, 144, 0,

      11, 160, 0,
      12, 160, 36,
      23, 192, 0,

      13, 208, 0,
      14, 208, 36,
      24, 240, 0,

      15, 256, 0,
      16, 256, 36,
      25, 288, 0,

      1, 304, 0,
      6, 312, 0,
      -1,
    ];

    /* TODO request full buffer swap(?) */

    const layout = bottomSvgaLayout;
    const frame = this.frame as Frame;

    /* Draw layout */
    for (let i = 0; layout[i] !== -1; i += 3) {
      frame.drawSprite(layout[i + 1], layout[i + 2], Data.Resource.AssetFrameBottom, layout[i]);
    }
  }

  /* Draw notification icon in action panel. */
  protected drawMessageNotify(): void {
    (this.frame as Frame).drawSprite(40, 4, Data.Resource.AssetFrameBottom, 2);
  }

  /* Draw return arrow icon in action panel. */
  protected drawReturnArrow(): void {
    (this.frame as Frame).drawSprite(40, 28, Data.Resource.AssetFrameBottom, 4);
  }

  /* Draw buttons in action panel. */
  protected drawPanelButtons(): void {
    if (this.enabled) {
      const player: Player | null = this.interface.getPlayer();
      /* Blinking message icon. */
      if (player !== null && player.hasNotification()) {
        if (this.blinkTrigger) {
          this.drawMessageNotify();
        }
      }

      /* Return arrow icon. */
      if (this.interface.hasReturnArrow()) {
        this.drawReturnArrow();
      }
    }

    const inactiveButtons = [
      PanelBarButton.ButtonBuildInactive,
      PanelBarButton.ButtonDestroyInactive,
      PanelBarButton.ButtonMapInactive,
      PanelBarButton.ButtonStatsInactive,
      PanelBarButton.ButtonSettInactive,
    ];

    for (let i = 0; i < 5; i++) {
      let button = this.panelBtns[i];
      if (!this.enabled) button = inactiveButtons[i];

      const sx = 64 + i * 48;
      const sy = 4;
      (this.frame as Frame).drawSprite(sx, sy, Data.Resource.AssetPanelButton, button);
    }
  }

  protected override internalDraw(): void {
    this.drawPanelFrame();
    this.drawPanelButtons();
  }

  /* Handle a click on the panel buttons. */
  protected buttonClick(button: number, special = false): void {
    const popup = this.interface.getPopupBox();

    /* A special click (right button) works as in the original: on a build
       button it switches the builder's help (the possible building sites),
       on the map button it shows the castle, and only a special click
       demolishes. */
    if (special) {
      switch (this.panelBtns[button]) {
        case PanelBarButton.ButtonBuildInactive:
        case PanelBarButton.ButtonBuildFlag:
        case PanelBarButton.ButtonBuildMine:
        case PanelBarButton.ButtonBuildSmall:
        case PanelBarButton.ButtonBuildLarge:
        case PanelBarButton.ButtonBuildCastle:
        case PanelBarButton.ButtonBuildRoad:
          /* Not while a popup is open or a road is being built. */
          if ((popup === null || !popup.isDisplayed()) && !this.interface.isBuildingRoad()) {
            this.interface.getViewport()!.switchLayer(ViewportLayer.LayerBuilds);
            this.playSound(AudioTypeSfx.TypeSfxClick);
          }
          return;
        case PanelBarButton.ButtonMap:
          this.interface.moveToCastle();
          return;
        case PanelBarButton.ButtonDestroy:
        case PanelBarButton.ButtonDestroyRoad:
          break;
        default:
          return;
      }
    } else if (
      this.panelBtns[button] === PanelBarButton.ButtonDestroy ||
      this.panelBtns[button] === PanelBarButton.ButtonDestroyRoad
    ) {
      /* A normal click on a demolish button does nothing. */
      return;
    }

    switch (this.panelBtns[button]) {
      case PanelBarButton.ButtonMap:
      case PanelBarButton.ButtonMapStarred:
        this.playSound(AudioTypeSfx.TypeSfxClick);
        if (popup !== null && popup.isDisplayed()) {
          this.interface.closePopup();
        } else {
          this.panelBtns[0] = PanelBarButton.ButtonBuildInactive;
          this.panelBtns[1] = PanelBarButton.ButtonDestroyInactive;
          this.panelBtns[2] = PanelBarButton.ButtonMapStarred;
          this.panelBtns[3] = PanelBarButton.ButtonStatsInactive;
          this.panelBtns[4] = PanelBarButton.ButtonSettInactive;

          this.interface.openPopup(PopupBoxType.TypeMap);

          /* Synchronize minimap window with viewport. */
          if (popup !== null) {
            const viewport = this.interface.getViewport()!;
            const minimap = popup.getMinimap();
            if (minimap !== null) {
              const pos = viewport.getCurrentMapPos();
              minimap.moveToMapPos(pos);
            }
          }
        }
        break;
      case PanelBarButton.ButtonSett:
      case PanelBarButton.ButtonSettStarred:
        this.playSound(AudioTypeSfx.TypeSfxClick);
        if (popup !== null && popup.isDisplayed()) {
          this.interface.closePopup();
        } else {
          this.panelBtns[0] = PanelBarButton.ButtonBuildInactive;
          this.panelBtns[1] = PanelBarButton.ButtonDestroyInactive;
          this.panelBtns[2] = PanelBarButton.ButtonMapInactive;
          this.panelBtns[3] = PanelBarButton.ButtonStatsInactive;
          this.panelBtns[4] = PanelBarButton.ButtonSettStarred;
          this.interface.openPopup(PopupBoxType.TypeSettSelect);
        }
        break;
      case PanelBarButton.ButtonStats:
      case PanelBarButton.ButtonStatsStarred:
        this.playSound(AudioTypeSfx.TypeSfxClick);
        if (popup !== null && popup.isDisplayed()) {
          this.interface.closePopup();
        } else {
          this.panelBtns[0] = PanelBarButton.ButtonBuildInactive;
          this.panelBtns[1] = PanelBarButton.ButtonDestroyInactive;
          this.panelBtns[2] = PanelBarButton.ButtonMapInactive;
          this.panelBtns[3] = PanelBarButton.ButtonStatsStarred;
          this.panelBtns[4] = PanelBarButton.ButtonSettInactive;
          this.interface.openPopup(PopupBoxType.TypeStatSelect);
        }
        break;
      case PanelBarButton.ButtonBuildRoad:
      case PanelBarButton.ButtonBuildRoadStarred:
        this.playSound(AudioTypeSfx.TypeSfxClick);
        if (this.interface.isBuildingRoad()) {
          this.interface.buildRoadEnd();
        } else {
          this.interface.buildRoadBegin();
        }
        break;
      case PanelBarButton.ButtonBuildFlag:
        this.playSound(AudioTypeSfx.TypeSfxClick);
        this.interface.buildFlag();
        break;
      case PanelBarButton.ButtonBuildSmall:
      case PanelBarButton.ButtonBuildSmallStarred:
        this.playSound(AudioTypeSfx.TypeSfxClick);
        if (popup !== null && popup.isDisplayed()) {
          this.interface.closePopup();
        } else {
          this.panelBtns[0] = PanelBarButton.ButtonBuildSmallStarred;
          this.panelBtns[1] = PanelBarButton.ButtonDestroyInactive;
          this.panelBtns[2] = PanelBarButton.ButtonMapInactive;
          this.panelBtns[3] = PanelBarButton.ButtonStatsInactive;
          this.panelBtns[4] = PanelBarButton.ButtonSettInactive;
          this.interface.openPopup(PopupBoxType.TypeBasicBld);
        }
        break;
      case PanelBarButton.ButtonBuildLarge:
      case PanelBarButton.ButtonBuildLargeStarred:
        this.playSound(AudioTypeSfx.TypeSfxClick);
        if (popup !== null && popup.isDisplayed()) {
          this.interface.closePopup();
        } else {
          this.panelBtns[0] = PanelBarButton.ButtonBuildLargeStarred;
          this.panelBtns[1] = PanelBarButton.ButtonDestroyInactive;
          this.panelBtns[2] = PanelBarButton.ButtonMapInactive;
          this.panelBtns[3] = PanelBarButton.ButtonStatsInactive;
          this.panelBtns[4] = PanelBarButton.ButtonSettInactive;
          this.interface.openPopup(PopupBoxType.TypeBasicBldFlip);
        }
        break;
      case PanelBarButton.ButtonBuildMine:
      case PanelBarButton.ButtonBuildMineStarred:
        this.playSound(AudioTypeSfx.TypeSfxClick);
        if (popup !== null && popup.isDisplayed()) {
          this.interface.closePopup();
        } else {
          this.panelBtns[0] = PanelBarButton.ButtonBuildMineStarred;
          this.panelBtns[1] = PanelBarButton.ButtonDestroyInactive;
          this.panelBtns[2] = PanelBarButton.ButtonMapInactive;
          this.panelBtns[3] = PanelBarButton.ButtonStatsInactive;
          this.panelBtns[4] = PanelBarButton.ButtonSettInactive;
          this.interface.openPopup(PopupBoxType.TypeMineBuilding);
        }
        break;
      case PanelBarButton.ButtonDestroy:
        if (this.interface.getMapCursorType() === InterfaceCursorType.CursorTypeRemovableFlag) {
          this.interface.demolishObject();
        } else {
          this.panelBtns[0] = PanelBarButton.ButtonBuildInactive;
          this.panelBtns[1] = PanelBarButton.ButtonDestroyInactive;
          this.panelBtns[2] = PanelBarButton.ButtonMapInactive;
          this.panelBtns[3] = PanelBarButton.ButtonStatsInactive;
          this.panelBtns[4] = PanelBarButton.ButtonSettInactive;
          this.interface.openPopup(PopupBoxType.TypeDemolish);
        }
        break;
      case PanelBarButton.ButtonBuildCastle:
        this.interface.buildCastle();
        break;
      case PanelBarButton.ButtonDestroyRoad: {
        // PORT: the result of game->demolish_road() in the C++, which is
        // that of can_demolish_road().
        const game = this.interface.getPlayer()!.getGame();
        const r = game.canDemolishRoad(
          this.interface.getMapCursorPos(),
          this.interface.getPlayer()!,
        );
        if (r) {
          cmdDemolishRoad(game, this.interface.getMapCursorPos());
        }
        if (!r) {
          this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
          this.interface.updateMapCursorPos(this.interface.getMapCursorPos());
        } else {
          this.playSound(AudioTypeSfx.TypeSfxAccepted);
        }
        break;
      }
      case PanelBarButton.ButtonGroundAnalysis:
      case PanelBarButton.ButtonGroundAnalysisStarred:
        this.playSound(AudioTypeSfx.TypeSfxClick);
        if (popup !== null && popup.isDisplayed()) {
          this.interface.closePopup();
        } else {
          this.panelBtns[0] = PanelBarButton.ButtonBuildInactive;
          this.panelBtns[1] = PanelBarButton.ButtonGroundAnalysisStarred;
          this.panelBtns[2] = PanelBarButton.ButtonMapInactive;
          this.panelBtns[3] = PanelBarButton.ButtonStatsInactive;
          this.panelBtns[4] = PanelBarButton.ButtonSettInactive;
          this.interface.openPopup(PopupBoxType.TypeGroundAnalysis);
        }
        break;
    }
  }

  protected override handleClickLeft(cx: number, cy: number): boolean {
    this.setRedraw();

    if (cx >= 41 && cx < 53) {
      /* Message bar click */
      if (cy < 16) {
        /* Message icon */
        this.interface.openMessage();
      } else if (cy >= 28) {
        /* Return arrow */
        this.interface.returnFromMessage();
      }
    } else if (cx >= 301 && cx < 313) {
      /* Timer bar click */
      /* Call to map position */
      let timerLength = 0;

      if (cy < 7) {
        timerLength = 5 * 60;
      } else if (cy < 14) {
        timerLength = 10 * 60;
      } else if (cy < 21) {
        timerLength = 20 * 60;
      } else if (cy < 28) {
        timerLength = 30 * 60;
      } else {
        timerLength = 60 * 60;
      }

      cmdAddTimer(
        this.interface.getPlayer()!.getGame(),
        timerLength * TICKS_PER_SEC,
        this.interface.getMapCursorPos(),
      );

      this.playSound(AudioTypeSfx.TypeSfxAccepted);
    } else {
      const button = this.buttonAt(cx, cy);
      if (button < 0) {
        return false;
      }
      this.buttonClick(button);
    }

    return true;
  }

  /* Special click (right button) on a panel button. */
  protected override handleClickRight(cx: number, cy: number): boolean {
    const button = this.buttonAt(cx, cy);
    if (button < 0) {
      return false;
    }

    this.setRedraw();
    this.buttonClick(button, true);
    return true;
  }

  /* Index of the panel button at cx, cy, or -1. */
  protected buttonAt(cx: number, cy: number): number {
    if (cy < 4 || cy >= 36 || cx < 64) {
      return -1;
    }

    cx -= 64;
    let button = 0;
    while (1) {
      if (cx < 32) {
        return button < 5 ? button : -1;
      }
      button += 1;
      if (cx < 48) {
        return -1;
      }
      cx -= 48;
    }
    // PORT: not reached, the loop above always returns.
    return -1;
  }

  protected override handleKeyPressed(key: number, modifier: number): boolean {
    if (key < 0x31 /* '1' */ || key > 0x35 /* '5' */) {
      return false;
    }

    /* The keys are not in the original; on the demolish buttons they act
       as a special click so that they can still demolish. */
    const button = key - 0x31; /* '1' */
    const special =
      this.panelBtns[button] === PanelBarButton.ButtonDestroy ||
      this.panelBtns[button] === PanelBarButton.ButtonDestroyRoad;
    this.buttonClick(button, special);

    return true;
  }

  protected buttonTypeWithBuildPossibility(buildPossibility: number): PanelBarButton {
    let result: PanelBarButton;

    switch (buildPossibility) {
      case InterfaceBuildPossibility.BuildPossibilityCastle:
        result = PanelBarButton.ButtonBuildCastle;
        break;
      case InterfaceBuildPossibility.BuildPossibilityMine:
        result = PanelBarButton.ButtonBuildMine;
        break;
      case InterfaceBuildPossibility.BuildPossibilityLarge:
        result = PanelBarButton.ButtonBuildLarge;
        break;
      case InterfaceBuildPossibility.BuildPossibilitySmall:
        result = PanelBarButton.ButtonBuildSmall;
        break;
      case InterfaceBuildPossibility.BuildPossibilityFlag:
        result = PanelBarButton.ButtonBuildFlag;
        break;
      default:
        result = PanelBarButton.ButtonBuildInactive;
        break;
    }

    return result;
  }

  update(): void {
    const popupBox = this.interface.getPopupBox();
    if (popupBox !== null && popupBox.isDisplayed()) {
      switch (popupBox.getBox()) {
        case PopupBoxType.TypeTransportInfo:
        case PopupBoxType.TypeOrderedBld:
        case PopupBoxType.TypeCastleRes:
        case PopupBoxType.TypeDefenders:
        case PopupBoxType.TypeMineOutput:
        case PopupBoxType.TypeBldStock:
        case PopupBoxType.TypeStartAttack:
        case PopupBoxType.TypeQuitConfirm:
        case PopupBoxType.TypeOptions: {
          this.panelBtns[0] = PanelBarButton.ButtonBuildInactive;
          this.panelBtns[1] = PanelBarButton.ButtonDestroyInactive;
          this.panelBtns[2] = PanelBarButton.ButtonMapInactive;
          this.panelBtns[3] = PanelBarButton.ButtonStatsInactive;
          this.panelBtns[4] = PanelBarButton.ButtonSettInactive;
          break;
        }
        default:
          break;
      }
    } else if (this.interface.isBuildingRoad()) {
      this.panelBtns[0] = PanelBarButton.ButtonBuildRoadStarred;
      this.panelBtns[1] = PanelBarButton.ButtonBuildInactive;
      this.panelBtns[2] = PanelBarButton.ButtonMapInactive;
      this.panelBtns[3] = PanelBarButton.ButtonStatsInactive;
      this.panelBtns[4] = PanelBarButton.ButtonSettInactive;
    } else {
      this.panelBtns[2] = PanelBarButton.ButtonMap;
      this.panelBtns[3] = PanelBarButton.ButtonStats;
      this.panelBtns[4] = PanelBarButton.ButtonSett;

      const buildPossibility: InterfaceBuildPossibility = this.interface.getBuildPossibility();

      switch (this.interface.getMapCursorType()) {
        case InterfaceCursorType.CursorTypeNone:
          this.panelBtns[0] = PanelBarButton.ButtonBuildInactive;
          if (this.interface.getPlayer()!.hasCastle()) {
            this.panelBtns[1] = PanelBarButton.ButtonDestroyInactive;
          } else {
            this.panelBtns[1] = PanelBarButton.ButtonGroundAnalysis;
          }
          break;
        case InterfaceCursorType.CursorTypeFlag:
          this.panelBtns[0] = PanelBarButton.ButtonBuildRoad;
          this.panelBtns[1] = PanelBarButton.ButtonDestroyInactive;
          break;
        case InterfaceCursorType.CursorTypeRemovableFlag:
          this.panelBtns[0] = PanelBarButton.ButtonBuildRoad;
          this.panelBtns[1] = PanelBarButton.ButtonDestroy;
          break;
        case InterfaceCursorType.CursorTypeBuilding:
          this.panelBtns[0] = this.buttonTypeWithBuildPossibility(buildPossibility);
          this.panelBtns[1] = PanelBarButton.ButtonDestroy;
          break;
        case InterfaceCursorType.CursorTypePath:
          this.panelBtns[0] = PanelBarButton.ButtonBuildInactive;
          this.panelBtns[1] = PanelBarButton.ButtonDestroyRoad;
          if (buildPossibility !== InterfaceBuildPossibility.BuildPossibilityNone) {
            this.panelBtns[0] = PanelBarButton.ButtonBuildFlag;
          }
          break;
        case InterfaceCursorType.CursorTypeClearByFlag:
          if (
            buildPossibility === InterfaceBuildPossibility.BuildPossibilityNone ||
            buildPossibility === InterfaceBuildPossibility.BuildPossibilityFlag
          ) {
            this.panelBtns[0] = PanelBarButton.ButtonBuildInactive;
            if (this.interface.getPlayer()!.hasCastle()) {
              this.panelBtns[1] = PanelBarButton.ButtonDestroyInactive;
            } else {
              this.panelBtns[1] = PanelBarButton.ButtonGroundAnalysis;
            }
          } else {
            this.panelBtns[0] = this.buttonTypeWithBuildPossibility(buildPossibility);
            this.panelBtns[1] = PanelBarButton.ButtonDestroyInactive;
          }
          break;
        case InterfaceCursorType.CursorTypeClearByPath:
          this.panelBtns[0] = this.buttonTypeWithBuildPossibility(buildPossibility);
          this.panelBtns[1] = PanelBarButton.ButtonDestroyInactive;
          break;
        case InterfaceCursorType.CursorTypeClear: {
          this.panelBtns[0] = this.buttonTypeWithBuildPossibility(buildPossibility);
          const player: Player | null = this.interface.getPlayer();
          if (player !== null && player.hasCastle()) {
            this.panelBtns[1] = PanelBarButton.ButtonDestroyInactive;
          } else {
            this.panelBtns[1] = PanelBarButton.ButtonGroundAnalysis;
          }
          break;
        }
        default:
          NOT_REACHED();
          break;
      }
    }
    this.setRedraw();
  }

  // timer_handler_t
  onTimerFired(id: number): void {
    this.blinkTrigger = !this.blinkTrigger;
    this.setRedraw();
  }
}
