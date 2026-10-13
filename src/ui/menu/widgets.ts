// The widgets of the menu kit: what the windows of ui/menu are made of.
// Each is small, works with the keyboard and says in text what it shows.
// Not part of Freeserf.
//
// A widget is { el, update?, dispose? } (kit.ts). Give it to
// MenuWindow.add() and its update() runs on the timer of the window: it
// reads the game through the get() it was made with and shows the value.
// A set() must issue a command of net/commands.ts and nothing else.

import { Asset } from '../../data/data';
import type { BuildingType } from '../../game/building';
import type { ResourceType } from '../../game/resource';
import { SerfType } from '../../game/serf';
import {
  buildingCanvas as plainBuildingCanvas,
  el,
  flagCanvas as plainFlagCanvas,
  resourceCanvas as plainResourceCanvas,
  spriteCanvas,
} from '../overlay-dom';
import type { Rgb } from '../overlay-dom';
import type { Widget } from './kit';
import { themeColor } from './theme';

export { el } from '../overlay-dom';
export type { Rgb } from '../overlay-dom';

// ---------------------------------------------------------------------------
// Pictures from the game data. All are canvases with aria-hidden: the text
// next to them names the thing.

/* Show a sprite at the pixel size of the theme (one pixel of the game is
   --gx-px wide), so that every picture of a window has the same scale. */
export function gamePixels<T extends HTMLCanvasElement>(canvas: T): T {
  canvas.style.width = `calc(${canvas.width} * var(--gx-px))`;
  canvas.style.height = `calc(${canvas.height} * var(--gx-px))`;
  canvas.classList.add('mk-sprite');
  return canvas;
}

/* Any sprite of the data file. */
export function assetCanvas(asset: Asset, index: number, color?: Rgb): HTMLCanvasElement {
  return gamePixels(spriteCanvas(asset, index, color));
}

/* An icon of the boxes of the game: Asset.Icon by its index, the numbers
   that drawPopupIcon() of popup.ts takes. */
export function iconCanvas(index: number): HTMLCanvasElement {
  return gamePixels(spriteCanvas(Asset.Icon, index));
}

/* The icon of a resource, 16 x 16 game pixels. */
export function resourceIcon(res: ResourceType): HTMLCanvasElement {
  const canvas = gamePixels(plainResourceCanvas(res));
  canvas.classList.remove('gx-res');
  return canvas;
}

/* The same in the height of a line of text. */
export function resourceIconSmall(res: ResourceType): HTMLCanvasElement {
  return plainResourceCanvas(res);
}

/* A finished building in the colour of a player. */
export function buildingIcon(type: BuildingType, color?: Rgb): HTMLCanvasElement {
  const canvas = gamePixels(plainBuildingCanvas(type, color));
  canvas.classList.remove('gx-bld');
  return canvas;
}

export function flagIcon(playerIndex: number, color?: Rgb): HTMLCanvasElement {
  const canvas = gamePixels(plainFlagCanvas(playerIndex, color));
  canvas.classList.remove('gx-bld');
  return canvas;
}

/* The icons of the serf types in the boxes of popup.ts (drawSerfsBox). */
const serfIcons: { [type: number]: number } = {
  [SerfType.TypeTransporter]: 0x09,
  [SerfType.TypeSailor]: 0x0a,
  [SerfType.TypeDigger]: 0x0b,
  [SerfType.TypeBuilder]: 0x0c,
  [SerfType.TypeTransporterInventory]: 0x09,
  [SerfType.TypeLumberjack]: 0x0d,
  [SerfType.TypeSawmiller]: 0x0e,
  [SerfType.TypeStonecutter]: 0x0f,
  [SerfType.TypeForester]: 0x10,
  [SerfType.TypeMiner]: 0x11,
  [SerfType.TypeSmelter]: 0x12,
  [SerfType.TypeFisher]: 0x13,
  [SerfType.TypePigFarmer]: 0x14,
  [SerfType.TypeButcher]: 0x15,
  [SerfType.TypeFarmer]: 0x16,
  [SerfType.TypeMiller]: 0x17,
  [SerfType.TypeBaker]: 0x18,
  [SerfType.TypeBoatBuilder]: 0x19,
  [SerfType.TypeToolmaker]: 0x1a,
  [SerfType.TypeWeaponSmith]: 0x1b,
  [SerfType.TypeGeologist]: 0x1c,
  [SerfType.TypeGeneric]: 0x82,
  [SerfType.TypeKnight0]: 0x1d,
  [SerfType.TypeKnight1]: 0x1e,
  [SerfType.TypeKnight2]: 0x1f,
  [SerfType.TypeKnight3]: 0x20,
  [SerfType.TypeKnight4]: 0x21,
};

