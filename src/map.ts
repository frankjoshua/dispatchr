import { obj, str } from './data';
import { DEAD, GHOST, buzzLabel, channelColor, kindOf, nodeStateOf, rgba, statusOf, type Kind } from './format';
import { painterFor, type Paint } from './painters';
import { pal, theme } from './theme';
import { presence } from './presence-state';
import { sleeps } from './presence';
import { boxOutline, hits } from './shapes';
import { fitView, type Extent } from './framing';
import { settings } from './settings';
import { badgeLook, badgesInStack, iconName, type Badge, type BadgeAction, type IconName } from './badges';
import { drawIcon } from './icons';
import { store } from './store';
import { usage, type Helper } from './usage';
import type { RostrEvent } from './types';
import { SHADE, pattern, preload, setShade, sprite, stand } from './sprites';
import { buildWorld, type Decor, type District, type Island, type Rect, type Slot, type TeamBlock, type World } from './world';
import { coreName, NAMES_ZOOM, oneLine, plateRank, plateShown, wrapName } from './nameplate';
import { Effects } from './effects';
import { STACK_K, STACK_MIN, stackHeight } from './stack';

// The isometric map on a 2D canvas, in the look of design/play: islands for computers, districts for
// spaces, a building and a unit per agent. Everything that moves either shows a status rostr reported or
// replays an event that just arrived: nothing is invented.

const TW = 64;
const TH = 32;
const SLAB = 40; // island thickness (px)
const MONO = '"IBM Plex Mono", ui-monospace, monospace';
const SANS = '"IBM Plex Sans", system-ui, sans-serif';
const art = () => painterFor(theme.id);
const display = () => art()?.font ?? '"Chakra Petch", "IBM Plex Sans", sans-serif';
const CYAN = '#5ee7ff';
const GOLD = '#ffd36e';
const RED = '#ff4d6a';
const GREEN = '#4dff9a';
const BUZZ = '#4dffd2';
// Name plates: an agent's name on a dark pill under its character: the name's core on one line
// (nameplate.ts), the selected agent's whole name wrapped. Small up to zoom 0.9, large from there.
const NAME_FONTS = [`600 10px ${MONO}`, `600 11px ${MONO}`];
const NAME_LINE = [13, 14];
const NAME_MAX = 120, NAME_PAD_X = 7, NAME_PAD_Y = 3;
/** Screen px from the unit's feet down to the top of its name plate. */
const NAME_TOP = 6;
/** The camera's zoom range for the wheel and pinch; Fit may go further out to show everything. */
const MIN_ZOOM = 0.2, MAX_ZOOM = 2.6;

interface P { x: number; y: number }
const iso = (x: number, y: number, z = 0): P => ({ x: ((x - y) * TW) / 2, y: ((x + y) * TH) / 2 - z });

interface UnitFx {
  warp: number; warpC: string; flash: number; flashC: string; wave: number; roof: number; roofC: string;
  /** Walking between the building and the base: distance along the route, the leg, time spent waiting, position, facing. */
  dist: number; phase: 'home' | 'out' | 'base' | 'back'; timer: number; wx: number; wy: number; flip: boolean;
}
interface Ember { agent: string; r: number; t: number }
/** Travels from the computer's core, or from the `from` agent, to `agent`. */
interface Beam { island: string; agent: string; from?: string; c: string; t: number }
interface Ring { agent: string; c: string; t: number }
interface Float { agent: string; text: string; c: string; t: number }
interface Boot { island: string; c: string; t: number }

export interface MapView {
  /** Rebuilds the scene from the store (and the viewport's shape). */
  refresh(): void;
  /** The agent picked anywhere (map, lists, search, log): ringed, lit, named in full; null for none. */
  select(id: string | null): void;
  /** Flies to an agent, putting it back on the map first if it was packed away. */
  focus(id: string): void;
  /** Frames a space on a computer, or a team in it by its lead's id. */
  focusSpace(nodeId: string, spaceId: string, leadId?: string): void;
  fit(): void;
  /** Screen px along the bottom kept clear by an overlay (the loop bar, a card over the map): Fit and flights frame above it. */
  setInset(bottom: number): void;
  /** Whether another view lies over the whole map (a phone tab): it then stops drawing, but keeps its light and effects current. */
  setCovered(covered: boolean): void;
  event(e: RostrEvent): void;
  /** A live usage delta for one agent. */
  usage(agentId: string, cost: number, tokens: number): void;
}

export interface MapTap { x: number; y: number; t: number; shift: boolean; action?: BadgeAction }

const ALIVE = new Set(['working', 'idle', 'blocked', 'done', 'unknown']);
/** The neon robot as drawn, in world px: feet to head, and across its arms. */
const UNIT_H = 50, UNIT_W = 40;
/** The most of each effect kept queued (effects.ts). */
const EFFECTS_MAX = 256;
// The phone layout of style.css (tabs, unit card as a bottom sheet); keep the two queries the same.
const PHONE = matchMedia('(max-width: 820px), (max-height: 500px)');

/** `onTap`: a tap or click on the map, with the unit under it (or null), where it landed on screen,
 * when it happened (the event's timeStamp, so a busy page cannot stretch a double tap) and whether Shift
 * was held. */
