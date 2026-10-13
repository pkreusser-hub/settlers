// The messages of the game as a window of the page: the HTML form of the
// canvas NotificationBox (notification.ts). Not part of Freeserf.
//
// The interface still decides everything: Interface.openMessage() takes the
// next message of the player, moves the map to its place, sets the return
// arrow of the panel and hands the message to this window
// (Interface.messageHook). The window shows the text, the picture of the
// canvas box (face, building or icon), and buttons for what the panel does:
// the next message, back to where the map was. It keeps the messages that
// were read, so that their places can be found again.

import './messages.css';

import { Asset } from '../../data/data';
import { BuildingType } from '../../game/building';
import type { Game } from '../../game/game';
import type { MapPos } from '../../game/map';
import { BIT_TEST } from '../../game/misc';
import { Message, MessageType } from '../../game/player';
import type { Interface } from '../interface';
import { mapBuildingSprite } from '../interface';
import {
  NOTIFICATION_SHOW_BUILDING,
  NOTIFICATION_SHOW_ICON,
  NOTIFICATION_SHOW_MAP_OBJECT,
  NOTIFICATION_SHOW_MENU,
  NOTIFICATION_SHOW_MINE,
  NOTIFICATION_SHOW_OPPONENT,
  notificationViews,
} from '../notification';
import { buildingName } from '../production';
import { MenuWindow } from './kit';
import { characterName, playerColorName } from './start';
import { assetCanvas, button, el, faceCanvas, iconCanvas } from './widgets';

/* The texts of notification.ts as sentences, with a title each. */
const texts: { [type: number]: { title: string; text: string } } = {
  [MessageType.TypeUnderAttack]: { title: 'Under attack', text: 'Your settlement is under attack.' },
  [MessageType.TypeLoseFight]: { title: 'Fight lost', text: 'Your knights lost the fight here.' },
  [MessageType.TypeWinFight]: { title: 'Victory', text: 'You won the fight here.' },
  [MessageType.TypeMineEmpty]: { title: 'Mine empty', text: 'This mine yields no more raw materials.' },
  [MessageType.TypeCallToLocation]: { title: 'Timer', text: 'You asked to be called to this place.' },
  [MessageType.TypeKnightOccupied]: { title: 'Building occupied', text: 'A knight has moved into this new building.' },
  [MessageType.TypeNewStock]: { title: 'New stock', text: 'A new stock is built.' },
  [MessageType.TypeLostLand]: { title: 'Land lost', text: 'You lost land to this enemy building.' },
  [MessageType.TypeLostBuildings]: {
    title: 'Land and buildings lost',
    text: 'You lost land and buildings to this enemy building.',
  },
  [MessageType.TypeEmergencyActive]: { title: 'Emergency program', text: 'The emergency program is active.' },
  [MessageType.TypeEmergencyNeutral]: { title: 'Emergency program', text: 'The emergency program has ended.' },
  [MessageType.TypeFoundGold]: { title: 'Gold found', text: 'A geologist has found gold.' },
  [MessageType.TypeFoundIron]: { title: 'Iron found', text: 'A geologist has found iron.' },
  [MessageType.TypeFoundCoal]: { title: 'Coal found', text: 'A geologist has found coal.' },
  [MessageType.TypeFoundStone]: { title: 'Stone found', text: 'A geologist has found stone.' },
  [MessageType.TypeCallToMenu]: { title: 'Reminder', text: 'You asked to be called to this menu.' },
  [MessageType.Type30MSinceSave]: { title: 'Save your game', text: '30 minutes have passed since you last saved.' },
  [MessageType.Type1HSinceSave]: { title: 'Save your game', text: 'One hour has passed since you last saved.' },
  [MessageType.TypeCallToStock]: { title: 'Timer', text: 'You asked to be called to this stock.' },
};

/* The messages with a place on the map: the ones Interface.openMessage()
   moves the map for. */
export function messageHasPlace(type: MessageType): boolean {
  return BIT_TEST(0x8f3fe, type) !== 0;
}

export function messageText(type: MessageType): { title: string; text: string } {
  return texts[type] ?? { title: 'Message', text: '' };
}

/* The pictures of the menus a message can call to
   (NotificationBox.drawNotification). */
const mapMenuSprite = [0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0x12a, 0x12b];

