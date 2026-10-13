// The settings boxes of the game as one window of the page with a page per
// box: TypeSettSelect (the overview), TypeSett1 to TypeSett6, TypeSett8 and
// TypeKnightLevel of popup.ts. Opening any of these box types opens its
// page; the tabs under the title go from one to the other. Not part of
// Freeserf.
//
// The options, quit and save boxes that the overview leads to are in
// options.ts.

import './settings.css';

import { Asset } from '../../data/data';
import { BuildingType } from '../../game/building';
import { idiv } from '../../game/misc';
import { ResourceType } from '../../game/resource';
import {
  canPromoteSerfsToKnights,
  cmdChangeCastleKnightsWanted,
  cmdChangeKnightOccupation,
  cmdCycleKnights,
  cmdMovePriority,
  cmdPromoteSerfsToKnights,
  cmdResetPriority,
  cmdSetDistribution,
  cmdSetSendStrongest,
  cmdSetSerfToKnightRate,
  cmdSetToolPrio,
} from '../../net/commands';
import type { DistributionSetting, PriorityReset } from '../../net/commands';
import { AudioTypeSfx } from '../audio';
import { PopupBoxType } from '../popup';
import { registerBox } from './kit';
import type { BoxContext, BoxView, Widget } from './kit';
import { resourceLabel } from './names';
import { registerOptionBoxes } from './options';
import {
  assetCanvas,
  button,
  buildingIcon,
  el,
  fitHeight,
  hint,
  iconCanvas,
  numberRow,
  priorityList,
  resourceIcon,
  section,
  segmented,
  shareSlider,
  stepper,
} from './widgets';
import type { PriorityItem, PriorityMove } from './widgets';

interface Page {
  box: PopupBoxType;
  /* The short name on the tab and the long one in the title bar. */
  tab: string;
  title: string;
  /* The icon of the page in drawSettSelectBox() of popup.ts. */
  icon: number;
  /* One sentence: what the settings of the page do. Shown in the overview
     and at the top of the page. */
  about: string;
  build(ctx: BoxContext): BoxView | void;
}

// ---------------------------------------------------------------------------
// Parts that several pages use.

const click = (ctx: BoxContext): void => ctx.sound(AudioTypeSfx.TypeSfxClick);

interface Bar {
  label: string;
  icon: HTMLElement;
  setting: DistributionSetting;
  get(): number;
}

/* A group of slide bars of the distribution boxes, each a
   cmdSetDistribution() as the ACTION_SETT_*_ADJUST_* of popup.ts. */
function barSection(ctx: BoxContext, title: string, bars: Bar[]): Widget {
  return section(
    title,
    ...bars.map((bar) =>
      shareSlider({
        label: bar.label,
        icon: bar.icon,
        get: bar.get,
        set: (value) => cmdSetDistribution(ctx.game, bar.setting, value),
      }),
    ),
  );
}

/* The button with icon 295 of the original boxes: back to the values of the
   start, one cmdResetPriority() per reset of the ACTION_DEFAULT_SETT_*. */
function defaultsButton(ctx: BoxContext, resets: PriorityReset[], title: string): HTMLButtonElement {
  return button('Default values', () => {
    click(ctx);
    for (const reset of resets) cmdResetPriority(ctx.game, reset);
  }, { icon: iconCanvas(295), title });
}

function bld(ctx: BoxContext, type: BuildingType): HTMLCanvasElement {
  return fitHeight(buildingIcon(type, ctx.player.getColor()), 2.4);
}

// ---------------------------------------------------------------------------
// The pages.

/* TypeSett1: how the food is shared between the mines. The four slide bars
   of drawSett1Box() of popup.ts, in its order. */
