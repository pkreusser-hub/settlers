// Port of Freeserf's misc.h, debug.h and log.h.

export const BIT = (n: number): number => 1 << n;
export const BIT_TEST = (x: number, n: number): number => x & (1 << n);

export function clamp(l: number, x: number, h: number): number {
  return Math.max(l, Math.min(x, h));
}

// C++ integer conversions. Use these wherever the original relies on a
// fixed width type wrapping around.
export const u8 = (x: number): number => x & 0xff;
export const u16 = (x: number): number => x & 0xffff;
export const u32 = (x: number): number => x >>> 0;
export const i8 = (x: number): number => (x << 24) >> 24;
export const i16 = (x: number): number => (x << 16) >> 16;
export const i32 = (x: number): number => x | 0;

// C++ integer division (truncates toward zero).
export const idiv = (a: number, b: number): number => Math.trunc(a / b);

export class ExceptionFreeserf extends Error {}

export function NOT_REACHED(): never {
  throw new ExceptionFreeserf('NOT_REACHED');
}

type Level = 'verbose' | 'debug' | 'info' | 'warn' | 'error';

function logger(level: Level) {
  return (system: string, ...args: unknown[]): void => {
    if (level === 'verbose' || level === 'debug') {
      if (!Log.verbose) return;
      console.debug(`[${system}]`, ...args);
    } else {
      console[level](`[${system}]`, ...args);
    }
  };
}

// Log.Info['game'] << "x" << y;  becomes  Log.info('game', 'x', y);
export const Log = {
  verbose: false,
  Verbose: logger('verbose'),
  Debug: logger('debug'),
  Info: logger('info'),
  Warn: logger('warn'),
  Error: logger('error'),
};