/* The picture of the canvas box and what it shows in words. */
function messagePicture(iface: Interface, message: Message): { picture: HTMLElement | null; caption: string } {
  const view = notificationViews().find((v) => v.type === message.type && v.type !== MessageType.TypeNone);
  const game = iface.getGame();
  if (view === undefined || !game) return { picture: null, caption: '' };
  const own = iface.getPlayer()?.getColor();

  switch (view.decoration) {
    case NOTIFICATION_SHOW_OPPONENT: {
      const other = game.getPlayer(message.data);
      if (other === null) return { picture: null, caption: '' };
      return {
        picture: faceCanvas(other.getFace(), other.getColor()),
        caption: `${playerColorName(message.data)}, ${characterName(other.getFace())}`,
      };
    }
    case NOTIFICATION_SHOW_MINE:
      return {
        picture: assetCanvas(Asset.MapObject, mapBuildingSprite[BuildingType.TypeStoneMine] + message.data, own),
        caption: buildingName((BuildingType.TypeStoneMine + message.data) as BuildingType),
      };
    case NOTIFICATION_SHOW_BUILDING: {
      const types = [BuildingType.TypeHut, BuildingType.TypeTower, BuildingType.TypeFortress];
      const type = types[message.data];
      if (type === undefined) return { picture: null, caption: '' };
      return {
        picture: assetCanvas(Asset.MapObject, mapBuildingSprite[type], own),
        caption: buildingName(type),
      };
    }
    case NOTIFICATION_SHOW_MAP_OBJECT: {
      let caption = '';
      if (message.type === MessageType.TypeNewStock || message.type === MessageType.TypeCallToStock) {
        caption = buildingName(BuildingType.TypeStock);
      } else if (
        message.type === MessageType.TypeEmergencyActive ||
        message.type === MessageType.TypeEmergencyNeutral
      ) {
        caption = buildingName(BuildingType.TypeCastle);
      }
      return { picture: assetCanvas(Asset.MapObject, view.icon, own), caption };
    }
    case NOTIFICATION_SHOW_ICON:
      return { picture: iconCanvas(view.icon), caption: '' };
    case NOTIFICATION_SHOW_MENU: {
      const sprite = mapMenuSprite[message.data];
      return { picture: sprite !== undefined ? iconCanvas(sprite) : null, caption: '' };
    }
    default:
      return { picture: null, caption: '' };
  }
}

/* The keys a control of the window uses itself (as the windows of kit.ts):
   they do not go on to the game. */
const ownKeys = new Set([
  'Tab', 'Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Home', 'End', 'PageUp', 'PageDown',
]);

/* How many read messages are kept. */
const LOG_LENGTH = 30;

class MessageWindow {
  protected win: MenuWindow | null = null;
  protected timer = 0;
  protected game: Game | null = null;
  protected current: Message | null = null;
  /* The messages read before the one that is shown, the newest first. */
  protected log: Message[] = [];
  protected logOpen = false;

  protected nextButton: HTMLButtonElement | null = null;
  protected backButton: HTMLButtonElement | null = null;
  protected closeButton: HTMLButtonElement | null = null;

  constructor(protected iface: Interface) {}

  isOpen(): boolean {
    return this.win !== null;
  }

  /* Interface.messageHook.show(). */
  show(message: Message): boolean {
    const game = this.iface.getGame();
    if (!game || this.iface.getPlayer() === null) return false;
    if (game !== this.game) {
      /* The messages of another game. */
      this.game = game;
      this.log = [];
      this.current = null;
    }
    if (this.current !== null) this.remember(this.current);
    /* The interface drops the message: keep a copy. */
    const copy = new Message();
    copy.type = message.type;
    copy.pos = message.pos;
    copy.data = message.data;
    this.current = copy;
    this.render();
    return true;
  }

