// Dev tool: save a running game, load it again and compare.
// Usage: npx esbuild tools/save-test.ts --bundle --platform=node --outfile=node_modules/.cache/save-test.cjs && node node_modules/.cache/save-test.cjs [mission] [updates] [after]
//
// Checks, at several points of a game with computer players:
//  1. save -> load -> save gives the same text (nothing is lost or changed
//     by a round trip);
//  2. two games loaded from the same text stay equal while they run (what
//     an online game that goes on from a save needs);
//  3. how long the loaded game stays equal to the game it was saved from
//     (state that is not in the file shows here; reported, not required).

import { Game } from '../src/game/game';
import { GameInfo } from '../src/game/mission';
import { Random } from '../src/game/random';
import { GameStore } from '../src/game/savegame';
import { stateHash } from '../src/net/hash';

const mission = Number(process.argv[2] ?? 1);
const updates = Number(process.argv[3] ?? 40000);
const after = Number(process.argv[4] ?? 5000);

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

const info = GameInfo.getMission(mission)!;
const game = info.instantiate()!;
(game as unknown as { rnd: Random }).rnd = new Random(0x1234, 0x5678, 0x9abc);

const points = 4;
for (let p = 1; p <= points; p++) {
  for (let i = 0; i < updates / points; i++) game.update();

  const text = store.write(game);
  const a = load(text);
  const text2 = store.write(a);
  const roundTrip = text === text2;
  if (!roundTrip) failed = true;

  const b = load(text);
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
