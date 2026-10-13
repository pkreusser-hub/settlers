// The statistics boxes of the game as one window of the page with a tab for
// each (TypeStatSelect and the TypeStat* boxes of popup.ts, with
// TypePlayerFaces). Not part of Freeserf.
//
// Every box type opens the window at its page: TypeStatSelect (the panel
// button) at the page that was open last, TypeStatBld1 to 4 at the one page
// of the buildings, TypePlayerFaces at the comparison of the players, where
// the faces are.

import './stats.css';

import { Building, BuildingType } from '../../game/building';
import { GAME_MAX_PLAYER_COUNT } from '../../game/game';
import { idiv } from '../../game/misc';
import { characters } from '../../game/mission';
import type { Player } from '../../game/player';
import { ResourceType } from '../../game/resource';
import { SerfType } from '../../game/serf';
import { AudioTypeSfx } from '../audio';
import { InterfaceStatAspect, InterfaceStatScale } from '../interface';
import { PopupBoxType } from '../popup';
import { buildingName } from '../production';
import { registerBox } from './kit';
import type { BoxContext, BoxView, Widget } from './kit';
import { registerMapBoxes } from './map';
import {
  relationName,
  resourceBoxOrder,
  resourceLabel,
  serfBoxOrder,
  serfName,
  stockPresetName,
  teamName,
  ticksAsClock,
} from './names';
import {
  button,
  buildingIcon,
  chart,
  el,
  faceCanvas,
  fitHeight,
  hint,
  iconCanvas,
  meter,
  numberGrid,
  numberRow,
  resourceIcon,
  section,
  segmented,
  serfIcon,
} from './widgets';
import type { ChartData } from './widgets';

/* A value that costs something to read (a sum over all buildings or all
   serfs): read once for all the widgets of a page, and again after the
   update() of the page has said so. */
function perUpdate<T>(read: () => T): { get(): T; invalidate(): void } {
  let value: T | undefined;
  let valid = false;
  return {
    get: () => {
      if (!valid) {
        value = read();
        valid = true;
      }
      return value as T;
    },
    invalidate: () => {
      valid = false;
    },
  };
}

/* What the pages show next to a name: a line of text, and optionally a
   small bar (0..1) that repeats what the text says. */
interface InfoTile {
  label: string;
  icon?: HTMLElement;
  get(): { text: string; fill?: number; dim?: boolean };
}

/* A grid of things with a line of text each: the buildings with their two
   counts, the serf types with theirs. */
function infoTiles(label: string, tiles: InfoTile[]): Widget {
  const root = el('ul', 'stat-tiles');
  root.setAttribute('aria-label', label);
  const parts = tiles.map((tile) => {
    const item = el('li', 'stat-tile');
    const pic = el('span', 'stat-pic');
    if (tile.icon !== undefined) pic.append(tile.icon);
    const text = el('span', 'stat-text');
    const name = el('span', 'stat-name', tile.label);
    const detail = el('span', 'stat-detail');
    text.append(name, detail);
    const bar = el('span', 'stat-bar');
    bar.setAttribute('aria-hidden', 'true');
    const fill = el('span', 'stat-bar-fill');
    bar.append(fill);
    bar.hidden = true;
    text.append(bar);
    item.append(pic, text);
    root.append(item);
    return { item, detail, bar, fill, shown: '' };
  });
  const update = (): void => {
    tiles.forEach((tile, i) => {
      const v = tile.get();
      const key = `${v.text}|${v.fill ?? ''}|${v.dim === true}`;
      const part = parts[i];
      if (key === part.shown) return;
      part.shown = key;
      part.detail.textContent = v.text;
      part.item.classList.toggle('stat-dim', v.dim === true);
      part.bar.hidden = v.fill === undefined;
      if (v.fill !== undefined) part.fill.style.width = `${Math.max(0, Math.min(1, v.fill)) * 100}%`;
    });
  };
  update();
  return { el: root, update };
}

