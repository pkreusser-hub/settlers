// What the windows of a building, a flag or a map spot share (buildings.ts
// registers them): the building or flag of the box, the header with the
// picture, the name and the state, a body that is built again when its
// shape changes, the Actions section and the demolish question.
// Not part of Freeserf.

import './buildings.css';

import { BuildingType } from '../../game/building';
import type { Building } from '../../game/building';
import type { Flag } from '../../game/flag';
import type { MapPos } from '../../game/map';
import { SerfType } from '../../game/serf';
import { buildingInfo, buildingName, productionLine } from '../production';
import type { BoxContext, Widget } from './kit';
import { button, buildingIcon, confirmRow, el, fitHeight, section } from './widgets';

// ---------------------------------------------------------------------------
// The object of the box.

/* The position of the object when the window opened. An index of the game
   is used again after its object is gone: a window never goes on with
   another building or flag that got the index of its own. */
export interface Pin {
  pos: MapPos | null;
}

/* The building of the box (player.tempIndex), or null when the box closes:
   where the canvas boxes close (no index, burning) and where they would
   fail (the building is gone, or taken by another player). */
export function boxBuilding(ctx: BoxContext, pin: Pin): Building | null {
  const { game, player } = ctx;
  if (player.tempIndex === 0) return null;
  const building = game.getBuilding(player.tempIndex);
  if (building === null || building.isBurning()) return null;
  if (building.getOwner() !== player.getIndex()) return null;
  if (pin.pos === null) pin.pos = building.getPosition();
  else if (pin.pos !== building.getPosition()) return null;
  return building;
}

/* The flag of the box (player.tempIndex), or null when the box closes. */
export function boxFlag(ctx: BoxContext, pin: Pin): Flag | null {
  const { game, player } = ctx;
  if (player.tempIndex === 0) return null;
  const flag = game.getFlag(player.tempIndex);
  if (flag === null || flag.getOwner() !== player.getIndex()) return null;
  /* The flag object is still there but no longer on the map. */
  if (game.getFlagAtPos(flag.getPosition()) !== flag) return null;
  if (pin.pos === null) pin.pos = flag.getPosition();
  else if (pin.pos !== flag.getPosition()) return null;
  return flag;
}

/* The serf that works in a finished building: the pictures of
   drawBuildingStockBox() and drawMineOutputBox() of popup.ts. */
const workers: { [type: number]: SerfType } = {
  [BuildingType.TypeFisher]: SerfType.TypeFisher,
  [BuildingType.TypeLumberjack]: SerfType.TypeLumberjack,
  [BuildingType.TypeBoatbuilder]: SerfType.TypeBoatBuilder,
  [BuildingType.TypeStonecutter]: SerfType.TypeStonecutter,
  [BuildingType.TypeStoneMine]: SerfType.TypeMiner,
  [BuildingType.TypeCoalMine]: SerfType.TypeMiner,
  [BuildingType.TypeIronMine]: SerfType.TypeMiner,
  [BuildingType.TypeGoldMine]: SerfType.TypeMiner,
  [BuildingType.TypeForester]: SerfType.TypeForester,
  [BuildingType.TypeStock]: SerfType.TypeTransporterInventory,
  [BuildingType.TypeFarm]: SerfType.TypeFarmer,
  [BuildingType.TypeButcher]: SerfType.TypeButcher,
  [BuildingType.TypePigFarm]: SerfType.TypePigFarmer,
  [BuildingType.TypeMill]: SerfType.TypeMiller,
  [BuildingType.TypeBaker]: SerfType.TypeBaker,
  [BuildingType.TypeSawmill]: SerfType.TypeSawmiller,
  [BuildingType.TypeSteelSmelter]: SerfType.TypeSmelter,
  [BuildingType.TypeToolMaker]: SerfType.TypeToolmaker,
  [BuildingType.TypeWeaponSmith]: SerfType.TypeWeaponSmith,
  [BuildingType.TypeGoldSmelter]: SerfType.TypeSmelter,
};

