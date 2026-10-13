// The build menu of the page: the buildings that fit the spot under the map
// cursor, with their names and what they need and make, in place of the
// icon boxes of popup.ts (TypeBasicBld, TypeBasicBldFlip, TypeMineBuilding).
// Also the keys that build without the menu. Not part of Freeserf.
//
// Nothing here changes the game directly: a row or a key calls
// Interface.buildBuilding(), buildFlag() or buildRoadBegin(), the same
// methods the boxes and the panel call, and those issue the commands.

import './build-menu.css';

import { BuildingType } from '../game/building';
import type { Game } from '../game/game';
import type { GameManager } from '../game/game-manager';
import type { Player } from '../game/player';
import { canReplaceBuilding } from '../net/commands';
import { ChainsView } from './chains';
import { InterfaceCursorType } from './interface';
import type { Interface } from './interface';
import { onBoxOpening, registerOpener } from './menu/kit';
import {
  blurActive,
  buildingCanvas,
  el,
  flagCanvas,
  leftStack,
  resourceCanvas,
  showHint,
} from './overlay-dom';
import { PopupBoxType } from './popup';
import {
  amountName,
  buildGroups,
  buildingCost,
  buildingInfo,
  buildingInfos,
  productionLine,
  resourceIcons,
} from './production';
import type { BuildingInfo } from './production';
import { ResourceType } from '../game/resource';

/* The keys that build at the map cursor. Letters that Interface and
   PanelBar do not use (those are Tab Esc + - 0 1-5 b f g j m p s and, with
   Ctrl, c f n q z; [ and ] zoom the map). */
export const buildKeys: { key: string; type: BuildingType }[] = [
  { key: 'w', type: BuildingType.TypeLumberjack },
  { key: 'e', type: BuildingType.TypeForester },
  { key: 'q', type: BuildingType.TypeStonecutter },
  { key: 'a', type: BuildingType.TypeSawmill },
  { key: 'i', type: BuildingType.TypeFisher },
  { key: 'd', type: BuildingType.TypeFarm },
  { key: 'h', type: BuildingType.TypeHut },
];
export const flagKey = 'f';
export const roadKey = 'r';
export const chainsKey = 'v';

/* The boxes of popup.ts that this menu stands for. */
const buildBoxes: PopupBoxType[] = [
  PopupBoxType.TypeBasicBld,
  PopupBoxType.TypeBasicBldFlip,
  PopupBoxType.TypeMineBuilding,
];

function keyOf(type: BuildingType): string | null {
  return buildKeys.find((k) => k.type === type)?.key ?? null;
}

interface Offer {
  /* The cursor is on a building of the player: a row replaces it, as a
     special click in the boxes does. */
  replace: boolean;
  types: BuildingType[];
  flag: boolean;
}

export class BuildMenu {
  protected root: HTMLElement;
  protected title: HTMLElement;
  protected list: HTMLElement;
  protected chains: ChainsView;
  protected shown = '';
  protected timer = 0;
  /* Let the next build box of the game through. */
  protected bypass = false;
  protected lastBox: number = PopupBoxType.TypeBasicBld;

