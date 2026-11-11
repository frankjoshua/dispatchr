import { rgba } from './format';
import type { Painter, Paint, Pt, UnitLook } from './painters';
import { SHADE, aspect, sprite, stand } from './sprites';
import type { Decor, District, Island, Rect, Slot, TeamBlock } from './world';
import { boxOutline, columnOutline, type Iso } from './shapes';
import { CHARACTERS, characterIdFor } from './inference';

// The cubicles theme's painter: each computer an office floor (one storey of a building, carpet on
// top, a window band round its edge), each space a department, each team a pod behind a low
// partition, each agent a cubicle whose pile of paperwork on the desk (the Stack) is as tall as its
// current run has been working, worked by an office worker. The base is the print-and-coffee
// corner. map.ts owns the camera, layout, labels and effects and calls these for the parts that
// look different.

const SLAB = 40;
export const EFFORT_ART = [0, 1, 2, 3].map((tier) => `c_effort_${tier}`);
export const WORKER_ART = Object.fromEntries(CHARACTERS.map(({ id: kind }) => [kind, {
  rest: `c_worker_${kind}`, wave: `c_wave_${kind}`,
  desk: [0, 1, 2, 3].map((tier) => `c_pose_${kind}_desk_${tier}`),
  walk: [0, 1, 2, 3].map((tier) => `c_pose_${kind}_walk_${tier}`),
}]));
const hash = (a: number, b: number, c: number) => { const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return x - Math.floor(x); };

let lobby: CanvasPattern | null = null;

/** The lobby floor round the office floors: big two-tone stone tiles in the isometric grid, made once. */
function lobbyPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (lobby) return lobby;
  const c = document.createElement('canvas');
  c.width = 192; c.height = 96;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#a9b3be';
  g.fillRect(0, 0, 192, 96);
  g.fillStyle = '#b8c0c9';
  g.beginPath(); g.moveTo(96, 0); g.lineTo(192, 48); g.lineTo(96, 96); g.lineTo(0, 48); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(80,95,115,.3)';
  g.lineWidth = 1.5;
  g.stroke();
  lobby = ctx.createPattern(c, 'repeat');
  return lobby;
}

