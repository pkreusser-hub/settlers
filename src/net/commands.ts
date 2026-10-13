// The player commands: one command type per action a player can take, the
// handler that applies it to the game, and a typed helper for the UI.
//
// A handler gets (game, playerIndex, cmd). It looks everything up from the
// game by position or index, checks again that the action is still valid
// (in a network game the command runs some updates after it was issued) and
// then does exactly what the UI did before the commands existed, in the same
// order. A command that is no longer valid, or that has arguments out of
// range, does nothing. Handlers never read UI or local state.
//
// Importing this module registers the handlers (main.ts imports it).

import { BuildingType } from '../game/building';
// EXT: for the building controls block at the end of this file.
import {
  isProductionBuilding,
  productionCapSteps,
  productionOutput,
  UpgradeRefusal,
} from '../game/building';
import type { Building } from '../game/building';
import type { Game } from '../game/game';
import { MapObject, Road } from '../game/map';
import type { Direction, MapPos } from '../game/map';
import type { Player } from '../game/player';
import { ResourceType } from '../game/resource';
import { SerfState, SerfType } from '../game/serf';
// EXT: for the trade block at the end of this file.
import { TradeRefusal } from '../game/trade';
import { issue, registerCommand } from './command';
import type { Command } from './command';

// ---------------------------------------------------------------------------
// Listeners: told after any command has been applied (of the local or of
// another player), so that the UI can refresh what it derived from the state
// (map cursor type, panel buttons, open box).

type CommandListener = (player: number, cmd: Command) => void;
const listeners: CommandListener[] = [];

export function addCommandListener(listener: CommandListener): void {
  listeners.push(listener);
}

export function removeCommandListener(listener: CommandListener): void {
  const i = listeners.indexOf(listener);
  if (i >= 0) listeners.splice(i, 1);
}

type PlayerHandler = (game: Game, player: Player, cmd: Command) => void;

// All the command types, in the order of their registration.
export const commandTypes: string[] = [];

function register(type: string, handler: PlayerHandler): void {
  commandTypes.push(type);
  registerCommand(type, (game, playerIndex, cmd) => {
    if (!Number.isInteger(playerIndex) || playerIndex < 0) return;
    const player = game.getPlayer(playerIndex);
    if (player === null) return;
    handler(game, player, cmd);
    for (const listener of listeners.slice()) {
      listener(playerIndex, cmd);
    }
  });
}

// ---------------------------------------------------------------------------
// Argument checks. The arguments come over the network: nothing is assumed.

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function isPos(game: Game, v: unknown): v is MapPos {
  const map = game.getMap();
  return isInt(v, 0, map.getCols() * map.getRows() - 1);
}

function isBuildableType(v: unknown): v is BuildingType {
  return isInt(v, BuildingType.TypeNone + 1, BuildingType.TypeCastle - 1);
}

/* The player's own building at pos that is not burning. */
function ownBuildingAt(game: Game, player: Player, pos: MapPos): Building | null {
  const building = game.getBuildingAtPos(pos);
  if (building === null || building.isBurning() || building.getOwner() !== player.getIndex()) {
    return null;
  }
  return building;
}

// ---------------------------------------------------------------------------
// Read-only checks for the UI, where the game has no can_* method. They
// decide the feedback (accepted or not accepted sound) before the command is
// issued; the handler checks again when the command runs.

/* The checks of Game::replace_building() before it demolishes. */
export function canReplaceBuilding(
  game: Game,
  pos: MapPos,
  type: BuildingType,
  player: Player,
): boolean {
  const site = game.getReplaceSiteClass(pos, player);
  if (site < 0) return false;

  let need = 1;
  switch (type) {
    case BuildingType.TypeStoneMine:
    case BuildingType.TypeCoalMine:
    case BuildingType.TypeIronMine:
    case BuildingType.TypeGoldMine:
      need = 0;
      break;
    case BuildingType.TypeFisher:
    case BuildingType.TypeLumberjack:
    case BuildingType.TypeBoatbuilder:
    case BuildingType.TypeStonecutter:
    case BuildingType.TypeForester:
    case BuildingType.TypeHut:
    case BuildingType.TypeMill:
      need = 1;
      break;
    default:
      need = 2;
      break;
  }
  if (need === 0 ? site !== 0 : site === 0 || site < need) {
    return false;
  }

  if (
    (type === BuildingType.TypeHut ||
      type === BuildingType.TypeTower ||
      type === BuildingType.TypeFortress) &&
    !game.canBuildMilitary(pos, true)
  ) {
    return false;
  }

  return true;
}

