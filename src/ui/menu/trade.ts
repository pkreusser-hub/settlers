// EXT: the trade window of a castle or storehouse (PopupBoxType.TypeTrade):
// make an offer from this store, answer the offers of other players, see
// the own open offers and the goods on the way. The rule is in
// game/trade.ts. Not part of Freeserf.
//
// The window reads the game and issues the four trade commands of
// net/commands.ts. What the player picks for a new offer (player, goods,
// amounts) is state of the window until "Make the offer" issues it.

import './trade.css';

import type { Building } from '../../game/building';
import { ResourceType } from '../../game/resource';
import {
  TRADE_MAX_AMOUNT,
  TRADE_MAX_OPEN_OFFERS,
  TRADE_OFFER_TICKS,
  TradeRefusal,
} from '../../game/trade';
import type { TradeOffer, TradeShipment } from '../../game/trade';
import {
  cmdTradeAccept,
  cmdTradeCancel,
  cmdTradeDecline,
  cmdTradeOffer,
  tradeAcceptRefusal,
  tradeOfferRefusal,
} from '../../net/commands';
import { AudioTypeSfx } from '../audio';
import { PopupBoxType } from '../popup';
import { amountName, buildingName } from '../production';
import { buildingHeader, dynamic } from './building-parts';
import type { Pin } from './building-parts';
import { inventoryBuilding, setInventoryTabs } from './inventory';
import { registerBox } from './kit';
import type { Interface } from '../interface';
import { BuildingType } from '../../game/building';
import type { BoxContext, BoxView, Widget } from './kit';
import { relationName, resourceBoxOrder, resourceLabel, ticksAsClock } from './names';
import { characterName, playerColorName } from './start';
import { button, el, faceCanvas, hint, resourceIcon, section, segmented, slider } from './widgets';

/* "5 planks", "1 sword". */
function goods(res: ResourceType, count: number): string {
  return amountName(res, String(count));
}

/* "5 planks for 3 stone", "5 planks as a gift". */
function dealText(offer: TradeOffer): string {
  const given = goods(offer.give, offer.giveCount);
  return offer.wantCount > 0 ? `${given} for ${goods(offer.want, offer.wantCount)}` : `${given} as a gift`;
}

/* Why an offer can not be made, in words; '' when it can. */
function offerProblem(refusal: TradeRefusal, give: ResourceType, have: number): string {
  switch (refusal) {
    case TradeRefusal.None: return '';
    case TradeRefusal.Off: return 'This game has no trading.';
    case TradeRefusal.Player: return 'You cannot trade with this player now.';
    case TradeRefusal.Stock: return 'This store cannot trade now.';
    case TradeRefusal.Resource: return 'Pick two different goods.';
    case TradeRefusal.NotEnough: return `This store holds only ${goods(give, have)}.`;
    case TradeRefusal.TooMany: return `You have ${TRADE_MAX_OPEN_OFFERS} open offers. Cancel one first.`;
    default: return 'This offer is not possible.';
  }
}

/* Why an offer can not be accepted, in words; '' when it can. */
function acceptProblem(refusal: TradeRefusal, offer: TradeOffer, have: number): string {
  switch (refusal) {
    case TradeRefusal.None: return '';
    case TradeRefusal.NotEnough:
      return `This store holds only ${goods(offer.want, have)}.`;
    case TradeRefusal.PartnerGoods: return 'The other player no longer has the goods.';
    case TradeRefusal.Busy: return 'Too many goods are on the way. Try again soon.';
    case TradeRefusal.Stock: return 'This store cannot trade now.';
    default: return 'This offer cannot be accepted now.';
  }
}

/* A row of a list: a picture, a text that follows the game, buttons. */
function listRow(picture: HTMLElement | null, text: () => string, buttons: HTMLElement[],
                 more?: () => void): Widget {
  const root = el('li', 'tr-item');
  if (picture !== null) {
    const pic = el('span', 'tr-pic');
    pic.append(picture);
    root.append(pic);
  }
  const words = el('span', 'tr-text');
  root.append(words);
  if (buttons.length > 0) {
    const side = el('span', 'tr-buttons');
    side.append(...buttons);
    root.append(side);
  }
  let shown = '';
  const update = (): void => {
    const next = text();
    if (next !== shown) {
      shown = next;
      words.textContent = next;
    }
    more?.();
  };
  update();
  return { el: root, update };
}

