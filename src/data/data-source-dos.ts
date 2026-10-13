// Reader for the original DOS data file (SPAE.PA). Port of Freeserf's
// data-source-dos.cc, data-source-legacy.cc, tpwm.cc and the sprite
// assembly in data-source.cc.

import { Buffer } from './buffer';
import { Animation, Asset, getResourceCount } from './data';
import { Color, Sprite } from './sprite';
import { Log } from '../game/misc';
import { ConvertorSFX2WAV } from '../ui/sfx2wav';
import { ConvertorXMI2MID } from '../ui/xmi2mid';

const DATA_SERF_ANIMATION_TABLE = 2;
const DATA_SERF_ARMS = 1850;
export const DATA_SFX_BASE = 3900;
export const DATA_MUSIC_GAME = 3990;

enum SpriteType {
  Unknown,
  Solid,
  Transparent,
  Overlay,
  Mask,
}

interface DosResource {
  index: number;
  dosPalette: number;
  spriteType: SpriteType;
}

// There are different types of sprites:
// - Solid: non-packed, rectangular.
// - Transparent: e.g. buildings/serfs. The transparent regions are RLE encoded.
// - Overlay/Mask: conceptually 0 or 1 at each pixel. Used either to modify
//   the alpha level of another sprite (shadows) or to mask parts of other
//   sprites completely.
const dosResources: Record<Asset, DosResource> = {
  [Asset.None]: { index: 0, dosPalette: 0, spriteType: SpriteType.Unknown },
  [Asset.ArtLandscape]: { index: 1, dosPalette: 3997, spriteType: SpriteType.Solid },
  [Asset.Animation]: { index: 2, dosPalette: 0, spriteType: SpriteType.Unknown },
  [Asset.SerfShadow]: { index: 4, dosPalette: 3, spriteType: SpriteType.Overlay },
  [Asset.DottedLines]: { index: 5, dosPalette: 3, spriteType: SpriteType.Solid },
  [Asset.ArtFlag]: { index: 15, dosPalette: 3997, spriteType: SpriteType.Solid },
  [Asset.ArtBox]: { index: 25, dosPalette: 3, spriteType: SpriteType.Solid },
  [Asset.CreditsBg]: { index: 40, dosPalette: 3998, spriteType: SpriteType.Solid },
  [Asset.Logo]: { index: 41, dosPalette: 3998, spriteType: SpriteType.Solid },
  [Asset.Symbol]: { index: 42, dosPalette: 3, spriteType: SpriteType.Solid },
  [Asset.MapMaskUp]: { index: 60, dosPalette: 3, spriteType: SpriteType.Mask },
  [Asset.MapMaskDown]: { index: 141, dosPalette: 3, spriteType: SpriteType.Mask },
  [Asset.PathMask]: { index: 230, dosPalette: 3, spriteType: SpriteType.Mask },
  [Asset.MapGround]: { index: 260, dosPalette: 3, spriteType: SpriteType.Solid },
  [Asset.PathGround]: { index: 300, dosPalette: 3, spriteType: SpriteType.Solid },
  [Asset.GameObject]: { index: 321, dosPalette: 3, spriteType: SpriteType.Transparent },
  [Asset.FrameTop]: { index: 600, dosPalette: 3, spriteType: SpriteType.Solid },
  [Asset.MapBorder]: { index: 610, dosPalette: 3, spriteType: SpriteType.Transparent },
  [Asset.MapWaves]: { index: 630, dosPalette: 3, spriteType: SpriteType.Transparent },
  [Asset.FramePopup]: { index: 660, dosPalette: 3, spriteType: SpriteType.Solid },
  [Asset.Indicator]: { index: 670, dosPalette: 3, spriteType: SpriteType.Solid },
  [Asset.Font]: { index: 750, dosPalette: 3, spriteType: SpriteType.Transparent },
  [Asset.FontShadow]: { index: 810, dosPalette: 3, spriteType: SpriteType.Transparent },
  [Asset.Icon]: { index: 870, dosPalette: 3, spriteType: SpriteType.Solid },
  [Asset.MapObject]: { index: 1250, dosPalette: 3, spriteType: SpriteType.Transparent },
  [Asset.MapShadow]: { index: 1500, dosPalette: 3, spriteType: SpriteType.Overlay },
  [Asset.PanelButton]: { index: 1750, dosPalette: 3, spriteType: SpriteType.Solid },
  [Asset.FrameBottom]: { index: 1780, dosPalette: 3, spriteType: SpriteType.Solid },
  [Asset.SerfTorso]: { index: 2500, dosPalette: 3, spriteType: SpriteType.Transparent },
  [Asset.SerfHead]: { index: 3150, dosPalette: 3, spriteType: SpriteType.Transparent },
  [Asset.FrameSplit]: { index: 3880, dosPalette: 3, spriteType: SpriteType.Solid },
  [Asset.Sound]: { index: 3900, dosPalette: 0, spriteType: SpriteType.Unknown },
  [Asset.Music]: { index: 3990, dosPalette: 0, spriteType: SpriteType.Unknown },
  [Asset.Cursor]: { index: 3999, dosPalette: 3, spriteType: SpriteType.Transparent },
};

