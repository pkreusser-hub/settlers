// Dev tool: trading between players (EXT, game/trade.ts) in headless games.
// Usage: npx esbuild tools/trade-test.ts --bundle --platform=node --outfile=node_modules/.cache/trade-test.cjs --log-level=error && node node_modules/.cache/trade-test.cjs [updates of the long run]
//
// Checks:
//  1. a gift and a swap between two players end with exactly the expected
//     counts in both stocks, after the delay the distance gives;
//  2. every refusal: option off, self, a player that is not there, more
//     than in stock, amounts that are 0, negative or not integers, a
//     resource that does not exist, too many open offers, accepting the
//     offer of somebody else, accepting twice, an expired offer, cancel and
//     decline by the wrong player;
//  3. expiry, to the update;
//  4. the offers of a defeated player are cancelled; goods return to the
//     sender when the receiver has no stock, and are lost when neither has;
//  5. a computer player takes a gift and judges a swap by its policy;
//  6. a save with an open offer and a shipment under way: round trip, two
//     loads stay equal, the shipment arrives in the loaded game; a save
//     without the values; a save with values the rule could not have made;
//  7. a long game of four computer players with scripted offers is the same
//     twice.
// IntegrityCheck finds nothing anywhere.

import { BuildingType } from '../src/game/building';
import { AI_TRADE_KEEP, AI_TRADE_KEEP_MATERIAL, tradeSwapAccepted } from '../src/game/ai-manage';
import { Game } from '../src/game/game';
import { IntegrityCheck } from '../src/game/integrity';
import { Log } from '../src/game/misc';
import { GameInfo } from '../src/game/mission';
import { MessageType } from '../src/game/player';
import type { Message } from '../src/game/player';
import { Random } from '../src/game/random';
import { ResourceType } from '../src/game/resource';
import { GameStore } from '../src/game/savegame';
import {
  TRADE_DELAY_BASE,
  TRADE_DELAY_MAX,
  TRADE_DELAY_PER_TILE,
  TRADE_END_DECLINED,
  TRADE_END_EXPIRED,
  TRADE_END_VOID,
  TRADE_MAX_AMOUNT,
  TRADE_MAX_OPEN_OFFERS,
  TRADE_MAX_SHIPMENTS,
  TRADE_OFFER_TICKS,
  TradeRefusal,
  unpackTradeData,
} from '../src/game/trade';
import { executeCommand } from '../src/net/command';
import type { Command } from '../src/net/command';
import { commandTypes, tradeAcceptRefusal, tradeOfferRefusal } from '../src/net/commands';
import { stateHash } from '../src/net/hash';

const longUpdates = Number(process.argv[2] ?? 40000);
const MAP_SEED = '8667715887436237';
const R = ResourceType;

let failed = 0;
let checks = 0;
function check(what: string, ok: boolean): void {
  checks++;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
}

/* The warnings of the integrity check are counted, not printed. */
(Log as unknown as { Warn: (...args: unknown[]) => void }).Warn = () => {};

let integrityRuns = 0;
let integrityProblems = 0;
function integrity(game: Game): number {
  const n = IntegrityCheck.run(game, false);
  integrityRuns++;
  integrityProblems += n;
  return n;
}

const store = GameStore.getInstance();

/* faces: 12 and 13 are people, below 12 computer players. */
function makeGame(faces: number[], trading: boolean, supplies = 40): Game {
  const info = new GameInfo(new Random(MAP_SEED));
  info.removeAllPlayers();
  for (const face of faces) info.addPlayer(face, { red: 0, green: 0, blue: 0 }, 40, supplies, 40);
  info.setDefaultColors();
  info.setRules({ stockPreset: 0, peaceMinutes: 0, busyRoads: false, trading });
  const game = info.instantiate()!;
  game.setRandom(new Random('3183215728814883'));
  return game;
}

function castlePos(game: Game, player: number): number {
  for (const b of game.buildings) {
    if (b.getIndex() !== 0 && b.getType() === BuildingType.TypeCastle && b.getOwner() === player &&
        !b.isBurning()) {
      return b.getPosition();
    }
  }
  return -1;
}

/* The people of a game build their castles: each at the first free place
   that is `apart` places further in the list than the last. */
function buildCastles(game: Game, players: number[]): void {
  const map = game.getMap();
  const size = map.getCols() * map.getRows();
  let from = 0;
  for (const index of players) {
    const player = game.getPlayer(index)!;
    for (let pos = from; pos < size; pos++) {
      if (game.canBuildCastle(pos, player) && game.buildCastle(pos, player)) {
        from = pos + Math.floor(size / 5);
        break;
      }
    }
  }
}

function count(game: Game, player: number, res: ResourceType): number {
  const inv = game.trade.findStock(player, 0);
  return inv === null ? -1 : inv.getCountOf(res);
}

/* All 26 counts of the stock of a player. */
function stock(game: Game, player: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < 26; r++) out.push(count(game, player, r as ResourceType));
  return out;
}

function exec(game: Game, player: number, cmd: Command): void {
  executeCommand(game, player, cmd);
}

function offer(game: Game, from: number, to: number, give: number, giveCount: number,
               want = -1, wantCount = 0, pos = castlePos(game, from)): number {
  const before = game.trade.nextId;
  exec(game, from, { type: 'tradeOffer', pos, to, give, giveCount, want, wantCount });
  return game.trade.nextId !== before ? before : 0;
}

function accept(game: Game, player: number, id: number, pos = castlePos(game, player)): void {
  exec(game, player, { type: 'tradeAccept', id, pos });
}

/* The messages of a player, taken from the queue. */
function messages(game: Game, player: number): Message[] {
  const p = game.getPlayer(player)!;
  const out: Message[] = [];
  while (p.hasNotification()) out.push(p.popNotification());
  return out;
}

