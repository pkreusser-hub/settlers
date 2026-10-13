/*
 * advanced-box.ts - Box of the advanced options
 *
 * Port of Freeserf's advanced-box.h and advanced-box.cc.
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

import { AudioTypeSfx } from './audio';
import { drawBoxFrame } from './box-frame';
import { Data } from './data-instance';
import { Color } from './gfx';
import { GuiObject } from './gui';
import type { Interface } from './interface';
import { PopupBoxBackgroundPattern } from './popup';
import { N_, Translation, _ } from './translation';

/* Exit button in the bottom right corner, where the options box has it. */
const kExitWidth = 16;
const kExitHeight = 16;

/* Options as in the options box: a label on the left, a check box on the
   right. */
const kLabelX = 16;
const kCheckSize = 16;
const kRowHeight = 20;
const kFirstRowY = 19;

/* An option is a check box (get) or a value shown as text (text); a click
   on either calls change. */
// PORT: the pointers to member functions of Interface become functions
// that take the interface.
interface Option {
  label: string;
  get: ((iface: Interface) => boolean) | null;
  text: ((iface: Interface) => string) | null;
  change: (iface: Interface) => void;
}

function autosaveText(iface: Interface): string {
  const minutes = iface.getAutosaveMinutes();
  if (minutes === 0) return _('Off');
  /* TRANSLATORS: %d is a number of minutes. */
  let text = _('%d min');
  const number = text.indexOf('%d');
  if (number !== -1) {
    text = text.substring(0, number) + String(minutes) + text.substring(number + 2);
  }
  return text;
}

function languageText(_iface: Interface): string {
  const translation = Translation.getInstance();
  return translation.getLanguageName(translation.getLanguage());
}

function graphicsText(iface: Interface): string {
  return iface.getDataSourceName(0);
}

function soundText(iface: Interface): string {
  return iface.getDataSourceName(1);
}

function musicText(iface: Interface): string {
  return iface.getDataSourceName(2);
}

const options: Option[] = [
  {
    label: N_('Invert scrolling'),
    get: (iface) => iface.getInvertScrolling(),
    text: null,
    change: (iface) => iface.switchInvertScrolling(),
  },
  {
    label: N_('Large numbers'),
    get: (iface) => iface.getLargeNumbers(),
    text: null,
    change: (iface) => iface.switchLargeNumbers(),
  },
  {
    label: N_('Autosave'),
    get: null,
    text: autosaveText,
    change: (iface) => iface.nextAutosaveInterval(),
  },
  {
    label: N_('Stock box until occupied'),
    get: (iface) => iface.getStockBoxOccupied(),
    text: null,
    change: (iface) => iface.switchStockBoxOccupied(),
  },
  /* With the data of several versions installed. */
  {
    label: N_('Graphics'),
    get: null,
    text: graphicsText,
    change: (iface) => iface.nextGraphicsSource(),
  },
  { label: N_('Sounds'), get: null, text: soundText, change: (iface) => iface.nextSoundSource() },
  { label: N_('Music'), get: null, text: musicText, change: (iface) => iface.nextMusicSource() },
  /* With a translation installed. */
  { label: N_('Language'), get: null, text: languageText, change: (iface) => iface.nextLanguage() },
];

/* Width of the value texts, right aligned to the check boxes. */
const kValueWidth = 48;
const kOptionCount = options.length;

/* Large box of the settings that the original game does not have, opened
   from the options box. */
export class AdvancedBox extends GuiObject {
  static readonly kWidth = 360;
  static readonly kHeight = 256;

  protected interface: Interface;

  constructor(_interface: Interface) {
    super();
    this.interface = _interface;
    this.setSize(AdvancedBox.kWidth, AdvancedBox.kHeight);
  }

  // PORT: the destructor is empty.

  protected override internalDraw(): void {
    const frame = this.frame!;

    /* Background of the options box. */
    for (let y = 0; y < this.height; y += 16) {
      for (let x = 0; x < this.width; x += 16) {
        frame.drawSprite(x, y, Data.Resource.AssetIcon, PopupBoxBackgroundPattern.PatternDiagonalGreen);
      }
    }
    drawBoxFrame(frame, this.width, this.height);

    const checkX = this.width - 24 - kCheckSize;
    for (let i = 0; i < kOptionCount; i++) {
      const y = kFirstRowY + i * kRowHeight;
      frame.drawString(kLabelX, y + 4, _(options[i].label), Color.green, Color.black);
      const get = options[i].get;
      if (get !== null) {
        const on = get(this.interface);
        frame.drawSprite(checkX, y, Data.Resource.AssetIcon, on ? 288 : 220);
      } else {
        const value = options[i].text!(this.interface);
        const valueX = checkX + kCheckSize - frame.getStringWidth(value);
        frame.drawString(valueX, y + 4, value, Color.green, Color.black);
      }
    }

    frame.drawSprite(
      this.width - 8 - kExitWidth,
      this.height - 7 - kExitHeight,
      Data.Resource.AssetIcon,
      60,
    ); // Exit
  }

  protected override handleClickLeft(x: number, y: number): boolean {
    const checkX = this.width - 24 - kCheckSize;
    for (let i = 0; i < kOptionCount; i++) {
      const rowY = kFirstRowY + i * kRowHeight;
      const left = options[i].get !== null ? checkX : checkX + kCheckSize - kValueWidth;
      if (x >= left && x < checkX + kCheckSize && y >= rowY && y < rowY + kCheckSize) {
        this.playSound(AudioTypeSfx.TypeSfxClick);
        options[i].change(this.interface);
        this.setRedraw();
        return true;
      }
    }

    const exitX = this.width - 8 - kExitWidth;
    const exitY = this.height - 7 - kExitHeight;
    if (x >= exitX && x < exitX + kExitWidth && y >= exitY && y < exitY + kExitHeight) {
      this.playSound(AudioTypeSfx.TypeSfxClick);
      /* Leave the options as well. */
      this.interface.closeAdvanced();
    }
    return true;
  }
}
