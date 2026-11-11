import { kindOf, rgba } from './format';
import type { Painter, Paint, Pt, UnitLook } from './painters';
import { SHADE, aspect, sprite, stand } from './sprites';
import type { Decor, District, Island, Rect, Slot, TeamBlock } from './world';
import { boxOutline, columnOutline, type Iso } from './shapes';
import { CHARACTERS, characterIdFor } from './inference';

// The lab theme's painter: a clean research building. Each computer is a lab floor with a bioreactor
// at its heart, each space a glass-walled wing, each team a taped-off bay, each agent an instrument
// column (the Stack: as tall as its current run has been working; lab modules stacked on a floor
// mat, a still on top) run by a scientist. map.ts owns the camera, layout, labels and effects and
// calls these for the parts that look different.

const SLAB = 40;
const SCIENTIST_ART = Object.fromEntries(CHARACTERS.map(({ id }) => [id, {
  work: `l_sci_${id}`, rest: `l_sci_${id}_rest`, alarm: `l_sci_${id}_alarm`,
}]));
const hash = (a: number, b: number, c: number) => { const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return x - Math.floor(x); };
const TAU = Math.PI * 2;

/** After hours (viewer's clock): 0 by day, up to 1 late at night, when the lab drops to its night lights. */
function afterHours(now = new Date()): number {
  const h = now.getHours() + now.getMinutes() / 60;
  const ramp = (a: number, b: number, x: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  return h < 12 ? 1 - ramp(5.5, 7.5, h) : ramp(19, 22, h);
}

// ─── ground

/** The building's lower level, under the floors: a pale blueprint grid drifting with the camera. */
function background(p: Paint, W: number, H: number, camX: number, camY: number) {
  const { ctx } = p;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#eef3f8');
  g.addColorStop(1, '#cfdbe7');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // A 2:1 grid like the floors', one path; it repeats every 96 px across and 48 down.
  const s = 48, ox = (((-camX * 0.08) % (s * 2)) - s * 2) % (s * 2), oy = (((-camY * 0.08) % s) - s) % s;
  ctx.strokeStyle = '#d2deea';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const span = W + s * 4;
  for (let y = oy - span / 2; y < H + span / 2; y += s) {
    ctx.moveTo(ox, y); ctx.lineTo(ox + span, y + span / 2);
    ctx.moveTo(ox, y); ctx.lineTo(ox + span, y - span / 2);
  }
  ctx.stroke();
}

const WALL: Record<string, [string, string, string, string]> = {
  // left face top/bottom, right face top/bottom
  online: ['#f7fafc', '#d6e0ea', '#dbe4ee', '#b4c3d3'],
  stale: ['#f6f1e2', '#ddd2b8', '#e2d8bf', '#c2b493'],
  offline: ['#dcdfe3', '#b9bfc6', '#c3c8ce', '#9ea5ad'],
};

/** A lab floor: speckled vinyl in 1×1 tiles on top, white cladding with an instrument-blue band on the sides. */
function slab(p: Paint, r: Rect, state: string) {
  const { ctx, iso, poly } = p;
  const A = iso(r.x0, r.y0), B = iso(r.x1, r.y0), C = iso(r.x1, r.y1), D = iso(r.x0, r.y1);
  const dn = (q: Pt, d = SLAB) => ({ x: q.x, y: q.y + d });
  const grad = (y0: number, y1: number, a: string, b: string) => { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
  const w = WALL[state] ?? WALL.offline;
  // A tight shadow: the slab's own footprint, a few px below its base, showing only as a lip under the front edges.
  poly([dn(A, SLAB + 4), dn(B, SLAB + 7), dn(C, SLAB + 9), dn(D, SLAB + 7)], 'rgba(40,70,110,.16)');
  poly([D, C, dn(C), dn(D)], grad(D.y, C.y + SLAB, w[0], w[1]));
  poly([C, B, dn(B), dn(C)], grad(B.y, C.y + SLAB, w[2], w[3]));
  // The blue band and the dark plinth along both visible sides.
  const band = state === 'online' ? '#1a7fd0' : state === 'stale' ? '#c98a1a' : '#7d8794';
  poly([dn(D, 12), dn(C, 12), dn(C, 18), dn(D, 18)], band);
  poly([dn(C, 12), dn(B, 12), dn(B, 18), dn(C, 18)], rgba(band, 0.8));
  poly([dn(D, SLAB - 5), dn(C, SLAB - 5), dn(C), dn(D)], '#5b6b7e');
  poly([dn(C, SLAB - 5), dn(B, SLAB - 5), dn(B), dn(C)], '#475668');
  poly([A, B, C, D], p.ground('l_floor', r.x0, r.y0, 2) ?? '#eef2f6');
  if (state !== 'online') poly([A, B, C, D], state === 'stale' ? 'rgba(230,200,120,.22)' : 'rgba(120,128,140,.35)');
  // Tile joints every tile.
  ctx.strokeStyle = '#d3dce6';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let x = Math.ceil(r.x0); x < r.x1; x++) { const a = iso(x, r.y0), b = iso(x, r.y1); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
  for (let y = Math.ceil(r.y0); y < r.y1; y++) { const a = iso(r.x0, y), b = iso(r.x1, y); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(C.x, C.y); ctx.lineTo(D.x, D.y); ctx.closePath(); ctx.stroke();
}

/** Column layout: a steel catwalk with railings between a computer's stacked floors. */
function bridge(p: Paint, a: Pt, b: Pt) {
  const { ctx, iso, poly } = p;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * 0.4, py = (dx / len) * 0.4;
  const deck = [iso(a.x + px, a.y + py), iso(b.x + px, b.y + py), iso(b.x - px, b.y - py), iso(a.x - px, a.y - py)];
  poly(deck, '#c6d1dc');
  ctx.strokeStyle = '#8c9db0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const steps = Math.max(2, Math.round(len / 0.25));
  for (let k = 1; k < steps; k++) {
    const t = k / steps, l = iso(a.x + dx * t + px, a.y + dy * t + py), r = iso(a.x + dx * t - px, a.y + dy * t - py);
    ctx.moveTo(l.x, l.y); ctx.lineTo(r.x, r.y);
  }
  ctx.stroke();
  ctx.strokeStyle = '#6f8297';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (const [s, e] of [[deck[0], deck[1]], [deck[3], deck[2]]]) {
    ctx.moveTo(s.x, s.y - 9); ctx.lineTo(e.x, e.y - 9);
    const n = Math.max(2, Math.round(len / 0.6));
    for (let k = 0; k <= n; k++) { const x = s.x + ((e.x - s.x) * k) / n, y = s.y + ((e.y - s.y) * k) / n; ctx.moveTo(x, y); ctx.lineTo(x, y - 9); }
  }
  ctx.stroke();
}

/** A space: a wing of the lab, its floor tinted, glass partitions on its back walls, tape on the floor and a door sign. */
function field(p: Paint, d: District) {
  const { ctx, iso, poly } = p;
  poly([iso(d.x0, d.y0), iso(d.x1, d.y0), iso(d.x1, d.y1), iso(d.x0, d.y1)], rgba(d.color, 0.07));
  // Floor tape along the open front edges. Strokes stay opaque: a see-through stroke costs a mask the size of its whole path.
  ctx.strokeStyle = d.color;
  ctx.lineWidth = 2.5;
  const f0 = iso(d.x1, d.y0 + 0.05), f1 = iso(d.x1, d.y1), f2 = iso(d.x0 + 0.05, d.y1);
  ctx.beginPath(); ctx.moveTo(f0.x, f0.y); ctx.lineTo(f1.x, f1.y); ctx.lineTo(f2.x, f2.y); ctx.stroke();
  // Glass partitions on the two back walls: pale panes, a steel top rail and posts.
  const H = 15;
  const walls: [number, number, number, number][] = [[d.x0, d.y1, d.x0, d.y0], [d.x0, d.y0, d.x1, d.y0]];
  for (const [x0, y0, x1, y1] of walls) poly([iso(x0, y0), iso(x1, y1), iso(x1, y1, H), iso(x0, y0, H)], 'rgba(200,228,248,.32)');
  ctx.strokeStyle = '#f2f7fb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of walls) { const a = iso(x0, y0, H - 4), b = iso(x1, y1, H - 4); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
  ctx.stroke();
  ctx.strokeStyle = '#8193a7';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of walls) {
    const a = iso(x0, y0, H), b = iso(x1, y1, H);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 1.5));
    for (let i = 0; i <= n; i++) { const q = iso(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x, q.y - H); }
  }
  ctx.stroke();
  // The door sign, under the wing's name.
  const sx = d.x0 + 0.35, sy = d.y0 + 0.35;
  const s0 = iso(sx + 0.2, sy, 0), s1 = iso(sx + 0.2, sy, 12);
  ctx.strokeStyle = '#6f8297'; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
  poly([iso(sx, sy, 12), iso(sx + 2.6, sy, 12), iso(sx + 2.6, sy, 23), iso(sx, sy, 23)], '#f7fafc');
  poly([iso(sx, sy, 12), iso(sx + 2.6, sy, 12), iso(sx + 2.6, sy, 15), iso(sx, sy, 15)], rgba(d.color, 0.95));
  poly([iso(sx, sy, 20), iso(sx + 2.6, sy, 20), iso(sx + 2.6, sy, 23), iso(sx, sy, 23)], rgba(d.color, 0.95));
}

