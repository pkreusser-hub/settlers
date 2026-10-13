// The game setup window of the start screen: the HTML form of the canvas
// GameInitBox (game-init.ts). A new game (map size, seed, players), the
// missions and the tutorials for one player, and for the host of an online
// game a new game or a saved one for the people in the room. Not part of
// Freeserf.
//
// SetupModel does what GameInitBox.handleAction() and handlePlayerClick()
// do, step for step, and hands the same GameInfo to the same calls:
// GameManager.startGame(), and online OnlineHostHooks.start() and
// startSaved(). Change the two together.

import {
  Game,
  GAME_MAX_PLAYER_COUNT,
  PEACE_MINUTES_CHOICES,
  STOCK_NORMAL,
  STOCK_POOR,
  STOCK_RICH,
  TEAM_A,
  TEAM_B,
  TEAM_NONE,
} from '../../game/game';
import { GameManager } from '../../game/game-manager';
import { Map as GameMap, MapGeometry } from '../../game/map';
import {
  ClassicMapGenerator,
  ClassicMissionMapGenerator,
  MapGenerator,
} from '../../game/map-generator';
import { characters, GameInfo } from '../../game/mission';
import type { PGameInfo, PPlayerInfo } from '../../game/mission';
import { Random } from '../../game/random';
import { GameStore } from '../../game/savegame';
import type { GameStoreSaveEntry } from '../../game/savegame';
import type { OnlineHostHooks } from '../game-init';
import type { Interface } from '../interface';
import { Minimap } from '../minimap';
import { PopupBoxType } from '../popup';
import type { MenuWindow, Widget, WindowTab } from './kit';
import { stockPresetName, teamName } from './names';
import {
  characterName,
  listBox,
  messageLine,
  para,
  playerColorName,
  textField,
  tutorialOrders,
} from './start';
import type { StartPage } from './start';
import {
  button, el, faceCanvas, hint, meter, section, segmented, slider, stepper, toggle,
} from './widgets';

/* What the window sets up: the game types of the canvas box. 'saved' is its
   load type, which the window only has for the host of an online game (a
   solo player loads from the saved games panel). */
export type SetupMode = 'custom' | 'mission' | 'tutorial' | 'saved';

/* GAME OPTIONS. The rules of a game that are neither the map nor a player:
   starting stock presets, a peace timer, victory rules. A new option gets a
   field here, a widget in gameOptionsSection() and its way into the game in
   SetupModel.start(). What belongs to one player (team, alliance) goes in
   slotOptions() and is kept in the PlayerInfo of the place. The fields are
   the GameRules of game.ts. */
export interface GameOptions {
  /* STOCK_NORMAL, STOCK_POOR or STOCK_RICH. */
  stockPreset: number;
  /* One of PEACE_MINUTES_CHOICES; 0 is no peace. */
  peaceMinutes: number;
  /* EXT: extra carriers on busy roads. */
  busyRoads: boolean;
}

const MAP_SIZE_MIN = 3;
const MAP_SIZE_MAX = 10;
const SEED_LENGTH = 16;

export class SetupModel {
  mode: SetupMode = 'custom';
  gameMission = 0;
  gameTutorial = 0;
  /* The game of the 'custom' mode; `mission` is what Start starts. */
  customMission: PGameInfo;
  mission: PGameInfo;
  /* The text of the seed field; it counts once it is applied. */
  seedText: string;
  /* The saved game of the 'saved' mode. */
  savedPath = '';
  readonly options: GameOptions = {
    stockPreset: STOCK_NORMAL,
    peaceMinutes: 0,
    busyRoads: false,
  };

  constructor(readonly online: OnlineHostHooks | null) {
    /* The constructor of GameInitBox. */
    this.customMission = new GameInfo(new Random());
    this.customMission.removeAllPlayers();
    this.customMission.addPlayer(12, { red: 0x00, green: 0xe3, blue: 0xe3 }, 40, 40, 40);
    if (online !== null) {
      /* The guests: human players ('Friend') with the host's values. */
      for (let i = 1; i < online.humans; i++) {
        this.customMission.addPlayer(13, { red: 0, green: 0, blue: 0 }, 40, 40, 40);
      }
      this.customMission.setDefaultColors();
    } else {
      this.customMission.addPlayer(1, { red: 0xcf, green: 0x63, blue: 0x63 }, 20, 30, 40);
    }
    this.mission = this.customMission;
    this.seedText = this.customMission.getRandomBase().toString();
  }

  /* ActionToggleGameType, with the type named. */
  setMode(mode: SetupMode): void {
    this.mode = mode;
    switch (mode) {
      case 'mission':
        this.mission = GameInfo.getMission(this.gameMission) as PGameInfo;
        break;
      case 'tutorial':
        this.mission = GameInfo.getTutorial(this.gameTutorial) as PGameInfo;
        break;
      case 'custom':
        this.mission = this.customMission;
        this.seedText = this.customMission.getRandomBase().toString();
        break;
      case 'saved':
        break;
    }
  }

