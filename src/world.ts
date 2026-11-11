import { spaceColor } from './format';
import { store } from './store';
import type { Team } from './teams';
import type { Agent, RNode } from './types';
import { castFor, effortTier, type EffortTier } from './inference';

// Where things stand on the isometric grid (units: tiles). A computer is an island; on it each space
// is a district; in a district each agent has a slot: a building with its unit standing in front.
// Teams (rostr's reports_to) are fenced blocks inside their district, nested as deep as they go.
//
// An isometric rectangle is always twice as wide as tall on screen, so a tall (phone) viewport gets the
// column layout: every district on its own slab, stacked straight down the screen.

const SLOT_X = 3.2;
const SLOT_Y = 4.4;
const DISTRICT_BACK = 1.7; // banner strip behind the first row of buildings
const DISTRICT_SIDE = 0.3; // between a district's edge and its contents
const TEAM_HEAD = 1.2; // a team's name strip behind its first row
const TEAM_PAD = 0.5; // a team's fence to its buildings
const GAP = 1; // between blocks side by side or one behind the other
const ISLAND_HEAD = 3.6; // strip at the back of the island for the computer's core
const ISLAND_GAP = 5;
const ROW_WIDTH = 46; // islands wrap to a new row past this width
const ISLAND_ROW = 24; // districts wrap inside an island past this width
const COLUMN_GAP = 5; // between slabs of one computer, in screen depth (x + y) tiles
const COLUMN_ISLAND_GAP = 9; // between computers: room for the computer's label
const CELL = 0.5; // the walking grid's resolution

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface Slot {
  agent: Agent;
  cast: string;
  effort: EffortTier;
  gx: number; // building footprint origin (2×2 tiles)
  gy: number;
  ux: number; // unit position
  uy: number;
  seed: number;
  district: District;
  island: Island;
  /**
   * Where the unit delivers when working, from its own spot: its computer's core (the base, a barn on
   * the farm), around the buildings and over the bridges between slabs. Working units walk it back and forth.
   */
  route: Pt[];
}

export interface Pt {
  x: number;
  y: number;
}

/** A team's fenced block in its district: its manager, the manager's direct reports, nested teams. */
export interface TeamBlock extends Rect {
  manager: Slot;
  /** Everyone in it, nested teams included. */
  slots: Slot[];
  /** 1 for a team straight in its district, 2 for one inside that, … */
  depth: number;
}

export interface District extends Rect {
  id: string;
  name: string;
  slug: string;
  color: string;
  slots: Slot[];
  /** Its teams at every depth, each before the teams inside it. */
  teams: TeamBlock[];
}

export interface Island {
  id: string;
  name: string;
  node: RNode | null;
  /** The ground: one slab, or one per district in the column layout. */
  slabs: Rect[];
  core: { x: number; y: number };
  districts: District[];
  /** Walkways joining stacked slabs (column layout), from the upper slab's front corner to the lower one's back corner. */
  bridges: [Pt, Pt][];
  /** Scenery spots on free ground; `r` (0–1) picks what stands there. */
  decor: Decor[];
}

export interface Decor {
  x: number;
  y: number;
  r: number;
}

export interface World {
  islands: Island[];
  slots: Map<string, Slot>;
  /** Reporting lines between agents both on the map: worker → manager. */
  links: { from: Slot; to: Slot }[];
  /** Changes when anything moves: agents, spaces or computers added or removed, or the layout mode. */
  shape: string;
}

/** Something laid out: its size, then where it goes (which creates its slots and team blocks). */
interface Box {
  w: number;
  d: number;
  place(x0: number, y0: number, into: Placing): void;
}

interface Placing {
  district: District;
  island: Island;
  slots: Map<string, Slot>;
  /** How many teams the box sits in. */
  depth: number;
}

interface Group { id: string; name: string; slug: string; box: Box; w: number; d: number }

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}

function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A grid of buildings, roughly square, in the agents' order. */
function gridBox(agents: Agent[]): Box | null {
  if (!agents.length) return null;
  const cols = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(agents.length * 1.4))));
  return {
    w: cols * SLOT_X + 0.4,
    d: Math.ceil(agents.length / cols) * SLOT_Y,
    place(x0, y0, into) {
      agents.forEach((agent, i) => {
        const gx = x0 + 0.6 + (i % cols) * SLOT_X;
        const gy = y0 + Math.floor(i / cols) * SLOT_Y;
        const seed = hash(agent.id);
        const slot: Slot = {
          agent, gx, gy, ux: gx + 1, uy: gy + 3, seed: seed * 100,
          cast: castFor(agent), effort: effortTier(agent.inference),
          district: into.district, island: into.island, route: [],
        };
        into.district.slots.push(slot);
        into.slots.set(agent.id, slot);
      });
    },
  };
}

