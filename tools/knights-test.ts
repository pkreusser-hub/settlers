// Dev tool: the knight controls that are not part of Freeserf (EXT, see
// "Extensions" in CLAUDE.md), against headless games: the stance of a
// military building (Normal, Hold), the rally point of a player and the
// forecast of the attack window.
// Usage: npx esbuild tools/knights-test.ts --bundle --platform=node --outfile=node_modules/.cache/knights-test.cjs --log-level=error && node node_modules/.cache/knights-test.cjs [updates of the long run]
//
// Checks:
//  1. Hold: an attack takes no knight from a building on Hold, and the
//     building keeps its full garrison whatever the occupation sliders say;
//  2. rally point: an attack takes its knights from the rally point first,
//     new knights from the castle go there first while it has room (and to
//     the others when no knight can reach it), and it is cleared when the
//     building is demolished, burns or is captured;
//  3. every way a command is refused;
//  4. the forecast against the duels of Serf.setFightOutcome(): the chance
//     of one duel, the chance of a whole attack and the word for it;
//  5. a real attack with a rally point runs to its end;
//  6. the save: round trip with a stance and a rally point, two loads stay
//     equal, a game without them writes neither value;
//  7. the integrity check: nothing in all of the above, and it finds and
//     repairs a stance or rally point that cannot be;
//  8. a long game of four computer players with scripted stance and rally
//     commands is the same twice.

import { BuildingStance, BuildingType, fullGarrison } from '../src/game/building';
import { Building } from '../src/game/building';
import { Game } from '../src/game/game';
import { IntegrityCheck } from '../src/game/integrity';
import {
  attackForce,
  attackVerdict,
  AttackVerdict,
  attackWinChance,
  duelMorale,
  duelWinDraws,
  forecastAttack,
  kOwnLandFactor,
} from '../src/game/knights';
import { GameInfo } from '../src/game/mission';
import { pathfinderMap } from '../src/game/pathfinder';
import { Random } from '../src/game/random';
import { ResourceType } from '../src/game/resource';
import { GameStore } from '../src/game/savegame';
import { Serf, SerfState, SerfType } from '../src/game/serf';
import { executeCommand } from '../src/net/command';
import type { Command } from '../src/net/command';
import '../src/net/commands';
import { canAttack, previewAttack, rallyRefusal, stanceRefusal } from '../src/net/commands';
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

/* The problems the integrity check finds, in all games of this tool. */
let integrityRuns = 0;
let integrityProblems = 0;
function integrity(game: any): number {
  warnings.length = 0;
  const n = IntegrityCheck.run(game as Game, false);
  integrityRuns++;
  integrityProblems += n;
  if (n !== 0) print(`     integrity: ${warnings.join(' | ')}`);
  return n;
}

const store = GameStore.getInstance();
function load(text: string): any {
  const game = new Game();
  if (!store.read(text, game)) throw new Error('load failed');
  /* A loaded game is paused; this resumes it, as GameManager does. */
  game.pause();
  return game;
}

// ---------------------------------------------------------------------------
// Hooks: every knight that leaves for an attack (Player.startAttack() is the
// only caller of Serf.sendOffToFight()) and every knight that an inventory
// sends to a military building (Building.knightRequestGranted()).

let sentFrom: number[] = [];
const serfProto = Serf.prototype as unknown as { sendOffToFight(c: number, r: number): void };
const sendOffToFight = serfProto.sendOffToFight;
serfProto.sendOffToFight = function (this: Serf, c: number, r: number): void {
  sentFrom.push((this as any).pos);
  sendOffToFight.call(this, c, r);
};

let granted: number[] = [];
const bldProto = Building.prototype as unknown as { knightRequestGranted(): void };
const knightRequestGranted = bldProto.knightRequestGranted;
bldProto.knightRequestGranted = function (this: Building): void {
  granted.push(this.getIndex());
  knightRequestGranted.call(this);
};

// ---------------------------------------------------------------------------
// The battle scene: two people without castles (the game stays quiet).
// Player 1 has a tower; player 0 has a tower, a guard hut and a fortress in
// reach of it. All come manned from the helper of tutorial 6
// (Game.buildOccupiedMilitary).

interface Scene {
  game: any;
  map: any;
  p0: any;
  p1: any;
  target: any;
  /* Player 0's buildings in the order an attack asks them (nearest first,
     Player.attackingBuildings). */
  own: any[];
}

let sceneAttempt = -1;

function buildScene(attempt: number): Scene | null {
  const info = new GameInfo(new Random('8667715887436237'));
  info.removeAllPlayers();
  info.addPlayer(12, { red: 0, green: 0, blue: 0 }, 40, 40, 40);
  info.addPlayer(13, { red: 0, green: 0, blue: 0 }, 40, 40, 40);
  info.setDefaultColors();
  info.setRules({ stockPreset: 0, peaceMinutes: 0, busyRoads: false, trading: false });
  const game = info.instantiate()! as any;
  game.rnd = new Random(0x1234, 0x5678, 0x9abc);
  const map = game.getMap();
  const size = map.getCols() * map.getRows();
  const p0 = game.getPlayer(0);
  const p1 = game.getPlayer(1);

  let seen = 0;
  let pos1 = -1;
  for (let pos = 0; pos < size; pos++) {
    if (game.canBuildCastle(pos, p1) && game.canBuildMilitary(pos) && seen++ === (attempt >> 3) * 37) {
      pos1 = pos;
      break;
    }
  }
  if (pos1 < 0) return null;
  game.buildOccupiedMilitary(pos1, BuildingType.TypeTower, p1);
  const pos0 = map.posAdd(pos1, 8 + (attempt & 7), 0);
  if (!game.canBuildCastle(pos0, p0) || !game.canBuildMilitary(pos0)) return null;
  game.buildOccupiedMilitary(pos0, BuildingType.TypeTower, p0);
  const target = game.getBuildingAtPos(pos1);
  if (target === null || game.getBuildingAtPos(pos0) === null) return null;
  if (target.getThreatLevel() !== 3) return null;

  /* A guard hut and a fortress on the land the tower has taken. */
  const site = (pos: number, large: boolean): boolean =>
    map.getOwner(pos) === 0 && map.hasOwner(pos) && game.canBuildMilitary(pos) &&
    (large ? game.canBuildLarge(pos) : game.canBuildSmall(pos)) &&
    game.canBuildFlag(map.moveDownRight(pos), p0);
  for (const type of [BuildingType.TypeHut, BuildingType.TypeFortress]) {
    let built = false;
    for (let i = 19; i < 271 && !built; i++) {
      const pos = map.posAddSpirally(pos0, i);
      if (!site(pos, type === BuildingType.TypeFortress)) continue;
      game.buildOccupiedMilitary(pos, type, p0);
      built = game.getBuildingAtPos(pos)?.getType() === type;
    }
    if (!built) return null;
  }

  if (!canAttack(game, pos1, p0)) return null;
  p0.knightsAvailableForAttack(pos1);
  const own: any[] = [];
  for (let i = 0; i < p0.attackingBuildingCount; i++) own.push(game.getBuilding(p0.attackingBuildings[i]));
  if (own.length !== 3) return null;
  /* Each of the three has knights to give. */
  for (const b of own) {
    if (attackForceOf({ game, map, p0, p1, target, own }, 100).filter((pos) => pos === b.getPosition()).length === 0) {
      return null;
    }
  }
  return { game, map, p0, p1, target, own };
}

