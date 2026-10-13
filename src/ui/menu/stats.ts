// The statistics boxes of the game as windows of the page (the TypeStat*
// boxes of popup.ts). Not part of Freeserf.
//
// Ported so far: TypeStat7. The others still open as the canvas popup.

import { ResourceType } from '../../game/resource';
import { AudioTypeSfx } from '../audio';
import { PopupBoxType } from '../popup';
import { registerBox } from './kit';
import type { BoxContext, BoxView } from './kit';
import { resourceBoxOrder, resourceLabel } from './names';
import { button, chart, hint, iconCanvas, numberRow, resourceIcon, segmented } from './widgets';
import type { ChartData } from './widgets';

/* The history of the resources: one sample every 6000 ticks of the game
   (Game::update_game_stats), two minutes at the normal speed, 120 samples. */
const historySize = 120;
const sampleMinutes = 2;
/* The chart of the original has 112 columns, each the sum of nine samples
   with these weights (64 in all). */
const chartColumns = 112;
const sampleWeights = [4, 6, 8, 9, 10, 9, 8, 6, 4];
const weightSum = 64;

/* The columns of drawStat7Box() of popup.ts, from the newest to the oldest,
   as that box sums them. */
export function resourceHistoryColumns(history: number[], index: number): number[] {
  const columns: number[] = [];
  for (let i = 0; i < chartColumns; i++) {
    let sum = 0;
    let j = index;
    for (let k = 0; k < 9; k++) {
      sum += sampleWeights[k] * history[j];
      j = j > 0 ? j - 1 : historySize - 1;
    }
    columns.push(sum);
    index = index > 0 ? index - 1 : historySize - 1;
  }
  return columns;
}

/* The top of the scale the original picks for the largest column (its
   multipliers 0x8000 .. 0xa3 over the 64 pixels of the chart): 2, 4, 8, 16,
   40, 80, 160 or 400 goods a sample. */
export function resourceHistoryScale(maxColumn: number): number {
  const limits = [64, 128, 256, 512, 1280, 2560, 5120];
  const tops = [2, 4, 8, 16, 40, 80, 160];
  for (let i = 0; i < limits.length; i++) {
    if (maxColumn <= limits[i]) return tops[i];
  }
  return 400;
}

/* TypeStat7: how much of one resource was made over time. */
function stat7Box(ctx: BoxContext): BoxView {
  const { win, iface, game, player } = ctx;
  win.setTitle('Production over time');
  win.setPattern('green');

  const selected = (): ResourceType => iface.getSelectedStatResource();

  const data = (): ChartData => {
    const res = selected();
    const columns = resourceHistoryColumns(
      player.getResourceCountHistory(res),
      game.getResourceHistoryIndex(),
    );
    const top = resourceHistoryScale(Math.max(...columns));
    /* Oldest on the left, as the original draws it. */
    const values = columns.map((c) => c / weightSum).reverse();
    const peak = Math.max(...values);
    return {
      series: [{ label: resourceLabel(res), values }],
      yMax: top,
      yTicks: [0, top / 4, top / 2, (3 * top) / 4, top],
      xLabels: [
        { at: 0, text: `${chartColumns * sampleMinutes} min ago` },
        { at: 1, text: 'now' },
      ],
      summary:
        `${resourceLabel(res)}: at most ${peak.toFixed(1)} in ${sampleMinutes} minutes, ` +
        `scale up to ${top}.`,
    };
  };

  win.add(
    hint(`How many were made in each ${sampleMinutes} minutes of the game, smoothed as in the original.`),
    chart({ kind: 'bars', label: 'Production over time', height: 10, get: data }),
    numberRow({
      label: 'Shown',
      get: () => resourceLabel(selected()),
    }),
    numberRow({
      label: `Made in the newest ${sampleMinutes} minutes counted`,
      title: 'The newest sample of the history of the game',
      get: () => {
        const index = game.getResourceHistoryIndex();
        const last = index > 0 ? index - 1 : historySize - 1;
        return player.getResourceCountHistory(selected())[last];
      },
    }),
    segmented<ResourceType>({
      label: 'Resource',
      iconsOnly: true,
      options: resourceBoxOrder.map((res) => ({
        value: res,
        label: resourceLabel(res),
        icon: resourceIcon(res),
      })),
      get: selected,
      set: (res) => {
        /* As ACTION_STAT_7_SELECT_* of popup.ts: a choice of the interface,
           not of the game. */
        ctx.sound(AudioTypeSfx.TypeSfxClick);
        iface.setSelectedStatResource(res);
      },
    }),
  );

  win.foot().append(
    button('Back to statistics', () => {
      ctx.sound(AudioTypeSfx.TypeSfxClick);
      ctx.open(PopupBoxType.TypeStatSelect);
    }, { icon: iconCanvas(61) }),
  );
  return {};
}

export function registerStatBoxes(): void {
  registerBox(PopupBoxType.TypeStat7, stat7Box);
}