/** Boxes in rows, left to right, starting a new row past `max` wide; each row as deep as its deepest. */
function shelf(items: Box[], max: number): Box {
  const rows: Box[][] = [];
  const rowW = (r: Box[]) => r.reduce((n, b) => n + b.w, 0) + GAP * (r.length - 1);
  const rowD = (r: Box[]) => Math.max(...r.map((b) => b.d));
  for (const b of items) {
    const last = rows[rows.length - 1];
    if (last && rowW(last) + GAP + b.w <= max) last.push(b);
    else rows.push([b]);
  }
  return {
    w: Math.max(...rows.map(rowW)),
    d: rows.reduce((n, r) => n + rowD(r), 0) + GAP * (rows.length - 1),
    place(x0, y0, into) {
      let y = y0;
      for (const r of rows) {
        let x = x0;
        for (const b of r) { b.place(x, y, into); x += b.w + GAP; }
        y += rowD(r) + GAP;
      }
    },
  };
}

/**
 * A team: its own grid (the manager first, then its reports without teams), then its reports' teams,
 * all in rows kept roughly square. With a manager it is fenced, with its name strip at the back; the
 * root (no manager: a district's members) is the district's contents.
 */
function teamBox(t: Team): Box {
  const parts = [gridBox(t.agents), ...t.teams.map(teamBox)].filter((b): b is Box => b !== null);
  const area = parts.reduce((n, b) => n + b.w * b.d, 0);
  const inner = shelf(parts, Math.max(...parts.map((b) => b.w), Math.sqrt(area) * 1.3));
  const lead = t.manager;
  if (!lead) return inner;
  const w = inner.w + 2 * TEAM_PAD, d = TEAM_HEAD + inner.d + TEAM_PAD;
  return {
    w, d,
    place(x0, y0, into) {
      const at = into.district.teams.length, from = into.district.slots.length;
      inner.place(x0 + TEAM_PAD, y0 + TEAM_HEAD, { ...into, depth: into.depth + 1 });
      const manager = into.slots.get(lead.id);
      if (!manager) return;
      into.district.teams.splice(at, 0, { x0, y0, x1: x0 + w, y1: y0 + d, manager, slots: into.district.slots.slice(from), depth: into.depth + 1 });
    },
  };
}

