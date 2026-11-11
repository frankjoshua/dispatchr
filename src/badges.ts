// Badges: an agent's tokens (display data its computer's plugins report, relayed by rostr without
// interpretation; GLOSSARY.md) shown the way the viewer's rules say. Nothing here knows what any token
// means: "mr_failed is a red alarm" is a rule a viewer writes (settings), not code.

import type { Agent, AgentToken } from './types';

export type Urgency = 'alarm' | 'notice' | 'quiet';
export const URGENCIES: Urgency[] = ['alarm', 'notice', 'quiet'];

/** What a badge shows on the map: its icon and text, only the icon (a marker), or only the text. */
export type Show = 'both' | 'icon' | 'text';
export const SHOWS: Show[] = ['both', 'icon', 'text'];

/** The built-in icons a rule can name (`@comment`); icons.ts draws each. */
export const ICON_NAMES = ['alert', 'comment', 'review', 'merge', 'check', 'cross', 'draft', 'running', 'clock', 'bell', 'flag', 'star', 'lock', 'person', 'artifacts'] as const;
export type IconName = (typeof ICON_NAMES)[number];
const ICON_SET: ReadonlySet<string> = new Set(ICON_NAMES);
const isIconName = (s: string): s is IconName => ICON_SET.has(s);

/** A rule's icon names a built-in one: `@` and its name. */
export function iconName(icon: string): IconName | null {
  const name = icon.startsWith('@') ? icon.slice(1) : '';
  return isIconName(name) ? name : null;
}

/** A viewer's rule; the first rule matching a token decides how it shows. */
export interface BadgeRule {
  /** Token name pattern; `*` matches any run of characters (`mr_*`). */
  name: string;
  /** Reporting source pattern; empty or omitted: any source. */
  source?: string;
  /** Leave matching tokens out everywhere. */
  hide?: boolean;
  /** A built-in icon (`@comment`, ICON_NAMES) or an emoji or symbol. */
  icon?: string;
  /** `#rgb` or `#rrggbb`; omitted: the theme's text colour. */
  color?: string;
  /** Default `notice`. */
  urgency?: Urgency;
  /** Default `both`; without an icon, the text is shown. */
  show?: Show;
}

export const DEFAULT_ARTIFACT_RULE: BadgeRule = { name: 'artifacts', icon: '@artifacts', color: '#a371f7', urgency: 'notice', show: 'both' };
export const DEFAULT_SCHEDULE_RULE: BadgeRule = { name: 'schedules', icon: '@clock', color: '#58a6ff', urgency: 'notice', show: 'both' };

export type BadgeAction = 'artifacts' | 'schedules';

export interface Badge {
  source: string;
  name: string;
  icon: string;
  /** The token's text without icon-font glyphs. */
  text: string;
  show: Show;
  color: string | null;
  urgency: Urgency;
  /** Matched by a rule (else shown as is, quiet). */
  ruled: boolean;
  action?: BadgeAction;
}

const NAME = /^[a-z*][a-z0-9_*-]{0,63}$/;
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A compiled pattern (`glob`). */
export interface Glob { test(s: string): boolean }

/**
 * A glob over the whole string: `*` is any run of characters, everything else is literal. Matched
 * left to right without backtracking: a rule is text from an import, tested on every render.
 */
export function glob(pattern: string): Glob {
  const parts = pattern.split('*');
  if (parts.length === 1) return { test: (s) => s === pattern };
  const head = parts[0], tail = parts[parts.length - 1], middle = parts.slice(1, -1).filter(Boolean);
  return {
    test(s) {
      if (s.length < head.length + tail.length || !s.startsWith(head) || !s.endsWith(tail)) return false;
      const end = s.length - tail.length;
      let at = head.length;
      for (const part of middle) {
        const i = s.indexOf(part, at);
        if (i < 0 || i + part.length > end) return false;
        at = i + part.length;
      }
      return true;
    },
  };
}

/** Text without icon-font glyphs (Unicode private-use code points), whitespace collapsed. */
export function plainText(text: string): string {
  return text.replace(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, ' ').replace(/\s+/g, ' ').trim();
}

interface Compiled { rule: BadgeRule; name: Glob; source: Glob | null }
const compiledCache = new WeakMap<readonly BadgeRule[], Compiled[]>();
function compile(rules: readonly BadgeRule[]): Compiled[] {
  let c = compiledCache.get(rules);
  if (!c) compiledCache.set(rules, (c = rules.map((rule) => ({ rule, name: glob(rule.name), source: rule.source ? glob(rule.source) : null }))));
  return c;
}

const RANK: Record<Urgency, number> = { alarm: 0, notice: 1, quiet: 2 };

/**
 * An agent's badges: each token through the first rule that matches it (hidden ones dropped);
 * tokens no rule matches show as they are, quiet. Most urgent first, then in rule order, then in
 * the order rostr gave them. Every token stays (a token is its source and name); `coalesce` merges
 * the ones that would look the same.
 */
