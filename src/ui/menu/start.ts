// The start screen of the page and the boxes around a game: the opening
// menu (new game, missions, tutorials, load, online, options), the end of a
// game and the orders of a tutorial. The game setup window is setup.ts, the
// messages are messages.ts. Not part of Freeserf.
//
// The start screen takes the place of the canvas GameInitBox
// (Interface.gameInitHook) and of the lobby overlay that lay over it. The
// lobby (net/lobby.ts) makes it and shows its own pages in it: the room of
// a host, the code field of a guest.
//
// One switch turns the HTML versions off: htmlMenus(). With `?canvasmenus`
// in the address of the page the canvas GameInitBox and NotificationBox are
// back, and the start screen only offers what the lobby did before.

import './start.css';

import { Asset } from '../../data/data';
import { GameGameType } from '../../game/game';
import type { GameManager } from '../../game/game-manager';
import { characters, defColor, GameInfo } from '../../game/mission';
import { GameStore } from '../../game/savegame';
import { hasCommandSink } from '../../net/command';
import { cmdSetPaused } from '../../net/commands';
import { AudioTypeSfx } from '../audio';
import { FREESERF_VERSION } from '../game-init';
import type { OnlineHostHooks } from '../game-init';
import type { Interface } from '../interface';
import { PopupBoxType } from '../popup';
import { openSavesPanel } from '../saves-panel';
import { MenuWindow, registerBox } from './kit';
import type { BoxContext, BoxView, Widget, WindowPattern, WindowSize } from './kit';
import { installMessages } from './messages';
import { setupPage } from './setup';
import type { SetupHandle, SetupMode } from './setup';
import { assetCanvas, button, el, faceCanvas, fitHeight, iconCanvas } from './widgets';

const SOURCE_URL = 'https://github.com/pkreusser-hub/settlers';

/* The switch between the HTML start screen, setup and messages (true) and
   the canvas GameInitBox and NotificationBox (false). */
export function htmlMenus(): boolean {
  if (typeof location === 'undefined') return true;
  return !/[?&]canvasmenus\b/.test(location.search);
}

// ---------------------------------------------------------------------------
// Names.

/* The colours of the players by their place (mission.ts defColor), as the
   end of the game names them. */
const colorNames = ['Blue', 'Red', 'Violet', 'Yellow'];

export function playerColorName(index: number): string {
  return colorNames[index & 3];
}

/* The name the game data gives a face: "Lady Amalie", "You", "Friend". */
export function characterName(face: number): string {
  const character = face >= 1 && face < characters.length ? characters[face] : null;
  return character !== null ? character.name : 'Nobody';
}

/* The goals of the tutorials, the ones the game checks (popup.ts
   drawTutorialOrdersBox). */
export const tutorialOrders = [
  'Build a guard hut, a guard tower and a fortress.',
  'Produce five planks and five stones.',
  'Produce five fish, five meat and five bread.',
  'Smelt five steel bars and five gold bars.',
  'Make ten weapons and ten tools.',
  'Conquer all the land of the enemy.',
];

// ---------------------------------------------------------------------------
// Small widgets of the start screen (the kit has no text field and no list).

let nextId = 1;
function newId(prefix: string): string {
  return `so-${prefix}-${nextId++}`;
}

export function para(text: string, className = 'so-text'): HTMLParagraphElement {
  return el('p', className, text);
}

/* A line that a screen reader reads when it changes: a status or an error.
   It takes no room while it is empty. */
export function messageLine(kind: 'status' | 'error', text = ''): HTMLParagraphElement {
  const line = el('p', kind === 'error' ? 'so-error' : 'so-status', text);
  line.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  return line;
}

export interface TextFieldOptions {
  label: string;
  value?: string;
  maxLength: number;
  /* Wide letters apart, for a code. */
  code?: boolean;
  /* Only these characters are taken. */
  allow?: RegExp;
  inputMode?: 'text' | 'numeric';
  onInput?(value: string): void;
  onEnter?(): void;
}