function groupsOf(agents: Agent[]): Group[] {
  const bySpace = new Map<string, Agent[]>();
  for (const a of agents) bySpace.set(a.space_id, [...(bySpace.get(a.space_id) ?? []), a]);
  return [...bySpace.entries()].map(([id, members]) => {
    const space = store.spaces.get(id);
    const slug = space?.slug ?? members[0].space_slug;
    const box = teamBox(store.teams(members));
    return { id, name: space?.name ?? slug, slug, box, w: box.w + 2 * DISTRICT_SIDE, d: DISTRICT_BACK + box.d };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function addDistrict(island: Island, g: Group, x0: number, y0: number, slots: Map<string, Slot>) {
  const district: District = { id: g.id, name: g.name, slug: g.slug, color: spaceColor(g.slug), x0, y0, x1: x0 + g.w, y1: y0 + g.d, slots: [], teams: [] };
  g.box.place(x0 + DISTRICT_SIDE, y0 + DISTRICT_BACK, { district, island, slots, depth: 0 });
  island.districts.push(district);
}

/**
 * Each island's routes and scenery, by computer id, with a key of everything they are found from:
 * a rebuild where nothing on the island moved (a status change, a new event) reuses them.
 */
const geometry = new Map<string, { key: string; routes: Map<string, Pt[]>; decor: Decor[] }>();

/** `skip`: agents left off the map (packed away, see map.ts); their computers still show. */
export function buildWorld(column: boolean, skip: ReadonlySet<string> = new Set()): World {
  const byNode = new Map<string, Agent[]>();
  for (const a of store.agents.values()) if (!skip.has(a.id)) byNode.set(a.node_id, [...(byNode.get(a.node_id) ?? []), a]);
  // Computers without agents still show (empty islands): they are part of what rostr knows. With a
  // filter, store.nodes holds only computers with an agent that passes, so none are empty.
  for (const n of store.nodes.values()) if (!byNode.has(n.id)) byNode.set(n.id, []);
  const nameOf = (id: string) => store.nodes.get(id)?.name ?? byNode.get(id)?.[0]?.node_name ?? 'computer';
  const nodeIds = [...byNode.keys()].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  const islands: Island[] = [];
  const slots = new Map<string, Slot>();
  let ox = 0, oy = 0, rowDepth = 0; // grid layout cursor
  let depth = 0; // column layout cursor: screen depth (x + y) of the next slab's back corner

  for (const nodeId of nodeIds) {
    const island: Island = { id: nodeId, name: nameOf(nodeId), node: store.nodes.get(nodeId) ?? null, slabs: [], core: { x: 0, y: 0 }, districts: [], decor: [], bridges: [] };
    const groups = groupsOf(byNode.get(nodeId) ?? []);

    if (column) {
      // Each slab is centred on the screen's vertical axis (x − y fixed) and starts below the last.
      const parts = groups.length ? groups : [null];
      parts.forEach((g, k) => {
        const head = k === 0 ? ISLAND_HEAD : 1;
        const w = (g?.w ?? 6) + 2, d = (g?.d ?? 2.2) + head + 0.8;
        const x0 = (depth - (w - d) / 2) / 2, y0 = (depth + (w - d) / 2) / 2;
        island.slabs.push({ x0, y0, x1: x0 + w, y1: y0 + d });
        if (k === 0) island.core = { x: x0 + 2, y: y0 + 1.9 };
        if (g) addDistrict(island, g, x0 + 1, y0 + head, slots);
        depth += w + d + (k === parts.length - 1 ? COLUMN_ISLAND_GAP : COLUMN_GAP);
      });
      for (let j = 1; j < island.slabs.length; j++) {
        const up = island.slabs[j - 1], down = island.slabs[j];
        island.bridges.push([{ x: up.x1 - 0.5, y: up.y1 - 0.5 }, { x: down.x0 + 0.5, y: down.y0 + 0.5 }]);
      }
    } else {
      // Districts fill rows so an island stays roughly square.
      let dx = 1, dy = ISLAND_HEAD, rowEnd = dy, widest = 8;
      const at = groups.map((g) => {
        if (dx > 1 && dx + g.w > 1 + ISLAND_ROW) { dx = 1; dy = rowEnd + 1.2; }
        const p = { x: dx, y: dy };
        dx += g.w + 1.2;
        widest = Math.max(widest, p.x + g.w + 1);
        rowEnd = Math.max(rowEnd, dy + g.d);
        return p;
      });
      const w = widest, d = Math.max(rowEnd + 0.8, ISLAND_HEAD + 3);
      island.slabs.push({ x0: ox, y0: oy, x1: ox + w, y1: oy + d });
      island.core = { x: ox + 2, y: oy + 1.9 };
      groups.forEach((g, k) => addDistrict(island, g, ox + at[k].x, oy + at[k].y, slots));
      rowDepth = Math.max(rowDepth, d);
      ox += w + ISLAND_GAP;
      if (ox > ROW_WIDTH) { ox = 0; oy += rowDepth + ISLAND_GAP; rowDepth = 0; }
    }
    const placed = island.districts.flatMap((d) => d.slots);
    const key = JSON.stringify([island.slabs, island.bridges, island.core, island.districts.map((d) => [d.x0, d.y0, d.x1, d.y1]), placed.map((s) => [s.agent.id, s.gx, s.gy])]);
    const prev = geometry.get(nodeId);
    if (prev?.key === key) {
      for (const s of placed) s.route = prev.routes.get(s.agent.id) ?? [];
      island.decor = prev.decor;
    } else {
      walkways(island);
      island.decor = scenery(island);
      geometry.set(nodeId, { key, routes: new Map(placed.map((s) => [s.agent.id, s.route])), decor: island.decor });
    }
    islands.push(island);
  }
  for (const id of geometry.keys()) if (!byNode.has(id)) geometry.delete(id);

  const links = [...slots.values()].flatMap((s) => {
    const m = store.manager(s.agent);
    const to = m && slots.get(m.id);
    return to ? [{ from: s, to }] : [];
  });
  const shape = (column ? 'col|' : 'grid|') + islands
    .map((i) => `${i.id}:${i.districts.map((d) => `${d.id}=${d.slots.map((s) => s.agent.id).join(',')}`).join(';')}`)
    .join('|');
  return { islands, slots, links, shape };
}

/**
 * Free ground for scenery (trees, lamps, hay…): tiles on the island's slabs away from every district
 * and the core, a fixed pseudo-random fifth of them, so the same island always looks the same.
 */
function scenery(island: Island): Decor[] {
  const out: Decor[] = [];
  // Keep the walkways clear too.
  const segments = island.districts.flatMap((d) => d.slots.flatMap((s) => s.route.slice(1).map((q, i) => [s.route[i], q] as const)));
  const nearPath = (p: Pt) => segments.some(([a, b]) => segmentDistance(p, a, b) < 0.8);
  const busy = (x: number, y: number) =>
    island.districts.some((d) => x > d.x0 - 0.5 && x < d.x1 + 0.5 && y > d.y0 - 0.5 && y < d.y1 + 0.5)
    || Math.hypot(x - island.core.x, y - island.core.y) < 2.2
    || nearPath({ x, y });
  for (const r of island.slabs) {
    for (let x = Math.ceil(r.x0 + 0.5); x < r.x1 - 0.5; x++) {
      for (let y = Math.ceil(r.y0 + 0.5); y < r.y1 - 0.5; y++) {
        if (busy(x, y)) continue;
        const key = `${island.id}:${x}:${y}`;
        if (hash(key) > 0.2) continue;
        out.push({ x: x + (hash(`${key}:x`) - 0.5) * 0.4, y: y + (hash(`${key}:y`) - 0.5) * 0.4, r: hash(`${key}:r`) });
      }
    }
  }
  return out;
}

/**
 * Each slot's delivery route, found on a grid over the island's ground: open on the slabs and the
 * bridges, shut under the buildings and the core. One breadth-first search from the core gives every
 * unit its way there, which is then straightened wherever nothing stands between two of its points. A
 * unit with no way there (none should exist) stays home.
 */
function walkways(island: Island) {
  const { x: cx, y: cy } = island.core;
  const frontY = cy + 1.2; // the strip in front of the core, above every district
  const xs = island.slabs.flatMap((r) => [r.x0, r.x1]), ys = island.slabs.flatMap((r) => [r.y0, r.y1]);
  const ox = Math.min(...xs), oy = Math.min(...ys);
  const W = Math.ceil((Math.max(...xs) - ox) / CELL), H = Math.ceil((Math.max(...ys) - oy) / CELL);
  const cellAt = (x: number, y: number) => {
    const i = Math.floor((x - ox) / CELL), j = Math.floor((y - oy) / CELL);
    return i >= 0 && j >= 0 && i < W && j < H ? j * W + i : -1;
  };
  const centre = (k: number): Pt => ({ x: ox + ((k % W) + 0.5) * CELL, y: oy + (Math.floor(k / W) + 0.5) * CELL });

  const open = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const p = centre(k);
    open[k] = island.slabs.some((r) => p.x > r.x0 + 0.3 && p.x < r.x1 - 0.3 && p.y > r.y0 + 0.3 && p.y < r.y1 - 0.3)
      || island.bridges.some(([a, b]) => segmentDistance(p, a, b) < 0.5) ? 1 : 0;
  }
  const shut = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y += CELL / 2) for (let x = x0; x < x1; x += CELL / 2) { const k = cellAt(x, y); if (k >= 0) open[k] = 0; }
  };
  const slots = island.districts.flatMap((d) => d.slots);
  for (const s of slots) shut(s.gx - 0.3, s.gy - 0.3, s.gx + 2.3, s.gy + 2.3);
  shut(cx - 0.8, cy - 0.8, cx + 0.8, cy + 0.6);

  const nearestOpen = (p: Pt, ok: (k: number) => boolean) => {
    for (let r = 0; r <= 4; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const k = cellAt(p.x + dx * CELL, p.y + dy * CELL);
          if (k >= 0 && open[k] && ok(k)) return k;
        }
      }
    }
    return -1;
  };
  const steps = (k: number) => {
    const i = k % W;
    return [i > 0 ? k - 1 : -1, i < W - 1 ? k + 1 : -1, k - W, k + W].filter((n) => n >= 0 && n < W * H && open[n]);
  };
  // Steps to the core from every open cell.
  const dist = new Int32Array(W * H).fill(-1);
  const seed = nearestOpen({ x: cx + 0.9, y: frontY }, () => true);
  const queue = seed >= 0 ? [seed] : [];
  if (seed >= 0) dist[seed] = 0;
  for (let h = 0; h < queue.length; h++) {
    for (const n of steps(queue[h])) if (dist[n] < 0) { dist[n] = dist[queue[h]] + 1; queue.push(n); }
  }
  // Nothing in the way: every quarter cell along the segment is open.
  const clear = (a: Pt, b: Pt) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (CELL / 2));
    for (let t = 1; t < n; t++) {
      const k = cellAt(a.x + ((b.x - a.x) * t) / n, a.y + ((b.y - a.y) * t) / n);
      if (k < 0 || !open[k]) return false;
    }
    return true;
  };
  const route = (from: Pt, to: Pt): Pt[] => {
    let k = nearestOpen(from, (c) => dist[c] >= 0);
    if (k < 0) return [];
    const pts = [from, centre(k)];
    while (dist[k] > 0) {
      k = steps(k).find((n) => dist[n] === dist[k] - 1) ?? -1;
      if (k < 0) return [];
      pts.push(centre(k));
    }
    pts.push(to);
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1;) {
      let j = pts.length - 1;
      while (j > i + 1 && !clear(pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  };

  for (const s of slots) {
    // Units wait at the core side by side, spread by seed so they do not stack.
    const to = { x: cx + 0.2 + ((s.seed * 7) % 1.4), y: frontY + ((s.seed * 13) % 0.6) - 0.3 };
    s.route = route({ x: s.ux, y: s.uy }, to);
  }
}
