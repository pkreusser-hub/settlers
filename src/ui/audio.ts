// audio.h + audio.cc + audio-sdlmixer.h + audio-sdlmixer.cc - Music and
// sound effects playback.
//
// PORT: SDL_mixer is replaced by the Web Audio API. The mixer, its four
// sound effect tracks and its music track are the AudioContext and gain
// nodes below; the music is played by the synthesizer of midi-player.ts.
// A browser gives no sound before the user has touched the page: the
// AudioContext is made on the first pointer or key event. Until then the
// calls keep their state (volumes, enabled players, the current music
// track) and play nothing; nothing is queued for later, except that the
// music starts with the current track once the context runs.

import { ExceptionFreeserf, Log } from '../game/misc';
import { Random } from '../game/random';
import { Data } from './data-instance';
import { EventLoop } from './event-loop';
import { GuiObject } from './gui';
import { MidiPlayer, MidiSong, parseMidi } from './midi-player';

export class ExceptionAudio extends ExceptionFreeserf {
  protected description: string;

  constructor(description: string) {
    super(description);
    this.description = description;
    this.message = this.getDescription();
  }

  getDescription(): string {
    return '[' + this.getSystem() + ':' + this.getPlatform() + '] ' + this.description;
  }

  getPlatform(): string {
    return 'Abstract';
  }

  getSystem(): string {
    return 'audio';
  }
}

// Audio::TypeSfx
export enum AudioTypeSfx {
  TypeSfxMessage = 1,
  TypeSfxAccepted = 2,
  TypeSfxNotAccepted = 4,
  TypeSfxUndo = 6,
  TypeSfxClick = 8,
  TypeSfxFight01 = 10,
  TypeSfxFight02 = 14,
  TypeSfxFight03 = 18,
  TypeSfxFight04 = 22,
  TypeSfxResourceFound = 26,
  TypeSfxPickBlow = 28,
  TypeSfxMetalHammering = 30,
  TypeSfxAxBlow = 32,
  TypeSfxTreeFall = 34,
  TypeSfxWoodHammering = 36,
  TypeSfxElevator = 38,
  TypeSfxHammerBlow = 40,
  TypeSfxSawing = 42,
  TypeSfxMillGrinding = 43,
  TypeSfxBackswordBlow = 44,
  TypeSfxGeologistSampling = 46,
  TypeSfxPlanting = 48,
  TypeSfxDigging = 50,
  TypeSfxMowing = 52,
  TypeSfxFishingRodReel = 54,
  TypeSfxUnknown21 = 58,
  TypeSfxPigOink = 60,
  TypeSfxGoldBoils = 62,
  TypeSfxRowing = 64,
  TypeSfxUnknown25 = 66,
  TypeSfxSerfDying = 69,
  TypeSfxBirdChirp0 = 70,
  TypeSfxBirdChirp1 = 74,
  TypeSfxAhhh = 76,
  TypeSfxBirdChirp2 = 78,
  TypeSfxBirdChirp3 = 82,
  TypeSfxBurning = 84,
  TypeSfxWaves = 86,
  TypeSfxWind = 88,
}

// Audio::TypeMidi
export enum AudioTypeMidi {
  TypeMidiNone = -1,
  TypeMidiTrack0 = 0,
  TypeMidiTrack1 = 1,
  TypeMidiTrack2 = 2,
  TypeMidiTrack3 = 4,
  TypeMidiTrackLast = TypeMidiTrack3,
}

// Audio::VolumeController
export interface AudioVolumeController {
  getVolume(): number;
  setVolume(volume: number): void;
  volumeUp(): void;
  volumeDown(): void;
}
export type AudioPVolumeController = AudioVolumeController | null;

// Audio::Track
export abstract class AudioTrack {
  abstract play(): void;
  /* Play on a channel replacing what plays there, at a volume (0..1)
     and a frequency ratio. */
  playOnChannel(_channel: number, _volume: number, _ratio: number): void {
    this.play();
  }
}
export type AudioPTrack = AudioTrack | null;

// Audio::Player
export abstract class AudioPlayer {
  protected trackCache: Map<number, AudioTrack> = new Map();
  protected enabled: boolean;

  constructor() {
    this.enabled = true;
  }

  playTrack(trackId: number): AudioPTrack {
    if (!this.isEnabled()) {
      return null;
    }

    const track = this.getTrack(trackId);
    if (track !== null) {
      track.play();
    }

    return track;
  }

  playTrackOnChannel(trackId: number, channel: number, vol: number, ratio: number): AudioPTrack {
    if (!this.isEnabled()) {
      return null;
    }

    const track = this.getTrack(trackId);
    if (track !== null) {
      track.playOnChannel(channel, vol, ratio);
    }

    return track;
  }

  abstract enable(enable: boolean): void;

  isEnabled(): boolean {
    return this.enabled;
  }

