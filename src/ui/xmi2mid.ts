// xmi2mid.h + xmi2mid.cc - XMI to MID converter.

import { ExceptionFreeserf, Log, idiv, u16, u32 } from '../game/misc';

// PORT: src/data/buffer.ts has no pop(size), get_tail(offset) or write
// side. These two classes are the parts of the C++ Buffer and
// MutableBuffer the convertor uses, with the same semantics: get_size() is
// the whole size, pop() reads at the read position, get_tail() counts from
// the start and sub-buffers inherit the endianess.
class XmiBuffer {
  readonly bytes: Uint8Array;
  protected read = 0;
  bigEndian: boolean;

  constructor(bytes: Uint8Array, bigEndian: boolean) {
    this.bytes = bytes;
    this.bigEndian = bigEndian;
  }

  getSize(): number {
    return this.bytes.length;
  }

  readable(): boolean {
    return this.read !== this.bytes.length;
  }

  // PORT: reading past the end is undefined behaviour in the C++, here it
  // throws (the caller reports the clip as not convertible).
  protected check(size: number): void {
    if (this.read + size > this.bytes.length) {
      throw new ExceptionFreeserf('XMI data is truncated');
    }
  }

  popU8(): number {
    this.check(1);
    return this.bytes[this.read++];
  }

  popU16(): number {
    const a = this.popU8();
    const b = this.popU8();
    return this.bigEndian ? (a << 8) | b : (b << 8) | a;
  }

  popU32(): number {
    const a = this.popU16();
    const b = this.popU16();
    return u32(this.bigEndian ? (a << 16) | b : (b << 16) | a);
  }

  pop(size: number): XmiBuffer {
    this.check(size);
    const value = new XmiBuffer(this.bytes.subarray(this.read, this.read + size), this.bigEndian);
    this.read += size;
    return value;
  }

  getSubbuffer(offset: number, size: number): XmiBuffer {
    return new XmiBuffer(this.bytes.subarray(offset, offset + size), this.bigEndian);
  }

  getTail(offset: number): XmiBuffer {
    return this.getSubbuffer(offset, this.bytes.length - offset);
  }

  toString(): string {
    return String.fromCharCode(...this.bytes);
  }
}

class XmiMutableBuffer {
  protected data: number[] = [];

  getSize(): number {
    return this.data.length;
  }

  pushU8(value: number): void {
    this.data.push(value & 0xff);
  }

  // Big endian, as every buffer written here.
  pushU16(value: number): void {
    this.data.push((value >> 8) & 0xff, value & 0xff);
  }

  pushU32(value: number): void {
    this.data.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  }

  pushString(str: string): void {
    for (let i = 0; i < str.length; i++) {
      this.data.push(str.charCodeAt(i) & 0xff);
    }
  }

  pushBuffer(buffer: XmiMutableBuffer | XmiBuffer): void {
    const bytes = buffer instanceof XmiBuffer ? buffer.bytes : buffer.data;
    for (let i = 0; i < bytes.length; i++) {
      this.data.push(bytes[i]);
    }
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.data);
  }
}

// ConvertorXMI2MID::MidiNode
export interface MidiNode {
  time: number;
  index: number;
  type: number;
  data1: number;
  data2: number;
  buffer: XmiBuffer | null;
}

export type MidiNodes = MidiNode[];

interface MidiFile {
  nodes: MidiNode[];
  tempo: number;
}

type ChunkProcessor = (buffer: XmiBuffer, midi: MidiFile) => number;
const xmiProcessors: Record<string, ChunkProcessor> = {
  'FORM': xmiProcessMulti,
  'INFO': xmiProcessINFO,
  'CAT ': xmiProcessMulti,
  'TIMB': xmiProcessTIMB,
  'EVNT': xmiProcessEVNT,
};

function xmiProcessChunk(buffer: XmiBuffer, midi: MidiFile): number {
  const id = buffer.pop(4);
  const name = id.toString();
  const size = buffer.popU32();
  Log.Verbose('xmi2mid', 'Processing XMI chunk: ' + name + ' (size: ' + size + ')');

  const it = Object.prototype.hasOwnProperty.call(xmiProcessors, name) ? xmiProcessors[name] : null;
  if (it === null) {
    buffer.pop(size);
    Log.Debug('xmi2mid', 'Unknown XMI chunk: ' + name);
  } else {
    const content = buffer.pop(size);
    it(content, midi);
  }

  return size + 8;
}

function xmiProcessChunks(buffer: XmiBuffer, midi: MidiFile): number {
  const length = buffer.getSize();

  while (buffer.getSize()) {
    const size = xmiProcessChunk(buffer, midi);
    // PORT: get_tail() past the end makes a buffer of a huge size in the
    // C++ (size_t underflow), here it throws.
    if (size > buffer.getSize()) {
      throw new ExceptionFreeserf('XMI data is truncated');
    }
    buffer = buffer.getTail(size);
  }

  return length;
}

function xmiProcessMulti(buffer: XmiBuffer, midi: MidiFile): number {
  const type = buffer.pop(4);
  const name = type.toString();
  Log.Verbose('xmi2mid', '\tchunk subtype: ' + name);
  xmiProcessChunks(buffer.getTail(4), midi);
  return buffer.getSize();
}

function xmiProcessINFO(buffer: XmiBuffer, _midi: MidiFile): number {
  if (buffer.getSize() !== 2) {
    Log.Debug('xmi2mid', '\tInconsistent INFO block.');
  } else {
    const trackCount = buffer.popU16();
    Log.Verbose('xmi2mid', '\tXMI contains ' + trackCount + ' track(s)');
  }
  return buffer.getSize();
}

