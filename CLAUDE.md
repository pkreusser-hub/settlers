# Settlers web port

A TypeScript port of Freeserf (the open-source reimplementation of The Settlers 1) that runs in the browser with the original `SPAE.PA` data file. The goal is online games for up to four players using deterministic lockstep over a PeerJS data channel: both browsers run the same simulation and only player commands cross the network.

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

## Map overlays, minimap and preferences

These are display only and not part of Freeserf. They read the game and never write to it; nothing here reaches the save, the hash or the network.

- `src/ui/prefs.ts` keeps every choice of the page in `localStorage`, one key per setting under `settlers.pref.` (`prefBool`, `prefNumber`, `prefString` and their setters, `onPrefChange`). A new toggle or size goes through it; do not call `localStorage` directly. `Interface.settingsGet/settingsSet` (sound, music, volume, messages, autosave) and the scales of `event-loop.ts` use it too. In dev, `settlers.devMute` wins over the sound choices and is not stored as one (`Interface.soundSettingsLocked`).
- `src/ui/map-overlays.ts` draws the overlays of the map view: territory (`ViewportLayer.LayerTerritory`, cached in tiles of 512 by 320 pixels), traffic (`LayerTraffic`) and status badges (`LayerBadges`). `Viewport.internalDraw` calls them; a layer that is off computes nothing. A new overlay is a new `ViewportLayer` bit with an entry in `storedLayers` of `viewport.ts`, a button and a key in the View group of `hud.ts`, and a legend entry. `overlays.css` (prefix `ov-`, badges `bd-`) styles the legend.
- `src/ui/minimap-panel.ts` and `minimap-panel.css` (prefix `mm-`) are the minimap in the corner. It takes the terrain colours from `minimapTerrainColors` of `minimap.ts`; the map window of the original (`minimap.ts`, `menu/map.ts`) is separate and unchanged. It hears of new messages through `Interface.messageObservers`.
- A state is never shown by colour alone: land has a fill pattern and a border style, traffic a line width, each badge its own shape.

## Extensions

Rules that the original does not have are marked `// EXT:` in the code. For each one:

- Integers only, no `Math.random`, no clock. With the rule not in use the game runs exactly as before (the digests of `tools/sim.ts` do not change).
- Every action of a player is a command in `src/net/commands.ts` that checks its arguments, with a case in `tools/commands-test.ts`.
- New state is written to the save only when set, read with `hasValue`, and mixed into `src/net/hash.ts`.
- The computer players must keep working with it.
- A change that online players must share bumps `PROTOCOL_VERSION`.

In the game so far: game options (`GameRules`: starting stock, peace) and teams (`Player.getTeam`, `Game.isAllied`, `Game.mayAttack`), tested by `tools/teams-test.ts`; building pause, output cap and upgrade in place (`Building.extPaused`, `extCap`, `upgradeTo`), tested by `tools/buildings-test.ts`; extra carriers on busy roads (`GameRules.busyRoads`, `Flag.extLoad`, `extBusy`, `extRoadBusy`; no command, the flags measure it), tested by `tools/roads-test.ts`; trading between players (`GameRules.trading`, `Game.trade` of `src/game/trade.ts`: offers and shipments under way, each walked by a trader along `TradeShipment.way` from `src/game/trade-route.ts` and drawn by `src/ui/caravan-layer.ts` with the art of `src/ui/art/caravan.ts`; commands `tradeOffer`, `tradeAccept`, `tradeDecline`, `tradeCancel`; the computer players answer in `answerTradeOffers` of `ai-manage.ts`), tested by `tools/trade-test.ts`; knight controls, always available (no `GameRules` option): the stance of a guard hut, tower or fortress (`Building.extStance`, a `BuildingStance`: on Hold `Building.updateMilitary` wants the full garrison and `Player.availableKnightsAtPos` and `startAttack` skip the building; command `setBuildingStance`), the rally point of a player (`Player.extRally`, a building index: `updateMilitary` wants its full garrison and sends the knight another building asks for there while it has room, through `Player.extRallyTakesKnight`; `Player.knightsAvailableForAttack` puts it at the head of `attackingBuildings`; cleared in `Building.burnup` and `Player.buildingCaptured`; commands `setRallyPoint`, `clearRallyPoint`) and the read-only attack forecast of `src/game/knights.ts` (the duel formula of `Serf.setFightOutcome`, shown by `src/ui/menu/attack.ts`); the original computer players do not use them; tested by `tools/knights-test.ts`; the level of the computer players (`GameRules.aiLevel`: 0 Original, the port of Freeserf, 1 Improved; `Game.getAiLevelOf`): at level 1 `src/game/ai-ext.ts` runs after each management step of `ai-core.ts` (`afterStep`) and decides the attacks in `Manage.attack` with the forecast (`attackKnights`); it upgrades border buildings, caps and pauses producers, sets Hold and the rally point, fills the border at the end of the peace and makes trade offers, each through the checks of the matching command; it keeps no memory of its own (it reads back the caps, stances and rally point it set), tested by `tools/ai-test.ts`.

