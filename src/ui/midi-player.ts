// midi-player.ts - Standard MIDI file parser and a small synthesizer.
//
// PORT: not in the C++. SDL_mixer plays the MIDI file made by xmi2mid with
// FluidSynth and a SoundFont; a browser has no MIDI synthesizer. This is a
// replacement on the Web Audio API: one oscillator with an envelope per
// note, the waveform and envelope chosen by the General MIDI family of the
// channel's program, and noise bursts or pitch sweeps for the percussion of
// channel 10. It plays the right notes in time, it does not sound like the
// AdLib or MT-32 music of the original.

export interface MidiEvent {
  /* Position in ticks and in seconds from the start. */
  tick: number;
  time: number;
  /* Status byte (with the channel), 0xFF for the tempo meta event. */
  status: number;
  data1: number;
  /* For the tempo meta event (data1 0x51): microseconds per quarter note. */
  data2: number;
}

export interface MidiSong {
  format: number;
  trackCount: number;
  /* Ticks per quarter note. */
  division: number;
  events: MidiEvent[];
  /* Seconds, the time of the last event of the file. */
  duration: number;
}

/* Division for a file without one. xmi2mid writes tempo * 3 / 25000, which
   is 0 for an XMI file without a tempo event; XMI time is 120 Hz, 60 ticks
   per quarter note at the default tempo. */
const DEFAULT_DIVISION = 60;
const DEFAULT_TEMPO = 500000;

/* Parse a standard MIDI file (format 0 or 1). The tracks are merged into
   one list of channel and tempo events in the order of their time. */
