// Dev tool: issue player commands against a headless game and check the
// state changes.
// Usage: npx esbuild tools/commands-test.ts --bundle --platform=node --outfile=node_modules/.cache/commands-test.cjs --log-level=warning && node node_modules/.cache/commands-test.cjs

import { BuildingType } from '../src/game/building';
import { InventoryMode } from '../src/game/inventory';
import { Road } from '../src/game/map';
import { GameInfo } from '../src/game/mission';
import { pathfinderMap } from '../src/game/pathfinder';
import { Random } from '../src/game/random';
import { ResourceType } from '../src/game/resource';
import {
  executeCommand,
  setCommandSink,
  setGameClock,
  setLocalPlayer,
  tickGame,
} from '../src/net/command';
import type { Command } from '../src/net/command';
import {
  addCommandListener,
  cmdBuildFlag,
  cmdBuildRoad,
  commandTypes,
  previewAttack,
  removeCommandListener,
  RoadFlag,
} from '../src/net/commands';

let failed = 0;
let checks = 0;

function check(out: string[], what: string, ok: boolean): void {
  checks++;
  if (!ok) failed++;
  out.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
}

function hashGame(game: any): string {
  let h = 2166136261;
  const mix = (v: number) => { h = Math.imul(h ^ (v | 0), 16777619); };
  for (const serf of game.serfs) { mix(serf.getIndex()); mix(serf.pos); mix(serf.state); mix(serf.counter); mix(serf.type); }
  for (const b of game.buildings) { mix(b.getPosition()); mix(b.getType()); mix(b.isDone() ? 1 : 0); mix(b.isBurning() ? 1 : 0); }
  for (const f of game.flags) { mix(f.getPosition()); }
  return (h >>> 0).toString(16);
}

