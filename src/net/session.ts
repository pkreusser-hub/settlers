// Deterministic lockstep between up to four players, in a star.
//
// Every side runs the same simulation. It advances in turns of TURN_UPDATES
// game updates. The host decides what runs in a turn: when it ends turn T it
// seals the commands of turn T + INPUT_DELAY_TURNS (its own commands of turn
// T and what each guest sent until then) and sends that one list to every
// guest. A side begins a turn only once it holds the sealed list of it, and
// runs the commands at the first update of the turn ordered by player
// index, then by issue order. So a guest only ever runs what the host
// sealed, and all sides run the same.
//
// A guest sends an 'input' message at the end of each of its turns, with
// the commands it issued (often none). The message also tells the host how
// far the guest is: the host does not begin a turn while a connected guest
// is more than MAX_LAG_TURNS behind, and a guest that fell behind runs at
// double speed until it is back.
//
// A guest that is silent for DISCONNECT_MS, or whose channel closes, is
// dropped: its kingdom stays in the game and nobody commands it. It can
// come back (HostSession.rejoin): the host writes the game as a save game
// at a turn boundary, and every side including the host builds the game
// again from that text (a loaded game is only sure to run like another
// loaded game), then all go on from that turn.
//
// Chat lines and map marks are relayed by the host as their own messages.
// They never enter the turn lists and never touch the game.
//
// This file has no DOM or PeerJS dependency apart from WorkerTimer, so that
// tools/lockstep-test.ts can run the sessions in node.

import { Game } from '../game/game';
import { GameStore } from '../game/savegame';
import { executeCommand } from './command';
import type { Command, CommandSink, GameClock } from './command';
import { stateHash } from './hash';
import {
  CHAT_MAX_CHARS,
  HASH_INTERVAL_TURNS,
  INPUT_DELAY_TURNS,
  MAX_HUMANS,
  MAX_LAG_TURNS,
  PROTOCOL_VERSION,
  SaveAssembler,
  sendSaveText,
  TURN_UPDATES,
  UPDATE_MS,
} from './protocol';
import type { NetMessage, Transport } from './protocol';

/* Clock tuning. These are local: the sides need not agree on them. */

// Most updates run in one pump; with a 20 ms timer this is 4 times speed.
export const MAX_STEPS_PER_PUMP = 4;
// Most updates the clock may owe after this side was slow (a long frame, a
// frozen tab): up to half a second is caught up, at MAX_STEPS_PER_PUMP per
// timer call. The rest is dropped, the game is simply later.
export const MAX_CREDIT_UPDATES = 25;
// A stall shorter than this is not shown.
export const WAIT_INDICATOR_MS = 500;
// No message at all for this long: the other side is gone. The host drops
// a guest then; a guest reports the silence and waits.
export const DISCONNECT_MS = 8000;
// A pump that comes this long after the last one: this side stood still (a
// frozen tab, a sleeping computer). The silence of the others during it
// does not count, their messages are still waiting to be read.
export const FREEZE_MS = 2000;
// A ping is sent when nothing else was for this long.
export const PING_MS = 1000;
// More commands than this in one turn is not a player.
const MAX_COMMANDS_PER_TURN = 256;
// Commands of a guest waiting for the next turn; more is not a player.
const MAX_QUEUED_COMMANDS = 1024;
// Chat lines and marks a guest may send in CHAT_WINDOW_MS.
const CHAT_WINDOW_MS = 5000;
const CHAT_WINDOW_MESSAGES = 10;
// Hashes the host keeps for the guests to compare with.
const KEPT_HASHES = 64;
// Repairs of a desync within REPAIR_WINDOW_MS before the game stops.
const MAX_REPAIRS = 3;
const REPAIR_WINDOW_MS = 120000;

export type SessionStatus =
  | { kind: 'running' }
  // Stalled. For the host: on these players. For a guest the list is empty
  // (it waits for the host, which may wait for someone else).
  | { kind: 'waiting'; players: number[] }
  // A guest lost the host.
  | { kind: 'disconnected'; reason: 'closed' | 'timeout' | 'protocol' }
  // The game of `player` differs from the host's.
  | { kind: 'desync'; turn: number; player: number; host: number; guest: number }
  // Playing on alone.
  | { kind: 'local' }
  | { kind: 'stopped' };

// Calls back about every UPDATE_MS. The session measures time itself, so
// the source only has to keep calling, also while the page is hidden.
export interface TimerSource {
  start(callback: () => void): void;
  stop(): void;
}

// Browsers throttle requestAnimationFrame and page timers of a hidden tab,
// which would stall the other players. A worker's timer keeps its pace.
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

