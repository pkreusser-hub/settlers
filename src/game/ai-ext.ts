// EXT: smarter computer players (GameRules.aiLevel). Not part of Freeserf.
//
// At AI_LEVEL_ORIGINAL nothing here runs: the computer players are the
// port of the original. At AI_LEVEL_IMPROVED they also use the rules the
// port added, on top of what the original does:
//   - upgradeBorder():   upgrades in place (Game.upgradeBuilding);
//   - capProducers():    output caps and the pause (Building.extCap,
//                        extPaused);
//   - posture():         the garrisons at the end of a peace, Hold and the
//                        rally point (Building.extStance, Player.extRally);
//   - attackKnights():   the attack forecast of knights.ts decides whether
//                        an attack starts and how many knights go;
//   - proposeTrade():    trade offers (Game.trade);
//   - planBuild():       the materials chain first and a budget for every
//                        building started (ai-core.ts wantAndBuild).
// ai-core.ts calls afterStep() after the management step of the original;
// ai-manage.ts calls attackKnights() where the original counts its knights.
//
// Rules of this file:
//   - Integers only, no clock, no random number of its own. Buildings and
//     inventories are walked in index order, players 0 to 3.
//   - It keeps no memory. Every decision is made from the state of the game
//     at that step; where a decision needs a "before" (a cap that is set, a
//     building on Hold, the rally point) it reads the very state it sets,
//     which is saved and hashed already.
//   - Every action makes the checks of the command a person would give
//     (net/commands.ts: setBuildingCap, setBuildingPaused, upgradeBuilding,
//     setBuildingStance, setRallyPoint, clearRallyPoint,
//     changeKnightOccupation, tradeOffer) and then calls the same method of
//     the game. The functions named act*() below are those actions.

import { AI_GAME, PLAYER_NUM } from './ai-internal';
import type { Building } from './building';
import {
  BuildingStance, BuildingType, UpgradeRefusal, constInfo, fullGarrison, isProductionBuilding,
  productionCapSteps, productionOutput, upgradeCost, upgradeTarget,
} from './building';
import { attackForce, forecastAttack } from './knights';
import { idiv } from './misc';
import type { Player } from './player';
import { ResourceType } from './resource';
import { TradeRefusal } from './trade';

// ---------------------------------------------------------------------------
// The numbers.

/* Upgrades: what the stocks of the player keep beyond the cost of the
   upgrade. */
export const AI_UPGRADE_PLANK_RESERVE = 20;
export const AI_UPGRADE_STONE_RESERVE = 15;

/* TICKS_PER_MINUTE of game.ts, as a number: a constant of this file may
   not read another game module while the modules load. */
const kTicksPerMinute = 6000;

/* Peace: with this many ticks of it left (two minutes) the border
   buildings are filled. */
export const AI_PEACE_FILL_TICKS = 2 * kTicksPerMinute;

/* Attack: it starts when the forecast of all knights that would go is at
   least AI_ATTACK_MIN_CHANCE of 1000, and sends the fewest knights whose
   forecast reaches AI_ATTACK_GOOD_CHANCE (all of them if none does). */
export const AI_ATTACK_MIN_CHANCE = 600;
export const AI_ATTACK_GOOD_CHANCE = 750;

/* Hold and rally point: enemy buildings count up to this many tiles from a
   border building; at most AI_HOLD_MAX buildings are on Hold. */
export const AI_THREAT_RANGE = 16;
export const AI_HOLD_MAX = 2;

/* Trade: an offer gives AI_TRADE_GIVE for AI_TRADE_WANT (3 for 2), of a
   resource the player holds less than AI_TRADE_SHORT of. What it gives
   comes from one stock that keeps AI_TRADE_KEEP (AI_TRADE_KEEP_MATERIAL of
   planks and stone) and as much again as it gives. A computer player makes
   offers only in one minute out of AI_TRADE_PERIOD_MINUTES, its own. */
export const AI_TRADE_GIVE = 6;
export const AI_TRADE_WANT = 4;
export const AI_TRADE_SHORT = 5;
export const AI_TRADE_KEEP = 10;
export const AI_TRADE_KEEP_MATERIAL = 30;
export const AI_TRADE_PERIOD_MINUTES = 4;

