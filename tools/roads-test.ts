// Dev tool: the rule "extra carriers on busy roads" (EXT, GameRules.busyRoads;
// not part of Freeserf) against headless games.
// Usage: npx esbuild tools/roads-test.ts --bundle --platform=node --outfile=node_modules/.cache/roads-test.cjs --log-level=error && node node_modules/.cache/roads-test.cjs [updates of the long run]
//
// A game of one player: a castle and a chain of flags joined by roads of
// chosen lengths. Stones are put down at the last flag faster than one
// carrier takes them away; they have no building to go to, so the flags
// send them to the castle. Every action of the player is a command. The
// checks:
//  1. with the rule off nothing of it shows: no load, no busy road, no value
//     in the save, the number of carriers the length gives;
//  2. with the rule on a crowded road turns busy and gets one carrier more,
//     never two, and more stones reach the castle than in the same game
//     with the rule off (roads of 2, 3, 4 and 7 steps);
//  3. when the stones stop the road is quiet again and the carriers above
//     its number go home; nobody is lost;
//  4. a road or a flag demolished, and a flag built into a road, while the
//     road has its extra carrier: IntegrityCheck finds nothing and every
//     carrier is on a road that counts him or on his way home;
//  5. a save taken while a road is busy loads to the same text, and two
//     loaded games stay equal;
//  6. four computer players with the rule on: no integrity problem in a
//     long game, and two runs are equal.

import { EXT_BUSY_MAX, EXT_BUSY_ON } from '../src/game/flag';
import type { Flag } from '../src/game/flag';
import { Game } from '../src/game/game';
import { IntegrityCheck } from '../src/game/integrity';
import { GameInfo } from '../src/game/mission';
import { pathfinderMap } from '../src/game/pathfinder';
import { Random } from '../src/game/random';
import { ResourceType } from '../src/game/resource';
import { GameStore } from '../src/game/savegame';
import { SerfState, SerfType } from '../src/game/serf';
import { executeCommand } from '../src/net/command';
import type { Command } from '../src/net/command';
import '../src/net/commands';
import { stateHash } from '../src/net/hash';

const longUpdates = Number(process.argv[2] ?? 40000);

// The game logs speed changes, the integrity check its findings.
const print = console.log.bind(console);
console.log = () => {};
console.info = () => {};
console.debug = () => {};
const warnings: string[] = [];
console.warn = (...args: unknown[]) => { warnings.push(args.join('')); };

let failed = 0;
let checks = 0;
function check(what: string, ok: boolean): void {
  checks++;
  if (!ok) failed++;
  print(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
}

const store = GameStore.getInstance();
const BASE = [1, 2, 3, 4, 6, 8, 11, 15];
const MAP_SEED = '8667715887436237';

function integrity(game: Game): number {
  const before = warnings.length;
  const n = IntegrityCheck.run(game, false);
  if (n === 0) warnings.length = before;
  return n;
}

/* A road of the scene, seen from the flag further from the castle. */
interface Seg { flag: Flag; dir: number; length: number; base: number }

interface Scene {
  game: Game;
  castleFlagPos: number;
  /* The flags of the chain, the castle's first. */
  flagPos: number[];
  segs: Seg[];
  /* The tiles of each road between its flags. */
  inner: number[][];
}

/* The roads of a game of one player agree with the serfs: both ends of a
   road count the same carriers, no more than the rule allows at any time
   (`slack`: carriers a merge of two roads may leave above that for a
   while), and every carrier at work is counted by a road. '' or what is
   wrong. */
function roadProblems(game: Game, slack = 0): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = game as any;
  let counted = 0;
  for (const flag of g.flags as Iterable<Flag>) {
    if (flag.getIndex() === 0) continue;
    for (let d = 0; d < 6; d++) {
      if (!flag.hasPath(d)) {
        if (flag.extLoad[d] !== 0 || flag.extBusy[d]) return `flag ${flag.getIndex()} has a load without a road`;
        continue;
      }
      const other = flag.getOtherEndFlag(d);
      if (other === null) return `flag ${flag.getIndex()} dir ${d} has no other end`;
      const od = flag.getOtherEndDir(d);
      if (other.getOtherEndFlag(od) !== flag) return `flag ${flag.getIndex()} dir ${d}: the other end does not point back`;
      const n = flag.freeTransporterCount(d);
      if (n !== other.freeTransporterCount(od)) return `flag ${flag.getIndex()} dir ${d}: the ends count ${n} and ${other.freeTransporterCount(od)}`;
      const top = Math.min(BASE[flag.lengthCategory(d)] + (game.getRules().busyRoads ? 1 : 0), 15);
      if (n > top + slack) return `flag ${flag.getIndex()} dir ${d}: ${n} carriers, at most ${top + slack}`;
      if (flag.getIndex() < other.getIndex()) counted += n;
    }
  }
  let working = 0;
  for (const serf of g.serfs) {
    if (serf.getIndex() === 0) continue;
    switch (serf.getState()) {
      case SerfState.StateTransporting:
        if (serf.s.transporting.waitCounter !== -1) working++;
        break;
      case SerfState.StateDelivering:
      case SerfState.StateIdleOnPath:
      case SerfState.StateWaitIdleOnPath:
      case SerfState.StateWakeOnPath:
        working++;
        break;
      default:
        break;
    }
  }
  if (working !== counted) return `${working} carriers at work, the roads count ${counted}`;
  return '';
}

