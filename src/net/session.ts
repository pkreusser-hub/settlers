// Deterministic lockstep between two players.
//
// Both sides run the same simulation. It advances in turns of TURN_UPDATES
// game updates. A command issued locally during turn T is sent tagged for
// turn T + INPUT_DELAY_TURNS and both sides run it at the first update of
// that turn, ordered by player index, then by issue order. A side begins
// turn T only once it holds both players' command lists for T (a list is
// sent for every turn, also when it is empty); until then its clock stalls.
//
// This file has no DOM or PeerJS dependency apart from WorkerTimer, so that
// tools/lockstep-test.ts can run two sessions in node.

import type { Game } from '../game/game';
import { executeCommand } from './command';
import type { Command, CommandSink, GameClock } from './command';
import { stateHash } from './hash';
import {
  HASH_INTERVAL_TURNS,
  INPUT_DELAY_TURNS,
  TURN_UPDATES,
  UPDATE_MS,
} from './protocol';
import type { NetMessage, Transport } from './protocol';

/* Clock tuning. These are local: the two sides need not agree on them. */

// Most updates run in one pump; with a 20 ms timer this is 4 times speed.
export const MAX_STEPS_PER_PUMP = 4;
// Most updates the clock may owe after this side was slow (a long frame, a
// frozen tab): up to half a second is caught up, at MAX_STEPS_PER_PUMP per
// timer call. The rest is dropped, the game is simply later.
export const MAX_CREDIT_UPDATES = 25;
// A stall shorter than this is not shown.
export const WAIT_INDICATOR_MS = 500;
// No message at all for this long: the other player is gone.
export const DISCONNECT_MS = 8000;
// A ping is sent when nothing else was for this long.
export const PING_MS = 1000;
// More commands than this in one turn is not a player.
const MAX_COMMANDS_PER_TURN = 256;

export type SessionStatus =
  | { kind: 'running' }
  // Stalled on the other player's commands.
  | { kind: 'waiting' }
  | { kind: 'disconnected'; reason: 'closed' | 'timeout' | 'protocol' }
  | { kind: 'desync'; turn: number; local: number; remote: number }
  // Playing on alone after the other player left.
  | { kind: 'local' }
  | { kind: 'stopped' };

// Calls back about every UPDATE_MS. The session measures time itself, so
// the source only has to keep calling, also while the page is hidden.
export interface TimerSource {
  start(callback: () => void): void;
  stop(): void;
}

// Browsers throttle requestAnimationFrame and page timers of a hidden tab,
// which would stall the other player. A worker's timer keeps its pace.
export class WorkerTimer implements TimerSource {
  protected worker: Worker | null = null;
  protected interval: ReturnType<typeof setInterval> | null = null;
  protected url: string | null = null;

  start(callback: () => void): void {
    this.stop();
    try {
      const source = `setInterval(function () { postMessage(0); }, ${UPDATE_MS});`;
      this.url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      this.worker = new Worker(this.url);
      this.worker.onmessage = () => callback();
    } catch (e) {
      console.warn('[net] no worker timer, the game stalls while the tab is hidden', e);
      this.worker = null;
      this.interval = setInterval(callback, UPDATE_MS);
    }
  }

  stop(): void {
    if (this.worker !== null) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.url !== null) {
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}

export interface SessionOptions {
  game: Game;
  // 0 for the host, 1 for the guest.
  localPlayer: number;
  transport: Transport;
  timer?: TimerSource | null;
  now?: () => number;
  onStatus?: (status: SessionStatus) => void;
  // For tests: every command as it is executed, and every hash checkpoint.
  onExecute?: (turn: number, player: number, cmd: Command) => void;
  onCheckpoint?: (turn: number, hash: number) => void;
}

export class LockstepSession implements CommandSink, GameClock {
  protected game: Game;
  protected localPlayer: number;
  protected remotePlayer: number;
  protected transport: Transport;
  protected timer: TimerSource | null;
  protected now: () => number;
  protected options: SessionOptions;

  protected status: SessionStatus = { kind: 'stopped' };
  protected started = false;
  // False once the remaining player goes on alone.
  protected remoteRequired = true;

  /* The turn being simulated and the updates of it already made. */
  protected turn = 0;
  protected updateInTurn = 0;

  /* Command lists by turn and player. */
  protected lists: [Map<number, Command[]>, Map<number, Command[]>] = [new Map(), new Map()];
  // Issued locally since the current turn began.
  protected pending: Command[] = [];
  // The turn of the next list expected from the other side.
  protected nextRemoteTurn = INPUT_DELAY_TURNS;

  /* Hashes by turn, kept until both are known. */
  protected localHashes = new Map<number, number>();
  protected remoteHashes = new Map<number, number>();

