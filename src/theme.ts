// Selectable looks. A theme is a palette for everything drawn from JS (status, kind, space and event
// colours, map labels) plus a `data-theme` on <body> for the CSS, and on the map its own painter
// (map.ts for neon; farm.ts, lab.ts and cubicles.ts for the painted themes, see painters.ts). The
// choice is remembered per browser.

export type ThemeId = 'neon' | 'farm' | 'lab' | 'cubicles';
export const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'neon', label: 'Neon city' },
  { id: 'farm', label: 'Farm' },
  { id: 'lab', label: 'Lab' },
  { id: 'cubicles', label: 'Cubicles' },
];

export interface KindColors { c: string; l: string; d: string }

export interface Palette {
  kinds: Record<string, KindColors>;
  otherKind: KindColors;
  status: Record<string, string>;
  statusOther: string;
  nodeState: Record<string, string>;
  channel: Record<string, string>;
  /** Space colours, picked by a hash of the slug. */
  spaces: string[];
  roles: Record<string, string>;
  /** Event-log colours by meaning. */
  ev: { good: string; bad: string; warn: string; info: string; session: string; muted: string; buzz: string; gold: string; stale: string; other: string };
  /** Labels and chips drawn over the map. */
  map: { text: string; textDim: string; stroke: string; chipBg: string; pane: string; buzz: string; money: string; selected: string };
}

const NEON: Palette = {
  kinds: {
    claude: { c: '#ff9a5c', l: '#ffc7a3', d: '#a1502a' },
    codex: { c: '#4dff9a', l: '#b4ffd2', d: '#1f8a4f' },
    pi: { c: '#c58cff', l: '#e3c9ff', d: '#6c3fa8' },
    omp: { c: '#5ee7ff', l: '#c2f6ff', d: '#1f7f99' },
  },
  otherKind: { c: '#9fb4cc', l: '#dbe6f2', d: '#4d5f75' },
  status: {
    working: '#5ee7ff', idle: '#8fa3bb', blocked: '#ffd36e', done: '#4dff9a', unknown: '#6b7788', missing: '#ff4d6a',
    exited: '#ff8a4c', node_offline: '#ff4d6a', disabled: '#6b7788', retired: '#6b7788',
  },
  statusOther: '#6b7788',
  nodeState: { online: '#4dff9a', stale: '#ffb547', offline: '#ff4d6a' },
  channel: { ok: '#4dff9a', attached: '#4dff9a', pending: '#ffb547', detached: '#ff8a4c', failed: '#ff4d6a', gone: '#6b7788', unknown: '#6b7788' },
  spaces: ['#5ee7ff', '#b48cff', '#6ee07a', '#ff8a4c', '#ff7ab8', '#ffd36e', '#7aa8ff', '#4dffd2'],
  roles: { main: '#5ee7ff', advisor: '#c58cff', subagent: '#7dffb0', helper: '#8fa3bb' },
  ev: {
    good: '#4dff9a', bad: '#ff4d6a', warn: '#ff8a4c', info: '#7aa8ff', session: '#b48cff', muted: '#6b7788', buzz: '#4dffd2',
    gold: '#ffd36e', stale: '#ffb547', other: '#8fa3bb',
  },
  map: { text: '#e6f2ff', textDim: '#8a97a8', stroke: 'rgba(2,5,10,.85)', chipBg: 'rgba(6,12,22,.85)', pane: '#7aa8ff', buzz: '#4dffd2', money: '#e8d9a8', selected: '#4dff9a' },
};

// Bright, warm and readable on parchment: darker inks than neon, since the panels are light.
const FARM: Palette = {
  kinds: {
    claude: { c: '#e0702a', l: '#f6a86b', d: '#9c4310' },
    codex: { c: '#3f9b3a', l: '#7dcc6d', d: '#24661f' },
    pi: { c: '#8e4fb8', l: '#bb8ad9', d: '#5c2b80' },
    omp: { c: '#2d7fc1', l: '#6fb2e6', d: '#1a5285' },
  },
  otherKind: { c: '#7f8c8d', l: '#b4bebf', d: '#4f5a5b' },
  status: {
    working: '#1f78c0', idle: '#7d6a50', blocked: '#d18a00', done: '#2e8b2e', unknown: '#8a7f70', missing: '#c0392b',
    exited: '#d35400', node_offline: '#c0392b', disabled: '#8a7f70', retired: '#8a7f70',
  },
  statusOther: '#8a7f70',
  nodeState: { online: '#2e8b2e', stale: '#d17a00', offline: '#c0392b' },
  channel: { ok: '#2e8b2e', attached: '#2e8b2e', pending: '#d17a00', detached: '#d35400', failed: '#c0392b', gone: '#8a7f70', unknown: '#8a7f70' },
  spaces: ['#2d7fc1', '#8e4fb8', '#2e8b2e', '#d35400', '#c2185b', '#b07d00', '#3949ab', '#00897b'],
  roles: { main: '#2d7fc1', advisor: '#8e4fb8', subagent: '#3f9b3a', helper: '#9a8c78' },
  ev: {
    good: '#2e8b2e', bad: '#c0392b', warn: '#d35400', info: '#2f6db5', session: '#8e4fb8', muted: '#8a7f70', buzz: '#00897b',
    gold: '#b07d00', stale: '#d17a00', other: '#6d5c45',
  },
  map: { text: '#fffbea', textDim: '#e9dfc4', stroke: 'rgba(58,34,12,.88)', chipBg: 'rgba(255,248,225,.95)', pane: '#2f6db5', buzz: '#00796b', money: '#ffd34d', selected: '#fff36b' },
};