function sett1Page(ctx: BoxContext): void {
  const { win, player } = ctx;
  win.add(
    barSection(ctx, 'Fish, meat and bread', [
      {
        label: 'Stone mines',
        icon: bld(ctx, BuildingType.TypeStoneMine),
        setting: 'setFoodStonemine',
        get: () => player.getFoodStonemine(),
      },
      {
        label: 'Coal mines',
        icon: bld(ctx, BuildingType.TypeCoalMine),
        setting: 'setFoodCoalmine',
        get: () => player.getFoodCoalmine(),
      },
      {
        label: 'Iron mines',
        icon: bld(ctx, BuildingType.TypeIronMine),
        setting: 'setFoodIronmine',
        get: () => player.getFoodIronmine(),
      },
      {
        label: 'Gold mines',
        icon: bld(ctx, BuildingType.TypeGoldMine),
        setting: 'setFoodGoldmine',
        get: () => player.getFoodGoldmine(),
      },
    ]),
  );
  /* ACTION_DEFAULT_SETT_1. */
  win.foot().append(
    defaultsButton(ctx, ['resetFoodPriority'], 'Set the four bars as they were at the start'),
  );
}

/* TypeSett2: planks for building sites, boat builders and toolmakers, steel
   for toolmakers and weaponsmiths (drawSett2Box). */
function sett2Page(ctx: BoxContext): void {
  const { win, player } = ctx;
  win.add(
    barSection(ctx, 'Planks', [
      {
        label: 'Building sites',
        /* The frame of a house, as the original box shows it. */
        icon: fitHeight(assetCanvas(Asset.MapObject, 186, player.getColor()), 2.4),
        setting: 'setPlanksConstruction',
        get: () => player.getPlanksConstruction(),
      },
      {
        label: 'Boat builders',
        icon: bld(ctx, BuildingType.TypeBoatbuilder),
        setting: 'setPlanksBoatbuilder',
        get: () => player.getPlanksBoatbuilder(),
      },
      {
        label: 'Toolmakers',
        icon: bld(ctx, BuildingType.TypeToolMaker),
        setting: 'setPlanksToolmaker',
        get: () => player.getPlanksToolmaker(),
      },
    ]),
    barSection(ctx, 'Steel', [
      {
        label: 'Toolmakers',
        icon: bld(ctx, BuildingType.TypeToolMaker),
        setting: 'setSteelToolmaker',
        get: () => player.getSteelToolmaker(),
      },
      {
        label: 'Weaponsmiths',
        icon: bld(ctx, BuildingType.TypeWeaponSmith),
        setting: 'setSteelWeaponsmith',
        get: () => player.getSteelWeaponsmith(),
      },
    ]),
  );
  /* ACTION_DEFAULT_SETT_2. */
  win.foot().append(
    defaultsButton(
      ctx,
      ['resetPlanksPriority', 'resetSteelPriority'],
      'Set the five bars as they were at the start',
    ),
  );
}

/* TypeSett3: coal for the smelters and the weaponsmith, wheat for pig farms
   and mills (drawSett3Box). */
function sett3Page(ctx: BoxContext): void {
  const { win, player } = ctx;
  win.add(
    barSection(ctx, 'Coal', [
      {
        label: 'Steel smelters',
        icon: bld(ctx, BuildingType.TypeSteelSmelter),
        setting: 'setCoalSteelsmelter',
        get: () => player.getCoalSteelsmelter(),
      },
      {
        label: 'Gold smelters',
        icon: bld(ctx, BuildingType.TypeGoldSmelter),
        setting: 'setCoalGoldsmelter',
        get: () => player.getCoalGoldsmelter(),
      },
      {
        label: 'Weaponsmiths',
        icon: bld(ctx, BuildingType.TypeWeaponSmith),
        setting: 'setCoalWeaponsmith',
        get: () => player.getCoalWeaponsmith(),
      },
    ]),
    barSection(ctx, 'Wheat', [
      {
        label: 'Pig farms',
        icon: bld(ctx, BuildingType.TypePigFarm),
        setting: 'setWheatPigfarm',
        get: () => player.getWheatPigfarm(),
      },
      {
        label: 'Mills',
        icon: bld(ctx, BuildingType.TypeMill),
        setting: 'setWheatMill',
        get: () => player.getWheatMill(),
      },
    ]),
  );
  /* ACTION_DEFAULT_SETT_3. */
  win.foot().append(
    defaultsButton(
      ctx,
      ['resetCoalPriority', 'resetWheatPriority'],
      'Set the five bars as they were at the start',
    ),
  );
}

