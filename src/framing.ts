// Framing: the camera that shows a set of things as large as the viewport allows. Each thing is a world
// point that scales with the camera, plus screen px around it that do not (labels, badges).

export interface Extent {
  x: number;
  y: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

export interface View {
  /** World point at the viewport's centre. */
  x: number;
  y: number;
  /** Screen px per world px. */
  z: number;
}

/**
 * The highest zoom, up to `maxZ`, at which every extent fits in a `w` × `h` viewport inside `pad`, centred.
 * Null when there is nothing to frame.
 */
export function fitView(extents: readonly Extent[], w: number, h: number, pad: number, maxZ: number): View | null {
  if (!extents.length) return null;
  const spanAt = (z: number) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const e of extents) {
      x0 = Math.min(x0, e.x * z - (e.left ?? 0));
      x1 = Math.max(x1, e.x * z + (e.right ?? 0));
      y0 = Math.min(y0, e.y * z - (e.top ?? 0));
      y1 = Math.max(y1, e.y * z + (e.bottom ?? 0));
    }
    return { x0, x1, y0, y1 };
  };
  const fits = (z: number) => {
    const s = spanAt(z);
    return s.x1 - s.x0 <= w - 2 * pad && s.y1 - s.y0 <= h - 2 * pad;
  };
  let z = maxZ;
  if (!fits(z)) {
    // The span grows with the zoom, so the largest zoom that fits is found by halving.
    let lo = 0, hi = maxZ;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    z = Math.max(lo, 1e-3);
  }
  const s = spanAt(z);
  return { x: (s.x0 + s.x1) / 2 / z, y: (s.y0 + s.y1) / 2 / z, z };
}