/* Where the knights of an attack with `knights` knights would come from, by
   sending them in a copy of nothing: the walk of start_attack() as
   knights.ts previews it gives ranks only, so this asks each building. */
function attackForceOf(scene: Scene, knights: number): number[] {
  const minLevel: Record<number, number[]> = {
    [BuildingType.TypeHut]: [1, 1, 2, 2, 3],
    [BuildingType.TypeTower]: [1, 2, 3, 4, 6],
    [BuildingType.TypeFortress]: [1, 3, 6, 9, 12],
  };
  const from: number[] = [];
  for (const b of scene.own) {
    if (b.isHolding()) continue;
    const n = b.getKnightCount() -
      minLevel[b.getType()][scene.p0.getKnightOccupation(b.getThreatLevel()) & 0xf];
    for (let j = 0; j < n && from.length < knights; j++) from.push(b.getPosition());
  }
  return from;
}

function scene(): Scene {
  if (sceneAttempt < 0) {
    for (let attempt = 0; attempt < 800; attempt++) {
      if (buildScene(attempt) !== null) {
        sceneAttempt = attempt;
        break;
      }
    }
    if (sceneAttempt < 0) throw new Error('no battle scene on this map');
  }
  return buildScene(sceneAttempt)!;
}

const typeName = (b: any): string =>
  ({ [BuildingType.TypeHut]: 'hut', [BuildingType.TypeTower]: 'tower',
     [BuildingType.TypeFortress]: 'fortress', [BuildingType.TypeCastle]: 'castle' } as Record<number, string>)[b.getType()] ?? `type ${b.getType()}`;
const exec = (game: any, cmd: Command, who = 0): void => executeCommand(game, who, cmd);
const run = (game: any, updates: number): void => { for (let i = 0; i < updates; i++) game.update(); };
const total = (b: any): number => b.stock[0].available + b.stock[0].requested;

/* All four occupation sliders of the player to the lowest or the highest
   setting, by the command of the knight box. */
function sliders(game: any, high: boolean, who = 0): void {
  for (let level = 0; level < 4; level++) {
    for (let i = 0; i < 4; i++) {
      if (high) {
        exec(game, { type: 'changeKnightOccupation', level, adjustMax: true, delta: 1 }, who);
        exec(game, { type: 'changeKnightOccupation', level, adjustMax: false, delta: 1 }, who);
      } else {
        exec(game, { type: 'changeKnightOccupation', level, adjustMax: false, delta: -1 }, who);
        exec(game, { type: 'changeKnightOccupation', level, adjustMax: true, delta: -1 }, who);
      }
    }
  }
}

// ---------------------------------------------------------------------------
print('1. Hold');
{
  const s = scene();
  const { game, p0, target, own } = s;
  print(`     scene ${sceneAttempt}: target tower with ${target.getKnightCount()} knights; ` +
    `player 0 has ${own.map((b) => `${typeName(b)} (${b.getKnightCount()})`).join(', ')}, nearest first`);

  const held = own[0];
  const before = previewAttack(p0, target.getPosition());
  const gives = attackForceOf(s, 100).filter((pos) => pos === held.getPosition()).length;
  exec(game, { type: 'setBuildingStance', pos: held.getPosition(), stance: BuildingStance.Hold });
  const after = previewAttack(p0, target.getPosition());
  check(`the nearest building goes on Hold: ${before.totalAttackingKnights} knights were ready, ` +
    `${after.totalAttackingKnights} are now (it had ${gives} to give), ` +
    `${after.attackingBuildingCount} of ${before.attackingBuildingCount} buildings take part`,
    held.isHolding() && gives > 0 && after.totalAttackingKnights === before.totalAttackingKnights - gives &&
    after.attackingBuildingCount === before.attackingBuildingCount - 1);

  const inside = held.getKnightCount();
  const others = own.slice(1).map((b) => b.getKnightCount());
  sentFrom = [];
  exec(game, { type: 'startAttack', pos: target.getPosition(), knights: 100 });
  check(`an attack with all knights: ${sentFrom.length} go, none from the building on Hold ` +
    `(it still has ${held.getKnightCount()} of ${inside})`,
    sentFrom.length === after.totalAttackingKnights && sentFrom.length > 0 &&
    !sentFrom.includes(held.getPosition()) && held.getKnightCount() === inside &&
    own.slice(1).every((b, i) => b.getKnightCount() < others[i]));

  /* Back to Normal: it gives again. */
  const s2 = scene();
  exec(s2.game, { type: 'setBuildingStance', pos: s2.own[0].getPosition(), stance: BuildingStance.Hold });
  exec(s2.game, { type: 'setBuildingStance', pos: s2.own[0].getPosition(), stance: BuildingStance.Normal });
  sentFrom = [];
  exec(s2.game, { type: 'startAttack', pos: s2.target.getPosition(), knights: 100 });
  check(`back on Normal the building gives its knights again (${sentFrom.length} go, as before the Hold)`,
    sentFrom.length === before.totalAttackingKnights && sentFrom.includes(s2.own[0].getPosition()));

  /* The garrison: all sliders to the lowest setting. A building on Normal
     sends its knights away down to one, the one on Hold keeps them all. */
  const s3 = scene();
  const keep = s3.own.find((b) => b.getType() === BuildingType.TypeFortress);
  const loose = s3.own.find((b) => b.getType() === BuildingType.TypeTower);
  exec(s3.game, { type: 'setBuildingStance', pos: keep.getPosition(), stance: BuildingStance.Hold });
  sliders(s3.game, false);
  let least = keep.getKnightCount();
  for (let i = 0; i < 6000; i++) {
    s3.game.update();
    least = Math.min(least, keep.getKnightCount());
  }
  check(`sliders at the lowest setting for 6000 updates: the fortress on Hold never has fewer than ${least} knights ` +
    `(full is ${fullGarrison(keep.getType())}), the tower on Normal is down to ${loose.getKnightCount()}`,
    least === fullGarrison(BuildingType.TypeFortress) && loose.getKnightCount() === 1);
  check('no integrity problems in the three games', integrity(game) + integrity(s2.game) + integrity(s3.game) === 0);
}

// ---------------------------------------------------------------------------
// The castle scene: player 0 with a finished castle and three manned towers,
// two of them joined to the castle by a road. Their knights are sent home
// first (sliders low), so that the castle has knights to send out and the
// towers have room.

interface CastleScene {
  game: any;
  p0: any;
  castle: any;
  /* The towers with a road, and the one without. */
  a: any;
  b: any;
  cut: any;
}

