// What each building needs and makes, for the build menu, the production
// chains view and the alerts. Not part of Freeserf.
//
// The simulation has no single table of this: the input stocks of a building
// are set when its worker walks in (Serf::handle_serf_entering_building_state
// in src/game/serf.ts, the `building.stockInit(...)` calls) and the output is
// the resource the worker's state hands out. Each entry below names the code
// that makes it true. The cost of the construction and the size of the site
// are read from constInfo() of src/game/building.ts, not repeated here.

import { BuildingType, constInfo } from '../game/building';
import { MapObject } from '../game/map';
import { ResourceType } from '../game/resource';

export type BuildGroup = 'wood' | 'food' | 'mining' | 'military' | 'storage';

export const buildGroups: { id: BuildGroup; title: string }[] = [
  { id: 'wood', title: 'Wood and stone' },
  { id: 'food', title: 'Food' },
  { id: 'mining', title: 'Mining and metal' },
  { id: 'military', title: 'Military' },
  { id: 'storage', title: 'Storage and transport' },
];

export interface BuildingInfo {
  type: BuildingType;
  name: string;
  group: BuildGroup;
  /* Resources the finished building takes in (its stock[] types). */
  needs: ResourceType[];
  /* Resources its worker hands out. */
  makes: ResourceType[];
  /* Words for the output where one icon per resource would not do. */
  makesText?: string;
  /* What it does, where it neither takes nor makes a resource, or a word
     put before the output ("cuts trees"). */
  does?: string;
  /* Tools the worker is made with (Building::request_serf_if_needed). */
  tools: ResourceType[];
  /* Set where the work is not one unit of each input for one unit of
     output; see the ratio notes below. */
  ratio?: Ratio;
}

export interface Ratio {
  /* How many of each of `needs`, in its order. */
  needs: string[];
  /* How many of each of `makes`, in its order. */
  makes: string[];
  /* One sentence on why, for the detail line and the tooltips. */
  note: string;
}

// Ratios, read from the state handlers of src/game/serf.ts and the stock
// methods of src/game/building.ts. Every handler takes its input with
// Building::useResourceInStock(n) (one unit of stock n) or
// Building::useResourcesInStocks() (one unit of stock 0 and one of stock 1)
// and hands out one resource through StateMoveResourceOut. One in, one out:
//   sawmill       handleSerfSawingState: useResourceInStock(1), one plank.
//   mill          handleSerfMillingState: useResourceInStock(0), one flour.
//   baker         handleSerfBakingState: useResourceInStock(0), one bread.
//   butcher       handleSerfButcheringState: useResourceInStock(0), one meat.
//   boat builder  handleSerfBuildingBoatState: useResourceInStock(0), one boat.
//   smelters      handleSerfSmeltingState: useResourcesInStocks(), one steel
//                 or one gold bar.
//   toolmaker     handleSerfMakingToolState: useResourcesInStocks(), one
//                 tool, drawn by the player's tool priorities (at random
//                 when all are zero).
// The workers without input bring one unit per walk
// (handleSerfFreeWalkingStateDestReached: one dropResource each): one log
// per felled tree, one stone per walk to a rock, one wheat per reaped field,
// one fish per walk (handleSerfFishingState: up to ten casts, each catches
// by chance, so a fisher can come back with nothing). The forester plants
// one tree per walk.
// Not one for one:
//   weaponsmith   handleSerfMakingWeaponState: useResourcesInStocks() is
//                 called only while the building's sfx bit is clear. The
//                 sword made then sets the bit, the next round makes a
//                 shield without taking anything and clears it. One coal
//                 and one steel make a sword and a shield.
//   mines         handleSerfMiningState: substate 0 skips the meal when
//                 (randomInt() & 7) === 0, one round in eight; else substate
//                 1 takes one food (useResourceInStock(0)). Substates 4 to 7
//                 are four tries to find the deposit near the mine; a round
//                 that finds none ends with nothing (substate 10,
//                 mining.res === 0) and the food is gone. Seven food for
//                 eight loads at best, fewer loads as the ground runs out.
//   pig farm      handleSerfPigfarmingState: wheat is taken only in mode 0
//                 (useResourceInStock(0)). The farmer starts there once;
//                 after that a round that hands out no pig goes back to mode
//                 0 one time in sixteen ((randomInt() & 0xf) === 0) and to
//                 mode 1, without wheat, the other fifteen. After a pig he
//                 comes back in mode 6 (entering building, TypePigFarmer),
//                 again without wheat. Pigs breed by chance (breedingProb)
//                 three times a round. Playing these rules through five
//                 million rounds outside the game gave 8.6 pigs per wheat.
const mineRatio: Ratio = {
  needs: ['7'],
  makes: ['up to 8'],
  note: 'The miner eats before 7 loads in 8. A dig that finds nothing still costs the meal.',
};
const weaponRatio: Ratio = {
  needs: ['1', '1'],
  makes: ['1', '1'],
  note: 'One coal and one steel make a sword, then a shield.',
};
const pigRatio: Ratio = {
  needs: ['1'],
  makes: ['about 8'],
  note: 'The pigs breed by chance. The farmer takes wheat only now and then, about once per 8 pigs.',
};

