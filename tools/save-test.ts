// Dev tool: save a running game, load it again and compare.
// Usage: npx esbuild tools/save-test.ts --bundle --platform=node --outfile=node_modules/.cache/save-test.cjs && node node_modules/.cache/save-test.cjs [mission] [updates] [after] [ext]
//
// With a fourth argument `ext` the game is not the mission but a custom game
// of four computer players with the game options and teams in use (EXT:
// rich stock, 20 minutes of peace, extra carriers on busy roads, teams A A B
// and none); the options and teams must come back from the file.
//
// Checks, at several points of a game with computer players:
//  1. save -> load -> save gives the same text (nothing is lost or changed
//     by a round trip);
//  2. two games loaded from the same text stay equal while they run (what
//     an online game that goes on from a save needs);
//  3. how long the loaded game stays equal to the game it was saved from
//     (state that is not in the file shows here; reported, not required).

import { Game } from '../src/game/game';
import { Collection } from '../src/game/objects';
import { Serf } from '../src/game/serf';
import { GameInfo } from '../src/game/mission';
import { Random } from '../src/game/random';
import { GameStore } from '../src/game/savegame';
import { stateHash } from '../src/net/hash';

const mission = Number(process.argv[2] ?? 1);
const updates = Number(process.argv[3] ?? 40000);
const after = Number(process.argv[4] ?? 5000);
// EXT (game options and teams): see the head of the file.
const ext = process.argv[5] === 'ext';

const store = GameStore.getInstance();
let failed = false;

function firstDiff(a: string, b: string): string {
  const la = a.split('\n');
  const lb = b.split('\n');
  let section = '';
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== undefined && la[i].startsWith('[')) section = la[i];
    if (la[i] !== lb[i]) {
      return `line ${i + 1} in ${section}:\n    first:  ${la[i]}\n    second: ${lb[i]}`;
    }
  }
  return 'no difference';
}

function load(text: string): Game {
  const game = new Game();
  if (!store.read(text, game)) {
    throw new Error('load failed');
  }
  /* A loaded game is paused; this resumes it, as GameManager does. */
  game.pause();
  return game;
}

// EXT (game options and teams): the game of the `ext` run.
const extTeams = [1, 1, 2, 0];
const extRules = { stockPreset: 2, peaceMinutes: 20, busyRoads: true, trading: true, aiLevel: 1 };
function extInfo(): GameInfo {
  const custom = new GameInfo(new Random('8667715887436237'));
  custom.removeAllPlayers();
  const faces = [9, 7, 5, 2];
  for (let i = 0; i < 4; i++) {
    custom.addPlayer(faces[i], { red: 0, green: 0, blue: 0 }, 40, 30, 40);
    custom.getPlayer(i).setTeam(extTeams[i]);
  }
  custom.setDefaultColors();
  custom.setRules(extRules);
  return custom;
}
function extState(g: Game): string {
  const teams = [0, 1, 2, 3].map((i) => g.getPlayer(i)?.getTeam() ?? -1).join('');
  return `stock ${g.getRules().stockPreset}, peace ${g.getRules().peaceMinutes}, busy roads ${g.getRules().busyRoads ? 'on' : 'off'}, trading ${g.getRules().trading ? 'on' : 'off'}, computer players ${g.getRules().aiLevel}, teams ${teams}`;
}
// EXT: end of the block.

const info = ext ? extInfo() : GameInfo.getMission(mission)!;
const game = info.instantiate()!;
(game as unknown as { rnd: Random }).rnd = new Random(0x1234, 0x5678, 0x9abc);

