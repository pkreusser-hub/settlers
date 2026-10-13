// The window of the castle or a storehouse: its goods, its serfs and what
// it takes in and sends out. One window with three pages for three boxes of
// popup.ts (TypeCastleRes, TypeCastleSerf, TypeResDir); a page is one of
// the boxes, so the tabs open them as the flip button of the original does.
// Not part of Freeserf.

import { BuildingType } from '../../game/building';
import type { Building } from '../../game/building';
import { InventoryMode } from '../../game/inventory';
import type { Inventory } from '../../game/inventory';
import { cmdSetInventoryResourceMode, cmdSetInventorySerfMode } from '../../net/commands';
import { AudioTypeSfx } from '../audio';
import { PopupBoxType } from '../popup';
import { buildingName } from '../production';
import {
  actionsSection,
  boxBuilding,
  buildingHeader,
  canDemolish,
  demolishControl,
  dynamic,
} from './building-parts';
import type { Pin } from './building-parts';
import { knightsByRank, knightTiles } from './building-info';
import type { BoxContext, BoxView, Widget } from './kit';
import { resourceBoxOrder, resourceLabel, serfBoxOrder, serfName } from './names';
import { hint, numberGrid, resourceIcon, section, segmented, serfIcon } from './widgets';

const pages: { box: PopupBoxType; label: string; title: string }[] = [
  { box: PopupBoxType.TypeCastleRes, label: 'Goods', title: 'The goods stored here' },
  { box: PopupBoxType.TypeCastleSerf, label: 'Serfs', title: 'The serfs waiting here' },
  { box: PopupBoxType.TypeResDir, label: 'In and out', title: 'What comes in and goes out, and the knights on guard' },
];

/* The mode as the commands count it: 0 in, 1 stop, 2 out (the actions
   ACTION_RES_MODE_IN.. of popup.ts). The box of the original shows any
   other value than in and stop as out. */
function modeNumber(mode: InventoryMode): number {
  if (mode === InventoryMode.ModeIn) return 0;
  if (mode === InventoryMode.ModeStop) return 1;
  return 2;
}

const modeWords = ['in', 'stop', 'out'];

/* The castle or storehouse of the box, where the three boxes of popup.ts
   stay open. */
function inventoryBuilding(ctx: BoxContext, pin: Pin): Building | null {
  const building = boxBuilding(ctx, pin);
  if (building === null) return null;
  const type = building.getType();
  if (type !== BuildingType.TypeStock && type !== BuildingType.TypeCastle) return null;
  if (building.getInventory() === null) return null;
  return building;
}

/* What a player can do with his castle or a storehouse. The trade and
   alliance controls to come are added to this list; see actionsSection()
   of building-parts.ts. The castle can not be demolished. */
export function inventoryActions(ctx: BoxContext, building: () => Building | null): (Widget | HTMLElement)[] {
  const b = building();
  const items: (Widget | HTMLElement)[] = [];
  if (b !== null && canDemolish(b)) items.push(demolishControl(ctx, building));
  return items;
}