/** A team: a bay taped off on the floor in its manager's colour, with a placard on a stand. */
function team(p: Paint, t: TeamBlock, color: string) {
  const { ctx, iso, poly } = p;
  const corners = [iso(t.x0, t.y0), iso(t.x1, t.y0), iso(t.x1, t.y1), iso(t.x0, t.y1)];
  poly(corners, 'rgba(255,255,255,.22)');
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  corners.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.closePath();
  ctx.stroke();
  // Corner brackets in steel, so a bay reads as a bay even in a pale colour.
  ctx.strokeStyle = '#6f8297';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (const [x, y] of [[t.x0, t.y0], [t.x1, t.y0], [t.x1, t.y1], [t.x0, t.y1]]) { const q = iso(x, y); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x, q.y - 7); }
  ctx.stroke();
  const sx = t.x0 + 0.3, sy = t.y0 + 0.3;
  const s0 = iso(sx + 0.15, sy, 0), s1 = iso(sx + 0.15, sy, 9);
  ctx.strokeStyle = '#6f8297'; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
  poly([iso(sx, sy, 9), iso(sx + 1.8, sy, 9), iso(sx + 1.8, sy, 16), iso(sx, sy, 16)], '#f7fafc');
  poly([iso(sx, sy, 9), iso(sx + 1.8, sy, 9), iso(sx + 1.8, sy, 11.5), iso(sx, sy, 11.5)], rgba(color, 0.95));
}