  /* ActionIncrement and ActionDecrement of the missions and tutorials. */
  selectMission(index: number): void {
    this.gameMission = Math.max(0, Math.min(index, GameInfo.getMissionCount() - 1));
    this.mission = GameInfo.getMission(this.gameMission) as PGameInfo;
  }

  selectTutorial(index: number): void {
    this.gameTutorial = Math.max(0, Math.min(index, GameInfo.getTutorialCount() - 1));
    this.mission = GameInfo.getTutorial(this.gameTutorial) as PGameInfo;
  }

  /* ActionIncrement and ActionDecrement of the custom game. */
  setMapSize(size: number): void {
    this.customMission.setMapSize(Math.max(MAP_SIZE_MIN, Math.min(MAP_SIZE_MAX, size)));
  }

  /* ActionGenRandom: a new seed in the field, not applied. */
  generateSeed(): void {
    this.seedText = new Random().toString();
  }

  appliedSeed(): string {
    return this.customMission.getRandomBase().toString();
  }

  canApplySeed(): boolean {
    return /^[1-8]{16}$/.test(this.seedText);
  }

  /* ActionApplyRandom: the seed makes the map and the players. */
  applySeed(): boolean {
    if (!this.canApplySeed()) return false;
    this.customMission.setRandomBase(new Random(this.seedText));
    if (this.online !== null) {
      /* The random base made the players after the host computer players,
         two to four of them: the first are the guests, with the host's
         values. */
      const host: PPlayerInfo = this.customMission.getPlayer(0);
      for (let i = 1; i < this.online.humans; i++) {
        if (i >= this.customMission.getPlayerCount()) {
          this.customMission.addPlayer(13, { red: 0, green: 0, blue: 0 }, 40, 40, 40);
        }
        const guest: PPlayerInfo = this.customMission.getPlayer(i);
        guest.setCharacter(13);
        guest.setIntelligence(host.getIntelligence());
        guest.setSupplies(host.getSupplies());
        guest.setReproduction(host.getReproduction());
      }
      this.customMission.setDefaultColors();
    }
    this.mission = this.customMission;
    this.onTeamsChange?.();
    return true;
  }

  /* The host and the guests keep their faces and their places. */
  isPerson(index: number): boolean {
    return this.online !== null && index < this.online.humans;
  }

  /* The faces the player can take: every face no other player has (what
     the clicks on the face of the canvas box cycle through). */
  freeFaces(index: number): number[] {
    const faces: number[] = [];
    for (let face = 1; face < 14; face++) {
      let inUse = false;
      for (let i = 0; i < this.mission.getPlayerCount(); i++) {
        if (i !== index && this.mission.getPlayer(i).getFace() === face) inUse = true;
      }
      if (!inUse) faces.push(face);
    }
    return faces;
  }

  /* getNextCharacter() of the canvas box. */
  nextFace(index: number): number {
    let next = this.mission.getPlayer(index).getFace();
    const free = this.freeFaces(index);
    do {
      next = Math.max(1, (next + 1) % 14);
    } while (!free.includes(next));
    return next;
  }

  setFace(index: number, face: number): boolean {
    if (this.mode !== 'custom' || index >= this.mission.getPlayerCount()) return false;
    if (this.isPerson(index) || !this.freeFaces(index).includes(face)) return false;
    this.mission.getPlayer(index).setCharacter(face);
    return true;
  }

  canAddPlayer(): boolean {
    return this.mode === 'custom' && this.mission.getPlayerCount() < GAME_MAX_PLAYER_COUNT;
  }

  /* The click on the corner of an empty place. */
  addPlayer(): boolean {
    if (!this.canAddPlayer()) return false;
    this.mission.addPlayer(0, { red: 0, green: 0, blue: 0 }, 20, 20, 20);
    this.mission.setDefaultColors();
    const index = this.mission.getPlayerCount() - 1;
    this.mission.getPlayer(index).setCharacter(this.nextFace(index));
    this.onTeamsChange?.();
    return true;
  }

  canRemovePlayer(index: number): boolean {
    return this.mode === 'custom' && index < this.mission.getPlayerCount() &&
      index > (this.online !== null ? this.online.humans - 1 : 0);
  }

  /* The click on the corner of a taken place. */
  removePlayer(index: number): boolean {
    if (!this.canRemovePlayer(index)) return false;
    this.mission.removePlayer(index);
    this.mission.setDefaultColors();
    this.onTeamsChange?.();
    return true;
  }

  /* The team of a place, in a custom game. */
  setTeam(index: number, team: number): boolean {
    if (this.mode !== 'custom' || index >= this.mission.getPlayerCount()) return false;
    this.mission.getPlayer(index).setTeam(team);
    this.onTeamsChange?.();
    return true;
  }

