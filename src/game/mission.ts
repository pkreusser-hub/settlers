/*
 * mission.ts - Predefined game mission maps
 *
 * Port of Freeserf's mission.h and mission.cc.
 *
 * Copyright (C) 2013-2017  Jon Lund Steffensen <jonlst@gmail.com>
 *
 * This file is part of freeserf.
 *
 * freeserf is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * freeserf is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with freeserf.  If not, see <http://www.gnu.org/licenses/>.
 */

import { AI } from './ai';
import { Game, GameGameType } from './game';
import type { GameRules } from './game';
import { u32 } from './misc';
import type { PlayerColor } from './player';
import { Random } from './random';

export interface Character {
  face: number;
  name: string;
  characterization: string;
}

export interface PlayerInfoPos {
  col: number;
  row: number;
}

export interface PlayerInfoPreset {
  character: Character;
  intelligence: number;
  supplies: number;
  reproduction: number;
  castle: PlayerInfoPos;
}

export interface GameInfoMission {
  name: string;
  // PORT: the C++ holds a `Random` built from this 16 character string at
  // static-init time. Module top level must not touch another game module,
  // so the string is kept here and GameInfo's constructor builds the Random.
  rnd: string;
  player: PlayerInfoPreset[];
}

export type PPlayerInfo = PlayerInfo;
export type PlayerInfos = PPlayerInfo[];
export type PGameInfo = GameInfo;

export const characters: Character[] = [
  { face: 0, name: 'ERROR', characterization: 'ERROR' },
  { face: 1, name: 'Lady Amalie',
    characterization: 'An inoffensive lady, reserved, who goes about her work peacefully.' },
  { face: 2, name: 'Kumpy Onefinger',
    characterization: 'A very hostile character, who loves gold above all else.' },
  { face: 3, name: 'Balduin, a former monk',
    characterization: 'A very discrete character, who worries chiefly about the protection of his' +
    ' lands and his important buildings.' },
  { face: 4, name: 'Frollin',
    characterization: 'His unpredictable behaviour will always take you by surprise. ' +
    'He will "pilfer" away lands that are not occupied.' },
  { face: 5, name: 'Kallina',
    characterization: 'She is a fighter who attempts to block the enemy’s food supply by using ' +
    'strategic tactics.' },
  { face: 6, name: 'Rasparuk the druid',
    characterization: 'His tactics consist in amassing large stocks of raw materials. ' +
    'But he attacks slyly.' },
  { face: 7, name: 'Count Aldaba',
    characterization: 'Protect your warehouses well, because he is aggressive and knows exactly ' +
    'where he must attack.' },
  { face: 8, name: 'The King Rolph VII',
    characterization: 'He is a prudent ruler, without any particular weakness. He will try to ' +
    'check the supply of construction materials of his adversaries.' },
  { face: 9, name: 'Homen Doublehorn',
    characterization: 'He is the most aggressive enemy. Watch your buildings carefully, ' +
    'otherwise he might take you by surprise.' },
  { face: 10, name: 'Sollok the Joker',
    characterization: 'A sly and repugnant adversary, he will try to stop the supply of raw ' +
    'materials of his enemies right from the beginning of the game.' },
  { face: 11, name: 'Enemy',
    characterization: 'Last enemy.' },
  { face: 12, name: 'You',
    characterization: 'You.' },
  { face: 13, name: 'Friend',
    characterization: 'Your partner.' },
];

export const defColor: PlayerColor[] = [
  { red: 0x00, green: 0xe3, blue: 0xe3 },
  { red: 0xcf, green: 0x63, blue: 0x63 },
  { red: 0xdf, green: 0x7f, blue: 0xef },
  { red: 0xef, green: 0xef, blue: 0x8f },
  { red: 0x00, green: 0x00, blue: 0x00 },
];

// One row of a mission's player list:
// {&characters[c], intelligence, supplies, reproduction, {col, row}}
function p(
  c: number, intelligence: number, supplies: number, reproduction: number,
  col: number, row: number,
): PlayerInfoPreset {
  return { character: characters[c], intelligence, supplies, reproduction, castle: { col, row } };
}

