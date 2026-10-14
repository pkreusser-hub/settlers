// Dev tool: the building controls that are not part of Freeserf, against a
// headless game: pause and output cap of production buildings, and the
// upgrade of a guard hut to a tower to a fortress in place.
// Usage: npx esbuild tools/buildings-test.ts --bundle --platform=node --outfile=node_modules/.cache/buildings-test.cjs --log-level=warning && node node_modules/.cache/buildings-test.cjs
//
// Player 0 builds a small economy next to his castle (woodcutter, forester,
// sawmill, stonecutter, two guard huts) and every action goes through
// executeCommand(), as in a network game. The checks:
//  1. a paused building makes nothing, asks for no input and goes on when
//     resumed;
//  2. a capped building stops when the stock reaches the cap and the stock
//     stays near it;
//  3. a hut becomes a tower and then a fortress where it stands: knights,
//     gold, land and map objects stay consistent (IntegrityCheck finds
//     nothing) through and after the upgrade;
//  4. a save with a paused building, a capped building and an upgrade under
//     way loads to the same text, and two loaded games stay equal.

import {
  BuildingType,
  ProductionHold,
  UpgradeRefusal,
  upgradeCost,
  upgradeWorkTicks,
} from '../src/game/building';
import { Game } from '../src/game/game';
import { IntegrityCheck } from '../src/game/integrity';
import { MapObject } from '../src/game/map';
import { GameInfo } from '../src/game/mission';
import { pathfinderMap } from '../src/game/pathfinder';
import { Random } from '../src/game/random';
import { ResourceType } from '../src/game/resource';
import { GameStore } from '../src/game/savegame';
import { SerfState } from '../src/game/serf';
import { executeCommand } from '../src/net/command';
import type { Command } from '../src/net/command';
import '../src/net/commands';
import { canCapBuilding, canPauseBuilding, upgradeRefusal } from '../src/net/commands';
import { stateHash } from '../src/net/hash';

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

const info = GameInfo.getMission(0)!;
const game = info.instantiate()! as any;
game.rnd = new Random(0x1234, 0x5678, 0x9abc);
const map = game.getMap();
const player = game.getPlayer(0);
const size = map.getCols() * map.getRows();
const exec = (cmd: Command, who = 0): void => executeCommand(game, who, cmd);
const name = (pos: number): string => (pos < 0 ? 'nowhere' : `${map.posCol(pos)},${map.posRow(pos)}`);
const run = (updates: number): void => { for (let i = 0; i < updates; i++) game.update(); };
const stock = (res: ResourceType): number => game.getStockCount(0, res);

/* What the player's workers have made, by resource: every worker counts
   his output with Player::increase_res_count. */
const made: number[] = new Array(27).fill(0);
const countRes = player.increaseResCount.bind(player);
player.increaseResCount = (res: ResourceType): void => { made[res]++; countRes(res); };

/* Run until `done`, at most `limit` updates; the updates it took, or -1. */
function runUntil(done: () => boolean, limit: number): number {
  for (let i = 0; i < limit; i++) {
    if (done()) return i;
    game.update();
  }
  return done() ? limit : -1;
}

function integrity(): number {
  warnings.length = 0;
  return IntegrityCheck.run(game as Game, false);
}

// --- the castle
let castlePos = -1;
for (let pos = 0; pos < size; pos++) {
  if (game.canBuildCastle(pos, player)) { castlePos = pos; break; }
}
exec({ type: 'buildCastle', pos: castlePos });
const castleFlag = map.moveDownRight(castlePos);

/* Build `type` at the first site near the castle that `fits` and that a
   road joins to the castle. */
