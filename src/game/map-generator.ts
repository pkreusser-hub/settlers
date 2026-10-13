/*
 * map-generator.ts - Map generator
 *
 * Port of Freeserf's map-generator.h and map-generator.cc.
 *
 * Copyright (C) 2013-2016  Jon Lund Steffensen <jonlst@gmail.com>
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

import { Map, MapMinerals, MapObject, MapSpace, MapTerrain } from './map';
import type { MapLandscapeTile } from './map';
import { Direction, cycleDirectionsCw } from './map-geometry';
import type { MapPos } from './map-geometry';
import { BIT_TEST, NOT_REACHED, idiv, u32 } from './misc';
import { Random } from './random';

export enum MapGeneratorHeightGenerator {
  HeightGeneratorMidpoints = 0,
  HeightGeneratorDiamondSquare,
}

/* Interface for map generators. */
export abstract class MapGenerator {
  static HeightGenerator = MapGeneratorHeightGenerator;

  abstract generate(): void;

  abstract getHeight(pos: MapPos): number;
  abstract getTypeUp(pos: MapPos): MapTerrain;
  abstract getTypeDown(pos: MapPos): MapTerrain;
  abstract getObj(pos: MapPos): MapObject;
  abstract getResourceType(pos: MapPos): MapMinerals;
  abstract getResourceAmount(pos: MapPos): number;
  abstract getLandscape(): MapLandscapeTile[];
}

function calcMapType(hSum: number): MapTerrain {
  if (hSum < 3) return MapTerrain.TerrainWater0;
  else if (hSum < 384) return MapTerrain.TerrainGrass1;
  else if (hSum < 416) return MapTerrain.TerrainGrass2;
  else if (hSum < 448) return MapTerrain.TerrainTundra0;
  else if (hSum < 480) return MapTerrain.TerrainTundra1;
  else if (hSum < 528) return MapTerrain.TerrainTundra2;
  else if (hSum < 560) return MapTerrain.TerrainSnow0;
  return MapTerrain.TerrainSnow1;
}

/* Classic map generator as in original game. */
export class ClassicMapGenerator extends MapGenerator {
  static readonly defaultMaxLakeArea: number = 14;
  static readonly defaultWaterLevel: number = 20;
  static readonly defaultTerrainSpikyness: number = 0x9999;

  protected map: Map;
  protected rnd: Random;

  protected tiles: MapLandscapeTile[];
  protected tags: number[];
  protected heightGenerator: MapGeneratorHeightGenerator;
  protected preserveBugs: boolean;

  protected waterLevel: number; // unsigned int
  protected maxLakeArea: number; // unsigned int
  protected terrainSpikyness: number;

  constructor(map: Map, random: Random) {
    super();
    this.map = map;
    this.rnd = new Random(random);
    this.heightGenerator = MapGeneratorHeightGenerator.HeightGeneratorMidpoints;
    this.preserveBugs = false;
    this.waterLevel = ClassicMapGenerator.defaultWaterLevel;
    this.maxLakeArea = ClassicMapGenerator.defaultMaxLakeArea;
    this.terrainSpikyness = ClassicMapGenerator.defaultTerrainSpikyness;
    const tileCount = map.geom().tileCount();
    this.tiles = [];
    this.tags = [];
    for (let i = 0; i < tileCount; i++) {
      this.tiles.push({
        height: 0,
        typeUp: 0,
        typeDown: 0,
        mineral: 0,
        resourceAmount: 0,
        obj: 0,
      });
      this.tags.push(0);
    }
  }

  init(
    heightGenerator: MapGeneratorHeightGenerator,
    preserveBugs: boolean,
    maxLakeArea: number = ClassicMapGenerator.defaultMaxLakeArea,
    waterLevel: number = ClassicMapGenerator.defaultWaterLevel,
    terrainSpikyness: number = ClassicMapGenerator.defaultTerrainSpikyness,
  ): void {
    this.heightGenerator = heightGenerator;
    this.preserveBugs = preserveBugs;
    this.maxLakeArea = u32(maxLakeArea);
    this.waterLevel = u32(waterLevel);
    this.terrainSpikyness = terrainSpikyness;
  }

  getHeight(pos: MapPos): number {
    return this.tiles[pos].height;
  }
  getTypeUp(pos: MapPos): MapTerrain {
    return this.tiles[pos].typeUp;
  }
  getTypeDown(pos: MapPos): MapTerrain {
    return this.tiles[pos].typeDown;
  }
  getObj(pos: MapPos): MapObject {
    return this.tiles[pos].obj;
  }
  getResourceType(pos: MapPos): MapMinerals {
    return this.tiles[pos].mineral;
  }
  getResourceAmount(pos: MapPos): number {
    return this.tiles[pos].resourceAmount;
  }
  getLandscape(): MapLandscapeTile[] {
    return this.tiles;
  }

  // PORT: `for (MapPos pos : map.geom())` iterates 0 .. tile_count()-1 in
  // order. It is written as a counted loop over this value everywhere below.
  protected tileCount(): number {
    return this.map.geom().tileCount();
  }

  /* Whether any of the two up/down tiles at this pos are water. */
  protected isWaterTile(pos: MapPos): boolean {
    return (
      this.tiles[pos].typeDown <= MapTerrain.TerrainWater3 &&
      this.tiles[pos].typeUp <= MapTerrain.TerrainWater3
    );
  }

  /* Whether the position is completely surrounded by water. */
  protected isInWater(pos: MapPos): boolean {
    const map = this.map;
    return (
      this.isWaterTile(pos) &&
      this.isWaterTile(map.moveUpLeft(pos)) &&
      this.tiles[map.moveLeft(pos)].typeDown <= MapTerrain.TerrainWater3 &&
      this.tiles[map.moveUp(pos)].typeUp <= MapTerrain.TerrainWater3
    );
  }