// Clinical and bright: instrument blue for work, inks dark enough for white enamel panels; light labels over the floors.
const LAB: Palette = {
  kinds: {
    claude: { c: '#e0702a', l: '#f6a86b', d: '#9c4310' },
    codex: { c: '#2f9a45', l: '#74cc7f', d: '#1c6a2c' },
    pi: { c: '#8e4fb8', l: '#bb8ad9', d: '#5c2b80' },
    omp: { c: '#2a78c8', l: '#6fb2e6', d: '#184f8a' },
  },
  otherKind: { c: '#7d8a99', l: '#b6c0cb', d: '#4c5866' },
  status: {
    working: '#1a7fd0', idle: '#6d7d8f', blocked: '#d98300', done: '#1e9e5a', unknown: '#8794a3', missing: '#d03a3a',
    exited: '#d9622b', node_offline: '#d03a3a', disabled: '#8794a3', retired: '#8794a3',
  },
  statusOther: '#8794a3',
  nodeState: { online: '#1e9e5a', stale: '#d98300', offline: '#d03a3a' },
  channel: { ok: '#1e9e5a', attached: '#1e9e5a', pending: '#d98300', detached: '#d9622b', failed: '#d03a3a', gone: '#8794a3', unknown: '#8794a3' },
  // No reds, pinks or oranges: on the map red means blocked.
  spaces: ['#1a7fd0', '#8e4fb8', '#1e9e5a', '#00968a', '#2f4a9e', '#b8900a', '#6a5acd', '#5f8f2a'],
  roles: { main: '#1a7fd0', advisor: '#8e4fb8', subagent: '#2f9a45', helper: '#7d8a99' },
  ev: {
    good: '#1e9e5a', bad: '#d03a3a', warn: '#d9622b', info: '#2a6fc4', session: '#8e4fb8', muted: '#8794a3', buzz: '#00838f',
    gold: '#b07d00', stale: '#d98300', other: '#55687d',
  },
  map: { text: '#ffffff', textDim: '#e8f0f8', stroke: 'rgba(18,40,66,.88)', chipBg: 'rgba(255,255,255,.95)', pane: '#2a6fc4', buzz: '#00838f', money: '#ffd34d', selected: '#22d3ee' },
};

// Office inks on beige paper: the kind colours are the workers' clothes (blue shirt, orange cardigan,
// green hoodie, purple sweater); labels light with a navy stroke over the carpet.
const CUBICLES: Palette = {
  kinds: {
    claude: { c: '#df7a2c', l: '#f4ad72', d: '#9a4a12' },
    codex: { c: '#2e9a48', l: '#74c987', d: '#1d6630' },
    pi: { c: '#7b4fc0', l: '#ad8ee0', d: '#4f2d86' },
    omp: { c: '#2f6db8', l: '#79a9e2', d: '#1c467c' },
  },
  otherKind: { c: '#78838f', l: '#b3bcc6', d: '#4a535d' },
  status: {
    working: '#2f6db8', idle: '#7a7266', blocked: '#d4361f', done: '#2e8b45', unknown: '#8a8478', missing: '#b8322a',
    exited: '#d35400', node_offline: '#b8322a', disabled: '#8a8478', retired: '#8a8478',
  },
  statusOther: '#8a8478',
  nodeState: { online: '#2e8b45', stale: '#c97a00', offline: '#b8322a' },
  channel: { ok: '#2e8b45', attached: '#2e8b45', pending: '#c97a00', detached: '#d35400', failed: '#b8322a', gone: '#8a8478', unknown: '#8a8478' },
  // No red, pink or orange: on the map red means blocked.
  spaces: ['#2f6db8', '#7b4fc0', '#2e8b45', '#00897b', '#3949ab', '#a77a00', '#1c5f8c', '#5b8f2a'],
  roles: { main: '#2f6db8', advisor: '#7b4fc0', subagent: '#2e9a48', helper: '#8f8676' },
  ev: {
    good: '#2e8b45', bad: '#b8322a', warn: '#d35400', info: '#2f6db8', session: '#7b4fc0', muted: '#8a8478', buzz: '#00897b',
    gold: '#a77a00', stale: '#c97a00', other: '#5f584c',
  },
  map: { text: '#ffffff', textDim: '#eef1f5', stroke: 'rgba(30,42,62,.9)', chipBg: 'rgba(252,250,244,.96)', pane: '#2f6db8', buzz: '#00796b', money: '#ffe06b', selected: '#ffe94d' },
};

const PALETTES: Record<ThemeId, Palette> = { neon: NEON, farm: FARM, lab: LAB, cubicles: CUBICLES };
const KEY = 'dispatchr.theme';

function stored(): ThemeId {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.find((t) => t.id === v)?.id ?? 'neon';
  } catch {
    return 'neon';
  }
}

let current: ThemeId = stored();
const listeners = new Set<() => void>();

export const theme = {
  get id(): ThemeId { return current; },
  /** Drawn by a painter from painters.ts (light, painted sprites; no additive glow): every theme but the neon city. */
  get painted(): boolean { return current !== 'neon'; },
  set(id: ThemeId) {
    if (id === current) return;
    current = id;
    try { localStorage.setItem(KEY, id); } catch { /* private mode: not remembered */ }
    document.body.dataset.theme = id;
    for (const fn of listeners) fn();
  },
  onChange(fn: () => void) { listeners.add(fn); },
};

/** The active palette. */
export const pal = (): Palette => PALETTES[current];

document.body.dataset.theme = current;