  constructor(protected iface: Interface) {
    this.chains = new ChainsView(iface);

    this.root = el('div', 'gx-box');
    this.root.id = 'gx-build';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Build');

    const head = el('div', 'bm-head');
    this.title = el('h2', 'bm-title', 'Build here');
    const close = el('button', 'gx-btn', 'Close');
    close.type = 'button';
    close.title = 'Close the build menu (Esc)';
    close.addEventListener('click', () => {
      this.close();
      blurActive();
    });
    head.append(this.title, close);

    this.list = el('div', 'bm-list');

    const foot = el('div', 'bm-foot');
    const chainsButton = el('button', 'gx-btn');
    chainsButton.type = 'button';
    chainsButton.append('Production chains ', el('kbd', '', chainsKey.toUpperCase()));
    chainsButton.addEventListener('click', () => this.chains.open());
    const original = el('button', 'gx-btn', 'Original icons');
    original.type = 'button';
    original.title = 'Open the build box of the original game for this spot';
    original.addEventListener('click', () => this.openOriginal());
    foot.append(chainsButton, original);

    this.root.append(head, this.list, foot);
    leftStack().append(this.root);

    this.root.addEventListener('keydown', (e) => this.handleMenuKey(e));

    /* The registry of ui/menu is the popup hook of the interface: the
       build boxes are registered there as this menu. */
    registerOpener(buildBoxes, (box, fromCanvas) => this.handlePopup(box, fromCanvas));
    onBoxOpening((box) => {
      /* Another box of the game opens: the menu makes room. */
      if (!buildBoxes.includes(box)) this.close();
    });
    this.iface.keyHooks.push((key, modifier) => this.handleKey(key, modifier));
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  getChains(): ChainsView {
    return this.chains;
  }

  open(): void {
    this.shown = '';
    this.root.hidden = false;
    this.refresh();
    this.rows()[0]?.focus({ preventScroll: true });
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.refresh(), 250);
  }

  close(): void {
    if (!this.isOpen()) return;
    const hadFocus = this.root.contains(document.activeElement);
    this.root.hidden = true;
    window.clearInterval(this.timer);
    if (hadFocus) blurActive();
  }

  /* Interface.openPopup asks the registry before it opens a box: the first
     build boxes become the menu. The second click on the build button closes it, as it
     closes the box. */
  protected handlePopup(box: number, fromCanvas: boolean): boolean {
    /* Not when the box of the original was asked for, and not when it
       turns its own pages. */
    if (this.bypass || fromCanvas) return false;
    this.lastBox = box;
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
    return true;
  }

  protected openOriginal(): void {
    this.close();
    this.bypass = true;
    try {
      this.iface.openPopup(this.lastBox);
    } finally {
      this.bypass = false;
    }
    blurActive();
  }

  /* What the boxes of popup.ts would offer at the cursor, by the same
     tests: Game::can_build_building for every type (the boxes draw all of
     a size and Interface::build_building tests the click), can_build_flag
     for the flag. On a building of the player: canReplaceBuilding. */
  protected offer(game: Game, player: Player): Offer {
    const pos = this.iface.getMapCursorPos();
    if (this.iface.getMapCursorType() === InterfaceCursorType.CursorTypeBuilding) {
      /* Not by the same building again. */
      const current = game.getBuildingAtPos(pos)?.getType();
      return {
        replace: true,
        types: buildingInfos
          .filter((info) => info.type !== current && canReplaceBuilding(game, pos, info.type, player))
          .map((info) => info.type),
        flag: false,
      };
    }
    return {
      replace: false,
      types: buildingInfos
        .filter((info) => game.canBuildBuilding(pos, info.type, player))
        .map((info) => info.type),
      flag: game.canBuildFlag(pos, player),
    };
  }

  protected rows(): HTMLButtonElement[] {
    return Array.from(this.list.querySelectorAll<HTMLButtonElement>('button.bm-row'));
  }

  /* Show the offer of the spot again when it changed (the cursor moved, a
     command was applied). */
  protected refresh(): void {
    const game = this.iface.getGame();
    const player = this.iface.getPlayer();
    if (!game || player === null || this.iface.isGameInitOpen() || this.iface.isBuildingRoad()) {
      this.close();
      return;
    }
    const offer = this.offer(game, player);
    const signature =
      `${this.iface.getMapCursorPos()}|${offer.replace}|${offer.flag}|${offer.types.join(',')}`;
    if (signature === this.shown) return;
    this.shown = signature;

    const focused =
      document.activeElement instanceof HTMLElement && this.list.contains(document.activeElement)
        ? document.activeElement.dataset.build
        : undefined;

    this.title.textContent = offer.replace ? 'Replace this building' : 'Build here';
    this.list.textContent = '';

    if (offer.types.length === 0 && !offer.flag) {
      this.list.append(
        el('p', 'bm-empty', offer.replace ? 'Nothing else fits here.' : 'Nothing can be built here.'),
      );
      return;
    }

    const color = player.getColor();
    for (const group of buildGroups) {
      const infos = buildingInfos.filter(
        (info) => info.group === group.id && offer.types.includes(info.type),
      );
      const withFlag = group.id === 'storage' && offer.flag;
      if (infos.length === 0 && !withFlag) continue;

      const section = el('div');
      section.setAttribute('role', 'group');
      section.setAttribute('aria-label', group.title);
      section.append(el('div', 'bm-group', group.title));
      for (const info of infos) {
        section.append(this.buildingRow(info, offer.replace));
      }
      if (withFlag) {
        section.append(this.flagRow(player.getIndex(), color));
      }
      this.list.append(section);
    }

    if (focused !== undefined) {
      const again = this.rows().find((row) => row.dataset.build === focused);
      (again ?? this.rows()[0])?.focus({ preventScroll: true });
    }
  }