  generate(): void {
    this.rnd.xor(new Random(0x5a5a, 0xa5a5, 0xc3c3));

    this.randomInt();
    this.randomInt();

    this.initHeightsSquares();
    switch (this.heightGenerator) {
      case MapGeneratorHeightGenerator.HeightGeneratorMidpoints:
        this.initHeightsMidpoints(); /* Midpoint displacement algorithm */
        break;
      case MapGeneratorHeightGenerator.HeightGeneratorDiamondSquare:
        this.initHeightsDiamondSquare(); /* Diamond square algorithm */
        break;
      default:
        NOT_REACHED();
    }

    this.clampHeights();
    this.createWaterBodies();
    this.heightsRebase();
    this.initTypes();
    this.removeIslands();
    this.heightsRescale();

    // Adjust terrain types on shores
    this.changeShoreWaterType();
    this.changeShoreGrassType();

    // Create deserts
    this.createDeserts();

    // Create map objects (trees, boulders, etc.)
    this.createObjects();

    this.createMineralDeposits();

    this.cleanUp();
  }

  protected randomInt(): number {
    return this.rnd.random();
  }

  /* Midpoint displacement map generator. This function initialises the height
     values in the corners of 16x16 squares. */
  protected initHeightsSquares(): void {
    const map = this.map;
    const tiles = this.tiles;
    for (let y = 0; y < map.getRows(); y += 16) {
      for (let x = 0; x < map.getCols(); x += 16) {
        const rndl = this.randomInt() & 0xff;
        tiles[map.pos(x, y)].height = Math.min(rndl, 250);
      }
    }
  }

  protected calcHeightDisplacement(avg: number, base: number, offset: number): number {
    const r = this.randomInt();
    const h = ((r * base) >> 16) - offset + avg;

    return Math.max(0, Math.min(h, 250));
  }

  /* Calculate height values of the subdivisions in the
     midpoint displacement algorithm. */
  protected initHeightsMidpoints(): void {
    /* This is the central part of the midpoint displacement algorithm.
       The initial 16x16 squares are subdivided into 8x8 then 4x4 and so on,
       until all positions in the map have a height value.

       The random offset applied to the midpoints is based on r1 and r2.
       The offset is a random value in [-r2; r1-r2). r1 controls the roughness of
       the terrain; a larger value of r1 will result in rough terrain
       while a smaller value will generate smoother terrain.

       A high spikyness will result in sharp mountains and smooth valleys. A low
       spikyness will result in smooth mountains and sharp valleys.
    */
    const map = this.map;
    const tiles = this.tiles;

    const rndl = this.randomInt();
    let r1 = 0x80 + (rndl & 0x7f);
    let r2 = Math.imul(r1, this.terrainSpikyness) >> 16;

    for (let i = 8; i > 0; i >>= 1) {
      for (let y = 0; y < map.getRows(); y += 2 * i) {
        for (let x = 0; x < map.getCols(); x += 2 * i) {
          const pos_ = map.pos(x, y);
          const h = i32h(tiles[pos_].height);

          const posR = map.moveRightN(pos_, 2 * i);
          const posMidR = map.moveRightN(pos_, i);
          let hR = i32h(tiles[posR].height);

          if (this.preserveBugs) {
            /* The intention was probably just to set h_r to the map height value,
               but the upper bits of rnd must be preserved in h_r in the first
               iteration to generate the same maps as the original game. */
            if (x === 0 && y === 0 && i === 8) hR |= rndl & 0xff00;
          }

          tiles[posMidR].height = this.calcHeightDisplacement(idiv(h + hR, 2), r1, r2);

          const posD = map.moveDownN(pos_, 2 * i);
          const posMidD = map.moveDownN(pos_, i);
          const hD = i32h(tiles[posD].height);
          tiles[posMidD].height = this.calcHeightDisplacement(idiv(h + hD, 2), r1, r2);

          const posDr = map.moveRightN(map.moveDownN(pos_, 2 * i), 2 * i);
          const posMidDr = map.moveRightN(map.moveDownN(pos_, i), i);
          const hDr = i32h(tiles[posDr].height);
          tiles[posMidDr].height = this.calcHeightDisplacement(idiv(h + hDr, 2), r1, r2);
        }
      }

      r1 >>= 1;
      r2 >>= 1;
    }
  }

