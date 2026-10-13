// The boxes of a building, a flag or a spot of the map as windows of the
// page. Not part of Freeserf.
//
// Which box of popup.ts became which window:
//   TypeOrderedBld, TypeBldStock,       building-info.ts: one window for a
//   TypeMineOutput, TypeDefenders       building of the player, by its kind
//   TypeCastleRes, TypeCastleSerf,      inventory.ts: the castle or a
//   TypeResDir                          storehouse, three pages
//   TypeTransportInfo                   flag.ts
//   TypeStartAttack, ..Redraw           attack.ts
//   TypeGroundAnalysis, TypeDemolish    map-spot.ts
// building-parts.ts holds what they share: the header, the Actions section
// (the home of the controls to come) and the demolish question.
//
// The boxes open as before: Viewport.openObjectBox() picks the box for the
// flag or building that was clicked and sets player.tempIndex (or
// Interface.attack), the panel opens the last two.

import { attackBox, attackBoxes } from './attack';
import { buildingInfoBox, buildingInfoBoxes } from './building-info';
import { flagBox, flagBoxes } from './flag';
import { inventoryBox, inventoryBoxes } from './inventory';
import { registerBox } from './kit';
import { demolishBox, demolishBoxes, groundAnalysisBox, groundAnalysisBoxes } from './map-spot';

export function registerBuildingBoxes(): void {
  registerBox(buildingInfoBoxes, buildingInfoBox);
  registerBox(inventoryBoxes, inventoryBox);
  registerBox(flagBoxes, flagBox);
  registerBox(attackBoxes, attackBox);
  registerBox(groundAnalysisBoxes, groundAnalysisBox);
  registerBox(demolishBoxes, demolishBox);
}
