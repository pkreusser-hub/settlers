// Dev tool: two lockstep sessions in one process, joined by an in-memory
// channel with random latency, driven by irregular timers on a virtual clock.
// Usage: npx esbuild tools/lockstep-test.ts --bundle --platform=node --outfile=node_modules/.cache/lockstep-test.cjs && node node_modules/.cache/lockstep-test.cjs [turns] [seed]

import { BuildingType } from '../src/game/building';
import type { Game } from '../src/game/game';
import { GameInfo } from '../src/game/mission';
import { pathfinderMap } from '../src/game/pathfinder';
import { Random } from '../src/game/random';
import type { Command } from '../src/net/command';
import '../src/net/commands';
import { stateHash } from '../src/net/hash';
import {
  HASH_INTERVAL_TURNS,
  INPUT_DELAY_TURNS,
  TURN_UPDATES,
  UPDATE_MS,
} from '../src/net/protocol';
import type { GameSetup, NetMessage, Transport } from '../src/net/protocol';
import { DISCONNECT_MS, LockstepSession } from '../src/net/session';
import type { SessionStatus, TimerSource } from '../src/net/session';
import { isValidSetup, makeSetup, NetGameInfo } from '../src/net/setup';

const TURNS = Number(process.argv[2] ?? 3000);
const SEED = Number(process.argv[3] ?? 12345);

// The games log every speed change.
const realLog = console.log;
console.log = () => {};
console.info = () => {};
console.debug = () => {};
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
      peer.onMessage?.(JSON.parse(text) as NetMessage);
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

interface Executed {
  turn: number;
  player: number;
  cmd: string;
}

class Side {
  frozenUntil = 0;
  game: Game;
  session: LockstepSession;
  transport: MemoryTransport;
  executed: Executed[] = [];
  checkpoints = new Map<number, number>();
  statuses: Array<{ time: number; status: SessionStatus }> = [];
  issued = 0;

  constructor(
    public name: string,
    public index: number,
    sched: Scheduler,
    setup: GameSetup,
    transport: MemoryTransport,
    rnd: () => number,
    timerMin: number,
    timerMax: number,
  ) {
    const game = new NetGameInfo(setup).instantiate();
    if (game === null) throw new Error('could not build the game');
    this.game = game;
    this.transport = transport;
    transport.side = this;
    this.session = new LockstepSession({
      game,
      localPlayer: index,
      transport,
      timer: new JitterTimer(sched, this, rnd, timerMin, timerMax, 0.01),
      now: () => sched.now,
      onStatus: (status) => this.statuses.push({ time: sched.now, status }),
      onExecute: (turn, player, cmd) => {
        this.executed.push({ turn, player, cmd: JSON.stringify(cmd) });
      },
      onCheckpoint: (turn, hash) => this.checkpoints.set(turn, hash),
    });
  }

  kind(): string {
    return this.session.getStatus().kind;
  }

  sawStatus(kind: string, since: number): boolean {
    return this.statuses.some((s) => s.time >= since && s.status.kind === kind);
  }
}

