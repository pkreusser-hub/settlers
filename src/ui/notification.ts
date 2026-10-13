// notification.h + notification.cc - Notification GUI component

import { BuildingType } from '../game/building';
import { NOT_REACHED } from '../game/misc';
import { Message, MessageType } from '../game/player';
import { Data } from './data-instance';
import type { Frame } from './gfx';
import { Color } from './gfx';
import { GuiObject } from './gui';
import type { Interface } from './interface';
import { mapBuildingSprite } from './interface';
import { _, N_ } from './translation';

// NotificationBox::NotificationView
export interface NotificationBoxNotificationView {
  type: MessageType;
  decoration: number;
  icon: number;
  text: string | null;
}

export const NOTIFICATION_SHOW_OPPONENT = 0;
export const NOTIFICATION_SHOW_MINE = 1;
export const NOTIFICATION_SHOW_BUILDING = 2;
export const NOTIFICATION_SHOW_MAP_OBJECT = 3;
export const NOTIFICATION_SHOW_ICON = 4;
export const NOTIFICATION_SHOW_MENU = 5;

// PORT: a file-level table in the C++. It reads map_building_sprite of
// interface.h, and interface.ts imports this module, so the table is built
// at the first call instead of at module load.
let notificationViewsTable: NotificationBoxNotificationView[] | null = null;

export function notificationViews(): NotificationBoxNotificationView[] {
  if (notificationViewsTable === null) {
    notificationViewsTable = [
      { type: MessageType.TypeUnderAttack,
        decoration: NOTIFICATION_SHOW_OPPONENT,
        icon: 0,
        text: N_('Your settlement\nis under attack') },
      { type: MessageType.TypeLoseFight,
        decoration: NOTIFICATION_SHOW_OPPONENT,
        icon: 0,
        text: N_('Your knights\njust lost the\nfight') },
      { type: MessageType.TypeWinFight,
        decoration: NOTIFICATION_SHOW_OPPONENT,
        icon: 0,
        text: N_('You gained\na victory here') },
      { type: MessageType.TypeMineEmpty,
        decoration: NOTIFICATION_SHOW_MINE,
        icon: 0,
        text: N_('This mine hauls\nno more raw\nmaterials') },
      { type: MessageType.TypeCallToLocation,
        decoration: NOTIFICATION_SHOW_MAP_OBJECT,
        icon: 0x90,
        text: N_('You wanted me\nto call you to\nthis location') },
      { type: MessageType.TypeKnightOccupied,
        decoration: NOTIFICATION_SHOW_BUILDING,
        icon: 0,
        text: N_('A knight has\noccupied this\nnew building') },
      { type: MessageType.TypeNewStock,
        decoration: NOTIFICATION_SHOW_MAP_OBJECT,
        icon: mapBuildingSprite[BuildingType.TypeStock],
        text: N_('A new stock\nhas been built') },
      { type: MessageType.TypeLostLand,
        decoration: NOTIFICATION_SHOW_OPPONENT,
        icon: 0,
        text: N_('Because of this\nenemy building\nyou lost some\nland') },
      { type: MessageType.TypeLostBuildings,
        decoration: NOTIFICATION_SHOW_OPPONENT,
        icon: 0,
        text: N_('Because of this\nenemy building\nyou lost some\n' +
                 'land and\nsome buildings') },
      { type: MessageType.TypeEmergencyActive,
        decoration: NOTIFICATION_SHOW_MAP_OBJECT,
        icon: mapBuildingSprite[BuildingType.TypeCastle] + 1,
        text: N_('Emergency\nprogram\nactivated') },
      { type: MessageType.TypeEmergencyNeutral,
        decoration: NOTIFICATION_SHOW_MAP_OBJECT,
        icon: mapBuildingSprite[BuildingType.TypeCastle],
        text: N_('Emergency\nprogram\nneutralized') },
      { type: MessageType.TypeFoundGold,
        decoration: NOTIFICATION_SHOW_ICON,
        icon: 0x2f,
        text: N_('A geologist\nhas found gold') },
      { type: MessageType.TypeFoundIron,
        decoration: NOTIFICATION_SHOW_ICON,
        icon: 0x2c,
        text: N_('A geologist\nhas found iron') },
      { type: MessageType.TypeFoundCoal,
        decoration: NOTIFICATION_SHOW_ICON,
        icon: 0x2e,
        text: N_('A geologist\nhas found coal') },
      { type: MessageType.TypeFoundStone,
        decoration: NOTIFICATION_SHOW_ICON,
        icon: 0x2b,
        text: N_('A geologist\nhas found stone') },
      { type: MessageType.TypeCallToMenu,
        decoration: NOTIFICATION_SHOW_MENU,
        icon: 0,
        text: N_('You wanted me\nto call you\nto this menu') },
      { type: MessageType.Type30MSinceSave,
        decoration: NOTIFICATION_SHOW_ICON,
        icon: 0x5d,
        text: N_('30 min. passed\nsince the last\nsaving') },
      { type: MessageType.Type1HSinceSave,
        decoration: NOTIFICATION_SHOW_ICON,
        icon: 0x5d,
        text: N_('One hour passed\nsince the last\nsaving') },
      { type: MessageType.TypeCallToStock,
        decoration: NOTIFICATION_SHOW_MAP_OBJECT,
        icon: mapBuildingSprite[BuildingType.TypeStock],
        text: N_('You wanted me\nto call you\nto this stock') },
      // EXT: an upgrade in place is done.
      { type: MessageType.TypeUpgradeDone,
        decoration: NOTIFICATION_SHOW_BUILDING,
        icon: 0,
        text: N_('The upgrade\nof this building\nis done') },
      { type: MessageType.TypeNone, decoration: 0, icon: 0, text: null },
    ];
  }
  return notificationViewsTable;
}