function tradeMessages(game: Game, player: number): Message[] {
  return messages(game, player).filter((m) => m.type >= MessageType.TypeTradeOffer &&
                                              m.type <= MessageType.TypeTradeArrived);
}

/* The state of the trade and of every stock, to see that nothing changed. */
function snapshot(game: Game): string {
  const stocks: number[][] = [];
  for (const inv of game.inventories) {
    const row: number[] = [inv.getIndex()];
    for (let r = 0; r < 26; r++) row.push(inv.getCountOf(r as ResourceType));
    stocks.push(row);
  }
  return JSON.stringify([game.trade.nextId, game.trade.offers, game.trade.shipments, stocks]);
}

/* The steps between two map positions, written again here: the larger of
   the two distances when they point the same way, else their sum. */
function steps(game: Game, a: number, b: number): number {
  const map = game.getMap();
  const dx = map.distX(a, b);
  const dy = map.distY(a, b);
  return (dx >= 0) === (dy >= 0) ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.abs(dx) + Math.abs(dy);
}

function expectedDelay(game: Game, a: number, b: number): number {
  return Math.min(TRADE_DELAY_MAX,
                  TRADE_DELAY_BASE + TRADE_DELAY_PER_TILE * steps(game, castlePos(game, a), castlePos(game, b)));
}

/* Update until the game has no shipment; the updates it took. */
function untilArrived(game: Game, limit = 20000): number {
  let n = 0;
  while (game.trade.shipments.length > 0 && n < limit) {
    game.update();
    n++;
  }
  return n;
}

function load(text: string): Game {
  const game = new Game();
  if (!store.read(text, game)) throw new Error('load failed');
  /* A loaded game is paused; this resumes it, as GameManager does. */
  game.pause();
  return game;
}

console.log(`rule: an offer stays ${TRADE_OFFER_TICKS} ticks, ${TRADE_MAX_OPEN_OFFERS} open offers a player, ` +
  `1..${TRADE_MAX_AMOUNT} of a resource, ${TRADE_MAX_SHIPMENTS} shipments in the game, delay ` +
  `min(${TRADE_DELAY_MAX}, ${TRADE_DELAY_BASE} + ${TRADE_DELAY_PER_TILE} * steps) ticks; a computer player keeps ` +
  `${AI_TRADE_KEEP} (${AI_TRADE_KEEP_MATERIAL} of lumber, planks, stone)`);
check('the four trade commands are registered',
  ['tradeOffer', 'tradeAccept', 'tradeDecline', 'tradeCancel'].every((t) => commandTypes.includes(t)));

