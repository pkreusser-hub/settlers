// font.h + font-sdl.cc - The font of the texts.

import { Log } from '../game/misc';
import { resourceUrl } from './sprite-file';

/* Pixels per em of the font's glyphs, twice the original 8. */
const kGridSize = 16;

/* Pixels of a glyph in the size of the original font. */
export class FontGlyph {
  /* Position of the pixels: from the pen position, and from the top of
     the letters (the 8 rows of the original glyphs). */
  left = 0;
  top = 0;
  width = 0;
  height = 0;
  advance = 0; /* To the pen position of the next glyph. */
  pixels: boolean[] = [];

  get(x: number, y: number): boolean {
    return this.pixels[y * this.width + x];
  }
}

// PORT: stands for the TTF_Font of SDL_ttf: the font as a CSS font family
// and the characters it has (from its cmap table, the canvas has no
// TTF_FontHasGlyph and would draw them with another font).
interface FontFile {
  family: string;
  chars: Set<number>;
}

/* The characters of the cmap table of a TrueType file. */
function readCmap(buffer: ArrayBuffer): Set<number> | null {
  const view = new DataView(buffer);
  const chars = new Set<number>();
  try {
    const numTables = view.getUint16(4);
    let cmap = 0;
    for (let i = 0; i < numTables; i++) {
      const record = 12 + 16 * i;
      if (view.getUint32(record) === 0x636d6170 /* 'cmap' */) {
        cmap = view.getUint32(record + 8);
      }
    }
    if (cmap === 0) {
      return null;
    }

    const numSubtables = view.getUint16(cmap + 2);
    for (let i = 0; i < numSubtables; i++) {
      const table = cmap + view.getUint32(cmap + 4 + 8 * i + 4);
      const format = view.getUint16(table);
      if (format === 0) {
        for (let c = 0; c < 256; c++) {
          if (view.getUint8(table + 6 + c) !== 0) chars.add(c);
        }
      } else if (format === 4) {
        const segCount = view.getUint16(table + 6) >> 1;
        const endCodes = table + 14;
        const startCodes = endCodes + 2 * segCount + 2;
        const idDeltas = startCodes + 2 * segCount;
        const idRangeOffsets = idDeltas + 2 * segCount;
        for (let s = 0; s < segCount; s++) {
          const end = view.getUint16(endCodes + 2 * s);
          const start = view.getUint16(startCodes + 2 * s);
          const delta = view.getUint16(idDeltas + 2 * s);
          const rangeOffset = view.getUint16(idRangeOffsets + 2 * s);
          for (let c = start; c <= end && c < 0xffff; c++) {
            let glyph = 0;
            if (rangeOffset === 0) {
              glyph = (c + delta) & 0xffff;
            } else {
              glyph = view.getUint16(idRangeOffsets + 2 * s + rangeOffset + 2 * (c - start));
              if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
            }
            if (glyph !== 0) chars.add(c);
          }
        }
      } else if (format === 6) {
        const first = view.getUint16(table + 6);
        const count = view.getUint16(table + 8);
        for (let k = 0; k < count; k++) {
          if (view.getUint16(table + 10 + 2 * k) !== 0) chars.add(first + k);
        }
      } else if (format === 12) {
        const numGroups = view.getUint32(table + 12);
        for (let g = 0; g < numGroups; g++) {
          const group = table + 16 + 12 * g;
          const start = view.getUint32(group);
          const end = view.getUint32(group + 4);
          const startGlyph = view.getUint32(group + 8);
          for (let c = start; c <= end; c++) {
            if (startGlyph + (c - start) !== 0) chars.add(c);
          }
        }
      }
    }
  } catch (e) {
    return null;
  }
  return chars;
}

/* The font of the texts, a TrueType font of the game's resources
   (resources/settlers.ttf). Its glyphs are pixels of the original font
   doubled (16 pixels per em, the steps smoothed with Scale2x): rasterized
   at 16 pixels and reduced by 2x2 blocks they are the pixels of the
   original 8x8 font again. */
export class Font {
  static Glyph = FontGlyph;

  // PORT: a font file can only be loaded asynchronously in the browser, the
  // C++ load() is synchronous. The loaded files are kept here by URL:
  // preload() them at startup (before the first use of Graphics), load()
  // then finds them. null: failed.
  protected static files = new Map<string, FontFile | null>();
  protected static canvas: HTMLCanvasElement | null = null;