/* After a game was read from a save game for an online match: the same
   fix-ups on every side. Players 0 to humans - 1 are human whatever the
   file says, and the game is paused or not as the host says (a game comes
   out of the file paused). */
export function prepareLoadedGame(game: Game, humans: number, paused: boolean): void {
  for (let i = 0; i < humans; i++) {
    game.getPlayer(i)?.setHuman();
  }
  if (game.isPaused() !== paused) {
    game.pause();
  }
}

/* Whether the game of a save game has these human players. */
export function hasPlayers(game: Game, humans: number): boolean {
  for (let i = 0; i < humans; i++) {
    const player = game.getPlayer(i);
    if (player === null || !player.isInGame()) return false;
  }
  return true;
}

/* The plain way to build the game of a resync (the lobby has its own, which
   also makes the game the current one). */
export function loadSyncedGame(text: string, humans: number, paused: boolean): Game | null {
  const game = new Game();
  try {
    if (!GameStore.getInstance().read(text, game)) return null;
  } catch (e) {
    console.error('[net] the save game of the resync can not be read', e);
    return null;
  }
  if (!hasPlayers(game, humans)) return null;
  prepareLoadedGame(game, humans, paused);
  return game;
}

export interface RosterChange {
  player: number;
  connected: boolean;
}

export interface SessionOptions {
  game: Game;
  // 0 for the host, 1 to 3 for a guest.
  localPlayer: number;
  // Players 0 to humans - 1 are human.
  humans: number;
  timer?: TimerSource | null;
  now?: () => number;
  onStatus?: (status: SessionStatus) => void;
  // A player left or came back. `connected` is the roster by player.
  onRoster?: (connected: boolean[], changes: RosterChange[]) => void;
  // A chat line or a map mark of another player.
  onChat?: (from: number, text: string) => void;
  onMark?: (from: number, pos: number) => void;
  // The game was built again from a save game (a resync). The session
  // already uses the new game.
  onResync?: (turn: number) => void;
  // Builds the game of a resync; null when the text is no game. Default:
  // loadSyncedGame().
  rebuild?: (text: string, humans: number, paused: boolean) => Game | null;
  // For tests: every command as it is executed, and every hash checkpoint.
  onExecute?: (turn: number, player: number, cmd: Command) => void;
  onCheckpoint?: (turn: number, hash: number) => void;
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function isCommandList(v: unknown): v is Command[] {
  return (
    Array.isArray(v) &&
    v.length <= MAX_COMMANDS_PER_TURN &&
    v.every((c) => typeof c === 'object' && c !== null && typeof (c as Command).type === 'string')
  );
}

function cleanChat(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, CHAT_MAX_CHARS);
  return clean.length > 0 ? clean : null;
}

export abstract class LockstepSession implements CommandSink, GameClock {
  protected game: Game;
  protected localPlayer: number;
  protected humans: number;
  protected timer: TimerSource | null;
  protected now: () => number;
  protected options: SessionOptions;

  protected status: SessionStatus = { kind: 'stopped' };
  protected started = false;
  // True once this side goes on alone.
  protected alone = false;
  // Who is connected, by player. The host always is.
  protected connected: boolean[];

  /* The turn being simulated and the updates of it already made. */
  protected turn = 0;
  protected updateInTurn = 0;

  // The sealed command lists by turn, each by player.
  protected bundles = new Map<number, Command[][]>();
  // Issued locally and not sent or sealed yet.
  protected pending: Command[] = [];

  /* Clock. */
  protected lastPump = 0;
  protected credit = 0;
  protected stalledSince = -1;
  protected pumping = false;