// ─── the base

const REACTOR_H = 112;

/** A computer: the bioreactor. Bubbles rise in its vessel while the node is up; its lid lamp blinks on the heartbeat. */
function reactor(p: Paint, i: Island, blink: number) {
  const { ctx, iso } = p;
  const { x, y } = i.core;
  const up = i.node?.state === 'online';
  const art = sprite('l_reactor', up ? undefined : 'gray');
  const b = iso(x, y);
  ctx.fillStyle = 'rgba(40,70,110,.22)';
  ctx.beginPath(); ctx.ellipse(b.x, b.y + 6, 40, 17, 0, 0, TAU); ctx.fill();
  if (!art) {
    p.box(x - 0.8, y - 0.8, 1.6, 1.6, 0, 18, '#e9eef3', '#cfd8e2', '#aebccb');
    p.box(x - 0.45, y - 0.45, 0.9, 0.9, 18, 40, 'rgba(120,230,170,.8)', 'rgba(60,200,140,.75)', 'rgba(40,160,110,.75)');
    return;
  }
  const w = REACTOR_H * aspect('l_reactor');
  const top = b.y + 12 - REACTOR_H, left = b.x - w / 2;
  stand(ctx, art, b.x, b.y + 12, REACTOR_H);
  if (!up) return;
  const t = p.t();
  // Bubbles inside the glass (its window spans about 37–62% across, 33–64% down the sprite).
  ctx.fillStyle = 'rgba(235,255,245,.75)';
  for (let k = 0; k < 6; k++) {
    const f = (t * (0.35 + hash(k, x, y) * 0.3) + k / 6) % 1;
    const bx = left + w * (0.4 + 0.2 * hash(k, 3, x)) + Math.sin(t * 3 + k) * 1.2;
    const by = top + REACTOR_H * (0.63 - f * 0.28);
    ctx.beginPath(); ctx.arc(bx, by, 0.9 + hash(k, 7, y) * 1.3, 0, TAU); ctx.fill();
  }
  // The lid lamp: the heartbeat.
  const lx = left + w * 0.575, ly = top + REACTOR_H * 0.195;
  ctx.fillStyle = `rgba(255,70,60,${0.25 + 0.75 * blink})`;
  ctx.beginPath(); ctx.arc(lx, ly, 2.6 + blink * 1.4, 0, TAU); ctx.fill();
  ctx.fillStyle = `rgba(255,235,230,${0.8 * blink})`;
  ctx.beginPath(); ctx.arc(lx - 0.6, ly - 0.6, 1, 0, TAU); ctx.fill();
}

// ─── an agent's place: an instrument column

