import { obj, str, tokenList } from './data';
import { coreName, namePieces, splitCopy } from './nameplate';
import { store } from './store';
import { pal } from './theme';
import type { Agent, RostrEvent } from './types';

// ─── palettes (colours from the active theme, see theme.ts)

export interface Kind { label: string; glyph: string; c: string; l: string; d: string }
const KIND_NAMES: Record<string, { label: string; glyph: string }> = {
  claude: { label: 'Claude Code', glyph: '✶' },
  codex: { label: 'Codex', glyph: '◎' },
  pi: { label: 'Pi', glyph: 'π' },
  omp: { label: 'omp', glyph: 'Ω' },
};
export function kindOf(kind: string): Kind {
  const p = pal();
  return { ...(KIND_NAMES[kind] ?? { label: kind, glyph: '◆' }), ...(p.kinds[kind] ?? p.otherKind) };
}

export const GHOST: Kind = { label: 'ghost', glyph: '', c: '#3d5168', l: '#5f7a96', d: '#1c2838' };
export const DEAD: Kind = { label: 'dead', glyph: '', c: '#4a5566', l: '#6b7788', d: '#252c38' };

export interface StatusLook { label: string; c: string; icon: string; up: boolean }
const STATUSES: Record<string, Omit<StatusLook, 'c'>> = {
  working: { label: 'working', icon: '▶', up: true },
  idle: { label: 'idle', icon: 'z', up: true },
  blocked: { label: 'blocked', icon: '!', up: true },
  done: { label: 'done', icon: '✓', up: true },
  unknown: { label: 'unknown', icon: '?', up: true },
  missing: { label: 'missing', icon: '✕', up: false },
  exited: { label: 'exited', icon: '■', up: false },
  node_offline: { label: 'computer offline', icon: '⌁', up: false },
  disabled: { label: 'disabled', icon: '❚❚', up: false },
  retired: { label: 'retired', icon: '·', up: false },
};
export function statusOf(s: string): StatusLook {
  const p = pal();
  return { ...(STATUSES[s] ?? { label: s, icon: '?', up: false }), c: p.status[s] ?? p.statusOther };
}

/** A status as an icon, like the map's over a character: typing dots, a warning diamond, a tick, a z… */
export function statusIcon(status: string): string {
  const st = statusOf(status);
  const inner = status === 'working' ? '<i></i><i></i><i></i>' : esc(st.icon);
  return `<span class="sti s-${esc(status)}" role="img" aria-label="${esc(st.label)}" title="${esc(st.label)}">${inner}</span>`;
}

/**
 * An agent's name in a list (the units list, the loop bar): its short name (nameplate.ts), which the
 * list's width cuts with `…` while a copy number stays; the whole name as its tooltip.
 */
export function shortNameHtml(name: string): string {
  const [head, copy] = splitCopy(coreName(name));
  return `<span class="nm" title="${esc(name)}"><span class="cut">${esc(head)}</span>${copy ? `<span class="copy">${esc(copy)}</span>` : ''}</span>`;
}

/** An agent's whole name in a list (the units list's selected row), free to break after a separator. */
export function wholeNameHtml(name: string): string {
  return `<span class="nm whole">${namePieces(name).map(esc).join('<wbr>')}</span>`;
}

export const STATUS_ORDER = ['working', 'blocked', 'idle', 'done', 'unknown', 'exited', 'missing', 'node_offline', 'disabled'];

export const nodeStateOf = (s: string) => ({ label: s, c: pal().nodeState[s] ?? pal().statusOther });

export const channelColor = (state: string) => pal().channel[state] ?? pal().statusOther;

export interface LinkLook { name: string; label: string; icon: string; href: string; host: string }

// What a link opens, by the name the computer's [links] gives it, in menu order; other names follow,
// shown as written.
const LINK_NAMES: Record<string, { label: string; icon: string }> = {
  web: { label: 'Web terminal', icon: '▣' },
  terminal: { label: 'Terminal', icon: '❯' },
  code: { label: 'Code', icon: '⟨⟩' },
  ssh: { label: 'SSH', icon: '⇄' },
  files: { label: 'Files', icon: '▤' },
};

/** The agent's links that can be opened: known names in menu order, then the rest by name. */
export function linksOf(a: Agent): LinkLook[] {
  return Object.entries(a.links).flatMap(([name, href]) => {
    let url: URL;
    try { url = new URL(href); } catch { return []; }
    // rostr only sends http(s) links; anything else (a script scheme above all) is never shown.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
    const look = LINK_NAMES[name] ?? { label: name.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()), icon: '↗' };
    return [{ name, ...look, href: url.href, host: url.host }];
  }).sort((x, y) => linkRank(x.name) - linkRank(y.name) || x.name.localeCompare(y.name));
}

const LINK_ORDER = Object.keys(LINK_NAMES);
function linkRank(name: string): number {
  const i = LINK_ORDER.indexOf(name);
  return i < 0 ? LINK_ORDER.length : i;
}

