// EXT: trading between players (GameRules.trading). Not part of Freeserf;
// this file is all of the rule except its hooks in game.ts (the option, the
// update, the save), the commands in net/commands.ts and the policy of the
// computer players in ai-manage.ts.
//
// A player offers goods of one of his stocks to another player: give N of
// one resource, want M of another (M 0 is a gift). The other accepts or
// declines; an offer that is not answered expires. Nothing is reserved while
// an offer is open: everything is checked again when it is accepted.
//
// Roads of different players never join, so no carrier can bring goods
// across a border. On accept the goods leave the stocks at once and travel
// as shipments: entries of a list of the game that count ticks down and then
// put the goods into a stock of the receiver the way a delivered resource
// gets there (Building.requestedResourceDelivered). The time grows with the
// distance between the two stocks.
//
// Integers only. The lists are arrays in the order the entries were made.

import type { Building } from './building';
import type { Game } from './game';
import type { Inventory } from './inventory';
import type { MapPos } from './map';
import { MessageType } from './player';
import type { Player } from './player';
import { ResourceType } from './resource';
import type { SaveReaderText, SaveWriterText } from './savegame';

/* Ticks an offer stays open: 3 minutes of game time (100 ticks a second at
   normal speed). */
export const TRADE_OFFER_TICKS = 18000;
/* Open offers one player may have made at a time. */
export const TRADE_MAX_OPEN_OFFERS = 4;
/* The most of a resource one side of an offer may name. */
export const TRADE_MAX_AMOUNT = 100;
/* Shipments under way in the whole game; no offer is accepted beyond. */
export const TRADE_MAX_SHIPMENTS = 64;
/* Ticks a shipment travels: TRADE_DELAY_BASE and TRADE_DELAY_PER_TILE for
   each tile between the two stocks, at most TRADE_DELAY_MAX (10 seconds,
   1 second a tile, 2 minutes at normal speed). */
export const TRADE_DELAY_BASE = 1000;
export const TRADE_DELAY_PER_TILE = 100;
export const TRADE_DELAY_MAX = 12000;

/* The resources that can be traded: all 26 (weapons too). Serfs and knights
   are not goods. */
export const TRADE_RESOURCE_COUNT = 26;

/* Why an offer is not made or not accepted. */
export enum TradeRefusal {
  None = 0,
  /* The game has no trading. */
  Off,
  /* The other player is the player himself, not in the game or defeated,
     or the player himself is. */
  Player,
  /* No castle or storehouse of the player at the position. */
  Stock,
  /* Not a resource, or the same resource both ways. */
  Resource,
  /* An amount that is not 1..TRADE_MAX_AMOUNT (0 wanted is a gift). */
  Amount,
  /* The stock holds less than the amount. */
  NotEnough,
  /* TRADE_MAX_OPEN_OFFERS are open. */
  TooMany,
  /* No such offer (it was answered, cancelled or it expired), or it is not
     the player's to answer or cancel. */
  NoOffer,
  /* The stock of the player who made the offer no longer holds the goods. */
  PartnerGoods,
  /* TRADE_MAX_SHIPMENTS are under way. */
  Busy,
}

/* Why an offer ended without a trade (the data of TypeTradeDeclined). */
export const TRADE_END_DECLINED = 0;
export const TRADE_END_EXPIRED = 1;
/* A player is defeated or the stock of the offer is gone. */
export const TRADE_END_VOID = 2;

export interface TradeOffer {
  id: number;
  from: number; /* The player who made it. */
  to: number;
  inv: number; /* The inventory of `from` the goods leave from. */
  give: ResourceType;
  giveCount: number;
  want: ResourceType; /* TypeNone (-1) for a gift. */
  wantCount: number; /* 0 for a gift. */
  left: number; /* Ticks until it expires. */
}

export interface TradeShipment {
  from: number; /* The player who sent it. */
  to: number;
  inv: number; /* The inventory of `to` it should reach; another if gone. */
  res: ResourceType;
  count: number;
  left: number; /* Ticks until it arrives. */
  delay: number; /* The whole way, for the way back. */
  back: boolean; /* On the way back to `from`: `to` had no stock. */
}

