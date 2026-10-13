// Sequential reader over a byte range. Port of the read side of Freeserf's Buffer.

export class Buffer {
  readonly bytes: Uint8Array;
  private view: DataView;
  private pos = 0;
  littleEndian = true;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get size(): number {
    return this.bytes.byteLength;
  }

  readable(): boolean {
    return this.pos < this.bytes.byteLength;
  }

  u8(): number {
    return this.view.getUint8(this.pos++);
  }

  i8(): number {
    return this.view.getInt8(this.pos++);
  }

  u16(): number {
    const v = this.view.getUint16(this.pos, this.littleEndian);
    this.pos += 2;
    return v;
  }

  i16(): number {
    const v = this.view.getInt16(this.pos, this.littleEndian);
    this.pos += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.pos, this.littleEndian);
    this.pos += 4;
    return v;
  }

  subbuffer(offset: number, size: number): Buffer {
    const b = new Buffer(this.bytes.subarray(offset, offset + size));
    b.littleEndian = this.littleEndian;
    return b;
  }

  // Everything not yet read.
  tail(): Buffer {
    return this.subbuffer(this.pos, this.bytes.byteLength - this.pos);
  }
}
