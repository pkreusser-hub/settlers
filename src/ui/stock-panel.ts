// Stock panel: what the local player has in the castle and the storehouses,
// with an arrow for stocks that rise or fall, the serfs without work and the
// knights. Not part of Freeserf.
//
// Reading only: nothing here changes the game.
//
// Where the numbers come from:
// - Resources: Inventory::get_count_of summed over Game::get_player_inventories,
//   as Player::get_stats_resources does for the original statistics box
//   (PopupBox::draw_resources_box). The icons are the ones of that box:
//   icon 34 + type.
// - Serfs without work: Inventory::free_serf_count (generic_count) summed
//   over the same inventories: the generic serfs that wait in stock.
//   Player::get_serf_count(TypeGeneric) is not used for this, it also counts
//   generic serfs that are walking home or out.
// - Knights: Player::get_serf_count(TypeKnight0 + rank), the number the
//   original box of serfs shows (PopupBox::draw_serfs_box). Serf::set_type
//   keeps it up to date, so it counts every living knight of the rank: in
//   stock, in the guard buildings, on the way and in a fight. The tooltip
//   adds how many of them wait in stock (Player::get_stats_serfs_idle).
//   Icons 0x1d to 0x21 are the ranks, 0x82 the generic serf (popup.ts).

import './build-menu.css';

import { Asset } from '../data/data';
import { DEFAULT_GAME_SPEED } from '../game/game';
import type { Game } from '../game/game';
import type { GameManager } from '../game/game-manager';
import type { Player } from '../game/player';
import { ResourceType } from '../game/resource';
import { SerfType } from '../game/serf';
import { TICKS_PER_SEC } from './freeserf';
import type { Interface } from './interface';
import { blurActive, el, leftStack, resourceCanvas, spriteCanvas } from './overlay-dom';
import { legacyValue, prefSetString, prefString } from './prefs';
import { resourceName } from './production';

/* Game ticks in a second of play at normal speed: Game::update adds the
   game speed to the tick on each of the TICKS_PER_SEC steps. A paused game
   adds nothing and a fast one more, so times in ticks follow the game. */
const GAME_SECOND = TICKS_PER_SEC * DEFAULT_GAME_SPEED;

/* The trend compares the stock of now with the stock of about WINDOW ago.
   A sample is kept every STEP; until the oldest is MIN_AGE old no arrow is
   shown. */
const STEP = 5 * GAME_SECOND;
const WINDOW = 90 * GAME_SECOND;
const MIN_AGE = 30 * GAME_SECOND;

const RESOURCES = 26;
const UNEMPLOYED = RESOURCES;
const KNIGHTS = RESOURCES + 1;
const VALUES = KNIGHTS + 5;

/* The preference "stockPanel" (prefs.ts): "open" or "closed". The key it had
   before is read when the preference was never set. */
const prefName = 'stockPanel';
const legacyKey = 'settlers.stockPanel';

const R = ResourceType;

/* The resources in the order of Resource::Type, cut into groups. */
const groups: { title: string; first: ResourceType; last: ResourceType }[] = [
  { title: 'Food', first: R.TypeFish, last: R.TypeBread },
  { title: 'Wood and stone', first: R.TypeLumber, last: R.TypeStone },
  { title: 'Ore and metal', first: R.TypeIronOre, last: R.TypeGoldBar },
  { title: 'Tools', first: R.TypeShovel, last: R.TypePincer },
  { title: 'Weapons', first: R.TypeSword, last: R.TypeShield },
];

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* "Planks", "Shovels": the names of production.ts, the tools as a count. */
function stockName(res: ResourceType): string {
  let name = resourceName(res);
  if (res >= R.TypeShovel && res <= R.TypePincer && !name.endsWith('s')) name += 's';
  return capital(name);
}

interface Sample {
  tick: number;
  values: Int32Array;
}

interface Entry {
  box: HTMLElement;
  count: HTMLElement;
  arrow: HTMLElement;
  shownCount: number;
  shownTrend: number;
  shownLabel: string;
}

const trendWords = ['falling', '', 'rising'];
const trendSigns = ['▼', '', '▲'];
const trendClasses = ['st-down', '', 'st-up'];

