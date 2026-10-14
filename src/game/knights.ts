// EXT: knight controls (not part of Freeserf): what an attack would send
// and how it is likely to end. Everything here only reads the game; the
// attack window shows it before the player commits. The rules themselves
// (stance, rally point) are in building.ts and player.ts.
//
// The numbers follow Serf::set_fight_outcome() of serf.ts:
//   morale = (0x400 * 2^rank * land) >> 16
//   land   = 0x1000 for a knight on land of his own player, else the
//            knight morale of his player (Player::get_knight_morale)
//   r      = ((morale + defMorale) * random_int()) >> 16
//   the attacker wins when r < morale
// Integers only, as there.

import { BuildingType } from './building';
import type { Building } from './building';
import type { Game } from './game';
import type { MapPos } from './map-geometry';
import type { Player } from './player';
import { SerfType } from './serf';

/* The land factor of a knight who fights on land of his own player. */
export const kOwnLandFactor = 0x1000;

/* The "morale" of a knight of a rank (0 to 4) in a duel. */
export function duelMorale(rank: number, landFactor: number): number {
  return Math.imul(0x400 * (1 << rank), landFactor) >> 16;
}

/* Of the 65536 values of Game::random_int(), the number with which the
   attacker wins the duel. */
export function duelWinDraws(morale: number, defMorale: number): number {
  const sum = morale + defMorale;
  if (morale <= 0 || sum <= 0) return 0;
  /* ((sum * x) >> 16) < morale  <=>  x < morale * 65536 / sum */
  const draws = Math.floor((morale * 65536 + sum - 1) / sum);
  return Math.min(draws, 65536);
}

/* A land factor as a percentage of the factor on own land, for the eye. */
export function moralePercent(landFactor: number): number {
  return Math.floor((landFactor * 100) / kOwnLandFactor);
}

const kScale = 1 << 24;

/* The chance, out of 1000, that the attackers take the building: they
   fight the defenders one duel after the other, the loser of a duel dies
   and the winner fights on, until one side has no knight left. attackers
   and defenders are ranks (0 to 4) in the order they fight. The land
   factors are those of set_fight_outcome(). */
export function attackWinChance(attackers: number[], defenders: number[],
                                attackerLand: number, defenderLand: number): number {
  const n = attackers.length;
  const m = defenders.length;
  if (n === 0) return 0;
  if (m === 0) return 1000;

  /* row[j]: the chance (of kScale) that the attacker at hand meets
     defender j, that is with j defenders dead. */
  let row: number[] = new Array(m + 1).fill(0);
  row[0] = kScale;
  let won = 0;
  for (let i = 0; i < n; i++) {
    const morale = duelMorale(attackers[i], attackerLand);
    const next: number[] = new Array(m + 1).fill(0);
    for (let j = 0; j < m; j++) {
      if (row[j] === 0) continue;
      const draws = duelWinDraws(morale, duelMorale(defenders[j], defenderLand));
      const win = Math.floor((row[j] * draws) / 65536);
      /* The attacker wins and meets the next defender, or he dies and the
         next attacker meets this one. */
      row[j + 1] += win;
      next[j] += row[j] - win;
    }
    won += row[m];
    row = next;
  }
  return Math.min(1000, Math.floor((won * 1000) / kScale));
}

export enum AttackVerdict {
  LikelyLoss = 0,
  Even = 1,
  LikelyWin = 2,
}

/* The word for a chance out of 1000: six in ten or better is a likely win,
   four in ten or worse a likely loss. */
export function attackVerdict(chance: number): AttackVerdict {
  if (chance >= 600) return AttackVerdict.LikelyWin;
  if (chance <= 400) return AttackVerdict.LikelyLoss;
  return AttackVerdict.Even;
}

export interface AttackForecast {
  /* Out of 1000. The ranks of the defenders are not known to the
     attacker: the mean of the five chances with all defenders of one
     rank. */
  chance: number;
  /* With all defenders of the lowest and of the highest rank. */
  best: number;
  worst: number;
  verdict: AttackVerdict;
}

/* The forecast of an attack with knights of these ranks (in the order they
   go) on a building with so many defenders of unknown rank. The attackers
   fight on the land of the defender: their land factor is the knight
   morale of their player, the defenders' is that of own land. */