function castleScene(): CastleScene {
  const info = new GameInfo(new Random('8667715887436237'));
  info.removeAllPlayers();
  info.addPlayer(12, { red: 0, green: 0, blue: 0 }, 40, 40, 40);
  info.setDefaultColors();
  info.setRules({ stockPreset: 0, peaceMinutes: 0, busyRoads: false, trading: false });
  const game = info.instantiate()! as any;
  game.rnd = new Random(0x1234, 0x5678, 0x9abc);
  const map = game.getMap();
  const size = map.getCols() * map.getRows();
  const p0 = game.getPlayer(0);
  let castlePos = -1;
  for (let pos = 0; pos < size; pos++) {
    if (game.canBuildCastle(pos, p0)) { castlePos = pos; break; }
  }
  exec(game, { type: 'buildCastle', pos: castlePos });
  const castle = game.getBuildingAtPos(castlePos);
  for (let i = 0; i < 3000 && !castle.isDone(); i++) game.update();
  if (!castle.isDone()) throw new Error('the castle was not finished');

  const towers: any[] = [];
  for (let i = 19; i < 295 && towers.length < 3; i++) {
    const pos = map.posAddSpirally(castlePos, i);
    if (!game.canBuildBuilding(pos, BuildingType.TypeTower, p0)) continue;
    const withRoad = towers.length < 2;
    if (withRoad) {
      /* A road must be possible before the tower stands. */
      const road = pathfinderMap(map, map.moveDownRight(pos), map.moveDownRight(castlePos));
      if (road.getLength() === 0) continue;
      game.buildOccupiedMilitary(pos, BuildingType.TypeTower, p0);
      if (!game.buildRoad(road, p0)) {
        game.demolishBuilding_(pos);
        continue;
      }
    } else {
      game.buildOccupiedMilitary(pos, BuildingType.TypeTower, p0);
      if (map.paths(map.moveDownRight(pos)) !== 0) {
        game.demolishBuilding_(pos);
        continue;
      }
    }
    towers.push(game.getBuildingAtPos(pos));
  }
  if (towers.length < 3) throw new Error('no room for three towers at the castle');

  /* The knights go home. */
  sliders(game, false);
  for (let i = 0; i < 12000; i++) {
    game.update();
    if (towers.every((t) => total(t) === 1) && knightsHome(game) >= 10) break;
  }
  return { game, p0, castle, a: towers[0], b: towers[1], cut: towers[2] };
}

/* Knights that wait in the castle. */
function knightsHome(game: any): number {
  let n = 0;
  for (const serf of game.serfs) {
    if (serf.getIndex() !== 0 && serf.getOwner() === 0 && serf.getState() === SerfState.StateIdleInStock &&
        serf.getType() >= SerfType.TypeKnight0 && serf.getType() <= SerfType.TypeKnight4) {
      n++;
    }
  }
  return n;
}