  /* Forget the loaded tracks (the data source changed). */
  clearCache(): void {
    this.trackCache.clear();
  }

  abstract getVolumeController(): AudioPVolumeController;

  protected getTrack(trackId: number): AudioPTrack {
    let track: AudioPTrack;
    const it = this.trackCache.get(trackId);
    if (it === undefined) {
      track = this.createTrack(trackId);
      if (track !== null) {
        this.trackCache.set(trackId, track);
      }
    } else {
      track = it;
    }

    return track;
  }

  protected abstract createTrack(trackId: number): AudioPTrack;
  protected abstract stop(): void;
}
export type AudioPPlayer = AudioPlayer | null;

/* Number of sound effects of the original (Amiga sfx_table). */
const kSfxCount = 96;
/* Number of channels playing sound effects (Amiga Paula). */
const kSfxChannels = 4;

/* Sound effect parameters of the original (Amiga sfx_table, 0x2f334):
   base period, period random mask, base volume (0..64), volume random
   mask, and the frames (1/50 s) the channel stays reserved. */
interface SfxParams {
  period: number;
  periodMask: number;
  volume: number;
  volumeMask: number;
  duration: number;
}

const p = (
  period: number,
  periodMask: number,
  volume: number,
  volumeMask: number,
  duration: number,
): SfxParams => ({ period, periodMask, volume, volumeMask, duration });

// prettier-ignore
const sfxParams: SfxParams[] = [
  p(0, 0, 0, 0, 0), p(427, 0, 64, 0, 96), p(427, 0, 48, 0, 40),  /* 0 */
  p(0, 0, 0, 0, 0), p(427, 0, 64, 0, 86), p(0, 0, 0, 0, 0),  /* 3 */
  p(427, 0, 20, 0, 36), p(0, 0, 0, 0, 0), p(220, 0, 25, 0, 1),  /* 6 */
  p(0, 0, 0, 0, 0), p(412, 31, 25, 15, 75), p(0, 0, 0, 0, 0),  /* 9 */
  p(0, 0, 0, 0, 0), p(0, 0, 0, 0, 0), p(412, 31, 25, 15, 94),  /* 12 */
  p(0, 0, 0, 0, 0), p(0, 0, 0, 0, 0), p(0, 0, 0, 0, 0),  /* 15 */
  p(412, 31, 25, 15, 80), p(0, 0, 0, 0, 0), p(0, 0, 0, 0, 0),  /* 18 */
  p(0, 0, 0, 0, 0), p(412, 31, 25, 15, 51), p(0, 0, 0, 0, 0),  /* 21 */
  p(0, 0, 0, 0, 0), p(0, 0, 0, 0, 0), p(412, 31, 29, 7, 147),  /* 24 */
  p(0, 0, 0, 0, 0), p(396, 63, 23, 15, 32), p(0, 0, 0, 0, 0),  /* 27 */
  p(420, 15, 9, 7, 54), p(0, 0, 0, 0, 0), p(396, 63, 25, 15, 39),  /* 30 */
  p(0, 0, 0, 0, 0), p(1774, 31, 25, 15, 266), p(0, 0, 0, 0, 0),  /* 33 */
  p(412, 31, 9, 7, 39), p(0, 0, 0, 0, 0), p(412, 31, 17, 7, 27),  /* 36 */
  p(0, 0, 0, 0, 0), p(396, 63, 25, 15, 17), p(0, 0, 0, 0, 0),  /* 39 */
  p(879, 31, 9, 3, 145), p(729, 31, 9, 3, 145), p(412, 31, 7, 3, 32),  /* 42 */
  p(0, 0, 0, 0, 0), p(205, 31, 25, 15, 8), p(0, 0, 0, 0, 0),  /* 45 */
  p(412, 31, 25, 15, 21), p(0, 0, 0, 0, 0), p(945, 31, 25, 15, 152),  /* 48 */
  p(0, 0, 0, 0, 0), p(492, 31, 17, 7, 49), p(0, 0, 0, 0, 0),  /* 51 */
  p(248, 0, 32, 0, 6), p(0, 0, 0, 0, 0), p(0, 0, 0, 0, 0),  /* 54 */
  p(0, 0, 0, 0, 0), p(412, 31, 25, 15, 24), p(0, 0, 0, 0, 0),  /* 57 */
  p(362, 255, 12, 7, 48), p(0, 0, 0, 0, 0), p(1156, 63, 7, 3, 228),  /* 60 */
  p(0, 0, 0, 0, 0), p(825, 63, 9, 7, 243), p(0, 0, 0, 0, 0),  /* 63 */
  p(887, 15, 7, 3, 200), p(0, 0, 0, 0, 0), p(0, 0, 0, 0, 0),  /* 66 */
  p(465, 63, 13, 7, 139), p(205, 31, 5, 15, 17), p(0, 0, 0, 0, 0),  /* 69 */
  p(0, 0, 0, 0, 0), p(0, 0, 0, 0, 0), p(205, 31, 5, 15, 65),  /* 72 */
  p(0, 0, 0, 0, 0), p(396, 63, 17, 7, 210), p(0, 0, 0, 0, 0),  /* 75 */
  p(251, 31, 5, 15, 99), p(0, 0, 0, 0, 0), p(0, 0, 0, 0, 0),  /* 78 */
  p(0, 0, 0, 0, 0), p(205, 31, 5, 15, 135), p(0, 0, 0, 0, 0),  /* 81 */
  p(412, 31, 9, 7, 405), p(0, 0, 0, 0, 0), p(831, 127, 0, 0, 1114),  /* 84 */
  p(0, 0, 0, 0, 0), p(533, 127, 0, 0, 764), p(0, 0, 0, 0, 0),  /* 87 */
  p(0, 0, 0, 0, 0), p(0, 0, 0, 0, 0), p(0, 0, 0, 0, 0),  /* 90 */
  p(0, 0, 0, 0, 0), p(0, 0, 0, 0, 0), p(0, 0, 0, 0, 0),  /* 93 */
];

