/*
 * map.ts - Map data and map update functions
 *
 * Port of Freeserf's map.h and map.cc.
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

/* Basically the map is constructed from a regular, square grid, with
   rows and columns, except that the grid is actually sheared like this:
   http://mathworld.wolfram.com/Polyrhomb.html
   This is the foundational 2D grid for the map, where each vertex can be
   identified by an integer col and row (commonly encoded as MapPos).

   Each tile has the shape of a rhombus:
      A ______ B
       /\    /
      /  \  /
   C /____\/ D

   but is actually composed of two triangles called "up" (a,c,d) and
   "down" (a,b,d). A serf can move on the perimeter of any of these
   triangles. Each vertex has various properties associated with it,
   among others a height value which means that the 3D landscape is
   defined by these points in (col, row, height)-space.

   Map elevation and type
   ----------------------
   The type of terrain is determined by either the elevation or the adjacency
   to other terrain types when the map is generated. The type is encoded
   separately from the elevation so it is only the map generator enforcing this
   correlation. The elevation (height) values range in 0-31 while the type
   ranges in 0-15.

   Terrain types:
   - 0-3: Water (range encodes adjacency to shore)
   - 4-7: Grass (4=adjacency to water, 5=only tile that allows large buildings,
                 6-7=elevation based)
   - 8-10: Desert (range encodes adjacency to grass)
   - 11-13: Tundra (elevation based)
   - 14-15: Snow (elevation based)

   For water tiles, desert tiles and grass tile 4, the ranges of values are
   used to encode distance to other terrains. For example, type 4 grass is
   adjacent to at least one water tile and type 3 water is adjacent to at
   least one grass tile. Type 2 water is adjacent to at least one type 3 water,
   type 1 water is adjacent to at least one type 2 water, and so on. The lower
   desert tiles (8) are close to grass while the higher (10) are at the center
   of the desert. The higher grass tiles (5-7), tundra tiles, and snow tiles
   are determined by elevation and _not_ be adjacency.
*/

import {
  Direction,
  MapGeometry,
  badMapPos,
  cycleDirectionsCw,
  reverseDirection,
} from './map-geometry';
import type { MapPos } from './map-geometry';
import { BIT, BIT_TEST, ExceptionFreeserf, i32, NOT_REACHED, u16, u32, u8 } from './misc';
import type { Random } from './random';
import type { MapGenerator } from './map-generator';
import type { SaveReaderText, SaveWriterText } from './savegame';

// map.h includes map-geometry.h, so everything declared there is visible
// to modules that import './map'.
export * from './map-geometry';

export type RoadDirs = Direction[];

export class Road {
  protected begin: MapPos;
  protected dirs: RoadDirs = [];

  static readonly maxLength = 256;

  constructor() {
    this.begin = badMapPos;
  }

  isValid(): boolean {
    return this.begin !== badMapPos;
  }
  invalidate(): void {
    this.begin = badMapPos;
    this.dirs = [];
  }
  start(start: MapPos): void {
    this.begin = start;
  }
  getSource(): MapPos {
    return this.begin;
  }
  // Returns a copy, as in the C++.
  getDirs(): RoadDirs {
    return this.dirs.slice();
  }
  getLength(): number {
    return this.dirs.length;
  }
  getLast(): Direction {
    return this.dirs[this.dirs.length - 1];
  }
  isExtendable(): boolean {
    return this.dirs.length < Road.maxLength;
  }

  isValidExtension(map: Map, dir: Direction): boolean {
    if (this.isUndo(dir)) {
      return false;
    }

    /* Check that road does not cross itself. */
    const extendedEnd = map.move(this.getEnd(map), dir);
    let pos = this.begin;
    let valid = true;
    for (const _dir of this.dirs) {
      pos = map.move(pos, _dir);
      if (pos === extendedEnd) {
        valid = false;
        break;
      }
    }

    return valid;
  }

  isUndo(dir: Direction): boolean {
    return this.dirs.length > 0 && this.dirs[this.dirs.length - 1] === reverseDirection(dir);
  }

  extend(dir: Direction): boolean {
    if (this.begin === badMapPos) {
      return false;
    }

    this.dirs.push(dir);

    return true;
  }

  undo(): boolean {
    if (this.begin === badMapPos) {
      return false;
    }

    this.dirs.pop();
    if (this.dirs.length === 0) {
      this.begin = badMapPos;
    }

    return true;
  }

  getEnd(map: Map): MapPos {
    let result = this.begin;
    for (const dir of this.dirs) {
      result = map.move(result, dir);
    }
    return result;
  }

  hasPos(map: Map, pos: MapPos): boolean {
    let result = this.begin;
    for (const dir of this.dirs) {
      if (result === pos) {
        return true;
      }
      result = map.move(result, dir);
    }
    return result === pos;
  }
}

export enum MapObject {
  ObjectNone = 0,
  ObjectFlag,
  ObjectSmallBuilding,
  ObjectLargeBuilding,
  ObjectCastle,

  ObjectTree0 = 8,
  ObjectTree1,
  ObjectTree2 /* 10 */,
  ObjectTree3,
  ObjectTree4,
  ObjectTree5,
  ObjectTree6,
  ObjectTree7 /* 15 */,

  ObjectPine0,
  ObjectPine1,
  ObjectPine2,
  ObjectPine3,
  ObjectPine4 /* 20 */,
  ObjectPine5,
  ObjectPine6,
  ObjectPine7,

  ObjectPalm0,
  ObjectPalm1 /* 25 */,
  ObjectPalm2,
  ObjectPalm3,

  ObjectWaterTree0,
  ObjectWaterTree1,
  ObjectWaterTree2 /* 30 */,
  ObjectWaterTree3,

  ObjectStone0 = 72,
  ObjectStone1,
  ObjectStone2,
  ObjectStone3 /* 75 */,
  ObjectStone4,
  ObjectStone5,
  ObjectStone6,
  ObjectStone7,

  ObjectSandstone0 /* 80 */,
  ObjectSandstone1,

  ObjectCross,
  ObjectStub,

  ObjectStone,
  ObjectSandstone3 /* 85 */,

