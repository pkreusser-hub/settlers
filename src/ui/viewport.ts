// viewport.h + viewport.cc - Viewport GUI component

import type { Building } from '../game/building';
import { BuildingType } from '../game/building';
import {
  Direction,
  DirectionDown,
  DirectionDownRight,
  DirectionLeft,
  DirectionNone,
  DirectionRight,
  DirectionUp,
  DirectionUpLeft,
  Map as GameMap,
  MapObject,
  MapSpace,
  MapTerrain,
  cycleDirectionsCw,
  reverseDirection,
} from '../game/map';
import type { MapHandler, MapPos, PMap } from '../game/map';
import { BIT_TEST, ExceptionFreeserf, Log, NOT_REACHED, idiv, u16, u32 } from '../game/misc';
import { pathfinderMap } from '../game/pathfinder';
import { ResourceType } from '../game/resource';
import { Serf, SerfState, SerfType } from '../game/serf';
import { previewAttack } from '../net/commands';
import { AudioTypeSfx } from './audio';
import { Data } from './data-instance';
import type { DataPSource } from './data-instance';
import { EventButton } from './event-loop';
import { Color, Frame, Graphics } from './gfx';
import { GuiObject } from './gui';
import { mapBuildingSprite } from './interface';
import type { Interface } from './interface';
import { PopupBoxType } from './popup';

const MAP_TILE_WIDTH = 32;
const MAP_TILE_HEIGHT = 20;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MAP_TILE_TEXTURES = 33;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MAP_TILE_MASKS = 81;

/* Number of cols,rows in each landscape tile */
const MAP_TILE_COLS = 16;
const MAP_TILE_ROWS = 16;

const triSpr = [
  32, 32, 32, 32, 32, 32, 32, 32,
  32, 32, 32, 32, 32, 32, 32, 32,
  32, 32, 32, 32, 32, 32, 32, 32,
  32, 32, 32, 32, 32, 32, 32, 32,
  0, 1, 2, 3, 4, 5, 6, 7,
  0, 1, 2, 3, 4, 5, 6, 7,
  0, 1, 2, 3, 4, 5, 6, 7,
  0, 1, 2, 3, 4, 5, 6, 7,
  24, 25, 26, 27, 28, 29, 30, 31,
  24, 25, 26, 27, 28, 29, 30, 31,
  24, 25, 26, 27, 28, 29, 30, 31,
  8, 9, 10, 11, 12, 13, 14, 15,
  8, 9, 10, 11, 12, 13, 14, 15,
  8, 9, 10, 11, 12, 13, 14, 15,
  16, 17, 18, 19, 20, 21, 22, 23,
  16, 17, 18, 19, 20, 21, 22, 23,
];

// PORT: the tables local to the functions of the C++ (static or not) are
// at file level here, so they are not built again on every call. The two
// tables named tri_mask are triMaskUp (draw_triangle_up) and triMaskDown
// (draw_triangle_down); the others keep their names.

/* tri_mask of draw_triangle_up(). */
const triMaskUp = [
   0,  1,  3,  6,  7, -1, -1, -1, -1,
   0,  1,  2,  5,  6,  7, -1, -1, -1,
   0,  1,  2,  3,  5,  6,  7, -1, -1,
   0,  1,  2,  3,  4,  5,  6,  7, -1,
   0,  1,  2,  3,  4,  4,  5,  6,  7,
  -1,  0,  1,  2,  3,  4,  5,  6,  7,
  -1, -1,  0,  1,  2,  4,  5,  6,  7,
  -1, -1, -1,  0,  1,  2,  5,  6,  7,
  -1, -1, -1, -1,  0,  1,  4,  6,  7,
];

/* tri_mask of draw_triangle_down(). */
const triMaskDown = [
   0,  0,  0,  0,  0, -1, -1, -1, -1,
   1,  1,  1,  1,  1,  0, -1, -1, -1,
   3,  2,  2,  2,  2,  1,  0, -1, -1,
   6,  5,  3,  3,  3,  2,  1,  0, -1,
   7,  6,  5,  4,  4,  3,  2,  1,  0,
  -1,  7,  6,  5,  4,  4,  4,  2,  1,
  -1, -1,  7,  6,  5,  5,  5,  5,  4,
  -1, -1, -1,  7,  6,  6,  6,  6,  6,
  -1, -1, -1, -1,  7,  7,  7,  7,  7,
];

const mapBuildingFrameSprite = [
  0, 0xba, 0xba, 0xba, 0xba,
  0xb9, 0xb9, 0xb9, 0xb9,
  0xba, 0xc1, 0xba, 0xb1, 0xb8, 0xb1, 0xbb,
  0xb7, 0xb5, 0xb6, 0xb0, 0xb8, 0xb3, 0xaf, 0xb4,
];

/* pigfarm_anim of draw_unharmed_building(). */
const pigfarmAnim = [
  0xa2, 0, 0xa2, 0, 0xa2, 0, 0xa2, 0, 0xa2, 0, 0xa3, 0,
  0xa2, 1, 0xa3, 1, 0xa2, 2, 0xa3, 2, 0xa2, 3, 0xa3, 3,
  0xa2, 4, 0xa3, 4, 0xa6, 4, 0xa6, 4, 0xa6, 4, 0xa6, 4,
  0xa4, 4, 0xa5, 4, 0xa4, 3, 0xa5, 3, 0xa4, 2, 0xa5, 2,
  0xa4, 1, 0xa5, 1, 0xa4, 0, 0xa5, 0, 0xa2, 0, 0xa2, 0,
  0xa6, 0, 0xa6, 0, 0xa6, 0, 0xa2, 0, 0xa7, 0, 0xa8, 0,
  0xa7, 0, 0xa8, 0, 0xa7, 0, 0xa8, 0, 0xa7, 0, 0xa8, 0,
  0xa7, 0, 0xa8, 0, 0xa7, 0, 0xa8, 0, 0xa7, 0, 0xa8, 0,
  0xa7, 0, 0xa8, 0, 0xa7, 0, 0xa2, 0, 0xa2, 0, 0xa2, 0,
  0xa2, 0, 0xa6, 0, 0xa6, 0, 0xa6, 0, 0xa6, 0, 0xa6, 0,
  0xa6, 0, 0xa2, 0, 0xa2, 0, 0xa7, 0, 0xa8, 0, 0xa9, 0,
  0xaa, 0, 0xab, 0, 0xac, 0, 0xad, 0, 0xac, 0, 0xad, 0,
  0xac, 0, 0xad, 0, 0xac, 0, 0xad, 0, 0xac, 0, 0xad, 0,
  0xac, 0, 0xad, 0, 0xac, 0, 0xad, 0, 0xac, 0, 0xab, 0,
  0xaa, 0, 0xa9, 0, 0xa8, 0, 0xa7, 0, 0xa2, 0, 0xa2, 0,
  0xa2, 0, 0xa2, 0, 0xa3, 0, 0xa2, 1, 0xa3, 1, 0xa2, 1,
  0xa3, 2, 0xa2, 2, 0xa3, 2, 0xa7, 2, 0xa8, 2, 0xa7, 2,
  0xa8, 2, 0xa7, 2, 0xa8, 2, 0xa7, 2, 0xa8, 2, 0xa7, 2,
  0xa8, 2, 0xa7, 2, 0xa8, 2, 0xa7, 2, 0xa8, 2, 0xa7, 2,
  0xa2, 2, 0xa2, 2, 0xa6, 2, 0xa6, 2, 0xa6, 2, 0xa6, 2,
  0xa4, 2, 0xa5, 2, 0xa4, 1, 0xa5, 1, 0xa4, 0, 0xa5, 0,
  0xa2, 0, 0xa2, 0,
];

/* pigs_layout of draw_unharmed_building(). */
/* Pigs in drawing order (back to front), each with the pig count
   from which it is shown. */
const pigsLayout = [
  0,   0,   0,  0,
  6, 140,  -2,  6,
  5, 280,   8,  8,
  3, 420, -11,  8,
  1,  40,   2, 11,
  7, 180,  -8, 13,
  8, 320,  13, 14,
  2, 460,   0, 17,
  4,  90, -11, 19,
];

/* building_anim_offset_from_type of draw_burning_building(). */
const buildingAnimOffsetFromType = [
  0, 10, 26, 39, 49, 62, 78, 97, 97, 116,
  129, 157, 167, 198, 211, 236, 255, 277, 305, 324,
  349, 362, 381, 418, 446,
];

/* building_burn_animation of draw_burning_building(). */
const buildingBurnAnimation = [
  /* Unfinished */
  0, -8, 2,
  8, 0, 4,
  0, 8, 2, -1,

  /* Fisher */
  0, -8, -10,
  0, 4, -12,
  8, -8, 4,
  8, 7, 4,
  0, -2, 8, -1,

  /* Lumberjack */
  0, 3, -13,
  0, -8, -10,
  8, 9, 3,
  8, -6, 3, -1,

  /* Boat builder */
  0, -1, -12,
  8, -8, 11,
  8, 7, 5, -1,

  /* Stone cutter */
  0, 6, -14,
  0, -9, -11,
  8, -8, 5,
  8, 6, 5, -1,

  /* Stone mine */
  8, -4, -40,
  8, -8, -15,
  8, 3, -14,
  8, -9, 4,
  8, 6, 5, -1,

  /* Coal mine */
  8, -4, -40,
  8, -1, -18,
  8, -8, -15,
  8, 6, 2,
  8, 0, 8,
  8, -8, 9, -1,

  /* Iron mine, gold mine */
  8, -4, -40,
  8, -2, -19,
  8, -9, -14,
  8, -8, 2,
  8, 6, 2,
  0, -4, 8, -1,

  /* Forester */
  0, 8, -11,
  0, -6, -8,
  8, -8, 4,
  8, 6, 4, -1,

  /* Stock */
  0, -2, -25,
  0, 6, -17,
  0, -9, -16,
  8, -21, 1,
  8, 21, 2,
  0, 15, 18,
  0, -16, 10,
  8, -8, 15,
  8, 5, 15, -1,

  /* Hut */
  0, 0, -11,
  8, -8, 5,
  8, 8, 5, -1,

  /* Farm */
  8, 22, -2,
  8, 7, -5,
  8, -3, -1,
  8, -23, 0,
  8, -12, 4,
  0, 25, 5,
  0, 21, 13,
  0, -17, 8,
  0, -10, 15,
  0, -2, 15, -1,

  /* Butcher */
  8, -15, 3,
  8, 20, 3,
  8, 7, 3,
  8, -4, 3, -1,

  /* Pig farm */
  8, 0, -2,
  8, 22, 1,
  8, 15, 5,
  8, -20, -1,
  8, -11, 3,
  0, 20, 12,
  0, -16, 7,
  0, -12, 14, -1,

  /* Mill */
  0, 7, -33,
  0, 5, -20,
  8, -2, -24,
  8, -6, 1,
  8, 4, 2,
  0, -3, 6, -1,

  /* Baker */
  0, -15, -16,
  0, -4, -19,
  0, 3, -16,
  8, -13, 2,
  8, -9, 7,
  8, 6, 7,
  0, 17, 1, -1,

  /* Saw mill */
  0, 7, -19,
  0, -1, -14,
  0, 16, -13,
  0, 5, -8,
  8, 14, 4,
  0, 10, 9,
  0, -17, 8,
  8, -11, 10,
  8, -1, 12, -1,

  /* Steel smelter */
  0, 5, -19,
  0, 16, -16,
  8, -14, 2,
  8, -10, 5,
  8, 15, 5,
  8, 2, 5, -1,

  /* Tool maker */
  8, 7, -19,
  0, -11, -17,
  0, -4, -11,
  0, 12, -10,
  8, -20, 0,
  8, -15, 7,
  8, 1, 7,
  8, 15, 7, -1,

  /* Weapon smith */
  8, -15, 1,
  8, -10, 3,
  8, 20, 3,
  8, 5, 3, -1,

  /* Tower */
  0, -6, -30,
  0, 7, -14,
  8, -11, -3,
  0, -8, 4,
  8, 9, 5,
  8, -4, 5, -1,

  /* Fortress */
  0, -3, -30,
  0, -15, -26,
  0, 21, -29,
  0, -13, -17,
  8, 4, -11,
  8, -2, -6,
  8, -22, 0,
  8, -17, 8,
  8, 20, 1,
  8, 10, 8,
  8, 4, 13,
  8, -11, 15, -1,

  /* Gold smelter */
  0, -15, -20,
  0, 10, -22,
  0, -3, -25,
  0, -8, -10,
  0, 7, -10,
  0, -13, 2,
  8, -8, 5,
  8, 6, 5,
  0, 16, 6, -1,

  /* Castle */
  0, 11, -46,
  0, -19, -42,
  8, 1, -27,
  8, 10, -13,
  0, -7, -24,
  8, -16, -6,
  0, -23, 4,
  8, -2, 0,
  8, 12, 12,
  8, -14, 17,
  8, -4, 19,
  0, 13, 19, -1,
];

/* res_pos of draw_flag_and_res(). */
const resPos = [
   6, -4,
  10, -2,
  -4, -4,
  10,  2,
  -8, -2,
   6,  4,
  -8,  2,
  -4,  4,
];