/* The output caps: the buildings of a type get the cap when the stocks of
   the player hold `cap` of the output or more, and lose it when they hold
   less than `lift` (half of it). The cap stops the work only while the
   stocks hold `cap` or more, so a capped building works again long before
   the goods run short: construction and the weaponsmith are never starved
   by it. Gold ore and gold bars (morale) have no cap. Every cap is one of
   productionCapSteps. */
export interface AICap { type: BuildingType; cap: number; lift: number }

let caps: AICap[] | null = null;
/* Built on the first call, so that loading this module does not touch the
   exports of building.ts. */
export function aiCaps(): AICap[] {
  if (caps === null) {
    caps = [
      { type: BuildingType.TypeLumberjack, cap: 20, lift: 10 },
      { type: BuildingType.TypeSawmill, cap: 100, lift: 50 },
      { type: BuildingType.TypeStonecutter, cap: 50, lift: 25 },
      { type: BuildingType.TypeStoneMine, cap: 50, lift: 25 },
      { type: BuildingType.TypeCoalMine, cap: 100, lift: 50 },
      { type: BuildingType.TypeIronMine, cap: 100, lift: 50 },
      { type: BuildingType.TypeSteelSmelter, cap: 100, lift: 50 },
      { type: BuildingType.TypeFisher, cap: 50, lift: 25 },
      { type: BuildingType.TypeButcher, cap: 50, lift: 25 },
      { type: BuildingType.TypeBaker, cap: 50, lift: 25 },
      { type: BuildingType.TypeFarm, cap: 50, lift: 25 },
      { type: BuildingType.TypeMill, cap: 20, lift: 10 },
      { type: BuildingType.TypePigFarm, cap: 20, lift: 10 },
      { type: BuildingType.TypeBoatbuilder, cap: 10, lift: 5 },
    ];
  }
  return caps;
}

// ---------------------------------------------------------------------------
// Reading.

export function isImproved(player: Player): boolean {
  return AI_GAME().getAiLevelOf(PLAYER_NUM(player)) >= 1;
}

/* The finished buildings of the player that stand, in index order. */
function ownBuildings(player: Player): Building[] {
  const out: Building[] = [];
  for (const b of AI_GAME().buildings) {
    if (b.getIndex() === 0 || b.getOwner() !== PLAYER_NUM(player)) continue;
    if (!b.isDone() || b.isBurning()) continue;
    out.push(b);
  }
  return out;
}

function isGuardType(type: BuildingType): boolean {
  return type === BuildingType.TypeHut || type === BuildingType.TypeTower ||
         type === BuildingType.TypeFortress;
}

/* The guard huts, towers and fortresses of the player next to the land of
   an enemy: threat level 3, which the land of an ally does not give
   (Building.updateMilitaryFlagState). */
function borderBuildings(player: Player): Building[] {
  return ownBuildings(player).filter((b) =>
    isGuardType(b.getType()) && b.isActive() && b.getThreatLevel() === 3);
}

interface Front {
  /* Knights the enemies could send from their buildings in range: each
     keeps one at home. */
  enemyKnights: number;
  /* The owner of the nearest enemy military building in range, -1 if
     none; its distance. */
  enemy: number;
  distance: number;
}

/* What stands against the border building b. */
function frontOf(player: Player, b: Building): Front {
  const game = AI_GAME();
  const me = PLAYER_NUM(player);
  const front: Front = { enemyKnights: 0, enemy: -1, distance: 0 };
  for (const o of game.buildings) {
    if (o.getIndex() === 0) continue;
    const owner = o.getOwner();
    if (owner === me || game.isAllied(me, owner)) continue;
    if (!o.isDone() || o.isBurning() || !o.isMilitary() || !o.isActive()) continue;
    const d = game.trade.distance(b.getPosition(), o.getPosition());
    if (d > AI_THREAT_RANGE) continue;
    if (isGuardType(o.getType()) && o.getKnightCount() > 1) {
      front.enemyKnights += o.getKnightCount() - 1;
    }
    if (front.enemy < 0 || d < front.distance) {
      front.enemy = owner;
      front.distance = d;
    }
  }
  return front;
}