  constructor(options: SessionOptions) {
    if (!isInt(options.humans) || options.humans < 1 || options.humans > MAX_HUMANS) {
      throw new Error(`lockstep: ${String(options.humans)} human players`);
    }
    this.options = options;
    this.game = options.game;
    this.localPlayer = options.localPlayer;
    this.humans = options.humans;
    this.timer = options.timer ?? null;
    this.now = options.now ?? (() => performance.now());
    this.connected = new Array<boolean>(this.humans).fill(true);
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

  getLocalPlayer(): number {
    return this.localPlayer;
  }

  getHumans(): number {
    return this.humans;
  }

  /* Who is connected, by player. */
  getConnected(): boolean[] {
    return this.connected.slice();
  }

  isHost(): boolean {
    return this.localPlayer === 0;
  }

  /* Whether chat lines and marks reach anyone. */
  isOnline(): boolean {
    return this.started && !this.alone && this.status.kind !== 'disconnected';
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const now = this.now();
    this.lastPump = now;
    this.attach(now);
    this.setStatus({ kind: 'running' });
    if (this.timer !== null) {
      this.timer.start(() => this.pump());
    }
  }

  /* End the session for good and close the channels. */
  stop(): void {
    if (this.timer !== null) {
      this.timer.stop();
    }
    if (!this.started) return;
    this.started = false;
    this.detach();
    this.setStatus({ kind: 'stopped' });
  }

  /* Go on alone (the others are gone, or the games went out of sync). The
     other kingdoms stay, nobody commands them. */
  continueLocal(): void {
    if (!this.started || this.alone) return;
    this.alone = true;
    this.detach();
    this.lastPump = this.now();
    this.credit = 0;
    this.stalledSince = -1;
    this.setStatus({ kind: 'local' });
  }

  // CommandSink
  issue(cmd: Command): void {
    if (!this.isSimulating()) return;
    /* The copy that crossed JSON is what the others get; run the same one
       here. */
    this.pending.push(JSON.parse(JSON.stringify(cmd)) as Command);
  }

  /* A chat line to the other players. False when it was not sent. */
  sendChat(text: string): boolean {
    const clean = cleanChat(text);
    if (clean === null || !this.isOnline()) return false;
    this.relay({ t: 'chat', text: clean });
    return true;
  }

  /* "Look here" on the map, to the other players. */
  sendMark(pos: number): boolean {
    if (!isInt(pos) || pos < 0 || !this.isOnline()) return false;
    this.relay({ t: 'mark', pos });
    return true;
  }

  // GameClock. The interface calls this once per event loop update. The
  // clock follows the time, not the number of calls, so this is only a
  // nudge: it can not advance the game twice.
  tick(game: Game): void {
    if (game !== this.game) return;
    this.pump();
  }

  /* Advance the game as far as the time and the sealed turns allow. The
     only place that calls game.update(). */
  pump(): void {
    if (!this.started || this.pumping) return;
    this.pumping = true;
    try {
      this.pumpInner();
    } finally {
      this.pumping = false;
    }
  }

  /* Take the channels: handlers, first messages. */
  protected abstract attach(now: number): void;
  /* Let go of the channels and close them. */
  protected abstract detach(): void;
  /* Pings and silence limits. */
  protected abstract service(now: number): void;
  /* This side stood still for `ms`: do not count it as the others'
     silence. */
  protected abstract forgive(ms: number): void;
  /* Before a turn begins. */
  protected abstract turnBoundary(): void;
  /* Whether the turn may begin; its sealed list is there. */
  protected abstract canBegin(turn: number): boolean;
  /* The players a stall is on. */
  protected abstract waitingFor(): number[];
  /* The turn is over; `cmds` is what was issued locally since the last
     call. */
  protected abstract endTurn(turn: number, cmds: Command[]): void;
  /* This side's hash at the start of a turn. */
  protected abstract reportHash(turn: number, hash: number): void;
  /* Send a chat line or a mark of this player on its way. */
  protected abstract relay(msg: NetMessage): void;
  /* How much faster than the clock the game may run now. */
  protected pace(): number {
    return 1;
  }

  protected isSimulating(): boolean {
    if (!this.started) return false;
    const kind = this.status.kind;
    return kind === 'running' || kind === 'waiting' || kind === 'local';
  }

  protected emptyBundle(): Command[][] {
    const lists: Command[][] = [];
    for (let i = 0; i < this.humans; i++) lists.push([]);
    return lists;
  }

  protected pumpInner(): void {
    const now = this.now();
    const elapsed = Math.max(0, now - this.lastPump);
    this.lastPump = now;

    if (!this.alone) {
      if (elapsed >= FREEZE_MS) this.forgive(elapsed);
      this.service(now);
    }

    if (!this.isSimulating()) return;

    /* The clock follows the time, never faster (a guest that is behind the
       host may run after it): credit is only what has passed. */
    this.credit = Math.min(this.credit + (elapsed / UPDATE_MS) * this.pace(), MAX_CREDIT_UPDATES);

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

    /* Time spent waiting is not made up afterwards: this side was ahead,
       and running after its lead would only stall it again (the game would
       move in bursts). One update stays due, so that it goes on the moment
       the turn arrives. */
    this.credit = Math.min(this.credit, 1);

    if (this.stalledSince < 0) {
      this.stalledSince = now;
    } else if (now - this.stalledSince >= WAIT_INDICATOR_MS &&
               (this.status.kind === 'running' || this.status.kind === 'waiting')) {
      this.setStatus({ kind: 'waiting', players: this.waitingFor() });
    }
  }

  /* One game update. False when the next turn can not begin yet. */
  protected step(): boolean {
    if (this.updateInTurn === 0) {
      if (!this.alone) {
        this.turnBoundary();
      }
      if (!this.beginTurn()) {
        return false;
      }
    }
    if (!this.isSimulating()) {
      /* The hash check at the start of the turn failed. */
      return true;
    }

    this.game.update();
    this.updateInTurn++;

    if (this.updateInTurn === TURN_UPDATES) {
      /* The turn is over: what was issued during it goes out. */
      const cmds = this.pending;
      this.pending = [];
      if (this.alone) {
        const target = this.turn + INPUT_DELAY_TURNS;
        const lists = this.bundles.get(target) ?? this.emptyBundle();
        lists[this.localPlayer].push(...cmds);
        this.bundles.set(target, lists);
      } else {
        this.endTurn(this.turn, cmds);
      }
      this.updateInTurn = 0;
      this.turn++;
    }
    return true;
  }

  protected beginTurn(): boolean {
    const turn = this.turn;
    if (this.alone) {
      if (!this.bundles.has(turn)) this.bundles.set(turn, this.emptyBundle());
    } else if (!this.bundles.has(turn) || !this.canBegin(turn)) {
      return false;
    }
    const lists = this.bundles.get(turn) as Command[][];

    if (turn % HASH_INTERVAL_TURNS === 0) {
      const hash = stateHash(this.game);
      this.options.onCheckpoint?.(turn, hash);
      if (!this.alone) {
        this.reportHash(turn, hash);
        if (!this.isSimulating()) return true;
      }
    }

    this.bundles.delete(turn);

    for (let player = 0; player < lists.length; player++) {
      for (const cmd of lists[player]) {
        this.options.onExecute?.(turn, player, cmd);
        try {
          executeCommand(this.game, player, cmd);
        } catch (e) {
          /* The same command fails the same way on the other sides. */
          console.error(`[net] command failed in turn ${turn}`, cmd, e);
        }
      }
    }
    return true;
  }

  protected setRoster(next: boolean[]): void {
    const changes: RosterChange[] = [];
    for (let i = 0; i < this.humans; i++) {
      const value = next[i] === true;
      if (value !== this.connected[i]) changes.push({ player: i, connected: value });
      this.connected[i] = value;
    }
    if (changes.length > 0) {
      this.options.onRoster?.(this.connected.slice(), changes);
    }
  }

  protected sendTo(transport: Transport, msg: NetMessage): void {
    try {
      transport.send(msg);
    } catch (e) {
      console.error('[net] send failed', e);
    }
  }

  protected setStatus(status: SessionStatus): void {
    const previous = this.status;
    this.status = status;
    if (JSON.stringify(previous) === JSON.stringify(status)) return;
    this.options.onStatus?.(status);
  }
}

// ---------------------------------------------------------------------------
// Host

// A guest as the host is given it.
export interface GuestSeat {
  // 1 to humans - 1.
  player: number;
  transport: Transport;
  // What the guest sent in its hello; a guest that comes back is known by
  // it.
  token: string;
}

interface Seat {
  player: number;
  token: string;
  transport: Transport | null;
  // In the game: the host waits for it and sends it the turns.
  connected: boolean;
  // Came back and waits for the resync.
  joining: boolean;
  // The start or resync turn the guest has built its game for.
  readyTurn: number;
  // The last turn the guest has finished.
  acked: number;
  // Commands the guest sent, for the next turn that is sealed.
  queue: Command[];
  lastReceived: number;
  lastSent: number;
  chatTimes: number[];
}

export interface HostSessionOptions extends SessionOptions {
  // The guests at the start. A place without a guest (it left before the
  // start) may be missing: it can be taken later with rejoin().
  guests: GuestSeat[];
  // A desync is repaired by a resync (at most MAX_REPAIRS in a while)
  // instead of stopping the game.
  repairDesync?: boolean;
  // A desync was repaired.
  onRepair?: (turn: number, player: number) => void;
}

export class HostSession extends LockstepSession {
  protected hostOptions: HostSessionOptions;
  protected seats: Seat[] = [];
  // The turn of the start or of the last resync.
  protected epoch = 0;
  protected resyncWanted = false;
  protected localHashes = new Map<number, number>();
  protected repairs: number[] = [];