export function badgesFor(tokens: readonly AgentToken[], rules: readonly BadgeRule[]): Badge[] {
  const compiled = compile(rules);
  const out: { badge: Badge; at: number; i: number }[] = [];
  tokens.forEach((t, i) => {
    const at = compiled.findIndex((c) => c.name.test(t.name) && (!c.source || c.source.test(t.source)));
    const rule = at >= 0 ? compiled[at].rule : null;
    if (rule?.hide) return;
    const text = plainText(t.text);
    const badge: Badge = rule
      ? { source: t.source, name: t.name, icon: rule.icon ?? '', text, show: rule.icon ? rule.show ?? 'both' : 'text', color: rule.color ?? null, urgency: rule.urgency ?? 'notice', ruled: true }
      : { source: t.source, name: t.name, icon: '', text, show: 'text', color: null, urgency: 'quiet', ruled: false };
    out.push({ badge, at: at >= 0 ? at : rules.length, i });
  });
  return out.sort((a, b) => RANK[a.badge.urgency] - RANK[b.badge.urgency] || a.at - b.at || a.i - b.i).map((x) => x.badge);
}

/** What a badge shows on the map: its icon (or none), its text (or none), and whether it is a marker. */
export interface Look { icon: string; text: string; marker: boolean }

/**
 * How a badge looks on the map. `text` never shows an icon, at any zoom; `icon` is always a marker;
 * `both` is a pill up close and its marker when `far`. With neither text nor an icon, it shows the
 * token name.
 */
export function badgeLook(b: Badge, far: boolean): Look {
  const icon = b.show === 'text' ? '' : b.icon;
  const marker = !!icon && (b.show === 'icon' || far);
  return { icon, marker, text: marker ? '' : b.text || (icon ? '' : b.name) };
}

/**
 * Badges that would look the same (a token herdr reports for both the workspace and the pane) as one,
 * its `source` listing every source it came from; order kept.
 */
export function coalesce(badges: readonly Badge[]): Badge[] {
  const byLook = new Map<string, Badge>();
  for (const b of badges) {
    const key = lookOf(b);
    const same = byLook.get(key);
    if (same) same.source = `${same.source}, ${b.source}`;
    else byLook.set(key, { ...b });
  }
  return [...byLook.values()];
}

const lookOf = (b: Badge) => [b.name, b.text, b.icon, b.show, b.color, b.urgency, b.ruled].join('\n');

/**
 * For the map: agents sharing a workspace (two panes in one worktree) all carry the workspace's
 * tokens, so a shared badge they carry alike shows on the first of them only; anything else (a pane's
 * own tokens) stays on every agent. `lists` in the order to prefer (first gets it); `workspaceOf`
 * names an agent's workspace, null when it has none of its own; `shared` says which badges come from
 * the workspace.
 */
export function onePerWorkspace(lists: ReadonlyMap<string, readonly Badge[]>, workspaceOf: (id: string) => string | null, shared: (b: Badge) => boolean): Map<string, Badge[]> {
  const shown = new Map<string, Set<string>>();
  const out = new Map<string, Badge[]>();
  for (const [id, badges] of lists) {
    const ws = workspaceOf(id);
    if (ws === null) { out.set(id, [...badges]); continue; }
    let seen = shown.get(ws);
    if (!seen) shown.set(ws, (seen = new Set()));
    const kept: Badge[] = [];
    for (const b of badges) {
      if (shared(b)) {
        const key = lookOf(b);
        if (seen.has(key)) continue;
        seen.add(key);
      }
      kept.push(b);
    }
    out.set(id, kept);
  }
  return out;
}

/** What placing an agent's badges needs: its tokens, its workspace, and its age within the workspace. */
export type Carrier = Pick<Agent, 'id' | 'tokens' | 'artifacts' | 'created_at' | 'node_id' | 'workspace_label'>;

interface ScheduleAssociation { space_slug: string; execution: { agent_ids: readonly string[] } }

