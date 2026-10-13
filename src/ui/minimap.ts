// minimap.h + minimap.cc - Minimap GUI component

import { BuildingType } from '../game/building';
import type { Game, PGame } from '../game/game';
import type { Map as GameMap, PMap } from '../game/map';
import { MapObject } from '../game/map';
import type { MapPos } from '../game/map-geometry';
import { clamp, idiv } from '../game/misc';
import { Data } from './data-instance';
import type { Frame } from './gfx';
import { Color } from './gfx';
import { GuiObject } from './gui';
import type { Interface } from './interface';

export class Minimap extends GuiObject {
  protected map: PMap | null = null;

  protected offsetX: number;
  protected offsetY: number;
  protected scale: number;

  protected drawGrid: boolean;

  protected minimap: Color[] = [];

  protected static readonly maxScale: number = 8;

  constructor(_map: PMap | null) {
    super();
    this.offsetX = 0;
    this.offsetY = 0;
    this.scale = 1;

    this.drawGrid = false;

    this.setMap(_map);
  }

  getScale(): number {
    return this.scale;
  }

  getDrawGrid(): boolean {
    return this.drawGrid;
  }

  setDrawGrid(_drawGrid: boolean): void {
    this.drawGrid = _drawGrid;
    this.setRedraw();
  }