  constructor(options: HostSessionOptions) {
    super({ ...options, localPlayer: 0 });
    this.hostOptions = options;
    for (let player = 1; player < this.humans; player++) {
      const guest = options.guests.find((g) => g.player === player);
      this.seats.push({
        player,
        token: guest !== undefined ? guest.token : '',
        transport: guest !== undefined ? guest.transport : null,
        connected: guest !== undefined,
        joining: false,
        readyTurn: -1,
        acked: -1,
        queue: [],
        lastReceived: 0,
        lastSent: 0,
        chatTimes: [],
      });
      this.connected[player] = guest !== undefined;
    }
  }

  /* A guest opened a channel to the running game: give it the place it had
     (known by the token), or the first place nobody holds. Everyone builds
     the game again at the next turn boundary. The player index, or -1 when
     there is no place. */
  rejoin(transport: Transport, token: string): number {
    if (!this.started || this.alone) return -1;
    const kind = this.status.kind;
    if (kind !== 'running' && kind !== 'waiting' && kind !== 'desync') return -1;

    let seat = token !== '' ? this.seats.find((s) => s.token === token) : undefined;
    if (seat === undefined) {
      seat = this.seats.find((s) => !s.connected && !s.joining);
    }
    if (seat === undefined) return -1;

    /* The same guest again while its old channel still looks alive (a
       reloaded page): the old one goes. */
    this.release(seat);
    seat.connected = false;
    seat.token = token;
    seat.transport = transport;
    seat.joining = true;
    seat.queue = [];
    this.bind(seat, this.now());
    this.resyncWanted = true;
    return seat.player;
  }