/* TypeSett4: the nine tools in the order of drawSett4Box(), each with the
   index that cmdSetToolPrio() takes (shovel 0, hammer 1, rod 2, cleaver 3,
   scythe 4, axe 5, saw 6, pick 7, pincer 8). */
const tools: { tool: number; res: ResourceType }[] = [
  { tool: 0, res: ResourceType.TypeShovel },
  { tool: 1, res: ResourceType.TypeHammer },
  { tool: 5, res: ResourceType.TypeAxe },
  { tool: 6, res: ResourceType.TypeSaw },
  { tool: 4, res: ResourceType.TypeScythe },
  { tool: 7, res: ResourceType.TypePick },
  { tool: 8, res: ResourceType.TypePincer },
  { tool: 3, res: ResourceType.TypeCleaver },
  { tool: 2, res: ResourceType.TypeRod },
];

function sett4Page(ctx: BoxContext): void {
  const { win, game, player } = ctx;
  for (const { tool, res } of tools) {
    win.add(
      shareSlider({
        label: resourceLabel(res),
        icon: resourceIcon(res),
        get: () => player.getToolPrio(tool),
        /* ACTION_SETT_4_ADJUST_*. */
        set: (value) => cmdSetToolPrio(game, tool, value),
      }),
    );
  }
  /* ACTION_DEFAULT_SETT_4. */
  win.foot().append(
    defaultsButton(ctx, ['resetToolPriority'], 'Set the nine bars as they were at the start'),
  );
}

/* TypeSett5 and TypeSett6: the 26 resources in an order. The player keeps a
   place 1 to 26 for each resource, 26 is the first of the list (the top of
   the stairs of drawPopupResourceStairs()). The four buttons of a row are
   the four buttons of the original box for the resource of that row. */
function orderPage(ctx: BoxContext, inventory: boolean): void {
  const { win, game, player } = ctx;
  const places = (): number[] => (inventory ? player.getInventoryPrio() : player.getFlagPrio());

  const moves: { [how in PriorityMove]: [boolean, boolean] } = {
    /* ACTION_SETT_5_6_TOP, _UP, _DOWN, _BOTTOM: moveSett56Item(up, toEnd). */
    top: [true, true],
    up: [true, false],
    down: [false, false],
    bottom: [false, true],
  };

  const items: PriorityItem[] = [];
  for (let res = 0; res < 26; res++) {
    items.push({ id: res, label: resourceLabel(res as ResourceType), icon: resourceIcon(res as ResourceType) });
  }

  win.add(
    priorityList({
      label: inventory ? 'Order out of a stock' : 'Order of transport',
      items,
      getOrder: () => {
        const prio = places();
        return items.map((item) => item.id).sort((a, b) => prio[b] - prio[a] || a - b);
      },
      move: (id, how) => {
        click(ctx);
        const [up, toEnd] = moves[how];
        cmdMovePriority(game, inventory, id, up, toEnd);
      },
    }),
  );
  /* ACTION_DEFAULT_SETT_5_6. */
  win.foot().append(
    defaultsButton(
      ctx,
      [inventory ? 'resetInventoryPriority' : 'resetFlagPriority'],
      'Set the order as it was at the start',
    ),
  );
}

/* TypeKnightLevel. The names of drawKnightLevelBox(); the knights that a
   level stands for are the tables of Building::update_military() and
   Player::start_attack(). */
const occupationNames = ['Minimum', 'Weak', 'Medium', 'Good', 'Full'];

function occupationName(level: number): string {
  return occupationNames[level] ?? 'ERROR';
}

/* The four classes of Building::update_military_flag_state(), from 3 (land
   of another player in the nearest ring around the building) to 0 (none in
   the rings it checks), with the icons 226 to 229 of the original box. */
const distances: { level: number; title: string; icon: number }[] = [
  { level: 3, title: 'At the border', icon: 226 },
  { level: 2, title: 'Near the border', icon: 227 },
  { level: 1, title: 'Farther from the border', icon: 228 },
  { level: 0, title: 'Far from any other player', icon: 229 },
];

