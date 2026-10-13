// Asset catalogue. Port of Freeserf's data.h / data.cc.

export enum Asset {
  None,
  ArtLandscape,
  Animation,
  SerfShadow,
  DottedLines,
  ArtFlag,
  ArtBox,
  CreditsBg,
  Logo,
  Symbol,
  MapMaskUp,
  MapMaskDown,
  PathMask,
  MapGround,
  PathGround,
  GameObject,
  FrameTop,
  MapBorder,
  MapWaves,
  FramePopup,
  Indicator,
  Font,
  FontShadow,
  Icon,
  MapObject,
  MapShadow,
  PanelButton,
  FrameBottom,
  SerfTorso,
  SerfHead,
  FrameSplit,
  Sound,
  Music,
  Cursor,
}

export enum AssetType {
  Unknown,
  Sprite,
  Animation,
  Sound,
  Music,
}

export interface Animation {
  sprite: number;
  x: number;
  y: number;
}

interface ResourceInfo {
  type: AssetType;
  count: number;
  name: string;
}

const resources: Record<Asset, ResourceInfo> = {
  [Asset.None]: { type: AssetType.Unknown, count: 0, name: 'error' },
  [Asset.ArtLandscape]: { type: AssetType.Sprite, count: 1, name: 'art_landscape' },
  [Asset.Animation]: { type: AssetType.Animation, count: 200, name: 'animation' },
  [Asset.SerfShadow]: { type: AssetType.Sprite, count: 1, name: 'serf_shadow' },
  [Asset.DottedLines]: { type: AssetType.Sprite, count: 7, name: 'dotted_lines' },
  [Asset.ArtFlag]: { type: AssetType.Sprite, count: 7, name: 'art_flag' },
  [Asset.ArtBox]: { type: AssetType.Sprite, count: 14, name: 'art_box' },
  [Asset.CreditsBg]: { type: AssetType.Sprite, count: 1, name: 'credits_bg' },
  [Asset.Logo]: { type: AssetType.Sprite, count: 1, name: 'logo' },
  [Asset.Symbol]: { type: AssetType.Sprite, count: 16, name: 'symbol' },
  [Asset.MapMaskUp]: { type: AssetType.Sprite, count: 81, name: 'map_mask_up' },
  [Asset.MapMaskDown]: { type: AssetType.Sprite, count: 81, name: 'map_mask_down' },
  [Asset.PathMask]: { type: AssetType.Sprite, count: 27, name: 'path_mask' },
  [Asset.MapGround]: { type: AssetType.Sprite, count: 33, name: 'map_ground' },
  [Asset.PathGround]: { type: AssetType.Sprite, count: 10, name: 'path_ground' },
  [Asset.GameObject]: { type: AssetType.Sprite, count: 279, name: 'game_object' },
  [Asset.FrameTop]: { type: AssetType.Sprite, count: 4, name: 'frame_top' },
  [Asset.MapBorder]: { type: AssetType.Sprite, count: 10, name: 'map_border' },
  [Asset.MapWaves]: { type: AssetType.Sprite, count: 16, name: 'map_waves' },
  [Asset.FramePopup]: { type: AssetType.Sprite, count: 4, name: 'frame_popup' },
  [Asset.Indicator]: { type: AssetType.Sprite, count: 8, name: 'indicator' },
  [Asset.Font]: { type: AssetType.Sprite, count: 44, name: 'font' },
  [Asset.FontShadow]: { type: AssetType.Sprite, count: 44, name: 'font_shadow' },
  [Asset.Icon]: { type: AssetType.Sprite, count: 318, name: 'icon' },
  [Asset.MapObject]: { type: AssetType.Sprite, count: 194, name: 'map_object' },
  [Asset.MapShadow]: { type: AssetType.Sprite, count: 194, name: 'map_shadow' },
  [Asset.PanelButton]: { type: AssetType.Sprite, count: 25, name: 'panel_button' },
  [Asset.FrameBottom]: { type: AssetType.Sprite, count: 26, name: 'frame_bottom' },
  [Asset.SerfTorso]: { type: AssetType.Sprite, count: 541, name: 'serf_torso' },
  [Asset.SerfHead]: { type: AssetType.Sprite, count: 630, name: 'serf_head' },
  [Asset.FrameSplit]: { type: AssetType.Sprite, count: 3, name: 'frame_split' },
  [Asset.Sound]: { type: AssetType.Sound, count: 90, name: 'sound' },
  [Asset.Music]: { type: AssetType.Music, count: 7, name: 'music' },
  [Asset.Cursor]: { type: AssetType.Sprite, count: 1, name: 'cursor' },
};

export function getResourceType(asset: Asset): AssetType {
  return resources[asset].type;
}

export function getResourceCount(asset: Asset): number {
  return resources[asset].count;
}

export function getResourceName(asset: Asset): string {
  return resources[asset].name;
}
