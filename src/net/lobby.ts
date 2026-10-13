// The lobby: the page overlay shown at startup with the choice between a
// solo game, hosting an online game and joining one. It also runs an online
// game once it has begun: it owns the session, installs it as command sink
// and game clock, and shows the status line over the game.

import type { Game } from '../game/game';
import { GameManager } from '../game/game-manager';
import type { GameManagerHandler } from '../game/game-manager';
import type { PGameInfo } from '../game/mission';
import { Random } from '../game/random';
import { setOnlineHost } from '../ui/game-init';
import type { Interface } from '../ui/interface';
import '../ui/overlay.css';
import { setCommandSink, setGameClock, setLocalPlayer } from './command';
import { hostRoom, joinRoom, normalizeRoomCode, ROOM_CODE_LENGTH } from './peer-transport';
import type { NetError, PendingConnection } from './peer-transport';
import { PROTOCOL_VERSION } from './protocol';

const SOURCE_URL = 'https://github.com/pkreusser-hub/settlers';
import type { GameSetup, NetMessage, Transport } from './protocol';
import { LockstepSession, WorkerTimer } from './session';
import type { SessionStatus } from './session';
import { isValidSetup, makeSetup, NetGameInfo } from './setup';

// How long the two sides may take to exchange their versions.
const HELLO_TIMEOUT_MS = 10000;
// How long "Playing alone." stays on the screen.
const NOTE_MS = 4000;

const TEXT = {
  notFound: (code: string) => `No game found for code ${code}. Check the code with the host.`,
  failed: 'Could not connect. Check your internet connection and try again.',
  unsupported: 'This browser cannot make the connection (WebRTC is missing or blocked).',
  version: 'The other player has a different version of the game. Both reload the page, then try again.',
  badCode: `Enter the ${ROOM_CODE_LENGTH}-character code the host sees.`,
  hostLeft: 'The host closed the game.',
  guestLeft: 'The other player left.',
  badStart: 'The host sent a game this version cannot build. Both reload the page, then try again.',
};

