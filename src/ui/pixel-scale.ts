// Pixel-art magnification of a finished picture, for the "Smooth" mode of
// the map view.
//
// PORT: not in the C++.
//
// Scale2x and Scale3x (the EPX family, as AdvanceMAME names them): each
// pixel becomes a block of 2 x 2 or 3 x 3. A pixel of the block takes the
// colour of two neighbours of the source pixel when those two are equal and
// form a corner, so the steps of a diagonal edge are cut; everywhere else
// the block is the source pixel. No colour is mixed.
//
// The pixels are whole 32 bit RGBA values and are only compared for
// equality, so the alpha is part of the comparison: a transparent pixel is
// a colour like any other and no colour bleeds out of it.

/* src: w x h pixels; dst: 2w x 2h pixels. */
export function scale2x(src: Uint32Array, w: number, h: number, dst: Uint32Array): void {
  const dw = 2 * w;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const up = y > 0 ? row - w : row;
    const down = y < h - 1 ? row + w : row;
    let o0 = 2 * y * dw;
    let o1 = o0 + dw;
    for (let x = 0; x < w; x++) {
      const e = src[row + x];
      const b = src[up + x];
      const hh = src[down + x];
      const d = x > 0 ? src[row + x - 1] : e;
      const f = x < w - 1 ? src[row + x + 1] : e;
      if (b !== hh && d !== f) {
        dst[o0] = d === b ? d : e;
        dst[o0 + 1] = b === f ? f : e;
        dst[o1] = d === hh ? d : e;
        dst[o1 + 1] = hh === f ? f : e;
      } else {
        dst[o0] = e;
        dst[o0 + 1] = e;
        dst[o1] = e;
        dst[o1 + 1] = e;
      }
      o0 += 2;
      o1 += 2;
    }
  }
}

/* src: w x h pixels; dst: 3w x 3h pixels. */
export function scale3x(src: Uint32Array, w: number, h: number, dst: Uint32Array): void {
  const dw = 3 * w;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const up = y > 0 ? row - w : row;
    const down = y < h - 1 ? row + w : row;
    let o0 = 3 * y * dw;
    let o1 = o0 + dw;
    let o2 = o1 + dw;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : x;
      const xr = x < w - 1 ? x + 1 : x;
      const e = src[row + x];
      const b = src[up + x];
      const hh = src[down + x];
      const d = src[row + xl];
      const f = src[row + xr];
      if (b !== hh && d !== f) {
        const a = src[up + xl];
        const c = src[up + xr];
        const g = src[down + xl];
        const i = src[down + xr];
        const db = d === b;
        const bf = b === f;
        const dh = d === hh;
        const hf = hh === f;
        dst[o0] = db ? d : e;
        dst[o0 + 1] = (db && e !== c) || (bf && e !== a) ? b : e;
        dst[o0 + 2] = bf ? f : e;
        dst[o1] = (db && e !== g) || (dh && e !== a) ? d : e;
        dst[o1 + 1] = e;
        dst[o1 + 2] = (bf && e !== i) || (hf && e !== c) ? f : e;
        dst[o2] = dh ? d : e;
        dst[o2 + 1] = (dh && e !== i) || (hf && e !== g) ? hh : e;
        dst[o2 + 2] = hf ? f : e;
      } else {
        dst[o0] = e;
        dst[o0 + 1] = e;
        dst[o0 + 2] = e;
        dst[o1] = e;
        dst[o1 + 1] = e;
        dst[o1 + 2] = e;
        dst[o2] = e;
        dst[o2 + 1] = e;
        dst[o2 + 2] = e;
      }
      o0 += 3;
      o1 += 3;
      o2 += 3;
    }
  }
}

/* Magnifies pictures by 2, 3 or 4 and keeps its buffers between the calls,
   as the map view does it for every picture it draws. */
export class PixelScaler {
  protected half: Uint32Array | null = null;
  protected output: ImageData | null = null;

  /* The factor for a picture that is shown with pixelSize device pixels
     per pixel: the pixel size itself when it is 2, 3 or 4, the next one
     above it otherwise (the rest is done by interpolation). */
  static factorFor(pixelSize: number): number {
    if (pixelSize <= 2) return 2;
    if (pixelSize <= 3) return 3;
    return 4;
  }

  /* The picture of the RGBA bytes of src (w x h) magnified by factor. The
     result is valid until the next call. */
  scale(src: Uint8ClampedArray, w: number, h: number, factor: number): ImageData {
    const ow = w * factor;
    const oh = h * factor;
    if (this.output === null || this.output.width !== ow || this.output.height !== oh) {
      this.output = new ImageData(ow, oh);
    }
    const from = new Uint32Array(src.buffer, src.byteOffset, w * h);
    const to = new Uint32Array(this.output.data.buffer);
    if (factor === 2) {
      scale2x(from, w, h, to);
    } else if (factor === 3) {
      scale3x(from, w, h, to);
    } else {
      /* Four times: twice by two. */
      if (this.half === null || this.half.length !== 4 * w * h) {
        this.half = new Uint32Array(4 * w * h);
      }
      scale2x(from, w, h, this.half);
      scale2x(this.half, 2 * w, 2 * h, to);
    }
    return this.output;
  }

  /* Free the buffers. */
  clear(): void {
    this.half = null;
    this.output = null;
  }
}