const R = ResourceType;
const B = BuildingType;

export const buildingInfos: BuildingInfo[] = [
  // serf.ts handleSerfFreeWalkingStateDestReached, TypeLumberjack:
  // dropResource(TypeLumber). No stockInit: needs nothing delivered.
  // building.ts requestSerfIfNeeded: TypeLumberjack with TypeAxe.
  { type: B.TypeLumberjack, name: 'Woodcutter', group: 'wood', needs: [], makes: [R.TypeLumber], does: 'cuts trees', tools: [R.TypeAxe] },
  // serf.ts entering building, TypeForester: StatePlanningPlanting. Plants
  // trees, hands out nothing. requestSerfIfNeeded: TypeForester, no tool.
  { type: B.TypeForester, name: 'Forester', group: 'wood', needs: [], makes: [], does: 'plants trees for the woodcutter', tools: [] },
  // serf.ts free walking, TypeStonecutter: dropResource(TypeStone).
  // requestSerfIfNeeded: TypeStonecutter with TypePick.
  { type: B.TypeStonecutter, name: 'Stonecutter', group: 'wood', needs: [], makes: [R.TypeStone], does: 'cuts rocks', tools: [R.TypePick] },
  // serf.ts entering building, TypeSawmiller: stockInit(1, TypeLumber, 8);
  // handleSerfSawingState: useResourceInStock(1), then moves TypePlank out.
  // requestSerfIfNeeded: TypeSawmiller with TypeSaw.
  { type: B.TypeSawmill, name: 'Sawmill', group: 'wood', needs: [R.TypeLumber], makes: [R.TypePlank], tools: [R.TypeSaw] },

  // serf.ts free walking, TypeFisher: dropResource(TypeFish).
  // requestSerfIfNeeded: TypeFisher with TypeRod.
  { type: B.TypeFisher, name: 'Fisher', group: 'food', needs: [], makes: [R.TypeFish], does: 'fishes in water', tools: [R.TypeRod] },
  // serf.ts free walking, TypeFarmer: dropResource(TypeWheat).
  // requestSerfIfNeeded: TypeFarmer with TypeScythe.
  { type: B.TypeFarm, name: 'Farm', group: 'food', needs: [], makes: [R.TypeWheat], does: 'sows and reaps fields', tools: [R.TypeScythe] },
  // serf.ts entering building, TypeMiller: stockInit(0, TypeWheat, 8);
  // handleSerfMillingState: useResourceInStock(0), moves TypeFlour out.
  // requestSerfIfNeeded: TypeMiller, no tool.
  { type: B.TypeMill, name: 'Mill', group: 'food', needs: [R.TypeWheat], makes: [R.TypeFlour], tools: [] },
  // serf.ts entering building, TypeBaker: stockInit(0, TypeFlour, 8);
  // handleSerfBakingState: useResourceInStock(0), moves TypeBread out.
  // requestSerfIfNeeded: TypeBaker, no tool.
  { type: B.TypeBaker, name: 'Baker', group: 'food', needs: [R.TypeFlour], makes: [R.TypeBread], tools: [] },
  // serf.ts entering building, TypePigFarmer: stockInit(0, TypeWheat, 8);
  // handleSerfPigfarmingState: useResourceInStock(0), moves TypePig out.
  // requestSerfIfNeeded: TypePigFarmer, no tool.
  { type: B.TypePigFarm, name: 'Pig farm', group: 'food', needs: [R.TypeWheat], makes: [R.TypePig], tools: [], ratio: pigRatio },
  // serf.ts entering building, TypeButcher: stockInit(0, TypePig, 8);
  // handleSerfButcheringState: useResourceInStock(0), moves TypeMeat out.
  // requestSerfIfNeeded: TypeButcher with TypeCleaver.
  { type: B.TypeButcher, name: 'Butcher', group: 'food', needs: [R.TypePig], makes: [R.TypeMeat], tools: [R.TypeCleaver] },

  // serf.ts entering building, TypeMiner: stockInit(0, GroupFood, 8) for all
  // four mines; handleSerfMiningState substate 1: useResourceInStock(0)
  // (one time in eight the miner works without eating). The output is
  // resFromMineType[deposit - 1] with deposit = 4 - (type - TypeStoneMine):
  // stone, coal, iron ore, gold ore. requestSerfIfNeeded: TypeMiner, TypePick.
  { type: B.TypeStoneMine, name: 'Stone mine', group: 'mining', needs: [R.GroupFood], makes: [R.TypeStone], tools: [R.TypePick], ratio: mineRatio },
  { type: B.TypeCoalMine, name: 'Coal mine', group: 'mining', needs: [R.GroupFood], makes: [R.TypeCoal], tools: [R.TypePick], ratio: mineRatio },
  { type: B.TypeIronMine, name: 'Iron mine', group: 'mining', needs: [R.GroupFood], makes: [R.TypeIronOre], tools: [R.TypePick], ratio: mineRatio },
  { type: B.TypeGoldMine, name: 'Gold mine', group: 'mining', needs: [R.GroupFood], makes: [R.TypeGoldOre], tools: [R.TypePick], ratio: mineRatio },
  // serf.ts entering building, TypeSmelter: stockInit(0, TypeCoal, 8) and
  // stockInit(1, TypeIronOre, 8) in a steel smelter, TypeGoldOre in a gold
  // smelter; handleSerfSmeltingState: useResourcesInStocks() (one of each),
  // moves TypeSteel (smelting.type 0) or TypeGoldBar out.
  // requestSerfIfNeeded: TypeSmelter, no tool.
  { type: B.TypeSteelSmelter, name: 'Steel smelter', group: 'mining', needs: [R.TypeCoal, R.TypeIronOre], makes: [R.TypeSteel], tools: [] },
  { type: B.TypeGoldSmelter, name: 'Gold smelter', group: 'mining', needs: [R.TypeCoal, R.TypeGoldOre], makes: [R.TypeGoldBar], tools: [] },
  // serf.ts entering building, TypeToolmaker: stockInit(0, TypePlank, 8),
  // stockInit(1, TypeSteel, 8); handleSerfMakingToolState:
  // useResourcesInStocks(), then one tool TypeShovel + i (i in 0..8) by the
  // player's tool priorities. requestSerfIfNeeded: TypeHammer and TypeSaw.
  {
    type: B.TypeToolMaker, name: 'Toolmaker', group: 'mining', needs: [R.TypePlank, R.TypeSteel],
    makes: [R.TypeShovel, R.TypeHammer, R.TypeRod, R.TypeCleaver, R.TypeScythe, R.TypeAxe, R.TypeSaw, R.TypePick, R.TypePincer],
    makesText: 'tools', tools: [R.TypeHammer, R.TypeSaw],
  },
  // serf.ts entering building, TypeWeaponSmith: stockInit(0, TypeCoal, 8),
  // stockInit(1, TypeSteel, 8); handleSerfMakingWeaponState:
  // useResourcesInStocks(), then TypeSword and TypeShield in turn.
  // requestSerfIfNeeded: TypeHammer and TypePincer.
  { type: B.TypeWeaponSmith, name: 'Weaponsmith', group: 'mining', needs: [R.TypeCoal, R.TypeSteel], makes: [R.TypeSword, R.TypeShield], tools: [R.TypeHammer, R.TypePincer], ratio: weaponRatio },

  // building.ts updateMilitary: asks for knights (stock[0]) and, once
  // occupied, for gold bars: stockInit(1, TypeGoldBar, maxGold) with 2, 4
  // and 8 for hut, tower and fortress. No worker (requestSerfIfNeeded).
  { type: B.TypeHut, name: 'Guard hut', group: 'military', needs: [R.TypeGoldBar], makes: [], does: 'holds knights and guards land', tools: [] },
  { type: B.TypeTower, name: 'Tower', group: 'military', needs: [R.TypeGoldBar], makes: [], does: 'holds more knights', tools: [] },
  { type: B.TypeFortress, name: 'Fortress', group: 'military', needs: [R.TypeGoldBar], makes: [], does: 'holds the most knights', tools: [] },

  // building.ts updateNoTick, TypeStock: gets an Inventory when finished.
  { type: B.TypeStock, name: 'Storehouse', group: 'storage', needs: [], makes: [], does: 'stores goods and serfs, like the castle', tools: [] },
  // serf.ts entering building, TypeBoatBuilder: stockInit(0, TypePlank, 8);
  // handleSerfBuildingBoatState: useResourceInStock(0), moves TypeBoat out.
  // inventory.ts: a boat and a free serf make the sailor of a water road.
  // requestSerfIfNeeded: TypeBoatBuilder with TypeHammer.
  { type: B.TypeBoatbuilder, name: 'Boat builder', group: 'storage', needs: [R.TypePlank], makes: [R.TypeBoat], does: 'for roads over water', tools: [R.TypeHammer] },
];