// ---------------------------------------------------------------------------
// TypeStat4: the stock.

/* TypeStat4: what lies in the castle and the storehouses, the 26 numbers of
   drawResourcesBox() of popup.ts in its order. */
function stockPage(ctx: BoxContext): BoxView {
  const { win, player } = ctx;
  /* Sum up resources of all inventories. */
  const resources = perUpdate(() => player.getStatsResources());
  win.add(
    hint('What lies in your castle and your storehouses.'),
    numberGrid(
      'Stock',
      resourceBoxOrder.map((res) => ({
        label: resourceLabel(res),
        icon: resourceIcon(res),
        get: () => resources.get().get(res) ?? 0,
      })),
    ),
  );
  return { update: resources.invalidate };
}

// ---------------------------------------------------------------------------
// TypeStatBld1 to TypeStatBld4: the buildings.

const B = BuildingType;

/* The buildings of the four pages of the original (drawStatBld1Box() to
   drawStatBld4Box() of popup.ts), each page in its order. */
const buildingPages: { title: string; types: BuildingType[] }[] = [
  { title: 'Military and storage', types: [B.TypeHut, B.TypeTower, B.TypeFortress, B.TypeStock] },
  {
    title: 'Wood, stone and workshops',
    types: [
      B.TypeToolMaker, B.TypeSawmill, B.TypeWeaponSmith, B.TypeStonecutter,
      B.TypeBoatbuilder, B.TypeForester, B.TypeLumberjack,
    ],
  },
  { title: 'Food', types: [B.TypePigFarm, B.TypeFarm, B.TypeFisher, B.TypeButcher, B.TypeMill, B.TypeBaker] },
  {
    title: 'Mines and smelters',
    types: [
      B.TypeStoneMine, B.TypeCoalMine, B.TypeIronMine, B.TypeGoldMine,
      B.TypeSteelSmelter, B.TypeGoldSmelter,
    ],
  },
];

/* The two numbers of drawBuildingCount() of popup.ts. */
function buildingsPage(ctx: BoxContext): BoxView {
  const { win, player } = ctx;
  const color = player.getColor();
  win.add(hint('How many of each building stand, and how many more are being built.'));
  for (const page of buildingPages) {
    win.add(
      section(
        page.title,
        infoTiles(
          page.title,
          page.types.map((type) => ({
            label: buildingName(type),
            icon: fitHeight(buildingIcon(type, color), 2.2),
            get: () => {
              const done = player.getCompletedBuildingCount(type);
              const unfinished = player.getIncompleteBuildingCount(type);
              return {
                text: `${done} finished, ${unfinished} unfinished`,
                dim: done === 0 && unfinished === 0,
              };
            },
          })),
        ),
      ),
    );
  }
  return {};
}

// ---------------------------------------------------------------------------
// TypeStat8: the players compared, with TypePlayerFaces.

const playerHistorySize = 112;

/* The four lengths of the history of the players. Game::update_game_stats
   takes a sample every 1500 ticks (30 seconds at the normal speed) for the
   first, every 4th of those for the second, every 5th of those for the
   third and every 5th of those for the fourth; each keeps 112 samples. */
const statScales: { value: InterfaceStatScale; label: string; sample: string }[] = [
  { value: InterfaceStatScale.StatScale30Min, label: '56 minutes', sample: 'One point every 30 seconds' },
  { value: InterfaceStatScale.StatScale60Min, label: '3.7 hours', sample: 'One point every 2 minutes' },
  { value: InterfaceStatScale.StatScale600Min, label: '19 hours', sample: 'One point every 10 minutes' },
  { value: InterfaceStatScale.StatScale3000Min, label: '93 hours', sample: 'One point every 50 minutes' },
];