// ---------------------------------------------------------------------------
console.log('\n1. a gift and a swap between two people');
{
  const game = makeGame([12, 13], true);
  buildCastles(game, [0, 1]);
  /* The same game without a trade, updated as often: the castles make a
     knight now and then, which takes a sword and a shield. What a stock
     holds after a trade must be what it holds there, and the trade. */
  const plain = makeGame([12, 13], true);
  buildCastles(plain, [0, 1]);
  for (let i = 0; i < 200; i++) {
    game.update();
    plain.update();
  }
  const arrive = (): number => {
    const n = untilArrived(game);
    for (let i = 0; i < n; i++) plain.update();
    return n;
  };
  /* The stock of the plain game and what the trades moved. */
  const moved = [new Array<number>(26).fill(0), new Array<number>(26).fill(0)];
  const expected = (player: number): string =>
    stock(plain, player).map((n, r) => n + moved[player][r]).join();
  check('both have a castle and can trade', castlePos(game, 0) >= 0 && castlePos(game, 1) >= 0 &&
    game.trade.canPlayerTrade(0) && game.trade.canPlayerTrade(1) && game.hasTrading());
  messages(game, 0);
  messages(game, 1);
  const delay = expectedDelay(game, 0, 1);
  const gold = game.getGoldTotal();

  // --- the gift
  const a0 = stock(game, 0);
  const b0 = stock(game, 1);
  const id = offer(game, 0, 1, R.TypePlank, 5);
  const told = tradeMessages(game, 1);
  check(`player 0 offers 5 planks as a gift: offer ${id}, nothing has moved, player 1 is told`,
    id === 1 && game.trade.offers.length === 1 && game.trade.offers[0].left === TRADE_OFFER_TICKS &&
    stock(game, 0).join() === a0.join() && told.length === 1 && told[0].type === MessageType.TypeTradeOffer &&
    unpackTradeData(told[0].data).other === 0 && unpackTradeData(told[0].data).res === R.TypePlank &&
    unpackTradeData(told[0].data).count === 5 && unpackTradeData(told[0].data).count2 === 0);
  accept(game, 1, id);
  const s = game.trade.shipments[0];
  check(`player 1 accepts: the planks leave the stock of player 0 at once (${a0[R.TypePlank]} -> ` +
    `${count(game, 0, R.TypePlank)}), one shipment, ${s?.left} ticks for ` +
    `${steps(game, castlePos(game, 0), castlePos(game, 1))} steps`,
    game.trade.offers.length === 0 && game.trade.shipments.length === 1 &&
    count(game, 0, R.TypePlank) === a0[R.TypePlank] - 5 && count(game, 1, R.TypePlank) === b0[R.TypePlank] &&
    s.left === delay && s.delay === delay && s.res === R.TypePlank && s.count === 5 && s.from === 0 && s.to === 1);
  const acceptedMsg = tradeMessages(game, 0);
  check('player 0 is told that the offer was accepted',
    acceptedMsg.length === 1 && acceptedMsg[0].type === MessageType.TypeTradeAccepted &&
    unpackTradeData(acceptedMsg[0].data).other === 1);
  check('integrity with the shipment under way: 0 problems', integrity(game) === 0);
  const speed = game.getSpeed();
  const n = arrive();
  const a1 = stock(game, 0);
  const b1 = stock(game, 1);
  moved[0][R.TypePlank] -= 5;
  moved[1][R.TypePlank] += 5;
  check(`the shipment arrives after ${n} updates (${delay} ticks at speed ${speed}): player 0 has ` +
    `${a1[R.TypePlank]} planks, player 1 has ${b1[R.TypePlank]}, every other count is that of the same ` +
    'game without the trade',
    n === Math.ceil(delay / speed) && a1[R.TypePlank] === a0[R.TypePlank] - 5 &&
    b1[R.TypePlank] === b0[R.TypePlank] + 5 && a1.join() === expected(0) && b1.join() === expected(1));
  const arrived = tradeMessages(game, 1);
  check('player 1 is told where the goods arrived',
    arrived.length === 1 && arrived[0].type === MessageType.TypeTradeArrived &&
    arrived[0].pos === castlePos(game, 1) && unpackTradeData(arrived[0].data).other === 0 &&
    unpackTradeData(arrived[0].data).res === R.TypePlank && unpackTradeData(arrived[0].data).count === 5 &&
    unpackTradeData(arrived[0].data).code === 0);

  // --- the swap
  const id2 = offer(game, 0, 1, R.TypeStone, 4, R.TypeFish, 3);
  check('player 0 offers 4 stone for 3 fish', id2 === 2 && game.trade.offers.length === 1);
  accept(game, 1, id2);
  check('player 1 accepts: both goods leave at once, two shipments',
    game.trade.shipments.length === 2 &&
    count(game, 0, R.TypeStone) === a1[R.TypeStone] - 4 && count(game, 0, R.TypeFish) === a1[R.TypeFish] &&
    count(game, 1, R.TypeFish) === b1[R.TypeFish] - 3 && count(game, 1, R.TypeStone) === b1[R.TypeStone]);
  arrive();
  const a2 = stock(game, 0);
  const b2 = stock(game, 1);
  moved[0][R.TypeStone] -= 4;
  moved[0][R.TypeFish] += 3;
  moved[1][R.TypeStone] += 4;
  moved[1][R.TypeFish] -= 3;
  check(`after the swap player 0 has ${a2[R.TypeStone]} stone and ${a2[R.TypeFish]} fish, player 1 ` +
    `${b2[R.TypeStone]} and ${b2[R.TypeFish]}, every other count as without the trade`,
    a2[R.TypeStone] === a1[R.TypeStone] - 4 && a2[R.TypeFish] === a1[R.TypeFish] + 3 &&
    b2[R.TypeStone] === b1[R.TypeStone] + 4 && b2[R.TypeFish] === b1[R.TypeFish] - 3 &&
    a2.join() === expected(0) && b2.join() === expected(1));
  check('both are told that their goods arrived',
    tradeMessages(game, 0).filter((m) => m.type === MessageType.TypeTradeArrived).length === 1 &&
    tradeMessages(game, 1).filter((m) => m.type === MessageType.TypeTradeArrived).length === 1);

  // --- weapons and gold
  const id3 = offer(game, 1, 0, R.TypeSword, 2, R.TypeGoldBar, 1);
  accept(game, 0, id3);
  check('swords for a gold bar: accepted, the gold of the game is counted as before while it travels',
    id3 === 3 && game.trade.shipments.length === 2 && game.getGoldTotal() === gold);
  arrive();
  moved[0][R.TypeSword] += 2;
  moved[0][R.TypeGoldBar] -= 1;
  moved[1][R.TypeSword] -= 2;
  moved[1][R.TypeGoldBar] += 1;
  check(`they arrive: player 0 has ${count(game, 0, R.TypeSword)} swords and ${count(game, 0, R.TypeGoldBar)} ` +
    `gold bars, player 1 ${count(game, 1, R.TypeSword)} and ${count(game, 1, R.TypeGoldBar)}; the gold of the ` +
    'game is still the same',
    stock(game, 0).join() === expected(0) && stock(game, 1).join() === expected(1) &&
    count(game, 0, R.TypeGoldBar) === a2[R.TypeGoldBar] - 1 &&
    count(game, 1, R.TypeGoldBar) === b2[R.TypeGoldBar] + 1 && game.getGoldTotal() === gold &&
    stateHash(game) !== stateHash(plain));
  check('integrity after the trades: 0 problems', integrity(game) === 0);
}