  /* Told when a team or the players change: the summary of the teams in
     the game options. */
  onTeamsChange: (() => void) | null = null;

  /* The places by team, for the summary: [no team, team A, team B]. */
  teams(): number[][] {
    const teams: number[][] = [[], [], []];
    for (let i = 0; i < this.mission.getPlayerCount(); i++) {
      teams[this.mission.getPlayer(i).getTeam()]?.push(i);
    }
    return teams;
  }

  /* Why the teams as they are make no game, or ''. */
  teamProblem(): string {
    if (this.mode !== 'custom') return '';
    const [, a, b] = this.teams();
    const count = this.mission.getPlayerCount();
    if (count > 1 && (a.length === count || b.length === count)) {
      return 'All players are in one team. Put at least one player in another team or in no team.';
    }
    return '';
  }

  /* ActionStartGame. */
  start(iface: Interface): boolean {
    /* GAME OPTIONS: a custom game takes them, a mission and a tutorial keep
       the defaults. A saved game has its own. */
    if (this.mode === 'custom') {
      if (this.teamProblem() !== '') return false;
      this.mission.setRules({ ...this.options });
    }
    if (this.online !== null) {
      if (this.mode === 'saved') {
        if (this.savedPath.length === 0 || !this.online.startSaved(this.savedPath)) return false;
      } else if (!this.online.start(this.mission)) {
        return false;
      }
      iface.closeGameInit();
      return true;
    }
    if (this.mode === 'saved') return false;
    if (!GameManager.getInstance().startGame(this.mission)) return false;

    const tutorial = this.mode === 'tutorial';
    iface.closeGameInit();
    if (tutorial) iface.openPopup(PopupBoxType.TypeTutorialOrders);
    return true;
  }
}

// ---------------------------------------------------------------------------
// The map preview.

/* The colours the minimap of the game gives the fields of a map
   (Minimap.initMinimap), one per field in the order of the positions. */
class FieldColors extends Minimap {
  colors(): { r: number; g: number; b: number }[] {
    return this.minimap as unknown as { r: number; g: number; b: number }[];
  }
}

/* The map the game would make: generateMapPreview() of the canvas box. */
function generateMap(model: SetupModel): GameMap | null {
  if (model.mode === 'saved') {
    if (model.savedPath.length === 0) return null;
    const game = new Game();
    return GameStore.getInstance().load(model.savedPath, game) ? game.getMap() : null;
  }
  const map = new GameMap(new MapGeometry(model.mission.getMapSize()));
  if (model.mode === 'mission' || model.mode === 'tutorial') {
    const generator = new ClassicMissionMapGenerator(map, model.mission.getRandomBase());
    generator.init();
    generator.generate();
    map.initTiles(generator);
  } else {
    const generator = new ClassicMapGenerator(map, model.mission.getRandomBase());
    generator.init(MapGenerator.HeightGenerator.HeightGeneratorMidpoints, true);
    generator.generate();
    map.initTiles(generator);
  }
  return map;
}

/* Draw the whole map once, one pixel a field, as the minimap of the game
   places the fields at scale 1: each row half a field further left
   (Minimap.drawMinimapPoint). */
function drawMap(canvas: HTMLCanvasElement, map: GameMap): void {
  const source = new FieldColors(map);
  const colors = source.colors();
  source.destroy();
  const cols = map.getCols();
  const rows = map.getRows();
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const image = ctx.createImageData(cols, rows);
  let i = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const color = colors[i++];
      const x = (((col - (row >> 1)) % cols) + cols) % cols;
      const at = (row * cols + x) * 4;
      image.data[at] = color.r;
      image.data[at + 1] = color.g;
      image.data[at + 2] = color.b;
      image.data[at + 3] = 0xff;
    }
  }
  ctx.putImageData(image, 0, 0);
}

interface Preview {
  el: HTMLElement;
  /* Make and draw the map of the model; a moment later, so that the click
     shows first. */
  request(): void;
  dispose(): void;
}