// A space keeps its colour across sessions and new spaces: hashed from its slug.
export function spaceColor(slug: string): string {
  let h = 2166136261;
  for (const ch of slug) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const spaces = pal().spaces;
  return spaces[(h >>> 0) % spaces.length];
}

export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// ─── text

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 5) return 'now';
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const basename = (p: string | null | undefined) => (p ? p.replace(/\/+$/, '').split('/').pop() ?? p : '');

// ─── usage

/** Money and role colours of the active theme. */
export const roleColor = (role: string) => pal().roles[role] ?? pal().ev.muted;

/** USD; "≥" when part of it had no known price. */
export function money(usd: number, complete = true): string {
  const s = usd >= 1000 ? `$${Math.round(usd).toLocaleString('en-US')}` : `$${usd.toFixed(2)}`;
  return complete ? s : `≥ ${s}`;
}

export function tokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

export function pct(share: number): string {
  const p = share * 100;
  if (p > 0 && p < 0.1) return '<0.1%';
  return p > 0 && p < 10 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
}

export function buzzLabel(agent: Agent): string | null {
  const ch = agent.channels.find((c) => c.type === 'buzz');
  if (!ch) return null;
  return store.buzz.get(ch.id)?.identity ?? 'buzz';
}

// ─── events

export interface Described {
  icon: string;
  c: string;
  /** Who it is about: agent name, else node name. */
  who: string;
  /** HTML-escaped rest of the line. */
  what: string;
  /** Admin noise (grants, tokens, principals): shown dim. */
  quiet?: boolean;
}

function agentName(e: RostrEvent): string {
  if (e.agent_id) {
    const a = store.agents.get(e.agent_id);
    if (a) return a.name;
    const fromData = str(obj(e.data.agent).name);
    if (fromData) return fromData;
    // Retired or hidden: the newest event that carried its name.
    for (let i = store.events.length - 1; i >= 0; i--) {
      const x = store.events[i];
      if (x.agent_id === e.agent_id) { const n = str(obj(x.data.agent).name); if (n) return n; }
    }
    return 'agent';
  }
  return '';
}

const pane = (v: unknown) => { const p = str(v); return p ? ` <span class="pane">${esc(p)}</span>` : ''; };

/** A principal's name: a visible agent's, else the one the agent's reports_to names (a person, say). */
function principalName(agentId: string | null, principalId: string): string | null {
  const agent = store.agentByPrincipal(principalId);
  if (agent) return agent.name;
  const r = agentId ? store.agents.get(agentId)?.reports_to : null;
  return r && 'principal_id' in r && r.principal_id === principalId ? r.name : null;
}