const statAspects: { value: InterfaceStatAspect; label: string; title: string }[] = [
  { value: InterfaceStatAspect.StatAspectAll, label: 'Overall', title: 'Land, buildings and knights together' },
  { value: InterfaceStatAspect.StatAspectLand, label: 'Land', title: 'The land each player owns' },
  { value: InterfaceStatAspect.StatAspectBuildings, label: 'Buildings', title: 'The buildings of each player' },
  { value: InterfaceStatAspect.StatAspectMilitary, label: 'Military', title: 'The knights of each player' },
];

/* The values drawPlayerStatChart() of popup.ts draws, in its order: from
   the newest sample back to the oldest. Each is the share of the player in
   percent (Game::record_player_history). */
export function playerHistoryValues(data: number[], index: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < playerHistorySize; i++) {
    values.push(data[index]);
    index = index > 0 ? index - 1 : playerHistorySize - 1;
  }
  return values;
}

function playerLabel(player: Player, local: Player): string {
  let label = `Player ${player.getIndex() + 1}`;
  if (player === local) return `${label} (you)`;
  const face = player.getFace();
  /* The computer players have the names of their faces (mission.ts). */
  if (player.isAi() && face >= 1 && face <= 11) label += `, ${characters[face].name}`;
  return label;
}

function stat8Page(ctx: BoxContext): BoxView {
  const { win, iface, game } = ctx;

  const players: Player[] = [];
  for (let i = 0; i < GAME_MAX_PLAYER_COUNT; i++) {
    const p = game.getPlayer(i);
    if (p !== null) players.push(p);
  }
  const cssColor = (p: Player): string => {
    const c = p.getColor();
    return `rgb(${c.red}, ${c.green}, ${c.blue})`;
  };
  const history = (p: Player): number[] => {
    const scale = iface.getSelectedStatScale();
    const mode = (iface.getSelectedStatAspect() << 2) | scale;
    return p.getPlayerStatHistory(mode);
  };
  /* The newest sample: where the chart of the original starts. */
  const share = (p: Player): number => history(p)[game.getPlayerHistoryIndex(iface.getSelectedStatScale())];

  const data = (): ChartData => {
    const scale = iface.getSelectedStatScale();
    const index = game.getPlayerHistoryIndex(scale);
    const length = statScales.find((s) => s.value === scale) ?? statScales[0];
    return {
      series: players.map((p) => ({
        label: playerLabel(p, ctx.player),
        /* Oldest on the left, as the original draws it. */
        values: playerHistoryValues(history(p), index).reverse(),
        color: cssColor(p),
      })),
      yMax: 100,
      yTicks: [0, 25, 50, 75, 100],
      yFormat: (v) => `${v}%`,
      xLabels: [
        { at: 0, text: `${length.label} ago` },
        { at: 1, text: 'now' },
      ],
      summary: players.map((p) => `${playerLabel(p, ctx.player)}: ${share(p)} percent`).join(', ') + '.',
    };
  };

  /* The faces of the players on their colours (drawPlayerFacesBox() of
     popup.ts), each with its share now. */
  const faces = el('ul', 'stat-players');
  faces.setAttribute('aria-label', 'Players');
  const shares = players.map((p) => {
    const item = el('li', 'stat-player');
    const text = el('span', 'stat-text');
    const value = el('span', 'stat-detail');
    text.append(el('span', 'stat-name', playerLabel(p, ctx.player)), value);
    /* GAME OPTIONS: the team of the player and how it stands to the local
       player. The teams are fixed for the game. */
    if (game.hasTeams()) {
      const relation = relationName(game, ctx.player.getIndex(), p.getIndex());
      const team = teamName(p.getTeam());
      const line = [team !== '' ? team : 'No team', relation === 'you' ? '' : relation]
        .filter((t) => t !== '').join(', ');
      text.append(el('span', 'stat-detail stat-team', line));
    }
    item.append(fitHeight(faceCanvas(p.getFace(), p.getColor()), 4.4), text);
    faces.append(item);
    return { value, shown: '' };
  });
  const facesWidget: Widget = {
    el: faces,
    update: () => {
      players.forEach((p, i) => {
        const text = `${share(p)}% now`;
        if (text === shares[i].shown) return;
        shares[i].shown = text;
        shares[i].value.textContent = text;
      });
    },
  };
  facesWidget.update?.();

  /* GAME OPTIONS, read only: what the setup chose for this game. */
  const rules = game.getRules();
  const optionRows: Widget[] = [
    numberRow({ label: 'Starting stock', get: () => stockPresetName(rules.stockPreset) }),
    numberRow({
      label: 'Peace at the start',
      get: () => {
        if (rules.peaceMinutes === 0) return 'Off';
        const left = game.getPeaceTicksLeft();
        return left > 0
          ? `${rules.peaceMinutes} minutes, ${ticksAsClock(left)} left`
          : `${rules.peaceMinutes} minutes, over`;
      },
    }),
    numberRow({
      label: 'Teams',
      get: () => (game.hasTeams() ? 'Fixed. Allies cannot attack each other.' : 'None'),
    }),
  ];

  win.add(
    hint('The share of each player in percent, over time.'),
    chart({ kind: 'lines', label: 'Players compared', height: 11, get: data }),
    facesWidget,
    section('Game options', ...optionRows),
    segmented<InterfaceStatAspect>({
      label: 'Compare',
      options: statAspects,
      get: () => iface.getSelectedStatAspect(),
      set: (aspect) => {
        /* ACTION_SETT_8_SET_ASPECT_* of popup.ts: a choice of the
           interface, not of the game. */
        ctx.sound(AudioTypeSfx.TypeSfxClick);
        iface.setSelectedStatAspect(aspect);
      },
    }),
    segmented<InterfaceStatScale>({
      label: 'Time shown',
      options: statScales.map((s) => ({ value: s.value, label: s.label, title: s.sample })),
      get: () => iface.getSelectedStatScale(),
      set: (scale) => {
        /* ACTION_SETT_8_SET_SCALE_*. */
        ctx.sound(AudioTypeSfx.TypeSfxClick);
        iface.setSelectedStatScale(scale);
      },
    }),
  );
  return {};
}

