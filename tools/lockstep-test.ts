// Dev tool: up to four lockstep sessions in one process (a host and its
// guests), joined by in-memory channels with random latency, driven by
// irregular timers on a virtual clock.
// Usage: npx esbuild tools/lockstep-test.ts --bundle --platform=node --outfile=node_modules/.cache/lockstep-test.cjs && node node_modules/.cache/lockstep-test.cjs [turns] [seed]

import { BuildingType } from '../src/game/building';
import { Game } from '../src/game/game';
import { GameInfo } from '../src/game/mission';
import { pathfinderMap } from '../src/game/pathfinder';
import { Random } from '../src/game/random';
import { GameStore } from '../src/game/savegame';
import type { Command } from '../src/net/command';
import '../src/net/commands';
import { stateHash } from '../src/net/hash';
import {
  HASH_INTERVAL_TURNS,
  INPUT_DELAY_TURNS,
  MAX_LAG_TURNS,
  PROTOCOL_VERSION,
  SaveAssembler,
  TURN_UPDATES,
  UPDATE_MS,
} from '../src/net/protocol';
import type { GameSetup, NetMessage, Transport } from '../src/net/protocol';
import {
  DISCONNECT_MS,
  GuestSession,
  hasPlayers,
  HostSession,
  loadSyncedGame,
} from '../src/net/session';
import type { LockstepSession, RosterChange, SessionStatus, TimerSource } from '../src/net/session';
import { isValidSetup, makeSetup, NetGameInfo } from '../src/net/setup';

const TURNS = Number(process.argv[2] ?? 3000);
const SEED = Number(process.argv[3] ?? 12345);

// The games log every speed change, the sessions every dropped player.
const realLog = console.log;
console.log = () => {};
console.info = () => {};
console.debug = () => {};
console.warn = () => {};
const realError = console.error;
let quietErrors = false;
console.error = (...args: unknown[]) => {
  if (!quietErrors) realError(...args);
};
const print = (...args: unknown[]): void => realLog(...args);

let failures = 0;
function check(ok: boolean, what: string): void {
  if (ok) {
    print(`  ok    ${what}`);
  } else {
    failures++;
    print(`  FAIL  ${what}`);
  }
}

/* Seeded random numbers of the test itself (not of the games). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Virtual clock: events in time order, ties in scheduling order. */
interface Ev {
  time: number;
  seq: number;
  side: Side | null;
  fn: () => void;
}

class Scheduler {
  now = 0;
  protected heap: Ev[] = [];
  protected seq = 0;

  at(time: number, side: Side | null, fn: () => void): void {
    this.push({ time: Math.max(time, this.now), seq: this.seq++, side, fn });
  }

  after(delay: number, side: Side | null, fn: () => void): void {
    this.at(this.now + delay, side, fn);
  }

  protected less(a: Ev, b: Ev): boolean {
    return a.time < b.time || (a.time === b.time && a.seq < b.seq);
  }

  protected push(ev: Ev): void {
    const h = this.heap;
    h.push(ev);
    let i = h.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(h[i], h[parent])) break;
      [h[i], h[parent]] = [h[parent], h[i]];
      i = parent;
    }
  }

  protected pop(): Ev | null {
    const h = this.heap;
    if (h.length === 0) return null;
    const top = h[0];
    const last = h.pop() as Ev;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.less(h[l], h[m])) m = l;
        if (r < h.length && this.less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }

  /* Run until the time or until stop() says so. */
  run(until: number, stop: () => boolean = () => false): void {
    for (;;) {
      if (stop()) return;
      const ev = this.pop();
      if (ev === null) return;
      if (ev.time > until) {
        this.push(ev);
        this.now = until;
        return;
      }
      this.now = ev.time;
      const side = ev.side;
      if (side !== null && side.frozenUntil > this.now) {
        /* A frozen page runs nothing: its events wait, in order. */
        this.push({ time: side.frozenUntil, seq: this.seq++, side, fn: ev.fn });
        continue;
      }
      ev.fn();
    }
  }
}

/* Sees every message on its way into a side; deliver() hands it over. */
let probe: ((side: Side | null, msg: NetMessage, deliver: () => void) => void) | null = null;

class MemoryTransport implements Transport {
  onMessage: ((msg: NetMessage) => void) | null = null;
  onClose: (() => void) | null = null;
  peer: MemoryTransport | null = null;
  side: Side | null = null;
  sent = 0;
  protected closed = false;
  protected lastArrival = 0;

  constructor(
    protected sched: Scheduler,
    protected rnd: () => number,
    protected baseLatency: number,
    protected jitter: number,
  ) {}