  /* Initialize minimap data. */
  protected initMinimap(): void {
    const colorOffset = [
      0, 85, 102, 119, 17, 17, 17, 17,
      34, 34, 34, 51, 51, 51, 68, 68,
    ];

    const colors = [
      new Color(0x00, 0x00, 0xaf), new Color(0x00, 0x00, 0xaf), new Color(0x00, 0x00, 0xaf),
      new Color(0x00, 0x00, 0xaf), new Color(0x00, 0x00, 0xaf), new Color(0x00, 0x00, 0xaf),
      new Color(0x00, 0x00, 0xaf), new Color(0x00, 0x00, 0xaf), new Color(0x00, 0x00, 0xaf),
      new Color(0x00, 0x00, 0xaf), new Color(0x00, 0x00, 0xaf), new Color(0x00, 0x00, 0xaf),
      new Color(0x00, 0x00, 0xaf), new Color(0x00, 0x00, 0xaf), new Color(0x00, 0x00, 0xaf),
      new Color(0x00, 0x00, 0xaf), new Color(0x00, 0x00, 0xaf), new Color(0x73, 0xb3, 0x43),
      new Color(0x73, 0xb3, 0x43), new Color(0x6b, 0xab, 0x3b), new Color(0x63, 0xa3, 0x33),
      new Color(0x5f, 0x9b, 0x2f), new Color(0x57, 0x93, 0x27), new Color(0x53, 0x8b, 0x23),
      new Color(0x4f, 0x83, 0x1b), new Color(0x47, 0x7f, 0x17), new Color(0x3f, 0x73, 0x13),
      new Color(0x3b, 0x6b, 0x13), new Color(0x33, 0x63, 0x0f), new Color(0x2f, 0x57, 0x0b),
      new Color(0x2b, 0x4f, 0x0b), new Color(0x23, 0x43, 0x0b), new Color(0x1f, 0x3b, 0x07),
      new Color(0x1b, 0x33, 0x07), new Color(0xef, 0xcf, 0xaf), new Color(0xef, 0xcf, 0xaf),
      new Color(0xe3, 0xbf, 0x9f), new Color(0xd7, 0xb3, 0x8f), new Color(0xd7, 0xb3, 0x8f),
      new Color(0xcb, 0xa3, 0x7f), new Color(0xbf, 0x97, 0x73), new Color(0xbf, 0x97, 0x73),
      new Color(0xb3, 0x87, 0x67), new Color(0xab, 0x7b, 0x5b), new Color(0xab, 0x7b, 0x5b),
      new Color(0x9f, 0x6f, 0x4f), new Color(0x93, 0x63, 0x43), new Color(0x93, 0x63, 0x43),
      new Color(0x87, 0x57, 0x3b), new Color(0x7b, 0x4f, 0x33), new Color(0x7b, 0x4f, 0x33),
      new Color(0xd7, 0xb3, 0x8f), new Color(0xd7, 0xb3, 0x8f), new Color(0xcb, 0xa3, 0x7f),
      new Color(0xcb, 0xa3, 0x7f), new Color(0xbf, 0x97, 0x73), new Color(0xbf, 0x97, 0x73),
      new Color(0xb3, 0x87, 0x67), new Color(0xab, 0x7b, 0x5b), new Color(0x9f, 0x6f, 0x4f),
      new Color(0x93, 0x63, 0x43), new Color(0x87, 0x57, 0x3b), new Color(0x7b, 0x4f, 0x33),
      new Color(0x73, 0x43, 0x2b), new Color(0x67, 0x3b, 0x23), new Color(0x5b, 0x33, 0x1b),
      new Color(0x4f, 0x2b, 0x17), new Color(0x43, 0x23, 0x13), new Color(0xff, 0xff, 0xff),
      new Color(0xff, 0xff, 0xff), new Color(0xef, 0xef, 0xef), new Color(0xef, 0xef, 0xef),
      new Color(0xdf, 0xdf, 0xdf), new Color(0xd3, 0xd3, 0xd3), new Color(0xc3, 0xc3, 0xc3),
      new Color(0xb3, 0xb3, 0xb3), new Color(0xa7, 0xa7, 0xa7), new Color(0x97, 0x97, 0x97),
      new Color(0x87, 0x87, 0x87), new Color(0x7b, 0x7b, 0x7b), new Color(0x6b, 0x6b, 0x6b),
      new Color(0x5b, 0x5b, 0x5b), new Color(0x4f, 0x4f, 0x4f), new Color(0x3f, 0x3f, 0x3f),
      new Color(0x2f, 0x2f, 0x2f), new Color(0x07, 0x07, 0xb3), new Color(0x07, 0x07, 0xb3),
      new Color(0x07, 0x07, 0xb3), new Color(0x07, 0x07, 0xb3), new Color(0x07, 0x07, 0xb3),
      new Color(0x07, 0x07, 0xb3), new Color(0x07, 0x07, 0xb3), new Color(0x07, 0x07, 0xb3),
      new Color(0x07, 0x07, 0xb3), new Color(0x07, 0x07, 0xb3), new Color(0x07, 0x07, 0xb3),
      new Color(0x07, 0x07, 0xb3), new Color(0x07, 0x07, 0xb3), new Color(0x07, 0x07, 0xb3),
      new Color(0x07, 0x07, 0xb3), new Color(0x07, 0x07, 0xb3), new Color(0x07, 0x07, 0xb3),
      new Color(0x0b, 0x0b, 0xb7), new Color(0x0b, 0x0b, 0xb7), new Color(0x0b, 0x0b, 0xb7),
      new Color(0x0b, 0x0b, 0xb7), new Color(0x0b, 0x0b, 0xb7), new Color(0x0b, 0x0b, 0xb7),
      new Color(0x0b, 0x0b, 0xb7), new Color(0x0b, 0x0b, 0xb7), new Color(0x0b, 0x0b, 0xb7),
      new Color(0x0b, 0x0b, 0xb7), new Color(0x0b, 0x0b, 0xb7), new Color(0x0b, 0x0b, 0xb7),
      new Color(0x0b, 0x0b, 0xb7), new Color(0x0b, 0x0b, 0xb7), new Color(0x0b, 0x0b, 0xb7),
      new Color(0x0b, 0x0b, 0xb7), new Color(0x0b, 0x0b, 0xb7), new Color(0x13, 0x13, 0xbb),
      new Color(0x13, 0x13, 0xbb), new Color(0x13, 0x13, 0xbb), new Color(0x13, 0x13, 0xbb),
      new Color(0x13, 0x13, 0xbb), new Color(0x13, 0x13, 0xbb), new Color(0x13, 0x13, 0xbb),
      new Color(0x13, 0x13, 0xbb), new Color(0x13, 0x13, 0xbb), new Color(0x13, 0x13, 0xbb),
      new Color(0x13, 0x13, 0xbb), new Color(0x13, 0x13, 0xbb), new Color(0x13, 0x13, 0xbb),
      new Color(0x13, 0x13, 0xbb), new Color(0x13, 0x13, 0xbb), new Color(0x13, 0x13, 0xbb),
      new Color(0x13, 0x13, 0xbb),
    ];

    const map = this.map;
    if (map === null) {
      return;
    }

    this.minimap = [];

    for (let pos of map.geom()) {
      const typeOff = colorOffset[map.typeUp(pos)];

      pos = map.moveRight(pos);
      const h1 = map.getHeight(pos);

      pos = map.moveLeft(map.moveDown(pos));
      const h2 = map.getHeight(pos);

      const hOff = h2 - h1 + 8;
      this.minimap.push(colors[typeOff + hOff]);
    }
  }

