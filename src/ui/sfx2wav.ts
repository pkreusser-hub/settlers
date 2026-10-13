// sfx2wav.h + sfx2wav.cc (+ pcm2wav.h + pcm2wav.cc) - SFX to WAV converter.
//
// PORT: ConvertorPCM2WAV wraps the samples in a RIFF/WAVE container for
// SDL_mixer to parse again. Web Audio takes the samples as they are, so
// convert() returns what create_data() makes (signed 16-bit mono samples)
// and the "fmt " header fields are the public fields chenals and rate.

import type { Buffer } from '../data/buffer';

export class ConvertorSFX2WAV {
  protected buffer: Buffer;
  chenals: number;
  rate: number;
  protected level: number;
  protected invert: boolean;
  protected isSigned: boolean;

  constructor(buffer: Buffer, level = 0, invert = false, rate = 8000, isSigned = false) {
    this.buffer = buffer;
    this.chenals = 1;
    this.rate = rate;
    this.level = level;
    this.invert = invert;
    this.isSigned = isSigned;
  }

  // PORT: no RIFF container, see above.
  convert(): Int16Array {
    return this.createData(this.buffer);
  }

  protected createData(data: Buffer): Int16Array {
    /* WAV holds 16-bit little-endian samples. */
    const res = new Int16Array(data.size);
    let n = 0;

    while (data.readable()) {
      let value = this.isSigned ? data.i8() : data.u8();
      value = value + this.level;
      if (this.invert) {
        value = 0xff - value;
      }
      value = Math.max(-0x8000, Math.min(value * 0x100, 0x7fff));
      res[n++] = value;
    }

    return res;
  }
}
