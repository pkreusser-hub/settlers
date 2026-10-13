// Helpers shared by the page overlays of the game (build menu, production
// chains, alerts): sprites of the game data as small canvases, the stack of
// panels at the left edge and the hint line. Not part of Freeserf.

import './build-menu.css';

import { Asset } from '../data/data';
import type { BuildingType } from '../game/building';
import type { ResourceType } from '../game/resource';
import { Data } from './data-instance';
import { mapBuildingSprite } from './interface';

export interface Rgb {
  red: number;
  green: number;
  blue: number;
}

const defaultColor: Rgb = { red: 0x00, green: 0xe3, blue: 0xe3 };

const spriteCache = new Map<string, HTMLCanvasElement | null>();

function loadSprite(asset: Asset, index: number, color: Rgb): HTMLCanvasElement | null {
  const key = `${asset}:${index}:${color.red},${color.green},${color.blue}`;
  const cached = spriteCache.get(key);
  if (cached !== undefined) return cached;

  let canvas: HTMLCanvasElement | null = null;
  const data = Data.getInstance();
  if (!data.isLoaded()) return null; /* Not cached: asked again later. */
  try {
    const sprite = data.getDataSource().getSprite(asset, index, { ...color, alpha: 0xff });
    if (sprite !== null && sprite.width > 0 && sprite.height > 0) {
      canvas = document.createElement('canvas');
      canvas.width = sprite.width;
      canvas.height = sprite.height;
      const ctx = canvas.getContext('2d');
      if (ctx !== null) {
        const image = ctx.createImageData(sprite.width, sprite.height);
        image.data.set(sprite.data);
        ctx.putImageData(image, 0, 0);
      }
    }
  } catch {
    canvas = null;
  }
  spriteCache.set(key, canvas);
  return canvas;
}

/* A sprite of the game data on a canvas of its own, in its own pixels; the
   style sheet sets the size it is shown at. */
export function spriteCanvas(asset: Asset, index: number, color: Rgb = defaultColor): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const source = loadSprite(asset, index, color);
  if (source === null) {
    canvas.width = 1;
    canvas.height = 1;
    return canvas;
  }
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext('2d')?.drawImage(source, 0, 0);
  return canvas;
}

/* The icon of a resource: icon 34 + type, as the stock boxes of popup.ts. */
export function resourceCanvas(res: ResourceType): HTMLCanvasElement {
  const canvas = spriteCanvas(Asset.Icon, 34 + res);
  canvas.classList.add('gx-res');
  return canvas;
}

/* The finished building, as the build boxes of popup.ts draw it. */
export function buildingCanvas(type: BuildingType, color?: Rgb): HTMLCanvasElement {
  const canvas = spriteCanvas(Asset.MapObject, mapBuildingSprite[type], color);
  canvas.classList.add('gx-bld');
  return canvas;
}

/* The flag of a player: map object 0x80 + 4 * player (popup.ts). */
export function flagCanvas(playerIndex: number, color?: Rgb): HTMLCanvasElement {
  const canvas = spriteCanvas(Asset.MapObject, 0x80 + 4 * playerIndex, color);
  canvas.classList.add('gx-bld');
  return canvas;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

/* The column at the left edge that holds the alerts and the build menu. */
export function leftStack(): HTMLElement {
  let stack = document.getElementById('gx-left');
  if (stack === null) {
    stack = el('div', 'gx');
    stack.id = 'gx-left';
    document.body.append(stack);
  }
  return stack;
}

let hintBox: HTMLElement | null = null;
let hintTimer = 0;

/* A short line at the bottom of the page that goes away by itself. */
export function showHint(text: string): void {
  if (hintBox === null) {
    hintBox = el('div', 'gx');
    hintBox.id = 'gx-hint';
    hintBox.setAttribute('role', 'status');
    hintBox.setAttribute('aria-live', 'polite');
    hintBox.hidden = true;
    document.body.append(hintBox);
  }
  hintBox.textContent = text;
  hintBox.hidden = false;
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => {
    if (hintBox !== null) hintBox.hidden = true;
  }, 2200);
}

/* Give the keys back to the game: no element of the page keeps the focus. */
export function blurActive(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) {
    active.blur();
  }
}
