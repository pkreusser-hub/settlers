// The lobby: the page overlay shown at startup with the choice between a
// solo game, hosting an online game and joining one. It also runs an online
// game once it has begun: it owns the session, installs it as command sink
// and game clock, keeps the host's room open for guests that come back,
// and shows the status line and the chat over the game.

import { Game } from '../game/game';
import { GameManager } from '../game/game-manager';
import type { GameManagerHandler } from '../game/game-manager';
import type { PGameInfo } from '../game/mission';
import { Random } from '../game/random';
import { GameStore } from '../game/savegame';
import { setOnlineHost } from '../ui/game-init';
import type { Interface } from '../ui/interface';
import '../ui/overlay.css';
import { Chat } from './chat';
import { setCommandSink, setGameClock, setLocalPlayer } from './command';
import { hostRoom, joinRoom, normalizeRoomCode, ROOM_CODE_LENGTH } from './peer-transport';
import type { NetError, PendingConnection } from './peer-transport';
import { MAX_HUMANS, PROTOCOL_VERSION, SaveAssembler, sendSaveText } from './protocol';
import type { GameSetup, NetMessage, RejectReason, Transport } from './protocol';
import { GuestSession, hasPlayers, HostSession, prepareLoadedGame, WorkerTimer } from './session';
import type { LockstepSession, RosterChange, SessionOptions, SessionStatus } from './session';
import { isValidSetup, makeSetup, NetGameInfo } from './setup';

const SOURCE_URL = 'https://github.com/pkreusser-hub/settlers';

// How long the two sides may take to exchange their versions.
const HELLO_TIMEOUT_MS = 10000;
// How long a note stays on the status line.
const NOTE_MS = 4000;
// A guest that lost the host tries this often to get back, this far apart.
const REJOIN_ATTEMPTS = 3;
const REJOIN_RETRY_MS = 2000;
// A refused guest gets this long to read why before the channel closes.
const REJECT_CLOSE_MS = 500;
// sessionStorage: who this tab is to a host, and the room it played in.
const TOKEN_KEY = 'settlers.net.token';
const ROOM_KEY = 'settlers.net.room';

const TEXT = {
  notFound: (code: string) => `No game found for code ${code}. Check the code with the host.`,
  failed: 'Could not connect. Check your internet connection and try again.',
  unsupported: 'This browser cannot make the connection (WebRTC is missing or blocked).',
  version: 'The host has a different version of the game. Both reload the page, then try again.',
  badCode: `Enter the ${ROOM_CODE_LENGTH}-character code the host sees.`,
  hostLeft: 'The host closed the game.',
  guestsLeft: 'The other players left.',
  full: 'This game has no free place.',
  setup: 'The host is already setting up the game. Ask the host to cancel the setup, then join again.',
  badStart: 'The host sent a game this version cannot build. Both reload the page, then try again.',
  fewPlayers: 'This saved game has fewer players than are here. Choose another one.',
};

function netErrorText(error: NetError, code: string): string {
  if (error === 'not-found') return TEXT.notFound(code);
  if (error === 'unsupported') return TEXT.unsupported;
  return TEXT.failed;
}

function rejectText(reason: RejectReason): string {
  return reason === 'setup' ? TEXT.setup : TEXT.full;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K, className: string, text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function button(text: string, onClick: () => void, quiet = false): HTMLButtonElement {
  const el = element('button', quiet ? 'ov-button ov-quiet' : 'ov-button', text);
  el.type = 'button';
  el.addEventListener('click', onClick);
  return el;
}

function stored(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* No storage: a reloaded page is a new guest. */
  }
}

/* Who this tab is to a host: it gets its player back by this after a lost
   connection or a reload. */
function guestToken(): string {
  let token = stored(TOKEN_KEY);
  if (token === null || token.length < 16) {
    const values = new Uint32Array(4);
    crypto.getRandomValues(values);
    token = Array.from(values, (v) => v.toString(36)).join('-');
    store(TOKEN_KEY, token);
  }
  return token;
}

// A guest in the host's room before the game.
interface RoomGuest {
  transport: Transport;
  token: string;
}

// What a guest's attempt to get into a room reports.
interface JoinUi {
  // The channel is open and the versions match.
  connected(): void;
  // The host's room has no game yet: this is the place in it.
  lobby(you: number, count: number): void;
  fail(text: string, notFound: boolean): void;
}