// ---------------------------------------------------------------------------
// The actions: the checks of the command, then the method the command calls.

/* setBuildingCap. */
function actSetCap(player: Player, b: Building, cap: number): boolean {
  if (b.getOwner() !== PLAYER_NUM(player) || b.isBurning() || !b.isDone()) return false;
  if (!isProductionBuilding(b.getType())) return false;
  if (productionOutput(b.getType()) === ResourceType.TypeNone) return false;
  if (!productionCapSteps.includes(cap)) return false;
  b.setProductionCap(cap);
  return true;
}

/* setBuildingPaused. */
function actSetPaused(player: Player, b: Building, paused: boolean): boolean {
  if (b.getOwner() !== PLAYER_NUM(player) || b.isBurning() || !b.isDone()) return false;
  if (!isProductionBuilding(b.getType())) return false;
  b.setProductionPaused(paused);
  return true;
}

/* setBuildingStance. */
function actSetStance(player: Player, b: Building, stance: BuildingStance): boolean {
  if (b.getOwner() !== PLAYER_NUM(player) || b.isBurning() || !b.isDone()) return false;
  if (!isGuardType(b.getType())) return false;
  if (stance === BuildingStance.Hold && player.extRally === b.getIndex()) return false;
  b.setStance(stance);
  return true;
}

/* setRallyPoint. */
function actSetRally(player: Player, b: Building): boolean {
  if (b.getOwner() !== PLAYER_NUM(player) || b.isBurning() || !b.isDone()) return false;
  if (!isGuardType(b.getType()) || b.isHolding()) return false;
  player.setRally(b);
  return true;
}

// ---------------------------------------------------------------------------
// 1. Upgrades.

/* Upgrade one border building in place when the stocks hold the cost and
   the reserve of planks and of stone, the player is not in the emergency
   program and none of his buildings is being upgraded. A building on Hold
   comes first, then the rally point, then a guard hut before a tower, then
   the lower index. */
export function upgradeBorder(player: Player): void {
  const game = AI_GAME();
  if (player.isEmergencyActive() || player.isOutOfPlanks() || player.isOutOfStone()) return;

  const own = ownBuildings(player);
  for (const b of own) {
    if (b.isUpgrading()) return;
  }

  const planks = game.getStockCount(PLAYER_NUM(player), ResourceType.TypePlank);
  const stones = game.getStockCount(PLAYER_NUM(player), ResourceType.TypeStone);

  let best: Building | null = null;
  let bestRank = 0;
  for (const b of own) {
    if (upgradeTarget(b.getType()) === BuildingType.TypeNone) continue;
    if (!b.isActive() || b.getThreatLevel() !== 3) continue;
    const cost = upgradeCost(b.getType());
    if (planks < cost.planks + AI_UPGRADE_PLANK_RESERVE) continue;
    if (stones < cost.stones + AI_UPGRADE_STONE_RESERVE) continue;
    if (game.getUpgradeRefusal(b.getPosition(), player) !== UpgradeRefusal.None) continue;
    const rank = (b.isHolding() ? 8 : 0) + (player.extRally === b.getIndex() ? 4 : 0) +
                 (b.getType() === BuildingType.TypeHut ? 2 : 1);
    if (rank > bestRank) {
      best = b;
      bestRank = rank;
    }
  }
  /* upgradeBuilding. */
  if (best !== null) game.upgradeBuilding(best.getPosition(), player);
}

// ---------------------------------------------------------------------------
// 2. Caps and the pause.

export function capProducers(player: Player): void {
  const game = AI_GAME();
  const me = PLAYER_NUM(player);
  const own = ownBuildings(player);

  for (const entry of aiCaps()) {
    const stock = game.getStockCount(me, productionOutput(entry.type));
    for (const b of own) {
      if (b.getType() !== entry.type) continue;
      if (b.getProductionCap() === 0) {
        if (stock >= entry.cap) actSetCap(player, b, entry.cap);
      } else if (stock < entry.lift) {
        actSetCap(player, b, 0);
      }
    }
  }

  /* The toolmaker has no single output and so no cap. It is paused while
     the original wants no tool: ai_adjust_priorities has set the priority
     of each of the nine tools to 0, which it does when the stocks hold the
     tools its jobs need. With all priorities 0 the toolmaker would make
     tools at random (Serf.handleSerfMakingToolState). It works again as
     soon as one priority is above 0. */
  let wanted = false;
  for (let i = 0; i < 9; i++) {
    if (player.getToolPrio(i) !== 0) wanted = true;
  }
  for (const b of own) {
    if (b.getType() !== BuildingType.TypeToolMaker) continue;
    if (b.isProductionPaused() === wanted) actSetPaused(player, b, !wanted);
  }
}