/* Whether one of the player's inventories has a geologist, or a free serf
   and a hammer for one. Game::send_geologist() also needs a road from that
   inventory to the flag; the search for it marks the flags, so it cannot be
   run here. */
export function canSendGeologist(game: Game, pos: MapPos, player: Player): boolean {
  const flag = game.getFlagAtPos(pos);
  if (flag === null || flag.getOwner() !== player.getIndex()) return false;

  for (const inventory of game.getPlayerInventories(player)) {
    if (
      inventory.haveSerf(SerfType.TypeGeologist) ||
      (inventory.haveSerf(SerfType.TypeGeneric) &&
        inventory.getCountOf(ResourceType.TypeHammer) > 0)
    ) {
      return true;
    }
  }
  return false;
}

/* Whether Player::promote_serfs_to_knights() would promote at least one
   serf: a free serf idle in an inventory with a sword and a shield. */
export function canPromoteSerfsToKnights(game: Game, player: Player): boolean {
  for (const serf of game.getPlayerSerfs(player)) {
    if (serf.getState() === SerfState.StateIdleInStock && serf.getType() === SerfType.TypeGeneric) {
      const inv = game.getInventory(serf.getIdleInStockInvIndex());
      if (
        inv !== null &&
        inv.getCountOf(ResourceType.TypeSword) !== 0 &&
        inv.getCountOf(ResourceType.TypeShield) !== 0
      ) {
        return true;
      }
    }
  }
  return false;
}

// EXT (game options and teams): the rules that forbid an attack.

/* Why the rules of the game forbid the player an attack on the building at
   pos: it is an ally's, or the peace timer runs. '' when they allow it. */
export type AttackRefusal = '' | 'ally' | 'peace';

export function attackRefusal(game: Game, pos: MapPos, player: Player): AttackRefusal {
  const building = game.getBuildingAtPos(pos);
  if (building !== null && game.isAllied(player.getIndex(), building.getOwner())) return 'ally';
  if (game.isPeace()) return 'peace';
  return '';
}

/* Whether the attack window has something to say about the building at
   pos: a building the player could attack by the checks of the original,
   or a finished military building of an ally (which never is one). */
export function isAttackBoxTarget(game: Game, pos: MapPos, player: Player): boolean {
  if (isAttackTarget(game, pos, player)) return true;
  const building = game.getBuildingAtPos(pos);
  return building !== null && !building.isBurning() && building.isDone() &&
    building.isMilitary() && game.isAllied(player.getIndex(), building.getOwner());
}

/* Whether the player may attack the building at pos: the checks of the
   click on a foreign building in the viewport, and the rules above. The
   startAttack command asks here when it runs. */
export function canAttack(game: Game, pos: MapPos, player: Player): boolean {
  return isAttackTarget(game, pos, player) && attackRefusal(game, pos, player) === '';
}

// EXT: end of the block.

/* The checks of the click on a foreign building in the viewport. */
function isAttackTarget(game: Game, pos: MapPos, player: Player): boolean {
  const map = game.getMap();
  const building = game.getBuildingAtPos(pos);
  if (building === null || building.isBurning()) return false;
  if (map.getOwner(pos) === player.getIndex()) return false;
  if (!building.isDone() || !building.isMilitary()) return false;

  /* It is not allowed to attack if currently not occupied or is too far
     from the border. */
  if (!building.isActive() || building.getThreatLevel() !== 3) return false;

  for (let i = 257; i >= 0; i--) {
    const p = map.posAddSpirally(building.getPosition(), 7 + 257 - i);
    if (map.hasOwner(p) && map.getOwner(p) === player.getIndex()) {
      return true;
    }
  }
  return false;
}

export interface AttackPreview {
  attackingKnights: number[]; /* By distance, 4 entries. */
  totalAttackingKnights: number;
  attackingBuildingCount: number;
}

/* The knights the player could send against the building at pos, for the
   attack box. Player::knights_available_for_attack() keeps its result in
   the player; its fields are put back, so that the game state is the same
   after the call. The command handler computes them again. */
