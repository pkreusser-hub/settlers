// The map box of the game as a window of the page: the minimap with its
// options (TypeMap of popup.ts) and the list of buildings it can be limited
// to (TypeBld1 to TypeBld4, one list here). Not part of Freeserf.
//
// The minimap is the MinimapGame of minimap.ts, drawn by itself into the
// canvas of the window (canvas-host.ts). Its options are set on it as the
// canvas box does: they are a choice of the interface, not of the game, and
// last as long as the box is open, as there.

import './map.css';

import { BuildingType } from '../../game/building';
import { AudioTypeSfx } from '../audio';
import { MinimapGame, MinimapGameOwnershipMode } from '../minimap';
import { PopupBoxType } from '../popup';
import { buildingName } from '../production';
import { canvasHost } from './canvas-host';
import { registerBox } from './kit';
import type { BoxContext, BoxView } from './kit';
import { buildingIcon, el, fitHeight, flagIcon, hint, section, segmented, toggle } from './widgets';
import type { SegmentOption } from './widgets';

/* The size of the minimap in the box of the game. MinimapGame clears this
   much of its frame (internalDraw), so it is not made larger here. */
const minimapSize = 128;

/* The buildings of the list, by the number MinimapGame.setAdvanced() takes:
   building_remap of drawMinimapBuildings() of minimap.ts, in the order of
   the four pages of the canvas list (ACTION_MINIMAP_BLD_1 to _23). */
const B = BuildingType;
export const minimapBuildings: BuildingType[] = [
  B.TypeStock, B.TypeTower, B.TypeHut, B.TypeFortress,
  B.TypeToolMaker, B.TypeSawmill, B.TypeWeaponSmith, B.TypeStonecutter,
  B.TypeBoatbuilder, B.TypeForester, B.TypeLumberjack,
  B.TypePigFarm, B.TypeFarm, B.TypeFisher, B.TypeMill, B.TypeButcher, B.TypeBaker,
  B.TypeStoneMine, B.TypeCoalMine, B.TypeIronMine, B.TypeGoldMine,
  B.TypeSteelSmelter, B.TypeGoldSmelter,
];

