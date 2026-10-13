// The two boxes of the panel that are about the spot under the map cursor:
// the ground analysis (TypeGroundAnalysis of popup.ts) and the question
// before a building is demolished (TypeDemolish). Not part of Freeserf.

import type { Building } from '../../game/building';
import { MapMinerals } from '../../game/map';
import { ResourceType } from '../../game/resource';
import { SerfType } from '../../game/serf';
import { InterfaceCursorType } from '../interface';
import { PopupBoxType } from '../popup';
import { buildingName } from '../production';
import { buildingHeader, objectHeader } from './building-parts';
import type { BoxContext, BoxView } from './kit';
import { confirmRow, hint, numberRow, resourceIcon, serfIcon } from './widgets';

/* prepareResAmountText() of popup.ts. */
export function groundAmountText(amount: number): string {
  if (amount === 0) return 'Not present';
  else if (amount < 100) return 'Minimum';
  else if (amount < 180) return 'Very few';
  else if (amount < 240) return 'Few';
  else if (amount < 300) return 'Below average';
  else if (amount < 400) return 'Average';
  else if (amount < 500) return 'Above average';
  else if (amount < 600) return 'Much';
  else if (amount < 800) return 'Very much';
  return 'Perfect';
}

/* TypeGroundAnalysis: what the ground around the map cursor holds, as
   drawGroundAnalysisBox() words it. */
function groundAnalysisBox(ctx: BoxContext): BoxView {
  const { win, iface, game } = ctx;
  win.setTitle('Ground analysis');
  win.setPattern('green');
  win.setSize('narrow');

  /* Game::prepare_ground_analysis() walks 25 rings of the map: once per
     update, and only when the cursor moved or a second has passed. */
  const estimates: number[] = [0, 0, 0, 0, 0];
  let pos = -1;
  let age = 0;
  const read = (): void => {
    const cursor = iface.getMapCursorPos();
    if (cursor === pos && age++ < 4) return;
    pos = cursor;
    age = 0;
    game.prepareGroundAnalysis(cursor, estimates);
  };
  read();

  /* Gold and stone count double, as in the original. */
  const rows: { label: string; res: ResourceType; amount: () => number }[] = [
    { label: 'Gold', res: ResourceType.TypeGoldOre, amount: () => 2 * estimates[MapMinerals.MineralsGold] },
    { label: 'Iron', res: ResourceType.TypeIronOre, amount: () => estimates[MapMinerals.MineralsIron] },
    { label: 'Coal', res: ResourceType.TypeCoal, amount: () => estimates[MapMinerals.MineralsCoal] },
    { label: 'Stone', res: ResourceType.TypeStone, amount: () => 2 * estimates[MapMinerals.MineralsStone] },
  ];

  win.add(
    objectHeader({
      pictureKey: () => 'geologist',
      picture: () => serfIcon(SerfType.TypeGeologist),
      name: () => 'Around the map cursor',
      state: () => 'Minerals in the ground here',
    }),
    ...rows.map((row) =>
      numberRow({
        label: row.label,
        icon: resourceIcon(row.res),
        get: () => groundAmountText(row.amount()),
      }),
    ),
    hint('Move the map cursor to look at another spot.'),
  );

  return { update: read };
}

/* TypeDemolish, opened by the demolish button of the panel: the question
   for the building under the map cursor. The window of a building asks the
   same in its Actions section (demolishControl() of building-parts.ts). */
function demolishBox(ctx: BoxContext): BoxView {
  const { win, iface, game } = ctx;
  win.setTitle('Demolish');
  win.setPattern('plain');
  win.setSize('narrow');

  /* The building Interface.demolishObject() would take: the player's own,
     not burning, not the castle (the cursor type CursorTypeBuilding). */
  const find = (): Building | null => {
    if (iface.getMapCursorType() !== InterfaceCursorType.CursorTypeBuilding) return null;
    const building = game.getBuildingAtPos(iface.getMapCursorPos());
    return building === null || building.isBurning() ? null : building;
  };
  let cur = find();
  const b = (): Building | null => cur;

  const question = confirmRow(
    'Demolish this building?',
    {
      label: 'Demolish',
      danger: true,
      action: () => {
        /* ACTION_DEMOLISH of popup.ts. */
        iface.demolishObject();
        ctx.close();
      },
    },
    { label: 'Keep it', action: () => ctx.close() },
  );
  const text = question.el.querySelector<HTMLElement>('.mk-confirm-text');
  let asked = '';
  const ask = (): void => {
    const next = cur === null ? '' : `Demolish this ${buildingName(cur.getType()).toLowerCase()}?`;
    if (next === asked || text === null) return;
    asked = next;
    text.textContent = next;
  };
  ask();

  win.add(
    buildingHeader(ctx, b, (building) => (building.isDone() ? 'Finished' : 'Under construction')),
    question,
  );
  win.initialFocus = question.noButton;

  return {
    update: () => {
      cur = find();
      if (cur === null) {
        ctx.close();
        return;
      }
      ask();
    },
  };
}

export { demolishBox, groundAnalysisBox };

export const groundAnalysisBoxes: PopupBoxType[] = [PopupBoxType.TypeGroundAnalysis];
export const demolishBoxes: PopupBoxType[] = [PopupBoxType.TypeDemolish];
