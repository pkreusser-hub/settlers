// Dev tool: issue player commands against a headless game and check the
// state changes.
// Usage: npx esbuild tools/commands-test.ts --bundle --platform=node --outfile=node_modules/.cache/commands-test.cjs --log-level=warning && node node_modules/.cache/commands-test.cjs

import { BuildingType } from '../src/game/building';
// EXT: for the building controls block of run().
import { UpgradeRefusal } from '../src/game/building';
import { MapObject } from '../src/game/map';
import { canCapBuilding, canPauseBuilding, upgradeRefusal } from '../src/net/commands';
// EXT: for the knight controls block of run().
import { rallyRefusal, stanceRefusal } from '../src/net/commands';
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

// ---------------------------------------------------------------------------
// EXT (game options and teams): the startAttack command under the peace
// timer and between allies. Its own block; the games here are apart from the
// game of run().

import { attackRefusal, canAttack } from '../src/net/commands';
// EXT (trading): for runTradeRules().
import { tradeAcceptRefusal, tradeOfferRefusal } from '../src/net/commands';
import { MessageType } from '../src/game/player';
import { TradeRefusal } from '../src/game/trade';

interface AttackScene {
  game: any;
  attacker: any;
  /* The tower of player 1 and the tower of player 0 next to it. */
  target: any;
  source: any;
}

/* Two players, each with a manned tower, close enough for an attack of
   player 0 on the tower of player 1. The towers come from the helper of
   tutorial 6 (Game.buildOccupiedMilitary); nobody has a castle, so the game
   stays quiet. */
function attackScene(stockPreset: number, peaceMinutes: number, teams: number[]): AttackScene | null {
  for (let attempt = 0; attempt < 400; attempt++) {
    const info = new GameInfo(new Random('8667715887436237'));
    info.removeAllPlayers();
    info.addPlayer(12, { red: 0, green: 0, blue: 0 }, 40, 40, 40);
    info.addPlayer(13, { red: 0, green: 0, blue: 0 }, 40, 40, 40);
    info.setDefaultColors();
    info.getPlayer(0).setTeam(teams[0]);
    info.getPlayer(1).setTeam(teams[1]);
    info.setRules({ stockPreset, peaceMinutes, busyRoads: false, trading: false });
    const game = info.instantiate()! as any;
    game.rnd = new Random(0x1234, 0x5678, 0x9abc);
    const map = game.getMap();
    const size = map.getCols() * map.getRows();
    const p0 = game.getPlayer(0);
    const p1 = game.getPlayer(1);

    /* The attempt picks the place of the first tower and where the second
       stands from it. */
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
    if (!game.canBuildCastle(pos0, p0) || !game.canBuildMilitary(pos0)) continue;
    game.buildOccupiedMilitary(pos0, BuildingType.TypeTower, p0);

    const target = game.getBuildingAtPos(pos1);
    const source = game.getBuildingAtPos(pos0);
    if (target === null || source === null) continue;
    /* Allies are no threat to each other: the tower of an ally is not at
       the highest threat level by itself. The level is set here, so that
       only the rule about allies stands in the way of the attack. */
    if (game.isAllied(0, 1)) target.setThreatLevel(3);
    if (target.getThreatLevel() !== 3) continue;
    if (previewAttack(p0, pos1).totalAttackingKnights < 2) continue;
    return { game, attacker: p0, target, source };
  }
  return null;
}

/* Knights of player 0 on their way to a fight. */
function knightsOut(scene: AttackScene): number {
  return 6 - scene.source.getKnightCount();
}

// ---------------------------------------------------------------------------
// EXT (trading): the four trade commands, who may issue them and with which
// arguments. tools/trade-test.ts checks what a trade does. The games here
// are apart from the game of run().

/* Two people with a castle each. */
function tradeScene(trading: boolean): any {
  const info = new GameInfo(new Random('8667715887436237'));
  info.removeAllPlayers();
  info.addPlayer(12, { red: 0, green: 0, blue: 0 }, 40, 40, 40);
  info.addPlayer(13, { red: 0, green: 0, blue: 0 }, 40, 40, 40);
  info.setDefaultColors();
  info.setRules({ stockPreset: 0, peaceMinutes: 0, busyRoads: false, trading });
  const game = info.instantiate()! as any;
  game.rnd = new Random(0x1234, 0x5678, 0x9abc);
  const map = game.getMap();
  const size = map.getCols() * map.getRows();
  let from = 0;
  for (let p = 0; p < 2; p++) {
    for (let pos = from; pos < size; pos++) {
      if (game.canBuildCastle(pos, game.getPlayer(p)) && game.buildCastle(pos, game.getPlayer(p))) {
        from = pos + (size >> 2);
        break;
      }
    }
  }
  for (let i = 0; i < 20; i++) game.update();
  return game;
}

