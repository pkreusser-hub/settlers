/*
 * list.ts - String list GUI component
 *
 * Port of Freeserf's list.h and list.cc.
 *
 * Copyright (C) 2017-2018  Wicked_Digger <wicked_digger@mail.ru>
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

import { GameStore } from '../game/savegame';
import { Color, Frame } from './gfx';
import { GuiObject } from './gui';

// PORT: GameStore::SaveInfo of savegame.h, which is not ported. Only the
// fields this widget reads.
export interface ListSavedFilesSaveInfo {
  name: string;
  path: string;
}

export class ListSavedFiles extends GuiObject {
  protected colorFocus: Color;
  protected colorText: Color;
  protected colorBackground: Color;

  protected saveGame: GameStore;
  protected items: ListSavedFilesSaveInfo[];
  protected firstVisibleItem: number;
  protected selectedItem: number;
  protected selectionHandler: ((item: string) => void) | null;

  constructor() {
    super();
    this.selectionHandler = null;
    this.colorFocus = new Color(0x00, 0x8b, 0x47);
    this.colorText = Color.green;
    this.colorBackground = Color.black;

    this.saveGame = GameStore.getInstance();
    // PORT: not in the C++, which lists the files by name. The autosaves
    // first, then the rest newest first, as the saves panel of the page.
    this.items = this.saveGame.getSavedGamesByTime();
    this.firstVisibleItem = 0;
    this.selectedItem = -1;
  }

  // PORT: not in the C++, where the list is read once. Read the saved
  // games again, a game may have been saved since.
  update(): void {
    this.items = this.saveGame.getSavedGamesByTime();
    this.firstVisibleItem = 0;
    this.selectedItem = -1;
    this.setRedraw();
  }

  setSelectionHandler(handler: ((item: string) => void) | null): void {
    this.selectionHandler = handler;
  }

  getSelected(): string {
    // PORT: the C++ reads items[-1] when nothing is selected.
    if (this.items.length === 0 || this.selectedItem < 0) {
      return '';
    }
    const filePath = this.items[this.selectedItem].path;
    return filePath;
  }

  getFolderPath(): string {
    return this.saveGame.getFolderPath();
  }

  protected internalDraw(): void {
    const frame = this.frame as Frame;
    frame.fillRect(0, 0, this.width, this.height, this.colorBackground);

    if (this.focused) {
      frame.drawRect(0, 0, this.width, this.height, this.colorFocus);
    }

    let item = this.firstVisibleItem;
    for (let ly = 0; ly < this.height - 6 && item < this.items.length; ly += 9) {
      let tc = this.colorText;
      if (item === this.selectedItem) {
        frame.fillRect(2, ly + 2, this.width - 4, 9, Color.green);
        tc = Color.black;
      }
      frame.drawString(3, 3 + ly, this.items[item].name, tc);
      item++;
    }
  }

  protected override handleClickLeft(_cx: number, cy: number): boolean {
    this.setFocused();
    cy -= 3;
    if (cy >= 0) {
      cy = this.firstVisibleItem + Math.trunc(cy / 9);
      if (this.selectedItem !== cy && cy >= 0 && cy < this.items.length) {
        this.selectedItem = cy;
        this.setRedraw();
        if (this.selectionHandler !== null) {
          const filePath = this.items[this.selectedItem].path;
          this.selectionHandler(filePath);
        }
      }
    }
    return true;
  }

  protected override handleDrag(dx: number, dy: number): boolean {
    if (!this.focused) {
      return false;
    }

    let nfvi = this.firstVisibleItem + Math.trunc(dy / 32);
    if (nfvi < 0) {
      nfvi = 0;
    }
    if ((this.items.length - nfvi) * 9 <= this.height - 8) {
      return true;
    }
    if (this.firstVisibleItem !== nfvi) {
      this.firstVisibleItem = nfvi;
      this.setRedraw();
    }
    return true;
  }

  protected override handleKeyPressed(key: number, modifier: number): boolean {
    return true;
  }

  protected override handleFocusLoose(): boolean {
    this.focused = false;
    this.setRedraw();
    return true;
  }
}