// ---------------------------------------------------------------------------
console.log('\n2. what is refused');
{
  // --- the option is off
  const off = makeGame([12, 13], false);
  buildCastles(off, [0, 1]);
  for (let i = 0; i < 50; i++) off.update();
  const offBefore = snapshot(off);
  const offHash = stateHash(off);
  offer(off, 0, 1, R.TypePlank, 5);
  off.trade.offers.push({ id: 7, from: 0, to: 1, inv: 0, give: R.TypePlank, giveCount: 5, want: -1, wantCount: 0, left: 100 });
  accept(off, 1, 7);
  exec(off, 1, { type: 'tradeDecline', id: 7 });
  exec(off, 0, { type: 'tradeCancel', id: 7 });
  const planted = off.trade.offers.length === 1;
  off.trade.offers.length = 0;
  check('in a game without the option the four commands do nothing (even on an offer put there by hand)',
    planted && snapshot(off) === offBefore && stateHash(off) === offHash &&
    tradeOfferRefusal(off, off.getPlayer(0)!, castlePos(off, 0), 1, R.TypePlank, 5, -1, 0) === TradeRefusal.Off &&
    tradeMessages(off, 1).length === 0);

  // --- three people, the option on
  const game = makeGame([12, 13, 13], true);
  buildCastles(game, [0, 1, 2]);
  for (let i = 0; i < 50; i++) game.update();
  const p0 = game.getPlayer(0)!;
  const c0 = castlePos(game, 0);
  const planks = count(game, 0, R.TypePlank);
  const refusal = (to: unknown, give: unknown, giveCount: unknown, want: unknown, wantCount: unknown,
                   pos = c0): TradeRefusal =>
    game.trade.offerRefusal(p0, pos, to, give, giveCount, want, wantCount);
  let before = snapshot(game);
  const nothing = (what: string, cmds: Command[], player = 0, why = true): void => {
    for (const cmd of cmds) exec(game, player, cmd);
    check(`${what}: nothing happens`, snapshot(game) === before && why);
  };
  const o = (changes: Partial<Command>): Command =>
    ({ type: 'tradeOffer', pos: c0, to: 1, give: R.TypePlank, giveCount: 5, want: -1, wantCount: 0, ...changes });

  nothing('an offer to oneself', [o({ to: 0 })], 0, refusal(0, R.TypePlank, 5, -1, 0) === TradeRefusal.Player);
  nothing('an offer to a player who is not in the game', [o({ to: 3 }), o({ to: 4 }), o({ to: -1 }), o({ to: 1.5 })], 0,
    refusal(3, R.TypePlank, 5, -1, 0) === TradeRefusal.Player);
  nothing(`more than the stock holds (${planks} planks, ${TRADE_MAX_AMOUNT} is the most of an offer)`,
    [o({ giveCount: planks + 1 }), o({ giveCount: TRADE_MAX_AMOUNT + 1 }), o({ give: R.TypeBoat, giveCount: 100 })], 0,
    count(game, 0, R.TypeBoat) < 100 && refusal(1, R.TypeBoat, 100, -1, 0) === TradeRefusal.NotEnough &&
    refusal(1, R.TypePlank, TRADE_MAX_AMOUNT + 1, -1, 0) === TradeRefusal.Amount);
  nothing('an amount of 0, a negative one, one that is not an integer or not a number',
    [o({ giveCount: 0 }), o({ giveCount: -3 }), o({ giveCount: 2.5 }), o({ giveCount: '5' }),
      o({ giveCount: NaN }), o({ giveCount: Infinity }),
      o({ want: R.TypeStone, wantCount: -1 }), o({ want: R.TypeStone, wantCount: 1.5 }),
      o({ want: R.TypeStone, wantCount: TRADE_MAX_AMOUNT + 1 }), o({ want: R.TypeStone, wantCount: true })], 0,
    refusal(1, R.TypePlank, 0, -1, 0) === TradeRefusal.Amount &&
    refusal(1, R.TypePlank, -3, -1, 0) === TradeRefusal.Amount &&
    refusal(1, R.TypePlank, 2.5, -1, 0) === TradeRefusal.Amount &&
    refusal(1, R.TypePlank, 5, R.TypeStone, -1) === TradeRefusal.Amount);
  nothing('a resource that does not exist, the same resource both ways, a gift that names a resource, ' +
    'a swap that names none',
    [o({ give: 26 }), o({ give: -1 }), o({ give: 27 }), o({ give: 3.5 }), o({ give: 'plank' }),
      o({ want: 26, wantCount: 2 }), o({ want: R.TypePlank, wantCount: 2 }), o({ want: R.TypeStone, wantCount: 0 }),
      o({ want: -1, wantCount: 2 }), o({ want: -2, wantCount: 0 })], 0,
    refusal(1, 26, 5, -1, 0) === TradeRefusal.Resource && refusal(1, R.GroupFood, 5, -1, 0) === TradeRefusal.Resource &&
    refusal(1, R.TypePlank, 5, R.TypePlank, 2) === TradeRefusal.Resource &&
    refusal(1, R.TypePlank, 5, -1, 2) === TradeRefusal.Resource);
  nothing('a place that is not a stock of the player',
    [o({ pos: castlePos(game, 1) }), o({ pos: -1 }), o({ pos: 1 << 30 }), o({ pos: c0 + 1 }), o({ pos: 0.5 })], 0,
    refusal(1, R.TypePlank, 5, -1, 0, castlePos(game, 1)) === TradeRefusal.Stock);
  nothing('a command without its arguments', [{ type: 'tradeOffer' }, { type: 'tradeAccept' },
    { type: 'tradeDecline' }, { type: 'tradeCancel' }]);

  // --- too many open offers
  const ids: number[] = [];
  for (let i = 0; i < TRADE_MAX_OPEN_OFFERS + 2; i++) ids.push(offer(game, 0, 1 + (i & 1), R.TypePlank, 1 + i));
  check(`${TRADE_MAX_OPEN_OFFERS} offers are open; the next two are refused (ids ${ids.join(' ')})`,
    game.trade.offers.length === TRADE_MAX_OPEN_OFFERS &&
    ids.slice(0, TRADE_MAX_OPEN_OFFERS).join() === '1,2,3,4' && ids[4] === 0 && ids[5] === 0 &&
    refusal(1, R.TypePlank, 1, -1, 0) === TradeRefusal.TooMany);
  check('another player still can make one', offer(game, 1, 0, R.TypeStone, 2, R.TypePlank, 2) === 5);

  // --- the wrong player answers: offer 1 is from player 0 to player 1
  before = snapshot(game);
  nothing('the player who made the offer accepts it himself', [{ type: 'tradeAccept', id: 1, pos: c0 }], 0,
    tradeAcceptRefusal(game, p0, 1, c0) === TradeRefusal.NoOffer);
  nothing('a third player accepts or declines the offer of somebody else',
    [{ type: 'tradeAccept', id: 1, pos: castlePos(game, 2) }, { type: 'tradeDecline', id: 1 }], 2);
  nothing('a player who did not make the offer cancels it', [{ type: 'tradeCancel', id: 1 }], 1);
  nothing('a player who did not make the offer cancels it (the third)', [{ type: 'tradeCancel', id: 1 }], 2);
  nothing('the player who made the offer declines it', [{ type: 'tradeDecline', id: 1 }], 0);
  nothing('accepting with a place that is not an own stock',
    [{ type: 'tradeAccept', id: 1, pos: c0 }, { type: 'tradeAccept', id: 1, pos: -4 },
      { type: 'tradeAccept', id: 1, pos: castlePos(game, 2) }], 1);
  nothing('an offer that does not exist, or an id that is not one',
    [{ type: 'tradeAccept', id: 99, pos: castlePos(game, 1) }, { type: 'tradeAccept', id: 0, pos: castlePos(game, 1) },
      { type: 'tradeAccept', id: 1.5, pos: castlePos(game, 1) }, { type: 'tradeDecline', id: -1 },
      { type: 'tradeCancel', id: '1' }], 1);
  nothing('a player who is not in the game', [{ type: 'tradeAccept', id: 1, pos: castlePos(game, 1) }], 3);

  // --- accepting twice
  accept(game, 1, 1);
  const once = snapshot(game);
  accept(game, 1, 1);
  exec(game, 1, { type: 'tradeDecline', id: 1 });
  exec(game, 0, { type: 'tradeCancel', id: 1 });
  check('offer 1 is accepted once; accepting again, declining or cancelling it then does nothing',
    game.trade.shipments.length === 1 && snapshot(game) === once && game.trade.getOffer(1) === null);

  // --- the goods are gone when the offer is accepted
  const offer3 = game.trade.getOffer(3)!; /* 3 planks to player 1 */
  const inv0 = game.trade.findStock(0, 0)!;
  const kept = inv0.getCountOf(R.TypePlank);
  inv0.setCountOf(R.TypePlank, 2);
  before = snapshot(game);
  nothing('the sender no longer has the goods when the offer is accepted (the offer stays)',
    [{ type: 'tradeAccept', id: 3, pos: castlePos(game, 1) }], 1,
    offer3.giveCount === 3 &&
    tradeAcceptRefusal(game, game.getPlayer(1)!, 3, castlePos(game, 1)) === TradeRefusal.PartnerGoods);
  inv0.setCountOf(R.TypePlank, kept);
  /* Offer 5: player 1 gives 2 stone for 2 planks of player 0. */
  inv0.setCountOf(R.TypePlank, 1);
  before = snapshot(game);
  nothing('the player who accepts has not got what is asked', [{ type: 'tradeAccept', id: 5, pos: c0 }], 0,
    tradeAcceptRefusal(game, p0, 5, c0) === TradeRefusal.NotEnough);
  inv0.setCountOf(R.TypePlank, kept);
  let top = 0;
  for (const inv of game.inventories) {
    for (let r = 0; r < 26; r++) top = Math.max(top, inv.getCountOf(r as ResourceType));
  }
  /* A count below 0 would read as a number over 4 000 000 000. */
  check(`no count went below 0 (the highest count of a stock is ${top})`, top <= 50000);

  // --- decline and cancel by the right players
  messages(game, 0);
  exec(game, 1, { type: 'tradeDecline', id: 3 });
  const declined = tradeMessages(game, 0);
  check('player 1 declines offer 3: it is gone and player 0 is told',
    game.trade.getOffer(3) === null && declined.length === 1 && declined[0].type === MessageType.TypeTradeDeclined &&
    unpackTradeData(declined[0].data).code === TRADE_END_DECLINED && unpackTradeData(declined[0].data).other === 1);
  exec(game, 0, { type: 'tradeCancel', id: 2 });
  check('player 0 cancels offer 2: it is gone, and a place for a new offer is free',
    game.trade.getOffer(2) === null && offer(game, 0, 2, R.TypeStone, 1) === 6);

  // --- too many shipments
  const real = game.trade.shipments.slice();
  while (game.trade.shipments.length < TRADE_MAX_SHIPMENTS - 1) game.trade.shipments.push({ ...real[0] });
  before = snapshot(game);
  nothing(`${TRADE_MAX_SHIPMENTS - 1} shipments are under way: no offer is accepted`,
    [{ type: 'tradeAccept', id: 5, pos: c0 }], 0, tradeAcceptRefusal(game, p0, 5, c0) === TradeRefusal.Busy);
  game.trade.shipments.length = 0;
  game.trade.shipments.push(...real);
  check('integrity: 0 problems', integrity(game) === 0);
}

