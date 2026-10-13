# Settlers web port

A TypeScript port of Freeserf (the open-source reimplementation of The Settlers 1) that runs in the browser with the original `SPAE.PA` data file. The goal is online two-player games using deterministic lockstep over a PeerJS data channel: both browsers run the same simulation and only player commands cross the network.

- `ref/freeserf/src/` is the C++ reference (git-ignored). It is the source of truth for behaviour.
- `src/data/` reads SPAE.PA. `src/game/` is the simulation. UI and netcode come later.
- `public/data/SPAE.PA` is the user's copy of the original data file. Never commit it.
- `npm run dev` serves on port 5317. `npm run typecheck` runs `tsc --noEmit`.

## Porting rules

Port each C++ file pair `foo.h` + `foo.cc` to one `src/game/foo.ts` (UI files go to `src/ui/`). Translate line by line. Do not redesign, simplify, reorder or "improve" logic, even where the original looks odd. Keep the original's comments.

Naming:
- Classes keep their names (`Game`, `Serf`, `MapPos`). Methods, fields and locals go from `snake_case` to `camelCase` (`get_free_knight_count` becomes `getFreeKnightCount`). No other renaming.
- Nested enums become a top-level TS `enum` named `<Class><Enum>` with the C++ member names unchanged, and are also exposed as a static on the class so both spellings work: `Building::TypeFisher` becomes `BuildingType.TypeFisher`, with `static Type = BuildingType` on `Building`. `Serf::StateWalking` becomes `SerfState.StateWalking`. `Resource::TypeFish` becomes `ResourceType.TypeFish` (already in `resource.ts`).
- Free functions and file-level constant tables keep their name in camelCase and are exported.
- `typedef unsigned int MapPos` becomes `export type MapPos = number`.

Types and memory:
- Pointers and references become object references; `nullptr` becomes `null`. A method that can return `nullptr` is typed `T | null`.
- `std::vector`/`std::list` become arrays, `std::map` becomes `Map`, fixed C arrays become arrays (or typed arrays when the element type is a fixed-width integer and wraparound matters).
- C `union`s (the serf state union `s`, building `u`) become one plain object per variant under the same names (`this.s.walking.dir`), all allocated up front. Where the C++ deliberately reads one variant after writing another, note it with a `// UNION ALIAS` comment and make it behave the same.
- Overloads become one method with optional parameters or distinct names; keep call sites unambiguous.
- `Collection<T, n>` is `Collection<T>` in `objects.ts`; `collection[i]` becomes `collection.get(i)`; range-for works unchanged.

Integer semantics (this is where ports go wrong):
- JS numbers are doubles. Wherever the C++ value is a fixed-width integer that can overflow or go negative, apply the helpers from `misc.ts`: `u8 u16 u32 i8 i16 i32`. Fields declared `uint16_t` must be masked on every write that could exceed the range, and `int16_t` casts must sign-extend.
- Integer division is `idiv(a, b)` or `Math.trunc`. Never leave a bare `/` where C++ did integer division.
- `x >> n` on unsigned 32-bit values is `x >>> n`. Multiplications that may exceed 2^53 or need 32-bit wrap use `Math.imul`.
- `Random.random()` returns a uint16, as in C++.
- Iteration order must match the C++ (it affects the random stream and therefore sync). Never iterate a `Set` or object keys where C++ iterated a vector or an ordered `std::map`; if the C++ used `std::map`, iterate keys in sorted order.
- No `Math.random()`, `Date.now()` or floating point in simulation code unless the C++ has it at that exact spot.

Logging and errors: `Log::Info["x"] << a << b` becomes `Log.Info('x', a, b)`. `throw ExceptionFreeserf(...)` stays. `NOT_REACHED()` is in `misc.ts`.

Savegame code: the text format is ported (`src/game/savegame.ts`; each class has `loadText(reader)` and `saveText(writer)` for the C++ `operator>>`/`operator<<`). The value names are the file format. The binary reader (`SaveReaderBinary`, original DOS saves) is not ported. Saved games live in IndexedDB (`GameStore`). `tools/save-test.ts` checks the round trip; run it after touching any `loadText`/`saveText` or adding simulation state.

Imports between game modules are circular. Use `import type` wherever a module only needs the type, and never run code at module top level that touches another game module's exports.

If something cannot be ported faithfully, port the closest thing and leave a `// PORT:` comment explaining the difference. Do not silently drop code.

## UI porting rules

UI files go to `src/ui/`. The foundation (`gfx.ts`, `gui.ts`, `event-loop.ts`, `video.ts`, `font.ts`, `box-frame.ts`, `data-instance.ts`, `freeserf.ts`) mirrors the C++ API in camelCase. Read those files for exact signatures. Differences from the C++ that every UI port must follow:

- Out-parameters are tuples: `getPosition()`, `getSize()`, `gfx.getResolution()`, `gfx.getScreenFactor()` return `[a, b]`.
- `Frame.drawSprite(x, y, res, index, useOff = false, colorOrProgress?, progress = 1)` is one method for all the C++ overloads.
- `Color` comparison is `a.equals(b)`; the CMYK constructor is `Color.fromCMYK`.
- `handleKeyPressed(key, modifier)` takes a char code: `case 'b':` becomes `case 0x62:`; appending is `String.fromCharCode(key)`.
- `Event` from `event-loop.ts` shadows the DOM `Event`; the game's `Map` class shadows the JS `Map`. Alias one on import when a module needs both (`import { Map as GameMap }`).
- No destructors: call `destroy()` on frames, GUI objects and timers where the C++ deletes; a subclass with a destructor overrides `destroy()` and calls `super.destroy()` last.
- `Timer::Handler` is `TimerHandler`; `EventLoop::Handler` is `EventLoopHandler`. `EventLoop.run()` returns a promise.
- Assets are `Data.Resource.AssetIcon` (or `DataResource.AssetIcon`) from `data-instance.ts`. `Data.getInstance().getMixedSource()` is always null.
- Sound: call `this.playSound(n)` as the C++ does; audio is not ported yet. Calls to `Audio`/`Audio::Player`/`Audio::VolumeController` go through `src/ui/audio.ts` (a no-op stand-in with the same method names until the audio port lands).
- The config file and command line features are not ported: keep the menu entries and call sites, route them to a `// TODO(savegame)` no-op.