function serfCounts(game: Game): { all: number; lost: number; home: number } {
  let all = 0;
  let lost = 0;
  let home = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const serf of (game as any).serfs) {
    if (serf.getIndex() === 0) continue;
    all++;
    const s = serf.getState();
    if (s === SerfState.StateLost || s === SerfState.StateLostSailor || s === SerfState.StateFreeWalking ||
        s === SerfState.StateWakeAtFlag) lost++;
    if (s === SerfState.StateIdleInStock &&
        (serf.getType() === SerfType.TypeTransporter || serf.getType() === SerfType.TypeGeneric)) home++;
  }
  return { all, lost, home };
}

/* The scene: lengths[i] is the length of the road from flag i to flag
   i + 1 of the chain; flag 0 is the castle's. null if the land does not
   take it. */
function makeScene(busyRoads: boolean, lengths: number[]): Scene | null {
  const info = new GameInfo(new Random(MAP_SEED));
  info.removeAllPlayers();
  info.addPlayer(12, { red: 0, green: 0, blue: 0 }, 40, 40, 40);
  info.setDefaultColors();
  info.setRules({ stockPreset: 0, peaceMinutes: 0, busyRoads, trading: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const game = info.instantiate()! as any;
  game.setRandom(new Random('3183215728814883'));
  const map = game.getMap();
  const player = game.getPlayer(0);
  const exec = (cmd: Command): void => executeCommand(game, 0, cmd);
  const size = map.getCols() * map.getRows();

  for (let castlePos = 0; castlePos < size; castlePos++) {
    if (!game.canBuildCastle(castlePos, player)) continue;
    exec({ type: 'buildCastle', pos: castlePos });
    break;
  }
  if (!player.hasCastle()) return null;
  let castleFlagPos = -1;
  for (const flag of game.flags as Iterable<Flag>) {
    if (flag.getIndex() !== 0 && flag.hasBuilding()) castleFlagPos = flag.getPosition();
  }

  const scene: Scene = { game, castleFlagPos, flagPos: [castleFlagPos], segs: [], inner: [] };
  let prev = castleFlagPos;
  for (const length of lengths) {
    let built = false;
    for (let i = 1; i < 295 && !built; i++) {
      const pos = map.posAddSpirally(prev, i);
      if (!game.canBuildFlag(pos, player)) continue;
      const road = pathfinderMap(map, prev, pos);
      const dirs: number[] = road.getDirs().slice();
      if (dirs.length !== length) continue;
      /* Over free land only. */
      const inner: number[] = [];
      let p = prev;
      let free = true;
      for (let k = 0; k < dirs.length - 1; k++) {
        p = map.move(p, dirs[k]);
        inner.push(p);
        if (map.hasFlag(p) || map.paths(p) !== 0) free = false;
      }
      if (!free) continue;
      exec({ type: 'buildFlag', pos });
      if (!map.hasFlag(pos)) continue;
      exec({ type: 'buildRoad', start: prev, dirs, flag: 0 });
      if (map.paths(pos) === 0) {
        exec({ type: 'demolishFlag', pos });
        continue;
      }
      const flag = game.getFlagAtPos(pos) as Flag;
      const prevFlag = game.getFlagAtPos(prev) as Flag;
      let dir = -1;
      for (let d = 0; d < 6; d++) {
        if (flag.hasPath(d) && flag.getOtherEndFlag(d) === prevFlag) dir = d;
      }
      scene.segs.push({ flag, dir, length, base: BASE[flag.lengthCategory(dir)] });
      scene.inner.push(inner);
      scene.flagPos.push(pos);
      prev = pos;
      built = true;
    }
    if (!built) return null;
  }
  return scene;
}

/* Put a stone down at the flag if it has a free place. It has no
   destination: the flag sends it to the castle. */
function feed(game: Game, pos: number): void {
  const flag = game.getFlagAtPos(pos);
  if (flag !== null && flag.hasEmptySlot()) flag.dropResource(ResourceType.TypeStone, 0);
}

const FEED_EVERY = 10;
const stones = (game: Game): number => game.getStockCount(0, ResourceType.TypeStone);

interface RunResult {
  delivered: number;
  busyAt: number;
  extraAt: number[];
  most: number[];
  problems: number;
  roads: string;
}

/* Run the scene for `updates` with stones coming to the last flag. */
function runFed(scene: Scene, updates: number, feeding = true): RunResult {
  const { game } = scene;
  const start = stones(game);
  const result: RunResult = {
    delivered: 0, busyAt: -1, extraAt: scene.segs.map(() => -1),
    most: scene.segs.map(() => 0), problems: 0, roads: '',
  };
  const last = scene.flagPos[scene.flagPos.length - 1];
  for (let i = 1; i <= updates; i++) {
    if (feeding && i % FEED_EVERY === 0) feed(game, last);
    game.update();
    scene.segs.forEach((seg, k) => {
      const n = seg.flag.freeTransporterCount(seg.dir);
      if (n > result.most[k]) result.most[k] = n;
      if (n > seg.base && result.extraAt[k] < 0) result.extraAt[k] = i;
      if (result.busyAt < 0 && seg.flag.extRoadBusy(seg.dir)) result.busyAt = i;
    });
    if (i % 250 === 0) {
      result.problems += integrity(game);
      if (result.roads === '') result.roads = roadProblems(game);
    }
  }
  result.delivered = stones(game) - start;
  return result;
}

function load(text: string): Game {
  const game = new Game();
  if (!store.read(text, game)) throw new Error('load failed');
  /* A loaded game is paused; this resumes it, as GameManager does. */
  game.pause();
  return game;
}

const WARM_UP = 3000;
const WINDOW = 20000;

// ---------------------------------------------------------------------------
print(`busy from a load of ${EXT_BUSY_ON} ticks, the load stops at ${EXT_BUSY_MAX}; ` +
      `a stone every ${FEED_EVERY} updates at the last flag\n`);
print('1. the rule off: a crowded road of 3 steps');
{
  const scene = makeScene(false, [3]);
  check('the scene is built', scene !== null);
  if (scene !== null) {
    runFed(scene, WARM_UP, false);
    const r = runFed(scene, WINDOW);
    const seg = scene.segs[0];
    let load = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const flag of (scene.game as any).flags as Iterable<Flag>) {
      for (let d = 0; d < 6; d++) load += flag.extLoad[d] + (flag.extBusy[d] ? 1 : 0);
    }
    const text = store.write(scene.game);
    check(`${r.delivered} stones delivered, never more than ${r.most[0]} carrier, no load counted, never busy`,
      r.most[0] === 1 && seg.base === 1 && load === 0 && r.busyAt === -1 && !seg.flag.extRoadBusy(seg.dir));
    check('the save has no value of the rule', !text.includes('ext_road') && !text.includes('busy_roads'));
    /* Where the rule does not apply: the longest roads have 15 carriers
       already, which is all the save and the path code hold. */
    const on = makeScene(true, [3]);
    if (on !== null) {
      const s = on.segs[0];
      const can = s.flag.extRoadCanBeBusy(s.dir);
      s.flag.pathLengthCategory[s.dir] = 7;
      const longest = s.flag.extRoadCanBeBusy(s.dir) || s.flag.extMaxTransporters(s.dir) !== 15;
      s.flag.pathLengthCategory[s.dir] = 0;
      check('the rule on: a road of 3 steps can be busy, a road of the longest kind (15 carriers) cannot',
        can && !longest && !seg.flag.extRoadCanBeBusy(seg.dir));
    }
    check(`integrity ${r.problems} problems, roads and carriers agree${r.roads === '' ? '' : ': ' + r.roads}`,
      r.problems === 0 && r.roads === '');
  }
}

// ---------------------------------------------------------------------------
print('\n2. and 3. the rule on against the rule off, one road, by length');
for (const length of [2, 3, 4, 7]) {
  const off = makeScene(false, [length]);
  const on = makeScene(true, [length]);
  if (off === null || on === null) {
    check(`length ${length}: the scene is built`, false);
    continue;
  }
  const seg = on.segs[0];
  runFed(off, WARM_UP, false);
  runFed(on, WARM_UP, false);
  const before = serfCounts(on.game);
  const a = runFed(off, WINDOW);
  const b = runFed(on, WINDOW);
  check(`length ${length} (${seg.base} by its length): off ${a.delivered} stones with at most ${a.most[0]} carriers, ` +
        `on ${b.delivered} stones with at most ${b.most[0]}; busy after ${b.busyAt} updates, ` +
        `the extra carrier there after ${b.extraAt[0]}`,
    a.most[0] === seg.base && b.most[0] === seg.base + 1 && b.busyAt > 0 && b.extraAt[0] > b.busyAt &&
    b.delivered > a.delivered);
  check(`length ${length}: integrity off ${a.problems} on ${b.problems} problems, ` +
        `roads and carriers agree${a.roads + b.roads === '' ? '' : ': ' + a.roads + ' / ' + b.roads}`,
    a.problems === 0 && b.problems === 0 && a.roads === '' && b.roads === '');

  /* The stones stop. */
  let quietAt = -1;
  let baseAt = -1;
  let problems = 0;
  let roads = '';
  for (let i = 1; i <= 20000; i++) {
    on.game.update();
    const n = seg.flag.freeTransporterCount(seg.dir);
    if (quietAt < 0 && !seg.flag.extRoadBusy(seg.dir)) quietAt = i;
    if (baseAt < 0 && quietAt > 0 && n <= seg.base) baseAt = i;
    if (i % 250 === 0) {
      problems += integrity(on.game);
      if (roads === '') roads = roadProblems(on.game);
    }
  }
  const after = serfCounts(on.game);
  const left = seg.flag.freeTransporterCount(seg.dir);
  check(`length ${length}: the stones stop: quiet after ${quietAt} updates, ${seg.base} or fewer carriers after ${baseAt}, ` +
        `${left} at the end; serfs ${before.all} before and ${after.all} after, ${after.lost} lost, ` +
        `${problems} integrity problems${roads === '' ? '' : ', ' + roads}`,
    quietAt > 0 && baseAt > 0 && left <= seg.base && left >= 1 && seg.flag.extLoad[seg.dir] === 0 &&
    after.all >= before.all && after.lost === 0 && problems === 0 && roads === '');
}

// ---------------------------------------------------------------------------
print('\n4. roads and flags that go while a road has its extra carrier');

/* Run until every road of the scene has its extra carrier. */
function untilExtra(scene: Scene, limit = 30000): boolean {
  const last = scene.flagPos[scene.flagPos.length - 1];
  for (let i = 1; i <= limit; i++) {
    if (i % FEED_EVERY === 0) feed(scene.game, last);
    scene.game.update();
    if (scene.segs.every((seg) => seg.flag.freeTransporterCount(seg.dir) > seg.base)) return true;
  }
  return false;
}

/* After a change: integrity now and for `updates` more, the roads and the
   carriers agree, and in the end nobody is lost. */
function settle(scene: Scene, updates: number, slack: number, feedPos = -1): string {
  const { game } = scene;
  const all = serfCounts(game).all;
  let problems = integrity(game);
  let roads = roadProblems(game, slack);
  for (let i = 1; i <= updates; i++) {
    if (feedPos >= 0 && i % FEED_EVERY === 0) feed(game, feedPos);
    game.update();
    if (i % 50 === 0) {
      problems += integrity(game);
      if (roads === '') roads = roadProblems(game, slack);
    }
  }
  const end = serfCounts(game);
  const out: string[] = [];
  if (problems !== 0) out.push(`${problems} integrity problems`);
  if (roads !== '') out.push(roads);
  if (end.lost !== 0) out.push(`${end.lost} serfs lost at the end`);
  if (end.all < all) out.push(`${all} serfs before, ${end.all} after`);
  return out.join('; ');
}

for (const length of [2, 3, 4]) {
  const scene = makeScene(true, [length]);
  if (scene === null || !untilExtra(scene)) {
    check(`length ${length}: a road with its extra carrier`, false);
    continue;
  }
  const seg = scene.segs[0];
  const n = seg.flag.freeTransporterCount(seg.dir);
  executeCommand(scene.game, 0, { type: 'demolishRoad', pos: scene.inner[0][0] });
  const gone = !seg.flag.hasPath(seg.dir) && seg.flag.extLoad[seg.dir] === 0 && !seg.flag.extBusy[seg.dir];
  const wrong = settle(scene, 8000, 0);
  check(`length ${length}: the road demolished with ${n} carriers on it: the road and its load are gone` +
        `${wrong === '' ? ', 0 problems, nobody lost in the end' : ': ' + wrong}`, gone && wrong === '');
}

{
  /* The last flag of a chain has one road: it goes with its road. */
  const scene = makeScene(true, [3, 3]);
  if (scene === null || !untilExtra(scene)) {
    check('a chain of two roads of 3 steps, both with an extra carrier', false);
  } else {
    const counts = scene.segs.map((seg) => seg.flag.freeTransporterCount(seg.dir)).join(' and ');
    const mid = scene.flagPos[1];
    const can = scene.game.canDemolishFlag(mid, scene.game.getPlayer(0)!);
    executeCommand(scene.game, 0, { type: 'demolishFlag', pos: mid });
    const far = scene.game.getFlagAtPos(scene.flagPos[2])!;
    let dir = -1;
    for (let d = 0; d < 6; d++) if (far.hasPath(d)) dir = d;
    const merged = dir >= 0 ? far.freeTransporterCount(dir) : -1;
    const cat = dir >= 0 ? far.lengthCategory(dir) : -1;
    /* The two roads are one of 6 steps now, with the carriers of both. */
    const wrong = settle(scene, 12000, 4, scene.flagPos[2]);
    const end = dir >= 0 ? far.freeTransporterCount(dir) : -1;
    check(`the flag between two busy roads (${counts} carriers) demolished: one road with ${merged} carriers ` +
          `(${BASE[cat] ?? '?'} by its length), ${end} after 12000 updates of stones` +
          `${wrong === '' ? ', 0 problems, nobody lost' : ': ' + wrong}`,
      can && scene.game.getFlagAtPos(mid) === null && merged === 4 && end >= 1 && end <= BASE[cat] + 1 &&
      wrong === '');
  }
}

{
  const scene = makeScene(true, [3, 3]);
  if (scene === null || !untilExtra(scene)) {
    check('a chain of two roads of 3 steps, both with an extra carrier', false);
  } else {
    /* The far flag and its road: the road first, then the flag. */
    executeCommand(scene.game, 0, { type: 'demolishRoad', pos: scene.inner[1][0] });
    executeCommand(scene.game, 0, { type: 'demolishFlag', pos: scene.flagPos[2] });
    const wrong = settle(scene, 12000, 0);
    const seg = scene.segs[0];
    check(`the far road and its flag demolished while both roads had 2 carriers: ` +
          `the near road has ${seg.flag.freeTransporterCount(seg.dir)} at the end` +
          `${wrong === '' ? ', 0 problems, nobody lost' : ': ' + wrong}`,
      scene.game.getFlagAtPos(scene.flagPos[2]) === null && seg.flag.freeTransporterCount(seg.dir) === 1 &&
      wrong === '');
  }
}

{
  /* A flag built into a road of 4 steps with 3 carriers: two roads of 2. */
  const scene = makeScene(true, [4]);
  if (scene === null || !untilExtra(scene)) {
    check('a road of 4 steps with its extra carrier', false);
  } else {
    const seg = scene.segs[0];
    const n = seg.flag.freeTransporterCount(seg.dir);
    const pos = scene.inner[0][1];
    executeCommand(scene.game, 0, { type: 'buildFlag', pos });
    const flag = scene.game.getFlagAtPos(pos);
    const now = seg.flag.freeTransporterCount(seg.dir);
    const wrong = settle(scene, 12000, 0, scene.flagPos[1]);
    check(`a flag built into a road of 4 steps with ${n} carriers: the half at the far flag has ${now} ` +
          `right after${wrong === '' ? ', 0 problems, nobody lost' : ': ' + wrong}`,
      flag !== null && n === 3 && now <= 2 && wrong === '');
  }
}

// ---------------------------------------------------------------------------
print('\n5. a save taken while a road is busy');
{
  const scene = makeScene(true, [3]);
  if (scene === null || !untilExtra(scene)) {
    check('a road of 3 steps with its extra carrier', false);
  } else {
    const { game } = scene;
    const seg = scene.segs[0];
    const pos = scene.flagPos[1];
    const text = store.write(game);
    const a = load(text);
    const b = load(text);
    const fa = a.getFlagAtPos(pos)!;
    check('the save has the rule and the load of the flag', /^\s*busy_roads/m.test(text) && /^\s*ext_road_load/m.test(text) &&
      /^\s*ext_road_busy/m.test(text));
    check('save, load, save gives the same text', store.write(a) === text);
    check(`the loaded game has the rule, the busy road (load ${fa.extLoad[seg.dir]}) and its ` +
          `${fa.freeTransporterCount(seg.dir)} carriers`,
      a.getRules().busyRoads && fa.extRoadBusy(seg.dir) && fa.extLoad[seg.dir] === seg.flag.extLoad[seg.dir] &&
      fa.extBusy[seg.dir] === seg.flag.extBusy[seg.dir] &&
      fa.freeTransporterCount(seg.dir) === seg.flag.freeTransporterCount(seg.dir) &&
      stateHash(a) === stateHash(game));
    let pair = true;
    let original = -1;
    let problems = 0;
    for (let i = 1; i <= 20000; i++) {
      /* Stones for 4000 updates, then none: busy and quiet again. */
      if (i <= 4000 && i % FEED_EVERY === 0) { feed(game, pos); feed(a, pos); feed(b, pos); }
      game.update();
      a.update();
      b.update();
      if (stateHash(a) !== stateHash(b)) { pair = false; break; }
      if (original < 0 && stateHash(a) !== stateHash(game)) original = i;
      if (i % 500 === 0) problems += integrity(a);
    }
    check(`two loaded games stay equal for 20000 updates, ${problems} integrity problems, ` +
          `${fa.freeTransporterCount(seg.dir)} carrier at the end`,
      pair && problems === 0 && roadProblems(a) === '' && fa.freeTransporterCount(seg.dir) === 1);
    check(`the loaded game and the game it was saved from: ` +
          `${original < 0 ? 'equal for 20000 updates' : 'differ after ' + original + ' updates'}`, original < 0);

    /* A save of before the rule: no value, the rule is off. */
    const old = text.split('\n').filter((line) => !/^\s*(busy_roads|ext_road_)/.test(line)).join('\n');
    const older = load(old);
    let load6 = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const flag of (older as any).flags as Iterable<Flag>) {
      for (let d = 0; d < 6; d++) load6 += flag.extLoad[d] + (flag.extBusy[d] ? 1 : 0);
    }
    check('a save without the values loads with the rule off and no load', !older.getRules().busyRoads && load6 === 0);
  }
}