  protected attach(now: number): void {
    for (const seat of this.seats) {
      if (seat.transport !== null) this.bind(seat, now);
    }
    /* Nothing can be issued for the first turns: they are empty. */
    for (let t = 0; t < INPUT_DELAY_TURNS; t++) {
      this.seal(t, this.emptyBundle());
    }
  }

  protected detach(): void {
    for (const seat of this.seats) {
      this.release(seat);
      seat.connected = false;
      seat.joining = false;
    }
  }

  protected bind(seat: Seat, now: number): void {
    const transport = seat.transport as Transport;
    seat.lastReceived = now;
    seat.lastSent = now;
    transport.onMessage = (msg) => {
      if (seat.transport === transport) this.handleMessage(seat, msg);
    };
    transport.onClose = () => {
      if (seat.transport === transport) this.drop(seat, 'closed');
    };
  }

  protected release(seat: Seat): void {
    const transport = seat.transport;
    if (transport === null) return;
    seat.transport = null;
    transport.onMessage = null;
    transport.onClose = null;
    transport.close();
  }

  /* The guest is gone: its kingdom stays, the others go on. */
  protected drop(seat: Seat, why: string): void {
    if (seat.transport === null) return;
    console.warn(`[net] player ${seat.player + 1} dropped (${why})`);
    this.release(seat);
    seat.joining = false;
    if (!seat.connected) return;
    seat.connected = false;
    this.broadcastRoster();
    /* The game may have waited for this guest. */
    if (this.stalledSince >= 0) this.pump();
  }

  protected roster(): boolean[] {
    const roster = [true];
    for (const seat of this.seats) roster[seat.player] = seat.connected;
    return roster;
  }

  protected broadcastRoster(): void {
    const connected = this.roster();
    this.broadcast({ t: 'roster', connected });
    this.setRoster(connected);
  }

  protected send(seat: Seat, msg: NetMessage): void {
    if (seat.transport === null) return;
    seat.lastSent = this.now();
    this.sendTo(seat.transport, msg);
  }

  protected broadcast(msg: NetMessage, except: Seat | null = null): void {
    for (const seat of this.seats) {
      if (seat.connected && seat !== except) this.send(seat, msg);
    }
  }

  protected seal(turn: number, lists: Command[][]): void {
    this.bundles.set(turn, lists);
    this.broadcast({ t: 'turn', turn, cmds: lists });
  }

  protected service(now: number): void {
    for (const seat of this.seats) {
      if (seat.transport === null) continue;
      if (now - seat.lastReceived >= DISCONNECT_MS) {
        this.drop(seat, 'silent');
      } else if (now - seat.lastSent >= PING_MS) {
        this.send(seat, { t: 'ping' });
      }
    }
    /* A stopped game takes no step, so the boundary never comes: the game
       as it is now is the start of the next turn. */
    if (this.resyncWanted && this.status.kind === 'desync') {
      if (this.updateInTurn > 0) {
        /* The turn ends early; its commands are sealed as always. */
        const cmds = this.pending;
        this.pending = [];
        this.endTurn(this.turn, cmds);
        this.updateInTurn = 0;
        this.turn++;
      }
      this.resync();
    }
  }

  protected forgive(ms: number): void {
    for (const seat of this.seats) seat.lastReceived += ms;
  }

  protected turnBoundary(): void {
    if (this.resyncWanted) this.resync();
  }

