/*
 * pathfinder.ts - Path finder functions
 *
 * Port of Freeserf's pathfinder.h and pathfinder.cc.
 *
 * Copyright (C) 2013-2014  Jon Lund Steffensen <jonlst@gmail.com>
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

import { Direction, cycleDirectionsCw, reverseDirection } from './map-geometry';
import type { MapPos } from './map-geometry';
import { Map, MapObject, Road } from './map';
import { idiv } from './misc';

type PSearchNode = SearchNode;

class SearchNode {
  parent: PSearchNode | null = null;
  gScore: number;
  fScore: number;
  pos: MapPos;
  dir: Direction;

  constructor() {
    this.gScore = 0;
    this.fScore = 0;
    this.pos = 0;
    this.dir = Direction.DirectionNone;
  }
}

function searchNodeLess(left: PSearchNode, right: PSearchNode): boolean {
  // A search node is considered less than the other if
  // it has a larger f-score. This means that in the max-heap
  // the lower score will go to the top.
  return left.fScore > right.fScore;
}

// PORT: std::push_heap, std::pop_heap and std::make_heap are reimplemented
// below following the libstdc++ algorithms, so that nodes with equal f-score
// come out in the same order as in a GCC build of the original. (The C++
// standard does not fix that order, so other standard libraries may differ.)
type Comp<T> = (left: T, right: T) => boolean;

function pushHeapImpl<T>(
  first: T[],
  holeIndex: number,
  topIndex: number,
  value: T,
  comp: Comp<T>,
): void {
  let parent = idiv(holeIndex - 1, 2);
  while (holeIndex > topIndex && comp(first[parent], value)) {
    first[holeIndex] = first[parent];
    holeIndex = parent;
    parent = idiv(holeIndex - 1, 2);
  }
  first[holeIndex] = value;
}

function adjustHeap<T>(first: T[], holeIndex: number, len: number, value: T, comp: Comp<T>): void {
  const topIndex = holeIndex;
  let secondChild = holeIndex;
  while (secondChild < idiv(len - 1, 2)) {
    secondChild = 2 * (secondChild + 1);
    if (comp(first[secondChild], first[secondChild - 1])) {
      secondChild--;
    }
    first[holeIndex] = first[secondChild];
    holeIndex = secondChild;
  }
  if ((len & 1) === 0 && secondChild === idiv(len - 2, 2)) {
    secondChild = 2 * (secondChild + 1);
    first[holeIndex] = first[secondChild - 1];
    holeIndex = secondChild - 1;
  }
  pushHeapImpl(first, holeIndex, topIndex, value, comp);
}

// std::push_heap(v.begin(), v.end(), comp)
function pushHeap<T>(v: T[], comp: Comp<T>): void {
  const value = v[v.length - 1];
  pushHeapImpl(v, v.length - 1, 0, value, comp);
}

// std::pop_heap(v.begin(), v.end(), comp)
function popHeap<T>(v: T[], comp: Comp<T>): void {
  if (v.length > 1) {
    const last = v.length - 1;
    const value = v[last];
    v[last] = v[0];
    adjustHeap(v, 0, last, value, comp);
  }
}

// std::make_heap(v.begin(), v.end(), comp)
function makeHeap<T>(v: T[], comp: Comp<T>): void {
  if (v.length < 2) {
    return;
  }

  const len = v.length;
  let parent = idiv(len - 2, 2);
  while (true) {
    const value = v[parent];
    adjustHeap(v, parent, len, value, comp);
    if (parent === 0) {
      return;
    }
    parent--;
  }
}

const walkCost: number[] = [255, 319, 383, 447, 511];

// PORT: the C++ indexes walk_cost[] with a height difference that is not
// bounded to the table size (an out-of-bounds read, undefined behaviour, when
// the difference is above 4). Here such an index reads the last entry.
function walkCostAt(index: number): number {
  return walkCost[index < walkCost.length ? index : walkCost.length - 1];
}

function heuristicCost(map: Map, start: MapPos, end: MapPos): number {
  /* Calculate distance to target. */
  const distCol = map.distX(start, end);
  const distRow = map.distY(start, end);

  const hDiff = Math.abs((map.getHeight(start) | 0) - (map.getHeight(end) | 0));
  let dist = 0;

  if ((distCol > 0 && distRow > 0) || (distCol < 0 && distRow < 0)) {
    dist = Math.max(Math.abs(distCol), Math.abs(distRow));
  } else {
    dist = Math.abs(distCol) + Math.abs(distRow);
  }

  return dist > 0 ? dist * walkCostAt(idiv(hDiff, dist)) : 0;
}