function runTradeRules(out: string[]): void {
  const castleOf = (game: any, p: number): number => {
    for (const b of game.buildings) {
      if (b.getIndex() !== 0 && b.getType() === BuildingType.TypeCastle && b.getOwner() === p) return b.getPosition();
    }
    return -1;
  };
  const state = (game: any): string => {
    const stocks: number[] = [];
    for (const inv of game.inventories) {
      for (let r = 0; r < 26; r++) stocks.push(inv.getCountOf(r));
    }
    return JSON.stringify([game.trade.nextId, game.trade.offers, game.trade.shipments, stocks]);
  };
  const plank = ResourceType.TypePlank;
  const stone = ResourceType.TypeStone;

  // --- the option is off
  const off = tradeScene(false);
  const offState = state(off);
  executeCommand(off, 0, { type: 'tradeOffer', pos: castleOf(off, 0), to: 1, give: plank, giveCount: 5, want: -1, wantCount: 0 });
  executeCommand(off, 1, { type: 'tradeAccept', id: 1, pos: castleOf(off, 1) });
  executeCommand(off, 1, { type: 'tradeDecline', id: 1 });
  executeCommand(off, 0, { type: 'tradeCancel', id: 1 });
  check(out, 'EXT trade commands in a game without trading do nothing',
        state(off) === offState &&
        tradeOfferRefusal(off, off.getPlayer(0), castleOf(off, 0), 1, plank, 5, -1, 0) === TradeRefusal.Off);

  // --- the option is on
  const game = tradeScene(true);
  const c0 = castleOf(game, 0);
  const c1 = castleOf(game, 1);
  const p0 = game.getPlayer(0);
  const p1 = game.getPlayer(1);
  const inv0 = game.getBuildingAtPos(c0).getInventory();
  const inv1 = game.getBuildingAtPos(c1).getInventory();
  let before = state(game);
  const base = { type: 'tradeOffer', pos: c0, to: 1, give: plank, giveCount: 5, want: -1, wantCount: 0 };
  const bad: Partial<Command>[] = [
    { to: 0 }, { to: 2 }, { to: -1 }, { to: 0.5 }, { to: '1' },
    { give: 26 }, { give: -1 }, { give: 1.5 },
    { giveCount: 0 }, { giveCount: -5 }, { giveCount: 2.5 }, { giveCount: 101 }, { giveCount: '5' },
    { giveCount: inv0.getCountOf(plank) + 1 }, { give: ResourceType.TypeBoat, giveCount: 100 },
    { want: stone, wantCount: 0 }, { want: -1, wantCount: 3 }, { want: plank, wantCount: 3 },
    { want: 26, wantCount: 3 }, { want: stone, wantCount: -1 }, { want: stone, wantCount: 1.5 },
    { want: stone, wantCount: 101 },
    { pos: c1 }, { pos: -1 }, { pos: 1 << 28 }, { pos: c0 + 1 },
  ];
  for (const change of bad) executeCommand(game, 0, { ...base, ...change } as Command);
  executeCommand(game, 2, base);
  executeCommand(game, -1, base);
  check(out, `tradeOffer with invalid arguments (${bad.length} forms) or by a player who is not there does nothing`,
        state(game) === before);

  const planks0 = inv0.getCountOf(plank);
  const planks1 = inv1.getCountOf(plank);
  const stone0 = inv0.getCountOf(stone);
  const stone1 = inv1.getCountOf(stone);
  executeCommand(game, 0, base);
  const first = game.trade.offers[0];
  check(out, 'tradeOffer: 5 planks as a gift to player 1, who gets a message; nothing leaves the stock yet',
        game.trade.offers.length === 1 && first.id === 1 && first.from === 0 && first.to === 1 &&
        first.give === plank && first.giveCount === 5 && first.wantCount === 0 &&
        p1.hasNotification() && p1.peekNotification().type === MessageType.TypeTradeOffer &&
        inv0.getCountOf(plank) === planks0);
  executeCommand(game, 0, { ...base, giveCount: 3, want: stone, wantCount: 2 });
  executeCommand(game, 0, { ...base, giveCount: 1 });
  executeCommand(game, 0, { ...base, giveCount: 2 });
  executeCommand(game, 0, { ...base, giveCount: 4 });
  check(out, 'tradeOffer: four are open, a fifth is refused',
        game.trade.offers.length === 4 && game.trade.nextId === 5 &&
        tradeOfferRefusal(game, p0, c0, 1, plank, 4, -1, 0) === TradeRefusal.TooMany);

  // --- tradeAccept, tradeDecline, tradeCancel by the wrong player or with bad arguments
  before = state(game);
  executeCommand(game, 0, { type: 'tradeAccept', id: 1, pos: c0 });
  executeCommand(game, 1, { type: 'tradeAccept', id: 1, pos: c0 });
  executeCommand(game, 1, { type: 'tradeAccept', id: 1, pos: -1 });
  executeCommand(game, 1, { type: 'tradeAccept', id: 9, pos: c1 });
  executeCommand(game, 1, { type: 'tradeAccept', id: 1.5, pos: c1 });
  executeCommand(game, 1, { type: 'tradeAccept', id: '1', pos: c1 });
  executeCommand(game, 0, { type: 'tradeDecline', id: 1 });
  executeCommand(game, 1, { type: 'tradeCancel', id: 1 });
  executeCommand(game, 1, { type: 'tradeDecline', id: 0 });
  executeCommand(game, 0, { type: 'tradeCancel', id: -3 });
  executeCommand(game, 3, { type: 'tradeAccept', id: 1, pos: c1 });
  check(out, 'tradeAccept, tradeDecline and tradeCancel by the wrong player or with invalid arguments do nothing',
        state(game) === before && tradeAcceptRefusal(game, p0, 1, c0) === TradeRefusal.NoOffer &&
        tradeAcceptRefusal(game, p1, 1, c0) === TradeRefusal.Stock &&
        tradeAcceptRefusal(game, p1, 1, c1) === TradeRefusal.None);

  executeCommand(game, 1, { type: 'tradeAccept', id: 1, pos: c1 });
  check(out, 'tradeAccept by player 1: the 5 planks leave the castle of player 0 and are under way',
        game.trade.getOffer(1) === null && game.trade.shipments.length === 1 &&
        inv0.getCountOf(plank) === planks0 - 5 && inv1.getCountOf(plank) === planks1 &&
        game.trade.shipments[0].count === 5 && game.trade.shipments[0].to === 1);
  before = state(game);
  executeCommand(game, 1, { type: 'tradeAccept', id: 1, pos: c1 });
  check(out, 'a second tradeAccept does nothing', state(game) === before);
  executeCommand(game, 1, { type: 'tradeAccept', id: 2, pos: c1 });
  check(out, 'tradeAccept of the swap: 3 planks and 2 stone leave the two castles',
        game.trade.shipments.length === 3 && inv0.getCountOf(plank) === planks0 - 8 &&
        inv1.getCountOf(stone) === stone1 - 2);
  executeCommand(game, 1, { type: 'tradeDecline', id: 3 });
  executeCommand(game, 0, { type: 'tradeCancel', id: 4 });
  check(out, 'tradeDecline by player 1 and tradeCancel by player 0 remove their offers',
        game.trade.offers.length === 0 && game.trade.shipments.length === 3);
  let n = 0;
  while (game.trade.shipments.length > 0 && n < 20000) {
    game.update();
    n++;
  }
  check(out, `the goods have arrived after ${n} updates`,
        inv1.getCountOf(plank) === planks1 + 8 && inv0.getCountOf(stone) === stone0 + 2 &&
        inv1.getCountOf(stone) === stone1 - 2 && inv0.getCountOf(plank) === planks0 - 8);
}