  /* Clock. */
  protected lastPump = 0;
  protected credit = 0;
  protected stalledSince = -1;
  protected lastReceived = 0;
  protected lastSent = 0;
  protected pumping = false;

  constructor(options: SessionOptions) {
    this.options = options;
    this.game = options.game;
    this.localPlayer = options.localPlayer;
    this.remotePlayer = 1 - options.localPlayer;
    this.transport = options.transport;
    this.timer = options.timer ?? null;
    this.now = options.now ?? (() => performance.now());

    /* Nothing can be issued for the first turns: they are empty. */
    for (let t = 0; t < INPUT_DELAY_TURNS; t++) {
      this.lists[0].set(t, []);
      this.lists[1].set(t, []);
    }
  }

  getTurn(): number {
    return this.turn;
  }

  getUpdateCount(): number {
    return this.turn * TURN_UPDATES + this.updateInTurn;
  }

  getStatus(): SessionStatus {
    return this.status;
  }

  getGame(): Game {
    return this.game;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const now = this.now();
    this.lastPump = now;
    this.lastReceived = now;
    this.lastSent = now;
    this.transport.onMessage = (msg) => this.handleMessage(msg);
    this.transport.onClose = () => this.handleClose();
    this.setStatus({ kind: 'running' });
    if (this.timer !== null) {
      this.timer.start(() => this.pump());
    }
  }

  /* End the session for good and close the channel. */
  stop(): void {
    if (this.timer !== null) {
      this.timer.stop();
    }
    if (!this.started) return;
    this.started = false;
    this.transport.onMessage = null;
    this.transport.onClose = null;
    this.transport.close();
    this.setStatus({ kind: 'stopped' });
  }

  /* After the other player is gone (or the games went out of sync): go on
     alone. The other player's castle stays, nobody commands it. */
  continueLocal(): void {
    if (!this.started || !this.remoteRequired) return;
    this.remoteRequired = false;
    this.transport.onMessage = null;
    this.transport.onClose = null;
    this.transport.close();
    this.lastPump = this.now();
    this.credit = 0;
    this.stalledSince = -1;
    this.setStatus({ kind: 'local' });
  }

  // CommandSink
  issue(cmd: Command): void {
    if (!this.isSimulating()) return;
    /* The copy that crossed JSON is what the other side gets; run the same
       one here. */
    this.pending.push(JSON.parse(JSON.stringify(cmd)) as Command);
  }

  // GameClock. The interface calls this once per event loop update. The
  // clock follows the time, not the number of calls, so this is only a
  // nudge: it can not advance the game twice.
  tick(game: Game): void {
    if (game !== this.game) return;
    this.pump();
  }

  /* Advance the game as far as the time and the other side's commands
     allow. The only place that calls game.update(). */
  pump(): void {
    if (!this.started || this.pumping) return;
    this.pumping = true;
    try {
      this.pumpInner();
    } finally {
      this.pumping = false;
    }
  }

  protected isSimulating(): boolean {
    if (!this.started) return false;
    const kind = this.status.kind;
    return kind === 'running' || kind === 'waiting' || kind === 'local';
  }

  protected pumpInner(): void {
    const now = this.now();
    const elapsed = Math.max(0, now - this.lastPump);
    this.lastPump = now;

    if (this.remoteRequired) {
      if (now - this.lastSent >= PING_MS) {
        this.send({ t: 'ping' });
      }
      if (this.isSimulating() && now - this.lastReceived >= DISCONNECT_MS) {
        this.setStatus({ kind: 'disconnected', reason: 'timeout' });
      }
    }

    if (!this.isSimulating()) return;

    /* The clock follows the time, never faster: credit is only what has
       passed. */
    this.credit = Math.min(this.credit + elapsed / UPDATE_MS, MAX_CREDIT_UPDATES);

    let steps = 0;
    let stalled = false;
    while (this.credit >= 1 && steps < MAX_STEPS_PER_PUMP) {
      if (!this.step()) {
        stalled = true;
        break;
      }
      if (!this.isSimulating()) return;
      this.credit -= 1;
      steps++;
    }

    if (!stalled) {
      if (steps > 0) {
        this.stalledSince = -1;
        if (this.status.kind === 'waiting') {
          this.setStatus({ kind: 'running' });
        }
      }
      return;
    }

    /* Time spent waiting for the other side is not made up afterwards: this
       side was ahead, and running after its lead would only stall it again
       (the game would move in bursts). One update stays due, so that it
       goes on the moment the commands arrive. */
    this.credit = Math.min(this.credit, 1);

    if (this.stalledSince < 0) {
      this.stalledSince = now;
    } else if (now - this.stalledSince >= WAIT_INDICATOR_MS && this.status.kind === 'running') {
      this.setStatus({ kind: 'waiting' });
    }
  }