function background(p: Paint, W: number, H: number, camX: number, camY: number) {
  const { ctx } = p;
  // The lobby floor drifts slowly with the camera; lighter towards the top, like a lit hall.
  const pat = lobbyPattern(ctx);
  const ox = ((-camX * 0.06) % 192 + 192) % 192, oy = ((-camY * 0.06) % 96 + 96) % 96;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = pat ?? '#b3bcc6';
  ctx.fillRect(-ox, -oy, W, H);
  ctx.restore();
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(240,246,252,.3)');
  g.addColorStop(1, 'rgba(40,55,75,.18)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

const CARPET: Record<string, string> = { online: '#cdbfa6', stale: '#d6c79a', offline: '#b9b3a8' };

/** An office floor: carpet on top, the storey's edge (slab, window band) on the sides. */
function slab(p: Paint, r: Rect, state: string) {
  const { ctx, iso, poly } = p;
  const A = iso(r.x0, r.y0), B = iso(r.x1, r.y0), C = iso(r.x1, r.y1), D = iso(r.x0, r.y1);
  const dn = (q: Pt, d: number) => ({ x: q.x, y: q.y + d });
  const grad = (y0: number, y1: number, a: string, b: string) => { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
  const up = state === 'online';
  // A tight drop shadow on the lobby floor, down and to the right (light from the top-left).
  const o = (q: Pt) => ({ x: q.x + 16, y: q.y + SLAB + 12 });
  poly([dn(D, SLAB), dn(C, SLAB), dn(B, SLAB), o(B), o(C), o(D)], 'rgba(70,58,40,.16)');
  // Concrete edge, then a band of windows, then the ceiling of the storey below.
  poly([D, C, dn(C, SLAB), dn(D, SLAB)], '#ece7dc');
  poly([C, B, dn(B, SLAB), dn(C, SLAB)], '#cfc8ba');
  const glassL = up ? grad(D.y + 9, C.y + 33, '#a9d4f0', '#5d93c4') : state === 'stale' ? grad(D.y + 9, C.y + 33, '#d8c890', '#a08a52') : '#7d8590';
  const glassR = up ? grad(B.y + 9, C.y + 33, '#86b6dc', '#43739f') : state === 'stale' ? grad(B.y + 9, C.y + 33, '#c2b27a', '#8a7444') : '#69707a';
  poly([dn(D, 9), dn(C, 9), dn(C, 33), dn(D, 33)], glassL);
  poly([dn(C, 9), dn(B, 9), dn(B, 33), dn(C, 33)], glassR);
  // Mullions every tile, and a sill line.
  ctx.strokeStyle = 'rgba(70,80,95,.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let x = Math.ceil(r.x0); x < r.x1; x++) { const q = iso(x, r.y1); ctx.moveTo(q.x, q.y + 9); ctx.lineTo(q.x, q.y + 33); }
  for (let y = Math.ceil(r.y0); y < r.y1; y++) { const q = iso(r.x1, y); ctx.moveTo(q.x, q.y + 9); ctx.lineTo(q.x, q.y + 33); }
  ctx.moveTo(D.x, D.y + 33); ctx.lineTo(C.x, C.y + 33); ctx.lineTo(B.x, B.y + 33);
  ctx.stroke();
  if (up) {
    // Sky reflected in the glass: two pale diagonal streaks on the front face.
    const fL = (u: number, z: number) => ({ x: D.x + (C.x - D.x) * u, y: D.y + (C.y - D.y) * u + z });
    poly([fL(0.18, 9), fL(0.26, 9), fL(0.2, 33), fL(0.12, 33)], 'rgba(255,255,255,.22)');
    poly([fL(0.62, 9), fL(0.66, 9), fL(0.6, 33), fL(0.56, 33)], 'rgba(255,255,255,.16)');
  }
  poly([A, B, C, D], p.ground('c_carpet', r.x0, r.y0, 4) ?? (CARPET[state] ?? CARPET.offline));
  if (state !== 'online') poly([A, B, C, D], state === 'stale' ? 'rgba(220,190,90,.3)' : 'rgba(150,150,155,.5)');
  // Carpet-tile seams every two tiles.
  ctx.strokeStyle = 'rgba(110,90,60,.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.ceil(r.x0 / 2) * 2; x < r.x1; x += 2) { const a = iso(x, r.y0), b = iso(x, r.y1); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
  for (let y = Math.ceil(r.y0 / 2) * 2; y < r.y1; y += 2) { const a = iso(r.x0, y), b = iso(r.x1, y); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
  ctx.stroke();
  // A skirting rail round the edge.
  ctx.strokeStyle = '#fbf7ee';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(C.x, C.y); ctx.lineTo(D.x, D.y); ctx.closePath(); ctx.stroke();
}

/** A department: its carpet tinted, a border inlay in the department's colour and a standing sign. */
function field(p: Paint, d: District) {
  const { ctx, iso, poly } = p;
  poly([iso(d.x0, d.y0), iso(d.x1, d.y0), iso(d.x1, d.y1), iso(d.x0, d.y1)], rgba(d.color, 0.08));
  const inset = 0.18;
  const ring = [iso(d.x0 + inset, d.y0 + inset), iso(d.x1 - inset, d.y0 + inset), iso(d.x1 - inset, d.y1 - inset), iso(d.x0 + inset, d.y1 - inset)];
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(d.color, 0.6);
  ctx.lineWidth = 4;
  ctx.beginPath(); ring.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,252,242,.7)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.lineJoin = 'miter';
  // The sign, under the department's name: a white board on a steel post, a colour band along its foot.
  const sx = d.x0 + 0.35, sy = d.y0 + 0.35;
  const s0 = iso(sx + 0.2, sy, 0), s1 = iso(sx + 0.2, sy, 12);
  ctx.strokeStyle = '#7d8794'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
  poly([iso(sx, sy, 11), iso(sx + 2.6, sy, 11), iso(sx + 2.6, sy, 23), iso(sx, sy, 23)], '#42536a');
  poly([iso(sx, sy, 11), iso(sx + 2.6, sy, 11), iso(sx + 2.6, sy, 14), iso(sx, sy, 14)], rgba(d.color, 0.95));
}

/** A team: a pod behind a low fabric partition, its nameplate in the manager's colour. */
function team(p: Paint, t: TeamBlock, color: string) {
  const { ctx, iso, poly } = p;
  poly([iso(t.x0, t.y0), iso(t.x1, t.y0), iso(t.x1, t.y1), iso(t.x0, t.y1)], 'rgba(255,250,236,.16)');
  const Z = 6;
  const wall = (x0: number, y0: number, x1: number, y1: number, fill: string) => poly([iso(x0, y0), iso(x1, y1), iso(x1, y1, Z), iso(x0, y0, Z)], fill);
  wall(t.x0, t.y0, t.x1, t.y0, '#8ea3be');
  wall(t.x0, t.y0, t.x0, t.y1, '#a7b8cf');
  wall(t.x0, t.y1, t.x1, t.y1, '#a7b8cf');
  wall(t.x1, t.y0, t.x1, t.y1, '#8ea3be');
  const cap = [iso(t.x0, t.y0, Z), iso(t.x1, t.y0, Z), iso(t.x1, t.y1, Z), iso(t.x0, t.y1, Z)];
  ctx.strokeStyle = '#e9edf2';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); cap.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.stroke();
  const sx = t.x0 + 0.3, sy = t.y0 + 0.3;
  const s0 = iso(sx + 0.15, sy, 0), s1 = iso(sx + 0.15, sy, 9);
  ctx.strokeStyle = '#7d8794'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke();
  poly([iso(sx, sy, 9), iso(sx + 1.8, sy, 9), iso(sx + 1.8, sy, 16), iso(sx, sy, 16)], '#4a5b72');
  poly([iso(sx, sy, 9), iso(sx + 1.8, sy, 9), iso(sx + 1.8, sy, 11), iso(sx, sy, 11)], rgba(color, 0.95));
}

const CORE_H = 92;

/** A computer: the print-and-coffee corner; the copier's status light blinks and a page slides out on each heartbeat. */
function copier(p: Paint, i: Island, blink: number) {
  const { ctx, iso } = p;
  const { x, y } = i.core;
  const up = i.node?.state === 'online';
  const art = sprite('c_copier', up ? undefined : 'gray');
  const b = iso(x, y);
  ctx.fillStyle = 'rgba(60,50,35,.22)';
  ctx.beginPath(); ctx.ellipse(b.x, b.y + 4, 66, 24, 0, 0, Math.PI * 2); ctx.fill();
  if (art) {
    const h = CORE_H, w = h * aspect('c_copier'), x0 = b.x - w / 2, y0 = b.y + 14 - h;
    stand(ctx, art, b.x, b.y + 14, h);
    if (!up) return;
    // A fresh page sliding out onto the output tray, then the status light.
    if (blink > 0.02) {
      const u = 1 - blink, px = x0 + 0.15 * w - u * 6, py = y0 + 0.43 * h + u * 3;
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, blink * 2)})`;
      ctx.strokeStyle = `rgba(90,100,115,${Math.min(1, blink * 2)})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(px - 9, py); ctx.lineTo(px + 1, py - 5); ctx.lineTo(px + 10, py); ctx.lineTo(px, py + 5); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = blink > 0.3 ? '#b6ff7a' : '#3fbf4a';
    ctx.beginPath(); ctx.arc(x0 + 0.318 * w, y0 + 0.366 * h, 1.4 + blink * 1.4, 0, Math.PI * 2); ctx.fill();
    return;
  }
  p.box(x - 0.9, y - 0.5, 1.8, 1, 0, 26, up ? '#eceff2' : '#9a9a9a', up ? '#d3d8de' : '#888', up ? '#b9c0c8' : '#777', 'rgba(255,255,255,.7)');
  const l = iso(x - 0.4, y + 0.5, 20);
  ctx.fillStyle = up ? `rgba(80,220,90,${0.5 + 0.5 * blink})` : 'rgba(80,80,80,.6)';
  ctx.beginPath(); ctx.arc(l.x, l.y, 2.5, 0, Math.PI * 2); ctx.fill();
}

