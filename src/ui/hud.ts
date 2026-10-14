// Page controls over the game: game speed, pause, save and load, the size
// of the map and of the panel, and the View group: the overlays of the map
// (map-overlays.ts) and the minimap (minimap-panel.ts) with their legend.
// Not part of Freeserf.

import './hud.css';
import './overlays.css';

import { DEFAULT_GAME_SPEED } from '../game/game';
import type { GameManager } from '../game/game-manager';
import { GameStore } from '../game/savegame';
import { cmdSetPaused, cmdSetSpeed } from '../net/commands';
import { EventLoop, EventLoopDOM } from './event-loop';
import type { Interface } from './interface';
import {
  badgeCanvas,
  badgeKinds,
  getTerritoryMode,
  landBorderDash,
  landClasses,
  landPatternTile,
  setTerritoryMode,
  territoryModeFor,
  themeCss,
  trafficLevels,
} from './map-overlays';
import type { LandClass } from './map-overlays';
import { ticksAsClock } from './menu/names';
import { getMinimapPanel } from './minimap-panel';
import { el, showHint } from './overlay-dom';
import { prefBool, prefSetBool } from './prefs';
import { openSavesPanel } from './saves-panel';
import { ViewportLayer } from './viewport';

// PORT: not in the C++. 8x is speed 16 of the game, which allows up to 40.
const SPEEDS = [1, 2, 4, 8];

/* The keys of the View group. Free in the game and in the other overlays
   (build-menu.ts, alerts.ts); listed in the README. */
const KEY_TERRITORY = 't';
const KEY_TRAFFIC = 'y';
const KEY_BADGES = 'x';
const KEY_MINIMAP = 'n';

const landHelp =
  'Your land is filled evenly and has a solid border. ' +
  'The land of the others is striped and has a dashed border.';
const trafficHelp =
  'A thin line is a quiet road, a medium line a steady one, a thick line a congested one.';
const badgeHelp = badgeKinds
  .map((b) => `${b.shape.charAt(0).toUpperCase()}${b.shape.slice(1)}: ${b.label.toLowerCase()}.`)
  .join(' ');

export class Hud {
  protected root: HTMLElement;
  protected speedButtons: HTMLButtonElement[] = [];
  protected spotsButton: HTMLButtonElement;
  protected smoothButton: HTMLButtonElement;
  protected pauseButton: HTMLButtonElement;
  protected saveButton: HTMLButtonElement;
  protected loadButton: HTMLButtonElement;
  protected savedUntil = 0;
  /* GAME OPTIONS: the time left of the peace timer; hidden without one. */
  protected peaceGroup: HTMLElement;
  protected peaceText: HTMLElement;
  protected peaceShown = '';
  /* The View group. */
  protected landButton: HTMLButtonElement;
  protected trafficButton: HTMLButtonElement;
  protected badgeButton: HTMLButtonElement;
  protected minimapButton: HTMLButtonElement;
  protected legendButton: HTMLButtonElement;
  protected legend: HTMLElement;
  protected legendShown = '';

