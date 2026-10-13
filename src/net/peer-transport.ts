// The PeerJS implementation of Transport: a WebRTC data channel between two
// browsers, set up through the public PeerJS broker. A room code maps to
// the host's peer id.

import { Peer } from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { NetMessage, Transport } from './protocol';

const PEER_ID_PREFIX = 'settlers1-';

// No I, L, O, 0 or 1: they are easy to confuse when read out.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

// How long joining may take before it counts as failed.
const CONNECT_TIMEOUT_MS = 20000;
// A taken room code is replaced by another this many times.
const MAX_CODE_ATTEMPTS = 5;

export type NetError =
  // No host with that code.
  | 'not-found'
  // The broker or the peer could not be reached.
  | 'failed'
  // This browser has no WebRTC.
  | 'unsupported';

export function makeRoomCode(): string {
  const values = new Uint32Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(values);
  let code = '';
  for (const v of values) {
    code += ROOM_CODE_ALPHABET[v % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

/* What the player typed, as a room code; null when it can not be one. */
export function normalizeRoomCode(text: string): string | null {
  const code = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const c of code) {
    if (!ROOM_CODE_ALPHABET.includes(c)) return null;
  }
  return code;
}

class PeerTransport implements Transport {
  onMessage: ((msg: NetMessage) => void) | null = null;
  onClose: (() => void) | null = null;

  protected peer: Peer;
  protected conn: DataConnection;
  protected closed = false;

  constructor(peer: Peer, conn: DataConnection) {
    this.peer = peer;
    this.conn = conn;
    conn.on('data', (data) => {
      if (this.closed) return;
      if (typeof data !== 'object' || data === null) return;
      this.onMessage?.(data as NetMessage);
    });
    conn.on('close', () => this.remoteClosed());
    conn.on('error', (err) => {
      console.error('[net] connection error', err);
      this.remoteClosed();
    });
    conn.on('iceStateChanged', (state) => {
      if (state === 'failed' || state === 'closed') this.remoteClosed();
    });
  }

  send(msg: NetMessage): void {
    if (this.closed || !this.conn.open) return;
    // Serialization 'json': PeerJS turns the object into JSON text.
    void this.conn.send(msg);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.conn.close();
    } finally {
      this.peer.destroy();
    }
  }

  protected remoteClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.peer.destroy();
    this.onClose?.();
  }
}

export interface PendingConnection {
  cancel(): void;
}

function errorKind(type: string): NetError {
  if (type === 'peer-unavailable') return 'not-found';
  if (type === 'browser-incompatible') return 'unsupported';
  return 'failed';
}

/* Open a room and wait for one guest. onCode is called once the broker has
   registered the room. */
export function hostRoom(handlers: {
  onCode(code: string): void;
  onGuest(transport: Transport): void;
  onError(error: NetError): void;
}): PendingConnection {
  let peer: Peer | null = null;
  let done = false;
  let attempts = 0;

  const fail = (error: NetError): void => {
    if (done) return;
    done = true;
    peer?.destroy();
    handlers.onError(error);
  };

  const open = (): void => {
    attempts++;
    const code = makeRoomCode();
    const p = new Peer(PEER_ID_PREFIX + code);
    peer = p;

    p.on('open', () => {
      if (!done) handlers.onCode(code);
    });

    p.on('connection', (conn) => {
      if (done) {
        /* The room holds two players. */
        conn.close();
        return;
      }
      conn.on('open', () => {
        if (done) {
          conn.close();
          return;
        }
        done = true;
        handlers.onGuest(new PeerTransport(p, conn));
      });
    });

    p.on('disconnected', () => {
      /* The broker dropped the room before a guest came: register again. */
      if (!done && !p.destroyed) p.reconnect();
    });

    p.on('error', (err) => {
      if (done) return;
      console.error('[net] host error', err.type, err);
      if (err.type === 'unavailable-id' && attempts < MAX_CODE_ATTEMPTS) {
        p.destroy();
        open();
        return;
      }
      fail(errorKind(err.type));
    });
  };

  open();

  return {
    cancel(): void {
      if (done) return;
      done = true;
      peer?.destroy();
    },
  };
}

/* Connect to the room with this code. */
export function joinRoom(code: string, handlers: {
  onOpen(transport: Transport): void;
  onError(error: NetError): void;
}): PendingConnection {
  let done = false;
  const peer = new Peer();

  const fail = (error: NetError): void => {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    peer.destroy();
    handlers.onError(error);
  };

  const timeout = setTimeout(() => fail('failed'), CONNECT_TIMEOUT_MS);

  peer.on('open', () => {
    if (done) return;
    const conn = peer.connect(PEER_ID_PREFIX + code, { reliable: true, serialization: 'json' });
    conn.on('open', () => {
      if (done) {
        conn.close();
        return;
      }
      done = true;
      clearTimeout(timeout);
      handlers.onOpen(new PeerTransport(peer, conn));
    });
    conn.on('error', (err) => {
      console.error('[net] join connection error', err);
      fail('failed');
    });
  });

  peer.on('error', (err) => {
    console.error('[net] join error', err.type, err);
    fail(errorKind(err.type));
  });

  return {
    cancel(): void {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      peer.destroy();
    },
  };
}