  protected row(id: string, pic: HTMLElement, name: string, key: string | null): {
    button: HTMLButtonElement;
    nameLine: HTMLElement;
    text: HTMLElement;
  } {
    const button = el('button', 'bm-row');
    button.type = 'button';
    button.dataset.build = id;
    const picBox = el('span', 'bm-pic');
    picBox.append(pic);
    const text = el('span', 'bm-text');
    const nameLine = el('span', 'bm-name');
    nameLine.append(el('span', '', name));
    if (key !== null) {
      const kbd = el('kbd', '', key.toUpperCase());
      kbd.title = `Key ${key.toUpperCase()} builds this at the map cursor`;
      nameLine.append(kbd);
    }
    text.append(nameLine);
    button.append(picBox, text);
    return { button, nameLine, text };
  }

  protected buildingRow(info: BuildingInfo, replace: boolean): HTMLButtonElement {
    const key = replace ? null : keyOf(info.type);
    const { button, nameLine, text } = this.row('b' + info.type, buildingCanvas(info.type), info.name, key);

    /* Cost of the construction: constInfo() of the game. */
    const cost = buildingCost(info.type);
    const costBox = el('span', 'bm-cost');
    costBox.append(resourceCanvas(ResourceType.TypePlank), ` ${cost.planks} `);
    if (cost.stones > 0) {
      costBox.append(resourceCanvas(ResourceType.TypeStone), ` ${cost.stones}`);
    }
    nameLine.append(costBox);

    text.append(this.productionLine(info));

    const costWords =
      `costs ${cost.planks} planks` + (cost.stones > 0 ? ` and ${cost.stones} stone` : '');
    button.setAttribute(
      'aria-label',
      `${info.name}: ${productionLine(info)}; ${costWords}` + (key !== null ? `; key ${key}` : ''),
    );
    button.addEventListener('click', () => {
      /* As the click in the box: Interface::build_building, with the
         special click on a building to replace. */
      this.iface.buildBuilding(info.type, replace);
      this.close();
      blurActive();
    });
    return button;
  }

  /* "needs X, Y → makes Z" with the icons of the resources, and the numbers
     where the building has a ratio (production.ts). */
  protected productionLine(info: BuildingInfo): HTMLElement {
    const line = el('span', 'bm-line');
    line.setAttribute('aria-hidden', 'true');
    const resources = (list: ResourceType[], amounts?: string[]): void => {
      list.forEach((res, i) => {
        if (i > 0) line.append(', ');
        for (const icon of resourceIcons(res)) line.append(resourceCanvas(icon));
        line.append(' ' + amountName(res, amounts?.[i]));
      });
    };
    let any = false;
    if (info.does !== undefined) {
      line.append(info.does);
      any = true;
    }
    if (info.needs.length > 0) {
      line.append(any ? ' → needs ' : 'needs ');
      resources(info.needs, info.ratio?.needs);
      any = true;
    }
    if (info.makes.length > 0) {
      line.append(any ? ' → makes ' : 'makes ');
      if (info.makesText !== undefined) {
        line.append(resourceCanvas(ResourceType.TypeHammer), ' ' + info.makesText);
      } else {
        resources(info.makes, info.ratio?.makes);
      }
    }
    if (info.ratio !== undefined) line.title = info.ratio.note;
    return line;
  }