  protected laggards(turn: number): number[] {
    const players: number[] = [];
    for (const seat of this.seats) {
      if (!seat.connected) continue;
      if (seat.readyTurn !== this.epoch || seat.acked < turn - 1 - MAX_LAG_TURNS) {
        players.push(seat.player);
      }
    }
    return players;
  }

  protected canBegin(turn: number): boolean {
    return this.laggards(turn).length === 0;
  }

  protected waitingFor(): number[] {
    return this.laggards(this.turn);
  }

  protected endTurn(turn: number, cmds: Command[]): void {
    const lists = this.emptyBundle();
    lists[0] = cmds;
    for (const seat of this.seats) {
      /* Also of a guest that has just left: it sent them. */
      lists[seat.player] = seat.queue.splice(0, MAX_COMMANDS_PER_TURN);
    }
    this.seal(turn + INPUT_DELAY_TURNS, lists);
  }

  protected reportHash(turn: number, hash: number): void {
    this.localHashes.set(turn, hash);
    if (this.localHashes.size > KEPT_HASHES) {
      const oldest = this.localHashes.keys().next().value as number;
      this.localHashes.delete(oldest);
    }
  }

  protected relay(msg: NetMessage): void {
    if (msg.t === 'chat') this.broadcast({ t: 'chat', from: 0, text: msg.text });
    if (msg.t === 'mark') this.broadcast({ t: 'mark', from: 0, pos: msg.pos });
  }

  protected chatAllowed(seat: Seat, now: number): boolean {
    seat.chatTimes = seat.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
    if (seat.chatTimes.length >= CHAT_WINDOW_MESSAGES) return false;
    seat.chatTimes.push(now);
    return true;
  }

  protected handleMessage(seat: Seat, msg: NetMessage): void {
    if (!this.started || this.alone) return;
    if (typeof msg !== 'object' || msg === null) return;
    const now = this.now();
    seat.lastReceived = now;
    /* A guest that waits for the resync has nothing to say yet. */
    if (!seat.connected) return;

    switch (msg.t) {
      case 'ready': {
        if (!isInt(msg.turn)) return;
        seat.readyTurn = msg.turn;
        if (this.stalledSince >= 0) this.pump();
        break;
      }
      case 'input': {
        if (!isInt(msg.turn) || msg.turn < 0 || !isCommandList(msg.cmds) ||
            seat.queue.length + msg.cmds.length > MAX_QUEUED_COMMANDS) {
          console.error('[net] bad input message', msg);
          this.drop(seat, 'protocol');
          return;
        }
        /* A message from before a resync may name an older turn. */
        if (msg.turn > seat.acked) seat.acked = msg.turn;
        seat.queue.push(...msg.cmds);
        /* Do not wait for the timer when this was what the clock stalled
           on. */
        if (this.stalledSince >= 0) this.pump();
        break;
      }
      case 'hash': {
        if (!isInt(msg.turn) || typeof msg.hash !== 'number') return;
        /* Of a game from before the last resync: that game is gone. */
        if (msg.e !== this.epoch) return;
        const local = this.localHashes.get(msg.turn);
        if (local === undefined || local === msg.hash) return;
        this.desync(msg.turn, seat.player, local, msg.hash);
        break;
      }
      case 'chat': {
        const text = cleanChat(msg.text);
        if (text === null || !this.chatAllowed(seat, now)) return;
        this.broadcast({ t: 'chat', from: seat.player, text }, seat);
        this.options.onChat?.(seat.player, text);
        break;
      }
      case 'mark': {
        if (!isInt(msg.pos) || msg.pos < 0 || !this.chatAllowed(seat, now)) return;
        this.broadcast({ t: 'mark', from: seat.player, pos: msg.pos }, seat);
        this.options.onMark?.(seat.player, msg.pos);
        break;
      }
      default:
        break;
    }
  }

  protected desync(turn: number, player: number, host: number, guest: number): void {
    console.error(
      `[net] the game of player ${player + 1} is out of sync at turn ${turn}: ` +
        `host hash ${host.toString(16)}, its hash ${guest.toString(16)}`,
    );
    if (this.status.kind === 'desync') return;

    const now = this.now();
    this.repairs = this.repairs.filter((t) => now - t < REPAIR_WINDOW_MS);
    if (this.hostOptions.repairDesync === true && this.repairs.length < MAX_REPAIRS) {
      if (!this.resyncWanted) {
        this.repairs.push(now);
        this.resyncWanted = true;
        this.hostOptions.onRepair?.(turn, player);
      }
      return;
    }

    this.broadcast({ t: 'desync', turn, player, host, guest });
    this.setStatus({ kind: 'desync', turn, player, host, guest });
  }