/* What the trade messages carry in Message.data: the other player in bits
   0..1, a resource in 2..6, its amount in 7..13, a second resource + 1 in
   14..18 and its amount in 19..25, a code in 26..27. */
export function packTradeData(other: number, res: number, count: number,
                              res2: number, count2: number, code: number): number {
  return (other & 3) | ((res & 31) << 2) | ((count & 127) << 7) |
         (((res2 + 1) & 31) << 14) | ((count2 & 127) << 19) | ((code & 3) << 26);
}

export function unpackTradeData(data: number): {
  other: number; res: number; count: number; res2: number; count2: number; code: number;
} {
  return {
    other: data & 3,
    res: (data >>> 2) & 31,
    count: (data >>> 7) & 127,
    res2: ((data >>> 14) & 31) - 1,
    count2: (data >>> 19) & 127,
    code: (data >>> 26) & 3,
  };
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

export class Trade {
  offers: TradeOffer[] = [];
  shipments: TradeShipment[] = [];
  /* The id of the next offer. */
  nextId = 1;

  constructor(protected game: Game) {}

  /* Whether anything is to be saved or hashed. */
  isEmpty(): boolean {
    return this.offers.length === 0 && this.shipments.length === 0 && this.nextId === 1;
  }

  // -------------------------------------------------------------------------
  // Reading.

  /* The building of an inventory that can give and take goods: it belongs
     to the player, its building stands and holds it. */
  protected stockBuilding(inventory: Inventory | null, playerIndex: number): Building | null {
    if (inventory === null || inventory.getOwner() !== playerIndex) return null;
    const building = this.game.getBuilding(inventory.getBuildingIndex());
    if (building === null || building.isBurning()) return null;
    if (building.getOwner() !== playerIndex || building.getInventory() !== inventory) return null;
    return building;
  }

  /* The inventory `index` of the player if it can give and take goods. */
  getStock(playerIndex: number, index: number): Inventory | null {
    const inventory = this.game.getInventory(index);
    return this.stockBuilding(inventory, playerIndex) !== null ? inventory : null;
  }

  /* The castle or storehouse of the player at pos, as an inventory. */
  getStockAt(player: Player, pos: MapPos): Inventory | null {
    const building = this.game.getBuildingAtPos(pos);
    if (building === null) return null;
    const inventory = building.getInventory();
    return this.stockBuilding(inventory, player.getIndex()) !== null ? inventory : null;
  }

  /* Where goods for the player go: the inventory `preferred` if it still
     takes them, else the castle, else the first storehouse. null when the
     player has none. */
  findStock(playerIndex: number, preferred: number): Inventory | null {
    let inventory = this.getStock(playerIndex, preferred);
    if (inventory !== null) return inventory;
    const player = this.game.getPlayer(playerIndex);
    if (player === null) return null;
    if (player.hasCastle()) {
      inventory = this.getStock(playerIndex, player.castleInventory);
      if (inventory !== null) return inventory;
    }
    for (const other of this.game.getPlayerInventories(player)) {
      if (this.stockBuilding(other, playerIndex) !== null) return other;
    }
    return null;
  }

  /* Whether the player can trade: in the game, the castle stands and a
     stock takes goods. */
  canPlayerTrade(index: number): boolean {
    if (!isInt(index, 0, 3)) return false;
    const player = this.game.getPlayer(index);
    if (player === null || !player.isInGame()) return false;
    if (!player.hasCastle() || player.isDefeated()) return false;
    return this.findStock(index, 0) !== null;
  }

  getOffer(id: number): TradeOffer | null {
    for (const offer of this.offers) {
      if (offer.id === id) return offer;
    }
    return null;
  }

  /* The open offers a player has made. */
  countOffersOf(playerIndex: number): number {
    let count = 0;
    for (const offer of this.offers) {
      if (offer.from === playerIndex) count += 1;
    }
    return count;
  }

  /* Tiles between two map positions: the steps of a serf that could walk
     straight. */
  distance(a: MapPos, b: MapPos): number {
    const map = this.game.getMap();
    const dx = map.distX(a, b);
    const dy = map.distY(a, b);
    if ((dx >= 0) === (dy >= 0)) return Math.max(Math.abs(dx), Math.abs(dy));
    return Math.abs(dx) + Math.abs(dy);
  }

  /* The ticks a shipment travels between two stocks. */
  delay(a: Inventory, b: Inventory): number {
    const ba = this.game.getBuilding(a.getBuildingIndex());
    const bb = this.game.getBuilding(b.getBuildingIndex());
    if (ba === null || bb === null) return TRADE_DELAY_MAX;
    const ticks = TRADE_DELAY_BASE +
                  TRADE_DELAY_PER_TILE * this.distance(ba.getPosition(), bb.getPosition());
    return Math.min(ticks, TRADE_DELAY_MAX);
  }

  // -------------------------------------------------------------------------
  // The actions of a player (the commands of net/commands.ts call them).

  /* Why the player may not make the offer, or TradeRefusal.None. The
     arguments come from the network: nothing is assumed about them. */
  offerRefusal(player: Player, pos: MapPos, to: unknown, give: unknown, giveCount: unknown,
               want: unknown, wantCount: unknown): TradeRefusal {
    if (!this.game.hasTrading()) return TradeRefusal.Off;
    if (!isInt(to, 0, 3) || to === player.getIndex()) return TradeRefusal.Player;
    if (!this.canPlayerTrade(player.getIndex()) || !this.canPlayerTrade(to)) {
      return TradeRefusal.Player;
    }
    if (!isInt(give, 0, TRADE_RESOURCE_COUNT - 1)) return TradeRefusal.Resource;
    if (!isInt(giveCount, 1, TRADE_MAX_AMOUNT)) return TradeRefusal.Amount;
    if (!isInt(wantCount, 0, TRADE_MAX_AMOUNT)) return TradeRefusal.Amount;
    if (wantCount === 0) {
      if (want !== ResourceType.TypeNone) return TradeRefusal.Resource;
    } else if (!isInt(want, 0, TRADE_RESOURCE_COUNT - 1) || want === give) {
      return TradeRefusal.Resource;
    }
    const inventory = this.getStockAt(player, pos);
    if (inventory === null) return TradeRefusal.Stock;
    if (inventory.getCountOf(give) < giveCount) return TradeRefusal.NotEnough;
    if (this.countOffersOf(player.getIndex()) >= TRADE_MAX_OPEN_OFFERS) return TradeRefusal.TooMany;
    return TradeRefusal.None;
  }

  /* Make the offer; the id of it, or 0 when it is refused. */
  makeOffer(player: Player, pos: MapPos, to: number, give: ResourceType, giveCount: number,
            want: ResourceType, wantCount: number): number {
    if (this.offerRefusal(player, pos, to, give, giveCount, want, wantCount) !==
        TradeRefusal.None) {
      return 0;
    }
    const inventory = this.getStockAt(player, pos)!;
    const offer: TradeOffer = {
      id: this.nextId,
      from: player.getIndex(),
      to,
      inv: inventory.getIndex(),
      give,
      giveCount,
      want,
      wantCount,
      left: TRADE_OFFER_TICKS,
    };
    this.nextId = this.nextId >= 0x7fffffff ? 1 : this.nextId + 1;
    this.offers.push(offer);
    this.game.getPlayer(to)!.addNotification(
      MessageType.TypeTradeOffer, 0,
      packTradeData(offer.from, give, giveCount, want, wantCount, 0));
    return offer.id;
  }

  /* Why the player may not accept the offer `id` with his castle or
     storehouse at pos, or TradeRefusal.None. */
  acceptRefusal(player: Player, id: unknown, pos: MapPos): TradeRefusal {
    if (!this.game.hasTrading()) return TradeRefusal.Off;
    if (!isInt(id, 1, 0x7fffffff)) return TradeRefusal.NoOffer;
    const offer = this.getOffer(id);
    if (offer === null || offer.to !== player.getIndex()) return TradeRefusal.NoOffer;
    if (offer.from === offer.to) return TradeRefusal.Player;
    if (!this.canPlayerTrade(offer.from) || !this.canPlayerTrade(offer.to)) {
      return TradeRefusal.Player;
    }
    const own = this.getStockAt(player, pos);
    if (own === null) return TradeRefusal.Stock;
    const theirs = this.getStock(offer.from, offer.inv);
    if (theirs === null || theirs.getCountOf(offer.give) < offer.giveCount) {
      return TradeRefusal.PartnerGoods;
    }
    if (offer.wantCount > 0 && own.getCountOf(offer.want) < offer.wantCount) {
      return TradeRefusal.NotEnough;
    }
    if (this.shipments.length + 2 > TRADE_MAX_SHIPMENTS) return TradeRefusal.Busy;
    return TradeRefusal.None;
  }

  /* Accept the offer: the goods of both sides leave the two stocks and are
     under way. */
  acceptOffer(player: Player, id: number, pos: MapPos): boolean {
    if (this.acceptRefusal(player, id, pos) !== TradeRefusal.None) return false;
    const offer = this.getOffer(id)!;
    const own = this.getStockAt(player, pos)!;
    const theirs = this.getStock(offer.from, offer.inv)!;
    const delay = this.delay(theirs, own);

    /* The counts were checked above: neither goes below 0. */
    theirs.setCountOf(offer.give, theirs.getCountOf(offer.give) - offer.giveCount);
    this.shipments.push({
      from: offer.from, to: offer.to, inv: own.getIndex(),
      res: offer.give, count: offer.giveCount, left: delay, delay, back: false,
    });
    if (offer.wantCount > 0) {
      own.setCountOf(offer.want, own.getCountOf(offer.want) - offer.wantCount);
      this.shipments.push({
        from: offer.to, to: offer.from, inv: theirs.getIndex(),
        res: offer.want, count: offer.wantCount, left: delay, delay, back: false,
      });
    }

    this.offers.splice(this.offers.indexOf(offer), 1);
    this.game.getPlayer(offer.from)!.addNotification(
      MessageType.TypeTradeAccepted, 0,
      packTradeData(offer.to, offer.give, offer.giveCount, offer.want, offer.wantCount, 0));
    return true;
  }

  /* The player the offer is for says no. */
  declineOffer(player: Player, id: unknown): boolean {
    if (!this.game.hasTrading() || !isInt(id, 1, 0x7fffffff)) return false;
    const offer = this.getOffer(id);
    if (offer === null || offer.to !== player.getIndex()) return false;
    this.endOffer(offer, TRADE_END_DECLINED);
    return true;
  }

  /* The player who made the offer takes it back. */
  cancelOffer(player: Player, id: unknown): boolean {
    if (!this.game.hasTrading() || !isInt(id, 1, 0x7fffffff)) return false;
    const offer = this.getOffer(id);
    if (offer === null || offer.from !== player.getIndex()) return false;
    this.offers.splice(this.offers.indexOf(offer), 1);
    return true;
  }

  /* Remove the offer and tell the player who made it why. */
  protected endOffer(offer: TradeOffer, code: number): void {
    this.offers.splice(this.offers.indexOf(offer), 1);
    const from = this.game.getPlayer(offer.from);
    if (from !== null) {
      from.addNotification(
        MessageType.TypeTradeDeclined, 0,
        packTradeData(offer.to, offer.give, offer.giveCount, offer.want, offer.wantCount, code));
    }
  }

  // -------------------------------------------------------------------------
  // The update, once per Game.update() while the rule is on.

  update(tickDiff: number): void {
    if (this.offers.length !== 0) {
      for (const offer of this.offers.slice()) {
        if (!this.canPlayerTrade(offer.from) || !this.canPlayerTrade(offer.to) ||
            this.getStock(offer.from, offer.inv) === null) {
          /* A defeated player has no offers, and nobody has one to him. */
          this.endOffer(offer, TRADE_END_VOID);
          continue;
        }
        offer.left -= tickDiff;
        if (offer.left <= 0) this.endOffer(offer, TRADE_END_EXPIRED);
      }
    }

    if (this.shipments.length !== 0) {
      for (const shipment of this.shipments.slice()) {
        shipment.left -= tickDiff;
        if (shipment.left <= 0) this.arrive(shipment);
      }
    }
  }

  /* The shipment is there: into a stock of the receiver; back to the sender
     when the receiver has none; lost when the sender has none either. */
  protected arrive(shipment: TradeShipment): void {
    const playerIndex = shipment.back ? shipment.from : shipment.to;
    const inventory = this.findStock(playerIndex, shipment.back ? 0 : shipment.inv);
    if (inventory === null) {
      if (!shipment.back) {
        shipment.back = true;
        shipment.left = shipment.delay;
        return;
      }
      for (let i = 0; i < shipment.count; i++) this.game.loseResource(shipment.res);
      this.shipments.splice(this.shipments.indexOf(shipment), 1);
      return;
    }

    const building = this.game.getBuilding(inventory.getBuildingIndex())!;
    for (let i = 0; i < shipment.count; i++) {
      /* A full stock takes no more (Inventory.pushResource): that unit is
         lost to the game. */
      if (inventory.getCountOf(shipment.res) >= 50000) this.game.loseResource(shipment.res);
      building.requestedResourceDelivered(shipment.res);
    }
    this.shipments.splice(this.shipments.indexOf(shipment), 1);
    this.game.getPlayer(playerIndex)!.addNotification(
      MessageType.TypeTradeArrived, building.getPosition(),
      packTradeData(shipment.back ? shipment.to : shipment.from, shipment.res, shipment.count,
                    ResourceType.TypeNone, 0, shipment.back ? 1 : 0));
  }

  // -------------------------------------------------------------------------
  // Consistency (IntegrityCheck) and the state hash.

  /* The number of entries that could not have been made by the rule (a
     save can hold anything). With fix they are dropped. */
  countProblems(fix: boolean): number {
    let problems = 0;
    const seen: number[] = [];
    const count = [0, 0, 0, 0];
    const offers: TradeOffer[] = [];
    for (const o of this.offers) {
      const ok = this.game.hasTrading() &&
        isInt(o.id, 1, 0x7fffffff) && !seen.includes(o.id) && o.id !== this.nextId &&
        isInt(o.from, 0, 3) && isInt(o.to, 0, 3) && o.from !== o.to &&
        this.game.getPlayer(o.from) !== null && this.game.getPlayer(o.to) !== null &&
        count[o.from] < TRADE_MAX_OPEN_OFFERS &&
        isInt(o.inv, 0, 0xffff) &&
        isInt(o.give, 0, TRADE_RESOURCE_COUNT - 1) && isInt(o.giveCount, 1, TRADE_MAX_AMOUNT) &&
        (o.wantCount === 0 ? o.want === ResourceType.TypeNone
          : isInt(o.want, 0, TRADE_RESOURCE_COUNT - 1) && o.want !== o.give &&
            isInt(o.wantCount, 1, TRADE_MAX_AMOUNT)) &&
        isInt(o.left, 1, TRADE_OFFER_TICKS);
      if (ok) {
        seen.push(o.id);
        count[o.from] += 1;
        offers.push(o);
      } else {
        problems += 1;
      }
    }
    const shipments: TradeShipment[] = [];
    for (const s of this.shipments) {
      const ok = this.game.hasTrading() && shipments.length < TRADE_MAX_SHIPMENTS &&
        isInt(s.from, 0, 3) && isInt(s.to, 0, 3) && s.from !== s.to &&
        this.game.getPlayer(s.from) !== null && this.game.getPlayer(s.to) !== null &&
        isInt(s.inv, 0, 0xffff) &&
        isInt(s.res, 0, TRADE_RESOURCE_COUNT - 1) && isInt(s.count, 1, TRADE_MAX_AMOUNT) &&
        isInt(s.delay, TRADE_DELAY_BASE, TRADE_DELAY_MAX) && isInt(s.left, 1, s.delay) &&
        typeof s.back === 'boolean';
      if (ok) {
        shipments.push(s);
      } else {
        problems += 1;
      }
    }
    if (!isInt(this.nextId, 1, 0x7fffffff)) {
      problems += 1;
      if (fix) {
        let top = 0;
        for (const o of offers) top = Math.max(top, o.id);
        this.nextId = top >= 0x7fffffff ? 1 : top + 1;
      }
    }
    if (fix && problems !== 0) {
      /* A dropped shipment is lost to the game. */
      for (const s of this.shipments) {
        if (shipments.includes(s) || !isInt(s.count, 1, TRADE_MAX_AMOUNT)) continue;
        if (s.res === ResourceType.TypeGoldOre || s.res === ResourceType.TypeGoldBar) {
          for (let i = 0; i < s.count && this.game.getGoldTotal() > 0; i++) {
            this.game.loseResource(s.res);
          }
        }
      }
      this.offers = offers;
      this.shipments = shipments;
    }
    return problems;
  }

  /* Every number of the state, for the hash of net/hash.ts. */
  mixInto(mix: (v: number) => void): void {
    mix(this.nextId);
    mix(this.offers.length);
    for (const o of this.offers) {
      mix(o.id); mix(o.from); mix(o.to); mix(o.inv); mix(o.give); mix(o.giveCount);
      mix(o.want); mix(o.wantCount); mix(o.left);
    }
    mix(this.shipments.length);
    for (const s of this.shipments) {
      mix(s.from); mix(s.to); mix(s.inv); mix(s.res); mix(s.count); mix(s.left);
      mix(s.delay); mix(s.back ? 1 : 0);
    }
  }

  // -------------------------------------------------------------------------
  // The save: "trade_next_id" in the game section and one section per offer
  // and per shipment, written only when there is something to write.

  saveText(gameWriter: SaveWriterText, writer: SaveWriterText): void {
    if (this.nextId !== 1) gameWriter.value('trade_next_id').write(this.nextId);
    this.offers.forEach((o, i) => {
      const w = writer.addSection('trade_offer', i);
      w.value('id').write(o.id);
      w.value('from').write(o.from);
      w.value('to').write(o.to);
      w.value('inventory').write(o.inv);
      w.value('give').write(o.give);
      w.value('give').write(o.giveCount);
      w.value('want').write(o.want);
      w.value('want').write(o.wantCount);
      w.value('left').write(o.left);
    });
    this.shipments.forEach((s, i) => {
      const w = writer.addSection('trade_shipment', i);
      w.value('from').write(s.from);
      w.value('to').write(s.to);
      w.value('inventory').write(s.inv);
      w.value('resource').write(s.res);
      w.value('resource').write(s.count);
      w.value('left').write(s.left);
      w.value('delay').write(s.delay);
      w.value('back').write(s.back ? 1 : 0);
    });
  }

  loadText(gameReader: SaveReaderText, reader: SaveReaderText): void {
    this.offers = [];
    this.shipments = [];
    this.nextId = 1;
    if (gameReader.hasValue('trade_next_id')) {
      this.nextId = gameReader.value('trade_next_id').readInt();
    }
    const byNumber = (a: SaveReaderText, b: SaveReaderText): number =>
      a.getNumber() - b.getNumber();
    for (const r of reader.getSections('trade_offer').sort(byNumber)) {
      this.offers.push({
        id: r.value('id').readInt(),
        from: r.value('from').readInt(),
        to: r.value('to').readInt(),
        inv: r.value('inventory').readInt(),
        give: r.value('give').at(0).readInt(),
        giveCount: r.value('give').at(1).readInt(),
        want: r.value('want').at(0).readInt(),
        wantCount: r.value('want').at(1).readInt(),
        left: r.value('left').readInt(),
      });
    }
    for (const r of reader.getSections('trade_shipment').sort(byNumber)) {
      this.shipments.push({
        from: r.value('from').readInt(),
        to: r.value('to').readInt(),
        inv: r.value('inventory').readInt(),
        res: r.value('resource').at(0).readInt(),
        count: r.value('resource').at(1).readInt(),
        left: r.value('left').readInt(),
        delay: r.value('delay').readInt(),
        back: r.value('back').readInt() !== 0,
      });
    }
  }
}