function runAttackRules(out: string[]): void {
  const attack = (scene: AttackScene): void => {
    executeCommand(scene.game, 0, { type: 'startAttack', pos: scene.target.getPosition(), knights: 2 });
  };

  // --- neither option: the attack starts, as before
  const free = attackScene(0, 0, [0, 0]);
  if (free === null) { check(out, 'EXT attack scene could be built', false); return; }
  check(out, 'EXT without peace and teams: canAttack, no refusal',
        canAttack(free.game, free.target.getPosition(), free.attacker) &&
        attackRefusal(free.game, free.target.getPosition(), free.attacker) === '');
  attack(free);
  check(out, `EXT without peace and teams: startAttack sends ${knightsOut(free)} knights`,
        knightsOut(free) === 2 && free.target.isUnderAttack());

  // --- allies
  const allied = attackScene(0, 0, [1, 1]);
  if (allied === null) { check(out, 'EXT allied attack scene could be built', false); return; }
  const alliedPos = allied.target.getPosition();
  check(out, 'EXT allies: canAttack is false, the refusal is "ally"',
        !canAttack(allied.game, alliedPos, allied.attacker) &&
        attackRefusal(allied.game, alliedPos, allied.attacker) === 'ally');
  attack(allied);
  check(out, 'EXT allies: startAttack on the tower of an ally is refused',
        knightsOut(allied) === 0 && !allied.target.isUnderAttack());
  /* Past the command: the simulation itself refuses. */
  allied.attacker.buildingAttacked = allied.target.getIndex();
  allied.attacker.knightsAttacking = Math.min(2, allied.attacker.knightsAvailableForAttack(alliedPos));
  allied.attacker.startAttack();
  check(out, 'EXT allies: Player.startAttack() itself sends nobody against an ally',
        allied.attacker.attackingBuildingCount > 0 && knightsOut(allied) === 0 &&
        !allied.target.isUnderAttack());

  // --- two teams against each other
  const enemies = attackScene(0, 0, [1, 2]);
  if (enemies === null) { check(out, 'EXT enemy teams attack scene could be built', false); return; }
  attack(enemies);
  check(out, 'EXT team A against team B: startAttack is allowed',
        knightsOut(enemies) === 2 && enemies.target.isUnderAttack());

  // --- the peace timer: 10 minutes are 60000 ticks
  const peace = attackScene(0, 10, [0, 0]);
  if (peace === null) { check(out, 'EXT peace attack scene could be built', false); return; }
  const peacePos = peace.target.getPosition();
  check(out, `EXT peace: ${peace.game.getPeaceTicksLeft()} ticks left at the start, the refusal is "peace"`,
        peace.game.isPeace() && peace.game.getPeaceTicksLeft() === 60000 &&
        !canAttack(peace.game, peacePos, peace.attacker) &&
        attackRefusal(peace.game, peacePos, peace.attacker) === 'peace');
  attack(peace);
  check(out, 'EXT peace: startAttack at the start is refused',
        knightsOut(peace) === 0 && !peace.target.isUnderAttack());
  while (peace.game.getPeaceTicksLeft() > peace.game.gameSpeed) peace.game.update();
  attack(peace);
  check(out, `EXT peace: still refused at tick ${peace.game.getTick()}`,
        peace.game.isPeace() && knightsOut(peace) === 0 && !peace.target.isUnderAttack());
  peace.attacker.buildingAttacked = peace.target.getIndex();
  peace.attacker.knightsAttacking = Math.min(2, peace.attacker.knightsAvailableForAttack(peacePos));
  peace.attacker.startAttack();
  check(out, 'EXT peace: Player.startAttack() itself sends nobody during the peace',
        knightsOut(peace) === 0 && !peace.target.isUnderAttack());
  peace.game.update();
  attack(peace);
  check(out, `EXT peace: allowed at tick ${peace.game.getTick()}, once the timer is over`,
        !peace.game.isPeace() && peace.game.getTick() >= 60000 &&
        knightsOut(peace) === 2 && peace.target.isUnderAttack());

  // --- options that are not valid leave the defaults
  const odd = attackScene(7, 15, [0, 0]);
  check(out, 'EXT a stock preset and a peace time that do not exist are not taken',
        odd !== null && odd.game.getRules().stockPreset === 0 && odd.game.getRules().peaceMinutes === 0);
}