export const tutorials: GameInfoMission[] = [
  {
    name: 'Tutorial 1',
    rnd: '3762665523225478',
    player: [
      p(12, 40, 30, 30, -1, -1),
    ],
  },
  {
    name: 'Tutorial 2',
    rnd: '1616118277634871',
    player: [
      p(12, 40, 30, 30, -1, -1),
    ],
  },
  {
    name: 'Tutorial 3',
    rnd: '2418554743842118',
    player: [
      p(12, 40, 30, 30, -1, -1),
    ],
  },
  {
    name: 'Tutorial 4',
    rnd: '4454333314864658',
    player: [
      p(12, 40, 30, 30, -1, -1),
    ],
  },
  {
    name: 'Tutorial 5',
    rnd: '4264118313621432',
    player: [
      p(12, 40, 30, 30, -1, -1),
    ],
  },
  {
    name: 'Tutorial 6',
    rnd: '2487251185361288',
    player: [
      p(12, 40, 30, 30, -1, -1),
    ],
  },
];

export const missions: GameInfoMission[] = [
  {
    name: 'START',
    rnd: '8667715887436237',
    player: [
      p(12, 40, 35, 30, -1, -1),
      p( 1, 10,  5, 30, -1, -1),
    ],
  },
  {
    name: 'STATION',
    rnd: '2831713285431227',
    player: [
      p(12, 40, 30, 40, -1, -1),
      p( 2, 12, 15, 30, -1, -1),
      p( 3, 14, 15, 30, -1, -1),
    ],
  },
  {
    name: 'UNITY',
    rnd: '4632253338621228',
    player: [
      p(12, 40, 30, 30, -1, -1),
      p( 2, 18, 10, 25, -1, -1),
      p( 4, 18, 10, 25, -1, -1),
    ],
  },
  {
    name: 'WAVE',
    rnd: '8447342476811762',
    player: [
      p(12, 40, 25, 40, -1, -1),
      p( 2, 16, 20, 30, -1, -1),
    ],
  },
  {
    name: 'EXPORT',
    rnd: '4276472414845177',
    player: [
      p(12, 40, 30, 30, -1, -1),
      p( 3, 16, 25, 20, -1, -1),
      p( 4, 16, 25, 20, -1, -1),
    ],
  },
  {
    name: 'OPTION',
    rnd: '2333577877517478',
    player: [
      p(12, 40, 30, 30, -1, -1),
      p( 3, 20, 12, 14, -1, -1),
      p( 5, 20, 12, 14, -1, -1),
    ],
  },
  {
    name: 'RECORD',
    rnd: '1416541231242884',
    player: [
      p(12, 40, 30, 40, -1, -1),
      p( 3, 22, 30, 30, -1, -1),
    ],
  },
  {
    name: 'SCALE',
    rnd: '7845187715476348',
    player: [
      p(12, 40, 25, 30, -1, -1),
      p( 4, 23, 25, 30, -1, -1),
      p( 6, 24, 25, 30, -1, -1),
    ],
  },
  {
    name: 'SIGN',
    rnd: '5185768873118642',
    player: [
      p(12, 40, 25, 40, -1, -1),
      p( 4, 26, 13, 30, -1, -1),
      p( 5, 28, 13, 30, -1, -1),
      p( 6, 30, 13, 30, -1, -1),
    ],
  },
  {
    name: 'ACORN',
    rnd: '3183215728814883',
    player: [
      p(12, 40, 20, 16, 28, 14),
      p( 4, 30, 19, 20,  5, 47),
    ],
  },
  {
    name: 'CHOPPER',
    rnd: '4376241846215474',
    player: [
      p(12, 40, 16, 20, 16, 42),
      p( 5, 33, 10, 20, 52, 25),
      p( 7, 34, 13, 20, 23, 12),
    ],
  },
  {
    name: 'GATE',
    rnd: '6371557668231277',
    player: [
      p(12, 40, 23, 27, 53, 13),
      p( 5, 27, 17, 24, 27, 10),
      p( 6, 27, 13, 24, 29, 38),
      p( 7, 27, 13, 24, 15, 32),
    ],
  },
  {
    name: 'ISLAND',
    rnd: '8473352672411117',
    player: [
      p(12, 40, 24, 20,  7, 26),
      p( 5, 20, 30, 20,  2, 10),
    ],
  },
  {
    name: 'LEGION',
    rnd: '1167854231884464',
    player: [
      p(12, 40, 20, 23, 19,  3),
      p( 6, 28, 16, 20, 55,  7),
      p( 8, 28, 16, 20, 55, 46),
    ],
  },
  {
    name: 'PIECE',
    rnd: '2571462671725414',
    player: [
      p(12, 40, 20, 17, 41,  5),
      p( 6, 40, 23, 20, 19, 49),
      p( 7, 37, 20, 20, 58, 52),
      p( 8, 40, 15, 15, 43, 31),
    ],
  },
  {
    name: 'RIVAL',
    rnd: '4563653871271587',
    player: [
      p(12, 40, 26, 23, 36, 63),
      p( 6, 28, 29, 40, 14, 15),
    ],
  },
  {
    name: 'SAVAGE',
    rnd: '7212145428156114',
    player: [
      p(12, 40, 25, 12, 63, 59),
      p( 7, 29, 17, 10, 29, 24),
      p( 8, 29, 17, 10, 39, 26),
      p( 9, 32, 17, 10, 42, 49),
    ],
  },
  {
    name: 'XAVER',
    rnd: '4276472414435177',
    player: [
      p(12, 40, 25, 40, 15,  0),
      p( 7, 40, 30, 35, 34, 48),
      p( 9, 30, 30, 35, 58,  5),
    ],
  },
  {
    name: 'BLADE',
    rnd: '7142748441424786',
    player: [
      p(12, 40, 30, 20, 13, 37),
      p( 7, 40, 20, 20, 32, 34),
    ],
  },
  {
    name: 'BEACON',
    rnd: '6882188351133886',
    player: [
      p(12, 40,  9, 10, 14, 42),
      p( 8, 40, 16, 22, 62,  1),
      p( 9, 40, 16, 23, 32, 14),
    ],
  },
  {
    name: 'PASTURE',
    rnd: '7742136435163436',
    player: [
      p(12, 40, 20, 11, 38, 17),
      p( 8, 30, 22, 13, 32, 51),
      p( 9, 30, 23, 13,  1, 50),
      p(10, 30, 21, 13,  4,  9),
    ],
  },
  {
    name: 'OMNUS',
    rnd: '6764387728224725',
    player: [
      p(12, 40, 20, 40, 42, 20),
      p( 8, 36, 25, 40, 48, 47),
    ],
  },
  {
    name: 'TRIBUTE',
    rnd: '5848744734731253',
    player: [
      p(12, 40,  5, 11, 53,  1),
      p( 9, 35, 30, 10, 20,  2),
      p(10, 37, 30, 10, 16, 55),
    ],
  },
  {
    name: 'FOUNTAIN',
    rnd: '6183541838474434',
    player: [
      p(12, 40, 20, 12,  3, 34),
      p( 9, 30, 25, 10, 47, 41),
      p(10, 30, 26, 10, 42, 52),
    ],
  },
  {
    name: 'CHUDE',
    rnd: '7633126817245833',
    player: [
      p(12, 40, 20, 40, 23, 38),
      p( 9, 40, 25, 40, 57, 52),
    ],
  },
  {
    name: 'TRAILER',
    rnd: '5554144773646312',
    player: [
      p(12, 40, 20, 30, 29, 11),
      p(10, 38, 30, 35, 15, 40),
    ],
  },
  {
    name: 'CANYON',
    rnd: '3122431112682557',
    player: [
      p(12, 40, 18, 28, 49, 53),
      p(10, 39, 25, 40, 14, 53),
    ],
  },
  {
    name: 'REPRESS',
    rnd: '2568412624848266',
    player: [
      p(12, 40, 20, 40, 44, 39),
      p(10, 39, 25, 40, 44, 63),
    ],
  },
  {
    name: 'YOKI',
    rnd: '3736685353284538',
    player: [
      p(12, 40,  5, 22, 53,  8),
      p(11, 40, 15, 20, 30, 22),
    ],
  },
  {
    name: 'PASSIVE',
    rnd: '5471458635555317',
    player: [
      p(12, 40,  5, 20, 25, 46),
      p(11, 40, 20, 20, 51, 42),
    ],
  },
];