// ---------------------------------------------------------------------------
// 3. and 4. Peace, Hold and the rally point.

/* Runs after ai_adjust_flags of the original has set the knight sliders. */
export function posture(player: Player): void {
  const game = AI_GAME();
  const peaceLeft = game.getPeaceTicksLeft();
  const quiet = peaceLeft > AI_PEACE_FILL_TICKS;

  if (peaceLeft > 0 && !quiet) {
    /* The last minutes of the peace: the buildings next to an enemy get
       their full garrison (changeKnightOccupation: the upper end of the
       slider of threat level 3 to the top). */
    player.changeKnightOccupation(3, 1, 4);
  }

  const border = quiet ? [] : borderBuildings(player);
  const fronts = border.map((b) => frontOf(player, b));

  /* The enemy the player works against: the one who stands nearest to
     most of the border buildings (the lower index of two). */
  const facing = [0, 0, 0, 0];
  for (const f of fronts) {
    if (f.enemy >= 0 && f.enemy < 4) facing[f.enemy] += 1;
  }
  let enemy = -1;
  for (let i = 0; i < 4; i++) {
    if (facing[i] > 0 && (enemy < 0 || facing[i] > facing[enemy])) enemy = i;
  }

  /* The rally point: the strongest border building that faces him, a
     fortress before a tower before a guard hut, then the most knights,
     then the lower index. The one that is set stays while it faces him
     and no building of a larger type does. */
  let rally: Building | null = null;
  if (enemy >= 0) {
    for (let i = 0; i < border.length; i++) {
      const b = border[i];
      if (fronts[i].enemy !== enemy) continue;
      if (rally === null) {
        rally = b;
        continue;
      }
      const size = fullGarrison(b.getType()) - fullGarrison(rally.getType());
      if (size > 0) {
        rally = b;
      } else if (size === 0 && rally.getIndex() !== player.extRally &&
                 (b.getIndex() === player.extRally ||
                  b.getKnightCount() > rally.getKnightCount())) {
        rally = b;
      }
    }
  }

  /* Hold: the border buildings the enemies in range outnumber, counted
     against the full garrison of the building (not against the knights
     who are there, so that Hold does not undo itself); the AI_HOLD_MAX with
     the largest gap, the lower index first. Not the rally point: it wants
     its full garrison anyway and gives its knights to an attack. */
  const hold: Building[] = [];
  const gaps: number[] = [];
  for (let i = 0; i < border.length; i++) {
    const b = border[i];
    if (b === rally) continue;
    const gap = fronts[i].enemyKnights -
                fullGarrison(b.getType(), player.reducedKnightLevel());
    if (gap <= 0) continue;
    let at = hold.length;
    while (at > 0 && gaps[at - 1] < gap) at--;
    hold.splice(at, 0, b);
    gaps.splice(at, 0, gap);
  }
  hold.length = Math.min(hold.length, AI_HOLD_MAX);

  /* Put it into the game. Stances first: the building that becomes the
     rally point must not be on Hold. */
  for (const b of ownBuildings(player)) {
    if (!isGuardType(b.getType())) continue;
    const want = hold.includes(b) ? BuildingStance.Hold : BuildingStance.Normal;
    if (b.getStance() !== want) {
      if (want === BuildingStance.Hold && player.extRally === b.getIndex()) {
        player.clearRally(); /* clearRallyPoint */
      }
      actSetStance(player, b, want);
    }
  }
  if (rally === null) {
    if (player.extRally !== 0) player.clearRally(); /* clearRallyPoint */
  } else if (player.extRally !== rally.getIndex()) {
    actSetRally(player, rally);
  }
}

// ---------------------------------------------------------------------------
// 4. The attack.

