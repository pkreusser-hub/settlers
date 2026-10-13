// The boxes the settings overview leads to, as windows of the page:
// TypeOptions together with the advanced box (advanced-box.ts) as one
// "Options" window, TypeQuitConfirm, TypeNoSaveQuitConfirm and TypeLoadSave
// (the box that saves the game) of popup.ts. Not part of Freeserf.
//
// None of these changes the game: the options are settings of this browser,
// set on the interface, the audio and the graphics as the canvas boxes do;
// saving reads the game.

import './settings.css';

import { GameStore } from '../../game/savegame';
import type { GameStoreSaveEntry } from '../../game/savegame';
import { Audio, AudioTypeSfx } from '../audio';
import { Data } from '../data-instance';
import { EventLoop } from '../event-loop';
import { Graphics } from '../gfx';
import { PopupBoxType } from '../popup';
import { openSavesPanel } from '../saves-panel';
import { Translation } from '../translation';
import { isBoxRegistered, registerBox } from './kit';
import type { BoxContext, BoxView, Widget } from './kit';
import { button, confirmRow, el, hint, iconCanvas, section, segmented, stepper, toggle } from './widgets';

const click = (ctx: BoxContext): void => ctx.sound(AudioTypeSfx.TypeSfxClick);

function backButton(ctx: BoxContext): HTMLButtonElement {
  return button('Back to settings', () => {
    click(ctx);
    ctx.open(PopupBoxType.TypeSettSelect);
  }, { icon: iconCanvas(61) });
}

/* A line of explanation under the row above it. */
function note(text: string): HTMLElement {
  const p = hint(text);
  p.classList.add('sg-note');
  return p;
}

// ---------------------------------------------------------------------------
// Options.

/* A value in words with a button that goes to the next one: the rows of
   the advanced box that are not check boxes. */
function nextRow(options: {
  label: string;
  get(): string;
  next(): void;
  nextLabel: string;
  /* Whether there is another value to go to. */
  can(): boolean;
}): Widget {
  const root = el('div', 'mk-row');
  const label = el('span', 'mk-label');
  label.append(el('span', 'mk-label-text', options.label));
  const side = el('span', 'mk-side');
  const value = el('span', 'mk-value sg-state');
  value.setAttribute('aria-live', 'polite');
  const b = button(options.nextLabel, options.next);
  side.append(value, b);
  root.append(label, side);
  let shown = '';
  const update = (): void => {
    const text = options.get();
    if (text !== shown) {
      shown = text;
      value.textContent = text;
    }
    const off = !options.can();
    if (b.disabled !== off) b.disabled = off;
  };
  update();
  return { el: root, update };
}

/* The message levels of drawOptionsBox(): Interface.getMessageLevel(). */
const messageLevels = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Few' },
  { value: 2, label: 'Most' },
  { value: 3, label: 'All' },
];

/* The steps of Interface.nextAutosaveInterval(), in minutes. */
const autosaveSteps = [0, 5, 10, 20, 30, 60];