  /* At the start of this.turn: write the game, build it again here, and
     have every guest (and whoever came back) build it from the same text. */
  protected resync(): void {
    this.resyncWanted = false;
    const turn = this.turn;
    const paused = this.game.isPaused();

    let text: string;
    let game: Game | null;
    try {
      text = GameStore.getInstance().write(this.game);
      game = (this.options.rebuild ?? loadSyncedGame)(text, this.humans, paused);
    } catch (e) {
      console.error('[net] resync failed', e);
      text = '';
      game = null;
    }
    if (game === null) {
      /* The game goes on as it was, without those who wanted in. */
      console.error('[net] the game could not be built again; nobody rejoins');
      for (const seat of this.seats) {
        if (seat.joining) this.drop(seat, 'resync failed');
      }
      return;
    }

    this.game = game;
    this.epoch = turn;
    this.localHashes.clear();

    const now = this.now();
    for (const seat of this.seats) {
      if (seat.joining) {
        seat.joining = false;
        seat.connected = true;
        seat.lastReceived = now;
      }
      seat.readyTurn = -1;
      seat.acked = turn - 1;
    }

    const connected = this.roster();
    const turns = [...this.bundles.keys()].filter((t) => t >= turn).sort((a, b) => a - b);
    for (const seat of this.seats) {
      if (!seat.connected || seat.transport === null) continue;
      sendSaveText(seat.transport, text);
      this.send(seat, {
        t: 'resync', v: PROTOCOL_VERSION, turn, you: seat.player, humans: this.humans, paused, connected,
      });
      /* The turns that were sealed and have not run. */
      for (const t of turns) {
        this.send(seat, { t: 'turn', turn: t, cmds: this.bundles.get(t) as Command[][] });
      }
    }

    this.lastPump = now;
    this.credit = 0;
    this.stalledSince = -1;
    if (this.status.kind === 'desync') {
      this.setStatus({ kind: 'running' });
    }
    this.options.onResync?.(turn);
    this.setRoster(connected);
  }
}

// ---------------------------------------------------------------------------
// Guest

export interface GuestSessionOptions extends SessionOptions {
  // The channel to the host.
  transport: Transport;
  // The turn the game starts at: 0, or the turn of the resync the guest
  // came in with.
  startTurn?: number;
  // The roster, when the guest came in with a resync.
  connected?: boolean[];
}

export class GuestSession extends LockstepSession {
  protected transport: Transport;
  // The turn of the next sealed list expected from the host.
  protected nextBundle: number;
  protected startTurn: number;
  protected save = new SaveAssembler();
  protected lastReceived = 0;
  protected lastSent = 0;

  constructor(options: GuestSessionOptions) {
    super(options);
    if (options.localPlayer < 1 || options.localPlayer >= options.humans) {
      throw new Error(`lockstep: guest as player ${options.localPlayer}`);
    }
    this.transport = options.transport;
    this.startTurn = options.startTurn ?? 0;
    this.turn = this.startTurn;
    this.nextBundle = this.startTurn;
    if (options.connected !== undefined) {
      for (let i = 0; i < this.humans; i++) this.connected[i] = options.connected[i] === true;
    }
  }

  protected attach(now: number): void {
    this.lastReceived = now;
    this.lastSent = now;
    this.transport.onMessage = (msg) => this.handleMessage(msg);
    this.transport.onClose = () => this.handleClose();
    this.send({ t: 'ready', turn: this.startTurn });
  }

  protected detach(): void {
    this.transport.onMessage = null;
    this.transport.onClose = null;
    this.transport.close();
  }

  protected send(msg: NetMessage): void {
    this.lastSent = this.now();
    this.sendTo(this.transport, msg);
  }

  protected service(now: number): void {
    if (this.status.kind === 'disconnected' && this.status.reason !== 'timeout') return;
    if (now - this.lastSent >= PING_MS) {
      this.send({ t: 'ping' });
    }
    if (this.isSimulating() && now - this.lastReceived >= DISCONNECT_MS) {
      this.setStatus({ kind: 'disconnected', reason: 'timeout' });
    }
  }

  protected forgive(ms: number): void {
    this.lastReceived += ms;
  }

  protected turnBoundary(): void {}

  protected canBegin(_turn: number): boolean {
    return true;
  }

  protected waitingFor(): number[] {
    return [];
  }

  /* Behind the host: more sealed turns wait than the input delay gives. */
  protected override pace(): number {
    return !this.alone && this.nextBundle - this.turn > INPUT_DELAY_TURNS + 1 ? 2 : 1;
  }