/* The computer player has chosen the building `target` and counted his
   knights (Player.knightsAvailableForAttack). How many to send, 0 for no
   attack: the forecast of knights.ts with the knights that would really
   go, in the order they go, against the defenders the map shows. */
export function attackKnights(player: Player, target: Building): number {
  const game = AI_GAME();
  const available = player.totalAttackingKnights;
  if (available <= 0) return 0;

  let defenders = 0;
  let index = target.getFirstKnight();
  for (let guard = 0; index !== 0 && guard < 1000; guard++) {
    const serf = game.getSerf(index);
    if (serf === null) break;
    defenders += 1;
    index = serf.getNext();
  }

  const force = attackForce(game, player, target.getPosition(), available);
  const morale = player.getKnightMorale();
  const all = force.knights.length;
  if (all === 0) return 0;
  if (forecastAttack(force.knights, defenders, morale).chance < AI_ATTACK_MIN_CHANCE) return 0;
  for (let k = 1; k < all; k++) {
    if (forecastAttack(force.knights.slice(0, k), defenders, morale).chance >=
        AI_ATTACK_GOOD_CHANCE) {
      return k;
    }
  }
  return all;
}

// ---------------------------------------------------------------------------
// 6. The building plan.
//
// The original picks the most wanted building and starts it if the number
// of unfinished sites is below a limit that reads the stock alone. Nothing
// weighs the planks and stone the open sites still have to get, so on a
// poor start the sites eat the stock before a stonecutter or a sawmill
// stands, and the player is stuck. Here, before a building is started:
//   - The materials chain comes first: lumberjack, sawmill, stonecutter, in
//     that order, each as soon as the original wants it at all (it has a
//     site and a worker), whatever else it wants more. The order fits the
//     poorest start (6 planks, 2 stone): lumberjack and sawmill take 5
//     planks and the 2 stone, and the stonecutter waits for new planks.
//   - The stock is a budget: what the stocks hold less what the unfinished
//     sites still need (less what waits at the sites or is on the way).
//     While a part of the chain is not started its cost is kept back from
//     every other building, and from the parts of the chain after it.
//   - Until a sawmill works with a lumberjack, while the budget holds fewer
//     than AI_PLAN_EARLY_PLANKS planks, nothing is started but the chain, a
//     forester and huts (land, for a sawmill site).
//   - A building is started only if its cost fits the budget. A material
//     that is made already (a sawmill and a lumberjack for planks, a
//     stonecutter or a stone mine for stone) may run AI_PLAN_OVERDRAW short
//     per maker, since more is coming.
//   - When the most wanted building does not fit, the most wanted one that
//     does is started, if the original would have started it.
//   - The chain may count on the reserve of the castle, which the emergency
//     program releases to the chain alone; and an improved player does not
//     demolish its sites in an emergency (Building.updateUnfinished).

/* The materials chain, in the order it is started. */
const AI_PLAN_CHAIN: BuildingType[] = [
  BuildingType.TypeLumberjack, BuildingType.TypeSawmill, BuildingType.TypeStonecutter,
];
/* What may be started before the first planks are made: the chain, a
   forester, and huts to win land for a sawmill. */
const AI_PLAN_EARLY: BuildingType[] = [
  ...AI_PLAN_CHAIN, BuildingType.TypeForester, BuildingType.TypeHut,
];
/* Below this many planks in the budget, and no sawmill working, only
   AI_PLAN_EARLY is started. */
export const AI_PLAN_EARLY_PLANKS = 15;
/* How far short of a material may run per building that makes it, and at
   most. */
export const AI_PLAN_OVERDRAW = 4;
export const AI_PLAN_OVERDRAW_MAX = 12;

export interface AIBudget {
  planks: number; /* What the stocks hold less what the sites still need. */
  stone: number;
  plankMakers: number; /* Finished sawmills, while a lumberjack stands. */
  stoneMakers: number; /* Finished stonecutters and stone mines. */
  /* The reserve the castle keeps back until it runs out (Player.extraPlanks,
     extraStone): the emergency program gives it to the chain only. */
  extraPlanks: number;
  extraStone: number;
  started: number[]; /* Buildings of each type, finished or not. */
}