const MODULES = ['l_mod_analyser', 'l_mod_incubator', 'l_mod_centrifuge', 'l_mod_samples'];
/** Each kind's column starts on its own instrument; the rest are picked by the agent's seed. */
const BASE_MODULE: Record<string, number> = { omp: 0, claude: 1, codex: 2, pi: 3 };
const MOD_W = 60; // px: a module is a cube about one tile across
const PITCH = 0.615; // a module's side height / its sprite height: where the next one sits
const CAP_MIN = 30;

/**
 * A drawn column: its modules' bases, the top, and the cap's vessel: liquid from y0 (bottom) to y1 (top)
 * around x, `w` half width, bubble scale `r`, and the mouth's y, where vapour leaves.
 */
interface Column { top: Pt; tops: Pt[]; capTop: Pt; glass: { x: number; y0: number; y1: number; w: number; r: number; mouth: number } }

/** Floor mat and the column of stacked lab modules, `h` px tall: whole modules, then a still sized to fill the rest. */
function bench(p: Paint, s: Slot, h: number, status: string, alive: boolean, shade = 0) {
  const { ctx, iso, poly } = p;
  const t = p.t();
  const { gx, gy } = s;
  const kind = characterIdFor(s.agent.kind);
  const mat = [iso(gx + 0.12, gy + 0.12), iso(gx + 1.88, gy + 0.12), iso(gx + 1.88, gy + 1.88), iso(gx + 0.12, gy + 1.88)];
  poly(mat, p.ground('l_mat', gx, gy, 1.6) ?? (alive ? '#5d7189' : '#8b939c'));
  if (!alive) poly(mat, 'rgba(200,205,212,.45)');
  // Needs a human: the whole mat flashes alarm red, the one big flat shape that reads at phone size.
  else if (status === 'blocked') {
    poly(mat, `rgba(255,52,36,${0.72 + 0.22 * Math.sin(t * 8 + s.seed)})`);
    // Alarm rings spreading over the floor, thinning out instead of fading (an opaque stroke needs no mask).
    const c = iso(gx + 1, gy + 1);
    ctx.strokeStyle = '#ff3b2f';
    for (let k = 0; k < 2; k++) {
      const f = (t * 0.9 + k / 2 + s.seed * 0.1) % 1;
      const rx = 52 + f * 70;
      ctx.lineWidth = 4 * (1 - f) + 0.3;
      ctx.beginPath(); ctx.ellipse(c.x, c.y, rx, rx / 2, 0, 0, TAU); ctx.stroke();
    }
  }
  // The kind's colour as tape along the mat's front edges.
  const K = alive ? kindOf(s.agent.kind).c : '#9aa3ad';
  poly([iso(gx + 0.12, gy + 1.88), iso(gx + 1.88, gy + 1.88), iso(gx + 1.88, gy + 1.74), iso(gx + 0.26, gy + 1.74)], K);
  poly([iso(gx + 1.88, gy + 0.12), iso(gx + 1.88, gy + 1.88), iso(gx + 1.74, gy + 1.74), iso(gx + 1.74, gy + 0.26)], rgba(K, 0.8));
  // A quiet agent: map.ts hands over its sprites already darkened; the mat and tape are darkened here to match.
  if (shade > 0) poly(mat, `rgba(${SHADE.lab.join(',')},${shade})`);
  const col = column(p, s, h, kind, alive);
  if (!col) {
    p.box(gx + 0.55, gy + 0.55, 0.9, 0.9, 0, h, '#f1f5f9', '#d6dfe8', '#b3c1cf');
    return;
  }
  const working = status === 'working';
  // Lights and bubbles fade with the shade, so a quiet column's panel goes dark too.
  ctx.save();
  ctx.globalAlpha *= 1 - shade * 0.85;
  if (alive) leds(p, s, col, status);
  if (working) bubbles(p, s, col);
  ctx.restore();
  if (status === 'blocked' && alive) beacon(p, col, 'l_beacon_red', t, s.seed);
  else if (status === 'done') beacon(p, col, 'l_beacon_green', t, s.seed);
}

/** The floor mat, and the column of modules standing on the plot's centre up to its still. */
function benchShape(iso: Iso, s: Slot, h: number): Pt[][] {
  const front = iso(s.gx + 1.5, s.gy + 1.5), centre = iso(s.gx + 1, s.gy + 1);
  return [boxOutline(iso, s.gx + 0.12, s.gy + 0.12, 1.76, 1.76, 6), columnOutline(front, MOD_W, front.y - centre.y + h + 4)];
}

