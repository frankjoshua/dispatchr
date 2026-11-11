import { rgba } from './format';
import type { Painter, Paint, Pt, UnitLook } from './painters';
import { SHADE, aspect, sprite, stand } from './sprites';
import type { Decor, District, Island, Rect, Slot, TeamBlock } from './world';
import { boxOutline, type Iso } from './shapes';

// The farm theme's painter: a meadow, each computer a farm with a barn, each space a fenced field
// with a sign, each agent a plot of crops (the Stack: as tall as its current run has been working)
// tended by a farmer. map.ts owns the camera, layout, labels and effects and calls these for the
// parts that look different.

const SLAB = 40;
const hash = (a: number, b: number, c: number) => { const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return x - Math.floor(x); };

// Screen-space meadow details, placed once.
const tufts = Array.from({ length: 220 }, () => ({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8, f: Math.random() < 0.12 }));
const clouds = Array.from({ length: 4 }, (_, i) => ({ y: 0.15 + i * 0.22, s: 0.7 + Math.random() * 0.6, v: 6 + Math.random() * 8, o: Math.random() }));

function background(p: Paint, W: number, H: number, camX: number, camY: number) {
  const { ctx } = p;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#a6d86b');
  g.addColorStop(1, '#7fb84a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 1.2;
  for (const t of tufts) {
    const x = ((t.x * W - camX * 0.05) % W + W) % W, y = ((t.y * H - camY * 0.05) % H + H) % H;
    if (t.f) {
      ctx.fillStyle = t.x > 0.5 ? '#fffdf0' : '#ffe066';
      ctx.beginPath(); ctx.arc(x, y, 1.6 * t.s, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    ctx.strokeStyle = 'rgba(52,110,30,.45)';
    ctx.beginPath(); ctx.moveTo(x - 3 * t.s, y - 4 * t.s); ctx.lineTo(x, y); ctx.lineTo(x + 3 * t.s, y - 5 * t.s); ctx.stroke();
  }
  // Cloud shadows drifting over the fields.
  const t = p.t();
  ctx.fillStyle = 'rgba(30,60,20,.07)';
  for (const c of clouds) {
    const x = ((c.o * W + t * c.v) % (W + 400)) - 200;
    ctx.beginPath(); ctx.ellipse(x, c.y * H, 160 * c.s, 60 * c.s, 0, 0, Math.PI * 2); ctx.fill();
  }
}

const GRASS: Record<string, string> = { online: '#8fd052', stale: '#c8c46a', offline: '#b8a67c' };

/** A raised plot of land: grass on top, soil strata on the sides. */
function slab(p: Paint, r: Rect, state: string) {
  const { ctx, iso, poly } = p;
  const A = iso(r.x0, r.y0), B = iso(r.x1, r.y0), C = iso(r.x1, r.y1), D = iso(r.x0, r.y1);
  const dn = (q: Pt, d = SLAB) => ({ x: q.x, y: q.y + d });
  const grad = (y0: number, y1: number, a: string, b: string) => { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
  ctx.fillStyle = 'rgba(40,70,20,.18)';
  ctx.beginPath(); ctx.ellipse((D.x + B.x) / 2, (A.y + C.y) / 2 + SLAB + 16, (B.x - D.x) / 2 + 10, (C.y - A.y) / 2 + 6, 0, 0, Math.PI * 2); ctx.fill();
  poly([D, C, dn(C), dn(D)], grad(D.y, C.y + SLAB, '#9e6c3b', '#6b4322'));
  poly([C, B, dn(B), dn(C)], grad(B.y, C.y + SLAB, '#86582e', '#56361a'));
  ctx.strokeStyle = 'rgba(70,40,15,.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const d of [SLAB / 3, (SLAB * 2) / 3]) { ctx.moveTo(D.x, D.y + d); ctx.lineTo(C.x, C.y + d); ctx.lineTo(B.x, B.y + d); }
  ctx.stroke();
  const grass = GRASS[state] ?? GRASS.offline;
  poly([A, B, C, D], p.ground('f_grass', r.x0, r.y0, 3) ?? grass);
  if (state !== 'online') poly([A, B, C, D], state === 'stale' ? 'rgba(210,190,100,.35)' : 'rgba(170,150,110,.6)');
  // Checkered mowing pattern.
  const light = new Path2D();
  for (let x = Math.floor(r.x0); x < r.x1; x++) {
    for (let y = Math.floor(r.y0); y < r.y1; y++) {
      if ((x + y) % 2) continue;
      const x0 = Math.max(x, r.x0), x1 = Math.min(x + 1, r.x1), y0 = Math.max(y, r.y0), y1 = Math.min(y + 1, r.y1);
      if (x1 <= x0 || y1 <= y0) continue;
      const a = iso(x0, y0), b = iso(x1, y0), c = iso(x1, y1), d = iso(x0, y1);
      light.moveTo(a.x, a.y); light.lineTo(b.x, b.y); light.lineTo(c.x, c.y); light.lineTo(d.x, d.y); light.closePath();
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  ctx.fill(light);
  ctx.strokeStyle = 'rgba(220,255,170,.8)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(C.x, C.y); ctx.lineTo(D.x, D.y); ctx.closePath(); ctx.stroke();
}

/** A space: a fenced field with a sign in the space's colour. */
function field(p: Paint, d: District) {
  const { ctx, iso, poly } = p;
  poly([iso(d.x0, d.y0), iso(d.x1, d.y0), iso(d.x1, d.y1), iso(d.x0, d.y1)], 'rgba(120,80,30,.12)');
  const posts: Pt[][] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) posts.push([iso(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 0)]);
    ctx.strokeStyle = '#b78450';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const z of [4, 8]) { const a = iso(x0, y0, z), b = iso(x1, y1, z); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.stroke();
  };
  edge(d.x0, d.y0, d.x1, d.y0);
  edge(d.x0, d.y0, d.x0, d.y1);
  edge(d.x1, d.y0, d.x1, d.y1);
  edge(d.x0, d.y1, d.x1, d.y1);
  ctx.strokeStyle = '#7a4f26';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [b] of posts) { ctx.moveTo(b.x, b.y); ctx.lineTo(b.x, b.y - 10); }
  ctx.stroke();
  // The sign, under the space's name.
  const sx = d.x0 + 0.35, sy = d.y0 + 0.35;
  const s0 = iso(sx + 0.2, sy, 0), s1 = iso(sx + 0.2, sy, 12);
  ctx.strokeStyle = '#6b4322'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
  poly([iso(sx, sy, 12), iso(sx + 2.6, sy, 12), iso(sx + 2.6, sy, 22), iso(sx, sy, 22)], '#d9a866');
  poly([iso(sx, sy, 12), iso(sx + 2.6, sy, 12), iso(sx + 2.6, sy, 14), iso(sx, sy, 14)], rgba(d.color, 0.9));
}

/** A team inside a field: paler grass behind a low rail, and a small sign in its manager's colour. */
function team(p: Paint, t: TeamBlock, color: string) {
  const { ctx, iso, poly } = p;
  const corners = [iso(t.x0, t.y0), iso(t.x1, t.y0), iso(t.x1, t.y1), iso(t.x0, t.y1)];
  poly(corners, 'rgba(255,246,205,.13)');
  const rail = [iso(t.x0, t.y0, 5), iso(t.x1, t.y0, 5), iso(t.x1, t.y1, 5), iso(t.x0, t.y1, 5)];
  ctx.strokeStyle = '#d0a26a';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  rail.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = '#8a5a2b';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of [[t.x0, t.y0, t.x1, t.y0], [t.x1, t.y0, t.x1, t.y1], [t.x1, t.y1, t.x0, t.y1], [t.x0, t.y1, t.x0, t.y0]]) {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 1.5));
    for (let i = 0; i < n; i++) {
      const b = iso(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
      ctx.moveTo(b.x, b.y); ctx.lineTo(b.x, b.y - 7);
    }
  }
  ctx.stroke();
  const sx = t.x0 + 0.3, sy = t.y0 + 0.3;
  const s0 = iso(sx + 0.15, sy, 0), s1 = iso(sx + 0.15, sy, 9);
  ctx.strokeStyle = '#6b4322'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
  poly([iso(sx, sy, 9), iso(sx + 1.8, sy, 9), iso(sx + 1.8, sy, 16), iso(sx, sy, 16)], '#e2b878');
  poly([iso(sx, sy, 9), iso(sx + 1.8, sy, 9), iso(sx + 1.8, sy, 11), iso(sx, sy, 11)], rgba(color, 0.9));
}

/** A computer: a red barn; its hayloft lamp blinks on the node's heartbeat. */
function barn(p: Paint, i: Island, blink: number) {
  const { ctx, iso, poly } = p;
  const { x, y } = i.core;
  const up = i.node?.state === 'online';
  const art = sprite('f_barn', up ? undefined : 'gray');
  if (art) {
    const b = iso(x, y);
    stand(ctx, art, b.x, b.y + 12, 104);
    // The hayloft lamp brightens on every heartbeat.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(b.x - 6, b.y - 66, 0, b.x - 6, b.y - 66, 22);
    g.addColorStop(0, `rgba(255,214,90,${up ? 0.25 + 0.55 * blink : 0})`);
    g.addColorStop(1, 'rgba(255,214,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(b.x - 30, b.y - 90, 48, 48);
    ctx.restore();
    return;
  }
  const wall = up ? '#c0392b' : '#8e7f7f', wallR = up ? '#a12f24' : '#776a6a';
  const w = 0.9, h = 22, ridge = 14;
  p.box(x - w, y - w, w * 2, w * 2, 0, h, wall, wall, wallR, 'rgba(255,255,255,.7)');
  // Door with the white cross.
  const d0 = iso(x - 0.35, y + w, 0), d1 = iso(x + 0.35, y + w, 0), d2 = iso(x + 0.35, y + w, 13), d3 = iso(x - 0.35, y + w, 13);
  poly([d0, d1, d2, d3], up ? '#7b241c' : '#5f5555');
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(d0.x, d0.y); ctx.lineTo(d2.x, d2.y); ctx.moveTo(d1.x, d1.y); ctx.lineTo(d3.x, d3.y);
  ctx.moveTo(d0.x, d0.y); ctx.lineTo(d1.x, d1.y); ctx.lineTo(d2.x, d2.y); ctx.lineTo(d3.x, d3.y); ctx.closePath(); ctx.stroke();
  const A = iso(x - w, y - w, h), B = iso(x + w, y - w, h), C = iso(x + w, y + w, h), D = iso(x - w, y + w, h);
  const R1 = iso(x - w, y, h + ridge), R2 = iso(x + w, y, h + ridge);
  poly([A, B, R2, R1], up ? '#6d7b85' : '#77706a');
  poly([B, C, R2], wallR);
  poly([D, C, R2, R1], up ? '#8a98a2' : '#8a837c');
  ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(B.x, B.y); ctx.lineTo(R2.x, R2.y); ctx.lineTo(C.x, C.y); ctx.moveTo(R1.x, R1.y); ctx.lineTo(R2.x, R2.y); ctx.stroke();
  // Hayloft lamp on the gable end.
  const l = iso(x + w, y, h + 5);
  ctx.fillStyle = up ? `rgba(255,214,90,${0.45 + 0.55 * blink})` : 'rgba(80,70,60,.6)';
  ctx.beginPath(); ctx.arc(l.x, l.y, 3, 0, Math.PI * 2); ctx.fill();
}

const SPROUT = '#57b03a';
const STALK = { alive: '#3f8f2f', dead: '#9c7a4a' };

/** The plot up to its tallest plants (they stand across all of it). */
const cropShape = (iso: Iso, s: Slot, h: number): Pt[][] => [boxOutline(iso, s.gx + 0.1, s.gy + 0.1, 1.8, 1.8, h + 6)];

/**
 * An agent's plot: 3×3 plants on tilled soil, `h` px tall. The crop follows the agent's kind
 * (omp corn, Claude sunflowers, others wheat); dead plots wither; working ones sway briskly. `shade`:
 * how far a quiet plot's soil goes toward dusk (map.ts dims by recency; its plants use darkened sprites).
 */
function crop(p: Paint, s: Slot, h: number, status: string, alive: boolean, shade = 0) {
  const { ctx, iso, poly } = p;
  const t = p.t();
  const { gx, gy } = s;
  poly([iso(gx + 0.1, gy + 0.1), iso(gx + 1.9, gy + 0.1), iso(gx + 1.9, gy + 1.9), iso(gx + 0.1, gy + 1.9)], p.ground('f_soil', gx, gy, 1.6) ?? (alive ? '#7a4a24' : '#8b6a48'));
  if (!alive) poly([iso(gx + 0.1, gy + 0.1), iso(gx + 1.9, gy + 0.1), iso(gx + 1.9, gy + 1.9), iso(gx + 0.1, gy + 1.9)], 'rgba(170,140,100,.45)');
  ctx.strokeStyle = 'rgba(60,30,10,.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const fy of [0.55, 1.0, 1.45]) { const a = iso(gx + 0.15, gy + fy), b = iso(gx + 1.85, gy + fy); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
  ctx.stroke();
  if (shade > 0) poly([iso(gx + 0.1, gy + 0.1), iso(gx + 1.9, gy + 0.1), iso(gx + 1.9, gy + 1.9), iso(gx + 0.1, gy + 1.9)], `rgba(${SHADE.farm.join(',')},${shade})`);
  const working = status === 'working';
  const speed = working ? 3.6 : 1.1, amp = working ? 4.5 : 1.6;
  const plant = s.agent.kind === 'omp' ? 'corn' : s.agent.kind === 'claude' ? 'sunflower' : 'wheat';
  if (plantArt(p, s, h, plant, alive, working)) return;
  const spots: [number, number][] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) spots.push([i, j]);
  spots.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  for (const [i, j] of spots) {
    const px = gx + 0.45 + i * 0.55, py = gy + 0.45 + j * 0.55;
    const hs = h * (0.8 + 0.2 * hash(s.seed, i, j));
    const base = iso(px, py, 0);
    const sway = Math.sin(t * speed + s.seed + i * 1.3 + j * 0.7) * amp * Math.min(1, hs / 80);
    const top = { x: base.x + sway, y: base.y - hs };
    const at = (f: number): Pt => ({ x: base.x + sway * f * f, y: base.y - hs * f });
    ctx.strokeStyle = alive ? STALK.alive : STALK.dead;
    ctx.lineWidth = 1.4 + Math.min(1.8, hs / 90);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.quadraticCurveTo(base.x + sway * 0.3, base.y - hs * 0.5, top.x, top.y); ctx.stroke();
    const leaves = Math.max(1, Math.floor(hs / 22));
    ctx.fillStyle = alive ? SPROUT : '#b08d57';
    for (let k = 1; k <= leaves; k++) {
      const q = at(k / (leaves + 1));
      const side = (k + i + j) % 2 ? 1 : -1;
      const len = 3 + Math.min(6, hs / 25);
      ctx.beginPath();
      ctx.ellipse(q.x + side * len * 0.8, q.y + (alive ? 0 : 3), len, 1.8, side * (alive ? -0.5 : 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    if (!alive || hs < 30) continue; // withered plots and seedlings carry no heads
    if (plant === 'corn') {
      const c = at(0.72);
      ctx.fillStyle = '#f2c94c';
      ctx.beginPath(); ctx.ellipse(c.x + 2.5, c.y, 2.4, 5.5, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6fbf3f';
      ctx.beginPath(); ctx.ellipse(c.x + 1.2, c.y + 2, 1.6, 5, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const a of [-0.6, 0, 0.6]) { ctx.moveTo(top.x, top.y); ctx.lineTo(top.x + Math.sin(a) * 5, top.y - Math.cos(a) * 5); }
      ctx.stroke();
    } else if (plant === 'sunflower') {
      const r = 3 + Math.min(4, hs / 40);
      ctx.fillStyle = '#f9c80e';
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + t * (working ? 0.6 : 0.1);
        ctx.beginPath(); ctx.ellipse(top.x + Math.cos(a) * r, top.y + Math.sin(a) * r * 0.8, r * 0.75, r * 0.35, a, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#6b3e1e';
      ctx.beginPath(); ctx.arc(top.x, top.y, r * 0.65, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#e3b23c';
      ctx.beginPath(); ctx.ellipse(top.x, top.y + 2, 2.2, 6, sway * 0.04, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#c99a2e'; ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) { ctx.moveTo(top.x, top.y - 2 + k * 3); ctx.lineTo(top.x + 3.5, top.y - 5 + k * 3); }
      ctx.stroke();
    }
  }
  ctx.lineCap = 'butt';
  if (working) sparkles(p, s, h);
}

/** Growth sparkles rising out of a busy plot. */
function sparkles(p: Paint, s: Slot, h: number) {
  const { ctx, iso } = p;
  const t = p.t();
  for (let k = 0; k < 4; k++) {
    const f = (t * 0.5 + k / 4 + s.seed) % 1;
    const q = iso(s.gx + 0.4 + k * 0.4, s.gy + 1, h * 0.6 + f * 44);
    ctx.fillStyle = `rgba(255,255,200,${1 - f})`;
    ctx.beginPath(); ctx.arc(q.x, q.y, 1.8, 0, Math.PI * 2); ctx.fill();
  }
}

const PLANTS: Record<string, string> = { corn: 'f_corn', sunflower: 'f_sunflower', wheat: 'f_wheat' };

/** The art version of a plot: four plants from the art set, scaled to `h`, rustling in the wind. */
function plantArt(p: Paint, s: Slot, h: number, plant: string, alive: boolean, working: boolean): boolean {
  const name = !alive ? 'f_withered' : h < 34 ? 'f_sprout' : PLANTS[plant];
  const img = sprite(name);
  if (!img) return false;
  const { ctx, iso } = p;
  const t = p.t();
  const ratio = aspect(name);
  const spots: [number, number][] = [[0.55, 0.55], [1.45, 0.55], [0.55, 1.45], [1.45, 1.45]];
  for (const [i, j] of spots) {
    const k = hash(s.seed, i * 3, j * 7);
    const hs = !alive ? Math.min(h, 70) * (0.8 + 0.2 * k) : h < 34 ? Math.max(14, h * 0.9) : h * (0.85 + 0.15 * k);
    // Tall crops grow taller, not fatter: the width is capped.
    const w = Math.min(hs * ratio, name === 'f_sprout' ? 22 : 44);
    const base = iso(s.gx + i, s.gy + j);
    const rot = Math.sin(t * (working ? 3.2 : 1.1) + s.seed + i * 2 + j) * (working ? 0.06 : 0.025);
    stand(ctx, img, base.x, base.y, hs, { w, rot, flip: k > 0.5 });
  }
  if (working) sparkles(p, s, h);
  return true;
}

/** A Buzz channel is a mailbox at the plot's corner: flag up while attached, blinking while pending, down when off. */
function mailbox(p: Paint, s: Slot, state: string | null) {
  if (!state) return;
  const { ctx, iso } = p;
  const img = sprite('f_mailbox', state === 'attached' || state === 'ok' || state === 'pending' ? undefined : 'gray');
  if (img) {
    const b = iso(s.gx + 1.85, s.gy + 0.2);
    ctx.save();
    if (state === 'pending') ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(p.t() * 4));
    stand(ctx, img, b.x, b.y, 30);
    ctx.restore();
    return;
  }
  const x = s.gx + 1.9, y = s.gy + 0.15;
  const b = iso(x, y, 0), top = iso(x, y, 12);
  ctx.strokeStyle = '#6b4322'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(top.x, top.y); ctx.stroke();
  p.box(x - 0.18, y - 0.1, 0.36, 0.2, 12, 6, '#5d7f99', '#4a6b85', '#3b566b');
  const attached = state === 'attached' || state === 'ok';
  const pending = state === 'pending';
  const up = attached || (pending && Math.sin(p.t() * 5) > 0);
  const f0 = iso(x + 0.18, y, 14);
  ctx.fillStyle = up ? '#e53935' : '#8a7f70';
  if (up) ctx.fillRect(f0.x, f0.y - 9, 4, 6);
  else ctx.fillRect(f0.x, f0.y - 1, 7, 2.5);
  ctx.fillRect(f0.x, f0.y - (up ? 9 : 1), 1.2, up ? 10 : 2.5);
}

const FARMER_H = 54;

/** A farmer in overalls and a straw hat, feet at (x, y); the shirt is the agent's kind colour. */
function farmer(p: Paint, x: number, y: number, o: UnitLook) {
  const { ctx } = p;
  const t = p.t();
  const img = sprite(`f_farmer_${['omp', 'claude', 'codex', 'pi'].includes(o.kind) ? o.kind : 'omp'}`, o.dead ? 'gray' : undefined);
  if (img) {
    // Working: rocking into each hoe stroke, kicking up dirt; blocked: hopping for attention.
    const rot = o.walking ? o.sway : o.working ? Math.sin(t * 7 + o.seed) * 0.08 : 0;
    const hop = o.blocked ? Math.abs(Math.sin(t * 6 + o.seed)) * 5 : 0;
    stand(ctx, img, x, y - hop, FARMER_H, { flip: o.flip, rot, sy: o.working ? 1 + Math.sin(t * 14 + o.seed) * 0.03 : 1 + Math.sin(t * 2 + o.seed) * 0.012 });
    if (o.working && Math.sin(t * 7 + o.seed) > 0.7) {
      ctx.fillStyle = 'rgba(120,80,40,.55)';
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(x + (o.flip ? -1 : 1) * (10 + k * 3), y - 2 - (k % 2) * 3, 1.4, 0, Math.PI * 2); ctx.fill(); }
    }
    return;
  }
  const denim = o.dead ? '#6f7680' : '#3a6ea5', denimD = o.dead ? '#575d66' : '#2c5482';
  const shirt = o.dead ? '#9a9a9a' : o.shirt.c, shirtD = o.dead ? '#7a7a7a' : o.shirt.d;
  const skin = '#f1c27d';
  ctx.fillStyle = '#5b3a1e';
  ctx.fillRect(x - 5.5, y - 3, 4.4, 3); ctx.fillRect(x + 1.1, y - 3, 4.4, 3);
  ctx.fillStyle = denim;
  ctx.fillRect(x - 5, y - 11, 3.6, 8); ctx.fillRect(x + 1.4, y - 11, 3.6, 8);
  ctx.fillStyle = shirt;
  ctx.beginPath(); ctx.roundRect(x - 7.5, y - 25, 15, 15, 4); ctx.fill();
  ctx.strokeStyle = rgba(shirtD, 0.6); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x - 7, y - 20); ctx.lineTo(x + 7, y - 20); ctx.moveTo(x - 7, y - 15); ctx.lineTo(x + 7, y - 15); ctx.stroke();
  ctx.fillStyle = denim;
  ctx.fillRect(x - 5, y - 20, 10, 10);
  ctx.strokeStyle = denimD; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(x - 4, y - 20); ctx.lineTo(x - 5.5, y - 25); ctx.moveTo(x + 4, y - 20); ctx.lineTo(x + 5.5, y - 25); ctx.stroke();
  ctx.fillStyle = shirt;
  ctx.fillRect(x - 10.5, y - 24, 3.4, 10);
  // The hoe: swung while working, leaning when not; none for a farmer who is not running.
  const swing = o.working ? Math.abs(Math.sin(t * 6 + o.seed)) * 7 : 0;
  ctx.fillRect(x + 7.1, y - 24 + swing * 0.3, 3.4, 10);
  if (!o.dead) {
    ctx.strokeStyle = '#8b5a2b'; ctx.lineWidth = 1.8;
    const hx = x + 9, hy = y - 15 + swing * 0.3;
    const ex = hx + 7, ey = hy + 13 - swing;
    ctx.beginPath(); ctx.moveTo(hx, hy - 8 + swing * 0.5); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.fillStyle = '#9aa5ad';
    ctx.beginPath(); ctx.moveTo(ex - 1, ey - 1); ctx.lineTo(ex + 4, ey + 1); ctx.lineTo(ex + 3, ey + 4); ctx.lineTo(ex - 2, ey + 2); ctx.closePath(); ctx.fill();
    if (o.working && swing > 5) {
      ctx.fillStyle = 'rgba(120,80,40,.7)';
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(ex + 2 + k * 2.5, ey + 4 - k * 2, 1.2, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(x, y - 31, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3b2a1a';
  ctx.beginPath(); ctx.arc(x - 2.2, y - 31, 0.9, 0, Math.PI * 2); ctx.arc(x + 2.2, y - 31, 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e9c46a';
  ctx.beginPath(); ctx.ellipse(x, y - 35, 10.5, 3.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#b8913a'; ctx.lineWidth = 0.8; ctx.stroke();
  ctx.fillStyle = '#f4d58d';
  ctx.beginPath(); ctx.roundRect(x - 5.5, y - 42, 11, 7, [4, 4, 1, 1]); ctx.fill();
  ctx.fillStyle = shirtD;
  ctx.fillRect(x - 5.5, y - 37.6, 11, 1.8);
}

/** A missing agent: rostr expects a farmer here, so a scarecrow stands in. */
function scarecrow(p: Paint, x: number, y: number, alpha: number) {
  const { ctx } = p;
  const img = sprite('f_scarecrow');
  if (img) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    stand(ctx, img, x, y, 56, { rot: Math.sin(p.t() * 1.2 + x) * 0.05 });
    ctx.restore();
    return;
  }
  const lean = Math.sin(p.t() * 1.2 + x) * 0.05;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.rotate(lean);
  ctx.strokeStyle = '#7a4f26'; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -38); ctx.moveTo(-13, -25); ctx.lineTo(13, -25); ctx.stroke();
  ctx.fillStyle = '#c8a165';
  ctx.beginPath(); ctx.moveTo(-9, -27); ctx.lineTo(9, -27); ctx.lineTo(7, -12); ctx.lineTo(4, -14); ctx.lineTo(1, -11); ctx.lineTo(-3, -14); ctx.lineTo(-7, -12); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e8c88a';
  ctx.beginPath(); ctx.moveTo(-13, -26); ctx.lineTo(-16, -22); ctx.lineTo(-11, -23); ctx.moveTo(13, -26); ctx.lineTo(16, -22); ctx.lineTo(11, -23); ctx.fill();
  ctx.fillStyle = '#d9b77e';
  ctx.beginPath(); ctx.arc(0, -32, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#5b3a1e'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-3, -34); ctx.lineTo(-1, -32); ctx.moveTo(-1, -34); ctx.lineTo(-3, -32); ctx.moveTo(1, -34); ctx.lineTo(3, -32); ctx.moveTo(3, -34); ctx.lineTo(1, -32); ctx.stroke();
  ctx.fillStyle = '#5b4636';
  ctx.beginPath(); ctx.ellipse(0, -36.5, 9, 2.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.roundRect(-4.5, -42, 9, 6, [3, 3, 0, 0]); ctx.fill();
  ctx.restore();
}

/** A coin in flight: live spend landing on a plot. */
function coin(p: Paint, x: number, y: number, r: number, alpha: number) {
  const { ctx } = p;
  const img = sprite('f_coin');
  if (img) {
    // A spinning coin: its width follows the cosine of its turn.
    const spin = Math.max(0.2, Math.abs(Math.cos(p.t() * 9 + x * 0.05)));
    ctx.save();
    ctx.globalAlpha = alpha;
    stand(ctx, img, x, y + r * 1.2, r * 2.4, { w: r * 2.4 * spin });
    ctx.restore();
    return;
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffd23f';
  ctx.strokeStyle = '#b8860b';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.beginPath(); ctx.ellipse(x - r * 0.35, y - r * 0.35, r * 0.3, r * 0.18, -0.6, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

/** Scenery on free ground: apple trees, hay bales, chickens pecking about, flower patches. */
function decor(p: Paint, d: Decor) {
  const { ctx, iso } = p;
  const t = p.t();
  const shadow = (q: Pt, rx: number) => {
    ctx.fillStyle = 'rgba(40,60,20,.25)';
    ctx.beginPath(); ctx.ellipse(q.x, q.y, rx, rx / 2.2, 0, 0, Math.PI * 2); ctx.fill();
  };
  if (d.r < 0.4) {
    const img = sprite('f_tree');
    const q = iso(d.x, d.y);
    shadow(q, 22);
    if (img) stand(ctx, img, q.x, q.y + 2, 70 + d.r * 30, { rot: Math.sin(t * 0.8 + d.r * 40) * 0.015 });
  } else if (d.r < 0.6) {
    const img = sprite('f_hay');
    const q = iso(d.x, d.y);
    shadow(q, 12);
    if (img) stand(ctx, img, q.x, q.y + 2, 22, { flip: d.r > 0.5 });
  } else if (d.r < 0.82) {
    // A chicken wandering a small circle, pecking now and then.
    const a = t * 0.35 + d.r * 50, b = t * 0.27 + d.r * 31;
    const q = iso(d.x + Math.sin(a) * 0.45, d.y + Math.cos(b) * 0.45);
    const vx = Math.cos(a) * 0.35 + Math.sin(b) * 0.27; // screen-x velocity, in tiles per second
    const pecking = Math.sin(t * 0.9 + d.r * 7) > 0.55;
    const img = sprite('f_chicken');
    shadow(q, 6);
    if (img) stand(ctx, img, q.x, q.y - (pecking ? 0 : Math.abs(Math.sin(t * 9 + d.r * 5)) * 1.2), 15, { flip: vx > 0, rot: pecking ? Math.sin(t * 12) * 0.15 - 0.2 : 0 });
  } else {
    const q = iso(d.x, d.y);
    for (let k = 0; k < 6; k++) {
      const fx = q.x + Math.cos(k * 2.1 + d.r * 9) * 8, fy = q.y + Math.sin(k * 1.7 + d.r * 5) * 4;
      ctx.fillStyle = k % 3 === 0 ? '#ff7eb6' : k % 3 === 1 ? '#fff6a8' : '#ffffff';
      ctx.beginPath(); ctx.arc(fx, fy - 1, 1.8, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/** How dark it is on the farm right now, from the viewer's clock: night 0–1, and the warm dusk glow 0–1. */
function daylight(now = new Date()): { night: number; dusk: number } {
  const h = now.getHours() + now.getMinutes() / 60;
  const ramp = (a: number, b: number, x: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  const night = h < 12 ? 1 - ramp(5, 7, h) : ramp(19, 21.5, h);
  const dusk = Math.max(0, 1 - Math.abs(h - 19.3) / 1.6) + 0.6 * Math.max(0, 1 - Math.abs(h - 6.3) / 1.2);
  return { night, dusk: Math.min(1, dusk) };
}

/**
 * Sky over the farm, in world space: birds by day; after sunset a blue tint over everything, the
 * barns' windows glowing and fireflies over the plots.
 */
function sky(p: Paint, bounds: { x0: number; y0: number; x1: number; y1: number }, barns: Pt[], plots: Pt[]) {
  const { ctx, iso } = p;
  const t = p.t();
  const { night, dusk } = daylight();
  if (night < 0.6) {
    // Two small flocks crossing the map, wings beating.
    ctx.strokeStyle = 'rgba(40,40,40,.7)';
    ctx.lineWidth = 1.4;
    for (let f = 0; f < 2; f++) {
      const span = bounds.x1 - bounds.x0 + 400;
      const fx = bounds.x0 - 200 + ((t * (22 + f * 9) + f * 500) % span);
      const fy = bounds.y0 + 60 + f * 90 + Math.sin(t * 0.4 + f) * 20;
      for (let k = 0; k < 4; k++) {
        const bx = fx - k * 14 - (k % 2) * 6, by = fy + k * 7, w = Math.sin(t * 8 + k + f) * 3;
        ctx.beginPath(); ctx.moveTo(bx - 5, by - 2 - w); ctx.lineTo(bx, by); ctx.lineTo(bx + 5, by - 2 - w); ctx.stroke();
      }
    }
  }
  if (dusk > 0) {
    ctx.fillStyle = `rgba(255,130,50,${0.12 * dusk})`;
    ctx.fillRect(-1e5, -1e5, 2e5, 2e5);
  }
  if (night <= 0) return;
  ctx.fillStyle = `rgba(16,24,70,${0.38 * night})`;
  ctx.fillRect(-1e5, -1e5, 2e5, 2e5);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of barns) {
    const g = ctx.createRadialGradient(b.x - 6, b.y - 60, 0, b.x - 6, b.y - 60, 60);
    g.addColorStop(0, `rgba(255,200,90,${0.35 * night})`);
    g.addColorStop(1, 'rgba(255,200,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(b.x - 70, b.y - 120, 130, 130);
  }
  plots.forEach((q, i) => {
    for (let k = 0; k < 2; k++) {
      const a = t * (0.5 + k * 0.2) + i * 2.3 + k * 4;
      const f = iso(q.x + Math.sin(a) * 1.1, q.y + Math.cos(a * 1.3) * 1.1, 14 + Math.sin(a * 2.1) * 8);
      const on = 0.5 + 0.5 * Math.sin(t * 3 + i + k * 2);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 7);
      g.addColorStop(0, `rgba(220,255,120,${0.9 * on * night})`);
      g.addColorStop(1, 'rgba(220,255,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(f.x - 7, f.y - 7, 14, 14);
    }
  });
  ctx.restore();
}

/** Column layout: a plank bridge between a computer's stacked slabs. */
function bridge(p: Paint, a: Pt, b: Pt) {
  const { ctx, iso, poly } = p;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * 0.4, py = (dx / len) * 0.4;
  const deck = [iso(a.x + px, a.y + py), iso(b.x + px, b.y + py), iso(b.x - px, b.y - py), iso(a.x - px, a.y - py)];
  const steps = Math.max(2, Math.round(len / 0.35));
  poly(deck, '#b07a43');
  ctx.strokeStyle = 'rgba(90,55,25,.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 1; k < steps; k++) {
    const t = k / steps, l = iso(a.x + dx * t + px, a.y + dy * t + py), r = iso(a.x + dx * t - px, a.y + dy * t - py);
    ctx.moveTo(l.x, l.y); ctx.lineTo(r.x, r.y);
  }
  ctx.stroke();
  ctx.strokeStyle = '#6b4322';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(deck[0].x, deck[0].y - 6); ctx.lineTo(deck[1].x, deck[1].y - 6);
  ctx.moveTo(deck[3].x, deck[3].y - 6); ctx.lineTo(deck[2].x, deck[2].y - 6); ctx.stroke();
}

/** A working farmer carries a sheaf of its crop to the barn. */
function carry(p: Paint, s: Slot, x: number, y: number, flip: boolean) {
  const kind = s.agent.kind;
  const img = sprite(kind === 'omp' ? 'f_corn' : kind === 'claude' ? 'f_sunflower' : 'f_wheat');
  if (img) stand(p.ctx, img, x, y + 9, 20, { rot: flip ? 0.5 : -0.5 });
}

export const painter: Painter = {
  sprites: ['f_barn', 'f_corn', 'f_sunflower', 'f_wheat', 'f_sprout', 'f_withered', 'f_tree', 'f_hay', 'f_chicken', 'f_mailbox',
    'f_coin', 'f_grass', 'f_soil', 'f_scarecrow', 'f_farmer_omp', 'f_farmer_claude', 'f_farmer_codex', 'f_farmer_pi'],
  font: '"Fredoka", "IBM Plex Sans", sans-serif',
  unitH: FARMER_H, unitW: 40,
  unitArt: (kind) => `f_farmer_${['omp', 'claude', 'codex', 'pi'].includes(kind) ? kind : 'omp'}`,
  link: { color: '#fff1c4', dash: [5, 4], lift: 0.5 },
  background, slab, bridge, field, team, core: barn, place: crop, placeShape: cropShape, buzz: mailbox, unit: farmer, carry, standIn: scarecrow, coin, decor, sky,
};
