// Names and orders that several menus need: the serf types in words, the
// resources as labels and the order the boxes of the game list them in.
// The names of the resources and the buildings are in ../production.ts.
// Not part of Freeserf.

import { ResourceType } from '../../game/resource';
import { SerfType } from '../../game/serf';
import { resourceName } from '../production';

/* "Planks", "Iron ore": the name of production.ts with a capital. */
export function resourceLabel(res: ResourceType): string {
  const name = resourceName(res);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const R = ResourceType;

/* The resources in the order of the stock boxes of popup.ts
   (drawResourcesBox): materials, tools, weapons, food. */
export const resourceBoxOrder: ResourceType[] = [
  R.TypeLumber, R.TypePlank, R.TypeBoat, R.TypeStone, R.TypeCoal, R.TypeIronOre,
  R.TypeSteel, R.TypeGoldOre, R.TypeGoldBar,
  R.TypeShovel, R.TypeHammer, R.TypeAxe, R.TypeSaw, R.TypeScythe, R.TypePick,
  R.TypePincer, R.TypeCleaver, R.TypeRod,
  R.TypeSword, R.TypeShield,
  R.TypeFish, R.TypePig, R.TypeMeat, R.TypeWheat, R.TypeFlour, R.TypeBread,
];

const S = SerfType;

const serfNames: { [type: number]: string } = {
  [S.TypeTransporter]: 'Carrier',
  [S.TypeSailor]: 'Sailor',
  [S.TypeDigger]: 'Digger',
  [S.TypeBuilder]: 'Builder',
  [S.TypeTransporterInventory]: 'Carrier',
  [S.TypeLumberjack]: 'Woodcutter',
  [S.TypeSawmiller]: 'Sawmiller',
  [S.TypeStonecutter]: 'Stonecutter',
  [S.TypeForester]: 'Forester',
  [S.TypeMiner]: 'Miner',
  [S.TypeSmelter]: 'Smelter',
  [S.TypeFisher]: 'Fisher',
  [S.TypePigFarmer]: 'Pig farmer',
  [S.TypeButcher]: 'Butcher',
  [S.TypeFarmer]: 'Farmer',
  [S.TypeMiller]: 'Miller',
  [S.TypeBaker]: 'Baker',
  [S.TypeBoatBuilder]: 'Boat builder',
  [S.TypeToolmaker]: 'Toolmaker',
  [S.TypeWeaponSmith]: 'Weaponsmith',
  [S.TypeGeologist]: 'Geologist',
  [S.TypeGeneric]: 'Serf without a job',
  [S.TypeKnight0]: 'Knight, rank 1',
  [S.TypeKnight1]: 'Knight, rank 2',
  [S.TypeKnight2]: 'Knight, rank 3',
  [S.TypeKnight3]: 'Knight, rank 4',
  [S.TypeKnight4]: 'Knight, rank 5',
};

export function serfName(type: SerfType): string {
  return serfNames[type] ?? 'Serf';
}

/* The serf types in the order of the serf boxes of popup.ts
   (drawSerfsBox): carriers and builders, knights from the highest rank,
   the trades. */
export const serfBoxOrder: SerfType[] = [
  S.TypeTransporter, S.TypeSailor, S.TypeDigger, S.TypeBuilder,
  S.TypeKnight4, S.TypeKnight3, S.TypeKnight2, S.TypeKnight1, S.TypeKnight0,
  S.TypeLumberjack, S.TypeSawmiller, S.TypeSmelter, S.TypeStonecutter, S.TypeForester,
  S.TypeMiner, S.TypeBoatBuilder, S.TypeToolmaker, S.TypeWeaponSmith,
  S.TypeFisher, S.TypePigFarmer, S.TypeButcher, S.TypeFarmer, S.TypeMiller, S.TypeBaker,
  S.TypeGeologist, S.TypeGeneric,
];

// ---------------------------------------------------------------------------
// EXT: game options and teams (game.ts), as the setup window, the
// statistics, the attack window and the end of the game name them.

/* "Team A", "Team B", or '' for a player without a team. */
export function teamName(team: number): string {
  return team === 1 ? 'Team A' : team === 2 ? 'Team B' : '';
}

/* How one player stands to another: "you", "ally", "enemy". Without teams
   in the game nobody is called an enemy: '' then. */
export function relationName(
  game: { isAllied(a: number, b: number): boolean; hasTeams(): boolean },
  local: number,
  other: number,
): string {
  if (local === other) return 'you';
  if (game.isAllied(local, other)) return 'ally';
  return game.hasTeams() ? 'enemy' : '';
}

/* The stock presets by their value (STOCK_NORMAL 0, STOCK_POOR 1,
   STOCK_RICH 2). */
export function stockPresetName(preset: number): string {
  return preset === 1 ? 'Poor' : preset === 2 ? 'Rich' : 'Normal';
}

/* Game ticks as "12:05" (minutes and seconds of game time: 100 ticks a
   second), rounded up to the second. */
export function ticksAsClock(ticks: number): string {
  const seconds = Math.ceil(ticks / 100);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
