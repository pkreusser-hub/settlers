/*
 * savegame.ts - Loading and saving of save games
 *
 * Port of Freeserf's savegame.h/.cc and configfile.h/.cc.
 *
 * Copyright (C) 2013-2019  Jon Lund Steffensen <jonlst@gmail.com>
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

import type { Game } from './game';
import { IntegrityCheck } from './integrity';
import { ExceptionFreeserf, i32, Log, u16 } from './misc';

// PORT: SaveReaderBinary (the save games of the original DOS game) is not
// ported, and with it the operator>> (SaveReaderBinary) of every class and
// GameStore::find_legacy(). Only the text format is read and written.

// PORT: the stream operators are methods. The C++ picks the conversion by
// the type of the variable; here the caller picks it:
//   reader.value("x") >> v   with v an int, Direction, Resource::Type,
//                            Building::Type or Serf::State: v = readInt()
//                            with v an unsigned int or size_t: readUint()
//                            with v a uint16_t: readU16()
//                            with v a std::string: readString()
//   reader.value("x")[i]     at(i)
//   writer.value("x") << v   write(v); writeUint(v) when v is unsigned in
//                            the C++ and could be negative here.

function atoi(value: string): number {
  const m = /^\s*[+-]?\d+/.exec(value);
  if (m === null) {
    return 0;
  }
  return i32(Number(BigInt.asIntN(32, BigInt(m[0].trim()))));
}

export class SaveReaderTextValue {
  protected value: string;
  protected parts: SaveReaderTextValue[];

  constructor(value: string) {
    this.value = value;
    this.parts = [];
    if (value.indexOf(',') !== -1) {
      // PORT: std::getline(iss, item, ',') gives no item after a last ','.
      const items = value.split(',');
      if (items[items.length - 1] === '') {
        items.pop();
      }
      for (const item of items) {
        this.parts.push(new SaveReaderTextValue(item));
      }
    }
  }

  readInt(): number {
    return atoi(this.value);
  }

  readUint(): number {
    /* Not atoi(): a value over the range of int (as 4294967295) stays,
       whatever the size of long (32 bits on Windows). */
    const m = /^\s*[+-]?\d+/.exec(this.value);
    if (m === null) {
      return 0;
    }
    return Number(BigInt.asUintN(32, BigInt(m[0].trim())));
  }

  readU16(): number {
    return u16(atoi(this.value));
  }

  readString(): string {
    return this.value;
  }

  size(): number {
    return this.parts.length;
  }

  at(pos: number): SaveReaderTextValue {
    if (pos >= this.parts.length) {
      throw new ExceptionFreeserf('Failed to read value');
    }

    return this.parts[pos];
  }
}

export class SaveWriterTextValue {
  protected value = '';

  write(val: number | boolean | string): this {
    if (this.value.length !== 0) {
      this.value += ',';
    }

    if (typeof val === 'string') {
      this.value += val;
    } else if (typeof val === 'boolean') {
      this.value += val ? '1' : '0';
    } else {
      if (!Number.isInteger(val)) {
        throw new ExceptionFreeserf('Not an integer in a save game: ' + val);
      }
      this.value += val.toString();
    }

    return this;
  }

  writeUint(val: number): this {
    return this.write(val >>> 0);
  }

  getValue(): string {
    return this.value;
  }
}

export type Readers = SaveReaderText[];

export interface SaveReaderText {
  getName(): string;
  getNumber(): number;
  value(name: string): SaveReaderTextValue;
  getSections(name: string): Readers;
  hasValue(name: string): boolean;
}

export interface SaveWriterText {
  value(name: string): SaveWriterTextValue;
  addSection(name: string, number: number): SaveWriterText;
}