export class Lobby implements GameManagerHandler {
  protected iface: Interface;
  protected backdrop: HTMLDivElement;
  protected panel: HTMLDivElement;
  protected hud: HTMLDivElement;
  protected hudTimer: ReturnType<typeof setTimeout> | null = null;
  protected chat: Chat;

  /* Host: the room, from "Host online game" until the game ends. */
  protected room: PendingConnection | null = null;
  protected roomCode = '';
  protected phase: 'none' | 'room' | 'setup' | 'game' = 'none';
  protected guests: RoomGuest[] = [];
  protected refreshRoom: () => void = () => undefined;

  /* Guest: joining a room, and the channel before a session has it. */
  protected pending: PendingConnection | null = null;
  protected helloTimer: ReturnType<typeof setTimeout> | null = null;
  protected transport: Transport | null = null;
  protected rejoinTimer: ReturnType<typeof setTimeout> | null = null;

  protected session: LockstepSession | null = null;
  // True while the game of the session is replaced by its rebuilt self.
  protected rebuilding = false;
  protected hintShown = false;

  protected blockKeys = (event: KeyboardEvent): void => {
    /* While the lobby is open the keys are not for the game behind it. */
    if (!this.backdrop.hidden && !this.backdrop.contains(event.target as Node)) {
      event.stopImmediatePropagation();
    }
  };

  constructor(iface: Interface) {
    this.iface = iface;

    this.backdrop = element('div', 'ov-backdrop');
    this.backdrop.id = 'lobby';
    this.panel = element('div', 'ov-panel');
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'The Settlers');
    this.backdrop.append(this.panel);
    /* Keys typed in the lobby stay in the lobby. */
    this.backdrop.addEventListener('keydown', (e) => e.stopPropagation());
    this.backdrop.addEventListener('keyup', (e) => e.stopPropagation());

    this.hud = element('div', 'ov-hud');
    this.hud.id = 'net-status';
    this.hud.setAttribute('role', 'status');
    this.hud.hidden = true;

    document.body.append(this.backdrop, this.hud);
    window.addEventListener('keydown', this.blockKeys, true);
    this.chat = new Chat(iface, () => !this.backdrop.hidden);
    /* Leaving the page closes the channels, so that the others see it at
       once and not only after the silence limit. */
    window.addEventListener('pagehide', (event) => {
      if (event.persisted) return;
      this.transport?.close();
      this.session?.stop();
      this.room?.cancel();
    });
    GameManager.getInstance().addHandler(this);

