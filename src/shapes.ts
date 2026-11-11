// Outlines for picking: what a place covers on screen, in world px (before the camera), so a tap lands
// on whatever is drawn there rather than on a box around it. A tall, narrow tower in front would
// otherwise take taps meant for the place showing beside it, behind.

import type { Pt } from './painters';

/** World px for a ground point (x, y) in tiles, `z` px up. */
export type Iso = (x: number, y: number, z?: number) => Pt;

/** The outline of a box standing on tiles (gx, gy), w × d, from `z` px up to `z + h`: six corners. */
export function boxOutline(iso: Iso, gx: number, gy: number, w: number, d: number, h: number, z = 0): Pt[] {
  return [iso(gx, gy + d, z), iso(gx + w, gy + d, z), iso(gx + w, gy, z), iso(gx + w, gy, z + h), iso(gx, gy, z + h), iso(gx, gy + d, z + h)];
}

/** An upright column `w` px wide and `h` px tall with its foot centred at `foot`. */
export function columnOutline(foot: Pt, w: number, h: number): Pt[] {
  const l = foot.x - w / 2, r = foot.x + w / 2;
  return [{ x: l, y: foot.y }, { x: r, y: foot.y }, { x: r, y: foot.y - h }, { x: l, y: foot.y - h }];
}

/** Whether `p` is inside `poly` or within `slop` of its edge (a finger is wider than a cursor). */
export function hits(poly: readonly Pt[], p: Pt, slop = 0): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  if (inside || slop <= 0) return inside;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segmentDistance(p, poly[j], poly[i]) <= slop) return true;
  return false;
}

function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
