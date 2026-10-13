// The settings boxes of the game as windows of the page (the TypeSett*
// boxes and TypeKnightLevel of popup.ts). Not part of Freeserf.
//
// Ported so far: TypeSett1. The others still open as the canvas popup.

import { BuildingType } from '../../game/building';
import { cmdResetPriority, cmdSetDistribution } from '../../net/commands';
import type { DistributionSetting } from '../../net/commands';
import { AudioTypeSfx } from '../audio';
import { PopupBoxType } from '../popup';
import { registerBox } from './kit';
import type { BoxContext, BoxView } from './kit';
import { button, buildingIcon, fitHeight, hint, iconCanvas, shareSlider } from './widgets';

/* TypeSett1: how the food is shared between the mines. The four slide bars
   of drawSett1Box() of popup.ts, in its order. */
function sett1Box(ctx: BoxContext): BoxView {
  const { win, game, player } = ctx;
  win.setTitle('Food for the mines');
  win.setPattern('brown');

  const color = player.getColor();
  const bars: { label: string; type: BuildingType; setting: DistributionSetting; get: () => number }[] = [
    {
      label: 'Stone mines',
      type: BuildingType.TypeStoneMine,
      setting: 'setFoodStonemine',
      get: () => player.getFoodStonemine(),
    },
    {
      label: 'Coal mines',
      type: BuildingType.TypeCoalMine,
      setting: 'setFoodCoalmine',
      get: () => player.getFoodCoalmine(),
    },
    {
      label: 'Iron mines',
      type: BuildingType.TypeIronMine,
      setting: 'setFoodIronmine',
      get: () => player.getFoodIronmine(),
    },
    {
      label: 'Gold mines',
      type: BuildingType.TypeGoldMine,
      setting: 'setFoodGoldmine',
      get: () => player.getFoodGoldmine(),
    },
  ];

  win.add(hint('A mine with a longer bar gets fish, meat and bread before the others.'));
  for (const bar of bars) {
    win.add(
      shareSlider({
        label: bar.label,
        icon: fitHeight(buildingIcon(bar.type, color), 2.4),
        get: bar.get,
        /* ACTION_SETT_1_ADJUST_* of popup.ts. */
        set: (value) => cmdSetDistribution(game, bar.setting, value),
      }),
    );
  }

  win.foot().append(
    button('Default values', () => {
      /* ACTION_DEFAULT_SETT_1. */
      ctx.sound(AudioTypeSfx.TypeSfxClick);
      cmdResetPriority(game, 'resetFoodPriority');
    }, { icon: iconCanvas(295), title: 'Set the four bars as they were at the start' }),
    button('Back to settings', () => {
      ctx.sound(AudioTypeSfx.TypeSfxClick);
      ctx.open(PopupBoxType.TypeSettSelect);
    }, { icon: iconCanvas(61) }),
  );
  return {};
}

export function registerSettingsBoxes(): void {
  registerBox(PopupBoxType.TypeSett1, sett1Box);
}