export function previewAttack(player: Player, pos: MapPos): AttackPreview {
  const savedKnights = player.attackingKnights.slice();
  const savedBuildings = player.attackingBuildings.slice();
  const savedCount = player.attackingBuildingCount;
  const savedTotal = player.totalAttackingKnights;

  player.knightsAvailableForAttack(pos);
  const preview: AttackPreview = {
    attackingKnights: player.attackingKnights.slice(),
    totalAttackingKnights: player.totalAttackingKnights,
    attackingBuildingCount: player.attackingBuildingCount,
  };

  for (let i = 0; i < savedKnights.length; i++) player.attackingKnights[i] = savedKnights[i];
  for (let i = 0; i < savedBuildings.length; i++) player.attackingBuildings[i] = savedBuildings[i];
  player.attackingBuildingCount = savedCount;
  player.totalAttackingKnights = savedTotal;

  return preview;
}

// ---------------------------------------------------------------------------
// Construction and demolition.

/* buildCastle { pos } */
register('buildCastle', (game, player, cmd) => {
  if (!isPos(game, cmd.pos)) return;
  game.buildCastle(cmd.pos, player);
});

export function cmdBuildCastle(game: Game, pos: MapPos): void {
  issue(game, { type: 'buildCastle', pos });
}

/* buildFlag { pos } */
register('buildFlag', (game, player, cmd) => {
  if (!isPos(game, cmd.pos)) return;
  game.buildFlag(cmd.pos, player);
});

export function cmdBuildFlag(game: Game, pos: MapPos): void {
  issue(game, { type: 'buildFlag', pos });
}

/* buildBuilding { pos, building } */
register('buildBuilding', (game, player, cmd) => {
  if (!isPos(game, cmd.pos) || !isBuildableType(cmd.building)) return;
  game.buildBuilding(cmd.pos, cmd.building, player);
});

export function cmdBuildBuilding(game: Game, pos: MapPos, type: BuildingType): void {
  issue(game, { type: 'buildBuilding', pos, building: type });
}

/* replaceBuilding { pos, building }: demolish the own building at pos and
   build the new type on the site once it has burned down. */
register('replaceBuilding', (game, player, cmd) => {
  if (!isPos(game, cmd.pos) || !isBuildableType(cmd.building)) return;
  game.replaceBuilding(cmd.pos, cmd.building, player);
});

export function cmdReplaceBuilding(game: Game, pos: MapPos, type: BuildingType): void {
  issue(game, { type: 'replaceBuilding', pos, building: type });
}

/* What buildRoad does about a flag at the end of the road. */
export enum RoadFlag {
  /* The road ends at an existing flag. */
  None = 0,
  /* The last step goes onto an existing road: a flag is built there, which
     splits that road (special click). The flag stays if the road fails. */
  Join = 1,
  /* A flag is built at the free end of the road (special click). The flag
     stays if the road fails. */
  End = 2,
  /* A flag is built at the end of the road (double click on the end); it is
     demolished again if the road cannot be built. */
  EndOrUndo = 3,
}

/* buildRoad { start, dirs, flag }: start is the position of the flag the
   road begins at, dirs the directions of its segments, flag a RoadFlag. */
register('buildRoad', (game, player, cmd) => {
  if (!isPos(game, cmd.start) || !isInt(cmd.flag, RoadFlag.None, RoadFlag.EndOrUndo)) return;
  const dirs = cmd.dirs;
  if (!Array.isArray(dirs) || dirs.length > Road.maxLength) return;
  for (const dir of dirs) {
    if (!isInt(dir, 0, 5)) return;
  }

  const map = game.getMap();
  const road = new Road();
  road.start(cmd.start);
  for (const dir of dirs) {
    road.extend(dir as Direction);
  }

  switch (cmd.flag as RoadFlag) {
    case RoadFlag.None:
      game.buildRoad(road, player);
      break;
    case RoadFlag.Join: {
      if (dirs.length === 0) return;
      /* The position before the last step. */
      let pos: MapPos = cmd.start;
      for (let i = 0; i < dirs.length - 1; i++) {
        pos = map.move(pos, dirs[i] as Direction);
      }
      const dir = dirs[dirs.length - 1] as Direction;
      if (!game.canJoinRoad(pos, dir, player)) return;
      if (!game.buildFlag(map.move(pos, dir), player)) return;
      game.buildRoad(road, player);
      break;
    }
    case RoadFlag.End: {
      const dest = { value: 0 };
      if (game.canBuildRoad(road, player, dest, null) <= 0) return;
      if (map.paths(dest.value) !== 0) return;
      if (game.canBuildFlag(dest.value, player) && game.buildFlag(dest.value, player)) {
        game.buildRoad(road, player);
      }
      break;
    }
    case RoadFlag.EndOrUndo: {
      const end = road.getEnd(map);
      if (!game.buildFlag(end, player)) return;
      if (!game.buildRoad(road, player)) {
        game.demolishFlag(end, player);
      }
      break;
    }
  }
});