// ---------------------------------------------------------------------------
// TypeStat7: the production of one resource over time.

/* The history of the resources: one sample every 6000 ticks of the game
   (Game::update_game_stats), two minutes at the normal speed, 120 samples. */
const historySize = 120;
const sampleMinutes = 2;
/* The chart of the original has 112 columns, each the sum of nine samples
   with these weights (64 in all). */
const chartColumns = 112;
const sampleWeights = [4, 6, 8, 9, 10, 9, 8, 6, 4];
const weightSum = 64;

/* The columns of drawStat7Box() of popup.ts, from the newest to the oldest,
   as that box sums them. */
export function resourceHistoryColumns(history: number[], index: number): number[] {
  const columns: number[] = [];
  for (let i = 0; i < chartColumns; i++) {
    let sum = 0;
    let j = index;
    for (let k = 0; k < 9; k++) {
      sum += sampleWeights[k] * history[j];
      j = j > 0 ? j - 1 : historySize - 1;
    }
    columns.push(sum);
    index = index > 0 ? index - 1 : historySize - 1;
  }
  return columns;
}

/* The top of the scale the original picks for the largest column (its
   multipliers 0x8000 .. 0xa3 over the 64 pixels of the chart): 2, 4, 8, 16,
   40, 80, 160 or 400 goods a sample. */
export function resourceHistoryScale(maxColumn: number): number {
  const limits = [64, 128, 256, 512, 1280, 2560, 5120];
  const tops = [2, 4, 8, 16, 40, 80, 160];
  for (let i = 0; i < limits.length; i++) {
    if (maxColumn <= limits[i]) return tops[i];
  }
  return 400;
}