// [mask, image]
export type MaskImage = [Sprite | null, Sprite | null];

interface DataEntry {
  offset: number;
  size: number;
}

function unpackTPWM(src: Uint8Array): Uint8Array | null {
  if (src.length < 8 || String.fromCharCode(src[0], src[1], src[2], src[3]) !== 'TPWM') {
    return null;
  }

  const buffer = new Buffer(src.subarray(4));
  const resSize = buffer.u32();
  const result = new Uint8Array(resSize);
  let n = 0;

  while (buffer.readable()) {
    let flag = buffer.u8();
    for (let i = 0; i < 8 && buffer.readable(); i++) {
      flag <<= 1;
      if (flag & ~0xff) {
        flag &= 0xff;
        const temp = buffer.u8();
        const stampSize = (temp & 0x0f) + 3;
        const stampOffset = buffer.u8() | ((temp << 4) & 0x0f00);
        for (let k = 0; k < stampSize; k++, n++) {
          result[n] = result[n - stampOffset];
        }
      } else {
        result[n++] = buffer.u8();
      }
    }
  }

  if (n !== resSize) {
    throw new Error('TPWM source data corrupted');
  }
  return result;
}

function readHeader(sprite: Sprite, data: Buffer): void {
  if (data.size < 10) {
    throw new Error('Failed to extract DOS sprite');
  }
  sprite.deltaX = data.i8();
  sprite.deltaY = data.i8();
  sprite.width = data.u16();
  sprite.height = data.u16();
  sprite.offsetX = data.i16();
  sprite.offsetY = data.i16();
  sprite.data = new Uint8ClampedArray(sprite.width * sprite.height * 4);
}

function spriteSolid(data: Buffer, palette: Uint8Array): Sprite {
  const s = new Sprite();
  readHeader(s, data);
  if (data.size !== s.width * s.height + 10) {
    throw new Error('Failed to extract DOS solid sprite');
  }

  const out = s.data;
  for (let n = 0; data.readable(); n += 4) {
    const c = data.u8() * 3;
    out[n] = palette[c];
    out[n + 1] = palette[c + 1];
    out[n + 2] = palette[c + 2];
    out[n + 3] = 0xff;
  }
  return s;
}

function spriteTransparent(data: Buffer, palette: Uint8Array, colorOffset = 0): Sprite {
  const s = new Sprite();
  readHeader(s, data);

  const out = s.data;
  let n = 0;
  while (data.readable()) {
    n += data.u8() * 4;
    const fill = data.u8();
    for (let i = 0; i < fill; i++, n += 4) {
      const c = (data.u8() + colorOffset) * 3;
      out[n] = palette[c];
      out[n + 1] = palette[c + 1];
      out[n + 2] = palette[c + 2];
      out[n + 3] = 0xff;
    }
  }
  return s;
}

function spriteOverlay(data: Buffer, palette: Uint8Array, value: number): Sprite {
  const s = new Sprite();
  readHeader(s, data);

  const out = s.data;
  const c = value * 3;
  let n = 0;
  while (data.readable()) {
    n += data.u8() * 4;
    const fill = data.u8();
    for (let i = 0; i < fill; i++, n += 4) {
      out[n] = palette[c];
      out[n + 1] = palette[c + 1];
      out[n + 2] = palette[c + 2];
      out[n + 3] = value;
    }
  }
  return s;
}