// ---------------------------------------------------------------------------
print(`\n6. four computer players, ${longUpdates} updates`);

interface LongRun { hashes: number[]; problems: number; busySeen: number; extraSeen: number; ends: string; serfs: number }

function longRun(busyRoads: boolean): LongRun {
  const info = new GameInfo(new Random(MAP_SEED));
  info.removeAllPlayers();
  const faces = [9, 7, 5, 2];
  for (let i = 0; i < 4; i++) info.addPlayer(faces[i], { red: 0, green: 0, blue: 0 }, 40, 40, 40);
  info.setDefaultColors();
  info.setRules({ stockPreset: 0, peaceMinutes: 0, busyRoads, trading: false });
  const game = info.instantiate()!;
  game.setRandom(new Random('3183215728814883'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = game as any;
  const out: LongRun = { hashes: [], problems: 0, busySeen: 0, extraSeen: 0, ends: '', serfs: 0 };
  /* The roads that were ever busy, and that ever had the extra carrier. */
  const busy = new Set<string>();
  const extra = new Set<string>();
  for (let i = 1; i <= longUpdates; i++) {
    game.update();
    if (i % 100 === 0) {
      for (const flag of g.flags as Iterable<Flag>) {
        if (flag.getIndex() === 0) continue;
        for (let d = 0; d < 6; d++) {
          if (!flag.hasPath(d)) continue;
          const other = flag.getOtherEndFlag(d)!;
          const od = flag.getOtherEndDir(d);
          const n = flag.freeTransporterCount(d);
          if (out.ends === '' && n !== other.freeTransporterCount(od)) {
            out.ends = `update ${i}: flag ${flag.getIndex()} dir ${d} counts ${n}, the other end ${other.freeTransporterCount(od)}`;
          }
          if (out.ends === '' && n > 15) out.ends = `update ${i}: flag ${flag.getIndex()} dir ${d} counts ${n}`;
          const key = `${Math.min(flag.getPosition(), other.getPosition())}-${Math.max(flag.getPosition(), other.getPosition())}`;
          if (flag.extRoadBusy(d)) busy.add(key);
          if (busyRoads && !flag.isWaterPath(d) && n > BASE[flag.lengthCategory(d)] && flag.extRoadBusy(d)) extra.add(key);
        }
      }
    }
    if (i % 500 === 0) out.problems += integrity(game);
    if (i % 2000 === 0) out.hashes.push(stateHash(game));
  }
  out.busySeen = busy.size;
  out.extraSeen = extra.size;
  for (const serf of g.serfs) if (serf.getIndex() !== 0) out.serfs++;
  return out;
}

{
  const a = longRun(true);
  const b = longRun(true);
  const off = longRun(false);
  check(`the rule on: ${a.problems} integrity problems, ${a.serfs} serfs, ${a.busySeen} roads were busy at some time, ` +
        `${a.extraSeen} of them had the extra carrier${a.ends === '' ? '' : '; ' + a.ends}`,
    a.problems === 0 && a.ends === '' && a.busySeen > 0 && a.extraSeen > 0);
  check(`two runs with the rule on are equal (${a.hashes.length} hashes, the last ${a.hashes[a.hashes.length - 1].toString(16)})`,
    a.hashes.length > 0 && a.hashes.join() === b.hashes.join() && a.problems === b.problems);
  check(`the same game with the rule off: ${off.problems} integrity problems, ${off.serfs} serfs, ` +
        `${off.busySeen} busy roads`,
    off.problems === 0 && off.ends === '' && off.busySeen === 0);
}

if (warnings.length > 0) print('\n' + warnings.slice(0, 20).join('\n'));
print(`\n${checks - failed} of ${checks} checks passed`);
print(failed === 0 ? 'PASSED' : 'FAILED');
process.exit(failed === 0 ? 0 : 1);
