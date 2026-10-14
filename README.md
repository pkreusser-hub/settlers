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

The View group of the strip shows more on the map. Each button has a key:

- Land (T) fills each player's land and draws its border. Yours is filled evenly
  with a solid border, the others are striped with a dashed border. In a game with
  teams a second press shows your team, the enemy teams and the players without a team.
- Traffic (Y) marks your roads as quiet (thin line), steady (medium) or congested (thick).
- Status (X, on at the start) puts one badge over a building of yours that is paused,
  has reached its output cap, is being upgraded, has no worker yet, waits for
  materials, or is a military building with no knight inside. Point at a badge to read it.
- Minimap (N) shows or hides a map of the whole world in the bottom right corner:
  terrain, land by player or team, buildings, the frame of the view, a ring where you
  are attacked and the markers of online players. Click or drag in it to move the view.
  Drag its top left corner or press − and + to resize it. With the focus on it the
  arrow keys move the view and Home goes to your castle.
- Legend keeps the list of what the fills, lines and badges mean on the page.

The original map window (the map button of the panel) works as before.

The browser remembers these choices, the zoom, the panel size, Smooth, Spots, sound and
music, the message options, the autosave interval and whether the stock panel is open.

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

## Rules added by this port

None of these change a game that does not use them.

- Starting stock: Poor, Normal or Rich, chosen in the game setup.
- Peace: nobody can attack for the first 10, 20, 30 or 60 minutes. The top bar
  shows the time left.
- Teams: the host puts players in team A or B in the setup. Allies cannot
  attack each other, computer players included, and a team wins together.
  A computer player settles 14 to 26 steps from an ally's castle, or for the
  first castle of its team as far from the enemies as it can; it waits up to
  two minutes for a human ally to place a castle first. Clicking an ally's
  building opens a window that names them as your ally.
- Extra carriers on busy roads: an option in the game setup, off by default.
  A road where three or more goods keep waiting at one end for about 30
  seconds gets one more carrier than its length allows. The carrier goes home
  when the road is quiet again. The window of a flag shows the carriers of
  each road and which roads are busy. Water roads and roads of 24 steps or
  more stay as they are.
- Trading between players: an option in the game setup, off by default. With
  the Trade button in the top bar, the Trade page of your castle or a
  storehouse, or the window of another player's building, you offer another player 1 to
  100 of one kind of goods, as a gift or for 1 to 100 of another kind. Any
  goods can be traded, weapons too; serfs and knights cannot. The other player
  has 3 minutes of game time to accept or decline, and you can have 4 offers
  open. Nothing is set aside while an offer is open: both stores must still
  hold the goods when it is accepted. Then the goods leave both stores at once
  and arrive after 10 seconds plus 1 second for each step between the two
  stores, 2 minutes at most. No carrier walks them: roads of two players never
  join. If the receiver has no castle or storehouse left the goods travel back,
  and they are lost if the sender has none either. A player whose castle has
  fallen cannot trade. Allies and enemies trade alike. A computer player takes
  every gift and accepts a swap only if you ask for no
  weapon or tool, for at most twice what you give, and for goods it has plenty
  of. Original computer players never make an offer; improved ones do (see
  Computer players below). A message tells you about an offer, its answer and
  the goods that arrive.
- Pause a building: its worker stays in but makes nothing.
- Output cap: a building stops when the stock of what it makes reaches the
  number you set, and starts again when the stock falls.
- Upgrade: a guard hut becomes a tower and a tower a fortress, in place. It
  keeps its knights and its land while planks and stones arrive. A hut needs
  room for a large building. A building that the enemy takes loses its upgrade.

- Attack forecast: before you send knights, the attack window shows which of
  your knights would go and their ranks, how many knights defend the building
  (their ranks do not show), the morale of both sides, and an estimate:
  Likely win, Even or Likely loss. The estimate uses the rule of the duels and
  averages over the ranks the defenders may have. It counts only the knights
  that are there now.
- Stance: a guard hut, tower or fortress is on Normal or on Hold. On Hold it
  keeps a full garrison (3, 6 or 12 knights) whatever the knight sliders say,
  and gives no knight to an attack.
- Rally point: you can make one of your guard huts, towers or fortresses your
  rally point. It wants a full garrison. While it has room, a knight that
  another of your buildings asks for goes to the rally point instead; a
  building with no knight at all still gets its first one, and so does any
  building when no knight can reach the rally point. An attack takes its
  knights from the rally point first, then from the nearest buildings as
  before. The rally point is cleared when the building is demolished, burns or
  is captured. A building cannot be on Hold and the rally point at once.

Pause, cap, upgrade, stance and rally point are in the window of the building.

- Computer players: Original or Improved, chosen in the game setup; Original
  is the default and plays exactly as before. Improved computer players also:
  - upgrade one border building facing an enemy at a time, when their stores
    hold the cost plus 20 planks and 15 stones, and not during the emergency
    program;
  - cap producers whose goods pile up (at 20 lumber, 100 planks, 50 stones,
    100 coal, iron ore or steel, 50 fish, meat, bread or wheat, 20 flour or
    pigs, 10 boats) and lift the cap when the store falls below half that;
    gold is never capped. They pause the toolmaker while they want no
    tool;
  - build instead of planning attacks during the peace, and fill the
    buildings next to an enemy in its last two minutes;
  - attack only when the attack forecast of the knights that would go is at
    least 6 in 10, and send the fewest knights that give 7.5 in 10 (or all);
  - put up to two border buildings on Hold when the enemy knights within 16
    steps outnumber a full garrison, and make their strongest border building
    facing their main enemy the rally point; both follow the front;
  - with trading on, offer 6 of a clear surplus for 4 of planks, stone, coal,
    iron ore, steel or food they have fewer than 5 of: to an ally if they
    have one, else to anyone, one open offer at a time, at most in one minute
    of every four, never weapons or tools.

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
