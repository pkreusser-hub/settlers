// The attack window: the building of another player that was clicked, the
// knights the player can send against it and how many go. In place of
// TypeStartAttack and TypeStartAttackRedraw of popup.ts. The numbers are
// the interface's (Interface.attack, set by openObjectBox() of viewport.ts)
// as in that box. Not part of Freeserf.

import type { Building } from '../../game/building';
import { attackRefusal, cmdStartAttack, isAttackBoxTarget, previewAttack } from '../../net/commands';
import { AudioTypeSfx } from '../audio';
import { PopupBoxType } from '../popup';
import { buildingName } from '../production';
import { actionsSection, objectHeader } from './building-parts';
import type { BoxContext, BoxView, Widget } from './kit';
import { relationName, teamName, ticksAsClock } from './names';
import {
  button,
  buildingIcon,
  el,
  faceCanvas,
  fitHeight,
  iconCanvas,
  numberRow,
  section,
  stepper,
} from './widgets';

/* The four distances of Player::knights_available_for_attack(): the 32
   rings of fields around the target, eight to a class. The icons are those
   of the original box. */
const distances: { label: string; icon: number }[] = [
  { label: 'Nearest, up to 8 fields away', icon: 216 },
  { label: 'Near, 9 to 16 fields away', icon: 217 },
  { label: 'Far, 17 to 24 fields away', icon: 218 },
  { label: 'Farthest, 25 to 32 fields away', icon: 219 },
];

/* "Player 2", as the chat names the players. */
function playerLabel(index: number): string {
  return `Player ${index + 1}`;
}

/* What a player can do with a building of another player. The trade and
   alliance controls to come are added to this list; see actionsSection()
   of building-parts.ts. */
export function enemyActions(_ctx: BoxContext, start: HTMLButtonElement): (Widget | HTMLElement)[] {
  return [start];
}