export function cmdBuildRoad(game: Game, road: Road, flag: RoadFlag = RoadFlag.None): void {
  issue(game, {
    type: 'buildRoad',
    start: road.getSource(),
    dirs: road.getDirs().map((dir) => dir as number),
    flag,
  });
}

/* demolishFlag { pos }: the player's own flag, if it can be removed. */
register('demolishFlag', (game, player, cmd) => {
  if (!isPos(game, cmd.pos)) return;
  const map = game.getMap();
  if (map.getObj(cmd.pos) !== MapObject.ObjectFlag || map.getOwner(cmd.pos) !== player.getIndex()) {
    return;
  }
  game.demolishFlag(cmd.pos, player);
});

export function cmdDemolishFlag(game: Game, pos: MapPos): void {
  issue(game, { type: 'demolishFlag', pos });
}

/* demolishBuilding { pos }: the player's own building (not the castle). */
register('demolishBuilding', (game, player, cmd) => {
  if (!isPos(game, cmd.pos)) return;
  const map = game.getMap();
  if (
    (map.getObj(cmd.pos) !== MapObject.ObjectSmallBuilding &&
      map.getObj(cmd.pos) !== MapObject.ObjectLargeBuilding) ||
    map.getOwner(cmd.pos) !== player.getIndex()
  ) {
    return;
  }
  if (ownBuildingAt(game, player, cmd.pos) === null) return;
  game.demolishBuilding(cmd.pos, player);
});

export function cmdDemolishBuilding(game: Game, pos: MapPos): void {
  issue(game, { type: 'demolishBuilding', pos });
}

/* demolishRoad { pos }: the road through pos. */
register('demolishRoad', (game, player, cmd) => {
  if (!isPos(game, cmd.pos)) return;
  game.demolishRoad(cmd.pos, player);
});

export function cmdDemolishRoad(game: Game, pos: MapPos): void {
  issue(game, { type: 'demolishRoad', pos });
}

/* pullRoadsThroughFlag { pos }: lead the roads that pass the player's flag
   at pos around a corner through the flag. */
register('pullRoadsThroughFlag', (game, player, cmd) => {
  if (!isPos(game, cmd.pos)) return;
  const flag = game.getFlagAtPos(cmd.pos);
  if (flag === null || flag.getOwner() !== player.getIndex()) return;
  game.pullRoadsThroughFlag(cmd.pos, player);
});

export function cmdPullRoadsThroughFlag(game: Game, pos: MapPos): void {
  issue(game, { type: 'pullRoadsThroughFlag', pos });
}

/* sendGeologist { pos }: to the player's flag at pos. */
register('sendGeologist', (game, player, cmd) => {
  if (!isPos(game, cmd.pos)) return;
  const flag = game.getFlagAtPos(cmd.pos);
  if (flag === null || flag.getOwner() !== player.getIndex()) return;
  game.sendGeologist(flag);
});

export function cmdSendGeologist(game: Game, pos: MapPos): void {
  issue(game, { type: 'sendGeologist', pos });
}

// ---------------------------------------------------------------------------
// Inventories (castle and stocks).

/* setInventoryResourceMode { pos, mode }: pos is the position of the castle
   or stock, mode 0 in, 1 stop, 2 out. */
register('setInventoryResourceMode', (game, player, cmd) => {
  if (!isPos(game, cmd.pos) || !isInt(cmd.mode, 0, 2)) return;
  const building = ownBuildingAt(game, player, cmd.pos);
  if (building === null) return;
  const inventory = building.getInventory();
  if (inventory === null) return;
  game.setInventoryResourceMode(inventory, cmd.mode);
});

export function cmdSetInventoryResourceMode(game: Game, pos: MapPos, mode: number): void {
  issue(game, { type: 'setInventoryResourceMode', pos, mode });
}

/* setInventorySerfMode { pos, mode }: as above, for the serfs. */
register('setInventorySerfMode', (game, player, cmd) => {
  if (!isPos(game, cmd.pos) || !isInt(cmd.mode, 0, 2)) return;
  const building = ownBuildingAt(game, player, cmd.pos);
  if (building === null) return;
  const inventory = building.getInventory();
  if (inventory === null) return;
  game.setInventorySerfMode(inventory, cmd.mode);
});

export function cmdSetInventorySerfMode(game: Game, pos: MapPos, mode: number): void {
  issue(game, { type: 'setInventorySerfMode', pos, mode });
}

