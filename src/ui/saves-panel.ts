// The saved games of this browser as a page panel: load, download, delete
// and import save files. Not part of Freeserf.

import './overlay.css';
import './saves-panel.css';

import { Game } from '../game/game';
import { GameManager } from '../game/game-manager';
import { GameStore } from '../game/savegame';
import type { GameStoreSaveEntry } from '../game/savegame';
import { hasCommandSink } from '../net/command';
import type { Interface } from './interface';

const TEXT = {
  title: 'Saved games',
  intro: 'These games are stored in this browser. Download a file to keep it elsewhere.',
  online: 'You cannot load during an online game. Download, delete and import still work.',
  autosaves: 'Autosaves',
  saves: 'Saves',
  empty: 'No saved games in this browser yet.',
  load: 'Load',
  download: 'Download',
  remove: 'Delete',
  keep: 'Keep',
  ask: 'Delete this save?',
  importFile: 'Import file…',
  close: 'Close',
  loadFailed: 'Could not load this save.',
  readFailed: 'Could not read the file.',
  tooLarge: 'The file is too large to be a saved game.',
};

/* A save of a full map is a few MB of text. */
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K, className: string, text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className.length > 0) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function timeText(time: number): string {
  if (time === 0) return '';
  try {
    return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return new Date(time).toLocaleString();
  }
}

class SavesPanel {
  protected backdrop: HTMLDivElement;
  protected panel: HTMLDivElement;
  protected note: HTMLParagraphElement;
  protected lists: HTMLDivElement;
  protected message: HTMLParagraphElement;
  protected fileInput: HTMLInputElement;
  protected importButton: HTMLButtonElement;

  protected iface: Interface;
  protected gameManager: GameManager;
  /* The save whose row asks "Delete this save?". */
  protected confirmPath: string | null = null;
  protected opener: HTMLElement | null = null;
  protected online = false;
  protected timer: number | null = null;