export function createMap(host: HTMLElement, onTap: (id: string | null, at: MapTap) => void): MapView {
  const cv = document.createElement('canvas');
  cv.className = 'world';
  cv.setAttribute('aria-label', 'Map of computers and agents. The roster lists the same agents.');
  host.append(cv);
  const banner = document.createElement('div');
  banner.className = 'banner';
  host.append(banner);
  const maybeCtx = cv.getContext('2d');
  if (!maybeCtx) throw new Error('canvas 2d unavailable');
  const ctx = maybeCtx;
  // What a painted theme's painter borrows (painters.ts); the helpers below are hoisted function declarations.
  const paint: Paint = { ctx, t: () => T, iso, poly, box, ground: groundPattern };
  preload(['n_core', 'n_tree', 'n_lamp', 'n_drone', 'n_floor', 'n_wall', 'n_robot_omp', 'n_robot_claude', 'n_robot_codex', 'n_robot_pi']);
  preload(art()?.sprites ?? []);
  theme.onChange(() => preload(art()?.sprites ?? []));

  /** Scenery: the painted theme's props, or holo-trees and street lamps in the city. */
  function drawDecor(d: Decor) {
    const a = art();
    if (a) { a.decor(paint, d); return; }
    const q = iso(d.x, d.y);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(q.x, q.y, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
    if (d.r < 0.6) {
      const img = sprite('n_tree');
      if (img) stand(ctx, img, q.x, q.y + 2, 58 + d.r * 24, { flip: d.r > 0.3 });
      return;
    }
    const img = sprite('n_lamp');
    if (!img) return;
    stand(ctx, img, q.x, q.y + 2, 54);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow(q.x + 6, q.y - 50, 26, CYAN, 0.35 + 0.08 * Math.sin(T * 3 + d.r * 20));
    ctx.restore();
  }

  /** The extent of everything on the map, in world px (for things that roam: drones, birds). */
  function worldBounds() {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const r of world.islands.flatMap((i) => i.slabs)) {
      for (const p of [iso(r.x0, r.y0), iso(r.x1, r.y0), iso(r.x1, r.y1), iso(r.x0, r.y1)]) {
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
    }
    return { x0, y0: y0 - 160, x1, y1 };
  }

  /** Drones patrolling over the city, each on its own looping figure, lights blinking, shadows below. */
  function drawDrones() {
    const img = sprite('n_drone');
    if (!img || !world.islands.length) return;
    const b = bounds;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2 + 60, rx = (b.x1 - b.x0) * 0.42, ry = (b.y1 - b.y0) * 0.3;
    for (let k = 0; k < 3; k++) {
      const a = T * (0.07 + k * 0.025) + k * 2.1;
      const x = cx + Math.sin(a) * rx, ground = cy + Math.sin(a * 2 + k) * ry;
      const y = ground - 150 - Math.sin(T * 1.3 + k) * 8;
      const vx = Math.cos(a);
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.beginPath(); ctx.ellipse(x, ground, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
      stand(ctx, img, x, y, 20, { flip: vx < 0, rot: vx * 0.08 });
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      glow(x, y - 8, 16, Math.sin(T * 6 + k) > 0 ? '#ff4d6a' : CYAN, 0.5);
      ctx.restore();
    }
  }

  /** Little cars circling each city block: a white headlight and a red tail light. */
  function drawTraffic() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const i of world.islands) {
      for (const d of i.districts) {
        const x0 = d.x0 - 0.45, y0 = d.y0 - 0.45, x1 = d.x1 + 0.45, y1 = d.y1 + 0.45;
        const w = x1 - x0, h = y1 - y0, per = 2 * (w + h);
        const at = (u: number): P => {
          const s = ((u % per) + per) % per;
          if (s < w) return iso(x0 + s, y0);
          if (s < w + h) return iso(x1, y0 + s - w);
          if (s < 2 * w + h) return iso(x1 - (s - w - h), y1);
          return iso(x0, y1 - (s - 2 * w - h));
        };
        for (let k = 0; k < 3; k++) {
          const u = T * (1.1 + k * 0.25) + (k * per) / 3 + d.x0;
          const head = at(u), tail = at(u - 0.35);
          glow(head.x, head.y, 5, '#ffffff', 0.9);
          glow(tail.x, tail.y, 4, RED, 0.8);
        }
      }
    }
    ctx.restore();
  }

  let world: World = { islands: [], slots: new Map(), links: [], shape: '' };
  let selected: string | null = null;
  let hover: string | null = null;
  let userMoved = false;

  /**
   * The agent the camera was last flown to: held in frame as the scene reshapes (more of rostr arriving,
   * a neighbour packed away) and as overlays come and go, until the viewer moves the camera or picks
   * another agent.
   */
  let flight: string | null = null;
  let W = 1;
  let H = 1;
  let DPR = 1;
  let T = 0;
  const cam = { x: 0, y: 0, z: 0.8, tx: 0, ty: 0, tz: 0.8 };
  const fx = new Map<string, UnitFx>();
  const beams = new Effects<Beam>(EFFECTS_MAX);
  const rings = new Effects<Ring>(EFFECTS_MAX);
  const floats = new Effects<Float>(EFFECTS_MAX);
  const boots = new Effects<Boot>(EFFECTS_MAX);
  const embers = new Effects<Ember>(EFFECTS_MAX);
  // What only a rebuild changes, worked out in refresh() for the frame to read: the world's extent,
  // each base (world px) and place (tiles) for a painter's sky, and the counts on the labels.
  let bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
  let cores: P[] = [];
  let places: P[] = [];
  interface Tally { agents: number; working: number; packed: number }
  const tallies = new Map<Island | District | TeamBlock, Tally>();
  /** agent id → its place's current (eased) height: the Stack. */
  const heights = new Map<string, number>();
  const heartbeat = new Map<string, { seen: string | null; blink: number }>();
  const stars = Array.from({ length: 180 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.2 + 0.3, p: Math.random() * 6 }));

  const unitFx = (id: string): UnitFx => {
    let f = fx.get(id);
    if (!f) {
      f = { warp: 0, warpC: GREEN, flash: 0, flashC: GOLD, wave: 0, roof: 0, roofC: pal().map.money, dist: 0, phase: 'home', timer: -((Number.parseInt(id.slice(-4), 16) % 40) / 10), wx: NaN, wy: NaN, flip: false };
      fx.set(id, f);
    }
    return f;
  };

  const targetHeight = (s: Slot, now: number) => stackHeight(s.agent.status, store.runs.get(s.agent.id), store.statusSince.get(s.agent.id), now);
  const heightOf = (s: Slot) => heights.get(s.agent.id) ?? STACK_MIN;

  // ─── camera

  const w2s = (p: P): P => ({ x: (p.x - cam.x) * cam.z + W / 2, y: (p.y - cam.y) * cam.z + H / 2 });
  const s2w = (sx: number, sy: number): P => ({ x: (sx - W / 2) / cam.z + cam.x, y: (sy - H / 2) / cam.z + cam.y });
  /** How far out the wheel and pinch go: MIN_ZOOM, or the last Fit when it had to go further. */
  let floorZ = MIN_ZOOM;
  const clampZ = (z: number) => Math.max(floorZ, Math.min(MAX_ZOOM, z));

  /** Screen px along the bottom of the map under an overlay (setInset). */
  let inset = 0;
  /** Another view lies over the whole map (setCovered). */
  let covered = false;

  /**
   * Fit: as close as the agents (places, units, names, badges) and the computers' bases allow; bare
   * ground may crop. Below NAMES_ZOOM only busy, blocked and recent agents carry names and badges are
   * markers, so a far view leaves out what is not drawn there.
   */
  function fit() {
    userMoved = false;
    flight = null;
    const h = H - inset;
    const far = fitView(fitExtents(0), W, h, 8, MAX_ZOOM);
    const view = far && far.z < NAMES_ZOOM ? far : fitView(fitExtents(NAMES_ZOOM), W, h, 8, MAX_ZOOM);
    if (!view) return;
    floorZ = Math.min(MIN_ZOOM, view.z);
    cam.tx = view.x; cam.ty = view.y + inset / (2 * view.z); cam.tz = view.z;
  }

  /** What Fit keeps on screen as drawn at zoom `z`; from NAMES_ZOOM every name and every ruled badge as a pill (an upper bound). */
  function fitExtents(z: number): Extent[] {
    const close = z >= NAMES_ZOOM;
    const out: Extent[] = [];
    const painter = art(), now = Date.now();
    for (const s of world.slots.values()) {
      const id = s.agent.id;
      const h = Math.max(heightOf(s), targetHeight(s, now));
      for (const outline of painter ? painter.placeShape(iso, s, h) : towerShape(s, h)) out.push(...outline);
      out.push(iso(s.gx + 1, s.gy + 1, h + 40)); // roof, flag and crystal
      const badges = presence.badges.get(id)?.filter((b) => b.ruled && (close || b.urgency !== 'quiet')).length ?? 0;
      if (badges) {
        const w = close ? 40 : 16;
        out.push({ ...linkEnd(s), left: w, right: w, top: 10 + Math.min(badges, MAP_BADGES + 1) * 26 });
      }
      out.push({ ...unitIso(s, painter?.unitH ?? UNIT_H), top: 24 }); // status icon
      if (namedAt(s, z)) {
        const plate = plateOf(s, 1);
        out.push({ ...unitIso(s), left: plate.w / 2, right: plate.w / 2, bottom: NAME_TOP + plate.h + (close ? 16 : 0) }); // name plate and chips
      }
    }
    for (const i of world.islands) {
      const b = iso(i.core.x, i.core.y);
      out.push({ x: b.x - 70, y: b.y - 120 }, { x: b.x + 70, y: b.y + 24 });
      for (const d of i.districts) {
        const a = iso(d.x0 + 0.4, d.y0 + 0.5, 6);
        out.push({ ...a, top: 8, bottom: 18, right: d.name.length * 10 + 4 });
      }
    }
    return out;
  }

  /**
   * Points the camera at ground rectangles (world tiles), zoomed to fit them above the overlays along
   * the bottom (setInset), with room above for towers (the tallest a run grows, plus roof, flag and
   * crystal) and `below` px under them for labels.
   */
  function frameRects(rects: Rect[], below: number) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const r of rects) {
      for (const p of [iso(r.x0, r.y0), iso(r.x1, r.y0), iso(r.x1, r.y1), iso(r.x0, r.y1)]) {
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
    }
    y0 -= 90 + STACK_MIN + STACK_K;
    y1 += below;
    const pad = W < 600 ? 12 : 40, h = H - inset;
    cam.tz = clampZ(Math.min((W - pad * 2) / (x1 - x0), (h - pad * 2) / (y1 - y0), 1.25));
    cam.tx = (x0 + x1) / 2;
    cam.ty = (y0 + y1) / 2 + inset / (2 * cam.tz);
  }

  function focusSpace(nodeId: string, spaceId: string, leadId?: string) {
    const d = world.islands.find((i) => i.id === nodeId)?.districts.find((x) => x.id === spaceId);
    if (!d) return;
    const team = leadId ? d.teams.find((t) => t.manager.agent.id === leadId) : undefined;
    frameRects([team ?? d], 24);
    userMoved = true;
    flight = null;
  }

  function focus(id: string) {
    // Packed away: back on the map for this visit, since it is being looked for.
    if (presence.packed.has(id)) { presence.revealed.add(id); refresh(); }
    if (!world.slots.has(id)) return;
    flight = id;
    cam.tz = Math.max(cam.tz, PHONE.matches ? 1.05 : 0.95);
    aim();
    userMoved = true;
  }

  /**
   * Points the camera at the flight's agent, centred in what the overlays along the bottom leave (setInset):
   * at its own spot, not where it is walking, which after a reshape is still in the old layout.
   */
  function aim() {
    const s = flight ? world.slots.get(flight) : undefined;
    if (!s) return;
    const p = iso(s.ux, s.uy, 20);
    cam.tx = p.x;
    cam.ty = p.y + inset / (2 * cam.tz);
  }

  function resize() {
    const r = host.getBoundingClientRect();
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    if (columnMode() !== column) { userMoved = false; refresh(); return; }
    if (!userMoved) { fit(); cam.x = cam.tx; cam.y = cam.ty; cam.z = cam.tz; }
  }
  new ResizeObserver(resize).observe(host);

  // ─── input: drag to pan, wheel or pinch to zoom, click or tap to select

  const pointers = new Map<number, P>();
  let press: { x: number; y: number; moved: boolean } | null = null;
  let pinch: { d: number; mid: P } | null = null;
  const local = (e: PointerEvent | WheelEvent): P => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const pinchOf = (): { d: number; mid: P } => {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };
  function zoomAt(sx: number, sy: number, z: number) {
    const before = s2w(sx, sy);
    cam.z = cam.tz = clampZ(z);
    const after = s2w(sx, sy);
    cam.x = cam.tx = cam.x + before.x - after.x;
    cam.y = cam.ty = cam.y + before.y - after.y;
    userMoved = true;
    flight = null;
  }

  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) press = { ...p, moved: false };
    if (pointers.size === 2) { pinch = pinchOf(); if (press) press.moved = true; }
  });
  cv.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (e.pointerType === 'mouse' && !pointers.size) { hover = under(p.x, p.y, 0).id; cv.style.cursor = hover ? 'pointer' : 'grab'; }
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const now = pinchOf();
      zoomAt(now.mid.x, now.mid.y, cam.z * (now.d / Math.max(1, pinch.d)));
      cam.x = cam.tx -= (now.mid.x - pinch.mid.x) / cam.z;
      cam.y = cam.ty -= (now.mid.y - pinch.mid.y) / cam.z;
      pinch = now;
      return;
    }
    if (!press) return;
    if (!press.moved && Math.hypot(p.x - press.x, p.y - press.y) > 6) press.moved = true;
    if (press.moved) {
      cam.x = cam.tx -= (p.x - prev.x) / cam.z;
      cam.y = cam.ty -= (p.y - prev.y) / cam.z;
      userMoved = true;
      flight = null;
      cv.style.cursor = 'grabbing';
    }
  });
  const release = (e: PointerEvent) => {
    if (press && !press.moved && pointers.size === 1 && e.type === 'pointerup') {
      const p = local(e);
      const hit = under(p.x, p.y, e.pointerType === 'mouse' ? 0 : 10);
      onTap(hit.id, { x: e.clientX, y: e.clientY, t: e.timeStamp, shift: e.shiftKey, action: hit.action });
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) { press = null; cv.style.cursor = hover ? 'pointer' : 'grab'; }
  };
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', release);
  cv.addEventListener('pointerleave', () => { hover = null; });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    zoomAt(p.x, p.y, cam.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });

  /** The agent under a screen point: units first, then places by what they cover (shapes.ts); front to back. */
  function pick(sx: number, sy: number, slop = 0): string | null {
    const z = cam.z, painter = art(), unitH = painter?.unitH ?? UNIT_H, unitHalfW = (painter?.unitW ?? UNIT_W) / 2;
    const byUnit = [...world.slots.values()].sort((a, b) => b.ux + b.uy - (a.ux + a.uy));
    for (const s of byUnit) {
      if (asleep(s)) continue; // no character drawn, so none to press
      const p = w2s(unitIso(s));
      if (Math.abs(sx - p.x) < unitHalfW * z + slop && sy > p.y - unitH * z - slop && sy < p.y + 8 * z + slop) return s.agent.id;
    }
    const at = s2w(sx, sy), reach = slop / z;
    const byPlace = [...world.slots.values()].sort((a, b) => b.gx + b.gy - (a.gx + a.gy));
    for (const s of byPlace) {
      const shape = painter ? painter.placeShape(iso, s, heightOf(s)) : towerShape(s, heightOf(s));
      if (shape.some((outline) => hits(outline, at, reach))) return s.agent.id;
    }
    return null;
  }

  /** What a press lands on, top-most first as drawn: a name plate, a badge (and its action), a unit, a place. */
  function under(x: number, y: number, slop: number): { id: string | null; action?: BadgeAction } {
    const plate = plateAt(x, y, slop / 2);
    if (plate) return { id: plate };
    const badge = badgeHit(x, y, slop);
    return badge ? { id: badge.agentId, action: badge.action } : { id: pick(x, y, slop) };
  }

  /** The neon tower: its walls up to `h`, and the roof house on top. */
  const towerShape = (s: Slot, h: number): P[][] => [boxOutline(iso, s.gx, s.gy, 2, 2, h), boxOutline(iso, s.gx + 0.45, s.gy + 0.45, 1.1, 1.1, 8, h)];

  // ─── primitives

  function poly(pts: P[], fill: string | CanvasGradient | CanvasPattern) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  function vgrad(y0: number, y1: number, a: string, b: string) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    return g;
  }
  function box(gx: number, gy: number, w: number, d: number, z: number, h: number, top: string, left: string | CanvasGradient, right: string | CanvasGradient, rim = 'rgba(160,210,255,.13)') {
    const A = iso(gx, gy, z + h), B = iso(gx + w, gy, z + h), C = iso(gx + w, gy + d, z + h), D = iso(gx, gy + d, z + h);
    const Cb = iso(gx + w, gy + d, z), Db = iso(gx, gy + d, z), Bb = iso(gx + w, gy, z);
    poly([Db, Cb, C, D], left);
    poly([Cb, Bb, B, C], right);
    poly([A, B, C, D], top);
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(D.x, D.y); ctx.lineTo(A.x, A.y); ctx.lineTo(B.x, B.y);
    ctx.moveTo(D.x, D.y); ctx.lineTo(C.x, C.y); ctx.lineTo(B.x, B.y);
    ctx.moveTo(C.x, C.y); ctx.lineTo(Cb.x, Cb.y);
    ctx.stroke();
  }
  const hash = (a: number, b: number, c: number) => { const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return x - Math.floor(x); };
  function ellipse(x: number, y: number, rx: number, ry: number) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); }
  /** A neon line's glow without shadowBlur, which phones redraw on the CPU every frame (the map ran at
   * 1 fps there): the path built so far, stroked wide and faint, then crisp. */
  function glowStroke(c: string, a: number, w: number, spread: number) {
    ctx.lineWidth = w + spread; ctx.strokeStyle = rgba(c, a * 0.22); ctx.stroke();
    ctx.lineWidth = w; ctx.strokeStyle = rgba(c, a); ctx.stroke();
  }
  function glow(x: number, y: number, r: number, c: string, a: number) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(c, a));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function crystal(x: number, y: number, r: number, c: string) {
    const s = Math.sin(T * 1.8) * r * 0.55;
    const top = { x, y: y - r * 1.7 }, bot = { x, y: y + r * 1.3 }, L = { x: x - r, y }, R = { x: x + r, y }, M = { x: x + s, y: y + r * 0.25 };
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow(x, y, r * 4, c, 0.45);
    ctx.restore();
    for (const [f, o] of [[[top, L, M], 'rgba(255,255,255,.45)'], [[top, M, R], 'rgba(255,255,255,.12)'], [[bot, L, M], 'rgba(0,0,0,.15)'], [[bot, M, R], 'rgba(0,0,0,.45)']] as const) {
      poly([...f], c);
      poly([...f], o);
    }
  }

  // ─── islands

  function islandColor(i: Island): { c: string; fl: number } {
    const state = i.node?.state ?? 'offline';
    if (state === 'online') return { c: CYAN, fl: 1 };
    if (state === 'stale') return { c: '#ffb547', fl: 0.55 + 0.45 * Math.abs(Math.sin(T * 3)) };
    return { c: '#7a8699', fl: 0.35 };
  }

  /** Column layout: walkways between a computer's stacked slabs (the painted theme's, or a light bridge). */
  function drawBridges(i: Island) {
    const painted = art();
    for (const [a, b] of i.bridges) {
      if (painted) { painted.bridge(paint, a, b); continue; }
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const px = (-dy / len) * 0.4, py = (dx / len) * 0.4;
      const deck = [iso(a.x + px, a.y + py), iso(b.x + px, b.y + py), iso(b.x - px, b.y - py), iso(a.x - px, a.y - py)];
      poly(deck, 'rgba(14,30,52,.95)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath(); ctx.moveTo(deck[0].x, deck[0].y); ctx.lineTo(deck[1].x, deck[1].y);
      ctx.moveTo(deck[3].x, deck[3].y); ctx.lineTo(deck[2].x, deck[2].y);
      glowStroke(CYAN, 0.7, 1.5, 6);
      ctx.restore();
    }
  }

  function drawIsland(i: Island) {
    const a = art();
    if (a) {
      for (const r of i.slabs) a.slab(paint, r, i.node?.state ?? 'offline');
      drawBridges(i);
      for (const d of i.districts) {
        a.field(paint, d);
        for (const t of d.teams) a.team(paint, t, kindOf(t.manager.agent.kind).c);
      }
      a.core(paint, i, heartbeat.get(i.id)?.blink ?? 0);
      drawBoots(i);
      return;
    }
    const { c, fl } = islandColor(i);
    for (const r of i.slabs) drawSlab(r, c, fl);
    drawBridges(i);

    for (const d of i.districts) {
      const a = iso(d.x0, d.y0), b = iso(d.x1, d.y0), cc = iso(d.x1, d.y1), dd = iso(d.x0, d.y1);
      poly([a, b, cc, dd], rgba(d.color, 0.05));
      ctx.save();
      ctx.strokeStyle = rgba(d.color, 0.32);
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(cc.x, cc.y); ctx.lineTo(dd.x, dd.y); ctx.closePath();
      ctx.stroke();
      ctx.restore();
      // The district's banner strip along its back edge.
      poly([iso(d.x0 + 0.3, d.y0 + 0.3), iso(d.x1 - 0.3, d.y0 + 0.3), iso(d.x1 - 0.3, d.y0 + 0.75), iso(d.x0 + 0.3, d.y0 + 0.75)], rgba(d.color, 0.28));
      // Teams: a pad with a solid edge kept visible when zoomed out (brighter around the selected
      // agent's teams) and a name strip in the manager's colour.
      const px = 1 / Math.min(1, cam.z);
      for (const t of d.teams) {
        const on = t.slots.some((s) => s.agent.id === selected);
        const corners = [iso(t.x0, t.y0), iso(t.x1, t.y0), iso(t.x1, t.y1), iso(t.x0, t.y1)];
        poly(corners, rgba(d.color, on ? 0.1 : 0.06));
        ctx.save();
        ctx.strokeStyle = rgba(d.color, on ? 0.95 : 0.6);
        ctx.lineWidth = (on ? 2.2 : 1.4) * px;
        ctx.beginPath();
        corners.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
        poly([iso(t.x0 + 0.25, t.y0 + 0.25), iso(t.x1 - 0.25, t.y0 + 0.25), iso(t.x1 - 0.25, t.y0 + 0.65), iso(t.x0 + 0.25, t.y0 + 0.65)], rgba(kindOf(t.manager.agent.kind).c, 0.45));
      }
    }
    drawCore(i);
  }

  function drawSlab(r: Rect, c: string, fl: number) {
    const A = iso(r.x0, r.y0), B = iso(r.x1, r.y0), C = iso(r.x1, r.y1), D = iso(r.x0, r.y1);
    const dn = (p: P) => ({ x: p.x, y: p.y + SLAB });
    const center = iso((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow(center.x, center.y + 60, (r.x1 - r.x0 + r.y1 - r.y0) * 24, c, 0.09 * fl);
    ctx.restore();
    poly([D, C, dn(C), dn(D)], vgrad(D.y, C.y + SLAB, '#14253d', '#03060c'));
    poly([C, B, dn(B), dn(C)], vgrad(B.y, C.y + SLAB, '#0c1828', '#020408'));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.moveTo(D.x, D.y + SLAB); ctx.lineTo(C.x, C.y + SLAB); ctx.lineTo(B.x, B.y + SLAB);
    glowStroke(c, 0.6 * fl, 2, 9);
    ctx.restore();
    poly([A, B, C, D], groundPattern('n_floor', r.x0, r.y0, 2) ?? '#0e1a2b');
    poly([A, B, C, D], 'rgba(6,12,24,.35)');
    ctx.strokeStyle = rgba(c, 0.06);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = r.x0 + 1; x < r.x1 - 0.5; x += 1) { const a = iso(x, r.y0), b = iso(x, r.y1); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    for (let y = r.y0 + 1; y < r.y1 - 0.5; y += 1) { const a = iso(r.x0, y), b = iso(r.x1, y); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.stroke();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(C.x, C.y); ctx.lineTo(D.x, D.y); ctx.closePath();
    glowStroke(c, 0.55 * fl, 1.5, 6);
    ctx.restore();
  }

  function drawCore(i: Island) {
    const { c } = islandColor(i);
    const { x, y } = i.core;
    const hb = heartbeat.get(i.id)?.blink ?? 0;
    const g = iso(x, y, 12);
    const img = sprite('n_core', i.node?.state === 'offline' || !i.node ? 'gray' : undefined);
    if (!img) box(x - 0.6, y - 0.6, 1.2, 1.2, 0, 12, '#1f3350', '#142540', '#0c182a');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(c, 0.4 + 0.55 * hb);
    ctx.lineWidth = 1.5;
    ellipse(g.x, g.y + 12, 26, 13);
    ctx.restore();
    drawBoots(i);
    if (img) {
      const base = iso(x, y);
      stand(ctx, img, base.x, base.y + 10, 112);
      // The crystal flares on every heartbeat.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      glow(base.x, base.y - 88, 34 + hb * 18, c, 0.18 + 0.5 * hb);
      ctx.restore();
      return;
    }
    const top = iso(x, y, 50 + Math.sin(T * 2 + x) * 4);
    crystal(top.x, top.y, 9, i.node?.state === 'offline' || !i.node ? '#3a4656' : c);
  }

  /** A top-down texture laid flat on the iso ground: `tiles` tiles per texture, anchored at (x0, y0). */
  function groundPattern(name: string, x0: number, y0: number, tiles: number): CanvasPattern | null {
    const pat = pattern(ctx, name);
    if (!pat) return null;
    const o = iso(x0, y0), k = tiles / 256;
    pat.setTransform(new DOMMatrix([32 * k, 16 * k, -32 * k, 16 * k, o.x, o.y]));
    return pat;
  }

  /**
   * A front-on texture on a vertical face whose top-left corner is `o` and whose width runs along
   * (ux, uy). Every face shares the one pattern (sprites.ts keeps one per name): place it right
   * before each fill.
   */
  function wallAt(pat: CanvasPattern, o: P, ux: number, uy: number): CanvasPattern {
    pat.setTransform(new DOMMatrix([ux / 256, uy / 256, 0, 0.25, o.x, o.y]));
    return pat;
  }

  /** A computer (re)connecting or going quiet: rings spread from its core. */
  function drawBoots(i: Island) {
    const g = iso(i.core.x, i.core.y, 12);
    ctx.save();
    if (!theme.painted) ctx.globalCompositeOperation = 'lighter';
    for (const b of boots) {
      if (b.island !== i.id) continue;
      const r = 22 + b.t * 160;
      ctx.strokeStyle = rgba(b.c, 1 - b.t);
      ctx.lineWidth = 3;
      ellipse(g.x, g.y, r, r / 2);
    }
    ctx.restore();
  }

  // ─── buildings and units

  function look(s: Slot): { st: string; alive: boolean; P: Kind; col: string } {
    const st = s.agent.status;
    const alive = ALIVE.has(st);
    const K = kindOf(s.agent.kind);
    const P = st === 'missing' ? GHOST : alive ? K : DEAD;
    return { st, alive, P, col: st === 'blocked' ? GOLD : alive ? K.c : '#56637a' };
  }

  /** Lit windows show activity; on a textured wall only the lit ones are drawn. */
  function windows(s: Slot, h: number, col: string, lit: number, flick: number, textured = false) {
    const { gx, gy } = s, w = 2, d = 2, rs = 11, cs = 0.5, ww = 0.28, wh = 5, m = 10, fr = Math.floor(T * flick);
    const on = new Path2D(), off = new Path2D();
    const q = (p: Path2D, a: P, b: P, c: P, e: P) => { p.moveTo(a.x, a.y); p.lineTo(b.x, b.y); p.lineTo(c.x, c.y); p.lineTo(e.x, e.y); p.closePath(); };
    let r = 0;
    for (let z = m; z < h - m + 1; z += rs, r++) {
      for (let i = 0; i * cs < w - 0.05; i++) {
        const x = gx + cs * 0.25 + i * cs;
        q(hash(s.seed, r, i + fr * (1 + (i % 3))) < lit ? on : off, iso(x, gy + d, z), iso(x + ww, gy + d, z), iso(x + ww, gy + d, z + wh), iso(x, gy + d, z + wh));
      }
      for (let i = 0; i * cs < d - 0.05; i++) {
        const y = gy + cs * 0.25 + i * cs;
        q(hash(s.seed + 9, r, i + fr * (1 + (i % 2))) < lit ? on : off, iso(gx + w, y, z), iso(gx + w, y + ww, z), iso(gx + w, y + ww, z + wh), iso(gx + w, y, z + wh));
      }
    }
    if (!textured) {
      ctx.fillStyle = 'rgba(150,190,240,.06)';
      ctx.fill(off);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 3; ctx.strokeStyle = rgba(col, 0.18); ctx.stroke(on); // their glow
    ctx.fillStyle = rgba(col, 0.85);
    ctx.fill(on);
    ctx.restore();
  }

  function drawBuilding(s: Slot) {
    const { gx, gy } = s;
    const h = heightOf(s);
    const { st, alive, col } = look(s);
    const a = art();
    if (a) {
      a.place(paint, s, h, st, alive, shadeOf(s));
      // The most recent places stand in a pool of light on the shaded ground (dim by recency, below).
      const sun = groundShade() ? Math.max(0, (lightOf(s) - 0.6) / 0.4) : 0;
      if (sun > 0) {
        const c = iso(gx + 1, gy + 1, Math.min(h, 60) * 0.5);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        glow(c.x, c.y, 70, '#ffe7a0', 0.42 * sun);
        ctx.restore();
      }
      a.buzz(paint, s, s.agent.channels.find((c) => c.type === 'buzz')?.state ?? null);
      roofRing(s, h);
      return;
    }
    const sc = s.district.color;
    const D0 = iso(gx, gy + 2, h), C0 = iso(gx + 2, gy + 2, h), Cb = iso(gx + 2, gy + 2), Db = iso(gx, gy + 2), Bb = iso(gx + 2, gy), B0 = iso(gx + 2, gy, h);
    const wall = pattern(ctx, 'n_wall');
    if (wall) {
      // Glass-and-steel walls; light from the top-left, so the right face sits in shade.
      poly([D0, C0, Cb, Db], wallAt(wall, D0, C0.x - D0.x, C0.y - D0.y));
      poly([D0, C0, Cb, Db], vgrad(D0.y, Db.y, 'rgba(8,16,32,.15)', 'rgba(4,8,18,.55)'));
      poly([C0, B0, Bb, Cb], wallAt(wall, C0, B0.x - C0.x, B0.y - C0.y));
      poly([C0, B0, Bb, Cb], vgrad(B0.y, Cb.y, 'rgba(4,8,18,.45)', 'rgba(2,4,10,.75)'));
      poly([iso(gx, gy, h), B0, C0, D0], '#22385a');
      if (!alive) { poly([D0, C0, Cb, Db], 'rgba(3,6,12,.6)'); poly([C0, B0, Bb, Cb], 'rgba(3,6,12,.6)'); }
    } else {
      box(gx, gy, 2, 2, 0, h, '#24395a',
        vgrad(iso(gx, gy + 2, h).y, iso(gx + 2, gy + 2).y, '#1e3354', '#0b1525'),
        vgrad(iso(gx + 2, gy, h).y, iso(gx + 2, gy + 2).y, '#132542', '#060c17'));
    }
    windows(s, h, col, st === 'working' ? 0.62 : st === 'blocked' ? 0.55 : alive ? 0.22 : 0.03, st === 'working' ? 4 : st === 'blocked' ? 6 : 0.35, !!wall);
    // Space stripe under the roof.
    poly([iso(gx, gy + 2, h - 7), iso(gx + 2, gy + 2, h - 7), iso(gx + 2, gy + 2, h - 3), iso(gx, gy + 2, h - 3)], rgba(sc, 0.85));
    const p1 = iso(gx, gy + 2, 2), p2 = iso(gx + 2, gy + 2, 2), p3 = iso(gx + 2, gy, 2);
    const A = iso(gx, gy, h), B = iso(gx + 2, gy, h), C = iso(gx + 2, gy + 2, h), D = iso(gx, gy + 2, h);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
    glowStroke(col, alive ? 0.75 : 0.15, 2, 7);
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(C.x, C.y); ctx.lineTo(D.x, D.y); ctx.closePath();
    glowStroke(col, alive ? 0.55 : 0.12, 1.2, 5);
    ctx.restore();
    box(gx + 0.45, gy + 0.45, 1.1, 1.1, h, 7, '#2a4166', '#1a2c48', '#111f36');
    const shade = shadeOf(s);
    if (shade > 0) {
      // Night over a quiet tower: its outline, walls, windows and roof house, in one shape.
      const night = `rgba(${SHADE.city.join(',')},${shade})`;
      poly([Db, Cb, Bb, B0, iso(gx, gy, h), D0], night);
      poly([iso(gx + 0.45, gy + 1.55, h), iso(gx + 1.55, gy + 1.55, h), iso(gx + 1.55, gy + 0.45, h), iso(gx + 1.55, gy + 0.45, h + 7), iso(gx + 0.45, gy + 0.45, h + 7), iso(gx + 0.45, gy + 1.55, h + 7)], night);
    }
    ctx.globalAlpha = 1 - shade;
    drawFlag(s, sc, h);
    drawAntenna(s, h);
    ctx.globalAlpha = 1;
    if (st === 'working') { const c = iso(gx + 1, gy + 1, h + 30 + Math.sin(T * 2.5 + s.seed) * 3); crystal(c.x, c.y, 5, kindOf(s.agent.kind).c); }
    if (st === 'blocked') {
      const c = iso(gx + 1, gy + 1, h + 8);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      glow(c.x, c.y, 40, GOLD, 0.3 + 0.22 * Math.sin(T * 8));
      ctx.restore();
    }
    roofRing(s, h);
  }

  /** Usage just landed on this roof (or crop), or the session restarted: a ring spreads from it. */
  function roofRing(s: Slot, h: number) {
    const roof = unitFx(s.agent.id);
    if (roof.roof <= 0) return;
    const c = iso(s.gx + 1, s.gy + 1, h + 7);
    const r = 18 + (1 - roof.roof) * 40;
    ctx.save();
    if (!theme.painted) ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(roof.roofC, roof.roof * 0.9);
    ctx.lineWidth = 2;
    ellipse(c.x, c.y, r, r / 2);
    ctx.restore();
  }

  function drawFlag(s: Slot, sc: string, h: number) {
    const a0 = iso(s.gx + 1.7, s.gy + 0.35, h), a1 = iso(s.gx + 1.7, s.gy + 0.35, h + 28), wv = Math.sin(T * 4 + s.seed) * 2.2;
    ctx.strokeStyle = '#4a6688';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.stroke();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(sc, 0.9);
    ctx.beginPath();
    ctx.moveTo(a1.x, a1.y);
    ctx.quadraticCurveTo(a1.x - 8, a1.y - 1 + wv, a1.x - 17, a1.y + 2 + wv * 0.6);
    ctx.lineTo(a1.x - 17, a1.y + 11 + wv * 0.6);
    ctx.quadraticCurveTo(a1.x - 8, a1.y + 8 + wv, a1.x, a1.y + 9);
    ctx.closePath();
    ctx.lineWidth = 4; ctx.strokeStyle = rgba(sc, 0.22); ctx.stroke(); // its glow
    ctx.fill();
    ctx.restore();
  }

  /** A Buzz channel is a roof antenna: waves while attached, amber blink while pending, red when down. */
  function drawAntenna(s: Slot, h: number) {
    const ch = s.agent.channels.find((c) => c.type === 'buzz');
    if (!ch) return;
    const base = iso(s.gx + 0.35, s.gy + 1.55, h), tip = iso(s.gx + 0.35, s.gy + 1.55, h + 24);
    ctx.strokeStyle = '#6f8cb0';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(tip.x, tip.y); ctx.moveTo(tip.x - 5, tip.y + 6); ctx.lineTo(tip.x, tip.y + 2); ctx.lineTo(tip.x + 5, tip.y + 6); ctx.stroke();
    const attached = ch.state === 'attached' || ch.state === 'ok';
    const c = attached ? BUZZ : ch.state === 'pending' ? '#ffb547' : RED;
    const on = attached || (ch.state === 'pending' ? Math.sin(T * 5) > 0 : true);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(c, (on ? 1 : 0.25) * 0.25); // its glow
    ctx.beginPath(); ctx.arc(tip.x, tip.y, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba(c, on ? 1 : 0.25);
    ctx.beginPath(); ctx.arc(tip.x, tip.y, 2.4, 0, Math.PI * 2); ctx.fill();
    if (attached) {
      const burst = unitFx(s.agent.id).wave;
      ctx.lineWidth = 1.3;
      for (let k = 0; k < 3; k++) {
        const t = (T * 0.6 + k / 3) % 1;
        const r = 5 + t * (14 + burst * 30);
        ctx.strokeStyle = rgba(c, (1 - t) * (0.55 + burst * 0.45));
        ctx.beginPath(); ctx.arc(tip.x, tip.y, r, -Math.PI * 0.85, -Math.PI * 0.15); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function body(x: number, y: number, P: Kind, alpha: number, visor: string, glyph: string, blink: number) {
    const g = ctx;
    g.save();
    g.globalAlpha *= alpha;
    g.fillStyle = P.d;
    g.beginPath(); g.roundRect(x - 5, y - 9, 3.6, 9, 1.5); g.roundRect(x + 1.4, y - 9, 3.6, 9, 1.5); g.fill();
    g.beginPath(); g.roundRect(x - 10, y - 23, 3.5, 10, 2); g.roundRect(x + 6.5, y - 23, 3.5, 10, 2); g.fill();
    const gr = g.createLinearGradient(x - 8, 0, x + 8, 0);
    gr.addColorStop(0, P.l); gr.addColorStop(0.45, P.c); gr.addColorStop(1, P.d);
    g.fillStyle = gr;
    g.beginPath(); g.roundRect(x - 7.5, y - 25, 15, 17, [6, 6, 4, 4]); g.fill();
    const hg = g.createLinearGradient(0, y - 36, 0, y - 25);
    hg.addColorStop(0, P.l); hg.addColorStop(1, P.c);
    g.fillStyle = hg;
    g.beginPath(); g.roundRect(x - 6.5, y - 36, 13, 11, 4.5); g.fill();
    const vx = x - 3.3;
    g.fillStyle = visor; // the visor's glow: a faint halo behind its frame
    g.save();
    g.globalAlpha *= 0.3;
    g.beginPath(); g.roundRect(vx - 2, y - 34, 13.4, 7.6, 3.5); g.fill();
    g.restore();
    g.fillStyle = '#0a1220';
    g.beginPath(); g.roundRect(vx - 0.6, y - 32.6, 10.2, 4.8, 2); g.fill();
    g.fillStyle = visor;
    g.beginPath(); g.roundRect(vx + 0.5, y - 31.6, 8, 2.6, 1.3); g.fill();
    g.fillStyle = 'rgba(255,255,255,.92)';
    g.font = `700 8px ${MONO}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(glyph, x, y - 16.5);
    g.strokeStyle = P.d;
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(x + 3.5, y - 35); g.lineTo(x + 5.5, y - 42); g.stroke();
    g.fillStyle = blink > 0 ? '#fff' : P.c;
    g.beginPath(); g.arc(x + 5.5, y - 42, 1.7, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function drawUnit(s: Slot) {
    const p = unitIso(s);
    const { st, P } = look(s);
    const f = unitFx(s.agent.id);
    const glyph = kindOf(s.agent.kind).glyph;
    if (s.agent.id === selected) {
      ctx.save();
      const sel = pal().map.selected;
      ctx.setLineDash([7, 4]); ctx.lineDashOffset = -T * 22;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 17, 8.5, 0, 0, Math.PI * 2);
      glowStroke(sel, 1, 1.8, 6);
      ctx.restore();
    } else if (s.agent.id === hover) {
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.2;
      ellipse(p.x, p.y, 15, 7.5);
    }
    if (f.warp > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const hh = 420, bw = 24 * f.warp + 2;
      ctx.fillStyle = vgrad(p.y - hh, p.y, rgba(f.warpC, 0), rgba(f.warpC, 0.9 * f.warp));
      ctx.fillRect(p.x - bw / 2, p.y - hh, bw, hh);
      ctx.strokeStyle = rgba(f.warpC, f.warp); ctx.lineWidth = 2;
      const r = (1 - f.warp) * 48 + 6;
      ellipse(p.x, p.y, r, r / 2);
      ctx.restore();
    }
    if (f.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      glow(p.x, p.y - 18, 44, f.flashC, f.flash * 0.6);
      ctx.restore();
    }
    if (st === 'missing') {
      ctx.save();
      ctx.strokeStyle = rgba(RED, 0.6); ctx.setLineDash([3, 4]); ctx.lineDashOffset = T * 10; ctx.lineWidth = 1.2;
      ellipse(p.x, p.y, 13, 6.5);
      ctx.restore();
      const ghost = 0.22 + (Math.sin(T * 9 + s.seed) > 0.85 ? 0.2 : 0);
      // A painted theme puts its stand-in where the unit should be; the city, a flickering hologram.
      const a = art();
      const holo = a ? null : sprite(robotName(s), 'ghost');
      if (a) a.standIn(paint, p.x, p.y, 0.55 + ghost);
      else if (holo) {
        ctx.save();
        ctx.globalAlpha = 0.3 + ghost;
        stand(ctx, holo, p.x + (Math.random() < 0.06 ? 3 : 0), p.y - 4 - Math.sin(T * 1.5 + s.seed) * 2, UNIT_H);
        ctx.restore();
      } else body(p.x, p.y - 4 - Math.sin(T * 1.5 + s.seed) * 2, P, ghost, '#5ee7ff', glyph, 0);
      return;
    }
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 10, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    if (st === 'exited') {
      // Fallen over: the process ended; rostr relaunches it if the agent asks for that.
      const a = art();
      const lying = a ? null : sprite(robotName(s), 'gray');
      ctx.save();
      ctx.translate(p.x + 2, p.y - 2);
      ctx.rotate(-1.35);
      if (a) a.unit(paint, 0, 0, { shirt: kindOf(s.agent.kind), kind: s.agent.kind, cast: s.cast, effort: s.effort, working: false, walking: false, sway: 0, dead: true, seed: s.seed, flip: false, blocked: false });
      else if (lying) stand(ctx, lying, 0, 0, UNIT_H);
      else body(0, 0, P, 0.85, '#3a4656', glyph, 0);
      ctx.restore();
      return;
    }
    if (st === 'blocked') {
      const r = 12 + Math.sin(T * 8) * 3;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(GOLD, 0.85); ctx.lineWidth = 2;
      ellipse(p.x, p.y, r, r / 2);
      ctx.restore();
    }
    const phase = s.seed;
    const flip = f.flip;
    const walking = f.phase === 'out' || f.phase === 'back';
    // At the building a working unit bustles; on the road it strides (a bob per step and a sway).
    const bob = walking ? Math.abs(Math.sin(T * 11 + phase)) * 2.6
      : st === 'working' ? Math.abs(Math.sin(T * 9 + phase)) * 2.2 : ALIVE.has(st) ? Math.sin(T * 2 + phase) * 0.8 : 0;
    const sway = walking ? Math.sin(T * 11 + phase) * 0.06 : 0;
    const alpha = st === 'node_offline' ? 0.4 : st === 'disabled' ? 0.55 : 1;
    const atWork = st === 'working' && f.phase === 'home';
    const a = art();
    if (a) {
      ctx.save();
      ctx.globalAlpha = alpha * (1 - f.warp * 0.6);
      a.unit(paint, p.x, p.y - bob, { shirt: kindOf(s.agent.kind), kind: s.agent.kind, cast: s.cast, effort: s.effort, working: atWork, walking, sway, dead: !ALIVE.has(st), seed: s.seed, flip, blocked: st === 'blocked' });
      ctx.restore();
      if (f.phase === 'out') carry(s, p.x, p.y - bob, flip);
      return;
    }
    const robot = sprite(robotName(s), ALIVE.has(st) ? undefined : 'gray');
    if (robot) {
      // Squash and stretch: a quick stride while working, slow breathing at rest, a hop when blocked.
      const hop = st === 'blocked' ? Math.abs(Math.sin(T * 6 + phase)) * 5 : 0;
      const sy = atWork ? 1 + Math.sin(T * 18 + phase) * 0.035 : walking ? 1 + Math.abs(Math.sin(T * 11 + phase)) * 0.03 : 1 + Math.sin(T * 2 + phase) * 0.015;
      ctx.save();
      ctx.globalAlpha = alpha * (1 - f.warp * 0.6);
      stand(ctx, robot, p.x, p.y - bob - hop, UNIT_H, { flip, sy, sx: 2 - sy, rot: sway });
      ctx.restore();
      if (f.phase === 'out') carry(s, p.x, p.y - bob, flip);
      return;
    }
    const visor = st === 'blocked' ? GOLD : st === 'working' ? '#ffffff' : st === 'done' ? GREEN : ALIVE.has(st) ? '#9ff3ff' : '#3a4656';
    body(p.x, p.y - bob, P, alpha * (1 - f.warp * 0.6), visor, glyph, heartbeat.get(s.island.id)?.blink ?? 0);
    if (st === 'working') {
      // Sparks off the keyboard: the one motion only working units have.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const t = (T * 1.6 + k / 3 + phase) % 1;
        ctx.fillStyle = rgba(kindOf(s.agent.kind).c, 1 - t);
        ctx.beginPath(); ctx.arc(p.x + 11 + t * 6, p.y - 16 - t * 14 + k * 3, 1.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  // ─── helpers: the subagents and advisors an agent ran this hour or last (usage.helpers) stand around
  // its building or plot, busy while it works and at rest otherwise. The other kinds' characters play
  // them, since your own agents may all be one kind: a subagent is the Claude or Codex character
  // (robot, farmer, scientist or worker; fixed by its name), an advisor the pi one.

  /** Where helpers stand, from the building's corner: around its front corner and right face. */
  const HELPER_SPOTS: [number, number][] = [[2.05, 2.75], [2.75, 2.05], [2.85, 1.0]];

  function helperKind(h: Helper): string {
    if (h.role === 'advisor') return 'pi';
    let n = 7;
    for (const ch of h.name) n = (n * 31 + ch.charCodeAt(0)) | 0;
    return n & 1 ? 'claude' : 'codex';
  }

  function drawHelper(s: Slot, h: Helper, i: number) {
    const [dx, dy] = HELPER_SPOTS[i];
    const p = iso(s.gx + dx, s.gy + dy);
    const seed = s.seed + i * 17;
    const busy = s.agent.status === 'working';
    const bob = busy ? Math.abs(Math.sin(T * 9 + seed)) * 1.8 : 0;
    const kind = helperKind(h);
    const a = art();
    if (a) {
      ctx.save();
      ctx.translate(p.x, p.y - bob);
      ctx.scale(0.75, 0.75);
      a.unit(paint, 0, 0, { shirt: kindOf(kind), kind, cast: kind, effort: 0, working: busy, walking: false, sway: 0, dead: false, seed, flip: true, blocked: false });
      ctx.restore();
      return;
    }
    const robot = sprite(`n_robot_${kind}`);
    if (!robot) return;
    const sy = busy ? 1 + Math.sin(T * 18 + seed) * 0.035 : 1 + Math.sin(T * 2 + seed) * 0.015;
    stand(ctx, robot, p.x, p.y - bob, UNIT_H * 0.72, { flip: true, sy, sx: 2 - sy });
  }

  /** What a unit carries to the base: the painted theme's goods, a glowing data cube in the city. */
  function carry(s: Slot, x: number, y: number, flip: boolean) {
    const hx = x + (flip ? 9 : -9), hy = y - 24;
    const a = art();
    if (a) { a.carry(paint, s, hx, hy, flip); return; }
    const c = kindOf(s.agent.kind).c;
    const r = 4.5, cy = hy - 2 + Math.sin(T * 6 + s.seed) * 1.2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow(hx, cy, 16, c, 0.55);
    ctx.restore();
    poly([{ x: hx, y: cy - r }, { x: hx + r, y: cy - r / 2 }, { x: hx, y: cy }, { x: hx - r, y: cy - r / 2 }], rgba(c, 0.95));
    poly([{ x: hx - r, y: cy - r / 2 }, { x: hx, y: cy }, { x: hx, y: cy + r }, { x: hx - r, y: cy + r / 2 }], rgba(c, 0.6));
    poly([{ x: hx, y: cy }, { x: hx + r, y: cy - r / 2 }, { x: hx + r, y: cy + r / 2 }, { x: hx, y: cy + r }], rgba(c, 0.4));
  }

  const robotName = (s: Slot) => `n_robot_${['omp', 'claude', 'codex', 'pi'].includes(s.agent.kind) ? s.agent.kind : 'omp'}`;

  // ─── working units walk between their building and their computer's core (the base)

  const WALK = 2.2; // tiles per second
  const AT_HOME = 4; // seconds working at the building between trips
  const AT_BASE = 1.5;

  /** The point `d` tiles along a route, and the direction of travel there. */
  function along(route: { x: number; y: number }[], d: number): { x: number; y: number; dx: number; dy: number } {
    let left = d;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len === 0) continue;
      if (left <= len || i === route.length - 1) {
        const t = Math.min(1, left / len);
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len };
      }
      left -= len;
    }
    return { x: route[0]?.x ?? 0, y: route[0]?.y ?? 0, dx: 0, dy: 0 };
  }

  const routeLength = (r: { x: number; y: number }[]) => r.slice(1).reduce((n, q, i) => n + Math.hypot(q.x - r[i].x, q.y - r[i].y), 0);

  /**
   * Working: wait at the building, carry to the base, wait, walk back, again. Stopped working while
   * away: walk home and stay. Never teleports, so a status change shows as a unit turning round.
   */
  function stepWalker(s: Slot, dt: number) {
    const f = unitFx(s.agent.id);
    const L = routeLength(s.route);
    if (f.dist > L) f.dist = L;
    if (s.agent.status === 'working' && L > 0) {
      if (f.phase === 'home' && (f.timer += dt) > AT_HOME) { f.phase = 'out'; f.timer = 0; }
      else if (f.phase === 'out' && (f.dist += WALK * dt) >= L) {
        f.dist = L; f.phase = 'base'; f.timer = 0;
        rings.add({ agent: s.agent.id, c: kindOf(s.agent.kind).c, t: 0.3 }); // delivered
      } else if (f.phase === 'base' && (f.timer += dt) > AT_BASE) f.phase = 'back';
      else if (f.phase === 'back' && (f.dist -= WALK * dt) <= 0) { f.dist = 0; f.phase = 'home'; f.timer = 0; }
    } else if (f.dist > 0) {
      f.phase = 'back';
      f.dist = Math.max(0, f.dist - WALK * dt);
    } else {
      f.phase = 'home';
      f.timer = 0;
    }
    if (f.dist === 0 && f.phase === 'back') f.phase = 'home';
    const at = along(s.route, f.dist);
    f.wx = L > 0 ? at.x : s.ux;
    f.wy = L > 0 ? at.y : s.uy;
    const moving = f.phase === 'out' || f.phase === 'back';
    // Sprites face down-left; heading right on screen mirrors them.
    const sdx = (at.dx - at.dy) * (f.phase === 'back' ? -1 : 1);
    if (moving && Math.abs(sdx) > 0.01) f.flip = sdx > 0;
    else if (f.phase === 'home') f.flip = false;
  }

  function unitIso(s: Slot, z = 0): P {
    const f = unitFx(s.agent.id);
    return iso(Number.isNaN(f.wx) ? s.ux : f.wx, Number.isNaN(f.wy) ? s.uy : f.wy, z);
  }

  // ─── reporting lines (world space)

  /** Where a slot's reporting line meets it: over its tower, or at the painted theme's lift over its place. */
  const linkEnd = (s: Slot): P => iso(s.gx + 1, s.gy + 1, heightOf(s) * (art()?.link.lift ?? 1) + 12);
  const bez = (a: P, c: P, b: P, t: number): P =>
    ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });
  const arcTop = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 24 - Math.hypot(b.x - a.x, b.y - a.y) * 0.22 });

  /**
   * An arc from each worker to its manager, in the manager's colour (the painted theme's rope): faint,
   * bright for the selected or hovered agent's lines, with goods flowing up while the worker works.
   */
  function drawLinks() {
    if (!world.links.length) return;
    ctx.save();
    const look = art()?.link;
    if (!look) ctx.globalCompositeOperation = 'lighter';
    // World units shrink with the camera: zoomed out, lines keep their width on screen.
    const px = 1 / Math.min(1, cam.z);
    for (const { from, to } of world.links) {
      const lit = [selected, hover].some((id) => id === from.agent.id || id === to.agent.id);
      const c = look ? look.color : kindOf(to.agent.kind).c;
      const a = linkEnd(from), b = linkEnd(to), m = arcTop(a, b);
      ctx.setLineDash(look ? look.dash.map((d) => d * px) : []);
      const dim = lightOf(from); // the line is the reporting agent's
      ctx.strokeStyle = rgba(c, (lit ? 0.9 : look ? 0.55 : 0.4) * dim);
      ctx.lineWidth = (lit ? 2.4 : 1.6) * px;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(m.x, m.y, b.x, b.y); ctx.stroke();
      if (!lit && from.agent.status !== 'working') continue;
      for (let k = 0; k < 3; k++) {
        const t = (T * 0.45 + k / 3 + from.seed) % 1;
        const q = bez(a, m, b, t);
        ctx.fillStyle = rgba(c, (lit ? 1 : 0.85) * Math.sin(t * Math.PI) * dim);
        ctx.beginPath(); ctx.arc(q.x, q.y, (lit ? 3 : 2.4) * px, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  // ─── event effects (world space)

  function drawBeams() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of beams) {
      const s = world.slots.get(b.agent);
      const src = b.from ? world.slots.get(b.from) : undefined;
      const island = b.from ? undefined : world.islands.find((i) => i.id === b.island);
      const a = src ? linkEnd(src) : island ? iso(island.core.x, island.core.y, 50) : null;
      if (!a || !s) continue;
      const z = src ? linkEnd(s) : unitIso(s, 30);
      const c = src ? arcTop(a, z) : { x: (a.x + z.x) / 2, y: Math.min(a.y, z.y) - 120 };
      const t0 = Math.min(1, b.t);
      ctx.strokeStyle = rgba(b.c, 0.25 * (1 - Math.max(0, b.t - 1)));
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, z.x, z.y); ctx.stroke();
      for (let k = 0; k < 16; k++) {
        const t = t0 - k * 0.014;
        if (t < 0) break;
        const q = bez(a, c, z, t);
        ctx.fillStyle = rgba(k ? b.c : '#ffffff', (1 - k / 16) * (1 - Math.max(0, b.t - 1)));
        ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.7, 5.5 - k * 0.33), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawRings() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const r of rings) {
      const s = world.slots.get(r.agent);
      if (!s) continue;
      const p = unitIso(s);
      ctx.strokeStyle = rgba(r.c, 1 - r.t);
      ctx.lineWidth = 3 * (1 - r.t) + 1;
      const rad = 10 + r.t * 70;
      ellipse(p.x, p.y, rad, rad / 2);
    }
    ctx.restore();
  }

  // ─── screen-space overlays

  function text(s: string, x: number, y: number, col: string, font: string, align: CanvasTextAlign = 'center') {
    ctx.font = font;
    ctx.textAlign = align;
    ctx.lineWidth = 3;
    ctx.strokeStyle = pal().map.stroke;
    ctx.strokeText(s, x, y);
    ctx.fillStyle = col;
    ctx.fillText(s, x, y);
  }

  const CHIP_FONT = `600 9px ${MONO}`;
  /** Chip text → its width in CHIP_FONT, measured once. */
  const chipWidths = new Map<string, number>();
  function chipWidth(s: string): number {
    let w = chipWidths.get(s);
    if (w === undefined) {
      // Pane ids and Buzz names come and go: start over rather than keep every one ever shown.
      if (chipWidths.size >= 512) chipWidths.clear();
      ctx.font = CHIP_FONT;
      w = ctx.measureText(s).width;
      chipWidths.set(s, w);
    }
    return w;
  }

  function chip(s: string, x: number, y: number, col: string) {
    const w = chipWidth(s) + 10;
    ctx.font = CHIP_FONT;
    ctx.fillStyle = pal().map.chipBg;
    ctx.fillRect(x - w / 2, y - 7, w, 13);
    ctx.strokeStyle = rgba(col, 0.6);
    ctx.lineWidth = 1;
    ctx.strokeRect(x - w / 2 + 0.5, y - 6.5, w - 1, 12);
    ctx.fillStyle = col;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
    ctx.textBaseline = 'alphabetic';
  }

  /** A name plate laid out for `name`: its lines, size, and the font and line height they were measured in; `whole` for the selected agent's full name. */
  interface Plate { name: string; lines: string[]; w: number; h: number; font: string; line: number; whole: boolean }
  /** Name plates by agent id, [whole][size]: the core on one line or the whole name wrapped, measured once per name. */
  const plates = [[new Map<string, Plate>(), new Map<string, Plate>()], [new Map<string, Plate>(), new Map<string, Plate>()]];
  // Measured before the web font arrived, they would keep the fallback font's widths.
  document.fonts?.addEventListener('loadingdone', () => { for (const sizes of plates) for (const m of sizes) m.clear(); chipWidths.clear(); });

  /** An agent's name plate: the selected agent's whole name, wrapped; anyone else's core on one line. */
  function plateOf(s: Slot, size: 0 | 1): Plate {
    const id = s.agent.id, whole = id === selected ? 1 : 0, name = s.agent.name;
    let plate = plates[whole][size].get(id);
    if (!plate || plate.name !== name) {
      ctx.font = NAME_FONTS[size];
      const width = (t: string) => ctx.measureText(t).width;
      const lines = whole ? wrapName(name, NAME_MAX, width) : [oneLine(coreName(name), NAME_MAX, width)];
      const w = Math.max(...lines.map(width)) + 2 * NAME_PAD_X;
      plate = { name, lines, w, h: lines.length * NAME_LINE[size] + 2 * NAME_PAD_Y, font: NAME_FONTS[size], line: NAME_LINE[size], whole: whole === 1 };
      plates[whole][size].set(id, plate);
    }
    return plate;
  }

  /** A name plate, its top at `y`, centred on `x`. */
  function namePlate(plate: Plate, x: number, y: number, col: string) {
    ctx.fillStyle = pal().map.stroke;
    ctx.beginPath(); ctx.roundRect(x - plate.w / 2, y, plate.w, plate.h, 8); ctx.fill();
    // Edged in its own colour, faint; the selected agent's (its whole name) in full.
    const alpha = ctx.globalAlpha;
    if (!plate.whole) ctx.globalAlpha = alpha * 0.35;
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.font = plate.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = col;
    for (let i = 0; i < plate.lines.length; i++) ctx.fillText(plate.lines[i], x, y + NAME_PAD_Y + plate.line * (i + 0.5) + 0.5);
    ctx.textBaseline = 'alphabetic';
  }

  function statusIcon(s: Slot, x: number, y: number) {
    const st = s.agent.status;
    const c = statusOf(st).c;
    ctx.textBaseline = 'middle';
    if (st === 'working') {
      ctx.fillStyle = 'rgba(4,10,20,.85)';
      ctx.beginPath(); ctx.roundRect(x - 13, y - 6, 26, 12, 6); ctx.fill();
      ctx.fillStyle = c;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x - 6 + i * 6, y + Math.sin(T * 10 - i * 0.9) * 2, 1.8, 0, Math.PI * 2); ctx.fill(); }
    } else if (st === 'blocked') {
      const b = Math.abs(Math.sin(T * 6)) * 5;
      ctx.save();
      ctx.translate(x, y - b - 2);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = rgba(GOLD, 0.3); ctx.fillRect(-10, -10, 20, 20); // its glow
      ctx.fillStyle = GOLD; ctx.fillRect(-7, -7, 14, 14);
      ctx.restore();
      ctx.fillStyle = '#1a1200';
      ctx.font = `900 12px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText('!', x, y - b - 1);
    } else if (st === 'done') {
      ctx.fillStyle = GREEN;
      ctx.beginPath(); ctx.arc(x, y, 6.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#05200f'; ctx.font = `900 10px ${SANS}`; ctx.textAlign = 'center';
      ctx.fillText('✓', x, y + 1);
    } else if (st === 'idle') {
      const t = (T * 0.7 + s.seed) % 1;
      ctx.save();
      ctx.globalAlpha *= 1 - t;
      text('z', x + 4 + t * 6, y - t * 10, '#8fa3bb', `700 ${9 + t * 4}px ${MONO}`);
      ctx.restore();
    } else if (st === 'missing') {
      text('MISSING', x, y, rgba(RED, 0.6 + 0.4 * Math.sin(T * 6)), `700 9px ${MONO}`);
    } else if (st === 'exited') {
      text('■ EXITED', x, y + 14, c, `700 9px ${MONO}`);
    } else if (st === 'node_offline') {
      text('⌁ OFFLINE', x, y, c, `700 9px ${MONO}`);
    } else if (st === 'disabled') {
      text('❚❚', x, y, c, `700 9px ${MONO}`);
    } else {
      text('?', x, y, c, `900 12px ${SANS}`);
    }
    ctx.textBaseline = 'alphabetic';
  }

  function unitOverlay(s: Slot) {
    ctx.globalAlpha = lightOf(s);
    try { helperLabels(s); statusOver(s); placeBadges(s); } finally { ctx.globalAlpha = 1; }
  }

  /** Name plates go over the units' status icons and badges: the names matter most. */
  function plateOverlay(s: Slot) {
    ctx.globalAlpha = lightOf(s);
    try { unitPlate(s); } finally { ctx.globalAlpha = 1; }
  }

  /** What you are looking at, a blocked agent, a fresh flash: named at any zoom, drawn on top. */
  const loudOf = (s: Slot) => {
    const id = s.agent.id;
    return id === selected || id === hover || s.agent.status === 'blocked' || unitFx(id).flash > 0;
  };
  /** Whether the agent's name shows at this zoom (nameplate.ts). */
  const namedAt = (s: Slot, z: number) => plateShown(s.agent.status, loudOf(s), presence.named.has(s.agent.id), z);
  const rankOf = (s: Slot) => plateRank(s.agent.status, loudOf(s), presence.named.has(s.agent.id), presence.lit.get(s.agent.id) ?? 0);
  const byPlateRank = (a: Slot, b: Slot) => rankOf(a) - rankOf(b);
  /** The name plates to draw this frame, least important first so the most important end on top. */
  const plateQueue: Slot[] = [];

  function queuePlates() {
    plateQueue.length = 0;
    const z = cam.z;
    for (const s of world.slots.values()) {
      if (!namedAt(s, z)) continue;
      const p = w2s(unitIso(s));
      if (p.x > -160 && p.x < W + 160 && p.y > -120 && p.y < H + 20) plateQueue.push(s);
    }
    plateQueue.sort(byPlateRank);
  }

  // ─── badges (badges.ts): an agent's tokens through the viewer's rules, over its place where its
  // reporting line meets it. Alarm and notice badges always show, quiet ones up close or when the agent
  // is looked at; an alarm pulses at full strength, but the agent keeps its own light and sleep: a
  // failing MR on an empty pane is a loud marker over a quiet place, not an agent at work.

  const MAP_BADGES = 3;
  interface BadgePiece { b: Badge; glyph: IconName | null; emoji: string; text: string; marker: boolean; w: number }
  interface BadgeLayout { list: readonly Badge[]; near: boolean; far: boolean; pieces: BadgePiece[]; more: string; moreW: number; height: number }
  const badgeLayouts = new Map<string, BadgeLayout>();
  interface BadgeHit { agentId: string; action: BadgeAction; x: number; y: number; w: number; h: number; round: boolean }
  const badgeHits: BadgeHit[] = [];
  let badgeHitCount = 0;
  /** Name plates drawn this frame, top-most last: agent ids and boxes (x0, y0, x1, y1 each), reused. */
  const plateHitIds: string[] = [];
  const plateHitBoxes: number[] = [];
  let plateHitCount = 0;

  function plateAt(x: number, y: number, slop = 0): string | null {
    for (let i = plateHitCount - 1; i >= 0; i--) {
      const k = i * 4;
      if (x >= plateHitBoxes[k] - slop && x <= plateHitBoxes[k + 2] + slop && y >= plateHitBoxes[k + 1] - slop && y <= plateHitBoxes[k + 3] + slop) return plateHitIds[i];
    }
    return null;
  }

  function badgeHit(x: number, y: number, slop = 0): BadgeHit | null {
    for (let i = badgeHitCount - 1; i >= 0; i--) {
      const hit = badgeHits[i];
      if (hit.round) {
        if (Math.hypot(x - hit.x - hit.w / 2, y - hit.y - hit.h / 2) <= hit.w / 2 + slop) return hit;
      } else if (x >= hit.x - slop && x <= hit.x + hit.w + slop && y >= hit.y - slop && y <= hit.y + hit.h + slop) return hit;
    }
    return null;
  }

  /** Dark ink on a light colour, white on a dark one (a marker's icon on its disc). */
  function inkOn(hex: string): string {
    const n = Number.parseInt(hex.slice(1), 16);
    return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160 ? '#10161f' : '#ffffff';
  }

  function placeBadges(s: Slot) {
    const id = s.agent.id;
    const list = presence.badges.get(id);
    if (!list?.length) return;
    const z = cam.z;
    const near = z >= 0.75 || id === selected || id === hover;
    const top = w2s(linkEnd(s));
    if (top.x < -160 || top.x > W + 160 || top.y < -60 || top.y > H + 120) return;
    const pad = 6, gap = 4, hgt = 16, ICON = 12, MARK = 22;
    const far = !(z >= 0.6 || near);
    let layout = badgeLayouts.get(id);
    // Text measurement and badge objects change with data or reveal mode, not with each frame.
    if (!layout || layout.list !== list || layout.near !== near || layout.far !== far) {
      ctx.font = `700 10px ${MONO}`;
      const shown = list.filter((b) => b.ruled && (b.urgency !== 'quiet' || near));
      const pieces = badgesInStack(shown, MAP_BADGES).map((b) => {
        const look = badgeLook(b, far);
        const glyph = look.icon ? iconName(look.icon) : null;
        const emoji = look.icon && !glyph ? look.icon : '';
        const { text, marker } = look;
        const lead = (glyph ? ICON : 0) + (emoji ? ctx.measureText(emoji).width : 0);
        const w = marker ? MARK : pad * 2 + lead + (text ? ctx.measureText(text).width + (lead ? 4 : 0) : 0);
        return { b, glyph, emoji, text, marker, w };
      });
      const extra = shown.length - pieces.length;
      const more = extra > 0 ? `+${extra}` : '';
      const moreW = more ? ctx.measureText(more).width + pad * 2 : 0;
      const height = pieces.reduce((sum, p) => sum + (p.marker ? MARK : hgt) + gap, 0) + (more ? hgt : -gap);
      layout = { list, near, far, pieces, more, moreW, height };
      badgeLayouts.set(id, layout);
    }
    const { pieces, more, moreW } = layout;
    if (!pieces.length) return;
    ctx.font = `700 10px ${MONO}`;
    let y = top.y - 10 - layout.height;
    // A badge is feedback the viewer asked for: it keeps full strength on a quiet, dimmed agent.
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let k = 0; k < pieces.length; k++) {
      const p = pieces[k];
      const col = p.b.color ?? pal().map.text;
      const alarm = p.b.urgency === 'alarm';
      const lift = alarm ? Math.abs(Math.sin(T * 6 + k)) * 2 : 0;
      const x = top.x - p.w / 2;
      if (p.b.action) {
        let hit = badgeHits[badgeHitCount];
        if (!hit) badgeHits[badgeHitCount] = hit = { agentId: id, action: p.b.action, x: 0, y: 0, w: 0, h: 0, round: false };
        hit.agentId = id; hit.action = p.b.action; hit.x = x; hit.y = y - lift; hit.w = p.w; hit.h = p.marker ? MARK : hgt; hit.round = p.marker;
        badgeHitCount++;
      }
      if (p.marker) {
        // A marker over the place, like a quest marker: a disc in the rule's colour with its icon, and
        // for an alarm a ring that keeps spreading.
        const r = MARK / 2, cx = top.x, cy = y + r - lift;
        if (alarm) {
          const t = (T * 1.4) % 1;
          ctx.strokeStyle = rgba(col, 0.7 * (1 - t)); ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx, cy, r + 2 + t * 8, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = pal().map.chipBg; ctx.lineWidth = 2; ctx.stroke();
        if (p.glyph) drawIcon(ctx, p.glyph, cx, cy, 13, inkOn(col));
        else { ctx.textAlign = 'center'; ctx.fillText(p.emoji, cx, cy + 0.5); ctx.textAlign = 'left'; }
      } else {
        ctx.fillStyle = pal().map.chipBg;
        ctx.beginPath(); ctx.roundRect(x, y - lift, p.w, hgt, 8); ctx.fill();
        ctx.lineWidth = alarm ? 2 : 1;
        ctx.strokeStyle = rgba(col, alarm ? 0.55 + 0.45 * Math.abs(Math.sin(T * 6)) : 0.7);
        ctx.stroke();
        let cx = x + pad;
        if (p.glyph) { drawIcon(ctx, p.glyph, cx + ICON / 2, y - lift + hgt / 2, ICON, col); cx += ICON + 4; }
        ctx.fillStyle = col;
        if (p.emoji) { ctx.fillText(p.emoji, cx, y - lift + hgt / 2 + 0.5); cx += ctx.measureText(p.emoji).width + 4; }
        if (p.text) ctx.fillText(p.text, cx, y - lift + hgt / 2 + 0.5);
      }
      y += (p.marker ? MARK : hgt) + gap;
    }
    if (more) {
      const x = top.x - moreW / 2;
      ctx.fillStyle = pal().map.chipBg;
      ctx.beginPath(); ctx.roundRect(x, y, moreW, hgt, 8); ctx.fill();
      ctx.fillStyle = pal().map.textDim;
      ctx.fillText(more, x + pad, y + hgt / 2 + 0.5);
    }
    ctx.restore();
  }

  /** Each helper's name under it, once zoomed in close or while its agent is selected or hovered. */
  function helperLabels(s: Slot) {
    if (cam.z < 0.9 && s.agent.id !== selected && s.agent.id !== hover) return;
    const crew = usage.helpers.get(s.agent.id);
    if (!crew) return;
    for (let i = 0; i < crew.length && i < HELPER_SPOTS.length; i++) {
      const p = w2s(iso(s.gx + HELPER_SPOTS[i][0], s.gy + HELPER_SPOTS[i][1]));
      text(crew[i].name, p.x, p.y + 12, pal().map.textDim, `500 9px ${MONO}`);
    }
  }

  /** The status icon over the character; none while asleep (no character to wear it). */
  function statusOver(s: Slot) {
    if (asleep(s)) return;
    const p = w2s(unitIso(s));
    if (p.x < -100 || p.x > W + 100 || p.y < -100 || p.y > H + 100) return;
    statusIcon(s, p.x, p.y - (art()?.unitH ?? UNIT_H) * cam.z - 6);
  }

  /** The name plate under the unit (on the empty spot when asleep), and its pane and Buzz chips up close. */
  function unitPlate(s: Slot) {
    const z = cam.z;
    const p = w2s(unitIso(s));
    const id = s.agent.id;
    const st = s.agent.status;
    const nameC = id === selected ? pal().map.selected : ALIVE.has(st) ? pal().map.text : pal().map.textDim;
    const plate = plateOf(s, z >= 0.9 ? 1 : 0), top = p.y + NAME_TOP, below = top + plate.h;
    namePlate(plate, p.x, top, nameC);
    const k = plateHitCount * 4;
    plateHitIds[plateHitCount++] = id;
    plateHitBoxes[k] = p.x - plate.w / 2; plateHitBoxes[k + 1] = top; plateHitBoxes[k + 2] = p.x + plate.w / 2; plateHitBoxes[k + 3] = below;
    if ((z >= 0.75 || loudOf(s)) && !asleep(s)) {
      const m = pal().map;
      const pane = settings.mapDetails ? store.panes.get(id)?.pane_id : undefined;
      const ch = s.agent.channels.find((c) => c.type === 'buzz');
      const label = ch ? buzzLabel(s.agent) : null;
      const buzz = label ? `📣 ${label}` : '';
      const paneW = pane ? chipWidth(pane) + 14 : 0, buzzW = buzz ? chipWidth(buzz) + 14 : 0;
      let x = p.x - (paneW + buzzW) / 2;
      if (pane) { chip(pane, x + paneW / 2 - 2, below + 9, m.pane); x += paneW; }
      if (buzz && ch) chip(buzz, x + buzzW / 2 - 2, below + 9, ch.state === 'attached' || ch.state === 'ok' ? m.buzz : channelColor(ch.state));
    }
  }

  function islandOverlay(i: Island) {
    const z = cam.z;
    const last = i.slabs[i.slabs.length - 1];
    const front = w2s(iso(last.x1, last.y1, -SLAB));
    const state = i.node?.state ?? 'unknown';
    const nc = nodeStateOf(state);
    ctx.save();
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    text(i.name.toUpperCase(), front.x, front.y + 24, pal().map.text, `700 ${z > 0.7 ? 15 : 13}px ${display()}`);
    ctx.restore();
    const herdr = i.node?.versions?.herdr;
    const whole = tallies.get(i);
    const count = whole?.agents ?? 0, away = whole?.packed ?? 0;
    // On a painted theme's ground the dark state inks would vanish under the label stroke: light text there.
    text(`${nc.label.toUpperCase()}${herdr ? ` · herdr ${herdr}` : ''} · ${count} agent${count === 1 ? '' : 's'}${away ? ` · ${away} packed away` : ''}`, front.x, front.y + 40, theme.painted ? pal().map.textDim : nc.c, `600 10px ${MONO}`);
    for (const d of i.districts) {
      const a = w2s(iso(d.x0 + 0.4, d.y0 + 0.5, 6));
      const tally = tallies.get(d), working = tally?.working ?? 0;
      ctx.save();
      if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
      // Painted themes' signs carry the space colour; the label over them stays light to read on the ground.
      const label = theme.painted ? pal().map.text : d.color;
      text(d.name.toUpperCase(), a.x, a.y, label, `700 ${z > 0.7 ? 12 : 11}px ${display()}`, 'left');
      ctx.restore();
      if (z <= 0.45) continue;
      const quiet = tally?.packed ?? 0;
      text(`${d.slots.length} agent${d.slots.length === 1 ? '' : 's'}${working ? ` · ${working} working` : ''}${quiet ? ` · ${quiet} packed away` : ''}`, a.x, a.y + 13, theme.painted ? pal().map.textDim : rgba(d.color, 0.75), `500 9px ${MONO}`, 'left');
      // Each team: its manager's name over its strip, then how many and how busy.
      for (const t of d.teams) {
        const p = w2s(iso(t.x0 + 0.35, t.y0 + 0.45, theme.painted ? 18 : 4));
        const busy = tallies.get(t)?.working ?? 0;
        text(t.manager.agent.name.toUpperCase(), p.x, p.y, theme.painted ? pal().map.text : kindOf(t.manager.agent.kind).c, `700 ${z > 0.7 ? 10 : 9}px ${display()}`, 'left');
        if (z > 0.6) text(`team · ${t.slots.length}${busy ? ` · ${busy} working` : ''}`, p.x, p.y + 11, theme.painted ? pal().map.textDim : rgba(d.color, 0.7), `500 8.5px ${MONO}`, 'left');
      }
    }
  }

  /** Live usage: embers fly from the unit into its own roof, which then rings (see drawBuilding). */
  function drawEmbers() {
    const gold = pal().map.money;
    ctx.save();
    const painted = art();
    if (!painted) ctx.globalCompositeOperation = 'lighter';
    for (const e of embers) {
      const s = world.slots.get(e.agent);
      if (!s) continue;
      const a = unitIso(s, 40), b = iso(s.gx + 1, s.gy + 1, heightOf(s) + 7);
      const c = { x: Math.min(a.x, b.x) - 40, y: (a.y + b.y) / 2 };
      const at = (t: number): P => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });
      if (painted) {
        // Coins: a short trail of fading ones behind the leader.
        for (let k = 3; k >= 0; k--) {
          const t = e.t - k * 0.06;
          if (t < 0) continue;
          const q = at(t);
          painted.coin(paint, q.x, q.y, e.r + 1 - k * 0.6, 1 - k * 0.25);
        }
        continue;
      }
      for (let k = 0; k < 10; k++) {
        const t = e.t - k * 0.025;
        if (t < 0) break;
        const q = at(t);
        ctx.fillStyle = rgba(gold, 1 - k / 10);
        ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.6, e.r - k * 0.35), 0, Math.PI * 2); ctx.fill();
      }
      const q = at(e.t);
      glow(q.x, q.y, e.r * 4, gold, 0.6);
    }
    ctx.restore();
  }

  function floatOverlay() {
    for (const f of floats) {
      const s = world.slots.get(f.agent);
      if (!s) continue;
      const p = w2s(unitIso(s));
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - f.t) * 2);
      // Pop in big, settle, then drift up and fade.
      const pop = 1 + 0.6 * Math.max(0, 1 - f.t * 7);
      text(f.text, p.x, p.y - 62 * cam.z - 12 - f.t * 36, f.c, `700 ${Math.round(11 * pop)}px ${MONO}`);
      ctx.restore();
    }
  }

  // ─── dim by recency (recency.ts): quiet agents dim relative to the most recently active ones. Their
  // sprites come from darkened copies (sprites.ts setShade), a tower's walls get the same darkness as
  // one shape and a crop plot's soil as another, so nothing turns see-through and nothing costs an
  // extra canvas. Blocked, selected and hovered agents stay lit.

  let litAt = -Infinity;
  /** Asleep (presence.ts sleeps), when the viewer hides sleepers; selecting or hovering it does not wake it. */
  function asleep(s: Slot): boolean {
    return settings.hideSleepers && sleeps(s.agent, store.lastActive, Date.now());
  }

  /** Per-agent state goes when its agent leaves the map. */
  const prune = (m: Map<string, unknown>) => { for (const id of m.keys()) if (!world.slots.has(id)) m.delete(id); };

  function updateLit() {
    presence.relight();
    prune(badgeLayouts);
    prune(fx);
    prune(heights);
    for (const sizes of plates) for (const m of sizes) prune(m);
  }

  function lightOf(s: Slot): number {
    const id = s.agent.id;
    if (!settings.dimQuiet || s.agent.status === 'blocked' || id === selected || id === hover) return 1;
    return presence.lit.get(id) ?? 1;
  }

  /**
   * A painted theme's ground (grass, lab floor, carpet) is brighter than any place on it, so darkening
   * quiet places alone leaves nothing standing out. With dimming on, the whole ground (with its cores
   * and scenery) sits in this much shade, and agents range from full light (the most recent, brighter
   * than the ground) to darker than it (the quietest).
   */
  const GROUND_SHADE = 0.32;
  const groundShade = () => (theme.painted && settings.dimQuiet ? GROUND_SHADE : 0);

  /** How far toward SHADE an agent goes: the city's full night, or in a painted theme up to well past the ground's shade. */
  const shadeOf = (s: Slot) => (1 - lightOf(s)) * (theme.painted ? 0.9 : 1);

  // ─── frame

  /** One thing to draw in depth order; the records are refilled in place each frame. */
  interface DrawItem { d: number; kind: 'decor' | 'place' | 'unit' | 'helper'; slot: Slot | null; decor: Decor | null; helper: Helper | null; spot: number }
  const drawList: DrawItem[] = [];
  let drawCount = 0;
  const byDepth = (a: DrawItem, b: DrawItem) => a.d - b.d;
  function queueDraw(d: number, kind: DrawItem['kind'], slot: Slot | null, decor: Decor | null = null, helper: Helper | null = null, spot = 0) {
    const it = drawList[drawCount];
    if (it) { it.d = d; it.kind = kind; it.slot = slot; it.decor = decor; it.helper = helper; it.spot = spot; }
    else drawList[drawCount] = { d, kind, slot, decor, helper, spot };
    drawCount++;
  }

  /** An ember reached its roof, which rings (roofRing). */
  function emberLanded(e: Ember) {
    const f = unitFx(e.agent);
    f.roof = 1;
    f.roofC = pal().map.money;
  }

  let last = performance.now();
  // Browsers stop frames for a hidden tab while events keep arriving: an effect queued then would replay when the tab is next shown.
  const animating = () => performance.now() - last < 1000;
  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    T += dt;
    const k = Math.min(1, dt * 6);
    cam.x += (cam.tx - cam.x) * k;
    cam.y += (cam.ty - cam.y) * k;
    cam.z += (cam.tz - cam.z) * k;
    if (now - litAt > 1000) {
      litAt = now;
      updateLit();
    }
    for (const f of fx.values()) {
      f.warp = Math.max(0, f.warp - dt / 1.3);
      f.flash = Math.max(0, f.flash - dt / 1.6);
      f.wave = Math.max(0, f.wave - dt / 2.5);
      f.roof = Math.max(0, f.roof - dt / 1.4);
    }
    // Places ease toward their Stack.
    const ease = Math.min(1, dt * 2.5), clock = Date.now();
    for (const s of world.slots.values()) {
      const cur = heights.get(s.agent.id) ?? STACK_MIN;
      heights.set(s.agent.id, cur + (targetHeight(s, clock) - cur) * ease);
      stepWalker(s, dt);
    }
    for (const h of heartbeat.values()) h.blink = Math.max(0, h.blink - dt * 2.5);
    floats.step(dt / 2.4);
    beams.step(dt / 0.9, 1.5);
    rings.step(dt / 1.2);
    boots.step(dt / 1.2);
    embers.step(dt / 0.9, 1, emberLanded);
    // Under a phone tab there is nothing to draw; the light and the effects above still move on.
    if (covered && PHONE.matches) { requestAnimationFrame(frame); return; }

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const painted = art();
    if (painted) painted.background(paint, W, H, cam.x, cam.y);
    else {
      ctx.fillStyle = vgrad(0, H, '#071020', '#03060c');
      ctx.fillRect(0, 0, W, H);
      for (const s of stars) {
        ctx.fillStyle = `rgba(159,195,255,${0.25 + 0.25 * Math.sin(T * 0.8 + s.p)})`;
        ctx.fillRect(((s.x * W - cam.x * 0.03) % W + W) % W, ((s.y * H - cam.y * 0.03) % H + H) % H, s.r, s.r);
      }
    }

    ctx.setTransform(DPR * cam.z, 0, 0, DPR * cam.z, DPR * (W / 2 - cam.x * cam.z), DPR * (H / 2 - cam.y * cam.z));
    for (const i of world.islands) drawIsland(i);
    const ground = groundShade();
    if (ground) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(${SHADE[theme.id === 'neon' ? 'city' : theme.id].join(',')},${ground})`;
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.restore();
    }
    if (!painted) drawTraffic();
    drawCount = 0;
    for (const i of world.islands) for (const d of i.decor) queueDraw(d.x + d.y, 'decor', null, d);
    for (const s of world.slots.values()) {
      queueDraw(s.gx + s.gy + 1.5, 'place', s);
      if (asleep(s)) continue;
      const w = unitFx(s.agent.id);
      queueDraw(w.wx + w.wy, 'unit', s);
      const crew = usage.helpers.get(s.agent.id);
      if (crew) for (let i = 0; i < crew.length && i < HELPER_SPOTS.length; i++) queueDraw(s.gx + s.gy + HELPER_SPOTS[i][0] + HELPER_SPOTS[i][1], 'helper', s, null, crew[i], i);
    }
    drawList.length = drawCount;
    drawList.sort(byDepth);
    for (const it of drawList) {
      const { slot } = it;
      setShade(slot ? shadeOf(slot) : ground);
      try {
        switch (it.kind) {
          case 'decor': if (it.decor) drawDecor(it.decor); break;
          case 'place': if (slot) drawBuilding(slot); break;
          case 'unit': if (slot) drawUnit(slot); break;
          case 'helper': if (slot && it.helper) drawHelper(slot, it.helper, it.spot); break;
        }
      } finally { setShade(0); }
    }
    drawLinks();
    drawRings();
    drawBeams();
    drawEmbers();
    if (painted && world.islands.length) painted.sky(paint, bounds, cores, places);
    else drawDrones();

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    badgeHitCount = 0;
    plateHitCount = 0;
    for (const i of world.islands) islandOverlay(i);
    queuePlates();
    for (const s of world.slots.values()) unitOverlay(s);
    for (const s of plateQueue) plateOverlay(s);
    floatOverlay();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ─── events → effects

  let bannerTimer = 0;
  function showBanner(title: string, sub: string, c: string) {
    banner.innerHTML = '';
    const t = document.createElement('b');
    t.textContent = title;
    const s = document.createElement('span');
    s.textContent = sub;
    banner.append(t, s);
    banner.style.setProperty('--c', c);
    banner.classList.remove('show');
    void banner.offsetWidth; // restart the animation
    banner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => banner.classList.remove('show'), 3200);
  }

  function event(e: RostrEvent) {
    if (!animating()) return;
    const id = e.agent_id;
    const name = id ? store.agents.get(id)?.name ?? 'agent' : '';
    const islandId = e.node_id ?? (id ? store.agents.get(id)?.node_id : null) ?? '';
    const d = e.data;
    const float = (text: string, c: string) => { if (id) floats.add({ agent: id, text, c, t: 0 }); };
    const ring = (c: string) => { if (id) rings.add({ agent: id, c, t: 0 }); };
    const flash = (c: string) => { if (id) { const f = unitFx(id); f.flash = 1; f.flashC = c; } };
    const warp = (c: string) => { if (id) { const f = unitFx(id); f.warp = 1; f.warpC = c; } };
    const beam = (c: string) => { if (id && islandId) beams.add({ island: islandId, agent: id, c, t: 0 }); };
    switch (e.type) {
      case 'launched':
      case 'resumed': {
        const verb = e.type === 'launched' ? 'LAUNCHED' : 'RESUMED';
        warp(GREEN); beam(GREEN); float(`▲ ${verb}`, GREEN);
        showBanner(verb, `${name}${str(d.pane_id) ? ` · ${str(d.pane_id)}` : ''}`, GREEN);
        break;
      }
      case 'agent_created':
      case 'adopted': {
        const worker = str(d.reason) === 'worktree';
        const title = worker ? 'NEW WORKER' : e.type === 'adopted' ? 'ADOPTED' : 'NEW AGENT';
        warp(CYAN); float(`✚ ${title}`, CYAN);
        showBanner(title, name || str(obj(d.agent).name) || '', CYAN);
        break;
      }
      case 'reports_to_changed': {
        // The new line forms: a beam from the agent up to its manager.
        const next = str(d.new);
        const boss = next ? store.agentByPrincipal(next) : undefined;
        const c = art()?.link.color ?? (boss ? kindOf(boss.kind).c : CYAN);
        if (id && boss && world.slots.has(boss.id)) beams.add({ island: islandId, agent: boss.id, from: id, c, t: 0 });
        flash(c); float(boss ? `⇢ reports to ${boss.name}` : next ? '⇢ new reporting line' : '⇢ reports to no one', c);
        break;
      }
      case 'exited':
        ring('#ff8a4c'); flash('#ff8a4c'); float('■ EXITED', '#ff8a4c');
        showBanner('EXITED', name, '#ff8a4c');
        break;
      case 'launch_failed':
      case 'launch_refused':
        ring(RED); flash(RED); float(e.type === 'launch_failed' ? '✖ LAUNCH FAILED' : '⛔ REFUSED', RED);
        showBanner(e.type === 'launch_failed' ? 'LAUNCH FAILED' : 'LAUNCH REFUSED', name, RED);
        break;
      case 'status_changed': {
        const to = statusOf(str(d.new) ?? '?');
        ring(to.c); flash(to.c); float(`${to.icon} ${to.label}`, to.c);
        break;
      }
      case 'renamed':
      case 'relabeled':
        flash('#7aa8ff'); float(`✎ ${str(d.herdr_name) ?? str(d.workspace_label) ?? 'renamed'}`, '#7aa8ff');
        break;
      case 'address_changed':
        beam('#7aa8ff'); float('⇢ new address', '#7aa8ff');
        break;
      case 'session_recorded':
        // A new session: the roof rings; the Stack follows the run, not the session.
        flash('#b48cff'); float('◈ new session', '#b48cff');
        if (id) { const f = unitFx(id); f.roof = 1; f.roofC = '#b48cff'; }
        break;
      case 'agent_changed':
        flash('#7aa8ff'); float('⚙ changed', '#7aa8ff');
        break;
      case 'conflict':
        ring(RED); float('⚔ CONFLICT', RED);
        showBanner('CONFLICT', name, RED);
        break;
      case 'node_connected':
      case 'node_disconnected':
      case 'node_stale':
      case 'node_offline': {
        const look = {
          node_connected: [GREEN, 'COMPUTER ONLINE'], node_disconnected: ['#ff8a4c', 'COMPUTER DISCONNECTED'],
          node_stale: ['#ffb547', 'COMPUTER STALE'], node_offline: [RED, 'COMPUTER OFFLINE'],
        }[e.type] ?? [CYAN, ''];
        const [c, title] = look;
        if (e.node_id) boots.add({ island: e.node_id, c, t: 0 });
        showBanner(title, store.nodes.get(e.node_id ?? '')?.name ?? '', c);
        break;
      }
      case 'untracked_seen':
        if (e.node_id) boots.add({ island: e.node_id, c: GOLD, t: 0.4 });
        break;
      default:
        if (e.type.startsWith('channel_') && id) {
          const to = str(d.to) ?? e.type.slice(8);
          const good = to === 'attached' || to === 'ok' || e.type === 'channel_added';
          const c = good ? BUZZ : to === 'pending' ? '#ffb547' : RED;
          if (good) unitFx(id).wave = 1;
          ring(c); float(`⌁ ${str(d.type) ?? 'channel'} ${e.type === 'channel_added' ? 'added' : to}`, c);
        }
    }
  }

  // A tall viewport (phone) gets the column layout; see world.ts.
  const columnMode = () => H > W * 1.15;
  let column = false;
  // Packed away (presence.ts, settings.packQuiet): off the map; the lists, search and labels still count
  // them. Decided at each rebuild, so nothing vanishes mid-look.

  /** How many agents are packed away on a computer, or in one of its spaces. */
  function packedOn(nodeId: string, spaceId?: string): number {
    let n = 0;
    for (const id of presence.packed) {
      const a = store.agents.get(id);
      if (a && a.node_id === nodeId && (!spaceId || a.space_id === spaceId)) n++;
    }
    return n;
  }

  const workingIn = (slots: Slot[]) => { let n = 0; for (const s of slots) if (s.agent.status === 'working') n++; return n; };

  /** Works out what only a rebuild changes (bounds, cores, places, tallies). */
  function measureWorld() {
    bounds = worldBounds();
    cores = world.islands.map((i) => iso(i.core.x, i.core.y));
    places = [...world.slots.values()].map((s) => ({ x: s.gx + 1, y: s.gy + 1 }));
    tallies.clear();
    for (const i of world.islands) {
      let agents = 0, working = 0;
      for (const d of i.districts) {
        const tally = { agents: d.slots.length, working: workingIn(d.slots), packed: packedOn(i.id, d.id) };
        tallies.set(d, tally);
        agents += tally.agents;
        working += tally.working;
        for (const t of d.teams) tallies.set(t, { agents: t.slots.length, working: workingIn(t.slots), packed: 0 });
      }
      tallies.set(i, { agents, working, packed: packedOn(i.id) });
    }
  }

  function refresh() {
    column = columnMode();
    presence.repack(selected);
    const next = buildWorld(column, presence.packed);
    const reshaped = next.shape !== world.shape;
    world = next;
    measureWorld();
    updateLit();
    for (const i of world.islands) {
      const seen = i.node?.last_seen_at ?? null;
      const h = heartbeat.get(i.id);
      if (!h) heartbeat.set(i.id, { seen, blink: 0 });
      else if (h.seen !== seen) { h.seen = seen; h.blink = 1; }
    }
    if (reshaped && flight) aim();
    // First frame: start pulled back and above, and let the camera ease in.
    if (reshaped && !userMoved) { const first = !cam.x && !cam.y; fit(); if (first) { cam.x = cam.tx; cam.y = cam.ty - 260; cam.z = cam.tz * 0.45; } }
  }

  function usageFrame(agentId: string, cost: number, toks: number) {
    if (!animating() || !world.slots.has(agentId) || (cost <= 0 && toks <= 0)) return;
    // Ember size follows the frame's cost on a log scale: a cent is small, a dollar is big.
    embers.add({ agent: agentId, r: 2.4 + Math.min(4, Math.log10(1 + cost * 100) * 1.6), t: 0 });
  }

  return {
    refresh,
    select(id) {
      // A burst at the feet of whatever was just picked.
      if (id && id !== selected && animating()) rings.add({ agent: id, c: pal().map.selected, t: 0 });
      if (id !== flight) flight = null;
      selected = id;
    },
    focus,
    focusSpace,
    fit,
    setInset(bottom) {
      if (bottom === inset) return;
      inset = bottom;
      if (!userMoved) fit();
      else if (flight) aim();
    },
    setCovered(on) { covered = on; },
    event,
    usage: usageFrame,
  };
}