export function workerOf(type: BuildingType): SerfType | null {
  return workers[type] ?? null;
}

export function isMilitaryHouse(type: BuildingType): boolean {
  return (
    type === BuildingType.TypeHut ||
    type === BuildingType.TypeTower ||
    type === BuildingType.TypeFortress
  );
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* "Needs coal, iron ore → makes steel" of production.ts for a building
   type, and the note on its ratio where it has one. */
export function productionText(type: BuildingType): { line: string; note: string } {
  if (type === BuildingType.TypeCastle) {
    return { line: 'Stores goods and serfs, holds knights', note: '' };
  }
  const info = buildingInfo(type);
  if (info === null) return { line: '', note: '' };
  return { line: capital(productionLine(info)), note: info.ratio?.note ?? '' };
}

// ---------------------------------------------------------------------------
// Widgets of this family.

/* A part of a window that is built again when its shape changes (a site
   becomes a building, a stock gets its resource): `signature` says what the
   shape is, `build` makes the rows for it. The rows read their values in
   their own get() as usual. */
export function dynamic(
  signature: () => string,
  build: () => (Widget | HTMLElement)[],
  className = 'bw-part',
): Widget {
  const root = el('div', className);
  let shown: string | null = null;
  let widgets: Widget[] = [];
  const clear = (): void => {
    for (const widget of widgets) widget.dispose?.();
    widgets = [];
  };
  const update = (): void => {
    const next = signature();
    if (next === shown) {
      for (const widget of widgets) widget.update?.();
      return;
    }
    shown = next;
    const hadFocus = root.contains(document.activeElement);
    clear();
    root.textContent = '';
    for (const item of build()) {
      if (item instanceof HTMLElement) {
        root.append(item);
      } else {
        root.append(item.el);
        widgets.push(item);
      }
    }
    if (hadFocus) {
      root.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true });
    }
  };
  update();
  return { el: root, update, dispose: clear };
}

export interface HeaderOptions {
  /* Changes when another picture is needed. */
  pictureKey(): string;
  picture(): HTMLCanvasElement | null;
  name(): string;
  /* The state in words: "Waiting for a builder". */
  state(): string;
  /* What it needs and makes, and the note on the ratio. */
  line?(): string;
  note?(): string;
}

/* The head of a window of this family: the picture of the object, its name
   and its state in words. */
export function objectHeader(options: HeaderOptions): Widget {
  const root = el('div', 'bw-head');
  const pic = el('div', 'bw-head-pic');
  const text = el('div', 'bw-head-text');
  const name = el('div', 'bw-name');
  const state = el('div', 'bw-state');
  state.setAttribute('role', 'status');
  const line = el('div', 'bw-line');
  const note = el('div', 'bw-note');
  text.append(name, state, line, note);
  root.append(pic, text);

  const shown = { key: '', name: '', state: '', line: '', note: '' };
  const set = (node: HTMLElement, key: 'name' | 'state' | 'line' | 'note', value: string): void => {
    if (shown[key] === value) return;
    shown[key] = value;
    node.textContent = value;
    node.hidden = value === '';
  };
  line.hidden = true;
  note.hidden = true;
  let first = true;
  const update = (): void => {
    const key = options.pictureKey();
    if (first || key !== shown.key) {
      first = false;
      shown.key = key;
      pic.textContent = '';
      const canvas = options.picture();
      if (canvas !== null && canvas.width > 1) {
        /* Two page pixels for one of the game, but no taller than 5 em. */
        pic.append(fitHeight(canvas, Math.min(5, canvas.height / 8)));
      }
    }
    set(name, 'name', options.name());
    set(state, 'state', options.state());
    set(line, 'line', options.line?.() ?? '');
    set(note, 'note', options.note?.() ?? '');
  };
  update();
  return { el: root, update };
}

/* The header of a building: its picture in the colour of its owner, its
   name, the state the caller words, and its line of production.ts. */