// building.ts updateNoTick, TypeCastle: the first inventory. Not in the
// build menu (the panel has its own castle button).
export const castleName = 'Castle';

const infoByType = new Map<BuildingType, BuildingInfo>();
for (const info of buildingInfos) {
  infoByType.set(info.type, info);
}

export function buildingInfo(type: BuildingType): BuildingInfo | null {
  return infoByType.get(type) ?? null;
}

export function buildingName(type: BuildingType): string {
  if (type === BuildingType.TypeCastle) return castleName;
  return infoByType.get(type)?.name ?? 'Building';
}

/* Planks and stones of the construction: const_info[] of the game. */
export function buildingCost(type: BuildingType): { planks: number; stones: number } {
  const info = constInfo()[type];
  return { planks: info.planks, stones: info.stones };
}

export function isMine(type: BuildingType): boolean {
  return type >= BuildingType.TypeStoneMine && type <= BuildingType.TypeGoldMine;
}

/* The site a type needs: Game::can_build_building tests mines with
   can_build_mine, const_info's large buildings with can_build_large. */
export function buildingSize(type: BuildingType): 'mine' | 'small' | 'large' {
  if (isMine(type)) return 'mine';
  return constInfo()[type].mapObj === MapObject.ObjectLargeBuilding ? 'large' : 'small';
}