// ---------------------------------------------------------------------------
console.log('\n3. an offer expires');
{
  const game = makeGame([12, 13], true);
  buildCastles(game, [0, 1]);
  for (let i = 0; i < 50; i++) game.update();
  messages(game, 0);
  const id = offer(game, 0, 1, R.TypePlank, 5, R.TypeStone, 5);
  const speed = game.getSpeed();
  const need = Math.ceil(TRADE_OFFER_TICKS / speed);
  for (let i = 0; i < need - 1; i++) game.update();
  const last = game.trade.getOffer(id);
  check(`after ${need - 1} updates at speed ${speed} the offer is still open, ${last?.left} ticks left`,
    last !== null && last.left === TRADE_OFFER_TICKS - (need - 1) * speed);
  game.pause();
  for (let i = 0; i < 100; i++) game.update();
  check('it does not expire while the game is paused', game.trade.getOffer(id) !== null);
  game.pause();
  game.update();
  const told = tradeMessages(game, 0);
  check(`one update later it is gone (${TRADE_OFFER_TICKS} ticks) and player 0 is told that it expired`,
    game.trade.getOffer(id) === null && told.length === 1 && told[0].type === MessageType.TypeTradeDeclined &&
    unpackTradeData(told[0].data).code === TRADE_END_EXPIRED);
  const before = snapshot(game);
  accept(game, 1, id);
  check('accepting the expired offer does nothing', snapshot(game) === before);
  check('integrity: 0 problems', integrity(game) === 0);
}