export abstract class Audio {
  static TypeSfx = AudioTypeSfx;
  static TypeMidi = AudioTypeMidi;

  // PORT: the members of the two enums as statics too, Audio::TypeSfxClick
  // is Audio.TypeSfxClick, Audio.TypeSfx.TypeSfxClick or
  // AudioTypeSfx.TypeSfxClick.
  static readonly TypeSfxMessage = AudioTypeSfx.TypeSfxMessage;
  static readonly TypeSfxAccepted = AudioTypeSfx.TypeSfxAccepted;
  static readonly TypeSfxNotAccepted = AudioTypeSfx.TypeSfxNotAccepted;
  static readonly TypeSfxUndo = AudioTypeSfx.TypeSfxUndo;
  static readonly TypeSfxClick = AudioTypeSfx.TypeSfxClick;
  static readonly TypeSfxFight01 = AudioTypeSfx.TypeSfxFight01;
  static readonly TypeSfxFight02 = AudioTypeSfx.TypeSfxFight02;
  static readonly TypeSfxFight03 = AudioTypeSfx.TypeSfxFight03;
  static readonly TypeSfxFight04 = AudioTypeSfx.TypeSfxFight04;
  static readonly TypeSfxResourceFound = AudioTypeSfx.TypeSfxResourceFound;
  static readonly TypeSfxPickBlow = AudioTypeSfx.TypeSfxPickBlow;
  static readonly TypeSfxMetalHammering = AudioTypeSfx.TypeSfxMetalHammering;
  static readonly TypeSfxAxBlow = AudioTypeSfx.TypeSfxAxBlow;
  static readonly TypeSfxTreeFall = AudioTypeSfx.TypeSfxTreeFall;
  static readonly TypeSfxWoodHammering = AudioTypeSfx.TypeSfxWoodHammering;
  static readonly TypeSfxElevator = AudioTypeSfx.TypeSfxElevator;
  static readonly TypeSfxHammerBlow = AudioTypeSfx.TypeSfxHammerBlow;
  static readonly TypeSfxSawing = AudioTypeSfx.TypeSfxSawing;
  static readonly TypeSfxMillGrinding = AudioTypeSfx.TypeSfxMillGrinding;
  static readonly TypeSfxBackswordBlow = AudioTypeSfx.TypeSfxBackswordBlow;
  static readonly TypeSfxGeologistSampling = AudioTypeSfx.TypeSfxGeologistSampling;
  static readonly TypeSfxPlanting = AudioTypeSfx.TypeSfxPlanting;
  static readonly TypeSfxDigging = AudioTypeSfx.TypeSfxDigging;
  static readonly TypeSfxMowing = AudioTypeSfx.TypeSfxMowing;
  static readonly TypeSfxFishingRodReel = AudioTypeSfx.TypeSfxFishingRodReel;
  static readonly TypeSfxUnknown21 = AudioTypeSfx.TypeSfxUnknown21;
  static readonly TypeSfxPigOink = AudioTypeSfx.TypeSfxPigOink;
  static readonly TypeSfxGoldBoils = AudioTypeSfx.TypeSfxGoldBoils;
  static readonly TypeSfxRowing = AudioTypeSfx.TypeSfxRowing;
  static readonly TypeSfxUnknown25 = AudioTypeSfx.TypeSfxUnknown25;
  static readonly TypeSfxSerfDying = AudioTypeSfx.TypeSfxSerfDying;
  static readonly TypeSfxBirdChirp0 = AudioTypeSfx.TypeSfxBirdChirp0;
  static readonly TypeSfxBirdChirp1 = AudioTypeSfx.TypeSfxBirdChirp1;
  static readonly TypeSfxAhhh = AudioTypeSfx.TypeSfxAhhh;
  static readonly TypeSfxBirdChirp2 = AudioTypeSfx.TypeSfxBirdChirp2;
  static readonly TypeSfxBirdChirp3 = AudioTypeSfx.TypeSfxBirdChirp3;
  static readonly TypeSfxBurning = AudioTypeSfx.TypeSfxBurning;
  static readonly TypeSfxWaves = AudioTypeSfx.TypeSfxWaves;
  static readonly TypeSfxWind = AudioTypeSfx.TypeSfxWind;