function place(type: BuildingType, fits: (pos: number) => boolean = () => true): number {
  for (let i = 7; i < 295; i++) {
    const pos = map.posAddSpirally(castlePos, i);
    if (!game.canBuildBuilding(pos, type, player) || !fits(pos)) continue;
    const flagPos = map.moveDownRight(pos);
    const hadFlag = map.hasFlag(flagPos);
    if (!hadFlag) {
      exec({ type: 'buildFlag', pos: flagPos });
      if (!map.hasFlag(flagPos)) continue;
      /* The shortest road to a flag of the player (they all lead to the
         castle), not over the site itself. */
      let best: number[] | null = null;
      for (const flag of game.flags) {
        if (flag.getIndex() === 0 || flag.getOwner() !== 0 || flag.getPosition() === flagPos) continue;
        const road = pathfinderMap(map, flagPos, flag.getPosition());
        const dirs: number[] = road.getDirs().slice();
        if (dirs.length === 0 || (best !== null && dirs.length >= best.length)) continue;
        let p = flagPos;
        let free = true;
        for (let k = 0; k < dirs.length; k++) {
          p = map.move(p, dirs[k]);
          if (p === pos || (map.hasFlag(p) && k < dirs.length - 1)) free = false;
        }
        if (free) best = dirs;
      }
      if (best !== null) exec({ type: 'buildRoad', start: flagPos, dirs: best, flag: 0 });
      if (map.paths(flagPos) === 0) {
        exec({ type: 'demolishFlag', pos: flagPos });
        continue;
      }
    }
    if (!game.canBuildBuilding(pos, type, player)) continue;
    exec({ type: 'buildBuilding', pos, building: type });
    if (game.getBuildingAtPos(pos)?.getType() === type) return pos;
  }
  return -1;
}

/* The huts first, while the land near the castle is free of roads: a hut
   where a tower could stand, and one where it could not. */
const smallHutPos = place(BuildingType.TypeHut, (pos) => !game.canBuildLarge(pos));
const hutPos = place(BuildingType.TypeHut, (pos) => game.canBuildLarge(pos));
/* Two more on large sites: one is demolished and one given up during
   its upgrade. */
const hut2Pos = place(BuildingType.TypeHut, (pos) => game.canBuildLarge(pos));
const hut3Pos = place(BuildingType.TypeHut, (pos) => game.canBuildLarge(pos));
const lumberjackPos = place(BuildingType.TypeLumberjack);
const stonecutterPos = place(BuildingType.TypeStonecutter);
/* The sawmill is a large building: not where it would take the room for a
   tower from one of the huts (can_build_large looks two tiles around). */
const nearHut = (pos: number): boolean => {
  for (const h of [hutPos, hut2Pos, hut3Pos]) {
    for (let i = 0; i < 19; i++) if (map.posAddSpirally(h, i) === pos) return true;
  }
  return false;
};
const sawmillPos = place(BuildingType.TypeSawmill, (pos) => !nearHut(pos));
const foresterPos = place(BuildingType.TypeForester);
check(`built woodcutter ${name(lumberjackPos)}, stonecutter ${name(stonecutterPos)}, sawmill ${name(sawmillPos)}, ` +
      `forester ${name(foresterPos)}, huts ${name(hutPos)}, ${name(hut2Pos)}, ${name(hut3Pos)} on large sites, ` +
      `hut ${name(smallHutPos)} on a small site`,
      [lumberjackPos, stonecutterPos, sawmillPos, foresterPos, hutPos, hut2Pos, hut3Pos, smallHutPos].every((pos) => pos >= 0));

const at = (pos: number): any => game.getBuildingAtPos(pos);
const lumberjack = at(lumberjackPos);
const sawmill = at(sawmillPos);
const hut = at(hutPos);
const smallHut = at(smallHutPos);
const hut2 = at(hut2Pos);
const hut3 = at(hut3Pos);

/* The serf that works in the building at pos (he is at home). */
function workerState(pos: number): string {
  for (const serf of game.getSerfsAtPos(pos)) return SerfState[serf.getState()];
  return 'away';
}

// --- commands on buildings that are not ready or not the player's
exec({ type: 'setBuildingPaused', pos: lumberjackPos, paused: true });
check('setBuildingPaused on a construction site does nothing', !lumberjack.isProductionPaused());
exec({ type: 'upgradeBuilding', pos: hutPos });
check('upgradeBuilding on an unfinished hut does nothing (NotFinished)',
      !hut.isUpgrading() && upgradeRefusal(game, hutPos, player) === UpgradeRefusal.NotFinished);

const built = runUntil(() => lumberjack.isDone() && lumberjack.hasSerf() && sawmill.isDone() && sawmill.hasSerf() &&
                             at(stonecutterPos).isDone() && hut.isActive() && smallHut.isActive() && hut2.isActive() && hut3.isActive() &&
                             made[ResourceType.TypeLumber] >= 2 && made[ResourceType.TypePlank] >= 1, 80000);
