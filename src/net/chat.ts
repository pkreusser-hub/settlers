// Chat and map marks of an online game: a one-line input, a small log of
// lines that fade, and "look here" markers over the map. None of it is
// part of the simulation: the lines and marks travel as their own messages
// (session.sendChat / sendMark) and nothing here writes to the Game.
//
// Keys: Enter opens the input, Enter sends, Escape closes. Alt+click on the
// map marks the place for the other players.

import type { MapPos } from '../game/map';
import { Graphics } from '../ui/gfx';
import type { Interface } from '../ui/interface';
import './chat.css';
import { CHAT_MAX_CHARS } from './protocol';

// How long a line stays in the log, and a mark on the map.
const LINE_MS = 12000;
const MARK_MS = 8000;
// Lines kept in the log.
const MAX_LINES = 8;

// A place another player (or this one) pointed at.
export interface MapMark {
  pos: MapPos;
  player: number;
  // performance.now() time at which the mark is gone.
  expires: number;
}

// Where chat lines and marks of this player go. The lobby connects it to
// the session.
export interface ChatLink {
  sendChat(text: string): boolean;
  sendMark(pos: number): boolean;
}

let marks: MapMark[] = [];

/* The marks to show now, for whoever draws the map. */
export function getActiveMarks(): readonly MapMark[] {
  const now = performance.now();
  if (marks.some((m) => m.expires <= now)) {
    marks = marks.filter((m) => m.expires > now);
  }
  return marks;
}

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'BUTTON' ||
      target.tagName === 'A')
  );
}

export class Chat {
  protected iface: Interface;
  protected root: HTMLDivElement;
  protected log: HTMLDivElement;
  protected form: HTMLDivElement;
  protected input: HTMLInputElement;
  protected layer: HTMLDivElement;
  protected markers = new Map<MapMark, HTMLDivElement>();
  protected frame = 0;

  protected link: ChatLink | null = null;
  protected localPlayer = 0;
  // True while something else has the keys (the lobby is open).
  protected blocked: () => boolean;

  constructor(iface: Interface, blocked: () => boolean) {
    this.iface = iface;
    this.blocked = blocked;

    this.root = document.createElement('div');
    this.root.id = 'chat';
    this.root.hidden = true;

    this.log = document.createElement('div');
    this.log.className = 'chat-log';
    this.log.setAttribute('role', 'log');
    this.log.setAttribute('aria-live', 'polite');

    this.form = document.createElement('div');
    this.form.className = 'chat-form';
    this.form.hidden = true;
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'chat-input';
    this.input.maxLength = CHAT_MAX_CHARS;
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.placeholder = 'Message';
    this.input.setAttribute('aria-label', 'Message to the other players');
    const hint = document.createElement('span');
    hint.className = 'chat-hint';
    hint.textContent = 'Enter sends, Esc closes';
    this.form.append(this.input, hint);

    this.root.append(this.log, this.form);

    this.layer = document.createElement('div');
    this.layer.id = 'chat-marks';
    this.layer.setAttribute('aria-hidden', 'true');

    document.body.append(this.layer, this.root);

    /* Every key typed in the input stays there: the game listens on the
       window. */
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    this.input.addEventListener('keypress', (e) => e.stopPropagation());
    /* A click on the map takes the focus away: the input closes, what was
       typed stays for the next time. */
    this.input.addEventListener('blur', () => this.close(false));

    /* Before the game sees the event (it listens on the window too, in the
       bubbling phase, and on the canvas). */
    window.addEventListener('keydown', (e) => this.handleKeyDown(e), true);
    window.addEventListener('mousedown', (e) => this.handleMouseDown(e), true);
  }

  /* Turn the chat on for an online game (with the player of this browser)
     or off (null). */
  setLink(link: ChatLink | null, localPlayer = 0): void {
    this.link = link;
    this.localPlayer = localPlayer;
    if (link === null) {
      this.close();
      this.input.value = '';
      this.log.replaceChildren();
      this.clearMarks();
    }
    this.root.hidden = link === null;
  }

  isOpen(): boolean {
    return !this.form.hidden;
  }

  open(): void {
    if (this.link === null || this.isOpen()) return;
    this.form.hidden = false;
    this.root.classList.add('chat-open');
    this.input.focus();
  }

  close(blur = true): void {
    if (!this.isOpen()) return;
    this.form.hidden = true;
    this.root.classList.remove('chat-open');
    if (blur && document.activeElement === this.input) this.input.blur();
  }

  /* A chat line of a player. */
  addChat(player: number, text: string): void {
    this.addLine(`${this.playerName(player)}: `, text, player, null);
  }

  /* A line of the game itself: a player left, the game was built again. */
  addNote(text: string): void {
    this.addLine('', text, -1, null);
  }

  /* A place a player points at: a marker on the map and a line in the log.
     A click on the line moves the view there. */
  addMark(player: number, pos: MapPos): void {
    const mark: MapMark = { pos, player, expires: performance.now() + MARK_MS };
    marks = marks.filter((m) => m.player !== player);
    marks.push(mark);
    const verb = player === this.localPlayer ? 'point' : 'points';
    this.addLine(`${this.playerName(player)} `, `${verb} at the map. Click to look.`, player, pos);
    /* Now, and then with every frame (a hidden page gets no frames). */
    this.syncMarkers();
    this.schedule();
  }

  clearMarks(): void {
    marks = [];
    this.syncMarkers();
  }

  protected playerName(player: number): string {
    return player === this.localPlayer ? 'You' : `Player ${player + 1}`;
  }