  ObjectCadaver0,
  ObjectCadaver1,

  ObjectWaterStone0,
  ObjectWaterStone1,

  ObjectCactus0 /* 90 */,
  ObjectCactus1,

  ObjectDeadTree,

  ObjectFelledPine0,
  ObjectFelledPine1,
  ObjectFelledPine2 /* 95 */,
  ObjectFelledPine3,
  ObjectFelledPine4,

  ObjectFelledTree0,
  ObjectFelledTree1,
  ObjectFelledTree2 /* 100 */,
  ObjectFelledTree3,
  ObjectFelledTree4,

  ObjectNewPine,
  ObjectNewTree,

  ObjectSeeds0 /* 105 */,
  ObjectSeeds1,
  ObjectSeeds2,
  ObjectSeeds3,
  ObjectSeeds4,
  ObjectSeeds5 /* 110 */,
  ObjectFieldExpired,

  ObjectSignLargeGold,
  ObjectSignSmallGold,
  ObjectSignLargeIron,
  ObjectSignSmallIron /* 115 */,
  ObjectSignLargeCoal,
  ObjectSignSmallCoal,
  ObjectSignLargeStone,
  ObjectSignSmallStone,

  ObjectSignEmpty /* 120 */,

  ObjectField0,
  ObjectField1,
  ObjectField2,
  ObjectField3,
  ObjectField4 /* 125 */,
  ObjectField5,
  Object127,
}

export enum MapMinerals {
  MineralsNone = 0,
  MineralsGold,
  MineralsIron,
  MineralsCoal,
  MineralsStone,
}

/* A map space can be OPEN which means that
   a building can be constructed in the space.
   A FILLED space can be passed by a serf, but
   nothing can be built in this space except roads.
   A SEMIPASSABLE space is like FILLED but no roads
   can be built. A IMPASSABLE space can neither be
   used for contructions nor passed by serfs. */
export enum MapSpace {
  SpaceOpen = 0,
  SpaceFilled,
  SpaceSemipassable,
  SpaceImpassable,
}

export enum MapTerrain {
  TerrainWater0 = 0,
  TerrainWater1,
  TerrainWater2,
  TerrainWater3,
  TerrainGrass0, // 4
  TerrainGrass1,
  TerrainGrass2,
  TerrainGrass3,
  TerrainDesert0, // 8
  TerrainDesert1,
  TerrainDesert2,
  TerrainTundra0, // 11
  TerrainTundra1,
  TerrainTundra2,
  TerrainSnow0, // 14
  TerrainSnow1,
}

// Map::Handler
export interface MapHandler {
  onHeightChanged(pos: MapPos): void;
  onObjectChanged(pos: MapPos): void;
}

// Map::LandscapeTile
export class MapLandscapeTile {
  // Landscape filds
  height = 0;
  typeUp: MapTerrain = MapTerrain.TerrainWater0;
  typeDown: MapTerrain = MapTerrain.TerrainWater0;
  mineral: MapMinerals = MapMinerals.MineralsNone;
  resourceAmount = 0;
  // Mingled fields
  obj: MapObject = MapObject.ObjectNone;
}

// PORT: the tile structs hold data only, so that plain object literals with
// the same fields are accepted wherever a tile is expected. Their operator==
// are the free functions landscapeTileEquals(), updateStateEquals() and
// gameTileEquals().
export function landscapeTileEquals(lhs: MapLandscapeTile, rhs: MapLandscapeTile): boolean {
  return (
    lhs.height === rhs.height &&
    lhs.typeUp === rhs.typeUp &&
    lhs.typeDown === rhs.typeDown &&
    lhs.mineral === rhs.mineral &&
    lhs.resourceAmount === rhs.resourceAmount &&
    lhs.obj === rhs.obj
  );
}

// Map::UpdateState
export class MapUpdateState {
  removeSignsCounter = 0;
  lastTick = 0; // uint16_t
  counter = 0;
  initialPos: MapPos = 0;
}

export function updateStateEquals(lhs: MapUpdateState, rhs: MapUpdateState): boolean {
  return (
    lhs.removeSignsCounter === rhs.removeSignsCounter &&
    lhs.lastTick === rhs.lastTick &&
    lhs.counter === rhs.counter &&
    lhs.initialPos === rhs.initialPos
  );
}

// Map::GameTile
export class MapGameTile {
  serf = 0;
  owner = 0;
  objIndex = 0;
  paths = 0; // uint8_t
  idleSerf = false;
}

export function gameTileEquals(lhs: MapGameTile, rhs: MapGameTile): boolean {
  return (
    lhs.paths === rhs.paths &&
    lhs.serf === rhs.serf &&
    lhs.owner === rhs.owner &&
    lhs.idleSerf === rhs.idleSerf &&
    lhs.objIndex === rhs.objIndex
  );
}

const SAVE_MAP_TILE_SIZE = 16;

// PORT: stand-ins for the C++ out parameters `int *col`, `int *row` of
// Map::get_rnd_coord() and the in/out `MapPos *pos` of
// Map::remove_road_segment().
export interface IntRef {
  value: number;
}
export interface MapPosRef {
  pos: MapPos;
}

/* Facilitates quick lookup of offsets following a spiral pattern in the map data.
 The columns following the second are filled out by setup_spiral_pattern(). */