/* index1 of draw_row_serf(). */
const index1 = [
  0, 0, 48, 6, 96, -1, 48, 24,
  240, -1, 48, 30, 248, -1, 48, 12,
  48, 18, 96, 306, 96, 300, 48, 54,
  48, 72, 48, 36, 0, 48, 272, -1,
  48, 60, 264, -1, 48, 42, 280, -1,
  48, 66, 96, 312, 500, 600, 48, 318,
  48, 78, 0, 84, 48, 90, 48, 96,
  48, 102, 48, 108, 48, 114, 96, 324,
  96, 330, 96, 336, 96, 342, 96, 348,
  48, 354, 48, 360, 48, 366, 48, 372,
  48, 378, 48, 384, 504, 604, 509, -1,
  48, 120, 288, -1, 288, 420, 48, 126,
  48, 132, 96, 426, 0, 138, 304, -1,
  48, 390, 48, 144, 96, 432, 48, 198,
  510, 608, 48, 204, 48, 402, 48, 150,
  96, 438, 48, 156, 312, -1, 320, -1,
  48, 162, 48, 168, 96, 444, 0, 174,
  513, -1, 48, 408, 48, 180, 96, 450,
  0, 186, 520, -1, 48, 414, 48, 192,
  96, 456, 328, -1, 48, 210, 344, -1,
  48, 6, 48, 6, 48, 216, 528, -1,
  48, 534, 48, 528, 48, 288, 48, 282,
  48, 222, 533, -1, 48, 540, 48, 546,
  48, 552, 48, 558, 48, 564, 96, 468,
  96, 462, 48, 570, 48, 576, 48, 582,
  48, 396, 48, 228, 48, 234, 48, 240,
  48, 246, 48, 252, 48, 258, 48, 264,
  48, 270, 48, 276, 96, 474, 96, 480,
  96, 486, 96, 492, 96, 498, 96, 504,
  96, 510, 96, 516, 96, 522, 96, 612,
  144, 294, 144, 588, 144, 594, 144, 618,
  144, 624, 401, 294, 352, 297, 401, 588,
  352, 591, 401, 594, 352, 597, 401, 618,
  352, 621, 401, 624, 352, 627, 450, -1,
  192, -1,
];

/* index2 of draw_row_serf(). */
const index2 = [
  0, 0, 1, 0, 2, 0, 3, 0,
  4, 0, 5, 0, 6, 0, 7, 0,
  8, 1, 9, 1, 10, 1, 11, 1,
  12, 1, 13, 1, 14, 1, 15, 1,
  16, 2, 17, 2, 18, 2, 19, 2,
  20, 2, 21, 2, 22, 2, 23, 2,
  24, 3, 25, 3, 26, 3, 27, 3,
  28, 3, 29, 3, 30, 3, 31, 3,
  32, 4, 33, 4, 34, 4, 35, 4,
  36, 4, 37, 4, 38, 4, 39, 4,
  40, 5, 41, 5, 42, 5, 43, 5,
  44, 5, 45, 5, 46, 5, 47, 5,
  0, 0, 1, 0, 2, 0, 3, 0,
  4, 0, 5, 0, 6, 0, 2, 0,
  0, 1, 1, 1, 2, 1, 3, 1,
  4, 1, 5, 1, 6, 1, 2, 1,
  0, 2, 1, 2, 2, 2, 3, 2,
  4, 2, 5, 2, 6, 2, 2, 2,
  0, 3, 1, 3, 2, 3, 3, 3,
  4, 3, 5, 3, 6, 3, 2, 3,
  0, 0, 1, 0, 2, 0, 3, 0,
  4, 0, 5, 0, 6, 0, 7, 0,
  8, 0, 9, 0, 10, 0, 11, 0,
  12, 0, 13, 0, 14, 0, 15, 0,
  16, 0, 17, 0, 18, 0, 19, 0,
  20, 0, 21, 0, 22, 0, 23, 0,
  24, 0, 25, 0, 26, 0, 27, 0,
  28, 0, 29, 0, 30, 0, 31, 0,
  32, 0, 33, 0, 34, 0, 35, 0,
  36, 0, 37, 0, 38, 0, 39, 0,
  40, 0, 41, 0, 42, 0, 43, 0,
  44, 0, 45, 0, 46, 0, 47, 0,
  48, 0, 49, 0, 50, 0, 51, 0,
  52, 0, 53, 0, 54, 0, 55, 0,
  56, 0, 57, 0, 58, 0, 59, 0,
  60, 0, 61, 0, 62, 0, 63, 0,
  64, 0,
];

/* transporter_type of serf_get_body(). */
const transporterType = [
  0, 0x3000, 0x3500, 0x3b00, 0x4100, 0x4600, 0x4b00, 0x1400,
  0x700, 0x5100, 0x800, 0x1c00, 0x1d00, 0x1e00, 0x1a00, 0x1b00,
  0x6800, 0x6d00, 0x6500, 0x6700, 0x6b00, 0x6a00, 0x6600, 0x6900,
  0x6c00, 0x5700, 0x5600, 0, 0, 0, 0, 0,
];

/* sailor_type of serf_get_body(). */
const sailorType = [
  0, 0x3100, 0x3600, 0x3c00, 0x4200, 0x4700, 0x4c00, 0x1500,
  0x900, 0x7700, 0xa00, 0x2100, 0x2200, 0x2300, 0x1f00, 0x2000,
  0x6e00, 0x6f00, 0x7000, 0x7100, 0x7200, 0x7300, 0x7400, 0x7500,
  0x7600, 0x5f00, 0x6000, 0, 0, 0, 0, 0,
];

/* arr_4 of draw_active_serf(). */
const arr4 = [
   9, 5,
  10, 7,
  10, 2,
   8, 6,
  11, 8,
   9, 6,
   9, 8,
   0, 0,
   0, 0,
   0, 0,
   5, 5,
   4, 7,
   4, 2,
   7, 5,
   3, 8,
   5, 6,
   5, 8,
   0, 0,
   0, 0,
   0, 0,
];

/* arr_1 of draw_serf_row(). */
const arr1 = [
  0x240, 0x40, 0x380, 0x140, 0x300, 0x80, 0x180, 0x200,
  0, 0x340, 0x280, 0x100, 0x1c0, 0x2c0, 0x3c0, 0xc0,
];

/* arr_2 of draw_serf_row(). */
const arr2 = [
  0x8800, 0x8800, 0x8800, 0x8800, 0x8801, 0x8802, 0x8803, 0x8804,
  0x8804, 0x8804, 0x8804, 0x8804, 0x8803, 0x8802, 0x8801, 0x8800,
  0x8800, 0x8800, 0x8800, 0x8800, 0x8801, 0x8802, 0x8803, 0x8804,
  0x8805, 0x8806, 0x8807, 0x8808, 0x8809, 0x8808, 0x8809, 0x8808,
  0x8809, 0x8807, 0x8806, 0x8805, 0x8804, 0x8804, 0x8804, 0x8804,
  0x28, 0x29, 0x2a, 0x2b, 0x4, 0x5, 0xe, 0xf,
  0x10, 0x11, 0x1a, 0x1b, 0x23, 0x25, 0x26, 0x27,
  0x8800, 0x8800, 0x8800, 0x8800, 0x8801, 0x8802, 0x8803, 0x8804,
  0x8803, 0x8802, 0x8801, 0x8800, 0x8800, 0x8800, 0x8800, 0x8800,
  0x8801, 0x8802, 0x8803, 0x8804, 0x8804, 0x8804, 0x8804, 0x8804,
  0x8805, 0x8806, 0x8807, 0x8808, 0x8809, 0x8807, 0x8806, 0x8805,
  0x8804, 0x8803, 0x8802, 0x8802, 0x8802, 0x8802, 0x8801, 0x8800,
  0x8800, 0x8800, 0x8800, 0x8801, 0x8802, 0x8803, 0x8803, 0x8803,
  0x8803, 0x8804, 0x8804, 0x8804, 0x8805, 0x8806, 0x8807, 0x8808,
  0x8809, 0x8808, 0x8809, 0x8808, 0x8809, 0x8807, 0x8806, 0x8805,
  0x8803, 0x8803, 0x8803, 0x8802, 0x8802, 0x8801, 0x8801, 0x8801,
];

