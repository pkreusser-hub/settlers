//
// map-geometry.ts - Map geometry functions
//
// Port of Freeserf's map-geometry.h.
//
// Copyright (C) 2013-2016  Jon Lund Steffensen <jonlst@gmail.com>
//
// This file is part of freeserf.
//
// freeserf is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// freeserf is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with freeserf.  If not, see <http://www.gnu.org/licenses/>.

import { ExceptionFreeserf, idiv } from './misc';

// Map directions
//
//    A ______ B
//     /\    /
//    /  \  /
// C /____\/ D
//
// Six standard directions:
// RIGHT: A to B
// DOWN_RIGHT: A to D
// DOWN: A to C
// LEFT: D to C
// UP_LEFT: D to A
// UP: D to B
//
// Non-standard directions:
// UP_RIGHT: C to B
// DOWN_LEFT: B to C
export enum Direction {
  DirectionNone = -1,

  DirectionRight = 0,
  DirectionDownRight,
  DirectionDown,
  DirectionLeft,
  DirectionUpLeft,
  DirectionUp,
}

// PORT: the C++ enumerators are unscoped (`DirectionRight`), so they are also
// exported as plain constants next to the `Direction.DirectionRight` spelling.
export const DirectionNone = Direction.DirectionNone;
export const DirectionRight = Direction.DirectionRight;
export const DirectionDownRight = Direction.DirectionDownRight;
export const DirectionDown = Direction.DirectionDown;
export const DirectionLeft = Direction.DirectionLeft;
export const DirectionUpLeft = Direction.DirectionUpLeft;
export const DirectionUp = Direction.DirectionUp;

// Return the given direction turned clockwise a number of times.
//
// Return the resulting direction from turning the given direction
// clockwise in 60 degree increment the specified number of times.
// If times is a negative number the direction will be turned counter
// clockwise.
export function turnDirection(d: Direction, times: number): Direction {
  if (d === Direction.DirectionNone) {
    return Direction.DirectionNone;
  }
  let td = ((d as number) + times) % 6;
  if (td < 0) td += 6;
  return td as Direction;
}

// Return the given direction reversed.
export function reverseDirection(d: Direction): Direction {
  return turnDirection(d, 3);
}

// Cycle direction (clockwise or counter-clockwise)
export enum Cycle {
  CW,
  CCW,
}

// PORT: DirectionCycle<C>::Iterator. operator++ is inc(), operator* is
// deref(), operator== is equals(), the copy constructor is clone().
export class DirectionCycleIterator {
  cycle: DirectionCycle;
  offset: number;

  constructor(cycle: DirectionCycle, offset: number) {
    this.cycle = cycle;
    this.offset = offset;
  }

  clone(): DirectionCycleIterator {
    return new DirectionCycleIterator(this.cycle, this.offset);
  }

  assign(that: DirectionCycleIterator): this {
    this.cycle = that.cycle;
    this.offset = that.offset;
    return this;
  }

  inc(): this {
    if (this.offset < this.cycle.getLength()) ++this.offset;
    return this;
  }

  equals(rhs: DirectionCycleIterator): boolean {
    return this.cycle.equals(rhs.cycle) && this.offset === rhs.offset;
  }

  deref(): Direction {
    if (this.cycle.getCycle() === Cycle.CW) {
      // Specialize for clockwise cycle
      return ((this.cycle.getStart() + this.offset) % 6) as Direction;
    } else {
      // Specialize for counter-clockwise cycle
      return ((((this.cycle.getStart() - this.offset) % 6) + 6) % 6) as Direction;
    }
  }
}

// Provides iterator for cycling through directions.
// PORT: the template parameter `Cycle C` is the first constructor argument.
// `for (Direction d : cycle)` becomes `for (const d of cycle)`.
export class DirectionCycle implements Iterable<Direction> {
  protected cycle: Cycle;
  protected start: Direction;
  protected length: number;

  constructor(cycle: Cycle, start: Direction, length: number) {
    this.cycle = cycle;
    this.start = start;
    this.length = length >>> 0;
    if (start === Direction.DirectionNone) {
      throw new ExceptionFreeserf('Failed to init DirectionCycle with ' + 'uninitialised direction');
    }
  }

  clone(): DirectionCycle {
    return new DirectionCycle(this.cycle, this.start, this.length);
  }