  protected playerColor(player: number): string {
    const game = this.iface.getGame();
    const p = game ? game.getPlayer(player) : null;
    if (p === null) return '#e6e0cf';
    const c = p.getColor();
    return `rgb(${c.red}, ${c.green}, ${c.blue})`;
  }

  protected addLine(prefix: string, text: string, player: number, pos: MapPos | null): void {
    if (this.link === null) return;
    const line = document.createElement(pos !== null ? 'button' : 'div');
    line.className = player < 0 ? 'chat-line chat-note' : 'chat-line';
    if (prefix !== '') {
      const who = document.createElement('span');
      who.className = 'chat-who';
      who.style.color = this.playerColor(player);
      who.textContent = prefix;
      line.append(who);
    }
    line.append(document.createTextNode(text));
    if (pos !== null && line instanceof HTMLButtonElement) {
      line.type = 'button';
      line.classList.add('chat-jump');
      line.addEventListener('click', () => {
        line.blur();
        const viewport = this.iface.getViewport();
        const game = this.iface.getGame();
        if (viewport !== null && game && pos < game.getMap().getCols() * game.getMap().getRows()) {
          viewport.moveToMapPos(pos);
        }
      });
    }
    this.log.append(line);
    while (this.log.childElementCount > MAX_LINES) {
      this.log.firstElementChild?.remove();
    }
    setTimeout(() => line.classList.add('chat-old'), LINE_MS);
  }

  protected submit(): void {
    const text = this.input.value.trim();
    if (text !== '' && this.link !== null) {
      if (this.link.sendChat(text)) {
        this.addChat(this.localPlayer, text.slice(0, CHAT_MAX_CHARS));
      } else {
        this.addNote('Not sent. Nobody is connected.');
      }
    }
    this.input.value = '';
    this.close();
  }

  protected handleKeyDown(event: KeyboardEvent): void {
    if (this.link === null || this.blocked()) return;
    if (event.key !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
    if (isTextField(event.target)) return;
    /* The game does nothing on Enter; it does not get this one. */
    event.preventDefault();
    event.stopImmediatePropagation();
    this.open();
  }

  /* Alt+click on the map: a mark for the others. The game does not get the
     click. */
  protected handleMouseDown(event: MouseEvent): void {
    if (this.link === null || this.blocked()) return;
    if (!event.altKey || event.button !== 0) return;
    const canvas = event.target;
    if (!(canvas instanceof HTMLCanvasElement) || canvas.id !== 'screen') return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const pos = this.mapPosAt(canvas, event.clientX, event.clientY);
    if (pos === null) return;
    if (this.link.sendMark(pos)) {
      this.addMark(this.localPlayer, pos);
    } else {
      this.addNote('Not sent. Nobody is connected.');
    }
  }

  /* CSS pixels of the page per pixel of the viewport. */
  protected mapPixelSize(): [number, number] {
    const gfx = Graphics.getInstance();
    const [fx, fy] = gfx.getScreenFactor();
    const scale = gfx.getMapZoom() / gfx.getZoomFactor();
    return [scale / fx, scale / fy];
  }

  protected mapPosAt(canvas: HTMLCanvasElement, clientX: number, clientY: number): MapPos | null {
    const viewport = this.iface.getViewport();
    if (viewport === null) return null;
    const rect = canvas.getBoundingClientRect();
    const [px, py] = this.mapPixelSize();
    if (!(px > 0) || !(py > 0)) return null;
    const x = Math.trunc((clientX - rect.left) / px);
    const y = Math.trunc((clientY - rect.top) / py);
    /* Null in the sky of the "Globe" view. */
    return viewport.mapPosFromViewPix(x, y);
  }

  /* Keep the markers where their places are while the map moves. */
  protected schedule(): void {
    if (this.frame !== 0) return;
    const step = (): void => {
      this.frame = 0;
      this.syncMarkers();
      if (marks.length > 0) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  protected syncMarkers(): void {
    const active = getActiveMarks();
    for (const [mark, el] of this.markers) {
      if (!active.includes(mark)) {
        el.remove();
        this.markers.delete(mark);
      }
    }
    if (active.length === 0) return;

    const viewport = this.iface.getViewport();
    const game = this.iface.getGame();
    const canvas = document.getElementById('screen');
    if (viewport === null || !game || canvas === null) return;
    const map = game.getMap();
    const rect = canvas.getBoundingClientRect();
    const [px, py] = this.mapPixelSize();
    /* The map wraps: a place just left of or above the view comes back
       with a large coordinate. */
    const width = map.getCols() * 32;
    const height = map.getRows() * 20;

    for (const mark of active) {
      let el = this.markers.get(mark);
      if (el === undefined) {
        el = document.createElement('div');
        el.className = 'chat-mark';
        el.style.color = this.playerColor(mark.player);
        this.layer.append(el);
        this.markers.set(mark, el);
      }
      if (mark.pos >= map.getCols() * map.getRows()) {
        el.hidden = true;
        continue;
      }
      /* Null behind the horizon of the "Globe" view. */
      const place = viewport.viewPixFromMapCoord(mark.pos);
      if (place === null) {
        el.hidden = true;
        continue;
      }
      let [sx, sy] = place;
      if (sx > width - 64) sx -= width;
      if (sy > height - 64) sy -= height;
      const x = rect.left + sx * px;
      const y = rect.top + sy * py;
      el.hidden = x < rect.left - 40 || y < rect.top - 40 || x > rect.right + 40 || y > rect.bottom + 40;
      el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }
}