// EXT (free index order): a pool that frees y then x (new indexes, x < y)
// and then z, the last index, which leaves x and y as free slots past the
// last object, hands out y before x, also after a save and a load.
{
  const g = (ext ? extInfo() : GameInfo.getMission(mission)!).instantiate()!;
  for (let i = 0; i < 1000; i++) g.update();
  const serfs = (g as unknown as { serfs: Collection<Serf> }).serfs;
  /* Serfs that are on no map position and in no list: nothing else sees them. */
  /* Take the free slots first, so that x, y and z are new indexes at the end. */
  const refill: number[] = [];
  while (serfs.getFreeIndexes().length > 0) refill.push(serfs.allocate().getIndex());
  const x = serfs.allocate().getIndex();
  const y = serfs.allocate().getIndex();
  const z = serfs.allocate().getIndex();
  for (const i of refill) serfs.erase(i);
  serfs.erase(y);
  serfs.erase(x);
  serfs.erase(z);
  const loaded = load(store.write(g));
  const pool = (loaded as unknown as { serfs: Collection<Serf> }).serfs;
  const hashSame = stateHash(g) === stateHash(loaded);
  const shown = `original ${serfs.getFreeIndexes().join(',')}, loaded ${pool.getFreeIndexes().join(',')}`;
  const free = serfs.getFreeIndexes();
  let ok = hashSame && free.join(',') === pool.getFreeIndexes().join(',') &&
    free.indexOf(y) >= 0 && free.indexOf(y) < free.indexOf(x) && free.indexOf(z) < 0;
  /* Both pools hand out the same indexes, z (the old last index) at the end. */
  const n = free.length + 1;
  const handed: number[] = [];
  for (let i = 0; i < n; i++) {
    const i1 = serfs.allocate().getIndex();
    const i2 = pool.allocate().getIndex();
    if (i1 !== i2) ok = false;
    handed.push(i1);
  }
  if (handed[n - 1] !== z) ok = false;
  if (!ok) failed = true;
  console.log(`free index order after a load: ${shown} ${ok ? 'ok' : 'DIFFER'}`);
}

const points = 4;
for (let p = 1; p <= points; p++) {
  for (let i = 0; i < updates / points; i++) game.update();

  const text = store.write(game);
  const a = load(text);
  const text2 = store.write(a);
  const roundTrip = text === text2;
  if (!roundTrip) failed = true;

  const b = load(text);
  // EXT (free index order): the loaded game takes free indexes in the order
  // the original would, or it reuses another index of a flag, building or
  // serf than the game that went on (found in the TEAMS game of ai-test).
  const pools = (g: Game): string => g.extPools()
    .map(([name, pool]) => `${name} ${pool.getFreeIndexes().join(' ')}`).join('; ');
  const freeSame = pools(game) === pools(a) && pools(game) === pools(b);
  if (!freeSame) {
    failed = true;
    console.log(`  free indexes DIFFER:
    original: ${pools(game)}
    loaded:   ${pools(a)}`);
  }
  const unordered = game.extPools().filter(([, pool]) => !pool.freeOrderIsAscending()).length;
  console.log(`  free indexes ${freeSame ? 'same' : 'DIFFER'} (${unordered} pools out of ascending order)`);
  // EXT (game options and teams): they come back from the file.
  if (ext) {
    const want = `stock ${extRules.stockPreset}, peace ${extRules.peaceMinutes}, busy roads on, trading on, computer players ${extRules.aiLevel}, teams ${extTeams.join('')}`;
    const ok = extState(game) === want && extState(a) === want && a.isAllied(0, 1) && !a.isAllied(0, 2) &&
      a.getPeaceTicksLeft() === game.getPeaceTicksLeft();
    if (!ok) failed = true;
    console.log(`  options and teams after loading: ${extState(a)}, peace ticks left ${a.getPeaceTicksLeft()} ` +
                `${ok ? 'ok' : 'DIFFER from ' + want}`);
  }
  let pair = true;
  let original = -1;
  let diff = '';
  for (let i = 1; i <= after; i++) {
    game.update();
    a.update();
    b.update();
    if (stateHash(a) !== stateHash(b)) {
      pair = false;
      failed = true;
      console.log(`  two loaded games differ after ${i} updates`);
      break;
    }
    if (original === -1 && stateHash(a) !== stateHash(game)) {
      original = i;
      diff = firstDiff(store.write(game), store.write(a));
    }
  }

  console.log(`t=${(p * updates) / points}: ${(text.length / 1024).toFixed(0)} KB, ` +
              `round trip ${roundTrip ? 'ok' : 'DIFFERS'}, two loads ${pair ? 'stay equal' : 'DIFFER'}, ` +
              `loaded vs original: ${original === -1 ? `equal for ${after} updates` : `differs after ${original} updates`}`);
  if (!roundTrip) console.log('  ' + firstDiff(text, text2));
  if (diff !== '') console.log('  original (first) vs loaded (second): ' + diff);
}

console.log(failed ? 'FAILED' : 'PASSED');
process.exit(failed ? 1 : 0);