/* A list that is built again when its entries change; `empty` is shown
   when there are none. */
function list(label: string, empty: string, signature: () => string, rows: () => Widget[]): Widget {
  return dynamic(signature, () => {
    const items = rows();
    if (items.length === 0) return [el('p', 'tr-empty', empty)];
    const root = el('ul', 'tr-list');
    root.setAttribute('aria-label', label);
    for (const item of items) root.append(item.el);
    return [{ el: root, update: () => { for (const item of items) item.update?.(); } }];
  }, 'tr-part');
}

/* The player the next trade window offers to first: set by openTrade(). */
let partnerWanted = -1;

/* Open the trade window from anywhere (the Trade button of the top bar, the
   window of another player's building): the window of the player's castle,
   else of the first storehouse. partner, if given, is picked for the offer.
   As the click on a building does, this sets player.tempIndex, a value of
   the interface. */
export function openTrade(iface: Interface, partner = -1): boolean {
  const game = iface.getGame();
  const player = iface.getPlayer();
  if (game === null || player === null || !game.getRules().trading) return false;
  let store: Building | null = null;
  for (const b of game.buildings) {
    if (b.getOwner() !== player.getIndex() || b.isBurning() || !b.isDone()) continue;
    if (b.getInventory() === null) continue;
    if (b.getType() === BuildingType.TypeCastle) { store = b; break; }
    if (b.getType() === BuildingType.TypeStock && store === null) store = b;
  }
  if (store === null) return false;
  partnerWanted = partner;
  player.tempIndex = store.getIndex();
  iface.openPopup(PopupBoxType.TypeTrade);
  return true;
}

