/*
 * main.ts - Main program source.
 *
 * Port of Freeserf's freeserf.cc.
 *
 * Copyright (C) 2013-2018  Jon Lund Steffensen <jonlst@gmail.com>
 *
 * This file is part of freeserf.
 *
 * freeserf is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * freeserf is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with freeserf.  If not, see <http://www.gnu.org/licenses/>.
 */

import { GameManager } from './game/game-manager';
// Registers the handlers of the player commands.
import './net/commands';
import { Log } from './game/misc';
import { GameStore } from './game/savegame';
import { initAlerts } from './ui/alerts';
import { Audio, AudioTypeMidi } from './ui/audio';
import { initBuildMenu } from './ui/build-menu';
import { openLobby } from './net/lobby';
import { loadGameData } from './ui/data-picker';
import { EventLoop } from './ui/event-loop';
import { Graphics } from './ui/gfx';
import { Hud } from './ui/hud';
import { Interface } from './ui/interface';
import { Translation } from './ui/translation';
import { Video } from './ui/video';

// PORT: SDL_ShowSimpleMessageBox: the message is shown in the page instead
// of the screen of the game.
function showMessage(message: string): void {
  const canvas = document.getElementById('screen');
  if (canvas !== null) {
    canvas.style.display = 'none';
  }
  let box = document.getElementById('message');
  if (box === null) {
    box = document.createElement('div');
    document.body.appendChild(box);
  }
  box.style.display = 'block';
  box.style.color = '#ddd';
  box.textContent = message;
}

// PORT: main(argc, argv). The command line options (-d, -f, -g, -h, -l, -r)
// and the settings file are dropped: no debug level, fullscreen at start,
// data directories, save file to load or resolution. EXIT_FAILURE and
// EXIT_SUCCESS are the results false and true.
async function main(): Promise<boolean> {
  // PORT: version.h is not ported, there is no FREESERF_VERSION.
  Log.Info('main', 'freeserf');

  /* Settings of the last run; the language already for the messages. */
  // TODO(savegame): settings.load(); without the settings file the language
  // is the default "".
  Translation.getInstance().setLanguage('');

  // PORT: the C++ ends here with a message box when the data is not found
  // in its data directories. The data file is not part of a hosted build:
  // when /data/SPAE.PA can not be fetched, the player is asked for their
  // own copy (kept in this browser), and the game goes on once it is read.
  await loadGameData(import.meta.env.BASE_URL + 'data/SPAE.PA');

  // PORT: the saved games of this browser, read before the first list.
  await GameStore.getInstance().init();

  Log.Info('main', 'Initialize graphics...');

  // PORT: the canvas of index.html is the window of the game, and the files
  // that the C++ reads while it draws are loaded before.
  const canvas = document.getElementById('screen');
  if (canvas instanceof HTMLCanvasElement) {
    Video.setCanvas(canvas);
  }
  await Graphics.preloadResources();

  const gfx = Graphics.getInstance();

  /* TODO move to right place */
  const audio = Audio.getInstance();
  const player = audio.getMusicPlayer();
  if (player) {
    player.playTrack(AudioTypeMidi.TypeMidiTrack0);
  }

  const gameManager = GameManager.getInstance();

  /* Either load a save game if specified or
     start a new game. */
  // TODO(savegame): game_manager.load_game(save_file) when a save file is
  // given on the command line.
  if (!gameManager.startRandomGame()) {
    return false;
  }

  /* Initialize interface */
  const iface = new Interface();
  const [screenWidth, screenHeight] = gfx.getResolution();
  iface.setSize(screenWidth, screenHeight);
  iface.setDisplayed(true);

  // Dev console handle, for poking at the running game.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).settlers = { iface, gameManager };
  }

  /* Settings of the last run; -f asks for fullscreen in any case. */
  iface.applySettings();
  // PORT: no -f option and no "fullscreen" setting: gfx.set_fullscreen(true)
  // is never called here.

  iface.openGameInit();

  // PORT: page controls for speed and zoom, not in the C++.
  new Hud(gameManager, iface);
  initBuildMenu(iface, gameManager);
  initAlerts(iface, gameManager);

  // PORT: not in the C++. The lobby lies over the game: a solo game goes on
  // as above, an online game replaces the current game when it starts.
  const lobby = openLobby(iface);
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).lobby = lobby;
  }

  /* Init game loop */
  const eventLoop = EventLoop.getInstance();
  eventLoop.addHandler(iface);

  /* Start game loop */
  await eventLoop.run();

  eventLoop.delHandler(iface);

  /* Options changed by keys (music, sound, fullscreen) too. */
  iface.storeSettings();

  Log.Info('main', 'Cleaning up...');

  // PORT: the destructor of the interface at the end of main().
  iface.destroy();

  return true;
}

main().catch((err) => {
  Log.Error('main', err);
  showMessage(String(err));
  throw err;
});