const resourceNames: { [res: number]: string } = {
  [R.TypeFish]: 'fish',
  [R.TypePig]: 'pigs',
  [R.TypeMeat]: 'meat',
  [R.TypeWheat]: 'wheat',
  [R.TypeFlour]: 'flour',
  [R.TypeBread]: 'bread',
  [R.TypeLumber]: 'logs',
  [R.TypePlank]: 'planks',
  [R.TypeBoat]: 'boats',
  [R.TypeStone]: 'stone',
  [R.TypeIronOre]: 'iron ore',
  [R.TypeSteel]: 'steel',
  [R.TypeCoal]: 'coal',
  [R.TypeGoldOre]: 'gold ore',
  [R.TypeGoldBar]: 'gold bars',
  [R.TypeShovel]: 'shovel',
  [R.TypeHammer]: 'hammer',
  [R.TypeRod]: 'rod',
  [R.TypeCleaver]: 'cleaver',
  [R.TypeScythe]: 'scythe',
  [R.TypeAxe]: 'axe',
  [R.TypeSaw]: 'saw',
  [R.TypePick]: 'pick',
  [R.TypePincer]: 'pincers',
  [R.TypeSword]: 'swords',
  [R.TypeShield]: 'shields',
  [R.GroupFood]: 'food',
};

export function resourceName(res: ResourceType): string {
  return resourceNames[res] ?? 'goods';
}

/* Building::requested_resource_delivered counts fish, meat and bread as
   GroupFood. */
export const foodResources: ResourceType[] = [R.TypeFish, R.TypeBread, R.TypeMeat];

/* The icons that stand for a resource: the three foods for GroupFood. */
export function resourceIcons(res: ResourceType): ResourceType[] {
  return res === R.GroupFood ? foodResources : [res];
}

/* One unit of a resource, for "1 sword" beside "swords". */
const singularNames: { [res: number]: string } = {
  [R.TypePig]: 'pig',
  [R.TypeBoat]: 'boat',
  [R.TypeGoldBar]: 'gold bar',
  [R.TypeSword]: 'sword',
  [R.TypeShield]: 'shield',
};

/* A resource with its share of the ratio, if the building has one:
   "7 food", "1 sword", else just "food". */
export function amountName(res: ResourceType, amount?: string): string {
  if (amount === undefined) return resourceName(res);
  const name = amount === '1' ? (singularNames[res] ?? resourceName(res)) : resourceName(res);
  return `${amount} ${name}`;
}

/* "needs coal, iron ore → makes steel", as words; with the numbers where
   the building has a ratio. */
export function productionLine(info: BuildingInfo): string {
  const parts: string[] = [];
  if (info.needs.length > 0) {
    parts.push('needs ' + info.needs.map((res, i) => amountName(res, info.ratio?.needs[i])).join(', '));
  }
  if (info.makes.length > 0) {
    const made =
      info.makesText ?? info.makes.map((res, i) => amountName(res, info.ratio?.makes[i])).join(', ');
    parts.push('makes ' + made);
  }
  let line = parts.join(' → ');
  if (info.does !== undefined) {
    line = line === '' ? info.does : `${info.does} → ${line}`;
  }
  return line;
}