  protected drawMinimapPoint(col: number, row: number, color: Color, density: number): void {
    const map = this.map as GameMap;
    const mapWidth = map.getCols() * this.scale;
    const mapHeight = map.getRows() * this.scale;

    if (0 === mapWidth || 0 === mapHeight) {
      return;
    }

    let mmY = row * this.scale - this.offsetY;
    col -= idiv(map.getRows(), 2) * idiv(mmY, mapHeight);
    mmY = mmY % mapHeight;

    while (mmY < this.height) {
      if (mmY >= -density) {
        let mmX = col * this.scale - idiv(row * this.scale, 2) - this.offsetX;
        mmX = mmX % mapWidth;
        while (mmX < this.width) {
          if (mmX >= -density) {
            (this.frame as Frame).fillRect(mmX, mmY, density, density, color);
          }
          mmX += mapWidth;
        }
      }
      col -= idiv(map.getRows(), 2);
      mmY += mapHeight;
    }
  }

  protected drawMinimapMap(): void {
    const map = this.map as GameMap;
    let colorData = 0;
    for (let row = 0; row < map.getRows(); row++) {
      for (let col = 0; col < map.getCols(); col++) {
        const color = this.minimap[colorData++];
        this.drawMinimapPoint(col, row, color, this.scale);
      }
    }
  }

  protected drawMinimapGrid(): void {
    const map = this.map as GameMap;
    for (let py = 0; py < map.getRows() * this.scale; py += 2) {
      this.drawMinimapPoint(0, py, new Color(0xab, 0x7b, 0x5b), 1);
      this.drawMinimapPoint(0, py + 1, Color.black, 1);
    }

    for (let px = 0; px < map.getCols() * this.scale; px += 2) {
      this.drawMinimapPoint(px, 0, new Color(0xab, 0x7b, 0x5b), 1);
      this.drawMinimapPoint(px + 1, 0, Color.black, 1);
    }
  }

  protected drawMinimapRect(): void {
    const px = idiv(this.width, 2);
    const py = idiv(this.height, 2);
    (this.frame as Frame).drawSprite(px, py, Data.Resource.AssetGameObject, 33, true);
  }

  protected override internalDraw(): void {
    if (this.map === null) {
      (this.frame as Frame).fillRect(0, 0, this.width, this.height, Color.black);
      return;
    }

    this.drawMinimapMap();

    if (this.drawGrid) {
      this.drawMinimapGrid();
    }
  }

  // PORT: int up in the C++, used as a truth value.
  protected handleScroll(up: number): number {
    let scale_ = 0;

    if (up) {
      scale_ = this.scale + 1;
    } else {
      scale_ = this.scale - 1;
    }

    this.setScale(clamp(1, scale_, Minimap.maxScale));

    return 0;
  }

  protected override handleDrag(dx: number, dy: number): boolean {
    if (dx !== 0 || dy !== 0) {
      this.moveByPixels(dx, dy);
    }

    return true;
  }

  setMap(_map: PMap | null): void {
    this.map = _map;
    this.initMinimap();
    this.setRedraw();
  }

  /* Set the scale of the map (zoom). Must be positive. */
  setScale(scale: number): void {
    const pos = this.getCurrentMapPos();
    this.scale = scale;
    this.moveToMapPos(pos);

    this.setRedraw();
  }

  // PORT: the out-parameters sx, sy become the result [sx, sy].
  protected screenPixFromMapPix(mx: number, my: number): [number, number] {
    const map = this.map as GameMap;
    const pwidth = map.getCols() * this.scale;
    const pheight = map.getRows() * this.scale;

    let sx = mx - this.offsetX;
    let sy = my - this.offsetY;

    while (sy < 0) {
      sx -= idiv(pheight, 2);
      sy += pheight;
    }

    while (sy >= pheight) {
      sx += idiv(pheight, 2);
      sy -= pheight;
    }

    while (sx < 0) sx += pwidth;
    while (sx >= pwidth) sx -= pwidth;

    return [sx, sy];
  }

