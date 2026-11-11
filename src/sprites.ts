// Sprite art (public/art/*.webp, generated for dispatchr; see public/art/README.md). Images load in
// the background; until one is ready, callers fall back to drawing with shapes, so the map never
// waits on art. Derived variants (grey for a stopped agent, a cold ghost for a missing one) are made
// once per image on an offscreen canvas.

export type Variant = 'gray' | 'ghost';

interface Entry {
  img: HTMLImageElement;
  ok: boolean;
  variants: Partial<Record<Variant, HTMLCanvasElement>>;
  /** Darkened copies by shade step (see setShade). */
  shaded: Map<number, HTMLCanvasElement>;
  pattern?: CanvasPattern | null;
}

/** What a quiet agent darkens toward, by theme: night in the city, a softer dusk in the painted themes. */
export const SHADE = { city: [2, 4, 10], farm: [30, 40, 24], lab: [104, 124, 150], cubicles: [44, 50, 72] } as const;
/** A sprite's shade by its art prefix (public/art/README.md); anything else is the city's. */
const SHADE_BY_PREFIX: Record<string, readonly number[]> = { f_: SHADE.farm, l_: SHADE.lab, c_: SHADE.cubicles };
const SHADE_STEP = 0.125;
let shadeStep = 0;

/**
 * While set above 0, plain sprites come from a copy mixed this far toward SHADE (map.ts dims quiet
 * agents this way). Rounded to SHADE_STEP, so each sprite has a handful of copies, each made once.
 */
export function setShade(amount: number) {
  shadeStep = Math.round(Math.min(1, Math.max(0, amount)) / SHADE_STEP);
}

const BASE = `${import.meta.env.BASE_URL}art/`;
const entries = new Map<string, Entry>();

function entry(name: string): Entry {
  let e = entries.get(name);
  if (e) return e;
  const img = new Image();
  e = { img, ok: false, variants: {}, shaded: new Map() };
  const ref = e;
  img.onload = () => { ref.ok = true; };
  img.src = `${BASE}${name}.webp`;
  entries.set(name, e);
  return e;
}

/** Start loading every sprite a theme uses, so they are ready when first drawn. */
export function preload(names: string[]) {
  for (const n of names) entry(n);
}

function derive(src: HTMLImageElement, v: Variant): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.naturalWidth;
  c.height = src.naturalHeight;
  const g = c.getContext('2d');
  if (!g) return c;
  g.drawImage(src, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2];
    if (v === 'gray') {
      px[i] = px[i + 1] = px[i + 2] = l * 0.62;
    } else {
      px[i] = l * 0.35;
      px[i + 1] = l * 0.8 + 30;
      px[i + 2] = l + 60;
      px[i + 3] *= 0.75;
    }
  }
  g.putImageData(data, 0, 0);
  return c;
}

function darken(name: string, src: HTMLImageElement, amount: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.naturalWidth;
  c.height = src.naturalHeight;
  const g = c.getContext('2d');
  if (!g) return c;
  g.drawImage(src, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const to = SHADE_BY_PREFIX[name.slice(0, 2)] ?? SHADE.city;
  for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) px[i + k] += (to[k] - px[i + k]) * amount;
  g.putImageData(data, 0, 0);
  return c;
}

/** The sprite (or a variant of it), or null while it is still loading or missing. */
export function sprite(name: string, variant?: Variant): CanvasImageSource | null {
  const e = entry(name);
  if (!e.ok) return null;
  if (variant) return (e.variants[variant] ??= derive(e.img, variant));
  if (!shadeStep) return e.img;
  let c = e.shaded.get(shadeStep);
  if (!c) e.shaded.set(shadeStep, (c = darken(name, e.img, shadeStep * SHADE_STEP)));
  return c;
}

/** Natural width / height of a loaded sprite. */
export function aspect(name: string): number {
  const e = entry(name);
  return e.ok && e.img.naturalHeight ? e.img.naturalWidth / e.img.naturalHeight : 1;
}

/** A repeating pattern of a texture, or null while it loads. Set its transform before each fill. */
export function pattern(ctx: CanvasRenderingContext2D, name: string): CanvasPattern | null {
  const e = entry(name);
  if (!e.ok) return null;
  if (e.pattern === undefined) e.pattern = ctx.createPattern(e.img, 'repeat');
  return e.pattern;
}

/**
 * Draws a sprite standing on (x, y): bottom-centre anchored, `h` world px tall, width by its aspect
 * (or `w` when given). `flip` mirrors it; `sx`/`sy` squash and stretch around the feet.
 */
export function stand(
  ctx: CanvasRenderingContext2D, img: CanvasImageSource, x: number, y: number, h: number,
  o: { w?: number; flip?: boolean; sx?: number; sy?: number; rot?: number } = {},
) {
  const iw = img instanceof HTMLImageElement ? img.naturalWidth : (img as HTMLCanvasElement).width;
  const ih = img instanceof HTMLImageElement ? img.naturalHeight : (img as HTMLCanvasElement).height;
  const w = o.w ?? (h * iw) / ih;
  ctx.save();
  ctx.translate(x, y);
  if (o.rot) ctx.rotate(o.rot);
  ctx.scale((o.flip ? -1 : 1) * (o.sx ?? 1), o.sy ?? 1);
  ctx.drawImage(img, -w / 2, -h, w, h);
  ctx.restore();
}