## HTML menus

The boxes of the game (`src/ui/popup.ts` and the other canvas boxes) are being replaced by HTML windows in `src/ui/menu/`. `kit.ts` is the window and the registry, `widgets.ts` the controls, `theme.css` the colours, `theme.ts` the frame and patterns drawn from SPAE.PA at run time, `names.ts` shared names. Each family of boxes has one file (`stats.ts`, `settings.ts`, `buildings.ts`, `start.ts`) with a `register*Boxes()` that `index.ts` calls. `initMenus(iface, gameManager)` installs the registry as `Interface.popupHook`: a registered `PopupBoxType` opens as a window, every other type opens as the canvas popup.

Rules for every box port:

- A menu only reads the game. It changes the game only through the `cmd*` functions of `src/net/commands.ts`, with the same calls and arguments that `PopupBox.handleAction()` makes for that box today. Never call a setter of `Player`, `Game`, `Building`, `Flag` or `Inventory`. If an action has no command, stop and report it; do not write to the game. Choices that belong to the interface (`Interface.setSelectedStat*`, `iface.attack.knightsAttacking`, minimap options, sound and message options) are set on the interface as the canvas box does.
- Remove nothing from `popup.ts`, `game-init.ts`, `notification.ts` or `advanced-box.ts`. The canvas box stays as the fallback until every box is ported.
- Read values in `get()` callbacks and in `update()`, not once in the factory: the window stays open while the game runs. Read `player.tempIndex` (the building or flag of the box) the same way, and close the box when the canvas version would (`tempIndex === 0`, building burning, wrong type).
- Every number the original box shows is still shown, with a text label. An icon alone is not a label.
- Text is plain English, short, active voice, no exclamation marks. Use the names of `production.ts` and `names.ts`.
- Pictures come from the game data through `iconCanvas`, `resourceIcon`, `buildingIcon`, `serfIcon`, `faceCanvas`, `assetCanvas`. No emoji, no new art, no file of the original in the repository.
- Colours come from the `--gx-*` variables of `theme.css`, sizes are in `em` or `--gx-px`. Add shared styles to `kit.css` only when two families need them; a family's own classes go in its own CSS file with its own prefix.
- A state is never shown by colour alone, every control works with the keyboard, and `update()` must be cheap (it runs four times a second): compare with what is shown and touch the DOM only on a change. The widgets do this already.
- To go to another box call `ctx.open(type)`; it opens the window or the canvas popup, whichever exists. To close call `ctx.close()`.

Kit API (`import { ... } from './kit'` and `'./widgets'`):

- `registerBox(type | type[], (ctx) => ({ update?, dispose? }) | void)`. `ctx` has `iface`, `gameManager`, `box`, `game`, `player`, `win`, `open(box)`, `close()`, `sound(sfx)`.
- `ctx.win`: `setTitle(text)`, `setPattern('green' | 'brown' | 'build' | 'plain')` (the background of the original box), `setSize('narrow' | 'normal' | 'wide')`, `setTabs(tabs, current, ctx.open)`, `add(...widgets)` (appends to the body and runs their `update()` on the timer), `addTo(parent, ...)`, `track(widget)`, `foot()` (footer element), `body`, `initialFocus`.
- Widgets, each `{ el, update? }`: `numberRow`, `numberGrid`, `meter`, `slider`, `shareSlider` (0..65500 in steps of 1310, the slide bars of the original), `stepper`, `toggle`, `segmented`, `priorityList`, `chart({ kind: 'bars' | 'lines', ... })`, `confirmRow`, `section`, `hint`, `button`.
- `registerOpener` and `onBoxOpening` are for a box that is not a kit window (the build menu uses them).

Example, the food box (`settings.ts`):

```ts
function sett1Box(ctx: BoxContext): BoxView {
  const { win, game, player } = ctx;
  win.setTitle('Food for the mines');
  win.setPattern('brown');
  win.add(
    hint('A mine with a longer bar gets fish, meat and bread before the others.'),
    shareSlider({
      label: 'Stone mines',
      icon: fitHeight(buildingIcon(BuildingType.TypeStoneMine, player.getColor()), 2.4),
      get: () => player.getFoodStonemine(),
      // ACTION_SETT_1_ADJUST_STONEMINE of popup.ts
      set: (value) => cmdSetDistribution(game, 'setFoodStonemine', value),
    }),
  );
  win.foot().append(
    button('Default values', () => cmdResetPriority(game, 'resetFoodPriority')),
    button('Back to settings', () => ctx.open(PopupBoxType.TypeSettSelect)),
  );
  return {};
}

registerBox(PopupBoxType.TypeSett1, sett1Box);
```

Check a port in the browser: the box opens from the same panel button, key or map click as before, shows the values of the game fields, each control issues the expected command (`addCommandListener` in the dev console) and Escape and the panel button close it.