function attackBox(ctx: BoxContext): BoxView {
  const { win, iface, game, player } = ctx;
  const attack = iface.attack;
  win.setTitle('Attack');
  win.setPattern('build');

  /* The building that was clicked. The window closes when it is gone,
     burning, the player's own by now or no longer open to an attack. */
  const pinned = attack.pos;
  const findTarget = (): Building | null => {
    if (attack.pos !== pinned) return null;
    const building = game.getBuilding(attack.buildingAttacked);
    if (building === null || building.getPosition() !== pinned) return null;
    /* GAME OPTIONS: a building of an ally stays in the window, which says
       why there is no attack on it. */
    if (!isAttackBoxTarget(game, pinned, player)) return null;
    return building;
  };
  let target = findTarget();

  /* GAME OPTIONS: "Player 2, Team B, enemy" when the game has teams. */
  const ownerText = (owner: number): string => {
    const parts = [playerLabel(owner)];
    if (game.hasTeams()) {
      const other = game.getPlayer(owner);
      const team = other === null ? '' : teamName(other.getTeam());
      parts.push(team !== '' ? team : 'no team');
      const relation = relationName(game, player.getIndex(), owner);
      if (relation !== '') parts.push(relation === 'ally' ? 'your ally' : relation);
    }
    return parts.join(', ');
  };

  /* GAME OPTIONS: why the rules allow no attack now, or ''. */
  const refusalText = (): string => {
    if (target === null) return '';
    switch (attackRefusal(game, pinned, player)) {
      case 'ally':
        return `${playerLabel(target.getOwner())} is your ally. You cannot attack an ally.`;
      case 'peace':
        return `Peace: nobody can attack for another ${ticksAsClock(game.getPeaceTicksLeft())} ` +
          'of game time.';
      default:
        return '';
    }
  };

  win.add(
    objectHeader({
      pictureKey: () => (target === null ? '' : `${target.getType()}|${target.getOwner()}`),
      picture: () => {
        if (target === null) return null;
        const owner = game.getPlayer(target.getOwner());
        return buildingIcon(target.getType(), owner?.getColor());
      },
      name: () => (target === null ? '' : buildingName(target.getType())),
      state: () => (target === null ? '' : `Held by ${ownerText(target.getOwner())}`),
    }),
  );

  /* The owner: face and number. */
  win.add(
    (() => {
      const owner = target === null ? null : game.getPlayer(target.getOwner());
      return numberRow({
        label: 'Owner',
        icon: owner === null ? undefined : fitHeight(faceCanvas(owner.getFace(), owner.getColor()), 3),
        get: () => (target === null ? '' : ownerText(target.getOwner())),
      });
    })(),
  );

  const limit = (): number => Math.min(attack.totalAttackingKnights, 100);

  /* The knights at each distance. The button takes all of them and of the
     nearer ones: ACTION_ATTACKING_SELECT_ALL_1..4. */
  const ready = section('Your knights ready to go');
  distances.forEach((distance, i) => {
    const row = el('div', 'mk-row bw-distance');
    const label = el('span', 'mk-label');
    const pic = el('span', 'mk-pic');
    pic.append(iconCanvas(distance.icon));
    label.append(pic, el('span', 'mk-label-text', distance.label));
    const side = el('span', 'mk-side');
    const value = el('span', 'mk-value');
    const select = button('Send up to here', () => {
      let sum = 0;
      for (let j = 0; j <= i; j++) sum += attack.attackingKnights[j];
      attack.knightsAttacking = sum;
      win.updateWidgets();
    }, { title: 'Send all the knights of this distance and of the nearer ones' });
    select.setAttribute('aria-label', `Send all knights up to: ${distance.label}`);
    side.append(value, select);
    row.append(label, side);
    let shown = -1;
    const update = (): void => {
      const n = attack.attackingKnights[i];
      if (n === shown) return;
      shown = n;
      value.textContent = String(n);
    };
    update();
    ready.content.append(row);
    win.track({ el: row, update });
  });
  win.add(
    ready,
    numberRow({ label: 'Ready in all', get: () => attack.totalAttackingKnights }),
    stepper({
      label: 'Knights to send',
      get: () => attack.knightsAttacking,
      decLabel: 'Send one knight less',
      incLabel: 'Send one knight more',
      /* ACTION_ATTACKING_KNIGHTS_DEC and _INC. */
      dec: () => {
        attack.knightsAttacking = Math.max(attack.knightsAttacking - 1, 0);
        win.updateWidgets();
      },
      inc: () => {
        attack.knightsAttacking = Math.min(attack.knightsAttacking + 1, limit());
        win.updateWidgets();
      },
      canDec: () => attack.knightsAttacking > 0,
      canInc: () => attack.knightsAttacking < limit(),
    }),
  );

  const start = button('Attack', () => {
    /* GAME OPTIONS: the command would be refused. */
    if (refusalText() !== '') {
      ctx.sound(AudioTypeSfx.TypeSfxNotAccepted);
      return;
    }
    /* ACTION_START_ATTACK. */
    if (attack.knightsAttacking > 0) {
      if (attack.attackingBuildingCount > 0) {
        ctx.sound(AudioTypeSfx.TypeSfxAccepted);
        cmdStartAttack(game, attack.pos, attack.knightsAttacking);
      }
      ctx.close();
    } else {
      ctx.sound(AudioTypeSfx.TypeSfxNotAccepted);
    }
  }, { kind: 'primary', icon: iconCanvas(222), title: 'Send the knights against this building' });

  /* GAME OPTIONS: the reason there is no attack, above the button it turns
     off. */
  const refusal = el('p', 'bw-refusal');
  refusal.setAttribute('role', 'status');
  let refusalShown = '?';
  const showRefusal = (): void => {
    const text = refusalText();
    if (text === refusalShown) return;
    refusalShown = text;
    refusal.textContent = text;
    refusal.hidden = text === '';
    start.disabled = text !== '';
    start.title = text !== '' ? text : 'Send the knights against this building';
  };
  showRefusal();

  win.add(actionsSection([refusal, ...enemyActions(ctx, start)]));
  win.initialFocus = start;
  win.foot().append(
    /* ACTION_CLOSE_ATTACK_BOX. */
    button('Cancel', () => ctx.close(), { icon: iconCanvas(60) }),
  );

  let ticks = 0;
  return {
    update: () => {
      target = findTarget();
      if (target === null) {
        ctx.close();
        return;
      }
      showRefusal();
      /* The knights change while the window is open: count them again
         once a second, as the click on the building did. The command
         counts them once more when it runs. */
      if (ticks++ % 4 === 0) {
        const preview = previewAttack(player, pinned);
        attack.attackingKnights = preview.attackingKnights;
        attack.totalAttackingKnights = preview.totalAttackingKnights;
        attack.attackingBuildingCount = preview.attackingBuildingCount;
        if (attack.knightsAttacking > preview.totalAttackingKnights) {
          attack.knightsAttacking = preview.totalAttackingKnights;
        }
      }
    },
  };
}

export const attackBoxes: PopupBoxType[] = [
  PopupBoxType.TypeStartAttack,
  PopupBoxType.TypeStartAttackRedraw,
];

export { attackBox };