/* TypeStat7: how much of one resource was made over time. */
function stat7Page(ctx: BoxContext): BoxView {
  const { win, iface, game, player } = ctx;

  const selected = (): ResourceType => iface.getSelectedStatResource();

  const data = (): ChartData => {
    const res = selected();
    const columns = resourceHistoryColumns(
      player.getResourceCountHistory(res),
      game.getResourceHistoryIndex(),
    );
    const top = resourceHistoryScale(Math.max(...columns));
    /* Oldest on the left, as the original draws it. */
    const values = columns.map((c) => c / weightSum).reverse();
    const peak = Math.max(...values);
    return {
      series: [{ label: resourceLabel(res), values }],
      yMax: top,
      yTicks: [0, top / 4, top / 2, (3 * top) / 4, top],
      xLabels: [
        { at: 0, text: `${chartColumns * sampleMinutes} min ago` },
        { at: 1, text: 'now' },
      ],
      summary:
        `${resourceLabel(res)}: at most ${peak.toFixed(1)} in ${sampleMinutes} minutes, ` +
        `scale up to ${top}.`,
    };
  };

  win.add(
    hint(`How many were made in each ${sampleMinutes} minutes of the game, smoothed as in the original.`),
    chart({ kind: 'bars', label: 'Production over time', height: 10, get: data }),
    numberRow({
      label: 'Shown',
      get: () => resourceLabel(selected()),
    }),
    numberRow({
      label: `Made in the newest ${sampleMinutes} minutes counted`,
      title: 'The newest sample of the history of the game',
      get: () => {
        const index = game.getResourceHistoryIndex();
        const last = index > 0 ? index - 1 : historySize - 1;
        return player.getResourceCountHistory(selected())[last];
      },
    }),
    segmented<ResourceType>({
      label: 'Resource',
      iconsOnly: true,
      options: resourceBoxOrder.map((res) => ({
        value: res,
        label: resourceLabel(res),
        icon: resourceIcon(res),
      })),
      get: selected,
      set: (res) => {
        /* As ACTION_STAT_7_SELECT_* of popup.ts: a choice of the interface,
           not of the game. */
        ctx.sound(AudioTypeSfx.TypeSfxClick);
        iface.setSelectedStatResource(res);
      },
    }),
  );
  return {};
}

// ---------------------------------------------------------------------------
// TypeStat1 and TypeStat2: the gauges of the food and the materials.

/* calculate_gauge_values() of popup.ts: for each building type (0: the
   buildings that are not finished) and each of its stocks, the sum of how
   full the stock is in sixteenths (what lies there counts twice, what is on
   its way once) and the number of stocks counted. Only buildings with their
   worker, and not the burning ones. */
export function gaugeValues(player: Player): number[][][] {
  // PORT: unsigned int values[24][Building::kMaxStock][2] = {{{0}}}
  const values: number[][][] = [];
  for (let i = 0; i < 24; i++) {
    const row: number[][] = [];
    for (let j = 0; j < Building.kMaxStock; j++) {
      row.push([0, 0]);
    }
    values.push(row);
  }

  for (const building of player.getGame().getPlayerBuildings(player)) {
    if (building.isBurning() || !building.hasSerf()) {
      continue;
    }

    let type: number = building.getType();
    if (!building.isDone()) type = 0;

    for (let i = 0; i < Building.kMaxStock; i++) {
      if (building.getMaximumInStock(i) > 0) {
        const v = 2 * building.getResCountInStock(i) + building.getRequestedInStock(i);
        values[type][i][0] += idiv(16 * v, 2 * building.getMaximumInStock(i));
        values[type][i][1] += 1;
      }
    }
  }
  return values;
}

/* The picture drawGaugeBalance() and drawGaugeFull() of popup.ts choose,
   as a number: 0 (empty) to 10 (full) for the eleven pictures, null for the
   picture of "no such building". */
export function gaugeLevel(value: number, count: number): number | null {
  if (count <= 0) return null;
  const v = idiv(16 * value, count);
  return Math.min(10, idiv(v, 23));
}

