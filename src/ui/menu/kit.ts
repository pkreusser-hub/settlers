// The menu kit of the page: the window that takes the place of a popup box
// of the game (popup.ts), and the registry that says which boxes open as
// such a window. Not part of Freeserf.
//
// A box port registers a factory for its PopupBoxType with registerBox().
// Interface.openPopup() asks the registry first (Interface.popupHook): a
// registered box opens as a window of the page, every other box opens as the
// canvas popup as before. The canvas popup asks too when it switches to
// another box (PopupBox.setBox), so a window opens from the select boxes
// that are still canvas.
//
// The rule for every port is in CLAUDE.md, "HTML menus": a menu only reads
// the game and changes it only through the cmd* functions of
// net/commands.ts.

import './theme.css';
import './kit.css';

import type { Game } from '../../game/game';
import type { GameManager } from '../../game/game-manager';
import { Log } from '../../game/misc';
import type { Player } from '../../game/player';
import type { AudioTypeSfx } from '../audio';
import type { HtmlBox, Interface } from '../interface';
import { blurActive, el } from '../overlay-dom';
import type { PopupBoxType } from '../popup';
import { applyGameTheme } from './theme';
import { iconCanvas } from './widgets';

/* A piece of a window: its element, and optionally what to do on the timer
   (read the game again and show it; must be cheap) and when the window
   closes. The widgets of widgets.ts are of this shape. */
export interface Widget {
  el: HTMLElement;
  update?(): void;
  dispose?(): void;
}

/* What a factory may return: the same two calls for the whole box. */
export interface BoxView {
  update?(): void;
  dispose?(): void;
}

/* The background of the title bar and the body: one of the patterns of the
   original boxes (theme.ts). */
export type WindowPattern = 'green' | 'brown' | 'build' | 'plain';
export type WindowSize = 'narrow' | 'normal' | 'wide';

export interface WindowTab {
  label: string;
  /* The box the tab opens (Interface.openPopup), or what it does. */
  box?: PopupBoxType;
  select?: () => void;
  icon?: HTMLElement;
  title?: string;
}

/* What a factory gets. */
export interface BoxContext {
  readonly iface: Interface;
  readonly gameManager: GameManager;
  /* The box that is being opened: one factory may serve several. */
  readonly box: PopupBoxType;
  /* The game and the player of this browser. The window closes by itself
     when either changes, so a factory may keep them. */
  readonly game: Game;
  readonly player: Player;
  readonly win: MenuWindow;
  /* Open another box in place of this one (a window or the canvas popup). */
  open(box: PopupBoxType): void;
  close(): void;
  /* The sounds of the original: click, accepted, not accepted. */
  sound(sfx: AudioTypeSfx): void;
}

export type BoxFactory = (ctx: BoxContext) => BoxView | void;

/* A box that is not a window of the kit (the build menu): asked like the
   hook of the interface, true when it took the box. fromCanvas: the canvas
   popup is switching to the box by itself. */
export type BoxOpener = (box: PopupBoxType, fromCanvas: boolean) => boolean;

type Entry =
  | { kind: 'window'; factory: BoxFactory }
  | { kind: 'opener'; open: BoxOpener };

const registry = new Map<number, Entry>();
const openingListeners: ((box: PopupBoxType, fromCanvas: boolean) => void)[] = [];

function register(type: PopupBoxType | PopupBoxType[], entry: Entry): void {
  for (const t of Array.isArray(type) ? type : [type]) {
    if (registry.has(t)) Log.Warn('menu', 'box registered twice: ', t);
    registry.set(t, entry);
  }
}

/* The box (or boxes) opens as a window of the page, built by the factory. */
export function registerBox(type: PopupBoxType | PopupBoxType[], factory: BoxFactory): void {
  register(type, { kind: 'window', factory });
}

export function registerOpener(type: PopupBoxType | PopupBoxType[], open: BoxOpener): void {
  register(type, { kind: 'opener', open });
}

/* Called before any box opens, registered or not. */
export function onBoxOpening(listener: (box: PopupBoxType, fromCanvas: boolean) => void): void {
  openingListeners.push(listener);
}

export function isBoxRegistered(type: PopupBoxType): boolean {
  return registry.has(type);
}

let nextId = 1;