// PORT: std::map<std::string, ...> is iterated in the order of its keys,
// compared byte by byte. The names here are ASCII, so the order of the
// UTF-16 code units is the same.
function sortedKeys<T>(map: Map<string, T>): string[] {
  return Array.from(map.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

type Values = Map<string, string>;

function trim(str: string): string {
  return str.replace(/^[ \t\n\v\f\r]+/, '').replace(/[ \t\n\v\f\r]+$/, '');
}

// PORT: only what the save games need of ConfigFile.
class ConfigFile {
  protected data: Map<string, Values> = new Map();

  getSections(): string[] {
    return sortedKeys(this.data);
  }

  getValues(section: string): string[] {
    const sect = this.data.get(section);
    if (sect === undefined) {
      return [];
    }
    return sortedKeys(sect);
  }

  value(section: string, name: string, defValue: string): string {
    const sect = this.data.get(section);
    if (sect === undefined) {
      return defValue;
    }
    const val = sect.get(name);
    return val === undefined ? defValue : val;
  }

  setValue(section: string, name: string, value: string): void {
    let sect = this.data.get(section);
    if (sect === undefined) {
      sect = new Map();
      this.data.set(section, sect);
    }
    sect.set(name, value);
  }

  read(text: string): boolean {
    let section: Values = new Map();
    this.data.set('global', section);
    let lineNumber = 0;

    for (let line of text.split('\n')) {
      lineNumber++;
      line = trim(line);
      if (line.length === 0) {
        continue;
      }

      if (line[0] === '[') {
        const end = line.lastIndexOf(']');
        if (end === -1) {
          Log.Error('config', 'Failed to parse config file (', lineNumber, ')');
          return false;
        }
        const name = line.substring(1, end).toLowerCase();
        if (name.length === 0) {
          Log.Error('config', 'Failed to parse config file (', lineNumber, ')');
          return false;
        }
        section = new Map();
        this.data.set(name, section);
      } else if (line[0] === ';' || line[0] === '#') {
        // it's a comment line. drop it for now.
      } else {
        const pos = line.indexOf('=');
        const name = (pos === -1 ? line : line.substring(0, pos)).toLowerCase();
        // PORT: line.substr(npos + 1) is the whole line when there is no '='.
        const val = line.substring(pos + 1).toLowerCase();
        section.set(trim(name), trim(val));
      }
    }

    return true;
  }

  write(): string {
    const out: string[] = [];
    for (const name of sortedKeys(this.data)) {
      out.push('[' + name + ']\n');
      const values = this.data.get(name) as Values;
      for (const key of sortedKeys(values)) {
        out.push('  ' + key + ' = ' + values.get(key) + '\n');
      }
    }
    return out.join('');
  }
}

export class SaveWriterTextSection implements SaveWriterText {
  protected name: string;
  protected number: number;
  protected values: Map<string, SaveWriterTextValue> = new Map();
  protected sections: SaveWriterTextSection[] = [];

  constructor(name: string, number: number) {
    this.name = name;
    this.number = number;
  }

  value(valName: string): SaveWriterTextValue {
    let v = this.values.get(valName);
    if (v === undefined) {
      v = new SaveWriterTextValue();
      this.values.set(valName, v);
    }
    return v;
  }

  // PORT: save(path) and write(ostream) are one: the text of the file.
  write(): string {
    const file = new ConfigFile();
    this.save(file);
    return file.write();
  }

  addSection(subName: string, subNumber: number): SaveWriterText {
    const section = new SaveWriterTextSection(subName, subNumber);
    this.sections.push(section);
    return section;
  }

  protected save(file: ConfigFile): boolean {
    const str = this.name + ' ' + this.number;

    for (const [key, value] of this.values) {
      file.setValue(str, key, value.getValue());
    }

    for (const writer of this.sections) {
      writer.save(file);
    }

    return true;
  }
}

class SaveReaderTextSection implements SaveReaderText {
  protected name: string;
  protected number: number;
  protected values: Map<string, SaveReaderTextValue> = new Map();

  constructor(file: ConfigFile, name: string) {
    this.name = name;
    this.number = 0;
    const pos = name.indexOf(' ');
    if (pos !== -1) {
      const value = name.substring(pos + 1);
      this.name = name.substring(0, pos);
      this.number = atoi(value);
    }

    for (const vname of file.getValues(name)) {
      this.values.set(vname, new SaveReaderTextValue(file.value(name, vname, '')));
    }
  }

  getName(): string {
    return this.name;
  }

  getNumber(): number {
    return this.number >>> 0;
  }

  value(valName: string): SaveReaderTextValue {
    const v = this.values.get(valName.toLowerCase());
    if (v === undefined) {
      throw new ExceptionFreeserf('Failed to load value: ' + valName);
    }

    return v;
  }

  getSections(_name: string): Readers {
    throw new ExceptionFreeserf('Recursive sections are not allowed');
  }

  hasValue(name: string): boolean {
    return this.values.has(name.toLowerCase());
  }
}

export class SaveReaderTextFile implements SaveReaderText {
  protected sections: SaveReaderTextSection[] = [];
  protected values: Map<string, SaveReaderTextValue> = new Map();

  constructor(text: string) {
    const file = new ConfigFile();

    if (!file.read(text)) {
      // PORT: the C++ goes on with what was read before the bad line.
      throw new ExceptionFreeserf('Wrong config file format.');
    }

    for (const name of file.getSections()) {
      this.sections.push(new SaveReaderTextSection(file, name));
    }

    for (const vname of file.getValues('main')) {
      this.values.set(vname, new SaveReaderTextValue(file.value('main', vname, '')));
    }
  }

  getName(): string {
    return '';
  }

  getNumber(): number {
    return 0;
  }

  value(name: string): SaveReaderTextValue {
    const v = this.values.get(name.toLowerCase());
    if (v === undefined) {
      throw new ExceptionFreeserf('Failed to load value: ' + name);
    }

    return v;
  }

  getSections(name: string): Readers {
    const result: Readers = [];

    for (const reader of this.sections) {
      if (reader.getName() === name) {
        result.push(reader);
      }
    }

    return result;
  }

  hasValue(name: string): boolean {
    return this.values.has(name.toLowerCase());
  }
}

// SaveGame

export enum GameStoreSaveInfoType {
  Legacy,
  Regular,
}

export interface GameStoreSaveInfo {
  name: string;
  path: string;
  type: GameStoreSaveInfoType;
}

const DB_NAME = 'settlers-saves';
const DB_STORE = 'saves';

// PORT: the folder of the save games is an IndexedDB store of this browser.
// The C++ reads and writes files at once; here the files are kept in memory
// (read by init() before the game starts) and written through in the
// background, so that save() and load() stay synchronous.
export class GameStore {
  static SaveInfo = { Type: GameStoreSaveInfoType };

  protected static instance: GameStore | null = null;

  protected folderPath: string;
  protected savedGames: GameStoreSaveInfo[] = [];
  protected files: Map<string, string> = new Map();
  protected db: IDBDatabase | null = null;

  protected constructor() {
    this.folderPath = 'saves';
  }

  static getInstance(): GameStore {
    if (GameStore.instance === null) {
      GameStore.instance = new GameStore();
    }
    return GameStore.instance;
  }

  /* Read the saved games of this browser. Without IndexedDB the saved
     games last as long as the page. */
  async init(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      return;
    }
    try {
      this.db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(DB_STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const db = this.db;
      await new Promise<void>((resolve, reject) => {
        const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor === null) {
            resolve();
            return;
          }
          if (typeof cursor.key === 'string' && typeof cursor.value === 'string') {
            this.files.set(cursor.key, cursor.value);
          }
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      Log.Warn('savegame', 'Saved games are not kept: ', String(e));
      this.db = null;
    }
  }

  getFolderPath(): string {
    return this.folderPath;
  }

  getSavedGames(): GameStoreSaveInfo[] {
    this.savedGames = [];
    this.update();
    return this.savedGames;
  }

  /* The text of a saved game, to send or download it; null if there is no
     such file. */
  getText(path: string): string | null {
    const text = this.files.get(path);
    return text === undefined ? null : text;
  }

  /* Store a save game that came from elsewhere (an imported file). */
  putText(path: string, text: string): void {
    this.files.set(path, text);
    if (this.db !== null) {
      try {
        this.db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(text, path);
      } catch (e) {
        Log.Warn('savegame', 'Unable to store save game: ', String(e));
      }
    }
  }

  remove(path: string): void {
    this.files.delete(path);
    if (this.db !== null) {
      try {
        this.db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).delete(path);
      } catch (e) {
        Log.Warn('savegame', 'Unable to delete save game: ', String(e));
      }
    }
  }

  /* Generic save/load function that will try to detect the right
   format on load and save to the best format on write. */
  save(path: string, game: Game): boolean {
    /* Substitute problematic characters. These are problematic
     particularly on windows platforms, but also in general on FAT
     filesystems through any platform. */
    const filePath = path.replace(/[*?"<>|]/g, '_');

    let text: string;
    try {
      text = this.write(game);
    } catch (e) {
      Log.Error('savegame', 'Failed to save game: ', String(e));
      return false;
    }
    this.putText(filePath, text);
    return true;
  }

  load(path: string, game: Game): boolean {
    const text = this.files.get(path);
    if (text === undefined) {
      Log.Error('savegame', "Unable to open save game file: '", path, "'");
      return false;
    }

    // PORT: no compatibility mode (SaveReaderBinary) after a failed read.
    return this.read(text, game);
  }

  quickSave(prefix: string, game: Game): boolean {
    /* Build filename including time stamp. */
    const tm = new Date();
    const p2 = (n: number): string => (n < 10 ? '0' : '') + n;
    const name = tm.getFullYear() + '-' + p2(tm.getMonth() + 1) + '-' + p2(tm.getDate()) +
                 '_' + p2(tm.getHours()) + '-' + p2(tm.getMinutes()) + '-' + p2(tm.getSeconds());

    const path = this.getFolderPath() + '/' + prefix + '-' + name + '.save';

    return this.save(path, game);
  }

  read(text: string, game: Game): boolean {
    try {
      const readerText = new SaveReaderTextFile(text);
      game.loadText(readerText);
    } catch (e) {
      Log.Error('savegame', 'Failed to load save game: ', String(e));
      return false;
    }
    IntegrityCheck.run(game, true);
    return true;
  }

  write(game: Game): string {
    const writer = new SaveWriterTextSection('game', 0);
    game.saveText(writer);
    return writer.write();
  }

  protected update(): void {
    // PORT: the files of the folder, in the order of their names.
    for (const filePath of sortedKeys(this.files)) {
      const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);
      const pos = fileName.lastIndexOf('.');
      if (pos === -1) {
        continue;
      }
      const ext = fileName.substring(pos + 1);
      if (ext !== 'save') {
        continue;
      }
      this.savedGames.push({
        name: this.nameFromFile(fileName),
        path: filePath,
        type: GameStoreSaveInfoType.Regular,
      });
    }
  }

  protected nameFromFile(fileName: string): string {
    const pos = fileName.lastIndexOf('.');
    if (pos === -1) {
      return fileName;
    }

    return fileName.substring(0, pos);
  }
}
