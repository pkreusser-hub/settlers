// The singleton role of Freeserf's data.h / data.cc (class Data). The asset
// catalogue itself is in src/data/data.ts.

import {
  Animation,
  Asset,
  AssetType,
  getResourceCount,
  getResourceName,
  getResourceType,
} from '../data/data';
import { DataSourceDOS } from '../data/data-source-dos';
import type { Color, Sprite } from '../data/sprite';
import { ExceptionFreeserf, Log } from '../game/misc';

// Data::Type
export const DataType = {
  TypeUnknown: AssetType.Unknown,
  TypeSprite: AssetType.Sprite,
  TypeAnimation: AssetType.Animation,
  TypeSound: AssetType.Sound,
  TypeMusic: AssetType.Music,
} as const;
export type DataType = AssetType;

// Data::Resource (Data::Asset). The C++ member names, for the values of the
// Asset enum of src/data/data.ts: Data::AssetIcon is DataResource.AssetIcon
// (or Asset.Icon).
export const DataResource = {
  AssetNone: Asset.None,
  AssetArtLandscape: Asset.ArtLandscape,
  AssetAnimation: Asset.Animation,
  AssetSerfShadow: Asset.SerfShadow,
  AssetDottedLines: Asset.DottedLines,
  AssetArtFlag: Asset.ArtFlag,
  AssetArtBox: Asset.ArtBox,
  AssetCreditsBg: Asset.CreditsBg,
  AssetLogo: Asset.Logo,
  AssetSymbol: Asset.Symbol,
  AssetMapMaskUp: Asset.MapMaskUp,
  AssetMapMaskDown: Asset.MapMaskDown,
  AssetPathMask: Asset.PathMask,
  AssetMapGround: Asset.MapGround,
  AssetPathGround: Asset.PathGround,
  AssetGameObject: Asset.GameObject,
  AssetFrameTop: Asset.FrameTop,
  AssetMapBorder: Asset.MapBorder,
  AssetMapWaves: Asset.MapWaves,
  AssetFramePopup: Asset.FramePopup,
  AssetIndicator: Asset.Indicator,
  AssetFont: Asset.Font,
  AssetFontShadow: Asset.FontShadow,
  AssetIcon: Asset.Icon,
  AssetMapObject: Asset.MapObject,
  AssetMapShadow: Asset.MapShadow,
  AssetPanelButton: Asset.PanelButton,
  AssetFrameBottom: Asset.FrameBottom,
  AssetSerfTorso: Asset.SerfTorso,
  AssetSerfHead: Asset.SerfHead,
  AssetFrameSplit: Asset.FrameSplit,
  AssetSound: Asset.Sound,
  AssetMusic: Asset.Music,
  AssetCursor: Asset.Cursor,
} as const;
export type DataResource = Asset;

export type DataAnimation = Animation;
export type DataSprite = Sprite;
export type DataPSprite = Sprite | null;
export type DataSpriteColor = Color;
export type DataSource = DataSourceDOS;
export type DataPSource = DataSourceDOS;

export class Data {
  static Type = DataType;
  static Resource = DataResource;
  static Asset = DataResource;

  protected static instance: Data | null = null;

  protected dataSource: DataSourceDOS | null = null;

  protected constructor() {}

  static getInstance(): Data {
    if (Data.instance === null) {
      Data.instance = new Data();
    }
    return Data.instance;
  }

  // PORT: the C++ load() searches folders on disk for the data of the DOS,
  // Amiga and custom formats. Here the one DOS data file is fetched from
  // url; await it once at startup, before the first use of Graphics.
  async load(url: string): Promise<boolean> {
    try {
      this.dataSource = await DataSourceDOS.fetch(url);
    } catch (e) {
      Log.Error('data', 'Could not load game data.', e);
      return false;
    }
    return true;
  }

  // PORT: not in the C++; sets a source loaded with DataSourceDOS.fetch().
  setDataSource(source: DataSourceDOS | null): void {
    this.dataSource = source;
  }

  // PORT: not in the C++, which returns a null pointer from
  // get_data_source() before load().
  isLoaded(): boolean {
    return this.dataSource !== null;
  }

  // PORT: throws when the data is not loaded yet instead of returning a
  // null pointer (which no caller of the C++ checks).
  getDataSource(): DataSourceDOS {
    if (this.dataSource === null) {
      throw new ExceptionFreeserf('The game data is not loaded.');
    }
    return this.dataSource;
  }

  // PORT: there is no DataSourceMixed (DOS data only), always null.
  getMixedSource(): null {
    return null;
  }

  static getResourceType(resource: Asset): AssetType {
    return getResourceType(resource);
  }

  static getResourceCount(resource: Asset): number {
    return getResourceCount(resource);
  }

  static getResourceName(resource: Asset): string {
    return getResourceName(resource);
  }
}
