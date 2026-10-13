// Port of Freeserf's resource.h.

export enum ResourceType {
  TypeNone = -1,

  TypeFish = 0,
  TypePig,
  TypeMeat,
  TypeWheat,
  TypeFlour,
  TypeBread,
  TypeLumber,
  TypePlank,
  TypeBoat,
  TypeStone,
  TypeIronOre,
  TypeSteel,
  TypeCoal,
  TypeGoldOre,
  TypeGoldBar,
  TypeShovel,
  TypeHammer,
  TypeRod,
  TypeCleaver,
  TypeScythe,
  TypeAxe,
  TypeSaw,
  TypePick,
  TypePincer,
  TypeSword,
  TypeShield,

  GroupFood,

  TypesCount,
}

// Resource::Type in the C++ is written Resource.Type here.
export const Resource = { Type: ResourceType };
export type ResourceMap = Map<ResourceType, number>;