  // PORT: the out-parameters mx, my become the result [mx, my].
  protected mapPixFromMapCoord(pos: MapPos): [number, number] {
    const map = this.map as GameMap;
    const pwidth = map.getCols() * this.scale;
    const pheight = map.getRows() * this.scale;

    let mx = this.scale * map.posCol(pos) - idiv(this.scale * map.posRow(pos), 2);
    let my = this.scale * map.posRow(pos);

    if (my < 0) {
      mx -= idiv(pheight, 2);
      my += pheight;
    }

    if (mx < 0) mx += pwidth;
    else if (mx >= pwidth) mx -= pwidth;

    return [mx, my];
  }

  // PORT: screen_pix_from_map_pos() is declared in minimap.h and defined
  // nowhere in the C++ (no caller); there is nothing to port.

  mapPosFromScreenPix(sx: number, sy: number): MapPos {
    const map = this.map as GameMap;
    const mx = sx + this.offsetX;
    const my = sy + this.offsetY;

    const col = idiv(idiv(my, 2) + mx, this.scale) & map.getColMask();
    const row = idiv(my, this.scale) & map.getRowMask();

    return map.pos(col, row);
  }

  getCurrentMapPos(): MapPos {
    return this.mapPosFromScreenPix(idiv(this.width, 2), idiv(this.height, 2));
  }

  moveToMapPos(pos: MapPos): void {
    const map = this.map as GameMap;
    let [mx, my] = this.mapPixFromMapCoord(pos);

    const mapWidth = map.getCols() * this.scale;
    const mapHeight = map.getRows() * this.scale;

    /* Center view */
    mx -= idiv(this.width, 2);
    my -= idiv(this.height, 2);

    if (my < 0) {
      mx -= idiv(mapHeight, 2);
      my += mapHeight;
    }

    if (mx < 0) mx += mapWidth;
    else if (mx >= mapWidth) mx -= mapWidth;

    this.offsetX = mx;
    this.offsetY = my;

    this.setRedraw();
  }

  moveByPixels(dx: number, dy: number): void {
    const map = this.map as GameMap;
    const pwidth = map.getCols() * this.scale;
    const pheight = map.getRows() * this.scale;

    this.offsetX += dx;
    this.offsetY += dy;

    if (this.offsetY < 0) {
      this.offsetY += pheight;
      this.offsetX -= idiv(pheight, 2);
    } else if (this.offsetY >= pheight) {
      this.offsetY -= pheight;
      this.offsetX += idiv(pheight, 2);
    }

    if (this.offsetX >= pwidth) this.offsetX -= pwidth;
    else if (this.offsetX < 0) this.offsetX += pwidth;

    this.setRedraw();
  }
}

export enum MinimapGameOwnershipMode {
  OwnershipModeNone = 0,
  OwnershipModeMixed = 1,
  OwnershipModeSolid = 2,
  OwnershipModeLast = OwnershipModeSolid,
}

export class MinimapGame extends Minimap {
  static OwnershipMode = MinimapGameOwnershipMode;

  // PORT: `interface` is the field name of the C++; the constructor
  // parameter is _interface as there.
  protected interface: Interface;

  protected game: PGame;

  protected advanced: number;
  protected drawRoads: boolean;
  protected drawBuildings: boolean;
  protected ownershipMode: MinimapGameOwnershipMode;

  constructor(_interface: Interface, _game: PGame) {
    super(_game.getMap());
    this.interface = _interface;
    this.game = _game;
    this.advanced = -1;
    this.drawRoads = false;
    this.drawBuildings = true;
    this.ownershipMode = MinimapGameOwnershipMode.OwnershipModeNone;
  }

  getAdvanced(): number {
    return this.advanced;
  }

  setAdvanced(advanced: number): void {
    this.advanced = advanced;
  }

  getDrawRoads(): boolean {
    return this.drawRoads;
  }

  getDrawBuildings(): boolean {
    return this.drawBuildings;
  }

  getOwnershipMode(): MinimapGameOwnershipMode {
    return this.ownershipMode;
  }

  protected drawMinimapOwnership(density: number): void {
    const map = this.map as GameMap;
    for (let row = 0; row < map.getRows(); row += density) {
      for (let col = 0; col < map.getCols(); col += density) {
        const pos = map.pos(col, row);
        if (map.hasOwner(pos)) {
          const color = this.interface.getPlayerColor(map.getOwner(pos));
          this.drawMinimapPoint(col, row, color, this.scale);
        }
      }
    }
  }