/* The budget of the player as it stands. */
export function budget(player: Player): AIBudget {
  const game = AI_GAME();
  const index = PLAYER_NUM(player);
  const out: AIBudget = {
    planks: game.getStockCount(index, ResourceType.TypePlank),
    stone: game.getStockCount(index, ResourceType.TypeStone),
    plankMakers: 0, stoneMakers: 0, extraPlanks: player.extraPlanks, extraStone: player.extraStone,
    started: new Array<number>(25).fill(0),
  };
  let sawmills = 0;
  let lumberjacks = 0;
  for (const b of game.buildings) {
    if (b.getIndex() === 0 || b.getOwner() !== index || b.isBurning()) continue;
    const type = b.getType();
    out.started[type] += 1;
    if (!b.isDone()) {
      if (type === BuildingType.TypeCastle) continue;
      out.planks -= Math.max(0, b.stock[0].maximum - b.stock[0].available - b.stock[0].requested);
      out.stone -= Math.max(0, b.stock[1].maximum - b.stock[1].available - b.stock[1].requested);
      continue;
    }
    if (type === BuildingType.TypeSawmill) sawmills++;
    if (type === BuildingType.TypeLumberjack) lumberjacks++;
    if (type === BuildingType.TypeStonecutter || type === BuildingType.TypeStoneMine) out.stoneMakers++;
  }
  out.plankMakers = lumberjacks > 0 ? sawmills : 0;
  return out;
}

/* Whether a building of the type fits the budget, with the cost of the
   parts of the chain not started kept back: all of them for a building
   outside the chain, those before it for a part of the chain. */
export function fitsBudget(b: AIBudget, type: number): boolean {
  if (type < 1 || type > 23) return true; /* a flag or a geologist: free */
  /* No planks are made yet and few are left: only what leads to them, and
     huts for land. */
  if (b.plankMakers === 0 && b.planks < AI_PLAN_EARLY_PLANKS && !AI_PLAN_EARLY.includes(type)) {
    return false;
  }
  const chain = AI_PLAN_CHAIN.includes(type);
  let planks = b.planks + (chain ? b.extraPlanks : 0);
  let stone = b.stone + (chain ? b.extraStone : 0);
  for (const t of AI_PLAN_CHAIN) {
    if (t === type) break;
    if (b.started[t] > 0) continue;
    planks -= constInfo()[t].planks;
    stone -= constInfo()[t].stones;
  }
  const cost = constInfo()[type];
  const plankSlack = Math.min(AI_PLAN_OVERDRAW_MAX, AI_PLAN_OVERDRAW * b.plankMakers);
  const stoneSlack = Math.min(AI_PLAN_OVERDRAW_MAX, AI_PLAN_OVERDRAW * b.stoneMakers);
  return planks + plankSlack >= cost.planks && stone + stoneSlack >= cost.stones;
}

/* The building type to start instead of `type` (the most wanted, -1 for
   none), from the wants of this step (index type - 1); -1 to start none.
   `threshold` is the want the original asks of a building it starts. */
export function planBuild(player: Player, wants: number[], type: number, threshold: number): number {
  const b = budget(player);
  /* The chain first, in its order. */
  for (const t of AI_PLAN_CHAIN) {
    if (b.started[t] > 0) continue;
    if ((wants[t - 1] & 0xffff) > 0 && fitsBudget(b, t)) return t;
    /* Not yet possible (no site or no worker): the next part may be. */
  }
  if (type < 0) return -1;
  if (type > 23) return type;
  /* The most wanted that fits and that the original would start. */
  let best = -1;
  let bestWant = 0;
  for (let t = 1; t <= 23; t++) {
    const want = wants[t - 1] & 0xffff;
    if (want < threshold || want <= bestWant) continue;
    if (!fitsBudget(b, t)) continue;
    best = t;
    bestWant = want;
  }
  return best;
}

// ---------------------------------------------------------------------------
// 5. Trade offers.

