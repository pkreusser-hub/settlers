// Dev tool: the early economy of computer players. Four computer players
// on one map; at checkpoints it prints, per player, the planks, stone and
// lumber in the stocks, the finished buildings, the construction sites and
// the planks and stone those sites still have to get, and whether the
// player is stuck: sites waiting, too little in stock to finish them, and
// no working lumberjack and sawmill (or no stonecutter) to make more.
// Usage: npx esbuild tools/ai-economy.ts --bundle --platform=node --outfile=node_modules/.cache/ai-economy.cjs --log-level=error && node node_modules/.cache/ai-economy.cjs [aiLevel] [supplies] [stockPreset] [updates] [seeds]
//   aiLevel:     0 Original, 1 Improved (1)
//   supplies:    starting supplies of every player, 0..40 (10)
//   stockPreset: 0 normal, 1 poor, 2 rich (1)
//   updates:     length of each game (60000)
//   seeds:       how many map seeds (4)

import { BuildingType } from '../src/game/building';
import type { Building } from '../src/game/building';
import { Game } from '../src/game/game';
import { GameInfo } from '../src/game/mission';
import type { Player } from '../src/game/player';
import { Random } from '../src/game/random';
import { ResourceType } from '../src/game/resource';

const aiLevel = Number(process.argv[2] ?? 1);
const supplies = Number(process.argv[3] ?? 10);
const stockPreset = Number(process.argv[4] ?? 1);
const updates = Number(process.argv[5] ?? 60000);
const seedCount = Number(process.argv[6] ?? 4);

const MAP_SEEDS = ['8667715887436237', '2251799813685247', '6172839455555550', '1029384756473829',
  '7305843009213693', '4398046511104123', '3141592653589793', '2718281828459045'].slice(0, seedCount);
const GAME_SEED = '3183215728814883';
const CHECKPOINTS = 6;

console.info = () => {};
console.warn = () => {};

const B = BuildingType;
const R = ResourceType;

function makeGame(mapSeed: string): Game {
  const info = new GameInfo(new Random(mapSeed));
  info.removeAllPlayers();
  for (const face of [9, 7, 5, 2]) info.addPlayer(face, { red: 0, green: 0, blue: 0 }, 40, supplies, 40);
  info.setDefaultColors();
  info.setRules({ stockPreset, peaceMinutes: 0, busyRoads: false, trading: false, aiLevel });
  const game = info.instantiate()!;
  game.setRandom(new Random(GAME_SEED));
  return game;
}

function buildingsOf(game: Game, player: Player): Building[] {
  return [...game.getPlayerBuildings(player)];
}

function stockOf(game: Game, player: Player, res: ResourceType): number {
  let n = 0;
  for (const inv of game.getPlayerInventories(player)) n += inv.getCountOf(res);
  return n;
}

interface State {
  planks: number; stone: number; lumber: number;
  done: number; sites: number; needPlanks: number; needStone: number;
  lumberjacks: number; sawmills: number; stonecutters: number; foresters: number;
  stuck: boolean;
}

function stateOf(game: Game, player: Player): State {
  const s: State = {
    planks: stockOf(game, player, R.TypePlank), stone: stockOf(game, player, R.TypeStone),
    lumber: stockOf(game, player, R.TypeLumber), done: 0, sites: 0, needPlanks: 0, needStone: 0,
    lumberjacks: 0, sawmills: 0, stonecutters: 0, foresters: 0, stuck: false,
  };
  for (const b of buildingsOf(game, player)) {
    if (b.getType() === B.TypeCastle) continue;
    if (!b.isDone()) {
      s.sites++;
      /* What the site still has to get: its rest less what waits there or
         is on the way. */
      const st = (b as unknown as { stock: { maximum: number; available: number; requested: number }[] }).stock;
      s.needPlanks += Math.max(0, st[0].maximum - st[0].available - st[0].requested);
      s.needStone += Math.max(0, st[1].maximum - st[1].available - st[1].requested);
      continue;
    }
    s.done++;
    if (b.getType() === B.TypeLumberjack) s.lumberjacks++;
    if (b.getType() === B.TypeSawmill) s.sawmills++;
    if (b.getType() === B.TypeStonecutter) s.stonecutters++;
    if (b.getType() === B.TypeForester) s.foresters++;
  }
  const canMakePlanks = s.sawmills > 0 && (s.lumberjacks > 0 || s.lumber > 0);
  s.stuck = s.sites > 0 &&
    ((s.needPlanks > s.planks && !canMakePlanks) || (s.needStone > s.stone && s.stonecutters === 0));
  return s;
}

const fmt = (s: State): string =>
  `P${s.planks} S${s.stone} L${s.lumber} | done ${s.done} sites ${s.sites} need P${s.needPlanks} S${s.needStone}` +
  ` | lj ${s.lumberjacks} saw ${s.sawmills} sc ${s.stonecutters} for ${s.foresters}${s.stuck ? '  STUCK' : ''}`;

console.log(`aiLevel ${aiLevel}, supplies ${supplies}, stock preset ${stockPreset}, ${updates} updates, ` +
  `${MAP_SEEDS.length} seeds`);
let stuckEnd = 0;
let doneEnd = 0;
let players = 0;
for (const seed of MAP_SEEDS) {
  const game = makeGame(seed);
  console.log(`\nseed ${seed}`);
  for (let c = 1; c <= CHECKPOINTS; c++) {
    const until = Math.floor((updates * c) / CHECKPOINTS);
    while (game.getTick() >= 0 && c > 0 && (game as unknown as { _n?: number })._n !== until) {
      const g = game as unknown as { _n?: number };
      g._n = (g._n ?? 0) + 1;
      game.update();
    }
    console.log(`  t=${until}`);
    for (let p = 0; p < 4; p++) {
      const player = game.getPlayer(p);
      if (player === null || !player.hasCastle()) continue;
      const s = stateOf(game, player);
      console.log(`    p${p} ${fmt(s)}`);
      if (s.stuck && process.env.DETAIL) {
        const sites = buildingsOf(game, player).filter((b) => !b.isDone() && b.getType() !== B.TypeCastle).map((b) => {
          const st = (b as unknown as { stock: { maximum: number; available: number; requested: number }[] }).stock;
          return `${B[b.getType()]}(P${st[0].maximum}/${st[0].available}/${st[0].requested} S${st[1].maximum}/${st[1].available}/${st[1].requested} prog ${b.getProgress()})`;
        });
        console.log(`      extra P${player.extraPlanks} S${player.extraStone} emergency ${player.emergencyActive} outP ${player.isOutOfPlanks()} outS ${player.isOutOfStone()} | ${sites.join(' ')}`);
      }
      if (c === CHECKPOINTS) {
        players++;
        doneEnd += s.done;
        if (s.stuck) stuckEnd++;
      }
    }
  }
}
console.log(`\nat the end: ${stuckEnd} of ${players} players stuck, ${doneEnd} buildings finished in all`);