export function forecastAttack(attackers: number[], defenderCount: number,
                               attackerMorale: number): AttackForecast {
  let sum = 0;
  let best = 0;
  let worst = 0;
  for (let rank = 0; rank <= 4; rank++) {
    const defenders: number[] = new Array(defenderCount).fill(rank);
    const chance = attackWinChance(attackers, defenders, attackerMorale, kOwnLandFactor);
    sum += chance;
    if (rank === 0) best = chance;
    if (rank === 4) worst = chance;
  }
  const chance = Math.floor(sum / 5);
  return { chance, best, worst, verdict: attackVerdict(chance) };
}

export interface AttackForce {
  /* The ranks of the knights in the order Player::start_attack() would
     send them. */
  knights: number[];
  /* How many of each rank, lowest first. */
  byRank: number[];
  /* How many of them come from the rally point. */
  fromRally: number;
}

/* The ranks of the knights in a building, in the order of its list. */
function knightRanks(game: Game, building: Building): number[] {
  const ranks: number[] = [];
  let index = building.getFirstKnight();
  for (let guard = 0; index !== 0 && guard < 1000; guard++) {
    const serf = game.getSerf(index);
    if (serf === null) break;
    const type = serf.getType();
    if (type >= SerfType.TypeKnight0 && type <= SerfType.TypeKnight4) {
      ranks.push(type - SerfType.TypeKnight0);
    }
    index = serf.getNext();
  }
  return ranks;
}

/* The knights that would go if the player sent `knights` against the
   building at pos now: the walk of Player::start_attack() through the
   buildings of Player::knights_available_for_attack(), without sending
   anybody. The fields that call leaves in the player are put back. */
export function attackForce(game: Game, player: Player, pos: MapPos, knights: number): AttackForce {
  const minLevelHut = [1, 1, 2, 2, 3];
  const minLevelTower = [1, 2, 3, 4, 6];
  const minLevelFortress = [1, 3, 6, 9, 12];

  const savedKnights = player.attackingKnights.slice();
  const savedBuildings = player.attackingBuildings.slice();
  const savedCount = player.attackingBuildingCount;
  const savedTotal = player.totalAttackingKnights;

  player.knightsAvailableForAttack(pos);
  const buildings = player.attackingBuildings.slice(0, player.attackingBuildingCount);

  for (let i = 0; i < savedKnights.length; i++) player.attackingKnights[i] = savedKnights[i];
  for (let i = 0; i < savedBuildings.length; i++) player.attackingBuildings[i] = savedBuildings[i];
  player.attackingBuildingCount = savedCount;
  player.totalAttackingKnights = savedTotal;

  const force: AttackForce = { knights: [], byRank: [0, 0, 0, 0, 0], fromRally: 0 };
  const map = game.getMap();
  let left = knights;
  for (const index of buildings) {
    if (left <= 0) break;
    const b = game.getBuilding(index);
    if (b === null || b.isBurning() || map.getOwner(b.getPosition()) !== player.getIndex()) {
      continue;
    }
    if (b.isHolding()) continue;

    const flagPos = map.moveDownRight(b.getPosition());
    if (map.hasSerf(flagPos)) {
      /* Under siege. */
      const s = game.getSerfAtPos(flagPos);
      if (s !== null && s.getOwner() !== player.getIndex()) continue;
    }

    let minLevel: number[];
    switch (b.getType()) {
      case BuildingType.TypeHut: minLevel = minLevelHut; break;
      case BuildingType.TypeTower: minLevel = minLevelTower; break;
      case BuildingType.TypeFortress: minLevel = minLevelFortress; break;
      default: continue;
    }

    const toSend = b.getKnightCount() -
      minLevel[player.getKnightOccupation(b.getThreatLevel()) & 0xf];
    /* Building::call_attacker_out() takes the last knight of the list. */
    const ranks = knightRanks(game, b);
    for (let j = 0; j < toSend && left > 0; j++) {
      const rank = ranks.pop();
      if (rank === undefined) break;
      force.knights.push(rank);
      force.byRank[rank] += 1;
      if (index === player.extRally) force.fromRally += 1;
      left -= 1;
    }
  }
  return force;
}