function tradeBox(ctx: BoxContext): BoxView {
  const { win, game, player } = ctx;
  const me = player.getIndex();
  const trade = game.trade;
  win.setPattern('green');
  win.setSize('wide');

  const pin: Pin = { pos: null };
  let cur = inventoryBuilding(ctx, pin);
  const b = (): Building | null => cur;
  const have = (res: ResourceType): number => cur?.getInventory()?.getCountOf(res) ?? 0;

  win.setTitle(cur === null ? 'Trade' : `Trade: ${buildingName(cur.getType()).toLowerCase()}`);
  setInventoryTabs(ctx);

  const who = (index: number): string => {
    const other = game.getPlayer(index);
    const name = other === null ? '' : `, ${characterName(other.getFace())}`;
    const relation = relationName(game, me, index);
    return `${playerColorName(index)}${name}${relation !== '' ? ` (${relation})` : ''}`;
  };
  const face = (index: number): HTMLElement | null => {
    const other = game.getPlayer(index);
    return other === null ? null : faceCanvas(other.getFace(), other.getColor());
  };

  win.add(buildingHeader(ctx, b, () => 'Goods you trade leave this store and arrive here.'));

  if (!game.getRules().trading) {
    win.add(hint('This game has no trading. The setup of a new game can turn it on.'));
    return {
      update: () => {
        cur = inventoryBuilding(ctx, pin);
        if (cur === null) ctx.close();
      },
    };
  }

  // -------------------------------------------------------------------------
  // A new offer. The picks are state of the window.

  const others: number[] = [];
  for (let index = 0; index < 4; index++) {
    const other = game.getPlayer(index);
    if (other !== null && index !== me && other.isInGame()) others.push(index);
  }
  let to = others.includes(partnerWanted) ? partnerWanted : others.length > 0 ? others[0] : -1;
  partnerWanted = -1;
  let give: ResourceType = ResourceType.TypePlank;
  let giveCount = 1;
  let want: ResourceType = ResourceType.TypeStone;
  let wantCount = 0;

  const refusal = (): TradeRefusal => {
    if (cur === null) return TradeRefusal.Stock;
    return tradeOfferRefusal(game, player, cur.getPosition(), to, give, giveCount,
                             wantCount > 0 ? want : ResourceType.TypeNone, wantCount);
  };

  const resourceOptions = resourceBoxOrder.map((res) => ({
    value: res,
    label: resourceLabel(res),
    icon: resourceIcon(res),
  }));

  const status = el('p', 'tr-status');
  status.setAttribute('role', 'status');
  const offerButton = button('Make the offer', () => {
    if (cur === null || refusal() !== TradeRefusal.None) {
      ctx.sound(AudioTypeSfx.TypeSfxNotAccepted);
      return;
    }
    ctx.sound(AudioTypeSfx.TypeSfxAccepted);
    cmdTradeOffer(game, cur.getPosition(), to, give, giveCount,
                  wantCount > 0 ? want : ResourceType.TypeNone, wantCount);
  }, { kind: 'primary' });

  let statusShown = '';
  const updateStatus = (): void => {
    const problem = offerProblem(refusal(), give, have(give));
    let text = problem;
    if (problem === '') {
      const deal = wantCount > 0
        ? `${goods(give, giveCount)} for ${goods(want, wantCount)}`
        : `${goods(give, giveCount)} as a gift`;
      text = `You offer ${playerColorName(to)} ${deal}. This store holds ${goods(give, have(give))}.`;
    }
    if (text !== statusShown) {
      statusShown = text;
      status.textContent = text;
      status.classList.toggle('tr-problem', problem !== '');
    }
    if (offerButton.disabled !== (problem !== '')) offerButton.disabled = problem !== '';
  };

  const offerRow = el('div', 'tr-offer-row');
  offerRow.append(status, offerButton);

  const makeOffer = section(
    'Make an offer',
    ...(others.length === 0
      ? [hint('There is no other player in this game.')]
      : [
        segmented<number>({
          label: 'To',
          options: others.map((index) => ({
            value: index,
            label: who(index),
            icon: face(index) ?? undefined,
          })),
          get: () => to,
          set: (index) => { to = index; updateStatus(); },
        }),
        segmented<ResourceType>({
          label: 'You give',
          options: resourceOptions,
          iconsOnly: true,
          get: () => give,
          set: (res) => { give = res; updateStatus(); },
        }),
        slider({
          label: 'Amount you give',
          min: 1,
          max: TRADE_MAX_AMOUNT,
          get: () => giveCount,
          set: (value) => { giveCount = value; updateStatus(); },
          /* The status line below says of what. */
          format: (value) => String(value),
        }),
        segmented<ResourceType>({
          label: 'You want',
          options: resourceBoxOrder.map((res) => ({
            value: res,
            label: resourceLabel(res),
            icon: resourceIcon(res),
          })),
          iconsOnly: true,
          get: () => want,
          set: (res) => { want = res; updateStatus(); },
        }),
        slider({
          label: 'Amount you want',
          min: 0,
          max: TRADE_MAX_AMOUNT,
          get: () => wantCount,
          set: (value) => { wantCount = value; updateStatus(); },
          format: (value) => (value === 0 ? 'Nothing: a gift' : String(value)),
          title: 'Set this to 0 to give the goods away',
        }),
        offerRow,
        hint(
          `The other player has ${ticksAsClock(TRADE_OFFER_TICKS)} minutes of game time to answer. ` +
          'Nothing is set aside while the offer is open. Once it is accepted, a trader takes the ' +
          'goods on a pack horse along your roads, then across country to the other store. The ' +
          'goods arrive with him.'),
      ]),
  );
  makeOffer.el.classList.add('tr-make');

  // -------------------------------------------------------------------------
  // The lists.

  const toMe = (): TradeOffer[] => trade.offers.filter((offer) => offer.to === me);
  const mine = (): TradeOffer[] => trade.offers.filter((offer) => offer.from === me);
  const moving = (): TradeShipment[] =>
    /* A trader on his way home carries nothing: not listed. */
    trade.shipments.filter((s) => s.count > 0 && (s.from === me || s.to === me));

  const incoming = list(
    'Offers to you',
    'Nobody has made you an offer.',
    () => toMe().map((offer) => offer.id).join(','),
    () => toMe().map((offer) => {
      const id = offer.id;
      const problem = (): string => {
        if (cur === null) return 'This store cannot trade now.';
        const r = tradeAcceptRefusal(game, player, id, cur.getPosition());
        return acceptProblem(r, offer, offer.wantCount > 0 ? have(offer.want) : 0);
      };
      const accept = button('Accept', () => {
        if (cur === null || problem() !== '') {
          ctx.sound(AudioTypeSfx.TypeSfxNotAccepted);
          return;
        }
        ctx.sound(AudioTypeSfx.TypeSfxAccepted);
        cmdTradeAccept(game, id, cur.getPosition());
      }, { kind: 'primary' });
      accept.setAttribute('aria-label', `Accept: ${dealText(offer)} from ${playerColorName(offer.from)}`);
      const decline = button('Decline', () => {
        ctx.sound(AudioTypeSfx.TypeSfxClick);
        cmdTradeDecline(game, id);
      });
      decline.setAttribute('aria-label', `Decline: ${dealText(offer)} from ${playerColorName(offer.from)}`);
      return listRow(
        face(offer.from),
        () => {
          const live = trade.getOffer(id);
          if (live === null) return '';
          const p = problem();
          const what = live.wantCount > 0
            ? `gives ${goods(live.give, live.giveCount)} and wants ${goods(live.want, live.wantCount)} from this store`
            : `gives ${goods(live.give, live.giveCount)} as a gift`;
          return `${who(live.from)} ${what}. ${ticksAsClock(live.left)} left.${p !== '' ? ` ${p}` : ''}`;
        },
        [accept, decline],
        () => {
          const off = problem() !== '';
          if (accept.disabled !== off) accept.disabled = off;
        },
      );
    }),
  );

  const outgoing = list(
    'Your open offers',
    'You have no open offer.',
    () => mine().map((offer) => offer.id).join(','),
    () => mine().map((offer) => {
      const id = offer.id;
      const cancel = button('Cancel', () => {
        ctx.sound(AudioTypeSfx.TypeSfxClick);
        cmdTradeCancel(game, id);
      });
      cancel.setAttribute('aria-label', `Cancel: ${dealText(offer)} to ${playerColorName(offer.to)}`);
      return listRow(
        face(offer.to),
        () => {
          const live = trade.getOffer(id);
          if (live === null) return '';
          return `To ${who(live.to)}: ${dealText(live)}. ${ticksAsClock(live.left)} left.`;
        },
        [cancel],
      );
    }),
  );

  const shipmentKey = (s: TradeShipment): string =>
    `${s.from}/${s.to}/${s.res}/${s.count}/${s.back ? 1 : 0}`;
  const onTheWay = list(
    'Goods on the way',
    'No goods are on the way.',
    () => moving().map(shipmentKey).join(','),
    () => moving().map((shipment, i) => {
      const other = shipment.from === me ? shipment.to : shipment.from;
      const pic = el('span', 'tr-goods');
      pic.append(resourceIcon(shipment.res));
      return listRow(
        pic,
        () => {
          /* The same place in the list while the signature holds. */
          const live = moving()[i];
          if (live === undefined) return '';
          const what = goods(live.res, live.count);
          const time = `${ticksAsClock(live.left)} left`;
          if (live.back) {
            return live.from === me
              ? `${what} come back to you: ${who(other)} has no store. ${time}.`
              : `${what} go back to ${who(other)}: you had no store. ${time}.`;
          }
          return live.from === me
            ? `${what} to ${who(other)}, ${time}.`
            : `${what} from ${who(other)}, ${time}.`;
        },
        [],
      );
    }),
  );

  win.add(
    makeOffer,
    section('Offers to you', incoming),
    section('Your open offers', outgoing),
    section('Goods on the way', onTheWay),
  );
  updateStatus();

  return {
    update: () => {
      cur = inventoryBuilding(ctx, pin);
      if (cur === null) {
        ctx.close();
        return;
      }
      updateStatus();
    },
  };
}

export function registerTradeBoxes(): void {
  registerBox(PopupBoxType.TypeTrade, tradeBox);
}