export class StockPanel {
  protected root: HTMLElement;
  protected toggleButton: HTMLButtonElement;
  protected body: HTMLElement;
  protected entries: Entry[] = [];
  protected expanded = true;

  protected game: Game | null = null;
  protected player: Player | null = null;
  protected samples: Sample[] = [];

  constructor(protected iface: Interface) {
    this.root = el('div', 'gx-box');
    this.root.id = 'gx-stock';
    this.root.hidden = true;

    this.toggleButton = el('button', 'st-toggle');
    this.toggleButton.type = 'button';
    this.toggleButton.setAttribute('aria-controls', 'gx-stock-body');
    const mark = el('span', 'st-mark');
    mark.setAttribute('aria-hidden', 'true');
    this.toggleButton.append(mark, el('span', '', 'Stock'));
    this.toggleButton.addEventListener('click', () => {
      this.setExpanded(!this.expanded);
      blurActive();
    });

    this.body = el('div', 'st-body');
    this.body.id = 'gx-stock-body';
    this.build();

    this.root.append(this.toggleButton, this.body);
    leftStack().prepend(this.root);

    const stored = prefString(prefName, legacyValue(legacyKey) ?? 'open');
    this.setExpanded(stored !== 'closed', false);

    window.addEventListener('resize', () => {
      if (!this.root.hidden) this.clearHud();
    });
    window.setInterval(() => this.update(), 1000);
    this.update();
  }

  isExpanded(): boolean {
    return this.expanded;
  }

  setExpanded(expanded: boolean, remember = true): void {
    this.expanded = expanded;
    this.toggleButton.setAttribute('aria-expanded', String(expanded));
    this.toggleButton.title = expanded ? 'Hide the stock' : 'Show the stock';
    this.root.classList.toggle('st-closed', !expanded);
    this.body.hidden = !expanded;
    /* Without storage the panel opens the next time. */
    if (remember) prefSetString(prefName, expanded ? 'open' : 'closed');
    if (expanded) this.update();
  }

  protected build(): void {
    const group = (title: string): HTMLElement => {
      const box = el('div', 'st-group');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', title);
      const head = el('div', 'st-head');
      head.textContent = title;
      head.setAttribute('aria-hidden', 'true');
      box.append(head);
      this.body.append(box);
      return box;
    };
    const entry = (parent: HTMLElement, icon: HTMLCanvasElement): void => {
      const box = el('span', 'st-item');
      box.setAttribute('role', 'img');
      const count = el('span', 'st-n');
      const arrow = el('span', 'st-trend');
      box.append(icon, count, arrow);
      parent.append(box);
      this.entries.push({ box, count, arrow, shownCount: -1, shownTrend: 0, shownLabel: '' });
    };

    /* Entries in the order of the values: the 26 resources, the serfs
       without work, the five ranks. */
    for (const g of groups) {
      const box = group(g.title);
      for (let res = g.first; res <= g.last; res++) {
        entry(box, resourceCanvas(res as ResourceType));
      }
    }
    const people = group('Workers and knights');
    const serfIcon = (index: number): HTMLCanvasElement => {
      const canvas = spriteCanvas(Asset.Icon, index);
      canvas.classList.add('gx-res');
      return canvas;
    };
    entry(people, serfIcon(0x82));
    for (let rank = 0; rank < 5; rank++) {
      entry(people, serfIcon(0x1d + rank));
    }
  }

  /* The values of now: only the inventories of the local player are read. */
  protected read(game: Game, player: Player): Int32Array {
    const values = new Int32Array(VALUES);
    for (const inventory of game.getPlayerInventories(player)) {
      for (let res = 0; res < RESOURCES; res++) {
        values[res] += inventory.getCountOf(res as ResourceType);
      }
      /* free_serf_count is unsigned in the game: a count below zero reads
         as a huge number there and as nothing here. */
      const free = inventory.freeSerfCount();
      if (free < 0x80000000) values[UNEMPLOYED] += free;
    }
    for (let rank = 0; rank < 5; rank++) {
      values[KNIGHTS + rank] = player.getSerfCount(SerfType.TypeKnight0 + rank);
    }
    return values;
  }