const spiralPattern: number[] = [
  0, 0,
  1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  3, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  4, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  5, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  5, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  5, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  5, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  6, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  6, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  6, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  6, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  6, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  7, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  7, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  7, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  7, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  7, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  7, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  8, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  8, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  8, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  8, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  8, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  8, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  8, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  9, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  9, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  9, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  9, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  9, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  9, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  9, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  16, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  24, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  24, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

let spiralPatternInitialized = 0;

/* Initialize the global spiral_pattern. */
function initSpiralPattern(): void {
  if (spiralPatternInitialized) {
    return;
  }

  const spiralMatrix = [
    1, 0, 0, 1,
    1, 1, -1, 0,
    0, 1, -1, -1,
    -1, 0, 0, -1,
    -1, -1, 1, 0,
    0, -1, 1, 1,
  ];

  for (let i = 0; i < 49; i++) {
    const x = spiralPattern[2 + 12 * i];
    const y = spiralPattern[2 + 12 * i + 1];

    for (let j = 0; j < 6; j++) {
      spiralPattern[2 + 12 * i + 2 * j] = x * spiralMatrix[4 * j + 0] + y * spiralMatrix[4 * j + 2];
      spiralPattern[2 + 12 * i + 2 * j + 1] =
        x * spiralMatrix[4 * j + 1] + y * spiralMatrix[4 * j + 3];
    }
  }

  spiralPatternInitialized = 1;
}

/* Map Object to Space. */
const mapSpaceFromObj: MapSpace[] = [
  MapSpace.SpaceOpen, // ObjectNone = 0,
  MapSpace.SpaceFilled, // ObjectFlag,
  MapSpace.SpaceImpassable, // ObjectSmallBuilding,
  MapSpace.SpaceImpassable, // ObjectLargeBuilding,
  MapSpace.SpaceImpassable, // ObjectCastle,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,

  MapSpace.SpaceFilled, // ObjectTree0 = 8,
  MapSpace.SpaceFilled, // ObjectTree1,
  MapSpace.SpaceFilled, // ObjectTree2, /* 10 */
  MapSpace.SpaceFilled, // ObjectTree3,
  MapSpace.SpaceFilled, // ObjectTree4,
  MapSpace.SpaceFilled, // ObjectTree5,
  MapSpace.SpaceFilled, // ObjectTree6,
  MapSpace.SpaceFilled, // ObjectTree7, /* 15 */

  MapSpace.SpaceFilled, // ObjectPine0,
  MapSpace.SpaceFilled, // ObjectPine1,
  MapSpace.SpaceFilled, // ObjectPine2,
  MapSpace.SpaceFilled, // ObjectPine3,
  MapSpace.SpaceFilled, // ObjectPine4, /* 20 */
  MapSpace.SpaceFilled, // ObjectPine5,
  MapSpace.SpaceFilled, // ObjectPine6,
  MapSpace.SpaceFilled, // ObjectPine7,

  MapSpace.SpaceFilled, // ObjectPalm0,
  MapSpace.SpaceFilled, // ObjectPalm1, /* 25 */
  MapSpace.SpaceFilled, // ObjectPalm2,
  MapSpace.SpaceFilled, // ObjectPalm3,

  MapSpace.SpaceImpassable, // ObjectWaterTree0,
  MapSpace.SpaceImpassable, // ObjectWaterTree1,
  MapSpace.SpaceImpassable, // ObjectWaterTree2, /* 30 */
  MapSpace.SpaceImpassable, // ObjectWaterTree3,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,
  MapSpace.SpaceOpen,

  MapSpace.SpaceImpassable, // ObjectStone0 = 72,
  MapSpace.SpaceImpassable, // ObjectStone1,
  MapSpace.SpaceImpassable, // ObjectStone2,
  MapSpace.SpaceImpassable, // ObjectStone3, /* 75 */
  MapSpace.SpaceImpassable, // ObjectStone4,
  MapSpace.SpaceImpassable, // ObjectStone5,
  MapSpace.SpaceImpassable, // ObjectStone6,
  MapSpace.SpaceImpassable, // ObjectStone7,

  MapSpace.SpaceImpassable, // ObjectSandstone0, /* 80 */
  MapSpace.SpaceImpassable, // ObjectSandstone1,

  MapSpace.SpaceFilled, // ObjectCross,
  MapSpace.SpaceOpen, // ObjectStub,

  MapSpace.SpaceOpen, // ObjectStone,
  MapSpace.SpaceOpen, // ObjectSandstone3, /* 85 */

  MapSpace.SpaceOpen, // ObjectCadaver0,
  MapSpace.SpaceOpen, // ObjectCadaver1,

  MapSpace.SpaceImpassable, // ObjectWaterStone0,
  MapSpace.SpaceImpassable, // ObjectWaterStone1,

  MapSpace.SpaceFilled, // ObjectCactus0, /* 90 */
  MapSpace.SpaceFilled, // ObjectCactus1,

  MapSpace.SpaceFilled, // ObjectDeadTree,

  MapSpace.SpaceFilled, // ObjectFelledPine0,
  MapSpace.SpaceFilled, // ObjectFelledPine1,
  MapSpace.SpaceFilled, // ObjectFelledPine2, /* 95 */
  MapSpace.SpaceFilled, // ObjectFelledPine3,
  MapSpace.SpaceOpen, // ObjectFelledPine4,

  MapSpace.SpaceFilled, // ObjectFelledTree0,
  MapSpace.SpaceFilled, // ObjectFelledTree1,
  MapSpace.SpaceFilled, // ObjectFelledTree2, /* 100 */
  MapSpace.SpaceFilled, // ObjectFelledTree3,
  MapSpace.SpaceOpen, // ObjectFelledTree4,

  MapSpace.SpaceFilled, // ObjectNewPine,
  MapSpace.SpaceFilled, // ObjectNewTree,

  MapSpace.SpaceSemipassable, // ObjectSeeds0, /* 105 */
  MapSpace.SpaceSemipassable, // ObjectSeeds1,
  MapSpace.SpaceSemipassable, // ObjectSeeds2,
  MapSpace.SpaceSemipassable, // ObjectSeeds3,
  MapSpace.SpaceSemipassable, // ObjectSeeds4,
  MapSpace.SpaceSemipassable, // ObjectSeeds5, /* 110 */
  MapSpace.SpaceOpen, // ObjectFieldExpired,

  MapSpace.SpaceOpen, // ObjectSignLargeGold,
  MapSpace.SpaceOpen, // ObjectSignSmallGold,
  MapSpace.SpaceOpen, // ObjectSignLargeIron,
  MapSpace.SpaceOpen, // ObjectSignSmallIron, /* 115 */
  MapSpace.SpaceOpen, // ObjectSignLargeCoal,
  MapSpace.SpaceOpen, // ObjectSignSmallCoal,
  MapSpace.SpaceOpen, // ObjectSignLargeStone,
  MapSpace.SpaceOpen, // ObjectSignSmallStone,

  MapSpace.SpaceOpen, // ObjectSignEmpty, /* 120 */

  MapSpace.SpaceSemipassable, // ObjectField0,
  MapSpace.SpaceSemipassable, // ObjectField1,
  MapSpace.SpaceSemipassable, // ObjectField2,
  MapSpace.SpaceSemipassable, // ObjectField3,
  MapSpace.SpaceSemipassable, // ObjectField4, /* 125 */
  MapSpace.SpaceSemipassable, // ObjectField5,
  MapSpace.SpaceOpen, // Object127
];

// Map data.
//
// Initialization of a new Map takes a few steps:
//
// 1. Construct a MapGeometry specifying the size of the map.
// 2. Construct a Map from the MapGeometry.
// 3. Construct a MapGenerator subclass based on the Map object and use
//    it to generate the initial map data.
// 4. Call init_tiles() on the Map supplying the MapGenerator object to copy
//    the new tile data into the Map.
//
// Note: this class shadows the built-in `Map` in every module that imports it.
export class Map {
  static Object = MapObject;
  static Minerals = MapMinerals;
  static Space = MapSpace;
  static Terrain = MapTerrain;
  static LandscapeTile = MapLandscapeTile;
  static UpdateState = MapUpdateState;

  protected geom_: MapGeometry;
  protected landscapeTiles: MapLandscapeTile[] = [];
  protected gameTiles: MapGameTile[] = [];

  protected regions: number; // uint16_t

  protected updateState = new MapUpdateState();

  /* Callback for map height changes */
  protected changeHandlers: MapHandler[] = [];

  protected spiralPosPattern: MapPos[];

  constructor(geom: MapGeometry) {
    this.geom_ = new MapGeometry(geom);
    this.spiralPosPattern = new Array<MapPos>(295).fill(0);
    // Some code may still assume that map has at least size 3.
    if (geom.size() < 3) {
      throw new ExceptionFreeserf('Failed to create map with size less than 3.');
    }

    const tileCount = this.geom_.tileCount();
    for (let i = 0; i < tileCount; i++) {
      this.landscapeTiles.push(new MapLandscapeTile());
      this.gameTiles.push(new MapGameTile());
    }

    this.updateState.lastTick = 0;
    this.updateState.counter = 0;
    this.updateState.removeSignsCounter = 0;
    this.updateState.initialPos = 0;

    this.regions = u16(Math.imul(geom.cols() >>> 5, geom.rows() >>> 5));

    initSpiralPattern();
    this.initSpiralPosPattern();
  }

  geom(): MapGeometry {
    return this.geom_;
  }

  getSize(): number {
    return this.geom_.size();
  }
  getCols(): number {
    return this.geom_.cols();
  }
  getRows(): number {
    return this.geom_.rows();
  }
  getColMask(): number {
    return this.geom_.colMask();
  }
  getRowMask(): number {
    return this.geom_.rowMask();
  }
  getRowShift(): number {
    return this.geom_.rowShift();
  }
  getRegionCount(): number {
    return this.regions;
  }

  // Extract col and row from MapPos
  posCol(pos: MapPos): number {
    return this.geom_.posCol(pos);
  }
  posRow(pos: MapPos): number {
    return this.geom_.posRow(pos);
  }

  // Translate col, row coordinate to MapPos value. */
  pos(x: number, y: number): MapPos {
    return this.geom_.pos(x, y);
  }

  // Addition of two map positions.
  // pos_add(MapPos pos, int x, int y) and pos_add(MapPos pos, MapPos off)
  posAdd(pos: MapPos, x: number, y?: number): MapPos {
    return this.geom_.posAdd(pos, x, y);
  }
  posAddSpirally(pos_: MapPos, off: number): MapPos {
    return this.posAdd(pos_, this.spiralPosPattern[off]);
  }

  // Shortest distance between map positions.
  distX(pos1: MapPos, pos2: MapPos): number {
    return -this.geom_.distX(pos1, pos2);
  }
  distY(pos1: MapPos, pos2: MapPos): number {
    return -this.geom_.distY(pos1, pos2);
  }

  /* Return a random map position.
     Returned as map_pos_t and also as col and row if not NULL. */
  // PORT: `int *col, int *row` are `IntRef | null`; write through `.value`.
  getRndCoord(col: IntRef | null, row: IntRef | null, rnd: Random): MapPos {
    const c = rnd.random() & this.geom_.colMask();
    const r = rnd.random() & this.geom_.rowMask();

    if (col != null) col.value = c;
    if (row != null) row.value = r;
    return this.pos(c, r);
  }

  // Movement of map position according to directions.
  move(pos: MapPos, dir: Direction): MapPos {
    return this.geom_.move(pos, dir);
  }

  moveRight(pos: MapPos): MapPos {
    return this.geom_.moveRight(pos);
  }
  moveDownRight(pos: MapPos): MapPos {
    return this.geom_.moveDownRight(pos);
  }
  moveDown(pos: MapPos): MapPos {
    return this.geom_.moveDown(pos);
  }
  moveLeft(pos: MapPos): MapPos {
    return this.geom_.moveLeft(pos);
  }
  moveUpLeft(pos: MapPos): MapPos {
    return this.geom_.moveUpLeft(pos);
  }
  moveUp(pos: MapPos): MapPos {
    return this.geom_.moveUp(pos);
  }

  moveRightN(pos: MapPos, n: number): MapPos {
    return this.geom_.moveRightN(pos, n);
  }
  moveDownN(pos: MapPos, n: number): MapPos {
    return this.geom_.moveDownN(pos, n);
  }

  /* Extractors for map data. */
  paths(pos: MapPos): number {
    return this.gameTiles[pos].paths & 0x3f;
  }
  hasPath(pos: MapPos, dir: Direction): boolean {
    return BIT_TEST(this.gameTiles[pos].paths, dir) !== 0;
  }
  addPath(pos: MapPos, dir: Direction): void {
    this.gameTiles[pos].paths = u8(this.gameTiles[pos].paths | BIT(dir));
  }
  delPath(pos: MapPos, dir: Direction): void {
    this.gameTiles[pos].paths = u8(this.gameTiles[pos].paths & ~BIT(dir));
  }

  hasOwner(pos: MapPos): boolean {
    return this.gameTiles[pos].owner !== 0;
  }
  // Unsigned in the C++: an unowned position yields 0xffffffff.
  getOwner(pos: MapPos): number {
    return u32(this.gameTiles[pos].owner - 1);
  }
  setOwner(pos: MapPos, _owner: number): void {
    this.gameTiles[pos].owner = u32(_owner + 1);
  }
  delOwner(pos: MapPos): void {
    this.gameTiles[pos].owner = 0;
  }
  getHeight(pos: MapPos): number {
    return this.landscapeTiles[pos].height;
  }

  typeUp(pos: MapPos): MapTerrain {
    return this.landscapeTiles[pos].typeUp;
  }
  typeDown(pos: MapPos): MapTerrain {
    return this.landscapeTiles[pos].typeDown;
  }

  typesWithin(pos: MapPos, low: MapTerrain, high: MapTerrain): boolean {
    if (
      this.typeUp(pos) >= low &&
      this.typeUp(pos) <= high &&
      this.typeDown(pos) >= low &&
      this.typeDown(pos) <= high &&
      this.typeDown(this.moveLeft(pos)) >= low &&
      this.typeDown(this.moveLeft(pos)) <= high &&
      this.typeUp(this.moveUpLeft(pos)) >= low &&
      this.typeUp(this.moveUpLeft(pos)) <= high &&
      this.typeDown(this.moveUpLeft(pos)) >= low &&
      this.typeDown(this.moveUpLeft(pos)) <= high &&
      this.typeUp(this.moveUp(pos)) >= low &&
      this.typeUp(this.moveUp(pos)) <= high
    ) {
      return true;
    }

    return false;
  }

  getObj(pos: MapPos): MapObject {
    return this.landscapeTiles[pos].obj;
  }
  getIdleSerf(pos: MapPos): boolean {
    return this.gameTiles[pos].idleSerf;
  }
  setIdleSerf(pos: MapPos): void {
    this.gameTiles[pos].idleSerf = true;
  }
  clearIdleSerf(pos: MapPos): void {
    this.gameTiles[pos].idleSerf = false;
  }

  getObjIndex(pos: MapPos): number {
    return this.gameTiles[pos].objIndex;
  }
  setObjIndex(pos: MapPos, index: number): void {
    this.gameTiles[pos].objIndex = u32(index);
  }
  getResType(pos: MapPos): MapMinerals {
    return this.landscapeTiles[pos].mineral;
  }
  // Returns unsigned int in the C++ although resource_amount is an int.
  getResAmount(pos: MapPos): number {
    return u32(this.landscapeTiles[pos].resourceAmount);
  }
  getResFish(pos: MapPos): number {
    return this.getResAmount(pos);
  }
  getSerfIndex(pos: MapPos): number {
    return this.gameTiles[pos].serf;
  }
  hasSerf(pos: MapPos): boolean {
    return this.gameTiles[pos].serf !== 0;
  }

  hasFlag(pos: MapPos): boolean {
    return this.getObj(pos) === MapObject.ObjectFlag;
  }
  hasBuilding(pos: MapPos): boolean {
    return (
      this.getObj(pos) >= MapObject.ObjectSmallBuilding && this.getObj(pos) <= MapObject.ObjectCastle
    );
  }

  /* Whether any of the two up/down tiles at this pos are water. */
  isWaterTile(pos: MapPos): boolean {
    return (
      this.typeDown(pos) <= MapTerrain.TerrainWater3 && this.typeUp(pos) <= MapTerrain.TerrainWater3
    );
  }

  /* Whether the position is completely surrounded by water. */
  isInWater(pos: MapPos): boolean {
    return (
      this.isWaterTile(pos) &&
      this.isWaterTile(this.moveUpLeft(pos)) &&
      this.typeDown(this.moveLeft(pos)) <= MapTerrain.TerrainWater3 &&
      this.typeUp(this.moveUp(pos)) <= MapTerrain.TerrainWater3
    );
  }

  /* Mapping from Object to Space. */
  static readonly mapSpaceFromObj: MapSpace[] = mapSpaceFromObj;

  // Get count of gold mineral deposits in the map.
  getGoldDeposit(): number {
    let count = 0;

    for (const pos_ of this.geom_) {
      if (this.getResType(pos_) === MapMinerals.MineralsGold) {
        count = (count + this.getResAmount(pos_)) | 0;
      }
    }

    return u32(count);
  }

  /* Initialize spiral_pos_pattern from spiral_pattern. */
  protected initSpiralPosPattern(): void {
    for (let i = 0; i < 295; i++) {
      const x = spiralPattern[2 * i] & this.geom_.colMask();
      const y = spiralPattern[2 * i + 1] & this.geom_.rowMask();

      this.spiralPosPattern[i] = this.pos(x, y);
    }
  }

  /* Copy tile data from map generator into map tile data. */
  initTiles(generator: MapGenerator): void {
    // The C++ assigns the vector, which copies every tile.
    const landscape: readonly MapLandscapeTile[] = generator.getLandscape();
    const tiles: MapLandscapeTile[] = [];
    for (const src of landscape) {
      const tile = new MapLandscapeTile();
      tile.height = src.height;
      tile.typeUp = src.typeUp;
      tile.typeDown = src.typeDown;
      tile.mineral = src.mineral;
      tile.resourceAmount = src.resourceAmount;
      tile.obj = src.obj;
      tiles.push(tile);
    }
    this.landscapeTiles = tiles;
  }

  /* Change the height of a map position. */
  setHeight(pos: MapPos, height: number): void {
    this.landscapeTiles[pos].height = u32(height);

    /* Mark landscape dirty */
    for (const d of cycleDirectionsCw()) {
      for (const handler of this.changeHandlers) {
        handler.onHeightChanged(this.move(pos, d));
      }
    }
  }

  /* Change the object at a map position. If index is non-negative
     also change this. The index should be reset to zero when a flag or
     building is removed. */
  setObject(pos: MapPos, obj: MapObject, index: number): void {
    this.landscapeTiles[pos].obj = obj;
    if (index >= 0) this.gameTiles[pos].objIndex = index;

    /* Notify about object change */
    for (const d of cycleDirectionsCw()) {
      for (const handler of this.changeHandlers) {
        handler.onObjectChanged(this.move(pos, d));
      }
    }
  }

  /* Remove resources from the ground at a map position. */
  removeGroundDeposit(pos: MapPos, amount: number): void {
    this.landscapeTiles[pos].resourceAmount -= amount;

    if (this.landscapeTiles[pos].resourceAmount <= 0) {
      /* Also sets the ground deposit type to none. */
      this.landscapeTiles[pos].mineral = MapMinerals.MineralsNone;
    }
  }

  /* Remove fish at a map position (must be water). */
  removeFish(pos: MapPos, amount: number): void {
    this.landscapeTiles[pos].resourceAmount -= amount;
  }

  /* Set the index of the serf occupying map position. */
  setSerfIndex(pos: MapPos, index: number): void {
    this.gameTiles[pos].serf = u32(index);

    /* TODO Mark dirty in viewport. */
  }

  /* Update public parts of the map data. */
  protected updatePublic(pos: MapPos, rnd: Random): void {
    /* Update other map objects */
    let r: number;
    switch (this.getObj(pos)) {
      case MapObject.ObjectStub:
        if ((rnd.random() & 3) === 0) {
          this.setObject(pos, MapObject.ObjectNone, -1);
        }
        break;
      case MapObject.ObjectFelledPine0:
      case MapObject.ObjectFelledPine1:
      case MapObject.ObjectFelledPine2:
      case MapObject.ObjectFelledPine3:
      case MapObject.ObjectFelledPine4:
      case MapObject.ObjectFelledTree0:
      case MapObject.ObjectFelledTree1:
      case MapObject.ObjectFelledTree2:
      case MapObject.ObjectFelledTree3:
      case MapObject.ObjectFelledTree4:
        this.setObject(pos, MapObject.ObjectStub, -1);
        break;
      case MapObject.ObjectNewPine:
        r = rnd.random();
        if ((r & 0x300) === 0) {
          this.setObject(pos, (MapObject.ObjectPine0 + (r & 7)) as MapObject, -1);
        }
        break;
      case MapObject.ObjectNewTree:
        r = rnd.random();
        if ((r & 0x300) === 0) {
          this.setObject(pos, (MapObject.ObjectTree0 + (r & 7)) as MapObject, -1);
        }
        break;
      case MapObject.ObjectSeeds0:
      case MapObject.ObjectSeeds1:
      case MapObject.ObjectSeeds2:
      case MapObject.ObjectSeeds3:
      case MapObject.ObjectSeeds4:
      case MapObject.ObjectField0:
      case MapObject.ObjectField1:
      case MapObject.ObjectField2:
      case MapObject.ObjectField3:
      case MapObject.ObjectField4:
        this.setObject(pos, (this.getObj(pos) + 1) as MapObject, -1);
        break;
      case MapObject.ObjectSeeds5:
        this.setObject(pos, MapObject.ObjectField0, -1);
        break;
      case MapObject.ObjectFieldExpired:
        this.setObject(pos, MapObject.ObjectNone, -1);
        break;
      case MapObject.ObjectSignLargeGold:
      case MapObject.ObjectSignSmallGold:
      case MapObject.ObjectSignLargeIron:
      case MapObject.ObjectSignSmallIron:
      case MapObject.ObjectSignLargeCoal:
      case MapObject.ObjectSignSmallCoal:
      case MapObject.ObjectSignLargeStone:
      case MapObject.ObjectSignSmallStone:
      case MapObject.ObjectSignEmpty:
        if (this.updateState.removeSignsCounter === 0) {
          this.setObject(pos, MapObject.ObjectNone, -1);
        }
        break;
      case MapObject.ObjectField5:
        this.setObject(pos, MapObject.ObjectFieldExpired, -1);
        break;
      default:
        break;
    }
  }

  /* Update hidden parts of the map data. */
  protected updateHidden(pos: MapPos, rnd: Random): void {
    /* Update fish resources in water */
    if (this.isInWater(pos) && this.landscapeTiles[pos].resourceAmount > 0) {
      const r = rnd.random();

      if (this.landscapeTiles[pos].resourceAmount < 10 && r & 0x3f00) {
        /* Spawn more fish. */
        this.landscapeTiles[pos].resourceAmount += 1;
      }

      /* Move in a random direction of: right, down right, left, up left */
      let adjPos = pos;
      switch ((r >> 2) & 3) {
        case 0:
          adjPos = this.moveRight(adjPos);
          break;
        case 1:
          adjPos = this.moveDownRight(adjPos);
          break;
        case 2:
          adjPos = this.moveLeft(adjPos);
          break;
        case 3:
          adjPos = this.moveUpLeft(adjPos);
          break;
        default:
          NOT_REACHED();
          break;
      }

      if (this.isInWater(adjPos)) {
        /* Migrate a fish to adjacent water space. */
        this.landscapeTiles[pos].resourceAmount -= 1;
        this.landscapeTiles[adjPos].resourceAmount += 1;
      }
    }
  }

  /* Update map data as part of the game progression. */
  update(tick: number, rnd: Random): void {
    const delta = u16(tick - this.updateState.lastTick);
    this.updateState.lastTick = u16(tick);
    this.updateState.counter -= delta;

    let iters = 0;
    while (this.updateState.counter < 0) {
      iters += this.regions;
      this.updateState.counter += 20;
    }

    let pos = this.updateState.initialPos;

    for (let i = 0; i < iters; i++) {
      this.updateState.removeSignsCounter -= 1;
      if (this.updateState.removeSignsCounter < 0) {
        this.updateState.removeSignsCounter = 16;
      }

      /* Test if moving 23 positions right crosses map boundary. */
      if (this.posCol(pos) + 23 < (this.geom_.cols() | 0)) {
        pos = this.moveRightN(pos, 23);
      } else {
        pos = this.moveRightN(pos, 23);
        pos = this.moveDown(pos);
      }

      /* Update map at position. */
      this.updateHidden(pos, rnd);
      this.updatePublic(pos, rnd);
    }

    this.updateState.initialPos = pos;
  }

  getUpdateState(): MapUpdateState {
    return this.updateState;
  }
  setUpdateState(updateState_: MapUpdateState): void {
    // Struct copy in the C++.
    this.updateState.removeSignsCounter = updateState_.removeSignsCounter;
    this.updateState.lastTick = u16(updateState_.lastTick);
    this.updateState.counter = updateState_.counter;
    this.updateState.initialPos = updateState_.initialPos;
  }

  addChangeHandler(handler: MapHandler): void {
    this.changeHandlers.push(handler);
  }

  delChangeHandler(handler: MapHandler): void {
    // std::list::remove erases every matching element.
    this.changeHandlers = this.changeHandlers.filter((h) => h !== handler);
  }

  static getSpiralPattern(): number[] {
    return spiralPattern;
  }

  /* Return non-zero if the road segment from pos in direction dir
   can be successfully constructed at the current time. */
  isRoadSegmentValid(pos: MapPos, dir: Direction, join: boolean = false): boolean {
    const otherPos = this.move(pos, dir);

    /* With join, the segment may end on an existing road (see
       Game::can_join_road()). */
    const obj = this.getObj(otherPos);
    if (
      (this.paths(otherPos) !== 0 && obj !== MapObject.ObjectFlag && !join) ||
      Map.mapSpaceFromObj[obj] >= MapSpace.SpaceSemipassable
    ) {
      return false;
    }

    if (!this.hasOwner(otherPos) || this.getOwner(otherPos) !== this.getOwner(pos)) {
      return false;
    }

    if (
      this.isInWater(pos) !== this.isInWater(otherPos) &&
      !(this.hasFlag(pos) || this.hasFlag(otherPos))
    ) {
      return false;
    }

    return true;
  }

  /* Actually place road segments */
  placeRoadSegments(road: Road): boolean {
    let pos_ = road.getSource();
    const dirs = road.getDirs();
    let it = 0;
    for (; it !== dirs.length; ++it) {
      const revDir = reverseDirection(dirs[it]);

      if (!this.isRoadSegmentValid(pos_, dirs[it])) {
        /* Not valid after all. Backtrack and abort.
         This is needed to check that the road
         does not cross itself. */
        for (; it !== 0; ) {
          --it;
          const revDir = dirs[it];
          const dir = reverseDirection(revDir);

          this.gameTiles[pos_].paths = u8(this.gameTiles[pos_].paths & ~BIT(dir));
          this.gameTiles[this.move(pos_, dir)].paths = u8(
            this.gameTiles[this.move(pos_, dir)].paths & ~BIT(revDir),
          );

          pos_ = this.move(pos_, dir);
        }

        return false;
      }

      this.gameTiles[pos_].paths = u8(this.gameTiles[pos_].paths | BIT(dirs[it]));
      this.gameTiles[this.move(pos_, dirs[it])].paths = u8(
        this.gameTiles[this.move(pos_, dirs[it])].paths | BIT(revDir),
      );

      pos_ = this.move(pos_, dirs[it]);
    }

    return true;
  }

  removeRoadBackrefUntilFlag(pos_: MapPos, dir: Direction): boolean {
    while (1) {
      pos_ = this.move(pos_, dir);

      /* Clear backreference */
      this.gameTiles[pos_].paths = u8(this.gameTiles[pos_].paths & ~BIT(reverseDirection(dir)));

      if (this.getObj(pos_) === MapObject.ObjectFlag) break;

      /* Find next direction of path. */
      dir = Direction.DirectionNone;
      for (const d of cycleDirectionsCw()) {
        if (this.hasPath(pos_, d)) {
          dir = d;
          break;
        }
      }

      if (dir === Direction.DirectionNone) return false;
    }

    return true;
  }

  removeRoadBackrefs(pos_: MapPos): boolean {
    if (this.paths(pos_) === 0) return false;

    /* Find directions of path segments to be split. */
    let path1Dir: Direction = Direction.DirectionNone;
    const cycle = cycleDirectionsCw();
    const it = cycle.begin();
    for (; !it.equals(cycle.end()); it.inc()) {
      if (this.hasPath(pos_, it.deref())) {
        path1Dir = it.deref();
        break;
      }
    }

    let path2Dir: Direction = Direction.DirectionNone;
    it.inc();
    for (; !it.equals(cycle.end()); it.inc()) {
      if (this.hasPath(pos_, it.deref())) {
        path2Dir = it.deref();
        break;
      }
    }

    if (path1Dir === Direction.DirectionNone || path2Dir === Direction.DirectionNone) return false;

    if (!this.removeRoadBackrefUntilFlag(pos_, path1Dir)) return false;
    if (!this.removeRoadBackrefUntilFlag(pos_, path2Dir)) return false;

    return true;
  }

  // PORT: `MapPos *pos` is an in/out parameter in the C++. Pass a MapPosRef
  // (`{ pos }`); the new position is written back to `pos.pos`.
  removeRoadSegment(pos: MapPosRef, dir: Direction): Direction {
    /* Clear forward reference. */
    this.gameTiles[pos.pos].paths = u8(this.gameTiles[pos.pos].paths & ~BIT(dir));
    pos.pos = this.move(pos.pos, dir);

    /* Clear backreference. */
    this.gameTiles[pos.pos].paths = u8(
      this.gameTiles[pos.pos].paths & ~BIT(reverseDirection(dir)),
    );

    /* Find next direction of path. */
    dir = Direction.DirectionNone;
    for (const d of cycleDirectionsCw()) {
      if (this.hasPath(pos.pos, d)) {
        dir = d;
        break;
      }
    }

    return dir;
  }

  roadSegmentInWater(pos_: MapPos, dir: Direction): boolean {
    if (dir > Direction.DirectionDown) {
      pos_ = this.move(pos_, dir);
      dir = reverseDirection(dir);
    }

    let water = false;

    switch (dir) {
      case Direction.DirectionRight:
        if (
          this.typeDown(pos_) <= MapTerrain.TerrainWater3 &&
          this.typeUp(this.moveUp(pos_)) <= MapTerrain.TerrainWater3
        ) {
          water = true;
        }
        break;
      case Direction.DirectionDownRight:
        if (
          this.typeUp(pos_) <= MapTerrain.TerrainWater3 &&
          this.typeDown(pos_) <= MapTerrain.TerrainWater3
        ) {
          water = true;
        }
        break;
      case Direction.DirectionDown:
        if (
          this.typeUp(pos_) <= MapTerrain.TerrainWater3 &&
          this.typeDown(this.moveLeft(pos_)) <= MapTerrain.TerrainWater3
        ) {
          water = true;
        }
        break;
      default:
        NOT_REACHED();
        break;
    }

    return water;
  }

  // operator==
  equals(rhs: Map): boolean {
    // Check fundamental properties
    if (
      !this.geom_.equals(rhs.geom_) ||
      this.regions !== rhs.regions ||
      !updateStateEquals(this.updateState, rhs.updateState)
    ) {
      return false;
    }

    // Check all tiles
    for (const pos_ of this.geom_) {
      if (!landscapeTileEquals(this.landscapeTiles[pos_], rhs.landscapeTiles[pos_])) {
        return false;
      }
      if (!gameTileEquals(this.gameTiles[pos_], rhs.gameTiles[pos_])) {
        return false;
      }
    }

    return true;
  }

  // PORT: operator >> (SaveReaderBinary &reader, Map &map) is not ported.

  // operator >> (SaveReaderText &reader, Map &map)
  loadText(reader: SaveReaderText): void {
    let x = 0;
    let y = 0;
    x = reader.value('pos').at(0).readInt();
    y = reader.value('pos').at(1).readInt();
    const pos = this.pos(x, y);

    for (let y = 0; y < SAVE_MAP_TILE_SIZE; y++) {
      for (let x = 0; x < SAVE_MAP_TILE_SIZE; x++) {
        const p = this.posAdd(pos, this.pos(x, y));
        const gameTile = this.gameTiles[p];
        const landscapeTile = this.landscapeTiles[p];
        let val: number;

        val = reader.value('paths').at(y * SAVE_MAP_TILE_SIZE + x).readUint();
        gameTile.paths = val & 0x3f;

        val = reader.value('height').at(y * SAVE_MAP_TILE_SIZE + x).readUint();
        landscapeTile.height = val & 0x1f;

        val = reader.value('type.up').at(y * SAVE_MAP_TILE_SIZE + x).readUint();
        landscapeTile.typeUp = val as MapTerrain;

        val = reader.value('type.down').at(y * SAVE_MAP_TILE_SIZE + x).readUint();
        landscapeTile.typeDown = val as MapTerrain;

        try {
          val = reader.value('idle_serf').at(y * SAVE_MAP_TILE_SIZE + x).readUint();
          gameTile.idleSerf = (val !== 0);
          val = reader.value('object').at(y * SAVE_MAP_TILE_SIZE + x).readUint();
          landscapeTile.obj = val as MapObject;
        } catch (e) {
          val = reader.value('object').at(y * SAVE_MAP_TILE_SIZE + x).readUint();
          landscapeTile.obj = (val & 0x7f) as MapObject;
          gameTile.idleSerf = (BIT_TEST(val, 7) !== 0);
        }

        val = reader.value('serf').at(y * SAVE_MAP_TILE_SIZE + x).readUint();
        gameTile.serf = val;

        val = reader.value('resource.type').at(y * SAVE_MAP_TILE_SIZE + x).readUint();
        landscapeTile.mineral = val as MapMinerals;

        val = reader.value('resource.amount').at(y * SAVE_MAP_TILE_SIZE + x).readUint();
        landscapeTile.resourceAmount = i32(val);
      }
    }
  }

  // operator << (SaveWriterText &writer, Map &map)
  saveText(writer: SaveWriterText): void {
    let i = 0;

    for (let ty = 0; ty < this.getRows(); ty += SAVE_MAP_TILE_SIZE) {
      for (let tx = 0; tx < this.getCols(); tx += SAVE_MAP_TILE_SIZE) {
        const mapWriter = writer.addSection('map', i++);

        mapWriter.value('pos').write(tx);
        mapWriter.value('pos').write(ty);

        for (let y = 0; y < SAVE_MAP_TILE_SIZE; y++) {
          for (let x = 0; x < SAVE_MAP_TILE_SIZE; x++) {
            const pos = this.pos(tx + x, ty + y);

            mapWriter.value('height').write(this.getHeight(pos));
            mapWriter.value('type.up').write(this.typeUp(pos));
            mapWriter.value('type.down').write(this.typeDown(pos));
            mapWriter.value('paths').write(this.paths(pos));
            mapWriter.value('object').write(this.getObj(pos));
            mapWriter.value('serf').write(this.getSerfIndex(pos));
            mapWriter.value('idle_serf').write(this.getIdleSerf(pos));

            if (this.isInWater(pos)) {
              mapWriter.value('resource.type').write(0);
              mapWriter.value('resource.amount').write(this.getResFish(pos));
            } else {
              mapWriter.value('resource.type').write(this.getResType(pos));
              mapWriter.value('resource.amount').write(this.getResAmount(pos));
            }
          }
        }
      }
    }
  }

  posFromSavedValue(val: number): MapPos {
    val = u32(val) >>> 2;
    const x = val & this.getColMask();
    val = val >>> (this.getRowShift() + 1);
    const y = val & this.getRowMask();
    return this.pos(x, y);
  }
}

// PORT: lets `Map.Object`, `Map.Terrain` etc. be used as type names too,
// matching the C++ spelling `Map::Object`.
// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace Map {
  export type Object = MapObject;
  export type Minerals = MapMinerals;
  export type Space = MapSpace;
  export type Terrain = MapTerrain;
  export type Handler = MapHandler;
  export type LandscapeTile = MapLandscapeTile;
  export type UpdateState = MapUpdateState;
}

// typedef std::shared_ptr<Map> PMap;
export type PMap = Map;