/* The window: title bar with a close button, optional tabs, a body that
   scrolls and an optional footer. The registry makes it; a factory fills
   it through ctx.win. */
export class MenuWindow {
  readonly root: HTMLElement;
  /* Where the content goes. */
  readonly body: HTMLElement;
  protected head: HTMLElement;
  protected titleText: HTMLElement;
  protected tabBar: HTMLElement | null = null;
  protected footer: HTMLElement | null = null;
  protected widgets: Widget[] = [];
  /* What gets the focus when the window opens, if not the first control. */
  initialFocus: HTMLElement | null = null;

  constructor(title: string, protected requestClose: () => void) {
    const id = `mk-title-${nextId++}`;
    this.root = el('div', 'gx mk-win');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-labelledby', id);
    this.root.dataset.pattern = 'green';
    this.root.dataset.size = 'normal';

    this.head = el('div', 'mk-head');
    this.titleText = el('h2', 'mk-title', title);
    this.titleText.id = id;
    const close = el('button', 'mk-close');
    close.type = 'button';
    close.title = 'Close (Esc)';
    close.setAttribute('aria-label', 'Close');
    /* The exit icon of the boxes of the game; a plain cross without it. */
    const icon = iconCanvas(60);
    if (icon.width > 1) {
      close.append(icon);
    } else {
      close.textContent = '×';
    }
    close.addEventListener('click', () => this.requestClose());
    this.head.append(this.titleText, close);

    this.body = el('div', 'mk-body');
    this.root.append(this.head, this.body);
  }

  setTitle(text: string): void {
    this.titleText.textContent = text;
  }

  /* The pattern of the original box this one replaces. */
  setPattern(pattern: WindowPattern): void {
    this.root.dataset.pattern = pattern;
  }

  setSize(size: WindowSize): void {
    this.root.dataset.size = size;
  }

  getHead(): HTMLElement {
    return this.head;
  }

  /* Tabs under the title bar. `current` is the index of the tab that is
     shown. Left and right move between the tabs, Enter or Space opens one. */
  setTabs(tabs: WindowTab[], current: number, open: (box: PopupBoxType) => void): void {
    if (this.tabBar === null) {
      this.tabBar = el('div', 'mk-tabs');
      this.tabBar.setAttribute('role', 'tablist');
      this.head.after(this.tabBar);
    }
    const bar = this.tabBar;
    bar.textContent = '';
    const buttons: HTMLButtonElement[] = [];
    tabs.forEach((tab, i) => {
      const button = el('button', 'mk-tab');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(i === current));
      button.tabIndex = i === current ? 0 : -1;
      if (tab.title !== undefined) button.title = tab.title;
      if (tab.icon !== undefined) button.append(tab.icon);
      button.append(el('span', '', tab.label));
      button.addEventListener('click', () => {
        if (i === current) return;
        focusTabNext = true;
        if (tab.select !== undefined) tab.select();
        else if (tab.box !== undefined) open(tab.box);
      });
      buttons.push(button);
      bar.append(button);
    });
    bar.addEventListener('keydown', (e) => {
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (at < 0) return;
      let next = -1;
      if (e.key === 'ArrowRight') next = (at + 1) % buttons.length;
      else if (e.key === 'ArrowLeft') next = (at + buttons.length - 1) % buttons.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = buttons.length - 1;
      if (next < 0) return;
      buttons[next].focus();
      e.preventDefault();
    });
  }

  getSelectedTab(): HTMLElement | null {
    return this.tabBar?.querySelector<HTMLElement>('[aria-selected="true"]') ?? null;
  }

  /* The footer, made at the first call: buttons for the whole box (Default
     values, Back). */
  foot(): HTMLElement {
    if (this.footer === null) {
      this.footer = el('div', 'mk-foot');
      this.root.append(this.footer);
    }
    return this.footer;
  }

  /* Append widgets (or plain elements) to the body, or to `parent`. Their
     update() runs on the timer of the window, their dispose() when it
     closes. */
  add(...items: (Widget | HTMLElement)[]): void {
    this.addTo(this.body, ...items);
  }

  addTo(parent: HTMLElement, ...items: (Widget | HTMLElement)[]): void {
    for (const item of items) {
      if (item instanceof HTMLElement) {
        parent.append(item);
      } else {
        parent.append(item.el);
        this.track(item);
      }
    }
  }

  /* Have the window update and dispose a widget that is placed by hand. */
  track<T extends Widget>(widget: T): T {
    this.widgets.push(widget);
    return widget;
  }

  updateWidgets(): void {
    for (const widget of this.widgets) widget.update?.();
  }

  disposeWidgets(): void {
    for (const widget of this.widgets) widget.dispose?.();
    this.widgets = [];
  }

  /* The first control of the body (or of the window). */
  firstFocusable(): HTMLElement | null {
    /* Not the buttons a group keeps out of the tab order (a radio group
       has one stop, its choice). */
    const selector =
      'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), ' +
      'select:not([disabled]), [tabindex="0"]';
    return (
      this.body.querySelector<HTMLElement>(selector) ??
      this.footer?.querySelector<HTMLElement>(selector) ??
      this.root.querySelector<HTMLElement>(selector)
    );
  }
}

