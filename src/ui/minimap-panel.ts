// The minimap of the page: the whole world in a corner, always there. Not
// part of Freeserf, whose minimap is the box of the map button (the Map
// window of menu/map.ts, which stays as it is).
//
// Reading only: nothing here changes the game. A click or a drag moves the
// view, which is state of the interface.
//
// The picture is the minimap of the original laid out as a whole: one pixel
// per point of the map, each row half a point further left than the one
// above (as Minimap::draw_minimap_point), in the terrain colours of
// minimap.ts (minimapTerrainColors). It is drawn into an image of its own
// about once a second and only while the panel is open; the view frame,
// the pings and the marks are drawn over a copy of it when they change.

import './minimap-panel.css';

import { BuildingType } from '../game/building';
import type { Game } from '../game/game';
import type { Map as GameMap, MapPos } from '../game/map';
import { MessageType } from '../game/player';
import type { Message, Player } from '../game/player';
import { getActiveMarks } from '../net/chat';
import type { Interface } from './interface';
import { landClasses, themeCss } from './map-overlays';
import type { LandClass } from './map-overlays';
import { minimapTerrainColors } from './minimap';
import { blurActive, el } from './overlay-dom';
import { onPrefChange, prefBool, prefNumber, prefSetBool, prefSetNumber, prefSetString, prefString } from './prefs';

/* Pixels of the map view per point of the map (MAP_TILE_WIDTH and
   MAP_TILE_HEIGHT of viewport.ts). */
const TILE_W = 32;
const TILE_H = 20;

const MIN_WIDTH = 150;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 210;
const WIDTH_STEP = 40;

/* How long a ping of a message stays, in milliseconds. */
const PING_MS = 6000;

export type MinimapLand = 'owners' | 'teams' | 'terrain';

const landLabels: Record<MinimapLand, string> = {
  owners: 'Land: players',
  teams: 'Land: teams',
  terrain: 'Land: terrain',
};

interface Ping {
  pos: MapPos;
  until: number;
  /* An attack on the player or a fight lost, or a fight won. */
  bad: boolean;
}

interface Dot {
  x: number;
  y: number;
  own: boolean;
  castle: boolean;
}