  protected flagRow(playerIndex: number, color: { red: number; green: number; blue: number }): HTMLButtonElement {
    const { button, text } = this.row('flag', flagCanvas(playerIndex, color), 'Flag', flagKey);
    text.append(el('span', 'bm-line', 'roads start, end and cross at flags'));
    button.addEventListener('click', () => {
      this.iface.buildFlag();
      this.close();
      blurActive();
    });
    return button;
  }

  /* Keys while the focus is in the menu. The arrows move between the rows
     and do not scroll the map; every other key goes on to the game, so the
     build keys work here too. */
  protected handleMenuKey(e: KeyboardEvent): void {
    const rows = this.rows();
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    switch (e.key) {
      case 'ArrowDown':
        next = rows[at + 1] ?? rows[0];
        break;
      case 'ArrowUp':
        next = at > 0 ? rows[at - 1] : rows[rows.length - 1];
        break;
      case 'Home':
        next = rows[0];
        break;
      case 'End':
        next = rows[rows.length - 1];
        break;
      case 'Escape':
        this.close();
        blurActive();
        e.preventDefault();
        e.stopPropagation();
        return;
      default:
        return;
    }
    next?.focus();
    e.preventDefault();
    e.stopPropagation();
  }

  /* Keys of the game (Interface::handle_key_pressed asks first). The event
     loop does not send keys typed into a text field of the page. */
  protected handleKey(key: number, modifier: number): boolean {
    if (this.chains.isOpen()) {
      /* Only reached when the focus left the view. */
      if (key === 27 || key === chainsKey.charCodeAt(0)) this.chains.close();
      return true;
    }
    const game = this.iface.getGame();
    const player = this.iface.getPlayer();
    if (!game || player === null || this.iface.isGameInitOpen()) return false;

    if (key === 27 && this.isOpen()) {
      this.close();
      return true;
    }
    /* Ctrl and Alt keys are not ours. */
    if ((modifier & 5) !== 0) return false;

    const ch = String.fromCharCode(key);
    if (ch === chainsKey) {
      this.chains.open();
      return true;
    }

    const building = buildKeys.find((k) => k.key === ch);
    if (building === undefined && ch !== flagKey && ch !== roadKey) return false;

    /* A box or a message of the game is open: its keys, not ours. */
    const popup = this.iface.getPopupBox();
    const notification = this.iface.getNotificationBox();
    if (
      (popup !== null && popup.isDisplayed()) ||
      (notification !== null && notification.isDisplayed())
    ) {
      return false;
    }

    const pos = this.iface.getMapCursorPos();
    const cursor = this.iface.getMapCursorType();

    if (ch === roadKey) {
      /* As the road button of the panel (PanelBar::button_click). */
      if (this.iface.isBuildingRoad()) {
        this.iface.buildRoadEnd();
      } else if (
        cursor === InterfaceCursorType.CursorTypeFlag ||
        cursor === InterfaceCursorType.CursorTypeRemovableFlag
      ) {
        this.close();
        this.iface.buildRoadBegin();
      } else {
        showHint('Put the map cursor on one of your flags to start a road.');
      }
      return true;
    }

    if (this.iface.isBuildingRoad()) {
      showHint('Finish the road first, or press Esc.');
      return true;
    }

    if (ch === flagKey) {
      if (game.canBuildFlag(pos, player)) {
        this.iface.buildFlag();
        this.close();
      } else {
        showHint('No flag can be built here.');
      }
      return true;
    }

    const type = building!.type;
    const name = buildingInfo(type)!.name.toLowerCase();
    if (cursor === InterfaceCursorType.CursorTypeBuilding) {
      showHint('A building stands here. Use the build menu to replace it.');
    } else if (game.canBuildBuilding(pos, type, player)) {
      this.iface.buildBuilding(type);
      this.close();
    } else {
      showHint(`No ${name} can be built here.`);
    }
    return true;
  }
}

export function initBuildMenu(iface: Interface, _gameManager?: GameManager): BuildMenu {
  return new BuildMenu(iface);
}
