// State hash for desync detection: both sides compute it at the same turn
// and compare. It reads the game and never changes it.

import type { Game } from '../game/game';
import { ResourceType } from '../game/resource';

interface Hashable {
  tick: number;
  constTick: number;
  gameSpeed: number;
  rnd: { toString(): string };
  initMapRnd: { toString(): string };
  players: Iterable<{
    getIndex(): number;
    totalLandArea: number;
    totalBuildingScore: number;
    totalMilitaryScore: number;
    reproductionCounter: number;
    serfToKnightCounter: number;
    knightMorale: number;
    goldDeposited: number;
    castleKnights: number;
    getSerfCount(type: number): number;
  }>;
  flags: Iterable<{
    getIndex(): number;
    getPosition(): number;
    getOwner(): number;
    // EXT: busy roads.
    extLoad: number[];
    extBusy: boolean[];
  }>;
  inventories: Iterable<{
    getIndex(): number;
    getOwner(): number;
    getCountOf(resource: ResourceType): number;
  }>;
  buildings: Iterable<{
    getIndex(): number;
    getPosition(): number;
    getType(): number;
    getProgress(): number;
    getOwner(): number;
    isDone(): boolean;
    // EXT: building controls (pause, output cap, upgrade in place).
    extPaused: boolean;
    extCap: number;
    upgradeTo: number;
    upgradeTimer: number;
    stock: { type: number; available: number; requested: number; maximum: number }[];
  }>;
  serfs: Iterable<{
    getIndex(): number;
    pos: number;
    state: number;
    counter: number;
    type: number;
    animation: number;
    tick: number;
    getOwner(): number;
  }>;
}

const SERF_TYPES = 27;
const RESOURCE_TYPES = 26;

// 32-bit FNV-1a over the integers that describe the game.
export function stateHash(game: Game): number {
  const g = game as unknown as Hashable;
  let h = 2166136261;
  const mix = (v: number): void => {
    h = Math.imul(h ^ (v | 0), 16777619);
  };
  const mixString = (s: string): void => {
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
  };

  mix(g.tick);
  mix(g.constTick);
  mix(g.gameSpeed);
  mixString(g.rnd.toString());
  mixString(g.initMapRnd.toString());

  for (const p of g.players) {
    mix(p.getIndex());
    mix(p.totalLandArea);
    mix(p.totalBuildingScore);
    mix(p.totalMilitaryScore);
    mix(p.reproductionCounter);
    mix(p.serfToKnightCounter);
    mix(p.knightMorale);
    mix(p.goldDeposited);
    mix(p.castleKnights);
    for (let t = 0; t < SERF_TYPES; t++) mix(p.getSerfCount(t));
  }

  for (const s of g.serfs) {
    mix(s.getIndex());
    mix(s.pos);
    mix(s.state);
    mix(s.counter);
    mix(s.type);
    mix(s.animation);
    mix(s.tick);
    mix(s.getOwner());
  }

  for (const b of g.buildings) {
    mix(b.getIndex());
    mix(b.getPosition());
    mix(b.getType());
    mix(b.getProgress());
    mix(b.getOwner());
    mix(b.isDone() ? 1 : 0);
    // EXT: building controls. Mixed in only when one is in use, so that a
    // game without them hashes as before.
    if (b.extPaused || b.extCap !== 0 || b.upgradeTo !== 0) {
      mix(b.extPaused ? 1 : 0);
      mix(b.extCap);
      mix(b.upgradeTo);
      mix(b.upgradeTimer);
      mix(b.stock[2].type);
      mix(b.stock[2].available);
      mix(b.stock[2].requested);
      mix(b.stock[2].maximum);
    }
  }

  for (const f of g.flags) {
    mix(f.getIndex());
    mix(f.getPosition());
    mix(f.getOwner());
    // EXT: busy roads. Mixed in only for a flag that has a load, so that a
    // game without the rule hashes as before.
    let load = false;
    for (let d = 0; d < 6; d++) {
      if (f.extLoad[d] !== 0 || f.extBusy[d]) load = true;
    }
    if (load) {
      mix(0x45585433); /* 'EXT3' */
      for (let d = 0; d < 6; d++) {
        mix(f.extLoad[d]);
        mix(f.extBusy[d] ? 1 : 0);
      }
    }
  }

  for (const inv of g.inventories) {
    mix(inv.getIndex());
    mix(inv.getOwner());
    for (let r = 0; r < RESOURCE_TYPES; r++) mix(inv.getCountOf(r as ResourceType));
  }

  // EXT (game options and teams): mixed in only when one is set, so that a
  // game without them has the hash it had before.
  {
    const rules = game.getRules();
    if (rules.stockPreset !== 0 || rules.peaceMinutes !== 0 || game.hasTeams()) {
      mix(0x45585431); /* 'EXT1' */
      mix(rules.stockPreset);
      mix(rules.peaceMinutes);
      for (let i = 0; i < 4; i++) {
        const player = game.getPlayer(i);
        mix(player === null ? -1 : player.getTeam());
      }
      mix(game.getWinningPlayer());
    }
    // EXT: busy roads, only when on.
    if (rules.busyRoads) mix(0x45585432); /* 'EXT2' */
    // EXT: trading, only when on: the offers and the shipments under way.
    if (rules.trading) {
      mix(0x45585434); /* 'EXT4' */
      game.trade.mixInto(mix);
    }
  }
  // EXT: end of the block.

  return h >>> 0;
}
