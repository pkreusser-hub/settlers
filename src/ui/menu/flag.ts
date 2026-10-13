// The window of a flag of the player: its roads and their carriers, the
// goods that wait at it, and the two things the box of the original does
// (send a geologist, lead the roads through the flag). In place of
// TypeTransportInfo of popup.ts. The small map view of that box is a list of
// the six directions here. Not part of Freeserf.

import { FLAG_MAX_RES_COUNT } from '../../game/flag';
import type { Flag } from '../../game/flag';
import { Direction } from '../../game/map-geometry';
import { ResourceType } from '../../game/resource';
import { SerfType } from '../../game/serf';
import {
  canSendGeologist,
  cmdPullRoadsThroughFlag,
  cmdSendGeologist,
} from '../../net/commands';
import { AudioTypeSfx } from '../audio';
import { PopupBoxType } from '../popup';
import { buildingName } from '../production';
import { actionsSection, boxFlag, objectHeader } from './building-parts';
import type { Pin } from './building-parts';
import type { BoxContext, BoxView, Widget } from './kit';
import { resourceLabel } from './names';
import { button, el, flagIcon, iconCanvas, numberRow, resourceIcon, section, serfIcon } from './widgets';

/* The six directions, clockwise from the right as the game counts them. */
const directions: { dir: Direction; name: string }[] = [
  { dir: Direction.DirectionRight, name: 'Right' },
  { dir: Direction.DirectionDownRight, name: 'Down right' },
  { dir: Direction.DirectionDown, name: 'Down' },
  { dir: Direction.DirectionLeft, name: 'Left' },
  { dir: Direction.DirectionUpLeft, name: 'Up left' },
  { dir: Direction.DirectionUp, name: 'Up' },
];

/* A direction of the flag in words: the check box and the minus box of
   drawTransportInfoBox() (a carrier serves the road or not), and nothing
   drawn where no road leaves. The building of the flag stands up left of
   it; the flag counts no road for its door. */
function roadText(flag: Flag, dir: Direction): string {
  if (!flag.hasPath(dir)) {
    if (dir === Direction.DirectionUpLeft && flag.hasBuilding()) {
      const building = flag.getBuilding();
      const name = building === null ? 'building' : buildingName(building.getType()).toLowerCase();
      return `Door of the ${name}`;
    }
    return 'No road';
  }
  const what = flag.isWaterPath(dir) ? 'Water road' : 'Road';
  if (flag.hasTransporter(dir)) return `${what}, carrier present`;
  if (flag.serfRequested(dir)) return `${what}, no carrier, one is on the way`;
  return `${what}, no carrier`;
}

function roadCount(flag: Flag): number {
  let n = 0;
  for (const d of directions) {
    if (flag.hasPath(d.dir)) n++;
  }
  return n;
}

/* The eight places for goods at a flag, with what lies in each. */
function slotList(flag: () => Flag | null): Widget {
  const root = el('ol', 'bw-slots');
  root.setAttribute('aria-label', 'Goods waiting at the flag');
  const items: { pic: HTMLElement; text: HTMLElement; li: HTMLElement }[] = [];
  const shown: number[] = [];
  for (let i = 0; i < FLAG_MAX_RES_COUNT; i++) {
    const li = el('li', 'bw-slot');
    const place = el('span', 'bw-slot-place', `${i + 1}.`);
    const pic = el('span', 'mk-pic');
    const text = el('span', 'bw-slot-text');
    li.append(place, pic, text);
    root.append(li);
    items.push({ pic, text, li });
    shown.push(-2);
  }
  const update = (): void => {
    const f = flag();
    for (let i = 0; i < FLAG_MAX_RES_COUNT; i++) {
      const res = f === null ? ResourceType.TypeNone : f.getResourceAtSlot(i);
      if (res === shown[i]) continue;
      shown[i] = res;
      const item = items[i];
      item.pic.textContent = '';
      if (res === ResourceType.TypeNone) {
        item.text.textContent = 'Empty';
        item.li.classList.add('mk-zero');
      } else {
        item.pic.append(resourceIcon(res));
        item.text.textContent = resourceLabel(res);
        item.li.classList.remove('mk-zero');
      }
    }
  };
  update();
  return { el: root, update };
}