/* The icon of a serf type; the knights by their rank (TypeKnight0..4). */
export function serfIcon(type: SerfType): HTMLCanvasElement {
  return iconCanvas(serfIcons[type] ?? 0x82);
}

/* The face of a player on the colour of the player, as drawPlayerFace() of
   popup.ts: face 1..13 is icon 0x10b + face, 0 is the empty face 0x119. */
export function faceCanvas(face: number, color: Rgb | null): HTMLCanvasElement {
  const picture = spriteCanvas(Asset.Icon, face !== 0 ? 0x10b + face : 0x119);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.width = picture.width + 16;
  canvas.height = picture.height + 8;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    if (color !== null) {
      ctx.fillStyle = `rgb(${color.red}, ${color.green}, ${color.blue})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(picture, 8, 4);
  }
  return gamePixels(canvas);
}

// ---------------------------------------------------------------------------
// Text and layout.

let nextId = 1;
function newId(prefix: string): string {
  return `mk-${prefix}-${nextId++}`;
}

/* A small line of explanation. */
export function hint(text: string): HTMLElement {
  return el('p', 'mk-hint', text);
}

/* A titled group of rows. Append the rows to .content (or pass them). */
export function section(title: string, ...items: (Widget | HTMLElement)[]): Widget & { content: HTMLElement } {
  const root = el('section', 'mk-section');
  const id = newId('sec');
  const head = el('h3', 'mk-section-title', title);
  head.id = id;
  root.setAttribute('aria-labelledby', id);
  const content = el('div', 'mk-section-body');
  root.append(head, content);
  const widgets: Widget[] = [];
  for (const item of items) {
    if (item instanceof HTMLElement) {
      content.append(item);
    } else {
      content.append(item.el);
      widgets.push(item);
    }
  }
  return {
    el: root,
    content,
    update: () => widgets.forEach((w) => w.update?.()),
    dispose: () => widgets.forEach((w) => w.dispose?.()),
  };
}

export interface ButtonOptions {
  /* A picture before the text. */
  icon?: HTMLElement;
  /* The tooltip; the label is the name for a screen reader. */
  title?: string;
  kind?: 'normal' | 'primary' | 'danger' | 'quiet';
  /* Only the icon is shown; the label is still the name of the button. */
  iconOnly?: boolean;
}

export function button(label: string, onClick: () => void, options: ButtonOptions = {}): HTMLButtonElement {
  const b = el('button', 'gx-btn mk-btn');
  b.type = 'button';
  if (options.kind !== undefined && options.kind !== 'normal') b.classList.add(`mk-btn-${options.kind}`);
  if (options.icon !== undefined) b.append(options.icon);
  if (options.iconOnly === true) {
    b.classList.add('mk-btn-icon');
    b.setAttribute('aria-label', label);
    b.title = options.title ?? label;
  } else {
    b.append(el('span', '', label));
    if (options.title !== undefined) b.title = options.title;
  }
  b.addEventListener('click', onClick);
  return b;
}

/* A label on the left (with an optional picture) and something on the
   right: the base of the rows below. */
function row(label: string, icon: HTMLElement | undefined, className: string): {
  root: HTMLElement;
  labelEl: HTMLElement;
  side: HTMLElement;
} {
  const root = el('div', `mk-row ${className}`);
  const labelEl = el('span', 'mk-label');
  if (icon !== undefined) {
    const pic = el('span', 'mk-pic');
    pic.append(icon);
    labelEl.append(pic);
  }
  labelEl.append(el('span', 'mk-label-text', label));
  const side = el('span', 'mk-side');
  root.append(labelEl, side);
  return { root, labelEl, side };
}

export interface NumberRowOptions {
  label: string;
  icon?: HTMLElement;
  /* The number, or a text when it is not a plain number ("3 of 5"). */
  get(): number | string;
  title?: string;
}

/* A number of the game with its name. */
export function numberRow(options: NumberRowOptions): Widget {
  const { root, side } = row(options.label, options.icon, 'mk-number');
  if (options.title !== undefined) root.title = options.title;
  const value = el('span', 'mk-value');
  side.append(value);
  let shown = '';
  const update = (): void => {
    const text = String(options.get());
    if (text === shown) return;
    shown = text;
    value.textContent = text;
  };
  update();
  return { el: root, update };
}

export interface NumberTile {
  label: string;
  icon?: HTMLElement;
  get(): number | string;
  title?: string;
}

/* Many numbers in a grid: the stock of 26 resources, the serfs by type.
   A tile is picture, name and number; one at 0 steps back. */
export function numberGrid(label: string, tiles: NumberTile[]): Widget {
  const root = el('ul', 'mk-grid');
  root.setAttribute('aria-label', label);
  const values: HTMLElement[] = [];
  const items: HTMLElement[] = [];
  const shown: string[] = [];
  for (const tile of tiles) {
    const item = el('li', 'mk-tile');
    if (tile.title !== undefined) item.title = tile.title;
    if (tile.icon !== undefined) {
      const pic = el('span', 'mk-pic');
      pic.append(tile.icon);
      item.append(pic);
    }
    const value = el('span', 'mk-value');
    item.append(el('span', 'mk-tile-name', tile.label), value);
    values.push(value);
    items.push(item);
    shown.push('');
    root.append(item);
  }
  const update = (): void => {
    tiles.forEach((tile, i) => {
      const v = tile.get();
      const text = String(v);
      if (text === shown[i]) return;
      shown[i] = text;
      values[i].textContent = text;
      items[i].classList.toggle('mk-zero', v === 0);
    });
  };
  update();
  return { el: root, update };
}

export interface MeterOptions {
  label: string;
  icon?: HTMLElement;
  /* fill 0..1 and the words for it ("7 of 8", "Good"). */
  get(): { fill: number; text: string };
  title?: string;
}

/* A bar with its value in words: the gauges of the statistics boxes. */
export function meter(options: MeterOptions): Widget {
  const { root, side } = row(options.label, options.icon, 'mk-meter');
  if (options.title !== undefined) root.title = options.title;
  const bar = el('span', 'mk-meter-bar');
  const fill = el('span', 'mk-meter-fill');
  bar.append(fill);
  bar.setAttribute('aria-hidden', 'true');
  const value = el('span', 'mk-value');
  side.append(bar, value);
  let shown = '';
  const update = (): void => {
    const v = options.get();
    const key = `${v.fill}|${v.text}`;
    if (key === shown) return;
    shown = key;
    fill.style.width = `${Math.max(0, Math.min(1, v.fill)) * 100}%`;
    value.textContent = v.text;
  };
  update();
  return { el: root, update };
}

// ---------------------------------------------------------------------------
// Controls.

export interface SliderOptions {
  label: string;
  icon?: HTMLElement;
  min?: number;
  max: number;
  step?: number;
  get(): number;
  /* Issue the command. Called while the bar is dragged (at most about eight
     times a second) and when it is let go. */
  set(value: number): void;
  /* The value in words, shown next to the bar and read by a screen reader. */
  format?(value: number): string;
  title?: string;
}

/* A horizontal slide bar bound to a value of the game. */
export function slider(options: SliderOptions): Widget & { input: HTMLInputElement } {
  const id = newId('sl');
  const { root, labelEl, side } = row(options.label, options.icon, 'mk-slider');
  if (options.title !== undefined) root.title = options.title;
  const min = options.min ?? 0;
  const format = options.format ?? ((v: number) => String(v));

  const label = document.createElement('label');
  label.htmlFor = id;
  label.className = labelEl.className;
  label.append(...Array.from(labelEl.childNodes));
  labelEl.replaceWith(label);

  const input = el('input', 'mk-range');
  input.type = 'range';
  input.id = id;
  input.min = String(min);
  input.max = String(options.max);
  input.step = String(options.step ?? 1);
  const out = el('output', 'mk-value');
  out.htmlFor.add(id);
  side.append(input, out);

  /* The value the player set, until the game shows it (a command is
     applied a moment later, online some turns later). */
  let pending: number | null = null;
  let pendingUntil = 0;
  let lastSent = 0;
  let lastSentValue: number | null = null;
  let sendTimer = 0;
  let shown = NaN;

  const show = (value: number): void => {
    if (value === shown) return;
    shown = value;
    input.value = String(value);
    const text = format(value);
    out.textContent = text;
    input.setAttribute('aria-valuetext', text);
    input.style.setProperty('--mk-fill', `${((value - min) / (options.max - min || 1)) * 100}%`);
  };

  const send = (): void => {
    window.clearTimeout(sendTimer);
    sendTimer = 0;
    /* Not the same value twice in a row (the last step of a drag, then
       letting go). */
    if (pending === null || pending === lastSentValue) return;
    lastSent = performance.now();
    lastSentValue = pending;
    options.set(pending);
  };

  input.addEventListener('input', () => {
    pending = Number(input.value);
    pendingUntil = performance.now() + 1500;
    show(pending);
    const wait = 120 - (performance.now() - lastSent);
    if (wait <= 0) send();
    else if (sendTimer === 0) sendTimer = window.setTimeout(send, wait);
  });
  input.addEventListener('change', () => {
    pending = Number(input.value);
    pendingUntil = performance.now() + 1500;
    send();
  });

  const update = (): void => {
    const value = options.get();
    if (pending !== null) {
      if (value !== pending && performance.now() < pendingUntil) return;
      pending = null;
      lastSentValue = null;
    }
    show(value);
  };
  update();
  return { el: root, input, update, dispose: () => window.clearTimeout(sendTimer) };
}

/* The slide bars of the original: 0 to 65500 in 50 steps of 1310
   (guiGetSliderClickValue), shown as a share of the whole bar. */
export function shareSlider(
  options: Pick<SliderOptions, 'label' | 'icon' | 'get' | 'set' | 'title'>,
): Widget & { input: HTMLInputElement } {
  return slider({
    ...options,
    min: 0,
    max: 65500,
    step: 1310,
    format: (v) => `${Math.min(100, Math.round((v * 100) / 65500))}%`,
  });
}

export interface StepperOptions {
  label: string;
  icon?: HTMLElement;
  get(): number | string;
  /* Issue the command for one step down or up. */
  dec(): void;
  inc(): void;
  /* Whether a step is possible now; the button is off when not. */
  canDec?(): boolean;
  canInc?(): boolean;
  /* What the buttons are called: "Fewer knights", "More knights". */
  decLabel?: string;
  incLabel?: string;
  title?: string;
}

/* A value with a minus and a plus button. */
export function stepper(options: StepperOptions): Widget {
  const { root, side } = row(options.label, options.icon, 'mk-stepper');
  if (options.title !== undefined) root.title = options.title;
  /* The minus and plus icons of the boxes of the game. */
  const minus = button(options.decLabel ?? `Less: ${options.label}`, options.dec, {
    icon: iconCanvas(220),
    iconOnly: true,
  });
  const plus = button(options.incLabel ?? `More: ${options.label}`, options.inc, {
    icon: iconCanvas(221),
    iconOnly: true,
  });
  const value = el('span', 'mk-value');
  value.setAttribute('aria-live', 'polite');
  side.append(minus, value, plus);
  let shown = '';
  const update = (): void => {
    const text = String(options.get());
    if (text !== shown) {
      shown = text;
      value.textContent = text;
    }
    if (options.canDec !== undefined) minus.disabled = !options.canDec();
    if (options.canInc !== undefined) plus.disabled = !options.canInc();
  };
  update();
  return { el: root, update };
}

export interface ToggleOptions {
  label: string;
  icon?: HTMLElement;
  get(): boolean;
  set(on: boolean): void;
  /* The words for the two states, "On" and "Off" if not given. */
  onText?: string;
  offText?: string;
  title?: string;
}

/* A switch. The state is a word, not only a colour. */
export function toggle(options: ToggleOptions): Widget {
  const { root, labelEl, side } = row(options.label, options.icon, 'mk-toggle');
  if (options.title !== undefined) root.title = options.title;
  const id = newId('tg');
  labelEl.id = id;
  const b = el('button', 'mk-switch');
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-labelledby', id);
  const knob = el('span', 'mk-switch-knob');
  knob.setAttribute('aria-hidden', 'true');
  const state = el('span', 'mk-switch-text');
  b.append(knob, state);
  side.append(b);
  let shown: boolean | null = null;
  const update = (): void => {
    const on = options.get();
    if (on === shown) return;
    shown = on;
    b.setAttribute('aria-checked', String(on));
    state.textContent = on ? (options.onText ?? 'On') : (options.offText ?? 'Off');
  };
  b.addEventListener('click', () => options.set(!options.get()));
  update();
  return { el: root, update };
}

export interface SegmentOption<T> {
  value: T;
  label: string;
  icon?: HTMLElement;
  title?: string;
}

export interface SegmentedOptions<T> {
  label: string;
  options: SegmentOption<T>[];
  get(): T;
  set(value: T): void;
  /* Show the label of the group above the buttons (default) or only give
     it to a screen reader. */
  hideLabel?: boolean;
  /* The buttons show their icons only; the labels are their names. */
  iconsOnly?: boolean;
}

/* One of several: a radio group drawn as a row of buttons. The arrows move
   the choice, as in a radio group. */
export function segmented<T>(options: SegmentedOptions<T>): Widget {
  const root = el('div', 'mk-segmented');
  const id = newId('sg');
  const caption = el('div', options.hideLabel === true ? 'mk-sr' : 'mk-label mk-seg-label', options.label);
  caption.id = id;
  const group = el('div', 'mk-seg-group');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', id);
  root.append(caption, group);

  const buttons = options.options.map((option) => {
    const b = el('button', 'mk-seg');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    if (option.icon !== undefined) b.append(option.icon);
    if (options.iconsOnly === true && option.icon !== undefined) {
      b.setAttribute('aria-label', option.label);
      b.title = option.title ?? option.label;
      b.classList.add('mk-seg-icon');
    } else {
      b.append(el('span', '', option.label));
      if (option.title !== undefined) b.title = option.title;
    }
    b.addEventListener('click', () => {
      options.set(option.value);
      update();
    });
    group.append(b);
    return b;
  });

  group.addEventListener('keydown', (e) => {
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % buttons.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at + buttons.length - 1) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    if (next < 0) return;
    e.preventDefault();
    buttons[next].focus();
    options.set(options.options[next].value);
    update();
  });

  let shown = -2;
  const update = (): void => {
    const value = options.get();
    const at = options.options.findIndex((o) => o.value === value);
    if (at === shown) return;
    shown = at;
    buttons.forEach((b, i) => {
      b.setAttribute('aria-checked', String(i === at));
      b.tabIndex = i === at || (at < 0 && i === 0) ? 0 : -1;
    });
  };
  update();
  return { el: root, update };
}

export type PriorityMove = 'top' | 'up' | 'down' | 'bottom';

export interface PriorityItem {
  id: number;
  label: string;
  icon?: HTMLElement;
}

export interface PriorityListOptions {
  label: string;
  items: PriorityItem[];
  /* The ids from the first (highest) place to the last. */
  getOrder(): number[];
  /* Issue the command that moves the item one place or to an end. */
  move(id: number, how: PriorityMove): void;
  /* Optional: the item was dragged to the place `index` (0 is the first).
     Without it the rows can not be dragged. */
  moveTo?(id: number, index: number): void;
}

/* An order of things to change: each row has buttons to the top, up, down
   and to the bottom, and can be dragged when moveTo() is given. The focus
   stays on the button of the item while it moves. */
export function priorityList(options: PriorityListOptions): Widget {
  const root = el('ol', 'mk-prio');
  root.setAttribute('aria-label', options.label);
  const byId = new Map(options.items.map((item) => [item.id, item]));
  const rows = new Map<number, HTMLElement>();
  const places = new Map<number, HTMLElement>();
  const moves: { how: PriorityMove; icon: number; text: string }[] = [
    { how: 'top', icon: 237, text: 'to the top' },
    { how: 'up', icon: 238, text: 'up' },
    { how: 'down', icon: 239, text: 'down' },
    { how: 'bottom', icon: 240, text: 'to the bottom' },
  ];
  let dragged: number | null = null;

  for (const item of options.items) {
    const li = el('li', 'mk-prio-row');
    li.dataset.id = String(item.id);
    const place = el('span', 'mk-prio-place');
    const name = el('span', 'mk-label');
    if (item.icon !== undefined) {
      const pic = el('span', 'mk-pic');
      pic.append(item.icon);
      name.append(pic);
    }
    name.append(el('span', 'mk-label-text', item.label));
    const side = el('span', 'mk-side');
    for (const m of moves) {
      const b = button(`Move ${item.label} ${m.text}`, () => options.move(item.id, m.how), {
        icon: iconCanvas(m.icon),
        iconOnly: true,
      });
      b.dataset.move = m.how;
      side.append(b);
    }
    li.append(place, name, side);

    if (options.moveTo !== undefined) {
      const moveTo = options.moveTo;
      li.draggable = true;
      li.classList.add('mk-prio-drag');
      li.addEventListener('dragstart', (e) => {
        dragged = item.id;
        e.dataTransfer?.setData('text/plain', item.label);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        li.classList.add('mk-dragging');
      });
      li.addEventListener('dragend', () => {
        dragged = null;
        li.classList.remove('mk-dragging');
        rows.forEach((r) => r.classList.remove('mk-drop'));
      });
      li.addEventListener('dragover', (e) => {
        if (dragged === null || dragged === item.id) return;
        e.preventDefault();
        li.classList.add('mk-drop');
      });
      li.addEventListener('dragleave', () => li.classList.remove('mk-drop'));
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.classList.remove('mk-drop');
        if (dragged === null || dragged === item.id) return;
        moveTo(dragged, order.indexOf(item.id));
      });
    }
    rows.set(item.id, li);
    places.set(item.id, place);
  }

  let order: number[] = [];
  let shown = '';
  const update = (): void => {
    const next = options.getOrder().filter((id) => byId.has(id));
    const key = next.join(',');
    if (key === shown) return;
    shown = key;
    order = next;
    /* The button that has the focus keeps it while its row moves. */
    const active = document.activeElement;
    const keep = active instanceof HTMLElement && root.contains(active) ? active : null;
    order.forEach((id, i) => {
      const li = rows.get(id)!;
      places.get(id)!.textContent = `${i + 1}.`;
      root.append(li);
      li.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
        const how = b.dataset.move;
        b.disabled =
          ((how === 'top' || how === 'up') && i === 0) ||
          ((how === 'bottom' || how === 'down') && i === order.length - 1);
      });
    });
    if (keep !== null) {
      if (keep instanceof HTMLButtonElement && keep.disabled) {
        /* At an end: the nearest button of the row that still works. */
        const others = Array.from(keep.parentElement!.querySelectorAll<HTMLButtonElement>('button'));
        (others.find((b) => !b.disabled) ?? keep).focus({ preventScroll: true });
      } else {
        keep.focus({ preventScroll: true });
      }
    }
  };
  update();
  return { el: root, update };
}

/* A question with two answers in a row: "Demolish this building?" Yes, No.
   The second answer gets the focus first when the first is dangerous. */
export function confirmRow(
  question: string,
  yes: { label: string; action: () => void; danger?: boolean },
  no: { label: string; action: () => void },
): Widget & { yesButton: HTMLButtonElement; noButton: HTMLButtonElement } {
  const root = el('div', 'mk-confirm');
  root.setAttribute('role', 'group');
  const id = newId('cf');
  const text = el('p', 'mk-confirm-text', question);
  text.id = id;
  root.setAttribute('aria-labelledby', id);
  const buttons = el('div', 'mk-confirm-buttons');
  const yesButton = button(yes.label, yes.action, { kind: yes.danger === true ? 'danger' : 'primary' });
  const noButton = button(no.label, no.action);
  buttons.append(yesButton, noButton);
  root.append(text, buttons);
  return { el: root, yesButton, noButton };
}

// ---------------------------------------------------------------------------
// Charts.

export interface ChartSeries {
  label: string;
  /* From the oldest value (left) to the newest (right). */
  values: number[];
  /* A colour; the theme's when not given. The lines differ by their dash
     pattern too, and the legend names them. */
  color?: string;
}

export interface ChartData {
  series: ChartSeries[];
  /* The value at the top of the chart. */
  yMax: number;
  /* Values that get a line across and a number at the left edge. */
  yTicks?: number[];
  yFormat?(value: number): string;
  /* Words under the chart, at a place 0 (left) to 1 (right). */
  xLabels?: { at: number; text: string }[];
  /* One sentence that says what the chart shows now, for a screen reader
     ("Planks: 12 now, at most 30 in the last two hours"). */
  summary?: string;
}

export interface ChartOptions {
  kind: 'bars' | 'lines';
  label: string;
  /* Height of the drawing in em. */
  height?: number;
  get(): ChartData;
}

const dashes: number[][] = [[], [6, 3], [2, 3], [8, 3, 2, 3]];

/* A bar chart (one series) or a line chart (several) on a canvas, in the
   colours of the theme. update() draws again only when the data or the
   size changed. */
export function chart(options: ChartOptions): Widget {
  const root = el('figure', 'mk-chart');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.className = 'mk-chart-canvas';
  canvas.style.height = `${options.height ?? 9}em`;
  const legend = el('figcaption', 'mk-legend');
  root.append(canvas, legend);

  let shown = '';
  let legendShown = '';

  const draw = (data: ChartData, width: number, height: number, ratio: number): void => {
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const text = themeColor('--gx-text-dim', '#c9c3a4');
    const line = themeColor('--gx-line', '#55603c');
    const fontSize = Math.max(9, parseFloat(getComputedStyle(root).fontSize) * 0.8);
    ctx.font = `${fontSize}px ${themeColor('--gx-font', 'sans-serif')}`;
    const yFormat = data.yFormat ?? ((v: number) => String(v));
    const ticks = data.yTicks ?? [];
    const left = ticks.length > 0
      ? Math.ceil(Math.max(...ticks.map((t) => ctx.measureText(yFormat(t)).width))) + 6
      : 2;
    const bottom = data.xLabels !== undefined && data.xLabels.length > 0 ? fontSize + 6 : 2;
    const top = Math.ceil(fontSize / 2) + 1;
    const right = 2;
    const w = Math.max(1, width - left - right);
    const h = Math.max(1, height - top - bottom);
    const yMax = data.yMax > 0 ? data.yMax : 1;
    const yOf = (v: number): number => top + h - (Math.max(0, Math.min(v, yMax)) / yMax) * h;

    /* Frame and the lines of the ticks. */
    ctx.lineWidth = 1;
    ctx.strokeStyle = line;
    ctx.fillStyle = text;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (const tick of ticks) {
      const y = Math.round(yOf(tick)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + w, y);
      ctx.stroke();
      ctx.fillText(yFormat(tick), left - 4, y);
    }
    ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);

    if (data.xLabels !== undefined) {
      ctx.textBaseline = 'alphabetic';
      for (const label of data.xLabels) {
        ctx.textAlign = label.at <= 0.05 ? 'left' : label.at >= 0.95 ? 'right' : 'center';
        ctx.fillText(label.text, left + label.at * w, height - 3);
      }
    }

    if (options.kind === 'bars') {
      const series = data.series[0];
      if (series !== undefined && series.values.length > 0) {
        ctx.fillStyle = series.color ?? themeColor('--gx-chart', '#cf6363');
        const n = series.values.length;
        for (let i = 0; i < n; i++) {
          const v = series.values[i];
          if (v <= 0) continue;
          const x0 = left + Math.floor((i * w) / n);
          const x1 = left + Math.floor(((i + 1) * w) / n);
          const y = yOf(v);
          ctx.fillRect(x0, y, Math.max(1, x1 - x0), top + h - y);
        }
      }
      return;
    }

    data.series.forEach((series, s) => {
      const n = series.values.length;
      if (n === 0) return;
      ctx.strokeStyle = series.color ?? text;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.setLineDash(dashes[s % dashes.length]);
      ctx.beginPath();
      series.values.forEach((v, i) => {
        const x = left + (n === 1 ? w : (i * w) / (n - 1));
        if (i === 0) ctx.moveTo(x, yOf(v));
        else ctx.lineTo(x, yOf(v));
      });
      ctx.stroke();
    });
    ctx.setLineDash([]);
  };

  const update = (): void => {
    const data = options.get();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    let key = `${width}x${height}@${ratio}|${data.yMax}|${(data.yTicks ?? []).join(',')}|`;
    key += (data.xLabels ?? []).map((l) => l.text).join(',');
    for (const series of data.series) key += `|${series.label}:${series.color ?? ''}:${series.values.join(',')}`;
    if (key !== shown && width > 0 && height > 0) {
      shown = key;
      draw(data, width, height, ratio);
    }
    canvas.setAttribute('aria-label', data.summary !== undefined ? `${options.label}. ${data.summary}` : options.label);

    /* The legend: only when the lines need to be told apart. */
    const legendKey = options.kind === 'lines'
      ? data.series.map((s) => `${s.label}:${s.color ?? ''}`).join('|')
      : '';
    if (legendKey !== legendShown) {
      legendShown = legendKey;
      legend.textContent = '';
      if (legendKey !== '') {
        data.series.forEach((series, s) => {
          const item = el('span', 'mk-legend-item');
          const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          mark.setAttribute('viewBox', '0 0 28 6');
          mark.setAttribute('aria-hidden', 'true');
          mark.classList.add('mk-legend-mark');
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          path.setAttribute('x1', '0');
          path.setAttribute('x2', '28');
          path.setAttribute('y1', '3');
          path.setAttribute('y2', '3');
          path.setAttribute('stroke', series.color ?? 'currentColor');
          path.setAttribute('stroke-width', '2');
          const dash = dashes[s % dashes.length];
          if (dash.length > 0) path.setAttribute('stroke-dasharray', dash.join(' '));
          mark.append(path);
          item.append(mark, series.label);
          legend.append(item);
        });
      }
    }
  };

  /* Not laid out yet when the window is being built: the first update of
     the window draws it. */
  return { el: root, update };
}

/* Show a picture at a height in em (a building in a row of text): the
   width follows. Use it after one of the *Icon() functions. */
export function fitHeight<T extends HTMLCanvasElement>(canvas: T, em: number): T {
  canvas.style.height = `${em}em`;
  canvas.style.width = 'auto';
  return canvas;
}