  static readonly TypeMidiNone = AudioTypeMidi.TypeMidiNone;
  static readonly TypeMidiTrack0 = AudioTypeMidi.TypeMidiTrack0;
  static readonly TypeMidiTrack1 = AudioTypeMidi.TypeMidiTrack1;
  static readonly TypeMidiTrack2 = AudioTypeMidi.TypeMidiTrack2;
  static readonly TypeMidiTrack3 = AudioTypeMidi.TypeMidiTrack3;
  static readonly TypeMidiTrackLast = AudioTypeMidi.TypeMidiTrackLast;

  /* Number of sound effects of the original (Amiga sfx_table). */
  static readonly kSfxCount = kSfxCount;
  /* Number of channels playing sound effects (Amiga Paula). */
  static readonly kSfxChannels = kSfxChannels;

  static Player = AudioPlayer;
  static Track = AudioTrack;

  protected static instance: Audio | null = null;

  protected volume: number;

  /* Sound effects as the original schedules them (Amiga
     enqueue_sfx_clip @0x1beb0, audio_vbl_update @0x2dd6). */
  protected sfxQueue: number[] = [0, 0, 0, 0];
  protected sfxChannel: number[] = new Array<number>(kSfxChannels);
  protected sfxTimer: number[] = new Array<number>(kSfxChannels);
  protected sfxVolume: number[] = new Array<number>(kSfxCount);
  protected sfxRandom: Random;

  protected constructor() {
    this.volume = Math.fround(0.75);
    this.sfxRandom = new Random(0x5a5a, 0x1234, 0x8765);
    for (let i = 0; i < 4; i++) this.sfxQueue[i] = 0xff;
    for (let i = 0; i < kSfxChannels; i++) {
      this.sfxChannel[i] = 0xff;
      this.sfxTimer[i] = 0;
    }
    for (let i = 0; i < kSfxCount; i++) this.sfxVolume[i] = sfxParams[i].volume;
  }

  /* Common audio. */

  // PORT: defined in audio-sdlmixer.cc, which makes an AudioDummy when
  // there is no usable audio device. AudioWeb can not fail that way: it
  // stays silent when the browser has no Web Audio API.
  static getInstance(): Audio {
    if (Audio.instance === null) {
      Audio.instance = new AudioWeb();
      installHooks();
    }
    return Audio.instance;
  }

  /* Insert into the sorted queue, a lower id takes precedence (Amiga
     enqueue_sfx_clip @0x1beb0). */
  enqueueSfx(sfx: number): void {
    if (sfx < 0 || sfx >= kSfxCount || sfxParams[sfx].period === 0) return;

    for (let i = 0; i < 4; i++) {
      if (sfx === this.sfxQueue[i]) return;
      if (sfx < this.sfxQueue[i]) {
        for (let j = 3; j > i; j--) this.sfxQueue[j] = this.sfxQueue[j - 1];
        this.sfxQueue[i] = sfx;
        return;
      }
    }
  }

  /* Base volume of a sound, the ambient sounds set it before playing. */
  setSfxVolume(sfx: number, _volume: number): void {
    this.sfxVolume[sfx] = _volume;
  }

  /* Called every 1/50 s: the queued sounds take the channels holding the
     least important sounds, a sound replaces one of the same or a higher
     id. The queue is emptied (Amiga audio_vbl_update @0x2dd6). */
  updateSfx(): void {
    for (let i = 0; i < kSfxChannels; i++) {
      if (this.sfxTimer[i] !== 0 && --this.sfxTimer[i] === 0) this.sfxChannel[i] = 0xff;
    }

    const player = this.getSoundPlayer();
    if (!player || !player.isEnabled() || this.sfxQueue[0] === 0xff) {
      for (let i = 0; i < 4; i++) this.sfxQueue[i] = 0xff;
      return;
    }

    /* Channels by the id of their sound, free ones first. */
    const order: number[] = [];
    for (let i = 0; i < kSfxChannels; i++) order[i] = i;
    order.sort((a, b) => this.sfxChannel[b] - this.sfxChannel[a]);

    for (let i = 0; i < 4 && this.sfxQueue[i] !== 0xff; i++) {
      const channel = order[i];
      const sfx = this.sfxQueue[i];
      if (this.sfxChannel[channel] < sfx) break;

      const params = sfxParams[sfx];
      const r = this.sfxRandom.random();
      const period = params.period + (r & params.periodMask);
      const vol = Math.min(64, (this.sfxVolume[sfx] + (r & params.volumeMask)) & 0xff);

      this.sfxChannel[channel] = sfx;
      this.sfxTimer[channel] = params.duration;
      player.playTrackOnChannel(
        sfx,
        channel,
        Math.fround(vol / 64),
        Math.fround(Math.fround(params.period) / period),
      );
    }

    for (let i = 0; i < 4; i++) this.sfxQueue[i] = 0xff;
  }