// ---------------------------------------------------------------------------
// Distribution of food, planks, steel, coal and wheat (the slide bars).

const distributionSetters = {
  setFoodStonemine: (player: Player, value: number) => player.setFoodStonemine(value),
  setFoodCoalmine: (player: Player, value: number) => player.setFoodCoalmine(value),
  setFoodIronmine: (player: Player, value: number) => player.setFoodIronmine(value),
  setFoodGoldmine: (player: Player, value: number) => player.setFoodGoldmine(value),
  setPlanksConstruction: (player: Player, value: number) => player.setPlanksConstruction(value),
  setPlanksBoatbuilder: (player: Player, value: number) => player.setPlanksBoatbuilder(value),
  setPlanksToolmaker: (player: Player, value: number) => player.setPlanksToolmaker(value),
  setSteelToolmaker: (player: Player, value: number) => player.setSteelToolmaker(value),
  setSteelWeaponsmith: (player: Player, value: number) => player.setSteelWeaponsmith(value),
  setCoalSteelsmelter: (player: Player, value: number) => player.setCoalSteelsmelter(value),
  setCoalGoldsmelter: (player: Player, value: number) => player.setCoalGoldsmelter(value),
  setCoalWeaponsmith: (player: Player, value: number) => player.setCoalWeaponsmith(value),
  setWheatPigfarm: (player: Player, value: number) => player.setWheatPigfarm(value),
  setWheatMill: (player: Player, value: number) => player.setWheatMill(value),
};

export type DistributionSetting = keyof typeof distributionSetters;

/* setFoodStonemine { value } and the 13 others of distributionSetters: one
   command type per slide bar, value 0..65535. */
for (const name of Object.keys(distributionSetters) as DistributionSetting[]) {
  register(name, (_game, player, cmd) => {
    if (!isInt(cmd.value, 0, 0xffff)) return;
    distributionSetters[name](player, cmd.value);
  });
}

export function cmdSetDistribution(game: Game, setting: DistributionSetting, value: number): void {
  issue(game, { type: setting, value });
}

/* setToolPrio { tool, value }: tool 0..8 (shovel, hammer, rod, cleaver,
   scythe, axe, saw, pick, pincer), value 0..65535. */
register('setToolPrio', (_game, player, cmd) => {
  if (!isInt(cmd.tool, 0, 8) || !isInt(cmd.value, 0, 0xffff)) return;
  player.setToolPrio(cmd.tool, cmd.value);
});

export function cmdSetToolPrio(game: Game, tool: number, value: number): void {
  issue(game, { type: 'setToolPrio', tool, value });
}

const priorityResets = {
  resetFoodPriority: (player: Player) => player.resetFoodPriority(),
  resetPlanksPriority: (player: Player) => player.resetPlanksPriority(),
  resetSteelPriority: (player: Player) => player.resetSteelPriority(),
  resetCoalPriority: (player: Player) => player.resetCoalPriority(),
  resetWheatPriority: (player: Player) => player.resetWheatPriority(),
  resetToolPriority: (player: Player) => player.resetToolPriority(),
  resetFlagPriority: (player: Player) => player.resetFlagPriority(),
  resetInventoryPriority: (player: Player) => player.resetInventoryPriority(),
};

export type PriorityReset = keyof typeof priorityResets;

/* resetFoodPriority {} and the 7 others of priorityResets: back to the
   defaults. */
for (const name of Object.keys(priorityResets) as PriorityReset[]) {
  register(name, (_game, player) => {
    priorityResets[name](player);
  });
}

export function cmdResetPriority(game: Game, which: PriorityReset): void {
  issue(game, { type: which });
}

/* movePriority { inventory, item, up, toEnd }: move a resource in the order
   of the flag priorities (inventory false) or of the inventory priorities
   (inventory true). item is the resource type 0..25; up and toEnd as the
   four buttons of the box: one step or all the way, up or down. */