export class PlayerInfo {
  protected intelligence: number;
  protected supplies: number;
  protected reproduction: number;
  protected face: number;
  protected color: PlayerColor;
  protected name: string;
  protected characterization: string;
  protected castlePos: PlayerInfoPos;
  // EXT: the team of the player (TEAM_NONE, TEAM_A, TEAM_B of game.ts).
  protected team = 0;

  // PlayerInfo(Random *random_base)
  // PlayerInfo(character, _color, _intelligence, _supplies, _reproduction)
  constructor(randomBase: Random);
  constructor(character: number, _color: PlayerColor, _intelligence: number,
              _supplies: number, _reproduction: number);
  constructor(a: Random | number, _color?: PlayerColor, _intelligence?: number,
              _supplies?: number, _reproduction?: number) {
    this.intelligence = 0;
    this.supplies = 0;
    this.reproduction = 0;
    this.face = 0;
    this.color = { red: 0, green: 0, blue: 0 };
    this.name = '';
    this.characterization = '';
    this.castlePos = { col: 0, row: 0 };
    if (a instanceof Random) {
      const randomBase = a;
      const character = (((randomBase.random() * 10) >> 16) + 1) & 0xff;
      this.setCharacter(character);
      this.setIntelligence(((randomBase.random() * 41) >> 16) & 0xff);
      this.setSupplies(((randomBase.random() * 41) >> 16) & 0xff);
      this.setReproduction(((randomBase.random() * 41) >> 16) & 0xff);
      this.setCastlePos({ col: -1, row: -1 });
    } else {
      this.setCharacter(a);
      this.setIntelligence(_intelligence!);
      this.setSupplies(_supplies!);
      this.setReproduction(_reproduction!);
      this.setColor(_color!);
      this.setCastlePos({ col: -1, row: -1 });
    }
  }

