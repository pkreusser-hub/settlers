// Dev tool: the rule "smarter computer players" (EXT, GameRules.aiLevel; see
// "Extensions" in CLAUDE.md and src/game/ai-ext.ts) in headless games of
// four computer players.
// Usage: npx esbuild tools/ai-test.ts --bundle --platform=node --outfile=node_modules/.cache/ai-test.cjs --log-level=error && node node_modules/.cache/ai-test.cjs [updates] [seeds] [parts]
//   updates: the length of the long games (150000)
//   seeds:   how many of the map seeds below to use (3)
//   parts:   which parts to run, a string of the digits 1 to 4 (1234)
//   first:   the first of the map seeds to use (0)
//
// Parts:
//  1. aiLevel 0 is the game without the option: the state hashes of a game
//     that was given the rules with aiLevel 0 and of a game that was given
//     no rules are equal at every checkpoint.
//  2. aiLevel 1 in long games, two scenes per seed (everyone alone with
//     trading and no peace; two teams with trading and ten minutes of
//     peace): the computer players upgrade, cap, pause, hold, rally and
//     offer trades (each counted, none may be zero over the seeds of a
//     scene), no knight is sent during the peace or against an ally, the
//     state the computer players set is state the commands could have set,
//     the integrity check finds nothing that the same game at aiLevel 0
//     does not find, and two runs give the same hashes.
//  3. a save in the middle of an aiLevel 1 game: save, load, save gives the
//     same text, two loads stay equal, and the loaded game stays equal to
//     the game it was saved from (the improved computer players keep no
//     memory outside the save).
//  4. strength: improved against original computer players in the same
//     game, equal settings, both seatings of every seed. A measurement, not
//     a check: it prints the totals and which level is ahead in each.

import { Building, BuildingStance, BuildingType, productionCapSteps } from '../src/game/building';
import { Game, TEAM_A, TEAM_B, TEAM_NONE } from '../src/game/game';
import { IntegrityCheck } from '../src/game/integrity';
import { GameInfo } from '../src/game/mission';
import { Player } from '../src/game/player';
import { Random } from '../src/game/random';
import { GameStore } from '../src/game/savegame';
import { Serf, SerfType } from '../src/game/serf';
import { Trade } from '../src/game/trade';
import { stateHash } from '../src/net/hash';

const updates = Number(process.argv[2] ?? 150000);
const seedCount = Number(process.argv[3] ?? 3);
const parts = process.argv[4] ?? '1234';
const firstSeed = Number(process.argv[5] ?? 0);

const MAP_SEEDS = ['8667715887436237', '2251799813685247', '6172839455555550', '1029384756473829',
  '7305843009213693', '4398046511104123', '3141592653589793', '2718281828459045', '1618033988749894',
  '5772156649015328'].slice(firstSeed, firstSeed + seedCount);
const GAME_SEED = '3183215728814883';

