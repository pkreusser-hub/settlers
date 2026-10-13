# Settlers

A TypeScript port of [Freeserf](https://github.com/freeserf/freeserf), the open-source
reimplementation of The Settlers (Serf City, 1993), that runs in a browser. It adds
online play for two people: both browsers run the same simulation and exchange only
player commands over a PeerJS data channel.

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

A strip in the top-right corner sets game speed (1x, 2x, 4x, pause), map zoom and
the size of the panel and boxes. The mouse wheel or `[` and `]` zoom the map;
Ctrl+wheel resizes the panel.

## Online play

One player chooses Host online game and gets a six-character room code. The other
chooses Join online game and types it. The host sets up the map and starts. Game
speed and pause apply to both players.

Browsers connect directly to each other. On networks that block that (some mobile
carriers and office networks) the connection fails; there is no relay server.

## Layout

- `src/data/` reads SPAE.PA.
- `src/game/` is the simulation, ported file by file from Freeserf's C++.
- `src/ui/` is the canvas interface, sound and the page controls.
- `src/net/` is the command layer, lockstep session, lobby and PeerJS transport.
- `tools/` has headless checks: `sim.ts` (determinism), `commands-test.ts` and
  `lockstep-test.ts` (two simulated players under latency). Each file's header
  says how to run it.

`CLAUDE.md` records the rules the port follows, for anyone continuing it.

## Not done

Save and load are not ported. Most dialogs have had little testing. The music
plays through a simple built-in synthesizer, not the original AdLib sound.

## Licence

GPL-3.0-or-later, the same as Freeserf, which this is derived from. See `LICENSE`.
The Settlers is a trademark of its owner; this project is not affiliated with it.