register('movePriority', (_game, player, cmd) => {
  if (
    typeof cmd.inventory !== 'boolean' ||
    !isInt(cmd.item, 0, 25) ||
    typeof cmd.up !== 'boolean' ||
    typeof cmd.toEnd !== 'boolean'
  ) {
    return;
  }

  const prio = cmd.inventory ? player.getInventoryPrio() : player.getFlagPrio();
  const cur = cmd.item;

  const curValue = prio[cur];
  let nextValue = -1;
  if (cmd.up) {
    if (cmd.toEnd) {
      nextValue = 26;
    } else {
      nextValue = curValue + 1;
    }
  } else {
    if (cmd.toEnd) {
      nextValue = 1;
    } else {
      nextValue = curValue - 1;
    }
  }

  if (nextValue >= 1 && nextValue < 27) {
    const delta = nextValue > curValue ? -1 : 1;
    const min = nextValue > curValue ? curValue + 1 : nextValue;
    const max = nextValue > curValue ? nextValue : curValue - 1;
    for (let i = 0; i < 26; i++) {
      if (prio[i] >= min && prio[i] <= max) prio[i] += delta;
    }
    prio[cur] = nextValue;
  }
});

export function cmdMovePriority(
  game: Game,
  inventory: boolean,
  item: number,
  up: boolean,
  toEnd: boolean,
): void {
  issue(game, { type: 'movePriority', inventory, item, up, toEnd });
}

// ---------------------------------------------------------------------------
// Knights.

/* changeKnightOccupation { level, adjustMax, delta }: level is the threat
   level 0..3, adjustMax whether the maximum or the minimum changes, delta
   -1 or 1. */
register('changeKnightOccupation', (_game, player, cmd) => {
  if (
    !isInt(cmd.level, 0, 3) ||
    typeof cmd.adjustMax !== 'boolean' ||
    (cmd.delta !== -1 && cmd.delta !== 1)
  ) {
    return;
  }
  player.changeKnightOccupation(cmd.level, cmd.adjustMax ? 1 : 0, cmd.delta);
});

export function cmdChangeKnightOccupation(
  game: Game,
  level: number,
  adjustMax: boolean,
  delta: number,
): void {
  issue(game, { type: 'changeKnightOccupation', level, adjustMax, delta });
}

/* setSerfToKnightRate { value }: 0..65535. */
register('setSerfToKnightRate', (_game, player, cmd) => {
  if (!isInt(cmd.value, 0, 0xffff)) return;
  player.setSerfToKnightRate(cmd.value);
});

export function cmdSetSerfToKnightRate(game: Game, value: number): void {
  issue(game, { type: 'setSerfToKnightRate', value });
}

/* promoteSerfsToKnights { number }: the train buttons, 1, 5, 20 or 100. */
register('promoteSerfsToKnights', (_game, player, cmd) => {
  if (!isInt(cmd.number, 1, 100)) return;
  player.promoteSerfsToKnights(cmd.number);
});

export function cmdPromoteSerfsToKnights(game: Game, number: number): void {
  issue(game, { type: 'promoteSerfsToKnights', number });
}

/* setSendStrongest { strongest }: send the strongest or the weakest knights
   to fight. */
register('setSendStrongest', (_game, player, cmd) => {
  if (typeof cmd.strongest !== 'boolean') return;
  if (cmd.strongest) {
    player.setSendStrongest();
  } else {
    player.dropSendStrongest();
  }
});

export function cmdSetSendStrongest(game: Game, strongest: boolean): void {
  issue(game, { type: 'setSendStrongest', strongest });
}

/* cycleKnights {} */
register('cycleKnights', (_game, player) => {
  player.cycleKnights();
});

export function cmdCycleKnights(game: Game): void {
  issue(game, { type: 'cycleKnights' });
}

/* changeCastleKnightsWanted { delta }: -1 or 1. */
register('changeCastleKnightsWanted', (_game, player, cmd) => {
  if (cmd.delta === 1) {
    player.increaseCastleKnightsWanted();
  } else if (cmd.delta === -1) {
    player.decreaseCastleKnightsWanted();
  }
});

export function cmdChangeCastleKnightsWanted(game: Game, delta: number): void {
  issue(game, { type: 'changeCastleKnightsWanted', delta });
}

/* startAttack { pos, knights }: attack the foreign military building at pos
   with (up to) the number of knights. The attack box computes the knights
   that are available when it opens; they are computed again here. */
register('startAttack', (game, player, cmd) => {
  if (!isPos(game, cmd.pos) || !isInt(cmd.knights, 1, 0xffff)) return;
  if (!canAttack(game, cmd.pos, player)) return;
  const building = game.getBuildingAtPos(cmd.pos)!;

  player.buildingAttacked = building.getIndex();
  const knights = player.knightsAvailableForAttack(building.getPosition());
  player.knightsAttacking = Math.min(cmd.knights, knights);

  if (player.knightsAttacking > 0) {
    if (player.attackingBuildingCount > 0) {
      player.startAttack();
    }
  }
});