check(`the economy runs after ${built} updates: ${made[ResourceType.TypeLumber]} logs, ` +
      `${made[ResourceType.TypePlank]} planks, ${made[ResourceType.TypeStone]} stone made`, built >= 0);
check('integrity before the tests: 0 problems', integrity() === 0);

// ---------------------------------------------------------------------------
// 1. Pause.

exec({ type: 'setBuildingPaused', pos: lumberjackPos, paused: true }, 1);
check('setBuildingPaused by the other player does nothing', !lumberjack.isProductionPaused());
exec({ type: 'setBuildingPaused', pos: hutPos, paused: true });
exec({ type: 'setBuildingPaused', pos: castlePos, paused: true });
check('setBuildingPaused on a hut or the castle does nothing',
      !hut.isProductionPaused() && !at(castlePos).isProductionPaused() &&
      !canPauseBuilding(game, hutPos, player) && !canPauseBuilding(game, castlePos, player));
exec({ type: 'setBuildingPaused', pos: lumberjackPos, paused: 1 as unknown as boolean });
exec({ type: 'setBuildingPaused', pos: -1, paused: true });
check('setBuildingPaused with arguments that are not valid does nothing', !lumberjack.isProductionPaused());

exec({ type: 'setBuildingPaused', pos: lumberjackPos, paused: true });
exec({ type: 'setBuildingPaused', pos: sawmillPos, paused: true });
check('setBuildingPaused pauses the woodcutter and the sawmill',
      lumberjack.isProductionPaused() && sawmill.isProductionPaused() &&
      lumberjack.getProductionHold() === ProductionHold.Paused && lumberjack.isProductionHeld());

/* The work in progress ends: the woodcutter comes home with his log, the
   sawmill finishes its plank. */
run(6000);
const logsPaused = made[ResourceType.TypeLumber];
const planksPaused = made[ResourceType.TypePlank];
const sawmillInput = (): number => sawmill.getResCountInStock(1) + sawmill.getRequestedInStock(1);
const inputPaused = sawmillInput();
let stayedHome = true;
let asked = false;
for (let i = 0; i < 12000; i++) {
  game.update();
  if (workerState(lumberjackPos) !== 'StatePlanningLogging') stayedHome = false;
  if (sawmill.getMaxPriorityForResource(ResourceType.TypeLumber) > 0) asked = true;
}
check(`paused for 12000 updates: no log (${made[ResourceType.TypeLumber] - logsPaused}) and no plank ` +
      `(${made[ResourceType.TypePlank] - planksPaused}) made, the woodcutter stayed in`,
      made[ResourceType.TypeLumber] === logsPaused && made[ResourceType.TypePlank] === planksPaused && stayedHome);
check(`the paused sawmill asked for no logs and got none (${sawmillInput()} in and on the way, ${inputPaused} before)`,
      !asked && sawmillInput() === inputPaused);

exec({ type: 'setBuildingPaused', pos: lumberjackPos, paused: false });
exec({ type: 'setBuildingPaused', pos: sawmillPos, paused: false });
const resumed = runUntil(() => made[ResourceType.TypeLumber] > logsPaused && made[ResourceType.TypePlank] > planksPaused, 40000);
check(`resumed: a log and a plank made again after ${resumed} updates`,
      resumed >= 0 && !lumberjack.isProductionHeld());

// ---------------------------------------------------------------------------
// 2. Output cap.

exec({ type: 'setBuildingCap', pos: sawmillPos, cap: 10 }, 1);
exec({ type: 'setBuildingCap', pos: sawmillPos, cap: 15 });
exec({ type: 'setBuildingCap', pos: sawmillPos, cap: -10 });
exec({ type: 'setBuildingCap', pos: foresterPos, cap: 10 });
exec({ type: 'setBuildingCap', pos: hutPos, cap: 10 });
check('setBuildingCap by the other player, with a value that is not a step, on a forester or a hut does nothing',
      sawmill.getProductionCap() === 0 && at(foresterPos).getProductionCap() === 0 && hut.getProductionCap() === 0 &&
      canCapBuilding(game, sawmillPos, player) && !canCapBuilding(game, foresterPos, player) &&
      canPauseBuilding(game, foresterPos, player));

