// The window of one building of the player: a construction site, a
// workshop, a mine or a guard hut, tower or fortress. It takes the place of
// four boxes of popup.ts (TypeOrderedBld, TypeBldStock, TypeMineOutput,
// TypeDefenders) and of the TypeDemolish box for its building. What it
// shows follows the building, not the box it was opened as: a site that is
// finished while the window is open becomes the window of the workshop.
// Not part of Freeserf.

import { Building, BuildingType } from '../../game/building';
import type { Game } from '../../game/game';
import { BIT_TEST } from '../../game/misc';
import { ResourceType } from '../../game/resource';
import { SerfType } from '../../game/serf';
import { PopupBoxType } from '../popup';
import {
  buildingCost,
  buildingInfo,
  buildingName,
  isMine,
  resourceIcons,
  resourceName,
} from '../production';
import {
  actionsSection,
  boxBuilding,
  buildingHeader,
  canDemolish,
  demolishControl,
  dynamic,
  isMilitaryHouse,
  workerOf,
} from './building-parts';
import type { Pin } from './building-parts';
import type { BoxContext, BoxView, Widget } from './kit';
import { resourceLabel, serfName } from './names';
import { el, meter, numberGrid, numberRow, resourceIcon, section, serfIcon } from './widgets';

type Kind = 'site' | 'military' | 'mine' | 'workshop';

