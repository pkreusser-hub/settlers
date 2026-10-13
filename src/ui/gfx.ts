// gfx.h + gfx.cc - General graphics and data file functions

import type { Asset } from '../data/data';
import type { DataSourceDOS } from '../data/data-source-dos';
import { Color as SpriteColor, Sprite } from '../data/sprite';
import { ExceptionFreeserf, Log } from '../game/misc';
import { Data } from './data-instance';
import { Font, FontGlyph } from './font';
import { SpriteFile } from './sprite-file';
import { ExceptionVideo, Video, VideoColor, VideoFrame, VideoImage } from './video';

export class ExceptionGFX extends ExceptionFreeserf {
  constructor(description: string) {
    super(description);
  }

  getSystem(): string {
    return 'graphics';
  }
}

export class Color {
  protected r: number;
  protected g: number;
  protected b: number;
  protected a: number;

  // Color() and Color(r, g, b, a = 0xff).
  // PORT: the constructor from cyan, magenta, yellow and key is
  // Color.fromCMYK().
  constructor(r?: number, g?: number, b?: number, a = 0xff) {
    if (r === undefined || g === undefined || b === undefined) {
      this.r = 0;
      this.g = 0;
      this.b = 0;
      this.a = 0;
    } else {
      this.r = r & 0xff;
      this.g = g & 0xff;
      this.b = b & 0xff;
      this.a = a & 0xff;
    }
  }

  static fromCMYK(c: number, m: number, y: number, k: number, a: number): Color {
    return new Color(
      Math.trunc(255 * (1 - c) * (1 - k)),
      Math.trunc(255 * (1 - m) * (1 - k)),
      Math.trunc(255 * (1 - y) * (1 - k)),
      a,
    );
  }

  getRed(): number {
    return this.r;
  }

  getGreen(): number {
    return this.g;
  }

  getBlue(): number {
    return this.b;
  }

  getAlpha(): number {
    return this.a;
  }

  getCyan(): number {
    const k = this.getKey();
    return (1 - this.r / 255 - k) / (1 - k);
  }

  getMagenta(): number {
    const k = this.getKey();
    return (1 - this.g / 255 - k) / (1 - k);
  }

  getYellow(): number {
    const k = this.getKey();
    return (1 - this.b / 255 - k) / (1 - k);
  }

  getKey(): number {
    return 1 - Math.max(this.r / 255, Math.max(this.g / 255, this.b / 255));
  }

  static readonly black = new Color(0x00, 0x00, 0x00);
  static readonly white = new Color(0xff, 0xff, 0xff);
  static readonly green = new Color(0x73, 0xb3, 0x43);
  static readonly transparent = new Color(0x00, 0x00, 0x00, 0x00);

  // operator== (and !equals() for operator!=).
  equals(c: Color): boolean {
    return this.r === c.r && this.g === c.g && this.b === c.b && this.a === c.a;
  }
}

// PORT: the uint64_t identifier of a cached image. JS numbers hold 53 bits,
// so the same 64 bits are kept as two halves of 32 bits.
export class ImageId {
  constructor(
    readonly hi: number,
    readonly lo: number,
  ) {}
}

// Calculate hash of sprite identifier.
// PORT: Data::Sprite::create_id() of data-source.cc.
export function createId(
  resource: number,
  index: number,
  maskResource: number,
  maskIndex: number,
  color: SpriteColor,
): ImageId {
  // 0xFF00000000000000
  let hi = (resource & 0xff) << 24;
  // 0x00FFF00000000000
  hi |= (index & 0xfff) << 12;
  // 0x00000FF000000000
  hi |= (maskResource & 0xff) << 4;
  // 0x0000000FFF000000
  hi |= (maskIndex & 0xfff) >>> 8;
  let lo = (maskIndex & 0xff) << 24;
  // 0x0000000000FF0000
  lo |= (color.red & 0xff) << 16;
  // 0x000000000000FF00
  lo |= (color.green & 0xff) << 8;
  // 0x00000000000000FF
  lo |= (color.blue & 0xff) << 0;
  return new ImageId(hi >>> 0, lo >>> 0);
}

