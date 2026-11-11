import type { Kind } from './format';
import type { Decor, District, Island, Rect, Slot, TeamBlock } from './world';
import type { Iso } from './shapes';
import * as farm from './farm';
import * as lab from './lab';
import * as cubicles from './cubicles';
import type { ThemeId } from './theme';
import type { EffortTier } from './inference';

// The painted themes (everything but the neon city, which map.ts draws itself). Each is one module
// with the same parts: map.ts owns the camera, layout, labels and effects and asks the active theme's
// painter for the parts that look different.

export interface Pt { x: number; y: number }

/** What map.ts lends a painter: the context, the clock and its isometric helpers. */
export interface Paint {
  ctx: CanvasRenderingContext2D;
  t(): number;
  iso(x: number, y: number, z?: number): Pt;
  poly(pts: Pt[], fill: string | CanvasGradient | CanvasPattern): void;
  box(gx: number, gy: number, w: number, d: number, z: number, h: number, top: string, left: string, right: string, rim?: string): void;
  /** A top-down texture laid on the ground, `tiles` tiles per texture, anchored at (x0, y0); null while it loads. */
  ground(name: string, x0: number, y0: number, tiles: number): CanvasPattern | null;
}

export interface UnitLook {
  /** The agent kind's colours. */
  shirt: Kind;
  kind: string;
  /** Existing cast selected from reported model identity, independently of the launcher. */
  cast: string;
  effort: EffortTier;
  working: boolean;
  /** Not running: grey, no tools in hand. */
  dead: boolean;
  blocked: boolean;
  /** On the road to or from the base: a stride and a sway instead of the work motion. */
  walking: boolean;
  sway: number;
  /** Mirrored (heading right on screen). */
  flip: boolean;
  seed: number;
}

export interface Painter {
  /** Every sprite the theme draws, loaded when the theme is picked. */
  sprites: string[];
  /** Display face for map labels. */
  font: string;
  /** The unit's portrait: themes may use the reported-model cast rather than the launcher kind. */
  unitArt(kind: string, cast: string): string;
  /** Feet to the top of the unit's head, px at zoom 1: where the status icon sits and how tall a tap target is. */
  unitH: number;
  /** Maximum character width in world px, including extended arms, for pointer targets. */
  unitW: number;
  /** Reporting lines: colour, dash (none: solid) and how high over its place a line meets an agent (× place height). */
  link: { color: string; dash: number[]; lift: number };
  /** The screen behind the map. */
  background(p: Paint, W: number, H: number, camX: number, camY: number): void;
  /** A computer's raised ground. */
  slab(p: Paint, r: Rect, state: string): void;
  /** Column layout: the walkway between two of a computer's stacked slabs. */
  bridge(p: Paint, a: Pt, b: Pt): void;
  /** A space. */
  field(p: Paint, d: District): void;
  /** A team inside a space, its strip in the manager's colour. */
  team(p: Paint, t: TeamBlock, color: string): void;
  /** A computer's base, where working units carry their work; `blink` is its heartbeat. */
  core(p: Paint, i: Island, blink: number): void;
  /**
   * An agent's place, `h` px tall: how long its current run has been working (the Stack). `shade`
   * (0–1): how far a quiet agent goes toward its theme's SHADE (map.ts dims by recency). Sprites drawn
   * now are already darkened (sprites.ts setShade); the painter darkens its own shapes and textures by
   * the same amount.
   */
  place(p: Paint, s: Slot, h: number, status: string, alive: boolean, shade: number): void;
  /** What the place covers, `h` px tall, as outlines in world px (shapes.ts): taps land on what is drawn. */
  placeShape(iso: Iso, s: Slot, h: number): Pt[][];
  /** A Buzz channel on the place; null: none. */
  buzz(p: Paint, s: Slot, state: string | null): void;
  /** An agent's unit, feet at (x, y). */
  unit(p: Paint, x: number, y: number, o: UnitLook): void;
  /** What a working unit carries to the base, held at (x, y). */
  carry(p: Paint, s: Slot, x: number, y: number, flip: boolean): void;
  /** A missing agent: what stands where its unit should be. */
  standIn(p: Paint, x: number, y: number, alpha: number): void;
  /** Spend in flight to a place. */
  coin(p: Paint, x: number, y: number, r: number, alpha: number): void;
  /** Scenery on free ground. */
  decor(p: Paint, d: Decor): void;
  /** Over everything, in world space: weather, light, time of day. */
  sky(p: Paint, bounds: { x0: number; y0: number; x1: number; y1: number }, cores: Pt[], places: Pt[]): void;
}

const PAINTERS: Partial<Record<ThemeId, Painter>> = { farm: farm.painter, lab: lab.painter, cubicles: cubicles.painter };

/** The active theme's painter; null for the neon city. */
export const painterFor = (id: ThemeId): Painter | null => PAINTERS[id] ?? null;
