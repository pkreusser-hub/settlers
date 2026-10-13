// PORT: not in the C++, which searches the data folders on disk. The data
// file of the original game is copyrighted and is not part of a hosted
// build. When it can not be fetched, the player chooses their own copy; it
// is kept in IndexedDB of this browser and never sent anywhere.

import { DataSourceDOS } from '../data/data-source-dos';
import { Log } from '../game/misc';
import { Data } from './data-instance';
import './overlay.css';

const DB_NAME = 'settlers';
const STORE = 'files';
const KEY = 'SPAE.PA';
// The data file has about 3 MB; nothing near this size is one.
const MAX_FILE_SIZE = 32 * 1024 * 1024;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB is blocked'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/* The cache is a convenience: without IndexedDB (private window, blocked
   storage) the file is asked for on every visit. */
async function readCached(): Promise<Uint8Array | null> {
  try {
    const value = await withStore<unknown>('readonly', (store) => store.get(KEY));
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value instanceof Uint8Array) return value;
  } catch (e) {
    Log.Warn('data', 'Could not read the stored data file.', e);
  }
  return null;
}

async function writeCached(bytes: Uint8Array): Promise<void> {
  try {
    const copy = bytes.slice().buffer;
    await withStore('readwrite', (store) => store.put(copy, KEY));
  } catch (e) {
    Log.Warn('data', 'Could not store the data file.', e);
  }
}

async function clearCached(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(KEY));
  } catch (e) {
    Log.Warn('data', 'Could not remove the stored data file.', e);
  }
}

/* The file is valid when the data source can read it. */
function parse(bytes: Uint8Array): DataSourceDOS | null {
  try {
    return new DataSourceDOS(bytes);
  } catch (e) {
    Log.Info('data', 'Not a data file:', e);
    return null;
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K, className: string, text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/* Ask for the file until a valid one is chosen. */
function askForFile(): Promise<{ source: DataSourceDOS; bytes: Uint8Array }> {
  return new Promise((resolve) => {
    const backdrop = element('div', 'ov-backdrop');
    const panel = element('div', 'ov-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'data-picker-title');
    const title = element('h1', 'ov-title', 'Game data needed');
    title.id = 'data-picker-title';
    const text = element(
      'p', 'ov-text',
      'This game needs SPAE.PA, the data file of the original The Settlers (1993). ' +
        'Choose it from your own copy of the game.',
    );

    const input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    const button = element('button', 'ov-button', 'Choose SPAE.PA');
    button.type = 'button';
    const buttons = element('div', 'ov-buttons');
    buttons.append(button, input);

    const error = element('p', 'ov-error');
    error.setAttribute('role', 'alert');
    const note = element(
      'p', 'ov-small',
      'You can also drop the file here. It is stored in this browser only and is not uploaded.',
    );

    panel.append(title, text, buttons, error, note);
    backdrop.append(panel);
    document.body.append(backdrop);
    button.focus();

    let busy = false;
    const take = async (file: File | null | undefined): Promise<void> => {
      if (busy || file === null || file === undefined) return;
      busy = true;
      error.textContent = '';
      try {
        if (file.size === 0 || file.size > MAX_FILE_SIZE) {
          error.textContent = `${file.name} is not the data file. Look for SPAE.PA in the game's folder.`;
          return;
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const source = parse(bytes);
        if (source === null) {
          error.textContent = `${file.name} is not the data file. Look for SPAE.PA in the game's folder.`;
          return;
        }
        backdrop.remove();
        resolve({ source, bytes });
      } catch (e) {
        Log.Error('data', 'Could not read the file.', e);
        error.textContent = 'Could not read the file. Try again.';
      } finally {
        busy = false;
        input.value = '';
      }
    };

    button.addEventListener('click', () => input.click());
    input.addEventListener('change', () => void take(input.files?.[0]));

    backdrop.addEventListener('dragover', (e) => {
      e.preventDefault();
      panel.classList.add('ov-drop');
    });
    backdrop.addEventListener('dragleave', (e) => {
      if (e.target === backdrop) panel.classList.remove('ov-drop');
    });
    backdrop.addEventListener('drop', (e) => {
      e.preventDefault();
      panel.classList.remove('ov-drop');
      void take(e.dataTransfer?.files[0]);
    });
  });
}

/* Load the game data: from url, else the copy stored in this browser, else
   the file the player chooses (which is then stored). Returns once the data
   is loaded. */
export async function loadGameData(url: string): Promise<void> {
  const data = Data.getInstance();
  if (await data.load(url)) {
    return;
  }

  const cached = await readCached();
  if (cached !== null) {
    const source = parse(cached);
    if (source !== null) {
      Log.Info('data', 'Using the data file stored in this browser.');
      data.setDataSource(source);
      return;
    }
    await clearCached();
  }

  const { source, bytes } = await askForFile();
  data.setDataSource(source);
  await writeCached(bytes);
}