export class Image {
  protected deltaX: number;
  protected deltaY: number;
  protected offsetX: number;
  protected offsetY: number;
  protected width: number;
  protected height: number;
  protected video: Video | null;
  protected videoImage: VideoImage | null;

  /* Sprite cache hash table */
  // PORT: by the two halves of the identifier.
  protected static imageCache = new Map<number, Map<number, Image>>();

  constructor(video: Video, sprite: Sprite) {
    this.video = video;
    this.width = sprite.width;
    this.height = sprite.height;
    this.offsetX = sprite.offsetX;
    this.offsetY = sprite.offsetY;
    this.deltaX = sprite.deltaX;
    this.deltaY = sprite.deltaY;
    this.videoImage = video.createImage(sprite.data, this.width, this.height);
  }

  // PORT: the destructor.
  destroy(): void {
    if (this.videoImage !== null && this.video !== null) {
      this.video.destroyImage(this.videoImage);
      this.videoImage = null;
    }
    this.video = null;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  getDeltaX(): number {
    return this.deltaX;
  }

  getDeltaY(): number {
    return this.deltaY;
  }

  getOffsetX(): number {
    return this.offsetX;
  }

  getOffsetY(): number {
    return this.offsetY;
  }

  setOffset(x: number, y: number): void {
    this.offsetX = x;
    this.offsetY = y;
  }

  setDelta(x: number, y: number): void {
    this.deltaX = x;
    this.deltaY = y;
  }

  static cacheImage(id: ImageId, image: Image): void {
    let images = Image.imageCache.get(id.hi);
    if (images === undefined) {
      images = new Map<number, Image>();
      Image.imageCache.set(id.hi, images);
    }
    images.set(id.lo, image);
  }

  /* Return a pointer to the sprite pointer associated with id. */
  static getCachedImage(id: ImageId): Image | null {
    const images = Image.imageCache.get(id.hi);
    if (images === undefined) {
      return null;
    }
    const result = images.get(id.lo);
    if (result === undefined) {
      return null;
    }
    return result;
  }

  static clearCache(): void {
    for (const images of Image.imageCache.values()) {
      for (const image of images.values()) {
        image.destroy();
      }
    }
    Image.imageCache.clear();
  }

  getVideoImage(): VideoImage {
    return this.videoImage as VideoImage;
  }
}

const spriteOffsetFromAscii = [
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, 43, -1, -1,
  -1, -1, -1, -1, -1, 40, 39, -1,
  29, 30, 31, 32, 33, 34, 35, 36,
  37, 38, 41, -1, -1, -1, -1, 42,
  -1,  0,  1,  2,  3,  4,  5,  6,
   7,  8,  9, 10, 11, 12, 13, 14,
  15, 16, 17, 18, 19, 20, 21, 22,
  23, 24, 25, -1, -1, -1, -1, -1,
  -1,  0,  1,  2,  3,  4,  5,  6,
   7,  8,  9, 10, 11, 12, 13, 14,
  15, 16, 17, 18, 19, 20, 21, 22,
  23, 24, 25, -1, -1, -1, -1, -1,

  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1,
];

/* A glyph of the font in one color, or its shadow: the glyph moved by a
   pixel left, right, up and down, as the shadow sprites of the font. */
function spriteGlyph(glyph: FontGlyph, color: SpriteColor, shadow: boolean): Sprite {
  const border = shadow ? 1 : 0;
  const sprite = Sprite.create(glyph.width + 2 * border, glyph.height + 2 * border);
  sprite.fill({ red: 0, green: 0, blue: 0, alpha: 0 });
  sprite.offsetX = glyph.left - border;
  sprite.offsetY = glyph.top - border;
  const width = sprite.width;
  const pixels = sprite.data;
  const set = (i: number): void => {
    pixels[i * 4] = color.red;
    pixels[i * 4 + 1] = color.green;
    pixels[i * 4 + 2] = color.blue;
    pixels[i * 4 + 3] = color.alpha;
  };
  for (let y = 0; y < glyph.height; y++) {
    for (let x = 0; x < glyph.width; x++) {
      if (!glyph.get(x, y)) continue;
      if (shadow) {
        set((y + 1) * width + x);
        set((y + 1) * width + x + 2);
        set(y * width + x + 1);
        set((y + 2) * width + x + 1);
      } else {
        set(y * width + x);
      }
    }
  }
  return sprite;
}

/* The glyph of a character, a question mark for one the font has not. */
function getGlyph(font: Font, ch: number): FontGlyph | null {
  const glyph = font.getGlyph(ch);
  return glyph !== null ? glyph : font.getGlyph(0x3f /* '?' */);
}

/* The Unicode characters of a line of UTF-8; a byte that is not UTF-8 is
   the character of its value (Latin-1). A tab is two spaces. */
// PORT: the strings of JS are UTF-16, their code points are taken.
function splitLines(str: string): number[][] {
  const lines: number[][] = [[]];
  for (const c of str) {
    const ch = c.codePointAt(0) as number;

    if (ch === 0x0a /* '\n' */) {
      lines.push([]);
    } else if (ch === 0x09 /* '\t' */) {
      lines[lines.length - 1].push(0x20, 0x20);
    } else {
      lines[lines.length - 1].push(ch);
    }
  }
  return lines;
}

/* std::hash of a name, in two halves of 32 bits. */
// PORT: std::hash is not specified; FNV-1a with two different seeds.
function hashString(name: string): [number, number] {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  return [h1 >>> 0, h2 >>> 0];
}

function videoColor(color: Color): VideoColor {
  return {
    r: color.getRed(),
    g: color.getGreen(),
    b: color.getBlue(),
    a: color.getAlpha(),
  };
}

const noColor: SpriteColor = { red: 0, green: 0, blue: 0, alpha: 0 };

/* Frame. Keeps track of a specific rectangular area of a surface.
   Multiple frames can refer to the same surface. */
export class Frame {
  protected video: Video;
  protected videoFrame: VideoFrame | null;
  protected owner: boolean;
  protected dataSource: DataSourceDOS;

