import { describe, expect, it } from 'vitest';
import { fitView, type Extent, type View } from './framing';

/** Where each extent lands on a w × h screen under `v`, as screen boxes. */
const onScreen = (extents: Extent[], v: View, w: number, h: number) => extents.map((e) => {
  const x = (e.x - v.x) * v.z + w / 2, y = (e.y - v.y) * v.z + h / 2;
  return { x0: x - (e.left ?? 0), x1: x + (e.right ?? 0), y0: y - (e.top ?? 0), y1: y + (e.bottom ?? 0) };
});

describe('fitView', () => {
  it('fills the tighter axis up to the padding and centres the other', () => {
    const box = [{ x: 0, y: 0 }, { x: 100, y: 50 }];
    const v = fitView(box, 220, 220, 10, 5)!;
    expect(v.z).toBeCloseTo(2);
    const [a, b] = onScreen(box, v, 220, 220);
    expect(a.x0).toBeCloseTo(10);
    expect(b.x1).toBeCloseTo(210);
    expect(a.y0 + b.y1).toBeCloseTo(220);
  });

  it('keeps screen-space labels whole, without scaling them with the zoom', () => {
    const items: Extent[] = [{ x: 0, y: 0 }, { x: 100, y: 100, bottom: 40 }, { x: 50, y: 0, top: 30, left: 60, right: 60 }];
    const v = fitView(items, 300, 300, 8, 5)!;
    for (const s of onScreen(items, v, 300, 300)) {
      expect(s.x0).toBeGreaterThanOrEqual(8 - 1e-6);
      expect(s.x1).toBeLessThanOrEqual(292 + 1e-6);
      expect(s.y0).toBeGreaterThanOrEqual(8 - 1e-6);
      expect(s.y1).toBeLessThanOrEqual(292 + 1e-6);
    }
    expect(v.z).toBeCloseTo((300 - 16 - 70) / 100, 3);
  });

  it('stops at the maximum zoom for something small, centred on it', () => {
    expect(fitView([{ x: 40, y: -20 }], 300, 200, 8, 2.6)).toEqual({ x: 40, y: -20, z: 2.6 });
  });

  it('frames nothing when there is nothing', () => {
    expect(fitView([], 300, 200, 8, 2.6)).toBeNull();
  });
});
