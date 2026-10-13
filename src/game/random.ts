// Port of Freeserf's random.cc. The generator is 3 x 16 bit state.

export class Random {
  private state = new Uint16Array(3);

  // Random(), Random(value), Random(string), Random(Random), Random(a, b, c)
  constructor(a?: number | string | Random, b?: number, c?: number) {
    const s = this.state;
    if (a === undefined) {
      s[0] = Math.random() * 0x10000;
      s[1] = Math.random() * 0x10000;
      s[2] = Math.random() * 0x10000;
      this.random();
    } else if (a instanceof Random) {
      s.set(a.state);
    } else if (typeof a === 'string') {
      let tmp = 0n;
      for (let i = 15; i >= 0; i--) {
        tmp <<= 3n;
        tmp |= BigInt((a.charCodeAt(i) - 48 - 1) & 0xff);
      }
      s[0] = Number(tmp & 0xffffn);
      s[1] = Number((tmp >> 16n) & 0xffffn);
      s[2] = Number((tmp >> 32n) & 0xffffn);
    } else if (b !== undefined && c !== undefined) {
      s[0] = a;
      s[1] = b;
      s[2] = c;
    } else {
      s[0] = s[1] = s[2] = a;
    }
  }

  random(): number {
    const rnd = this.state;
    const r = ((rnd[0] + rnd[1]) ^ rnd[2]) & 0xffff;
    rnd[2] += rnd[1];
    rnd[1] ^= rnd[2];
    rnd[1] = (rnd[1] >> 1) | (rnd[1] << 15);
    rnd[2] = (rnd[2] >> 1) | (rnd[2] << 15);
    rnd[0] = r;
    return r;
  }

  toString(): string {
    let tmp = BigInt(this.state[0]) | (BigInt(this.state[1]) << 16n) | (BigInt(this.state[2]) << 32n);
    let out = '';
    for (let i = 0; i < 16; i++) {
      out += String.fromCharCode(Number(tmp & 7n) + 49);
      tmp >>= 3n;
    }
    return out;
  }

  // operator^=
  xor(right: Random): this {
    this.state[0] ^= right.state[0];
    this.state[1] ^= right.state[1];
    this.state[2] ^= right.state[2];
    return this;
  }

  clone(): Random {
    return new Random(this);
  }
}
