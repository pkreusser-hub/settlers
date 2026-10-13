// Port of Freeserf's objects.h: indexed game objects and their pools.

import type { Game } from './game';

export class GameObject {
  protected index: number;
  protected game: Game;

  constructor(game: Game, index: number) {
    this.game = game;
    this.index = index;
  }

  getGame(): Game {
    return this.game;
  }

  getIndex(): number {
    return this.index;
  }
}

export class Collection<T extends GameObject> implements Iterable<T> {
  protected objects: (T | null)[] = [];
  protected freeObjectIndexes: number[] = [];

  constructor(
    protected game: Game,
    private create: (game: Game, index: number) => T,
  ) {}

  clear(): void {
    this.objects = [];
    this.freeObjectIndexes = [];
  }

  allocate(): T {
    if (this.freeObjectIndexes.length > 0) {
      const newIndex = this.freeObjectIndexes.shift()!;
      const obj = this.create(this.game, newIndex);
      this.objects[newIndex] = obj;
      return obj;
    }
    const obj = this.create(this.game, this.objects.length);
    this.objects.push(obj);
    return obj;
  }

  exists(index: number): boolean {
    return index < this.objects.length && this.objects[index] != null;
  }

  getOrInsert(index: number): T {
    if (index < this.objects.length) {
      let object = this.objects[index];
      if (object == null) {
        const i = this.freeObjectIndexes.indexOf(index);
        if (i >= 0) this.freeObjectIndexes.splice(i, 1);
        object = this.create(this.game, index);
        this.objects[index] = object;
      }
      return object;
    }
    for (let i = this.objects.length; i < index; i++) {
      this.freeObjectIndexes.push(i);
      this.objects.push(null);
    }
    const object = this.create(this.game, index);
    this.objects.push(object);
    return object;
  }

  // operator[]
  get(index: number): T | null {
    return this.objects[index] ?? null;
  }

  // Skips freed slots. Safe against erase() during iteration.
  *[Symbol.iterator](): Iterator<T> {
    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      if (obj != null) yield obj;
    }
  }

  erase(index: number): void {
    if (index < this.objects.length && this.objects[index] != null) {
      if (index + 1 === this.objects.length) {
        this.objects.pop();
      } else {
        this.freeObjectIndexes.push(index);
        this.objects[index] = null;
      }
    }
  }

  size(): number {
    return this.objects.length - this.freeObjectIndexes.length;
  }

  // One past the highest index in use (the original's max_*_index).
  getMaxIndex(): number {
    return this.objects.length;
  }
}