export function cmdStartAttack(game: Game, pos: MapPos, knights: number): void {
  issue(game, { type: 'startAttack', pos, knights });
}

// ---------------------------------------------------------------------------
// Timers.

/* addTimer { timeout, pos }: a "call to location" message for pos after
   timeout ticks. */
register('addTimer', (game, player, cmd) => {
  if (!isInt(cmd.timeout, 1, 0x7fffffff) || !isPos(game, cmd.pos)) return;
  player.addTimer(cmd.timeout, cmd.pos);
});

export function cmdAddTimer(game: Game, timeout: number, pos: MapPos): void {
  issue(game, { type: 'addTimer', timeout, pos });
}

// ---------------------------------------------------------------------------
// Game speed and pause. They change the tick stream that both sides have to
// agree on.

/* setPaused { paused }: explicit, not a toggle: two players that pause in
   the same update must not cancel each other. */
register('setPaused', (game, _player, cmd) => {
  if (typeof cmd.paused !== 'boolean') return;
  if (game.isPaused() !== cmd.paused) {
    game.pause();
  }
});

export function cmdSetPaused(game: Game, paused: boolean): void {
  issue(game, { type: 'setPaused', paused });
}

/* setSpeed { speed }: 2 is normal speed, 4 twice, 8 four times as fast. */
register('setSpeed', (game, _player, cmd) => {
  const speed = cmd.speed;
  if (typeof speed !== 'number' || !Number.isInteger(speed) || speed < 1 || speed > 40) return;
  game.setSpeed(speed);
});

export function cmdSetSpeed(game: Game, speed: number): void {
  issue(game, { type: 'setSpeed', speed });
}

/* speedIncrease {} */
register('speedIncrease', (game) => {
  game.speedIncrease();
});

export function cmdSpeedIncrease(game: Game): void {
  issue(game, { type: 'speedIncrease' });
}

/* speedDecrease {} */
register('speedDecrease', (game) => {
  game.speedDecrease();
});

export function cmdSpeedDecrease(game: Game): void {
  issue(game, { type: 'speedDecrease' });
}

/* speedReset {} */
register('speedReset', (game) => {
  game.speedReset();
});

export function cmdSpeedReset(game: Game): void {
  issue(game, { type: 'speedReset' });
}

// ---------------------------------------------------------------------------
// EXT: building controls (not part of Freeserf): pause and output cap of a
// production building, upgrade of a guard hut or tower in place. This block
// is all of it in this file.

/* The player's own finished building at pos whose production can be paused
   (isProductionBuilding of building.ts), or null. */
function ownProductionBuildingAt(game: Game, player: Player, pos: MapPos): Building | null {
  const building = ownBuildingAt(game, player, pos);
  if (building === null || !building.isDone()) return null;
  if (!isProductionBuilding(building.getType())) return null;
  return building;
}

/* Whether the player may pause the building at pos. */
export function canPauseBuilding(game: Game, pos: MapPos, player: Player): boolean {
  return ownProductionBuildingAt(game, player, pos) !== null;
}

/* Whether the building at pos takes an output cap: a production building
   with one output (not the forester, the toolmaker or the weaponsmith). */
export function canCapBuilding(game: Game, pos: MapPos, player: Player): boolean {
  const building = ownProductionBuildingAt(game, player, pos);
  return building !== null && productionOutput(building.getType()) !== ResourceType.TypeNone;
}

/* Why the player may not upgrade the building at pos, or
   UpgradeRefusal.None (Game::getUpgradeRefusal). */
export function upgradeRefusal(game: Game, pos: MapPos, player: Player): UpgradeRefusal {
  return game.getUpgradeRefusal(pos, player);
}

/* setBuildingPaused { pos, paused }: pause or resume the player's own
   production building at pos. Explicit, not a toggle. */
register('setBuildingPaused', (game, player, cmd) => {
  if (!isPos(game, cmd.pos) || typeof cmd.paused !== 'boolean') return;
  const building = ownProductionBuildingAt(game, player, cmd.pos);
  if (building === null) return;
  building.setProductionPaused(cmd.paused);
});

export function cmdSetBuildingPaused(game: Game, pos: MapPos, paused: boolean): void {
  issue(game, { type: 'setBuildingPaused', pos, paused });
}

/* setBuildingCap { pos, cap }: the player's own production building at pos
   starts no new work while his inventories hold cap or more of its output.
   cap is one of productionCapSteps (0 is off). */