function packed(r: number, g: number, b: number): number {
  /* The bytes of ImageData are R, G, B, A: little endian words. */
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export class MinimapPanel {
  protected root: HTMLElement;
  protected toggleButton: HTMLButtonElement;
  protected landButton: HTMLButtonElement;
  protected smallerButton: HTMLButtonElement;
  protected largerButton: HTMLButtonElement;
  protected tools: HTMLElement;
  protected body: HTMLElement;
  protected canvas: HTMLCanvasElement;
  protected grip: HTMLElement;

  protected open: boolean;
  protected width: number;
  protected land: MinimapLand;

  protected game: Game | null = null;
  protected player: Player | null = null;
  /* The image of the world, one pixel per point. */
  protected base: HTMLCanvasElement = document.createElement('canvas');
  protected image: ImageData | null = null;
  protected terrain: Uint32Array = new Uint32Array(0);
  protected terrainMap: GameMap | null = null;
  protected classes: LandClass[] = [];
  protected dots: Dot[] = [];
  protected baseTime = 0;
  protected baseTick = -1;
  protected baseKey = '';

  protected pings: Ping[] = [];
  protected seen = new WeakSet<Message>();

  /* What the picture shows, to draw it again only on a change. */
  protected shown = '';
  protected shownLayout = '';
  protected dragging = false;

  constructor(protected iface: Interface) {
    this.open = prefBool('minimap.open', window.innerWidth >= 600);
    this.width = prefNumber('minimap.width', DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH);
    const land = prefString('minimap.land', 'owners');
    this.land = land === 'teams' || land === 'terrain' ? land : 'owners';

    this.root = el('div', 'gx gx-box mm-panel');
    this.root.id = 'mm-panel';
    this.root.hidden = true;

    const head = el('div', 'mm-head');
    this.toggleButton = el('button', 'mm-toggle');
    this.toggleButton.type = 'button';
    this.toggleButton.setAttribute('aria-controls', 'mm-body');
    const mark = el('span', 'mm-mark');
    mark.setAttribute('aria-hidden', 'true');
    const key = el('kbd', '', 'N');
    key.title = 'Key N shows and hides the minimap';
    this.toggleButton.append(mark, el('span', '', 'Minimap'), key);
    this.toggleButton.addEventListener('click', () => {
      this.setOpen(!this.open);
      blurActive();
    });

    this.tools = el('div', 'mm-tools');
    this.landButton = this.toolButton('', () => this.nextLand());
    this.landButton.classList.add('mm-land');
    this.smallerButton = this.toolButton('−', () => this.setWidth(this.width - WIDTH_STEP));
    this.smallerButton.title = 'Make the minimap smaller';
    this.smallerButton.setAttribute('aria-label', 'Make the minimap smaller');
    this.largerButton = this.toolButton('+', () => this.setWidth(this.width + WIDTH_STEP));
    this.largerButton.title = 'Make the minimap larger';
    this.largerButton.setAttribute('aria-label', 'Make the minimap larger');
    this.tools.append(this.landButton, this.smallerButton, this.largerButton);
    head.append(this.toggleButton, this.tools);

    this.body = el('div', 'mm-body');
    this.body.id = 'mm-body';
    this.canvas = el('canvas', 'mm-canvas');
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute(
      'aria-label',
      'Map of the world. Click or drag to move the view. With the focus here the arrow keys move it and Home goes to your castle.',
    );
    this.canvas.title = 'Click or drag to move the view';
    this.grip = el('div', 'mm-grip');
    this.grip.title = 'Drag to resize the minimap';
    this.grip.setAttribute('aria-hidden', 'true');
    this.body.append(this.canvas, this.grip);

    this.root.append(head, this.body);
    document.body.append(this.root);

    this.bindPointer();
    this.bindGrip();
    this.canvas.addEventListener('keydown', (e) => this.handleCanvasKey(e));

    /* New messages of the player, before the interface drops the ones
       its message level hides. */
    this.iface.messageObservers.push((message) => this.handleMessage(message));

    this.applyOpen();
    window.addEventListener('resize', () => this.layout());
    /* Another part of the page changed the choice (the View buttons). */
    onPrefChange((name) => {
      if (name === 'minimap.open' && prefBool(name, this.open) !== this.open) {
        this.open = !this.open;
        this.applyOpen();
        this.update();
      }
    });
    window.setInterval(() => this.update(), 100);
    this.update();
  }

  isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    prefSetBool('minimap.open', open);
    this.applyOpen();
    this.update();
  }

  protected applyOpen(): void {
    this.toggleButton.setAttribute('aria-expanded', String(this.open));
    this.toggleButton.title = this.open ? 'Hide the minimap (N)' : 'Show the minimap (N)';
    this.root.classList.toggle('mm-closed', !this.open);
    this.body.hidden = !this.open;
    this.tools.hidden = !this.open;
    this.shown = '';
    this.baseTime = 0;
    this.layout();
  }

  /* The width asked for, within what the page has room for. */
  setWidth(width: number, remember = true): void {
    this.width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));
    if (remember) prefSetNumber('minimap.width', this.width);
    this.layout();
    this.shown = '';
    this.paint();
  }

  protected nextLand(): void {
    const teams = this.game !== null && this.game.hasTeams();
    const order: MinimapLand[] = teams ? ['owners', 'teams', 'terrain'] : ['owners', 'terrain'];
    const at = order.indexOf(this.effectiveLand());
    this.land = order[(at + 1) % order.length];
    prefSetString('minimap.land', this.land);
    this.baseTime = 0;
    this.update();
  }

  /* By team only in a game with teams. */
  protected effectiveLand(): MinimapLand {
    if (this.land === 'teams' && (this.game === null || !this.game.hasTeams())) return 'owners';
    return this.land;
  }

  protected toolButton(text: string, action: () => void): HTMLButtonElement {
    const button = el('button', 'mm-btn', text);
    button.type = 'button';
    button.addEventListener('click', () => {
      action();
      blurActive();
    });
    return button;
  }

  // -------------------------------------------------------------------------
  // Layout

  /* The panel bar of the game in CSS pixels: [left, right, height], or
     null without one. Interface::layout puts it in the middle of the
     bottom edge, 352 by 40 pixels of the game. */
  protected panelBarBox(): [number, number, number] | null {
    const bar = this.iface.getPanelBar();
    const screen = document.getElementById('screen');
    if (bar === null || screen === null) return null;
    const [, ifaceHeight] = this.iface.getSize();
    const [x, y] = bar.getPosition();
    const [w] = bar.getSize();
    if (!(ifaceHeight > 0)) return null;
    const rect = screen.getBoundingClientRect();
    const perPixel = rect.height / ifaceHeight;
    return [rect.left + x * perPixel, rect.left + (x + w) * perPixel, (ifaceHeight - y) * perPixel];
  }

  /* Bottom right, and above the panel bar where the two would meet. The
     width gives way on a narrow or low page. */
  protected layout(): void {
    const map = this.game === null ? null : this.game.getMap();
    const aspect = map === null ? 0.625 : (map.getRows() * TILE_H) / (map.getCols() * TILE_W);
    const pageWidth = window.innerWidth;
    const pageHeight = window.innerHeight;

    const bar = this.panelBarBox();
    const barHeight = bar === null ? 0 : Math.ceil(bar[2]);

    let width = Math.min(this.width, pageWidth - 16 - 2);
    /* Room for the page controls and the stock panel above. */
    const maxHeight = Math.max(80, pageHeight - barHeight - 16 - 150);
    width = Math.max(100, Math.min(width, Math.floor(maxHeight / aspect)));
    const height = Math.max(1, Math.round(width * aspect));

    const boxWidth = (this.open ? width : this.root.offsetWidth) + 2;
    const left = pageWidth - 8 - boxWidth;
    const lift = bar !== null && left < bar[1] + 8 && pageWidth - 8 > bar[0] - 8;
    const bottom = lift ? barHeight + 8 : 8;

    const key = `${width}x${height}:${bottom}`;
    if (key === this.shownLayout) return;
    this.shownLayout = key;
    this.root.style.bottom = `${bottom}px`;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.smallerButton.disabled = this.width <= MIN_WIDTH;
    this.largerButton.disabled = this.width >= MAX_WIDTH || width < this.width;
    this.shown = '';
  }

  // -------------------------------------------------------------------------
  // The image of the world

  protected readTerrain(map: GameMap): void {
    const colors = minimapTerrainColors(map);
    this.terrain = new Uint32Array(colors.length);
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i];
      this.terrain[i] = packed(c.getRed(), c.getGreen(), c.getBlue());
    }
    this.terrainMap = map;
    this.base.width = map.getCols();
    this.base.height = map.getRows();
    this.image = null;
  }

  /* Terrain, the land of the players or teams over it, and the list of
     the buildings. */
  protected rebuildBase(game: Game, player: Player | null): void {
    const map = game.getMap();
    if (map !== this.terrainMap) this.readTerrain(map);
    const cols = map.getCols();
    const rows = map.getRows();
    const colMask = map.getColMask();
    const ctx = this.base.getContext('2d');
    if (ctx === null) return;
    if (this.image === null) this.image = ctx.createImageData(cols, rows);
    const out = new Uint32Array(this.image.data.buffer);
    const terrain = this.terrain;

    const land = this.effectiveLand();
    const mode = land === 'teams' ? 'teams' : 'players';
    const { classes, ofPlayer } = landClasses(game, player, mode);
    this.classes = classes;
    const tint = land !== 'terrain';
    const r = classes.map((c) => c.color.r);
    const g = classes.map((c) => c.color.g);
    const b = classes.map((c) => c.color.b);
    const solid = classes.map((c) => packed(c.color.r, c.color.g, c.color.b));
    const style = classes.map((c) => (c.style === 'own' ? 0 : c.style === 'other' ? 1 : 2));

    let i = 0;
    for (let row = 0; row < rows; row++) {
      const shift = row >> 1;
      const line = row * cols;
      for (let col = 0; col < cols; col++, i++) {
        let color = terrain[i];
        if (tint) {
          const pos = map.pos(col, row);
          if (map.hasOwner(pos)) {
            const c = ofPlayer[map.getOwner(pos)];
            if (c >= 0) {
              if (style[c] === 0) {
                /* The player's own: an even tint. */
                color = packed(
                  ((color & 0xff) * 2 + r[c] * 3) / 5,
                  (((color >> 8) & 0xff) * 2 + g[c] * 3) / 5,
                  (((color >> 16) & 0xff) * 2 + b[c] * 3) / 5,
                );
              } else if (style[c] === 1) {
                /* The others: every second point, as the mixed mode of
                   the original minimap. */
                if (((col ^ row) & 1) === 0) color = solid[c];
              } else if ((col & 1) === 0 && (row & 1) === 0) {
                /* No team: thinner dots. */
                color = solid[c];
              }
            }
          }
        }
        out[line + ((col - shift) & colMask)] = color;
      }
    }
    ctx.putImageData(this.image, 0, 0);

    const dots: Dot[] = [];
    const me = player === null ? -1 : player.getIndex();
    for (const building of game.buildings) {
      if (building.getIndex() === 0 || building.isBurning()) continue;
      const pos = building.getPosition();
      const row = map.posRow(pos);
      const owner = building.getOwner();
      dots.push({
        x: (map.posCol(pos) - (row >> 1)) & colMask,
        y: row,
        own: owner === me,
        castle: building.getType() === BuildingType.TypeCastle,
      });
    }
    this.dots = dots;
  }

  // -------------------------------------------------------------------------
  // Messages and marks

  protected handleMessage(message: Message): void {
    if (this.seen.has(message)) return;
    this.seen.add(message);
    let bad: boolean;
    switch (message.type) {
      case MessageType.TypeUnderAttack:
      case MessageType.TypeLoseFight:
        bad = true;
        break;
      case MessageType.TypeWinFight:
        bad = false;
        break;
      default:
        return;
    }
    const now = performance.now();
    this.pings = this.pings.filter((p) => p.until > now && p.pos !== message.pos);
    this.pings.push({ pos: message.pos, until: now + PING_MS, bad });
  }

  // -------------------------------------------------------------------------
  // Drawing

  /* Where a point of the map lies in the picture, in CSS pixels. */
  protected place(map: GameMap, pos: MapPos, width: number, height: number): [number, number] {
    const row = map.posRow(pos);
    const x = (map.posCol(pos) - (row >> 1)) & map.getColMask();
    return [((x + 0.5) / map.getCols()) * width, ((row + 0.5) / map.getRows()) * height];
  }

  protected update(): void {
    const game = this.iface.getGame() ?? null;
    const player = this.iface.getPlayer();
    const viewport = this.iface.getViewport();
    if (game === null || viewport === null || this.iface.isGameInitOpen()) {
      this.root.hidden = true;
      this.game = null;
      this.player = null;
      this.pings = [];
      return;
    }
    if (game !== this.game || player !== this.player) {
      this.game = game;
      this.player = player;
      this.pings = [];
      this.baseTime = 0;
      this.shownLayout = '';
      /* Messages that were waiting are not news. */
      if (player !== null) for (const message of player.messages) this.seen.add(message);
    }
    if (this.root.hidden) {
      this.root.hidden = false;
      this.shownLayout = '';
    }
    this.layout();

    const land = this.effectiveLand();
    if (this.landButton.textContent !== landLabels[land]) {
      this.landButton.textContent = landLabels[land];
      this.landButton.title =
        land === 'terrain'
          ? 'The minimap shows the terrain only. Press to show the land of each player.'
          : land === 'teams'
            ? 'The minimap shows the land by team. Your team is tinted evenly, the others are dotted. Press for the terrain only.'
            : 'The minimap shows the land of each player. Yours is tinted evenly, the others are dotted. Press to change.';
    }
    if (!this.open) return;

    /* The image: once a second while the game runs, and at once when the
       game, the choice or the size of the world changed. */
    const now = performance.now();
    const tick = game.getTick();
    const key = `${land}|${game.getMap().getCols()}x${game.getMap().getRows()}`;
    if (
      this.baseTime === 0 ||
      key !== this.baseKey ||
      (now - this.baseTime >= 1000 && tick !== this.baseTick)
    ) {
      this.baseTime = now;
      this.baseTick = tick;
      this.baseKey = key;
      this.rebuildBase(game, player);
      this.shown = '';
    }
    this.paint();
  }

  protected paint(): void {
    const game = this.game;
    const viewport = this.iface.getViewport();
    if (game === null || viewport === null || !this.open || this.root.hidden) return;
    const map = game.getMap();
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width <= 0 || height <= 0 || this.base.width === 0) return;

    const now = performance.now();
    if (this.pings.length > 0) this.pings = this.pings.filter((p) => p.until > now);
    const marks = getActiveMarks();
    const [ox, oy, vw, vh] = viewport.getViewRect();
    /* Pings move: a new picture every time while one is there. */
    const key = `${width}x${height}|${ox},${oy},${vw},${vh}|${this.baseTime}|${marks.length}|` +
      (this.pings.length > 0 ? now : 0);
    if (key === this.shown) return;
    this.shown = key;

    const ratio = window.devicePixelRatio || 1;
    const pw = Math.round(width * ratio);
    const ph = Math.round(height * ratio);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    const ctx = this.canvas.getContext('2d');
    if (ctx === null) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    /* Smaller than the world: averaged. Larger: whole points. */
    ctx.imageSmoothingEnabled = pw < this.base.width;
    ctx.drawImage(this.base, 0, 0, width, height);

    const cols = map.getCols();
    const rows = map.getRows();

    /* Buildings: the player's own light with a dark edge, the others
       dark with a light edge. */
    const side = Math.max(2, Math.min(4, width / cols * 1.5));
    const light = themeCss(['--gx-text-strong', '#fff6d8']);
    for (const dot of this.dots) {
      const x = ((dot.x + 0.5) / cols) * width;
      const y = ((dot.y + 0.5) / rows) * height;
      /* The castles are larger. */
      const s = dot.castle ? side * 2 : side;
      ctx.fillStyle = dot.own ? '#15170f' : light;
      ctx.fillRect(x - s / 2 - 0.75, y - s / 2 - 0.75, s + 1.5, s + 1.5);
      ctx.fillStyle = dot.own ? light : '#15170f';
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }

    /* Marks of the chat: a diamond in the colour of the player. */
    for (const mark of marks) {
      if (mark.pos >= map.pos(cols - 1, rows - 1) + 1) continue;
      const [x, y] = this.place(map, mark.pos, width, height);
      const who = game.getPlayer(mark.player);
      const color = who === null ? { red: 255, green: 255, blue: 255 } : who.getColor();
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x - 5, y);
      ctx.closePath();
      ctx.fillStyle = `rgb(${color.red},${color.green},${color.blue})`;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#15170f';
      ctx.stroke();
    }

    /* Pings: rings that grow from the place, with a cross for an attack
       or a lost fight and a dot for a fight won. */
    for (const ping of this.pings) {
      const [x, y] = this.place(map, ping.pos, width, height);
      const age = (PING_MS - (ping.until - now)) / 1000;
      const phase = age % 1.2 / 1.2;
      const color = ping.bad ? themeCss(['--gx-bad', '#ff7d66']) : themeCss(['--gx-good', '#7fdc5c']);
      for (const radius of [4 + phase * 12, 4 + ((phase + 0.5) % 1) * 12]) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.stroke();
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (ping.bad) {
        ctx.moveTo(x - 3, y - 3);
        ctx.lineTo(x + 3, y + 3);
        ctx.moveTo(x + 3, y - 3);
        ctx.lineTo(x - 3, y + 3);
        ctx.stroke();
      } else {
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* The view: a frame, again where it leaves the picture at an edge.
       Below the last row the view goes on with the first rows: in the
       picture that part of the frame lies half the rows of the world
       further right (see the space transformations of viewport.ts). */
    const worldW = cols * TILE_W;
    const worldH = rows * TILE_H;
    const fw = (vw / worldW) * width;
    const fh = (vh / worldH) * height;
    const fx = (ox / worldW) * width;
    const fy = (oy / worldH) * height;
    const skew = ((rows * TILE_W) / 2 / worldW) * width;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    const frame = new Path2D();
    if (fw >= width) {
      /* The view shows the whole world from side to side. */
      frame.rect(1, 1, width - 2, height - 2);
    } else {
      /* A view taller than the world shows rows twice; so does the frame. */
      for (let j = 0; j <= 2; j++) {
        const y = fy - j * height;
        if (y + fh <= 0) continue;
        for (let k = -3; k <= 1; k++) {
          const x = fx + j * skew + k * width;
          if (x + fw <= 0 || x >= width) continue;
          frame.rect(x, y, fw, fh);
        }
      }
    }
    ctx.lineJoin = 'miter';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.stroke(frame);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke(frame);
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Moving the view

  /* The point of the map under a point of the page. */
  protected posAt(clientX: number, clientY: number): MapPos | null {
    if (this.game === null) return null;
    const map = this.game.getMap();
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const u = Math.min(0.999999, Math.max(0, (clientX - rect.left) / rect.width));
    const v = Math.min(0.999999, Math.max(0, (clientY - rect.top) / rect.height));
    const row = Math.floor(v * map.getRows());
    const col = (Math.floor(u * map.getCols()) + (row >> 1)) & map.getColMask();
    return map.pos(col, row & map.getRowMask());
  }

  protected moveViewTo(clientX: number, clientY: number): void {
    const pos = this.posAt(clientX, clientY);
    const viewport = this.iface.getViewport();
    if (pos === null || viewport === null) return;
    viewport.moveToMapPos(pos);
    this.paint();
  }

  protected bindPointer(): void {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* Not capturing: the drag ends at the edge of the picture. */
      }
      this.moveViewTo(e.clientX, e.clientY);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) this.moveViewTo(e.clientX, e.clientY);
    });
    const end = (): void => {
      if (!this.dragging) return;
      this.dragging = false;
      /* Keys go to the game again. */
      blurActive();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  /* The arrow keys move the view by a sixteenth of the world, Home goes
     to the castle. The game does not get these keys. */
  protected handleCanvasKey(e: KeyboardEvent): void {
    const viewport = this.iface.getViewport();
    if (viewport === null || this.game === null) return;
    const map = this.game.getMap();
    const dx = Math.round((map.getCols() * TILE_W) / 16);
    const dy = Math.round((map.getRows() * TILE_H) / 16);
    switch (e.key) {
      case 'ArrowLeft': viewport.moveByPixels(-dx, 0); break;
      case 'ArrowRight': viewport.moveByPixels(dx, 0); break;
      case 'ArrowUp': viewport.moveByPixels(0, -dy); break;
      case 'ArrowDown': viewport.moveByPixels(0, dy); break;
      case 'Home': this.iface.moveToCastle(); break;
      case 'Escape': blurActive(); break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.paint();
  }

  /* The corner of the picture away from the corner of the page: a drag
     there makes the minimap larger or smaller. */
  protected bindGrip(): void {
    const grip = this.grip;
    let startX = 0;
    let startWidth = 0;
    let active = false;
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      active = true;
      startX = e.clientX;
      startWidth = this.canvas.clientWidth;
      try {
        grip.setPointerCapture(e.pointerId);
      } catch {
        /* Not capturing. */
      }
      e.preventDefault();
    });
    grip.addEventListener('pointermove', (e) => {
      if (active) this.setWidth(startWidth + (startX - e.clientX), false);
    });
    const end = (): void => {
      if (!active) return;
      active = false;
      prefSetNumber('minimap.width', this.width);
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }
}

let panel: MinimapPanel | null = null;

export function initMinimapPanel(iface: Interface): MinimapPanel {
  panel ??= new MinimapPanel(iface);
  return panel;
}

export function getMinimapPanel(): MinimapPanel | null {
  return panel;
}