export function describe(e: RostrEvent): Described {
  const d = e.data;
  const ev = pal().ev;
  const node = e.node_id ? store.nodes.get(e.node_id)?.name ?? str(d.name) ?? 'computer' : '';
  const who = agentName(e) || node || 'rostr';
  const reason = str(d.reason) ?? str(d.detail) ?? str(d.error);
  const why = reason ? ` · ${esc(reason)}` : '';
  switch (e.type) {
    case 'launched':
      return { icon: '▲', c: ev.good, who, what: `launched${pane(d.pane_id)}${d.continued === true ? ' · continued newest session' : ''}` };
    case 'resumed':
      return { icon: '↻', c: ev.good, who, what: `resumed its session${pane(d.pane_id)}` };
    case 'exited':
      return { icon: '■', c: ev.warn, who, what: `exited${pane(d.pane_id)}` };
    case 'launch_failed':
      return { icon: '✖', c: ev.bad, who, what: `launch failed${why}` };
    case 'launch_refused':
      return { icon: '⛔', c: ev.bad, who, what: `launch refused${why}` };
    case 'renamed':
      return { icon: '✎', c: ev.info, who, what: `pane renamed → ${esc(str(d.herdr_name) ?? '?')}${pane(d.pane_id)}` };
    case 'relabeled':
      return { icon: '✎', c: ev.info, who, what: `workspace relabeled → ${esc(str(d.workspace_label) ?? str(d.label) ?? '?')}` };
    case 'status_changed': {
      const to = statusOf(str(d.new) ?? '?');
      return { icon: to.icon, c: to.c, who, what: `${esc(statusOf(str(d.old) ?? '?').label)} → <b style="color:${to.c}">${esc(to.label)}</b>` };
    }
    case 'address_changed': {
      const next = obj(d.new);
      return { icon: '⇢', c: ev.info, who, what: `${esc(str(d.type) ?? 'channel')} address →${pane(next.pane_id) || ' none'}` };
    }
    case 'session_recorded':
      return { icon: '◈', c: ev.session, who, what: `session recorded <span class="pane">${esc(basename(str(d.new)))}</span>` };
    case 'channel_added': {
      const id = str(obj(d.config).identity);
      return { icon: '⌖', c: ev.buzz, who, what: `${esc(str(d.type) ?? 'channel')} channel added${id ? ` · ${esc(id)}` : ''}` };
    }
    case 'channel_removed':
      return { icon: '⌖', c: ev.warn, who, what: `${esc(str(d.type) ?? 'channel')} channel removed${d.by === 'hand' ? ' by hand' : ''}` };
    case 'channel_gone':
      return { icon: '⌖', c: ev.muted, who, what: `${esc(str(d.type) ?? 'channel')} channel gone` };
    case 'agent_created':
      return { icon: '✚', c: ev.good, who, what: 'registered' };
    case 'adopted':
      return { icon: '✚', c: ev.good, who, what: `${reason === 'worktree' ? 'joined as a worktree worker' : 'adopted'}${pane(d.pane_id)}` };
    case 'reports_to_changed': {
      const next = str(d.new), old = str(d.old);
      const named = (p: string) => esc(principalName(e.agent_id, p) ?? 'someone');
      const what = next ? `now reports to <b>${named(next)}</b>` : `reports to no one${old ? ` · was ${named(old)}` : ''}`;
      return { icon: '⇡', c: ev.info, who, what: `${what}${reason === 'worktree' ? ' · worktree worker' : why}` };
    }
    case 'agent_changed':
      return { icon: '⚙', c: ev.info, who, what: `changed · ${esc(Object.keys(obj(d.changes)).join(', ') || 'settings')}` };
    case 'schedule_created':
      return { icon: '◷', c: ev.info, who: str(d.name) ?? 'schedule', what: 'schedule registered', quiet: true };
    case 'schedule_changed': {
      const fields = Array.isArray(d.fields) ? d.fields.filter((field): field is string => typeof field === 'string') : [];
      return { icon: '◷', c: ev.info, who: str(d.name) ?? 'schedule', what: `schedule updated${fields.length ? ` · ${esc(fields.join(', '))}` : ''}`, quiet: true };
    }
    case 'agent_retired':
      return { icon: '✝', c: ev.muted, who, what: `retired${reason === 'worktree_removed' ? ' · its worktree was removed' : why}` };
    case 'conflict':
      return { icon: '⚔', c: ev.bad, who, what: `conflict · in ${Array.isArray(d.pane_ids) ? d.pane_ids.length : 'several'} panes` };
    case 'node_connected':
      return { icon: '◉', c: ev.good, who, what: `connected${str(obj(d.versions).herdr) ? ` · herdr ${esc(str(obj(d.versions).herdr))}` : ''}` };
    case 'node_disconnected':
      return { icon: '◌', c: ev.warn, who, what: 'disconnected' };
    case 'links_changed': {
      // Follows a pane move or a computer's new [links]: housekeeping, shown dim.
      const names = Object.keys(obj(d.new));
      return { icon: '↗', c: ev.muted, who, what: names.length ? `links → ${esc(names.join(', '))}${pane(d.pane_id)}` : 'links removed', quiet: true };
    }
    case 'tokens_changed': {
      // A plugin's display data moved (a prompt, a title, an MR's state): housekeeping, shown dim, naming
      // only the tokens whose text came, went or changed.
      const before = new Map(tokenList(d.old).map((t) => [`${t.source}/${t.name}`, t.text]));
      const after = new Map(tokenList(d.new).map((t) => [`${t.source}/${t.name}`, t.text]));
      const names = [...new Set([...before.keys(), ...after.keys()].filter((k) => before.get(k) !== after.get(k)).map((k) => k.split('/')[1]))];
      return { icon: '◈', c: ev.muted, who, what: `tokens → ${esc(names.join(', ') || 'reordered')}`, quiet: true };
    }
    case 'node_stale':
      return { icon: '◌', c: ev.stale, who, what: 'gone quiet · stale' };
    case 'node_offline':
      return { icon: '✖', c: ev.bad, who, what: 'offline' };
    case 'node_enrolled':
      return { icon: '✚', c: ev.good, who, what: 'computer enrolled' };
    case 'untracked_seen':
      return { icon: '?', c: ev.gold, who, what: `untracked ${esc(str(d.kind) ?? 'agent')}${pane(d.pane_id)} · ${esc(basename(str(d.cwd)))}` };
  }
  if (e.type.startsWith('channel_')) {
    const to = str(d.to) ?? e.type.slice(8);
    return { icon: '⌁', c: channelColor(to), who, what: `${esc(str(d.type) ?? 'channel')} ${esc(to)}${why}` };
  }
  if (/^(grant|credential|principal|token)_/.test(e.type)) {
    return { icon: '·', c: ev.muted, who: 'access', what: esc(e.type.replace(/_/g, ' ')), quiet: true };
  }
  return { icon: '·', c: ev.other, who, what: esc(e.type.replace(/_/g, ' ')) };
}