  setIntelligence(_intelligence: number): void {
    this.intelligence = _intelligence;
  }
  setSupplies(_supplies: number): void {
    this.supplies = _supplies;
  }
  setReproduction(_reproduction: number): void {
    this.reproduction = _reproduction;
  }

  setCastlePos(_castlePos: PlayerInfoPos): void {
    this.castlePos = { col: _castlePos.col, row: _castlePos.row };
  }

  setCharacter(character: number): void {
    this.face = characters[character].face;
    this.name = characters[character].name;
    this.characterization = characters[character].characterization;
  }

  setColor(_color: PlayerColor): void {
    this.color = { red: _color.red, green: _color.green, blue: _color.blue };
  }

  getIntelligence(): number {
    return this.intelligence;
  }
  getSupplies(): number {
    return this.supplies;
  }
  getReproduction(): number {
    return this.reproduction;
  }
  getFace(): number {
    return this.face;
  }
  getColor(): PlayerColor {
    return { red: this.color.red, green: this.color.green, blue: this.color.blue };
  }
  getCastlePos(): PlayerInfoPos {
    return { col: this.castlePos.col, row: this.castlePos.row };
  }

  hasCastle(): boolean {
    return this.castlePos.col >= 0;
  }

  // EXT: teams.
  getTeam(): number {
    return this.team;
  }
  setTeam(team: number): void {
    this.team = team;
  }
}

export class GameInfo {
  protected mapSize: number;
  protected randomBase: Random;
  protected players: PlayerInfos;
  protected name: string;
  protected gameType: number; /* Game::GameType */
  protected level: number;
  // EXT: the game options (GameRules of game.ts). Missions and tutorials
  // keep the defaults and no teams.
  protected rules: GameRules = { stockPreset: 0, peaceMinutes: 0, busyRoads: false,
                                 trading: false, aiLevel: 0 };

  // PORT: `static Mission mission[]` is declared in mission.h but never
  // defined or used; the tables are the file-level `missions` and `tutorials`.

  // GameInfo(const Random &random_base)
  // GameInfo(const Mission *mission_preset)
  // PORT: the Mission constructor is protected in the C++. A TS constructor
  // has one visibility, so both forms are public.
  constructor(arg: Random | GameInfoMission) {
    this.players = [];
    if (arg instanceof Random) {
      const _randomBase = arg;
      this.mapSize = 3;
      this.randomBase = new Random(_randomBase);
      this.name = _randomBase.toString();
      this.gameType = GameGameType.GameTypeOnePlayer;
      this.level = 0;
      this.setRandomBase(_randomBase);
    } else {
      const missionPreset = arg;
      this.gameType = GameGameType.GameTypeMission;
      this.level = 0;
      this.mapSize = 3;
      this.name = missionPreset.name;
      this.randomBase = new Random(missionPreset.rnd);
      for (let i = 0; i < missionPreset.player.length; i++) {
        const playerInfo = missionPreset.player[i];
        const character = playerInfo.character.face;
        const player = new PlayerInfo(character,
                                      defColor[i],
                                      playerInfo.intelligence,
                                      playerInfo.supplies,
                                      playerInfo.reproduction);
        player.setCastlePos(playerInfo.castle);
        this.addPlayer(player);
      }
    }
  }