function knightLevelPage(ctx: BoxContext): void {
  const { win, game, player } = ctx;
  win.add(
    hint(
      'Knights in a hut, tower or fortress: Minimum 1, 1, 1. Weak 1, 2, 3. Medium 2, 3, 6. ' +
      'Good 2, 4, 9. Full 3, 6, 12.',
    ),
  );
  for (const { level, title, icon } of distances) {
    const max = (): number => (player.getKnightOccupation(level) >> 4) & 0x7;
    const min = (): number => player.getKnightOccupation(level) & 0x7;
    const change = (adjustMax: boolean, delta: number): void => {
      /* ACTION_KNIGHT_LEVEL_*_MAX_DEC and the 15 others. */
      click(ctx);
      cmdChangeKnightOccupation(game, level, adjustMax, delta);
    };
    const part = section(
      title,
      stepper({
        label: 'Knights to call for',
        icon: iconCanvas(icon),
        get: () => occupationName(max()),
        dec: () => change(true, -1),
        inc: () => change(true, 1),
        /* The limits of Player::change_knight_occupation(). */
        canDec: () => max() > min(),
        canInc: () => max() < 4,
        decLabel: `Call for fewer knights, ${title.toLowerCase()}`,
        incLabel: `Call for more knights, ${title.toLowerCase()}`,
      }),
      stepper({
        label: 'Knights that stay in an attack',
        get: () => occupationName(min()),
        dec: () => change(false, -1),
        inc: () => change(false, 1),
        canDec: () => min() > 0,
        canInc: () => min() < max(),
        decLabel: `Keep fewer knights home, ${title.toLowerCase()}`,
        incLabel: `Keep more knights home, ${title.toLowerCase()}`,
      }),
    );
    part.el.classList.add('sg-distance');
    win.add(part);
  }
}