const WALL_W = 134, WALL_H = 80;
const DESK_H = 74;
/** How high the desk top is over the floor, at DESK_H. */
const DESK_TOP = 22;
const STACK_W = 26;
const STACKS = ['c_stack_paper', 'c_stack_folders', 'c_stack_binders', 'c_stack_box'];

/**
 * An agent's cubicle: two fabric partitions, a desk, and on the desk a pile of paperwork as tall as
 * `h` (how long its current run has been working: the Stack), stacked from boxes, reams, folders and
 * binders: taller, never wider. Working piles wobble and shed pages; blocked cubicles flash red and
 * raise a flag; done ones are tidy with a green tray; missing ones fade; other stopped ones go grey.
 * `shade` (0–1): how far a quiet agent goes toward SHADE.cubicles; sprites arrive already darkened,
 * the shapes here are shaded to match.
 */
function cubicle(p: Paint, s: Slot, h: number, status: string, alive: boolean, shade: number) {
  const { ctx, iso, poly } = p;
  const t = p.t();
  const { gx, gy } = s;
  const working = status === 'working', blocked = status === 'blocked', done = status === 'done';
  // Missing: the cubicle drawn faded (nobody there); other stopped states: the grey variant, full strength.
  const missing = status === 'missing', gray = !alive && !missing;
  const floor = [iso(gx + 0.05, gy + 0.05), iso(gx + 1.95, gy + 0.05), iso(gx + 1.95, gy + 1.95), iso(gx + 0.05, gy + 1.95)];
  poly(floor, p.ground('c_tile', gx, gy, 1) ?? '#6f7f94');
  if (!alive) poly(floor, 'rgba(150,150,150,.4)');
  if (shade > 0) poly(floor, `rgba(${SHADE.cubicles.join(',')},${shade})`);
  // White details (steam, flying pages) mixed toward the shade colour like the sprites.
  const white = `${SHADE.cubicles.map((v) => Math.round(255 + (v - 255) * shade)).join(',')}`;
  // Blocked: the floor flashes red and a warning light on the corner post sweeps two beams round it.
  const beam = t * 3.2 + s.seed;
  if (blocked) {
    poly(floor, `rgba(255,78,52,${0.72 + 0.2 * Math.sin(t * 7)})`);
    const c = iso(gx + 1, gy + 1), R = 2.8, half = 0.3;
    ctx.fillStyle = 'rgba(255,60,35,.24)';
    ctx.beginPath();
    for (const a of [beam, beam + Math.PI]) {
      const l = iso(gx + 1 + R * Math.cos(a - half), gy + 1 + R * Math.sin(a - half));
      const r = iso(gx + 1 + R * Math.cos(a + half), gy + 1 + R * Math.sin(a + half));
      ctx.moveTo(c.x, c.y); ctx.lineTo(l.x, l.y); ctx.lineTo(r.x, r.y); ctx.closePath();
    }
    ctx.fill();
  }
  const top = iso(gx, gy);
  ctx.save();
  if (missing) ctx.globalAlpha *= 0.45;
  const walls = sprite('c_cubicle', gray ? 'gray' : undefined);
  if (walls) stand(ctx, walls, top.x, top.y + 32 + 2, WALL_H, { w: WALL_W });
  else {
    p.box(gx, gy, 2, 0.12, 0, 44, '#e6e1d6', '#7f97b8', '#6a82a3');
    p.box(gx, gy, 0.12, 2, 0, 44, '#e6e1d6', '#7f97b8', '#6a82a3');
  }
  const deskAt = iso(gx + 1.1, gy + 1.05);
  const desk = sprite('c_desk', gray ? 'gray' : undefined);
  if (desk) stand(ctx, desk, deskAt.x, deskAt.y + 6, DESK_H);
  else p.box(gx + 0.3, gy + 0.3, 1.5, 0.7, 0, 18, '#d9b47c', '#b8915c', '#a07c4a');
  const pile = iso(gx + 0.62, gy + 0.62);
  paperwork(p, s, pile.x, pile.y - DESK_TOP + 3, Math.max(8, h - DESK_TOP), gray, working, done, white);
  const effort = sprite(EFFORT_ART[s.effort], gray ? 'gray' : undefined);
  if (effort) stand(ctx, effort, deskAt.x + 29, deskAt.y - DESK_TOP + 6, 32);
  ctx.restore();
  if (done) {
    const tray = sprite('c_tray');
    const q = iso(gx + 1.45, gy + 0.75);
    if (tray) stand(ctx, tray, q.x, q.y - DESK_TOP + 6, 14);
  }
  if (status === 'idle' && desk) {
    // A coffee break: steam curling off the mug on the desk (the mug sits at 82% across, 45% down the desk art).
    const w = DESK_H * aspect('c_desk'), mx = deskAt.x - w / 2 + 0.82 * w, my = deskAt.y + 6 - DESK_H + 0.42 * DESK_H;
    ctx.lineWidth = 1.9;
    ctx.lineCap = 'round';
    for (let k = 0; k < 2; k++) {
      const f = (t * 0.5 + k / 2 + s.seed * 0.1) % 1;
      ctx.strokeStyle = `rgba(${white},${0.8 * Math.sin(f * Math.PI)})`;
      ctx.beginPath();
      for (let j = 0; j <= 4; j++) {
        const yy = my - 2 - f * 6 - j * 3.2, xx = mx + (k - 0.5) * 3 + Math.sin(j * 1.3 + t * 2 + k) * 1.8;
        if (j) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy);
      }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
  if (blocked) {
    // A red flag on the back post, waving hard, and the warning light on the front-right post. Zoomed
    // out (a phone's fitted view) both keep their size on screen, so blocked is what you see first.
    const zoom = ctx.getTransform().a / Math.min(2, window.devicePixelRatio || 1);
    const k = Math.max(1, 0.8 / zoom);
    const flag = sprite('c_flag');
    if (flag) stand(ctx, flag, top.x + 3, top.y + 36 - WALL_H, 40 * k, { rot: Math.sin(t * 9 + s.seed) * 0.2 });
    const post = iso(gx + 2, gy);
    const lx = post.x - 3, ly = post.y - 42;
    ctx.fillStyle = '#5d6672';
    ctx.fillRect(lx - 5 * k, ly - 1, 10 * k, 3 * k);
    ctx.fillStyle = Math.cos(beam * 2) > 0 ? '#ff3b26' : '#b8221a';
    ctx.beginPath(); ctx.arc(lx, ly, 4.5 * k, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.beginPath(); ctx.arc(lx - 1.5 * k, ly - 2 * k, 1.3 * k, 0, Math.PI * 2); ctx.fill();
  }
}

/** A cubicle up to its partitions' top, and its pile (with room for its lean and sway). */
function cubicleShape(iso: Iso, s: Slot, h: number): Pt[][] {
  const pile = iso(s.gx + 0.62, s.gy + 0.62);
  return [boxOutline(iso, s.gx, s.gy, 2, 2, WALL_H - 34), columnOutline({ x: pile.x, y: pile.y - DESK_TOP + 3 }, STACK_W + 12, Math.max(8, h - DESK_TOP) + 4)];
}

/** The pile of paperwork on the desk, its foot at (x, y), `h` px tall; `gray` for a stopped agent, `white` the pages' r,g,b. */
function paperwork(p: Paint, s: Slot, x: number, y: number, h: number, gray: boolean, working: boolean, done: boolean, white: string) {
  const { ctx } = p;
  const t = p.t();
  const first = sprite(STACKS[0]);
  if (!first) {
    ctx.fillStyle = gray ? '#b5b5b5' : '#f4f1ea';
    ctx.fillRect(x - 9, y - h, 18, h);
    ctx.strokeStyle = 'rgba(90,90,100,.5)'; ctx.lineWidth = 1; ctx.strokeRect(x - 9, y - h, 18, h);
    return;
  }
  const W = STACK_W, side = W * 0.49, cap = W * 0.5;
  // Small piles: one block, shrunk whole. Tall ones: whole blocks, squeezed a little so the top lands at h.
  const n = Math.max(1, Math.round((h - cap) / side));
  const fit = n === 1 ? 1 : Math.max(0.78, Math.min(1.25, (h - cap) / (n * side)));
  const w = n === 1 ? Math.max(14, Math.min(W, (W * h) / (side + cap))) : W;
  let by = y;
  let lean = 0;
  for (let k = 0; k < n; k++) {
    const name = STACKS[Math.floor(hash(s.seed, k, 3) * STACKS.length)];
    const img = sprite(name, gray ? 'gray' : undefined);
    if (!img) continue;
    const mh = (w / aspect(name)) * fit;
    // Messy unless done; working piles sway more the higher they go.
    if (!done) lean += (hash(s.seed, k, 1) - 0.5) * 2.4;
    const sway = working ? Math.sin(t * 3.4 + s.seed) * k * 0.35 : 0;
    // Plain drawImage, no save/restore: a tall pile is a dozen blocks.
    ctx.drawImage(img, x + lean + sway - w / 2, by - mh, w, mh);
    by -= mh - w * 0.5 * fit;
  }
  if (!working) return;
  // Pages blowing off the top.
  const topY = by - w * 0.3;
  for (let k = 0; k < 3; k++) {
    const f = (t * 0.7 + k / 3 + s.seed * 0.13) % 1;
    const px = x + lean + (k - 1) * 4 + Math.sin(f * 6 + k) * 6 + f * 18 * (k % 2 ? 1 : -1);
    const py = topY - f * 26 + f * f * 30;
    ctx.save();
    ctx.globalAlpha = 1 - f;
    ctx.translate(px, py);
    ctx.rotate(Math.sin(t * 5 + k * 2) * 0.9);
    ctx.fillStyle = `rgb(${white})`;
    ctx.strokeStyle = 'rgba(80,90,105,.8)';
    ctx.lineWidth = 0.6;
    ctx.fillRect(-3, -4, 6, 8); ctx.strokeRect(-3, -4, 6, 8);
    ctx.restore();
  }
}

/** A Buzz channel is the desk phone: bright while attached, ringing (shaking) while pending, grey when off. */
function phone(p: Paint, s: Slot, state: string | null) {
  if (!state) return;
  const { ctx, iso } = p;
  const t = p.t();
  const live = state === 'attached' || state === 'ok' || state === 'pending';
  const ringing = state === 'pending' && Math.sin(t * 3) > 0;
  const q = iso(s.gx + 1.62, s.gy + 0.3);
  const y = q.y - DESK_TOP + 4;
  const img = sprite('c_phone', live ? undefined : 'gray');
  if (img) stand(ctx, img, q.x, y, 13, { rot: ringing ? Math.sin(t * 45) * 0.14 : 0 });
  else {
    ctx.fillStyle = live ? '#e8dcc0' : '#9a9a9a';
    ctx.fillRect(q.x - 6, y - 7, 12, 7);
  }
  if (!ringing) return;
  ctx.strokeStyle = '#d17a00';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (const r of [9, 13]) { ctx.moveTo(q.x - r * 0.7, y - 7 - r * 0.7); ctx.arc(q.x, y - 7, r, -Math.PI * 0.75, -Math.PI * 0.25); }
  ctx.stroke();
}

const WORKER_H = 54;
/** The waving sprites have arms over the head: drawn taller so the body matches the standing one. */
const WAVE_H = 58;

/** An office worker, feet at (x, y), in the viewer's selected character graphic. */
function worker(p: Paint, x: number, y: number, o: UnitLook) {
  const { ctx } = p;
  const t = p.t();
  const names = WORKER_ART[characterIdFor(o.cast)];
  const wave = o.blocked && !o.dead ? sprite(names.wave) : null;
  const posed = !o.dead && !o.blocked && (o.working || o.walking);
  const name = posed ? (o.walking ? names.walk : names.desk)[o.effort] : names.rest;
  const img = wave ?? sprite(name, o.dead ? 'gray' : undefined) ?? sprite(names.rest, o.dead ? 'gray' : undefined);
  if (img) {
    // Blocked: jumping and waving both arms; working: a brisk bounce over the keys; otherwise breathing.
    const hop = o.blocked ? Math.abs(Math.sin(t * 7 + o.seed)) * 7 : 0;
    const rot = o.walking ? o.sway : o.blocked ? Math.sin(t * 10 + o.seed) * 0.07 : o.working ? Math.sin(t * 8 + o.seed) * 0.05 : 0;
    const sy = o.working ? 1 + Math.sin(t * 16 + o.seed) * 0.03 : 1 + Math.sin(t * 2 + o.seed) * 0.012;
    stand(ctx, img, x, y - hop, wave ? WAVE_H : WORKER_H, { flip: o.flip, rot, sy });
    if (o.working) {
      // Pages flicking out of their hands.
      for (let n = 0; n < 2; n++) {
        const f = (t * 1.3 + n / 2 + o.seed) % 1;
        const px = x + (o.flip ? -1 : 1) * (8 + f * 14), py = y - 30 - f * 16;
        ctx.save();
        ctx.globalAlpha = 1 - f;
        ctx.translate(px, py);
        ctx.rotate(f * 4 + n);
        ctx.fillStyle = '#ffffff'; ctx.strokeStyle = 'rgba(80,90,105,.8)'; ctx.lineWidth = 0.6;
        ctx.fillRect(-2.5, -3.5, 5, 7); ctx.strokeRect(-2.5, -3.5, 5, 7);
        ctx.restore();
      }
    }
    return;
  }
  const shirt = o.dead ? '#9a9a9a' : o.shirt.c, shirtD = o.dead ? '#7a7a7a' : o.shirt.d;
  ctx.fillStyle = '#2f2f36';
  ctx.fillRect(x - 5.5, y - 3, 4.4, 3); ctx.fillRect(x + 1.1, y - 3, 4.4, 3);
  ctx.fillStyle = '#5b6270';
  ctx.fillRect(x - 5, y - 13, 3.6, 10); ctx.fillRect(x + 1.4, y - 13, 3.6, 10);
  ctx.fillStyle = shirt;
  ctx.beginPath(); ctx.roundRect(x - 7.5, y - 27, 15, 15, 4); ctx.fill();
  ctx.fillRect(x - 10.5, y - 26, 3.4, 10); ctx.fillRect(x + 7.1, y - 26, 3.4, 10);
  ctx.fillStyle = shirtD;
  ctx.fillRect(x - 1, y - 26, 2, 10);
  ctx.fillStyle = '#f1c27d';
  ctx.beginPath(); ctx.arc(x, y - 33, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5b3a1e';
  ctx.beginPath(); ctx.arc(x, y - 35, 6, Math.PI, 0); ctx.fill();
}

/** A missing agent: rostr expects someone here, so an empty chair with their jacket on it stands in. */
function emptyChair(p: Paint, x: number, y: number, alpha: number) {
  const { ctx } = p;
  const img = sprite('c_chair_jacket');
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (img) stand(ctx, img, x, y + 2, 38, { rot: Math.sin(p.t() * 0.9 + x) * 0.04, flip: Math.sin(p.t() * 0.25 + x) > 0.6 });
  else {
    ctx.fillStyle = '#3a3a40';
    ctx.fillRect(x - 8, y - 16, 16, 4);
    ctx.fillRect(x - 7, y - 32, 14, 16);
    ctx.fillRect(x - 1, y - 12, 2, 10);
    ctx.fillStyle = '#80838c';
    ctx.fillRect(x - 9, y - 33, 6, 18);
  }
  ctx.restore();
}

/** A banknote in flight: live spend landing on a cubicle. */
function cash(p: Paint, x: number, y: number, r: number, alpha: number) {
  const { ctx } = p;
  const img = sprite('c_cash');
  ctx.save();
  ctx.globalAlpha = alpha;
  if (img) {
    // Fluttering: the note turns over, its width following the cosine of the turn.
    const spin = Math.max(0.25, Math.abs(Math.cos(p.t() * 7 + x * 0.05)));
    stand(ctx, img, x, y + r * 1.1, r * 2.2, { w: r * 2.8 * spin, rot: Math.sin(p.t() * 4 + y * 0.1) * 0.3 });
  } else {
    ctx.fillStyle = '#7cc46a';
    ctx.strokeStyle = '#2f7a2a';
    ctx.lineWidth = 1;
    ctx.fillRect(x - r * 1.3, y - r * 0.7, r * 2.6, r * 1.4);
    ctx.strokeRect(x - r * 1.3, y - r * 0.7, r * 2.6, r * 1.4);
  }
  ctx.restore();
}

/** Scenery on free ground: fig plants, water coolers, a vending machine, the office cat, bins and coat stands. */
function decor(p: Paint, d: Decor) {
  const { ctx, iso } = p;
  const t = p.t();
  const shadow = (q: Pt, rx: number) => {
    ctx.fillStyle = 'rgba(60,50,35,.22)';
    ctx.beginPath(); ctx.ellipse(q.x, q.y, rx, rx / 2.2, 0, 0, Math.PI * 2); ctx.fill();
  };
  const q = iso(d.x, d.y);
  const put = (name: string, h: number, rx: number, flip = false) => {
    shadow(q, rx);
    const img = sprite(name);
    if (img) stand(ctx, img, q.x, q.y + 2, h, { flip });
  };
  if (d.r < 0.3) put('c_plant', 44 + d.r * 20, 12, d.r > 0.15);
  else if (d.r < 0.42) put('c_cooler', 38, 9, d.r > 0.36);
  else if (d.r < 0.52) put('c_vending', 54, 15, d.r > 0.47);
  else if (d.r < 0.7) {
    // The office cat, padding round a small loop and sitting down now and then.
    const sit = Math.sin(t * 0.3 + d.r * 9) > 0.5;
    const a = sit ? 0 : t * 0.4 + d.r * 50;
    const c = iso(d.x + Math.sin(a) * 0.6, d.y + Math.cos(a * 0.8) * 0.5);
    const vx = Math.cos(a) * 0.6 * 0.4 + Math.sin(a * 0.8) * 0.5 * 0.32;
    const img = sprite('c_cat');
    ctx.fillStyle = 'rgba(60,50,35,.22)';
    ctx.beginPath(); ctx.ellipse(c.x, c.y, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
    if (img) stand(ctx, img, c.x, c.y + 1 - (sit ? 0 : Math.abs(Math.sin(t * 8 + d.r * 5)) * 0.8), 15, { flip: vx < 0, sy: sit ? 0.92 : 1 });
  } else if (d.r < 0.84) put('c_bin', 13, 6, d.r > 0.77);
  else put('c_coatstand', 42, 8, d.r > 0.92);
}

/** How far into after-hours it is, from the viewer's clock: 0 while the office lights are on (07:00–21:00), 1 from 23:00 to 05:30. */
function night(now = new Date()): number {
  const h = now.getHours() + now.getMinutes() / 60;
  const ramp = (a: number, b: number, x: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  return h < 12 ? 1 - ramp(5.5, 7, h) : ramp(21, 23, h);
}

let monitorGlow: HTMLCanvasElement | null = null;
/** A soft blue pool of screen light, drawn once. */
function glowSprite(): HTMLCanvasElement {
  if (monitorGlow) return monitorGlow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(170,215,255,.85)');
    r.addColorStop(1, 'rgba(170,215,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  }
  monitorGlow = c;
  return c;
}

/**
 * Over the office, in world space: while the lights are on, soft bands of light falling from the
 * windows; after hours, the floor lights dimmed and every cubicle lit by its monitor.
 */
function sky(p: Paint, bounds: { x0: number; y0: number; x1: number; y1: number }, _cores: Pt[], places: Pt[]) {
  const { ctx, iso } = p;
  const t = p.t();
  const n = night();
  if (n < 1) {
    const w = bounds.x1 - bounds.x0, h = bounds.y1 - bounds.y0;
    ctx.fillStyle = `rgba(255,246,214,${0.07 * (1 - n) * (0.8 + 0.2 * Math.sin(t * 0.3))})`;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const x = bounds.x0 + w * (0.08 + k * 0.26);
      ctx.moveTo(x, bounds.y0); ctx.lineTo(x + w * 0.1, bounds.y0); ctx.lineTo(x + w * 0.1 + h * 0.9, bounds.y1); ctx.lineTo(x + h * 0.9, bounds.y1); ctx.closePath();
    }
    ctx.fill();
  }
  if (n <= 0) return;
  ctx.fillStyle = `rgba(18,26,60,${0.4 * n})`;
  ctx.fillRect(-1e5, -1e5, 2e5, 2e5);
  const g = glowSprite();
  ctx.save();
  ctx.globalAlpha = 0.55 * n;
  for (const q of places) {
    const c = iso(q.x + 0.1, q.y - 0.1, 26);
    ctx.drawImage(g, c.x - 34, c.y - 22, 68, 44);
  }
  ctx.restore();
}

/** Column layout: a glass skybridge between a computer's stacked floors. */
function bridge(p: Paint, a: Pt, b: Pt) {
  const { ctx, iso, poly } = p;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * 0.4, py = (dx / len) * 0.4;
  const deck = [iso(a.x + px, a.y + py), iso(b.x + px, b.y + py), iso(b.x - px, b.y - py), iso(a.x - px, a.y - py)];
  poly(deck, '#c7b99f');
  poly([deck[3], deck[2], { x: deck[2].x, y: deck[2].y + 5 }, { x: deck[3].x, y: deck[3].y + 5 }], '#9aa3ad');
  const up = (q: Pt) => ({ x: q.x, y: q.y - 11 });
  poly([deck[0], deck[1], up(deck[1]), up(deck[0])], 'rgba(170,210,240,.45)');
  poly([deck[3], deck[2], up(deck[2]), up(deck[3])], 'rgba(170,210,240,.4)');
  ctx.strokeStyle = '#8b97a4';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(deck[0].x, deck[0].y - 11); ctx.lineTo(deck[1].x, deck[1].y - 11);
  ctx.moveTo(deck[3].x, deck[3].y - 11); ctx.lineTo(deck[2].x, deck[2].y - 11);
  ctx.stroke();
}

/** A working unit carries a stuffed folder to the copier. */
function carry(p: Paint, _s: Slot, x: number, y: number, flip: boolean) {
  const img = sprite('c_folder');
  if (img) stand(p.ctx, img, x, y + 10, 15, { rot: flip ? 0.25 : -0.25, flip });
}

export const painter: Painter = {
  sprites: ['c_copier', 'c_cubicle', 'c_desk', ...STACKS, 'c_tray', 'c_flag', 'c_phone', 'c_cash', 'c_folder', 'c_chair_jacket',
    'c_plant', 'c_cooler', 'c_vending', 'c_cat', 'c_bin', 'c_coatstand', 'c_carpet', 'c_tile',
    ...Object.values(WORKER_ART).flatMap((a) => [a.rest, a.wave, ...a.desk, ...a.walk]), ...EFFORT_ART],
  font: '"Rubik", "IBM Plex Sans", sans-serif',
  unitArt: (_kind, cast) => WORKER_ART[characterIdFor(cast)].rest,
  link: { color: '#34506f', dash: [2, 2.5], lift: 0.35 },
  unitH: 56, unitW: 52,
  background, slab, bridge, field, team, core: copier, place: cubicle, placeShape: cubicleShape, buzz: phone, unit: worker, carry, standIn: emptyChair, coin: cash, decor, sky,
};