// ---------------------------------------------------------------------------
console.log('\n4. a player without a stock');
{
  const game = makeGame([12, 13, 13], true);
  buildCastles(game, [0, 1, 2]);
  /* A castle counts as fallen only once it was finished (as in
     tools/teams-test.ts). */
  let built = 0;
  while (built < 20000 && ![0, 1, 2].every((p) => game.getBuildingAtPos(castlePos(game, p))!.isDone())) {
    game.update();
    built++;
  }
  check(`the three castles are finished after ${built} updates`, built < 20000);
  const a0 = stock(game, 0);
  const gold = game.getGoldTotal();

  /* Under way to player 1: planks and a gold bar. Open: one offer each way,
     and one between the two others. */
  accept(game, 1, offer(game, 0, 1, R.TypePlank, 7));
  accept(game, 1, offer(game, 0, 1, R.TypeGoldBar, 2));
  const toB = offer(game, 0, 1, R.TypeStone, 1);
  const fromB = offer(game, 1, 0, R.TypeStone, 1);
  const other = offer(game, 0, 2, R.TypeStone, 1);
  const delay = game.trade.shipments[0].delay;
  messages(game, 0);
  check('two shipments are under way to player 1, three offers are open',
    game.trade.shipments.length === 2 && game.trade.offers.length === 3 &&
    count(game, 0, R.TypePlank) === a0[R.TypePlank] - 7);

  game.demolishBuilding_(castlePos(game, 1));
  game.update();
  const told = tradeMessages(game, 0);
  check('the castle of player 1 falls: he cannot trade, his offer and the offer to him are cancelled, ' +
    'the offer between the two others stays, player 0 is told',
    !game.trade.canPlayerTrade(1) && game.getPlayer(1)!.isDefeated() &&
    game.trade.getOffer(toB) === null && game.trade.getOffer(fromB) === null && game.trade.getOffer(other) !== null &&
    told.length === 1 && told[0].type === MessageType.TypeTradeDeclined &&
    unpackTradeData(told[0].data).code === TRADE_END_VOID);
  check('nobody can make him an offer now', offer(game, 0, 1, R.TypeStone, 1) === 0 &&
    offer(game, 1, 0, R.TypeStone, 1) === 0);

  const speed = game.getSpeed();
  let n = 1;
  while (!game.trade.shipments[0].back && n < 20000) {
    game.update();
    n++;
  }
  check(`after ${n} updates the shipments find no stock of player 1 and turn back (${delay} ticks again)`,
    n === Math.ceil(delay / speed) && game.trade.shipments.length === 2 &&
    game.trade.shipments.every((s) => s.back && s.left === delay) && game.getGoldTotal() === gold);
  check('integrity with shipments on the way back: 0 problems', integrity(game) === 0);
  const m = untilArrived(game);
  const back = tradeMessages(game, 0).filter((msg) => msg.type === MessageType.TypeTradeArrived);
  check(`${m} updates later they are back: player 0 has ${count(game, 0, R.TypePlank)} planks and ` +
    `${count(game, 0, R.TypeGoldBar)} gold bars again and is told so`,
    m === Math.ceil(delay / speed) && count(game, 0, R.TypePlank) === a0[R.TypePlank] &&
    count(game, 0, R.TypeGoldBar) === a0[R.TypeGoldBar] && game.getGoldTotal() === gold &&
    back.length === 2 && back.every((msg) => unpackTradeData(msg.data).code === 1 &&
                                             unpackTradeData(msg.data).other === 1 &&
                                             msg.pos === castlePos(game, 0)));

  /* Neither has a stock: the goods are lost. */
  accept(game, 2, offer(game, 0, 2, R.TypeGoldBar, 2));
  accept(game, 2, offer(game, 0, 2, R.TypePlank, 3));
  const goldNow = game.getGoldTotal();
  const inCastle0 = count(game, 0, R.TypeGoldBar) + count(game, 0, R.TypeGoldOre);
  const inCastle2 = count(game, 2, R.TypeGoldBar) + count(game, 2, R.TypeGoldOre);
  game.demolishBuilding_(castlePos(game, 2));
  game.demolishBuilding_(castlePos(game, 0));
  const goldAfterFall = game.getGoldTotal();
  const k = untilArrived(game);
  check(`both castles fall: the shipments turn back, find no stock and are lost after ${k} updates; ` +
    `the 2 gold bars leave the gold of the game (${goldAfterFall} -> ${game.getGoldTotal()})`,
    game.trade.shipments.length === 0 && game.trade.offers.length === 0 &&
    game.getGoldTotal() === goldAfterFall - 2 && goldNow === gold && inCastle0 >= 0 && inCastle2 >= 0);
  check('integrity: 0 problems', integrity(game) === 0);
}