/* TypeSett8: knights. Everything drawSett8Box() shows, from the top. */
function sett8Page(ctx: BoxContext): BoxView {
  const { win, game, player } = ctx;

  /* The number next to the train buttons of the original. */
  const convertible = (): number => {
    let count = 0;
    for (const inv of game.getPlayerInventories(player)) {
      const c = Math.min(inv.getCountOf(ResourceType.TypeSword), inv.getCountOf(ResourceType.TypeShield));
      count += Math.max(0, Math.min(c, inv.freeSerfCount()));
    }
    return count | 0;
  };

  /* sett8Train() of popup.ts. */
  const train = (number: number): void => {
    click(ctx);
    const can = canPromoteSerfsToKnights(game, player);
    cmdPromoteSerfsToKnights(game, number);
    ctx.sound(can ? AudioTypeSfx.TypeSfxAccepted : AudioTypeSfx.TypeSfxNotAccepted);
  };

  const trainRow = el('div', 'mk-row sg-train');
  trainRow.setAttribute('role', 'group');
  const trainLabel = el('span', 'mk-label');
  const trainPic = el('span', 'mk-pic');
  trainPic.append(iconCanvas(130));
  trainLabel.append(trainPic, el('span', 'mk-label-text', 'Make knights now'));
  trainLabel.id = 'sg-train-label';
  trainRow.setAttribute('aria-labelledby', trainLabel.id);
  const trainSide = el('span', 'mk-side');
  for (const number of [1, 5, 20, 100]) {
    /* ACTION_SETT_8_TRAIN_1, _5, _20, _100. */
    const b = button(String(number), () => train(number), {
      title: number === 1 ? 'Make 1 serf a knight' : `Make up to ${number} serfs knights`,
    });
    b.setAttribute('aria-label', b.title);
    trainSide.append(b);
  }
  trainRow.append(trainLabel, trainSide);

  const cycleRow = el('div', 'mk-row sg-cycle');
  const cycleLabel = el('span', 'mk-label');
  const cyclePic = el('span', 'mk-pic');
  cyclePic.append(fitHeight(iconCanvas(301), 2.4));
  cycleLabel.append(cyclePic, el('span', 'mk-label-text', 'Swap weak knights for strong ones'));
  const cycleSide = el('span', 'mk-side');
  const cycleState = el('span', 'mk-value sg-state');
  cycleState.setAttribute('aria-live', 'polite');
  cycleSide.append(
    cycleState,
    button('Swap', () => {
      /* ACTION_SETT_8_CYCLE. */
      click(ctx);
      cmdCycleKnights(game);
      ctx.sound(AudioTypeSfx.TypeSfxAccepted);
    }, {
      title: 'Military buildings send their weakest knights home for a while, then call for the best',
    }),
  );
  cycleRow.append(cycleLabel, cycleSide);
  let cycleShown = '';

  win.add(
    section(
      'New knights',
      shareSlider({
        label: 'Share of new serfs that become knights',
        icon: iconCanvas(29),
        title: 'A new serf becomes a knight only when its stock has a sword and a shield',
        get: () => player.getSerfToKnightRate(),
        /* ACTION_SETT_8_ADJUST_RATE. */
        set: (value) => cmdSetSerfToKnightRate(game, value),
      }),
      trainRow,
      numberRow({
        label: 'Serfs that can become knights now',
        title: 'Free serfs in a stock that also has a sword and a shield for them',
        get: convertible,
      }),
    ),
    section(
      'Strength',
      numberRow({
        label: 'Morale',
        icon: iconCanvas(304),
        title: 'Counts when your knights fight outside your land; 100% is the strength at home',
        get: () => `${idiv(100 * player.getKnightMorale(), 0x1000)}%`,
      }),
      numberRow({
        label: 'Gold in your stocks and military buildings',
        icon: iconCanvas(303),
        title: 'More of the gold of the map gives a higher morale',
        get: () => player.getGoldDeposited(),
      }),
    ),
    section(
      'Attacks',
      segmented<boolean>({
        label: 'Knights that leave a building to attack',
        options: [
          { value: false, label: 'The weakest first' },
          { value: true, label: 'The strongest first' },
        ],
        get: () => player.sendStrongest(),
        set: (strongest) => {
          /* ACTION_SETT_8_SET_COMBAT_MODE_WEAK and _STRONG. */
          click(ctx);
          cmdSetSendStrongest(game, strongest);
          ctx.sound(AudioTypeSfx.TypeSfxAccepted);
        },
      }),
      cycleRow,
    ),
    section(
      'Castle',
      stepper({
        label: 'Knights wanted in the castle',
        get: () => player.getCastleKnightsWanted(),
        /* ACTION_SETT_8_CASTLE_DEF_DEC and _INC. */
        dec: () => {
          click(ctx);
          cmdChangeCastleKnightsWanted(game, -1);
        },
        inc: () => {
          click(ctx);
          cmdChangeCastleKnightsWanted(game, 1);
        },
        /* The limits of Player::decrease_ and increase_castle_knights_wanted(). */
        canDec: () => player.getCastleKnightsWanted() > 1,
        canInc: () => player.getCastleKnightsWanted() < 99,
        decLabel: 'Fewer knights in the castle',
        incLabel: 'More knights in the castle',
      }),
      numberRow({
        label: 'Knights in the castle now',
        get: () => player.getCastleKnights(),
      }),
    ),
  );

  return {
    update: () => {
      const text = player.cyclingKnight() ? 'Swap running' : 'Not running';
      if (text !== cycleShown) {
        cycleShown = text;
        cycleState.textContent = text;
      }
    },
  };
}

/* TypeSettSelect: the overview. The eight pages, and the four other boxes
   the original box leads to. */
function overviewPage(ctx: BoxContext): void {
  const { win } = ctx;

  const list = el('ul', 'sg-menu');
  list.setAttribute('aria-label', 'Settings');
  for (const page of pages) {
    if (page.box === PopupBoxType.TypeSettSelect) continue;
    const item = el('li', '');
    /* ACTION_SHOW_SETT_1 to _8. */
    const b = el('button', 'gx-btn sg-menu-item');
    b.type = 'button';
    const pic = el('span', 'mk-pic sg-menu-pic');
    pic.append(iconCanvas(page.icon));
    const text = el('span', 'sg-menu-text');
    text.append(el('span', 'sg-menu-name', page.title), el('span', 'sg-menu-about', page.about));
    b.append(pic, text);
    b.addEventListener('click', () => {
      click(ctx);
      ctx.open(page.box);
    });
    item.append(b);
    list.append(item);
  }

  const go = (label: string, box: PopupBoxType, title: string): HTMLButtonElement =>
    button(label, () => {
      click(ctx);
      ctx.open(box);
    }, { title });

  /* The icons of these four in the original are the words themselves. */
  const other = section('Game');
  other.content.classList.add('sg-other');
  other.content.append(
    /* ACTION_SHOW_STAT_SELECT, ActionShowOptions, ACTION_SHOW_SAVE,
       ACTION_SHOW_QUIT. */
    go('Statistics', PopupBoxType.TypeStatSelect, 'Stocks, buildings, serfs and the other players'),
    go('Options', PopupBoxType.TypeOptions, 'Music, sound, messages and more'),
    go('Save game', PopupBoxType.TypeLoadSave, 'Save this game in the browser'),
    go('Quit game', PopupBoxType.TypeQuitConfirm, 'End this game'),
  );

  win.add(list, other);
}