function column(p: Paint, s: Slot, h: number, kind: string, alive: boolean): Column | null {
  const { ctx, iso } = p;
  const v = alive ? undefined : 'gray';
  const front = iso(s.gx + 1.5, s.gy + 1.5); // front corner of the 1×1 footprint at the plot's centre
  const centre = iso(s.gx + 1, s.gy + 1);
  const ratio = aspect(MODULES[0]);
  const mh = MOD_W / ratio, pitch = mh * PITCH;
  // Height is measured over the plot's centre: whole modules first, the cap takes the remainder.
  const reach = h + (front.y - centre.y);
  const n = Math.max(0, Math.floor((reach - CAP_MIN) / pitch));
  const tops: Pt[] = [];
  let y = front.y;
  const first = BASE_MODULE[kind] ?? 0;
  let prev = -1;
  for (let k = 0; k < n; k++) {
    let m = k === 0 ? first : Math.floor(hash(s.seed, k, 3) * MODULES.length);
    if (m === prev) m = (m + 1) % MODULES.length;
    prev = m;
    const img = sprite(MODULES[m], v);
    if (!img) return null;
    stand(ctx, img, front.x, y, mh, { w: MOD_W });
    tops.push({ x: front.x, y });
    y -= pitch;
  }
  // The cap stands on the top face's centre (or on the mat): a still, or a hot plate when there's little room.
  const capBase = n ? { x: front.x, y: y - (mh - pitch) / 2 + 3 } : { x: centre.x, y: centre.y + 4 };
  const capH = Math.max(14, capBase.y - (centre.y - h));
  const cap = capH < CAP_MIN || n === 0 ? 'l_hotplate' : 'l_still';
  const img = sprite(cap, v);
  if (!img) return null;
  // A still keeps its proportions (at most CAP_MIN + a module's pitch tall, about a module wide); a hot plate stays small.
  const cw = cap === 'l_still' ? capH * aspect(cap) : Math.min(capH * aspect(cap), 40);
  const flip = hash(s.seed, 9, 9) > 0.5;
  stand(ctx, img, capBase.x, capBase.y, capH, { w: cw, flip });
  // Where the liquid sits in each sprite: the still's round flask, 6% left of centre, 50–66% down;
  // the hot plate's beaker, centred, 16–48% down.
  const top = capBase.y - capH;
  const glass = cap === 'l_still'
    ? { x: capBase.x + (flip ? 1 : -1) * cw * 0.06, y0: top + capH * 0.66, y1: top + capH * 0.5, w: cw * 0.1, r: capH / 45, mouth: top + capH * 0.25 }
    : { x: capBase.x, y0: top + capH * 0.48, y1: top + capH * 0.16, w: cw * 0.16, r: capH / 40, mouth: top + capH * 0.06 };
  return { top: { x: front.x, y }, tops, capTop: { x: capBase.x, y: top }, glass };
}

/** Status lights on each module's right face: the kind's colour chasing while working, amber when blocked, a steady green when done. */
function leds(p: Paint, s: Slot, c: Column, status: string) {
  const { ctx } = p;
  const t = p.t();
  const mh = MOD_W / aspect(MODULES[0]), pitch = mh * PITCH;
  const lit = new Path2D(), dim = new Path2D();
  c.tops.forEach((q, k) => {
    for (let i = 0; i < 3; i++) {
      const on = status === 'working' ? Math.sin(t * 9 - i * 1.4 - k * 0.8 + s.seed) > 0
        : status === 'blocked' ? Math.sin(t * 10) > 0 : status === 'done' ? true : i === 0;
      // Along the right face, parallel to its top edge (rising 1 px per 2 across).
      const lx = q.x + 8 + i * 5, ly = q.y - pitch * 0.42 - (8 + i * 5) / 2;
      (on ? lit : dim).rect(lx - 1.4, ly - 1.4, 2.8, 2.8);
    }
  });
  ctx.fillStyle = 'rgba(70,85,100,.5)';
  ctx.fill(dim);
  ctx.fillStyle = status === 'working' ? kindOf(s.agent.kind).c : status === 'blocked' ? '#ff8a00' : status === 'done' ? '#2fbf5b' : '#9aa7b4';
  ctx.fill(lit);
}