/* TypeOptions and the advanced box. */
function optionsBox(ctx: BoxContext): BoxView {
  const { win, iface } = ctx;
  win.setTitle('Options');
  /* PatternDiagonalGreen. */
  win.setPattern('plain');
  win.root.classList.add('sg-win');

  const audio = Audio.getInstance();
  const gfx = Graphics.getInstance();
  const translation = Translation.getInstance();

  /* What ACTION_CLOSE_OPTIONS and Interface.closeAdvanced() do when the
     boxes close; here after every change, the window may close in many
     ways. */
  const changed = (): void => {
    iface.storeSettings();
  };

  const volume = (): number => {
    const controller = audio.getVolumeController();
    return controller !== null ? controller.getVolume() : 0;
  };

  win.add(
    hint('For this browser only. They do not change the game and are not kept when the page is loaded again.'),
    section(
      'Sound and screen',
      toggle({
        label: 'Music',
        get: () => audio.getMusicPlayer()?.isEnabled() ?? false,
        set: () => {
          /* ACTION_OPTIONS_MUSIC. */
          const player = audio.getMusicPlayer();
          if (player) player.enable(!player.isEnabled());
          click(ctx);
          changed();
        },
      }),
      toggle({
        label: 'Sound effects',
        get: () => audio.getSoundPlayer()?.isEnabled() ?? false,
        set: () => {
          /* ACTION_OPTIONS_SFX. */
          const player = audio.getSoundPlayer();
          if (player) player.enable(!player.isEnabled());
          click(ctx);
          changed();
        },
      }),
      stepper({
        label: 'Volume',
        /* The number of drawOptionsBox(): 0 to 99. */
        get: () => String(Math.trunc(Math.fround(99 * volume()))),
        dec: () => {
          /* ACTION_OPTIONS_VOLUME_MINUS. */
          const controller = audio.getVolumeController();
          if (controller !== null) controller.volumeDown();
          click(ctx);
          changed();
        },
        inc: () => {
          /* ACTION_OPTIONS_VOLUME_PLUS. */
          const controller = audio.getVolumeController();
          if (controller !== null) controller.volumeUp();
          click(ctx);
          changed();
        },
        canDec: () => volume() > 0,
        canInc: () => volume() < 1,
        decLabel: 'Quieter',
        incLabel: 'Louder',
      }),
      toggle({
        label: 'Full screen',
        get: () => gfx.isFullscreen(),
        set: () => {
          /* ACTION_OPTIONS_FULLSCREEN. */
          gfx.setFullscreen(!gfx.isFullscreen());
          click(ctx);
          changed();
        },
      }),
      segmented<number>({
        label: 'Messages',
        options: messageLevels,
        get: () => iface.getMessageLevel(),
        set: (level) => {
          /* ACTION_OPTIONS_MESSAGE_COUNT_1 goes to the next level (all,
             most, few, none, all); as many times as it takes. */
          for (let i = 0; i < messageLevels.length && iface.getMessageLevel() !== level; i++) {
            iface.nextMessageLevel();
          }
          click(ctx);
          changed();
        },
      }),
      note('How many kinds of events of the game send you a message. Some are sent at every level.'),
    ),
    /* The rows of advanced-box.ts, in its order. */
    section(
      'More options',
      toggle({
        label: 'Invert scrolling',
        get: () => iface.getInvertScrolling(),
        set: () => {
          click(ctx);
          iface.switchInvertScrolling();
          changed();
        },
      }),
      note('Dragging the map moves it the other way up and down.'),
      toggle({
        label: 'Large numbers',
        get: () => iface.getLargeNumbers(),
        set: () => {
          click(ctx);
          iface.switchLargeNumbers();
          changed();
        },
      }),
      note('The boxes drawn by the game shorten counts over 999 (15K) and do not show ">999".'),
      segmented<number>({
        label: 'Autosave',
        options: autosaveSteps.map((minutes) => ({
          value: minutes,
          label: minutes === 0 ? 'Off' : `${minutes} min`,
        })),
        get: () => iface.getAutosaveMinutes(),
        set: (minutes) => {
          click(ctx);
          for (let i = 0; i < autosaveSteps.length && iface.getAutosaveMinutes() !== minutes; i++) {
            iface.nextAutosaveInterval();
          }
          changed();
        },
      }),
      note('Saves the game in this browser this often and keeps the last three autosaves.'),
      toggle({
        label: 'Stock box until occupied',
        get: () => iface.getStockBoxOccupied(),
        set: () => {
          click(ctx);
          iface.switchStockBoxOccupied();
          changed();
        },
      }),
      note('A click on a new stock shows its building box, not its goods, until its serf has arrived.'),
      /* The data of several versions of the game is not installed in the
         port: the three rows show the one source and can not change. */
      ...[
        { label: 'Graphics', category: 0, next: () => iface.nextGraphicsSource() },
        { label: 'Sounds', category: 1, next: () => iface.nextSoundSource() },
        { label: 'Music', category: 2, next: () => iface.nextMusicSource() },
      ].map((source) =>
        nextRow({
          label: `${source.label} from`,
          get: () => iface.getDataSourceName(source.category) || 'DOS, the only data installed',
          next: () => {
            click(ctx);
            source.next();
            changed();
          },
          nextLabel: 'Next',
          can: () => Boolean(Data.getInstance().getMixedSource()),
        }),
      ),
      nextRow({
        label: 'Language',
        get: () => translation.getLanguageName(translation.getLanguage()),
        next: () => {
          click(ctx);
          iface.nextLanguage();
          changed();
        },
        nextLabel: 'Next',
        can: () => translation.getLanguages().length > 0,
      }),
      note('The language of the boxes drawn by the game. No translation is installed.'),
    ),
  );

  win.foot().append(backButton(ctx));
  return { dispose: changed };
}

