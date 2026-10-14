// Dev tool: the game options and the teams (EXT, see "Extensions" in
// CLAUDE.md) in headless games of four computer players.
// Usage: npx esbuild tools/teams-test.ts --bundle --platform=node --outfile=node_modules/.cache/teams-test.cjs --log-level=warning && node node_modules/.cache/teams-test.cjs [updates] [map seed]
//
// Checks:
//  1. the stock presets, against the normal stock of the same supplies;
//  2. a long game of two teams of two computer players: no knight is ever
//     sent against an ally, none during the peace, and the run is the same
//     twice; the same game without teams, for comparison, has attacks
//     between the players that were allies;
//  3. the victory of a team: it fires when the last castle of the other
//     side has fallen, not before, and an ally whose castle fell wins too;
//  4. a free-for-all game is not ended by fallen castles (today's rule);
//  5. the options and teams are in the save, and a save without them loads
//     with the defaults.

import { BuildingType } from '../src/game/building';
import { Game, STOCK_NORMAL, STOCK_POOR, STOCK_RICH, TEAM_A, TEAM_B, TEAM_NONE } from '../src/game/game';
import { GameInfo } from '../src/game/mission';
import { Random } from '../src/game/random';
import { ResourceType } from '../src/game/resource';
import { GameStore } from '../src/game/savegame';
import { Serf } from '../src/game/serf';
import { stateHash } from '../src/net/hash';

const updates = Number(process.argv[2] ?? 150000);
const mapSeed = process.argv[3] ?? '8667715887436237';

let failed = 0;
function check(what: string, ok: boolean): void {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
}

/* Four computer players: faces 9, 7, 5 and 2 (the aggressive ones of
   mission.ts), full intelligence. */
function makeGame(teams: number[], stockPreset = STOCK_NORMAL, peaceMinutes = 0, supplies = 40): Game {
  const info = new GameInfo(new Random(mapSeed));
  info.removeAllPlayers();
  const faces = [9, 7, 5, 2];
  for (let i = 0; i < 4; i++) {
    info.addPlayer(faces[i], { red: 0, green: 0, blue: 0 }, 40, supplies, 40);
    info.getPlayer(i).setTeam(teams[i]);
  }
  info.setDefaultColors();
  info.setRules({ stockPreset, peaceMinutes, busyRoads: false, trading: false, aiLevel: 0 });
  const game = info.instantiate()!;
  game.setRandom(new Random('3183215728814883'));
  return game;
}

/* Every knight that leaves for an attack goes through
   Serf.sendOffToFight(), called by Player.startAttack() only. */
interface Sent { tick: number; attacker: number; defender: number }
let sent: Sent[] = [];
let watched: Game | null = null;
const proto = Serf.prototype as unknown as { sendOffToFight(distCol: number, distRow: number): void };
const sendOffToFight = proto.sendOffToFight;
proto.sendOffToFight = function (this: Serf, distCol: number, distRow: number): void {
  if (watched !== null) {
    const attacker = this.getOwner();
    const target = watched.getBuilding(watched.getPlayer(attacker)!.buildingAttacked)!;
    sent.push({ tick: watched.getTick(), attacker, defender: target.getOwner() });
  }
  sendOffToFight.call(this, distCol, distRow);
};