export function scheduleBadgeCounts(records: Iterable<ScheduleAssociation>, spaces: ReadonlySet<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const schedule of records) {
    if (spaces.size && !spaces.has(schedule.space_slug)) continue;
    for (const id of schedule.execution.agent_ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

const NO_SCHEDULE_COUNTS: ReadonlyMap<string, number> = new Map();

/** The viewer's badge rules: for tokens, and for the artifact and schedule counts. */
export interface BadgeRuleSet {
  rules: readonly BadgeRule[];
  artifacts: BadgeRule;
  schedules: BadgeRule;
}

/**
 * The badges each agent shows, on the map and in the units list: its tokens through the rules, alike
 * ones as one, and a workspace's shared tokens once, on its oldest agent. Unruled badges are included
 * (the card shows them); the map and list show only ruled ones.
 */
export function agentBadges(agents: Iterable<Carrier>, ruleSet: BadgeRuleSet, scheduleCounts: ReadonlyMap<string, number> = NO_SCHEDULE_COUNTS): Map<string, Badge[]> {
  const carriers = [...agents].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const workspace = new Map(carriers.map((a) => [a.id, a.workspace_label ? `${a.node_id}/${a.workspace_label}` : null]));
  const lists = onePerWorkspace(new Map(carriers.map((a) => [a.id, coalesce(badgesFor(a.tokens ?? [], ruleSet.rules))])),
    (id) => workspace.get(id) ?? null, (b) => b.source.split(', ').includes('herdr-workspace'));
  for (const a of carriers) {
    const list = lists.get(a.id)!;
    const artifact = artifactBadge(a.artifacts?.length ?? 0, ruleSet.artifacts);
    if (artifact) list.push(artifact);
    const schedule = scheduleBadge(scheduleCounts.get(a.id) ?? 0, ruleSet.schedules);
    if (schedule) list.push(schedule);
    list.sort((a, b) => RANK[a.urgency] - RANK[b.urgency]);
  }
  return lists;
}

/** Whether an agent carries an alarm badge, from a token, its artifact count or its schedule count (it is never packed away). */
export function carriesAlarm(a: Carrier, ruleSet: BadgeRuleSet, scheduleCount: number): boolean {
  return badgesFor(a.tokens ?? [], ruleSet.rules).some((b) => b.urgency === 'alarm')
    || artifactBadge(a.artifacts?.length ?? 0, ruleSet.artifacts)?.urgency === 'alarm'
    || scheduleBadge(scheduleCount, ruleSet.schedules)?.urgency === 'alarm';
}

export function artifactBadge(count: number, rule: BadgeRule): Badge | null {
  return countBadge(count, rule, 'artifacts');
}

export function scheduleBadge(count: number, rule: BadgeRule): Badge | null {
  return countBadge(count, rule, 'schedules');
}

function countBadge(count: number, rule: BadgeRule, action: BadgeAction): Badge | null {
  if (!count || rule.hide) return null;
  return {
    source: 'rostr', name: action, icon: rule.icon ?? '', text: String(count),
    show: rule.icon ? rule.show ?? 'both' : 'text', color: rule.color ?? null,
    urgency: rule.urgency ?? 'notice', ruled: true, action,
  };
}

export function badgesInStack(badges: readonly Badge[], limit: number): Badge[] {
  const shown = badges.slice(0, limit);
  for (const badge of badges) {
    if (!badge.action || shown.includes(badge)) continue;
    for (let i = shown.length - 1; i >= 0; i--) {
      if (shown[i].action) continue;
      shown[i] = badge;
      break;
    }
  }
  return shown.sort((a, b) => badges.indexOf(a) - badges.indexOf(b));
}

/** Rules from storage or an import: keeps the well-formed ones, drops the rest. */
export function parseRules(value: unknown): BadgeRule[] {
  if (!Array.isArray(value)) return [];
  const out: BadgeRule[] = [];
  for (const v of value) {
    if (typeof v !== 'object' || v === null) continue;
    const o = v as Record<string, unknown>;
    if (typeof o.name !== 'string' || !NAME.test(o.name)) continue;
    const rule: BadgeRule = { name: o.name };
    if (typeof o.source === 'string' && o.source) rule.source = o.source.slice(0, 64);
    if (o.hide === true) rule.hide = true;
    // A built-in icon by name, else up to two characters (an emoji, a symbol).
    if (typeof o.icon === 'string' && o.icon) {
      if (o.icon.startsWith('@')) { if (iconName(o.icon)) rule.icon = o.icon; } else rule.icon = [...o.icon].slice(0, 2).join('');
    }
    if (typeof o.color === 'string' && COLOR.test(o.color)) rule.color = o.color.length === 4 ? `#${[...o.color.slice(1)].map((c) => c + c).join('')}`.toLowerCase() : o.color.toLowerCase();
    if (typeof o.urgency === 'string' && (URGENCIES as string[]).includes(o.urgency)) rule.urgency = o.urgency as Urgency;
    if (typeof o.show === 'string' && (SHOWS as string[]).includes(o.show)) rule.show = o.show as Show;
    else if (o.iconOnly === true) rule.show = 'icon'; // rules saved before show existed
    out.push(rule);
  }
  return out;
}

/** Ready-made rule sets for common plugins, as data (a viewer adds them, then edits freely). */
export const PRESETS: { id: string; label: string; rules: BadgeRule[] }[] = [
  {
    id: 'mr-status',
    label: 'Merge requests (mr_* tokens)',
    rules: [
      { name: 'mr_failed', icon: '@alert', color: '#f85149', urgency: 'alarm' },
      { name: 'mr_comments', icon: '@comment', color: '#f0883e', urgency: 'notice' },
      { name: 'mr_review', icon: '@review', color: '#58a6ff', urgency: 'notice' },
      { name: 'mr_opened', icon: '@merge', color: '#3fb950', urgency: 'notice' },
      { name: 'mr_merged', icon: '@check', color: '#a371f7', urgency: 'quiet' },
      { name: 'mr_closed', icon: '@cross', color: '#8b949e', urgency: 'quiet' },
      { name: 'mr_draft', icon: '@draft', color: '#8b949e', urgency: 'quiet' },
    ],
  },
];