print('\n2. the rally point');
{
  /* An attack takes its knights from the rally point first. */
  const s = scene();
  const far = s.own[2];
  const near = s.own[0];
  sentFrom = [];
  exec(s.game, { type: 'startAttack', pos: s.target.getPosition(), knights: 1 });
  const plain = sentFrom.slice();

  const r = scene();
  exec(r.game, { type: 'setRallyPoint', pos: r.own[2].getPosition() });
  const order = previewAttack(r.p0, r.target.getPosition());
  const force = attackForce(r.game, r.p0, r.target.getPosition(), 1);
  sentFrom = [];
  exec(r.game, { type: 'startAttack', pos: r.target.getPosition(), knights: 1 });
  check(`one knight to send: without a rally point he comes from the nearest building (${typeName(near)}), ` +
    `with the farthest (${typeName(far)}) as the rally point he comes from there`,
    plain.length === 1 && plain[0] === near.getPosition() &&
    sentFrom.length === 1 && sentFrom[0] === r.own[2].getPosition() &&
    r.p0.getRallyBuilding() === r.own[2] && force.fromRally === 1 && force.knights.length === 1);

  const r2 = scene();
  exec(r2.game, { type: 'setRallyPoint', pos: r2.own[2].getPosition() });
  const gives = attackForceOf(r2, 100).filter((pos) => pos === r2.own[2].getPosition()).length;
  sentFrom = [];
  exec(r2.game, { type: 'startAttack', pos: r2.target.getPosition(), knights: 100 });
  const rest = sentFrom.slice(gives);
  check(`all knights to send: the first ${gives} of ${sentFrom.length} come from the rally point, ` +
    'then the others nearest first, and as many go as without one',
    gives > 0 && sentFrom.slice(0, gives).every((pos) => pos === r2.own[2].getPosition()) &&
    rest.length > 0 && rest[0] === r2.own[0].getPosition() && !rest.includes(r2.own[2].getPosition()) &&
    sentFrom.length === order.totalAttackingKnights &&
    order.totalAttackingKnights === previewAttack(s.p0, s.target.getPosition()).totalAttackingKnights + 1);

  /* The rally point wants its full garrison. */
  const r3 = scene();
  const rally = r3.own.find((b) => b.getType() === BuildingType.TypeFortress);
  exec(r3.game, { type: 'setRallyPoint', pos: rally.getPosition() });
  sliders(r3.game, false);
  let least = rally.getKnightCount();
  for (let i = 0; i < 6000; i++) {
    r3.game.update();
    least = Math.min(least, rally.getKnightCount());
  }
  check(`sliders at the lowest setting for 6000 updates: the rally point never has fewer than ${least} knights`,
    least === fullGarrison(BuildingType.TypeFortress));
  check('no integrity problems in the four games',
    integrity(s.game) + integrity(r.game) + integrity(r2.game) + integrity(r3.game) === 0);

  /* New knights from the castle. */
  const fill = (withRally: 'none' | 'b' | 'cut'): { c: CastleScene; firstFive: number[]; all: number[]; updates: number } => {
    const c = castleScene();
    if (withRally === 'b') exec(c.game, { type: 'setRallyPoint', pos: c.b.getPosition() });
    if (withRally === 'cut') exec(c.game, { type: 'setRallyPoint', pos: c.cut.getPosition() });
    sliders(c.game, true);
    granted = [];
    let updates = 0;
    while (updates < 20000 && (total(c.a) < 6 || total(c.b) < 6)) {
      c.game.update();
      updates++;
    }
    return { c, firstFive: granted.slice(0, 5), all: granted.slice(), updates };
  };

  const none = fill('none');
  const withB = fill('b');
  const namesOf = (f: { c: CastleScene }, list: number[]): string =>
    list.map((i) => (i === f.c.a.getIndex() ? 'A' : i === f.c.b.getIndex() ? 'B' : i === f.c.cut.getIndex() ? 'C' : '?')).join('');
  print(`     castle scene: towers A and B with a road want five knights each, ${knightsHome(castleScene().game)} knights wait in the castle`);
  print(`     knights sent out, without a rally point: ${namesOf(none, none.all)}; with B as the rally point: ${namesOf(withB, withB.all)}`);
  check('with tower B as the rally point the first five knights from the castle all go to B, then A gets its five',
    withB.firstFive.length === 5 && withB.firstFive.every((i) => i === withB.c.b.getIndex()) &&
    withB.all.length === 10 && withB.all.slice(5).every((i) => i === withB.c.a.getIndex()) &&
    total(withB.c.a) === 6 && total(withB.c.b) === 6);
  check('without a rally point tower A gets a knight among the first five (the rule changes the order)',
    none.firstFive.includes(none.c.a.getIndex()) && total(none.c.a) === 6 && total(none.c.b) === 6);

  const cut = fill('cut');
  check(`tower C without a road as the rally point (it has room for five, no knight can reach it): ` +
    `A and B are full after ${cut.updates} updates all the same, C got ${cut.all.filter((i) => i === cut.c.cut.getIndex()).length}`,
    total(cut.c.a) === 6 && total(cut.c.b) === 6 && !cut.all.includes(cut.c.cut.getIndex()) &&
    cut.c.p0.getRallyBuilding() === cut.c.cut);
  check('no integrity problems in the three castle games',
    integrity(none.c.game) + integrity(withB.c.game) + integrity(cut.c.game) === 0);

  /* A building without a knight still gets its first one. */
  {
    const c = castleScene();
    exec(c.game, { type: 'setRallyPoint', pos: c.b.getPosition() });
    /* Tower A loses its knight: as a new building it has none. */
    const first = c.game.getSerf(c.a.getFirstKnight());
    c.a.firstKnight = 0;
    c.a.stock[0].available = 0;
    c.game.getMap().setSerfIndex(first.pos, 0);
    c.game.deleteSerf(first);
    sliders(c.game, true);
    granted = [];
    for (let i = 0; i < 4000 && granted.length < 3; i++) c.game.update();
    check(`tower A has no knight at all: it gets one of the first knights although the rally point has room ` +
      `(${namesOf({ c }, granted)})`,
      granted.slice(0, 2).includes(c.a.getIndex()) && granted.filter((i) => i === c.a.getIndex()).length === 1);
  }

  /* Cleared when the building is lost. */
  const d1 = scene();
  exec(d1.game, { type: 'setRallyPoint', pos: d1.own[1].getPosition() });
  const was1 = d1.p0.extRally;
  exec(d1.game, { type: 'demolishBuilding', pos: d1.own[1].getPosition() });
  check('the player demolishes his rally point: cleared at once', was1 !== 0 && d1.p0.extRally === 0 &&
    d1.p0.getRallyBuilding() === null);
  run(d1.game, 3000);
  check('and it stays cleared when the building is gone and its number is free again',
    d1.p0.extRally === 0 && integrity(d1.game) === 0);

  const d2 = scene();
  exec(d2.game, { type: 'setRallyPoint', pos: d2.own[1].getPosition() });
  exec(d2.game, { type: 'setBuildingStance', pos: d2.own[0].getPosition(), stance: BuildingStance.Hold });
  /* Game.demolishBuilding_(): what burns a building when its land is
     lost or an enemy takes the building next to it. */
  d2.game.demolishBuilding_(d2.own[1].getPosition());
  d2.game.demolishBuilding_(d2.own[0].getPosition());
  check('the rally point and a building on Hold burn (land lost): no rally point, no stance on the ruin',
    d2.p0.extRally === 0 && d2.own[0].getStance() === BuildingStance.Normal && integrity(d2.game) === 0);

  const d3 = scene();
  exec(d3.game, { type: 'setRallyPoint', pos: d3.own[1].getPosition() });
  exec(d3.game, { type: 'setBuildingStance', pos: d3.own[0].getPosition(), stance: BuildingStance.Hold });
  /* Game.occupyEnemyBuilding(): the capture by a knight of player 1. */
  d3.game.occupyEnemyBuilding(d3.own[1], 1);
  const afterRally = d3.p0.extRally;
  d3.game.occupyEnemyBuilding(d3.own[0], 1);
  check('player 1 captures the rally point and a building on Hold: player 0 has no rally point, ' +
    'the captured building is on Normal and player 1 has no rally point either',
    afterRally === 0 && d3.own[1].getOwner() === 1 && d3.own[0].getOwner() === 1 &&
    d3.own[0].getStance() === BuildingStance.Normal && d3.p1.extRally === 0);

  const d4 = scene();
  exec(d4.game, { type: 'setRallyPoint', pos: d4.own[1].getPosition() });
  exec(d4.game, { type: 'setRallyPoint', pos: d4.own[2].getPosition() });
  const moved = d4.p0.getRallyBuilding() === d4.own[2];
  exec(d4.game, { type: 'clearRallyPoint' });
  check('a second setRallyPoint moves the rally point (one per player), clearRallyPoint clears it',
    moved && d4.p0.extRally === 0);
}

