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
  flags: Iterable<{ getIndex(): number; getPosition(): number; getOwner(): number }>;
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
  }

  for (const f of g.flags) {
    mix(f.getIndex());
    mix(f.getPosition());
    mix(f.getOwner());
  }

  for (const inv of g.inventories) {
    mix(inv.getIndex());
    mix(inv.getOwner());
    for (let r = 0; r < RESOURCE_TYPES; r++) mix(inv.getCountOf(r as ResourceType));
  }

  return h >>> 0;
}