  protected drawMinimapRoads(): void {
    const map = this.map as GameMap;
    for (let row = 0; row < map.getRows(); row++) {
      for (let col = 0; col < map.getCols(); col++) {
        const pos = map.pos(col, row);
        if (map.paths(pos)) {
          this.drawMinimapPoint(col, row, Color.black, this.scale);
        }
      }
    }
  }

  protected drawMinimapBuildings(): void {
    const buildingRemap = [
      BuildingType.TypeCastle,
      BuildingType.TypeStock, BuildingType.TypeTower, BuildingType.TypeHut,
      BuildingType.TypeFortress, BuildingType.TypeToolMaker, BuildingType.TypeSawmill,
      BuildingType.TypeWeaponSmith, BuildingType.TypeStonecutter,
      BuildingType.TypeBoatbuilder, BuildingType.TypeForester, BuildingType.TypeLumberjack,
      BuildingType.TypePigFarm, BuildingType.TypeFarm, BuildingType.TypeFisher,
      BuildingType.TypeMill, BuildingType.TypeButcher, BuildingType.TypeBaker,
      BuildingType.TypeStoneMine, BuildingType.TypeCoalMine, BuildingType.TypeIronMine,
      BuildingType.TypeGoldMine, BuildingType.TypeSteelSmelter,
      BuildingType.TypeGoldSmelter,
    ];

    const map = this.map as GameMap;
    for (let row = 0; row < map.getRows(); row++) {
      for (let col = 0; col < map.getCols(); col++) {
        const pos = map.pos(col, row);
        const obj = map.getObj(pos);
        if (obj > MapObject.ObjectFlag && obj <= MapObject.ObjectCastle) {
          const color = this.interface.getPlayerColor(map.getOwner(pos));
          if (this.advanced > 0) {
            const bld = (this.interface.getGame() as Game).getBuildingAtPos(pos)!;
            if (bld.getType() === buildingRemap[this.advanced]) {
              this.drawMinimapPoint(col, row, color, this.scale);
            }
          } else {
            this.drawMinimapPoint(col, row, color, this.scale);
          }
        }
      }
    }
  }

  protected drawMinimapTraffic(): void {
    const map = this.map as GameMap;
    for (let row = 0; row < map.getRows(); row++) {
      for (let col = 0; col < map.getCols(); col++) {
        const pos = map.pos(col, row);
        if (map.getIdleSerf(pos)) {
          const color = this.interface.getPlayerColor(map.getOwner(pos));
          this.drawMinimapPoint(col, row, color, this.scale);
        }
      }
    }
  }

  setOwnershipMode(_ownershipMode: MinimapGameOwnershipMode): void {
    this.ownershipMode = _ownershipMode;
    this.setRedraw();
  }

  setDrawRoads(_drawRoads: boolean): void {
    this.drawRoads = _drawRoads;
    this.setRedraw();
  }

  setDrawBuildings(_drawBuildings: boolean): void {
    this.drawBuildings = _drawBuildings;
    this.setRedraw();
  }

  protected override internalDraw(): void {
    switch (this.ownershipMode) {
      case MinimapGameOwnershipMode.OwnershipModeNone:
        this.drawMinimapMap();
        break;
      case MinimapGameOwnershipMode.OwnershipModeMixed:
        this.drawMinimapMap();
        this.drawMinimapOwnership(2);
        break;
      case MinimapGameOwnershipMode.OwnershipModeSolid:
        (this.frame as Frame).fillRect(0, 0, 128, 128, Color.black);
        this.drawMinimapOwnership(1);
        break;
    }

    if (this.drawRoads) {
      this.drawMinimapRoads();
    }

    if (this.drawBuildings) {
      this.drawMinimapBuildings();
    }

    if (this.drawGrid) {
      this.drawMinimapGrid();
    }

    if (this.advanced > 0) {
      this.drawMinimapTraffic();
    }

    this.drawMinimapRect();
  }

  protected override handleClickLeft(cx: number, cy: number): boolean {
    const pos = this.mapPosFromScreenPix(cx, cy);
    this.interface.getViewport()!.moveToMapPos(pos);

    this.interface.updateMapCursorPos(pos);
    this.interface.closePopup();

    return true;
  }
}