  constructor(protected gameManager: GameManager, protected iface: Interface) {
    this.root = document.createElement('div');
    this.root.id = 'hud';

    const speed = this.group('Speed');
    for (const factor of SPEEDS) {
      const button = this.button(`${factor}x`, `Game speed ${factor}x`, () => {
        const game = this.gameManager.getCurrentGame();
        if (game) cmdSetSpeed(game, DEFAULT_GAME_SPEED * factor);
      });
      this.speedButtons.push(button);
      speed.append(button);
    }
    this.pauseButton = this.button('Pause', 'Pause or continue the game', () => {
      const game = this.gameManager.getCurrentGame();
      if (game) cmdSetPaused(game, !game.isPaused());
    });
    speed.append(this.pauseButton);

    this.peaceGroup = this.group('Peace');
    this.peaceGroup.title = 'Nobody can attack until the peace timer of this game ends';
    this.peaceText = document.createElement('span');
    this.peaceText.className = 'hud-value';
    this.peaceGroup.append(this.peaceText);
    this.peaceGroup.hidden = true;

    const file = this.group('Game');
    this.saveButton = this.button('Save', 'Save the game in this browser, under the date and time', () => {
      const game = this.gameManager.getCurrentGame();
      if (game && this.save()) this.savedUntil = Date.now() + 1500;
    });
    this.loadButton = this.button('Load', 'Saved games: load, download, import', () => openSavesPanel(this.iface, this.gameManager));
    file.append(this.saveButton, this.loadButton);

    const map = this.group('Map');
    map.append(
      this.button('−', 'Zoom the map out', () => this.loop()?.stepMapScale(-1)),
      this.button('+', 'Zoom the map in', () => this.loop()?.stepMapScale(1)),
    );
    // PORT: not in the C++. The layer of the possible buildings is the
    // C++'s (key B); the button shows and switches it.
    this.spotsButton = this.button('Spots', 'Show what can be built where (B)', () => {
      this.iface.getViewport()?.switchLayer(ViewportLayer.LayerBuilds);
    });
    // PORT: not in the C++. Pixel-art magnification of the map view.
    this.smoothButton = this.button('Smooth', 'Smooth the pixels of the map', () => {
      const loop = this.loop();
      if (loop) loop.setSmooth(!loop.getSmooth());
    });
    map.append(this.spotsButton, this.smoothButton);

    // PORT: not in the C++. The overlays of the map view and the minimap.
    // Each button shows and switches a layer of the viewport, as Spots
    // does, or the minimap panel; the keys do the same.
    const view = this.group('View');
    this.landButton = this.button('Land', '', () => this.cycleTerritory());
    this.trafficButton = this.button(
      'Traffic',
      `Show how loaded your roads are (${KEY_TRAFFIC.toUpperCase()}). ${trafficHelp}`,
      () => this.iface.getViewport()?.switchLayer(ViewportLayer.LayerTraffic),
    );
    this.badgeButton = this.button(
      'Status',
      `Show a status badge over your buildings (${KEY_BADGES.toUpperCase()}). ${badgeHelp} ` +
        'Rest the pointer on a badge to read it. The window of the building says more.',
      () => this.iface.getViewport()?.switchLayer(ViewportLayer.LayerBadges),
    );
    this.minimapButton = this.button(
      'Minimap',
      `Show or hide the minimap (${KEY_MINIMAP.toUpperCase()})`,
      () => this.toggleMinimap(),
    );
    this.legendButton = this.button(
      'Legend',
      'Keep the legend of the overlays open, with the status badges',
      () => prefSetBool('view.legend', !prefBool('view.legend', false)),
    );
    view.append(this.landButton, this.trafficButton, this.badgeButton, this.minimapButton, this.legendButton);

    this.legend = el('div', 'gx gx-box ov-legend');
    this.legend.id = 'ov-legend';
    this.legend.setAttribute('role', 'region');
    this.legend.setAttribute('aria-label', 'Legend of the map overlays');
    this.legend.hidden = true;

    const ui = this.group('Panel');
    ui.append(
      this.button('−', 'Make the panel and boxes smaller', () => this.loop()?.stepUiScale(-1)),
      this.button('+', 'Make the panel and boxes larger', () => this.loop()?.stepUiScale(1)),
    );

    document.body.append(this.root, this.legend);
    this.iface.keyHooks.push((key, modifier) => this.handleViewKey(key, modifier));
    window.setInterval(() => this.refresh(), 200);
    this.refresh();
  }

  /* Off, by player, and in a game with teams by team. */
  protected cycleTerritory(): void {
    const viewport = this.iface.getViewport();
    const game = this.iface.getGame();
    if (viewport === null || !game) return;
    if (!viewport.hasLayer(ViewportLayer.LayerTerritory)) {
      setTerritoryMode('players');
      viewport.setLayer(ViewportLayer.LayerTerritory, true);
    } else if (game.hasTeams() && territoryModeFor(game) === 'players') {
      setTerritoryMode('teams');
      viewport.setRedraw();
    } else {
      viewport.setLayer(ViewportLayer.LayerTerritory, false);
    }
  }

  protected toggleMinimap(): void {
    const panel = getMinimapPanel();
    if (panel !== null) panel.setOpen(!panel.isOpen());
  }

  /* The keys of the View group, asked by Interface::handle_key_pressed. */
  protected handleViewKey(key: number, modifier: number): boolean {
    /* Ctrl and Alt keys are not ours. */
    if ((modifier & 5) !== 0) return false;
    const ch = String.fromCharCode(key);
    if (ch !== KEY_TERRITORY && ch !== KEY_TRAFFIC && ch !== KEY_BADGES && ch !== KEY_MINIMAP) return false;
    const viewport = this.iface.getViewport();
    const game = this.iface.getGame();
    if (!game || viewport === null || this.iface.isGameInitOpen()) return false;
    /* A box or a message of the game is open: its keys, not ours. */
    const popup = this.iface.getPopupBox();
    const notification = this.iface.getNotificationBox();
    if (
      (popup !== null && popup.isDisplayed()) ||
      (notification !== null && notification.isDisplayed())
    ) {
      return false;
    }

    const state = (on: boolean): string => (on ? 'on' : 'off');
    if (ch === KEY_TERRITORY) {
      this.cycleTerritory();
      const by = territoryModeFor(game) === 'teams' ? 'by team' : 'by player';
      showHint(viewport.hasLayer(ViewportLayer.LayerTerritory) ? `Land ${by}` : 'Land off');
    } else if (ch === KEY_TRAFFIC) {
      viewport.switchLayer(ViewportLayer.LayerTraffic);
      showHint(`Traffic ${state(viewport.hasLayer(ViewportLayer.LayerTraffic))}`);
    } else if (ch === KEY_BADGES) {
      viewport.switchLayer(ViewportLayer.LayerBadges);
      showHint(`Status badges ${state(viewport.hasLayer(ViewportLayer.LayerBadges))}`);
    } else {
      this.toggleMinimap();
    }
    this.refresh();
    return true;
  }