/* A tab of a window was used: the tab of the next window gets the focus. */
let focusTabNext = false;

/* The keys a control of a window uses itself: they do not go on to the
   game (the arrows would scroll the map, Tab would open a message). Every
   other key does, so the keys of the panel and of the game still work. */
const ownKeys = new Set([
  'Tab', 'Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Home', 'End', 'PageUp', 'PageDown',
]);

interface OpenWindow {
  box: PopupBoxType;
  win: MenuWindow;
  view: BoxView | null;
  game: Game;
  player: Player;
  timer: number;
  handle: HtmlBox;
}

/* The one place of the page where a box of the game is shown as a window.
   Opening another box replaces the one that is open, as openPopup() and
   closePopup() of the interface do with the canvas popup. */
export class Menus {
  protected current: OpenWindow | null = null;
  /* Where the player dragged the window to; null: the middle of the page. */
  protected position: { x: number; y: number } | null = null;
  /* What had the focus before the first window opened. */
  protected returnFocus: HTMLElement | null = null;

  constructor(protected iface: Interface, protected gameManager: GameManager) {
    iface.popupHook = (box, fromCanvas) => this.handlePopup(box as PopupBoxType, fromCanvas === true);
    window.addEventListener('resize', () => this.place());
  }

  getOpenBox(): PopupBoxType | null {
    return this.current?.box ?? null;
  }

  getWindow(): MenuWindow | null {
    return this.current?.win ?? null;
  }

  /* Run the timer of the open window now (the tests and a factory that
     wants its change shown at once). */
  refresh(): void {
    if (this.current !== null) this.tick(this.current);
  }

  /* Interface.popupHook. */
  protected handlePopup(box: PopupBoxType, fromCanvas: boolean): boolean {
    for (const listener of openingListeners) listener(box, fromCanvas);

    const entry = registry.get(box);
    if (entry === undefined) return false;

    if (entry.kind === 'opener') {
      if (!entry.open(box, fromCanvas)) return false;
      /* The opener shows the box itself: the window makes room. */
      if (this.current !== null) this.iface.closePopup();
      return true;
    }

    const game = this.iface.getGame();
    const player = this.iface.getPlayer();
    if (!game || player === null || this.iface.isGameInitOpen()) return false;

    return this.openWindow(box, entry.factory, game, player);
  }

  protected openWindow(box: PopupBoxType, factory: BoxFactory, game: Game, player: Player): boolean {
    const win = new MenuWindow('', () => this.iface.closePopup());
    const ctx: BoxContext = {
      iface: this.iface,
      gameManager: this.gameManager,
      box,
      game,
      player,
      win,
      open: (other) => this.iface.openPopup(other),
      close: () => this.iface.closePopup(),
      sound: (sfx) => this.iface.playSound(sfx),
    };

    let view: BoxView | null;
    try {
      view = factory(ctx) ?? null;
    } catch (err) {
      /* The canvas box is still there: it opens instead. */
      Log.Error('menu', 'box ', box, ' failed to open: ', err);
      win.disposeWidgets();
      return false;
    }

    /* Keep the focus of the page from before the first window. */
    const active = document.activeElement;
    const hadFocusInside = this.current !== null && this.current.win.root.contains(active);
    if (this.current === null) {
      this.returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
    }

    const open: OpenWindow = {
      box,
      win,
      view,
      game,
      player,
      timer: 0,
      handle: {
        getBox: () => box,
        close: () => this.destroyWindow(open),
        refresh: () => this.tick(open),
      },
    };

    /* Closes the canvas popup or the window that is open, without the
       panel noticing a moment with no box. */
    this.iface.openHtmlBox(open.handle);
    this.current = open;

    win.root.addEventListener('keydown', (e) => this.handleKey(e));
    this.makeDraggable(win);
    document.body.append(win.root);
    this.place();

    this.tick(open);
    if (this.current !== open) return true; /* Closed by its first update. */
    open.timer = window.setInterval(() => this.tick(open), 250);

    const target =
      (focusTabNext && hadFocusInside ? win.getSelectedTab() : null) ??
      win.initialFocus ??
      win.firstFocusable();
    focusTabNext = false;
    target?.focus({ preventScroll: true });
    return true;
  }