/* Whether the player has a use for the resource now. */
function usesResource(player: Player, res: ResourceType): boolean {
  const done = (type: BuildingType): number => player.completedBuildingCount[type];
  switch (res) {
    case ResourceType.TypePlank:
    case ResourceType.TypeStone:
      return true;
    case ResourceType.TypeCoal:
      return done(BuildingType.TypeWeaponSmith) + done(BuildingType.TypeSteelSmelter) +
             done(BuildingType.TypeGoldSmelter) > 0;
    case ResourceType.TypeIronOre:
      return done(BuildingType.TypeSteelSmelter) > 0;
    case ResourceType.TypeSteel:
      return done(BuildingType.TypeWeaponSmith) + done(BuildingType.TypeToolMaker) > 0;
    case ResourceType.TypeFish:
    case ResourceType.TypeMeat:
    case ResourceType.TypeBread:
      return done(BuildingType.TypeStoneMine) + done(BuildingType.TypeCoalMine) +
             done(BuildingType.TypeIronMine) + done(BuildingType.TypeGoldMine) > 0;
    default:
      return false;
  }
}

/* Offer a clear surplus for a resource the player is short of. One open
   offer at a time, to the allies if the player has any that can trade,
   else to the other players, in turn. Never a weapon or a tool, to
   anybody. */
export function proposeTrade(player: Player): void {
  const game = AI_GAME();
  const trade = game.trade;
  const me = PLAYER_NUM(player);
  if (!game.hasTrading()) return;
  if (idiv(game.getTick(), kTicksPerMinute) % AI_TRADE_PERIOD_MINUTES !== me) return;
  if (trade.countOffersOf(me) > 0) return;
  if (!trade.canPlayerTrade(me)) return;

  /* What is wanted: the first of these the player uses and holds less
     than AI_TRADE_SHORT of. Food counts as one: fish, meat and bread. */
  const food = [ResourceType.TypeFish, ResourceType.TypeMeat, ResourceType.TypeBread];
  const goods = [
    ResourceType.TypePlank, ResourceType.TypeStone, ResourceType.TypeCoal,
    ResourceType.TypeIronOre, ResourceType.TypeSteel, ...food,
  ];
  const count = (res: ResourceType): number => game.getStockCount(me, res);
  const short = (res: ResourceType): boolean => {
    if (!usesResource(player, res)) return false;
    if (food.includes(res)) return count(food[0]) + count(food[1]) + count(food[2]) < AI_TRADE_SHORT;
    return count(res) < AI_TRADE_SHORT;
  };
  let want: ResourceType = ResourceType.TypeNone;
  for (const res of goods) {
    if (short(res)) {
      /* Which food: in turn. */
      want = food.includes(res) ? food[trade.nextId % 3] : res;
      break;
    }
  }
  if (want === ResourceType.TypeNone) return;

  /* What is given: the resource one stock holds the most of beyond what
     it keeps. */
  let give: ResourceType = ResourceType.TypeNone;
  let from: Building | null = null;
  let most = 0;
  for (const res of goods) {
    if (res === want || short(res)) continue;
    const keep = res === ResourceType.TypePlank || res === ResourceType.TypeStone
      ? AI_TRADE_KEEP_MATERIAL : AI_TRADE_KEEP;
    for (const inventory of game.getPlayerInventories(player)) {
      if (trade.getStock(me, inventory.getIndex()) === null) continue;
      const spare = inventory.getCountOf(res) - keep - 2 * AI_TRADE_GIVE;
      if (spare >= 0 && (from === null || spare > most)) {
        give = res;
        from = game.getBuilding(inventory.getBuildingIndex());
        most = spare;
      }
    }
  }
  if (from === null) return;

  /* To whom. */
  const allies: number[] = [];
  const others: number[] = [];
  for (let i = 0; i < 4; i++) {
    if (i === me || !trade.canPlayerTrade(i)) continue;
    (game.isAllied(me, i) ? allies : others).push(i);
  }
  const partners = allies.length > 0 ? allies : others;
  if (partners.length === 0) return;
  const to = partners[trade.nextId % partners.length];

  /* tradeOffer. */
  if (trade.offerRefusal(player, from.getPosition(), to, give, AI_TRADE_GIVE, want,
                         AI_TRADE_WANT) !== TradeRefusal.None) {
    return;
  }
  trade.makeOffer(player, from.getPosition(), to, give, AI_TRADE_GIVE, want, AI_TRADE_WANT);
}

// ---------------------------------------------------------------------------

