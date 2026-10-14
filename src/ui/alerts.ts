// Alerts: a short list of things that hold up the local player's economy,
// found by reading the game about once a second. Not part of Freeserf.
//
// Reading only: nothing here changes the game. A click on an alert moves
// the view and the map cursor, which are state of the interface.

import './build-menu.css';

import { BuildingType, ProductionHold } from '../game/building';
import type { Building } from '../game/building';
import type { Game } from '../game/game';
import type { GameManager } from '../game/game-manager';
import type { MapPos } from '../game/map';
import { Direction } from '../game/map-geometry';
import type { Player } from '../game/player';
import { ResourceType } from '../game/resource';
import type { Interface } from './interface';
import { blurActive, buildingCanvas, el, leftStack, resourceCanvas } from './overlay-dom';
import { buildingName, foodResources, isMine, resourceName } from './production';

/* How long a state has to last before it is shown, in checks (one a second
   while the game runs): stocks run empty for a moment all the time. */
const WAIT_WORKER = 60;
const WAIT_INPUT = 30;
const WAIT_KNIGHTS = 30;
const WAIT_ROAD = 15;
const WAIT_MATERIAL = 5;

const MAX_SHOWN = 30;

interface Alert {
  key: string;
  text: string;
  pos: MapPos;
  /* The icon: a resource, or the building. */
  res: ResourceType | null;
  type: BuildingType;
}

/* Buildings that ask for a worker of their own when finished: the types
   with a serf in the table of Building::request_serf_if_needed, and the
   storehouse, which asks for a transporter (Building::update, TypeStock). */
export function wantsWorker(type: BuildingType): boolean {
  switch (type) {
    case BuildingType.TypeNone:
    case BuildingType.TypeHut:
    case BuildingType.TypeTower:
    case BuildingType.TypeFortress:
    case BuildingType.TypeCastle:
      return false;
    default:
      return true;
  }
}

export function isGuard(type: BuildingType): boolean {
  return (
    type === BuildingType.TypeHut ||
    type === BuildingType.TypeTower ||
    type === BuildingType.TypeFortress
  );
}

export class Alerts {
  protected root: HTMLElement;
  protected toggleButton: HTMLButtonElement;
  protected countBadge: HTMLElement;
  protected list: HTMLElement;
  protected expanded = false;
  protected shown = '';
  protected alerts: Alert[] = [];

  protected game: Game | null = null;
  protected lastTick = -1;
  /* Checks in a row that a state was found, by the key of its alert. */
  protected waits = new Map<string, number>();