function netErrorText(error: NetError, code: string): string {
  if (error === 'not-found') return TEXT.notFound(code);
  if (error === 'unsupported') return TEXT.unsupported;
  return TEXT.failed;
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

export class Lobby implements GameManagerHandler {
  protected iface: Interface;
  protected backdrop: HTMLDivElement;
  protected panel: HTMLDivElement;
  protected hud: HTMLDivElement;
  protected hudTimer: ReturnType<typeof setTimeout> | null = null;

  /* Opening a room or joining one. */
  protected pending: PendingConnection | null = null;
  protected helloTimer: ReturnType<typeof setTimeout> | null = null;
  /* The open channel, before and during the game. */
  protected transport: Transport | null = null;
  protected session: LockstepSession | null = null;

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
    /* Leaving the page closes the channel, so that the other player sees
       it at once and not only after the silence limit. */
    window.addEventListener('pagehide', (event) => {
      if (!event.persisted) this.transport?.close();
    });
    GameManager.getInstance().addHandler(this);

    this.showMenu();
  }

  // -------------------------------------------------------------------------
  // Screens

  protected setScreen(...children: HTMLElement[]): void {
    this.panel.replaceChildren(...children);
    this.backdrop.hidden = false;
    const focus = this.panel.querySelector<HTMLElement>('input, button');
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
      element('p', 'ov-text', 'Play alone, or with one other player over the internet.'),
      buttons,
      message,
      source,
    );
  }

  // -------------------------------------------------------------------------
  // Host

  protected startHosting(): void {
    const status = element('p', 'ov-status', 'Opening a room…');
    status.setAttribute('role', 'status');
    const codeBox = element('div', 'ov-code', '······');
    codeBox.setAttribute('aria-label', 'Room code');
    const copy = button('Copy code', () => undefined);
    copy.disabled = true;
    const buttons = element('div', 'ov-buttons');
    buttons.append(copy, button('Cancel', () => {
      this.dropConnection();
      this.showMenu();
    }, true));

    this.setScreen(
      element('h1', 'ov-title', 'Host online game'),
      element('p', 'ov-text', 'Give this code to the other player.'),
      codeBox,
      status,
      buttons,
    );

    this.pending = hostRoom({
      onCode: (code) => {
        codeBox.textContent = code;
        status.textContent = 'Waiting for the other player…';
        copy.disabled = false;
        copy.onclick = () => {
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
        };
      },
      onGuest: (transport) => {
        this.pending = null;
        this.transport = transport;
        status.textContent = 'The other player is connecting…';
        this.exchangeHello(transport, () => this.showHostConnected(), (text) => this.showMenu(text));
      },
      onError: (error) => {
        this.pending = null;
        this.showMenu(netErrorText(error, ''));
      },
    });
  }

  protected showHostConnected(): void {
    const transport = this.transport as Transport;
    transport.onMessage = null;
    transport.onClose = () => {
      this.dropConnection();
      this.showMenu(TEXT.guestLeft);
    };

    const buttons = element('div', 'ov-buttons');
    buttons.append(
      button('Set up the game', () => this.showHostSetup()),
      button('Cancel', () => {
        this.dropConnection();
        this.showMenu();
      }, true),
    );
    this.setScreen(
      element('h1', 'ov-title', 'Host online game'),
      element('p', 'ov-text',
        'The other player is connected. Choose the map and the computer players, then start. ' +
        'You are player 1, the other player is player 2.'),
      buttons,
    );
  }

  /* The game init box of the game, in its online form. */
  protected showHostSetup(): void {
    const transport = this.transport as Transport;
    transport.onClose = () => {
      this.dropConnection();
      this.reopenGameInit();
      this.showMenu(TEXT.guestLeft);
    };

    setOnlineHost({
      start: (mission) => this.hostStart(mission),
      cancel: () => {
        this.dropConnection();
        this.reopenGameInit();
        this.showMenu();
      },
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
    const transport = this.transport;
    if (transport === null) return false;

    const setup = makeSetup(mission, new Random());
    const game = this.buildGame(setup, 0);
    if (game === null) return false;
    setOnlineHost(null);

    transport.send({ t: 'start', v: PROTOCOL_VERSION, setup });

    const session = this.installSession(game, 0, transport);
    this.showHud('Waiting for the other player…');
    /* The clock starts when the guest has built the game. */
    transport.onMessage = (msg: NetMessage) => {
      if (msg.t === 'ready' && this.session === session) {
        this.hideHud();
        session.start();
      }
    };
    transport.onClose = () => {
      if (this.session !== session) return;
      session.start();
      /* The session has taken the channel over: tell it. */
      transport.onClose?.();
    };
    return true;
  }

  // -------------------------------------------------------------------------
  // Guest

  protected showJoin(error = '', code = ''): void {
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

      this.pending = joinRoom(roomCode, {
        onOpen: (transport) => {
          this.pending = null;
          this.transport = transport;
          this.exchangeHello(
            transport,
            () => this.showGuestWaiting(roomCode),
            (text) => this.showJoin(text, roomCode),
          );
        },
        onError: (netError) => {
          this.pending = null;
          this.showJoin(netErrorText(netError, roomCode), roomCode);
        },
      });
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });

    this.setScreen(
      element('h1', 'ov-title', 'Join online game'),
      element('p', 'ov-text', 'Enter the code the host gave you.'),
      label,
      input,
      message,
      buttons,
    );
  }

  protected showGuestWaiting(code: string): void {
    const transport = this.transport as Transport;
    transport.onClose = () => {
      this.dropConnection();
      this.showJoin(TEXT.hostLeft, code);
    };
    transport.onMessage = (msg: NetMessage) => {
      if (msg.t !== 'start') return;
      if (msg.v !== PROTOCOL_VERSION) {
        this.dropConnection();
        this.showJoin(TEXT.version, code);
        return;
      }
      if (!this.guestStart(msg.setup)) {
        this.dropConnection();
        this.showJoin(TEXT.badStart, code);
      }
    };

    const buttons = element('div', 'ov-buttons');
    buttons.append(button('Cancel', () => {
      this.dropConnection();
      this.showMenu();
    }, true));
    const status = element('p', 'ov-status', 'Waiting for the host to start the game…');
    status.setAttribute('role', 'status');
    this.setScreen(
      element('h1', 'ov-title', 'Join online game'),
      element('p', 'ov-text', `Connected to game ${code}. You are player 2.`),
      status,
      buttons,
    );
  }

  protected guestStart(setup: GameSetup): boolean {
    const transport = this.transport;
    if (transport === null || !isValidSetup(setup)) return false;

    const game = this.buildGame(setup, 1);
    if (game === null) return false;

    /* The guest never sees the game init box. */
    this.iface.closeGameInit();
    this.hide();

    const session = this.installSession(game, 1, transport);
    transport.send({ t: 'ready' });
    session.start();
    return true;
  }

  // -------------------------------------------------------------------------
  // Connection and session

  /* Both sides send their version when the channel opens and check the
     other's. */
  protected exchangeHello(transport: Transport, ok: () => void, fail: (text: string) => void): void {
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
        /* Leave the other side the time to read this side's version. */
        end();
        setTimeout(() => failed(TEXT.version), 500);
        return;
      }
      end();
      ok();
    };
    transport.onClose = () => failed(TEXT.failed);
    this.helloTimer = setTimeout(() => failed(TEXT.failed), HELLO_TIMEOUT_MS);
    transport.send({ t: 'hello', v: PROTOCOL_VERSION });
  }

  /* Close whatever is open of a connection that has no session yet. */
  protected dropConnection(): void {
    if (this.helloTimer !== null) clearTimeout(this.helloTimer);
    this.helloTimer = null;
    if (this.pending !== null) {
      this.pending.cancel();
      this.pending = null;
    }
    if (this.transport !== null && this.session === null) {
      this.transport.onMessage = null;
      this.transport.onClose = null;
      this.transport.close();
      this.transport = null;
    }
    setOnlineHost(null);
  }

  /* Build the game of an online match and make it the current game, with
     this browser as the given player. */
  protected buildGame(setup: GameSetup, localPlayer: number): Game | null {
    setLocalPlayer(localPlayer);
    const manager = GameManager.getInstance();
    if (!manager.startGame(new NetGameInfo(setup))) {
      setLocalPlayer(0);
      return null;
    }
    return manager.getCurrentGame();
  }

  protected installSession(game: Game, localPlayer: number, transport: Transport): LockstepSession {
    const session = new LockstepSession({
      game,
      localPlayer,
      transport,
      timer: new WorkerTimer(),
      onStatus: (status) => {
        if (this.session === session) this.showStatus(status);
      },
    });
    this.session = session;
    setCommandSink(session);
    setGameClock(session);
    /* The interface took the local player when the game was set; this is
       for an interface that did not. */
    this.iface.setPlayer(localPlayer);
    return session;
  }

  protected endSession(): void {
    const session = this.session;
    if (session === null) return;
    this.session = null;
    this.transport = null;
    session.stop();
    setCommandSink(null);
    setGameClock(null);
    setLocalPlayer(0);
    this.hideHud();
  }

  // GameManager::Handler implementation

  onNewGame(_game: Game): void {}

  /* The online game was replaced (a new game from the game's own menu):
     the session ends, the other player sees a disconnect. */
  onEndGame(game: Game): void {
    if (this.session !== null && this.session.getGame() === game) {
      this.endSession();
    }
  }

  // -------------------------------------------------------------------------
  // Status line over the game

  protected showStatus(status: SessionStatus): void {
    const alone = (): HTMLButtonElement =>
      button('Keep playing alone', () => this.session?.continueLocal());

    switch (status.kind) {
      case 'running':
      case 'stopped':
        this.hideHud();
        break;
      case 'waiting':
        this.showHud('Waiting for the other player…');
        break;
      case 'disconnected':
        if (status.reason === 'timeout') {
          this.showHud('No answer from the other player. The game waits.', true, alone());
        } else if (status.reason === 'closed') {
          this.showHud('The other player left the game.', true, alone());
        } else {
          this.showHud('The connection failed. The game is stopped.', true, alone());
        }
        break;
      case 'desync':
        this.showHud(`Games out of sync at turn ${status.turn}. The game is stopped.`, true, alone());
        break;
      case 'local':
        this.showHud('Playing alone.');
        this.hudTimer = setTimeout(() => this.hideHud(), NOTE_MS);
        break;
    }
  }

  protected showHud(text: string, alert = false, action: HTMLElement | null = null): void {
    if (this.hudTimer !== null) clearTimeout(this.hudTimer);
    this.hudTimer = null;
    this.hud.className = alert ? 'ov-hud ov-alert' : 'ov-hud';
    this.hud.replaceChildren(element('span', '', text));
    if (action !== null) this.hud.append(action);
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