// ---------------------------------------------------------------------------
print('\n3. refused commands');
{
  const c = castleScene();
  const { game, p0 } = c;
  const map = game.getMap();
  const size = map.getCols() * map.getRows();
  const Hold = BuildingStance.Hold;
  const state = (): string => {
    const stances: number[] = [];
    for (const b of game.buildings) stances.push(b.extStance);
    return `${p0.extRally}/${stances.join('')}/${stateHash(game)}`;
  };
  const clean = state();
  const refusedAll = (what: string, cmds: Command[], who = 0): void => {
    for (const cmd of cmds) exec(game, cmd, who);
    check(what, state() === clean);
  };

  /* A woodcutter under construction and a guard hut under construction. */
  let sitePos = -1;
  let hutPos = -1;
  for (let i = 7; i < 295 && (sitePos < 0 || hutPos < 0); i++) {
    const pos = map.posAddSpirally(c.castle.getPosition(), i);
    if (sitePos < 0 && game.canBuildBuilding(pos, BuildingType.TypeLumberjack, p0)) {
      exec(game, { type: 'buildBuilding', pos, building: BuildingType.TypeLumberjack });
      if (game.getBuildingAtPos(pos) !== null) sitePos = pos;
    } else if (hutPos < 0 && game.canBuildBuilding(pos, BuildingType.TypeHut, p0)) {
      exec(game, { type: 'buildBuilding', pos, building: BuildingType.TypeHut });
      if (game.getBuildingAtPos(pos) !== null) hutPos = pos;
    }
  }
  let empty = -1;
  for (let pos = 0; pos < size && empty < 0; pos++) {
    if (game.getBuildingAtPos(pos) === null) empty = pos;
  }
  check('the scene has a woodcutter site, a guard hut site and an empty field', sitePos >= 0 && hutPos >= 0 && empty >= 0);
  const cleanNow = state();
  const refused = (what: string, cmds: Command[], who = 0): void => {
    for (const cmd of cmds) exec(game, cmd, who);
    check(what, state() === cleanNow);
  };
  void refusedAll;

  const a = c.a.getPosition();
  refused('setBuildingStance with a position that is no field does nothing', [
    { type: 'setBuildingStance', pos: -1, stance: Hold },
    { type: 'setBuildingStance', pos: size, stance: Hold },
    { type: 'setBuildingStance', pos: 1.5, stance: Hold },
    { type: 'setBuildingStance', pos: String(a) as unknown as number, stance: Hold },
    { type: 'setBuildingStance', stance: Hold },
  ]);
  refused('setBuildingStance with a stance that is none does nothing', [
    { type: 'setBuildingStance', pos: a, stance: 2 },
    { type: 'setBuildingStance', pos: a, stance: -1 },
    { type: 'setBuildingStance', pos: a, stance: 0.5 },
    { type: 'setBuildingStance', pos: a, stance: true as unknown as number },
    { type: 'setBuildingStance', pos: a },
  ]);
  refused('setBuildingStance on an empty field does nothing',
    [{ type: 'setBuildingStance', pos: empty, stance: Hold }]);
  check(`  (stanceRefusal says "${stanceRefusal(game, empty, p0, Hold)}")`, stanceRefusal(game, empty, p0, Hold) === 'notOwn');
  refused('setBuildingStance on the castle or a woodcutter does nothing', [
    { type: 'setBuildingStance', pos: c.castle.getPosition(), stance: Hold },
    { type: 'setBuildingStance', pos: sitePos, stance: Hold },
  ]);
  check(`  (stanceRefusal says "${stanceRefusal(game, c.castle.getPosition(), p0, Hold)}")`,
    stanceRefusal(game, c.castle.getPosition(), p0, Hold) === 'notMilitary' &&
    stanceRefusal(game, sitePos, p0, Hold) === 'notMilitary');
  refused('setBuildingStance on a guard hut that is not finished does nothing',
    [{ type: 'setBuildingStance', pos: hutPos, stance: Hold }]);
  check(`  (stanceRefusal says "${stanceRefusal(game, hutPos, p0, Hold)}")`, stanceRefusal(game, hutPos, p0, Hold) === 'notFinished');
  refused('setBuildingStance by a player who is not in the game does nothing', [
    { type: 'setBuildingStance', pos: a, stance: Hold },
  ], 3);
  refused('setBuildingStance by a player number that is none does nothing', [
    { type: 'setBuildingStance', pos: a, stance: Hold },
  ], -1);

  refused('setRallyPoint with a position that is no field does nothing', [
    { type: 'setRallyPoint', pos: -1 },
    { type: 'setRallyPoint', pos: size },
    { type: 'setRallyPoint', pos: 2.5 },
    { type: 'setRallyPoint', pos: null as unknown as number },
    { type: 'setRallyPoint' },
  ]);
  refused('setRallyPoint on an empty field, the castle, a woodcutter or an unfinished guard hut does nothing', [
    { type: 'setRallyPoint', pos: empty },
    { type: 'setRallyPoint', pos: c.castle.getPosition() },
    { type: 'setRallyPoint', pos: sitePos },
    { type: 'setRallyPoint', pos: hutPos },
  ]);
  check(`  (rallyRefusal says "${rallyRefusal(game, empty, p0)}", "${rallyRefusal(game, c.castle.getPosition(), p0)}", ` +
    `"${rallyRefusal(game, hutPos, p0)}")`,
    rallyRefusal(game, empty, p0) === 'notOwn' && rallyRefusal(game, c.castle.getPosition(), p0) === 'notMilitary' &&
    rallyRefusal(game, sitePos, p0) === 'notMilitary' && rallyRefusal(game, hutPos, p0) === 'notFinished');
  refused('clearRallyPoint without a rally point does nothing', [{ type: 'clearRallyPoint' }]);

  /* The two rules against each other. */
  exec(game, { type: 'setBuildingStance', pos: a, stance: Hold });
  exec(game, { type: 'setRallyPoint', pos: a });
  check(`setRallyPoint on a building on Hold does nothing (rallyRefusal says "${rallyRefusal(game, a, p0)}")`,
    c.a.isHolding() && p0.extRally === 0 && rallyRefusal(game, a, p0) === 'hold');
  const b = c.b.getPosition();
  exec(game, { type: 'setRallyPoint', pos: b });
  exec(game, { type: 'setBuildingStance', pos: b, stance: Hold });
  check(`setBuildingStance Hold on the rally point does nothing (stanceRefusal says "${stanceRefusal(game, b, p0, Hold)}")`,
    p0.getRallyBuilding() === c.b && !c.b.isHolding() && stanceRefusal(game, b, p0, Hold) === 'rally' &&
    stanceRefusal(game, b, p0, BuildingStance.Normal) === '');
  exec(game, { type: 'setBuildingStance', pos: a, stance: Hold });
  exec(game, { type: 'setBuildingStance', pos: a, stance: BuildingStance.Normal });
  exec(game, { type: 'setBuildingStance', pos: a, stance: BuildingStance.Normal });
  check('setBuildingStance is explicit: Hold twice is Hold, Normal twice is Normal', !c.a.isHolding());

  /* A burning building. */
  exec(game, { type: 'setBuildingStance', pos: a, stance: Hold });
  exec(game, { type: 'demolishBuilding', pos: a });
  const burning = c.a.isBurning() && !c.a.isHolding();
  exec(game, { type: 'setBuildingStance', pos: a, stance: Hold });
  exec(game, { type: 'setRallyPoint', pos: a });
  check('a burning building has no stance, and both commands on it do nothing',
    burning && !c.a.isHolding() && p0.getRallyBuilding() === c.b && stanceRefusal(game, a, p0, Hold) === 'notOwn' &&
    rallyRefusal(game, a, p0) === 'notOwn');

  /* The building of another player. */
  const s = scene();
  const snap = (): string => `${s.p0.extRally}/${s.p1.extRally}/${s.own.map((x) => x.extStance).join('')}/${s.target.extStance}`;
  const cleanScene = snap();
  exec(s.game, { type: 'setBuildingStance', pos: s.target.getPosition(), stance: Hold });
  exec(s.game, { type: 'setRallyPoint', pos: s.target.getPosition() });
  exec(s.game, { type: 'setBuildingStance', pos: s.own[0].getPosition(), stance: Hold }, 1);
  exec(s.game, { type: 'setRallyPoint', pos: s.own[0].getPosition() }, 1);
  check(`both commands on a building of the other player do nothing (the refusals say ` +
    `"${stanceRefusal(s.game, s.target.getPosition(), s.p0, Hold)}" and "${rallyRefusal(s.game, s.target.getPosition(), s.p0)}")`,
    snap() === cleanScene && stanceRefusal(s.game, s.target.getPosition(), s.p0, Hold) === 'notOwn' &&
    rallyRefusal(s.game, s.target.getPosition(), s.p0) === 'notOwn');
  exec(s.game, { type: 'setRallyPoint', pos: s.own[0].getPosition() });
  exec(s.game, { type: 'clearRallyPoint' }, 1);
  check('clearRallyPoint by the other player leaves the rally point of player 0',
    s.p0.getRallyBuilding() === s.own[0]);
  check('no integrity problems in the two games', integrity(game) + integrity(s.game) === 0);
}