  /* Initialize new graphics frame. If dest is NULL a new
     backing surface is created, otherwise the same surface
     as dest is used. */
  // Frame(video, width, height) and Frame(video, video_frame).
  constructor(video: Video, width: number, height: number);
  constructor(video: Video, videoFrame: VideoFrame);
  constructor(video: Video, widthOrVideoFrame: number | VideoFrame, height?: number) {
    this.video = video;
    if (typeof widthOrVideoFrame === 'number') {
      this.videoFrame = video.createFrame(widthOrVideoFrame, height as number);
      this.owner = true;
    } else {
      this.videoFrame = widthOrVideoFrame;
      this.owner = false;
    }
    this.dataSource = Data.getInstance().getDataSource();
  }

  /* Deinitialize frame and backing surface. */
  // PORT: the destructor; call it where the C++ deletes a frame.
  destroy(): void {
    if (this.owner && this.videoFrame !== null) {
      this.video.destroyFrame(this.videoFrame);
    }
    this.videoFrame = null;
  }

  // PORT: not in the C++. The canvas of the frame and its context, null
  // after destroy().
  getCanvas(): HTMLCanvasElement | OffscreenCanvas | null {
    return this.videoFrame !== null ? this.videoFrame.texture : null;
  }

  getContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
    return this.videoFrame !== null ? this.videoFrame.ctx : null;
  }

  /* Sprite functions */