function xmiProcessTIMB(buffer: XmiBuffer, _midi: MidiFile): number {
  buffer.bigEndian = false;
  const count = buffer.popU16();
  if (count * 2 + 2 !== buffer.getSize()) {
    Log.Debug('xmi2mid', '\tInconsistent TIMB block.');
  } else {
    for (let i = 0; i < count; i++) {
      const patch = buffer.popU8();
      const bank = buffer.popU8();
      Log.Verbose('xmi2mid', '\tTIMB entry ' + i + ': ' + patch + ', ' + bank);
    }
  }
  return buffer.getSize();
}

// Decode variable length duration.
function midiReadVariableSize(buffer: XmiBuffer): number {
  let val = 0;

  let data = buffer.popU8();
  while (data & 0x80) {
    val = val * 128 + (data & 0x7f);
    data = buffer.popU8();
  }
  val = val * 128 + (data & 0x7f);

  return val;
}

function xmiProcessEVNT(buffer: XmiBuffer, midi: MidiFile): number {
  let time = 0;
  let timeIndex = 0;

  while (buffer.readable()) {
    const type = buffer.popU8();

    if (type & 0x80) {
      // PORT: the C++ leaves data1, data2 uninitialized for the system
      // messages other than meta (0xF0..0xFE), here they are 0.
      let node: MidiNode = { time: 0, index: 0, type: 0, data1: 0, data2: 0, buffer: null };
      node.time = time;
      node.index = timeIndex++;
      node.type = type;

      switch (type & 0xf0) {
        case 0x80:
        case 0x90:
        case 0xa0:
        case 0xb0:
        case 0xe0:
          node.data1 = buffer.popU8();
          node.data2 = buffer.popU8();
          if ((type & 0xf0) === 0x90) {
            const data1 = node.data1;
            midi.nodes.push(node);

            const subnode: MidiNode = { time: 0, index: 0, type: 0, data1: 0, data2: 0, buffer: null };
            subnode.type = type;
            const length = midiReadVariableSize(buffer);

            // Generate on note with velocity zero corresponding to off note.
            subnode.time = time + length;
            subnode.index = timeIndex++;
            subnode.data1 = data1;
            subnode.data2 = 0;
            node = subnode;
          }
          break;
        case 0xc0:
        case 0xd0:
          node.data1 = buffer.popU8();
          node.data2 = 0;
          break;
        case 0xf0:
          if (type === 0xff) {
            // Meta message.
            node.data1 = buffer.popU8();
            node.data2 = buffer.popU8();
            node.buffer = buffer.pop(node.data2);
            if (node.data1 === 0x51) {
              if (midi.tempo === 0) {
                // PORT: the C++ pops from node.buffer, whose read position
                // is its own; the bytes written to the track later are the
                // whole buffer either way.
                for (let i = 0; i < node.data2; i++) {
                  midi.tempo = u32(midi.tempo << 8);
                  midi.tempo = u32(midi.tempo | node.buffer.bytes[i]);
                }
              }
            }
          }
          break;
      }

      midi.nodes.push(node);
    } else {
      time += type;
    }
  }

  return buffer.getSize();
}

function midiWriteVariableSize(val: number, data: XmiMutableBuffer): void {
  let count = 1;
  let buf = val % 128;
  for (; (val = Math.floor(val / 128)) !== 0; ++count) {
    buf = u32((buf << 8) | 0x80 | (val % 128));
  }
  for (let i = 0; i < count; ++i) {
    data.pushU8(buf & 0xff);
    buf >>>= 8;
  }
}

export class ConvertorXMI2MID {
  protected buffer: XmiBuffer;
  protected result: XmiMutableBuffer = new XmiMutableBuffer();

  constructor(buffer: Uint8Array) {
    this.buffer = new XmiBuffer(buffer, true);
  }

  convert(): Uint8Array {
    const midiFile: MidiFile = { nodes: [], tempo: 0 };

    xmiProcessChunks(this.buffer, midiFile);

    this.result = new XmiMutableBuffer();

    const header = new XmiMutableBuffer();
    header.pushU16(0); // File type
    header.pushU16(1); // Track count
    header.pushU16(u16(idiv(u32(midiFile.tempo * 3), 25000))); // Time division
    this.writeChunk('MThd', header);

    this.writeChunk('MTrk', this.createTrack(midiFile.nodes));

    return this.result.toBytes();
  }

  protected writeChunk(id: string, data: XmiMutableBuffer): void {
    this.result.pushString(id);
    this.result.pushU32(data.getSize());
    this.result.pushBuffer(data);
  }

  protected createTrack(nodes: MidiNodes): XmiMutableBuffer {
    // Return true if first midi node should come before second.
    // PORT: the C++ compares the times only and std::sort is not stable,
    // so the order of the events of one time is up to the standard
    // library. Here they keep the order in which they were made (index):
    // the note off made for an earlier note comes before a note on of the
    // same time.
    const compareByTime = (m1: MidiNode, m2: MidiNode): number => {
      if (m1.time !== m2.time) {
        return m2.time - m1.time;
      }
      return m2.index - m1.index;
    };

    // Sort the nodes.
    nodes.sort(compareByTime);

    const data = new XmiMutableBuffer();
    let time = 0;
    while (nodes.length !== 0) {
      const node = nodes.pop() as MidiNode;

      midiWriteVariableSize(node.time - time, data);
      time = node.time;
      data.pushU8(node.type);
      data.pushU8(node.data1);
      if ((node.type & 0xf0) !== 0xc0 && (node.type & 0xf0) !== 0xd0) {
        data.pushU8(node.data2);
        if (node.type === 0xff) {
          if (node.data2 > 0 && node.buffer !== null) {
            data.pushBuffer(node.buffer);
          }
        }
      }
    }

    return data;
  }
}