  /* Interface.messageHook.close(). */
  close(): void {
    const win = this.win;
    if (win === null) return;
    window.clearInterval(this.timer);
    this.timer = 0;
    const hadFocus = win.root.contains(document.activeElement);
    win.disposeWidgets();
    win.root.remove();
    this.win = null;
    if (this.current !== null) this.remember(this.current);
    this.current = null;
    /* The keys go to the game again. */
    if (hadFocus && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  protected remember(message: Message): void {
    this.log.unshift(message);
    if (this.log.length > LOG_LENGTH) this.log.length = LOG_LENGTH;
  }

  protected goTo(pos: MapPos): void {
    /* As Interface.openMessage() does for the message. */
    this.iface.getViewport()?.moveToMapPos(pos);
    this.iface.updateMapCursorPos(pos);
  }

  protected render(): void {
    const message = this.current;
    if (message === null) return;
    const iface = this.iface;
    const words = messageText(message.type);

    const old = this.win;
    const win = new MenuWindow(words.title, () => iface.closeMessage());
    win.root.classList.add('ms-win');
    win.setSize('narrow');
    win.setPattern('green');

    const row = el('div', 'ms-message');
    const { picture, caption } = messagePicture(iface, message);
    if (picture !== null) {
      const figure = el('div', 'ms-picture');
      figure.append(picture);
      if (caption !== '') figure.append(el('span', 'ms-caption', caption));
      row.append(figure);
    }
    const text = el('p', 'ms-text', words.text);
    text.setAttribute('role', 'status');
    row.append(text);
    win.add(row);

    if (this.log.length > 0) {
      const details = el('details', 'ms-log');
      details.open = this.logOpen;
      details.addEventListener('toggle', () => { this.logOpen = details.open; });
      details.append(el('summary', 'ms-log-title', `Earlier messages (${this.log.length})`));
      const list = el('ul', 'ms-log-list');
      for (const entry of this.log) {
        const item = el('li', 'ms-log-item');
        item.append(el('span', 'ms-log-text', messageText(entry.type).text));
        if (messageHasPlace(entry.type)) {
          const go = button('Go there', () => this.goTo(entry.pos), { kind: 'quiet' });
          go.setAttribute('aria-label', `Go there: ${messageText(entry.type).text}`);
          item.append(go);
        }
        list.append(item);
      }
      details.append(list);
      win.add(details);
    }

    const foot = win.foot();
    if (messageHasPlace(message.type)) {
      foot.append(button('Go there', () => this.goTo(message.pos), {
        title: 'Move the map to the place of this message',
      }));
    }
    this.backButton = button('Go back', () => {
      iface.returnFromMessage();
      iface.closeMessage();
    }, { title: 'Move the map back to where it was before the messages (Shift+Tab)' });
    this.nextButton = button('Next message', () => iface.openMessage(), { title: 'Show the next message (Tab)' });
    this.closeButton = button('Close', () => iface.closeMessage(), { kind: 'primary' });
    foot.append(this.backButton, this.nextButton, this.closeButton);

    win.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        iface.closeMessage();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (ownKeys.has(e.key)) e.stopPropagation();
    });

    if (old !== null) {
      old.disposeWidgets();
      old.root.replaceWith(win.root);
    } else {
      document.body.append(win.root);
      this.timer = window.setInterval(() => this.update(), 250);
    }
    this.win = win;
    this.update();
    const player = iface.getPlayer();
    const more = player !== null && player.hasNotification();
    (more ? this.nextButton : this.closeButton).focus({ preventScroll: true });
  }

  /* On the timer: the buttons follow the game, and the window goes with
     its game. */
  protected update(): void {
    const player = this.iface.getPlayer();
    if (this.iface.getGame() !== this.game || player === null || this.iface.isGameInitOpen()) {
      this.iface.closeMessage();
      return;
    }
    const next = this.nextButton;
    const back = this.backButton;
    if (next === null || back === null) return;
    const more = player.hasNotification();
    if (next.disabled === more) {
      const focused = document.activeElement === next;
      next.disabled = !more;
      if (focused && !more) this.closeButton?.focus({ preventScroll: true });
    }
    const arrow = this.iface.hasReturnArrow();
    if (back.disabled === arrow) {
      const focused = document.activeElement === back;
      back.disabled = !arrow;
      if (focused && !arrow) this.closeButton?.focus({ preventScroll: true });
    }
  }
}

/* Make the messages of the game open as a window of the page. */
export function installMessages(iface: Interface): void {
  const box = new MessageWindow(iface);
  iface.messageHook = {
    show: (message) => box.show(message),
    close: () => box.close(),
    isOpen: () => box.isOpen(),
  };
}
