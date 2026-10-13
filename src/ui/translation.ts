/*
 * translation.ts - Translations of the texts
 *
 * Port of Freeserf's translation.h and translation.cc.
 *
 * Copyright (C) 2026  Wicked_Digger <wicked_digger@mail.ru>
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

// PORT: English only. The C++ reads gettext .po files with tinygettext
// (translation.cc); without that library it builds translation-dummy.cc,
// which has no dictionary. This is the port of translation-dummy.cc: every
// text is returned as it is, there are no languages to choose from.

/* The translations of the texts of the game: gettext .po files of the po
   folder next to the program (in the bundle resources on macOS), read with
   tinygettext. The texts in the sources are the English ones, marked with
   _() where they are shown, N_() in tables; C_() and NC_() with a context
   for the translators when a word alone can be meant in several ways. */
export class Translation {
  // PORT: `manager` (tinygettext::DictionaryManager) is left out, there is
  // no dictionary.
  protected language: string;

  protected static instance: Translation | null = null;

  protected constructor() {
    this.language = '';
  }

  protected addDirectory(path: string): void {}

  // PORT: the destructor is empty.

  static getInstance(): Translation {
    if (Translation.instance === null) {
      Translation.instance = new Translation();
    }
    return Translation.instance;
  }

  /* Codes of the languages with a translation (for example "ru"). */
  getLanguages(): string[] {
    return [];
  }

  /* The language of the texts, "" for the original English. */
  setLanguage(code: string): void {}

  getLanguage(): string {
    return this.language;
  }

  /* Name of a language in that language, "English" for "". */
  getLanguageName(code: string): string {
    return code.length === 0 ? 'English' : code;
  }

  // translate(msgid) and translate(context, msgid).
  translate(msgid: string): string;
  translate(context: string, msgid: string): string;
  translate(contextOrMsgid: string, msgid?: string): string {
    if (msgid === undefined) {
      return contextOrMsgid;
    }
    return msgid;
  }
}

// #define _(msgid) Translation::get_instance().translate(msgid)
export function _(msgid: string): string {
  return Translation.getInstance().translate(msgid);
}

// #define C_(context, msgid) Translation::get_instance().translate(context, msgid)
export function C_(context: string, msgid: string): string {
  return Translation.getInstance().translate(context, msgid);
}

// #define N_(msgid) msgid
export function N_(msgid: string): string {
  return msgid;
}

// #define NC_(context, msgid) msgid
export function NC_(context: string, msgid: string): string {
  return msgid;
}

// PORT: not in the C++; a second name of _() for modules where an
// identifier of one underscore is unwanted.
export const tr = _;