  /* Draw the opaque sprite with data file index of
     sprite at x, y in dest frame. */
  // The overloads of the C++:
  //   draw_sprite(x, y, res, index)
  //   draw_sprite(x, y, res, index, use_off)
  //   draw_sprite(x, y, res, index, use_off, progress)
  //   draw_sprite(x, y, res, index, use_off, color)
  //   draw_sprite(x, y, res, index, use_off, color, progress)
  drawSprite(
    x: number,
    y: number,
    res: Asset,
    index: number,
    useOff = false,
    colorOrProgress: Color | number = Color.transparent,
    progress = 1,
  ): void {
    let color: Color;
    if (typeof colorOrProgress === 'number') {
      color = Color.transparent;
      progress = colorOrProgress;
    } else {
      color = colorOrProgress;
    }
    if (this.videoFrame === null) return;

    const pc: SpriteColor = {
      blue: color.getBlue(),
      green: color.getGreen(),
      red: color.getRed(),
      alpha: color.getAlpha(),
    };
    const id = createId(res, index, 0, 0, pc);
    let image = Image.getCachedImage(id);
    if (image === null) {
      const s = this.dataSource.getSprite(res, index, pc);
      if (!s) {
        Log.Warn('graphics', 'Failed to decode sprite #' + Data.getResourceName(res) + ':' + index);
        return;
      }

      image = new Image(this.video, s);
      Image.cacheImage(id, image);
    }

    if (useOff) {
      x += image.getOffsetX();
      y += image.getOffsetY();
    }
    const yOff = image.getHeight() - Math.trunc(Math.fround(image.getHeight() * Math.fround(progress)));
    this.video.drawImage(image.getVideoImage(), x, y, yOff, this.videoFrame);
  }

  drawSpriteRelatively(
    x: number,
    y: number,
    res: Asset,
    index: number,
    relativeToRes: Asset,
    relativeToIndex: number,
  ): void {
    const s = this.dataSource.getSprite(relativeToRes, relativeToIndex, noColor);
    if (s === null) {
      Log.Warn('graphics', 'Failed to decode sprite #' + Data.getResourceName(res) + ':' + index);
      return;
    }

    x += s.deltaX;
    y += s.deltaY;

    this.drawSprite(x, y, res, index, true, Color.transparent, 1);
  }

  /* Draw the masked sprite with given mask and sprite
     indices at x, y in dest frame. */
  drawMaskedSprite(
    x: number,
    y: number,
    maskRes: Asset,
    maskIndex: number,
    res: Asset,
    index: number,
  ): void {
    if (this.videoFrame === null) return;

    const id = createId(res, index, maskRes, maskIndex, noColor);
    let image = Image.getCachedImage(id);
    if (image === null) {
      let s = this.dataSource.getSprite(res, index, noColor);
      if (!s) {
        Log.Warn('graphics', 'Failed to decode sprite #' + Data.getResourceName(res) + ':' + index);
        return;
      }

      const m = this.dataSource.getSprite(maskRes, maskIndex, noColor);
      if (!m) {
        Log.Warn(
          'graphics',
          'Failed to decode sprite #' + Data.getResourceName(maskRes) + ':' + maskIndex,
        );
        return;
      }

      // PORT: data_source->apply_mask() of the DOS data source is
      // DataSourceBase::apply_mask(), which is sprite->get_masked(mask).
      let masked: Sprite | null = null;
      try {
        masked = s.getMasked(m);
      } catch (e) {
        masked = null;
      }
      if (!masked) {
        Log.Warn(
          'graphics',
          'Failed to apply mask #' + Data.getResourceName(maskRes) + ':' + maskIndex +
            ' to sprite #' + Data.getResourceName(res) + ':' + index,
        );
        return;
      }

      s = masked;

      image = new Image(this.video, s);
      Image.cacheImage(id, image);
    }

    x += image.getOffsetX();
    y += image.getOffsetY();
    this.video.drawImage(image.getVideoImage(), x, y, 0, this.videoFrame);
  }