// ---------------------------------------------------------------------------
console.log('\n5. a computer player answers');
{
  const N = R.TypeNone;
  check('the policy: never a weapon or a tool, not more than twice what it gets, only from a clear surplus',
    !tradeSwapAccepted(R.TypeSword, 1, 50, 1000) && !tradeSwapAccepted(R.TypeShield, 1, 50, 1000) &&
    !tradeSwapAccepted(R.TypeShovel, 1, 50, 1000) && !tradeSwapAccepted(R.TypePincer, 1, 50, 1000) &&
    !tradeSwapAccepted(R.TypeHammer, 1, 50, 1000) &&
    tradeSwapAccepted(R.TypeFish, 10, 5, 1000) && !tradeSwapAccepted(R.TypeFish, 11, 5, 1000) &&
    tradeSwapAccepted(R.TypeFish, 5, 5, 2 * 5 + AI_TRADE_KEEP) &&
    !tradeSwapAccepted(R.TypeFish, 5, 5, 2 * 5 + AI_TRADE_KEEP - 1) &&
    tradeSwapAccepted(R.TypePlank, 5, 5, 2 * 5 + AI_TRADE_KEEP_MATERIAL) &&
    !tradeSwapAccepted(R.TypePlank, 5, 5, 2 * 5 + AI_TRADE_KEEP_MATERIAL - 1) &&
    !tradeSwapAccepted(R.TypeStone, 5, 5, 39) && !tradeSwapAccepted(R.TypeLumber, 5, 5, 39) &&
    tradeSwapAccepted(R.TypeGoldBar, 1, 1, 12) && N === -1);

  /* Player 0 is a person, player 1 a computer player. */
  const game = makeGame([12, 9], true);
  buildCastles(game, [0]);
  let waited = 0;
  while ((castlePos(game, 1) < 0 || game.getPlayer(1)!.ai.phase !== 2) && waited < 30000) {
    game.update();
    waited++;
  }
  check(`the computer player has its castle after ${waited} updates`, game.trade.canPlayerTrade(1));
  messages(game, 0);

  /* What the computer player holds of a resource in its best stock. */
  const best = (res: ResourceType): number => {
    let have = 0;
    for (const inv of game.getPlayerInventories(game.getPlayer(1)!)) have = Math.max(have, inv.getCountOf(res));
    return have;
  };
  /* Make the offer and update until the computer player has answered:
     what it held when it did, and what it said. */
  const ask = (give: ResourceType, giveCount: number, want: ResourceType, wantCount: number):
      { answer: string; have: number; updates: number } => {
    const id = offer(game, 0, 1, give, giveCount, want, wantCount);
    if (id === 0) return { answer: 'not made', have: -1, updates: 0 };
    let have = want === R.TypeNone ? 0 : best(want);
    let updates = 0;
    while (game.trade.getOffer(id) !== null && updates < 3000) {
      have = want === R.TypeNone ? 0 : best(want);
      game.update();
      updates++;
    }
    const told = tradeMessages(game, 0).filter((m) => m.type !== MessageType.TypeTradeArrived);
    let answer = 'none';
    if (told.length === 1 && told[0].type === MessageType.TypeTradeAccepted) answer = 'accepted';
    if (told.length === 1 && told[0].type === MessageType.TypeTradeDeclined) {
      answer = ['declined', 'expired', 'void'][unpackTradeData(told[0].data).code];
    }
    return { answer, have, updates };
  };

  const before = count(game, 1, R.TypePlank);
  const mine = count(game, 0, R.TypePlank);
  const gift = ask(R.TypePlank, 6, R.TypeNone, 0);
  check(`a gift of 6 planks: ${gift.answer} after ${gift.updates} updates`,
    gift.answer === 'accepted' && count(game, 0, R.TypePlank) === mine - 6 && game.trade.shipments.length === 1);
  const made = game.trade.nextId;
  const took = untilArrived(game);
  for (let i = 0; i < 2000; i++) game.update();
  check('the computer player makes no offer itself', game.trade.nextId === made);
  check(`the gift arrived after ${took} updates (its planks ${before} -> ${count(game, 1, R.TypePlank)}, ` +
    'less what it built with)', game.trade.shipments.length === 0);

  const probes: [string, ResourceType, number, ResourceType, number][] = [
    ['5 stone for 5 fish', R.TypeStone, 5, R.TypeFish, 5],
    ['5 stone for 3 bread', R.TypeStone, 5, R.TypeBread, 3],
    ['20 fish for 1 sword', R.TypeFish, 20, R.TypeSword, 1],
    ['20 fish for 1 shield', R.TypeFish, 20, R.TypeShield, 1],
    ['20 fish for 1 hammer', R.TypeFish, 20, R.TypeHammer, 1],
    ['20 fish for 1 pick', R.TypeFish, 20, R.TypePick, 1],
    ['1 stone for 3 fish (more than twice)', R.TypeStone, 1, R.TypeFish, 3],
    ['30 stone for 30 wheat (no surplus)', R.TypeStone, 30, R.TypeWheat, 30],
    ['10 fish for 10 planks', R.TypeFish, 10, R.TypePlank, 10],
    ['20 fish for 40 stone', R.TypeFish, 20, R.TypeStone, 40],
  ];
  let accepted = 0;
  let declined = 0;
  for (const [what, give, giveCount, want, wantCount] of probes) {
    const stockBefore = count(game, 0, want);
    const r = ask(give, giveCount, want, wantCount);
    const expected = tradeSwapAccepted(want, wantCount, giveCount, r.have) ? 'accepted' : 'declined';
    if (r.answer === 'accepted') accepted++;
    if (r.answer === 'declined') declined++;
    check(`${what}: it holds ${r.have}, ${r.answer} after ${r.updates} updates`, r.answer === expected);
    untilArrived(game);
    if (r.answer === 'accepted') {
      check(`  player 0 got ${wantCount} more`, count(game, 0, want) === stockBefore + wantCount);
    }
  }
  check(`the probes had both answers (${accepted} accepted, ${declined} declined)`, accepted >= 3 && declined >= 5);
  check('integrity: 0 problems', integrity(game) === 0);
}