// ---------------------------------------------------------------------------
print('\n4. the forecast against the duels of the game');
{
  const s = scene();
  const { game, p0, p1, target } = s;
  const flagPos = game.getMap().moveDownRight(target.getPosition());
  const onEnemyLand = game.getMap().getOwner(flagPos) === 1;
  const attacker = game.createSerf();
  attacker.setOwner(0);
  attacker.pos = flagPos;
  const defender = game.createSerf();
  defender.setOwner(1);
  defender.pos = flagPos;
  /* One duel of Serf.setFightOutcome(): whether the attacker wins. */
  const duel = (rank: number, defRank: number): boolean => {
    attacker.setType(SerfType.TypeKnight0 + rank);
    defender.setType(SerfType.TypeKnight0 + defRank);
    attacker.setFightOutcome(attacker, defender);
    return attacker.s.attacking.attackerWon === 1;
  };

  check('the flag of the target is on land of player 1: the attacker fights with the morale of his player, ' +
    'the defender with that of own land', onEnemyLand);

  /* Single duels. */
  const n = 4000;
  let worstGap = 0;
  let directionOk = true;
  let cases = 0;
  const lines: string[] = [];
  for (const morale of [1, 1500, 4096, 9000, 0xffff]) {
    p0.knightMorale = morale;
    for (const [rank, defRank] of [[0, 0], [0, 4], [4, 0], [2, 1], [1, 3], [3, 3]]) {
      let wins = 0;
      for (let i = 0; i < n; i++) if (duel(rank, defRank)) wins++;
      const draws = duelWinDraws(duelMorale(rank, morale), duelMorale(defRank, kOwnLandFactor));
      const expected = Math.floor((draws * 1000) / 65536);
      const seen = Math.floor((wins * 1000) / n);
      worstGap = Math.max(worstGap, Math.abs(expected - seen));
      if (expected >= 600 && wins * 2 <= n) directionOk = false;
      if (expected <= 400 && wins * 2 >= n) directionOk = false;
      cases++;
      if (morale === 4096 || (rank === 0 && defRank === 0)) {
        lines.push(`morale ${morale} rank ${rank} v ${defRank}: ${expected} forecast, ${seen} seen`);
      }
    }
  }
  print(`     wins of the attacker in 1000 duels: ${lines.slice(0, 8).join('; ')}`);
  check(`${cases} pairings of ranks and morale, ${n} duels each: forecast and duels differ by at most ` +
    `${worstGap} in 1000, and never in direction`, worstGap <= 30 && directionOk);

  /* Whole attacks: the attackers fight the defenders one after the other
     until one side is gone, every duel decided by the game. */
  const battle = (attackers: number[], defenders: number[]): boolean => {
    let i = 0;
    let j = 0;
    while (i < attackers.length && j < defenders.length) {
      if (duel(attackers[i], defenders[j])) j++; else i++;
    }
    return j === defenders.length;
  };
  const battles = 1500;
  const configs: { name: string; morale: number; a: number[]; d: number[] }[] = [
    { name: '6 new knights v 6 new knights, morale 100%', morale: 4096, a: [0, 0, 0, 0, 0, 0], d: [0, 0, 0, 0, 0, 0] },
    { name: '6 new v 3 new, morale 100%', morale: 4096, a: [0, 0, 0, 0, 0, 0], d: [0, 0, 0] },
    { name: '3 new v 6 new, morale 100%', morale: 4096, a: [0, 0, 0], d: [0, 0, 0, 0, 0, 0] },
    { name: '4 of rank 2 v 6 new, morale 100%', morale: 4096, a: [2, 2, 2, 2], d: [0, 0, 0, 0, 0, 0] },
    { name: '8 new v 2 of rank 4, morale 100%', morale: 4096, a: [0, 0, 0, 0, 0, 0, 0, 0], d: [4, 4] },
    { name: '6 new v 6 new, morale 37%', morale: 1500, a: [0, 0, 0, 0, 0, 0], d: [0, 0, 0, 0, 0, 0] },
    { name: '6 new v 6 new, morale 220%', morale: 9000, a: [0, 0, 0, 0, 0, 0], d: [0, 0, 0, 0, 0, 0] },
    { name: 'mixed 0 1 2 3 4 v mixed 4 2 0, morale 80%', morale: 3277, a: [0, 1, 2, 3, 4], d: [4, 2, 0] },
    { name: 'mixed 4 3 2 1 0 v mixed 0 2 4 (the same knights in another order), morale 80%', morale: 3277, a: [4, 3, 2, 1, 0], d: [0, 2, 4] },
    { name: '12 new v 12 of rank 1, morale 150%', morale: 6144, a: new Array(12).fill(0), d: new Array(12).fill(1) },
  ];
  let battleGap = 0;
  let battleDirection = true;
  for (const config of configs) {
    p0.knightMorale = config.morale;
    let wins = 0;
    for (let i = 0; i < battles; i++) if (battle(config.a, config.d)) wins++;
    const chance = attackWinChance(config.a, config.d, config.morale, kOwnLandFactor);
    const seen = Math.floor((wins * 1000) / battles);
    const verdict = attackVerdict(chance);
    const word = ['Likely loss', 'Even', 'Likely win'][verdict];
    battleGap = Math.max(battleGap, Math.abs(chance - seen));
    if (verdict === AttackVerdict.LikelyWin && wins * 2 <= battles) battleDirection = false;
    if (verdict === AttackVerdict.LikelyLoss && wins * 2 >= battles) battleDirection = false;
    if (verdict === AttackVerdict.Even && (seen < 350 || seen > 650)) battleDirection = false;
    print(`     ${config.name}: forecast ${chance} in 1000 (${word}), ${seen} in 1000 of ${battles} attacks won`);
  }
  check(`${configs.length} attacks, ${battles} times each: forecast and outcome differ by at most ${battleGap} in 1000, ` +
    'and the word agrees with the side that wins more often', battleGap <= 40 && battleDirection);

  /* The forecast of the window: defenders of unknown rank. */
  const f = forecastAttack([0, 0, 0, 0, 0, 0], 6, 4096);
  const best = attackWinChance([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], 4096, kOwnLandFactor);
  const worst = attackWinChance([0, 0, 0, 0, 0, 0], [4, 4, 4, 4, 4, 4], 4096, kOwnLandFactor);
  check(`six new knights on six defenders of unknown rank: ${f.chance} in 1000, between ${f.worst} (all of the highest rank) ` +
    `and ${f.best} (all of the lowest)`,
    f.best === best && f.worst === worst && f.worst <= f.chance && f.chance <= f.best &&
    f.verdict === attackVerdict(f.chance));
  check('no attackers is a certain loss, no defenders a certain win; the limits of the words are 400 and 600',
    attackWinChance([], [0], 4096, 4096) === 0 && attackWinChance([0], [], 4096, 4096) === 1000 &&
    attackVerdict(400) === AttackVerdict.LikelyLoss && attackVerdict(401) === AttackVerdict.Even &&
    attackVerdict(599) === AttackVerdict.Even && attackVerdict(600) === AttackVerdict.LikelyWin);

  /* The knights the window names are the knights that go. */
  const t = scene();
  let rank = 0;
  for (const b of t.own) {
    let index = b.getFirstKnight();
    while (index !== 0) {
      const serf = t.game.getSerf(index);
      serf.setType(SerfType.TypeKnight0 + (rank++ % 5));
      index = serf.getNext();
    }
  }
  exec(t.game, { type: 'setRallyPoint', pos: t.own[1].getPosition() });
  const hash = stateHash(t.game);
  const force = attackForce(t.game, t.p0, t.target.getPosition(), 4);
  const unchanged = stateHash(t.game) === hash;
  const went: number[] = [];
  const proto = Serf.prototype as unknown as { sendOffToFight(c: number, r: number): void };
  const inner = proto.sendOffToFight;
  proto.sendOffToFight = function (this: Serf, c2: number, r2: number): void {
    went.push(this.getType() - SerfType.TypeKnight0);
    inner.call(this, c2, r2);
  };
  exec(t.game, { type: 'startAttack', pos: t.target.getPosition(), knights: 4 });
  proto.sendOffToFight = inner;
  check(`the preview of an attack with four knights names the ranks ${force.knights.join(' ')} ` +
    `(${force.fromRally} from the rally point) and changes nothing; the knights that go have the ranks ${went.join(' ')}`,
    unchanged && force.knights.length === 4 && force.knights.join() === went.join() &&
    force.byRank.reduce((x, y) => x + y, 0) === 4 && force.fromRally >= 1);
  void p1;
}