  assign(that: DirectionCycle): this {
    this.start = that.start;
    this.length = that.length;
    return this;
  }

  // PORT: accessors for the iterator (a friend class in the C++).
  getCycle(): Cycle {
    return this.cycle;
  }

  getStart(): Direction {
    return this.start;
  }

  getLength(): number {
    return this.length;
  }

  begin(): DirectionCycleIterator {
    return new DirectionCycleIterator(this, 0);
  }

  end(): DirectionCycleIterator {
    return new DirectionCycleIterator(this, this.length);
  }

  equals(rhs: DirectionCycle): boolean {
    return this.start === rhs.start && this.length === rhs.length;
  }

  *[Symbol.iterator](): Iterator<Direction> {
    const end = this.end();
    for (const it = this.begin(); !it.equals(end); it.inc()) {
      yield it.deref();
    }
  }
}

// Convenience function to create clockwise direction cycle.
export function cycleDirectionsCw(
  start: Direction = Direction.DirectionRight,
  length: number = 6,
): DirectionCycle {
  return new DirectionCycle(Cycle.CW, start, length);
}

// Convenience function to create counter-clockwise direction cycle.
export function cycleDirectionsCcw(
  start: Direction = Direction.DirectionUp,
  length: number = 6,
): DirectionCycle {
  return new DirectionCycle(Cycle.CCW, start, length);
}

// MapPos is a compact composition of col and row values that
// uniquely identifies a vertex in the map space. It is also used
// directly as index to map data arrays.
export type MapPos = number;
export const badMapPos: MapPos = 0xffffffff;

// PORT: MapGeometry::Iterator. operator++ is inc(), operator* is deref(),
// operator== is equals(), the copy constructor is clone().
export class MapGeometryIterator {
  geom: MapGeometry;
  pos: MapPos;

  constructor(geom: MapGeometry, pos: MapPos) {
    this.geom = geom;
    this.pos = pos;
  }

  clone(): MapGeometryIterator {
    return new MapGeometryIterator(this.geom, this.pos);
  }

  assign(that: MapGeometryIterator): this {
    this.geom = that.geom;
    this.pos = that.pos;
    return this;
  }

  inc(): this {
    if (this.pos < this.geom.tileCount()) {
      this.pos++;
    }
    return this;
  }

  // operator++(int)
  postInc(): MapGeometryIterator {
    const tmp = this.clone();
    this.inc();
    return tmp;
  }

  equals(rhs: MapGeometryIterator): boolean {
    return this.geom === rhs.geom && this.pos === rhs.pos;
  }

  deref(): MapPos {
    return this.pos;
  }
}

// PORT: `for (MapPos pos : geom)` becomes `for (const pos of geom)`.
export class MapGeometry implements Iterable<MapPos> {
  protected size_: number;

  // Derived members
  protected dirs: MapPos[] = [6, 0, 0, 0, 0, 0];
  protected colSize_ = 0;
  protected rowSize_ = 0;

  protected cols_ = 0;
  protected rows_ = 0;
  protected colMask_ = 0;
  protected rowMask_ = 0;
  protected rowShift_ = 0;

  // MapGeometry(unsigned int size) and MapGeometry(const MapGeometry& that)
  constructor(size: number | MapGeometry) {
    this.size_ = typeof size === 'number' ? size >>> 0 : size.size_;
    this.init();
  }

  clone(): MapGeometry {
    return new MapGeometry(this);
  }

  assign(that: MapGeometry): this {
    this.size_ = that.size_;
    this.init();
    return this;
  }

  size(): number {
    return this.size_;
  }
  cols(): number {
    return this.cols_;
  }
  rows(): number {
    return this.rows_;
  }
  colMask(): number {
    return this.colMask_;
  }
  rowMask(): number {
    return this.rowMask_;
  }
  rowShift(): number {
    return this.rowShift_;
  }
  tileCount(): number {
    return this.cols_ * this.rows_;
  }

  /* Extract col and row from MapPos */
  posCol(pos: number): number {
    return pos & this.colMask_;
  }
  posRow(pos: number): number {
    return (pos >> this.rowShift_) & this.rowMask_;
  }

  /* Translate col, row coordinate to MapPos value. */
  pos(x: number, y: number): MapPos {
    return ((y << this.rowShift_) | x) >>> 0;
  }