function kindOf(building: Building): Kind {
  if (!building.isDone()) return 'site';
  const type = building.getType();
  if (isMilitaryHouse(type)) return 'military';
  if (isMine(type)) return 'mine';
  return 'workshop';
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* Several resource icons in a row (the three foods of a mine). */
function resourcePics(res: ResourceType): HTMLElement {
  const box = el('span', 'bw-pics');
  for (const icon of resourceIcons(res)) box.append(resourceIcon(icon));
  return box;
}

// ---------------------------------------------------------------------------
// Construction site (TypeOrderedBld).

/* The construction in percent: Building::build_progress() counts progress
   from 1 to 0xffff, the frame up to 0x8000 and the rest after. 0 is the
   levelling of the ground of a large building. */
function sitePercent(building: Building): number {
  return Math.min(100, Math.floor((building.getProgress() * 100) / 0x10000));
}

/* Whose turn it is at the site: the digger while progress is 0. */
function siteStage(building: Building): 'dig' | 'build' {
  return building.getProgress() === 0 ? 'dig' : 'build';
}

interface Material {
  res: ResourceType;
  stock: number;
  total: number;
}

/* Planks are always stock 0 and stone stock 1 of a site
   (Building::start_building). The castle has no materials. */
function siteMaterials(building: Building): Material[] {
  if (building.getType() === BuildingType.TypeCastle) return [];
  const cost = buildingCost(building.getType());
  const list: Material[] = [{ res: ResourceType.TypePlank, stock: 0, total: cost.planks }];
  if (cost.stones > 0) list.push({ res: ResourceType.TypeStone, stock: 1, total: cost.stones });
  return list;
}

/* Brought to the site so far: what was built in (the maximum of the stock
   goes down by one with each, Building::plank_used_for_build) and what
   lies there. */
function delivered(building: Building, m: Material): number {
  const used = m.total - building.getMaximumInStock(m.stock);
  return used + building.getResCountInStock(m.stock);
}

/* What the site waits for, in words. */
function siteWaitingFor(building: Building): string {
  const parts: string[] = [];
  if (!building.hasSerf()) {
    parts.push(building.getProgress() === 0 ? 'a digger' : 'a builder');
  }
  for (const m of siteMaterials(building)) {
    const missing = m.total - delivered(building, m);
    if (missing === 1 && m.res === ResourceType.TypePlank) parts.push('1 plank');
    else if (missing > 0) parts.push(`${missing} ${resourceName(m.res)}`);
  }
  return parts.length === 0 ? 'Nothing' : parts.join(', ');
}

function siteState(building: Building): string {
  if (building.getProgress() === 0) {
    return building.hasSerf()
      ? 'A digger is levelling the ground'
      : 'Waiting for a digger to level the ground';
  }
  const percent = sitePercent(building);
  if (!building.hasSerf()) return `Under construction, ${percent}% built, no builder yet`;
  return `Under construction, ${percent}% built`;
}

function siteRows(b: () => Building | null): (Widget | HTMLElement)[] {
  const building = b();
  if (building === null) return [];
  const rows: (Widget | HTMLElement)[] = [
    meter({
      label: 'Construction',
      get: () => {
        const cur = b();
        if (cur === null) return { fill: 0, text: '' };
        if (cur.getProgress() === 0) return { fill: 0, text: 'Levelling' };
        const percent = sitePercent(cur);
        const stage = BIT_TEST(cur.getProgress(), 15) !== 0 ? 'walls and roof' : 'frame';
        return { fill: percent / 100, text: `${percent}%, ${stage}` };
      },
    }),
    numberRow({
      label: 'Waiting for',
      get: () => {
        const cur = b();
        return cur === null ? '' : siteWaitingFor(cur);
      },
    }),
    /* The serf icon of drawOrderedBuildingBox(): digger while the ground
       is levelled, builder after, the minus box without one. The part is
       built again when the digger is done (siteStage() in its signature). */
    numberRow({
      label: siteStage(building) === 'dig' ? 'Digger' : 'Builder',
      icon: serfIcon(siteStage(building) === 'dig' ? SerfType.TypeDigger : SerfType.TypeBuilder),
      get: () => {
        const cur = b();
        if (cur === null) return '';
        return cur.hasSerf() ? 'At work' : 'Not here yet';
      },
    }),
  ];
  const materials = siteMaterials(building);
  if (materials.length === 0) return rows;

  const materialRows = materials.map((m) => {
    const row = numberRow({
      label: resourceLabel(m.res),
      icon: resourceIcon(m.res),
      title: 'Delivered: built in or lying at the site. On the way: sent from a store.',
      get: () => {
        const cur = b();
        if (cur === null) return '';
        const coming = cur.getRequestedInStock(m.stock);
        return (
          `${delivered(cur, m)} of ${m.total} delivered` +
          `, ${cur.getResCountInStock(m.stock)} at the site` +
          `, ${coming} on the way`
        );
      },
    });
    row.el.classList.add('bw-wide-value');
    return row;
  });
  rows.push(section('Materials', ...materialRows));
  return rows;
}

// ---------------------------------------------------------------------------
// Workshop (TypeBldStock) and mine (TypeMineOutput).

function workerRow(b: () => Building | null, type: SerfType): Widget {
  return numberRow({
    label: serfName(type),
    icon: serfIcon(type),
    get: () => {
      const cur = b();
      if (cur === null) return '';
      return cur.hasSerf() ? 'Here' : 'Not here yet';
    },
  });
}

/* A stock of a building: how many lie there, how many fit and how many are
   on the way (Building::stock[]: available, maximum, requested). */
function stockRow(b: () => Building | null, stock: number, res: ResourceType): Widget {
  const row = numberRow({
    label: resourceLabel(res),
    icon: resourcePics(res),
    title: 'In the building, the most it holds, and what carriers are bringing.',
    get: () => {
      const cur = b();
      if (cur === null) return '';
      return (
        `${cur.getResCountInStock(stock)} of ${cur.getMaximumInStock(stock)}` +
        `, ${cur.getRequestedInStock(stock)} on the way`
      );
    },
  });
  row.el.classList.add('bw-wide-value');
  return row;
}

function activeStocks(building: Building): number[] {
  const list: number[] = [];
  for (let j = 0; j < Building.kMaxStock; j++) {
    if (building.isStockActive(j)) list.push(j);
  }
  return list;
}

function workshopState(building: Building): string {
  const worker = workerOf(building.getType());
  if (!building.hasSerf()) {
    return worker === null ? 'Nobody here yet' : `Waiting for its ${serfName(worker).toLowerCase()}`;
  }
  const empty = activeStocks(building)
    .filter((j) => building.getResCountInStock(j) === 0)
    .map((j) => resourceName(building.getResTypeInStock(j)));
  if (empty.length > 0) return `Staffed, out of ${empty.join(' and ')}`;
  return 'Staffed';
}

function workshopRows(b: () => Building | null): (Widget | HTMLElement)[] {
  const building = b();
  if (building === null) return [];
  const rows: (Widget | HTMLElement)[] = [];
  const worker = workerOf(building.getType());
  if (worker !== null) rows.push(workerRow(b, worker));

  /* "Stock of this building" of drawBuildingStockBox(). */
  const stocks = activeStocks(building);
  const stockRows: (Widget | HTMLElement)[] = stocks.map((j) =>
    stockRow(b, j, building.getResTypeInStock(j)),
  );
  if (stockRows.length === 0) {
    /* The stocks are set up when the worker walks in (Serf::
       handle_serf_entering_building_state). */
    const takes = (buildingInfo(building.getType())?.needs.length ?? 0) > 0;
    stockRows.push(el(
      'p',
      'mk-hint',
      takes ? 'Nothing here yet. Goods come once the worker has moved in.' : 'This building takes no goods in.',
    ));
  }
  rows.push(section('Stock of this building', ...stockRows));
  return rows;
}

/* The output of a mine in percent: the weighted sum of its last 15 rounds
   (bit set: the miner found something), as drawMineOutputBox(). */
export function mineOutputPercent(building: Building): number {
  const outputWeight = [10, 10, 9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 3, 2, 1];
  let output = 0;
  for (let i = 0; i < 15; i++) {
    output += (BIT_TEST(building.getProgress(), i) !== 0 ? 1 : 0) * outputWeight[i];
  }
  return output;
}

function mineState(building: Building): string {
  if (!building.hasSerf()) return 'Waiting for its miner';
  if (building.getResCountInStock(0) === 0) return 'Staffed, out of food';
  return 'Staffed';
}

function mineRows(b: () => Building | null): (Widget | HTMLElement)[] {
  const food = numberRow({
    label: 'Food',
    icon: resourcePics(ResourceType.GroupFood),
    title: 'Fish, meat and bread in the mine, the most it holds, and what carriers are bringing.',
    get: () => {
      const cur = b();
      if (cur === null) return '';
      /* Stock 0 holds the food once the miner is in. */
      const count = cur.getResCountInStock(0);
      if (!cur.isStockActive(0)) return String(count);
      return `${count} of ${cur.getMaximumInStock(0)}, ${cur.getRequestedInStock(0)} on the way`;
    },
  });
  food.el.classList.add('bw-wide-value');
  return [
    meter({
      label: 'Mining output',
      title: 'How many of the last 15 digs found something, the newest counting most.',
      get: () => {
        const cur = b();
        const output = cur === null ? 0 : mineOutputPercent(cur);
        return { fill: output / 100, text: `${output}%` };
      },
    }),
    workerRow(b, SerfType.TypeMiner),
    food,
  ];
}

// ---------------------------------------------------------------------------
// Guard hut, tower, fortress (TypeDefenders).

/* The knights in a building by rank, lowest first: the list that starts at
   Building::get_first_knight(). */
export function knightsByRank(game: Game, building: Building): number[] {
  const knights = [0, 0, 0, 0, 0];
  let index = building.getFirstKnight();
  for (let guard = 0; index !== 0 && guard < 1000; guard++) {
    const serf = game.getSerf(index);
    if (serf === null) break;
    const type = serf.getType();
    if (type >= SerfType.TypeKnight0 && type <= SerfType.TypeKnight4) {
      knights[type - SerfType.TypeKnight0] += 1;
    }
    index = serf.getNext();
  }
  return knights;
}

/* The tiles of the five ranks, the highest first as the boxes list them. */
export function knightTiles(counts: () => number[]): Widget {
  const ranks = [4, 3, 2, 1, 0];
  return numberGrid('Knights by rank', ranks.map((rank) => ({
    label: serfName(SerfType.TypeKnight0 + rank),
    icon: serfIcon(SerfType.TypeKnight0 + rank),
    get: () => counts()[rank],
  })));
}

/* Building::get_threat_level(): 3 when land of another player is closest
   (Building::update_military_flag_state), 0 when none is near. */
const threatWords = [
  'no enemy land near',
  'enemy land far away',
  'enemy land near',
  'enemy land next to it',
];

export function threatText(level: number): string {
  return `${level} of 3, ${threatWords[level] ?? ''}`;
}

function militaryState(game: Game, building: Building): string {
  const count = knightsByRank(game, building).reduce((a, n) => a + n, 0);
  let text = !building.isActive() && count === 0
    ? 'No knights here yet'
    : `Held by ${plural(count, 'knight', 'knights')}`;
  if (building.isUnderAttack()) text += ', under attack';
  return text;
}

function militaryRows(game: Game, b: () => Building | null): (Widget | HTMLElement)[] {
  /* One walk of the list for the five tiles. */
  let counts = [0, 0, 0, 0, 0];
  const read = (): void => {
    const cur = b();
    counts = cur === null ? [0, 0, 0, 0, 0] : knightsByRank(game, cur);
  };
  read();
  const tiles = knightTiles(() => counts);
  const defenders = section('Defenders', tiles);
  /* Nothing to see: reads the list before the rows below show it. */
  const reader = el('span');
  reader.hidden = true;
  return [
    { el: reader, update: read },
    numberRow({
      label: 'Knights inside',
      get: () => counts.reduce((a, n) => a + n, 0),
    }),
    defenders,
    numberRow({
      label: 'Gold bars',
      icon: resourceIcon(ResourceType.TypeGoldBar),
      title: 'Gold in the building raises the morale of the knights.',
      get: () => {
        const cur = b();
        if (cur === null) return '';
        /* Stock 1 holds the gold once knights are in. */
        const count = cur.getResCountInStock(1);
        if (!cur.isStockActive(1)) return String(count);
        return `${count} of ${cur.getMaximumInStock(1)}`;
      },
    }),
    numberRow({
      label: 'Threat level',
      title: 'How close land of another player is. The original box calls this number "State".',
      get: () => {
        const cur = b();
        return cur === null ? '' : threatText(cur.getThreatLevel() | 0);
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
// The window.

/* What a player can do with a building of his own. The controls to come
   (pause production, output cap, upgrade hut to tower to fortress) are
   added to this list; see actionsSection() of building-parts.ts. */
export function buildingActions(ctx: BoxContext, building: () => Building | null): (Widget | HTMLElement)[] {
  const b = building();
  const items: (Widget | HTMLElement)[] = [];
  if (b !== null && canDemolish(b)) items.push(demolishControl(ctx, building));
  return items;
}

/* The box the viewport opens for a finished building (Viewport::
   handle_dbl_click, openObjectBox() of viewport.ts): a storehouse that is
   in use has the inventory window. */
function opensInventory(ctx: BoxContext, building: Building): boolean {
  if (!building.isDone() || !building.hasInventory()) return false;
  if (building.getType() === BuildingType.TypeCastle) return true;
  if (building.getType() !== BuildingType.TypeStock || !building.isActive()) return false;
  return !(ctx.iface.getStockBoxOccupied() && !building.hasSerf());
}

function buildingInfoBox(ctx: BoxContext): BoxView {
  const { win, game } = ctx;
  win.setPattern('green');

  const pin: Pin = { pos: null };
  let cur = boxBuilding(ctx, pin);
  const b = (): Building | null => cur;

  let title = '';
  const showTitle = (): void => {
    const next = cur === null ? 'Building' : buildingName(cur.getType());
    if (next === title) return;
    title = next;
    win.setTitle(next);
  };
  showTitle();

  const state = (building: Building): string => {
    switch (kindOf(building)) {
      case 'site': return siteState(building);
      case 'military': return militaryState(game, building);
      case 'mine': return mineState(building);
      default: return workshopState(building);
    }
  };

  win.add(
    buildingHeader(ctx, b, state, (building) => (building.isDone() ? '' : 'When finished: ')),
    /* The rows of the kind of building; built again when the site is
       finished or the stocks of the building change. */
    dynamic(
      () => {
        if (cur === null) return '';
        const stocks = activeStocks(cur).map((j) => `${j}:${cur!.getResTypeInStock(j)}`).join(',');
        const stage = kindOf(cur) === 'site' ? siteStage(cur) : '';
        return `${kindOf(cur)}|${cur.getType()}|${stocks}|${stage}`;
      },
      () => {
        if (cur === null) return [];
        switch (kindOf(cur)) {
          case 'site': return siteRows(b);
          case 'military': return militaryRows(game, b);
          case 'mine': return mineRows(b);
          default: return workshopRows(b);
        }
      },
    ),
    dynamic(
      () => (cur === null ? '' : `${cur.getType()}|${canDemolish(cur)}`),
      () => [actionsSection(buildingActions(ctx, b))],
    ),
  );

  return {
    update: () => {
      cur = boxBuilding(ctx, pin);
      if (cur === null) {
        ctx.close();
        return;
      }
      if (opensInventory(ctx, cur)) {
        ctx.open(PopupBoxType.TypeCastleRes);
        return;
      }
      showTitle();
    },
  };
}

export const buildingInfoBoxes: PopupBoxType[] = [
  PopupBoxType.TypeOrderedBld,
  PopupBoxType.TypeBldStock,
  PopupBoxType.TypeMineOutput,
  PopupBoxType.TypeDefenders,
];

export { buildingInfoBox };