  protected initHeightsDiamondSquare(): void {
    /* This is the central part of the diamond-square algorithm.
       The squares are first subdivided into four new squares and
       the height of the midpoint is calculated by averaging the corners and
       adding a random offset. Each "diamond" that appears is then processed
       in the same way.

       The random offset applied to the midpoints is based on r1 and r2.
       The offset is a random value in [-r2; r1-r2). r1 controls the roughness of
       the terrain; a larger value of r1 will result in rough terrain
       while a smaller value will generate smoother terrain.

       A high spikyness will result in sharp mountains and smooth valleys. A low
       spikyness will result in smooth mountains and sharp valleys.
    */
    const map = this.map;
    const tiles = this.tiles;

    const rndl = this.randomInt();
    let r1 = 0x80 + (rndl & 0x7f);
    let r2 = Math.imul(r1, this.terrainSpikyness) >> 16;

    for (let i = 8; i > 0; i >>= 1) {
      /* Diamond step */
      for (let y = 0; y < map.getRows(); y += 2 * i) {
        for (let x = 0; x < map.getCols(); x += 2 * i) {
          const pos_ = map.pos(x, y);
          const h = i32h(tiles[pos_].height);

          const posR = map.moveRightN(pos_, 2 * i);
          const hR = i32h(tiles[posR].height);

          const posD = map.moveDownN(pos_, 2 * i);
          const hD = i32h(tiles[posD].height);

          const posDr = map.moveRightN(map.moveDownN(pos_, 2 * i), 2 * i);
          const hDr = i32h(tiles[posDr].height);

          const posMidDr = map.moveRightN(map.moveDownN(pos_, i), i);
          const avg = idiv(h + hR + hD + hDr, 4);
          tiles[posMidDr].height = this.calcHeightDisplacement(avg, r1, r2);
        }
      }

      /* Square step */
      for (let y = 0; y < map.getRows(); y += 2 * i) {
        for (let x = 0; x < map.getCols(); x += 2 * i) {
          const pos_ = map.pos(x, y);
          const h = i32h(tiles[pos_].height);

          const posR = map.moveRightN(pos_, 2 * i);
          const hR = i32h(tiles[posR].height);

          const posD = map.moveDownN(pos_, 2 * i);
          const hD = i32h(tiles[posD].height);

          const posUr = map.moveRightN(map.moveDownN(pos_, -i), i);
          const hUr = i32h(tiles[posUr].height);

          const posDr = map.moveRightN(map.moveDownN(pos_, i), i);
          const hDr = i32h(tiles[posDr].height);

          const posDl = map.moveRightN(map.moveDownN(pos_, i), -i);
          const hDl = i32h(tiles[posDl].height);

          const posMidR = map.moveRightN(pos_, i);
          const avgR = idiv(h + hR + hUr + hDr, 4);
          tiles[posMidR].height = this.calcHeightDisplacement(avgR, r1, r2);

          const posMidD = map.moveDownN(pos_, i);
          const avgD = idiv(h + hD + hDl + hDr, 4);
          tiles[posMidD].height = this.calcHeightDisplacement(avgD, r1, r2);
        }
      }

      r1 >>= 1;
      r2 >>= 1;
    }
  }

  protected adjustMapHeight(h1: number, h2: number, pos: MapPos): boolean {
    if (Math.abs(h1 - h2) > 32) {
      this.tiles[pos].height = u32(h1 + (h1 < h2 ? 32 : -32));
      return true;
    }

    return false;
  }

  /* Ensure that map heights of adjacent fields are not too far apart. */
  protected clampHeights(): void {
    const map = this.map;
    const tiles = this.tiles;
    const tileCount = this.tileCount();
    let changed = true;
    while (changed) {
      changed = false;
      for (let pos_ = 0; pos_ < tileCount; pos_++) {
        const h = i32h(tiles[pos_].height);

        const posD = map.moveDown(pos_);
        const hD = i32h(tiles[posD].height);
        // `changed |= f()` always evaluates f().
        if (this.adjustMapHeight(h, hD, posD)) changed = true;

        const posDr = map.moveDownRight(pos_);
        const hDr = i32h(tiles[posDr].height);
        if (this.adjustMapHeight(h, hDr, posDr)) changed = true;

        const posR = map.moveRight(pos_);
        const hR = i32h(tiles[posR].height);
        if (this.adjustMapHeight(h, hR, posR)) changed = true;
      }
    }
  }

  // Expand water around position.
  //
  // Expand water area by marking shores with 254 and water positions with 255.
  // Water (255) can only be expanded to a position where all six adjacent
  // positions are at or lower than the water level. When a position is marked
  // as water (255) the surrounding positions, that are not yet marked, are
  // changed to shore (254). Returns true only if the given position was
  // converted to water.
  protected expandWaterPosition(pos_: MapPos): boolean {
    const map = this.map;
    const tiles = this.tiles;
    let expanding = false;

    for (const d of cycleDirectionsCw()) {
      const newPos = map.move(pos_, d);
      const height = tiles[newPos].height;
      if (this.waterLevel < height && height < 254) {
        return false;
      } else if (height === 255) {
        expanding = true;
      }
    }

    if (expanding) {
      tiles[pos_].height = 255;

      for (const d of cycleDirectionsCw()) {
        const newPos = map.move(pos_, d);
        if (tiles[newPos].height !== 255) tiles[newPos].height = 254;
      }
    }

    return expanding;
  }

  // Try to expand area around position into a water body.
  //
  // After expanding, the water body will be tagged with the heights 253 for
  // positions in water and 252 for positions on the shore.
  protected expandWaterBody(pos: MapPos): void {
    const map = this.map;
    const tiles = this.tiles;

    // Check whether it is possible to expand from this position.
    for (const d of cycleDirectionsCw()) {
      const newPos = map.move(pos, d);
      if (tiles[newPos].height > this.waterLevel) {
        // Expanding water from this position was not possible. Just raise the
        // height to one above sea level.
        tiles[pos].height = 0;
        return;
      }
    }

    // Initialize expansion
    tiles[pos].height = 255;
    for (const d of cycleDirectionsCw()) {
      const newPos = map.move(pos, d);
      tiles[newPos].height = 254;
    }

    // Expand water until we are unable to expand any more or until the max
    // lake area limit has been reached.
    for (let i = 0; i < this.maxLakeArea; i++) {
      let expanded = false;

      let newPos = map.moveRightN(pos, i + 1);
      for (const d of cycleDirectionsCw(Direction.DirectionDown)) {
        for (let j = 0; j <= i; j++) {
          // `expanded |= f()` always evaluates f().
          if (this.expandWaterPosition(newPos)) expanded = true;
          newPos = map.move(newPos, d);
        }
      }

      if (!expanded) break;
    }

    // Change the water encoding from 255,254 to 253,252. This change means that
    // when expanding another lake, this area will look like an elevated plateau
    // at heights 252/253 and the other lake will not be able to expand into this
    // area. This keeps water bodies from growing larger than the max lake area.
    tiles[pos].height = u32(tiles[pos].height - 2);

    for (let i = 0; i < u32(this.maxLakeArea + 1); i++) {
      let newPos = map.moveRightN(pos, i + 1);
      for (const d of cycleDirectionsCw(Direction.DirectionDown)) {
        for (let j = 0; j <= i; j++) {
          if (tiles[newPos].height > 253) tiles[newPos].height = u32(tiles[newPos].height - 2);
          newPos = map.move(newPos, d);
        }
      }
    }
  }

