// The look of the page overlays that comes from the game data: the wooden
// frame of the popup boxes and their background patterns, drawn at run time
// from the player's SPAE.PA into data URLs and handed to the style sheets
// as CSS variables (theme.css lists them). Nothing of the original art is
// in the repository. Not part of Freeserf.

import { Asset } from '../../data/data';
import { Data } from '../data-instance';

type Canvas = HTMLCanvasElement;

/* A sprite of the game data in its own pixels, or null. */
function sprite(asset: Asset, index: number): Canvas | null {
  const data = Data.getInstance();
  if (!data.isLoaded()) return null;
  try {
    const s = data.getDataSource().getSprite(asset, index, { red: 0, green: 0, blue: 0, alpha: 0xff });
    if (s === null || s.width <= 0 || s.height <= 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = s.width;
    canvas.height = s.height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return null;
    const image = ctx.createImageData(s.width, s.height);
    image.data.set(s.data);
    ctx.putImageData(image, 0, 0);
    return canvas;
  } catch {
    return null;
  }
}

function url(canvas: Canvas): string {
  return `url("${canvas.toDataURL('image/png')}")`;
}

/* The sizes of the frame of the popup boxes (box-frame.ts): top edge 9,
   bottom edge 7, sides 8 pixels. */
export const frameTop = 9;
export const frameBottom = 7;
export const frameSide = 8;

/* The frame as one picture for border-image: the four corners of the popup
   frame and, between them, the plain wood of each edge (the parts that
   drawBoxFrame() of box-frame.ts repeats). 80 x 112 pixels, sliced 9 8 7 8. */
function frameImage(): Canvas | null {
  const top = sprite(Asset.FramePopup, 0);
  const bottom = sprite(Asset.FramePopup, 1);
  const left = sprite(Asset.FramePopup, 2);
  const right = sprite(Asset.FramePopup, 3);
  if (top === null || bottom === null || left === null || right === null) return null;

  const midW = 64;
  const midH = 96;
  const w = frameSide + midW + frameSide;
  const h = frameTop + midH + frameBottom;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;

  /* Top: corners, and the plain wood at 12..44 of the sprite twice. */
  ctx.drawImage(top, 0, 0, frameSide, frameTop, 0, 0, frameSide, frameTop);
  ctx.drawImage(top, 12, 0, 32, frameTop, frameSide, 0, 32, frameTop);
  ctx.drawImage(top, 12, 0, 32, frameTop, frameSide + 32, 0, 32, frameTop);
  ctx.drawImage(top, top.width - frameSide, 0, frameSide, frameTop, w - frameSide, 0, frameSide, frameTop);

  /* Bottom: corners, and the plain wood at 40..104. */
  const by = h - frameBottom;
  ctx.drawImage(bottom, 0, 0, frameSide, frameBottom, 0, by, frameSide, frameBottom);
  ctx.drawImage(bottom, 40, 0, midW, frameBottom, frameSide, by, midW, frameBottom);
  ctx.drawImage(
    bottom, bottom.width - frameSide, 0, frameSide, frameBottom,
    w - frameSide, by, frameSide, frameBottom,
  );

  /* Sides: the middle at 16..112. */
  ctx.drawImage(left, 0, 16, frameSide, midH, 0, frameTop, frameSide, midH);
  ctx.drawImage(right, 0, 16, frameSide, midH, w - frameSide, frameTop, frameSide, midH);
  return canvas;
}

/* The ornament in the middle of the top edge: 44..100 of the sprite. */
function ornamentImage(): Canvas | null {
  const top = sprite(Asset.FramePopup, 0);
  if (top === null) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 56;
  canvas.height = frameTop;
  canvas.getContext('2d')?.drawImage(top, 44, 0, 56, frameTop, 0, 0, 56, frameTop);
  return canvas;
}

/* The background patterns of the popup boxes (PopupBoxBackgroundPattern of
   popup.ts): one icon each, repeated over the box. */
const patterns: { name: string; icon: number }[] = [
  { name: 'green', icon: 129 }, // PatternStripedGreen
  { name: 'brown', icon: 311 }, // PatternCheckerdDiagonalBrown
  { name: 'build', icon: 131 }, // PatternConstruction
  { name: 'plain', icon: 310 }, // PatternDiagonalGreen
];

let applied = false;

/* Set the variables on the page. Safe to call again; does its work once,
   when the data file is loaded. Returns whether the game art is in use. */
export function applyGameTheme(): boolean {
  if (applied) return true;
  if (!Data.getInstance().isLoaded()) return false;

  const style = document.documentElement.style;
  const frame = frameImage();
  if (frame !== null) style.setProperty('--gx-frame-image', url(frame));
  const ornament = ornamentImage();
  if (ornament !== null) style.setProperty('--gx-frame-ornament', url(ornament));
  for (const pattern of patterns) {
    const canvas = sprite(Asset.Icon, pattern.icon);
    if (canvas !== null) style.setProperty(`--gx-pattern-${pattern.name}`, url(canvas));
  }
  if (frame !== null) document.documentElement.classList.add('gx-art');
  applied = true;
  return frame !== null;
}

/* A colour of the theme, for what is drawn on a canvas (charts). */
export function themeColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value !== '' ? value : fallback;
}
