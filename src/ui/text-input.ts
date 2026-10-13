/*
 * text-input.ts - Text input GUI component
 *
 * Port of Freeserf's text-input.h and text-input.cc.
 *
 * Copyright (C) 2015  Wicked_Digger <wicked_digger@mail.ru>
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

import { Color, Frame } from './gfx';
import { GuiObject } from './gui';

// TextInput::Filter
// key is the character code (char in the C++).
export type TextInputFilter = (key: number, textInput: TextInput) => boolean;

export class TextInput extends GuiObject {
  protected text: string;
  protected maxLength: number;
  protected filter: TextInputFilter | null;
  protected colorFocus: Color;
  protected colorText: Color;
  protected colorBackground: Color;
  protected drawFocus: boolean;

  constructor() {
    super();
    this.text = '';
    this.maxLength = 0;
    this.filter = null;
    this.drawFocus = true;
    this.colorFocus = new Color(0x00, 0x8b, 0x47);
    this.colorText = Color.green;
    this.colorBackground = Color.black;
  }

  setText(text: string): void {
    this.text = text;
    this.setRedraw();
  }

  getText(): string {
    return this.text;
  }

  getMaxLength(): number {
    return this.maxLength;
  }

  setFilter(_filter: TextInputFilter | null): void {
    this.filter = _filter;
  }

  protected internalDraw(): void {
    const frame = this.frame as Frame;
    frame.fillRect(0, 0, this.width, this.height, this.colorBackground);
    if (this.drawFocus && this.focused) {
      frame.drawRect(0, 0, this.width, this.height, this.colorFocus);
    }
    let str = this.text;
    let cx = 0;
    let cy = 0;
    if (this.drawFocus) {
      cx = 1;
      cy = 1;
    }
    /* As many characters on a line as fit in the width. */
    while (str.length) {
      let length = 1;
      while (
        length < str.length &&
        frame.getStringWidth(str.substring(0, length + 1)) <= this.width - cx
      ) {
        length++;
      }
      frame.drawString(cx, cy, str.substring(0, length), this.colorText);
      str = str.substring(length);
      cy += 8;
    }
  }

  protected override handleClickLeft(x: number, y: number): boolean {
    this.setFocused();
    return true;
  }

  protected override handleKeyPressed(key: number, modifier: number): boolean {
    if (!this.focused) {
      return false;
    }

    if (this.maxLength !== 0 && this.text.length >= this.maxLength) {
      return true;
    }

    if (key === 0x08 /* '\b' */ && this.text.length > 0) {
      this.text = this.text.substring(0, this.text.length - 1);
      this.setRedraw();
      return true;
    }

    if (this.filter !== null) {
      if (!this.filter(key, this)) {
        return true;
      }
    }

    this.text += String.fromCharCode(key);

    this.setRedraw();

    return true;
  }

  protected override handleFocusLoose(): boolean {
    this.focused = false;
    this.setRedraw();
    return true;
  }

  setMaxLength(maxLen: number): void {
    this.maxLength = maxLen;
    if (this.maxLength !== 0) {
      if (this.text.length > this.maxLength) {
        this.text = this.text.substring(0, this.maxLength);
      }
    }
  }
}