const R = ResourceType;

/* One gauge: what is counted (a resource at a kind of building) and which
   entries of the values are summed. */
interface Gauge {
  label: string;
  res: ResourceType;
  /* [building type, stock] pairs; 0 is the buildings not finished. */
  from: [number, number][];
  /* What to say when there is nothing to count. */
  none: string;
}

function gaugeRows(values: () => number[][][], gauges: Gauge[]): Widget[] {
  return gauges.map((gauge) =>
    meter({
      label: gauge.label,
      icon: resourceIcon(gauge.res),
      get: () => {
        const all = values();
        let value = 0;
        let count = 0;
        for (const [type, stock] of gauge.from) {
          value += all[type][stock][0];
          count += all[type][stock][1];
        }
        const level = gaugeLevel(value, count);
        if (level === null) return { fill: 0, text: gauge.none };
        return { fill: level / 10, text: `${level} of 10` };
      },
    }),
  );
}

const gaugeHint =
  '0 of 10: the buildings wait for it. 10 of 10: they have all they can hold. ' +
  'What is on its way counts half.';

/* TypeStat1: the food. The gauges of drawStat1Box() of popup.ts. */
function stat1Page(ctx: BoxContext): BoxView {
  const { win, player } = ctx;
  const values = perUpdate(() => gaugeValues(player));
  const noBuilding = 'None working';
  win.add(
    hint('How well your buildings are supplied along the way from the farm and the fisher to the mines.'),
    hint(gaugeHint),
    section(
      'Bread: farm, mill, baker',
      ...gaugeRows(values.get, [
        { label: 'Wheat at the mills', res: R.TypeWheat, from: [[B.TypeMill, 0]], none: noBuilding },
        { label: 'Flour at the bakers', res: R.TypeFlour, from: [[B.TypeBaker, 0]], none: noBuilding },
      ]),
    ),
    section(
      'Meat: farm, pig farm, butcher',
      ...gaugeRows(values.get, [
        { label: 'Wheat at the pig farms', res: R.TypeWheat, from: [[B.TypePigFarm, 0]], none: noBuilding },
        { label: 'Pigs at the butchers', res: R.TypePig, from: [[B.TypeButcher, 0]], none: noBuilding },
      ]),
    ),
    section(
      'Bread, meat and fish at the mines',
      ...gaugeRows(values.get, [
        { label: 'Food at the gold mines', res: R.TypeGoldOre, from: [[B.TypeGoldMine, 0]], none: noBuilding },
        { label: 'Food at the coal mines', res: R.TypeCoal, from: [[B.TypeCoalMine, 0]], none: noBuilding },
        { label: 'Food at the iron mines', res: R.TypeIronOre, from: [[B.TypeIronMine, 0]], none: noBuilding },
        { label: 'Food at the stone mines', res: R.TypeStone, from: [[B.TypeStoneMine, 0]], none: noBuilding },
      ]),
    ),
  );
  return { update: values.invalidate };
}