/* arr_3 of draw_serf_row(). */
const arr3 = [
  0, 0, 0, 0, 0, 0, -2, 1, 0, 0, 2, 2, 0, 5, 0, 0,
  0, 0, 0, 3, -2, 2, 0, 0, 2, 1, 0, 0, 0, 0, 0, 0,
  0, 0, -1, 2, -2, 1, 0, 0, 2, 1, 0, 0, 0, 0, 0, 0,
  1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, -1, 2, -2, 1, 0, 0, 2, 1, 0, 0, 0, 0, 0, 0,
  1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

// Viewport::Layer
export enum ViewportLayer {
  LayerLandscape = 1 << 0,
  LayerPaths = 1 << 1,
  LayerObjects = 1 << 2,
  LayerSerfs = 1 << 3,
  LayerCursor = 1 << 4,
  LayerGrid = 1 << 5,
  LayerBuilds = 1 << 6,
  LayerAll = LayerLandscape |
             LayerPaths |
             LayerObjects |
             LayerSerfs |
             LayerCursor,
}

/* Cache prerendered tiles of the landscape. Only the recently used
   ones are kept: all tiles of a large map take more than a gigabyte. */
// Viewport::LandscapeTile
export interface ViewportLandscapeTile {
  frame: Frame;
  lastUse: number;
}
type TilesMap = Map<number, ViewportLandscapeTile>;

export class Viewport extends GuiObject implements MapHandler {
  static Layer = ViewportLayer;

  protected landscapeTiles: TilesMap = new Map<number, ViewportLandscapeTile>();
  protected tileUseCounter: number;

  protected offsetX: number;
  protected offsetY: number;
  protected lastWidth: number;
  protected lastHeight: number;
  protected layers: number;
  protected interface: Interface;
  protected lastTick: number;
  protected dataSource: DataPSource;

  protected map: PMap;

  /* Water and trees seen by the last draw, for the ambient sounds. */
  protected waterInView: number;
  protected treesInView: number;

  switchLayer(layer: ViewportLayer): void {
    this.layers ^= layer;
  }

  getWaterInView(): number {
    return this.waterInView;
  }

  getTreesInView(): number {
    return this.treesInView;
  }

  protected drawTriangleUp(
    lx: number,
    ly: number,
    m: number,
    left: number,
    right: number,
    pos: MapPos,
    tile: Frame,
  ): void {
    if (left - m < -4 || left - m > 4) {
      throw new ExceptionFreeserf('Failed to draw triangle up (1).');
    }
    if (right - m < -4 || right - m > 4) {
      throw new ExceptionFreeserf('Failed to draw triangle up (2).');
    }

    const mask = 4 + m - left + 9 * (4 + m - right);
    if (triMaskUp[mask] < 0) {
      throw new ExceptionFreeserf('Failed to draw triangle up (3).');
    }

    const type: MapTerrain = this.map.typeUp(this.map.moveUp(pos));
    const index = (type << 3) | triMaskUp[mask];
    if (index >= 128) {
      throw new ExceptionFreeserf('Failed to draw triangle up (4).');
    }

    const sprite = triSpr[index];

    tile.drawMaskedSprite(lx, ly, Data.Resource.AssetMapMaskUp, mask,
                          Data.Resource.AssetMapGround, sprite);
  }

  protected drawTriangleDown(
    lx: number,
    ly: number,
    m: number,
    left: number,
    right: number,
    pos: MapPos,
    tile: Frame,
  ): void {
    if (left - m < -4 || left - m > 4) {
      throw new ExceptionFreeserf('Failed to draw triangle down (1).');
    }
    if (right - m < -4 || right - m > 4) {
      throw new ExceptionFreeserf('Failed to draw triangle down (2).');
    }

    const mask = 4 + left - m + 9 * (4 + right - m);
    if (triMaskDown[mask] < 0) {
      throw new ExceptionFreeserf('Failed to draw triangle down (3).');
    }

    const type: number = this.map.typeDown(this.map.moveUpLeft(pos));
    const index = (type << 3) | triMaskDown[mask];
    if (index >= 128) {
      throw new ExceptionFreeserf('Failed to draw triangle down (4).');
    }

    const sprite = triSpr[index];

    tile.drawMaskedSprite(lx, ly + MAP_TILE_HEIGHT,
                          Data.Resource.AssetMapMaskDown, mask,
                          Data.Resource.AssetMapGround, sprite);
  }

  /* Draw a column (vertical) of tiles, starting at an up pointing tile. */
  protected drawUpTileCol(pos: MapPos, xBase: number, yBase: number, maxY: number,
                          tile: Frame): void {
    const map = this.map;
    let m = map.getHeight(pos);
    let left: number;
    let right: number;

    // PORT: `goto down` jumps into the middle of the second loop; the flag
    // gotoDown skips the first half of its first iteration instead.
    let gotoDown = false;

    /* Loop until a tile is inside the frame (y >= 0). */
    while (true) {
      /* move down */
      pos = map.moveDown(pos);

      left = map.getHeight(pos);
      right = map.getHeight(map.moveRight(pos));

      const t = Math.min(left, right);
      /*if (left == right) t -= 1;*/ /* TODO ? */

      if (yBase + MAP_TILE_HEIGHT - 4 * t >= 0) break;

      yBase += MAP_TILE_HEIGHT;

      /* move down right */
      pos = map.moveDownRight(pos);

      m = map.getHeight(pos);

      if (yBase + MAP_TILE_HEIGHT - 4 * m >= 0) {
        gotoDown = true;
        break;
      }

      yBase += MAP_TILE_HEIGHT;
    }

    /* Loop until a tile is completely outside the frame (y >= max_y). */
    while (true) {
      if (!gotoDown) {
        if (yBase - 2 * MAP_TILE_HEIGHT - 4 * m >= maxY) break;

        this.drawTriangleUp(xBase, yBase - 4 * m, m, left, right, pos, tile);

        yBase += MAP_TILE_HEIGHT;

        /* move down right */
        pos = map.moveDownRight(pos);
        m = map.getHeight(pos);

        if (yBase - 2 * MAP_TILE_HEIGHT - 4 * Math.max(left, right) >= maxY) break;
      }
      gotoDown = false;

      /* down: */
      this.drawTriangleDown(xBase, yBase - 4 * m, m, left, right, pos, tile);

      yBase += MAP_TILE_HEIGHT;

      /* move down */
      pos = map.moveDown(pos);

      left = map.getHeight(pos);
      right = map.getHeight(map.moveRight(pos));
    }
  }

  /* Draw a column (vertical) of tiles, starting at a down pointing tile. */
  protected drawDownTileCol(pos: MapPos, xBase: number, yBase: number, maxY: number,
                            tile: Frame): void {
    const map = this.map;
    let left = map.getHeight(pos);
    let right = map.getHeight(map.moveRight(pos));
    let m: number;

    // PORT: `goto down`, see drawUpTileCol().
    let gotoDown = false;

    /* Loop until a tile is inside the frame (y >= 0). */
    while (true) {
      /* move down right */
      pos = map.moveDownRight(pos);

      m = map.getHeight(pos);

      if (yBase + MAP_TILE_HEIGHT - 4 * m >= 0) {
        gotoDown = true;
        break;
      }

      yBase += MAP_TILE_HEIGHT;

      /* move down */
      pos = map.moveDown(pos);

      left = map.getHeight(pos);
      right = map.getHeight(map.moveRight(pos));

      const t = Math.min(left, right);
      /*if (left == right) t -= 1;*/ /* TODO ? */

      if (yBase + MAP_TILE_HEIGHT - 4 * t >= 0) break;

      yBase += MAP_TILE_HEIGHT;
    }

    /* Loop until a tile is completely outside the frame (y >= max_y). */
    while (true) {
      if (!gotoDown) {
        if (yBase - 2 * MAP_TILE_HEIGHT - 4 * m >= maxY) break;

        this.drawTriangleUp(xBase, yBase - 4 * m, m, left, right, pos, tile);

        yBase += MAP_TILE_HEIGHT;

        /* move down right */
        pos = map.moveDownRight(pos);
        m = map.getHeight(pos);

        if (yBase - 2 * MAP_TILE_HEIGHT - 4 * Math.max(left, right) >= maxY) break;
      }
      gotoDown = false;

      /* down: */
      this.drawTriangleDown(xBase, yBase - 4 * m, m, left, right, pos, tile);

      yBase += MAP_TILE_HEIGHT;

      /* move down */
      pos = map.moveDown(pos);

      left = map.getHeight(pos);
      right = map.getHeight(map.moveRight(pos));
    }
  }

  // PORT: not in the C++, where landscape_tiles.clear() deletes the frames
  // of the tiles (std::unique_ptr).
  protected clearLandscapeTiles(): void {
    for (const tile of this.landscapeTiles.values()) {
      tile.frame.destroy();
    }
    this.landscapeTiles.clear();
  }

  protected override layout(): void {
    /* Keep the map position in the middle of the view when the size
       changes (window resize, zoom). */
    if (this.lastWidth !== 0 && this.lastHeight !== 0) {
      this.moveByPixels(idiv(this.lastWidth - this.width, 2),
                        idiv(this.lastHeight - this.height, 2));
    }
    this.lastWidth = this.width;
    this.lastHeight = this.height;
    this.clearLandscapeTiles();
  }

  override invalidate(): void {
    super.invalidate();
    this.clearLandscapeTiles();
  }

  redrawMapPos(pos: MapPos): void {
    const map = this.map;
    const [mx, my] = this.mapPixFromMapCoord(pos, map.getHeight(pos));

    const horizTiles = idiv(map.getCols(), MAP_TILE_COLS);
    const vertTiles = idiv(map.getRows(), MAP_TILE_ROWS);

    const tileWidth = MAP_TILE_COLS * MAP_TILE_WIDTH;
    const tileHeight = MAP_TILE_ROWS * MAP_TILE_HEIGHT;

    const tc = idiv(mx, tileWidth) % horizTiles;
    const tr = idiv(my, tileHeight) % vertTiles;
    const tid = tc + horizTiles * tr;

    const it = this.landscapeTiles.get(tid);
    if (it !== undefined) {
      it.frame.destroy();
      this.landscapeTiles.delete(tid);
    }
  }

  protected getTileFrame(tid: number, tc: number, tr: number): Frame {
    const map = this.map;
    const it = this.landscapeTiles.get(tid);
    if (it !== undefined) {
      it.lastUse = this.tileUseCounter;
      return it.frame;
    }

    const tileWidth = MAP_TILE_COLS * MAP_TILE_WIDTH;
    const tileHeight = MAP_TILE_ROWS * MAP_TILE_HEIGHT;

    const tileFrame = Graphics.getInstance().createFrame(tileWidth, tileHeight);
    tileFrame.fillRect(0, 0, tileWidth, tileHeight, Color.black);

    const col = (tc * MAP_TILE_COLS + idiv(tr * MAP_TILE_ROWS, 2)) % map.getCols();
    const row = tr * MAP_TILE_ROWS;
    let pos = map.pos(col, row);

    let xBase = -idiv(MAP_TILE_WIDTH, 2);

    /* Draw one extra column as half a column will be outside the
     map tile on both right and left side.. */
    for (let col = 0; col < MAP_TILE_COLS + 1; col++) {
      this.drawUpTileCol(pos, xBase, 0, tileHeight, tileFrame);
      this.drawDownTileCol(pos, xBase + idiv(MAP_TILE_WIDTH, 2), 0, tileHeight,
                           tileFrame);

      pos = map.moveRight(pos);
      xBase += MAP_TILE_WIDTH;
    }

    /* #if 0
    // Draw a border around the tile for debug.
    tileFrame.drawRect(0, 0, tileWidth, tileHeight, new Color(0xff, 0x00, 0x00));
    #endif */

    Log.Verbose('viewport', 'map: ', map.getCols() * MAP_TILE_WIDTH, ',',
                map.getRows() * MAP_TILE_HEIGHT, ', cols,rows: ',
                map.getCols(), ',', map.getRows(),
                ', tc,tr: ', tc, ',', tr, ', tw,th: ',
                tileWidth, ',', tileHeight);

    const tile: ViewportLandscapeTile = { frame: tileFrame, lastUse: this.tileUseCounter };
    this.landscapeTiles.set(tid, tile);

    return tile.frame;
  }

  /* Keep the tiles in view and those used most recently: up to three times
     the tiles in view, at least kMinCachedTiles (20 MB each 32 tiles). */
  protected trimTileCache(tilesInView: number): void {
    const kMinCachedTiles = 64;
    const limit = Math.max(kMinCachedTiles, 3 * tilesInView);
    while (this.landscapeTiles.size > limit) {
      // PORT: the std::map is iterated in the order of the tile ids and the
      // first of the least recently used tiles is taken; the Map here is in
      // the order of insertion, so of those tiles the one with the lowest
      // id is taken.
      let oldestKey = -1;
      let oldest: ViewportLandscapeTile | null = null;
      for (const [key, tile] of this.landscapeTiles) {
        if (oldest === null || tile.lastUse < oldest.lastUse ||
            (tile.lastUse === oldest.lastUse && key < oldestKey)) {
          oldest = tile;
          oldestKey = key;
        }
      }
      if (oldest === null || oldest.lastUse === this.tileUseCounter) break;
      oldest.frame.destroy();
      this.landscapeTiles.delete(oldestKey);
    }
  }

  protected drawLandscape(): void {
    const map = this.map;
    const horizTiles = idiv(map.getCols(), MAP_TILE_COLS);
    const vertTiles = idiv(map.getRows(), MAP_TILE_ROWS);

    const tileWidth = MAP_TILE_COLS * MAP_TILE_WIDTH;
    const tileHeight = MAP_TILE_ROWS * MAP_TILE_HEIGHT;

    const mapWidth = map.getCols() * MAP_TILE_WIDTH;
    const mapHeight = map.getRows() * MAP_TILE_HEIGHT;

    this.tileUseCounter = u32(this.tileUseCounter + 1);
    let tilesInView = 0;

    let my = this.offsetY;
    let ly = 0;
    let xBase = 0;
    while (ly < this.height) {
      while (my >= mapHeight) {
        my -= mapHeight;
        xBase += idiv(map.getRows() * MAP_TILE_WIDTH, 2);
      }

      const ty = my % tileHeight;

      let lx = 0;
      let mx = (this.offsetX + xBase) % mapWidth;
      while (lx < this.width) {
        const tx = mx % tileWidth;

        const tc = idiv(mx, tileWidth) % horizTiles;
        const tr = idiv(my, tileHeight) % vertTiles;
        const tid = tc + horizTiles * tr;

        const tileFrame = this.getTileFrame(tid, tc, tr);
        tilesInView++;

        let w = tileWidth - tx;
        if (lx + w > this.width) {
          w = this.width - lx;
        }
        let h = tileHeight - ty;
        if (ly + h > this.height) {
          h = this.height - ly;
        }

        this.frame!.drawFrame(lx, ly, tx, ty, tileFrame, w, h);
        lx += tileWidth - tx;
        mx += tileWidth - tx;
      }

      ly += tileHeight - ty;
      my += tileHeight - ty;
    }

    this.trimTileCache(tilesInView);
  }

  protected drawPathSegment(lx: number, ly: number, pos: MapPos, dir: Direction): void {
    const map = this.map;
    const h1 = map.getHeight(pos);
    const h2 = map.getHeight(map.move(pos, dir));
    const hDiff = h1 - h2;

    let t1: MapTerrain;
    let t2: MapTerrain;
    let h3: number;
    let h4: number;
    let hDiff2: number;

    switch (dir) {
      case DirectionRight:
        ly -= 4 * Math.max(h1, h2) + 2;
        t1 = map.typeDown(pos);
        t2 = map.typeUp(map.moveUp(pos));
        h3 = map.getHeight(map.moveUp(pos));
        h4 = map.getHeight(map.moveDownRight(pos));
        hDiff2 = (h3 - h4) - 4 * hDiff;
        break;
      case DirectionDownRight:
        ly -= 4 * h1 + 2;
        t1 = map.typeUp(pos);
        t2 = map.typeDown(pos);
        h3 = map.getHeight(map.moveRight(pos));
        h4 = map.getHeight(map.moveDown(pos));
        hDiff2 = 2 * (h3 - h4);
        break;
      case DirectionDown:
        lx -= idiv(MAP_TILE_WIDTH, 2);
        ly -= 4 * h1 + 2;
        t1 = map.typeUp(pos);
        t2 = map.typeDown(map.moveLeft(pos));
        h3 = map.getHeight(map.moveLeft(pos));
        h4 = map.getHeight(map.moveDown(pos));
        hDiff2 = 4 * hDiff - h3 + h4;
        break;
      default:
        NOT_REACHED();
        break;
    }

    const mask = hDiff + 4 + dir * 9;
    let sprite = 0;
    const type: MapTerrain = Math.max(t1, t2);

    if (hDiff2 > 4) {
      sprite = 0;
    } else if (hDiff2 > -6) {
      sprite = 1;
    } else {
      sprite = 2;
    }

    if (type <= MapTerrain.TerrainWater3) {
      sprite = 9;
    } else if (type >= MapTerrain.TerrainSnow0) {
      sprite += 6;
    } else if (type >= MapTerrain.TerrainDesert0) {
      sprite += 3;
    }

    this.frame!.drawMaskedSprite(lx, ly,
                                 Data.Resource.AssetPathMask, mask,
                                 Data.Resource.AssetPathGround, sprite);
  }

  protected drawBorderSegment(lx: number, ly: number, pos: MapPos, dir: Direction): void {
    const map = this.map;
    const h1 = map.getHeight(pos);
    const h2 = map.getHeight(map.move(pos, dir));
    const hDiff = h2 - h1;

    let t1: MapTerrain;
    let t2: MapTerrain;
    let h3: number;
    let h4: number;
    let hDiff2: number;

    switch (dir) {
      case DirectionRight:
        lx += idiv(MAP_TILE_WIDTH, 2);
        ly -= 2 * (h1 + h2) + 4;
        t1 = map.typeDown(pos);
        t2 = map.typeUp(map.moveUp(pos));
        h3 = map.getHeight(map.moveUp(pos));
        h4 = map.getHeight(map.moveDownRight(pos));
        hDiff2 = h3 - h4 + 4 * hDiff;
        break;
      case DirectionDownRight:
        lx += idiv(MAP_TILE_WIDTH, 4);
        ly -= 2 * (h1 + h2) - 6;
        t1 = map.typeUp(pos);
        t2 = map.typeDown(pos);
        h3 = map.getHeight(map.moveRight(pos));
        h4 = map.getHeight(map.moveDown(pos));
        hDiff2 = 2 * (h3 - h4);
        break;
      case DirectionDown:
        lx -= idiv(MAP_TILE_WIDTH, 4);
        ly -= 2 * (h1 + h2) - 6;
        t1 = map.typeUp(pos);
        t2 = map.typeDown(map.moveLeft(pos));
        h3 = map.getHeight(map.moveLeft(pos));
        h4 = map.getHeight(map.moveDown(pos));
        hDiff2 = 4 * hDiff - h3 + h4;
        break;
      default:
        NOT_REACHED();
        break;
    }

    let sprite = 0;
    const type: MapTerrain = Math.max(t1, t2);

    if (hDiff2 > 1) {
      sprite = 0;
    } else if (hDiff2 > -9) {
      sprite = 1;
    } else {
      sprite = 2;
    }

    if (type <= MapTerrain.TerrainWater3) {
      sprite = 9; /* Bouy */
    } else if (type >= MapTerrain.TerrainSnow0) {
      sprite += 6;
    } else if (type >= MapTerrain.TerrainDesert0) {
      sprite += 3;
    }

    this.frame!.drawSprite(lx, ly, Data.Resource.AssetMapBorder, sprite, false);
  }

  // PORT: the out-parameters x_off, y_off, col and row are returned with
  // the position: [pos, xOff, yOff, col, row].
  protected getOffset(): [MapPos, number, number, number, number] {
    const map = this.map;
    // PORT: `| 0` turns the -0 of the JS remainder into 0.
    const xOff = (-(this.offsetX + 16 * idiv(this.offsetY, 20)) % 32) | 0;
    const yOff = (-this.offsetY % 20) | 0;
    const col0 = idiv(idiv(this.offsetX, 16) + idiv(this.offsetY, 20), 2) & map.getColMask();
    const row0 = idiv(this.offsetY, MAP_TILE_HEIGHT) & map.getRowMask();

    return [map.pos(col0, row0), xOff, yOff, col0, row0];
  }

  protected drawPathsAndBorders(): void {
    const map = this.map;
    // eslint-disable-next-line prefer-const
    let [basePos, xOff, yOff] = this.getOffset();

    for (let xBase = xOff; xBase < this.width + MAP_TILE_WIDTH;
         xBase += MAP_TILE_WIDTH) {
      let pos = basePos;
      let yBase = yOff;
      let row = 0;

      while (true) {
        let lx: number;
        if (row % 2 === 0) {
          lx = xBase;
        } else {
          lx = xBase - idiv(MAP_TILE_WIDTH, 2);
        }

        const ly = yBase - 4 * map.getHeight(pos);
        if (ly >= this.height) break;

        /* For each direction right, down right and down,
           draw the corresponding paths and borders. */
        for (const d of cycleDirectionsCw(DirectionRight, 3)) {
          const otherPos = map.move(pos, d);

          if (map.hasPath(pos, d)) {
            this.drawPathSegment(lx, yBase, pos, d);
          } else if (map.hasOwner(pos) !== map.hasOwner(otherPos) ||
                     map.getOwner(pos) !== map.getOwner(otherPos)) {
            this.drawBorderSegment(lx, yBase, pos, d);
          }
        }
        /* #if 0
        for (int d = DIR_RIGHT; d <= DIR_UP_RIGHT; d++) {
          if (map->has_path(pos, (dir_t)d)) {
            int x, y;
            screen_pix_from_map_coord(pos, &x, &y);
            int x1, y1;
            screen_pix_from_map_coord(map->move(pos, (dir_t)d), &x1, &y1);
            frame->draw_line(x, y, x1, y1, 76);
          }
        }
        #endif */
        if (row % 2 === 0) {
          pos = map.moveDown(pos);
        } else {
          pos = map.moveDownRight(pos);
        }

        yBase += MAP_TILE_HEIGHT;
        row += 1;
      }

      basePos = map.moveRight(basePos);
    }

    /* If we're in road construction mode, also draw
       the temporarily placed roads. */
    if (this.interface.isBuildingRoad()) {
      const road = this.interface.getBuildingRoad();
      let pos = road.getSource();
      for (const dir of road.getDirs()) {
        let drawPos = pos;
        let drawDir = dir;
        if (drawDir > DirectionDown) {
          drawPos = map.move(pos, dir);
          drawDir = reverseDirection(dir);
        }

        const [sx, sy] = this.screenPixFromMapCoord(drawPos);

        this.drawPathSegment(sx, sy + 4 * map.getHeight(drawPos), drawPos,
                             drawDir);

        pos = map.move(pos, dir);
      }
    }
  }

  protected drawGameSprite(lx: number, ly: number, index: number): void {
    this.frame!.drawSprite(lx, ly, Data.Resource.AssetGameObject, index - 1, true);
  }

  protected drawSerf(lx: number, ly: number, color: Color, head: number, body: number): void {
    this.frame!.drawSprite(lx, ly, Data.Resource.AssetSerfTorso, body, true, color);

    if (head >= 0) {
      this.frame!.drawSpriteRelatively(lx, ly, Data.Resource.AssetSerfHead, head,
                                       Data.Resource.AssetSerfTorso, body);
    }
  }

  protected drawShadowAndBuildingSprite(lx: number, ly: number, index: number,
                                        color: Color = Color.transparent): void {
    this.frame!.drawSprite(lx, ly, Data.Resource.AssetMapShadow, index, true);
    this.frame!.drawSprite(lx, ly, Data.Resource.AssetMapObject, index, true, color);
  }

  protected drawShadowAndBuildingUnfinished(lx: number, ly: number, index: number,
                                            progress: number): void {
    const p = Math.fround(Math.fround(progress) / Math.fround(0xffff));
    this.frame!.drawSprite(lx, ly, Data.Resource.AssetMapShadow, index, true, p);
    this.frame!.drawSprite(lx, ly, Data.Resource.AssetMapObject, index, true, p);
  }

  protected drawBuildingUnfinished(building: Building, bldType: BuildingType,
                                   lx: number, ly: number): void {
    if (building.getProgress() === 0) { /* Draw cross */
      this.drawShadowAndBuildingSprite(lx, ly, 0x90);
    } else {
      /* Stone waiting */
      const stone = building.waitingStone();
      for (let i = 0; i < stone; i++) {
        this.drawGameSprite(lx + 10 - i * 3, ly - 8 + i, 1 + ResourceType.TypeStone);
      }

      /* Planks waiting */
      const planks = building.waitingPlanks();
      for (let i = 0; i < planks; i++) {
        this.drawGameSprite(lx + 12 - i * 3, ly - 6 + i, 1 + ResourceType.TypePlank);
      }

      if (BIT_TEST(building.getProgress(), 15)) { /* Frame finished */
        this.drawShadowAndBuildingSprite(lx, ly,
                                         mapBuildingFrameSprite[bldType]);
        this.drawShadowAndBuildingUnfinished(lx, ly, mapBuildingSprite[bldType],
                                             2 * (building.getProgress() & 0x7fff));
      } else {
        this.drawShadowAndBuildingSprite(lx, ly, 0x91); /* corner stone */
        if (building.getProgress() > 1) {
          this.drawShadowAndBuildingUnfinished(lx, ly,
                                               mapBuildingFrameSprite[bldType],
                                               2 * building.getProgress());
        }
      }
    }
  }

  protected drawOcupationFlag(building: Building, lx: number, ly: number, mul: number): void {
    if (building.hasKnight()) {
      this.drawGameSprite(lx, ly -
                          Math.trunc(Math.fround(Math.fround(mul) * building.getKnightCount())),
                          182 + ((this.interface.getGame().getTick() >>> 3) & 3) +
                          4 * Math.trunc(building.getThreatLevel()));
    }
  }

  protected drawUnharmedBuilding(building: Building, lx: number, ly: number): void {
    /* Use the persistent generator of the interface: a new Random is seeded
       from time() and gives the same values for a whole second. */
    const random = this.interface.getRandom();

    if (building.isDone()) {
      const type = building.getType();
      switch (type) {
        case BuildingType.TypeFisher:
        case BuildingType.TypeLumberjack:
        case BuildingType.TypeStonecutter:
        case BuildingType.TypeForester:
        case BuildingType.TypeStock:
        case BuildingType.TypeFarm:
        case BuildingType.TypeButcher:
        case BuildingType.TypeSawmill:
        case BuildingType.TypeToolMaker:
        case BuildingType.TypeCastle:
          this.drawShadowAndBuildingSprite(lx, ly, mapBuildingSprite[type]);
          break;
        case BuildingType.TypeBoatbuilder:
          this.drawShadowAndBuildingSprite(lx, ly, mapBuildingSprite[type]);
          if (building.getResCountInStock(1) > 0) {
            /* TODO x might not be correct */
            this.drawGameSprite(lx + 3, ly + 13,
                                174 + building.getResCountInStock(1));
          }
          break;
        case BuildingType.TypeStoneMine:
        case BuildingType.TypeCoalMine:
        case BuildingType.TypeIronMine:
        case BuildingType.TypeGoldMine:
          if (building.isActive()) { /* Draw elevator up */
            this.drawGameSprite(lx - 6, ly - 39, 152);
          }
          if (building.isPlayingSfx()) { /* Draw elevator down */
            this.drawGameSprite(lx - 6, ly - 39, 153);
            const pos = building.getPosition();
            // PORT: reinterpret_cast<uint8_t*>(&pos)[1] is the second byte
            // of the position (little endian).
            if (((u32(this.interface.getGame().getTick() +
                      ((pos >>> 8) & 0xff)) >>> 3) & 7) === 0 &&
                random.random() < 40000) {
              this.playSound(AudioTypeSfx.TypeSfxElevator);
            }
          }
          this.drawShadowAndBuildingSprite(lx, ly, mapBuildingSprite[type]);
          break;
        case BuildingType.TypeHut:
          this.drawShadowAndBuildingSprite(lx, ly, mapBuildingSprite[type]);
          this.drawOcupationFlag(building, lx - 14, ly + 2, 2);
          break;
        case BuildingType.TypePigFarm:
          this.drawShadowAndBuildingSprite(lx, ly, mapBuildingSprite[type]);
          if (building.getResCountInStock(1) > 0) {
            if ((random.random() & 0x7f) <
                Math.trunc(building.getResCountInStock(1))) {
              this.playSound(AudioTypeSfx.TypeSfxPigOink);
            }

            const pigsCount = building.getResCountInStock(1);

            for (let p = 1; p <= 8; p++) {
              if (pigsCount >= pigsLayout[p * 4]) {
                const i = (pigsLayout[p * 4 + 1] +
                           (this.interface.getGame().getTick() >>> 3)) & 0xfe;
                this.drawGameSprite(lx + pigfarmAnim[i + 1] + pigsLayout[p * 4 + 2],
                                    ly + pigsLayout[p * 4 + 3], pigfarmAnim[i]);
              }
            }
          }
          break;
        case BuildingType.TypeMill:
          if (building.isActive()) {
            if ((this.interface.getGame().getTick() >>> 4) & 3) {
              building.stopPlayingSfx();
            } else if (!building.isPlayingSfx()) {
              building.startPlayingSfx();
              this.playSound(AudioTypeSfx.TypeSfxMillGrinding);
            }
            this.drawShadowAndBuildingSprite(lx, ly, mapBuildingSprite[type] +
                                    ((this.interface.getGame().getTick() >>> 4) & 3));
          } else {
            this.drawShadowAndBuildingSprite(lx, ly, mapBuildingSprite[type]);
          }
          break;
        case BuildingType.TypeBaker:
          this.drawShadowAndBuildingSprite(lx, ly, mapBuildingSprite[type]);
          if (building.isActive()) {
            this.drawGameSprite(lx + 5, ly - 21,
                                154 + ((this.interface.getGame().getTick() >>> 3) & 7));
          }
          break;
        case BuildingType.TypeSteelSmelter:
          this.drawShadowAndBuildingSprite(lx, ly, mapBuildingSprite[type]);
          if (building.isActive()) {
            const i = (this.interface.getGame().getTick() >>> 3) & 7;
            if (i === 0 || (i === 7 && !building.isPlayingSfx())) {
              building.startPlayingSfx();
              this.playSound(AudioTypeSfx.TypeSfxGoldBoils);
            } else if (i !== 7) {
              building.stopPlayingSfx();
            }

            this.drawGameSprite(lx + 6, ly - 32, 128 + i);
          }
          break;
        case BuildingType.TypeWeaponSmith:
          this.drawShadowAndBuildingSprite(lx, ly, mapBuildingSprite[type]);
          if (building.isActive()) {
            this.drawGameSprite(lx - 16, ly - 21,
                                128 + ((this.interface.getGame().getTick() >>> 3) & 7));
          }
          break;
        case BuildingType.TypeTower:
          this.drawShadowAndBuildingSprite(lx, ly, mapBuildingSprite[type]);
          this.drawOcupationFlag(building, lx + 13, ly - 18, 1);
          break;
        case BuildingType.TypeFortress:
          this.drawShadowAndBuildingSprite(lx, ly, mapBuildingSprite[type]);
          this.drawOcupationFlag(building, lx - 12, ly - 21, 0.5);
          if (building.hasKnight()) {
            this.drawGameSprite(lx + 22, ly - 34 - idiv(building.getKnightCount() + 1, 2),
                        182 + (((this.interface.getGame().getTick() >>> 3) + 2) & 3) +
                                4 * Math.trunc(building.getThreatLevel()));
          }
          break;
        case BuildingType.TypeGoldSmelter:
          this.drawShadowAndBuildingSprite(lx, ly, mapBuildingSprite[type]);
          if (building.isActive()) {
            const i = (this.interface.getGame().getTick() >>> 3) & 7;
            if (i === 0 || (i === 7 && !building.isPlayingSfx())) {
              building.startPlayingSfx();
              this.playSound(AudioTypeSfx.TypeSfxGoldBoils);
            } else if (i !== 7) {
              building.stopPlayingSfx();
            }

            this.drawGameSprite(lx - 7, ly - 33, 128 + i);
          }
          break;
        default:
          NOT_REACHED();
          break;
      }
    } else { /* unfinished building */
      if (building.getType() !== BuildingType.TypeCastle) {
        this.drawBuildingUnfinished(building, building.getType(), lx, ly);
      } else {
        this.drawShadowAndBuildingUnfinished(lx, ly, 0xb2,
                                             building.getProgress());
      }
    }
  }

  protected drawBurningBuilding(building: Building, lx: number, ly: number): void {
    /* Play sound effect. */
    if (((building.getBurningCounter() >> 3) & 3) === 3 &&
        !building.isPlayingSfx()) {
      building.startPlayingSfx();
      this.playSound(AudioTypeSfx.TypeSfxBurning);
    } else {
      building.stopPlayingSfx();
    }

    // PORT: the C++ sets the tick of the building and decreases its burning
    // counter here (building->set_tick(), decrease_burning_counter(), with
    // the TODO "this is also done in update_buildings()"), and sets the
    // counter to 0 when it has run out. Drawing must not change the game
    // (the two sides of a network game draw different parts of the map), so
    // the counter as of this tick is worked out and the building is left
    // alone: Building::update() does the same count down.
    const delta = u16(this.interface.getGame().getTick() - building.getTick());

    if (building.getBurningCounter() >= delta) {
      const burningCounter = building.getBurningCounter() - delta;
      this.drawUnharmedBuilding(building, lx, ly);

      let type = 0;
      if (building.isDone() ||
          building.getProgress() >= 16000) {
        type = building.getType();
      }

      let offset = ((burningCounter >> 3) & 7) ^ 7;
      // PORT: the pointer anim is an index into building_burn_animation.
      let anim = buildingAnimOffsetFromType[type];
      while (buildingBurnAnimation[anim] >= 0) {
        this.drawGameSprite(lx + buildingBurnAnimation[anim + 1],
                            ly + buildingBurnAnimation[anim + 2],
                            136 + buildingBurnAnimation[anim] + offset);
        offset = (offset + 3) & 7;
        anim += 3;
      }
    }
  }

  protected drawBuilding(pos: MapPos, lx: number, ly: number): void {
    const building = this.interface.getGame().getBuildingAtPos(pos)!;

    if (building.isBurning()) {
      this.drawBurningBuilding(building, lx, ly);
    } else {
      this.drawUnharmedBuilding(building, lx, ly);
    }
  }

  protected drawWaterWaves(pos: MapPos, lx: number, ly: number): void {
    const map = this.map;
    const sprite = (((pos ^ 5) + (this.interface.getGame().getTick() >>> 3)) & 0xf);

    if (map.typeDown(pos) <= MapTerrain.TerrainWater3 &&
        map.typeUp(pos) <= MapTerrain.TerrainWater3) {
      this.frame!.drawWavesSprite(lx - 16, ly, Data.Resource.AssetNone, 0,
                                  Data.Resource.AssetMapWaves, sprite);
    } else if (map.typeDown(pos) <= MapTerrain.TerrainWater3) {
      this.frame!.drawWavesSprite(lx, ly + 16, Data.Resource.AssetMapMaskDown, 40,
                                  Data.Resource.AssetMapWaves, sprite);
    } else {
      this.frame!.drawWavesSprite(lx - 16, ly, Data.Resource.AssetMapMaskUp, 40,
                                  Data.Resource.AssetMapWaves, sprite);
    }
  }

  protected drawWaterWavesRow(pos: MapPos, yBase: number, cols: number,
                              xBase: number): void {
    const map = this.map;
    for (let i = 0; i < cols; i++, xBase += MAP_TILE_WIDTH,
         pos = map.moveRight(pos)) {
      if (map.typeUp(pos) <= MapTerrain.TerrainWater3 ||
          map.typeDown(pos) <= MapTerrain.TerrainWater3) {
        this.waterInView += 1;
        this.drawWaterWaves(pos, xBase, yBase);
      }
    }
  }

  protected drawFlagAndRes(pos: MapPos, lx: number, ly: number): void {
    const flag = this.interface.getGame().getFlagAtPos(pos)!;

    for (let i = 0; i < 3; i++) {
      if (flag.getResourceAtSlot(i) !== ResourceType.TypeNone) {
        this.drawGameSprite(lx + resPos[i * 2], ly + resPos[i * 2 + 1],
                            flag.getResourceAtSlot(i) + 1);
      }
    }

    const plNum = flag.getOwner();
    const playerColor = this.interface.getPlayerColor(plNum);
    const spr = 0x80 + ((this.interface.getGame().getTick() >>> 3) & 3);

    this.drawShadowAndBuildingSprite(lx, ly, spr, playerColor);

    for (let i = 3; i < 8; i++) {
      if (flag.getResourceAtSlot(i) !== ResourceType.TypeNone) {
        this.drawGameSprite(lx + resPos[i * 2], ly + resPos[i * 2 + 1],
          flag.getResourceAtSlot(i) + 1);
      }
    }
  }

  protected drawMapObjectsRow(pos: MapPos, yBase: number, cols: number, xBase: number): void {
    const map = this.map;
    for (let i = 0; i < cols;
         i++, xBase += MAP_TILE_WIDTH, pos = map.moveRight(pos)) {
      if (map.getObj(pos) === MapObject.ObjectNone) continue;

      const ly = yBase - 4 * map.getHeight(pos);
      if (map.getObj(pos) < MapObject.ObjectTree0) {
        if (map.getObj(pos) === MapObject.ObjectFlag) {
          this.drawFlagAndRes(pos, xBase, ly);
        } else if (map.getObj(pos) <= MapObject.ObjectCastle) {
          this.drawBuilding(pos, xBase, ly);
        }
      } else {
        let sprite = map.getObj(pos) - MapObject.ObjectTree0;
        if (sprite < 24) {
          /* Trees */
          this.treesInView += 1;

          /* Adding sprite number to animation ensures
             that the tree animation won't be synchronized
             for all trees on the map. */
          const treeAnim = u32(this.interface.getGame().getTick() + sprite) >>> 4;
          if (sprite < 16) {
            sprite = (sprite & ~7) + (treeAnim & 7);
          } else {
            sprite = (sprite & ~3) + (treeAnim & 3);
          }
        }
        this.drawShadowAndBuildingSprite(xBase, ly, sprite);
      }
    }
  }

  /* Draw one individual serf in the row. */
  protected drawRowSerf(lx: number, ly: number, shadow: boolean, color: Color,
                        body: number): void {
    /* Shadow */
    if (shadow) {
      this.frame!.drawSprite(lx, ly, Data.Resource.AssetSerfShadow, 0, true);
    }

    const hi = ((body >> 8) & 0xff) * 2;
    const lo = (body & 0xff) * 2;

    let base = index1[hi];
    let head = index1[hi + 1];

    if (head < 0) {
      base += index2[lo];
    } else {
      base += index2[lo];
      head += index2[lo + 1];
    }

    this.drawSerf(lx, ly, color, head, base);
  }

  /* Extracted from obsolete update_map_serf_rows(). */
  /* Translate serf type into the corresponding sprite code. */
  protected serfGetBody(serf: Serf): number {
    const animation = this.dataSource.getAnimation(serf.getAnimation(),
                                                   serf.getCounter());
    let t = animation.sprite;

    switch (serf.getType()) {
      case SerfType.TypeTransporter:
      case SerfType.TypeGeneric:
        if (serf.getState() === SerfState.StateIdleOnPath) {
          return -1;
        } else if ((serf.getState() === SerfState.StateTransporting ||
                    serf.getState() === SerfState.StateDelivering) &&
                   serf.getDelivery() !== 0) {
          t += transporterType[serf.getDelivery()];
        }
        break;
      case SerfType.TypeSailor:
        if (serf.getState() === SerfState.StateTransporting && t < 0x80) {
          if (((t & 7) === 4 && !serf.playingSfx()) ||
              (t & 7) === 3) {
            serf.startPlayingSfx();
            this.playSound(AudioTypeSfx.TypeSfxRowing);
          } else {
            serf.stopPlayingSfx();
          }
        }

        if ((serf.getState() === SerfState.StateTransporting &&
             serf.getDelivery() === 0) ||
            serf.getState() === SerfState.StateLostSailor ||
            serf.getState() === SerfState.StateFreeSailing) {
          if (t < 0x80) {
            if (((t & 7) === 4 && !serf.playingSfx()) ||
                (t & 7) === 3) {
              serf.startPlayingSfx();
              this.playSound(AudioTypeSfx.TypeSfxRowing);
            } else {
              serf.stopPlayingSfx();
            }
          }
          t += 0x200;
        } else if (serf.getState() === SerfState.StateTransporting) {
          t += sailorType[serf.getDelivery()];
        } else {
          t += 0x100;
        }
        break;
      case SerfType.TypeDigger:
        if (t < 0x80) {
          t += 0x300;
        } else if (t === 0x83 || t === 0x84) {
          if (t === 0x83 || !serf.playingSfx()) {
            serf.startPlayingSfx();
            this.playSound(AudioTypeSfx.TypeSfxDigging);
          }
          t += 0x380;
        } else {
          serf.stopPlayingSfx();
          t += 0x380;
        }
        break;
      case SerfType.TypeBuilder:
        if (t < 0x80) {
          t += 0x500;
        } else if ((t & 7) === 4 || (t & 7) === 5) {
          if ((t & 7) === 4 || !serf.playingSfx()) {
            serf.startPlayingSfx();
            this.playSound(AudioTypeSfx.TypeSfxHammerBlow);
          }
          t += 0x580;
        } else {
          serf.stopPlayingSfx();
          t += 0x580;
        }
        break;
      case SerfType.TypeTransporterInventory:
        if (serf.getState() === SerfState.StateBuildingCastle) {
          return -1;
        } else {
          const res = serf.getDelivery();
          t += transporterType[res];
        }
        break;
      case SerfType.TypeLumberjack:
        if (t < 0x80) {
          if (serf.getState() === SerfState.StateFreeWalking &&
              serf.getFreeWalkingNegDist1() === -128 &&
              serf.getFreeWalkingNegDist2() === 1) {
            t += 0x1000;
          } else {
            t += 0xb00;
          }
        } else if ((t === 0x86 && !serf.playingSfx()) ||
             t === 0x85) {
          serf.startPlayingSfx();
          this.playSound(AudioTypeSfx.TypeSfxAxBlow);
          /* TODO Dangerous reference to unknown state vars.
             It is probably free walking. */
          if (serf.getFreeWalkingNegDist2() === 0 &&
              serf.getCounter() < 64) {
            this.playSound(AudioTypeSfx.TypeSfxTreeFall);
          }
          t += 0xe80;
        } else if (t !== 0x86) {
          serf.stopPlayingSfx();
          t += 0xe80;
        }
        break;
      case SerfType.TypeSawmiller:
        if (t < 0x80) {
          if (serf.getState() === SerfState.StateLeavingBuilding &&
              serf.getLeavingBuildingNextState() ===
                SerfState.StateDropResourceOut) {
            t += 0x1700;
          } else {
            t += 0xc00;
          }
        } else {
          /* player_num += 4; ??? */
          if (t === 0xb3 || t === 0xbb || t === 0xc3 || t === 0xcb ||
              (!serf.playingSfx() && (t === 0xb7 || t === 0xbf ||
                    t === 0xc7 || t === 0xcf))) {
            serf.startPlayingSfx();
            this.playSound(AudioTypeSfx.TypeSfxSawing);
          } else if (t !== 0xb7 && t !== 0xbf && t !== 0xc7 && t !== 0xcf) {
            serf.stopPlayingSfx();
          }
          t += 0x1580;
        }
        break;
      case SerfType.TypeStonecutter:
        if (t < 0x80) {
          if ((serf.getState() === SerfState.StateFreeWalking &&
               serf.getFreeWalkingNegDist1() === -128 &&
               serf.getFreeWalkingNegDist2() === 1) ||
              (serf.getState() === SerfState.StateStoneCutting &&
               serf.getFreeWalkingNegDist1() === 2)) {
            t += 0x1200;
          } else {
            t += 0xd00;
          }
        } else if (t === 0x85 || (t === 0x86 && !serf.playingSfx())) {
          serf.startPlayingSfx();
          this.playSound(AudioTypeSfx.TypeSfxPickBlow);
          t += 0x1280;
        } else if (t !== 0x86) {
          serf.stopPlayingSfx();
          t += 0x1280;
        }
        break;
      case SerfType.TypeForester:
        if (t < 0x80) {
          t += 0xe00;
        } else if (t === 0x86 || (t === 0x87 && !serf.playingSfx())) {
          serf.startPlayingSfx();
          this.playSound(AudioTypeSfx.TypeSfxPlanting);
          t += 0x1080;
        } else if (t !== 0x87) {
          serf.stopPlayingSfx();
          t += 0x1080;
        }
        break;
      case SerfType.TypeMiner:
        if (t < 0x80) {
          if ((serf.getState() !== SerfState.StateMining ||
               serf.getMiningRes() === 0) &&
              (serf.getState() !== SerfState.StateLeavingBuilding ||
               serf.getLeavingBuildingNextState() !==
               SerfState.StateDropResourceOut)) {
            t += 0x1800;
          } else {
            let res: number = ResourceType.TypeNone;

            switch (serf.getState()) {
              case SerfState.StateMining:
                res = serf.getMiningRes() - 1;
                break;
              case SerfState.StateLeavingBuilding:
                res = serf.getLeavingBuildingFieldB() - 1;
                break;
              default:
                NOT_REACHED();
                break;
            }

            switch (res) {
              case ResourceType.TypeStone: t += 0x2700; break;
              case ResourceType.TypeIronOre: t += 0x2500; break;
              case ResourceType.TypeCoal: t += 0x2600; break;
              case ResourceType.TypeGoldOre: t += 0x2400; break;
              default: NOT_REACHED(); break;
            }
          }
        } else {
          t += 0x2a80;
        }
        break;
      case SerfType.TypeSmelter:
        if (t < 0x80) {
          if (serf.getState() === SerfState.StateLeavingBuilding &&
              serf.getLeavingBuildingNextState() ===
              SerfState.StateDropResourceOut) {
            if (serf.getLeavingBuildingFieldB() === 1 + ResourceType.TypeSteel) {
              t += 0x2900;
            } else {
              t += 0x2800;
            }
          } else {
            t += 0x1900;
          }
        } else {
          /* edi10 += 4; */
          t += 0x2980;
        }
        break;
      case SerfType.TypeFisher:
        if (t < 0x80) {
          if (serf.getState() === SerfState.StateFreeWalking &&
              serf.getFreeWalkingNegDist1() === -128 &&
              serf.getFreeWalkingNegDist2() === 1) {
            t += 0x2f00;
          } else {
            t += 0x2c00;
          }
        } else {
          if (t !== 0x80 && t !== 0x87 && t !== 0x88 && t !== 0x8f) {
            this.playSound(AudioTypeSfx.TypeSfxFishingRodReel);
          }

          /* TODO no check for state */
          if (serf.getFreeWalkingNegDist2() === 1) {
            t += 0x2d80;
          } else {
            t += 0x2c80;
          }
        }
        break;
      case SerfType.TypePigFarmer:
        if (t < 0x80) {
          if (serf.getState() === SerfState.StateLeavingBuilding &&
              serf.getLeavingBuildingNextState() ===
                SerfState.StateDropResourceOut) {
            t += 0x3400;
          } else {
            t += 0x3200;
          }
        } else {
          t += 0x3280;
        }
        break;
      case SerfType.TypeButcher:
        if (t < 0x80) {
          if (serf.getState() === SerfState.StateLeavingBuilding &&
              serf.getLeavingBuildingNextState() ===
                SerfState.StateDropResourceOut) {
            t += 0x3a00;
          } else {
            t += 0x3700;
          }
        } else {
          /* edi10 += 4; */
          if ((t === 0xb2 || t === 0xba || t === 0xc2 || t === 0xca) &&
              !serf.playingSfx()) {
            serf.startPlayingSfx();
            this.playSound(AudioTypeSfx.TypeSfxBackswordBlow);
          } else if (t !== 0xb2 && t !== 0xba && t !== 0xc2 && t !== 0xca) {
            serf.stopPlayingSfx();
          }
          t += 0x3780;
        }
        break;
      case SerfType.TypeFarmer:
        if (t < 0x80) {
          if (serf.getState() === SerfState.StateFreeWalking &&
              serf.getFreeWalkingNegDist1() === -128 &&
              serf.getFreeWalkingNegDist2() === 1) {
            t += 0x4000;
          } else {
            t += 0x3d00;
          }
        } else {
          /* TODO access to state without state check */
          if (serf.getFreeWalkingNegDist1() === 0) {
            t += 0x3d80;
          } else if (t === 0x83 || (t === 0x84 && !serf.playingSfx())) {
            serf.startPlayingSfx();
            this.playSound(AudioTypeSfx.TypeSfxMowing);
            t += 0x3e80;
          } else if (t !== 0x83 && t !== 0x84) {
            serf.stopPlayingSfx();
            t += 0x3e80;
          }
        }
        break;
      case SerfType.TypeMiller:
        if (t < 0x80) {
          if (serf.getState() === SerfState.StateLeavingBuilding &&
              serf.getLeavingBuildingNextState() ===
                SerfState.StateDropResourceOut) {
            t += 0x4500;
          } else {
            t += 0x4300;
          }
        } else {
          /* edi10 += 4; */
          t += 0x4380;
        }
        break;
      case SerfType.TypeBaker:
        if (t < 0x80) {
          if (serf.getState() === SerfState.StateLeavingBuilding &&
              serf.getLeavingBuildingNextState() ===
                SerfState.StateDropResourceOut) {
            t += 0x4a00;
          } else {
            t += 0x4800;
          }
        } else {
          /* edi10 += 4; */
          t += 0x4880;
        }
        break;
      case SerfType.TypeBoatBuilder:
        if (t < 0x80) {
          if (serf.getState() === SerfState.StateLeavingBuilding &&
              serf.getLeavingBuildingNextState() ===
                SerfState.StateDropResourceOut) {
            t += 0x5000;
          } else {
            t += 0x4e00;
          }
        } else if (t === 0x84 || t === 0x85) {
          if (t === 0x84 || !serf.playingSfx()) {
            serf.startPlayingSfx();
            this.playSound(AudioTypeSfx.TypeSfxWoodHammering);
          }
          t += 0x4e80;
        } else {
          serf.stopPlayingSfx();
          t += 0x4e80;
        }
        break;
      case SerfType.TypeToolmaker:
        if (t < 0x80) {
          if (serf.getState() === SerfState.StateLeavingBuilding &&
              serf.getLeavingBuildingNextState() ===
                SerfState.StateDropResourceOut) {
            switch (serf.getLeavingBuildingFieldB() - 1) {
              case ResourceType.TypeShovel: t += 0x5a00; break;
              case ResourceType.TypeHammer: t += 0x5b00; break;
              case ResourceType.TypeRod: t += 0x5c00; break;
              case ResourceType.TypeCleaver: t += 0x5d00; break;
              case ResourceType.TypeScythe: t += 0x5e00; break;
              case ResourceType.TypeAxe: t += 0x6100; break;
              case ResourceType.TypeSaw: t += 0x6200; break;
              case ResourceType.TypePick: t += 0x6300; break;
              case ResourceType.TypePincer: t += 0x6400; break;
              default: NOT_REACHED(); break;
            }
          } else {
            t += 0x5800;
          }
        } else {
          /* edi10 += 4; */
          if (t === 0x83 || (t === 0xb2 && !serf.playingSfx())) {
            serf.startPlayingSfx();
            this.playSound(AudioTypeSfx.TypeSfxSawing);
          } else if (t === 0x87 || (t === 0xb6 && !serf.playingSfx())) {
            serf.startPlayingSfx();
            this.playSound(AudioTypeSfx.TypeSfxWoodHammering);
          } else if (t !== 0xb2 && t !== 0xb6) {
            serf.stopPlayingSfx();
          }
          t += 0x5880;
        }
        break;
      case SerfType.TypeWeaponSmith:
        if (t < 0x80) {
          if (serf.getState() === SerfState.StateLeavingBuilding &&
              serf.getLeavingBuildingNextState() ===
                SerfState.StateDropResourceOut) {
            if (serf.getLeavingBuildingFieldB() === 1 + ResourceType.TypeSword) {
              t += 0x5500;
            } else {
              t += 0x5400;
            }
          } else {
            t += 0x5200;
          }
        } else {
          /* edi10 += 4; */
          if (t === 0x83 || (t === 0x84 && !serf.playingSfx())) {
            serf.startPlayingSfx();
            this.playSound(AudioTypeSfx.TypeSfxMetalHammering);
          } else if (t !== 0x84) {
            serf.stopPlayingSfx();
          }
          t += 0x5280;
        }
        break;
      case SerfType.TypeGeologist:
        if (t < 0x80) {
          t += 0x3900;
        } else if (t === 0x83 || t === 0x84 || t === 0x86) {
          if (t === 0x83 || !serf.playingSfx()) {
            serf.startPlayingSfx();
            this.playSound(AudioTypeSfx.TypeSfxGeologistSampling);
          }
          t += 0x4c80;
        } else if (t === 0x8c || t === 0x8d) {
          if (t === 0x8c || !serf.playingSfx()) {
            serf.startPlayingSfx();
            this.playSound(AudioTypeSfx.TypeSfxResourceFound);
          }
          t += 0x4c80;
        } else {
          serf.stopPlayingSfx();
          t += 0x4c80;
        }
        break;
      case SerfType.TypeKnight0:
      case SerfType.TypeKnight1:
      case SerfType.TypeKnight2:
      case SerfType.TypeKnight3:
      case SerfType.TypeKnight4: {
        const k = serf.getType() - SerfType.TypeKnight0;

        if (t < 0x80) {
          t += 0x7800 + 0x100 * k;
        } else if (t < 0xc0) {
          if (serf.getState() === SerfState.StateKnightAttacking ||
              serf.getState() === SerfState.StateKnightAttackingFree) {
            if (serf.getCounter() >= 24 || serf.getCounter() < 8) {
              serf.stopPlayingSfx();
            } else if (!serf.playingSfx()) {
              serf.startPlayingSfx();
              if (serf.getAttackingFieldD() === 0 ||
                  serf.getAttackingFieldD() === 4) {
                this.playSound(AudioTypeSfx.TypeSfxFight01);
              } else if (serf.getAttackingFieldD() === 2) {
                /* TODO when is TypeSfxFight02 played? */
                this.playSound(AudioTypeSfx.TypeSfxFight03);
              } else {
                this.playSound(AudioTypeSfx.TypeSfxFight04);
              }
            }
          }

          t += 0x7cd0 + 0x200 * k;
        } else {
          t += 0x7d90 + 0x200 * k;
        }
      }
        break;
      case SerfType.TypeDead:
        if ((!serf.playingSfx() &&
             (t === 2 || t === 5)) ||
            (t === 1 || t === 4)) {
          serf.startPlayingSfx();
          this.playSound(AudioTypeSfx.TypeSfxSerfDying);
        } else {
          serf.stopPlayingSfx();
        }
        t += 0x8700;
        break;
      default:
        NOT_REACHED();
        break;
    }

    return t;
  }

  protected drawActiveSerf(serf: Serf, pos: MapPos, xBase: number, yBase: number): void {
    const map = this.map;

    if ((serf.getAnimation() < 0) || (serf.getAnimation() > 199) ||
        (serf.getCounter() < 0)) {
      Log.Error('viewport', 'bad animation for serf #', serf.getIndex(),
                ' (', Serf.getStateName(serf.getState()),
                '): ', serf.getAnimation(),
                ',', serf.getCounter());
      return;
    }

    const animation = this.dataSource.getAnimation(serf.getAnimation(),
                                                   serf.getCounter());

    const lx = xBase + animation.x;
    const ly = yBase + animation.y - 4 * map.getHeight(pos);
    const body = this.serfGetBody(serf);

    if (body > -1) {
      const color = this.interface.getPlayerColor(serf.getOwner());
      this.drawRowSerf(lx, ly, true, color, body);
      if (this.layers & ViewportLayer.LayerGrid) {
        this.frame!.drawNumber(lx, ly, serf.getIndex(), new Color(0, 0, 128));
        this.frame!.drawString(lx, ly + 8, serf.printState(), new Color(0, 0, 128));
      }
    }

    /* Draw additional serf */
    if (serf.getState() === SerfState.StateKnightEngagingBuilding ||
        serf.getState() === SerfState.StateKnightPrepareAttacking ||
        serf.getState() === SerfState.StateKnightAttacking ||
        serf.getState() === SerfState.StateKnightPrepareAttackingFree ||
        serf.getState() === SerfState.StateKnightAttackingFree ||
        serf.getState() === SerfState.StateKnightAttackingVictoryFree ||
        serf.getState() === SerfState.StateKnightAttackingDefeatFree ||
        serf.getState() === SerfState.StateKnightAttackingVictory) {
      const index = serf.getAttackingDefIndex();
      if (index !== 0) {
        const defSerf = this.interface.getGame().getSerf(index)!;

        const animation =
                             this.dataSource.getAnimation(defSerf.getAnimation(),
                                                          defSerf.getCounter());

        const lx = xBase + animation.x;
        const ly = yBase + animation.y - 4 * map.getHeight(pos);
        const body = this.serfGetBody(defSerf);

        if (body > -1) {
          const color = this.interface.getPlayerColor(defSerf.getOwner());
          this.drawRowSerf(lx, ly, true, color, body);
        }
      }
    }

    /* Draw extra objects for fight */
    if ((serf.getState() === SerfState.StateKnightAttacking ||
         serf.getState() === SerfState.StateKnightAttackingFree) &&
        animation.sprite >= 0x80 && animation.sprite < 0xc0) {
      const index = serf.getAttackingDefIndex();
      if (index !== 0) {
        const defSerf = this.interface.getGame().getSerf(index)!;

        if (serf.getAnimation() >= 146 && serf.getAnimation() < 156) {
          if ((serf.getAttackingFieldD() === 0 ||
               serf.getAttackingFieldD() === 4) &&
              serf.getCounter() < 32) {
            let anim = -1;
            if (serf.getAttackingFieldD() === 0) {
              anim = serf.getAnimation() - 147;
            } else {
              anim = defSerf.getAnimation() - 147;
            }

            const sprite = 198 + ((serf.getCounter() >> 3) ^ 3);
            this.drawGameSprite(lx + arr4[2 * anim], ly - arr4[2 * anim + 1], sprite);
          }
        }
      }
    }
  }

  /* Draw one row of serfs. The serfs are composed of two or three transparent
     sprites (arm, torso, possibly head). A shadow is also drawn if appropriate.
     Note that idle serfs do not have their serf_t object linked from the map
     so they are drawn seperately from active serfs. */
  protected drawSerfRow(pos: MapPos, yBase: number, cols: number, xBase: number): void {
    const map = this.map;
    for (let i = 0; i < cols;
         i++, xBase += MAP_TILE_WIDTH, pos = map.moveRight(pos)) {
      /* #if 0
      // Draw serf marker
      if (map->has_serf(pos)) {
        serf_t *serf = game->get_serf_at_pos(pos);
        int color = game.player[map->get_owner(pos)]->color;
        frame->fill_rect(x_base - 2, y_base - 4*MAP_HEIGHT(pos) - 2, 4, 4, color);
      }
      #endif */

      /* Active serf */
      if (map.hasSerf(pos)) {
        const serf = this.interface.getGame().getSerfAtPos(pos)!;

        if (serf.getState() !== SerfState.StateMining ||
            (serf.getMiningSubstate() !== 3 &&
             serf.getMiningSubstate() !== 4 &&
             serf.getMiningSubstate() !== 9 &&
             serf.getMiningSubstate() !== 10)) {
              this.drawActiveSerf(serf, pos, xBase, yBase);
            }
      }

      /* Idle serf */
      if (map.getIdleSerf(pos)) {
        let lx: number;
        let ly: number;
        let body: number;
        if (map.isInWater(pos)) { /* Sailor */
          lx = xBase;
          ly = yBase - 4 * map.getHeight(pos);
          body = 0x203;
        } else { /* Transporter */
          lx = xBase + arr3[2 * map.paths(pos)];
          ly = yBase - 4 * map.getHeight(pos) +
              arr3[2 * map.paths(pos) + 1];
          body = arr2[(u32(this.interface.getGame().getTick() +
                           arr1[pos & 0xf]) >>> 3) & 0x7f];
        }

        const color = this.interface.getPlayerColor(map.getOwner(pos));
        this.drawRowSerf(lx, ly, true, color, body);
      }
    }
  }

  /* Draw serfs that should appear behind the building at their
     current position. */
  protected drawSerfRowBehind(pos: MapPos, yBase: number, cols: number, xBase: number): void {
    const map = this.map;
    for (let i = 0; i < cols;
         i++, xBase += MAP_TILE_WIDTH, pos = map.moveRight(pos)) {
      /* Active serf */
      if (map.hasSerf(pos)) {
        const serf = this.interface.getGame().getSerfAtPos(pos)!;

        if (serf.getState() === SerfState.StateMining &&
            (serf.getMiningSubstate() === 3 ||
             serf.getMiningSubstate() === 4 ||
             serf.getMiningSubstate() === 9 ||
             serf.getMiningSubstate() === 10)) {
              this.drawActiveSerf(serf, pos, xBase, yBase);
            }
      }
    }
  }

  protected drawGameObjects(layers_: number): void {
    const map = this.map;
    this.waterInView = 0;
    this.treesInView = 0;

    const drawLandscape = layers_ & ViewportLayer.LayerLandscape;
    const drawObjects = layers_ & ViewportLayer.LayerObjects;
    const drawSerfs = layers_ & ViewportLayer.LayerSerfs;
    if (!drawLandscape && !drawObjects && !drawSerfs) return;

    const cols = (2 * idiv(this.width, MAP_TILE_WIDTH) + 1);
    const shortRowLen = ((cols + 1) >> 1) + 1;
    const longRowLen = ((cols + 2) >> 1) + 1;

    // PORT: `| 0` turns the -0 of the JS remainder into 0.
    const lx = (-(this.offsetX + 16 * idiv(this.offsetY, 20)) % 32) | 0;
    let ly = (-(this.offsetY) % 20) | 0;

    const col0 = idiv(idiv(this.offsetX, 16) + idiv(this.offsetY, 20), 2) & map.getColMask();
    const row0 = idiv(this.offsetY, MAP_TILE_HEIGHT) & map.getRowMask();
    let pos = map.pos(col0, row0);

    /* Loop until objects drawn fall outside the frame. */
    while (true) {
      /* short row */
      if (drawLandscape) this.drawWaterWavesRow(pos, ly, shortRowLen, lx);
      if (drawSerfs) {
        this.drawSerfRowBehind(pos, ly, shortRowLen, lx);
      }
      if (drawObjects) {
        this.drawMapObjectsRow(pos, ly, shortRowLen, lx);
      }
      if (drawSerfs) {
        this.drawSerfRow(pos, ly, shortRowLen, lx);
      }

      ly += MAP_TILE_HEIGHT;
      if (ly >= this.height + 6 * MAP_TILE_HEIGHT) break;

      pos = map.moveDown(pos);

      /* long row */
      if (drawLandscape) {
        this.drawWaterWavesRow(pos, ly, longRowLen, lx - 16);
      }
      if (drawSerfs) {
        this.drawSerfRowBehind(pos, ly, longRowLen, lx - 16);
      }
      if (drawObjects) {
        this.drawMapObjectsRow(pos, ly, longRowLen, lx - 16);
      }
      if (drawSerfs) {
        this.drawSerfRow(pos, ly, longRowLen, lx - 16);
      }

      ly += MAP_TILE_HEIGHT;
      if (ly >= this.height + 6 * MAP_TILE_HEIGHT) break;

      pos = map.moveDownRight(pos);
    }
  }

  protected drawMapCursorSprite(pos: MapPos, sprite: number): void {
    const [sx, sy] = this.screenPixFromMapCoord(pos);

    this.drawGameSprite(sx, sy, sprite);
  }

  protected drawMapCursorPossibleBuild(): void {
    const map = this.map;
    // eslint-disable-next-line prefer-const
    let [basePos, xOff, yOff] = this.getOffset();

    const game = this.interface.getGame();

    for (let xBase = xOff; xBase < this.width + MAP_TILE_WIDTH;
         xBase += MAP_TILE_WIDTH) {
      let pos = basePos;
      let yBase = yOff;
      let row = 0;

      while (true) {
        let lx: number;
        if (row % 2 === 0) {
          lx = xBase;
        } else {
          lx = xBase - idiv(MAP_TILE_WIDTH, 2);
        }

        const ly = yBase - 4 * map.getHeight(pos);
        if (ly >= this.height) break;

        /* Draw possible building */
        let sprite = -1;
        if (game.canBuildCastle(pos, this.interface.getPlayer()!)) {
          sprite = 50;
        } else if (game.canPlayerBuild(pos, this.interface.getPlayer()!) &&
                   GameMap.mapSpaceFromObj[map.getObj(pos)] === MapSpace.SpaceOpen &&
                   (game.canBuildFlag(map.moveDownRight(pos),
                                      this.interface.getPlayer()!) ||
                   map.hasFlag(map.moveDownRight(pos)))) {
          if (game.canBuildMine(pos)) {
            sprite = 48;
          } else if (game.canBuildLarge(pos)) {
            sprite = 50;
          } else if (game.canBuildSmall(pos)) {
            sprite = 49;
          }
        }

        if (sprite >= 0) {
          this.drawGameSprite(lx, ly, sprite);
        }

        if (row % 2 === 0) {
          pos = map.moveDown(pos);
        } else {
          pos = map.moveDownRight(pos);
        }

        yBase += MAP_TILE_HEIGHT;
        row += 1;
      }

      basePos = map.moveRight(basePos);
    }
  }

  protected drawMapCursor(): void {
    if (this.layers & ViewportLayer.LayerBuilds) {
      this.drawMapCursorPossibleBuild();
    }

    const pos = this.interface.getMapCursorPos();

  /*
    int x = map->pos_col(pos);
    int y = map->pos_row(pos);
    std::stringstream s;
    s << x << ":" << y;
    frame->draw_string(0, 0, s.str(), 75, 0);
  */

    this.drawMapCursorSprite(pos, this.interface.getMapCursorSprite(0));

    for (const d of cycleDirectionsCw()) {
      this.drawMapCursorSprite(this.map.move(pos, d),
                               this.interface.getMapCursorSprite(1 + d));
    }
  }

  protected drawBaseGridOverlay(color: Color): void {
    const [, xBase, yBase] = this.getOffset();

    let row = 0;
    for (let ly = yBase; ly < this.height; ly += MAP_TILE_HEIGHT, row++) {
      this.frame!.drawLine(0, ly, this.width, ly, color);
      for (let lx = xBase + ((row % 2 === 0) ? 0 : idiv(-MAP_TILE_WIDTH, 2));
           lx < this.width; lx += MAP_TILE_WIDTH) {
        this.frame!.drawLine(lx, ly - 3, lx, ly + 3, color);
      }
    }
  }

  protected drawHeightGridOverlay(color: Color): void {
    const map = this.map;
    // eslint-disable-next-line prefer-const
    let [basePos, xOff, yOff] = this.getOffset();

    for (let xBase = xOff; xBase < this.width + MAP_TILE_WIDTH;
         xBase += MAP_TILE_WIDTH) {
      let pos = basePos;
      let yBase = yOff;
      let row = 0;

      while (true) {
        let lx: number;
        if (row % 2 === 0) {
          lx = xBase;
        } else {
          lx = xBase - idiv(MAP_TILE_WIDTH, 2);
        }

        const ly = yBase - 4 * map.getHeight(pos);
        if (ly >= this.height) break;

        /* Draw cross. */
        if (pos !== map.pos(0, 0)) {
          this.frame!.fillRect(lx, ly - 1, 1, 3, color);
          this.frame!.fillRect(lx - 1, ly, 3, 1, color);
        } else {
          this.frame!.fillRect(lx, ly - 2, 1, 5, color);
          this.frame!.fillRect(lx - 2, ly, 5, 1, color);
        }

        if (row % 2 === 0) {
          pos = map.moveDown(pos);
        } else {
          pos = map.moveDownRight(pos);
        }

        yBase += MAP_TILE_HEIGHT;
        row += 1;
      }

      basePos = map.moveRight(basePos);
    }
  }

  protected override internalDraw(): void {
    if (this.map == null) {
      return;
    }

    if (this.layers & ViewportLayer.LayerLandscape) {
      this.drawLandscape();
    }
    if (this.layers & ViewportLayer.LayerGrid) {
      this.drawBaseGridOverlay(new Color(0xcf, 0x63, 0x63));
      this.drawHeightGridOverlay(new Color(0xef, 0xef, 0x8f));
    }
    if (this.layers & ViewportLayer.LayerPaths) {
      this.drawPathsAndBorders();
    }
    this.drawGameObjects(this.layers);
    if (this.layers & ViewportLayer.LayerCursor) {
      this.drawMapCursor();
    }
  }

  /* Click on a neighbour of the cursor while a road is being built; a
     special click can join an existing road or end the road with a new
     flag (see Interface::build_road_segment()). */
  protected roadClick(clkPos: MapPos, special: boolean): void {
    const dx = -this.map.distX(this.interface.getMapCursorPos(), clkPos) + 1;
    const dy = -this.map.distY(this.interface.getMapCursorPos(), clkPos) + 1;
    let dir: Direction = DirectionNone;

    if (dx === 0) {
      if (dy === 1) {
        dir = DirectionLeft;
      } else if (dy === 0) {
        dir = DirectionUpLeft;
      } else {
        return;
      }
    } else if (dx === 1) {
      if (dy === 2) {
        dir = DirectionDown;
      } else if (dy === 0) {
        dir = DirectionUp;
      } else {
        return;
      }
    } else if (dx === 2) {
      if (dy === 1) {
        dir = DirectionRight;
      } else if (dy === 2) {
        dir = DirectionDownRight;
      } else {
        return;
      }
    } else {
      return;
    }

    if (this.interface.buildRoadIsValidDir(dir)) {
      const road = this.interface.getBuildingRoad();
      if (road.isUndo(dir)) {
        /* Delete existing path */
        const r = this.interface.removeRoadSegment();
        if (r < 0) {
          this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
        } else {
          this.playSound(AudioTypeSfx.TypeSfxClick);
        }
      } else {
        /* Build new road segment */
        const r = this.interface.buildRoadSegment(dir, special);
        if (r < 0) {
          this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
        } else if (r === 0) {
          this.playSound(AudioTypeSfx.TypeSfxClick);
        } else {
          this.playSound(AudioTypeSfx.TypeSfxAccepted);
        }
      }
    }
  }

  protected override handleClickLeft(lx: number, ly: number): boolean {
    this.setRedraw();

    const clkPos = this.mapPosFromScreenPix(lx, ly);

    if (this.interface.isBuildingRoad()) {
      this.roadClick(clkPos, false);
    } else {
      this.interface.updateMapCursorPos(clkPos);
      this.playSound(AudioTypeSfx.TypeSfxClick);
    }

    return true;
  }

  /* The original's special click (right button held). */
  protected override handleClickRight(lx: number, ly: number): boolean {
    this.setRedraw();

    const clkPos = this.mapPosFromScreenPix(lx, ly);

    if (this.interface.isBuildingRoad()) {
      this.roadClick(clkPos, true);
    } else {
      /* Move the cursor and open the window of a flag or building there,
         as a click does in the original. */
      this.interface.updateMapCursorPos(clkPos);
      this.openObjectBox(clkPos);
    }

    return true;
  }

  protected override handleDblClick(lx: number, ly: number, button: EventButton): boolean {
    if (button !== EventButton.ButtonLeft) return false;

    this.setRedraw();

    const player = this.interface.getPlayer()!;

    const clkPos = this.mapPosFromScreenPix(lx, ly);

    if (this.interface.isBuildingRoad()) {
      const cursor = this.interface.getMapCursorPos();
      let adjacent = false;
      for (const d of cycleDirectionsCw()) {
        if (this.map.move(cursor, d) === clkPos) {
          adjacent = true;
        }
      }
      if (adjacent && this.map.paths(clkPos) !== 0 && !this.map.hasFlag(clkPos)) {
        /* A double click on the next road tile joins that road, like a
           special click. */
        this.roadClick(clkPos, true);
      } else if (clkPos !== this.interface.getMapCursorPos()) {
        const pos = this.interface.getBuildingRoad().getEnd(this.map);
        const road = pathfinderMap(this.map, pos, clkPos,
                                   this.interface.getBuildingRoad());
        if (road.getLength() !== 0) {
          const r = this.interface.extendRoad(road);
          if (r < 0) {
            this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
          } else if (r === 1) {
            this.playSound(AudioTypeSfx.TypeSfxAccepted);
          } else {
            this.playSound(AudioTypeSfx.TypeSfxClick);
          }
        } else {
          this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
        }
      } else {
        // PORT: the C++ builds the flag here; it is part of the command of
        // Interface::build_road() now.
        const r = this.interface.getGame().canBuildFlag(
                                                  this.interface.getMapCursorPos(),
                                                   player);
        if (r) {
          this.interface.buildRoad();
        } else {
          this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
        }
      }
    } else {
      return this.openObjectBox(clkPos);
    }

    return false;
  }

  /* Open the window of the flag or building at clk_pos: own flags and
     buildings show their box, an enemy military building the attack box. */
  protected openObjectBox(clkPos: MapPos): boolean {
    const map = this.map;
    const player = this.interface.getPlayer()!;

    if (map.getObj(clkPos) === MapObject.ObjectNone ||
        map.getObj(clkPos) > MapObject.ObjectCastle) {
      return false;
    }

    if (map.getObj(clkPos) === MapObject.ObjectFlag) {
      if (map.getOwner(clkPos) === player.getIndex()) {
        this.interface.openPopup(PopupBoxType.TypeTransportInfo);
      }

      player.tempIndex = map.getObjIndex(clkPos);
    } else { /* Building */
      const building = this.interface.getGame().getBuildingAtPos(clkPos);
      if ((building === null) || building.isBurning()) {
        return false;
      }
      if (map.getOwner(clkPos) === player.getIndex()) {
        if (!building.isDone()) {
          this.interface.openPopup(PopupBoxType.TypeOrderedBld);
        } else if (building.getType() === BuildingType.TypeCastle) {
          this.interface.openPopup(PopupBoxType.TypeCastleRes);
        } else if (building.getType() === BuildingType.TypeStock) {
          if (!building.isActive()) return false;
          if (this.interface.getStockBoxOccupied() && !building.hasSerf()) {
            /* Advanced option: no inventory before the serf arrives. */
            this.interface.openPopup(PopupBoxType.TypeBldStock);
          } else {
            this.interface.openPopup(PopupBoxType.TypeCastleRes);
          }
        } else if (building.getType() === BuildingType.TypeHut ||
                   building.getType() === BuildingType.TypeTower ||
                   building.getType() === BuildingType.TypeFortress) {
          this.interface.openPopup(PopupBoxType.TypeDefenders);
        } else if (building.getType() === BuildingType.TypeStoneMine ||
                   building.getType() === BuildingType.TypeCoalMine ||
                   building.getType() === BuildingType.TypeIronMine ||
                   building.getType() === BuildingType.TypeGoldMine) {
          this.interface.openPopup(PopupBoxType.TypeMineOutput);
        } else {
          this.interface.openPopup(PopupBoxType.TypeBldStock);
        }

        player.tempIndex = map.getObjIndex(clkPos);
      } else { /* Foreign building */
        /* TODO handle coop mode*/
        // PORT: the values of the attack box are the interface's, not the
        // player's (see InterfaceAttack).
        const attack = this.interface.attack;
        attack.buildingAttacked = building.getIndex();
        attack.pos = building.getPosition();

        if (building.isDone() &&
            building.isMilitary()) {
          if (!building.isActive() ||
              building.getThreatLevel() !== 3) {
            /* It is not allowed to attack
               if currently not occupied or
               is too far from the border. */
            this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
            return false;
          }

          let found = 0;
          for (let i = 257; i >= 0; i--) {
            const pos = map.posAddSpirally(building.getPosition(),
                                           7 + 257 - i);
            if (map.hasOwner(pos) &&
                map.getOwner(pos) === player.getIndex()) {
              found = 1;
              break;
            }
          }

          if (!found) {
            this.playSound(AudioTypeSfx.TypeSfxNotAccepted);
            return false;
          }

          /* Action accepted */
          this.playSound(AudioTypeSfx.TypeSfxClick);

          let maxKnights = 0;
          switch (building.getType()) {
            case BuildingType.TypeHut: maxKnights = 3; break;
            case BuildingType.TypeTower: maxKnights = 6; break;
            case BuildingType.TypeFortress: maxKnights = 12; break;
            case BuildingType.TypeCastle: maxKnights = 20; break;
            default: NOT_REACHED(); break;
          }

          const preview = previewAttack(player, building.getPosition());
          attack.attackingKnights = preview.attackingKnights;
          attack.totalAttackingKnights = preview.totalAttackingKnights;
          attack.attackingBuildingCount = preview.attackingBuildingCount;
          const knights = preview.totalAttackingKnights;
          attack.knightsAttacking = Math.min(knights, maxKnights);
          this.interface.openPopup(PopupBoxType.TypeStartAttack);
        }
      }
    }

    return false;
  }

  protected override handleDrag(lx: number, ly: number): boolean {
    if (this.interface.getInvertScrolling()) {
      ly = -ly;
    }
    if (lx !== 0 || ly !== 0) {
      this.moveByPixels(lx, ly);
    }

    return true;
  }

  constructor(_interface: Interface, _map: PMap) {
    super();
    this.interface = _interface;
    this.map = _map;
    this.map.addChangeHandler(this);
    this.layers = ViewportLayer.LayerAll;

    this.offsetX = 0;
    this.offsetY = 0;
    this.lastWidth = 0;
    this.lastHeight = 0;
    this.tileUseCounter = 0;

    this.lastTick = 0;
    this.waterInView = 0;
    this.treesInView = 0;

    this.dataSource = Data.getInstance().getDataSource();
  }

  // PORT: the destructor (which also deletes the frames of the tiles).
  override destroy(): void {
    this.map.delChangeHandler(this);
    this.clearLandscapeTiles();
    super.destroy();
  }

  onHeightChanged(pos: MapPos): void {
    this.redrawMapPos(pos);
  }

  onObjectChanged(pos: MapPos): void {
    if (this.interface.getMapCursorPos() === pos) {
      this.interface.updateMapCursorPos(pos);
    }
  }

  /* Space transformations. */
  /* The game world space is a three dimensional space with the axes
     named "column", "row" and "height". The (column, row) coordinate
     can be encoded as a MapPos.

     The landscape is composed of a mesh of vertices in the game world
     space. There is one vertex for each integer position in the
     (column, row)-space. The height value of such a vertex is stored
     in the map data. Height values at non-integer (column, row)-points
     can be obtained by interpolation from the nearest three vertices.

     The game world can be projected onto a two-dimensional space called
     map pixel space by the following transformation:

      mx =  Tw*c  -(Tw/2)*r
      my =  Th*r  -4*h

     where (mx,my) is the coordinate in map pixel space; (c,r,h) is
     the coordinate in game world space; and (Tw,Th) is the width and
     height of a map tile in pixel units (these two values are defined
     as MAP_TILE_WIDTH and MAP_TILE_HEIGHT in the code).

     The map pixels space can be transformed into screen space by a
     simple translation.

     Note that the game world space wraps around when the edge is
     reached, i.e. decrementing the column by one when standing at
     (c,r,h) = (0,0,0) leads to the point (N-1,0,0) where N is the
     width of the map in columns. This also happens when crossing
     the row edge.

     The map pixel space also wraps around but the vertical wrap-around
     is a bit more tricky, so care must be taken when translating
     map pixel coordinates. When an edge is traversed vertically,
     the x-coordinate has to be offset by half the height of the map,
     because of the skew in the translation from game world space to
     map pixel space.
  */
  // PORT: out-parameters become the result [sx, sy].
  screenPixFromMapPix(mx: number, my: number): [number, number] {
    const map = this.map;
    const lwidth = map.getCols() * MAP_TILE_WIDTH;
    const lheight = map.getRows() * MAP_TILE_HEIGHT;

    let sx = mx - this.offsetX;
    let sy = my - this.offsetY;

    while (sy < 0) {
      sx -= idiv(map.getRows() * MAP_TILE_WIDTH, 2);
      sy += lheight;
    }

    while (sy >= lheight) {
      sx += idiv(map.getRows() * MAP_TILE_WIDTH, 2);
      sy -= lheight;
    }

    while (sx < 0) sx += lwidth;
    while (sx >= lwidth) sx -= lwidth;

    return [sx, sy];
  }

  // PORT: out-parameters become the result [mx, my].
  mapPixFromMapCoord(pos: MapPos, h: number): [number, number] {
    const map = this.map;
    const lwidth = map.getCols() * MAP_TILE_WIDTH;
    const lheight = map.getRows() * MAP_TILE_HEIGHT;

    let mx = MAP_TILE_WIDTH * map.posCol(pos) -
             idiv(MAP_TILE_WIDTH, 2) * map.posRow(pos);
    let my = MAP_TILE_HEIGHT * map.posRow(pos) - 4 * h;

    if (my < 0) {
      mx -= idiv(map.getRows() * MAP_TILE_WIDTH, 2);
      my += lheight;
    }

    if (mx < 0) mx += lwidth;
    else if (mx >= lwidth) mx -= lwidth;

    return [mx, my];
  }

  // PORT: out-parameters become the result [sx, sy].
  screenPixFromMapCoord(pos: MapPos): [number, number] {
    const h = this.map.getHeight(pos);
    const [mx, my] = this.mapPixFromMapCoord(pos, h);
    return this.screenPixFromMapPix(mx, my);
  }

  mapPosFromScreenPix(sx: number, sy: number): MapPos {
    const map = this.map;
    // eslint-disable-next-line prefer-const
    let [, xOff, yOff, col, row] = this.getOffset();

    sx -= xOff;
    sy -= yOff;

    let yBase = -4;
    const colOffset = (sx + 24) >> 5;
    if (!BIT_TEST(sx + 24, 4)) {
      row += 1;
      yBase = 16;
    }

    col = (col + colOffset) & map.getColMask();
    row = row & map.getRowMask();

    let ly: number;
    let lastY = -100;

    while (true) {
      ly = yBase - 4 * map.getHeight(map.pos(col, row));
      if (sy < ly) break;

      lastY = ly;
      col = (col + 1) & map.getColMask();
      row = (row + 2) & map.getRowMask();
      yBase += 2 * MAP_TILE_HEIGHT;
    }

    if (sy < idiv(ly + lastY, 2)) {
      col = (col - 1) & map.getColMask();
      row = (row - 2) & map.getRowMask();
    }

    return map.pos(col, row);
  }

  getCurrentMapPos(): MapPos {
    return this.mapPosFromScreenPix(idiv(this.width, 2), idiv(this.height, 2));
  }

  moveToMapPos(pos: MapPos): void {
    const map = this.map;
    let [mx, my] = this.mapPixFromMapCoord(pos, map.getHeight(pos));

    const mapWidth = map.getCols() * MAP_TILE_WIDTH;
    const mapHeight = map.getRows() * MAP_TILE_HEIGHT;

    /* Center screen. */
    mx -= idiv(this.width, 2);
    my -= idiv(this.height, 2);

    if (my < 0) {
      mx -= idiv(map.getRows() * MAP_TILE_WIDTH, 2);
      my += mapHeight;
    }

    if (mx < 0) mx += mapWidth;
    else if (mx >= mapWidth) mx -= mapWidth;

    this.offsetX = mx;
    this.offsetY = my;

    this.setRedraw();
  }

  moveByPixels(lx: number, ly: number): void {
    const map = this.map;
    const lwidth = map.getCols() * MAP_TILE_WIDTH;
    const lheight = map.getRows() * MAP_TILE_HEIGHT;

    this.offsetX += lx;
    this.offsetY += ly;

    if (this.offsetY < 0) {
      this.offsetY += lheight;
      this.offsetX -= idiv(map.getRows() * MAP_TILE_WIDTH, 2);
    } else if (this.offsetY >= lheight) {
      this.offsetY -= lheight;
      this.offsetX += idiv(map.getRows() * MAP_TILE_WIDTH, 2);
    }

    if (this.offsetX >= lwidth) this.offsetX -= lwidth;
    else if (this.offsetX < 0) this.offsetX += lwidth;

    this.setRedraw();
  }

  /* Called periodically when the game progresses. */
  update(): void {
    const tickXor = this.interface.getGame().getTick() ^ this.lastTick;
    this.lastTick = this.interface.getGame().getTick();

    /* Viewport animation does not care about low bits in anim */
    if (tickXor >= 1 << 3) {
      this.setRedraw();
    }
  }
}

// PORT: lets `Viewport.Layer` be used as a type name too, matching the C++
// spelling `Viewport::Layer`.
// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace Viewport {
  export type Layer = ViewportLayer;
  export type LandscapeTile = ViewportLandscapeTile;
}