// ---------------------------------------------------------------------------
console.log('\n6. the save');
{
  const game = makeGame([12, 13, 9], true);
  buildCastles(game, [0, 1]);
  for (let i = 0; i < 3000; i++) game.update();
  accept(game, 1, offer(game, 0, 1, R.TypePlank, 9, R.TypeFish, 2));
  for (let i = 0; i < 100; i++) game.update();
  const open = offer(game, 1, 0, R.TypeStone, 3, R.TypeCoal, 1);
  for (let i = 0; i < 20; i++) game.update();
  check('the game has an open offer and two shipments under way',
    game.trade.offers.length === 1 && game.trade.shipments.length === 2 && open > 0);

  const text = store.write(game);
  const lines = text.split('\n');
  const sections = lines.filter((line) => /^\[trade_/.test(line)).map((line) => line.trim());
  const values = lines.filter((line) => /^\s*(trading|trade_next_id)\s*=/.test(line)).map((line) => line.trim());
  check(`the file has them (${values.join(', ')}; ${sections.join(' ')})`,
    values.length === 2 && sections.length === 3);
  const a = load(text);
  const b = load(text);
  check('the round trip gives the same file', store.write(a) === text);
  check('the loaded game has the offer and the shipments, and the same hash as the original',
    a.getRules().trading && JSON.stringify(a.trade.offers) === JSON.stringify(game.trade.offers) &&
    JSON.stringify(a.trade.shipments) === JSON.stringify(game.trade.shipments) &&
    a.trade.nextId === game.trade.nextId && stateHash(a) === stateHash(game));
  check('integrity of the loaded game: 0 problems', integrity(a) === 0);

  const planks = count(a, 1, R.TypePlank);
  const fish = count(a, 0, R.TypeFish);
  let equal = true;
  let original = true;
  let n = 0;
  while (a.trade.shipments.length > 0 && n < 20000) {
    game.update();
    a.update();
    b.update();
    n++;
    if (stateHash(a) !== stateHash(b)) equal = false;
    if (stateHash(a) !== stateHash(game)) original = false;
  }
  check(`the shipments arrive in the loaded game after ${n} updates: player 1 has 9 planks more, player 0 2 fish more`,
    count(a, 1, R.TypePlank) === planks + 9 && count(a, 0, R.TypeFish) === fish + 2);
  accept(a, 0, open);
  accept(b, 0, open);
  accept(game, 0, open);
  for (let i = 0; i < 3000; i++) {
    game.update();
    a.update();
    b.update();
    if (stateHash(a) !== stateHash(b)) equal = false;
    if (stateHash(a) !== stateHash(game)) original = false;
  }
  check('the open offer is accepted in the loaded games; the two loads stay equal all the way', equal &&
    a.trade.offers.length === 0 && a.trade.shipments.length === 0);
  check('and equal to the game that was never saved', original);
  check('integrity: 0 problems', integrity(a) === 0 && integrity(game) === 0);

  /* The same file as a build without the rule wrote it. */
  let skip = false;
  const old = lines.filter((line) => {
    if (line.startsWith('[')) skip = /^\[trade_/.test(line);
    return !skip && !/^\s*(trading|trade_next_id)\s*=/.test(line);
  }).join('\n');
  const older = load(old);
  check('a file without the values loads with the rule off and nothing under way',
    !older.getRules().trading && older.trade.isEmpty() && integrity(older) === 0);

  /* Values the rule could not have made: dropped when the game is loaded. */
  const bad = text.replace(/(\[trade_shipment 0\][^[]*?resource\s*=\s*)\d+,\d+/, '$126,5000')
    .replace(/(\[trade_offer 0\][^[]*?to\s*=\s*)\d+/, '$17');
  const fixed = load(bad);
  check('a file with a shipment of 5000 of resource 26 and an offer to player 7 loads without them',
    bad !== text && fixed.trade.shipments.length === 1 && fixed.trade.offers.length === 0 &&
    integrity(fixed) === 0);
}

// ---------------------------------------------------------------------------
console.log(`\n7. four computer players, ${longUpdates} updates, scripted offers, twice`);
{
  const run = (): { hashes: number[]; made: number; accepted: number; declined: number; problems: number;
                    top: number } => {
    const game = makeGame([9, 7, 5, 2], true);
    const hashes: number[] = [];
    let accepted = 0;
    let declined = 0;
    let problems = 0;
    let top = 0;
    for (let i = 1; i <= longUpdates; i++) {
      game.update();
      if (i % 250 === 0) {
        /* A scripted offer in the name of a computer player: who, what and
           how much come from the update count. */
        const k = i / 250;
        const from = k & 3;
        const to = (from + 1 + (k >> 2) % 3) & 3;
        const give = (k * 7) % 26;
        const gift = k % 3 === 0;
        const pos = castlePos(game, from);
        if (pos >= 0) {
          exec(game, from, {
            type: 'tradeOffer', pos, to, give, giveCount: 1 + (k % 5),
            want: gift ? -1 : (k * 11 + 3) % 26, wantCount: gift ? 0 : 1 + (k % 4),
          });
        }
        if (k % 9 === 0 && game.trade.offers.length > 0) {
          exec(game, game.trade.offers[0].from, { type: 'tradeCancel', id: game.trade.offers[0].id });
        }
      }
      for (let p = 0; p < 4; p++) {
        for (const m of messages(game, p)) {
          if (m.type === MessageType.TypeTradeAccepted) accepted++;
          if (m.type === MessageType.TypeTradeDeclined) declined++;
        }
      }
      if (i % 2000 === 0) {
        hashes.push(stateHash(game));
        problems += integrity(game);
        for (const inv of game.inventories) {
          for (let r = 0; r < 26; r++) top = Math.max(top, inv.getCountOf(r as ResourceType));
        }
      }
    }
    return { hashes, made: game.trade.nextId - 1, accepted, declined, problems, top };
  };
  const a = run();
  const b = run();
  check(`first run: ${a.made} offers made, ${a.accepted} accepted, ${a.declined} declined, expired or void; ` +
    `last hash ${a.hashes[a.hashes.length - 1].toString(16)}`, a.made > 20 && a.accepted > 5 && a.declined > 5);
  check('the second run has the same hash at every checkpoint and the same counts',
    a.hashes.join() === b.hashes.join() && a.made === b.made && a.accepted === b.accepted &&
    a.declined === b.declined);
  check(`integrity at ${a.hashes.length} checkpoints: ${a.problems} problems`, a.problems === 0 && b.problems === 0);
  check(`no count of a stock is out of range (the highest is ${a.top})`, a.top <= 50000);
}

console.log(`\nintegrity: ${integrityRuns} runs, ${integrityProblems} problems`);
check('zero integrity problems in all runs', integrityProblems === 0);
console.log(failed === 0 ? `\nPASSED: ${checks} checks` : `\n${failed} of ${checks} FAILED`);
process.exit(failed === 0 ? 0 : 1);