function mapPreview(model: SetupModel): Preview {
  const root = el('figure', 'su-preview');
  const canvas = document.createElement('canvas');
  canvas.className = 'su-preview-map';
  canvas.setAttribute('role', 'img');
  canvas.width = 64;
  canvas.height = 64;
  const caption = el('figcaption', 'su-preview-caption');
  root.append(canvas, caption);
  let timer = 0;
  let shown = '';

  const request = (): void => {
    const key = model.mode === 'saved'
      ? `saved|${model.savedPath}`
      : `${model.mode}|${model.mission.getMapSize()}|${model.mission.getRandomBase().toString()}`;
    if (key === shown) return;
    shown = key;
    window.clearTimeout(timer);
    caption.textContent = 'Drawing the map.';
    timer = window.setTimeout(() => {
      let map: GameMap | null = null;
      try {
        map = generateMap(model);
      } catch {
        map = null;
      }
      if (map === null) {
        canvas.hidden = true;
        caption.textContent = model.mode === 'saved' && model.savedPath.length > 0
          ? 'This saved game has no map to show.'
          : 'No map to show.';
        return;
      }
      canvas.hidden = false;
      drawMap(canvas, map);
      const text = `${map.getCols()} by ${map.getRows()} fields. Blue is water, green is grass, ` +
        'brown is mountain and desert, white is snow.';
      canvas.setAttribute('aria-label', `Map preview, ${map.getCols()} by ${map.getRows()} fields`);
      caption.textContent = text;
    }, 30);
  };

  return { el: root, request, dispose: () => window.clearTimeout(timer) };
}

// ---------------------------------------------------------------------------
// Words.

/* How big a map of the size is, in fields and against the smallest. */
export function mapSizeText(size: number): string {
  const geom = new MapGeometry(size);
  const smallest = new MapGeometry(MAP_SIZE_MIN);
  const times = geom.tileCount() / smallest.tileCount();
  const word = ['Small', 'Small', 'Medium', 'Medium', 'Large', 'Large', 'Huge', 'Huge'][size - MAP_SIZE_MIN] ?? '';
  const fields = `${geom.cols()} by ${geom.rows()} fields`;
  if (times <= 1) return `${word}: ${fields}. The smallest map, neighbours meet early.`;
  return `${word}: ${fields}, ${times} times the smallest map.`;
}

/* What the three values of a player do, from the code that uses them:
   Inventory.applySuppliesPreset(), Game.update() with
   Player.getAiIntelligence(), and Player.init() with Player.update(). */
const valueHelp = {
  supplies: 'Supplies: what the castle holds at the start. At 0 it has 7 planks and 2 stones, ' +
    'at 40 it has 200 planks, 100 stones and far more tools, food and weapons.',
  intelligence: 'Intelligence: how often a computer player acts, from one turn in five at 0 to ' +
    'every turn at 40. It does nothing for a person.',
  reproduction: 'Reproduction: how fast new settlers arrive, from one every 30 seconds at 0 to ' +
    'one every 10 seconds at 40, at normal speed.',
};

/* Player.init(): a new serf every (60 - reproduction) * 50 ticks, and the
   game counts 100 ticks a second at normal speed. */
function reproductionText(value: number): string {
  const seconds = (60 - value) / 2;
  return `${value}, a settler every ${seconds} s`;
}

/* Game.update(): a computer player acts when a random 16 bit number is
   below 1300 * intelligence + 13535. */
function intelligenceText(value: number): string {
  const share = Math.min(100, Math.round(((1300 * value + 13535) / 65536) * 100));
  return `${value}, acts in ${share}% of its turns`;
}

function timeText(time: number): string {
  if (time === 0) return '';
  try {
    return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return new Date(time).toLocaleString();
  }
}

// ---------------------------------------------------------------------------
// The window.

export interface SetupOptions {
  iface: Interface;
  mode: SetupMode;
  /* The host of an online game sets it up; null: a solo game. */
  online: OnlineHostHooks | null;
  /* A line for the host: why the setup is shown again. */
  note: string;
  /* The Back button and Escape. */
  back(): void;
}

/* The places of the players, drawn again when the players change. */
interface PlayersWidget extends Widget {
  rerender(): void;
}

/* What the lobby tells the window. */
export interface SetupHandle {
  showError(text: string): void;
  /* For the tests: the model behind the window. */
  model: SetupModel;
}

/* GAME OPTIONS of the whole game: see GameOptions. Shown under the players
   of a custom and an online game. */