  // Create water bodies on the map.
  //
  // Try to expand every position that is at or below the water level into a
  // body of water. After expanding bodies of water, the height of the positions
  // are changed such that the lowest points on the map are at water_level - 1
  // (marking water) and just above that the height is at water_level (marking
  // shore).
  protected createWaterBodies(): void {
    const tiles = this.tiles;
    const tileCount = this.tileCount();

    for (let h = 0; h <= this.waterLevel; h++) {
      for (let pos_ = 0; pos_ < tileCount; pos_++) {
        if (tiles[pos_].height === h) {
          this.expandWaterBody(pos_);
        }
      }
    }

    // Map positions are marked in the previous loop.
    // 0: Above water level.
    // 252: Land at water level.
    // 253: Water.
    for (let pos_ = 0; pos_ < tileCount; pos_++) {
      const h = i32h(tiles[pos_].height);
      switch (h) {
        case 0:
          tiles[pos_].height = u32(this.waterLevel + 1);
          break;
        case 252:
          tiles[pos_].height = this.waterLevel;
          break;
        case 253:
          tiles[pos_].height = u32(this.waterLevel - 1);
          tiles[pos_].mineral = MapMinerals.MineralsNone;
          tiles[pos_].resourceAmount = this.randomInt() & 7; /* Fish */
          break;
      }
    }
  }

  /* Adjust heights so zero height is sea level. */
  protected heightsRebase(): void {
    const tiles = this.tiles;
    const tileCount = this.tileCount();
    const h = (this.waterLevel - 1) | 0;

    for (let pos = 0; pos < tileCount; pos++) {
      tiles[pos].height = u32(tiles[pos].height - h);
    }
  }

  /* Set type of map fields based on the height value. */
  protected initTypes(): void {
    const map = this.map;
    const tiles = this.tiles;
    const tileCount = this.tileCount();
    for (let pos_ = 0; pos_ < tileCount; pos_++) {
      const h1 = i32h(tiles[pos_].height);
      const h2 = i32h(tiles[map.moveRight(pos_)].height);
      const h3 = i32h(tiles[map.moveDownRight(pos_)].height);
      const h4 = i32h(tiles[map.moveDown(pos_)].height);
      tiles[pos_].typeUp = calcMapType((h1 + h3 + h4) | 0);
      tiles[pos_].typeDown = calcMapType((h1 + h2 + h3) | 0);
    }
  }

  protected clearAllTags(): void {
    const tileCount = this.tileCount();
    for (let pos = 0; pos < tileCount; pos++) {
      this.tags[pos] = 0;
    }
  }

  // Remove islands.
  //
  // Pick an initial map position, then search from there to see which other
  // positions on the map are reachable (over land) from that position. If the
  // reachable positions cover at least 1/4 of the map, then stop and convert any
  // position that was _not_ reached to water. Otherwise, keep trying new initial
  // positions.
  //
  // In most cases this will eliminate any island that covers less than 1/4 of
  // the map. However, since the markings are not reset after an initial
  // position has failed to expand to 1/4 of the map, it is still possible for
  // islands to survive if they by change happen to be in the area where the
  // first initial positions are chosen (around 0, 0).
  protected removeIslands(): void {
    const map = this.map;
    const tiles = this.tiles;
    const tags = this.tags;
    const tileCount = this.tileCount();

    // Initially all positions are tagged with 0. When reached from another
    // position the tag is changed to 1, and later when that position is
    // itself expanded the tag is changed to 2.
    this.clearAllTags();

    for (let pos_ = 0; pos_ < tileCount; pos_++) {
      if (tiles[pos_].height > 0 && tags[pos_] === 0) {
        tags[pos_] = 1;

        let num = 0;
        let changed = true;
        while (changed) {
          changed = false;
          for (let pos_ = 0; pos_ < tileCount; pos_++) {
            if (tags[pos_] === 1) {
              num += 1;
              tags[pos_] = 2;

              // The i'th flag will indicate whether a path on land from
              // pos_in direction i is possible.
              let flags = 0;
              if (tiles[pos_].typeDown >= MapTerrain.TerrainGrass0) {
                flags |= 3;
              }
              if (tiles[pos_].typeUp >= MapTerrain.TerrainGrass0) {
                flags |= 6;
              }
              if (tiles[map.moveLeft(pos_)].typeDown >= MapTerrain.TerrainGrass0) {
                flags |= 0xc;
              }
              if (tiles[map.moveUpLeft(pos_)].typeUp >= MapTerrain.TerrainGrass0) {
                flags |= 0x18;
              }
              if (tiles[map.moveUpLeft(pos_)].typeDown >= MapTerrain.TerrainGrass0) {
                flags |= 0x30;
              }
              if (tiles[map.moveUp(pos_)].typeUp >= MapTerrain.TerrainGrass0) {
                flags |= 0x21;
              }

              // Mark positions following any valid direction on land.
              for (const d of cycleDirectionsCw()) {
                if (BIT_TEST(flags, d)) {
                  if (tags[map.move(pos_, d)] === 0) {
                    tags[map.move(pos_, d)] = 1;
                    changed = true;
                  }
                }
              }
            }
          }
        }

        if (4 * num >= tileCount) break;
      }
    }

    // Change every position that was not tagged (i.e. tag is 0) to water.
    for (let pos_ = 0; pos_ < tileCount; pos_++) {
      if (tiles[pos_].height > 0 && tags[pos_] === 0) {
        tiles[pos_].height = 0;
        tiles[pos_].typeUp = MapTerrain.TerrainWater0;
        tiles[pos_].typeUp = MapTerrain.TerrainWater0;

        tiles[map.moveLeft(pos_)].typeDown = MapTerrain.TerrainWater0;
        tiles[map.moveUpLeft(pos_)].typeUp = MapTerrain.TerrainWater0;
        tiles[map.moveUpLeft(pos_)].typeDown = MapTerrain.TerrainWater0;
        tiles[map.moveUp(pos_)].typeUp = MapTerrain.TerrainWater0;
      }
    }
  }