  /* Save under a name like "2026-10-12 14.03.22". */
  protected save(): boolean {
    const game = this.gameManager.getCurrentGame();
    if (!game) return false;
    const d = new Date();
    const p2 = (n: number): string => (n < 10 ? '0' : '') + n;
    const name = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ` +
                 `${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}`;
    const store = GameStore.getInstance();
    return store.save(`${store.getFolderPath()}/${name}.save`, game);
  }

  protected loop(): EventLoopDOM | null {
    const loop = EventLoop.getInstance();
    return loop instanceof EventLoopDOM ? loop : null;
  }

  protected group(label: string): HTMLElement {
    const group = document.createElement('div');
    group.className = 'hud-group';
    const text = document.createElement('span');
    text.className = 'hud-label';
    text.textContent = label;
    group.append(text);
    this.root.append(group);
    return group;
  }

  protected button(text: string, title: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', () => {
      action();
      // Keys go to the game again, not to the button.
      button.blur();
      this.refresh();
    });
    return button;
  }

  protected refresh(): void {
    const game = this.gameManager.getCurrentGame();
    const speed = game ? game.getSpeed() : DEFAULT_GAME_SPEED;
    SPEEDS.forEach((factor, i) => {
      this.speedButtons[i].setAttribute('aria-pressed', String(speed === DEFAULT_GAME_SPEED * factor));
    });
    const paused = game ? game.isPaused() : false;
    this.pauseButton.setAttribute('aria-pressed', String(paused));
    this.pauseButton.textContent = paused ? 'Paused' : 'Pause';
    this.saveButton.textContent = Date.now() < this.savedUntil ? 'Saved' : 'Save';
    const peace = game && game.isPeace() ? ticksAsClock(game.getPeaceTicksLeft()) : '';
    if (peace !== this.peaceShown) {
      this.peaceShown = peace;
      this.peaceText.textContent = peace === '' ? '' : `${peace} left`;
      this.peaceGroup.hidden = peace === '';
    }
    const viewport = this.iface.getViewport();
    this.spotsButton.disabled = viewport === null;
    this.spotsButton.setAttribute(
      'aria-pressed',
      String(viewport !== null && viewport.hasLayer(ViewportLayer.LayerBuilds)),
    );
    this.smoothButton.setAttribute('aria-pressed', String(this.loop()?.getSmooth() ?? false));
    this.refreshView();
  }

  protected refreshView(): void {
    const viewport = this.iface.getViewport();
    const game = this.iface.getGame();
    const ready = viewport !== null && !!game;
    const land = ready && viewport.hasLayer(ViewportLayer.LayerTerritory);
    const traffic = ready && viewport.hasLayer(ViewportLayer.LayerTraffic);
    const badges = ready && viewport.hasLayer(ViewportLayer.LayerBadges);
    const teams = ready && game.hasTeams();
    const mode = ready ? territoryModeFor(game) : getTerritoryMode();

    const press = (button: HTMLButtonElement, on: boolean, enabled: boolean): void => {
      if (button.disabled !== !enabled) button.disabled = !enabled;
      const pressed = String(on);
      if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    };
    press(this.landButton, land, ready);
    press(this.trafficButton, traffic, ready);
    press(this.badgeButton, badges, ready);
    const panel = getMinimapPanel();
    press(this.minimapButton, panel !== null && panel.isOpen(), panel !== null);
    const pinned = prefBool('view.legend', false);
    press(this.legendButton, pinned, true);

    /* The mode is in the words of the button, not only in its colour. */
    const landText = !land ? 'Land' : mode === 'teams' ? 'Land: teams' : teams ? 'Land: players' : 'Land: on';
    if (this.landButton.textContent !== landText) this.landButton.textContent = landText;
    const landTitle =
      `Tint the land by owner (${KEY_TERRITORY.toUpperCase()}). ${landHelp}` +
      (teams ? ' Press again to tint by team: your team, enemy teams, players without a team.' : '');
    if (this.landButton.title !== landTitle) {
      this.landButton.title = landTitle;
      this.landButton.setAttribute('aria-label', landTitle);
    }

    this.refreshLegend(land, traffic, badges && pinned, pinned);
  }

  /* The legend lies under the strip: the sections of the overlays that
     are on. It is there while Land or Traffic is on or it is kept open. */
  protected refreshLegend(land: boolean, traffic: boolean, badges: boolean, pinned: boolean): void {
    const game = this.iface.getGame();
    const visible = !!game && !this.iface.isGameInitOpen() && (land || traffic || pinned);
    if (!visible) {
      if (!this.legend.hidden) this.legend.hidden = true;
      this.legendShown = '';
      return;
    }
    const classes = land ? landClasses(game, this.iface.getPlayer(), territoryModeFor(game)).classes : [];
    const signature =
      classes.map((c) => `${c.label}:${c.style}:${c.color.r},${c.color.g},${c.color.b}`).join('|') +
      `#${land}#${traffic}#${badges}`;
    const top = `${Math.ceil(this.root.getBoundingClientRect().bottom + 6)}px`;
    if (this.legend.style.top !== top) this.legend.style.top = top;
    if (this.legend.hidden) this.legend.hidden = false;
    if (signature === this.legendShown) return;
    this.legendShown = signature;

    this.legend.textContent = '';
    const section = (title: string, note: string): HTMLElement => {
      const box = el('div', 'ov-sec');
      box.append(el('div', 'ov-head', title));
      const list = el('ul', 'ov-list');
      box.append(list);
      if (note !== '') box.append(el('div', 'ov-note', note));
      this.legend.append(box);
      return list;
    };
    const row = (list: HTMLElement, picture: HTMLCanvasElement, text: string, title = ''): void => {
      const item = el('li', 'ov-row');
      picture.setAttribute('aria-hidden', 'true');
      item.append(picture, el('span', '', text));
      if (title !== '') item.title = title;
      list.append(item);
    };

    if (land) {
      const list = section('Land', 'Solid border: yours. Dashed or dotted: not yours.');
      for (const c of classes) row(list, landSwatch(c), c.label);
    }
    if (traffic) {
      const list = section('Your roads', '');
      trafficLevels.forEach((level, i) => row(list, trafficSwatch(i), level.label, level.title));
    }
    if (badges) {
      const list = section('Building status', '');
      for (const b of badgeKinds) {
        /* A copy: the picture of the kind is shared with the map. */
        const icon = badgeCanvas(b.kind, 32);
        const copy = document.createElement('canvas');
        copy.width = icon.width;
        copy.height = icon.height;
        copy.getContext('2d')?.drawImage(icon, 0, 0);
        copy.className = 'bd-icon';
        row(list, copy, b.label);
      }
    }
    if (this.legend.childElementCount === 0) {
      this.legend.append(el('div', 'ov-note', 'No overlay is on. Status badges are off.'));
    }
  }
}