/* After management step `slot` (0..15) of ai_update. */
export function afterStep(player: Player, slot: number): void {
  switch (slot) {
    case 0: posture(player); break; /* after the knight sliders */
    case 1: case 9: capProducers(player); break; /* after the statistics */
    case 3: upgradeBorder(player); break; /* after the buildings */
    case 8: posture(player); proposeTrade(player); break;
    default: break;
  }
}

// ---------------------------------------------------------------------------
// EXT (teams): where a computer player with allies puts its castle.
//
// The original picks the best of a few random sites anywhere on the map, so
// team mates end up far apart. With teams, a computer player settles near an
// ally whose castle stands: on a free site 14 to 26 steps from the nearest
// allied castle, as far from enemy castles as it can, then as close to the
// ally as it can. Without an allied castle yet it waits up to two minutes of
// game time for a human ally to place one, then picks as the original does.
// Integer only, no random draws, sites tried in a fixed order.

const TEAM_SITE_MIN = 14;
const TEAM_SITE_MAX = 26;
const TEAM_WAIT_TICKS = 12000;

/* Steps between two places on the hexagonal map. */
function steps(map: { distX(a: number, b: number): number; distY(a: number, b: number): number },
               a: number, b: number): number {
  const dx = map.distX(a, b);
  const dy = map.distY(a, b);
  if ((dx >= 0) === (dy >= 0)) return Math.max(Math.abs(dx), Math.abs(dy));
  return Math.abs(dx) + Math.abs(dy);
}

/* null: no team rule here, place as the original does; -1: wait; else the
   position to build the castle on. */
export function teamCastleSite(player: Player): number | null {
  const game = AI_GAME();
  if (!game.hasTeams() || player.getTeam() === 0) return null;
  const me = PLAYER_NUM(player);
  const allied: number[] = [];
  const enemy: number[] = [];
  for (const b of game.buildings) {
    if (b.getType() !== BuildingType.TypeCastle || b.isBurning()) continue;
    if (b.getOwner() === me) return null;
    (game.isAllied(me, b.getOwner()) ? allied : enemy).push(b.getPosition());
  }
  if (allied.length === 0) {
    for (let i = 0; i < 4; i++) {
      const other = game.getPlayer(i);
      if (other === null || i === me || other.isAi() || other.hasCastle()) continue;
      if (game.isAllied(me, i) && game.getTick() < TEAM_WAIT_TICKS) return -1;
    }
    if (enemy.length === 0) return null;
    /* The first castle of the team: the free site farthest from the enemy
       castles, every third field of the map tried. */
    const map = game.getMap();
    let far = -1;
    let farDist = -1;
    for (let row = 0; row < map.getRows(); row += 3) {
      for (let col = 0; col < map.getCols(); col += 3) {
        const pos = map.pos(col, row);
        let nearEnemy = 1 << 20;
        for (const e of enemy) nearEnemy = Math.min(nearEnemy, steps(map, e, pos));
        if (nearEnemy <= farDist || !game.canBuildCastle(pos, player)) continue;
        far = pos;
        farDist = nearEnemy;
      }
    }
    return far >= 0 ? far : null;
  }
  const map = game.getMap();
  let best = -1;
  let bestScore = -1;
  for (const center of allied) {
    for (let dy = -TEAM_SITE_MAX; dy <= TEAM_SITE_MAX; dy++) {
      for (let dx = -TEAM_SITE_MAX; dx <= TEAM_SITE_MAX; dx++) {
        const pos = map.posAdd(center, dx, dy);
        let nearAlly = 1 << 20;
        for (const a of allied) nearAlly = Math.min(nearAlly, steps(map, a, pos));
        if (nearAlly < TEAM_SITE_MIN || nearAlly > TEAM_SITE_MAX) continue;
        let nearEnemy = 200;
        for (const e of enemy) nearEnemy = Math.min(nearEnemy, steps(map, e, pos));
        const score = nearEnemy * 64 + (TEAM_SITE_MAX - nearAlly);
        if (score <= bestScore) continue;
        if (!game.canBuildCastle(pos, player)) continue;
        best = pos;
        bestScore = score;
      }
    }
  }
  return best >= 0 ? best : null;
}
