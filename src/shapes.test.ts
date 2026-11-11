import { describe, expect, it } from 'vitest';
import { boxOutline, columnOutline, hits } from './shapes';

// map.ts's isometric projection: 64 × 32 px tiles.
const iso = (x: number, y: number, z = 0) => ({ x: ((x - y) * 64) / 2, y: ((x + y) * 32) / 2 - z });

describe('boxOutline', () => {
  const box = boxOutline(iso, 0, 0, 2, 2, 100);

  it('covers the box: its front corner, its top and its sides', () => {
    expect(hits(box, iso(1, 1))).toBe(true);
    expect(hits(box, iso(2, 2, 1))).toBe(true);
    expect(hits(box, iso(0, 0, 99))).toBe(true);
  });

  it('leaves out the empty corners of its bounding rectangle', () => {
    // Up and left of the roof's left corner: inside the old rectangle test, but nothing is drawn there.
    const roofLeft = iso(0, 2, 100);
    expect(hits(box, { x: roofLeft.x + 2, y: roofLeft.y - 20 })).toBe(false);
  });
});

describe('a tall narrow column', () => {
  // A cubicle's pile: 26 px wide, 200 px tall, on a desk.
  const pile = columnOutline({ x: 0, y: 40 }, 26, 200);

  it('takes taps on itself', () => {
    expect(hits(pile, { x: 0, y: -100 })).toBe(true);
  });

  it('leaves taps beside it to what is drawn behind', () => {
    expect(hits(pile, { x: 40, y: -100 })).toBe(false);
  });
});

describe('hits with slop', () => {
  const pile = columnOutline({ x: 0, y: 0 }, 20, 50);

  it('reaches as far as the slop past the edge, no further', () => {
    expect(hits(pile, { x: 18, y: -25 }, 10)).toBe(true);
    expect(hits(pile, { x: 22, y: -25 }, 10)).toBe(false);
  });
});