// EXT: end of the block.

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

  // EXT (game options and teams): see runAttackRules().
  runAttackRules(out);
  // EXT (trading): see runTradeRules().
  runTradeRules(out);

  // -------------------------------------------------------------------------
  // EXT: building controls (setBuildingPaused, setBuildingCap,
  // upgradeBuilding). tools/buildings-test.ts checks what they do to the
  // economy; here: who may issue them and with which arguments.
  {
    const bld = (pos: number) => game.getBuildingAtPos(pos);

    // --- setBuildingPaused
    exec({ type: 'setBuildingPaused', pos: lumberjackPos, paused: true }, 1);
    check(out, 'setBuildingPaused by the other player does nothing', !lumberjack.isProductionPaused());
    exec({ type: 'setBuildingPaused', pos: castlePos, paused: true });
    check(out, 'setBuildingPaused on the castle does nothing',
          !bld(castlePos).isProductionPaused() && !canPauseBuilding(game, castlePos, player));
    exec({ type: 'setBuildingPaused', pos: lumberjackPos, paused: 'yes' as unknown as boolean });
    exec({ type: 'setBuildingPaused', pos: size, paused: true });
    check(out, 'setBuildingPaused with invalid arguments does nothing', !lumberjack.isProductionPaused());
    exec({ type: 'setBuildingPaused', pos: lumberjackPos, paused: true });
    exec({ type: 'setBuildingPaused', pos: lumberjackPos, paused: true });
    const wasPaused = lumberjack.isProductionPaused() && lumberjack.isProductionHeld();
    exec({ type: 'setBuildingPaused', pos: lumberjackPos, paused: false });
    check(out, 'setBuildingPaused (twice true is still paused, then false)',
          wasPaused && !lumberjack.isProductionPaused() && canPauseBuilding(game, lumberjackPos, player));

    // --- setBuildingCap
    exec({ type: 'setBuildingCap', pos: lumberjackPos, cap: 20 }, 1);
    check(out, 'setBuildingCap by the other player does nothing', lumberjack.getProductionCap() === 0);
    for (const cap of [15, -10, 1000, 10.5, '10' as unknown as number]) {
      exec({ type: 'setBuildingCap', pos: lumberjackPos, cap });
    }
    exec({ type: 'setBuildingCap', pos: castlePos, cap: 10 });
    check(out, 'setBuildingCap with a value that is not a step, or on the castle, does nothing',
          lumberjack.getProductionCap() === 0 && bld(castlePos).getProductionCap() === 0 &&
          !canCapBuilding(game, castlePos, player));
    exec({ type: 'setBuildingCap', pos: lumberjackPos, cap: 200 });
    const capped = lumberjack.getProductionCap();
    exec({ type: 'setBuildingCap', pos: lumberjackPos, cap: 0 });
    check(out, 'setBuildingCap 200, then 0 (off)',
          capped === 200 && lumberjack.getProductionCap() === 0 && canCapBuilding(game, lumberjackPos, player));

    // --- upgradeBuilding: a hut where a tower fits and one where none does
    const placeHut = (large: boolean): number => {
      for (let i = 7; i < 295; i++) {
        const pos = map.posAddSpirally(castlePos, i);
        if (!game.canBuildBuilding(pos, BuildingType.TypeHut, player)) continue;
        if (game.canBuildLarge(pos) !== large) continue;
        const hutFlag = map.moveDownRight(pos);
        if (!map.hasFlag(hutFlag)) {
          exec({ type: 'buildFlag', pos: hutFlag });
          if (!map.hasFlag(hutFlag)) continue;
          /* The shorter road to the flag of the castle or of the woodcutter
             (which has a road to the castle), not over the site. */
          let best: number[] | null = null;
          for (const target of [castleFlag, lumberjackFlag]) {
            const dirs: number[] = pathfinderMap(map, hutFlag, target).getDirs().slice();
            if (dirs.length === 0 || (best !== null && dirs.length >= best.length)) continue;
            let p = hutFlag;
            let free = true;
            for (let k = 0; k < dirs.length; k++) {
              p = map.move(p, dirs[k]);
              if (p === pos || (map.hasFlag(p) && k < dirs.length - 1)) free = false;
            }
            if (free) best = dirs;
          }
          if (best !== null) exec({ type: 'buildRoad', start: hutFlag, dirs: best, flag: RoadFlag.None });
          if (map.paths(hutFlag) === 0) {
            exec({ type: 'demolishFlag', pos: hutFlag });
            continue;
          }
        }
        if (!game.canBuildBuilding(pos, BuildingType.TypeHut, player)) continue;
        exec({ type: 'buildBuilding', pos, building: BuildingType.TypeHut });
        if (bld(pos)?.getType() === BuildingType.TypeHut) return pos;
      }
      return -1;
    };
    const smallHutPos = placeHut(false);
    const hutPos = placeHut(true);
    check(out, 'built a hut on a large site and a hut on a small site', hutPos >= 0 && smallHutPos >= 0);
    if (hutPos >= 0 && smallHutPos >= 0) {
      const hut = bld(hutPos);
      exec({ type: 'upgradeBuilding', pos: hutPos });
      check(out, 'upgradeBuilding on a hut that is not finished does nothing',
            !hut.isUpgrading() && upgradeRefusal(game, hutPos, player) === UpgradeRefusal.NotFinished);
      let waited = 0;
      while (waited < 60000 && !(hut.isActive() && bld(smallHutPos).isActive())) {
        game.update();
        waited++;
      }
      check(out, `both huts have knights after ${waited} updates`, hut.isActive() && bld(smallHutPos).isActive());

      exec({ type: 'upgradeBuilding', pos: hutPos }, 1);
      check(out, 'upgradeBuilding by the other player does nothing',
            !hut.isUpgrading() && upgradeRefusal(game, hutPos, game.getPlayer(1)) === UpgradeRefusal.NotOwn);
      exec({ type: 'upgradeBuilding', pos: lumberjackPos });
      exec({ type: 'upgradeBuilding', pos: castlePos });
      check(out, 'upgradeBuilding on a woodcutter or the castle does nothing',
            !lumberjack.isUpgrading() && !bld(castlePos).isUpgrading() &&
            upgradeRefusal(game, lumberjackPos, player) === UpgradeRefusal.WrongType);
      exec({ type: 'upgradeBuilding', pos: smallHutPos });
      check(out, 'upgradeBuilding on a hut where no large building fits does nothing',
            !bld(smallHutPos).isUpgrading() && map.getObj(smallHutPos) === MapObject.ObjectSmallBuilding &&
            upgradeRefusal(game, smallHutPos, player) === UpgradeRefusal.NoRoom);
      for (const pos of [-1, size, 0.5, NaN, undefined as unknown as number]) {
        exec({ type: 'upgradeBuilding', pos });
        exec({ type: 'setBuildingPaused', pos, paused: true });
        exec({ type: 'setBuildingCap', pos, cap: 10 });
      }
      check(out, 'the three commands with a position that is not valid do nothing', !hut.isUpgrading());

      exec({ type: 'upgradeBuilding', pos: hutPos });
      check(out, 'upgradeBuilding on the hut on the large site: an upgrade to a tower starts',
            hut.isUpgrading() && hut.getUpgradeTo() === BuildingType.TypeTower &&
            hut.getType() === BuildingType.TypeHut && map.getObj(hutPos) === MapObject.ObjectLargeBuilding &&
            upgradeRefusal(game, hutPos, player) === UpgradeRefusal.InProgress);
      const timer = hut.getUpgradeTimer();
      exec({ type: 'upgradeBuilding', pos: hutPos });
      check(out, 'a second upgradeBuilding does nothing', hut.getUpgradeTo() === BuildingType.TypeTower &&
            hut.getUpgradeTimer() === timer);
      let upgraded = 0;
      while (upgraded < 60000 && hut.isUpgrading()) {
        game.update();
        upgraded++;
      }
      check(out, `the hut is a tower after ${upgraded} updates`,
            !hut.isUpgrading() && hut.getType() === BuildingType.TypeTower);

      // ---------------------------------------------------------------------
      // EXT: knight controls (setBuildingStance, setRallyPoint,
      // clearRallyPoint). tools/knights-test.ts checks what they do to the
      // knights; here: who may issue them and with which arguments. The
      // tower (the hut of before) and the small hut are finished by now.
      {
        const tower = hut;
        const smallHut = bld(smallHutPos);
        const stances = (): string => [...game.buildings].map((b: any) => b.extStance).join('');
        const none = stances();
        check(out, 'the tower and the small hut are finished and on Normal, no rally point',
              tower.isDone() && smallHut !== null && smallHut.isDone() && !none.includes('1') && player.extRally === 0);

        // --- setBuildingStance
        exec({ type: 'setBuildingStance', pos: hutPos, stance: 1 }, 1);
        check(out, 'setBuildingStance by the other player does nothing', !tower.isHolding());
        exec({ type: 'setBuildingStance', pos: castlePos, stance: 1 });
        exec({ type: 'setBuildingStance', pos: lumberjackPos, stance: 1 });
        check(out, 'setBuildingStance on the castle or a woodcutter does nothing',
              stances() === none && stanceRefusal(game, castlePos, player, 1) === 'notMilitary' &&
              stanceRefusal(game, lumberjackPos, player, 1) === 'notMilitary');
        for (const stance of [2, -1, 0.5, '1' as unknown as number, undefined as unknown as number]) {
          exec({ type: 'setBuildingStance', pos: hutPos, stance });
        }
        for (const pos of [-1, size, 0.5, 'x' as unknown as number]) {
          exec({ type: 'setBuildingStance', pos, stance: 1 });
          exec({ type: 'setRallyPoint', pos });
        }
        check(out, 'setBuildingStance and setRallyPoint with invalid arguments do nothing',
              stances() === none && player.extRally === 0);
        const sitePos = placeHut(false);
        if (sitePos >= 0) {
          exec({ type: 'setBuildingStance', pos: sitePos, stance: 1 });
          exec({ type: 'setRallyPoint', pos: sitePos });
          check(out, 'setBuildingStance and setRallyPoint on a hut that is not finished do nothing',
                !stances().includes('1') && player.extRally === 0 &&
                stanceRefusal(game, sitePos, player, 1) === 'notFinished' &&
                rallyRefusal(game, sitePos, player) === 'notFinished');
        }
        exec({ type: 'setBuildingStance', pos: hutPos, stance: 1 });
        exec({ type: 'setBuildingStance', pos: hutPos, stance: 1 });
        const held = tower.isHolding();
        exec({ type: 'setRallyPoint', pos: hutPos });
        check(out, 'setBuildingStance Hold (twice is still Hold); setRallyPoint on the building on Hold does nothing',
              held && tower.isHolding() && player.extRally === 0 && rallyRefusal(game, hutPos, player) === 'hold');
        exec({ type: 'setBuildingStance', pos: hutPos, stance: 0 });
        check(out, 'setBuildingStance Normal', !tower.isHolding() && !stances().includes('1'));

        // --- setRallyPoint, clearRallyPoint
        exec({ type: 'setRallyPoint', pos: hutPos }, 1);
        exec({ type: 'setRallyPoint', pos: castlePos });
        exec({ type: 'setRallyPoint', pos: lumberjackPos });
        check(out, 'setRallyPoint by the other player, on the castle or on a woodcutter does nothing',
              player.extRally === 0 && game.getPlayer(1).extRally === 0 &&
              rallyRefusal(game, castlePos, player) === 'notMilitary');
        exec({ type: 'setRallyPoint', pos: hutPos });
        const first = player.getRallyBuilding() === tower;
        exec({ type: 'setBuildingStance', pos: hutPos, stance: 1 });
        check(out, 'setRallyPoint on the tower; setBuildingStance Hold on the rally point does nothing',
              first && !tower.isHolding() && stanceRefusal(game, hutPos, player, 1) === 'rally');
        exec({ type: 'setRallyPoint', pos: smallHutPos });
        check(out, 'a second setRallyPoint moves the rally point to the small hut',
              player.getRallyBuilding() === smallHut);
        exec({ type: 'clearRallyPoint' }, 1);
        const kept = player.getRallyBuilding() === smallHut;
        exec({ type: 'clearRallyPoint' });
        exec({ type: 'clearRallyPoint' });
        check(out, 'clearRallyPoint by the other player does nothing; by the player it clears (twice is still none)',
              kept && player.extRally === 0);
        exec({ type: 'setRallyPoint', pos: smallHutPos });
        exec({ type: 'demolishBuilding', pos: smallHutPos });
        check(out, 'demolishing the rally point clears it', smallHut.isBurning() && player.extRally === 0);
      }
      // EXT: end of the knight controls block.
    }
  }
  // EXT: end of the building controls block.
  // -------------------------------------------------------------------------

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