    this.showMenu();
  }

  // -------------------------------------------------------------------------
  // Screens

  protected setScreen(...children: HTMLElement[]): void {
    this.panel.replaceChildren(...children);
    this.backdrop.hidden = false;
    const focus = this.panel.querySelector<HTMLElement>('input, button:not(:disabled)');
    focus?.focus();
  }

  protected hide(): void {
    this.backdrop.hidden = true;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  protected showMenu(error = ''): void {
    const buttons = element('div', 'ov-buttons');
    buttons.append(
      button('Play solo', () => this.hide()),
      button('Host online game', () => this.startHosting()),
      button('Join online game', () => this.showJoin()),
    );
    /* This tab was in an online game (it was reloaded, or lost the host). */
    const last = stored(ROOM_KEY);
    if (last !== null && normalizeRoomCode(last) === last) {
      buttons.append(button(`Rejoin game ${last}`, () => this.showJoin('', last, true), true));
    }
    const message = element('p', 'ov-error', error);
    message.setAttribute('role', 'alert');
    const source = element('p', 'ov-small', 'A port of Freeserf, under the GPL. ');
    const link = document.createElement('a');
    link.href = SOURCE_URL;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Source code';
    source.append(link);
    this.setScreen(
      element('h1', 'ov-title', 'The Settlers'),
      element('p', 'ov-text', 'Play alone, or with up to three other players over the internet.'),
      buttons,
      message,
      source,
    );
  }

  // -------------------------------------------------------------------------
  // Host

  protected startHosting(): void {
    this.closeRoom();
    this.phase = 'room';
    this.showHostRoom();

    this.room = hostRoom({
      onCode: (code) => {
        this.roomCode = code;
        this.refreshRoom();
      },
      onGuest: (transport) => this.acceptGuest(transport),
      onError: (error) => {
        this.closeRoom();
        this.showMenu(netErrorText(error, ''));
      },
    });
  }

  /* The room before the game: the code and who has joined. */
  protected showHostRoom(note = ''): void {
    const status = element('p', 'ov-status');
    status.setAttribute('role', 'status');
    const codeBox = element('div', 'ov-code', '······');
    codeBox.setAttribute('aria-label', 'Room code');
    const list = element('p', 'ov-text');
    const message = element('p', 'ov-error', note);
    message.setAttribute('role', 'alert');

    const copy = button('Copy code', () => {
      const code = this.roomCode;
      const done = (): void => {
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = 'Copy code'; }, 2000);
      };
      const select = (): void => {
        /* No clipboard access: select the code for a manual copy. */
        const range = document.createRange();
        range.selectNodeContents(codeBox);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      };
      if (navigator.clipboard !== undefined) {
        navigator.clipboard.writeText(code).then(done, select);
      } else {
        select();
      }
    });
    const setup = button('Set up the game', () => this.showHostSetup());
    const buttons = element('div', 'ov-buttons');
    buttons.append(copy, setup, button('Cancel', () => {
      this.closeRoom();
      this.showMenu();
    }, true));

    this.refreshRoom = () => {
      if (this.phase !== 'room') return;
      const count = this.guests.length;
      codeBox.textContent = this.roomCode !== '' ? this.roomCode : '······';
      copy.disabled = this.roomCode === '';
      setup.disabled = count === 0;
      if (this.roomCode === '') {
        status.textContent = 'Opening a room…';
      } else if (count === 0) {
        status.textContent = 'Waiting for players…';
      } else if (count < MAX_HUMANS - 1) {
        status.textContent = 'Start when everyone is here.';
      } else {
        status.textContent = 'The game is full.';
      }
      const joined = this.guests.map((_, i) => `Player ${i + 2} joined.`).join(' ');
      list.textContent = `You are player 1. ${joined}`;
      this.guests.forEach((guest, i) => {
        guest.transport.send({ t: 'lobby', you: i + 1, count: count + 1 });
      });
    };

    this.setScreen(
      element('h1', 'ov-title', 'Host online game'),
      element('p', 'ov-text', 'Give this code to the other players. Up to three can join.'),
      codeBox,
      list,
      status,
      message,
      buttons,
    );
    this.refreshRoom();
  }

  /* A channel opened to the room: exchange versions, then see whether
     there is a place. */
  protected acceptGuest(transport: Transport): void {
    let done = false;
    const end = (): void => {
      done = true;
      clearTimeout(timer);
      transport.onMessage = null;
      transport.onClose = null;
    };
    const timer = setTimeout(() => {
      if (done) return;
      end();
      transport.close();
    }, HELLO_TIMEOUT_MS);
    transport.onClose = () => end();
    transport.onMessage = (msg: NetMessage) => {
      if (done || msg.t !== 'hello') return;
      end();
      if (msg.v !== PROTOCOL_VERSION) {
        console.error(`[net] a guest has protocol version ${String(msg.v)}, this side has ${PROTOCOL_VERSION}`);
        /* Leave it the time to read this side's version. */
        setTimeout(() => transport.close(), REJECT_CLOSE_MS);
        return;
      }
      this.seatGuest(transport, typeof msg.token === 'string' ? msg.token.slice(0, 64) : '');
    };
    transport.send({ t: 'hello', v: PROTOCOL_VERSION });
  }

  protected reject(transport: Transport, reason: RejectReason): void {
    transport.send({ t: 'reject', reason });
    setTimeout(() => transport.close(), REJECT_CLOSE_MS);
  }

  protected seatGuest(transport: Transport, token: string): void {
    if (this.phase === 'game') {
      /* A guest comes back to the running game (or someone takes the place
         of one that left). */
      const session = this.session;
      if (!(session instanceof HostSession) || session.rejoin(transport, token) < 0) {
        this.reject(transport, 'full');
      }
      return;
    }
    if (this.phase === 'setup') {
      this.reject(transport, 'setup');
      return;
    }
    if (this.phase !== 'room') {
      transport.close();
      return;
    }

    /* The same tab again (it reloaded): it takes its old place. */
    const known = token !== '' ? this.guests.find((g) => g.token === token) : undefined;
    if (known !== undefined) {
      known.transport.onClose = null;
      known.transport.close();
      known.transport = transport;
    } else if (this.guests.length >= MAX_HUMANS - 1) {
      this.reject(transport, 'full');
      return;
    } else {
      this.guests.push({ transport, token });
    }
    transport.onMessage = null;
    transport.onClose = () => this.guestLeftRoom(transport);
    this.refreshRoom();
  }

  /* A guest left before the game began. */
  protected guestLeftRoom(transport: Transport): void {
    this.guests = this.guests.filter((g) => g.transport !== transport);
    if (this.phase === 'room') {
      this.refreshRoom();
    } else if (this.phase === 'setup') {
      if (this.guests.length === 0) {
        this.backToRoom(TEXT.guestsLeft);
      } else {
        /* The box is made for a number of people: make it again. */
        this.showHostSetup();
        this.showHud('A player left. Set up the game again.');
        this.hudTimer = setTimeout(() => this.hideHud(), NOTE_MS);
      }
    }
  }

  protected backToRoom(note = ''): void {
    setOnlineHost(null);
    this.reopenGameInit();
    this.phase = 'room';
    this.showHostRoom(note);
  }

  /* The game init box of the game, in its online form. */
  protected showHostSetup(): void {
    if (this.guests.length === 0) return;
    this.phase = 'setup';
    this.guests.forEach((guest, i) => {
      guest.transport.send({ t: 'lobby', you: i + 1, count: this.guests.length + 1 });
    });

    setOnlineHost({
      humans: this.guests.length + 1,
      start: (mission) => this.hostStart(mission),
      startSaved: (path) => this.hostStartSaved(path),
      cancel: () => this.backToRoom(),
    });
    this.reopenGameInit();
    this.hide();
  }

  /* A game init box keeps the mode it was made in. */
  protected reopenGameInit(): void {
    this.iface.closeGameInit();
    this.iface.openGameInit();
  }

  protected hostStart(mission: PGameInfo): boolean {
    const humans = this.guests.length + 1;
    if (this.phase !== 'setup' || humans < 2) return false;

    const setup = makeSetup(mission, new Random(), humans);
    const game = this.buildGame(setup, 0);
    if (game === null) return false;

    this.guests.forEach((guest, i) => {
      guest.transport.send({ t: 'start', v: PROTOCOL_VERSION, setup, you: i + 1 });
    });
    this.hostBegin(game, humans);
    return true;
  }

  /* Go on from a saved game: the guests get the text of the file and build
     the same game from it. */
  protected hostStartSaved(path: string): boolean {
    const humans = this.guests.length + 1;
    if (this.phase !== 'setup' || humans < 2) return false;

    const text = GameStore.getInstance().getText(path);
    if (text === null) return false;
    const check = new Game();
    if (!GameStore.getInstance().read(text, check)) return false;
    if (!hasPlayers(check, humans)) {
      this.showHud(TEXT.fewPlayers, true);
      this.hudTimer = setTimeout(() => this.hideHud(), NOTE_MS * 2);
      return false;
    }
    const game = this.buildSavedGame(text, 0, humans, false, false);
    if (game === null) return false;

    this.guests.forEach((guest, i) => {
      sendSaveText(guest.transport, text);
      guest.transport.send({ t: 'startSave', v: PROTOCOL_VERSION, you: i + 1, humans });
    });
    this.hostBegin(game, humans);
    return true;
  }

  /* The guests have what they need to build the game; the session waits
     for each of them to say it is ready. */
  protected hostBegin(game: Game, humans: number): void {
    setOnlineHost(null);
    this.phase = 'game';
    const seats = this.guests.map((guest, i) => ({
      player: i + 1, transport: guest.transport, token: guest.token,
    }));
    this.guests = [];
    this.hideHud();
    this.replaceSession();
    const session: HostSession = new HostSession({
      ...this.sessionOptions(game, 0, humans, () => session),
      guests: seats,
      repairDesync: true,
      onRepair: (_turn, player) => {
        this.chat.addNote(`The game of player ${player + 1} was out of sync.`);
      },
    });
    this.installSession(session);
    session.start();
  }

  /* Close the room and whoever is in it. A running session is not touched:
     its channels are its own. */
  protected closeRoom(): void {
    if (this.room !== null) {
      this.room.cancel();
      this.room = null;
    }
    for (const guest of this.guests) {
      guest.transport.onMessage = null;
      guest.transport.onClose = null;
      guest.transport.close();
    }
    this.guests = [];
    this.roomCode = '';
    this.phase = 'none';
    this.refreshRoom = () => undefined;
    setOnlineHost(null);
  }

  // -------------------------------------------------------------------------
  // Guest

  protected showJoin(error = '', code = '', connectNow = false): void {
    const label = element('label', 'ov-label', 'Room code');
    label.htmlFor = 'lobby-code';
    const input = element('input', 'ov-input');
    input.id = 'lobby-code';
    input.type = 'text';
    input.maxLength = ROOM_CODE_LENGTH + 2;
    input.autocomplete = 'off';
    input.autocapitalize = 'characters';
    input.spellcheck = false;
    input.value = code;
    input.setAttribute('aria-describedby', 'lobby-join-message');

    const message = element('p', error !== '' ? 'ov-error' : 'ov-status', error);
    message.id = 'lobby-join-message';
    message.setAttribute('role', 'alert');

    const connect = button('Connect', () => submit());
    const back = button('Back', () => {
      this.dropConnection();
      this.showMenu();
    }, true);
    const buttons = element('div', 'ov-buttons');
    buttons.append(connect, back);

    const submit = (): void => {
      const roomCode = normalizeRoomCode(input.value);
      if (roomCode === null) {
        message.className = 'ov-error';
        message.textContent = TEXT.badCode;
        input.focus();
        return;
      }
      message.className = 'ov-status';
      message.textContent = 'Connecting…';
      connect.disabled = true;
      input.disabled = true;

      this.join(roomCode, {
        connected: () => this.showGuestWaiting(roomCode),
        lobby: () => undefined,
        fail: (text, notFound) => {
          if (notFound && stored(ROOM_KEY) === roomCode) store(ROOM_KEY, null);
          this.showJoin(text, roomCode);
        },
      });
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });

    this.setScreen(
      element('h1', 'ov-title', 'Join online game'),
      element('p', 'ov-text', 'Enter the code the host gave you. The same code brings you back into a running game you were in.'),
      label,
      input,
      message,
      buttons,
    );
    if (connectNow) submit();
  }

  protected showGuestWaiting(code: string): void {
    const buttons = element('div', 'ov-buttons');
    buttons.append(button('Cancel', () => {
      this.dropConnection();
      this.showMenu();
    }, true));
    const place = element('p', 'ov-text', `Connected to game ${code}.`);
    place.id = 'lobby-place';
    const status = element('p', 'ov-status', 'Waiting for the host…');
    status.setAttribute('role', 'status');
    this.setScreen(
      element('h1', 'ov-title', 'Join online game'),
      place,
      status,
      buttons,
    );
  }

  /* Open a channel to the room, exchange versions, then take what the host
     sends: the place in the room, the start of the game, or (the game is
     running) the save game to come in with. Used from the join screen and
     by a guest that lost the host in a game. */
  protected join(code: string, ui: JoinUi): void {
    this.dropConnection();
    this.pending = joinRoom(code, {
      onOpen: (transport) => {
        this.pending = null;
        this.transport = transport;
        this.guestHello(transport, () => {
          ui.connected();
          this.guestListen(transport, code, ui);
        }, (text) => ui.fail(text, false));
      },
      onError: (netError) => {
        this.pending = null;
        ui.fail(netErrorText(netError, code), netError === 'not-found');
      },
    });
  }

  /* The guest sends its version and token when the channel opens and
     checks the host's version. */
  protected guestHello(transport: Transport, ok: () => void, fail: (text: string) => void): void {
    const end = (): void => {
      if (this.helloTimer !== null) clearTimeout(this.helloTimer);
      this.helloTimer = null;
      transport.onMessage = null;
      transport.onClose = null;
    };
    const failed = (text: string): void => {
      if (this.transport !== transport) return;
      end();
      this.dropConnection();
      fail(text);
    };

    transport.onMessage = (msg: NetMessage) => {
      if (this.transport !== transport || msg.t !== 'hello') return;
      if (msg.v !== PROTOCOL_VERSION) {
        console.error(`[net] protocol version ${String(msg.v)}, this side has ${PROTOCOL_VERSION}`);
        end();
        failed(TEXT.version);
        return;
      }
      end();
      ok();
    };
    transport.onClose = () => failed(TEXT.failed);
    this.helloTimer = setTimeout(() => failed(TEXT.failed), HELLO_TIMEOUT_MS);
    transport.send({ t: 'hello', v: PROTOCOL_VERSION, token: guestToken() });
  }

  protected guestListen(transport: Transport, code: string, ui: JoinUi): void {
    const fail = (text: string): void => {
      if (this.transport !== transport) return;
      this.dropConnection();
      ui.fail(text, false);
    };
    const save = new SaveAssembler();
    transport.onClose = () => fail(TEXT.hostLeft);
    transport.onMessage = (msg: NetMessage) => {
      if (this.transport !== transport) return;
      switch (msg.t) {
        case 'lobby': {
          if (!Number.isInteger(msg.you) || !Number.isInteger(msg.count)) return;
          ui.lobby(msg.you, msg.count);
          const place = document.getElementById('lobby-place');
          if (place !== null) {
            place.textContent = `Connected to game ${code}. You are player ${msg.you + 1} of ${msg.count} so far.`;
          }
          break;
        }
        case 'reject':
          fail(rejectText(msg.reason));
          break;
        case 'save':
          if (!save.add(msg)) fail(TEXT.badStart);
          break;
        case 'start': {
          if (msg.v !== PROTOCOL_VERSION) {
            fail(TEXT.version);
          } else if (!isValidSetup(msg.setup) || !this.validPlace(msg.you, msg.setup.humans) ||
                     !this.guestBegin(this.buildGame(msg.setup, msg.you), msg.you, msg.setup.humans, code, 0)) {
            fail(TEXT.badStart);
          }
          break;
        }
        case 'startSave': {
          if (msg.v !== PROTOCOL_VERSION) {
            fail(TEXT.version);
          } else if (!this.validPlace(msg.you, msg.humans) ||
                     !this.guestBegin(this.buildSavedGame(save.take(), msg.you, msg.humans, false, false),
                                      msg.you, msg.humans, code, 0)) {
            fail(TEXT.badStart);
          }
          break;
        }
        case 'resync': {
          /* The game is running: come in at this turn. A guest that lost
             the host keeps its view of the map. */
          if (msg.v !== PROTOCOL_VERSION) {
            fail(TEXT.version);
            return;
          }
          const keepView = this.session !== null;
          if (!this.validPlace(msg.you, msg.humans) || !Number.isInteger(msg.turn) || msg.turn < 0 ||
              !Array.isArray(msg.connected) ||
              !this.guestBegin(this.buildSavedGame(save.take(), msg.you, msg.humans, msg.paused === true, keepView),
                               msg.you, msg.humans, code, msg.turn, msg.connected)) {
            fail(TEXT.badStart);
          }
          break;
        }
        default:
          break;
      }
    };
  }

  protected validPlace(you: number, humans: number): boolean {
    return Number.isInteger(humans) && humans >= 2 && humans <= MAX_HUMANS &&
      Number.isInteger(you) && you >= 1 && you < humans;
  }

  protected guestBegin(
    game: Game | null, you: number, humans: number, code: string, startTurn: number, connected?: boolean[],
  ): boolean {
    const transport = this.transport;
    if (transport === null || game === null) return false;

    /* The guest never sees the game init box. */
    this.iface.closeGameInit();
    this.hide();
    if (this.rejoinTimer !== null) clearTimeout(this.rejoinTimer);
    this.rejoinTimer = null;

    /* A session that lost the host is replaced. */
    const old = this.replaceSession();
    this.transport = null;
    this.roomCode = code;
    store(ROOM_KEY, code);

    const session: GuestSession = new GuestSession({
      ...this.sessionOptions(game, you, humans, () => session),
      transport,
      startTurn,
      connected,
    });
    this.installSession(session);
    session.start();
    if (startTurn > 0) {
      this.chat.addNote(old !== null ? 'You are back in the game.' : `You are in the game again, as player ${you + 1}.`);
    }
    return true;
  }

  /* The guest lost the host in a game: try the room again. The game stays
     on the screen meanwhile, stopped. */
  protected rejoin(attempt: number): void {
    const session = this.session;
    if (session === null || session.isHost()) return;
    const code = this.roomCode;
    const alone = (): HTMLButtonElement => button('Keep playing alone', () => this.playAlone());
    const again = (): HTMLButtonElement => button('Try again', () => this.rejoin(1));
    const stillLost = (): boolean => {
      if (this.session !== session) return false;
      const status = session.getStatus();
      return status.kind === 'disconnected' && status.reason !== 'timeout';
    };
    if (!stillLost()) return;

    this.showHud('Connection lost. Rejoining…', true, alone());
    this.join(code, {
      connected: () => undefined,
      /* A room without a game under this code: not the match that was
         lost. */
      lobby: () => {
        this.dropConnection();
        if (stillLost()) this.showHud('The host started over. This match is over.', true, alone());
      },
      fail: (text, notFound) => {
        if (!stillLost()) return;
        if (notFound) {
          /* The room is gone, and the host's game with it. */
          this.showHud('The host left. The match is over.', true, again(), alone());
        } else if (attempt < REJOIN_ATTEMPTS) {
          this.rejoinTimer = setTimeout(() => this.rejoin(attempt + 1), REJOIN_RETRY_MS);
        } else {
          this.showHud(`Could not rejoin. ${text}`, true, again(), alone());
        }
      },
    });
  }

  protected playAlone(): void {
    if (this.rejoinTimer !== null) clearTimeout(this.rejoinTimer);
    this.rejoinTimer = null;
    this.dropConnection();
    this.session?.continueLocal();
  }

  // -------------------------------------------------------------------------
  // Connection and session

  /* Close whatever a guest has open that no session owns. */
  protected dropConnection(): void {
    if (this.helloTimer !== null) clearTimeout(this.helloTimer);
    this.helloTimer = null;
    if (this.pending !== null) {
      this.pending.cancel();
      this.pending = null;
    }
    if (this.transport !== null) {
      this.transport.onMessage = null;
      this.transport.onClose = null;
      this.transport.close();
      this.transport = null;
    }
  }

  /* Build the game of an online match and make it the current game, with
     this browser as the given player. */
  protected buildGame(setup: GameSetup, localPlayer: number): Game | null {
    setLocalPlayer(localPlayer);
    const manager = GameManager.getInstance();
    /* A session of an earlier match (played on alone) is replaced by the
       caller, not ended as if the player had started a solo game. */
    this.rebuilding = true;
    try {
      if (!manager.startGame(new NetGameInfo(setup))) {
        setLocalPlayer(0);
        return null;
      }
    } finally {
      this.rebuilding = false;
    }
    return manager.getCurrentGame();
  }

  /* The same for a game that comes from a save game: at a start from a
     file, and whenever a running game is built again on every side (a
     resync). Whoever played them before, players 0 to humans - 1 are now
     the host and the guests. With keepView the map stays where it was (the
     game is the one on the screen, built again). */
  protected buildSavedGame(
    text: string, localPlayer: number, humans: number, paused: boolean, keepView: boolean,
  ): Game | null {
    const check = new Game();
    try {
      if (!GameStore.getInstance().read(text, check)) return null;
    } catch (e) {
      console.error('[net] the save game can not be read', e);
      return null;
    }
    if (!hasPlayers(check, humans)) {
      console.error(`[net] the save game has no ${humans} players`);
      return null;
    }

    const viewport = keepView ? this.iface.getViewport() : null;
    const center = viewport !== null ? viewport.getCurrentMapPos() : -1;
    const cursor = keepView ? this.iface.getMapCursorPos() : -1;

    setLocalPlayer(localPlayer);
    const manager = GameManager.getInstance();
    this.rebuilding = true;
    try {
      /* A box of the old game may hold what the new one does not have. */
      this.iface.closePopup();
      if (!manager.loadGameText(text)) return null;
    } finally {
      this.rebuilding = false;
    }
    const game = manager.getCurrentGame();
    if (game === null) return null;
    prepareLoadedGame(game, humans, paused);

    const cells = game.getMap().getCols() * game.getMap().getRows();
    if (cursor >= 0 && cursor < cells) this.iface.updateMapCursorPos(cursor);
    if (center >= 0 && center < cells) this.iface.getViewport()?.moveToMapPos(center);
    return game;
  }

  /* What the host's and a guest's session have in common. `self` gives the
     session once it exists. */
  protected sessionOptions(
    game: Game, localPlayer: number, humans: number, self: () => LockstepSession,
  ): SessionOptions {
    const mine = (): boolean => this.session === self();
    return {
      game,
      localPlayer,
      humans,
      timer: new WorkerTimer(),
      onStatus: (status) => {
        if (mine()) this.showStatus(status);
      },
      onRoster: (_connected, changes) => {
        if (mine()) this.showRoster(changes);
      },
      onChat: (from, text) => {
        if (mine()) this.chat.addChat(from, text);
      },
      onMark: (from, pos) => {
        if (mine()) this.chat.addMark(from, pos);
      },
      onResync: () => {
        if (mine()) this.chat.addNote('The game was loaded again for everyone.');
      },
      rebuild: (text, count, paused) => this.buildSavedGame(text, localPlayer, count, paused, true),
    };
  }

  protected installSession(session: LockstepSession): void {
    this.session = session;
    setCommandSink(session);
    setGameClock(session);
    /* The interface took the local player when the game was set; this is
       for an interface that did not. */
    this.iface.setPlayer(session.getLocalPlayer());
    this.chat.setLink({
      sendChat: (text) => this.session === session && session.sendChat(text),
      sendMark: (pos) => this.session === session && session.sendMark(pos),
    }, session.getLocalPlayer());
    if (!this.hintShown) {
      this.hintShown = true;
      this.chat.addNote('Enter opens the chat. Alt+click on the map points at a place.');
    }
  }

  /* Stop the session a new one takes the place of. */
  protected replaceSession(): LockstepSession | null {
    const old = this.session;
    if (old !== null) {
      this.session = null;
      old.stop();
    }
    return old;
  }

  protected endSession(): void {
    const session = this.session;
    if (session === null) return;
    this.session = null;
    if (this.rejoinTimer !== null) clearTimeout(this.rejoinTimer);
    this.rejoinTimer = null;
    session.stop();
    this.dropConnection();
    if (this.phase === 'game') this.closeRoom();
    setCommandSink(null);
    setGameClock(null);
    setLocalPlayer(0);
    this.chat.setLink(null);
    this.hideHud();
  }

  // GameManager::Handler implementation

  onNewGame(_game: Game): void {}

  /* The online game was replaced (a new game from the game's own menu):
     the session ends, the others see this player leave. */
  onEndGame(game: Game): void {
    if (this.rebuilding) return;
    if (this.session !== null && this.session.getGame() === game) {
      this.endSession();
    }
  }

  // -------------------------------------------------------------------------
  // Status line over the game

  protected showRoster(changes: RosterChange[]): void {
    for (const change of changes) {
      const name = `Player ${change.player + 1}`;
      if (change.connected) {
        this.chat.addNote(`${name} is back.`);
      } else {
        this.chat.addNote(`${name} left. The kingdom stays. ${name} can rejoin with code ${this.roomCode}.`);
      }
    }
  }

  protected showStatus(status: SessionStatus): void {
    const session = this.session;
    const host = session !== null && session.isHost();
    const alone = (): HTMLButtonElement => button('Keep playing alone', () => this.playAlone());

    switch (status.kind) {
      case 'running':
      case 'stopped':
        this.hideHud();
        break;
      case 'waiting': {
        const names = status.players.map((p) => `player ${p + 1}`).join(' and ');
        this.showHud(names !== '' ? `Waiting for ${names}…` : 'Waiting for the other players…');
        break;
      }
      case 'disconnected':
        /* Only a guest gets here: it lost the host. */
        if (status.reason === 'timeout') {
          this.showHud('No answer from the host. The game waits.', true, alone());
        } else {
          this.rejoin(1);
        }
        break;
      case 'desync': {
        const who = `player ${status.player + 1}`;
        this.showHud(
          `The game of ${who} is out of sync. The game is stopped. It goes on when ${who} reloads the page and rejoins.`,
          true, alone());
        break;
      }
      case 'local':
        /* Alone for good: nobody can come back. */
        if (host) this.closeRoom();
        this.chat.setLink(null);
        this.showHud('Playing alone.');
        this.hudTimer = setTimeout(() => this.hideHud(), NOTE_MS);
        break;
    }
  }

  protected showHud(text: string, alert = false, ...actions: HTMLElement[]): void {
    if (this.hudTimer !== null) clearTimeout(this.hudTimer);
    this.hudTimer = null;
    this.hud.className = alert ? 'ov-hud ov-alert' : 'ov-hud';
    this.hud.replaceChildren(element('span', '', text), ...actions);
    this.hud.hidden = false;
  }

  protected hideHud(): void {
    if (this.hudTimer !== null) clearTimeout(this.hudTimer);
    this.hudTimer = null;
    this.hud.hidden = true;
    this.hud.replaceChildren();
  }
}

export function openLobby(iface: Interface): Lobby {
  return new Lobby(iface);
}