  /* Rescale height values to be in [0;31]. */
  protected heightsRescale(): void {
    const tiles = this.tiles;
    const tileCount = this.tileCount();
    for (let pos_ = 0; pos_ < tileCount; pos_++) {
      tiles[pos_].height = u32(tiles[pos_].height + 6) >>> 3;
    }
  }

  // Change terrain types based on a seed type in adjacent tiles.
  //
  // For every triangle, if the current type is old and any adjacent triangle
  // has type seed, then the triangle is changed into the new_ terrain type.
  protected seedTerrainType(old: MapTerrain, seed: MapTerrain, new_: MapTerrain): void {
    const map = this.map;
    const tiles = this.tiles;
    const tileCount = this.tileCount();
    for (let pos_ = 0; pos_ < tileCount; pos_++) {
      /* Check that the central triangle is of type old (o), and that any
         adjacent triangle is of type seed:
             ____
            /\  /\
           /__\/__\
          /\  /\  /\
         /__\/o_\/__\
         \  /\  /\  /
          \/__\/__\/
      */
      if (
        tiles[pos_].typeUp === old &&
        (seed === tiles[map.moveUpLeft(pos_)].typeDown ||
          seed === tiles[map.moveUpLeft(pos_)].typeUp ||
          seed === tiles[map.moveUp(pos_)].typeUp ||
          seed === tiles[map.moveLeft(pos_)].typeDown ||
          seed === tiles[map.moveLeft(pos_)].typeUp ||
          seed === tiles[pos_].typeDown ||
          seed === tiles[map.moveRight(pos_)].typeUp ||
          seed === tiles[map.moveLeft(map.moveDown(pos_))].typeDown ||
          seed === tiles[map.moveDown(pos_)].typeDown ||
          seed === tiles[map.moveDown(pos_)].typeUp ||
          seed === tiles[map.moveDownRight(pos_)].typeDown ||
          seed === tiles[map.moveDownRight(pos_)].typeUp)
      ) {
        tiles[pos_].typeUp = new_;
      }

      /* Check that the central triangle is of type old (o), and that any
         adjacent triangle is of type seed:
           ________
          /\  /\  /\
         /__\/__\/__\
         \  /\o /\  /
          \/__\/__\/
           \  /\  /
            \/__\/
      */
      if (
        tiles[pos_].typeDown === old &&
        (seed === tiles[map.moveUpLeft(pos_)].typeDown ||
          seed === tiles[map.moveUpLeft(pos_)].typeUp ||
          seed === tiles[map.moveUp(pos_)].typeDown ||
          seed === tiles[map.moveUp(pos_)].typeUp ||
          seed === tiles[map.moveRight(map.moveUp(pos_))].typeUp ||
          seed === tiles[map.moveLeft(pos_)].typeDown ||
          seed === tiles[pos_].typeUp ||
          seed === tiles[map.moveRight(pos_)].typeDown ||
          seed === tiles[map.moveRight(pos_)].typeUp ||
          seed === tiles[map.moveDown(pos_)].typeDown ||
          seed === tiles[map.moveDownRight(pos_)].typeDown ||
          seed === tiles[map.moveDownRight(pos_)].typeUp)
      ) {
        tiles[pos_].typeDown = new_;
      }
    }
  }

  // Change water type based on closeness to shore.
  //
  // Change type from TerrainWater0 to higher water (1-3) types based on
  // closeness to the shore. The water closest to the shore will become
  // TerrainWater3.
  protected changeShoreWaterType(): void {
    this.seedTerrainType(MapTerrain.TerrainWater0, MapTerrain.TerrainGrass1, MapTerrain.TerrainWater3);
    this.seedTerrainType(MapTerrain.TerrainWater0, MapTerrain.TerrainWater3, MapTerrain.TerrainWater2);
    this.seedTerrainType(MapTerrain.TerrainWater0, MapTerrain.TerrainWater2, MapTerrain.TerrainWater1);
  }

  // Change grass type of shore to TerrainGrass0.
  //
  // Change type from TerrainGrass1 to TerrainGrass0 where the tiles are
  // adjacent to water.
  protected changeShoreGrassType(): void {
    this.seedTerrainType(MapTerrain.TerrainGrass1, MapTerrain.TerrainWater3, MapTerrain.TerrainGrass0);
  }

