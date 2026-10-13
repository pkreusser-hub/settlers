// Page controls over the game: game speed, pause, save and load, and the
// size of the map and of the panel. Not part of Freeserf.

import './hud.css';

import { DEFAULT_GAME_SPEED } from '../game/game';
import type { GameManager } from '../game/game-manager';
import { GameStore } from '../game/savegame';
import { cmdSetPaused, cmdSetSpeed } from '../net/commands';
import { EventLoop, EventLoopDOM } from './event-loop';
import type { Interface } from './interface';
import { ticksAsClock } from './menu/names';
import { openSavesPanel } from './saves-panel';
import { ViewportLayer } from './viewport';

// PORT: not in the C++. 8x is speed 16 of the game, which allows up to 40.
const SPEEDS = [1, 2, 4, 8];

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

    const ui = this.group('Panel');
    ui.append(
      this.button('−', 'Make the panel and boxes smaller', () => this.loop()?.stepUiScale(-1)),
      this.button('+', 'Make the panel and boxes larger', () => this.loop()?.stepUiScale(1)),
    );

    document.body.append(this.root);
    window.setInterval(() => this.refresh(), 200);
    this.refresh();
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
  }
}