function run(): string[] {
  const out: string[] = [];
  const info = GameInfo.getMission(0)!;
  const game = info.instantiate()! as any;
  game.rnd = new Random(0x1234, 0x5678, 0x9abc);
  const map = game.getMap();
  const player = game.getPlayer(0);
  const size = map.getCols() * map.getRows();
  const exec = (cmd: Command, who = 0) => executeCommand(game, who, cmd);
  const name = (pos: number) => `${map.posCol(pos)},${map.posRow(pos)}`;

  // --- castle
  let castlePos = -1;
  for (let pos = 0; pos < size; pos++) {
    if (game.canBuildCastle(pos, player)) { castlePos = pos; break; }
  }
  exec({ type: 'buildCastle', pos: castlePos });
  check(out, `buildCastle at ${name(castlePos)}`, player.hasCastle() &&
        game.getBuildingAtPos(castlePos)?.getType() === BuildingType.TypeCastle);
  const castleFlag = map.moveDownRight(castlePos);

  // --- two buildings
  const wanted = [BuildingType.TypeLumberjack, BuildingType.TypeStonecutter];
  const built: number[] = [];
  for (let i = 0; i < 295 && built.length < wanted.length; i++) {
    const pos = map.posAddSpirally(castlePos, i);
    const type = wanted[built.length];
    if (!game.canBuildBuilding(pos, type, player)) continue;
    exec({ type: 'buildBuilding', pos, building: type });
    const b = game.getBuildingAtPos(pos);
    check(out, `buildBuilding ${BuildingType[type]} at ${name(pos)}`,
          b !== null && b.getType() === type && b.getOwner() === 0 &&
          map.hasFlag(map.moveDownRight(pos)));
    built.push(pos);
  }
  const [lumberjackPos, stonecutterPos] = built;

  // --- road from the lumberjack's flag to the castle's flag
  const lumberjackFlag = map.moveDownRight(lumberjackPos);
  const road: Road = pathfinderMap(map, lumberjackFlag, castleFlag);
  exec({ type: 'buildRoad', start: road.getSource(), dirs: road.getDirs(), flag: RoadFlag.None });
  const lf = game.getFlagAtPos(lumberjackFlag);
  check(out, `buildRoad length ${road.getLength()} from ${name(lumberjackFlag)} to the castle flag`,
        road.getLength() > 0 && lf.hasPath(road.getDirs()[0]) &&
        lf.getOtherEndFlag(road.getDirs()[0]) === game.getFlagAtPos(castleFlag));

  // --- a flag of its own, then a road from it that ends with a new flag
  let flagPos = -1;
  let endRoad: Road | null = null;
  for (let i = 19; i < 295 && endRoad === null; i++) {
    const pos = map.posAddSpirally(castlePos, i);
    if (!game.canBuildFlag(pos, player) || map.paths(pos) !== 0) continue;
    /* A road of three steps from there to a free site for a flag. */
    for (let j = 19; j < 61 && endRoad === null; j++) {
      const dest = map.posAddSpirally(pos, j);
      if (!game.canBuildFlag(dest, player) || map.paths(dest) !== 0) continue;
      const r: Road = pathfinderMap(map, pos, dest);
      if (r.getLength() < 3) continue;
      /* Not past another flag or road. */
      let p = pos;
      let free = true;
      for (const d of r.getDirs()) {
        p = map.move(p, d);
        if (map.paths(p) !== 0 || map.hasFlag(p) || map.hasBuilding(p)) free = false;
      }
      if (free) { flagPos = pos; endRoad = r; }
    }
  }
  check(out, 'found a site for a flag and a road with a flag at its end', endRoad !== null);
  if (endRoad !== null) {
    exec({ type: 'buildFlag', pos: flagPos });
    check(out, `buildFlag at ${name(flagPos)}`, map.hasFlag(flagPos) && map.getOwner(flagPos) === 0);

    const flagsBefore = [...game.flags].length;
    const end = endRoad.getEnd(map);
    exec({ type: 'buildRoad', start: flagPos, dirs: endRoad.getDirs(), flag: RoadFlag.End });
    check(out, `buildRoad flag=End: flag at ${name(end)} and the road to it`,
          map.hasFlag(end) && [...game.flags].length === flagsBefore + 1 &&
          game.getFlagAtPos(flagPos).getOtherEndFlag(endRoad.getDirs()[0]) === game.getFlagAtPos(end));

    // --- the same command again: no longer valid, nothing happens
    const before = hashGame(game);
    exec({ type: 'buildRoad', start: flagPos, dirs: endRoad.getDirs(), flag: RoadFlag.End });
    exec({ type: 'buildFlag', pos: flagPos });
    check(out, 'repeated buildRoad and buildFlag do nothing', hashGame(game) === before);

    // --- demolish the road, then both flags
    const mid = map.move(flagPos, endRoad.getDirs()[0]);
    exec({ type: 'demolishRoad', pos: mid });
    check(out, `demolishRoad at ${name(mid)}`, map.paths(mid) === 0 && map.paths(flagPos) === 0);
    exec({ type: 'demolishFlag', pos: end }, 1);
    check(out, 'demolishFlag by the other player does nothing', map.hasFlag(end));
    exec({ type: 'demolishFlag', pos: end });
    exec({ type: 'demolishFlag', pos: flagPos });
    check(out, 'demolishFlag (both flags)', !map.hasFlag(end) && !map.hasFlag(flagPos));

    // --- a road that fails with flag=EndOrUndo leaves no flag behind
    const flagsNow = [...game.flags].length;
    exec({ type: 'buildRoad', start: flagPos, dirs: endRoad.getDirs(), flag: RoadFlag.EndOrUndo });
    check(out, 'buildRoad flag=EndOrUndo from a start without a flag: the flag is removed again',
          !map.hasFlag(end) && [...game.flags].length === flagsNow && map.paths(end) === 0);
  }

  // --- demolish a building
  exec({ type: 'demolishBuilding', pos: stonecutterPos }, 1);
  check(out, 'demolishBuilding by the other player does nothing',
        !game.getBuildingAtPos(stonecutterPos).isBurning());
  exec({ type: 'demolishBuilding', pos: stonecutterPos });
  check(out, `demolishBuilding at ${name(stonecutterPos)}`,
        game.getBuildingAtPos(stonecutterPos).isBurning());
  exec({ type: 'demolishBuilding', pos: castlePos });
  check(out, 'demolishBuilding does not take the castle', !game.getBuildingAtPos(castlePos).isBurning());

  // --- settings
  exec({ type: 'setFoodStonemine', value: 13100 });
  exec({ type: 'setPlanksConstruction', value: 1310 });
  exec({ type: 'setWheatMill', value: 65500 });
  check(out, 'setFoodStonemine, setPlanksConstruction, setWheatMill',
        player.getFoodStonemine() === 13100 && player.getPlanksConstruction() === 1310 &&
        player.getWheatMill() === 65500);
  exec({ type: 'resetFoodPriority' });
  check(out, 'resetFoodPriority', player.getFoodStonemine() === 13100 && player.getFoodCoalmine() !== 0);
  const coalmine = player.getFoodCoalmine();
  exec({ type: 'setFoodCoalmine', value: 70000 });
  exec({ type: 'setFoodCoalmine', value: 1.5 });
  exec({ type: 'setFoodCoalmine', value: 'x' as unknown as number });
  check(out, 'setFoodCoalmine with a value out of range does nothing', player.getFoodCoalmine() === coalmine);

  exec({ type: 'setToolPrio', tool: 5, value: 2620 });
  check(out, 'setToolPrio', player.getToolPrio(5) === 2620);
  exec({ type: 'resetToolPriority' });
  check(out, 'resetToolPriority', player.getToolPrio(5) !== 2620);

  const occupation = player.getKnightOccupation(3);
  exec({ type: 'changeKnightOccupation', level: 3, adjustMax: false, delta: -1 });
  check(out, 'changeKnightOccupation (minimum of level 3, -1)',
        player.getKnightOccupation(3) === ((occupation & 0xf0) | Math.max(0, (occupation & 0xf) - 1)));

  exec({ type: 'setSendStrongest', strongest: true });
  const strongest = player.sendStrongest();
  exec({ type: 'setSendStrongest', strongest: false });
  check(out, 'setSendStrongest', strongest && !player.sendStrongest());

  const wantedKnights = player.getCastleKnightsWanted();
  exec({ type: 'changeCastleKnightsWanted', delta: 1 });
  exec({ type: 'changeCastleKnightsWanted', delta: 1 });
  exec({ type: 'changeCastleKnightsWanted', delta: -1 });
  check(out, 'changeCastleKnightsWanted', player.getCastleKnightsWanted() === wantedKnights + 1);

  exec({ type: 'setSerfToKnightRate', value: 39300 });
  check(out, 'setSerfToKnightRate', player.getSerfToKnightRate() === 39300);

  exec({ type: 'cycleKnights' });
  check(out, 'cycleKnights', player.cyclingKnight() && player.reducedKnightLevel());

  const plank = ResourceType.TypePlank;
  const goldOre = ResourceType.TypeGoldOre;
  exec({ type: 'movePriority', inventory: false, item: goldOre, up: true, toEnd: true });
  const flagPrio = player.getFlagPrio().slice().sort((a: number, b: number) => a - b);
  check(out, 'movePriority (gold ore to the top of the flag priorities)',
        player.getFlagPrio(goldOre) === 26 && flagPrio.every((v: number, i: number) => v === i + 1));
  exec({ type: 'movePriority', inventory: true, item: plank, up: false, toEnd: true });
  check(out, 'movePriority (planks to the bottom of the inventory priorities)',
        player.getInventoryPrio(plank) === 1);
  exec({ type: 'resetFlagPriority' });
  check(out, 'resetFlagPriority', player.getFlagPrio(goldOre) === 1 && player.getFlagPrio(plank) === 26);
  exec({ type: 'resetInventoryPriority' });
  exec({ type: 'resetPlanksPriority' });
  check(out, 'resetInventoryPriority, resetPlanksPriority',
        player.getInventoryPrio(plank) === 8 && player.getPlanksConstruction() !== 1310);

  const inventory = game.getBuildingAtPos(castlePos).getInventory();
  exec({ type: 'setInventoryResourceMode', pos: castlePos, mode: 1 });
  exec({ type: 'setInventorySerfMode', pos: castlePos, mode: 2 });
  check(out, 'setInventoryResourceMode stop, setInventorySerfMode out',
        inventory.getResMode() === InventoryMode.ModeStop && inventory.getSerfMode() === InventoryMode.ModeOut);
  exec({ type: 'setInventoryResourceMode', pos: castlePos, mode: 0 }, 1);
  check(out, 'setInventoryResourceMode by the other player does nothing',
        inventory.getResMode() === InventoryMode.ModeStop);
  exec({ type: 'setInventoryResourceMode', pos: castlePos, mode: 0 });
  exec({ type: 'setInventorySerfMode', pos: castlePos, mode: 0 });
  check(out, 'setInventoryResourceMode and setInventorySerfMode in',
        inventory.getResMode() === InventoryMode.ModeIn && inventory.getSerfMode() === InventoryMode.ModeIn);

  exec({ type: 'addTimer', timeout: 100, pos: castlePos });
  check(out, 'addTimer', player.timers.length === 1 && player.timers[0].pos === castlePos);

  // --- attack: nothing to attack yet, and the preview leaves the player alone
  const scratch = JSON.stringify([player.attackingKnights, player.attackingBuildings,
                                  player.attackingBuildingCount, player.totalAttackingKnights]);
  const preview = previewAttack(player, castlePos);
  exec({ type: 'startAttack', pos: castlePos, knights: 5 });
  check(out, 'previewAttack and an invalid startAttack leave the player as it was',
        preview.attackingKnights.length === 4 &&
        JSON.stringify([player.attackingKnights, player.attackingBuildings,
                        player.attackingBuildingCount, player.totalAttackingKnights]) === scratch);

  // --- speed and pause
  const speed = game.gameSpeed;
  exec({ type: 'speedIncrease' });
  exec({ type: 'speedIncrease' });
  exec({ type: 'speedDecrease' });
  check(out, 'speedIncrease, speedDecrease', game.gameSpeed === speed + 1);
  exec({ type: 'speedReset' });
  check(out, 'speedReset', game.gameSpeed === speed);
  exec({ type: 'setPaused', paused: true });
  exec({ type: 'setPaused', paused: true }, 1);
  const paused = game.isPaused();
  exec({ type: 'setPaused', paused: false });
  check(out, 'setPaused (twice true is still paused, then false)', paused && !game.isPaused() &&
        game.gameSpeed === speed);

  // --- arguments that are not valid
  const before = hashGame(game);
  for (const pos of [-1, size, 1e12, 0.5, NaN, undefined as unknown as number]) {
    exec({ type: 'buildFlag', pos });
    exec({ type: 'buildBuilding', pos, building: BuildingType.TypeHut });
    exec({ type: 'demolishBuilding', pos });
    exec({ type: 'sendGeologist', pos });
    exec({ type: 'buildRoad', start: pos, dirs: [0, 1], flag: 0 });
  }
  exec({ type: 'buildBuilding', pos: lumberjackPos, building: BuildingType.TypeCastle });
  exec({ type: 'buildBuilding', pos: lumberjackPos, building: 99 });
  exec({ type: 'buildRoad', start: castleFlag, dirs: [0, 7], flag: 0 });
  exec({ type: 'buildRoad', start: castleFlag, dirs: 'x' as unknown as number[], flag: 0 });
  exec({ type: 'buildRoad', start: castleFlag, dirs: [], flag: 1 });
  exec({ type: 'buildFlag', pos: castleFlag }, 7);
  check(out, 'commands with invalid arguments or an unknown player do nothing', hashGame(game) === before);
  let threw = false;
  try { exec({ type: 'noSuchCommand' }); } catch { threw = true; }
  check(out, 'an unknown command type throws', threw);

  // --- the helpers issue plain data through the sink; the listener is told
  const sent: string[] = [];
  let heard = 0;
  const listener = () => { heard++; };
  addCommandListener(listener);
  setLocalPlayer(0);
  setCommandSink({ issue: (cmd) => { sent.push(JSON.stringify(cmd)); } });
  cmdBuildFlag(game, flagPos);
  cmdBuildRoad(game, road, RoadFlag.EndOrUndo);
  setCommandSink(null);
  check(out, `helpers issue to the sink: ${sent.join(' ')}`,
        sent.length === 2 && !map.hasFlag(flagPos) && heard === 0 &&
        sent[1] === JSON.stringify({ type: 'buildRoad', start: road.getSource(), dirs: road.getDirs(), flag: 3 }));
  executeCommand(game, 0, JSON.parse(sent[0]));
  check(out, 'the command from the sink, applied later', map.hasFlag(flagPos) && heard === 1);
  removeCommandListener(listener);
  cmdBuildFlag(game, flagPos); /* No sink: runs at once (and does nothing). */
  check(out, 'no listener after removeCommandListener', heard === 1);

  // --- advance the game through the clock
  let ticks = 0;
  setGameClock({ tick: (g) => { ticks++; g.update(); } });
  const serfs = [...game.serfs].length;
  for (let i = 0; i < 20000; i++) tickGame(game);
  setGameClock(null);
  const lumberjack = game.getBuildingAtPos(lumberjackPos);
  check(out, `after ${ticks} updates: lumberjack ${lumberjack.isDone() ? 'done' : 'in progress ' + lumberjack.getProgress()}, ` +
        `stonecutter ${game.getBuildingAtPos(stonecutterPos) === null ? 'burned down' : 'still there'}, ` +
        `${[...game.serfs].length} serfs (${serfs} before), timer message ${player.timers.length === 0 ? 'sent' : 'pending'}`,
        ticks === 20000 && (lumberjack.isDone() || lumberjack.getProgress() > 0) &&
        game.getBuildingAtPos(stonecutterPos) === null && [...game.serfs].length > serfs &&
        player.timers.length === 0 && player.hasNotification());

  out.push(`hash=${hashGame(game)}`);
  return out;
}

const a = run();
const failedFirst = failed;
const b = run();
console.log(a.join('\n'));
console.log(`${commandTypes.length} command types registered: ${commandTypes.join(', ')}`);
console.log(a.join('\n') === b.join('\n') ? 'DETERMINISTIC: two runs match' : 'MISMATCH between two runs:\n' + b.join('\n'));
console.log(failedFirst === 0 && failed === 0 ? `PASS: ${checks / 2} checks` : `FAILED: ${failedFirst} of ${checks / 2} checks`);
process.exit(failed === 0 && a.join('\n') === b.join('\n') ? 0 : 1);