export class NotificationBox extends GuiObject {
  protected message: Message;
  // PORT: `interface` is the field name of the C++; the constructor
  // parameter is _interface as there.
  protected interface: Interface;

  protected drawIcon(ix: number, iy: number, sprite: number): void {
    (this.frame as Frame).drawSprite(8 * ix, iy, Data.Resource.AssetIcon, sprite);
  }

  protected drawBackground(bwidth: number, bheight: number, sprite: number): void {
    for (let sy = 0; sy < bheight; sy += 16) {
      for (let sx = 0; sx < bwidth; sx += 16) {
        (this.frame as Frame).drawSprite(sx, sy, Data.Resource.AssetIcon, sprite);
      }
    }
  }

  protected drawString(sx: number, sy: number, str: string): void {
    // PORT: std::getline over a stringstream: the lines between '\n',
    // without an empty line after a '\n' at the end.
    const lines = str.split('\n');
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }
    let cy = sy;
    for (const line of lines) {
      /* On the green background, with a shadow as in the advanced box. */
      (this.frame as Frame).drawString(sx * 8, cy, line, Color.green, Color.black);
      cy += 10;
    }
  }

  protected drawMapObject(ox: number, oy: number, sprite: number): void {
    (this.frame as Frame).drawSprite(8 * ox, oy, Data.Resource.AssetMapObject, sprite);
  }

  protected getPlayerFaceSprite(face: number): number {
    if (face !== 0) {
      return (0x10b + face) >>> 0;
    }
    return 0x119; /* sprite_face_none */
  }

  protected drawPlayerFace(fx: number, fy: number, player: number): void {
    const p = this.interface.getGame()!.getPlayer(player)!;
    const color = this.interface.getPlayerColor(player);
    (this.frame as Frame).fillRect(8 * fx, fy, 48, 72, color);
    this.drawIcon(fx + 1, fy + 4, this.getPlayerFaceSprite(p.getFace()));
  }

  /* Messages boxes */
  protected drawNotification(view: NotificationBoxNotificationView): void {
    const mapMenuSprite = [
      0xe6, 0xe7, 0xe8, 0xe9,
      0xea, 0xeb, 0x12a, 0x12b,
    ];

    // PORT: text is NULL only in the last entry of the table, which is
    // never drawn.
    this.drawString(1, 10, _(view.text as string));
    switch (view.decoration) {
      case NOTIFICATION_SHOW_OPPONENT:
        this.drawPlayerFace(18, 8, this.message.data);
        break;
      case NOTIFICATION_SHOW_MINE:
        this.drawMapObject(18, 8, mapBuildingSprite[BuildingType.TypeStoneMine] +
                                  this.message.data);
        break;
      case NOTIFICATION_SHOW_BUILDING:
        switch (this.message.data) {
          case 0:
            this.drawMapObject(18, 8, mapBuildingSprite[BuildingType.TypeHut]);
            break;
          case 1:
            this.drawMapObject(18, 8, mapBuildingSprite[BuildingType.TypeTower]);
            break;
          case 2:
            this.drawMapObject(16, 8, mapBuildingSprite[BuildingType.TypeFortress]);
            break;
          default:
            NOT_REACHED();
            break;
        }
        break;
      case NOTIFICATION_SHOW_MAP_OBJECT:
        this.drawMapObject(16, 8, view.icon);
        break;
      case NOTIFICATION_SHOW_ICON:
        this.drawIcon(20, 14, view.icon);
        break;
      case NOTIFICATION_SHOW_MENU:
        this.drawIcon(18, 8, mapMenuSprite[this.message.data]);
        break;
      default:
        break;
    }
  }

  protected override internalDraw(): void {
    this.drawBackground(this.width, this.height, 0x13a);
    this.drawIcon(14, 128, 0x120); /* Checkbox */

    const views = notificationViews();
    for (let i = 0; views[i].type !== MessageType.TypeNone; i++) {
      if (views[i].type === this.message.type) {
        this.drawNotification(views[i]);
      }
    }
  }

  protected override handleClickLeft(x: number, y: number): boolean {
    this.setDisplayed(false);
    return true;
  }

  constructor(_interface: Interface) {
    super();
    this.message = new Message();
    this.interface = _interface;
  }

  show(_message: Message): void {
    // PORT: the C++ copies the message.
    this.message = new Message();
    this.message.type = _message.type;
    this.message.pos = _message.pos;
    this.message.data = _message.data;
    this.setDisplayed(true);
  }
}