  /* One game update. False when the next turn can not begin yet. */
  protected step(): boolean {
    if (this.updateInTurn === 0 && !this.beginTurn()) {
      return false;
    }
    if (!this.isSimulating()) {
      /* The hash check at the start of the turn failed. */
      return true;
    }

    this.game.update();
    this.updateInTurn++;

    if (this.updateInTurn === TURN_UPDATES) {
      /* The turn is over: what was issued during it goes out. */
      const target = this.turn + INPUT_DELAY_TURNS;
      const cmds = this.pending;
      this.pending = [];
      this.lists[this.localPlayer].set(target, cmds);
      if (this.remoteRequired) {
        this.send({ t: 'turn', turn: target, cmds });
      }
      this.updateInTurn = 0;
      this.turn++;
    }
    return true;
  }

  protected beginTurn(): boolean {
    const turn = this.turn;
    const local = this.lists[this.localPlayer].get(turn);
    let remote = this.lists[this.remotePlayer].get(turn);
    if (remote === undefined) {
      if (this.remoteRequired) return false;
      remote = [];
    }
    if (local === undefined) {
      // Can not happen: the list of a turn is stored INPUT_DELAY_TURNS
      // turns before it begins.
      throw new Error(`lockstep: no local commands for turn ${turn}`);
    }

    if (turn % HASH_INTERVAL_TURNS === 0) {
      const hash = stateHash(this.game);
      this.options.onCheckpoint?.(turn, hash);
      if (this.remoteRequired) {
        this.localHashes.set(turn, hash);
        this.send({ t: 'hash', turn, hash });
        this.compareHashes(turn);
        if (!this.isSimulating()) return true;
      }
    }

    this.lists[this.localPlayer].delete(turn);
    this.lists[this.remotePlayer].delete(turn);

    const byPlayer: Command[][] = [];
    byPlayer[this.localPlayer] = local;
    byPlayer[this.remotePlayer] = remote;
    for (let player = 0; player < 2; player++) {
      for (const cmd of byPlayer[player]) {
        this.options.onExecute?.(turn, player, cmd);
        try {
          executeCommand(this.game, player, cmd);
        } catch (e) {
          /* The same command fails the same way on the other side. */
          console.error(`[net] command failed in turn ${turn}`, cmd, e);
        }
      }
    }
    return true;
  }

  protected compareHashes(turn: number): void {
    const local = this.localHashes.get(turn);
    const remote = this.remoteHashes.get(turn);
    if (local === undefined || remote === undefined) return;
    this.localHashes.delete(turn);
    this.remoteHashes.delete(turn);
    if (local === remote) return;

    console.error(
      `[net] games out of sync at turn ${turn}: ` +
        `local hash ${local.toString(16)}, remote hash ${remote.toString(16)}`,
    );
    this.setStatus({ kind: 'desync', turn, local, remote });
  }

  protected send(msg: NetMessage): void {
    this.lastSent = this.now();
    try {
      this.transport.send(msg);
    } catch (e) {
      console.error('[net] send failed', e);
    }
  }

  protected handleMessage(msg: NetMessage): void {
    if (!this.started || !this.remoteRequired) return;
    if (typeof msg !== 'object' || msg === null) return;
    this.lastReceived = this.now();

    if (this.status.kind === 'disconnected' && this.status.reason === 'timeout') {
      /* The other side is back. */
      this.lastPump = this.lastReceived;
      this.stalledSince = -1;
      this.setStatus({ kind: 'running' });
    }

    switch (msg.t) {
      case 'turn': {
        if (
          msg.turn !== this.nextRemoteTurn ||
          !Array.isArray(msg.cmds) ||
          msg.cmds.length > MAX_COMMANDS_PER_TURN ||
          !msg.cmds.every((c) => typeof c === 'object' && c !== null && typeof c.type === 'string')
        ) {
          console.error('[net] bad turn message', msg, 'expected turn', this.nextRemoteTurn);
          this.setStatus({ kind: 'disconnected', reason: 'protocol' });
          return;
        }
        this.lists[this.remotePlayer].set(msg.turn, msg.cmds);
        this.nextRemoteTurn++;
        /* Do not wait for the timer when this was what the clock stalled
           on. */
        if (this.stalledSince >= 0) this.pump();
        break;
      }
      case 'hash': {
        if (typeof msg.turn !== 'number' || typeof msg.hash !== 'number') return;
        this.remoteHashes.set(msg.turn, msg.hash);
        this.compareHashes(msg.turn);
        break;
      }
      default:
        break;
    }
  }

  protected handleClose(): void {
    if (!this.started || !this.remoteRequired) return;
    if (this.status.kind === 'desync') return;
    this.setStatus({ kind: 'disconnected', reason: 'closed' });
  }

  protected setStatus(status: SessionStatus): void {
    const previous = this.status;
    this.status = status;
    if (previous.kind === status.kind) return;
    this.options.onStatus?.(status);
  }
}