  /* -1, 0 or 1 for each value: against the oldest sample kept, which is
     about WINDOW old once the game has run that long. */
  protected trends(tick: number, values: Int32Array): Int8Array {
    const last = this.samples[this.samples.length - 1];
    if (last === undefined || tick - last.tick >= STEP) {
      this.samples.push({ tick, values: values.slice() });
    }
    while (this.samples.length >= 2 && tick - this.samples[1].tick >= WINDOW) {
      this.samples.shift();
    }
    const trends = new Int8Array(VALUES);
    const then = this.samples[0];
    if (tick - then.tick >= MIN_AGE) {
      for (let i = 0; i < VALUES; i++) {
        trends[i] = Math.sign(values[i] - then.values[i]);
      }
    }
    return trends;
  }

  /* The strip of page controls (#hud of hud.ts) lies at the top right and
     grows to the left: where the panel would reach under it, the panel
     starts below it. Only the width decides, so the panel does not jump
     back once it has moved. */
  protected clearHud(): void {
    let top = 0;
    const hud = document.getElementById('hud');
    if (hud !== null) {
      const strip = hud.getBoundingClientRect();
      const box = this.root.getBoundingClientRect();
      if (strip.width > 0 && strip.left < box.left + box.width + 8) {
        const stack = leftStack().getBoundingClientRect();
        top = Math.max(0, Math.ceil(strip.bottom - stack.top + 6));
      }
    }
    const margin = top > 0 ? `${top}px` : '';
    if (this.root.style.marginTop !== margin) this.root.style.marginTop = margin;
  }

  protected update(): void {
    const game = this.iface.getGame() ?? null;
    const player = this.iface.getPlayer();
    if (game === null || player === null || this.iface.isGameInitOpen()) {
      this.root.hidden = true;
      this.game = null;
      this.player = null;
      this.samples = [];
      return;
    }

    /* Another game (new, loaded, rebuilt by an online resync), another
       player, or a tick that went back: the samples are of no use. */
    const tick = game.getTick();
    const last = this.samples[this.samples.length - 1];
    if (game !== this.game || player !== this.player || (last !== undefined && tick < last.tick)) {
      this.game = game;
      this.player = player;
      this.samples = [];
    }

    const values = this.read(game, player);
    const trends = this.trends(tick, values);
    this.root.hidden = false;
    this.clearHud();
    if (!this.expanded) return;

    /* Knights that wait in stock, for the tooltips only. */
    const idle = player.getStatsSerfsIdle();

    for (let i = 0; i < VALUES; i++) {
      const entry = this.entries[i];
      const value = values[i];
      const trend = trends[i];

      let label: string;
      if (i < RESOURCES) {
        label = `${stockName(i as ResourceType)}: ${value}`;
      } else if (i === UNEMPLOYED) {
        label = `Serfs without work, in stock: ${value}`;
      } else {
        const rank = i - KNIGHTS;
        const inStock = idle.get((SerfType.TypeKnight0 + rank) as SerfType) ?? 0;
        const which = rank === 0 ? ' (weakest)' : rank === 4 ? ' (strongest)' : '';
        label = `Knights of rank ${rank + 1}${which}: ${value} in all, ${inStock} of them in stock`;
      }
      if (trend !== 0) label += `, ${trendWords[trend + 1]}`;

      if (value !== entry.shownCount) {
        entry.shownCount = value;
        entry.count.textContent = String(value);
        entry.box.classList.toggle('st-zero', value === 0);
      }
      if (trend !== entry.shownTrend) {
        entry.shownTrend = trend;
        entry.arrow.textContent = trendSigns[trend + 1];
        entry.arrow.className = `st-trend ${trendClasses[trend + 1]}`.trim();
      }
      if (label !== entry.shownLabel) {
        entry.shownLabel = label;
        entry.box.title = label;
        entry.box.setAttribute('aria-label', label);
      }
    }
  }
}

export function initStockPanel(iface: Interface, _gameManager?: GameManager): StockPanel {
  return new StockPanel(iface);
}