register('setBuildingCap', (game, player, cmd) => {
  if (!isPos(game, cmd.pos) || !isInt(cmd.cap, 0, 0xffff)) return;
  if (!productionCapSteps.includes(cmd.cap)) return;
  if (!canCapBuilding(game, cmd.pos, player)) return;
  const building = ownProductionBuildingAt(game, player, cmd.pos)!;
  building.setProductionCap(cmd.cap);
});

export function cmdSetBuildingCap(game: Game, pos: MapPos, cap: number): void {
  issue(game, { type: 'setBuildingCap', pos, cap });
}

/* upgradeBuilding { pos }: upgrade the player's own guard hut or tower at
   pos in place (Game::upgradeBuilding checks everything again). */
register('upgradeBuilding', (game, player, cmd) => {
  if (!isPos(game, cmd.pos)) return;
  game.upgradeBuilding(cmd.pos, player);
});

export function cmdUpgradeBuilding(game: Game, pos: MapPos): void {
  issue(game, { type: 'upgradeBuilding', pos });
}

// EXT: end of the building controls block.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// EXT: trading between players (not part of Freeserf; game/trade.ts has the
// rule). This block is all of it in this file. Every command does nothing
// in a game without the option.

/* Why the player may not offer the goods from his castle or storehouse at
   pos, or TradeRefusal.None (Trade.offerRefusal). */
export function tradeOfferRefusal(game: Game, player: Player, pos: MapPos, to: number,
                                  give: ResourceType, giveCount: number,
                                  want: ResourceType, wantCount: number): TradeRefusal {
  if (!isPos(game, pos)) return TradeRefusal.Stock;
  return game.trade.offerRefusal(player, pos, to, give, giveCount, want, wantCount);
}

/* Why the player may not accept the offer with his castle or storehouse at
   pos, or TradeRefusal.None (Trade.acceptRefusal). */
export function tradeAcceptRefusal(game: Game, player: Player, id: number,
                                   pos: MapPos): TradeRefusal {
  if (!isPos(game, pos)) return TradeRefusal.Stock;
  return game.trade.acceptRefusal(player, id, pos);
}

/* tradeOffer { pos, to, give, giveCount, want, wantCount }: offer giveCount
   of the resource give from the player's castle or storehouse at pos to the
   player `to`, for wantCount of the resource want. A gift has want -1 and
   wantCount 0. */
register('tradeOffer', (game, player, cmd) => {
  if (!isPos(game, cmd.pos)) return;
  if (!isInt(cmd.to, 0, 3) || !isInt(cmd.give, 0, 25) || !isInt(cmd.giveCount, 1, 0xffff) ||
      !isInt(cmd.want, -1, 25) || !isInt(cmd.wantCount, 0, 0xffff)) {
    return;
  }
  game.trade.makeOffer(player, cmd.pos, cmd.to, cmd.give, cmd.giveCount, cmd.want, cmd.wantCount);
});

export function cmdTradeOffer(game: Game, pos: MapPos, to: number, give: ResourceType,
                              giveCount: number, want: ResourceType, wantCount: number): void {
  issue(game, { type: 'tradeOffer', pos, to, give, giveCount, want, wantCount });
}

/* tradeAccept { id, pos }: accept the offer id that another player made to
   this one. What he wants leaves the player's castle or storehouse at pos,
   and what he gives arrives there. */
register('tradeAccept', (game, player, cmd) => {
  if (!isPos(game, cmd.pos) || !isInt(cmd.id, 1, 0x7fffffff)) return;
  game.trade.acceptOffer(player, cmd.id, cmd.pos);
});

export function cmdTradeAccept(game: Game, id: number, pos: MapPos): void {
  issue(game, { type: 'tradeAccept', id, pos });
}

/* tradeDecline { id }: say no to the offer id that was made to the player. */
register('tradeDecline', (game, player, cmd) => {
  if (!isInt(cmd.id, 1, 0x7fffffff)) return;
  game.trade.declineOffer(player, cmd.id);
});

export function cmdTradeDecline(game: Game, id: number): void {
  issue(game, { type: 'tradeDecline', id });
}

/* tradeCancel { id }: take back the offer id that the player made. */
register('tradeCancel', (game, player, cmd) => {
  if (!isInt(cmd.id, 1, 0x7fffffff)) return;
  game.trade.cancelOffer(player, cmd.id);
});

export function cmdTradeCancel(game: Game, id: number): void {
  issue(game, { type: 'tradeCancel', id });
}

// EXT: end of the trade block.
// ---------------------------------------------------------------------------