const print = (line: string): void => { console.log(line); };
let checks = 0;
let failed = 0;
function check(what: string, ok: boolean): void {
  checks++;
  if (!ok) failed++;
  print(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
}

// The game logs speed changes, the integrity check its findings.
console.info = () => {};
let warnings: string[] = [];
console.warn = (...args: unknown[]) => { warnings.push(args.join('')); };

/* The findings of the integrity check by kind (the text without its
   numbers), counted. */
function integrity(game: Game, kinds: Map<string, number>): number {
  warnings = [];
  const n = IntegrityCheck.run(game, false);
  for (const w of warnings) {
    if (/problem\(s\) found/.test(w)) continue;
    const kind = w.replace(/\d+/g, 'N');
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  warnings = [];
  return n;
}

interface Scene {
  name: string;
  teams: number[];
  peaceMinutes: number;
  trading: boolean;
  faces: number[];
  supplies: number[];
}

/* Supplies 40 give a castle full of everything, 30 one where food runs out
   in a long game: the first has what the second comes to ask for. */
const FFA: Scene = { name: 'everyone alone, trading, no peace, supplies 40 30 40 30', teams: [0, 0, 0, 0],
  peaceMinutes: 0, trading: true, faces: [9, 7, 5, 2], supplies: [40, 30, 40, 30] };
const TEAMS: Scene = { name: 'teams A A B B, trading, 10 minutes of peace, supplies 40 30 30 40',
  teams: [TEAM_A, TEAM_A, TEAM_B, TEAM_B], peaceMinutes: 10, trading: true, faces: [9, 7, 5, 2],
  supplies: [40, 30, 30, 40] };

function makeGame(mapSeed: string, scene: Scene, aiLevel: number | null): Game {
  const info = new GameInfo(new Random(mapSeed));
  info.removeAllPlayers();
  for (let i = 0; i < 4; i++) {
    info.addPlayer(scene.faces[i], { red: 0, green: 0, blue: 0 }, 40, scene.supplies[i], 40);
    info.getPlayer(i).setTeam(scene.teams[i]);
  }
  info.setDefaultColors();
  if (aiLevel !== null) {
    info.setRules({ stockPreset: 0, peaceMinutes: scene.peaceMinutes, busyRoads: false,
      trading: scene.trading, aiLevel });
  }
  const game = info.instantiate()!;
  game.setRandom(new Random(GAME_SEED));
  return game;
}

// ---------------------------------------------------------------------------
// What the computer players do, counted where it happens. Nothing else in a
// headless game calls these (there is no person and no command).

interface Counts {
  upgrades: number; upgradesDone: number; capsSet: number; capsLifted: number; pauses: number; resumes: number;
  holds: number; holdsCleared: number; rallies: number; ralliesCleared: number;
  offers: number; accepted: number; fills: number;
  sent: number; sentInPeace: number; sentAtAlly: number; attacks: number; captures: number;
  /* Per player: knights sent, buildings taken, buildings lost. */
  sentBy: number[]; takenBy: number[]; lostBy: number[];
  bad: string[];
}
function noCounts(): Counts {
  return { upgrades: 0, upgradesDone: 0, capsSet: 0, capsLifted: 0, pauses: 0, resumes: 0, holds: 0,
    holdsCleared: 0, rallies: 0, ralliesCleared: 0, offers: 0, accepted: 0, fills: 0, sent: 0, sentInPeace: 0,
    sentAtAlly: 0, attacks: 0, captures: 0, sentBy: [0, 0, 0, 0], takenBy: [0, 0, 0, 0], lostBy: [0, 0, 0, 0],
    bad: [] };
}
let counts: Counts = noCounts();
let watched: Game | null = null;

/* eslint-disable @typescript-eslint/no-explicit-any */
function wrap(proto: any, name: string, seen: (self: any, args: any[], result: any) => void): void {
  const original = proto[name];
  proto[name] = function (this: any, ...args: any[]): any {
    const result = original.apply(this, args);
    if (watched !== null) seen(this, args, result);
    return result;
  };
}
/* The state before the call, for the setters. */
function wrapBefore(proto: any, name: string, seen: (self: any, args: any[]) => void): void {
  const original = proto[name];
  proto[name] = function (this: any, ...args: any[]): any {
    if (watched !== null) seen(this, args);
    return original.apply(this, args);
  };
}

wrap(Game.prototype, 'upgradeBuilding', (_s, _a, ok) => { if (ok) counts.upgrades++; });
wrapBefore(Building.prototype, 'setProductionCap', (b: Building, [cap]) => {
  if (!productionCapSteps.includes(cap)) counts.bad.push(`cap ${cap} is no step`);
  if (cap > 0 && b.getProductionCap() === 0) counts.capsSet++;
  if (cap === 0 && b.getProductionCap() > 0) counts.capsLifted++;
});
wrapBefore(Building.prototype, 'setProductionPaused', (b: Building, [paused]) => {
  if (b.getType() !== BuildingType.TypeToolMaker) counts.bad.push(`paused a ${BuildingType[b.getType()]}`);
  if (paused && !b.isProductionPaused()) counts.pauses++;
  if (!paused && b.isProductionPaused()) counts.resumes++;
});
wrapBefore(Building.prototype, 'setStance', (b: Building, [stance]) => {
  const player = watched!.getPlayer(b.getOwner())!;
  if (stance === BuildingStance.Hold) {
    counts.holds++;
    if (player.extRally === b.getIndex()) counts.bad.push('Hold on the rally point');
    if (b.getThreatLevel() !== 3) counts.bad.push('Hold on a building that is not on the border');
    if (watched!.getPeaceTicksLeft() > 2 * 6000) counts.bad.push('Hold early in the peace');
  } else {
    counts.holdsCleared++;
  }
});
wrapBefore(Player.prototype, 'setRally', (p: Player, [b]) => {
  counts.rallies++;
  if ((b as Building).isHolding()) counts.bad.push('rally point on a building on Hold');
  if ((b as Building).getThreatLevel() !== 3) counts.bad.push('rally point not on the border');
  if ((b as Building).getOwner() !== p.getIndex()) counts.bad.push('rally point on a building of another');
});
wrapBefore(Player.prototype, 'clearRally', (p: Player) => { if (p.extRally !== 0) counts.ralliesCleared++; });
wrap(Trade.prototype, 'makeOffer', (t: Trade, [player, , to, give, giveCount, want, wantCount], id) => {
  if (id === 0) return;
  counts.offers++;
  const from = (player as Player).getIndex();
  if (t.countOffersOf(from) !== 1) counts.bad.push(`player ${from} has ${t.countOffersOf(from)} open offers`);
  if (give >= 15 || want >= 15) counts.bad.push(`offer with a tool or weapon (${give} for ${want})`);
  if (wantCount <= 0 || wantCount > giveCount) counts.bad.push(`offer ${giveCount} for ${wantCount}`);
  const g = watched!;
  let allyCouldTrade = false;
  for (let i = 0; i < 4; i++) if (g.isAllied(from, i) && t.canPlayerTrade(i)) allyCouldTrade = true;
  if (allyCouldTrade && !g.isAllied(from, to)) counts.bad.push('offer to an enemy while an ally can trade');
});
wrap(Trade.prototype, 'acceptOffer', (_t, _a, ok) => { if (ok) counts.accepted++; });
wrapBefore(Player.prototype, 'changeKnightOccupation', () => { counts.fills++; });
wrapBefore(Player.prototype, 'startAttack', (p: Player) => {
  const target = watched!.getBuilding(p.buildingAttacked);
  if (target === null) return;
  counts.attacks++;
});
/* Every knight that leaves for an attack goes through here. */
wrapBefore(Serf.prototype, 'sendOffToFight', (serf: Serf) => {
  const g = watched!;
  const attacker = serf.getOwner();
  const target = g.getBuilding(g.getPlayer(attacker)!.buildingAttacked)!;
  counts.sent++;
  counts.sentBy[attacker]++;
  if (g.isPeace()) counts.sentInPeace++;
  if (g.isAllied(attacker, target.getOwner())) counts.sentAtAlly++;
});
wrapBefore(Game.prototype, 'occupyEnemyBuilding', (_g: Game, [building, playerNum]) => {
  counts.captures++;
  counts.takenBy[playerNum]++;
  counts.lostBy[(building as Building).getOwner()]++;
});
/* eslint-enable @typescript-eslint/no-explicit-any */

function countsLine(c: Counts): string {
  return `upgrades ${c.upgrades} (${c.upgradesDone} finished), caps set ${c.capsSet} lifted ${c.capsLifted}, ` +
    `toolmaker paused ${c.pauses} resumed ${c.resumes}, Hold set ${c.holds} cleared ${c.holdsCleared}, ` +
    `rally point set ${c.rallies} cleared ${c.ralliesCleared}, trade offers ${c.offers} accepted ${c.accepted}, ` +
    `attacks ${c.attacks} with ${c.sent} knights, ${c.captures} buildings taken`;
}

// ---------------------------------------------------------------------------

interface Standing { land: number; buildings: number; military: number; knights: number; castle: boolean }

function standings(game: Game): Standing[] {
  const out: Standing[] = [];
  for (let i = 0; i < 4; i++) out.push({ land: 0, buildings: 0, military: 0, knights: 0, castle: false });
  const map = game.getMap();
  const size = map.getCols() * map.getRows();
  for (let pos = 0; pos < size; pos++) {
    if (map.hasOwner(pos)) out[map.getOwner(pos)].land++;
  }
  for (const b of game.buildings) {
    if (b.getIndex() === 0 || b.isBurning() || !b.isDone()) continue;
    out[b.getOwner()].buildings++;
    if (b.isMilitary()) out[b.getOwner()].military++;
  }
  for (let i = 0; i < 4; i++) {
    const p = game.getPlayer(i)!;
    for (let t = SerfType.TypeKnight0; t <= SerfType.TypeKnight4; t++) out[i].knights += p.serfCount[t];
    out[i].castle = p.hasCastle() && !p.isDefeated();
  }
  return out;
}

function standingLine(s: Standing[]): string {
  return s.map((p, i) => `p${i} land ${p.land} bld ${p.buildings} knights ${p.knights}${p.castle ? '' : ' (castle lost)'}`)
    .join(' | ');
}

interface Run {
  hashes: number[];
  counts: Counts;
  problems: number;
  kinds: Map<string, number>;
  /* The state at the end that the commands refuse. */
  final: Standing[];
  save: string;
  game: Game;
}

/* Upgrades that finished: a building whose type grew since the last look. */
function run(game: Game, n: number, saveAt = 0): Run {
  counts = noCounts();
  watched = game;
  const out: Run = { hashes: [], counts, problems: 0, kinds: new Map(), final: [], save: '', game };
  const types = new Map<number, number>();
  for (let i = 1; i <= n; i++) {
    game.update();
    if (i % 500 === 0) {
      out.problems += integrity(game, out.kinds);
      for (const b of game.buildings) {
        if (b.getIndex() === 0) continue;
        const key = b.getIndex() * 4 + b.getOwner();
        const before = types.get(key);
        if (before !== undefined && b.isDone() && !b.isBurning() &&
            ((before === BuildingType.TypeHut && b.getType() === BuildingType.TypeTower) ||
             (before === BuildingType.TypeTower && b.getType() === BuildingType.TypeFortress))) {
          counts.upgradesDone++;
        }
        if (b.isDone() && !b.isBurning()) types.set(key, b.getType()); else types.delete(key);
      }
    }
    if (i % 5000 === 0) out.hashes.push(stateHash(game));
    if (i === saveAt) out.save = GameStore.getInstance().write(game);
  }
  watched = null;
  out.final = standings(game);
  return out;
}

function kindsLine(kinds: Map<string, number>): string {
  if (kinds.size === 0) return 'none';
  return [...kinds].sort().map(([k, n]) => `${n} x "${k}"`).join('; ');
}

function load(text: string): Game {
  const game = new Game();
  if (!GameStore.getInstance().read(text, game)) throw new Error('load failed');
  game.pause();
  return game;
}

// ---------------------------------------------------------------------------
if (parts.includes('1')) {
  print('1. aiLevel 0 is the game without the option');
  for (const scene of [{ ...FFA, trading: false }]) {
    for (const seed of MAP_SEEDS.slice(0, 2)) {
      const n = Math.min(updates, 40000);
      const none = run(makeGame(seed, scene, null), n);
      const zero = run(makeGame(seed, scene, 0), n);
      const one = run(makeGame(seed, scene, 1), n);
      check(`seed ${seed}: ${none.hashes.length} hashes over ${n} updates are equal with aiLevel 0 and without rules ` +
            `(the last ${none.hashes[none.hashes.length - 1].toString(16)})`,
        none.hashes.length > 0 && none.hashes.join() === zero.hashes.join());
      const c = zero.counts;
      check('  the original computer players upgrade, cap, hold, rally and offer nothing',
        c.upgrades + c.capsSet + c.pauses + c.holds + c.rallies + c.offers + c.fills === 0);
      check('  aiLevel 1 is another game (the level is in the hash)', one.hashes[0] !== zero.hashes[0]);
    }
  }
}

// ---------------------------------------------------------------------------
/* after: the hash of the running game 5000 updates after the save. */
let attacksSeen = 0;
const saves: { seed: string; scene: Scene; text: string; at: number; after?: number }[] = [];

if (parts.includes('2')) {
  print(`\n2. aiLevel 1, four computer players, ${updates} updates, ${MAP_SEEDS.length} seeds`);
  for (const scene of [FFA, TEAMS]) {
    print(`\n  ${scene.name}`);
    const total = noCounts();
    let first = true;
    for (const seed of MAP_SEEDS) {
      const saveAt = Math.floor(updates / 10000) * 5000;
      const a = run(makeGame(seed, scene, 1), updates, saveAt);
      saves.push({ seed, scene, text: a.save, at: saveAt, after: a.hashes[saveAt / 5000] });
      const c = a.counts;
      for (const key of Object.keys(total) as (keyof Counts)[]) {
        if (typeof total[key] === 'number') (total[key] as number) += c[key] as number;
      }
      print(`  seed ${seed}: ${countsLine(c)}`);
      print(`    ${standingLine(a.final)}`);
      check(`  seed ${seed}: no knight sent during the peace (${c.sentInPeace}) or against an ally (${c.sentAtAlly})`,
        c.sentInPeace === 0 && c.sentAtAlly === 0);
      check(`  seed ${seed}: everything the computer players set is what a command could set` +
            (c.bad.length === 0 ? '' : `: ${[...new Set(c.bad)].slice(0, 5).join('; ')}`), c.bad.length === 0);

      /* The same game with the original computer players: what the
         integrity check finds there is not new. */
      const base = run(makeGame(seed, scene, 0), updates);
      const fresh = [...a.kinds.keys()].filter((k) => !base.kinds.has(k));
      print(`    integrity, aiLevel 1: ${a.problems} problems (${kindsLine(a.kinds)}); ` +
            `aiLevel 0: ${base.problems} (${kindsLine(base.kinds)})`);
      check(`  seed ${seed}: the integrity check finds no kind of problem that the game at aiLevel 0 does not have`,
        fresh.length === 0);
      if (a.problems > base.problems) {
        print(`    NOTE: more findings of a known kind at aiLevel 1 (${a.problems}) than at aiLevel 0 (${base.problems})`);
      }

      /* Twice the same game (the first seed of each scene; it takes long). */
      if (first) {
        const b = run(makeGame(seed, scene, 1), updates);
        check(`  seed ${seed}: two runs give the same ${a.hashes.length} hashes (the last ` +
              `${a.hashes[a.hashes.length - 1].toString(16)})`,
          a.hashes.length > 0 && a.hashes.join() === b.hashes.join());
        first = false;
      }
    }
    print(`  all seeds: ${countsLine(total)}`);
    check('  the computer players upgraded buildings', total.upgrades > 0);
    check('  an upgrade was finished', total.upgradesDone > 0);
    check('  they capped producers', total.capsSet > 0);
    check('  they paused toolmakers', total.pauses > 0);
    check('  they put buildings on Hold', total.holds > 0);
    check('  they set rally points', total.rallies > 0);
    check('  they cleared or moved Hold and rally points', total.holdsCleared + total.ralliesCleared > 0);
    check('  they made trade offers', total.offers > 0);
    attacksSeen += total.sent;
    if (total.sent === 0) print('  NOTE: no computer player found an attack the forecast allows in this scene');
    if (scene.peaceMinutes > 0) check('  they filled the border garrisons at the end of the peace', total.fills > 0);
    if (total.accepted === 0) print('  NOTE: no trade offer of a computer player was accepted in this scene');
  }
}

if (parts.includes('2')) {
  check(`the computer players attacked with the forecast (${attacksSeen} knights sent over both scenes)`,
    attacksSeen > 0);
}

// ---------------------------------------------------------------------------
if (parts.includes('3')) {
  print('\n3. a save in the middle of an aiLevel 1 game');
  if (saves.length === 0) {
    const at = Math.floor(updates / 2);
    for (const scene of [FFA, TEAMS]) {
      const a = run(makeGame(MAP_SEEDS[0], scene, 1), at, at);
      saves.push({ seed: MAP_SEEDS[0], scene, text: a.save, at });
    }
  }
  const store = GameStore.getInstance();
  for (const save of saves.filter((s) => s.seed === MAP_SEEDS[0])) {
    const a = load(save.text);
    const b = load(save.text);
    const original = load(save.text);
    check(`${save.scene.name}, update ${save.at}: save, load, save gives the same text ` +
          `(${(save.text.length / 1024).toFixed(0)} KB, computer players ${a.getRules().aiLevel})`,
      store.write(a) === save.text && a.getRules().aiLevel === 1);
    let pair = true;
    for (let i = 0; i < 5000 && pair; i++) {
      a.update();
      b.update();
      if (i % 100 === 99 && stateHash(a) !== stateHash(b)) pair = false;
    }
    check('  two loaded games stay equal for 5000 updates', pair && stateHash(a) === stateHash(b));
    if (save.after !== undefined) {
      check('  the loaded game is the game that went on without the save, 5000 updates later',
        stateHash(a) === save.after);
    }
    /* A save of the loaded game, loaded again, goes on like it: nothing the
       computer players decide with is outside the save. */
    const mid = load(store.write(original));
    let same = true;
    for (let i = 0; i < 5000 && same; i++) {
      original.update();
      mid.update();
      if (i % 100 === 99 && stateHash(original) !== stateHash(mid)) same = false;
    }
    check('  a loaded game and a save of it loaded again stay equal for 5000 updates', same);
    const old = save.text.split('\n').filter((line) => !/^\s*ai_level/.test(line)).join('\n');
    check('  a save without the value loads with the original computer players',
      old !== save.text && load(old).getRules().aiLevel === 0);
  }
}

// ---------------------------------------------------------------------------
if (parts.includes('4')) {
  print(`\n4. strength: improved against original computer players, ${updates} updates, both seatings`);
  /* Equal settings: the same face (9), intelligence 40, supplies 40,
     reproduction 40 for all four; no peace, no trading, no teams. */
  const scene: Scene = { name: 'strength', teams: [TEAM_NONE, TEAM_NONE, TEAM_NONE, TEAM_NONE], peaceMinutes: 0,
    trading: false, faces: [9, 9, 9, 9], supplies: [40, 40, 40, 40] };
  const sum = [
    { land: 0, buildings: 0, knights: 0, castles: 0, seats: 0, sent: 0, taken: 0, lost: 0 },
    { land: 0, buildings: 0, knights: 0, castles: 0, seats: 0, sent: 0, taken: 0, lost: 0 },
  ];
  print('  seed             seating  | per seat: level land/buildings/knights, knights sent>buildings taken-lost (x = castle lost)');
  for (const seed of MAP_SEEDS) {
    for (const levels of [[1, 0, 1, 0], [0, 1, 0, 1]]) {
      const game = makeGame(seed, scene, 0);
      (game as unknown as { getAiLevelOf(i: number): number }).getAiLevelOf = (i) => levels[i];
      const r = run(game, updates);
      const cells = r.final.map((s, i) =>
        `${levels[i] === 1 ? 'I' : 'O'} ${s.land}/${s.buildings}/${s.knights} ${r.counts.sentBy[i]}>${r.counts.takenBy[i]}-${r.counts.lostBy[i]}${s.castle ? '' : ' x'}`);
      print(`  ${seed} ${levels.join('')}     | ${cells.join(' | ')}`);
      r.final.forEach((s, i) => {
        const t = sum[levels[i]];
        t.land += s.land; t.buildings += s.buildings; t.knights += s.knights;
        t.castles += s.castle ? 1 : 0; t.seats += 1;
        t.sent += r.counts.sentBy[i]; t.taken += r.counts.takenBy[i]; t.lost += r.counts.lostBy[i];
      });
    }
  }
  const line = (name: string, t: typeof sum[0]): string =>
    `  ${name}: ${t.seats} seats, land ${t.land}, buildings ${t.buildings}, knights ${t.knights}, ` +
    `castles standing ${t.castles}, knights sent ${t.sent}, buildings taken ${t.taken}, lost ${t.lost}`;
  print(line('Original', sum[0]));
  print(line('Improved', sum[1]));
  const ahead = (a: number, b: number): string => (a > b ? 'Improved ahead' : a < b ? 'Original ahead' : 'equal');
  print(`  land: ${ahead(sum[1].land, sum[0].land)}; buildings: ${ahead(sum[1].buildings, sum[0].buildings)}; ` +
        `knights: ${ahead(sum[1].knights, sum[0].knights)}; castles standing: ${ahead(sum[1].castles, sum[0].castles)}`);
}

print(`\n${checks - failed} of ${checks} checks passed`);
print(failed === 0 ? 'PASSED' : 'FAILED');
process.exit(failed === 0 ? 0 : 1);