const distributionAbout = (what: string): string =>
  `A building with a longer bar gets ${what} before the others.`;

const pages: Page[] = [
  {
    box: PopupBoxType.TypeSettSelect,
    tab: 'Overview',
    title: 'Settings',
    icon: 0,
    about: 'What your settlers do first. The settings are part of the game and are saved with it.',
    build: overviewPage,
  },
  {
    box: PopupBoxType.TypeSett1,
    tab: 'Food',
    title: 'Food for the mines',
    icon: 230,
    about: 'A mine with a longer bar gets fish, meat and bread before the others.',
    build: sett1Page,
  },
  {
    box: PopupBoxType.TypeSett2,
    tab: 'Planks, steel',
    title: 'Planks and steel',
    icon: 231,
    about: distributionAbout('planks or steel'),
    build: sett2Page,
  },
  {
    box: PopupBoxType.TypeSett3,
    tab: 'Coal, wheat',
    title: 'Coal and wheat',
    icon: 232,
    about: distributionAbout('coal or wheat'),
    build: sett3Page,
  },
  {
    box: PopupBoxType.TypeSett4,
    tab: 'Tools',
    title: 'Tools to make',
    icon: 234,
    about: 'A toolmaker picks each tool by chance; a longer bar makes that tool more likely.',
    build: sett4Page,
  },
  {
    box: PopupBoxType.TypeSett5,
    tab: 'Transport',
    title: 'Order of transport',
    icon: 235,
    about: 'When several goods wait at a flag for the same road, the carrier takes the highest in this list first.',
    build: (ctx) => orderPage(ctx, false),
  },
  {
    box: PopupBoxType.TypeSett6,
    tab: 'Emptying',
    title: 'Order out of a stock',
    icon: 299,
    about: 'A castle or stock that is set to send its goods away sends the highest in this list first.',
    build: (ctx) => orderPage(ctx, true),
  },
  {
    box: PopupBoxType.TypeKnightLevel,
    tab: 'Garrisons',
    title: 'Knights in military buildings',
    icon: 233,
    about:
      'How many knights a military building calls for, and how many stay in it when you attack, ' +
      'by its distance to the land of another player.',
    build: knightLevelPage,
  },
  {
    box: PopupBoxType.TypeSett8,
    tab: 'Knights',
    title: 'Knights and the castle',
    icon: 298,
    about: 'Make serfs knights, choose who goes to attack and set the guard of the castle.',
    build: sett8Page,
  },
];

/* The one factory of the settings boxes: the window with the tabs and the
   page of ctx.box. */
function settingsBox(ctx: BoxContext): BoxView | void {
  const { win } = ctx;
  const current = pages.findIndex((page) => page.box === ctx.box);
  const page = pages[current];

  win.setTitle(page.title);
  /* PatternCheckerdDiagonalBrown, the background of all these boxes. */
  win.setPattern('brown');
  win.setSize('wide');
  win.root.classList.add('sg-win');
  win.setTabs(
    pages.map((p) => ({
      label: p.tab,
      box: p.box,
      title: p.title,
      icon: p.icon !== 0 ? fitHeight(iconCanvas(p.icon), 1.5) : undefined,
    })),
    current,
    ctx.open,
  );

  win.add(hint(page.about));
  return page.build(ctx);
}

export function registerSettingsBoxes(): void {
  registerBox(pages.map((page) => page.box), settingsBox);
  /* Until index.ts calls it itself (it does nothing the second time). */
  registerOptionBoxes();
}