  getMapSize(): number {
    return this.mapSize;
  }
  setMapSize(size: number): void {
    this.mapSize = size;
  }
  getRandomBase(): Random {
    return new Random(this.randomBase);
  }

  setRandomBase(base: Random): void {
    const random = new Random(base);
    this.randomBase = new Random(base);

    this.players = [];

    // Player 0
    this.players.push(new PlayerInfo(random));
    this.players[0].setCharacter(12);
    this.players[0].setIntelligence(40);

    // Player 1
    this.players.push(new PlayerInfo(random));

    const val = u32(random.random());
    if ((val & 7) !== 0) {
      // Player 2
      this.players.push(new PlayerInfo(random));
      const val = u32(random.random());
      if ((val & 3) === 0) {
        // Player 3
        this.players.push(new PlayerInfo(random));
      }
    }

    this.setDefaultColors();
  }

  getPlayerCount(): number {
    return this.players.length;
  }
  getPlayer(player: number): PPlayerInfo {
    return this.players[player];
  }

  /* Give each player the color of its position (blue, red, violet,
     yellow). */
  setDefaultColors(): void {
    for (let i = 0; i < this.players.length && i < 4; i++) {
      this.players[i].setColor(defColor[i]);
    }
  }

  // add_player(const PPlayerInfo &player)
  // add_player(character, _color, _intelligence, _supplies, _reproduction)
  addPlayer(player: PPlayerInfo): void;
  addPlayer(character: number, _color: PlayerColor, _intelligence: number,
            _supplies: number, _reproduction: number): void;
  addPlayer(a: PPlayerInfo | number, _color?: PlayerColor, _intelligence?: number,
            _supplies?: number, _reproduction?: number): void {
    if (a instanceof PlayerInfo) {
      this.players.push(a);
    } else {
      const player = new PlayerInfo(a, _color!, _intelligence!, _supplies!, _reproduction!);
      this.addPlayer(player);
    }
  }

  removePlayer(index: number): void {
    if (index >= this.players.length) {
      return;
    }
    this.players.splice(index, 1);
  }

  removeAllPlayers(): void {
    this.players = [];
  }

  // EXT: game options.
  getRules(): GameRules {
    return { ...this.rules };
  }
  setRules(rules: GameRules): void {
    this.rules = { ...rules };
  }
  /* EXT: whether this game takes options and teams: a custom game does,
     a mission and a tutorial do not. */
  hasExtensions(): boolean {
    return this.gameType !== GameGameType.GameTypeMission &&
           this.gameType !== GameGameType.GameTypeTutorial;
  }

  getGameType(): number {
    return this.gameType;
  }
  getLevel(): number {
    return this.level;
  }
  getName(): string {
    return this.name;
  }

  static getMission(m: number): PGameInfo | null {
    if (m >= GameInfo.getMissionCount()) {
      return null;
    }

    const mission = new GameInfo(missions[m]);
    mission.level = u32(m);
    return mission;
  }

  static getMissionCount(): number {
    return missions.length;
  }

  /* Tutorials 1-6 (Amiga mission_table entries 0..5): one human player,
     castle placed by the player. */
  static getTutorial(t: number): PGameInfo | null {
    if (t >= GameInfo.getTutorialCount()) {
      return null;
    }

    const tutorial = new GameInfo(tutorials[t]);
    tutorial.gameType = GameGameType.GameTypeTutorial;
    tutorial.level = u32(t + 1);
    return tutorial;
  }

  static getTutorialCount(): number {
    return tutorials.length;
  }

  static getCharacter(character: number): Character | null {
    if (character >= GameInfo.getCharacterCount()) {
      return null;
    }

    return characters[character];
  }

  static getCharacterCount(): number {
    return characters.length;
  }

  instantiate(): Game | null {
    const game = new Game();

    if (!game.init(this.mapSize, this.randomBase)) {
      return null;
    }
    game.setGameType(this.gameType, this.level);
    // EXT: the options before the first castle, which takes its stock by them.
    if (this.hasExtensions()) game.setRules(this.rules);

    /* Initialize player and build initial castle */
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

    if (this.gameType === GameGameType.GameTypeTutorial && this.level === 6) {
      game.initTutorialEnemy(defColor[1]);
    }

    return game;
  }
}