// ---------------------------------------------------------------------------
// Quit.

function quitBox(ctx: BoxContext, question: string): void {
  const { win } = ctx;
  win.setTitle('Quit game');
  win.setPattern('plain');
  win.setSize('narrow');
  const row = confirmRow(
    question,
    {
      label: 'Yes, quit',
      danger: true,
      action: () => {
        /* ACTION_QUIT_CONFIRM and ACTION_NO_SAVE_QUIT_CONFIRM. */
        click(ctx);
        ctx.sound(AudioTypeSfx.TypeSfxAhhh);
        EventLoop.getInstance().quit();
      },
    },
    {
      label: 'No',
      action: () => {
        /* ACTION_QUIT_CANCEL. */
        click(ctx);
        ctx.close();
      },
    },
  );
  win.add(row, hint('Quitting stops the game on this page. Load the page again to play.'));
  win.initialFocus = row.noButton;
}

// ---------------------------------------------------------------------------
// Save.

function timeText(time: number): string {
  if (time === 0) return '';
  try {
    return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return new Date(time).toLocaleString();
  }
}

/* The path ACTION_SAVE of popup.ts saves to for the text of the name
   field: ".save" is added unless the name ends in it. */
function savePath(store: GameStore, text: string): string {
  let fileName = text;
  const p = fileName.lastIndexOf('.');
  let fileExt = '';
  if (p !== -1) {
    fileExt = fileName.substring(p + 1, fileName.length);
    if (fileExt !== 'save') {
      fileExt = '';
    }
  }
  if (fileExt.length === 0) {
    fileName += '.save';
  }
  return store.getFolderPath() + '/' + fileName;
}

/* TypeLoadSave: the name field and the list of the saved games of
   drawSaveBox(). A click on a save puts its name in the field. */