function gameOptionsSection(model: SetupModel): Widget {
  const options = model.options;

  /* Inventory.applySuppliesPreset(). */
  const stockHelp = [
    'Normal: each castle starts with what the supplies of its player give.',
    'Poor: each castle starts with half of that, but never less than supplies 0 give ' +
      '(7 planks, 2 stones).',
    'Rich: each castle starts with one and a half times that.',
  ];
  const stockText = hint('');
  const stock = segmented<number>({
    label: 'Starting stock',
    options: [STOCK_POOR, STOCK_NORMAL, STOCK_RICH].map((value) => ({
      value,
      label: stockPresetName(value),
    })),
    get: () => options.stockPreset,
    set: (value) => {
      options.stockPreset = value;
      update();
    },
  });

  /* Game.isPeace(). */
  const peaceText = hint('');
  const peace = segmented<number>({
    label: 'Peace at the start',
    options: PEACE_MINUTES_CHOICES.map((value) => ({
      value,
      label: value === 0 ? 'Off' : `${value} minutes`,
    })),
    get: () => options.peaceMinutes,
    set: (value) => {
      options.peaceMinutes = value;
      update();
    },
  });

  /* EXT: Flag.extUpdateLoad(). */
  const busyRoads = toggle({
    label: 'Extra carriers on busy roads',
    get: () => options.busyRoads,
    set: (on) => {
      options.busyRoads = on;
      update();
    },
  });
  const busyRoadsText = hint(
    'A road where goods keep piling up gets one more carrier than its length allows.');

  /* Game.updateTeamWinner() and Game.updateWinner(). */
  const teamText = hint('');
  const problem = el('p', 'su-team-problem');
  problem.setAttribute('role', 'status');

  const names = (places: number[]): string => places.map((i) => playerColorName(i)).join(', ');
  let shown = '';
  /* A function declaration: the controls above call it. */
  function update(): void {
    stock.update?.();
    peace.update?.();
    busyRoads.update?.();
    const [none, a, b] = model.teams();
    const key = `${options.stockPreset}|${options.peaceMinutes}|${none}|${a}|${b}`;
    if (key === shown) return;
    shown = key;
    stockText.textContent = stockHelp[options.stockPreset] ?? '';
    peaceText.textContent = options.peaceMinutes === 0
      ? 'Attacks are allowed from the start.'
      : `Nobody can attack in the first ${options.peaceMinutes} minutes of game time. ` +
        'At a higher game speed they pass faster.';
    if (a.length === 0 && b.length === 0) {
      teamText.textContent = 'No teams: everyone plays alone. Set a team at each player above.';
    } else {
      const parts: string[] = [];
      if (a.length > 0) parts.push(`${teamName(TEAM_A)}: ${names(a)}.`);
      if (b.length > 0) parts.push(`${teamName(TEAM_B)}: ${names(b)}.`);
      if (none.length > 0) parts.push(`No team: ${names(none)}.`);
      teamText.textContent = `${parts.join(' ')} Allies cannot attack each other. A team wins ` +
        'together when every other player has lost the castle, or when the team leads ' +
        'clearly in land and knights.';
    }
    problem.textContent = model.teamProblem();
    problem.hidden = problem.textContent === '';
  }
  update();
  model.onTeamsChange = update;

  const root = section('Game options', stock, stockText, peace, peaceText,
    busyRoads, busyRoadsText,
    el('div', 'mk-label su-team-title', 'Teams'), teamText, problem);
  return { el: root.el, update };
}

/* GAME OPTIONS of one player (team, alliance): rows at the end of the
   player's place. See GameOptions. Only a custom game has teams. */
function slotOptions(model: SetupModel, index: number): (Widget | HTMLElement)[] {
  if (model.mode !== 'custom' || index >= model.mission.getPlayerCount()) return [];
  const info = model.mission.getPlayer(index);
  const team = segmented<number>({
    label: 'Team',
    options: [
      { value: TEAM_NONE, label: 'No team', title: 'Plays alone' },
      { value: TEAM_A, label: 'A', title: teamName(TEAM_A) },
      { value: TEAM_B, label: 'B', title: teamName(TEAM_B) },
    ],
    get: () => info.getTeam(),
    set: (value) => { model.setTeam(index, value); },
  });
  team.el.classList.add('su-team');
  return [team];
}