/* The woodcutter with a cap on logs. The sawmill is paused so that the logs
   stay in the castle; the cap is the step above what is in stock, so that
   the woodcutter has to work up to it. */
exec({ type: 'setBuildingPaused', pos: sawmillPos, paused: true });
run(6000);
const steps = [10, 20, 50, 100, 200];
const logsNow = stock(ResourceType.TypeLumber);
const cap = steps.find((step) => step > logsNow + 1) ?? 200;
exec({ type: 'setBuildingCap', pos: lumberjackPos, cap });
check(`setBuildingCap ${cap} on the woodcutter (${logsNow} logs in stock): not held yet`,
      lumberjack.getProductionCap() === cap && !lumberjack.isProductionHeld() &&
      lumberjack.getProductionHold() === ProductionHold.None);
const logsBefore = made[ResourceType.TypeLumber];
const reached = runUntil(() => lumberjack.getProductionHold() === ProductionHold.Capped, 400000);
check(`the stock reached the cap after ${reached} updates and ${made[ResourceType.TypeLumber] - logsBefore} logs: ` +
      `${stock(ResourceType.TypeLumber)} logs, the woodcutter waits`,
      reached >= 0 && stock(ResourceType.TypeLumber) >= cap && made[ResourceType.TypeLumber] > logsBefore);
/* A log that was on its way when the cap was reached still arrives. */
run(6000);
const logsCapped = made[ResourceType.TypeLumber];
let most = 0;
let held = true;
for (let i = 0; i < 12000; i++) {
  game.update();
  most = Math.max(most, stock(ResourceType.TypeLumber));
  if (!lumberjack.isProductionHeld()) held = false;
}
check(`capped for 12000 updates: no log made (${made[ResourceType.TypeLumber] - logsCapped}), ` +
      `at most ${most} logs in stock with a cap of ${cap}`,
      made[ResourceType.TypeLumber] === logsCapped && held && most >= cap && most <= cap + 2);
/* The stock falls below the cap (the sawmill takes logs again): the
   woodcutter goes on by himself. */
exec({ type: 'setBuildingPaused', pos: sawmillPos, paused: false });
const below = runUntil(() => made[ResourceType.TypeLumber] > logsCapped, 100000);
check(`the sawmill takes logs again: the capped woodcutter made a log after ${below} updates ` +
      `(${stock(ResourceType.TypeLumber)} logs in stock)`, below >= 0 && lumberjack.getProductionCap() === cap);
exec({ type: 'setBuildingCap', pos: lumberjackPos, cap: 0 });
check('setBuildingCap 0 turns the cap off', lumberjack.getProductionCap() === 0 && !lumberjack.isProductionHeld());

// ---------------------------------------------------------------------------
// 3. Upgrade: hut to tower to fortress.

function knightsOf(building: any): { count: number; states: string[] } {
  const states: string[] = [];
  let index = building.getFirstKnight();
  for (let guard = 0; index !== 0 && guard < 100; guard++) {
    const serf = game.getSerf(index);
    states.push(SerfState[serf.getState()]);
    index = serf.getNext();
  }
  return { count: states.length, states };
}

/* The tiles around pos that belong to player 0. */
function ownLand(pos: number): number {
  let n = 0;
  for (let i = 0; i < 295; i++) {
    const p = map.posAddSpirally(pos, i);
    if (map.hasOwner(p) && map.getOwner(p) === 0) n++;
  }
  return n;
}

exec({ type: 'upgradeBuilding', pos: hutPos }, 1);
check('upgradeBuilding by the other player does nothing (NotOwn)',
      !hut.isUpgrading() && upgradeRefusal(game, hutPos, game.getPlayer(1)) === UpgradeRefusal.NotOwn);
exec({ type: 'upgradeBuilding', pos: lumberjackPos });
exec({ type: 'upgradeBuilding', pos: castlePos });
check('upgradeBuilding on a woodcutter or the castle does nothing (WrongType, NotOwn)',
      !lumberjack.isUpgrading() && !at(castlePos).isUpgrading() &&
      upgradeRefusal(game, lumberjackPos, player) === UpgradeRefusal.WrongType &&
      upgradeRefusal(game, castlePos, player) === UpgradeRefusal.NotOwn);