/* TypeStat2: the materials. The gauges of drawStat2Box() of popup.ts. */
function stat2Page(ctx: BoxContext): BoxView {
  const { win, player } = ctx;
  const values = perUpdate(() => gaugeValues(player));
  const noBuilding = 'None working';
  win.add(
    hint('How well your buildings are supplied along the way from the mines and the forest to the workshops.'),
    hint(gaugeHint),
    section(
      'Gold',
      ...gaugeRows(values.get, [
        { label: 'Gold ore at the gold smelters', res: R.TypeGoldOre, from: [[B.TypeGoldSmelter, 1]], none: noBuilding },
        { label: 'Coal at the gold smelters', res: R.TypeCoal, from: [[B.TypeGoldSmelter, 0]], none: noBuilding },
        {
          label: 'Gold bars at the huts, towers and fortresses',
          res: R.TypeGoldBar,
          from: [[B.TypeHut, 1], [B.TypeTower, 1], [B.TypeFortress, 1]],
          none: 'None occupied',
        },
      ]),
    ),
    section(
      'Steel, weapons and tools',
      ...gaugeRows(values.get, [
        { label: 'Coal at the steel smelters', res: R.TypeCoal, from: [[B.TypeSteelSmelter, 0]], none: noBuilding },
        { label: 'Iron ore at the steel smelters', res: R.TypeIronOre, from: [[B.TypeSteelSmelter, 1]], none: noBuilding },
        { label: 'Coal at the weaponsmiths', res: R.TypeCoal, from: [[B.TypeWeaponSmith, 0]], none: noBuilding },
        { label: 'Steel at the weaponsmiths', res: R.TypeSteel, from: [[B.TypeWeaponSmith, 1]], none: noBuilding },
        { label: 'Steel at the toolmakers', res: R.TypeSteel, from: [[B.TypeToolMaker, 1]], none: noBuilding },
        { label: 'Planks at the toolmakers', res: R.TypePlank, from: [[B.TypeToolMaker, 0]], none: noBuilding },
      ]),
    ),
    section(
      'Wood and stone',
      ...gaugeRows(values.get, [
        { label: 'Logs at the sawmills', res: R.TypeLumber, from: [[B.TypeSawmill, 1]], none: noBuilding },
        { label: 'Planks at the boat builders', res: R.TypePlank, from: [[B.TypeBoatbuilder, 0]], none: noBuilding },
        { label: 'Planks at the building sites', res: R.TypePlank, from: [[0, 0]], none: 'No site with a builder' },
        { label: 'Stone at the building sites', res: R.TypeStone, from: [[0, 1]], none: 'No site with a builder' },
      ]),
    ),
  );
  return { update: values.invalidate };
}

// ---------------------------------------------------------------------------
// TypeStat6 and TypeStat3: the serfs.

/* TypeStat6: the serfs by their trade and their sum (drawStat6Box() and
   drawSerfsBox() of popup.ts). */
function stat6Page(ctx: BoxContext): BoxView {
  const { win, player } = ctx;
  win.add(
    hint('All your serfs by what they do.'),
    numberGrid(
      'Serfs',
      serfBoxOrder.map((type) => ({
        label: serfName(type),
        icon: serfIcon(type),
        get: () => player.getSerfs()[type],
      })),
    ),
    numberRow({
      label: 'All serfs',
      get: () => {
        let total = 0;
        for (let i = 0; i < 27; i++) {
          if (i !== SerfType.TypeTransporterInventory) {
            total += player.getSerfCount(i);
          }
        }
        return total;
      },
    }),
  );
  return {};
}

/* The picture drawStat3Meter() of popup.ts chooses for a number of serfs,
   as the level of that picture: 0 (empty) to 10 (full). */
export function stat3Level(value: number): number {
  if (value < 1) return 0;
  if (value < 2) return 2;
  if (value < 3) return 4;
  if (value < 4) return 5;
  if (value < 5) return 6;
  if (value < 7) return 7;
  if (value < 10) return 8;
  if (value < 20) return 9;
  return 10;
}

/* TypeStat3: the serfs that wait in a stock and the ones that could be
   made. The original shows a gauge for the sum of the two; here the two
   numbers are shown and the gauge is the bar. */
function stat3Page(ctx: BoxContext): BoxView {
  const { win, player } = ctx;
  const idle = perUpdate(() => player.getStatsSerfsIdle());
  const potential = perUpdate(() => player.getStatsSerfsPotential());
  win.add(
    hint(
      'Waiting: in the castle or a storehouse, without work. ' +
        'Possible: could be made now from the serfs without a job and the tools in stock. ' +
        'The bar is full from 20.',
    ),
    infoTiles(
      'Serfs waiting and possible',
      serfBoxOrder.map((type) => ({
        label: serfName(type),
        icon: serfIcon(type),
        get: () => {
          // PORT: std::map::operator[] gives 0 for a missing key.
          const waiting = idle.get().get(type) ?? 0;
          const possible = potential.get().get(type) ?? 0;
          return {
            text: `${waiting} waiting, ${possible} possible`,
            fill: stat3Level(waiting + possible) / 10,
            dim: waiting + possible === 0,
          };
        },
      })),
    ),
  );
  return {
    update: () => {
      idle.invalidate();
      potential.invalidate();
    },
  };
}

