# Settlers

A TypeScript port of [Freeserf](https://github.com/freeserf/freeserf), the open-source
reimplementation of The Settlers (Serf City, 1993), that runs in a browser. It adds
online play for up to four people: every browser runs the same simulation and only
player commands cross PeerJS data channels.

Play it at https://kruzarcade.up.railway.app/games/settlers/.

## You need the original game's data file

The game draws and sounds from `SPAE.PA`, the data file of the DOS release. It is
copyrighted and is not in this repository or in any hosted build. Copy it from your
own copy of the game:

- For local development, put it at `public/data/SPAE.PA`.
- In a hosted build, the game asks for the file on first run and keeps it in that
  browser.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5317.

`npm run build` writes a static site to `dist/`. The build removes `data/` and
`resources/` from its output so the original game's files are never uploaded.

## Controls added by this port

A strip in the top-right corner sets game speed (1x, 2x, 4x, 8x, pause), saves and loads, map zoom,
the building-spots overlay (key B), the Smooth picture filter and
the size of the panel and boxes. The mouse wheel or `[` and `]` zoom the map;
Ctrl+wheel resizes the panel.

## Online play

One player chooses Host online game and gets a six-character room code. Up to three
others choose Join online game and type it. The host sees who has joined, sets up
the map and starts; places without a person can be computer players. Game speed and
pause apply to everyone.

A player whose connection drops, or who reloads the page, gets back in with the same
code (the menu offers Rejoin). Everyone's game is loaded again from the host's at
that moment. While a player is away their kingdom stays and nobody commands it. If
the host leaves, the match is over; each player can keep playing alone.

Enter opens a one-line chat (Enter sends, Esc closes). Alt+click on the map shows
the other players a marker there.

Every guest connects directly to the host. On networks that block that (some mobile
carriers and office networks) the connection fails; there is no relay server.

## Layout

- `src/data/` reads SPAE.PA.
- `src/game/` is the simulation, ported file by file from Freeserf's C++.
- `src/ui/` is the canvas interface, sound and the page controls; `src/ui/menu/` has the HTML menus.
- `src/net/` is the command layer, lockstep session, lobby and PeerJS transport.
- `tools/` has headless checks: `sim.ts` (determinism), `commands-test.ts` and
  `lockstep-test.ts` (two to four simulated players under latency, with drops and
  rejoins). Each file's header
  says how to run it.

`CLAUDE.md` records the rules the port follows, for anyone continuing it.

## Building help

The build button opens a menu that names each building that fits the spot and
says what it needs and makes. V shows the production chains. Keys build the
common buildings at the map cursor (W woodcutter, E forester, Q stonecutter,
A sawmill, I fisher, D farm, H guard hut, F flag, R road). L opens a list of
problems such as buildings without a worker or mines without food.

## Menus

The boxes of the original game are being rebuilt as windows of the page, with
text labels, in the game's own frame and icons (drawn from your SPAE.PA). So far:
food for the mines (settings) and production over time (statistics). Drag a
window by its title bar; Esc closes it. Boxes that are not rebuilt yet open as
before.

## Save and load

Save in the top bar stores the game in this browser under the date and time;
Load lists the saved games. The options box of the game saves under a name
of your choice. To go on with an online game, the host picks "Host online
game", switches the game type in the setup box to the saved games and starts
one: the other players receive the file. The first players of the saved game
are the host and the guests, in the order they joined; the file needs at least
as many players as there are people.

The file is Freeserf's text format, with two more values (the game speed and
the tick counter).

## Not done

Save games of the original DOS game cannot be read. Most dialogs have had little testing. The music
plays through a simple built-in synthesizer, not the original AdLib sound.

## Licence

GPL-3.0-or-later, the same as Freeserf, which this is derived from. See `LICENSE`.
The Settlers is a trademark of its owner; this project is not affiliated with it.