  /* Addition of two map positions. */
  // pos_add(MapPos pos_, int x, int y) and pos_add(MapPos pos_, MapPos off)
  posAdd(pos_: MapPos, x: number, y?: number): MapPos {
    if (y === undefined) {
      const off = x;
      return this.pos(
        (this.posCol(pos_) + this.posCol(off)) & this.colMask_,
        (this.posRow(pos_) + this.posRow(off)) & this.rowMask_,
      );
    }
    return this.pos(
      (this.posCol(pos_) + x) & this.colMask_,
      (this.posRow(pos_) + y) & this.rowMask_,
    );
  }

  // Shortest signed distance between map positions.
  distX(pos1: MapPos, pos2: MapPos): number {
    return (
      idiv(this.cols_, 2) -
      ((idiv(this.cols_, 2) + this.posCol(pos1) - this.posCol(pos2)) & this.colMask_)
    );
  }
  distY(pos1: MapPos, pos2: MapPos): number {
    return (
      idiv(this.rows_, 2) -
      ((idiv(this.rows_, 2) + this.posRow(pos1) - this.posRow(pos2)) & this.rowMask_)
    );
  }

  /* Movement of map position according to directions. */
  move(pos: MapPos, dir: Direction): MapPos {
    return this.posAdd(pos, this.dirs[dir]);
  }

  moveRight(pos: MapPos): MapPos {
    return this.move(pos, Direction.DirectionRight);
  }
  moveDownRight(pos: MapPos): MapPos {
    return this.move(pos, Direction.DirectionDownRight);
  }
  moveDown(pos: MapPos): MapPos {
    return this.move(pos, Direction.DirectionDown);
  }
  moveLeft(pos: MapPos): MapPos {
    return this.move(pos, Direction.DirectionLeft);
  }
  moveUpLeft(pos: MapPos): MapPos {
    return this.move(pos, Direction.DirectionUpLeft);
  }
  moveUp(pos: MapPos): MapPos {
    return this.move(pos, Direction.DirectionUp);
  }

  moveRightN(pos: MapPos, n: number): MapPos {
    return this.posAdd(pos, Math.imul(this.dirs[Direction.DirectionRight], n) >>> 0);
  }
  moveDownN(pos: MapPos, n: number): MapPos {
    return this.posAdd(pos, Math.imul(this.dirs[Direction.DirectionDown], n) >>> 0);
  }

  begin(): MapGeometryIterator {
    return new MapGeometryIterator(this, 0);
  }
  end(): MapGeometryIterator {
    return new MapGeometryIterator(this, this.tileCount());
  }

  *[Symbol.iterator](): Iterator<MapPos> {
    const end = this.end();
    for (const it = this.begin(); !it.equals(end); it.inc()) {
      yield it.deref();
    }
  }

  equals(rhs: MapGeometry): boolean {
    return this.size_ === rhs.size_;
  }

  protected init(): void {
    if (this.size_ > 20) {
      throw new ExceptionFreeserf(
        'Above size 20 the map positions can no longer ' + 'fit in a 32-bit integer.',
      );
    }

    this.colSize_ = 5 + idiv(this.size_, 2);
    // PORT: size_ is unsigned, so (size_ - 1) wraps for size 0.
    this.rowSize_ = (5 + idiv((this.size_ - 1) >>> 0, 2)) >>> 0;
    this.cols_ = (1 << this.colSize_) >>> 0;
    this.rows_ = (1 << this.rowSize_) >>> 0;

    this.colMask_ = (this.cols_ - 1) >>> 0;
    this.rowMask_ = (this.rows_ - 1) >>> 0;
    this.rowShift_ = this.colSize_;

    // Setup direction offsets
    this.dirs[Direction.DirectionRight] = (1 & this.colMask_) >>> 0;
    this.dirs[Direction.DirectionLeft] = (-1 & this.colMask_) >>> 0;
    this.dirs[Direction.DirectionDown] = ((1 & this.rowMask_) << this.rowShift_) >>> 0;
    this.dirs[Direction.DirectionUp] = ((-1 & this.rowMask_) << this.rowShift_) >>> 0;

    this.dirs[Direction.DirectionDownRight] =
      (this.dirs[Direction.DirectionRight] | this.dirs[Direction.DirectionDown]) >>> 0;
    this.dirs[Direction.DirectionUpLeft] =
      (this.dirs[Direction.DirectionLeft] | this.dirs[Direction.DirectionUp]) >>> 0;
  }
}