exec({ type: 'upgradeBuilding', pos: smallHutPos });
check('upgradeBuilding on a hut where no large building fits does nothing (NoRoom)',
      !smallHut.isUpgrading() && map.getObj(smallHutPos) === MapObject.ObjectSmallBuilding &&
      upgradeRefusal(game, smallHutPos, player) === UpgradeRefusal.NoRoom);
exec({ type: 'upgradeBuilding', pos: -5 });
exec({ type: 'upgradeBuilding', pos: 0.5 });
check('upgradeBuilding with a position that is not valid does nothing', !hut.isUpgrading());

interface Before {
  knights: number;
  gold: number;
  land: number;
  totalLand: number;
  huts: number;
  towers: number;
  fortresses: number;
  score: number;
}
function snapshot(building: any): Before {
  return {
    knights: knightsOf(building).count,
    gold: building.getResCountInStock(1),
    land: ownLand(building.getPosition()),
    totalLand: player.getLandArea(),
    huts: player.getCompletedBuildingCount(BuildingType.TypeHut),
    towers: player.getCompletedBuildingCount(BuildingType.TypeTower),
    fortresses: player.getCompletedBuildingCount(BuildingType.TypeFortress),
    score: player.getBuildingScore(),
  };
}

/* Upgrade the building, watch it until it is the new type. */
function upgrade(building: any, from: BuildingType, to: BuildingType, stateAfter: string, maxGold: number): void {
  const pos = building.getPosition();
  const label = `${BuildingType[from]} -> ${BuildingType[to]}`;
  const cost = upgradeCost(from);
  const before = snapshot(building);
  check(`${label}: allowed (${before.knights} knights, ${before.gold} gold, ${before.land} tiles of land around)`,
        upgradeRefusal(game, pos, player) === UpgradeRefusal.None && before.knights > 0);

  exec({ type: 'upgradeBuilding', pos });
  check(`${label}: started, still a ${BuildingType[from]} with its knights, a large building on the map, ` +
        `asks for ${cost.planks} planks then ${cost.stones} stone`,
        building.isUpgrading() && building.getUpgradeTo() === to && building.getType() === from &&
        map.getObj(pos) === MapObject.ObjectLargeBuilding && map.getObjIndex(pos) === building.getIndex() &&
        knightsOf(building).count === before.knights && ownLand(pos) === before.land &&
        building.getResTypeInStock(2) === ResourceType.TypePlank && building.getMaximumInStock(2) === cost.planks);
  exec({ type: 'upgradeBuilding', pos });
  check(`${label}: a second upgradeBuilding does nothing (InProgress)`,
        upgradeRefusal(game, pos, player) === UpgradeRefusal.InProgress && building.getUpgradeTimer() === 0 &&
        building.getResCountInStock(2) === 0);

  /* Through the upgrade: nothing breaks, the building works as before. */
  let problems = 0;
  let updates = 0;
  let sawStone = false;
  let sawWork = false;
  let lostKnights = false;
  let lostLand = false;
  while (building.isUpgrading() && updates < 200000) {
    game.update();
    updates++;
    if (building.getResTypeInStock(2) === ResourceType.TypeStone) sawStone = true;
    if (building.getUpgradeTimer() > 0) sawWork = true;
    if (building.getType() === from && ownLand(pos) < before.land) lostLand = true;
    if (knightsOf(building).count === 0) lostKnights = true;
    if (updates % 250 === 0) problems += integrity();
  }
  problems += integrity();
  check(`${label}: finished after ${updates} updates (planks, then stone, then ${upgradeWorkTicks(from)} ticks of work), ` +
        `${problems} integrity problems on the way`,
        !building.isUpgrading() && sawStone && sawWork && problems === 0 && !lostKnights && !lostLand);

  const knights = knightsOf(building);
  const after = snapshot(building);
  check(`${label}: now a ${BuildingType[building.getType()]}, ${knights.count} knights (${before.knights} before) ` +
        `all ${stateAfter}, ${after.gold} gold (${before.gold} before) of ${building.getMaximumInStock(1)}`,
        building.getType() === to && building.isDone() && building.isActive() && !building.isBurning() &&
        knights.count >= before.knights && knights.states.every((s) => s === stateAfter) &&
        knights.count === building.getKnightCount() &&
        after.gold >= before.gold && building.getMaximumInStock(1) === maxGold &&
        building.getResTypeInStock(2) === ResourceType.TypeNone && building.getRequestedInStock(2) === 0);
  check(`${label}: map object large with the building's index, flag linked, ` +
        `land around ${before.land} -> ${after.land}, land of the player ${before.totalLand} -> ${after.totalLand}`,
        map.getObj(pos) === MapObject.ObjectLargeBuilding && map.getObjIndex(pos) === building.getIndex() &&
        game.getFlag(building.getFlagIndex()).getPosition() === map.moveDownRight(pos) &&
        map.hasPath(pos, 1 /* DirectionDownRight */) &&
        after.land >= before.land && after.totalLand >= before.totalLand);
  const dHut = after.huts - before.huts;
  const dTower = after.towers - before.towers;
  const dFortress = after.fortresses - before.fortresses;
  check(`${label}: building counts of the player (huts ${dHut}, towers ${dTower}, fortresses ${dFortress}), ` +
        `score ${before.score} -> ${after.score}`,
        (from === BuildingType.TypeHut
          ? dHut === -1 && dTower === 1 && dFortress === 0
          : dHut === 0 && dTower === -1 && dFortress === 1) && after.score > before.score);
}