/** An experiment running: bubbles rising through the cap's liquid, vapour puffing off the top. */
function bubbles(p: Paint, s: Slot, c: Column) {
  const { ctx } = p;
  const t = p.t();
  const g = c.glass;
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    const f = (t * 0.9 + k / 5 + s.seed * 0.13) % 1;
    const bx = g.x + Math.sin(t * 5 + k * 2.3) * g.w, by = g.y0 + (g.y1 - g.y0) * f, r = (0.7 + f * 1.1) * g.r;
    ctx.moveTo(bx + r, by); ctx.arc(bx, by, r, 0, TAU);
  }
  ctx.fillStyle = 'rgba(225,245,255,.85)';
  ctx.fill();
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const f = (t * 0.5 + k / 3 + s.seed * 0.07) % 1;
    const vx = g.x + Math.sin(t * 1.5 + k * 2) * 3 + f * 6, vy = g.mouth - f * 22, r = 2 + f * 4;
    ctx.moveTo(vx + r, vy); ctx.arc(vx, vy, r, 0, TAU);
  }
  ctx.fillStyle = 'rgba(255,255,255,.6)';
  ctx.fill();
}

/**
 * A beacon on top of the column: red and spinning (two light beams sweeping the floor and a bob) when the
 * agent needs a human; green and steady when its results are ready.
 */
