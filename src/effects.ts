// Effects (GLOSSARY): a ring, a beam, a float, an ember. Each is queued when something happens, plays
// for a moment and is gone. The animation frame ages them, and browsers stop calling it for a tab in
// the background while events keep arriving, so a queue holds at most `max` and drops its oldest: a
// tab left hidden for days stays the size it was.

export interface Timed {
  /** Progress through the effect's life, from 0. */
  t: number;
}

export class Effects<T extends Timed> implements Iterable<T> {
  private items: T[] = [];

  constructor(private readonly max: number) {}

  get size(): number { return this.items.length; }

  add(item: T) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push(item);
  }

  /** Ages every effect by `dt` and drops those that reached `life`, handing each to `done`. */
  step(dt: number, life = 1, done?: (item: T) => void) {
    const items = this.items;
    let kept = 0;
    for (const item of items) {
      item.t += dt;
      if (item.t < life) items[kept++] = item;
      else done?.(item);
    }
    items.length = kept;
  }

  clear() { this.items.length = 0; }

  [Symbol.iterator](): Iterator<T> { return this.items[Symbol.iterator](); }
}