  abstract getVolumeController(): AudioVolumeController | null;
  abstract getSoundPlayer(): AudioPPlayer;
  abstract getMusicPlayer(): AudioPPlayer;
  /* The sounds or the music now come from another data source. */
  dataChanged(_sounds: boolean, _music: boolean): void {}
}

// PORT: the nested types of the C++ class, for Audio.PPlayer and the like
// in type positions.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Audio {
  export type TypeSfx = AudioTypeSfx;
  export type TypeMidi = AudioTypeMidi;
  export type VolumeController = AudioVolumeController;
  export type PVolumeController = AudioPVolumeController;
  export type Track = AudioTrack;
  export type PTrack = AudioPTrack;
  export type Player = AudioPlayer;
  export type PPlayer = AudioPPlayer;
}

// ExceptionSDLmixer
export class ExceptionWebAudio extends ExceptionAudio {
  override getPlatform(): string {
    return 'WebAudio';
  }
}

/* Tracks of the sound effect channels and their sounds' volume. */
const SFX_TRACKS = kSfxChannels;

/* Sample rate of the sound effects (the default of ConvertorSFX2WAV). */
const SFX_RATE = 8000;

// PORT: a MIX_Track of a sound effect channel: its gain node and the
// source playing on it. The frequency ratio is kept here, a source of the
// Web Audio API plays once and a new one is made for every sound.
interface SfxTrack {
  gain: GainNode;
  source: AudioBufferSourceNode | null;
}

let mixer: AudioContext | null = null;
let sfxTracks: SfxTrack[] = [];
const sfxTrackVolume: number[] = [1, 1, 1, 1];
const sfxTrackRatio: number[] = [1, 1, 1, 1];
let sfxMasterVolume = 1;
let musicTrack: GainNode | null = null;
/* Gain of the music track (MIX_GetTrackGain), kept while there is no
   context. */
let musicTrackGain = 1;
/* Plays on the music track. */
let musicSynth: MidiPlayer | null = null;

/* A user event has asked the context to run and it has not answered yet. */
let unlocking = false;
/* The context has run once. */
let unlocked = false;
let hooksInstalled = false;

/* The mixer can play now. */
function mixerReady(): boolean {
  return mixer !== null && (mixer.state === 'running' || unlocking);
}

// AudioSDL::init_mixer()
// PORT: called for the first user event instead of from the constructor.
function initMixer(): void {
  const global = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Context = global.AudioContext ?? global.webkitAudioContext;
  if (Context === undefined) {
    throw new ExceptionWebAudio('Could not open audio device');
  }

  const context = new Context();
  Log.Info('audio:WebAudio', 'Initializing Web Audio (' + context.sampleRate + ' Hz)');

  sfxTracks = [];
  for (let i = 0; i < SFX_TRACKS; i++) {
    const gain = context.createGain();
    gain.gain.value = sfxMasterVolume * sfxTrackVolume[i];
    gain.connect(context.destination);
    sfxTracks.push({ gain, source: null });
  }

  musicTrack = context.createGain();
  musicTrack.gain.value = musicTrackGain;
  musicTrack.connect(context.destination);
  musicSynth = new MidiPlayer(context, musicTrack);
  // MIX_SetTrackStoppedCallback(music_track, music_finished_hook, nullptr)
  musicSynth.onFinished = () => PlayerMIDI.musicFinishedHook();

  mixer = context;

  Log.Info('audio:WebAudio', 'Initialized');
}

/* The keys that are no user activation for the browser. */
const passiveKeys = ['Escape', 'Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'];