  send(msg: NetMessage): void {
    if (this.closed) return;
    this.sent++;
    const text = JSON.stringify(msg);
    const peer = this.peer as MemoryTransport;
    let latency = this.baseLatency + this.rnd() * this.jitter;
    if (this.rnd() < 0.01) latency += 150 + this.rnd() * 250; // a spike
    /* Reliable and ordered: a late message holds back the ones after it. */
    const arrival = Math.max(this.sched.now + latency, this.lastArrival);
    this.lastArrival = arrival;
    this.sched.at(arrival, peer.side, () => {
      if (peer.closed) return;
      const copy = JSON.parse(text) as NetMessage;
      if (probe !== null) {
        probe(peer.side, copy, () => peer.onMessage?.(copy));
      } else {
        peer.onMessage?.(copy);
      }
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const peer = this.peer as MemoryTransport;
    this.sched.after(this.baseLatency, peer.side, () => {
      if (peer.closed) return;
      peer.closed = true;
      peer.onClose?.();
    });
  }
}

/* A timer that fires at irregular intervals, with a hiccup now and then. */
class JitterTimer implements TimerSource {
  protected running = false;

  constructor(
    protected sched: Scheduler,
    protected side: Side,
    protected rnd: () => number,
    protected min: number,
    protected max: number,
    protected hiccupChance: number,
  ) {}

  start(callback: () => void): void {
    this.running = true;
    const next = (): void => {
      if (!this.running) return;
      let delay = this.min + this.rnd() * (this.max - this.min);
      if (this.rnd() < this.hiccupChance) delay += 100 + this.rnd() * 300;
      this.sched.after(delay, this.side, () => {
        if (!this.running) return;
        callback();
        next();
      });
    };
    next();
  }

  stop(): void {
    this.running = false;
  }
}

interface Heard {
  time: number;
  from: number;
  what: string;
}

/* One browser: the host or a guest. */
class Side {
  frozenUntil = 0;
  session!: LockstepSession;
  // The channel to the host (a guest), for the message count.
  transport: MemoryTransport | null = null;
  token: string;
  // The commands run at the start of each turn, as text.
  log = new Map<number, string[]>();
  // Turns this side never ran: it was built again at a later turn.
  gaps: Array<[number, number]> = [];
  checkpoints = new Map<number, number>();
  statuses: Array<{ time: number; status: SessionStatus }> = [];
  rosterChanges: Array<{ time: number; change: RosterChange }> = [];
  resyncs: number[] = [];
  heard: Heard[] = [];
  repairs = 0;
  issued = 0;
  acting = true;
  rnd: () => number;

  constructor(public name: string, public index: number, public match: Match) {
    this.token = `token-${index}-${Math.floor(match.rnd() * 1e9)}`;
    this.rnd = match.rnd;
  }

  get game(): Game {
    return this.session.getGame();
  }

  kind(): string {
    return this.session.getStatus().kind;
  }

  sawStatus(kind: string, since: number): boolean {
    return this.statuses.some((s) => s.time >= since && s.status.kind === kind);
  }

  /* The turns below `turn` that this side did not run. */
  protected skipTo(turn: number, before: number): void {
    if (before < turn) this.gaps.push([before, turn]);
    for (const t of [...this.log.keys()]) if (t >= turn) this.log.delete(t);
    for (const t of [...this.checkpoints.keys()]) if (t >= turn) this.checkpoints.delete(t);
  }

  /* The first turn whose commands this side has not run. */
  protected nextUnrun(): number {
    const session = this.session;
    return session.getUpdateCount() % TURN_UPDATES === 0 ? session.getTurn() : session.getTurn() + 1;
  }

  protected common() {
    const sched = this.match.sched;
    let before = 0;
    return {
      localPlayer: this.index,
      humans: this.match.humans,
      now: () => sched.now,
      onStatus: (status: SessionStatus) => this.statuses.push({ time: sched.now, status }),
      onExecute: (turn: number, player: number, cmd: Command) => {
        let list = this.log.get(turn);
        if (list === undefined) this.log.set(turn, list = []);
        list.push(`${player}:${JSON.stringify(cmd)}`);
      },
      onCheckpoint: (turn: number, hash: number) => this.checkpoints.set(turn, hash),
      onRoster: (_connected: boolean[], changes: RosterChange[]) => {
        for (const change of changes) this.rosterChanges.push({ time: sched.now, change });
      },
      onChat: (from: number, text: string) => this.heard.push({ time: sched.now, from, what: `chat ${text}` }),
      onMark: (from: number, pos: number) => this.heard.push({ time: sched.now, from, what: `mark ${pos}` }),
      rebuild: (text: string, humans: number, paused: boolean) => {
        before = this.nextUnrun();
        return loadSyncedGame(text, humans, paused);
      },
      onResync: (turn: number) => {
        this.skipTo(turn, before);
        this.resyncs.push(turn);
      },
    };
  }

  makeHost(game: Game, guests: Array<{ player: number; transport: Transport; token: string }>, repair: boolean): void {
    this.session = new HostSession({
      ...this.common(),
      game,
      guests,
      repairDesync: repair,
      onRepair: () => { this.repairs++; },
      timer: new JitterTimer(this.match.sched, this, this.rnd, 12, 30, 0.01),
    });
  }

  makeGuest(game: Game, transport: MemoryTransport, startTurn = 0, connected?: boolean[]): void {
    this.transport = transport;
    this.session = new GuestSession({
      ...this.common(),
      game,
      transport,
      startTurn,
      connected,
      timer: new JitterTimer(this.match.sched, this, this.rnd, 5, 45, 0.01),
    });
  }

  /* What the lobby of a guest does to come back: open a channel, say who
     this is, take the save game and the resync message, build the game and
     start a session at that turn. The player index the host gave, or -1. */
  rejoin(token = this.token): number {
    const match = this.match;
    const [hostEnd, guestEnd] = match.link(this, 30 + this.index * 15, 50);
    const save = new SaveAssembler();
    const old = this.session;
    guestEnd.onMessage = (msg) => {
      if (msg.t === 'save') {
        save.add(msg);
        return;
      }
      if (msg.t !== 'resync' || msg.v !== PROTOCOL_VERSION) return;
      const game = loadSyncedGame(save.take(), msg.humans, msg.paused);
      if (game === null) throw new Error('rejoin: no game');
      const before = old.getUpdateCount() % TURN_UPDATES === 0 ? old.getTurn() : old.getTurn() + 1;
      old.stop();
      this.index = msg.you;
      this.makeGuest(game, guestEnd, msg.turn, msg.connected);
      this.skipTo(msg.turn, before);
      this.resyncs.push(msg.turn);
      this.session.start();
    };
    return (match.host.session as HostSession).rejoin(hostEnd, token);
  }
}

interface MatchOptions {
  repair?: boolean;
  // Nobody issues commands.
  idle?: boolean;
}

class Match {
  sched = new Scheduler();
  rnd: () => number;
  sides: Side[] = [];
  humans: number;

  constructor(seed: number, setup: GameSetup, options: MatchOptions = {}) {
    this.rnd = mulberry32(seed);
    this.humans = setup.humans;
    /* Each side gets the setup as it would arrive in a start message. */
    const build = (): Game => {
      const game = new NetGameInfo(JSON.parse(JSON.stringify(setup)) as GameSetup).instantiate();
      if (game === null) throw new Error('could not build the game');
      return game;
    };

    const host = new Side('host', 0, this);
    this.sides.push(host);
    const seats: Array<{ player: number; transport: Transport; token: string }> = [];
    for (let i = 1; i < this.humans; i++) {
      const side = new Side(`guest ${i}`, i, this);
      const [hostEnd, guestEnd] = this.link(side, 30 + i * 15, 50);
      seats.push({ player: i, transport: hostEnd, token: side.token });
      side.makeGuest(build(), guestEnd);
      this.sides.push(side);
    }
    host.makeHost(build(), seats, options.repair === true);

    for (const side of this.sides) {
      /* The nudge of the interface, at its own irregular pace. */
      const ui = (): void => {
        side.session.tick(side.game);
        this.sched.after(8 + this.rnd() * 40, side, ui);
      };
      this.sched.after(this.rnd() * 20, side, ui);

      /* The player. */
      const act = (): void => {
        const kind = side.kind();
        if (side.acting && options.idle !== true &&
            (kind === 'running' || kind === 'waiting' || kind === 'local')) {
          const cmd = chooseCommand(side, this.rnd);
          if (cmd !== null) {
            side.session.issue(cmd);
            side.issued++;
          }
        }
        this.sched.after(100 + this.rnd() * 900, side, act);
      };
      this.sched.after(200 + this.rnd() * 500, side, act);
    }
  }

  get host(): Side {
    return this.sides[0];
  }

  /* A channel between the host and a guest: [host end, guest end]. */
  link(guest: Side, base: number, jitter: number): [MemoryTransport, MemoryTransport] {
    const hostEnd = new MemoryTransport(this.sched, this.rnd, base, jitter);
    const guestEnd = new MemoryTransport(this.sched, this.rnd, base + 25, jitter);
    hostEnd.peer = guestEnd;
    guestEnd.peer = hostEnd;
    hostEnd.side = this.sides[0] ?? null;
    guestEnd.side = guest;
    return [hostEnd, guestEnd];
  }

  start(): void {
    for (const side of this.sides) side.session.start();
  }

  /* Until each of the sides has made this many more turns. */
  runTurns(turns: number, sides: Side[] = this.sides): void {
    const target = sides.map((s) => s.session.getTurn() + turns);
    this.sched.run(Infinity, () => sides.every((s, i) => s.session.getTurn() >= target[i]));
  }

  run(ms: number): void {
    this.sched.run(this.sched.now + ms);
  }
}

function inGap(side: Side, turn: number): boolean {
  return side.gaps.some(([from, to]) => turn >= from && turn < to);
}

/* Every side ran the same commands on the same turns as the host, and had
   the same hash at every checkpoint. */
function compare(match: Match, sides: Side[] = match.sides, from = 0): void {
  const host = match.host;
  from = Math.max(0, from);
  for (const side of sides) {
    if (side === host) continue;
    const end = Math.min(host.session.getTurn(), side.session.getTurn());
    let same = true;
    let turns = 0;
    let commands = 0;
    for (let turn = from; turn < end; turn++) {
      if (inGap(side, turn)) continue;
      turns++;
      const x = (host.log.get(turn) ?? []).join('\n');
      const y = (side.log.get(turn) ?? []).join('\n');
      commands += (host.log.get(turn) ?? []).length;
      if (x !== y) {
        same = false;
        print(`    first difference in turn ${turn}:\n      host: ${x}\n      ${side.name}: ${y}`);
        break;
      }
    }
    check(same && turns > 0, `${side.name} ran the same commands as the host (${commands} in ${turns} turns)`);

    let points = 0;
    let equal = true;
    for (const [turn, hash] of host.checkpoints) {
      if (turn < from) continue;
      const other = side.checkpoints.get(turn);
      if (other === undefined) continue;
      points++;
      if (other !== hash) {
        equal = false;
        print(`    hash differs at turn ${turn}: ${hash.toString(16)} ${other.toString(16)}`);
      }
    }
    check(equal && points > 0, `${side.name} had the host's state hash at all ${points} common checkpoints`);
  }
}

/* What a player might do now, from the state of the local game. */
function chooseCommand(side: Side, rnd: () => number): Command | null {
  const game = side.game;
  const map = game.getMap();
  const player = game.getPlayer(side.index)!;
  if (!player.isInGame()) return null;
  const cells = map.getCols() * map.getRows();
  const pick = (n: number): number => Math.floor(rnd() * n);

  if (!player.hasCastle()) {
    for (let i = 0; i < 400; i++) {
      const pos = pick(cells);
      if (game.canBuildCastle(pos, player)) return { type: 'buildCastle', pos };
    }
    return null;
  }

  let castle = -1;
  for (const b of game.getPlayerBuildings(player)) {
    if (b.getType() === BuildingType.TypeCastle) castle = b.getPosition();
  }
  if (castle < 0) return null;

  const r = rnd();
  if (r < 0.03) return { type: 'speedIncrease' };
  if (r < 0.06) return { type: 'speedDecrease' };
  if (r < 0.08) return { type: 'setPaused', paused: rnd() < 0.3 };
  if (r < 0.1) {
    /* Not a valid command for the state, or not at all: ignored alike. */
    return rnd() < 0.5
      ? { type: 'buildCastle', pos: pick(cells) }
      : { type: 'buildBuilding', pos: -5, building: 99 };
  }

  const types = [
    BuildingType.TypeLumberjack, BuildingType.TypeStonecutter, BuildingType.TypeHut,
    BuildingType.TypeForester, BuildingType.TypeFisher, BuildingType.TypeSawmill,
    BuildingType.TypeFarm, BuildingType.TypeTower,
  ];
  if (r < 0.45) {
    const type = types[pick(types.length)];
    for (let i = 0; i < 60; i++) {
      const pos = map.posAddSpirally(castle, pick(295));
      if (game.canBuildBuilding(pos, type, player)) {
        return { type: 'buildBuilding', pos, building: type };
      }
    }
    return null;
  }
  if (r < 0.6) {
    for (let i = 0; i < 60; i++) {
      const pos = map.posAddSpirally(castle, pick(295));
      if (game.canBuildFlag(pos, player)) return { type: 'buildFlag', pos };
    }
    return null;
  }
  if (r < 0.65) {
    for (let i = 0; i < 60; i++) {
      const pos = map.posAddSpirally(castle, 7 + pick(288));
      if (map.hasFlag(pos) && map.getOwner(pos) === side.index) {
        return { type: 'demolishFlag', pos };
      }
    }
    return null;
  }
  /* A road from some own flag to the flag of the castle. */
  const flags: number[] = [];
  for (let i = 0; i < 295; i++) {
    const pos = map.posAddSpirally(castle, i);
    if (map.hasFlag(pos) && map.getOwner(pos) === side.index) flags.push(pos);
  }
  if (flags.length < 2) return null;
  const from = flags[pick(flags.length)];
  const to = flags[pick(flags.length)];
  if (from === to) return null;
  const road = pathfinderMap(map, from, to);
  if (road.getLength() === 0) return null;
  return {
    type: 'buildRoad',
    start: road.getSource(),
    dirs: road.getDirs().map((d) => d as number),
    flag: 0,
  };
}

/* The host's choice: `humans` people, then computer players up to four. */
function makeTestSetup(humans: number, players: number, mapSeed: string, gameSeed: string): GameSetup {
  const info = new GameInfo(new Random(mapSeed));
  info.removeAllPlayers();
  const computers = [4, 7, 2];
  for (let i = 0; i < players; i++) {
    if (i < humans) {
      info.addPlayer(i === 0 ? 12 : 13, { red: 0, green: 0, blue: 0 }, 40, 40, 40);
    } else {
      info.addPlayer(computers[i - 1] ?? 5, { red: 0, green: 0, blue: 0 }, 30, 30, 30);
    }
  }
  return makeSetup(info, new Random(gameSeed), humans);
}

function allRunning(sides: Side[]): boolean {
  return sides.every((s) => s.kind() === 'running');
}

function noneSaw(sides: Side[], kind: string): boolean {
  return sides.every((s) => !s.sawStatus(kind, 0));
}

function speedLine(match: Match): string {
  const ideal = Math.floor(match.sched.now / UPDATE_MS);
  return `virtual time ${(match.sched.now / 1000).toFixed(1)} s; updates ` +
    match.sides.map((s) => `${s.name} ${s.session.getUpdateCount()}`).join(', ') +
    `; at 50 Hz it would be ${ideal}`;
}

function main(): void {
  const setup2 = makeTestSetup(2, 4, '8667715887436237', '3183215728814883');
  const setup3 = makeTestSetup(3, 4, '8667715887436237', '3183215728814883');
  const setup4 = makeTestSetup(4, 4, '8667715887436237', '3183215728814883');
  check(isValidSetup(JSON.parse(JSON.stringify(setup2)) as GameSetup), 'the setup is valid after JSON');
  check(isValidSetup(setup3) && isValidSetup(setup4), 'the setups for three and four people are valid');
  check(!isValidSetup({ ...setup2, humans: 5 }) && !isValidSetup({ ...setup2, humans: 1 }),
    'a setup for one or five people is refused');
  const seedRoundTrip = new Random(new Random('4563653871271587').toString()).toString();
  check(seedRoundTrip === '4563653871271587', 'a seed survives its 16 character form');

  print(`faces: two people ${setup2.players.map((p) => p.face).join(' ')}, ` +
    `three ${setup3.players.map((p) => p.face).join(' ')}, four ${setup4.players.map((p) => p.face).join(' ')}`);
  print(`constants: ${TURN_UPDATES} updates per turn, input delay ${INPUT_DELAY_TURNS} turns, ` +
    `hash every ${HASH_INTERVAL_TURNS} turns, the host waits for a guest more than ${MAX_LAG_TURNS} turns behind`);

  // -------------------------------------------------------------------------
  print(`\n1. two players, ${TURNS} turns with latency, jitter, hiccups and commands (seed ${SEED})`);
  {
    const match = new Match(SEED, setup2);
    const [a, b] = match.sides;
    const sched = match.sched;
    check(stateHash(a.game) === stateHash(b.game), 'both games start with the same hash');
    const humans = [0, 1].every((i) => !a.game.getPlayer(i)!.isAi());
    const computers = [2, 3].every((i) => a.game.getPlayer(i)!.isAi());
    check(humans && computers, 'players 0 and 1 are human, 2 and 3 computer players');

    match.start();
    sched.run(Infinity, () => a.session.getTurn() >= TURNS && b.session.getTurn() >= TURNS);

    const ideal = sched.now / UPDATE_MS;
    print(`    ${speedLine(match)}`);
    print(`    commands issued: host ${a.issued}, guest ${b.issued}; ` +
      `messages from the guest ${b.transport!.sent}`);
    const waits = match.sides.reduce((n, s) => n + s.statuses.filter((x) => x.status.kind === 'waiting').length, 0);
    print(`    "waiting" shown ${waits} times`);

    check(a.kind() !== 'desync' && b.kind() !== 'desync', 'no desync reported');
    check(noneSaw(match.sides, 'disconnected'), 'no disconnect reported');
    check(a.rosterChanges.length === 0 && b.rosterChanges.length === 0, 'nobody was dropped');
    check(match.sides.every((s) => s.session.getUpdateCount() <= ideal + 1),
      'no game ran faster than the clock (timer and interface nudges do not add up)');
    check(a.session.getUpdateCount() >= ideal * 0.9, 'the host kept at least 90% of full speed');
    check(a.session.getTurn() - b.session.getTurn() <= 8 && a.session.getTurn() >= b.session.getTurn(),
      `the guest follows the host closely (host turn ${a.session.getTurn()}, guest turn ${b.session.getTurn()})`);
    const ran = [...a.log.values()].flat();
    check(ran.length > 50 && [0, 1].every((p) => ran.some((e) => e.startsWith(`${p}:`))),
      'commands of both players were executed');
    const castles = [0, 1].every((i) => a.game.getPlayer(i)!.hasCastle() && b.game.getPlayer(i)!.hasCastle());
    check(castles, 'both humans have a castle in both games');
    check([...a.log.keys()].every((turn) => turn >= INPUT_DELAY_TURNS), 'no command ran before the input delay');
    compare(match);

    // -----------------------------------------------------------------------
    print('\n2. the guest freezes for 3 seconds');
    {
      const t0 = sched.now;
      b.frozenUntil = t0 + 3000;
      sched.run(t0 + 2900);
      const stalledAt = a.session.getTurn();
      const s = a.session.getStatus();
      check(s.kind === 'waiting' && s.players.join() === '1', `the host waits for player 2 (status ${s.kind})`);
      check(stalledAt - b.session.getTurn() <= MAX_LAG_TURNS + INPUT_DELAY_TURNS + 6,
        `the host stopped within the lag limit (host turn ${stalledAt}, guest turn ${b.session.getTurn()})`);
      sched.run(t0 + 2990);
      check(a.session.getTurn() === stalledAt, 'the host does not advance while it waits');
      sched.run(t0 + 8000);
      check(a.kind() === 'running' && b.kind() === 'running', 'both run again after the freeze');
      check(a.session.getTurn() > stalledAt + 20, `the host advanced again (turn ${a.session.getTurn()})`);
      check(a.session.getTurn() - b.session.getTurn() <= 5,
        `the guest caught up (host turn ${a.session.getTurn()}, guest turn ${b.session.getTurn()})`);
      check(a.rosterChanges.length === 0, 'the guest was not dropped');
    }

    // -----------------------------------------------------------------------
    print(`\n3. the host freezes for 12 seconds (silence limit ${DISCONNECT_MS / 1000} s)`);
    {
      const t0 = sched.now;
      a.frozenUntil = t0 + 12000;
      sched.run(t0 + 11900);
      const s = b.session.getStatus();
      check(s.kind === 'disconnected' && s.reason === 'timeout', `the guest reports the silence (status ${s.kind})`);
      const turn = b.session.getTurn();
      sched.run(t0 + 16000);
      check(a.kind() === 'running' && b.kind() === 'running', 'both run again when the host is back');
      check(a.rosterChanges.length === 0, 'the host did not drop the guest for its own standstill');
      check(b.session.getTurn() > turn + 20, 'the game went on');
    }

    sched.run(sched.now + 20000);
    check(a.kind() === 'running' && b.kind() === 'running', 'still running 20 seconds later');
    compare(match);

    // -----------------------------------------------------------------------
    print('\n4. the host closes the channel; the guest plays on alone');
    {
      a.session.stop();
      sched.run(sched.now + 1000);
      const s = b.session.getStatus();
      check(s.kind === 'disconnected' && s.reason === 'closed', `the guest reports the loss (status ${s.kind})`);
      const turn = b.session.getTurn();
      sched.run(sched.now + 2000);
      check(b.session.getTurn() - turn <= INPUT_DELAY_TURNS, 'the guest is stopped until the player decides');
      b.session.continueLocal();
      const ranBefore = [...b.log.values()].flat().length;
      const t0 = sched.now;
      const turn2 = b.session.getTurn();
      sched.run(t0 + 20000);
      const made = b.session.getTurn() - turn2;
      check(b.kind() === 'local', 'the guest is in local mode');
      check(made >= 180 && made <= 201, `the guest advanced at full speed alone (${made} turns in 20 s)`);
      check([...b.log.values()].flat().length > ranBefore, 'the commands of the guest still run');
      check(!b.session.sendChat('anyone'), 'a chat line is not sent when alone');
      b.session.stop();
    }
  }

  // -------------------------------------------------------------------------
  for (const [n, setup] of [[3, setup3], [4, setup4]] as Array<[number, GameSetup]>) {
    print(`\n${n + 2}. ${n} players, 1500 turns with latency and jitter`);
    const match = new Match(SEED + 10 + n, setup);
    const host = match.host;
    const people = Array.from({ length: n }, (_, i) => i);
    check(match.sides.every((s) => stateHash(s.game) === stateHash(host.game)), 'all games start with the same hash');
    check(people.every((i) => !host.game.getPlayer(i)!.isAi()), `players 0 to ${n - 1} are human`);
    if (n < 4) check(host.game.getPlayer(3)!.isAi(), 'player 3 is a computer player');
    match.start();
    match.runTurns(1500);
    const ideal = match.sched.now / UPDATE_MS;
    print(`    ${speedLine(match)}`);
    check(allRunning(match.sides) && noneSaw(match.sides, 'desync') && noneSaw(match.sides, 'disconnected'),
      'all running, no desync, no disconnect');
    check(host.session.getUpdateCount() >= ideal * 0.9, 'the host kept at least 90% of full speed');
    check(match.sides.every((s) => host.session.getTurn() - s.session.getTurn() <= 8),
      'every guest follows the host closely');
    const ran = [...host.log.values()].flat();
    check(people.every((p) => ran.some((e) => e.startsWith(`${p}:`))), 'commands of every human were executed');
    check(people.every((i) => match.sides.every((s) => s.game.getPlayer(i)!.hasCastle())),
      'every human has a castle in every game');
    const order = [...host.log.values()].every((list) => {
      const players = list.map((e) => Number(e[0]));
      return players.every((p, i) => i === 0 || players[i - 1] <= p);
    });
    check(order, 'within a turn the commands ran in player order');
    compare(match);

    if (n === 3) {
      for (const side of match.sides) side.session.stop();
      continue;
    }

    // -----------------------------------------------------------------------
    print('\n7. chat lines and map marks (four players)');
    {
      const sched = match.sched;
      const [, g1, g2, g3] = match.sides;
      let probed = 0;
      let changed = 0;
      let inTurns = 0;
      probe = (side, msg, deliver) => {
        if (msg.t === 'turn' && /hello from|flood|braces/.test(JSON.stringify(msg.cmds))) inTurns++;
        if (side === null || (msg.t !== 'chat' && msg.t !== 'mark')) {
          deliver();
          return;
        }
        const before = stateHash(side.game);
        const turn = side.session.getUpdateCount();
        deliver();
        probed++;
        if (stateHash(side.game) !== before || side.session.getUpdateCount() !== turn) changed++;
      };
      const t0 = sched.now;
      for (const side of match.sides) side.heard = [];
      check(g2.session.sendChat('hello from 3'), 'a guest sends a chat line');
      check(host.session.sendChat('hello from 1'), 'the host sends a chat line');
      check(g1.session.sendMark(1234), 'a guest sends a map mark');
      check(host.session.sendMark(77), 'the host sends a map mark');
      check(!g1.session.sendChat('   ') && !g1.session.sendMark(-1), 'an empty line and a bad position are not sent');
      match.run(1500);
      const heard = (s: Side): string => s.heard.map((h) => `${h.from}:${h.what}`).sort().join(' | ');
      check(heard(host) === '1:mark 1234 | 2:chat hello from 3', `the host got the two of the guests (${heard(host)})`);
      check(heard(g1) === '0:chat hello from 1 | 0:mark 77 | 2:chat hello from 3',
        `player 2 got all but its own (${heard(g1)})`);
      check(heard(g2) === '0:chat hello from 1 | 0:mark 77 | 1:mark 1234',
        `player 3 got all but its own (${heard(g2)})`);
      check(heard(g3) === '0:chat hello from 1 | 0:mark 77 | 1:mark 1234 | 2:chat hello from 3',
        `player 4 got all four (${heard(g3)})`);

      /* A flood from one guest: the host passes on only so many. */
      for (const side of match.sides) side.heard = [];
      for (let i = 0; i < 40; i++) g3.session.sendChat(`flood ${i}`);
      match.run(6000);
      check(host.heard.length === 10 && g1.heard.length === 10, `of 40 lines at once the host relays 10 (${g1.heard.length})`);

      /* A long, busy stretch of both while the game runs. */
      let sent = 0;
      const talk = (): void => {
        if (sent >= 300) return;
        const side = match.sides[sent % 4];
        if (sent % 3 === 0) side.session.sendMark(sent * 7);
        else side.session.sendChat(`line ${sent} with "quotes", {braces} and a buildCastle word`);
        sent++;
        sched.after(600 + match.rnd() * 300, null, talk);
      };
      talk();
      match.runTurns(2500);
      probe = null;
      check(sent === 300 && probed >= 900, `${probed} chat and mark messages were delivered while the games ran`);
      check(changed === 0, 'no delivery changed the state hash or advanced the game of its receiver');
      check(inTurns === 0, 'no chat text was in a turn message');
      const commands = [...host.log.values()].flat();
      check(commands.every((e) => !e.includes('"type":"chat"') && !e.includes('"type":"mark"')),
        'no chat or mark ran as a command');
      check(allRunning(match.sides) && noneSaw(match.sides, 'desync'), 'all still running, no desync');
      compare(match, match.sides, Math.floor(t0 / (TURN_UPDATES * UPDATE_MS)) - 50);
    }

    // -----------------------------------------------------------------------
    print('\n8. a guest closes its channel in a four-player game');
    const [, g1, g2, g3] = match.sides;
    const others = [host, g1, g3];
    {
      const sched = match.sched;
      const t0 = sched.now;
      const dropTurn = host.session.getTurn();
      g2.acting = false;
      g2.session.stop();
      match.run(3000);
      const told = others.every((s) =>
        s.rosterChanges.some((r) => r.time >= t0 && r.change.player === 2 && !r.change.connected));
      check(told, 'the host and the other guests learn that player 3 left');
      check(host.session.getConnected().join() === 'true,true,false,true' &&
        g1.session.getConnected().join() === 'true,true,false,true', 'the roster says so');
      const made = host.session.getTurn() - dropTurn;
      check(made >= 25, `the game did not stop (${made} turns in the 3 s after)`);
      match.runTurns(1200, others);
      check(allRunning(others) && others.every((s) => !s.sawStatus('desync', t0)), 'the three go on, no desync');
      const p = host.game.getPlayer(2)!;
      check(p.isInGame() && !p.isAi() && p.hasCastle(), 'the kingdom of player 3 is still in the game, not a computer player');
      const late = [...host.log.entries()].filter(([turn]) => turn > dropTurn + 10).flatMap(([, list]) => list);
      check(late.length > 20 && late.every((e) => !e.startsWith('2:')), 'no command of player 3 runs any more');
      compare(match, others, dropTurn);
    }

    // -----------------------------------------------------------------------
    print('\n9. a guest goes silent without closing (a frozen tab)');
    {
      const sched = match.sched;
      const t0 = sched.now;
      g3.acting = false;
      g3.frozenUntil = 1e15;
      match.run(DISCONNECT_MS - 1000);
      const s = host.session.getStatus();
      check(s.kind === 'waiting' && s.players.join() === '3', `the host waits for player 4 (status ${s.kind})`);
      match.run(3000);
      check(host.rosterChanges.some((r) => r.time >= t0 && r.change.player === 3 && !r.change.connected),
        `after ${DISCONNECT_MS / 1000} s of silence the host drops player 4`);
      const turn = host.session.getTurn();
      match.run(10000);
      check(host.session.getTurn() - turn >= 90 && allRunning([host, g1]), 'the host and player 2 go on at full speed');
      compare(match, [host, g1], Math.floor(t0 / 100));
    }

    // -----------------------------------------------------------------------
    print('\n10. player 3 comes back with its token');
    {
      const sched = match.sched;
      const t0 = sched.now;
      const before = [host, g1].map((s) => s.resyncs.length);
      const index = g2.rejoin();
      check(index === 2, `the host gives it player index ${index} again`);
      match.run(3000);
      g2.acting = true;
      const turn = host.resyncs[host.resyncs.length - 1];
      check(host.resyncs.length === before[0] + 1 && g1.resyncs.length === before[1] + 1 && g2.resyncs.length === 1,
        'the host, the guest that stayed and the one that came back all built the game again');
      check(g1.resyncs[g1.resyncs.length - 1] === turn && g2.resyncs[0] === turn,
        `all three from the state at turn ${turn}`);
      check([host, g1].every((s) =>
        s.rosterChanges.some((r) => r.time >= t0 && r.change.player === 2 && r.change.connected)),
        'the others learn that player 3 is back');
      check(g2.session.getConnected().join() === 'true,true,true,false', 'the one that came back has the roster');
      const three = [host, g1, g2];
      match.runTurns(2000, three);
      check(allRunning(three) && three.every((s) => !s.sawStatus('desync', t0)),
        'all three running 2000 turns later, no desync');
      const ran = [...host.log.entries()].filter(([t]) => t > turn).flatMap(([, list]) => list);
      check([0, 1, 2].every((p) => ran.some((e) => e.startsWith(`${p}:`))),
        'commands of all three run again, also of the one that came back');
      print(`    ${speedLine(match)}`);
      compare(match, three, turn);
    }

    // -----------------------------------------------------------------------
    print('\n11. player 2 reloads its page (a new channel while the old one still looks alive), then a stranger takes the free place');
    {
      const sched = match.sched;
      const t0 = sched.now;
      const three = [host, g1, g2];
      const index = g1.rejoin();
      check(index === 1, `the host gives it player index ${index} again`);
      match.run(3000);
      check(allRunning(three), 'all three running after the resync');
      check(host.session.getConnected()[1] && g1.resyncs.length > 0, 'player 2 is in the roster, on its new channel');

      /* Player 4 was dropped; someone without a known token gets its place. */
      g3.frozenUntil = 0;
      const place = g3.rejoin('a-new-browser');
      check(place === 3, `an unknown token gets the free place, player index ${place}`);
      match.run(3000);
      g3.acting = true;
      const none = (host.session as HostSession).rejoin(match.link(g3, 10, 10)[0], 'another-browser');
      check(none === -1, 'with every place taken the next unknown token is refused');
      match.runTurns(1500);
      check(allRunning(match.sides) && match.sides.every((s) => !s.sawStatus('desync', t0)),
        'all four running 1500 turns later, no desync');
      check(host.session.getConnected().join() === 'true,true,true,true', 'the roster is full again');
      const turn = host.resyncs[host.resyncs.length - 1];
      compare(match, match.sides, turn);
    }
    for (const side of match.sides) side.session.stop();
  }

  // -------------------------------------------------------------------------
  print('\n12. a resync in a paused game, and the save texts of all sides after it');
  {
    const match = new Match(SEED + 30, setup3);
    const [host, g1, g2] = match.sides;
    match.start();
    match.runTurns(400);
    for (const side of match.sides) side.acting = false;
    match.run(1000);
    host.session.issue({ type: 'setPaused', paused: true });
    match.run(2000);
    check(match.sides.every((s) => s.game.isPaused()), 'the game is paused everywhere');
    const index = g2.rejoin();
    match.run(3000);
    check(index === 2 && match.sides.every((s) => s.resyncs.length === 1), 'all three built the game again');
    check(match.sides.every((s) => s.game.isPaused()), 'the game is still paused everywhere');
    const turns = match.sides.map((s) => s.session.getTurn());
    match.run(1000);
    /* A paused game still takes turns. */
    host.session.issue({ type: 'setPaused', paused: false });
    match.run(3000);
    check(match.sides.every((s) => !s.game.isPaused()), 'the game goes on everywhere after the pause ends');
    check(match.sides.every((s, i) => s.session.getTurn() > turns[i]), 'the turns went on');
    match.runTurns(600);
    compare(match, match.sides, host.resyncs[0]);

    /* The same turn on all sides: the host stops, the guests run out of
       sealed turns at the same one. */
    host.frozenUntil = match.sched.now + 3000;
    match.run(2500);
    const at = [g1, g2].map((s) => s.session.getUpdateCount());
    check(at[0] === at[1] && at[0] % TURN_UPDATES === 0, `both guests stand at the same turn (${at.join(', ')} updates)`);
    const texts = [g1, g2].map((s) => GameStore.getInstance().write(s.game));
    check(texts[0] === texts[1], `their save texts are identical (${(texts[0].length / 1024).toFixed(0)} KB)`);
    for (const side of match.sides) side.session.stop();
  }

  // -------------------------------------------------------------------------
  print('\n13. desync detection: the game of player 3 gets another random seed after 42 s');
  {
    const match = new Match(SEED + 3, setup3);
    const [a, b, c] = match.sides;
    const sched = match.sched;
    match.start();
    sched.run(42000);
    check(allRunning(match.sides), 'running before the change');
    const tampered = c.session.getTurn();
    /* The random state is part of the hash and does not heal (a changed
       serf counter can be overwritten before the next checkpoint). */
    c.game.setRandom(new Random('1111111111111112'));
    quietErrors = true;
    sched.run(42000 + (HASH_INTERVAL_TURNS + 20) * TURN_UPDATES * UPDATE_MS * 2);
    quietErrors = false;
    const kinds = match.sides.map((s) => s.kind());
    check(kinds.every((k) => k === 'desync'), `all three report the desync (${kinds.join(', ')})`);
    const sa = a.session.getStatus();
    const sb = b.session.getStatus();
    if (sa.kind === 'desync' && sb.kind === 'desync') {
      check(sa.player === 2 && sb.player === 2 && sa.turn === sb.turn && sa.host === sb.host && sa.guest === sb.guest,
        `they name player 3, turn ${sa.turn} and the same two hashes`);
      check(sa.turn > tampered && sa.turn <= tampered + HASH_INTERVAL_TURNS && sa.turn % HASH_INTERVAL_TURNS === 0,
        `at the first checkpoint after the change (changed in turn ${tampered}, reported turn ${sa.turn})`);
    }
    const turn = a.session.getTurn();
    sched.run(sched.now + 10000);
    check(a.session.getTurn() === turn, 'the game is stopped');

    /* The player whose game differs reloads the page: the resync brings
       all three back. */
    const index = c.rejoin();
    match.run(3000);
    check(index === 2 && allRunning(match.sides), 'when player 3 rejoins, the resync starts all three again');
    const from = a.resyncs[a.resyncs.length - 1];
    match.runTurns(600);
    check(allRunning(match.sides), 'running 600 turns later');
    compare(match, match.sides, from);
    for (const side of match.sides) side.session.stop();
  }

  // -------------------------------------------------------------------------
  print('\n14. desync repair: the same change, with the host set to repair');
  {
    const match = new Match(SEED + 4, setup3, { repair: true });
    const [a, , c] = match.sides;
    match.start();
    match.run(42000);
    c.game.setRandom(new Random('1111111111111112'));
    quietErrors = true;
    match.run((HASH_INTERVAL_TURNS + 20) * TURN_UPDATES * UPDATE_MS * 2);
    quietErrors = false;
    check(a.repairs === 1 && match.sides.every((s) => s.resyncs.length === 1),
      `the host repaired it with one resync (${a.repairs} repairs)`);
    check(allRunning(match.sides) && noneSaw(match.sides, 'desync'), 'nobody was stopped');
    match.runTurns(800);
    check(allRunning(match.sides) && a.repairs === 1, 'running 800 turns later without another repair');
    compare(match, match.sides, a.resyncs[0]);

    /* A game that keeps going wrong is stopped after all. */
    quietErrors = true;
    for (let i = 0; i < 5 && a.kind() !== 'desync'; i++) {
      c.game.setRandom(new Random('1111111111111112'));
      match.run((HASH_INTERVAL_TURNS + 20) * TURN_UPDATES * UPDATE_MS * 2);
    }
    quietErrors = false;
    check(a.kind() === 'desync' && a.repairs >= 3 && a.repairs <= 4,
      `after ${a.repairs} repairs (3 within two minutes) the game stops`);
    for (const side of match.sides) side.session.stop();
  }

  // -------------------------------------------------------------------------
  print('\n15. a save game needs a player in the game for every human');
  {
    const two = new NetGameInfo(makeTestSetup(2, 2, '2831713285431227', '3183215728814883')).instantiate()!;
    for (let i = 0; i < 500; i++) two.update();
    const text = GameStore.getInstance().write(two);
    const loaded = new Game();
    check(GameStore.getInstance().read(text, loaded), 'a game with two players is saved and read');
    check(hasPlayers(loaded, 2) && !hasPlayers(loaded, 3) && !hasPlayers(loaded, 4),
      'it can start with two humans, not with three or four');
    check(loadSyncedGame(text, 3, false) === null, 'building it for three humans fails');
    const game = loadSyncedGame(text, 2, false);
    check(game !== null && !game.isPaused() && !game.getPlayer(1)!.isAi(), 'building it for two gives a running game with two humans');
  }

  // -------------------------------------------------------------------------
  print('\n16. two players without computer players, short');
  {
    const info2 = new GameInfo(new Random('2831713285431227'));
    info2.removeAllPlayers();
    info2.addPlayer(12, { red: 0, green: 0, blue: 0 }, 40, 40, 40);
    info2.addPlayer(1, { red: 0, green: 0, blue: 0 }, 40, 20, 40);
    const match = new Match(SEED + 2, makeSetup(info2, new Random(), 2));
    check(!match.host.game.getPlayer(1)!.isAi(), 'player 1 is human whatever face the screen had');
    match.start();
    match.runTurns(600);
    check(allRunning(match.sides), 'running without desync');
    compare(match);
  }

  print(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