  protected onWindowKey = (event: KeyboardEvent): void => {
    if (this.backdrop.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.confirmPath !== null) {
        const path = this.confirmPath;
        this.confirmPath = null;
        this.render(this.key(path, 'delete'));
      } else {
        this.close();
      }
      return;
    }
    /* While the panel is open the keys are not for the game behind it. */
    if (!(event.target instanceof Node) || !this.backdrop.contains(event.target)) {
      event.stopImmediatePropagation();
      if (event.key === 'Tab') {
        event.preventDefault();
        this.focusFirst();
      }
    }
  };

  constructor(iface: Interface, gameManager: GameManager) {
    this.iface = iface;
    this.gameManager = gameManager;

    this.backdrop = element('div', 'ov-backdrop sv-backdrop');
    this.backdrop.id = 'saves-panel';
    this.backdrop.hidden = true;
    this.panel = element('div', 'ov-panel sv-panel');
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-labelledby', 'saves-panel-title');
    this.backdrop.append(this.panel);

    const title = element('h2', 'ov-title', TEXT.title);
    title.id = 'saves-panel-title';
    const intro = element('p', 'ov-text', TEXT.intro);
    this.note = element('p', 'ov-small', TEXT.online);
    this.note.id = 'saves-panel-online';
    this.lists = element('div', '');
    this.message = element('p', 'ov-status');
    this.message.setAttribute('role', 'status');
    this.message.setAttribute('aria-live', 'polite');

    this.fileInput = element('input', 'sv-file');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.save,text/plain';
    this.fileInput.multiple = true;
    this.fileInput.tabIndex = -1;
    this.fileInput.setAttribute('aria-hidden', 'true');
    this.fileInput.addEventListener('change', () => {
      const files = Array.from(this.fileInput.files ?? []);
      this.fileInput.value = '';
      void this.importFiles(files);
    });

    const foot = element('div', 'sv-foot');
    this.importButton = this.button(TEXT.importFile, () => this.fileInput.click());
    const close = this.button(TEXT.close, () => this.close(), 'ov-button ov-quiet');
    foot.append(this.importButton, close);

    this.panel.append(title, intro, this.note, this.lists, this.message, this.fileInput, foot);

    /* Keys typed in the panel stay in the panel; Tab stays inside it. */
    this.backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') this.trapTab(e);
      if (e.key !== 'Escape') e.stopPropagation();
    });
    this.backdrop.addEventListener('keyup', (e) => e.stopPropagation());
    this.backdrop.addEventListener('mousedown', (e) => {
      if (e.target === this.backdrop) this.close();
    });

    document.body.append(this.backdrop);
  }

  open(iface: Interface, gameManager: GameManager): void {
    this.iface = iface;
    this.gameManager = gameManager;
    if (this.backdrop.hidden) {
      const active = document.activeElement;
      this.opener = active instanceof HTMLElement && active !== document.body ? active : null;
      window.addEventListener('keydown', this.onWindowKey, true);
      /* An online game may start or end, an autosave may come in. */
      this.timer = window.setInterval(() => this.poll(), 1000);
    }
    this.confirmPath = null;
    this.say('');
    this.backdrop.hidden = false;
    this.render(null);
    this.focusFirst();
  }

  close(): void {
    if (this.backdrop.hidden) return;
    this.backdrop.hidden = true;
    window.removeEventListener('keydown', this.onWindowKey, true);
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    /* Keys go to the game again unless the opener takes the focus. */
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    if (this.opener !== null && this.opener.isConnected) {
      this.opener.focus();
    }
    this.opener = null;
  }

  protected listed = '';

  /* Draw the lists again when the saves or the kind of game changed. */
  protected poll(): void {
    if (this.confirmPath !== null) return;
    const entries = GameStore.getInstance().getSavedGamesByTime();
    const listed = this.signature(entries);
    if (listed !== this.listed || hasCommandSink() !== this.online) {
      const active = document.activeElement;
      const key = active instanceof HTMLElement ? active.dataset.key ?? null : null;
      const inside = this.lists.contains(active);
      this.render(key);
      if (inside && !this.lists.contains(document.activeElement)) this.focusFirst();
    }
  }

  protected signature(entries: GameStoreSaveEntry[]): string {
    return entries.map((entry) => entry.path + '\n' + entry.time).join('\n');
  }

  protected key(path: string, action: string): string {
    return action + '|' + path;
  }

  protected button(
    text: string, onClick: () => void, className = 'ov-button',
  ): HTMLButtonElement {
    const el = element('button', className, text);
    el.type = 'button';
    el.addEventListener('click', onClick);
    return el;
  }

  protected say(text: string, error = false): void {
    this.message.className = error ? 'ov-error' : 'ov-status';
    this.message.textContent = text;
  }

  /* Build the lists; focusKey names the button that takes the focus. */
  protected render(focusKey: string | null): void {
    const store = GameStore.getInstance();
    const entries = store.getSavedGamesByTime();
    this.listed = this.signature(entries);
    this.online = hasCommandSink();
    this.note.hidden = !this.online;
    if (this.confirmPath !== null && !entries.some((e) => e.path === this.confirmPath)) {
      this.confirmPath = null;
    }

    this.lists.textContent = '';
    const autosaves = entries.filter((entry) => entry.autosave);
    const saves = entries.filter((entry) => !entry.autosave);
    if (entries.length === 0) {
      this.lists.append(element('p', 'ov-text', TEXT.empty));
    }
    if (autosaves.length > 0) {
      this.lists.append(this.section(TEXT.autosaves, 'saves-panel-auto', autosaves));
    }
    if (saves.length > 0) {
      this.lists.append(this.section(TEXT.saves, 'saves-panel-saves', saves));
    }

    if (focusKey !== null) {
      for (const el of Array.from(this.lists.querySelectorAll<HTMLButtonElement>('button'))) {
        if (el.dataset.key === focusKey && !el.disabled) {
          el.focus();
          return;
        }
      }
    }
  }

  protected section(heading: string, id: string, entries: GameStoreSaveEntry[]): HTMLElement {
    const section = element('section', '');
    const title = element('h3', 'sv-heading', heading);
    title.id = id;
    const list = element('ul', 'sv-list');
    list.setAttribute('aria-labelledby', id);
    for (const entry of entries) {
      list.append(this.row(entry));
    }
    section.append(title, list);
    return section;
  }

  protected row(entry: GameStoreSaveEntry): HTMLLIElement {
    const row = element('li', 'sv-row');
    const info = element('div', 'sv-info');
    info.append(element('span', 'sv-name', entry.name));
    const actions = element('div', 'sv-actions');

    const add = (
      text: string, action: string, onClick: () => void, className = 'ov-button',
    ): HTMLButtonElement => {
      const el = this.button(text, onClick, className);
      el.dataset.key = this.key(entry.path, action);
      el.setAttribute('aria-label', text + ' ' + entry.name);
      actions.append(el);
      return el;
    };

    if (this.confirmPath === entry.path) {
      info.append(element('span', 'sv-ask', TEXT.ask));
      add(TEXT.remove, 'confirm', () => this.remove(entry), 'ov-button sv-button-danger');
      add(TEXT.keep, 'keep', () => {
        this.confirmPath = null;
        this.render(this.key(entry.path, 'delete'));
      }, 'ov-button ov-quiet');
    } else {
      const time = timeText(entry.time);
      if (time.length > 0) info.append(element('span', 'sv-time', time));
      const load = add(TEXT.load, 'load', () => this.load(entry));
      if (this.online) {
        load.disabled = true;
        load.setAttribute('aria-describedby', this.note.id);
      }
      add(TEXT.download, 'download', () => this.download(entry), 'ov-button ov-quiet');
      add(TEXT.remove, 'delete', () => {
        this.confirmPath = entry.path;
        this.say('');
        this.render(this.key(entry.path, 'keep'));
      }, 'ov-button ov-quiet');
    }

    row.append(info, actions);
    return row;
  }

  protected load(entry: GameStoreSaveEntry): void {
    /* The online game may have started while the panel was open. */
    if (hasCommandSink()) {
      this.render(null);
      this.focusFirst();
      return;
    }
    if (!this.gameManager.loadGame(entry.path)) {
      this.say(TEXT.loadFailed, true);
      return;
    }
    /* The loaded game shows; the game init box, if open, goes. */
    this.iface.closeGameInit();
    this.close();
  }

  protected download(entry: GameStoreSaveEntry): void {
    const text = GameStore.getInstance().getText(entry.path);
    if (text === null) {
      this.say(TEXT.readFailed, true);
      this.render(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = entry.name + '.save';
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  protected remove(entry: GameStoreSaveEntry): void {
    const before = GameStore.getInstance().getSavedGamesByTime();
    const index = before.findIndex((e) => e.path === entry.path);
    GameStore.getInstance().remove(entry.path);
    this.confirmPath = null;
    this.say(`Deleted "${entry.name}".`);
    /* The focus goes to the save that took the place, or the one before. */
    const next = before[index + 1] ?? before[index - 1];
    this.render(next !== undefined ? this.key(next.path, 'delete') : null);
    if (!this.lists.contains(document.activeElement)) this.importButton.focus();
  }

  protected async importFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    const store = GameStore.getInstance();
    const done: string[] = [];
    const failed: string[] = [];
    let lastPath: string | null = null;

    for (const file of files) {
      if (file.size > MAX_IMPORT_BYTES) {
        failed.push(`"${file.name}": ${TEXT.tooLarge}`);
        continue;
      }
      let text: string;
      try {
        text = await file.text();
      } catch {
        failed.push(`"${file.name}": ${TEXT.readFailed}`);
        continue;
      }
      /* The text must load into a game before it is kept. */
      let valid = false;
      try {
        valid = store.read(text, new Game());
      } catch {
        valid = false;
      }
      if (!valid) {
        failed.push(`"${file.name}" is not a saved game.`);
        continue;
      }

      let name = file.name.replace(/\.save$/i, '').trim();
      if (name.length === 0) name = 'imported';
      /* Not into the autosave slots: the next autosave would move it on. */
      if (store.isAutosave(store.getFolderPath() + '/' + name + '.save')) {
        name += ' imported';
      }
      /* A name that is taken gets " (2)", " (3)"... */
      const path = store.getFreePath(name);
      store.putText(path, text);
      lastPath = path;
      done.push(path.substring(path.lastIndexOf('/') + 1).replace(/\.save$/, ''));
    }

    const parts: string[] = [];
    if (done.length > 0) parts.push('Imported ' + done.map((n) => `"${n}"`).join(', ') + '.');
    parts.push(...failed);
    this.say(parts.join(' '), failed.length > 0);
    this.confirmPath = null;
    this.render(lastPath !== null ? this.key(lastPath, this.online ? 'download' : 'load') : null);
    if (!this.panel.contains(document.activeElement)) this.importButton.focus();
  }

  protected focusable(): HTMLElement[] {
    return Array.from(this.panel.querySelectorAll<HTMLButtonElement>('button'))
      .filter((el) => !el.disabled);
  }

  protected focusFirst(): void {
    const items = this.focusable();
    if (items.length > 0) items[0].focus();
  }

  protected trapTab(event: KeyboardEvent): void {
    const items = this.focusable();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !this.panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !this.panel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }
}

let savesPanel: SavesPanel | null = null;

/* Show the saved games of this browser. Loading a save starts it as a solo
   game; during an online game the Load buttons are off. */
export function openSavesPanel(
  iface: Interface, gameManager: GameManager = GameManager.getInstance(),
): void {
  if (savesPanel === null) {
    savesPanel = new SavesPanel(iface, gameManager);
  }
  savesPanel.open(iface, gameManager);
}

export function closeSavesPanel(): void {
  savesPanel?.close();
}