  // Check whether large down-triangle is suitable for desert.
  //
  // The large down-triangle at position A is made up of the following
  // triangular pieces. The method returns true only if all terrain types
  // within the triangle are either TerrainGrass1 or TerrainDesert2.
  //
  // __ A ___
  // \  /\  /
  //  \/__\/
  //   \  /
  //    \/
  //
  protected checkDesertDownTriangle(pos_: MapPos): boolean {
    const map = this.map;
    const tiles = this.tiles;
    let typeD = tiles[pos_].typeDown;
    const typeU = tiles[pos_].typeUp;

    if (typeD !== MapTerrain.TerrainGrass1 && typeD !== MapTerrain.TerrainDesert2) {
      return false;
    }
    if (typeU !== MapTerrain.TerrainGrass1 && typeU !== MapTerrain.TerrainDesert2) {
      return false;
    }

    typeD = tiles[map.moveLeft(pos_)].typeDown;
    if (typeD !== MapTerrain.TerrainGrass1 && typeD !== MapTerrain.TerrainDesert2) {
      return false;
    }

    typeD = tiles[map.moveDown(pos_)].typeDown;
    if (typeD !== MapTerrain.TerrainGrass1 && typeD !== MapTerrain.TerrainDesert2) {
      return false;
    }

    return true;
  }

  /* Check whether large up-triangle is suitable for desert.

     The large up-triangle at position A is made up of the following
     triangular pieces. The method returns true only if all terrain types
     within the triangle are either TerrainGrass1 or TerrainDesert2.

          /\
       A /__\
        /\  /\
       /__\/__\
  */
  protected checkDesertUpTriangle(pos_: MapPos): boolean {
    const map = this.map;
    const tiles = this.tiles;
    const typeD = tiles[pos_].typeDown;
    let typeU = tiles[pos_].typeUp;

    if (typeD !== MapTerrain.TerrainGrass1 && typeD !== MapTerrain.TerrainDesert2) {
      return false;
    }
    if (typeU !== MapTerrain.TerrainGrass1 && typeU !== MapTerrain.TerrainDesert2) {
      return false;
    }

    typeU = tiles[map.moveRight(pos_)].typeUp;
    if (typeU !== MapTerrain.TerrainGrass1 && typeU !== MapTerrain.TerrainDesert2) {
      return false;
    }

    typeU = tiles[map.moveUp(pos_)].typeUp;
    if (typeU !== MapTerrain.TerrainGrass1 && typeU !== MapTerrain.TerrainDesert2) {
      return false;
    }

    return true;
  }

  // Create deserts.
  protected createDeserts(): void {
    const map = this.map;
    const tiles = this.tiles;
    const tileCount = this.tileCount();

    // Initialize random areas of desert based on spiral pattern.
    // Only TerrainGrass1 triangles will be converted to desert.
    for (let i = 0; i < map.getRegionCount(); i++) {
      for (let try_ = 0; try_ < 200; try_++) {
        const rndPos = map.getRndCoord(null, null, this.rnd);

        if (
          tiles[rndPos].typeUp === MapTerrain.TerrainGrass1 &&
          tiles[rndPos].typeDown === MapTerrain.TerrainGrass1
        ) {
          for (let index = 255; index >= 0; index--) {
            const pos = map.posAddSpirally(rndPos, index);

            if (this.checkDesertDownTriangle(pos)) {
              tiles[pos].typeUp = MapTerrain.TerrainDesert2;
            }

            if (this.checkDesertUpTriangle(pos)) {
              tiles[pos].typeDown = MapTerrain.TerrainDesert2;
            }
          }
          break;
        }
      }
    }

    // Convert outer triangles in the desert areas into a gradual transition
    // through TerrainGrass3, TerrainDesert0, TerrainDesert1 to TerrainDesert2.
    this.seedTerrainType(MapTerrain.TerrainDesert2, MapTerrain.TerrainGrass1, MapTerrain.TerrainGrass3);
    this.seedTerrainType(MapTerrain.TerrainDesert2, MapTerrain.TerrainGrass3, MapTerrain.TerrainDesert0);
    this.seedTerrainType(MapTerrain.TerrainDesert2, MapTerrain.TerrainDesert0, MapTerrain.TerrainDesert1);

    // Convert all triangles in the TerrainGrass3 - TerrainDesert1 range to
    // TerrainGrass1. This reduces the size of the desert areas to the core
    // that was made up of TerrainDesert2.
    for (let pos_ = 0; pos_ < tileCount; pos_++) {
      const typeD: number = tiles[pos_].typeDown;
      const typeU: number = tiles[pos_].typeUp;

      if (typeD >= MapTerrain.TerrainGrass3 && typeD <= MapTerrain.TerrainDesert1) {
        tiles[pos_].typeDown = MapTerrain.TerrainGrass1;
      }
      if (typeU >= MapTerrain.TerrainGrass3 && typeU <= MapTerrain.TerrainDesert1) {
        tiles[pos_].typeUp = MapTerrain.TerrainGrass1;
      }
    }

    // Restore the gradual transition from TerrainGrass3 to TerrainDesert2 around
    // the desert.
    this.seedTerrainType(MapTerrain.TerrainGrass1, MapTerrain.TerrainDesert2, MapTerrain.TerrainDesert1);
    this.seedTerrainType(MapTerrain.TerrainGrass1, MapTerrain.TerrainDesert1, MapTerrain.TerrainDesert0);
    this.seedTerrainType(MapTerrain.TerrainGrass1, MapTerrain.TerrainDesert0, MapTerrain.TerrainGrass3);
  }

  /* Put crosses on top of mountains. */
  protected createCrosses(): void {
    const map = this.map;
    const tiles = this.tiles;
    const tileCount = this.tileCount();
    for (let pos_ = 0; pos_ < tileCount; pos_++) {
      const h = tiles[pos_].height;
      if (
        h >= 26 &&
        h >= tiles[map.moveRight(pos_)].height &&
        h >= tiles[map.moveDownRight(pos_)].height &&
        h >= tiles[map.moveDown(pos_)].height &&
        h > tiles[map.moveLeft(pos_)].height &&
        h > tiles[map.moveUpLeft(pos_)].height &&
        h > tiles[map.moveUp(pos_)].height
      ) {
        tiles[pos_].obj = MapObject.ObjectCross;
      }
    }
  }