  /* The timer of the window: about four times a second, and when a
     command was applied. */
  protected tick(open: OpenWindow): void {
    if (this.current !== open) return;
    if (
      this.iface.getGame() !== open.game ||
      this.iface.getPlayer() !== open.player ||
      this.iface.isGameInitOpen()
    ) {
      this.iface.closePopup();
      return;
    }
    try {
      open.view?.update?.();
      open.win.updateWidgets();
    } catch (err) {
      Log.Error('menu', 'box ', open.box, ' failed to update: ', err);
      this.iface.closePopup();
    }
  }

  /* HtmlBox.close(): the interface has dropped the box. */
  protected destroyWindow(open: OpenWindow): void {
    window.clearInterval(open.timer);
    try {
      open.view?.dispose?.();
      open.win.disposeWidgets();
    } catch (err) {
      Log.Error('menu', 'box ', open.box, ' failed to close: ', err);
    }
    const hadFocus = open.win.root.contains(document.activeElement);
    open.win.root.remove();
    if (this.current !== open) return;
    this.current = null;

    /* Another window follows at once when a box replaces this one; the
       focus goes back only when none does. */
    const back = this.returnFocus;
    window.setTimeout(() => {
      if (this.current !== null) return;
      this.returnFocus = null;
      if (!hadFocus) return;
      if (back !== null && back.isConnected) back.focus({ preventScroll: true });
      else blurActive();
    }, 0);
  }

  protected handleKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.iface.closePopup();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (ownKeys.has(e.key)) e.stopPropagation();
  }

  /* Put the window where it was dragged to, or in the middle of the page
     (where the boxes of the game open), and keep it inside the page. */
  protected place(): void {
    if (this.current === null) return;
    const root = this.current.win.root;
    if (this.position === null) {
      root.style.left = '';
      root.style.top = '';
      root.classList.remove('mk-moved');
      return;
    }
    const margin = 4;
    const rect = root.getBoundingClientRect();
    const x = Math.max(margin, Math.min(this.position.x, window.innerWidth - rect.width - margin));
    const y = Math.max(margin, Math.min(this.position.y, window.innerHeight - rect.height - margin));
    root.classList.add('mk-moved');
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
  }

  /* Drag by the title bar (not by its buttons). */
  protected makeDraggable(win: MenuWindow): void {
    const head = win.getHead();
    let start: { px: number; py: number; x: number; y: number } | null = null;

    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button') !== null) return;
      const rect = win.root.getBoundingClientRect();
      start = { px: e.clientX, py: e.clientY, x: rect.left, y: rect.top };
      head.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    head.addEventListener('pointermove', (e) => {
      if (start === null) return;
      this.position = { x: start.x + e.clientX - start.px, y: start.y + e.clientY - start.py };
      this.place();
    });
    const end = (e: PointerEvent): void => {
      if (start === null) return;
      start = null;
      if (head.hasPointerCapture(e.pointerId)) head.releasePointerCapture(e.pointerId);
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    /* Back to the middle. */
    head.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('button') !== null) return;
      this.position = null;
      this.place();
    });
  }
}

let menus: Menus | null = null;

/* Install the registry as the popup hook of the interface. index.ts calls
   this once, with the boxes of the families registered. */
export function installMenus(iface: Interface, gameManager: GameManager): Menus {
  applyGameTheme();
  if (menus === null) menus = new Menus(iface, gameManager);
  return menus;
}

export function getMenus(): Menus | null {
  return menus;
}