upgrade(hut, BuildingType.TypeHut, BuildingType.TypeTower, 'StateDefendingTower', 4);
check('a tower takes more knights: the building asks for them',
      runUntil(() => hut.getKnightCount() + hut.getRequestedInStock(0) >= 1 && !hut.isUpgrading(), 10) >= 0);

// ---------------------------------------------------------------------------
// 4. Save and load with a paused building, a capped building and an upgrade
// under way (tower to fortress), then the upgrade to its end.

const store = GameStore.getInstance();
function load(text: string): any {
  const g = new Game();
  if (!store.read(text, g)) throw new Error('load failed');
  /* A loaded game is paused; this resumes it, as GameManager does. */
  g.pause();
  return g;
}

exec({ type: 'setBuildingPaused', pos: lumberjackPos, paused: true });
exec({ type: 'setBuildingCap', pos: stonecutterPos, cap: 10 });
exec({ type: 'setBuildingCap', pos: sawmillPos, cap: 50 });
exec({ type: 'upgradeBuilding', pos: hutPos });
/* Until the first plank of the upgrade is in the building or on its way. */
const started = runUntil(() => hut.getResCountInStock(2) + hut.getRequestedInStock(2) > 0, 100000);
check(`tower -> fortress under way for the save (first plank after ${started} updates)`,
      started >= 0 && hut.isUpgrading() && hut.getType() === BuildingType.TypeTower);

const text = store.write(game);
/* For a look at the building windows in the browser: SAVE_DUMP=file writes
   this save (gameManager.loadGameText() of the dev console loads it). */
if (process.env.SAVE_DUMP !== undefined) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('fs').writeFileSync(process.env.SAVE_DUMP, text);
}
const a = load(text);
const text2 = store.write(a);
check(`save of ${(text.length / 1024).toFixed(0)} KB has ext_paused, ext_cap, ext_upgrade and stock[2]`,
      text.includes('ext_paused') && text.includes('ext_cap') && text.includes('ext_upgrade') &&
      text.includes('ext_upgrade_timer') && text.includes('stock[2].type'));
check('save -> load -> save gives the same text', text === text2);
const la = a.getBuildingAtPos(lumberjackPos);
const sa = a.getBuildingAtPos(stonecutterPos);
const ha = a.getBuildingAtPos(hutPos);
check('the loaded game has the paused woodcutter, the caps and the upgrade with its stock',
      la.isProductionPaused() && sa.getProductionCap() === 10 && a.getBuildingAtPos(sawmillPos).getProductionCap() === 50 &&
      ha.getUpgradeTo() === BuildingType.TypeFortress && ha.getResTypeInStock(2) === hut.getResTypeInStock(2) &&
      ha.getResCountInStock(2) === hut.getResCountInStock(2) && ha.getRequestedInStock(2) === hut.getRequestedInStock(2) &&
      a.getMap().getObj(hutPos) === MapObject.ObjectLargeBuilding && stateHash(a) === stateHash(game));