export function setupPage(options: SetupOptions): { page: StartPage; handle: SetupHandle } {
  const { iface, online } = options;
  const model = new SetupModel(online);
  model.setMode(options.mode);
  let showError: (text: string) => void = () => undefined;

  const build = (win: MenuWindow): (() => void) => {
    const error = messageLine('error');
    showError = (text) => { error.textContent = text; };
    const preview = mapPreview(model);
    /* The widgets of the part that is drawn again. */
    let live: Widget[] = [];
    win.track({
      el: win.body,
      update: () => live.forEach((w) => w.update?.()),
      dispose: () => live.forEach((w) => w.dispose?.()),
    });
    const add = (parent: HTMLElement, ...items: (Widget | HTMLElement)[]): void => {
      for (const item of items) {
        if (item instanceof HTMLElement) {
          parent.append(item);
        } else {
          parent.append(item.el);
          live.push(item);
        }
      }
    };
    const refresh = (): void => live.forEach((w) => w.update?.());

    const modes: { mode: SetupMode; label: string }[] = online !== null
      ? [{ mode: 'custom', label: 'New game' }, { mode: 'saved', label: 'Saved game' }]
      : [
        { mode: 'custom', label: 'New game' },
        { mode: 'mission', label: 'Missions' },
        { mode: 'tutorial', label: 'Tutorials' },
      ];

    const start = (): void => {
      error.textContent = '';
      if (!model.start(iface) && error.textContent === '') {
        if (model.teamProblem() !== '') {
          error.textContent = model.teamProblem();
        } else {
          error.textContent = model.mode === 'saved' && model.savedPath.length === 0
            ? 'Choose a saved game first.'
            : 'The game could not be started.';
        }
      }
    };

    // ---- The places of the players ----

    /* One place: the face on the colour of the place, who it is, and the
       three values. `edit`: the custom game, where they can be changed. */
    const slot = (index: number, edit: boolean, renderSlots: (focus: string) => void): HTMLElement => {
      const card = el('div', 'su-slot');
      const count = model.mission.getPlayerCount();
      const colorName = playerColorName(index);

      if (index >= count) {
        card.classList.add('su-slot-empty');
        const head = el('div', 'su-slot-head');
        head.append(faceCanvas(0, null));
        const who = el('div', 'su-slot-who');
        who.append(el('span', 'su-slot-name', 'Empty'), el('span', 'su-slot-role', `Place ${index + 1}, ${colorName.toLowerCase()}`));
        head.append(who);
        card.append(head);
        if (edit && index === count && model.canAddPlayer()) {
          const addButton = button('Add computer player', () => {
            if (model.addPlayer()) renderSlots(`face${index}`);
          });
          addButton.dataset.key = 'add';
          card.append(addButton);
        }
        return card;
      }

      const info = model.mission.getPlayer(index);
      const face = info.getFace();
      const person = model.isPerson(index);
      const computer = face >= 1 && face < 12;

      let name = characterName(face);
      let role: string;
      if (online !== null && person) {
        name = index === 0 ? 'You' : `Player ${index + 1}`;
        role = index === 0 ? 'Host, a person' : 'Guest, a person';
      } else if (computer) {
        role = index === 0 && online === null ? 'The computer plays your place' : 'Computer player';
      } else if (index === 0) {
        role = 'You play';
      } else {
        role = 'Nobody plays this place';
      }

      const head = el('div', 'su-slot-head');
      head.append(faceCanvas(face, info.getColor()));
      const who = el('div', 'su-slot-who');
      who.append(
        el('span', 'su-slot-name', name),
        el('span', 'su-slot-role', `${role}. ${colorName}.`),
      );
      head.append(who);
      card.append(head);

      if (computer) {
        card.append(el('p', 'su-slot-text', characters[face].characterization));
      } else if (!person && index > 0 && edit) {
        card.append(el('p', 'su-slot-text', 'A face of a person. In the game, J switches you to this place.'));
      }
      if (info.hasCastle()) {
        card.append(el('p', 'su-slot-text', 'The castle is already built.'));
      }

      if (edit && !person) {
        const id = `su-face-${index}`;
        const row = el('div', 'su-face');
        const label = el('label', 'su-face-label', 'Character');
        label.htmlFor = id;
        const select = el('select', 'su-select');
        select.id = id;
        select.dataset.key = `face${index}`;
        for (const free of model.freeFaces(index)) {
          const option = document.createElement('option');
          option.value = String(free);
          option.textContent = free < 12 ? characterName(free) : `${characterName(free)} (a person)`;
          option.selected = free === face;
          select.append(option);
        }
        select.addEventListener('change', () => {
          if (model.setFace(index, Number(select.value))) renderSlots(`face${index}`);
        });
        row.append(label, select);
        card.append(row);
      }

      const values: {
        label: string; get: () => number; set: (v: number) => void;
        format?: (v: number) => string; off?: boolean;
      }[] = [
        { label: 'Supplies', get: () => info.getSupplies(), set: (v) => info.setSupplies(v) },
        {
          label: computer ? 'Intelligence' : 'Intelligence (computer players only)',
          get: () => info.getIntelligence(),
          set: (v) => info.setIntelligence(v),
          format: computer ? intelligenceText : undefined,
          off: !computer,
        },
        {
          label: 'Reproduction',
          get: () => info.getReproduction(),
          set: (v) => info.setReproduction(v),
          format: reproductionText,
        },
      ];
      const rows = el('div', 'su-values');
      for (const value of values) {
        const format = value.format ?? ((v: number) => String(v));
        if (edit) {
          const bar = slider({
            label: value.label,
            min: 0,
            max: 40,
            get: value.get,
            set: value.set,
            format,
          });
          /* The value of a person is carried along but does nothing. */
          if (value.off === true) bar.input.disabled = true;
          add(rows, bar);
        } else {
          add(rows, meter({
            label: value.label,
            get: () => ({ fill: value.get() / 40, text: format(value.get()) }),
          }));
        }
      }
      card.append(rows);
      add(card, ...slotOptions(model, index));

      if (edit && model.canRemovePlayer(index)) {
        const remove = button('Remove', () => {
          if (model.removePlayer(index)) renderSlots('add');
        }, { kind: 'quiet', title: `Remove ${name} from the game` });
        remove.setAttribute('aria-label', `Remove ${name}`);
        card.append(remove);
      }
      return card;
    };

    /* The four places. Drawn again when a player comes, goes or changes the
       face; the key names what takes the focus then. */
    const players = (edit: boolean): PlayersWidget => {
      const host = el('div', 'su-slots');
      let mine: Widget[] = [];
      const renderSlots = (focus: string): void => {
        live = live.filter((w) => !mine.includes(w));
        mine.forEach((w) => w.dispose?.());
        const before = live.length;
        host.replaceChildren();
        for (let i = 0; i < GAME_MAX_PLAYER_COUNT; i++) {
          host.append(slot(i, edit, renderSlots));
        }
        mine = live.slice(before);
        if (focus !== '') {
          const target = host.querySelector<HTMLElement>(`[data-key="${focus}"]`) ??
            host.querySelector<HTMLElement>('select, button');
          target?.focus({ preventScroll: true });
        }
      };
      renderSlots('');
      const root = section('Players');
      if (edit) {
        const help = el('ul', 'su-help');
        help.append(
          el('li', '', valueHelp.supplies),
          el('li', '', valueHelp.intelligence),
          el('li', '', valueHelp.reproduction),
        );
        root.content.append(help);
      }
      root.content.append(host);
      return { el: root.el, rerender: () => renderSlots('') };
    };

    // ---- The pages by mode ----

    const custom = (body: HTMLElement): void => {
      if (online !== null) {
        const guests = online.humans - 1;
        body.append(para(
          `You and ${guests === 1 ? 'one guest' : `${guests} guests`} play. ` +
          'The free places can take computer players.',
        ));
      }

      const sizeText = para('', 'su-size-text');
      const seedState = messageLine('status');
      seedState.classList.add('su-seed-state');
      let playersWidget: PlayersWidget | null = null;

      const showSize = (): void => {
        sizeText.textContent = mapSizeText(model.customMission.getMapSize());
        preview.request();
      };
      const size = stepper({
        label: 'Map size',
        get: () => `${model.customMission.getMapSize()} of ${MAP_SIZE_MIN} to ${MAP_SIZE_MAX}`,
        dec: () => {
          model.setMapSize(model.customMission.getMapSize() - 1);
          showSize();
          refresh();
        },
        inc: () => {
          model.setMapSize(model.customMission.getMapSize() + 1);
          showSize();
          refresh();
        },
        canDec: () => model.customMission.getMapSize() > MAP_SIZE_MIN,
        canInc: () => model.customMission.getMapSize() < MAP_SIZE_MAX,
        decLabel: 'Smaller map',
        incLabel: 'Larger map',
      });

      const showSeed = (): void => {
        apply.disabled = !model.canApplySeed() || model.seedText === model.appliedSeed();
        if (model.seedText === model.appliedSeed()) {
          seedState.textContent = 'This seed is in use.';
        } else if (!model.canApplySeed()) {
          seedState.textContent = `A seed has ${SEED_LENGTH} digits from 1 to 8.`;
        } else {
          seedState.textContent = 'Not in use yet. Apply makes the map and the players of this seed.';
        }
      };
      const applySeed = (): void => {
        if (!model.applySeed()) return;
        showSeed();
        preview.request();
        playersWidget?.rerender();
        seed.input.focus({ preventScroll: true });
      };
      const seed = textField({
        label: 'Map seed',
        value: model.seedText,
        maxLength: SEED_LENGTH,
        allow: /[1-8]/,
        inputMode: 'numeric',
        code: true,
        onInput: (value) => {
          model.seedText = value;
          showSeed();
        },
        onEnter: () => applySeed(),
      });
      seed.input.classList.add('su-seed');
      const generate = button('Generate', () => {
        model.generateSeed();
        seed.input.value = model.seedText;
        showSeed();
      }, { title: 'Put a random seed in the field' });
      const apply = button('Apply', applySeed, { title: 'Make the map and the players of this seed' });
      const seedButtons = el('div', 'su-seed-buttons');
      seedButtons.append(generate, apply);
      seed.el.append(seedButtons);

      const mapPart = section('Map');
      add(mapPart.content, size, sizeText, seed.el, seedState);
      const top = el('div', 'su-top');
      top.append(mapPart.el, preview.el);
      body.append(top);

      playersWidget = players(true);
      add(body, playersWidget, gameOptionsSection(model));
      showSize();
      showSeed();
    };

    const fixed = (body: HTMLElement, kind: 'mission' | 'tutorial'): void => {
      const count = kind === 'mission' ? GameInfo.getMissionCount() : GameInfo.getTutorialCount();
      const items = [];
      for (let i = 0; i < count; i++) {
        const info = (kind === 'mission' ? GameInfo.getMission(i) : GameInfo.getTutorial(i)) as PGameInfo;
        if (kind === 'mission') {
          const enemies = info.getPlayerCount() - 1;
          items.push({
            label: `${i + 1}. ${info.getName()}`,
            detail: enemies === 1 ? '1 opponent' : `${enemies} opponents`,
          });
        } else {
          items.push({ label: `Tutorial ${i + 1}`, detail: tutorialOrders[i] ?? '' });
        }
      }

      const about = para('', 'su-about');
      let playersWidget: PlayersWidget | null = null;
      const showChoice = (): void => {
        if (kind === 'mission') {
          about.textContent = `Mission ${model.gameMission + 1} of ${count}, password ${model.mission.getName()}. ` +
            'You win when your opponents give up.';
        } else {
          about.textContent = `Tutorial ${model.gameTutorial + 1} of ${count}. ` +
            `Orders: ${tutorialOrders[model.gameTutorial] ?? ''}`;
        }
        preview.request();
        playersWidget?.rerender();
      };
      const list = listBox({
        label: kind === 'mission' ? 'Missions' : 'Tutorials',
        items,
        get: () => (kind === 'mission' ? model.gameMission : model.gameTutorial),
        set: (index) => {
          if (kind === 'mission') model.selectMission(index);
          else model.selectTutorial(index);
          showChoice();
        },
      });
      list.el.classList.add('su-pick');

      const pick = section(kind === 'mission' ? 'Missions' : 'Tutorials');
      add(pick.content, list, about);
      const top = el('div', 'su-top');
      top.append(pick.el, preview.el);
      body.append(top);
      playersWidget = players(false);
      add(body, playersWidget);
      showChoice();
    };

    const saved = (body: HTMLElement): void => {
      const humans = online !== null ? online.humans : 1;
      body.append(para(
        `Go on from a saved game. Its players 1 to ${humans} are you and your guests, ` +
        'whoever played them before.',
      ));
      const entries: GameStoreSaveEntry[] = GameStore.getInstance().getSavedGamesByTime();
      if (entries.length === 0) {
        model.savedPath = '';
        body.append(para('No saved games in this browser yet.'));
        return;
      }
      if (!entries.some((entry) => entry.path === model.savedPath)) model.savedPath = entries[0].path;
      const list = listBox({
        label: 'Saved games',
        items: entries.map((entry) => ({
          label: entry.name,
          detail: [entry.autosave ? 'Autosave' : '', timeText(entry.time)].filter((t) => t !== '').join(', '),
        })),
        get: () => entries.findIndex((entry) => entry.path === model.savedPath),
        set: (index) => {
          model.savedPath = entries[index].path;
          error.textContent = '';
          preview.request();
        },
      });
      list.el.classList.add('su-pick');
      const pick = section('Saved games');
      add(pick.content, list);
      const top = el('div', 'su-top');
      top.append(pick.el, preview.el);
      body.append(top);
      preview.request();
    };

    // ---- The whole window ----

    const render = (focusTab: boolean): void => {
      live.forEach((w) => w.dispose?.());
      live = [];
      error.textContent = '';
      const current = Math.max(0, modes.findIndex((m) => m.mode === model.mode));
      const tabs: WindowTab[] = modes.map((m) => ({
        label: m.label,
        select: () => {
          model.setMode(m.mode);
          render(true);
        },
      }));
      win.setTabs(tabs, current, () => undefined);

      const body = el('div', 'su-body');
      if (options.note !== '') {
        const note = messageLine('status', options.note);
        body.append(note);
      }
      let startLabel = 'Start game';
      switch (model.mode) {
        case 'custom':
          custom(body);
          break;
        case 'mission':
          fixed(body, 'mission');
          startLabel = 'Start mission';
          break;
        case 'tutorial':
          fixed(body, 'tutorial');
          startLabel = 'Start tutorial';
          break;
        case 'saved':
          saved(body);
          startLabel = 'Start saved game';
          break;
      }
      win.body.replaceChildren(body);
      win.body.scrollTop = 0;

      const go = button(startLabel, start, { kind: 'primary' });
      go.dataset.key = 'start';
      if (model.mode === 'saved' && model.savedPath.length === 0) go.disabled = true;
      const back = button(online !== null ? 'Back to the room' : 'Back to the menu', options.back);
      win.foot().replaceChildren(error, go, back);
      refresh();
      if (focusTab) win.getSelectedTab()?.focus({ preventScroll: true });
    };

    win.setTitle(online !== null ? 'Online game' : 'Game setup');
    render(false);
    /* The tab of the page first: the arrows change the page from there. */
    win.initialFocus = win.getSelectedTab();
    return () => preview.dispose();
  };

  return {
    page: {
      title: online !== null ? 'Online game' : 'Game setup',
      size: 'wide',
      pattern: 'plain',
      back: options.back,
      build,
    },
    handle: {
      showError: (text) => showError(text),
      model,
    },
  };
}