export function parseMidi(data: Uint8Array): MidiSong | null {
  let pos = 0;

  const tag = (): string => {
    const s = String.fromCharCode(data[pos], data[pos + 1], data[pos + 2], data[pos + 3]);
    pos += 4;
    return s;
  };
  const u32 = (): number => {
    const v = ((data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3]) >>> 0;
    pos += 4;
    return v;
  };
  const u16 = (): number => {
    const v = (data[pos] << 8) | data[pos + 1];
    pos += 2;
    return v;
  };

  if (data.length < 14 || tag() !== 'MThd') {
    return null;
  }
  const headerSize = u32();
  if (headerSize < 6) {
    return null;
  }
  const format = u16();
  const trackCount = u16();
  let division = u16();
  pos = 8 + headerSize;

  /* SMPTE time: frames per second and ticks per frame, a fixed number of
     ticks per second whatever the tempo. */
  let ticksPerSecond = 0;
  if (division & 0x8000) {
    const fps = 256 - (division >> 8);
    ticksPerSecond = fps * (division & 0xff);
    division = DEFAULT_DIVISION;
  }
  if (division === 0) {
    division = DEFAULT_DIVISION;
  }

  interface RawEvent extends MidiEvent {
    order: number;
  }
  const events: RawEvent[] = [];
  let order = 0;
  let lastTick = 0;

  while (pos + 8 <= data.length) {
    const id = tag();
    const size = u32();
    const end = Math.min(pos + size, data.length);
    if (id !== 'MTrk') {
      pos = end;
      continue;
    }

    let tick = 0;
    let running = 0;
    const varLen = (): number => {
      let val = 0;
      while (pos < end) {
        const b = data[pos++];
        val = val * 128 + (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return val;
    };

    /* The end of track meta event does not end the parsing: xmi2mid puts
       the note off events of the notes still playing after it. */
    while (pos < end) {
      tick += varLen();
      if (pos >= end) break;
      let status = data[pos];
      if (status & 0x80) {
        pos++;
      } else {
        status = running;
        if (status === 0) {
          /* Data without a status, the track is damaged. */
          pos = end;
          break;
        }
      }

      if (status === 0xff) {
        const type = data[pos++];
        const length = varLen();
        if (type === 0x51 && length === 3 && pos + 3 <= end) {
          const tempo = (data[pos] << 16) | (data[pos + 1] << 8) | data[pos + 2];
          events.push({ tick, time: 0, status: 0xff, data1: 0x51, data2: tempo, order: order++ });
        }
        pos += length;
      } else if (status === 0xf0 || status === 0xf7) {
        pos += varLen();
      } else if (status >= 0xf0) {
        /* System common and real time messages have no place in a file. */
        if (status === 0xf2) pos += 2;
        else if (status === 0xf1 || status === 0xf3) pos += 1;
      } else {
        running = status;
        const kind = status & 0xf0;
        const data1 = data[pos++] & 0x7f;
        let data2 = 0;
        if (kind !== 0xc0 && kind !== 0xd0) {
          data2 = data[pos++] & 0x7f;
        }
        events.push({ tick, time: 0, status, data1, data2, order: order++ });
      }
      if (tick > lastTick) lastTick = tick;
    }
    pos = end;
  }

  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  /* Ticks to seconds with the tempo changes. */
  let tempo = DEFAULT_TEMPO;
  let time = 0;
  let prevTick = 0;
  const secondsPerTick = (): number =>
    ticksPerSecond !== 0 ? 1 / ticksPerSecond : tempo / 1000000 / division;
  const result: MidiEvent[] = [];
  for (const event of events) {
    time += (event.tick - prevTick) * secondsPerTick();
    prevTick = event.tick;
    if (event.status === 0xff) {
      tempo = event.data2;
    }
    result.push({
      tick: event.tick,
      time,
      status: event.status,
      data1: event.data1,
      data2: event.data2,
    });
  }
  const duration = time + (lastTick - prevTick) * secondsPerTick();

  return { format, trackCount, division, events: result, duration };
}

/* Sound of a program. Times in seconds; sustain is the level, as a part of
   the peak, the note falls to while it is held. */
interface Instrument {
  wave: OscillatorType;
  gain: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

/* One instrument per General MIDI family (program / 8). */
const instruments: Instrument[] = [
  /* Piano */
  { wave: 'triangle', gain: 1.0, attack: 0.004, decay: 0.9, sustain: 0.1, release: 0.25 },
  /* Chromatic percussion */
  { wave: 'sine', gain: 1.0, attack: 0.002, decay: 0.5, sustain: 0.0, release: 0.3 },
  /* Organ */
  { wave: 'square', gain: 0.3, attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.08 },
  /* Guitar */
  { wave: 'sawtooth', gain: 0.4, attack: 0.004, decay: 0.6, sustain: 0.1, release: 0.2 },
  /* Bass */
  { wave: 'triangle', gain: 1.2, attack: 0.005, decay: 0.4, sustain: 0.4, release: 0.12 },
  /* Strings */
  { wave: 'sawtooth', gain: 0.32, attack: 0.07, decay: 0.3, sustain: 0.8, release: 0.3 },
  /* Ensemble */
  { wave: 'sawtooth', gain: 0.3, attack: 0.1, decay: 0.3, sustain: 0.85, release: 0.35 },
  /* Brass */
  { wave: 'sawtooth', gain: 0.38, attack: 0.03, decay: 0.2, sustain: 0.7, release: 0.12 },
  /* Reed */
  { wave: 'square', gain: 0.3, attack: 0.03, decay: 0.2, sustain: 0.8, release: 0.1 },
  /* Pipe */
  { wave: 'sine', gain: 0.9, attack: 0.04, decay: 0.2, sustain: 0.9, release: 0.12 },
  /* Synth lead */
  { wave: 'square', gain: 0.3, attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.1 },
  /* Synth pad */
  { wave: 'triangle', gain: 0.8, attack: 0.2, decay: 0.4, sustain: 0.9, release: 0.6 },
  /* Synth effects */
  { wave: 'triangle', gain: 0.7, attack: 0.05, decay: 0.6, sustain: 0.5, release: 0.5 },
  /* Ethnic */
  { wave: 'sawtooth', gain: 0.35, attack: 0.004, decay: 0.5, sustain: 0.15, release: 0.2 },
  /* Percussive */
  { wave: 'sine', gain: 1.0, attack: 0.002, decay: 0.25, sustain: 0.0, release: 0.15 },
  /* Sound effects */
  { wave: 'triangle', gain: 0.6, attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.2 },
];

/* Percussion of channel 10 by note. A sweep is a sine falling from freq to
   a third of it, the rest is filtered noise. */
interface Drum {
  kind: 'sweep' | 'noise';
  filter: BiquadFilterType;
  freq: number;
  duration: number;
  gain: number;
}

function drumFor(note: number): Drum {
  switch (note) {
    case 35:
    case 36: /* Bass drums */
      return { kind: 'sweep', filter: 'lowpass', freq: 130, duration: 0.18, gain: 1.6 };
    case 38:
    case 40: /* Snares */
      return { kind: 'noise', filter: 'bandpass', freq: 1800, duration: 0.16, gain: 1.2 };
    case 37:
    case 39: /* Side stick, hand clap */
      return { kind: 'noise', filter: 'bandpass', freq: 1200, duration: 0.07, gain: 1.0 };
    case 42:
    case 44: /* Closed and pedal hi-hat */
      return { kind: 'noise', filter: 'highpass', freq: 5000, duration: 0.05, gain: 0.6 };
    case 46: /* Open hi-hat */
      return { kind: 'noise', filter: 'highpass', freq: 5000, duration: 0.3, gain: 0.6 };
    case 41:
    case 43:
    case 45:
    case 47:
    case 48:
    case 50: /* Toms, low to high */
      return { kind: 'sweep', filter: 'lowpass', freq: 110 + (note - 41) * 22, duration: 0.25, gain: 1.2 };
    case 49:
    case 51:
    case 52:
    case 53:
    case 55:
    case 57:
    case 59: /* Cymbals */
      return { kind: 'noise', filter: 'highpass', freq: 4000, duration: 0.7, gain: 0.5 };
    default:
      return { kind: 'noise', filter: 'bandpass', freq: 3000, duration: 0.08, gain: 0.7 };
  }
}

/* Level of a single note at full velocity and volume. */
const VOICE_GAIN = 0.16;
const MAX_VOICES = 64;
const PERCUSSION_CHANNEL = 9;
/* The events are given to the audio clock this many seconds ahead. The
   timer of a hidden page fires once per second only. */
const LOOKAHEAD = 1.5;
const SCHEDULE_INTERVAL = 200;
const START_DELAY = 0.1;
/* Silence after the last event before the song counts as finished. */
const END_TAIL = 0.5;

interface Voice {
  source: AudioScheduledSourceNode;
  detune: AudioParam | null;
  env: GainNode;
  channel: number;
  note: number;
  start: number;
  release: number;
  released: boolean;
  /* Note off came while the sustain pedal was down. */
  held: boolean;
}

interface Channel {
  program: number;
  volume: number;
  expression: number;
  /* Cents. */
  bend: number;
  sustain: boolean;
  gain: GainNode;
  pan: StereoPannerNode | null;
}

export class MidiPlayer {
  protected context: AudioContext;
  protected destination: AudioNode;
  protected filter: BiquadFilterNode;
  protected compressor: DynamicsCompressorNode;
  /* Everything of the song playing goes through the bus, a new one for
     each start so that the old song can fade out. */
  protected bus: GainNode | null = null;
  protected channels: Channel[] = [];
  protected voices: Voice[] = [];
  protected noise: AudioBuffer | null = null;

  protected song: MidiSong | null = null;
  protected loop = false;
  protected playing = false;
  protected index = 0;
  protected startTime = 0;
  protected timer: ReturnType<typeof setInterval> | null = null;

  /* Called when a song that does not loop has played to its end, not when
     it was stopped. */
  onFinished: (() => void) | null = null;

  constructor(context: AudioContext, destination: AudioNode) {
    this.context = context;
    this.destination = destination;

    /* Takes the edge off the square and sawtooth waves. */
    this.filter = context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 7000;
    this.filter.Q.value = 0.5;
    this.compressor = context.createDynamicsCompressor();
    this.filter.connect(this.compressor);
    this.compressor.connect(destination);
  }

  isPlaying(): boolean {
    return this.playing;
  }

  play(song: MidiSong, loop = false): void {
    this.stop();

    const context = this.context;
    this.song = song;
    this.loop = loop;
    this.index = 0;
    this.startTime = context.currentTime + START_DELAY;

    this.bus = context.createGain();
    this.bus.connect(this.filter);
    this.channels = [];
    for (let i = 0; i < 16; i++) {
      const gain = context.createGain();
      let pan: StereoPannerNode | null = null;
      if (typeof context.createStereoPanner === 'function') {
        pan = context.createStereoPanner();
        gain.connect(pan);
        pan.connect(this.bus);
      } else {
        gain.connect(this.bus);
      }
      this.channels.push({
        program: 0,
        volume: 100,
        expression: 127,
        bend: 0,
        sustain: false,
        gain,
        pan,
      });
      this.setChannelGain(i, context.currentTime);
    }

    this.playing = true;
    this.timer = setInterval(() => this.schedule(), SCHEDULE_INTERVAL);
    this.schedule();
  }

  /* Stop at once, onFinished is not called. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.playing = false;
    this.song = null;

    const bus = this.bus;
    if (bus !== null) {
      /* The notes may be scheduled ahead: fade the bus out and stop all
         of them, also the ones that have not started yet. */
      const now = this.context.currentTime;
      bus.gain.setTargetAtTime(0, now, 0.015);
      for (const voice of this.voices) {
        try {
          voice.source.stop(now + 0.1);
        } catch {
          /* Stopped already. */
        }
      }
      setTimeout(() => bus.disconnect(), 500);
      this.bus = null;
    }
    this.voices = [];
    this.channels = [];
  }

  protected finish(): void {
    this.stop();
    if (this.onFinished !== null) {
      this.onFinished();
    }
  }

  protected schedule(): void {
    const song = this.song;
    if (!this.playing || song === null) {
      return;
    }

    const now = this.context.currentTime;
    const horizon = now + LOOKAHEAD;
    const events = song.events;
    while (this.index < events.length) {
      const event = events[this.index];
      const time = this.startTime + event.time;
      if (time >= horizon) {
        break;
      }
      this.dispatch(event, Math.max(time, now));
      this.index++;
    }

    if (this.index >= events.length) {
      const end = this.startTime + song.duration;
      if (this.loop && song.duration > 0) {
        if (end < horizon) {
          /* Again from the start. */
          for (let i = 0; i < 16; i++) {
            this.allNotesOff(i, Math.max(end, now));
          }
          this.startTime = end;
          this.index = 0;
        }
      } else if (now >= end + END_TAIL) {
        this.finish();
      }
    }
  }

  protected dispatch(event: MidiEvent, time: number): void {
    const status = event.status;
    if (status === 0xff) {
      return; /* Tempo, in the times of the events already. */
    }

    const channel = status & 0x0f;
    switch (status & 0xf0) {
      case 0x80:
        this.noteOff(channel, event.data1, time);
        break;
      case 0x90:
        if (event.data2 === 0) {
          this.noteOff(channel, event.data1, time);
        } else {
          this.noteOn(channel, event.data1, event.data2, time);
        }
        break;
      case 0xb0:
        this.controller(channel, event.data1, event.data2, time);
        break;
      case 0xc0:
        this.channels[channel].program = event.data1;
        break;
      case 0xe0: {
        /* Pitch bend, a range of two semitones. */
        const value = ((event.data2 << 7) | event.data1) - 8192;
        const cents = (value / 8192) * 200;
        this.channels[channel].bend = cents;
        for (const voice of this.voices) {
          if (voice.channel === channel && voice.detune !== null) {
            voice.detune.setValueAtTime(cents, time);
          }
        }
        break;
      }
      default:
        break; /* Aftertouch is not played. */
    }
  }

  protected setChannelGain(channel: number, time: number): void {
    const c = this.channels[channel];
    const volume = c.volume / 127;
    const expression = c.expression / 127;
    c.gain.gain.setValueAtTime(volume * volume * expression * expression, time);
  }

  protected controller(channel: number, controller: number, value: number, time: number): void {
    const c = this.channels[channel];
    switch (controller) {
      case 7:
        c.volume = value;
        this.setChannelGain(channel, time);
        break;
      case 10:
        if (c.pan !== null) {
          c.pan.pan.setValueAtTime(Math.max(-1, Math.min((value - 64) / 63, 1)), time);
        }
        break;
      case 11:
        c.expression = value;
        this.setChannelGain(channel, time);
        break;
      case 64:
        c.sustain = value >= 64;
        if (!c.sustain) {
          for (const voice of this.voices) {
            if (voice.channel === channel && voice.held && !voice.released) {
              this.release(voice, time);
            }
          }
        }
        break;
      case 120:
      case 123:
        this.allNotesOff(channel, time);
        break;
      case 121:
        c.expression = 127;
        c.bend = 0;
        c.sustain = false;
        this.setChannelGain(channel, time);
        break;
      default:
        break; /* The others (and the XMI loop controllers) are not played. */
    }
  }

  protected allNotesOff(channel: number, time: number): void {
    for (const voice of this.voices) {
      if (voice.channel === channel && !voice.released) {
        this.release(voice, time);
      }
    }
  }

  protected addVoice(voice: Voice): void {
    const voices = this.voices;
    voice.source.onended = () => {
      voice.env.disconnect();
      const i = this.voices.indexOf(voice);
      if (i !== -1) this.voices.splice(i, 1);
    };
    voices.push(voice);

    /* Too many notes: the oldest one still held goes. */
    if (voices.length > MAX_VOICES) {
      for (const old of voices) {
        if (!old.released) {
          this.release(old, voice.start);
          break;
        }
      }
    }
  }

  protected noteOn(channel: number, note: number, velocity: number, time: number): void {
    if (this.bus === null) return;
    if (channel === PERCUSSION_CHANNEL) {
      this.drum(note, velocity, time);
      return;
    }

    const context = this.context;
    const c = this.channels[channel];
    const instrument = instruments[(c.program >> 3) & 0x0f];
    const level = velocity / 127;
    const peak = VOICE_GAIN * instrument.gain * level * level;

    const osc = context.createOscillator();
    osc.type = instrument.wave;
    osc.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
    osc.detune.setValueAtTime(c.bend, time);

    const env = context.createGain();
    env.gain.value = 0;
    env.gain.setValueAtTime(0, time);
    env.gain.setTargetAtTime(peak, time, instrument.attack / 3);
    env.gain.setTargetAtTime(peak * instrument.sustain, time + instrument.attack, instrument.decay / 3);

    osc.connect(env);
    env.connect(c.gain);
    osc.start(time);

    this.addVoice({
      source: osc,
      detune: osc.detune,
      env,
      channel,
      note,
      start: time,
      release: instrument.release,
      released: false,
      held: false,
    });
  }

  protected noteOff(channel: number, note: number, time: number): void {
    if (channel === PERCUSSION_CHANNEL) {
      return; /* The percussion sounds end on their own. */
    }
    for (const voice of this.voices) {
      if (voice.channel === channel && voice.note === note && !voice.released && !voice.held) {
        if (this.channels[channel].sustain) {
          voice.held = true;
        } else {
          this.release(voice, time);
        }
        break;
      }
    }
  }

  protected release(voice: Voice, time: number): void {
    /* Not before the note has begun to sound. */
    const t = Math.max(time, voice.start + 0.01);
    const tau = voice.release / 3;
    voice.released = true;
    voice.env.gain.cancelScheduledValues(t);
    voice.env.gain.setTargetAtTime(0, t, tau);
    try {
      voice.source.stop(t + tau * 7);
    } catch {
      /* Stopped already. */
    }
  }

  /* One second of white noise, from a generator of its own: the same on
     every run. */
  protected getNoise(): AudioBuffer {
    if (this.noise === null) {
      const rate = this.context.sampleRate;
      const buffer = this.context.createBuffer(1, rate, rate);
      const samples = buffer.getChannelData(0);
      let seed = 0x1234567;
      for (let i = 0; i < samples.length; i++) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        samples[i] = ((seed >>> 8) & 0xffff) / 0x8000 - 1;
      }
      this.noise = buffer;
    }
    return this.noise;
  }

  protected drum(note: number, velocity: number, time: number): void {
    const context = this.context;
    const c = this.channels[PERCUSSION_CHANNEL];
    const drum = drumFor(note);
    const level = velocity / 127;
    const peak = VOICE_GAIN * drum.gain * level * level;
    const end = time + drum.duration;

    const env = context.createGain();
    env.gain.value = 0;
    env.gain.setValueAtTime(peak, time);
    env.gain.exponentialRampToValueAtTime(peak * 0.001, end);
    env.connect(c.gain);

    let source: AudioScheduledSourceNode;
    if (drum.kind === 'sweep') {
      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(drum.freq, time);
      osc.frequency.exponentialRampToValueAtTime(drum.freq / 3, end);
      osc.connect(env);
      source = osc;
    } else {
      const noise = context.createBufferSource();
      noise.buffer = this.getNoise();
      noise.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = drum.filter;
      filter.frequency.value = drum.freq;
      filter.Q.value = 0.8;
      noise.connect(filter);
      filter.connect(env);
      source = noise;
    }
    source.start(time);
    source.stop(end + 0.02);

    this.addVoice({
      source,
      detune: null,
      env,
      channel: PERCUSSION_CHANNEL,
      note,
      start: time,
      release: 0.05,
      released: true,
      held: false,
    });
  }
}