// PORT: not in the C++. Handler of the pointer and key events of the
// window: makes the context on the first one and wakes a context the
// browser has suspended.
function handleUserEvent(event: globalThis.Event): void {
  if (mixer !== null && mixer.state === 'running') {
    return;
  }
  if (event.type === 'keydown' && passiveKeys.indexOf((event as KeyboardEvent).key) !== -1) {
    return;
  }
  const activation = (navigator as { userActivation?: { isActive: boolean } }).userActivation;
  if (activation !== undefined && !activation.isActive) {
    return;
  }

  if (mixer === null) {
    try {
      initMixer();
    } catch (e) {
      /* Without a usable audio device the game runs without sound. */
      Log.Error('audio', e instanceof Error ? e.message : e, '; continuing without sound.');
      removeUserEventListeners();
      return;
    }
  }

  const context = mixer as AudioContext;
  const started = (): void => {
    unlocking = false;
    if (context.state !== 'running' || unlocked) {
      return;
    }
    unlocked = true;
    const instance = AudioWeb.current;
    if (instance !== null) {
      instance.mixerStarted();
    }
  };

  if (context.state === 'running') {
    started();
    return;
  }
  unlocking = true;
  /* Not for ever, should the browser never answer. */
  setTimeout(() => {
    unlocking = false;
  }, 1000);
  context.resume().then(started, () => {
    unlocking = false;
  });
}

const userEvents = ['pointerdown', 'pointerup', 'mousedown', 'touchend', 'click', 'keydown'];

function removeUserEventListeners(): void {
  for (const type of userEvents) {
    window.removeEventListener(type, handleUserEvent, true);
  }
}

// PORT: not in the C++. Connects the GUI (GuiObject::play_sound() calls
// Audio::get_instance().enqueue_sfx()) and listens for the user events.
// Called once after the modules are loaded and by Audio.getInstance().
function installHooks(): void {
  if (hooksInstalled) {
    return;
  }
  hooksInstalled = true;

  GuiObject.enqueueSfx = (sound: number): void => {
    Audio.getInstance().enqueueSfx(sound);
  };

  if (typeof window !== 'undefined') {
    for (const type of userEvents) {
      window.addEventListener(type, handleUserEvent, { capture: true, passive: true });
    }
  }
}

/* Stop what plays on a sound effect track (MIX_StopTrack). */
function stopSfxTrack(track: SfxTrack): void {
  const source = track.source;
  if (source !== null) {
    track.source = null;
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* Not started. */
    }
    source.disconnect();
  }
}

/* MIX_SetTrackAudio and MIX_PlayTrack. */
function playSfxTrack(index: number, chunk: AudioBuffer): boolean {
  const context = mixer;
  if (context === null) {
    return false;
  }
  const track = sfxTracks[index];
  const source = context.createBufferSource();
  source.buffer = chunk;
  source.playbackRate.value = sfxTrackRatio[index];
  source.connect(track.gain);
  source.onended = () => {
    if (track.source === source) {
      track.source = null;
    }
    source.disconnect();
  };
  track.source = source;
  source.start();
  return true;
}

export class AudioWeb extends Audio implements AudioVolumeController {
  // PORT: the instance for the user event handler, which must not make
  // one.
  static current: AudioWeb | null = null;

  protected sfxPlayer: AudioPPlayer = null;
  protected midiPlayer: AudioPPlayer = null;

  /* Common audio. */
  constructor() {
    super();
    Log.Info('audio', 'Initializing "webaudio".');

    // PORT: the mixer itself is made on the first user event, see
    // initMixer().
    this.volume = 1;

    this.sfxPlayer = new PlayerSFX();
    this.midiPlayer = new PlayerMIDI();

    AudioWeb.current = this;
  }

  // PORT: not in the C++. The context runs for the first time: start the
  // music that was asked for while there was no sound.
  mixerStarted(): void {
    const player = this.midiPlayer;
    if (player instanceof PlayerMIDI) {
      player.mixerStarted();
    }
  }

  getVolumeController(): AudioVolumeController {
    return this;
  }

  getSoundPlayer(): AudioPPlayer {
    return this.sfxPlayer;
  }

  getMusicPlayer(): AudioPPlayer {
    return this.midiPlayer;
  }

  override dataChanged(sounds: boolean, music: boolean): void {
    /* Sound effects are decoded when loaded, the playing ones keep their
       audio (MIX_Audio is reference counted). */
    if (sounds && this.sfxPlayer) this.sfxPlayer.clearCache();
    if (music && this.midiPlayer) this.midiPlayer.clearCache();
  }

  getVolume(): number {
    return this.volume;
  }

  setVolume(_volume: number): void {
    _volume = Math.fround(Math.max(0, Math.min(_volume, 1)));
    if (Math.abs(this.volume - _volume) < Math.fround(0.01)) {
      return;
    }
    this.volume = _volume;

    if (this.midiPlayer !== null) {
      const volumeController = this.midiPlayer.getVolumeController();
      if (volumeController) {
        volumeController.setVolume(this.volume);
      }
    }

    if (this.sfxPlayer !== null) {
      const volumeController = this.sfxPlayer.getVolumeController();
      if (volumeController) {
        volumeController.setVolume(this.volume);
      }
    }
  }

  volumeUp(): void {
    const vol = this.getVolume();
    this.setVolume(Math.fround(vol + Math.fround(0.1)));
  }

