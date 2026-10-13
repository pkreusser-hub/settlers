// Sprite pixel container. Port of Freeserf's SpriteBase, except pixels are
// stored RGBA (canvas order) instead of BGRA.

export interface Color {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

export class Sprite {
  deltaX = 0;
  deltaY = 0;
  offsetX = 0;
  offsetY = 0;
  width = 0;
  height = 0;
  data: Uint8ClampedArray = new Uint8ClampedArray(0);

  static create(w: number, h: number): Sprite {
    const s = new Sprite();
    s.width = w;
    s.height = h;
    s.data = new Uint8ClampedArray(w * h * 4);
    return s;
  }

  // Empty sprite with the geometry of base.
  static like(base: Sprite): Sprite {
    const s = Sprite.create(base.width, base.height);
    s.deltaX = base.deltaX;
    s.deltaY = base.deltaY;
    s.offsetX = base.offsetX;
    s.offsetY = base.offsetY;
    return s;
  }

  private get words(): Uint32Array {
    return new Uint32Array(this.data.buffer, this.data.byteOffset, this.width * this.height);
  }

  // Apply mask to map tile sprite. The result is extended to the height of
  // the mask by repeating lines from the top of the sprite.
  getMasked(mask: Sprite): Sprite {
    if (mask.width > this.width) {
      throw new Error('Failed to apply mask to sprite');
    }

    const masked = Sprite.like(mask);
    const pos = masked.words;
    const src = this.words;
    const m = mask.words;
    const sEnd = this.width * this.height;
    const sDelta = this.width - masked.width;

    let p = 0;
    let s = 0;
    for (let y = 0; y < masked.height; y++) {
      for (let x = 0; x < masked.width; x++) {
        if (s >= sEnd) s = 0;
        pos[p] = src[s++] & m[p];
        p++;
      }
      s += sDelta;
    }

    return masked;
  }

  // Mask of the pixels that differ between this sprite and other.
  createMask(other: Sprite): Sprite | null {
    if (this.width !== other.width || this.height !== other.height) {
      return null;
    }

    const result = Sprite.like(this);
    const a = this.words;
    const b = other.words;
    const res = result.words;
    for (let i = 0; i < a.length; i++) {
      res[i] = a[i] === b[i] ? 0x00000000 : 0xffffffff;
    }
    return result;
  }

  fill(color: Color): void {
    const d = this.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = color.red;
      d[i + 1] = color.green;
      d[i + 2] = color.blue;
      d[i + 3] = color.alpha;
    }
  }

  fillMasked(color: Color): void {
    const d = this.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] !== 0) {
        d[i] = color.red;
        d[i + 1] = color.green;
        d[i + 2] = color.blue;
        d[i + 3] = color.alpha;
      }
    }
  }

  del(other: Sprite): void {
    if (this.width !== other.width || this.height !== other.height) return;
    const src = other.words;
    const res = this.words;
    for (let i = 0; i < res.length; i++) {
      if (src[i] === 0xffffffff) res[i] = 0;
    }
  }

  blend(other: Sprite): void {
    if (this.width !== other.width || this.height !== other.height) return;

    const c = this.data;
    const o = other.data;
    for (let i = 0; i < c.length; i += 4) {
      const alpha = o[i + 3];
      if (alpha === 0x00) continue;

      if (alpha === 0xff) {
        c[i] = o[i];
        c[i + 1] = o[i + 1];
        c[i + 2] = o[i + 2];
        c[i + 3] = 0xff;
        continue;
      }

      for (let k = 0; k < 3; k++) {
        const front = Math.trunc((0xff * o[i + k]) / alpha) & 0xff;
        c[i + k] = Math.trunc((front * alpha + c[i + k] * (0xff - alpha)) / 0xff);
      }
      c[i + 3] = 0xff;
    }

    this.deltaX = other.deltaX;
    this.deltaY = other.deltaY;
  }

  makeAlphaMask(): void {
    const c = this.data;
    let min = 0xff;
    for (let i = 0; i < c.length; i += 4) {
      if (c[i + 3] !== 0x00) {
        const lum = Math.trunc(0.21 * c[i] + 0.72 * c[i + 1] + 0.07 * c[i + 2]) & 0xff;
        c[i + 3] = 0xff - lum;
        c[i] = 0;
        c[i + 1] = 0;
        c[i + 2] = 0;
        min = Math.min(min, c[i + 3]);
      }
    }

    for (let i = 0; i < c.length; i += 4) {
      if (c[i + 3] !== 0x00) c[i + 3] -= min;
    }
  }

  // Paint the opaque pixels of sticker over this sprite.
  stick(sticker: Sprite, dx: number, dy: number): void {
    const base = this.words;
    const stkr = sticker.words;
    const w = Math.min(this.width, sticker.width);
    const h = Math.min(this.height, sticker.height);

    for (let y = 0; y < h; y++) {
      let b = (dy + y) * this.width + dx;
      let s = y * sticker.width;
      for (let x = 0; x < w; x++, b++, s++) {
        if (sticker.data[s * 4 + 3] !== 0x00) base[b] = stkr[s];
      }
    }

    this.deltaX = sticker.deltaX;
    this.deltaY = sticker.deltaY;
  }

  toImageData(): ImageData {
    return new ImageData(this.data as Uint8ClampedArray<ArrayBuffer>, this.width, this.height);
  }
}