function inventoryBox(ctx: BoxContext): BoxView {
  const { win, game, box } = ctx;
  win.setPattern('green');

  const pin: Pin = { pos: null };
  let cur = inventoryBuilding(ctx, pin);
  const b = (): Building | null => cur;
  const inv = (): Inventory | null => cur?.getInventory() ?? null;

  win.setTitle(cur === null ? 'Storehouse' : buildingName(cur.getType()));
  win.setTabs(
    pages.map((page) => ({ label: page.label, box: page.box, title: page.title })),
    Math.max(0, pages.findIndex((page) => page.box === box)),
    (other) => {
      ctx.sound(AudioTypeSfx.TypeSfxClick);
      ctx.open(other);
    },
  );

  win.add(
    buildingHeader(ctx, b, () => {
      const inventory = inv();
      if (inventory === null) return '';
      return (
        `Goods: ${modeWords[modeNumber(inventory.getResMode())]}. ` +
        `Serfs: ${modeWords[modeNumber(inventory.getSerfMode())]}.`
      );
    }),
  );

  /* Counted once per update for all the tiles of the serf page. */
  let serfs: number[] = [];
  const countSerfs = (): void => {
    serfs = new Array<number>(27).fill(0);
    const inventory = inv();
    if (inventory === null) return;
    for (const serf of game.getSerfsInInventory(inventory)) {
      serfs[serf.getType()] += 1;
    }
  };

  if (box === PopupBoxType.TypeCastleRes) {
    /* drawResourcesBox(): the 26 resources of the inventory. */
    win.setSize('wide');
    win.add(
      numberGrid('Goods stored here', resourceBoxOrder.map((res) => ({
        label: resourceLabel(res),
        icon: resourceIcon(res),
        get: () => inv()?.getCountOf(res) ?? 0,
      }))),
    );
  } else if (box === PopupBoxType.TypeCastleSerf) {
    /* drawSerfsBox(): the serfs that wait in the inventory, by type. */
    win.setSize('wide');
    countSerfs();
    win.add(
      numberGrid('Serfs waiting here', serfBoxOrder.map((type) => ({
        label: serfName(type),
        icon: serfIcon(type),
        get: () => serfs[type] ?? 0,
      }))),
    );
  } else {
    /* drawResdirBox(): the two modes and, in the castle, the knights. */
    const modeOptions = (what: string): { value: number; label: string; title: string }[] => [
      { value: 0, label: 'In', title: `Carriers bring ${what} here` },
      { value: 1, label: 'Stop', title: `No more ${what} come here; what is here stays` },
      { value: 2, label: 'Out', title: `No more ${what} come here and what is here goes to other stores` },
    ];
    win.add(
      hint('In: this store takes them. Stop: no more come. Out: what is here leaves for other stores.'),
      segmented<number>({
        label: 'Goods',
        options: modeOptions('goods'),
        get: () => {
          const inventory = inv();
          return inventory === null ? -1 : modeNumber(inventory.getResMode());
        },
        set: (mode) => {
          /* ACTION_RES_MODE_IN, _STOP, _OUT: setInventoryResourceMode(). */
          if (cur === null) return;
          cmdSetInventoryResourceMode(game, cur.getPosition(), mode);
        },
      }),
      segmented<number>({
        label: 'Serfs',
        options: modeOptions('serfs'),
        get: () => {
          const inventory = inv();
          return inventory === null ? -1 : modeNumber(inventory.getSerfMode());
        },
        set: (mode) => {
          /* ACTION_SERF_MODE_IN, _STOP, _OUT: setInventorySerfMode(). */
          if (cur === null) return;
          cmdSetInventorySerfMode(game, cur.getPosition(), mode);
        },
      }),
    );

    /* The knights on guard in the castle, by rank. */
    let knights = [0, 0, 0, 0, 0];
    const countKnights = (): void => {
      knights = cur === null ? [0, 0, 0, 0, 0] : knightsByRank(game, cur);
    };
    win.add(
      dynamic(
        () => (cur !== null && cur.getType() === BuildingType.TypeCastle ? 'castle' : ''),
        () => {
          if (cur === null || cur.getType() !== BuildingType.TypeCastle) return [];
          countKnights();
          const tiles = knightTiles(() => knights);
          const part = section('Knights on guard in the castle', tiles);
          return [{ el: part.el, update: () => { countKnights(); part.update?.(); } }];
        },
      ),
      dynamic(
        () => (cur === null ? '' : `${cur.getType()}|${canDemolish(cur)}`),
        () => [actionsSection(inventoryActions(ctx, b))],
      ),
    );
  }

  return {
    update: () => {
      cur = inventoryBuilding(ctx, pin);
      if (cur === null) {
        ctx.close();
        return;
      }
      if (box === PopupBoxType.TypeCastleSerf) countSerfs();
    },
  };
}

export const inventoryBoxes: PopupBoxType[] = [
  PopupBoxType.TypeCastleRes,
  PopupBoxType.TypeCastleSerf,
  PopupBoxType.TypeResDir,
];

export { inventoryBox };