  volumeDown(): void {
    const vol = this.getVolume();
    this.setVolume(Math.fround(vol - Math.fround(0.1)));
  }
}

class TrackSFX extends AudioTrack {
  // PORT: the samples of the data source; the AudioBuffer (the MIX_Audio
  // of the C++) is made from them for the first playing, when there is a
  // context.
  protected samples: Int16Array;
  protected chunk: AudioBuffer | null = null;

  constructor(samples: Int16Array) {
    super();
    this.samples = samples;
  }

  protected getChunk(): AudioBuffer | null {
    const context = mixer;
    if (this.chunk !== null || context === null || this.samples.length === 0) {
      return this.chunk;
    }

    const samples = this.samples;
    let chunk: AudioBuffer;
    try {
      chunk = context.createBuffer(1, samples.length, SFX_RATE);
      const out = chunk.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        out[i] = samples[i] / 0x8000;
      }
    } catch {
      /* A browser that has no buffers of this rate: at the rate of the
         context, with linear interpolation. */
      const step = SFX_RATE / context.sampleRate;
      const length = Math.max(1, Math.floor(samples.length / step));
      chunk = context.createBuffer(1, length, context.sampleRate);
      const out = chunk.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const pos = i * step;
        const n = Math.floor(pos);
        const a = samples[n];
        const b = n + 1 < samples.length ? samples[n + 1] : a;
        out[i] = (a + (b - a) * (pos - n)) / 0x8000;
      }
    }
    this.chunk = chunk;
    return chunk;
  }

  play(): void {
    if (!mixerReady()) {
      return;
    }
    const chunk = this.getChunk();
    if (chunk === null) {
      return;
    }

    /* Play on the first free track. */
    for (let i = 0; i < SFX_TRACKS; i++) {
      const track = sfxTracks[i];
      if (track.source !== null) {
        continue;
      }
      if (!playSfxTrack(i, chunk)) {
        Log.Error('audio:WebAudio', 'Could not play SFX clip');
      }
      return;
    }

    Log.Warn('audio:WebAudio', 'Could not play SFX clip: no free track');
  }

  override playOnChannel(channel: number, volume: number, ratio: number): void {
    // PORT: nothing plays before the first user event.
    if (!mixerReady()) {
      return;
    }
    const chunk = this.getChunk();
    if (chunk === null) {
      return;
    }

    const track = sfxTracks[channel];
    stopSfxTrack(track);
    sfxTrackVolume[channel] = volume;
    track.gain.gain.value = sfxMasterVolume * volume;
    sfxTrackRatio[channel] = ratio;
    if (!playSfxTrack(channel, chunk)) {
      Log.Error('audio:WebAudio', 'Could not play SFX clip');
    }
  }
}

class PlayerSFX extends AudioPlayer implements AudioVolumeController {
  protected volume: number;

  constructor() {
    super();
    this.volume = 1;
  }

  enable(enable: boolean): void {
    this.enabled = enable;
    if (!this.enabled) {
      this.stop();
    }
  }

  getVolumeController(): AudioPVolumeController {
    return this;
  }

  protected createTrack(trackId: number): AudioPTrack {
    const data = Data.getInstance();
    // PORT: get_data_source() of the port throws without data.
    if (!data.isLoaded()) {
      return null;
    }
    const dataSource = data.getDataSource();

    const wav = dataSource.getSound(trackId);
    if (!wav) {
      return null;
    }

    return new TrackSFX(wav);
  }

  protected stop(): void {
    for (let i = 0; i < sfxTracks.length; i++) {
      stopSfxTrack(sfxTracks[i]);
    }
  }

  getVolume(): number {
    return this.volume;
  }

  setVolume(_volume: number): void {
    this.volume = Math.fround(Math.max(0, Math.min(_volume, 1)));
    sfxMasterVolume = this.volume;
    for (let i = 0; i < sfxTracks.length; i++) {
      sfxTracks[i].gain.gain.value = this.volume * sfxTrackVolume[i];
    }
  }

  volumeUp(): void {
    this.setVolume(Math.fround(this.getVolume() + Math.fround(0.1)));
  }

  volumeDown(): void {
    this.setVolume(Math.fround(this.getVolume() - Math.fround(0.1)));
  }
}

class TrackMIDI extends AudioTrack {
  protected data: Uint8Array;
  protected chunk: MidiSong;

  constructor(data: Uint8Array, chunk: MidiSong) {
    super();
    this.data = data;
    this.chunk = chunk;
  }

  play(): void {
    // PORT: nothing plays before the first user event; the player starts
    // its current track when the context runs (PlayerMIDI.mixerStarted()).
    if (!mixerReady() || musicSynth === null) {
      return;
    }

    /* Replacing the playing track must not run the finished hook. */
    // PORT: MidiPlayer.play() stops the song playing without the hook.
    musicSynth.play(this.chunk, false);
  }
}