  /* Draw the waves sprite with given mask and sprite
     indices at x, y in dest frame. */
  drawWavesSprite(
    x: number,
    y: number,
    maskRes: Asset,
    maskIndex: number,
    res: Asset,
    index: number,
  ): void {
    if (this.videoFrame === null) return;

    const id = createId(res, index, maskRes, maskIndex, noColor);
    let image = Image.getCachedImage(id);
    if (image === null) {
      let s = this.dataSource.getSprite(res, index, noColor);
      if (!s) {
        Log.Warn('graphics', 'Failed to decode sprite #' + Data.getResourceName(res) + ':' + index);
        return;
      }

      if (maskRes > 0) {
        const m = this.dataSource.getSprite(maskRes, maskIndex, noColor);
        if (!m) {
          Log.Warn(
            'graphics',
            'Failed to decode sprite #' + Data.getResourceName(maskRes) + ':' + maskIndex,
          );
          return;
        }

        let masked: Sprite | null = null;
        try {
          masked = s.getMasked(m);
        } catch (e) {
          masked = null;
        }
        if (!masked) {
          Log.Warn(
            'graphics',
            'Failed to apply mask #' + Data.getResourceName(maskRes) + ':' + maskIndex +
              ' to sprite #' + Data.getResourceName(res) + ':' + index,
          );
          return;
        }

        s = masked;
      }

      image = new Image(this.video, s);
      Image.cacheImage(id, image);
    }

    x += image.getOffsetX();
    y += image.getOffsetY();
    this.video.drawImage(image.getVideoImage(), x, y, 0, this.videoFrame);
  }

  /* Draw a character at x, y in the dest frame. */
  protected drawCharSprite(x: number, y: number, c: number, color: Color, shadow: Color): void {
    const s = spriteOffsetFromAscii[c];
    if (s < 0) return;

    if (!shadow.equals(Color.transparent)) {
      this.drawSprite(x, y, Data.Resource.AssetFontShadow, s, false, shadow);
    }
    this.drawSprite(x, y, Data.Resource.AssetFont, s, false, color);
  }

  /* Draw a glyph of the font, returns its advance. */
  protected drawGlyph(x: number, y: number, ch: number, color: Color, shadow: Color): number {
    const font = Graphics.getInstance().getFont();
    if (font === null || this.videoFrame === null) return 0;
    const glyph = getGlyph(font, ch);
    if (glyph === null) return 0;
    if (glyph.width === 0) return glyph.advance; /* A space. */

    for (let pass = !shadow.equals(Color.transparent) ? 0 : 1; pass < 2; pass++) {
      const c = pass === 0 ? shadow : color;
      const pc: SpriteColor = {
        blue: c.getBlue(),
        green: c.getGreen(),
        red: c.getRed(),
        alpha: c.getAlpha(),
      };
      /* Cached apart from the sprites of the game data (bit 62), the
         shadows apart from the glyphs (bit 61). */
      const id = new ImageId(
        ((1 << 30) | ((pass === 0 ? 1 : 0) << 29) | ((ch & 0x1fffff) >>> 8)) >>> 0,
        (((ch & 0xff) << 24) | (pc.red << 16) | (pc.green << 8) | pc.blue) >>> 0,
      );
      let image = Image.getCachedImage(id);
      if (image === null) {
        image = new Image(this.video, spriteGlyph(glyph, pc, pass === 0));
        Image.cacheImage(id, image);
      }
      this.video.drawImage(
        image.getVideoImage(),
        x + image.getOffsetX(),
        y + image.getOffsetY(),
        0,
        this.videoFrame,
      );
    }
    return glyph.advance;
  }

  /* Text functions. The texts are UTF-8, a line of 8 pixels high per
     '\n'. The letters are proportional: a part of a line after spaces is
     centred where it was with the 8 pixels wide letters of the original
     font, as the texts are laid out for them. */