// ---------------------------------------------------------------------------
print('\n5. a real attack with a rally point');
{
  const s = scene();
  const { game, p0, target } = s;
  exec(game, { type: 'setRallyPoint', pos: s.own[2].getPosition() });
  exec(game, { type: 'setBuildingStance', pos: s.own[0].getPosition(), stance: BuildingStance.Hold });
  sentFrom = [];
  exec(game, { type: 'startAttack', pos: target.getPosition(), knights: 100 });
  const went = sentFrom.length;
  const fighting = (): number => {
    let n = 0;
    for (const serf of game.serfs) {
      if (serf.getIndex() !== 0 && serf.getOwner() === 0 &&
          serf.getState() >= SerfState.StateKnightEngagingBuilding &&
          serf.getState() <= SerfState.StateKnightLeaveForWalkToFight) {
        n++;
      }
    }
    return n;
  };
  let updates = 0;
  let problems = 0;
  while (updates < 60000 && target.getOwner() === 1 && !target.isBurning() && (updates < 200 || fighting() > 0)) {
    game.update();
    updates++;
    if (updates % 2000 === 0) problems += integrity(game);
  }
  problems += integrity(game);
  const taken = target.getOwner() === 0;
  check(`${went} knights go against the tower with 6: after ${updates} updates the tower is ` +
    `${taken ? 'taken' : `held with ${target.getKnightCount()} knights left`}, ` +
    `the building on Hold still has ${s.own[0].getKnightCount()} knights, no integrity problems on the way`,
    went > 0 && updates < 60000 && problems === 0 && s.own[0].isHolding() &&
    s.own[0].getKnightCount() === fullGarrison(s.own[0].getType()) && p0.getRallyBuilding() === s.own[2]);
}

// ---------------------------------------------------------------------------
print('\n6. the save');
{
  const c = castleScene();
  const plain = store.write(c.game);
  check('a game without a stance or a rally point writes neither value',
    !/ext_stance|ext_rally/.test(plain));

  exec(c.game, { type: 'setBuildingStance', pos: c.a.getPosition(), stance: BuildingStance.Hold });
  exec(c.game, { type: 'setRallyPoint', pos: c.b.getPosition() });
  sliders(c.game, true);
  run(c.game, 300);
  const text = store.write(c.game);
  const mine = text.split('\n').filter((line) => /^\s*(ext_stance|ext_rally)\s*=/.test(line)).map((line) => line.trim());
  check(`with tower A on Hold and tower B as the rally point the file has ${mine.join(' and ')}`,
    mine.length === 2 && mine.includes(`ext_rally = ${c.b.getIndex()}`) && mine.includes('ext_stance = 1'));

  const a = load(text);
  const b = load(text);
  const loadedA = a.getBuildingAtPos(c.a.getPosition());
  check('the loaded game has the stance and the rally point, and writes the same text again',
    store.write(a) === text && loadedA.isHolding() && !a.getBuildingAtPos(c.b.getPosition()).isHolding() &&
    a.getPlayer(0).getRallyBuilding() === a.getBuildingAtPos(c.b.getPosition()) &&
    stateHash(a) === stateHash(b));
  let equal = true;
  let original = -1;
  for (let i = 1; i <= 4000; i++) {
    a.update();
    b.update();
    c.game.update();
    if (stateHash(a) !== stateHash(b)) { equal = false; break; }
    if (original < 0 && stateHash(a) !== stateHash(c.game)) original = i;
  }
  check('two games loaded from the file stay equal for 4000 updates while the knights move in',
    equal && total(loadedA) === 6);
  print(`     loaded against the game it was saved from: ${original < 0 ? 'equal for 4000 updates' : `differs after ${original} updates`} (reported, not required; see tools/save-test.ts)`);
  check('the text of the two after the 4000 updates is the same, and it still has both values',
    store.write(a) === store.write(b) && /ext_stance = 1/.test(store.write(a)) && /ext_rally = /.test(store.write(a)));

  /* The same file as an older build wrote it. */
  const old = load(text.split('\n').filter((line) => !/^\s*(ext_stance|ext_rally)\s*=/.test(line)).join('\n'));
  check('a file without the two values loads with every building on Normal and no rally point',
    old.getPlayer(0).extRally === 0 && [...old.buildings].every((x: any) => x.extStance === BuildingStance.Normal));
  check('no integrity problems in the saved and the loaded games',
    integrity(c.game) + integrity(a) + integrity(b) + integrity(old) === 0);
}

// ---------------------------------------------------------------------------
print('\n7. the integrity check');
{
  const c = castleScene();
  const clean = integrity(c.game);
  integrityProblems -= clean;
  /* By hand, past the commands: the castle on Hold, a burning tower as the
     rally point. */
  c.castle.extStance = BuildingStance.Hold;
  c.p0.extRally = c.castle.getIndex();
  warnings.length = 0;
  const found = IntegrityCheck.run(c.game as Game, false);
  const said = warnings.filter((w) => /stance|rally/.test(w)).length;
  const fixed = IntegrityCheck.run(c.game as Game, true);
  const after = IntegrityCheck.run(c.game as Game, false);
  check(`a castle on Hold that is also the rally point: ${found} problems found (${said} named), repaired, then ${after}`,
    clean === 0 && found === 2 && said === 2 && fixed === 2 && after === 0 &&
    c.castle.extStance === BuildingStance.Normal && c.p0.extRally === 0);
  c.a.extStance = BuildingStance.Hold;
  c.p0.extRally = c.a.getIndex();
  const both = IntegrityCheck.run(c.game as Game, false);
  c.p0.extRally = 9999;
  const gone = IntegrityCheck.run(c.game as Game, false);
  c.p0.extRally = 0;
  check(`a rally point on Hold is ${both} problem, a rally point that is no building ${gone}`, both === 1 && gone === 1);
}