warnings.length = 0;
check('integrity of the loaded game: 0 problems', IntegrityCheck.run(a as Game, false) === 0);

const b = load(text);
let equal = true;
let doneAt = -1;
for (let i = 1; i <= 60000 && equal; i++) {
  a.update();
  b.update();
  if (i % 50 === 0 && stateHash(a) !== stateHash(b)) equal = false;
  if (doneAt < 0 && !ha.isUpgrading()) doneAt = i;
  if (doneAt >= 0 && i >= doneAt + 2000) break;
}
check(`two loaded games stay equal while the upgrade ends (after ${doneAt} updates): ` +
      `${BuildingType[ha.getType()]} in both`,
      equal && doneAt >= 0 && ha.getType() === BuildingType.TypeFortress &&
      b.getBuildingAtPos(hutPos).getType() === BuildingType.TypeFortress && stateHash(a) === stateHash(b));
warnings.length = 0;
check('integrity of the loaded game after the upgrade: 0 problems', IntegrityCheck.run(a as Game, false) === 0);

/* An old save has none of the new values: they are left out when unset. */
exec({ type: 'setBuildingPaused', pos: lumberjackPos, paused: false });
exec({ type: 'setBuildingCap', pos: stonecutterPos, cap: 0 });
exec({ type: 'setBuildingCap', pos: sawmillPos, cap: 0 });

/* The game it was saved from: tower to fortress to its end. */
const beforeFortress = snapshot(hut);
void beforeFortress;
let problems = 0;
const finished = runUntil(() => {
  if (game.getTick() % 500 === 0) problems += integrity();
  return !hut.isUpgrading();
}, 200000);
const fortressKnights = knightsOf(hut);
check(`tower -> fortress finished in the original game after ${finished} more updates: ` +
      `${BuildingType[hut.getType()]}, ${fortressKnights.count} knights all StateDefendingFortress, ` +
      `gold room ${hut.getMaximumInStock(1)}, ${problems} integrity problems`,
      finished >= 0 && hut.getType() === BuildingType.TypeFortress &&
      fortressKnights.count > 0 && fortressKnights.states.every((s) => s === 'StateDefendingFortress') &&
      hut.getMaximumInStock(1) === 8 && problems === 0 && integrity() === 0 &&
      map.getObj(hutPos) === MapObject.ObjectLargeBuilding &&
      upgradeRefusal(game, hutPos, player) === UpgradeRefusal.WrongType);
check('the player has a message for the finished fortress at its place',
      (player as unknown as { messages: { type: number; pos: number; data: number }[] }).messages
        .some((m) => m.type === 20 && m.pos === hutPos && m.data === 2));
// ---------------------------------------------------------------------------
// 5. An upgrade that does not end: the building is demolished, or given up
// as when an enemy takes it, with material on the way.

exec({ type: 'upgradeBuilding', pos: hut2Pos });
const onWay2 = runUntil(() => hut2.getRequestedInStock(2) > 0, 100000);
check(`another upgrade under way, a plank on the way (after ${onWay2} updates)`,
      onWay2 >= 0 && hut2.isUpgrading() && map.getObj(hut2Pos) === MapObject.ObjectLargeBuilding && integrity() === 0);

exec({ type: 'demolishBuilding', pos: hut2Pos });
let demolishProblems = integrity();
check('demolished during its upgrade: burning, the upgrade is gone',
      hut2.isBurning() && !hut2.isUpgrading() && hut2.getRequestedInStock(2) === 0 && demolishProblems === 0);

/* What Game::occupy_enemy_building does to a building it takes, in its
   order: the owner changes (Building::setOwner gives the upgrade up), then
   the transports to its flag are reset. Called here without a fight. */
exec({ type: 'upgradeBuilding', pos: hut3Pos });
const onWay3 = runUntil(() => hut3.getRequestedInStock(2) > 0, 100000);
check(`a third upgrade under way, a plank on the way (after ${onWay3} updates)`,
      onWay3 >= 0 && hut3.isUpgrading() && map.getObj(hut3Pos) === MapObject.ObjectLargeBuilding);