  /* Draw the string str at x, y in the dest frame. */
  drawString(x: number, y: number, str: string, color: Color, shadow: Color = Color.transparent): void {
    const font = Graphics.getInstance().getFont();
    for (const line of splitLines(str)) {
      if (font === null) {
        /* The font sprites of the game data, 8 pixels wide. */
        for (let i = 0; i < line.length; i++) {
          if (line[i] < 0x100) {
            this.drawCharSprite(x + 8 * i, y, line[i], color, shadow);
          }
        }
        y += 8;
        continue;
      }

      /* Parts of the line: words with one space between them. */
      let start = 0;
      while (start < line.length) {
        if (line[start] === 0x20) {
          start++;
          continue;
        }
        let end = start;
        while (
          end < line.length &&
          (line[end] !== 0x20 || (end + 1 < line.length && line[end + 1] !== 0x20))
        ) {
          end++;
        }

        let width = 0;
        for (let i = start; i < end; i++) {
          const glyph = getGlyph(font, line[i]);
          width += glyph !== null ? glyph.advance : 0;
        }
        /* The first part at x, the others centred where they were. */
        let cx = x;
        if (start > 0) {
          cx += 4 * (start + end) - Math.trunc(width / 2);
        }
        for (let i = start; i < end; i++) {
          cx += this.drawGlyph(cx, y, line[i], color, shadow);
        }
        start = end;
      }
      y += 8;
    }
  }

  /* Draw the number n at x, y in the dest frame. */
  drawNumber(x: number, y: number, value: number, color: Color, shadow: Color = Color.transparent): void {
    this.drawString(x, y, String(Math.trunc(value)), color, shadow);
  }

  /* Width of the longest line of str. */
  getStringWidth(str: string): number {
    const font = Graphics.getInstance().getFont();
    let result = 0;
    for (const line of splitLines(str)) {
      let width = 0;
      for (const ch of line) {
        if (font === null) {
          width += 8;
        } else {
          const glyph = getGlyph(font, ch);
          width += glyph !== null ? glyph.advance : 0;
        }
      }
      result = Math.max(result, width);
    }
    return result;
  }

  /* Drawing functions */

  /* Draw a rectangle with color at x, y in the dest frame. */
  drawRect(x: number, y: number, width: number, height: number, color: Color): void {
    if (this.videoFrame === null) return;
    const c = videoColor(color);
    this.video.drawRect(x, y, width, height, c, this.videoFrame);
  }

  /* Draw a rectangle with color at x, y in the dest frame. */
  fillRect(x: number, y: number, width: number, height: number, color: Color): void {
    if (this.videoFrame === null) return;
    const c = videoColor(color);
    this.video.fillRect(x, y, width, height, c, this.videoFrame);
  }

  drawLine(x: number, y: number, x1: number, y1: number, color: Color): void {
    if (this.videoFrame === null) return;
    const c = videoColor(color);
    this.video.drawLine(x, y, x1, y1, c, this.videoFrame);
  }

  /* Frame functions */

  /* Draw source frame from rectangle at sx, sy with given
     width and height, to destination frame at dx, dy. */
  drawFrame(dx: number, dy: number, sx: number, sy: number, src: Frame, w: number, h: number): void {
    if (this.videoFrame === null || src.videoFrame === null) return;
    this.video.drawFrame(dx, dy, this.videoFrame, sx, sy, src.videoFrame, w, h);
  }

  /* Draw an image of the game's resources folder (not original data). */
  // PORT: returns whether the image was there to draw.
  drawResourceImage(x: number, y: number, name: string): boolean {
    if (this.videoFrame === null) return false;
    /* Cached apart from the sprites of the game data (bit 63). */
    const [h1, h2] = hashString(name);
    const id = new ImageId((0x80000000 | (h1 >>> 1)) >>> 0, h2);
    let image = Image.getCachedImage(id);
    if (image === null) {
      const sprite = new SpriteFile();
      if (!sprite.loadResource(name)) {
        return false;
      }
      image = new Image(this.video, sprite);
      Image.cacheImage(id, image);
    }
    this.video.drawImage(image.getVideoImage(), x, y, 0, this.videoFrame);
    return true;
  }

