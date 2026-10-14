// EXT (trading): the traders with their pack horses on the map, drawn by the
// viewport row by row with the serfs, so that trees and buildings further
// down the map stand in front of them. Display only: where a trader is comes
// from the shipment of the trade (Trade.traderAt); nothing here changes the
// game.

import type { Game } from '../game/game';
import type { MapPos } from '../game/map';
import { TRADE_TICKS_PER_STEP } from '../game/trade';
import { CARAVAN_FRAMES, caravanSprite } from './art/caravan';
import type { CaravanView } from './art/caravan';

/* map position -> screen pixel of its centre, as the viewport draws it */
export type ToScreen = (pos: MapPos) => [number, number];

export interface CaravanDraw {
  row: number; /* The map row it is drawn with. */
  draw: (ctx: CanvasRenderingContext2D) => void;
}

/* The traders under way, each with the row it belongs to. */
export function collectCaravans(game: Game, toScreen: ToScreen): CaravanDraw[] {
  const out: CaravanDraw[] = [];
  if (!game.hasTrading()) return out;
  const map = game.getMap();
  for (const shipment of game.trade.shipments) {
    const at = game.trade.traderAt(shipment);
    if (at === null) continue;
    const player = game.getPlayer(shipment.from);
    if (player === null) continue;
    const [x0, y0] = toScreen(at.from);
    const [x1, y1] = toScreen(at.to);
    const dx = x1 - x0, dy = y1 - y0;
    const x = x0 + (dx * at.ticks) / TRADE_TICKS_PER_STEP;
    const y = y0 + (dy * at.ticks) / TRADE_TICKS_PER_STEP;
    const view: CaravanView = Math.abs(dx) >= Math.abs(dy) * 0.6 ? 'side' : dy > 0 ? 'front' : 'back';
    /* one stride of the horse per step */
    const frame = Math.floor((at.ticks * CARAVAN_FRAMES) / TRADE_TICKS_PER_STEP);
    const sprite = caravanSprite(view, frame, player.getColor(), view === 'side' && dx < 0);
    const near = at.ticks * 2 < TRADE_TICKS_PER_STEP ? at.from : at.to;
    out.push({
      row: map.posRow(near),
      /* feet on the point, the middle of the group over it */
      draw: (ctx) => ctx.drawImage(sprite, Math.round(x - sprite.width / 2),
                                   Math.round(y - (sprite.height - 1))),
    });
  }
  return out;
}

/* Draw the traders of one map row. */
export function drawCaravanRow(ctx: CanvasRenderingContext2D, caravans: CaravanDraw[], row: number): void {
  for (const c of caravans) {
    if (c.row === row) c.draw(ctx);
  }
}