function beacon(p: Paint, c: Column, name: string, t: number, seed: number) {
  const { ctx } = p;
  const img = sprite(name);
  const red = name === 'l_beacon_red';
  const x = c.capTop.x + 12, y = c.top.y - 8 - (c.tops.length ? 0 : -6);
  const bh = red ? 30 : 18;
  const bob = red ? Math.abs(Math.sin(t * 7 + seed)) * 3 : 0;
  if (red) {
    // Two beams turning around the dome, flattened onto the iso floor.
    const a = t * 5 + seed;
    const cy = y - bh * 0.55 - bob;
    ctx.fillStyle = 'rgba(255,60,40,.26)';
    for (const o of [0, Math.PI]) {
      const a0 = a + o - 0.34, a1 = a + o + 0.34, L = 64;
      ctx.beginPath();
      ctx.moveTo(x, cy);
      ctx.lineTo(x + Math.cos(a0) * L, cy + Math.sin(a0) * L * 0.5);
      ctx.lineTo(x + Math.cos(a1) * L, cy + Math.sin(a1) * L * 0.5);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (img) stand(ctx, img, x, y - bob, bh, { sx: red ? 1 + Math.sin(t * 14) * 0.04 : 1 });
  else {
    ctx.fillStyle = red ? '#e53935' : '#2fbf5b';
    ctx.beginPath(); ctx.arc(x, y - bh / 2 - bob, bh / 3, 0, TAU); ctx.fill();
  }
  if (red && Math.sin(t * 10 + seed) > 0) {
    ctx.fillStyle = 'rgba(255,240,200,.9)';
    ctx.beginPath(); ctx.arc(x, y - bh * 0.5 - bob, 3, 0, TAU); ctx.fill();
  }
}

/** A Buzz channel is an intercom on a post at the mat's back corner: lamp lit while attached, blinking while pending, grey when off. */
function intercom(p: Paint, s: Slot, state: string | null) {
  if (!state) return;
  const { ctx, iso } = p;
  const live = state === 'attached' || state === 'ok' || state === 'pending';
  const img = sprite('l_intercom', live ? undefined : 'gray');
  const b = iso(s.gx + 1.85, s.gy + 0.2);
  if (img) {
    stand(ctx, img, b.x, b.y, 30);
    // The lamp sits about 30% across, 45% down the box (a 30 px sprite, 15 px wide).
    const on = state === 'pending' ? Math.sin(p.t() * 5) > 0 : live;
    if (on) {
      ctx.fillStyle = state === 'pending' ? '#ffb300' : '#45e07a';
      ctx.beginPath(); ctx.arc(b.x - 15 * 0.18, b.y - 30 * 0.6, 1.6, 0, TAU); ctx.fill();
    }
    return;
  }
  const x = s.gx + 1.85, y = s.gy + 0.2;
  const top = iso(x, y, 14);
  ctx.strokeStyle = '#6f8297'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(top.x, top.y); ctx.stroke();
  p.box(x - 0.15, y - 0.1, 0.3, 0.2, 14, 9, '#f4f7fa', '#dfe6ee', '#c3cfdb');
}

// ─── the scientist

const STAND_H = 54, REST_H = 46, ALARM_H = 60;

/**
 * A scientist in a lab coat, feet at (x, y); trousers and shirt in the kind's colour. Standing (and
 * pipetting) while working or walking; on a stool with a coffee when idle or done; waving a red
 * paddle when blocked.
 */
function scientist(p: Paint, x: number, y: number, o: UnitLook) {
  const { ctx } = p;
  const t = p.t();
  const names = SCIENTIST_ART[characterIdFor(o.cast)];
  const resting = !o.working && !o.walking && !o.blocked && !o.dead;
  const name = o.blocked && !o.dead ? names.alarm : resting ? names.rest : names.work;
  const img = sprite(name, o.dead ? 'gray' : undefined);
  if (!img) { fallback(p, x, y, o); return; }
  if (o.blocked && !o.dead) {
    // Hopping and waving the paddle.
    const hop = Math.abs(Math.sin(t * 6 + o.seed)) * 6;
    stand(ctx, img, x, y - hop, ALARM_H, { flip: o.flip, rot: Math.sin(t * 12 + o.seed) * 0.07 });
    return;
  }
  if (resting) {
    stand(ctx, img, x, y, REST_H, { flip: o.flip, sy: 1 + Math.sin(t * 1.6 + o.seed) * 0.012 });
    // Steam off the mug (about 12% across, 40% down the sprite).
    const w = REST_H * aspect(name);
    const mx = x + (o.flip ? 1 : -1) * w * 0.36, my = y - REST_H * 0.66;
    for (let i = 0; i < 2; i++) {
      const f = (t * 0.45 + i / 2 + o.seed * 0.1) % 1;
      ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - f)})`;
      ctx.beginPath(); ctx.arc(mx + Math.sin(t * 2 + i * 3) * 1.6, my - f * 12, 1.4 + f * 2, 0, TAU); ctx.fill();
    }
    return;
  }
  const rot = o.walking ? o.sway : o.working ? Math.sin(t * 6 + o.seed) * 0.05 : 0;
  stand(ctx, img, x, y, STAND_H, { flip: o.flip, rot, sy: o.working ? 1 + Math.sin(t * 12 + o.seed) * 0.025 : 1 + Math.sin(t * 2 + o.seed) * 0.012 });
  if (o.working) {
    // Drops falling from the pipette, flask or tube in hand, in the kind's colour.
    const hx = x + (o.flip ? 1 : -1) * 8, hy = y - STAND_H * 0.62;
    for (let i = 0; i < 2; i++) {
      const f = (t * 1.3 + i / 2 + o.seed * 0.07) % 1;
      ctx.fillStyle = rgba(o.shirt.c, 1 - f);
      ctx.beginPath(); ctx.ellipse(hx, hy + f * 16, 1.3, 1.9, 0, 0, TAU); ctx.fill();
    }
  }
}

/** Until the art loads: a coat, a head and the kind's colour. */
function fallback(p: Paint, x: number, y: number, o: UnitLook) {
  const { ctx } = p;
  const c = o.dead ? '#9aa3ad' : o.shirt.c;
  ctx.fillStyle = c;
  ctx.fillRect(x - 5, y - 14, 4, 14); ctx.fillRect(x + 1, y - 14, 4, 14);
  ctx.fillStyle = '#f7f9fb';
  ctx.beginPath(); ctx.roundRect(x - 8, y - 32, 16, 20, 4); ctx.fill();
  ctx.strokeStyle = 'rgba(60,80,100,.5)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = c;
  ctx.fillRect(x - 3, y - 31, 6, 7);
  ctx.fillStyle = '#f1c27d';
  ctx.beginPath(); ctx.arc(x, y - 37, 6, 0, TAU); ctx.fill();
}

/** A working scientist carries a rack of samples to the reactor. */
function carry(p: Paint, _s: Slot, x: number, y: number, flip: boolean) {
  const img = sprite('l_tubes');
  if (img) stand(p.ctx, img, x, y + 7, 14, { flip });
}

/** A missing agent: an empty lab coat on a coat stand where the scientist should be. */
function coatStand(p: Paint, x: number, y: number, alpha: number) {
  const { ctx } = p;
  const img = sprite('l_coatstand');
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (img) stand(ctx, img, x, y, 56, { rot: Math.sin(p.t() * 1.1 + x) * 0.03 });
  else {
    ctx.strokeStyle = '#7d8ea1'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 50); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.stroke();
    ctx.fillStyle = '#f4f7fa';
    ctx.beginPath(); ctx.roundRect(x - 8, y - 46, 16, 26, 3); ctx.fill();
  }
  ctx.restore();
}

/** Spend in flight: a drop of golden reagent, wobbling as it flies. */
function drop(p: Paint, x: number, y: number, r: number, alpha: number) {
  const { ctx } = p;
  const img = sprite('l_drop');
  ctx.save();
  ctx.globalAlpha = alpha;
  if (img) {
    const wob = Math.sin(p.t() * 14 + x * 0.05) * 0.1;
    stand(ctx, img, x, y + r * 1.2, r * 2.6, { sy: 1 + wob, sx: 1 - wob });
  } else {
    ctx.fillStyle = '#ffbf2e';
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// ─── scenery

/** Scenery on free ground: potted plants, gas cylinders, carts, microscopes, supplies, bins, extinguishers and a lab mouse on the loose. */
function decor(p: Paint, d: Decor) {
  const { ctx, iso } = p;
  const t = p.t();
  const shadow = (q: Pt, rx: number) => {
    ctx.fillStyle = 'rgba(40,70,110,.2)';
    ctx.beginPath(); ctx.ellipse(q.x, q.y, rx, rx / 2.2, 0, 0, TAU); ctx.fill();
  };
  const prop = (name: string, h: number, rx: number, flip = false) => {
    const q = iso(d.x, d.y);
    shadow(q, rx);
    const img = sprite(name);
    if (img) stand(ctx, img, q.x, q.y + 2, h, { flip });
  };
  if (d.r < 0.22) prop('l_plant', 50 + d.r * 70, 14, d.r > 0.11);
  else if (d.r < 0.34) prop('l_cylinders', 46, 12, d.r > 0.28);
  else if (d.r < 0.45) prop('l_cart', 32, 16, d.r > 0.4);
  else if (d.r < 0.55) prop('l_microscope', 36, 15, d.r > 0.5);
  else if (d.r < 0.63) prop('l_boxes', 26, 13, d.r > 0.59);
  else if (d.r < 0.7) prop('l_bin', 20, 8);
  else if (d.r < 0.76) prop('l_extinguisher', 22, 6);
  else {
    // A lab mouse scurrying about: darting runs, then a pause to sniff.
    const run = (t * 0.22 + d.r * 13) % 1;
    const leg = Math.floor(t * 0.22 + d.r * 13);
    const a = hash(leg, d.r * 100, 1) * TAU, b = hash(leg + 1, d.r * 100, 1) * TAU;
    const e = Math.min(1, run / 0.35);
    const ease = e * e * (3 - 2 * e);
    const mx = d.x + Math.cos(a) * 0.5 * (1 - ease) + Math.cos(b) * 0.5 * ease, my = d.y + Math.sin(a) * 0.5 * (1 - ease) + Math.sin(b) * 0.5 * ease;
    const q = iso(mx, my);
    const vx = Math.cos(b) - Math.cos(a) - (Math.sin(b) - Math.sin(a)); // screen-x direction of this run
    shadow(q, 5);
    const img = sprite('l_mouse');
    const moving = e < 1;
    if (img) stand(ctx, img, q.x, q.y - (moving ? Math.abs(Math.sin(t * 30)) * 0.8 : 0), 9, { flip: vx < 0, rot: moving ? 0 : Math.sin(t * 9) * 0.05 });
  }
}

/** Over everything, in world space: after hours the lab drops to blue night lighting and the reactors' vessels glow through it. */
function sky(p: Paint, _bounds: { x0: number; y0: number; x1: number; y1: number }, cores: Pt[], _places: Pt[]) {
  const { ctx, iso } = p;
  const night = afterHours();
  if (night <= 0) return;
  ctx.fillStyle = `rgba(14,26,60,${0.32 * night})`;
  ctx.fillRect(-1e5, -1e5, 2e5, 2e5);
  // The vessels keep glowing: a soft green pool around each reactor.
  for (const c of cores) {
    const q = iso(c.x, c.y);
    ctx.fillStyle = `rgba(90,255,170,${0.12 * night})`;
    ctx.beginPath(); ctx.ellipse(q.x, q.y - 50, 34, 44, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(q.x, q.y + 4, 56, 24, 0, 0, TAU); ctx.fill();
  }
}

export const painter: Painter = {
  sprites: [
    'l_reactor', ...MODULES, 'l_still', 'l_hotplate', 'l_beacon_red', 'l_beacon_green', 'l_intercom', 'l_drop', 'l_tubes', 'l_coatstand',
    'l_plant', 'l_cylinders', 'l_cart', 'l_microscope', 'l_boxes', 'l_bin', 'l_extinguisher', 'l_mouse', 'l_floor', 'l_mat',
    ...Object.values(SCIENTIST_ART).flatMap((names) => [names.work, names.rest, names.alarm]),
  ],
  font: '"IBM Plex Sans", system-ui, sans-serif',
  unitArt: (_kind, cast) => SCIENTIST_ART[characterIdFor(cast)].work,
  unitH: 52, unitW: 42,
  link: { color: '#1f9fc4', dash: [], lift: 0.9 },
  background, slab, bridge, field, team, core: reactor, place: bench, placeShape: benchShape, buzz: intercom, unit: scientist, carry, standIn: coatStand, coin: drop, decor, sky,
};
