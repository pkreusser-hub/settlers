// box-frame.h + box-frame.cc - Frame of the boxes of any size

import { Data } from './data-instance';
import { Frame, Graphics } from './gfx';

/* Draw the frame of the popup boxes along the edges of a box of any size
   (at least the 144x160 of a popup). */
/* Frame of the small popup boxes (144x160) stretched to the size of the
   box: the corners and the ornament of the top edge are kept, the plain
   wood between them is repeated. */
export function drawBoxFrame(frame: Frame, width: number, height: number): void {
  const gfx = Graphics.getInstance();

  /* One edge sprite in its own frame, to copy parts of it. */
  const edge = (index: number, w: number, h: number): Frame => {
    const part = gfx.createFrame(w, h);
    part.drawSprite(0, 0, Data.Resource.AssetFramePopup, index);
    return part;
  };
  /* Fill dx..dx+dw of a horizontal edge with sx..sx+sw of the sprite. */
  const fillX = (src: Frame, dx: number, dw: number, dy: number, sx: number, sw: number, h: number): void => {
    for (let x = dx; x < dx + dw; x += sw) {
      frame.drawFrame(x, dy, sx, 0, src, Math.min(sw, dx + dw - x), h);
    }
  };
  /* The same vertically for a side edge. */
  const fillY = (src: Frame, dx: number, dy: number, dh: number, sy: number, sh: number, w: number): void => {
    for (let y = dy; y < dy + dh; y += sh) {
      frame.drawFrame(dx, y, 0, sy, src, w, Math.min(sh, dy + dh - y));
    }
  };

  const topH = 9;
  const bottomH = 7;
  const sideW = 8;

  /* Top: left end, ornament in the middle, right end. */
  const top = edge(0, 144, topH);
  const ornamentX = Math.trunc((width - 56) / 2);
  frame.drawFrame(0, 0, 0, 0, top, 44, topH);
  fillX(top, 44, ornamentX - 44, 0, 12, 32, topH);
  frame.drawFrame(ornamentX, 0, 44, 0, top, 56, topH);
  fillX(top, ornamentX + 56, width - 44 - ornamentX - 56, 0, 12, 32, topH);
  frame.drawFrame(width - 44, 0, 100, 0, top, 44, topH);
  top.destroy();

  /* Bottom: both ends with plain wood between. */
  const bottom = edge(1, 144, bottomH);
  const bottomY = height - bottomH;
  frame.drawFrame(0, bottomY, 0, 0, bottom, 40, bottomH);
  fillX(bottom, 40, width - 80, bottomY, 40, 64, bottomH);
  frame.drawFrame(width - 40, bottomY, 104, 0, bottom, 40, bottomH);
  bottom.destroy();

  /* Sides: the whole sprite, then its middle repeated down. */
  const sideH = height - topH - bottomH;
  for (let i = 0; i < 2; i++) {
    const side = edge(2 + i, sideW, 144);
    const x = i === 0 ? 0 : width - sideW;
    frame.drawFrame(x, topH, 0, 0, side, sideW, 144);
    fillY(side, x, topH + 144, sideH - 144, 16, 96, sideW);
    side.destroy();
  }
}
