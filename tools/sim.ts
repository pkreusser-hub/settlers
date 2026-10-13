// Dev tool: run the simulation headless and print a state digest.
// Usage: npx esbuild tools/sim.ts --bundle --platform=node --outfile=node_modules/.cache/sim.cjs && node node_modules/.cache/sim.cjs [mission] [updates]

import { BuildingType } from '../src/game/building';
import { GameInfo } from '../src/game/mission';
import { pathfinderMap } from '../src/game/pathfinder';
import { Random } from '../src/game/random';
import { SerfState } from '../src/game/serf';

const mission = Number(process.argv[2] ?? 0);
const updates = Number(process.argv[3] ?? 20000);

function digest(game: any): string {
  let h = 2166136261;
  const mix = (v: number) => { h = Math.imul(h ^ (v | 0), 16777619); };
  const states = new Map<number, number>();
  let serfs = 0;
  for (const serf of game.serfs) {
    serfs++;
    mix(serf.getIndex()); mix(serf.pos); mix(serf.state); mix(serf.counter); mix(serf.animation); mix(serf.type);
    states.set(serf.state, (states.get(serf.state) ?? 0) + 1);
  }
  let buildings = 0;
  // Buildings per player, "done/all" (index 0 is the NULL building).
  const perPlayer = new Map<number, [number, number]>();
  for (const b of game.buildings) {
    buildings++; mix(b.getPosition()); mix(b.getType()); mix(b.isDone() ? 1 : 0);
    if (b.getIndex() === 0) continue;
    const c = perPlayer.get(b.getOwner()) ?? [0, 0];
    if (b.isDone()) c[0]++;
    c[1]++;
    perPlayer.set(b.getOwner(), c);
  }
  const owners = [...perPlayer].sort((x, y) => x[0] - y[0])
    .map(([o, c]) => `p${o}:${c[0]}/${c[1]}`).join(' ');
  let flags = 0;
  for (const f of game.flags) { flags++; mix(f.getPosition()); }
  const top = [...states].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([s, n]) => `${SerfState[s]}:${n}`).join(' ');
  return `serfs=${serfs} buildings=${buildings} (${owners}) flags=${flags} hash=${(h >>> 0).toString(16)} | ${top}`;
}

function run(): string[] {
  const info = GameInfo.getMission(mission)!;
  const game = info.instantiate()! as any;
  game.rnd = new Random(0x1234, 0x5678, 0x9abc);
  const map = game.getMap();
  const out: string[] = [];
  out.push(`map ${map.getCols()}x${map.getRows()} players=${[...game.players].length}`);
  out.push(`start: ${digest(game)}`);

  // Give player 0 something to do: a lumberjack near the castle, joined by road.
  const player = game.getPlayer(0);
  if (!player.hasCastle()) {
    for (let pos = 0; pos < map.getCols() * map.getRows(); pos++) {
      if (game.canBuildCastle(pos, player) && game.buildCastle(pos, player)) {
        out.push(`castle at ${map.posCol(pos)},${map.posRow(pos)}`);
        break;
      }
    }
  }
  let castle: any = null;
  for (const b of game.buildings) if (b.getOwner() === 0 && b.getType() === BuildingType.TypeCastle) castle = b;
  let placed = 0;
  if (castle) {
    for (let i = 0; i < 295 && placed < 3; i++) {
      const pos = map.posAddSpirally(castle.getPosition(), i);
      const type = [BuildingType.TypeLumberjack, BuildingType.TypeStonecutter, BuildingType.TypeHut][placed];
      if (game.canBuildBuilding(pos, type, player) && game.buildBuilding(pos, type, player)) {
        placed++;
        const road = pathfinderMap(map, map.moveDownRight(pos), map.moveDownRight(castle.getPosition()));
        const ok = road.getLength() > 0 && game.buildRoad(road, player);
        out.push(`built ${BuildingType[type]} at ${map.posCol(pos)},${map.posRow(pos)}, road length ${road.getLength()} ${ok ? 'ok' : 'FAILED'}`);
      }
    }
  }

  for (let i = 1; i <= updates; i++) {
    game.update();
    if (i % (updates / 4) === 0) out.push(`t=${i}: ${digest(game)}`);
  }
  return out;
}

const a = run();
const b = run();
console.log(a.join('\n'));
console.log(a.join('\n') === b.join('\n') ? 'DETERMINISTIC: two runs match' : 'MISMATCH between two runs:\n' + b.join('\n'));