function pairs(list: Sent[]): string {
  const counts = new Map<string, number>();
  for (const s of list) {
    const key = `${s.attacker}>${s.defender}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort().map(([k, n]) => `${k}:${n}`).join(' ') || 'none';
}

function castles(game: Game): string {
  const out: string[] = [];
  for (let i = 0; i < 4; i++) {
    const p = game.getPlayer(i)!;
    out.push(`p${i}:${!p.hasCastle() ? 'none' : p.isDefeated() ? 'fallen' : 'stands'}`);
  }
  return out.join(' ');
}

function run(teams: number[], peaceMinutes: number, n: number): { game: Game; sent: Sent[]; hash: number } {
  const game = makeGame(teams, STOCK_NORMAL, peaceMinutes);
  watched = game;
  sent = [];
  for (let i = 0; i < n; i++) game.update();
  watched = null;
  return { game, sent, hash: stateHash(game) };
}

/* Let the computer players place their castles and finish them: a castle
   counts as fallen only once it was finished. */
function withCastles(teams: number[]): Game {
  const game = makeGame(teams);
  for (let i = 0; i < 20000; i++) {
    game.update();
    let all = true;
    for (let p = 0; p < 4; p++) {
      const pos = castlePos(game, p);
      all = all && pos >= 0 && game.getBuildingAtPos(pos)!.isDone();
    }
    if (all) break;
  }
  return game;
}

function castlePos(game: Game, player: number): number {
  for (const b of game.buildings) {
    if (b.getIndex() !== 0 && b.getType() === BuildingType.TypeCastle && b.getOwner() === player) {
      return b.getPosition();
    }
  }
  return -1;
}

/* The castle of the player falls (as when it is conquered:
   Game.occupyEnemyBuilding() demolishes it the same way). */
function fell(game: Game, player: number): void {
  game.demolishBuilding_(castlePos(game, player));
}

/* One period of the game statistics (1500 ticks) and a little more. */
function statsPeriod(game: Game): void {
  for (let i = 0; i < 800; i++) game.update();
}

// ---------------------------------------------------------------------------
console.log('1. stock presets');
{
  const R = ResourceType;
  /* What Game.buildCastle() puts in a castle, before the first serfs take
     their tools and weapons from it. */
  const scratch = makeGame([0, 0, 0, 0]);
  const stock = (preset: number, supplies: number): number[] => {
    const inv = scratch.inventories.allocate()!;
    inv.applySuppliesPreset(supplies, preset);
    const counts: number[] = [];
    for (let r = 0; r < 26; r++) counts.push(inv.getCountOf(r as ResourceType));
    return counts;
  };
  /* The castle of a game takes its stock by the preset of the game: the
     planks and stones it holds, with the reserve of the emergency program
     that is kept back from it. */
  const castleStock = (preset: number, supplies: number): string => {
    const game = makeGame([0, 0, 0, 0], preset, 0, supplies);
    for (let i = 0; i < 5000 && !game.getPlayer(0)!.hasCastle(); i++) game.update();
    const player = game.getPlayer(0)!;
    const inv = game.getPlayerInventories(player)[0];
    return `${inv.getCountOf(R.TypePlank) + player.extraPlanks}/${inv.getCountOf(R.TypeStone) + player.extraStone}`;
  };
  check(`a castle at supplies 20 holds planks/stones: normal ${castleStock(STOCK_NORMAL, 20)}, ` +
    `poor ${castleStock(STOCK_POOR, 20)}, rich ${castleStock(STOCK_RICH, 20)}`,
    castleStock(STOCK_NORMAL, 20) === '40/20' && castleStock(STOCK_POOR, 20) === '20/10' &&
    castleStock(STOCK_RICH, 20) === '60/30');
  for (const supplies of [0, 20, 40]) {
    const normal = stock(STOCK_NORMAL, supplies);
    const poor = stock(STOCK_POOR, supplies);
    const rich = stock(STOCK_RICH, supplies);
    const floor = stock(STOCK_NORMAL, 0);
    let ok = true;
    for (let r = 0; r < 26; r++) {
      const half = Math.ceil(normal[r] / 2);
      if (poor[r] !== Math.max(half, floor[r])) ok = false;
      if (rich[r] !== normal[r] + half) ok = false;
    }
    check(`supplies ${supplies}: planks, stones, swords normal ${normal[R.TypePlank]}/${normal[R.TypeStone]}/${normal[R.TypeSword]}, ` +
      `poor ${poor[R.TypePlank]}/${poor[R.TypeStone]}/${poor[R.TypeSword]}, ` +
      `rich ${rich[R.TypePlank]}/${rich[R.TypeStone]}/${rich[R.TypeSword]}`, ok);
  }
}

// ---------------------------------------------------------------------------
console.log(`\n2. two teams of two computer players, ${updates} updates, 30 minutes of peace`);
{
  const teams = [TEAM_A, TEAM_A, TEAM_B, TEAM_B];
  const a = run(teams, 30, updates);
  const allied = a.sent.filter((s) => a.game.isAllied(s.attacker, s.defender));
  const early = a.sent.filter((s) => s.tick < 30 * 6000);
  console.log(`     tick ${a.game.getTick()}, castles ${castles(a.game)}, winner ${a.game.getWinningPlayer()}`);
  console.log(`     knights sent, attacker>defender: ${pairs(a.sent)}`);
  check(`no knight was sent against an ally (${allied.length} of ${a.sent.length})`, allied.length === 0);
  check(`no knight was sent during the peace (first at tick ${a.sent.length > 0 ? a.sent[0].tick : 'none'})`,
    early.length === 0);
  check('knights were sent against enemies (the run is long enough to tell)', a.sent.length > 0);

  const b = run(teams, 30, updates);
  check(`the same game twice has the same state hash (${a.hash.toString(16)})`,
    a.hash === b.hash && pairs(a.sent) === pairs(b.sent));

  /* The same players without teams and without peace. */
  const c = run([TEAM_NONE, TEAM_NONE, TEAM_NONE, TEAM_NONE], 0, updates);
  const would = c.sent.filter((s) => (s.attacker < 2) === (s.defender < 2));
  console.log(`     without teams: knights sent ${pairs(c.sent)}; ` +
    `${would.length} of them between players 0 and 1 or 2 and 3`);
}

// ---------------------------------------------------------------------------
console.log('\n3. the victory of a team');
{
  const game = withCastles([TEAM_A, TEAM_A, TEAM_B, TEAM_B]);
  check(`all four castles stand (${castles(game)})`, [0, 1, 2, 3].every((p) => castlePos(game, p) >= 0));
  statsPeriod(game);
  check('no winner while all castles stand', game.getWinningPlayer() === -1 && !game.isGameEndPending());

  fell(game, 1);
  statsPeriod(game);
  check(`an ally's castle has fallen (${castles(game)}): no winner`, game.getWinningPlayer() === -1);

  fell(game, 2);
  statsPeriod(game);
  check(`one enemy castle has fallen (${castles(game)}): no winner`,
    game.getWinningPlayer() === -1 && !game.isGameEndPending());

  fell(game, 3);
  const before = game.getTick();
  let waited = 0;
  while (game.getWinningPlayer() < 0 && waited < 2000) {
    game.update();
    waited++;
  }
  check(`the last enemy castle has fallen (${castles(game)}): team A wins ${game.getTick() - before} ticks later, ` +
    `winning player ${game.getWinningPlayer()}, winners ${game.getWinners().join(' and ')}`,
    game.getWinningPlayer() === 0 && game.isGameEndPending() && game.getTick() - before <= 1500);
  check('the ally whose castle fell wins too; the enemies do not',
    game.isWinner(0) && game.isWinner(1) && game.getPlayer(1)!.isDefeated() &&
    !game.isWinner(2) && !game.isWinner(3));

  /* Three against one. */
  const three = withCastles([TEAM_A, TEAM_A, TEAM_A, TEAM_NONE]);
  fell(three, 0);
  fell(three, 1);
  fell(three, 2);
  statsPeriod(three);
  check(`three against one, the three castles have fallen (${castles(three)}): the one wins alone`,
    three.getWinningPlayer() === 3 && three.getWinners().join() === '3' && !three.isWinner(0));
}

// ---------------------------------------------------------------------------
console.log('\n4. no teams: fallen castles do not end the game');
{
  const game = withCastles([TEAM_NONE, TEAM_NONE, TEAM_NONE, TEAM_NONE]);
  fell(game, 1);
  fell(game, 2);
  fell(game, 3);
  statsPeriod(game);
  check(`three castles have fallen (${castles(game)}): no winner, as before`,
    game.getWinningPlayer() === -1 && !game.isGameEndPending() && game.getWinners().length === 0);
}

// ---------------------------------------------------------------------------
console.log('\n5. a save from before the options and teams');
{
  const store = GameStore.getInstance();
  const game = makeGame([TEAM_A, TEAM_A, TEAM_B, TEAM_B], STOCK_RICH, 20);
  for (let i = 0; i < 2000; i++) game.update();
  const text = store.write(game);
  const lines = text.split('\n');
  const mine = lines.filter((line) => /^\s*(stock_preset|peace_minutes|team)\s*=/.test(line));
  check(`the file has the values (${mine.map((line) => line.trim()).join(', ')})`, mine.length === 6);
  const loaded = new Game();
  check('the game with options and teams is read back with them',
    store.read(text, loaded) && loaded.getRules().stockPreset === STOCK_RICH &&
    loaded.getRules().peaceMinutes === 20 && loaded.isAllied(2, 3) && !loaded.isAllied(1, 2));
  /* The same file as an older build wrote it: without the three values. */
  const old = lines.filter((line) => !mine.includes(line)).join('\n');
  const older = new Game();
  check('a file without the values loads with normal stock, no peace and no teams',
    store.read(old, older) && older.getRules().stockPreset === STOCK_NORMAL &&
    older.getRules().peaceMinutes === 0 && !older.hasTeams() && !older.isPeace());
}

console.log(failed === 0 ? '\nPASSED' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
