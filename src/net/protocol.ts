// Wire protocol of an online game: JSON messages over reliable, ordered
// channels in a star. Every guest has one channel, to the host; the host
// relays. The host is player 0, the guests are players 1 to 3.

import type { Command } from './command';

// Bumped whenever the messages, the lockstep constants or the simulation
// change in a way that two different builds could not play together.
export const PROTOCOL_VERSION = 5;

// Most human players of a game (the game has four players).
export const MAX_HUMANS = 4;

// A save game crosses the channel in parts of this many characters: the
// channel carries each message as one piece and has a size limit.
export const SAVE_PART_CHARS = 8192;
// The largest save game a guest takes (the largest map is well below).
export const SAVE_MAX_CHARS = 64 * 1024 * 1024;

// Longest chat line.
export const CHAT_MAX_CHARS = 200;

/* Lockstep constants. All sides must use the same values; they are part of
   the protocol version. */

// Length of one game update in ms (the game runs 50 updates a second).
export const UPDATE_MS = 20;
// Updates per turn: commands are exchanged once per turn, every 100 ms.
export const TURN_UPDATES = 5;
// Input delay in turns: when the host ends turn T it seals the commands of
// turn T + INPUT_DELAY_TURNS (its own of turn T and what the guests sent
// until then).
export const INPUT_DELAY_TURNS = 2;
// A state hash is checked every this many turns (5 seconds).
export const HASH_INTERVAL_TURNS = 50;
// The host does not begin a turn while a connected guest has finished
// fewer than that turn minus this many: a slow guest slows everyone.
export const MAX_LAG_TURNS = 10;

export interface NetColor {
  red: number;
  green: number;
  blue: number;
}

export interface NetPlayer {
  // Index into the character table of mission.ts; 12 and above are humans.
  face: number;
  color: NetColor;
  intelligence: number;
  supplies: number;
  reproduction: number;
  // Castle position, col -1 when the player places the castle.
  castle: { col: number; row: number };
  // EXT: the team, 0 none, 1 A, 2 B (TEAM_* of game.ts).
  team: number;
}

// Everything needed to build the identical game on all sides.
export interface GameSetup {
  mapSize: number;
  // Seed of the map generator, the 16 character form of Random.
  mapSeed: string;
  // Seed of Game.rnd, the random numbers of the running game.
  gameSeed: string;
  gameType: number;
  level: number;
  // Players 0 to humans - 1 are the host and the guests, the rest computer
  // players.
  humans: number;
  players: NetPlayer[];
  // EXT: the game options (GameRules of game.ts).
  rules: { stockPreset: number; peaceMinutes: number };
}

// Why the host does not take a guest.
export type RejectReason =
  // Every human place is taken.
  | 'full'
  // The host is in the setup box; the players are counted.
  | 'setup';

export type NetMessage =
  // Sent by both sides as soon as the channel opens. The guest's carries
  // its token: the host knows a guest that comes back by it.
  | { t: 'hello'; v: number; token?: string }
  // Host to guest, before the game: your place and how many are in the room.
  | { t: 'lobby'; you: number; count: number }
  // Host to guest: no place for you.
  | { t: 'reject'; reason: RejectReason }
  // Host to guest: build this game; you are this player.
  | { t: 'start'; v: number; setup: GameSetup; you: number }
  // Host to guest: part i of the n parts of a save game, in order.
  | { t: 'save'; i: number; n: number; data: string }
  // Host to guest: build the game from the save game that was sent.
  | { t: 'startSave'; v: number; you: number; humans: number }
  // Host to guest, in a running game: everyone builds the game again from
  // the save game that was sent (the state at the start of `turn`) and goes
  // on from there. `connected` is the roster by player.
  | { t: 'resync'; v: number; turn: number; you: number; humans: number; paused: boolean; connected: boolean[] }
  // Guest to host: the game of this start or resync is built.
  | { t: 'ready'; turn: number }
  // Guest to host: the guest has finished this turn; the commands it
  // issued since its last message.
  | { t: 'input'; turn: number; cmds: Command[] }
  // Host to guest: the commands of one turn by player, final. Sent for
  // every turn in order, also when it is empty.
  | { t: 'turn'; turn: number; cmds: Command[][] }
  // Guest to host: the guest's state hash at the start of a turn. `e` is
  // the turn its game was started or last built again at.
  | { t: 'hash'; turn: number; hash: number; e: number }
  // Host to guests: the hash of this player differs from the host's.
  | { t: 'desync'; turn: number; player: number; host: number; guest: number }
  // Host to guests: who is connected, by player.
  | { t: 'roster'; connected: boolean[] }
  // A chat line. Guest to host without `from`; the host adds it and relays.
  | { t: 'chat'; text: string; from?: number }
  // "Look here" on the map, relayed like chat.
  | { t: 'mark'; pos: number; from?: number }
  // Keeps the channel from looking dead while nothing else is sent.
  | { t: 'ping' };

// One channel as the session sees it. PeerJS is one implementation
// (peer-transport.ts), the in-memory pair of tools/lockstep-test.ts another.
export interface Transport {
  send(msg: NetMessage): void;
  close(): void;
  onMessage: ((msg: NetMessage) => void) | null;
  onClose: (() => void) | null;
}

/* Send a save game in parts. The message that says what to do with it
   follows. */
export function sendSaveText(transport: Transport, text: string): void {
  const n = Math.ceil(text.length / SAVE_PART_CHARS);
  for (let i = 0; i < n; i++) {
    const data = text.substring(i * SAVE_PART_CHARS, (i + 1) * SAVE_PART_CHARS);
    transport.send({ t: 'save', i, n, data });
  }
}

/* The receiving end of sendSaveText(). */
export class SaveAssembler {
  protected parts: string[] = [];
  protected chars = 0;

  /* False when the part is not the next one of a save game. */
  add(msg: { i: number; n: number; data: string }): boolean {
    if (typeof msg.data !== 'string' || msg.i !== this.parts.length ||
        this.chars + msg.data.length > SAVE_MAX_CHARS) {
      this.parts = [];
      this.chars = 0;
      return false;
    }
    this.parts.push(msg.data);
    this.chars += msg.data.length;
    return true;
  }

  /* The text; the next save game starts empty. */
  take(): string {
    const text = this.parts.join('');
    this.parts = [];
    this.chars = 0;
    return text;
  }
}