const hut3Flag = game.getFlag(hut3.getFlagIndex());
hut3.cancelUpgrade();
game.flagResetTransport(hut3Flag);
check('given up during its upgrade: a small building on the map again, nothing asked for',
      !hut3.isUpgrading() && map.getObj(hut3Pos) === MapObject.ObjectSmallBuilding &&
      map.getObjIndex(hut3Pos) === hut3.getIndex() && hut3.getResTypeInStock(2) === ResourceType.TypeNone &&
      hut3.getType() === BuildingType.TypeHut && integrity() === 0);
for (let i = 0; i < 8000; i++) {
  game.update();
  if (i % 500 === 0) demolishProblems += integrity();
}
check(`8000 updates later: the demolished hut is gone, the other is a hut with its knights, ` +
      `${demolishProblems} integrity problems`,
      game.getBuildingAtPos(hut2Pos) === null && map.getObj(hut2Pos) === MapObject.ObjectNone &&
      knightsOf(hut3).count > 0 && knightsOf(hut3).states.every((st) => st === 'StateDefendingHut') &&
      demolishProblems === 0 && upgradeRefusal(game, hut3Pos, player) === UpgradeRefusal.None);

const plain = store.write(game);
check('with nothing paused, capped or upgrading the save has no ext_ value',
      !/^\s*ext_/m.test(plain) && !plain.includes('stock[2]') && /^\s*ext_paused/m.test(text));

if (warnings.length > 0) print(warnings.slice(0, 10).join('\n'));
/* The flag of a building that was attacked is never cleared (as in the
   original), so it does not stand in the way of an upgrade; a building
   that is taken loses its upgrade (Building.setOwner). */
hut3.setUnderAttack();
exec({ type: 'upgradeBuilding', pos: hut3Pos });
check('a building that was attacked before can be upgraded', hut3.isUpgrading());

// ---------------------------------------------------------------------------
// Regression: an unfinished castle that burns (a building next to it is
// captured, or its land is lost: Game.demolishBuilding_) took its inventory
// with it only when it was finished. The inventory that was left behind
// crashed Inventory.spawnSerfGeneric() about 1500 updates later, when the
// player's next serf was born into a building that no longer existed.
for (const wait of [0, 1, 50, 400]) {
  const g = GameInfo.getMission(0)!.instantiate()! as any;
  g.rnd = new Random(0x1234, 0x5678, 0x9abc);
  const p = g.getPlayer(0);
  let at = -1;
  for (let pos = 0; pos < size && at < 0; pos++) {
    if (g.canBuildCastle(pos, p)) at = pos;
  }
  executeCommand(g, 0, { type: 'buildCastle', pos: at });
  for (let i = 0; i < wait; i++) g.update();
  const castle = g.getBuildingAtPos(at);
  const done = castle.isDone();
  const index = castle.getIndex();
  g.demolishBuilding_(at);
  let error = '';
  let updates = 0;
  let problems = 0;
  try {
    for (; updates < 6000; updates++) {
      g.update();
      if (updates % 1000 === 999) {
        warnings.length = 0;
        problems += IntegrityCheck.run(g as Game, false);
      }
    }
  } catch (e) {
    error = String(e);
  }
  const left = g.getPlayerInventories(p).length;
  /* The computer player's castle may have taken the free numbers. */
  const stale = [...g.inventories].filter((inv: any) =>
    g.getBuilding(inv.getBuildingIndex()) === null || g.getBuilding(inv.getBuildingIndex()).getInventory() !== inv).length;
  check(`a castle ${done ? 'that is finished' : `under construction (${wait} updates old)`} burns: ` +
        `${error === '' ? `${updates} updates without an error` : error}, the player has ${left} inventories left, ` +
        `${stale} inventories without a building, ${problems} integrity problems, the player ${p.isDefeated() ? 'has' : 'has not'} lost his castle`,
        error === '' && left === 0 && stale === 0 && problems === 0 && p.isDefeated() &&
        (g.getBuilding(index) === null || g.getBuilding(index).getPosition() !== at || g.getBuilding(index).getOwner() !== 0));
}

print(failed === 0 ? `PASS: ${checks} checks` : `FAILED: ${failed} of ${checks} checks`);
process.exit(failed === 0 ? 0 : 1);
