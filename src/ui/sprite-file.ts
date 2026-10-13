// sprite-file.h + sprite-file-sdl.cc - Sprite loaded from an image file.

import { Sprite } from '../data/sprite';
import { Log } from '../game/misc';

/* URL of a file of the game's own resources (public/resources). */
export function resourceUrl(name: string): string {
  return new URL('resources/' + name, document.baseURI).href;
}

interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export class SpriteFile extends Sprite {
  // PORT: images can only be decoded asynchronously in the browser, the
  // C++ load() is synchronous. The decoded files are kept here by URL:
  // preload() them at startup, load() then finds them. null: failed.
  protected static files = new Map<string, Pixels | null>();
  protected static pending = new Map<string, Promise<boolean>>();

  constructor() {
    super();
  }

  // PORT: not in the C++, see files.
  static preload(path: string): Promise<boolean> {
    const loaded = SpriteFile.files.get(path);
    if (loaded !== undefined) {
      return Promise.resolve(loaded !== null);
    }
    let promise = SpriteFile.pending.get(path);
    if (promise === undefined) {
      promise = SpriteFile.decode(path).then(
        (pixels) => {
          SpriteFile.files.set(path, pixels);
          SpriteFile.pending.delete(path);
          return pixels !== null;
        },
        (e) => {
          Log.Warn('graphics', 'Failed to load image ' + path, e);
          SpriteFile.files.set(path, null);
          SpriteFile.pending.delete(path);
          return false;
        },
      );
      SpriteFile.pending.set(path, promise);
    }
    return promise;
  }

  // PORT: not in the C++, see files.
  static preloadResource(name: string): Promise<boolean> {
    return SpriteFile.preload(resourceUrl(name));
  }

  protected static async decode(path: string): Promise<Pixels | null> {
    const response = await fetch(path);
    if (!response.ok) {
      return null;
    }
    const bitmap = await createImageBitmap(await response.blob(), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null || bitmap.width === 0 || bitmap.height === 0) {
      return null;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: image.width, height: image.height, data: image.data };
  }

  load(path: string): boolean {
    const pixels = SpriteFile.files.get(path);
    if (pixels === undefined) {
      // PORT: not decoded yet. Start that now, so that a later drawing
      // finds the image.
      void SpriteFile.preload(path);
      return false;
    }
    if (pixels === null) {
      return false;
    }
    this.width = pixels.width;
    this.height = pixels.height;
    this.data = new Uint8ClampedArray(pixels.data);
    return true;
  }

  /* Load an image of the game's own resources (the resources folder next
     to the program, in the bundle resources on macOS). */
  loadResource(name: string): boolean {
    return this.load(resourceUrl(name));
  }

  setDelta(x: number, y: number): void {
    this.deltaX = x;
    this.deltaY = y;
  }

  setOffset(x: number, y: number): void {
    this.offsetX = x;
    this.offsetY = y;
  }
}

export type PSpriteFile = SpriteFile;