/* A labelled text field. */
export function textField(options: TextFieldOptions): Widget & { input: HTMLInputElement } {
  const root = el('div', 'so-field');
  const id = newId('in');
  const label = el('label', 'so-label', options.label);
  label.htmlFor = id;
  const input = el('input', options.code === true ? 'so-input so-input-code' : 'so-input');
  input.id = id;
  input.type = 'text';
  input.maxLength = options.maxLength;
  input.autocomplete = 'off';
  input.spellcheck = false;
  if (options.inputMode !== undefined) input.inputMode = options.inputMode;
  input.value = options.value ?? '';
  input.addEventListener('input', () => {
    if (options.allow !== undefined) {
      const kept = Array.from(input.value).filter((c) => options.allow!.test(c)).join('');
      if (kept !== input.value) input.value = kept;
    }
    options.onInput?.(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && options.onEnter !== undefined) {
      e.preventDefault();
      options.onEnter();
    }
  });
  root.append(label, input);
  return { el: root, input };
}

export interface ListItem {
  label: string;
  detail?: string;
}

export interface ListBoxOptions {
  label: string;
  items: ListItem[];
  get(): number;
  set(index: number): void;
}

/* One of a list: the arrows move the choice, as in a list box. The choice
   has a mark, not only a colour. */
export function listBox(options: ListBoxOptions): Widget {
  const root = el('ul', 'so-list');
  root.setAttribute('role', 'listbox');
  root.setAttribute('aria-label', options.label);
  const rows = options.items.map((item, i) => {
    const row = el('li', 'so-option');
    row.setAttribute('role', 'option');
    row.append(el('span', 'so-option-mark'), el('span', 'so-option-label', item.label));
    if (item.detail !== undefined) row.append(el('span', 'so-option-detail', item.detail));
    row.addEventListener('click', () => {
      options.set(i);
      update();
      row.focus({ preventScroll: true });
    });
    root.append(row);
    return row;
  });

  root.addEventListener('keydown', (e) => {
    const at = rows.indexOf(document.activeElement as HTMLLIElement);
    if (at < 0) return;
    let next = -1;
    if (e.key === 'ArrowDown') next = Math.min(rows.length - 1, at + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, at - 1);
    else if (e.key === 'PageDown') next = Math.min(rows.length - 1, at + 8);
    else if (e.key === 'PageUp') next = Math.max(0, at - 8);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = rows.length - 1;
    if (next < 0) return;
    e.preventDefault();
    if (next === at) return;
    options.set(next);
    update();
    rows[next].focus();
  });

  let shown = -2;
  const update = (): void => {
    const at = options.get();
    if (at === shown) return;
    shown = at;
    rows.forEach((row, i) => {
      row.setAttribute('aria-selected', String(i === at));
      row.tabIndex = i === at || (at < 0 && i === 0) ? 0 : -1;
    });
    /* Only inside the list: the page does not move. */
    const row = rows[at];
    if (row !== undefined && root.clientHeight > 0) {
      const top = row.offsetTop - root.offsetTop;
      if (top < root.scrollTop) root.scrollTop = top;
      else if (top + row.offsetHeight > root.scrollTop + root.clientHeight) {
        root.scrollTop = top + row.offsetHeight - root.clientHeight;
      }
    }
  };
  update();
  return { el: root, update };
}

// ---------------------------------------------------------------------------
// The start screen.

/* What the lobby does for the menu. */
export interface StartActions {
  host(): void;
  join(): void;
  rejoin(code: string): void;
  /* The room this tab was in, when it can go back. */
  rejoinCode(): string | null;
}

/* One page of the start screen: a window of the kit, filled by build(). */
export interface StartPage {
  title: string;
  size?: WindowSize;
  pattern?: WindowPattern;
  /* Escape and the close button of the window. Without it the page has
     neither. */
  back?: () => void;
  /* Fill the window; the result is called when the page goes. */
  build(win: MenuWindow): void | (() => void);
}