  protected font: FontFile | null = null;
  protected glyphs = new Map<number, FontGlyph | null>();

  constructor() {}

  // PORT: not in the C++, see files.
  static async preload(path: string): Promise<boolean> {
    const loaded = Font.files.get(path);
    if (loaded !== undefined) {
      return loaded !== null;
    }
    let file: FontFile | null = null;
    try {
      const response = await fetch(path);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        const chars = readCmap(buffer);
        if (chars !== null) {
          const family = 'freeserf-font-' + Font.files.size;
          const face = new FontFace(family, buffer);
          await face.load();
          document.fonts.add(face);
          file = { family, chars };
        }
      }
    } catch (e) {
      Log.Warn('graphics', 'Failed to load font ' + path, e);
    }
    Font.files.set(path, file);
    return file !== null;
  }

  // PORT: not in the C++, see files.
  static preloadResource(name: string): Promise<boolean> {
    return Font.preload(resourceUrl(name));
  }

  /* Open a font of the game's resources (the resources folder next to the
     program, in the bundle resources on macOS). */
  loadResource(name: string): boolean {
    return this.load(resourceUrl(name));
  }

  isLoaded(): boolean {
    return this.font !== null;
  }

  /* The glyph of a Unicode character, nullptr when the font has none. */
  getGlyph(ch: number): FontGlyph | null {
    let it = this.glyphs.get(ch);
    if (it === undefined) {
      it = this.render(ch);
      this.glyphs.set(ch, it);
    }
    return it;
  }

  protected load(path: string): boolean {
    const file = Font.files.get(path);
    if (file === undefined || file === null) {
      return false;
    }
    this.font = file;
    return true;
  }

  protected render(ch: number): FontGlyph | null {
    const ttf = this.font;
    if (ttf === null || !ttf.chars.has(ch)) {
      return null;
    }

    // PORT: SDL_ttf gives the metrics and the image of the glyph. Here the
    // glyph is drawn on a canvas of 3 x 3 em with the pen position at
    // (kGridSize, 2 * kGridSize); the bounds are those of its pixels.
    const size = 3 * kGridSize;
    if (Font.canvas === null) {
      Font.canvas = document.createElement('canvas');
      Font.canvas.width = size;
      Font.canvas.height = size;
    }
    const ctx = Font.canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) {
      return null;
    }
    const text = String.fromCodePoint(ch);
    ctx.clearRect(0, 0, size, size);
    ctx.font = kGridSize + 'px "' + ttf.family + '"';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    const advance = Math.round(ctx.measureText(text).width);
    ctx.fillText(text, kGridSize, 2 * kGridSize);
    const surf = ctx.getImageData(0, 0, size, size).data;

    const glyph = new FontGlyph();
    glyph.advance = Math.trunc(advance / 2);
    glyph.left = 0;
    glyph.top = 0;
    glyph.width = 0;
    glyph.height = 0;

    /* The image in the grid of 16 pixels per em, y from the top of the
       letters; the 2x2 blocks of the original pixels start at even
       coordinates. */
    /* The edges of the pixels overlap a little in the outlines: only
       the pixels mostly covered count. */
    let x0 = size;
    let x1 = -1;
    let y0 = size;
    let y1 = -1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (surf[(y * size + x) * 4 + 3] >= 0x80) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      }
    }
    if (x1 < 0) {
      return glyph; /* No pixels, the space. */
    }

    /* From the canvas to the grid: x from the pen position, the base line
       at kGridSize. */
    const gx0 = x0 - kGridSize;
    const gy0 = y0 - kGridSize;
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const bx = gx0 & ~1;
    const by = gy0 & ~1;
    glyph.left = bx / 2;
    glyph.top = by / 2;
    glyph.width = (gx0 + w - bx + 1) >> 1;
    glyph.height = (gy0 + h - by + 1) >> 1;

    const count = new Array<number>(glyph.width * glyph.height).fill(0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (surf[((y0 + y) * size + x0 + x) * 4 + 3] >= 0x80) {
          const px = (gx0 + x - bx) >> 1;
          const py = (gy0 + y - by) >> 1;
          count[py * glyph.width + px]++;
        }
      }
    }

    /* Scale2x changes at most one of the four pixels of an original one:
       two or more of them are a pixel. */
    glyph.pixels = count.map((c) => c >= 2);
    return glyph;
  }
}