// ---------------------------------------------------------------------------
// The window: one tab for each box of TypeStatSelect.

interface StatPage {
  /* The box the tab opens. */
  box: PopupBoxType;
  /* The other boxes that show this page. */
  also?: PopupBoxType[];
  tab: string;
  title: string;
  /* The icon of the box in drawStatSelectBox() of popup.ts. */
  icon: number;
  build(ctx: BoxContext): BoxView;
}

const T = PopupBoxType;

/* In the order of the icons of the select box. */
const statPages: StatPage[] = [
  { box: T.TypeStat1, tab: 'Food', title: 'Food supply', icon: 72, build: stat1Page },
  { box: T.TypeStat2, tab: 'Materials', title: 'Supply of materials', icon: 73, build: stat2Page },
  { box: T.TypeStat3, tab: 'Idle serfs', title: 'Serfs waiting and possible', icon: 77, build: stat3Page },
  { box: T.TypeStat4, tab: 'Stock', title: 'Stock', icon: 74, build: stockPage },
  {
    box: T.TypeStatBld1,
    also: [T.TypeStatBld2, T.TypeStatBld3, T.TypeStatBld4],
    tab: 'Buildings',
    title: 'Buildings',
    icon: 76,
    build: buildingsPage,
  },
  { box: T.TypeStat6, tab: 'Serfs', title: 'Serfs', icon: 75, build: stat6Page },
  { box: T.TypeStat7, tab: 'Production', title: 'Production over time', icon: 71, build: stat7Page },
  {
    box: T.TypeStat8,
    also: [T.TypePlayerFaces],
    tab: 'Players',
    title: 'Players compared',
    icon: 70,
    build: stat8Page,
  },
];

/* The page TypeStatSelect opens: the one that was open last. */
let lastPage: StatPage = statPages[0];

function statsBox(ctx: BoxContext): BoxView {
  const { win } = ctx;
  const page =
    statPages.find((p) => p.box === ctx.box || p.also?.includes(ctx.box) === true) ?? lastPage;
  lastPage = page;

  win.setTitle(`Statistics: ${page.title}`);
  win.setPattern('green');
  win.setSize('wide');
  win.root.classList.add('stat-win');
  win.setTabs(
    statPages.map((p) => ({
      label: p.tab,
      title: p.title,
      box: p.box,
      icon: fitHeight(iconCanvas(p.icon), 1.6),
    })),
    statPages.indexOf(page),
    ctx.open,
  );

  const view = page.build(ctx);
  /* A page without a control of its own: the keys start at its tab. */
  if (win.initialFocus === null && win.body.querySelector('button, input, select, [tabindex="0"]') === null) {
    win.initialFocus = win.getSelectedTab();
  }

  win.foot().append(
    button('Settings', () => {
      /* ACTION_SHOW_SETT_SELECT, the flip icon of the select box. */
      ctx.sound(AudioTypeSfx.TypeSfxClick);
      ctx.open(PopupBoxType.TypeSettSelect);
    }, { icon: iconCanvas(61), title: 'Go to the settings' }),
  );
  return view;
}

export function registerStatBoxes(): void {
  registerBox(
    [
      PopupBoxType.TypeStatSelect,
      ...statPages.flatMap((p) => [p.box, ...(p.also ?? [])]),
    ],
    statsBox,
  );
  /* The map box is a file of its own (map.ts). Until index.ts calls its
     registerMapBoxes(), it is registered from here; calling it twice is
     harmless. */
  registerMapBoxes();
}