  /* Check that hexagon has tile types in range.

     Check whether the hexagon at pos has triangles of types between min and max,
     both inclusive. Return false if not all triangles are in this range,
     otherwise true.

     NOTE: This function has a quirk which is enabled by preserve_bugs. When this
     quirk is enabled, one of the tiles that is checked is not in the hexagon but
     is instead an adjacent tile. This is necessary to generate original game
     maps. */
  protected hexagonTypesInRange(pos_: MapPos, min: MapTerrain, max: MapTerrain): boolean {
    const map = this.map;
    const tiles = this.tiles;
    let typeD = tiles[pos_].typeDown;
    let typeU = tiles[pos_].typeUp;

    if (typeD < min || typeD > max) return false;
    if (typeU < min || typeU > max) return false;

    typeD = tiles[map.moveLeft(pos_)].typeDown;
    if (typeD < min || typeD > max) return false;

    typeD = tiles[map.moveUpLeft(pos_)].typeDown;
    typeU = tiles[map.moveUpLeft(pos_)].typeUp;
    if (typeD < min || typeD > max) return false;
    if (typeU < min || typeU > max) return false;

    /* Should be checkeing the up tri type. */
    if (this.preserveBugs) {
      typeD = tiles[map.moveUp(pos_)].typeDown;
      if (typeD < min || typeD > max) return false;
    } else {
      typeU = tiles[map.moveUp(pos_)].typeUp;
      if (typeU < min || typeU > max) return false;
    }

    return true;
  }

  /* Get a random position in the spiral pattern based at col, row. */
  protected posAddSpirallyRandom(pos: MapPos, mask: number): MapPos {
    return this.map.posAddSpirally(pos, this.randomInt() & mask);
  }

  /* Create clusters of map objects.

     Tries to create num_clusters of objects in random locations on the map.
     Each cluster has up to objs_in_cluster objects. The pos_mask is used in
     the call to pos_add_spirally_random to determine the max cluster size. The
     type_min and type_max determine the range (both inclusive) of terrain
     types that must appear around a position to be elegible for placement of
     an object. The obj_base determines the first object type that can be placed
     and the obj_mask specifies a mask on a random integer that is added to the
     base to obtain the final object type.
  */
  protected createRandomObjectClusters(
    numClusters: number,
    objsInCluster: number,
    posMask: number,
    typeMin: MapTerrain,
    typeMax: MapTerrain,
    objBase: number,
    objMask: number,
  ): void {
    const map = this.map;
    const tiles = this.tiles;
    for (let i = 0; i < numClusters; i++) {
      for (let try_ = 0; try_ < 100; try_++) {
        const rndPos = map.getRndCoord(null, null, this.rnd);
        if (this.hexagonTypesInRange(rndPos, typeMin, typeMax)) {
          for (let j = 0; j < objsInCluster; j++) {
            const pos_ = this.posAddSpirallyRandom(rndPos, posMask);
            if (
              this.hexagonTypesInRange(pos_, typeMin, typeMax) &&
              tiles[pos_].obj === MapObject.ObjectNone
            ) {
              tiles[pos_].obj = ((this.randomInt() & objMask) + objBase) as MapObject;
            }
          }
          break;
        }
      }
    }
  }

  protected createObjects(): void {
    const regions = this.map.getRegionCount();

    this.createCrosses();

    // Add either tree or pine.
    this.createRandomObjectClusters(
      regions * 8, 10, 0xff, MapTerrain.TerrainGrass1, MapTerrain.TerrainGrass2,
      MapObject.ObjectTree0, 0xf);

    // Add only trees.
    this.createRandomObjectClusters(
      regions, 45, 0x3f, MapTerrain.TerrainGrass1, MapTerrain.TerrainGrass2,
      MapObject.ObjectTree0, 0x7);

    // Add only pines.
    this.createRandomObjectClusters(
      regions, 30, 0x3f, MapTerrain.TerrainGrass0, MapTerrain.TerrainGrass2,
      MapObject.ObjectPine0, 0x7);

    // Add either tree or pine.
    this.createRandomObjectClusters(
      regions, 20, 0x7f, MapTerrain.TerrainGrass1, MapTerrain.TerrainGrass2,
      MapObject.ObjectTree0, 0xf);

    // Create dense clusters of stone.
    this.createRandomObjectClusters(
      regions, 40, 0x3f, MapTerrain.TerrainGrass1, MapTerrain.TerrainGrass2,
      MapObject.ObjectStone0, 0x7);

    // Create sparse clusters.
    this.createRandomObjectClusters(
      regions, 15, 0xff, MapTerrain.TerrainGrass1, MapTerrain.TerrainGrass2,
      MapObject.ObjectStone0, 0x7);

    // Create dead trees.
    this.createRandomObjectClusters(
      regions, 2, 0xff, MapTerrain.TerrainGrass1, MapTerrain.TerrainGrass2,
      MapObject.ObjectDeadTree, 0);

    // Create sandstone boulders.
    this.createRandomObjectClusters(
      regions, 6, 0xff, MapTerrain.TerrainGrass1, MapTerrain.TerrainGrass2,
      MapObject.ObjectSandstone0, 0x1);

    // Create trees submerged in water.
    this.createRandomObjectClusters(
      regions, 50, 0x7f, MapTerrain.TerrainWater2, MapTerrain.TerrainWater3,
      MapObject.ObjectWaterTree0, 0x3);

    // Create tree stubs.
    this.createRandomObjectClusters(
      regions, 5, 0xff, MapTerrain.TerrainGrass1, MapTerrain.TerrainGrass2,
      MapObject.ObjectStub, 0);

    // Create small boulders.
    this.createRandomObjectClusters(
      regions, 10, 0xff, MapTerrain.TerrainGrass1, MapTerrain.TerrainGrass2,
      MapObject.ObjectStone, 0x1);

    // Create animal cadavers in desert.
    this.createRandomObjectClusters(
      regions, 2, 0xf, MapTerrain.TerrainDesert2, MapTerrain.TerrainDesert2,
      MapObject.ObjectCadaver0, 0x1);

    // Create cacti in desert.
    this.createRandomObjectClusters(
      regions, 6, 0x7f, MapTerrain.TerrainDesert0, MapTerrain.TerrainDesert2,
      MapObject.ObjectCactus0, 0x1);

    // Create boulders submerged in water.
    this.createRandomObjectClusters(
      regions, 8, 0x7f, MapTerrain.TerrainWater0, MapTerrain.TerrainWater2,
      MapObject.ObjectWaterStone0, 0x1);

    // Create palm trees in desert.
    this.createRandomObjectClusters(
      regions, 6, 0x3f, MapTerrain.TerrainDesert2, MapTerrain.TerrainDesert2,
      MapObject.ObjectPalm0, 0x3);
  }