export function buildingHeader(
  ctx: BoxContext,
  building: () => Building | null,
  state: (building: Building) => string,
  linePrefix: (building: Building) => string = () => '',
): Widget {
  const type = (): BuildingType => building()?.getType() ?? BuildingType.TypeNone;
  return objectHeader({
    pictureKey: () => String(type()),
    picture: () => {
      const b = building();
      if (b === null) return null;
      const owner = ctx.game.getPlayer(b.getOwner()) ?? ctx.player;
      return buildingIcon(b.getType(), owner.getColor());
    },
    name: () => (building() === null ? '' : buildingName(type())),
    state: () => {
      const b = building();
      return b === null ? '' : state(b);
    },
    line: () => {
      const b = building();
      if (b === null) return '';
      const text = productionText(b.getType()).line;
      return text === '' ? '' : linePrefix(b) + text;
    },
    note: () => (building() === null ? '' : productionText(type()).note),
  });
}

// ---------------------------------------------------------------------------
// Actions.

/* The Actions section of a window of this family: every control that does
   something with the object of the window goes here, one list per kind of
   object (buildingActions() of building-info.ts, inventoryActions() of
   inventory.ts, flagActions() of flag.ts, enemyActions() of attack.ts).

   The home of the features to come:
   - building-info.ts buildingActions(): pause production, output cap,
     upgrade (hut to tower to fortress);
   - flag.ts flagActions(): road options of the flag and its roads;
   - inventory.ts inventoryActions(): trade and alliance of a castle or
     storehouse;
   - attack.ts enemyActions(): trade and alliance with the owner of an
     enemy building.
   Each needs its command in net/commands.ts first; a control here only
   issues it. The section is hidden while its list is empty. */
export function actionsSection(items: (Widget | HTMLElement)[], title = 'Actions'): Widget {
  const part = section(title, ...items);
  part.el.classList.add('bw-actions');
  part.el.hidden = items.length === 0;
  return part;
}

/* The Demolish button of a building and its question, in the window: the
   TypeDemolish box of popup.ts. "Demolish" asks, the answer "Demolish"
   calls Interface.demolishObject() as ACTION_DEMOLISH does and closes the
   window.

   demolishObject() works on the building under the map cursor. The window
   is about one building while the cursor can go elsewhere, so the cursor is
   put back on the building first (an interface value, not one of the
   game). */
export function demolishControl(ctx: BoxContext, building: () => Building | null): Widget {
  const root = el('div', 'bw-demolish');
  let asking = false;
  let askedFor = '';

  const ask = button('Demolish', () => {
    asking = true;
    render();
    confirm?.noButton.focus({ preventScroll: true });
  }, { kind: 'danger', title: 'Burn this building down. You are asked before it happens.' });
  ask.classList.add('bw-demolish-ask');

  let confirm: ReturnType<typeof confirmRow> | null = null;

  const render = (): void => {
    const b = building();
    const name = b === null ? '' : buildingName(b.getType()).toLowerCase();
    const key = `${asking}|${name}`;
    if (key === askedFor) return;
    askedFor = key;
    root.textContent = '';
    confirm = null;
    if (!asking) {
      root.append(ask);
      return;
    }
    confirm = confirmRow(
      `Demolish this ${name}?`,
      {
        label: 'Demolish',
        danger: true,
        action: () => {
          const target = building();
          if (target === null) {
            ctx.close();
            return;
          }
          if (ctx.iface.getMapCursorPos() !== target.getPosition()) {
            ctx.iface.updateMapCursorPos(target.getPosition());
          }
          /* ACTION_DEMOLISH of popup.ts. */
          ctx.iface.demolishObject();
          ctx.close();
        },
      },
      {
        label: 'Keep it',
        action: () => {
          asking = false;
          render();
          ask.focus({ preventScroll: true });
        },
      },
    );
    root.append(confirm.el);
  };
  render();
  return { el: root, update: render };
}

/* Whether Interface.demolishObject() takes the building: the cursor type
   CursorTypeBuilding of the interface (not the castle). */
export function canDemolish(building: Building): boolean {
  return building.getType() !== BuildingType.TypeCastle && !building.isBurning();
}