export class StartScreen {
  /* The backdrop; hidden while no page is shown. */
  readonly root: HTMLDivElement;
  protected win: MenuWindow | null = null;
  protected page: StartPage | null = null;
  protected disposePage: (() => void) | null = null;
  protected timer = 0;
  /* A box of the game (the options) is open over the start screen. */
  protected suspended = false;
  protected watch = 0;
  protected resuming = false;
  protected html = htmlMenus();

  protected onWindowKey = (event: KeyboardEvent): void => {
    if (this.root.hidden || this.suspended) return;
    const target = event.target;
    if (target instanceof Element && target.closest('#lobby, .mk-win, .ov-backdrop') !== null) return;
    /* While the start screen is open the keys are not for the game behind
       it. */
    event.stopImmediatePropagation();
    if (event.key === 'Tab') {
      event.preventDefault();
      this.focusFirst();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.page?.back?.();
    }
  };

  constructor(
    protected iface: Interface,
    protected gameManager: GameManager,
    protected actions: StartActions,
  ) {
    this.root = el('div', 'gx so-backdrop');
    this.root.id = 'lobby';
    this.root.hidden = true;
    /* Keys typed in the start screen stay in it. */
    this.root.addEventListener('keydown', (e) => this.handleKey(e));
    this.root.addEventListener('keyup', (e) => e.stopPropagation());
    document.body.append(this.root);
    window.addEventListener('keydown', this.onWindowKey, true);

    if (this.html) {
      iface.gameInitHook = {
        open: (load) => {
          /* Back from the options: the menu is still there. */
          if (!this.resuming) this.showMenu();
          if (load) openSavesPanel(this.iface, this.gameManager);
          return true;
        },
        close: () => this.hide(),
        isOpen: () => this.isOpen() && !this.suspended,
        isActive: () => this.isOpen() || this.suspended,
      };
      installMessages(iface);
      /* main.ts opened the canvas box before the hook was there. */
      if (iface.isGameInitOpen()) iface.closeGameInit();
      iface.openGameInit();
    } else {
      this.showMenu();
    }
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  /* The HTML setup is in use (not the canvas game init box). */
  usesHtmlSetup(): boolean {
    return this.html;
  }

  /* Show a page in place of the one that is shown. */
  show(page: StartPage): MenuWindow {
    this.dropPage();
    const win = new MenuWindow(page.title, () => page.back?.());
    win.root.classList.add('so-win');
    win.root.setAttribute('aria-modal', 'true');
    win.setSize(page.size ?? 'normal');
    win.setPattern(page.pattern ?? 'green');
    if (page.back === undefined) {
      const close = win.getHead().querySelector<HTMLElement>('.mk-close');
      if (close !== null) close.hidden = true;
    }
    this.win = win;
    this.page = page;
    this.disposePage = page.build(win) ?? null;

    this.root.replaceChildren(win.root);
    this.root.hidden = false;
    this.root.scrollTop = 0;
    document.body.classList.add('so-open');
    win.updateWidgets();
    this.timer = window.setInterval(() => win.updateWidgets(), 250);
    (win.initialFocus ?? win.firstFocusable())?.focus({ preventScroll: true });
    return win;
  }

  hide(): void {
    this.endSuspend();
    this.dropPage();
    if (this.root.hidden) return;
    const hadFocus = this.root.contains(document.activeElement);
    this.root.hidden = true;
    this.root.replaceChildren();
    document.body.classList.remove('so-open');
    /* The keys go to the game again. */
    if (hadFocus && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  protected dropPage(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    const dispose = this.disposePage;
    this.disposePage = null;
    dispose?.();
    this.win?.disposeWidgets();
    this.win = null;
    this.page = null;
  }

  protected focusable(): HTMLElement[] {
    if (this.win === null) return [];
    const selector =
      'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), ' +
      'select:not([disabled]), a[href], [tabindex="0"]';
    return Array.from(this.win.root.querySelectorAll<HTMLElement>(selector))
      .filter((node) => !node.hidden && node.closest('[hidden]') === null);
  }

  protected focusFirst(): void {
    const items = this.focusable();
    if (items.length > 0) items[0].focus();
  }

  protected handleKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') {
      if (this.page?.back !== undefined) {
        e.preventDefault();
        this.page.back();
      }
      return;
    }
    if (e.key !== 'Tab') return;
    /* Tab stays in the window. */
    const items = this.focusable();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = active instanceof Node && this.root.contains(active);
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  }

  // -------------------------------------------------------------------------
  // The opening menu.

  showMenu(error = ''): void {
    this.show(this.menuPage(error));
  }

  protected menuItem(
    label: string, text: string, icon: number | HTMLCanvasElement, action: () => void,
  ): HTMLButtonElement {
    const item = el('button', 'gx-btn mk-btn so-item');
    item.type = 'button';
    const picture = el('span', 'so-item-pic');
    const canvas = typeof icon === 'number' ? iconCanvas(icon) : icon;
    if (canvas.width > 1) picture.append(fitHeight(canvas, 2.4));
    const words = el('span', 'so-item-words');
    words.append(el('span', 'so-item-label', label), el('span', 'so-item-text', text));
    item.append(picture, words);
    item.addEventListener('click', action);
    return item;
  }

  protected menuPage(error: string): StartPage {
    return {
      title: 'The Settlers',
      back: () => this.closeMenu(),
      build: (win) => {
        const message = messageLine('error', error);
        const menu = el('div', 'so-menu');
        menu.setAttribute('role', 'group');
        menu.setAttribute('aria-label', 'Start');

        const solo = (mode: SetupMode): void => {
          this.showSetup(mode, null);
        };
        const items: HTMLButtonElement[] = [];

        if (this.html) {
          const last = this.newestSave();
          if (last !== null && !hasCommandSink()) {
            items.push(this.menuItem('Continue', `Load "${last.name}", your newest saved game.`, 316, () => {
              if (this.gameManager.loadGame(last.path)) {
                this.iface.closeGameInit();
              } else {
                message.textContent = 'Could not load this save.';
              }
            }));
          }
          items.push(
            this.menuItem('New game', 'Choose a map and play against computer players.', 263,
              () => solo('custom')),
            this.menuItem('Missions', `${GameInfo.getMissionCount()} maps with set opponents, from easy to hard.`, 260,
              () => solo('mission')),
            this.menuItem('Tutorials', `${GameInfo.getTutorialCount()} short games with one task each.`, 261,
              () => solo('tutorial')),
            this.menuItem('Load game', 'Load, download or import a saved game.', 316,
              () => openSavesPanel(this.iface, this.gameManager)),
          );
        } else {
          /* The canvas game init box is under the start screen. */
          items.push(this.menuItem('Play solo', 'Set up a game, a mission or a tutorial.', 263,
            () => this.hide()));
        }

        items.push(
          this.menuItem('Host online game', 'Open a room for up to three other players.', faceCanvas(12, defColor[0]),
            () => this.actions.host()),
          this.menuItem('Join online game', 'Enter the code a host gave you.', faceCanvas(13, defColor[1]),
            () => this.actions.join()),
        );
        /* This tab was in an online game (it was reloaded, or lost the
           host). */
        const code = this.actions.rejoinCode();
        if (code !== null) {
          items.push(this.menuItem(`Rejoin game ${code}`, 'Go back into the online game you were in.', faceCanvas(13, defColor[1]),
            () => this.actions.rejoin(code)));
        }
        if (this.html) {
          items.push(this.menuItem('Options', 'Sound, music and messages.', 267,
            () => this.openOptions()));
        }
        menu.append(...items);

        /* Up and down move between the entries. */
        menu.addEventListener('keydown', (e) => {
          const at = items.indexOf(document.activeElement as HTMLButtonElement);
          if (at < 0) return;
          let next = -1;
          if (e.key === 'ArrowDown') next = (at + 1) % items.length;
          else if (e.key === 'ArrowUp') next = (at + items.length - 1) % items.length;
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = items.length - 1;
          if (next < 0) return;
          e.preventDefault();
          items[next].focus();
        });

        const source = para(`A port of Freeserf ${FREESERF_VERSION}, under the GPL. `, 'so-small');
        const link = document.createElement('a');
        link.href = SOURCE_URL;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Source code';
        source.append(link);

        win.add(
          para('Play alone, or with up to three other players over the internet.'),
          menu,
          message,
          source,
        );
        if (this.html) {
          win.foot().append(button('Close this menu', () => this.closeMenu(), {
            kind: 'quiet',
            title: 'Go to the game that runs behind this menu (Esc)',
          }));
        }
      },
    };
  }

  protected closeMenu(): void {
    if (this.html) this.iface.closeGameInit();
    else this.hide();
  }

  protected newestSave(): { name: string; path: string } | null {
    let best: { name: string; path: string; time: number } | null = null;
    for (const entry of GameStore.getInstance().getSavedGamesByTime()) {
      if (best === null || entry.time > best.time) best = entry;
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // The game setup (setup.ts).

  /* Solo (online null): New game, Missions, Tutorials. For the host of an
     online game: a new game or a saved one for the people in the room. */
  showSetup(mode: SetupMode, online: OnlineHostHooks | null, note = ''): SetupHandle {
    const setup = setupPage({
      iface: this.iface,
      mode,
      online,
      note,
      back: online !== null ? () => online.cancel() : () => this.showMenu(),
    });
    this.show(setup.page);
    return setup.handle;
  }

  // -------------------------------------------------------------------------
  // A box of the game over the start screen.

  /* The options box of the game: a window of the page opens over the start
     screen, the canvas box needs the screen out of its way. The start
     screen is back when the box closes. */
  protected openOptions(): void {
    if (this.suspended) return;
    const opener = document.activeElement;
    this.suspended = true;
    this.iface.openPopup(PopupBoxType.TypeOptions);
    if (this.iface.getPopupBox() === null) {
      this.suspended = false;
      return;
    }
    if (this.iface.getHtmlBox() !== null) {
      if (this.win !== null) this.win.root.inert = true;
    } else {
      this.root.hidden = true;
    }
    this.watch = window.setInterval(() => {
      if (this.iface.getPopupBox() !== null) return;
      this.endSuspend();
      /* The panel and the map off again, as before the box. */
      this.resuming = true;
      this.iface.openGameInit();
      this.resuming = false;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
      else this.focusFirst();
    }, 150);
  }

  protected endSuspend(): void {
    if (!this.suspended) return;
    this.suspended = false;
    window.clearInterval(this.watch);
    this.watch = 0;
    if (this.win !== null) this.win.root.inert = false;
    if (this.win !== null) this.root.hidden = false;
  }
}

// ---------------------------------------------------------------------------
// TypeGameEnd.

/* The picture of the result, as getGameEndPicture() of popup.ts at stage 0:
   the player of the first place won, the second player won a two player
   game, lost. */
function resultPicture(type: number, winner: number): number {
  if (winner === 0) return 0;
  if (type === GameGameType.GameTypeTwoPlayers && winner === 1) return 1;
  return 2;
}

/* The picture of a won mission, as getGameEndPicture() at stage 2, or -1. */
function missionPicture(type: number, winner: number, level: number): number {
  const pictures = [
    -1, 3, -1, -1, 4, -1, -1, 5, -1, -1, 6, -1, -1, 7, -1, -1,
    8, -1, -1, 9, -1, -1, 10, -1, -1, 11, -1, -1, 12, -1, 13,
  ];
  const mission = level + 1;
  if (type !== GameGameType.GameTypeMission || winner !== 0 || mission < 1 || mission > 30) return -1;
  return pictures[mission];
}

/* The end of the game. The canvas box shows three things one after the
   other, a click each: the result picture, the winner with the text, the
   picture of a won mission. The window shows them together. "Continue" is
   the last click: the game goes on and asks whether to quit. */
function gameEndBox(ctx: BoxContext): BoxView {
  const { win, game } = ctx;
  win.setPattern('green');

  const type = game.getGameType();
  const winner = Math.max(0, game.getWinningPlayer());
  const winnerPlayer = game.getPlayer(winner);
  const color = playerColorName(winner);

  let title: string;
  const lines: string[] = [];
  switch (type) {
    case GameGameType.GameTypeMission:
      if (winner === 0) {
        title = 'Mission won';
        lines.push('Congratulations. Your enemies resign. You have won this mission.');
        /* The password is the name of the next mission. */
        const next = GameInfo.getMission(game.getMissionLevel() + 1);
        if (next !== null) lines.push(`Password of the next mission: ${next.getName()}`);
      } else {
        title = 'Mission lost';
        lines.push('One of your enemies has gained the upper hand in this mission.');
      }
      break;
    case GameGameType.GameTypeTutorial:
      title = 'Tutorial completed';
      lines.push('Well done. You completed this tutorial.');
      break;
    default:
      title = 'The game is over';
      lines.push(`The ${color.toLowerCase()} settlers have gained the upper hand.`);
      break;
  }
  win.setTitle(title);

  const pictures = el('div', 'so-end-pictures');
  /* No result picture in a demo game (PopupBox.show). */
  if (type !== GameGameType.GameTypeDemo) {
    const result = assetCanvas(Asset.ArtBox, resultPicture(type, winner));
    if (result.width > 1) pictures.append(result);
  }
  const mission = missionPicture(type, winner, game.getMissionLevel());
  if (mission >= 0) {
    const picture = assetCanvas(Asset.ArtBox, mission);
    if (picture.width > 1) pictures.append(picture);
  }
  if (pictures.childElementCount > 0) win.add(pictures);

  const result = el('div', 'so-end-result');
  if (winnerPlayer !== null) {
    result.append(faceCanvas(winnerPlayer.getFace(), winnerPlayer.getColor()));
  }
  const words = el('div', 'so-end-words');
  const who = winnerPlayer !== null ? characterName(winnerPlayer.getFace()) : '';
  words.append(el('p', 'so-end-winner', `Winner: ${color}${who !== '' ? `, ${who}` : ''}`));
  for (const line of lines) words.append(el('p', 'so-end-line', line));
  result.append(words);
  win.add(result);

  const go = button('Continue', () => {
    /* handleGameEndClick() of popup.ts after the last picture. */
    ctx.close();
    if (game.isPaused()) cmdSetPaused(game, false);
    ctx.open(PopupBoxType.TypeQuitConfirm);
  }, { kind: 'primary', title: 'The game goes on and asks whether to quit' });
  win.foot().append(go);
  win.initialFocus = go;
  return {};
}

// ---------------------------------------------------------------------------
// TypeTutorialOrders.

/* The task of the tutorial, shown when it starts. */
function tutorialOrdersBox(ctx: BoxContext): BoxView {
  const { win, game } = ctx;
  win.setPattern('green');
  win.setSize('narrow');
  const level = game.getTutorialLevel();
  if (level < 1 || level > tutorialOrders.length) {
    win.setTitle('Tutorial');
  } else {
    win.setTitle(`Tutorial ${level}`);
    win.add(el('h3', 'mk-section-title', 'Orders'), para(tutorialOrders[level - 1], 'so-orders'));
  }
  const go = button('Start', () => {
    ctx.sound(AudioTypeSfx.TypeSfxClick);
    ctx.close();
  }, { kind: 'primary' });
  win.foot().append(go);
  win.initialFocus = go;
  return {};
}

export function registerStartBoxes(): void {
  if (!htmlMenus()) return;
  registerBox(PopupBoxType.TypeGameEnd, gameEndBox);
  registerBox(PopupBoxType.TypeTutorialOrders, tutorialOrdersBox);
}
