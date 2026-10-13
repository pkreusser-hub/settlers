// Page controls over the game: game speed, pause, and the size of the map
// and of the panel. Not part of Freeserf.

import './hud.css';

import { DEFAULT_GAME_SPEED } from '../game/game';
import type { GameManager } from '../game/game-manager';
import { cmdSetPaused, cmdSetSpeed } from '../net/commands';
import { EventLoop, EventLoopDOM } from './event-loop';

const SPEEDS = [1, 2, 4];

export class Hud {
  protected root: HTMLElement;
  protected speedButtons: HTMLButtonElement[] = [];
  protected pauseButton: HTMLButtonElement;

  constructor(protected gameManager: GameManager) {
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

    const map = this.group('Map');
    map.append(
      this.button('−', 'Zoom the map out', () => this.loop()?.stepMapScale(-1)),
      this.button('+', 'Zoom the map in', () => this.loop()?.stepMapScale(1)),
    );

    const ui = this.group('Panel');
    ui.append(
      this.button('−', 'Make the panel and boxes smaller', () => this.loop()?.stepUiScale(-1)),
      this.button('+', 'Make the panel and boxes larger', () => this.loop()?.stepUiScale(1)),
    );

    document.body.append(this.root);
    window.setInterval(() => this.refresh(), 200);
    this.refresh();
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
  }
}