// ---------------------------------------------------------------------------
print(`\n8. four computer players, ${longUpdates} updates, scripted stance and rally commands`);
{
  interface LongRun {
    hashes: number[];
    final: number;
    holds: number;
    rallies: number;
    cleared: number;
    lost: number;
    problems: number;
    buildings: number[];
    sent: number;
    heldGave: number;
    text: string;
  }
  const longRun = (script: boolean): LongRun => {
    const info = new GameInfo(new Random('8667715887436237'));
    info.removeAllPlayers();
    const faces = [9, 7, 5, 2];
    for (let i = 0; i < 4; i++) info.addPlayer(faces[i], { red: 0, green: 0, blue: 0 }, 40, 40, 40);
    info.setDefaultColors();
    info.setRules({ stockPreset: 0, peaceMinutes: 0, busyRoads: false, trading: false });
    const game = info.instantiate()! as any;
    game.setRandom(new Random('3183215728814883'));

    const out: LongRun = { hashes: [], final: 0, holds: 0, rallies: 0, cleared: 0, lost: 0, problems: 0,
                           buildings: [], sent: 0, heldGave: 0, text: '' };
    const military = (p: number): any[] => {
      const list: any[] = [];
      for (const b of game.buildings) {
        if (b.getIndex() === 0 || b.getOwner() !== p || !b.isDone() || b.isBurning()) continue;
        const type = b.getType();
        if (type === BuildingType.TypeHut || type === BuildingType.TypeTower || type === BuildingType.TypeFortress) list.push(b);
      }
      return list;
    };
    /* A knight that leaves a building on Hold for an attack would be a
       broken rule: count them. */
    const proto = Serf.prototype as unknown as { sendOffToFight(c: number, r: number): void };
    const inner = proto.sendOffToFight;
    proto.sendOffToFight = function (this: Serf, c: number, r: number): void {
      out.sent++;
      const from = game.getBuildingAtPos((this as any).pos);
      if (from !== null && from.isHolding()) out.heldGave++;
      inner.call(this, c, r);
    };

    const had = [0, 0, 0, 0];
    for (let u = 1; u <= longUpdates; u++) {
      game.update();
      if (script && u % 250 === 0) {
        const k = u / 250;
        for (let p = 0; p < 4; p++) {
          const player = game.getPlayer(p);
          if (had[p] !== 0 && player.extRally === 0) out.lost++;
          const list = military(p);
          if (list.length === 0) { had[p] = 0; continue; }
          const at = (k * 7 + p) % list.length;
          const pick = list[at];
          if (list.length === 1) {
            /* One building: on Hold and the rally point in turns. */
            if (k % 2 === 0) {
              exec(game, { type: 'clearRallyPoint' }, p);
              exec(game, { type: 'setBuildingStance', pos: pick.getPosition(), stance: 1 }, p);
              if (pick.isHolding()) out.holds++;
            } else {
              exec(game, { type: 'setBuildingStance', pos: pick.getPosition(), stance: 0 }, p);
              exec(game, { type: 'setRallyPoint', pos: pick.getPosition() }, p);
              if (player.getRallyBuilding() === pick) out.rallies++;
            }
          } else {
            /* The rally point moves to the next building (or is cleared),
               then the picked one goes on Hold (or back to Normal). */
            const rally = list[(at + 1) % list.length];
            if (k % 6 === 5) {
              exec(game, { type: 'clearRallyPoint' }, p);
              out.cleared++;
            } else {
              exec(game, { type: 'setBuildingStance', pos: rally.getPosition(), stance: 0 }, p);
              exec(game, { type: 'setRallyPoint', pos: rally.getPosition() }, p);
              if (player.getRallyBuilding() === rally) out.rallies++;
            }
            exec(game, { type: 'setBuildingStance', pos: pick.getPosition(), stance: k % 3 === 2 ? 0 : 1 }, p);
            if (pick.isHolding()) out.holds++;
          }
          /* And commands that must do nothing. */
          exec(game, { type: 'setBuildingStance', pos: pick.getPosition(), stance: 1 }, (p + 1) % 4);
          exec(game, { type: 'setRallyPoint', pos: pick.getPosition() }, (p + 2) % 4);
          had[p] = player.extRally;
        }
      }
      if (u % (longUpdates / 8) === 0) {
        out.hashes.push(stateHash(game));
        out.problems += integrity(game);
      }
    }
    proto.sendOffToFight = inner;
    out.final = stateHash(game);
    for (let p = 0; p < 4; p++) {
      let n = 0;
      for (const b of game.buildings) if (b.getIndex() !== 0 && b.getOwner() === p) n++;
      out.buildings.push(n);
    }
    out.text = store.write(game);
    return out;
  };

  const a = longRun(true);
  const b = longRun(true);
  print(`     ${a.holds} times a building went on Hold, ${a.rallies} rally points set, ${a.cleared} cleared by command, ` +
    `${a.lost} lost with their building; buildings at the end ${a.buildings.join(' ')}; ` +
    `${a.sent} knights sent to attacks by the computer players`);
  check('the commands took effect during the run', a.holds > 20 && a.rallies > 20);
  check(`no knight left a building on Hold for an attack (${a.heldGave} of ${a.sent})`, a.heldGave === 0);
  check(`the integrity check finds nothing at eight points of the run (${a.problems})`, a.problems === 0);
  check('the computer players go on building (every one has more than its castle)', a.buildings.every((n) => n > 3));
  check(`the same run twice: the same state hash at eight points and at the end (${a.final.toString(16)})`,
    a.final === b.final && a.hashes.join() === b.hashes.join() && a.text === b.text);
  const loaded = load(a.text);
  const same = store.write(loaded) === a.text;
  const inText = (a.text.match(/ext_stance = 1/g) ?? []).length + '/' + (a.text.match(/ext_rally = /g) ?? []).length;
  check(`the save of the end of the run loads to the same text; stances/rally points in it: ${inText}`,
    same && /ext_stance = 1/.test(a.text) && /ext_rally = /.test(a.text) && integrity(loaded) === 0);

  const plain = longRun(false);
  print(`     the same game without the script: hash ${plain.final.toString(16)}, buildings ${plain.buildings.join(' ')}, ` +
    `${plain.sent} knights sent`);
  check('without the script the game writes no stance and no rally point', !/ext_stance|ext_rally/.test(plain.text));
}

print(`\nintegrity check: ${integrityProblems} problems in ${integrityRuns} runs`);
check('zero integrity problems in all games of this tool', integrityProblems === 0);
print(failed === 0 ? `\nPASSED: ${checks} checks` : `\n${failed} of ${checks} checks FAILED`);
process.exit(failed === 0 ? 0 : 1);
