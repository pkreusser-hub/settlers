// Player commands: the only way the UI may change simulation state.
//
// In an online game both browsers run the same simulation and only commands
// cross the network, so every change a player makes has to be a Command
// that executeCommand() applies identically on both sides. The UI calls
// issue(); the active CommandSink decides when the command runs (at once in
// a local game, on an agreed future update in a network game).

import type { Game } from '../game/game';

// JSON-serializable. `type` selects the handler in executeCommand().
export type CommandValue = number | boolean | string | number[];
export interface Command {
  type: string;
  [arg: string]: CommandValue;
}

export interface CommandSink {
  // Called by the UI for the local player.
  issue(cmd: Command): void;
}

// Drives the simulation. The interface calls tick() once per event loop
// update instead of calling game.update() itself.
export interface GameClock {
  tick(game: Game): void;
}

let localPlayer = 0;
let sink: CommandSink | null = null;
let clock: GameClock = { tick: (game) => game.update() };

// Index of the player this browser controls.
export function getLocalPlayer(): number {
  return localPlayer;
}

export function setLocalPlayer(index: number): void {
  localPlayer = index;
}

export function setCommandSink(s: CommandSink | null): void {
  sink = s;
}

// Whether a sink is installed (a network game): commands then run later and
// only for the local player.
export function hasCommandSink(): boolean {
  return sink !== null;
}

export function setGameClock(c: GameClock | null): void {
  clock = c ?? { tick: (game) => game.update() };
}

export function tickGame(game: Game): void {
  clock.tick(game);
}

// With no sink installed (local game) the command runs immediately.
export function issue(game: Game, cmd: Command): void {
  if (sink !== null) {
    sink.issue(cmd);
  } else {
    executeCommand(game, localPlayer, cmd);
  }
}

type Handler = (game: Game, player: number, cmd: Command) => void;
const handlers = new Map<string, Handler>();

export function registerCommand(type: string, handler: Handler): void {
  handlers.set(type, handler);
}

// Apply a command issued by `player`. Must depend only on the game state and
// the command, never on local UI state, and must tolerate a command that is
// no longer valid by the time it runs (ignore it).
export function executeCommand(game: Game, player: number, cmd: Command): void {
  const handler = handlers.get(cmd.type);
  if (handler === undefined) {
    throw new Error(`Unknown command type: ${cmd.type}`);
  }
  handler(game, player, cmd);
}
