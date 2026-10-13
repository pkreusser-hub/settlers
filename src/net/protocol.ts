// Wire protocol of an online game: JSON messages over one reliable, ordered
// channel between the host (player 0) and the guest (player 1).

import type { Command } from './command';

// Bumped whenever the messages, the lockstep constants or the simulation
// change in a way that two different builds could not play together.
export const PROTOCOL_VERSION = 3;

// A save game goes to the guest in parts of this many characters: the
// channel carries each message as one piece and has a size limit.
export const SAVE_PART_CHARS = 8192;
// The largest save game a guest takes (the largest map is well below).
export const SAVE_MAX_CHARS = 64 * 1024 * 1024;

/* Lockstep constants. Both sides must use the same values; they are part of
   the protocol version. */

// Length of one game update in ms (the game runs 50 updates a second).
export const UPDATE_MS = 20;
// Updates per turn: commands are exchanged once per turn, every 100 ms.
export const TURN_UPDATES = 5;
// Input delay in turns: a command issued during turn T runs at the first
// update of turn T + INPUT_DELAY_TURNS on both sides.
export const INPUT_DELAY_TURNS = 2;
// A state hash is exchanged every this many turns (5 seconds).
export const HASH_INTERVAL_TURNS = 50;

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
}

// Everything needed to build the identical game on both sides.
export interface GameSetup {
  mapSize: number;
  // Seed of the map generator, the 16 character form of Random.
  mapSeed: string;
  // Seed of Game.rnd, the random numbers of the running game.
  gameSeed: string;
  gameType: number;
  level: number;
  // Player 0 is the host, player 1 the guest, the rest computer players.
  players: NetPlayer[];
}

export type NetMessage =
  // Sent by both sides as soon as the channel opens.
  | { t: 'hello'; v: number }
  // Host to guest: build this game.
  | { t: 'start'; v: number; setup: GameSetup }
  // Host to guest: part i of the n parts of a save game, in order.
  | { t: 'save'; i: number; n: number; data: string }
  // Host to guest: build the game from the save game that was sent.
  | { t: 'startSave'; v: number }
  // Guest to host: the game is built, start the clock.
  | { t: 'ready' }
  // The sender's commands for one turn; sent for every turn, also empty.
  | { t: 'turn'; turn: number; cmds: Command[] }
  // The sender's state hash at the start of a turn.
  | { t: 'hash'; turn: number; hash: number }
  // Keeps the channel from looking dead while nothing else is sent.
  | { t: 'ping' };

// The channel as the session sees it. PeerJS is one implementation
// (peer-transport.ts), the in-memory pair of tools/lockstep-test.ts another.
export interface Transport {
  send(msg: NetMessage): void;
  close(): void;
  onMessage: ((msg: NetMessage) => void) | null;
  onClose: (() => void) | null;
}