  protected endTurn(turn: number, cmds: Command[]): void {
    this.send({ t: 'input', turn, cmds });
  }

  protected reportHash(turn: number, hash: number): void {
    this.send({ t: 'hash', turn, hash, e: this.startTurn });
  }

  protected relay(msg: NetMessage): void {
    this.send(msg);
  }

  protected fail(what: string, msg: NetMessage): void {
    console.error(`[net] ${what}`, msg);
    this.setStatus({ kind: 'disconnected', reason: 'protocol' });
  }

  protected isPlayer(v: unknown): v is number {
    return isInt(v) && v >= 0 && v < this.humans;
  }

  protected handleMessage(msg: NetMessage): void {
    if (!this.started || this.alone) return;
    if (typeof msg !== 'object' || msg === null) return;
    this.lastReceived = this.now();

    if (this.status.kind === 'disconnected') {
      if (this.status.reason !== 'timeout') return;
      /* The host is back. */
      this.lastPump = this.lastReceived;
      this.stalledSince = -1;
      this.setStatus({ kind: 'running' });
    }

    switch (msg.t) {
      case 'turn': {
        if (
          msg.turn !== this.nextBundle ||
          !Array.isArray(msg.cmds) ||
          msg.cmds.length !== this.humans ||
          !msg.cmds.every(isCommandList)
        ) {
          this.fail(`bad turn message, expected turn ${this.nextBundle}`, msg);
          return;
        }
        this.bundles.set(msg.turn, msg.cmds);
        this.nextBundle++;
        /* Do not wait for the timer when this was what the clock stalled
           on. */
        if (this.stalledSince >= 0) this.pump();
        break;
      }
      case 'save': {
        if (!this.save.add(msg)) this.fail('bad save game part', msg);
        break;
      }
      case 'resync': {
        this.resync(msg);
        break;
      }
      case 'roster': {
        if (!Array.isArray(msg.connected)) return;
        this.setRoster(msg.connected);
        break;
      }
      case 'desync': {
        if (!isInt(msg.turn) || !this.isPlayer(msg.player)) return;
        console.error(
          `[net] the game of player ${msg.player + 1} is out of sync at turn ${msg.turn}: ` +
            `host hash ${Number(msg.host).toString(16)}, its hash ${Number(msg.guest).toString(16)}`,
        );
        this.setStatus({
          kind: 'desync', turn: msg.turn, player: msg.player, host: Number(msg.host), guest: Number(msg.guest),
        });
        break;
      }
      case 'chat': {
        const text = cleanChat(msg.text);
        if (text === null || !this.isPlayer(msg.from) || msg.from === this.localPlayer) return;
        this.options.onChat?.(msg.from, text);
        break;
      }
      case 'mark': {
        if (!isInt(msg.pos) || msg.pos < 0) return;
        if (!this.isPlayer(msg.from) || msg.from === this.localPlayer) return;
        this.options.onMark?.(msg.from, msg.pos);
        break;
      }
      default:
        break;
    }
  }

  /* The host's game as a save game has arrived: build it and go on from
     its turn. */
  protected resync(msg: Extract<NetMessage, { t: 'resync' }>): void {
    const text = this.save.take();
    if (msg.v !== PROTOCOL_VERSION || !isInt(msg.turn) || msg.turn < 0 ||
        msg.you !== this.localPlayer || msg.humans !== this.humans ||
        !Array.isArray(msg.connected)) {
      this.fail('bad resync message', msg);
      return;
    }

    let game: Game | null;
    try {
      game = (this.options.rebuild ?? loadSyncedGame)(text, this.humans, msg.paused === true);
    } catch (e) {
      console.error('[net] resync failed', e);
      game = null;
    }
    if (game === null) {
      this.fail('the game of the resync could not be built', { t: 'resync' } as NetMessage);
      return;
    }

    this.game = game;
    this.turn = msg.turn;
    this.updateInTurn = 0;
    this.startTurn = msg.turn;
    /* The sealed turns from here on follow. What was issued here and not
       sent yet stays. */
    this.bundles.clear();
    this.nextBundle = msg.turn;
    this.lastPump = this.now();
    this.credit = 0;
    this.stalledSince = -1;

    this.send({ t: 'ready', turn: msg.turn });
    if (this.status.kind !== 'running') {
      this.setStatus({ kind: 'running' });
    }
    this.options.onResync?.(msg.turn);
    this.setRoster(msg.connected);
  }

  protected handleClose(): void {
    if (!this.started || this.alone) return;
    if (this.status.kind === 'desync') return;
    this.setStatus({ kind: 'disconnected', reason: 'closed' });
  }
}
