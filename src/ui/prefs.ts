// Preferences of this browser: what the player chose for the page (scales,
// overlays, sound, the minimap) and nothing of the game. Not part of
// Freeserf.
//
// One localStorage key per preference, "settlers.pref." + name. Every access
// is guarded: without storage (private mode, blocked, full) the values last
// until the page is closed and the game runs as before.

const PREFIX = 'settlers.pref.';

/* What was read or written last: the storage is asked once per name, and a
   value that did not change is not written again. */
const cache = new Map<string, string | null>();

type Listener = (name: string) => void;
const listeners: Listener[] = [];

function read(name: string): string | null {
  if (cache.has(name)) return cache.get(name) ?? null;
  let value: string | null = null;
  try {
    value = localStorage.getItem(PREFIX + name);
  } catch {
    value = null;
  }
  cache.set(name, value);
  return value;
}

function write(name: string, value: string): void {
  if (cache.get(name) === value) return;
  cache.set(name, value);
  try {
    localStorage.setItem(PREFIX + name, value);
  } catch {
    /* No storage: the value lasts until the page is closed. */
  }
  for (const listener of listeners) listener(name);
}

/* Whether the preference was ever set. */
export function prefHas(name: string): boolean {
  return read(name) !== null;
}

export function prefString(name: string, fallback: string): string {
  return read(name) ?? fallback;
}

export function prefSetString(name: string, value: string): void {
  write(name, value);
}

export function prefBool(name: string, fallback: boolean): boolean {
  const value = read(name);
  if (value === '1') return true;
  if (value === '0') return false;
  return fallback;
}

export function prefSetBool(name: string, value: boolean): void {
  write(name, value ? '1' : '0');
}

/* A number within [min, max]; anything else stored gives the fallback. */
export function prefNumber(name: string, fallback: number, min = -Infinity, max = Infinity): number {
  const value = read(name);
  if (value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

export function prefSetNumber(name: string, value: number): void {
  write(name, String(value));
}

/* Called with the name after a preference changed in this page. */
export function onPrefChange(listener: Listener): void {
  listeners.push(listener);
}

/* A value kept under an older key, before the preferences had one place:
   read once to carry it over. Null without one. */
export function legacyValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