class PlayerMIDI extends AudioPlayer implements AudioVolumeController {
  protected currentTrack: AudioTypeMidi;

  protected static currentMidiPlayer: PlayerMIDI | null = null;

  constructor() {
    super();
    if (PlayerMIDI.currentMidiPlayer !== null) {
      throw new ExceptionWebAudio('Only one midi player is allowed');
    }
    this.currentTrack = AudioTypeMidi.TypeMidiNone;
    PlayerMIDI.currentMidiPlayer = this;
  }

  // PORT: not in the C++, see AudioWeb.mixerStarted().
  mixerStarted(): void {
    if (
      this.enabled &&
      this.currentTrack !== AudioTypeMidi.TypeMidiNone &&
      !(musicSynth !== null && musicSynth.isPlaying())
    ) {
      this.playTrack(this.currentTrack);
    }
  }

  protected createTrack(trackId: number): AudioPTrack {
    const data = Data.getInstance();
    // PORT: get_data_source() of the port throws without data.
    if (!data.isLoaded()) {
      return null;
    }
    const dataSource = data.getDataSource();

    const midi = dataSource.getMusic(trackId);
    if (!midi) {
      return null;
    }

    // PORT: MIX_LoadAudio with FluidSynth and a SoundFont in the C++, the
    // MIDI file is parsed for the synthesizer of midi-player.ts here.
    const music = parseMidi(midi);
    if (music === null) {
      Log.Warn('audio:WebAudio', 'Could not load music track: not a MIDI file');
      return null;
    }

    return new TrackMIDI(midi, music);
  }

  override playTrack(trackId: number): AudioPTrack {
    /* Skip missing tracks; after the last one start again with the first,
       but only once, so that it ends when no track can be played. */
    let track: AudioPTrack = null;
    let wrapped = false;
    while (!track) {
      if (trackId <= AudioTypeMidi.TypeMidiNone || trackId > AudioTypeMidi.TypeMidiTrackLast) {
        if (wrapped) {
          break;
        }
        wrapped = true;
        trackId = AudioTypeMidi.TypeMidiTrack0;
      }
      this.currentTrack = trackId as AudioTypeMidi;
      Log.Info('audio:WebAudio', 'Playing MIDI track: ' + this.currentTrack);
      track = super.playTrack(trackId);
      trackId++;
    }
    return track;
  }

  enable(enable: boolean): void {
    this.enabled = enable;
    if (!this.enabled) {
      this.stop();
    } else if (!(musicSynth !== null && musicSynth.isPlaying())) {
      /* Start the music again where it was stopped. */
      this.playTrack(
        this.currentTrack === AudioTypeMidi.TypeMidiNone
          ? AudioTypeMidi.TypeMidiTrack0
          : this.currentTrack,
      );
    }
  }

  getVolumeController(): AudioPVolumeController {
    return this;
  }

  /* Play the current track again from the new data. */
  override clearCache(): void {
    /* The old tracks are kept until the new one plays: the track playing
       reads from its data. */
    this.trackCache = new Map();
    if (this.enabled) {
      this.playTrack(
        this.currentTrack === AudioTypeMidi.TypeMidiNone
          ? AudioTypeMidi.TypeMidiTrack0
          : this.currentTrack,
      );
    } else if (musicSynth !== null) {
      musicSynth.stop();
    }
  }

  protected stop(): void {
    // PORT: MIX_StopTrack() runs the stopped callback of a playing track,
    // MidiPlayer.stop() does not.
    if (musicSynth !== null && musicSynth.isPlaying()) {
      musicSynth.stop();
      PlayerMIDI.musicFinishedHook();
    }
  }

  getVolume(): number {
    return musicTrackGain;
  }

  setVolume(volume: number): void {
    volume = Math.fround(Math.max(0, Math.min(volume, 1)));
    musicTrackGain = volume;
    if (musicTrack !== null) {
      musicTrack.gain.value = volume;
    }
  }

  volumeUp(): void {
    this.setVolume(Math.fround(this.getVolume() + Math.fround(0.1)));
  }

  volumeDown(): void {
    this.setVolume(Math.fround(this.getVolume() - Math.fround(0.1)));
  }

  static musicFinishedHook(): void {
    if (PlayerMIDI.currentMidiPlayer !== null) {
      const eventLoop = EventLoop.getInstance();
      eventLoop.deferredCall(() => {
        if (PlayerMIDI.currentMidiPlayer !== null) {
          PlayerMIDI.currentMidiPlayer.musicFinished();
        }
      }, null);
    }
  }

  protected musicFinished(): void {
    if (this.isEnabled()) {
      this.playTrack(this.currentTrack + 1);
    }
  }
}

// PORT: connect the GUI and the user events once all modules are loaded
// (not at the top level: the imports of the UI modules are circular).
queueMicrotask(installHooks);
