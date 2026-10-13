// The game of an online match: made by the host from the game init screen,
// sent to the guests, and built the same way on all sides.

import { AI } from '../game/ai';
import { Game, GameGameType, isValidGameRules, isValidTeam } from '../game/game';
import { defColor, GameInfo, PlayerInfo } from '../game/mission';
import { Random } from '../game/random';
import { MAX_HUMANS } from './protocol';
import type { GameSetup, NetPlayer } from './protocol';

// Faces of the human players (mission.ts: 'You' and 'Friend'). A face
// below 12 makes Player.initView() mark the player as a computer player.
export const HOST_FACE = 12;
export const GUEST_FACE = 13;

/* The players of an online game: the first `humans` of `info` become the
   host and the guests whatever face they had, the rest stay computer
   players. */
export function makeSetup(info: GameInfo, gameSeed: Random, humans = 2): GameSetup {
  const players: NetPlayer[] = [];
  for (let i = 0; i < info.getPlayerCount() || i < humans; i++) {
    const p = i < info.getPlayerCount() ? info.getPlayer(i) : null;
    let face = p !== null ? p.getFace() : GUEST_FACE;
    if (i === 0) face = HOST_FACE;
    else if (i < humans) face = GUEST_FACE;
    else if (face < 1 || face >= HOST_FACE) {
      /* A computer player needs a computer face. */
      face = i - 1;
    }
    players.push({
      face,
      color: { ...defColor[i] },
      intelligence: p !== null ? p.getIntelligence() : 40,
      supplies: p !== null ? p.getSupplies() : 40,
      reproduction: p !== null ? p.getReproduction() : 40,
      castle: p !== null ? p.getCastlePos() : { col: -1, row: -1 },
      // EXT: teams, set by the host in the setup.
      team: p !== null ? p.getTeam() : 0,
    });
  }

  return {
    mapSize: info.getMapSize(),
    mapSeed: info.getRandomBase().toString(),
    gameSeed: gameSeed.toString(),
    gameType: GameGameType.GameTypeTwoPlayers,
    level: 0,
    humans,
    players,
    // EXT: game options.
    rules: info.getRules(),
  };
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function isSeed(v: unknown): v is string {
  return typeof v === 'string' && /^[1-8]{16}$/.test(v);
}

/* A start message comes from the network: refuse what the game could not
   be built from. */
export function isValidSetup(setup: GameSetup): boolean {
  if (typeof setup !== 'object' || setup === null) return false;
  if (!isInt(setup.mapSize, 3, 10)) return false;
  if (!isSeed(setup.mapSeed) || !isSeed(setup.gameSeed)) return false;
  if (!isInt(setup.gameType, 0, 4) || !isInt(setup.level, 0, 64)) return false;
  if (!isInt(setup.humans, 2, MAX_HUMANS)) return false;
  if (!Array.isArray(setup.players)) return false;
  if (setup.players.length < setup.humans || setup.players.length > 4) return false;
  for (let i = 0; i < setup.players.length; i++) {
    const p = setup.players[i];
    if (typeof p !== 'object' || p === null) return false;
    const human = i < setup.humans;
    if (!isInt(p.face, human ? HOST_FACE : 1, human ? GUEST_FACE : HOST_FACE - 1)) return false;
    if (!isInt(p.intelligence, 0, 40)) return false;
    if (!isInt(p.supplies, 0, 40)) return false;
    if (!isInt(p.reproduction, 0, 40)) return false;
    const c = p.color;
    if (typeof c !== 'object' || c === null) return false;
    if (!isInt(c.red, 0, 255) || !isInt(c.green, 0, 255) || !isInt(c.blue, 0, 255)) return false;
    const castle = p.castle;
    if (typeof castle !== 'object' || castle === null) return false;
    if (!isInt(castle.col, -1, 1023) || !isInt(castle.row, -1, 1023)) return false;
    // EXT: teams.
    if (!isValidTeam(p.team)) return false;
  }
  // EXT: game options.
  if (!isValidGameRules(setup.rules)) return false;
  return true;
}

// A GameInfo that builds its game from a GameSetup. GameManager.startGame()
// takes it like any other.
export class NetGameInfo extends GameInfo {
  protected setup: GameSetup;

  constructor(setup: GameSetup) {
    super(new Random(setup.mapSeed));
    this.setup = setup;
    this.mapSize = setup.mapSize;
    this.gameType = setup.gameType;
    this.level = setup.level;
    this.players = [];
    for (const p of setup.players) {
      const player = new PlayerInfo(p.face, p.color, p.intelligence, p.supplies, p.reproduction);
      player.setCastlePos(p.castle);
      // EXT: teams.
      player.setTeam(p.team);
      this.players.push(player);
    }
    // EXT: game options.
    this.rules = {
      stockPreset: setup.rules.stockPreset,
      peaceMinutes: setup.rules.peaceMinutes,
      // EXT: busy roads.
      busyRoads: setup.rules.busyRoads,
      // EXT: trading between players.
      trading: setup.rules.trading,
    };
  }

  /* GameInfo.instantiate() with the one difference that the random numbers
     of the game start from the shared seed, before anything can draw one. */
  override instantiate(): Game | null {
    const game = new Game();
    game.setRandom(new Random(this.setup.gameSeed));

    if (!game.init(this.mapSize, this.randomBase)) {
      return null;
    }
    game.setGameType(this.gameType, this.level);
    // EXT: the options before the first castle, as GameInfo.instantiate().
    if (this.hasExtensions()) game.setRules(this.rules);

    for (const playerInfo of this.players) {
      const index = game.addPlayer(playerInfo.getIntelligence(),
                                   playerInfo.getSupplies(),
                                   playerInfo.getReproduction());
      const player = game.getPlayer(index)!;
      player.initView(playerInfo.getColor(), playerInfo.getFace());
      // EXT: teams.
      if (this.hasExtensions()) player.setTeam(playerInfo.getTeam());

      const castlePos = playerInfo.getCastlePos();
      if (castlePos.col > -1 && castlePos.row > -1) {
        const pos = game.getMap()!.pos(castlePos.col, castlePos.row);
        AI.castleGiven(game, player, pos);
        game.buildCastle(pos, player);
      }
    }

    return game;
  }
}