/* What a player can do at a flag of his own. The road options to come are
   added to this list; see actionsSection() of building-parts.ts. */
export function flagActions(ctx: BoxContext, flag: () => Flag | null): (Widget | HTMLElement)[] {
  const { game, player } = ctx;

  const geologist = button('Send a geologist', () => {
    /* ACTION_SEND_GEOLOGIST, handleSendGeologist() of popup.ts. That one
       sends to the map cursor, which is on the flag when the box opens;
       here it is the flag of the window wherever the cursor went. */
    const f = flag();
    if (f === null) return;
    if (!canSendGeologist(game, f.getPosition(), player)) {
      ctx.sound(AudioTypeSfx.TypeSfxNotAccepted);
    } else {
      cmdSendGeologist(game, f.getPosition());
      ctx.sound(AudioTypeSfx.TypeSfxAccepted);
      ctx.close();
    }
  }, {
    icon: serfIcon(SerfType.TypeGeologist),
    title: 'A geologist walks to this flag and looks for ore, coal and stone in the hills around it',
  });

  const merge = button('Lead the roads through this flag', () => {
    /* ACTION_UNKNOWN_TP_INFO_FLAG of popup.ts. */
    const f = flag();
    if (f !== null && game.flagHasRoadCorner(f.getPosition())) {
      cmdPullRoadsThroughFlag(game, f.getPosition());
      ctx.sound(AudioTypeSfx.TypeSfxAccepted);
    } else {
      ctx.sound(AudioTypeSfx.TypeSfxNotAccepted);
    }
    ctx.close();
  }, { icon: iconCanvas(0x135) });

  const mergeNote = el('p', 'mk-hint bw-action-note');
  let shown: boolean | null = null;
  const update = (): void => {
    const f = flag();
    const corner = f !== null && game.flagHasRoadCorner(f.getPosition());
    if (corner === shown) return;
    shown = corner;
    merge.disabled = !corner;
    mergeNote.textContent = corner
      ? 'A road passes this flag around a corner. It can go through the flag.'
      : 'No road passes this flag around a corner.';
  };
  update();

  const list = el('div', 'bw-action-list');
  list.append(geologist, merge, mergeNote);
  return [{ el: list, update }];
}

function flagBox(ctx: BoxContext): BoxView {
  const { win, player } = ctx;
  win.setTitle('Flag');
  win.setPattern('green');

  const pin: Pin = { pos: null };
  let cur = boxFlag(ctx, pin);
  const f = (): Flag | null => cur;

  win.add(
    objectHeader({
      pictureKey: () => 'flag',
      picture: () => flagIcon(player.getIndex(), player.getColor()),
      name: () => 'Flag',
      state: () => {
        if (cur === null) return '';
        const roads = roadCount(cur);
        let waiting = 0;
        for (let i = 0; i < FLAG_MAX_RES_COUNT; i++) {
          if (cur.getResourceAtSlot(i) !== ResourceType.TypeNone) waiting++;
        }
        return (
          `${roads} ${roads === 1 ? 'road' : 'roads'}, ` +
          `${waiting} of ${FLAG_MAX_RES_COUNT} places taken`
        );
      },
    }),
    /* "Index:" of the original box. */
    numberRow({ label: 'Flag number', get: () => (cur === null ? '' : cur.getIndex() | 0) }),
  );

  const roads = section('Roads', ...directions.map((d) => {
    const row = numberRow({
      label: d.name,
      get: () => (cur === null ? '' : roadText(cur, d.dir)),
    });
    row.el.classList.add('bw-wide-value');
    return row;
  }));

  win.add(
    roads,
    section('Goods waiting here', slotList(f)),
    actionsSection(flagActions(ctx, f)),
  );

  return {
    update: () => {
      cur = boxFlag(ctx, pin);
      if (cur === null) ctx.close();
    },
  };
}

export const flagBoxes: PopupBoxType[] = [PopupBoxType.TypeTransportInfo];

export { flagBox };