  constructor(protected iface: Interface) {
    this.root = el('div', 'gx-box');
    this.root.id = 'gx-alerts';
    this.root.hidden = true;

    this.toggleButton = el('button', 'al-toggle');
    this.toggleButton.type = 'button';
    this.toggleButton.setAttribute('aria-expanded', 'false');
    this.toggleButton.setAttribute('aria-controls', 'gx-alerts-list');
    this.countBadge = el('span', 'al-count', '0');
    const key = el('kbd', '', 'L');
    key.title = 'Key L opens and closes the list';
    this.toggleButton.append(this.countBadge, el('span', '', 'Alerts'), key);
    this.toggleButton.addEventListener('click', () => {
      this.setExpanded(!this.expanded);
      blurActive();
    });

    this.list = el('ul', 'al-list');
    this.list.id = 'gx-alerts-list';
    this.list.hidden = true;
    /* The arrow keys move in the list and do not scroll the map. */
    this.list.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = Array.from(this.list.querySelectorAll<HTMLButtonElement>('button'));
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = items[at + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next !== undefined) next.focus();
      e.preventDefault();
      e.stopPropagation();
    });

    this.root.append(this.toggleButton, this.list);
    leftStack().prepend(this.root);

    this.iface.keyHooks.push((k, modifier) => this.handleKey(k, modifier));
    window.setInterval(() => this.check(), 1000);
    this.check();
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.toggleButton.setAttribute('aria-expanded', String(expanded));
    this.list.hidden = !expanded;
  }

  protected handleKey(key: number, modifier: number): boolean {
    if (key !== 0x6c /* 'l' */ || (modifier & 5) !== 0) return false;
    if (this.root.hidden) return false;
    this.setExpanded(!this.expanded);
    return true;
  }

  /* Read the game and show what was found. */
  protected check(): void {
    const game = this.iface.getGame();
    const player = this.iface.getPlayer();
    if (!game || player === null || this.iface.isGameInitOpen() || !player.hasCastle()) {
      this.root.hidden = true;
      this.game = game ?? null;
      this.waits.clear();
      return;
    }
    if (game !== this.game) {
      this.game = game;
      this.waits.clear();
      this.lastTick = -1;
    }
    /* A paused game does not make anything wait longer. */
    const tick = game.getTick();
    const step = tick !== this.lastTick ? 1 : 0;
    this.lastTick = tick;

    this.alerts = this.collect(game, player, step);
    this.root.hidden = false;
    this.render();
  }

  protected collect(game: Game, player: Player, step: number): Alert[] {
    const next = new Map<string, number>();
    /* Whether the state of this key has lasted `wait` checks. */
    const lasted = (key: string, wait: number): boolean => {
      const n = (this.waits.get(key) ?? 0) + step;
      next.set(key, n);
      return n >= wait;
    };

    const alerts: Alert[] = [];
    let plankSites = 0;
    let stoneSites = 0;
    let plankSite: Building | null = null;
    let stoneSite: Building | null = null;

    for (const building of game.getPlayerBuildings(player)) {
      if (building.isBurning()) continue;
      const type = building.getType();
      /* Building 0 of the game is a blank that every list starts with. */
      if (type === BuildingType.TypeNone) continue;
      const index = building.getIndex();
      const pos = building.getPosition();
      const name = buildingName(type);

      if (!building.isDone()) {
        if (type === BuildingType.TypeCastle) continue;

        /* Building::start_building: planks are stock 0 and stones stock 1
           of a site, `maximum` is what is still to come. */
        const planksOpen =
          building.getMaximumInStock(0) - building.getResCountInStock(0) - building.getRequestedInStock(0);
        if (planksOpen > 0) {
          plankSites += 1;
          plankSite ??= building;
        }
        const stonesOpen =
          building.getMaximumInStock(1) - building.getResCountInStock(1) - building.getRequestedInStock(1);
        if (stonesOpen > 0) {
          stoneSites += 1;
          stoneSite ??= building;
        }

        /* The flag of the site has no road: the only path of the flag, if
           any, is the one up left to the building. */
        const flag = game.getFlag(building.getFlagIndex());
        if (flag !== null && (flag.paths() & ~(1 << Direction.DirectionUpLeft)) === 0) {
          const key = `road:${index}`;
          if (lasted(key, WAIT_ROAD)) {
            alerts.push({ key, text: `${name} site has no road`, pos, res: null, type });
          }
        }
        continue;
      }

      if (isGuard(type)) {
        /* Building::update_military: stock[0].available is the knights
           inside (get_knight_count). */
        if (building.getKnightCount() === 0) {
          const key = `knights:${index}`;
          if (lasted(key, WAIT_KNIGHTS)) {
            alerts.push({ key, text: `${name} has no knights`, pos, res: ResourceType.TypeSword, type });
          }
        }
        continue;
      }

      if (type === BuildingType.TypeCastle) continue;

      /* A building the player paused is listed as that, at once. A paused
         building, or one that waits because its output cap is reached
         (Building.getProductionHold), asks for no input: it is not said
         to have none. */
      const hold = building.getProductionHold();
      if (hold === ProductionHold.Paused) {
        alerts.push({ key: `paused:${index}`, text: `${name} is paused`, pos, res: null, type });
      }

      if (!building.hasSerf()) {
        /* `holder` is set when the requested serf arrives
           (Building::requested_serf_reached). */
        if (wantsWorker(type)) {
          const key = `worker:${index}`;
          if (lasted(key, WAIT_WORKER)) {
            alerts.push({ key, text: `${name} has no worker`, pos, res: null, type });
          }
        }
        continue;
      }

      /* The storehouse has no stock of its own (0xff marks an inventory). */
      if (type === BuildingType.TypeStock) continue;
      if (hold !== ProductionHold.None) continue;

      /* The input stocks, as the worker set them when he walked in
         (stockInit in serf.ts): empty means the work stands still. */
      for (let j = 0; j < 2; j++) {
        if (!building.isStockActive(j)) continue;
        if (building.getMaximumInStock(j) <= 0 || building.getResCountInStock(j) > 0) continue;
        const res = building.getResTypeInStock(j);
        const key = `input:${index}:${j}`;
        if (lasted(key, WAIT_INPUT)) {
          const icon = res === ResourceType.GroupFood ? foodResources[1] : res;
          const what = isMine(type) ? 'food' : resourceName(res);
          alerts.push({ key, text: `${name} has no ${what}`, pos, res: icon, type });
        }
      }
    }

    /* Sites wait and no inventory has a plank or a stone left. */
    if (plankSites > 0 || stoneSites > 0) {
      let planks = 0;
      let stones = 0;
      for (const inventory of game.getPlayerInventories(player)) {
        planks += inventory.getCountOf(ResourceType.TypePlank);
        stones += inventory.getCountOf(ResourceType.TypeStone);
      }
      const sites = (n: number): string => (n === 1 ? '1 site waits' : `${n} sites wait`);
      if (stoneSite !== null && stones === 0 && lasted('stone', WAIT_MATERIAL)) {
        alerts.unshift({
          key: 'stone', text: `No stone in stock, ${sites(stoneSites)}`,
          pos: stoneSite.getPosition(), res: ResourceType.TypeStone, type: stoneSite.getType(),
        });
      }
      if (plankSite !== null && planks === 0 && lasted('planks', WAIT_MATERIAL)) {
        alerts.unshift({
          key: 'planks', text: `No planks in stock, ${sites(plankSites)}`,
          pos: plankSite.getPosition(), res: ResourceType.TypePlank, type: plankSite.getType(),
        });
      }
    }

    this.waits = next;
    return alerts;
  }

  protected render(): void {
    const count = this.alerts.length;
    const badge = String(count);
    if (this.countBadge.textContent !== badge) this.countBadge.textContent = badge;
    this.countBadge.classList.toggle('al-some', count > 0);
    this.toggleButton.setAttribute(
      'aria-label',
      count === 1 ? '1 alert, show or hide the list' : `${count} alerts, show or hide the list`,
    );

    /* Build the list again only when it changed: the focus stays. */
    const signature = this.alerts.map((a) => a.key + '|' + a.text).join('\n');
    if (signature === this.shown) return;
    this.shown = signature;

    const focusedKey =
      document.activeElement instanceof HTMLElement && this.list.contains(document.activeElement)
        ? document.activeElement.dataset.key
        : undefined;

    this.list.textContent = '';
    if (count === 0) {
      const item = el('li', 'al-none', 'Nothing holds you up.');
      this.list.append(item);
      return;
    }
    for (const alert of this.alerts.slice(0, MAX_SHOWN)) {
      const item = el('li');
      const button = el('button', 'al-item');
      button.type = 'button';
      button.dataset.key = alert.key;
      button.title = 'Show on the map';
      const pic = el('span', 'al-pic');
      pic.append(alert.res !== null ? resourceCanvas(alert.res) : buildingCanvas(alert.type));
      button.append(pic, el('span', '', alert.text));
      button.addEventListener('click', () => this.show(alert.pos));
      item.append(button);
      this.list.append(item);
      if (alert.key === focusedKey) button.focus({ preventScroll: true });
    }
    if (count > MAX_SHOWN) {
      this.list.append(el('li', 'al-none', `And ${count - MAX_SHOWN} more.`));
    }
  }

  /* Centre the map on the spot, as a click on a message does
     (Interface::open_message), and put the map cursor there. */
  protected show(pos: MapPos): void {
    const viewport = this.iface.getViewport();
    if (viewport === null || !this.iface.getGame()) return;
    viewport.moveToMapPos(pos);
    this.iface.updateMapCursorPos(pos);
    blurActive();
  }
}

export function initAlerts(iface: Interface, _gameManager?: GameManager): Alerts {
  return new Alerts(iface);
}