function spriteMask(data: Buffer): Sprite {
  const s = new Sprite();
  readHeader(s, data);

  const out = s.data;
  let n = 0;
  while (data.readable()) {
    n += data.u8() * 4;
    const fill = data.u8() * 4;
    out.fill(0xff, n, n + fill);
    n += fill;
  }
  return s;
}

export class DataSourceDOS {
  private spae: Buffer;
  private entries: DataEntry[] = [];
  private animationTable: Animation[][] = [];

  constructor(file: Uint8Array) {
    this.spae = new Buffer(unpackTPWM(file) ?? file);
    this.load();
  }

  static async fetch(url: string): Promise<DataSourceDOS> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not load game data from ${url} (${response.status})`);
    }
    return new DataSourceDOS(new Uint8Array(await response.arrayBuffer()));
  }

  private load(): void {
    // The 8 byte header is the file size, then the number of entries in the
    // index table. Some entries are undefined (size and offset are zero).
    if (this.spae.u32() !== this.spae.size) {
      throw new Error('Data file is not a Settlers SPA?.PA archive');
    }
    const entryCount = this.spae.u32();
    this.entries.push({ offset: 0, size: 0 }); // objects are numbered from 1
    for (let i = 0; i < entryCount; i++) {
      const size = this.spae.u32();
      const offset = this.spae.u32();
      this.entries.push({ offset, size });
    }

    this.fixup();

    // The first uint32 is the byte length of the rest
    // of the table in big endian order.
    const anim = this.getObject(DATA_SERF_ANIMATION_TABLE);
    if (!anim) {
      throw new Error('Could not extract animation table.');
    }
    anim.littleEndian = false;
    if (anim.size !== anim.u32()) {
      throw new Error('Could not extract animation table.');
    }
    this.loadAnimationTable(anim.tail());
  }

  // Return buffer with object at index
  getObject(index: number): Buffer | null {
    const entry = this.entries[index];
    if (!entry || entry.offset === 0) {
      return null;
    }
    return this.spae.subbuffer(entry.offset, entry.size);
  }

  // Fill out some undefined spaces in the index from other
  // places in the data file index.
  private fixup(): void {
    const e = this.entries;
    for (let i = 0; i < 48; i++) {
      for (let j = 1; j < 6; j++) {
        e[3450 + 6 * i + j] = e[3450 + 6 * i];
      }
    }

    for (let i = 0; i < 3; i++) {
      e[3765 + i] = e[3762 + i];
    }

    for (let i = 0; i < 6; i++) {
      e[1363 + i] = e[1352];
      e[1613 + i] = e[1602];
    }
  }

  // The table starts with 200 big endian uint32 offsets from the start of
  // the table, one per animation. Each animation is a run of three byte
  // entries: serf body sprite, signed x offset, signed y offset.
  private loadAnimationTable(data: Buffer): void {
    const offsets: number[] = [];
    for (let i = 0; i < 200; i++) {
      offsets.push(data.u32());
    }

    const bytes = data.bytes;
    for (let i = 0; i < 200; i++) {
      const a = offsets[i];
      let next = data.size;
      for (let j = 0; j < 200; j++) {
        if (offsets[j] > a) next = Math.min(next, offsets[j]);
      }
      const count = Math.trunc((next - a) / 3);

      const animations: Animation[] = [];
      for (let j = 0; j < count; j++) {
        const p = a + j * 3;
        animations.push({
          sprite: bytes[p],
          x: (bytes[p + 1] << 24) >> 24,
          y: (bytes[p + 2] << 24) >> 24,
        });
      }
      this.animationTable.push(animations);
    }
  }

  // PORT: returns the signed 16-bit mono samples (8000 Hz) the C++ wraps
  // in a WAV container, see src/ui/sfx2wav.ts.
  getSound(index: number): Int16Array | null {
    let data = this.getObject(DATA_SFX_BASE + index);
    if (!data) {
      Log.Error('data', 'Could not extract SFX clip: #' + index);
      return null;
    }

    let level = -32;
    if (index === 62) {
      /* The smelter clip is the only one not centred on 32: its samples
         lie in 0..15 around 8, followed by silence padding at 32. Played
         as is, the offset and the jump to the padding give a loud click on
         every repeat. Centre it on 8 and drop the padding. */
      level = -8;
      const samples = data.bytes;
      let size = data.size;
      while (size > 0 && samples[size - 1] === 32) size--;
      data = data.subbuffer(0, size);
    }

    try {
      const convertor = new ConvertorSFX2WAV(data, level);
      return convertor.convert();
    } catch {
      Log.Error('data', 'Could not convert SFX clip to WAV: #' + index);
      return null;
    }
  }

  // The music as a standard MIDI file.
  getMusic(index: number): Uint8Array | null {
    const data = this.getObject(DATA_MUSIC_GAME + index);
    if (!data) {
      Log.Error('data', 'Could not extract XMI clip: #' + index);
      return null;
    }

    try {
      const convertor = new ConvertorXMI2MID(data.bytes);
      return convertor.convert();
    } catch {
      Log.Error('data', 'Could not convert XMI clip to MID: #' + index);
      return null;
    }
  }

  private getDosPalette(index: number): Uint8Array | null {
    const data = this.getObject(index);
    if (!data || data.size !== 3 * 256) {
      return null;
    }
    return data.bytes;
  }

  // Sprite with the player colour applied where the sprite has a colour mask.
  getSprite(res: Asset, index: number, color: Color): Sprite | null {
    if (index >= getResourceCount(res)) {
      return null;
    }

    const [mask, image] = this.getSpriteParts(res, index);
    if (mask) {
      mask.fillMasked(color);
      if (image) mask.blend(image);
      return mask;
    }
    return image;
  }

  getSpriteParts(res: Asset, index: number): MaskImage {
    if (index >= getResourceCount(res)) {
      return [null, null];
    }

    const dosRes = dosResources[res];
    const palette = this.getDosPalette(dosRes.dosPalette);
    if (!palette) {
      return [null, null];
    }

    if (res === Asset.SerfTorso) {
      const data = this.getObject(dosRes.index + index);
      const data2 = this.getObject(dosRes.index + index);
      if (!data || !data2) return [null, null];
      const torso = spriteTransparent(data, palette, 64);
      const torso2 = spriteTransparent(data2, palette, 72);

      const mi = this.separateSprites(torso, torso2);

      const armsData = this.getObject(DATA_SERF_ARMS + index);
      if (armsData) {
        torso.stick(spriteTransparent(armsData, palette), 0, 0);
      }
      return mi;
    } else if (res === Asset.MapObject) {
      if (index >= 128 && index <= 143) {
        // Flag sprites
        const flagFrame = (index - 128) % 4;
        const d1 = this.getObject(dosRes.index + 128 + flagFrame);
        const d2 = this.getObject(dosRes.index + 128 + 4 + flagFrame);
        if (!d1 || !d2) return [null, null];
        return this.separateSprites(
          spriteTransparent(d1, palette),
          spriteTransparent(d2, palette),
        );
      }
    } else if (res === Asset.Font || res === Asset.FontShadow) {
      const data = this.getObject(dosRes.index + index);
      if (!data) return [null, null];
      return [spriteTransparent(data, palette), null];
    }

    const data = this.getObject(dosRes.index + index);
    if (!data) {
      return [null, null];
    }

    switch (dosRes.spriteType) {
      case SpriteType.Solid:
        return [null, spriteSolid(data, palette)];
      case SpriteType.Transparent:
        return [null, spriteTransparent(data, palette)];
      case SpriteType.Overlay:
        return [null, spriteOverlay(data, palette, 0x80)];
      case SpriteType.Mask:
        return [null, spriteMask(data)];
      default:
        return [null, null];
    }
  }

  // Split two renderings of one sprite, identical except for the player
  // colour, into the colour mask and the image with the coloured region
  // turned into shading.
  private separateSprites(s1: Sprite, s2: Sprite): MaskImage {
    const filled = s1.createMask(s2);
    if (!filled) return [null, null];
    const masked = s1.getMasked(filled);
    masked.makeAlphaMask();
    s1.del(filled);
    s1.stick(masked, 0, 0);
    return [filled, s1];
  }

  getAnimationPhaseCount(animation: number): number {
    return this.animationTable[animation]?.length ?? 0;
  }

  getAnimation(animation: number, phase: number): Animation {
    return this.animationTable[animation]?.[phase >> 3] ?? { sprite: 0, x: 0, y: 0 };
  }
}