function actualCost(map: Map, pos: MapPos, dir: Direction): number {
  const otherPos = map.move(pos, dir);
  const hDiff = Math.abs((map.getHeight(pos) | 0) - (map.getHeight(otherPos) | 0));
  return walkCostAt(hDiff);
}

/* Find the shortest path from start to end (using A*) considering that
   the walking time for a serf walking in any direction of the path
   should be minimized. Returns a malloc'ed array of directions and
   the size of this array in length. */
export function pathfinderMap(
  map: Map,
  start: MapPos,
  end: MapPos,
  buildingRoad: Road | null = null,
): Road {
  // Unfortunately the STL priority_queue cannot be used since we
  // would need access to the underlying sequence to determine if
  // a node is already in the open list. We keep instead open as
  // a vector and apply std::pop_heap and std::push_heap to keep
  // it heapified.
  const open: PSearchNode[] = [];
  const closed: PSearchNode[] = [];

  /* Create start node */
  let node: PSearchNode = new SearchNode();
  node.pos = end;
  node.gScore = 0;
  node.fScore = heuristicCost(map, start, end);

  open.push(node);

  while (open.length !== 0) {
    popHeap(open, searchNodeLess);
    node = open[open.length - 1];
    open.pop();

    if (node.pos === start) {
      /* Construct solution */
      const solution = new Road();
      solution.start(start);

      while (node.parent) {
        const dir = node.dir;
        solution.extend(reverseDirection(dir));
        node = node.parent;
      }

      return solution;
    }

    /* Put current node on closed list. */
    closed.unshift(node);

    for (const d of cycleDirectionsCw()) {
      const newPos = map.move(node.pos, d);
      const cost = actualCost(map, node.pos, d);

      /* Check if neighbour is valid. */
      if (
        !map.isRoadSegmentValid(node.pos, d) ||
        (map.getObj(newPos) === MapObject.ObjectFlag && newPos !== start)
      ) {
        continue;
      }

      if (
        buildingRoad !== null &&
        buildingRoad.hasPos(map, newPos) &&
        newPos !== end &&
        newPos !== start
      ) {
        continue;
      }

      /* Check if neighbour is in closed list. */
      let inClosed = false;
      for (const closedNode of closed) {
        if (closedNode.pos === newPos) {
          inClosed = true;
          break;
        }
      }

      if (inClosed) continue;

      /* See if neighbour is already in open list. */
      let inOpen = false;
      for (let it = 0; it !== open.length; ++it) {
        const n = open[it];
        if (n.pos === newPos) {
          inOpen = true;
          if (n.gScore >= node.gScore + cost) {
            n.gScore = node.gScore + cost;
            n.fScore = n.gScore + heuristicCost(map, newPos, start);
            n.parent = node;
            n.dir = d;

            // Move element to the back and heapify
            const back = open.length - 1;
            const tmp = open[it];
            open[it] = open[back];
            open[back] = tmp;
            makeHeap(open, searchNodeLess);
          }
          break;
        }
      }

      /* If not found in the open set, create a new node. */
      if (!inOpen) {
        const newNode: PSearchNode = new SearchNode();

        newNode.pos = newPos;
        newNode.gScore = node.gScore + cost;
        newNode.fScore = newNode.gScore + heuristicCost(map, newPos, start);
        newNode.parent = node;
        newNode.dir = d;

        open.push(newNode);
        pushHeap(open, searchNodeLess);
      }
    }
  }

  return new Road();
}