/* A sample of a kind of land for the legend: its fill and its border. */
function landSwatch(c: LandClass): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'ov-swatch';
  canvas.width = 56;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    ctx.scale(2, 2);
    /* Grass in the colour of the minimap, under the tint. */
    ctx.fillStyle = '#538b23';
    ctx.fillRect(0, 0, 28, 16);
    const pattern = ctx.createPattern(landPatternTile(c), 'repeat');
    if (pattern !== null) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, 28, 16);
    }
    ctx.setLineDash([]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.strokeRect(2, 2, 24, 12);
    ctx.setLineDash(landBorderDash(c.style));
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgb(${c.color.r},${c.color.g},${c.color.b})`;
    ctx.strokeRect(2, 2, 24, 12);
  }
  return canvas;
}

/* A piece of road at a level of traffic, as drawTraffic draws it. */
function trafficSwatch(level: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'ov-swatch';
  canvas.width = 56;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    ctx.scale(2, 2);
    ctx.fillStyle = '#538b23';
    ctx.fillRect(0, 0, 28, 16);
    ctx.lineCap = 'round';
    const strokes: [number, string][] = [
      [2, 'rgba(0,0,0,0.6)'],
      [0, themeCss(trafficLevels[level].color)],
    ];
    for (const [extra, color] of strokes) {
      ctx.lineWidth = trafficLevels[level].width + extra;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(5, 8);
      ctx.lineTo(23, 8);
      ctx.stroke();
    }
  }
  return canvas;
}