  // Expand a cluster of minerals.
  // PORT: `int *index` is a one-field box, `index.value`.
  protected expandMineralCluster(
    iters: number,
    initPos: MapPos,
    index: { value: number },
    amount: number,
    type: MapMinerals,
  ): void {
    const tiles = this.tiles;
    for (let i = 0; i < iters; i++) {
      const pos = this.map.posAddSpirally(initPos, index.value);
      index.value += 1;

      if (tiles[pos].mineral === MapMinerals.MineralsNone || tiles[pos].resourceAmount < amount) {
        tiles[pos].mineral = type;
        tiles[pos].resourceAmount = amount;
      }
    }
  }

  // Create random clusters of mineral deposits.
  //
  // Tries to create num_clusters of minerals of the given type. The terrain type
  // around a position must be in the min, max range (both inclusive) for a
  // resource to be deposited.
  protected createRandomMineralClusters(
    numClusters: number,
    type: MapMinerals,
    min: MapTerrain,
    max: MapTerrain,
  ): void {
    const iterations = [1, 6, 12, 18, 24, 30];

    for (let i = 0; i < numClusters; i++) {
      for (let try_ = 0; try_ < 100; try_++) {
        const pos_ = this.map.getRndCoord(null, null, this.rnd);

        if (this.hexagonTypesInRange(pos_, min, max)) {
          const index = { value: 0 };
          const count = 2 + ((this.randomInt() >> 2) & 3);

          for (let j = 0; j < count; j++) {
            const amount = 4 * (count - j);
            this.expandMineralCluster(iterations[j], pos_, index, amount, type);
          }

          break;
        }
      }
    }
  }

  // Initialize mineral deposits in the ground.
  protected createMineralDeposits(): void {
    interface Deposit {
      mult: number;
      mineral: MapMinerals;
    }

    const deposits: Deposit[] = [
      { mult: 9, mineral: MapMinerals.MineralsCoal },
      { mult: 4, mineral: MapMinerals.MineralsIron },
      { mult: 2, mineral: MapMinerals.MineralsGold },
      { mult: 2, mineral: MapMinerals.MineralsStone },
    ];

    const regions = this.map.getRegionCount();

    for (const dep of deposits) {
      this.createRandomMineralClusters(
        regions * dep.mult, dep.mineral, MapTerrain.TerrainTundra0, MapTerrain.TerrainSnow0);
    }
  }

  protected cleanUp(): void {
    const map = this.map;
    const tiles = this.tiles;
    const tileCount = this.tileCount();
    /* Make sure that it is always possible to walk around
       any impassable objects. This also clears water obstacles
       except in certain positions near the shore. */
    for (let pos_ = 0; pos_ < tileCount; pos_++) {
      if (Map.mapSpaceFromObj[tiles[pos_].obj] >= MapSpace.SpaceImpassable) {
        // Due to a quirk in the original game the three adjacent positions
        // were not checked directly whether they were impassable but instead
        // another flag was used to mark the position impassable. This flag
        // was only initialzed for water positions before this loop and was
        // initialized as part of this same loop for non-water positions. For
        // this reason, the check for impassable spaces would never succeed
        // under two particular conditions at the map edge:
        // 1) x == 0 && d == DirectionLeft
        // 2) y == 0 && (d == DirectionUp || d == DirectionUpLeft)
        for (const d of cycleDirectionsCw(Direction.DirectionLeft, 3)) {
          const otherPos = map.move(pos_, d);
          const s = Map.mapSpaceFromObj[tiles[otherPos].obj];

          let checkImpassable = false;
          if (
            !(map.posCol(pos_) === 0 && d === Direction.DirectionLeft) &&
            !((d === Direction.DirectionUp || d === Direction.DirectionUpLeft) && map.posRow(pos_) === 0)
          ) {
            checkImpassable = s >= MapSpace.SpaceImpassable;
          }

          if (this.isInWater(otherPos) || checkImpassable) {
            tiles[pos_].obj = MapObject.ObjectNone;
            break;
          }
        }
      }
    }
  }
}

// `int h = tiles[pos].height` : unsigned int to int conversion.
function i32h(height: number): number {
  return height | 0;
}

/* Classic map generator that generates identical maps for missions. */
export class ClassicMissionMapGenerator extends ClassicMapGenerator {
  constructor(map: Map, rnd: Random) {
    super(map, rnd);
  }

  override init(): void {
    super.init(MapGenerator.HeightGenerator.HeightGeneratorMidpoints, true);
  }
}
