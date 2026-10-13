// The menus of the page: the boxes of the game as HTML windows. One call
// installs them. Not part of Freeserf.
//
// kit.ts is the window and the registry, widgets.ts what the windows are
// made of, theme.ts and theme.css the look. The boxes are in one file per
// family; a family registers its boxes in its register*Boxes().

import type { GameManager } from '../../game/game-manager';
import type { Interface } from '../interface';
import { registerBuildingBoxes } from './buildings';
import { installMenus } from './kit';
import type { Menus } from './kit';
import { registerSettingsBoxes } from './settings';
import { registerStartBoxes } from './start';
import { registerStatBoxes } from './stats';
// EXT: the trade window.
import { registerTradeBoxes } from './trade';

let registered = false;

/* Make the registered boxes open as windows: sets Interface.popupHook.
   Boxes that are not registered open as the canvas popup as before. */
export function initMenus(iface: Interface, gameManager: GameManager): Menus {
  if (!registered) {
    registered = true;
    registerStatBoxes();
    registerSettingsBoxes();
    registerBuildingBoxes();
    registerStartBoxes();
    registerTradeBoxes();
  }
  return installMenus(iface, gameManager);
}

export * from './kit';