function saveBox(ctx: BoxContext): BoxView {
  const { win, iface, game, gameManager } = ctx;
  win.setTitle('Save game');
  win.setPattern('plain');
  win.root.classList.add('sg-win');

  const store = GameStore.getInstance();

  const field = el('div', 'sg-field');
  const label = el('label', 'mk-label', 'Name');
  label.htmlFor = 'sg-save-name';
  const input = el('input', 'sg-input');
  input.type = 'text';
  input.id = 'sg-save-name';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = 60;
  input.setAttribute('aria-describedby', 'sg-save-status');
  const saveButton = button('Save', () => save(), { kind: 'primary' });
  field.append(label, input, saveButton);

  const status = el('p', 'mk-hint sg-status');
  status.id = 'sg-save-status';
  status.setAttribute('role', 'status');

  const listTitle = el('h3', 'mk-section-title', 'Saved games in this browser');
  listTitle.id = 'sg-save-list-title';
  const list = el('ul', 'sg-saves');
  list.setAttribute('aria-labelledby', listTitle.id);

  let entries: GameStoreSaveEntry[] = [];
  let listed: string | null = null;
  let failed = false;

  const fileNameOf = (path: string): string => {
    const p = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return path.substring(p + 1, path.length);
  };

  /* The save the name in the field would replace. */
  const taken = (): GameStoreSaveEntry | null => {
    if (input.value.trim() === '') return null;
    /* GameStore.save() changes these characters of the path. */
    const path = savePath(store, input.value).replace(/[*?"<>|]/g, '_');
    return entries.find((entry) => entry.path === path) ?? null;
  };

  let statusShown = '';
  const showStatus = (): void => {
    const empty = input.value.trim() === '';
    let text = '';
    if (failed) text = 'The game could not be saved.';
    else if (empty) text = 'Type a name, or pick a save from the list to replace it.';
    else if (taken() !== null) text = 'A save with this name exists. Saving replaces it.';
    if (text !== statusShown) {
      statusShown = text;
      status.textContent = text;
    }
    if (saveButton.disabled !== empty) saveButton.disabled = empty;
    for (const item of Array.from(list.children) as HTMLElement[]) {
      const on = item.dataset.path === taken()?.path;
      const b = item.firstElementChild as HTMLElement;
      if ((b.getAttribute('aria-pressed') === 'true') !== on) b.setAttribute('aria-pressed', String(on));
    }
  };

  const showList = (): void => {
    entries = store.getSavedGamesByTime();
    const key = entries.map((entry) => entry.path + '\n' + entry.time).join('\n');
    if (key === listed) return;
    listed = key;
    const hadFocus = list.contains(document.activeElement);
    list.textContent = '';
    for (const entry of entries) {
      const item = el('li', '');
      item.dataset.path = entry.path;
      const b = el('button', 'gx-btn sg-save');
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.append(el('span', 'sg-save-name', entry.name), el('span', 'sg-save-time', timeText(entry.time)));
      b.addEventListener('click', () => {
        /* The selection handler of the file list of popup.ts. */
        click(ctx);
        input.value = fileNameOf(entry.path);
        failed = false;
        showStatus();
      });
      item.append(b);
      list.append(item);
    }
    if (entries.length === 0) {
      list.append(el('li', 'sg-saves-empty', 'No saved games yet.'));
    }
    if (hadFocus) input.focus({ preventScroll: true });
    showStatus();
  };

  /* ACTION_SAVE. */
  function save(): void {
    if (input.value.trim() === '') return;
    click(ctx);
    const saved = store.save(savePath(store, input.value), game);
    if (saved) {
      ctx.close();
    } else {
      failed = true;
      showStatus();
    }
  }

  input.addEventListener('input', () => {
    failed = false;
    showStatus();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });

  showList();

  win.add(
    hint('Saves the game in this browser under the name you type.'),
    field,
    status,
    listTitle,
    list,
  );
  win.initialFocus = input;

  win.foot().append(
    button('Load, download or import', () => {
      /* The saves panel of the page does the rest; it lies over the game,
         so this window goes first. */
      click(ctx);
      ctx.close();
      openSavesPanel(iface, gameManager);
    }, { title: 'Open the list of saved games of the page' }),
    backButton(ctx),
  );

  return { update: showList };
}

/* index.ts may call this as well as settings.ts: it registers once. */
export function registerOptionBoxes(): void {
  if (isBoxRegistered(PopupBoxType.TypeOptions)) return;
  registerBox(PopupBoxType.TypeOptions, optionsBox);
  registerBox(PopupBoxType.TypeQuitConfirm, (ctx) =>
    /* drawQuitConfirmBox(). */
    quitBox(ctx, 'Do you want to quit this game?'));
  registerBox(PopupBoxType.TypeNoSaveQuitConfirm, (ctx) =>
    /* drawNoSaveQuitConfirmBox(). */
    quitBox(ctx, 'The game has not been saved recently. Are you sure?'));
  registerBox(PopupBoxType.TypeLoadSave, saveBox);
}