/* TypeMap, and TypeBld1 to TypeBld4 (the same window, at the list). */
function mapBox(ctx: BoxContext): BoxView {
  const { win, iface, game, player } = ctx;
  win.setTitle('Map');
  win.setPattern('green');
  win.setSize('wide');

  const minimap = new MinimapGame(iface, game);
  const host = canvasHost({
    object: minimap,
    width: minimapSize,
    height: minimapSize,
    label: 'Map of the world. Click a place to go there. Drag to move the map.',
  });
  /* Synchronize minimap window with viewport (panel.ts does it for the
     canvas box). */
  const viewport = iface.getViewport();
  if (viewport !== null) minimap.moveToMapPos(viewport.getCurrentMapPos());
  host.redraw();

  /* An option was set: the sound of a click in the box, and the picture. */
  const changed = (): void => {
    ctx.sound(AudioTypeSfx.TypeSfxClick);
    host.redraw();
  };

  const color = player.getColor();
  const filterOptions: SegmentOption<number>[] = [
    { value: -1, label: 'All buildings' },
    {
      value: 0,
      label: 'Flag',
      icon: fitHeight(flagIcon(player.getIndex(), color), 1.6),
      title: 'The flag of the list of the game. The map shows the same as with all buildings.',
    },
    ...minimapBuildings.map((type, i) => ({
      value: i + 1,
      label: buildingName(type),
      icon: fitHeight(buildingIcon(type, color), 1.6),
    })),
  ];

  const filter = segmented<number>({
    label: 'Buildings shown',
    options: filterOptions,
    get: () => minimap.getAdvanced(),
    set: (value) => {
      if (value < 0) {
        /* ACTION_MINIMAP_BUILDINGS of popup.ts with a choice made: back to
           all buildings. */
        minimap.setAdvanced(-1);
        minimap.setDrawBuildings(true);
      } else if (value === 0) {
        /* ACTION_MINIMAP_BLD_FLAG. */
        minimap.setAdvanced(0);
      } else {
        /* ACTION_MINIMAP_BLD_1 to _23. */
        minimap.setAdvanced(value);
        minimap.setDrawBuildings(true);
      }
      changed();
    },
  });
  filter.el.classList.add('mp-filter');

  const picture = el('div', 'mp-picture');
  picture.append(host.el);
  win.track(host);

  const options = el('div', 'mp-options');
  win.addTo(
    options,
    segmented<MinimapGameOwnershipMode>({
      label: 'Land',
      options: [
        { value: MinimapGameOwnershipMode.OwnershipModeNone, label: 'Terrain' },
        {
          value: MinimapGameOwnershipMode.OwnershipModeMixed,
          label: 'Terrain and owners',
          title: 'The land of each player is dotted in the colour of the player',
        },
        {
          value: MinimapGameOwnershipMode.OwnershipModeSolid,
          label: 'Owners',
          title: 'Only the land of the players, in their colours',
        },
      ],
      get: () => minimap.getOwnershipMode(),
      /* ACTION_MINIMAP_MODE steps through the three; here each is named. */
      set: (mode) => {
        minimap.setOwnershipMode(mode);
        changed();
      },
    }),
    toggle({
      label: 'Roads',
      get: () => minimap.getDrawRoads(),
      /* ACTION_MINIMAP_ROADS. */
      set: (on) => {
        minimap.setDrawRoads(on);
        changed();
      },
    }),
    toggle({
      label: 'Buildings',
      get: () => minimap.getDrawBuildings(),
      /* ACTION_MINIMAP_BUILDINGS: with a choice of the list made, the button
         of the game goes back to all buildings first. Off is off here, and
         the choice is dropped with it. */
      set: (on) => {
        if (!on) minimap.setAdvanced(-1);
        minimap.setDrawBuildings(on);
        changed();
      },
    }),
    toggle({
      label: 'Grid',
      title: 'Lines along the two edges of the world',
      get: () => minimap.getDrawGrid(),
      /* ACTION_MINIMAP_GRID. */
      set: (on) => {
        minimap.setDrawGrid(on);
        changed();
      },
    }),
    segmented<number>({
      label: 'Scale',
      options: [
        { value: 1, label: '1 to 1', title: 'One point of the map is one pixel' },
        { value: 2, label: '2 to 1', title: 'One point of the map is two pixels' },
      ],
      get: () => minimap.getScale(),
      /* ACTION_MINIMAP_SCALE. */
      set: (scale) => {
        minimap.setScale(scale);
        changed();
      },
    }),
  );

  const top = el('div', 'mp-top');
  top.append(picture, options);
  win.add(
    top,
    hint('Click the map to move the view there. The dotted frame marks the middle of the map shown here.'),
    section(
      'Buildings shown',
      hint(
        'Choose one kind of building to see only where those stand. ' +
          'The map then also marks the roads where a carrier waits.',
      ),
      filter,
    ),
  );

  /* Opened as the list of buildings: start there. */
  if (ctx.box !== PopupBoxType.TypeMap) {
    win.initialFocus =
      filter.el.querySelector<HTMLElement>('[aria-checked="true"]') ??
      filter.el.querySelector<HTMLElement>('button');
  } else {
    win.initialFocus = host.canvas;
  }

  return {};
}

let registered = false;

export function registerMapBoxes(): void {
  if (registered) return;
  registered = true;
  registerBox(
    [
      PopupBoxType.TypeMap,
      PopupBoxType.TypeBld1,
      PopupBoxType.TypeBld2,
      PopupBoxType.TypeBld3,
      PopupBoxType.TypeBld4,
    ],
    mapBox,
  );
}