  drawFrameScaled(dx: number, dy: number, dw: number, dh: number, src: Frame, w: number, h: number): void {
    if (this.videoFrame === null || src.videoFrame === null) return;
    this.video.drawFrameScaled(dx, dy, dw, dh, this.videoFrame, src.videoFrame, w, h);
  }
}

export class Graphics {
  protected static instance: Graphics | null = null;
  protected video: Video;
  /* Magnification of the map view on top of the screen zoom. */
  protected mapZoom: number;
  /* The font of the texts; the font sprites of the game data without it. */
  protected font: Font | null;

  protected constructor() {
    this.mapZoom = 1;
    if (Graphics.instance !== null) {
      throw new ExceptionGFX('Unable to create second instance.');
    }

    try {
      this.video = Video.getInstance();
    } catch (e) {
      if (e instanceof ExceptionVideo) {
        throw new ExceptionGFX(e.message);
      }
      throw e;
    }

    this.setCursorFromData();

    // PORT: found only when the font was loaded before with
    // Font.preloadResource('settlers.ttf'), see preloadResources().
    this.font = new Font();
    if (!this.font.loadResource('settlers.ttf')) {
      Log.Warn(
        'graphics',
        'Failed to load the font settlers.ttf, the ' +
          'texts are drawn with the font of the game data',
      );
      this.font = null;
    }

    Graphics.instance = this;
  }

  protected setCursorFromData(): void {
    const dataSource = Data.getInstance().getDataSource();
    const sprite = dataSource.getSprite(Data.Resource.AssetCursor, 0, noColor);
    if (sprite) {
      this.video.setCursor(sprite.data, sprite.width, sprite.height);
    }
  }

  /* The graphics now come from another data source: forget the images
     and take the cursor from it. */
  dataChanged(): void {
    Image.clearCache();
    this.setCursorFromData();
  }

  static getInstance(): Graphics {
    if (Graphics.instance === null) {
      new Graphics();
    }
    return Graphics.instance as Graphics;
  }

  // PORT: not in the C++, which loads these files in the constructor of
  // Graphics and at the first drawing. Await it once at startup, after the
  // game data and before the first Graphics.getInstance(). Without it the
  // texts are drawn with the font sprites of the game data.
  static async preloadResources(): Promise<void> {
    await Promise.all([
      Font.preloadResource('settlers.ttf'),
      SpriteFile.preloadResource('button-advanced.png'),
    ]);
  }

  /* Frame functions */
  createFrame(width: number, height: number): Frame {
    return new Frame(this.video, width, height);
  }

  /* Screen functions */
  getScreenFrame(): Frame {
    return new Frame(this.video, this.video.getScreenFrame());
  }

  setResolution(width: number, height: number, fullscreen: boolean): void {
    this.video.setResolution(width, height, fullscreen);
  }

  // PORT: out-parameters become the result [width, height].
  getResolution(): [number, number] {
    return this.video.getResolution();
  }

  /* Enable or disable fullscreen mode */
  setFullscreen(enable: boolean): void {
    this.video.setFullscreen(enable);
  }

  /* Check whether fullscreen mode is enabled */
  isFullscreen(): boolean {
    return this.video.isFullscreen();
  }

  swapBuffers(): void {
    this.video.swapBuffers();
  }

  getZoomFactor(): number {
    return this.video.getZoomFactor();
  }

  setZoomFactor(factor: number): boolean {
    return this.video.setZoomFactor(factor);
  }

  getFont(): Font | null {
    return this.font;
  }

  getMapZoom(): number {
    return this.mapZoom;
  }

  setMapZoom(zoom: number): void {
    this.mapZoom = zoom;
  }

  // PORT: out-parameters become the result [fx, fy].
  getScreenFactor(): [number, number] {
    return this.video.getScreenFactor();
  }
}