/* What a player might do now, from the state of the local game. */
function chooseCommand(side: Side, rnd: () => number): Command | null {
  const game = side.game;
  const map = game.getMap();
  const player = game.getPlayer(side.index)!;
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

interface Pair {
  sched: Scheduler;
  a: Side;
  b: Side;
  rnd: () => number;
}

function makePair(seed: number, setup: GameSetup): Pair {
  const rnd = mulberry32(seed);
  const sched = new Scheduler();
  const ta = new MemoryTransport(sched, rnd, 40, 60);
  const tb = new MemoryTransport(sched, rnd, 70, 50);
  ta.peer = tb;
  tb.peer = ta;
  /* Each side gets the setup as it would arrive in a start message. */
  const copy = (): GameSetup => JSON.parse(JSON.stringify(setup)) as GameSetup;
  const a = new Side('host', 0, sched, copy(), ta, rnd, 12, 30);
  const b = new Side('guest', 1, sched, copy(), tb, rnd, 5, 45);

  for (const side of [a, b]) {
    /* The interface's nudge, at its own irregular pace. */
    const ui = (): void => {
      side.session.tick(side.game);
      sched.after(8 + rnd() * 40, side, ui);
    };
    sched.after(rnd() * 20, side, ui);

    /* The player. */
    const act = (): void => {
      const kind = side.kind();
      if (kind === 'running' || kind === 'waiting' || kind === 'local') {
        const cmd = chooseCommand(side, rnd);
        if (cmd !== null) {
          side.session.issue(cmd);
          side.issued++;
        }
      }
      sched.after(100 + rnd() * 900, side, act);
    };
    sched.after(200 + rnd() * 500, side, act);
  }

  return { sched, a, b, rnd };
}

function compareLogs(a: Side, b: Side): void {
  const n = Math.min(a.executed.length, b.executed.length);
  let same = true;
  for (let i = 0; i < n; i++) {
    const x = a.executed[i];
    const y = b.executed[i];
    if (x.turn !== y.turn || x.player !== y.player || x.cmd !== y.cmd) {
      same = false;
      print(`    first difference at #${i}:`, x, y);
      break;
    }
  }
  check(same, `both executed the same commands on the same turns (${n} compared)`);

  let turns = 0;
  let equal = true;
  for (const [turn, hash] of a.checkpoints) {
    const other = b.checkpoints.get(turn);
    if (other === undefined) continue;
    turns++;
    if (other !== hash) {
      equal = false;
      print(`    hash differs at turn ${turn}: ${hash.toString(16)} ${other.toString(16)}`);
    }
  }
  check(equal && turns > 0, `state hashes identical at all ${turns} common checkpoints`);
}

function main(): void {
  /* The host's choice: itself, the guest, two computer players. */
  const info = new GameInfo(new Random('8667715887436237'));
  info.removeAllPlayers();
  info.addPlayer(12, { red: 0, green: 0, blue: 0 }, 40, 40, 40);
  info.addPlayer(13, { red: 0, green: 0, blue: 0 }, 40, 40, 40);
  info.addPlayer(4, { red: 0, green: 0, blue: 0 }, 30, 30, 30);
  info.addPlayer(7, { red: 0, green: 0, blue: 0 }, 35, 25, 30);
  const setup = makeSetup(info, new Random('3183215728814883'));
  check(isValidSetup(JSON.parse(JSON.stringify(setup)) as GameSetup), 'the setup is valid after JSON');
  const seedRoundTrip = new Random(new Random('4563653871271587').toString()).toString();
  check(seedRoundTrip === '4563653871271587', 'a seed survives its 16 character form');

  print(`setup: map size ${setup.mapSize}, faces ${setup.players.map((p) => p.face).join(' ')}`);
  print(`constants: ${TURN_UPDATES} updates per turn, input delay ${INPUT_DELAY_TURNS} turns, ` +
    `hash every ${HASH_INTERVAL_TURNS} turns`);

  // -------------------------------------------------------------------------
  print(`\n1. ${TURNS} turns with latency, jitter, hiccups and commands (seed ${SEED})`);
  {
    const { sched, a, b } = makePair(SEED, setup);
    check(stateHash(a.game) === stateHash(b.game), 'both games start with the same hash');
    const humans = [0, 1].every((i) => !a.game.getPlayer(i)!.isAi());
    const computers = [2, 3].every((i) => a.game.getPlayer(i)!.isAi());
    check(humans && computers, 'players 0 and 1 are human, 2 and 3 computer players');

    a.session.start();
    b.session.start();
    sched.run(Infinity, () => a.session.getTurn() >= TURNS && b.session.getTurn() >= TURNS);

    const elapsed = sched.now;
    const ideal = elapsed / UPDATE_MS;
    print(`    virtual time ${(elapsed / 1000).toFixed(1)} s; updates host ${a.session.getUpdateCount()}, ` +
      `guest ${b.session.getUpdateCount()}, at 50 Hz it would be ${Math.floor(ideal)}`);
    print(`    commands issued: host ${a.issued}, guest ${b.issued}; executed ${a.executed.length}; ` +
      `messages: host ${a.transport.sent}, guest ${b.transport.sent}`);
    const waits = a.statuses.filter((s) => s.status.kind === 'waiting').length +
      b.statuses.filter((s) => s.status.kind === 'waiting').length;
    print(`    "waiting" shown ${waits} times`);

    check(a.session.getTurn() >= TURNS && b.session.getTurn() >= TURNS, 'both reached the last turn');
    check(a.kind() !== 'desync' && b.kind() !== 'desync', 'no desync reported');
    check(!a.sawStatus('disconnected', 0) && !b.sawStatus('disconnected', 0), 'no disconnect reported');
    check(a.session.getUpdateCount() <= ideal + 1 && b.session.getUpdateCount() <= ideal + 1,
      'neither game ran faster than the clock (timer and interface nudges do not add up)');
    check(a.session.getUpdateCount() >= ideal * 0.7, 'the game kept at least 70% of full speed');
    check(Math.abs(a.session.getTurn() - b.session.getTurn()) <= INPUT_DELAY_TURNS + 1,
      'the sides are within the input delay of each other');
    const bothPlayers = [0, 1].every((p) => a.executed.some((e) => e.player === p));
    check(a.executed.length > 50 && bothPlayers, 'commands of both players were executed');
    const castles = [0, 1].every((i) => a.game.getPlayer(i)!.hasCastle() && b.game.getPlayer(i)!.hasCastle());
    check(castles, 'both humans have a castle in both games');
    let delayOk = true;
    for (const e of a.executed) if (e.turn < INPUT_DELAY_TURNS) delayOk = false;
    check(delayOk, 'no command ran before the input delay');
    compareLogs(a, b);

    // -----------------------------------------------------------------------
    print('\n2. the guest freezes for 3 seconds');
    {
      const t0 = sched.now;
      b.frozenUntil = t0 + 3000;
      sched.run(t0 + 2900);
      const stalledAt = a.session.getTurn();
      check(a.kind() === 'waiting', `the host shows "waiting" (status ${a.kind()})`);
      check(stalledAt - b.session.getTurn() <= INPUT_DELAY_TURNS,
        `the host stopped within the input delay (host turn ${stalledAt}, guest turn ${b.session.getTurn()})`);
      sched.run(t0 + 2990);
      check(a.session.getTurn() === stalledAt, 'the host does not advance while it waits');
      sched.run(t0 + 6000);
      check(a.kind() === 'running' && b.kind() === 'running', 'both run again after the freeze');
      check(a.session.getTurn() > stalledAt + 20, `the host advanced again (turn ${a.session.getTurn()})`);
      check(Math.abs(a.session.getTurn() - b.session.getTurn()) <= INPUT_DELAY_TURNS + 1, 'the guest caught up');
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
      check(b.session.getTurn() > turn + 20, 'the game went on');
    }

    sched.run(sched.now + 20000);
    check(a.kind() === 'running' && b.kind() === 'running', 'still running 20 seconds later');
    compareLogs(a, b);

    // -----------------------------------------------------------------------
    print('\n4. the guest closes the channel; the host plays on alone');
    {
      b.session.stop();
      sched.run(sched.now + 1000);
      const s = a.session.getStatus();
      check(s.kind === 'disconnected' && s.reason === 'closed', `the host reports the disconnect (status ${s.kind})`);
      const turn = a.session.getTurn();
      sched.run(sched.now + 2000);
      check(a.session.getTurn() - turn <= INPUT_DELAY_TURNS, 'the host is stopped until the player decides');
      a.session.continueLocal();
      const executed = a.executed.length;
      const t0 = sched.now;
      const turn2 = a.session.getTurn();
      sched.run(t0 + 20000);
      const made = a.session.getTurn() - turn2;
      check(a.kind() === 'local', 'the host is in local mode');
      check(made >= 180 && made <= 201, `the host advanced at full speed alone (${made} turns in 20 s)`);
      check(a.executed.length > executed, 'the host\'s own commands still run');
      a.session.stop();
    }
  }

  // -------------------------------------------------------------------------
  print('\n5. desync detection: the guest\'s game gets another random seed');
  {
    const { sched, a, b } = makePair(SEED + 1, setup);
    b.game.setRandom(new Random('1111111111111112'));
    a.session.start();
    b.session.start();
    sched.run(60000);
    const sa = a.session.getStatus();
    const sb = b.session.getStatus();
    check(sa.kind === 'desync' && sb.kind === 'desync', `both report the desync (${sa.kind}, ${sb.kind})`);
    if (sa.kind === 'desync' && sb.kind === 'desync') {
      check(sa.turn === sb.turn && sa.local === sb.remote && sa.remote === sb.local,
        `both name turn ${sa.turn} and the same two hashes`);
    }
    const turn = a.session.getTurn();
    sched.run(70000);
    check(a.session.getTurn() === turn, 'the game is stopped');
  }

  // -------------------------------------------------------------------------
  print('\n6. desync detection in a running game: the guest\'s game gets another random seed after 42 s');
  {
    const { sched, a, b } = makePair(SEED + 3, setup);
    a.session.start();
    b.session.start();
    sched.run(42000);
    check(a.kind() === 'running' && b.kind() === 'running', 'running before the change');
    const tampered = b.session.getTurn();
    /* The random state is part of the hash and does not heal (a changed
       serf counter can be overwritten before the next checkpoint). */
    b.game.setRandom(new Random('1111111111111112'));
    sched.run(42000 + (HASH_INTERVAL_TURNS + 20) * TURN_UPDATES * UPDATE_MS * 2);
    const sa = a.session.getStatus();
    const sb = b.session.getStatus();
    check(sa.kind === 'desync' && sb.kind === 'desync', `both report the desync (${sa.kind}, ${sb.kind})`);
    if (sa.kind === 'desync') {
      check(sa.turn > tampered && sa.turn <= tampered + HASH_INTERVAL_TURNS && sa.turn % HASH_INTERVAL_TURNS === 0,
        `at the first checkpoint after the change (changed in turn ${tampered}, reported turn ${sa.turn})`);
    }
  }

  // -------------------------------------------------------------------------
  print('\n7. a second seed, short, without computer players');
  {
    const info2 = new GameInfo(new Random('2831713285431227'));
    info2.removeAllPlayers();
    info2.addPlayer(12, { red: 0, green: 0, blue: 0 }, 40, 40, 40);
    info2.addPlayer(1, { red: 0, green: 0, blue: 0 }, 40, 20, 40);
    const setup2 = makeSetup(info2, new Random());
    const { sched, a, b } = makePair(SEED + 2, setup2);
    check(!a.game.getPlayer(1)!.isAi(), 'player 1 is human whatever face the screen had');
    a.session.start();
    b.session.start();
    sched.run(Infinity, () => a.session.getTurn() >= 600 && b.session.getTurn() >= 600);
    check(a.kind() === 'running' && b.kind() === 'running', 'running without desync');
    compareLogs(a, b);
  }

  print(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
