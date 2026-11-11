// Viewer settings, remembered per browser. The theme has its own picker (theme.ts); everything else
// lives in the ⚙ menu, badge rules in its Badges editor.

import { DEFAULT_ARTIFACT_RULE, DEFAULT_SCHEDULE_RULE, parseRules, type BadgeRule, type BadgeRuleSet } from './badges';

export interface Settings {
  /** Pane ids as labels on the map. */
  mapDetails: boolean;
  /** Agents dim the longer they have been quiet, relative to the others (recency.ts). */
  dimQuiet: boolean;
  /** Agents quiet for over a week leave the map (map.ts); lists and search still have them. */
  packQuiet: boolean;
  /** Idle or done agents quiet for over an hour show only their place, not their character (presence.ts sleeps). */
  hideSleepers: boolean;
  /** Restrict navigation to done, blocked and ruled-alarm agents; never to recent visits. */
  navigationAttentionOnly: boolean;
}

const KEY = 'dispatchr.settings';
const DEFAULTS: Settings = { mapDetails: false, dimQuiet: true, packQuiet: true, hideSleepers: true, navigationAttentionOnly: true };

function load(): Settings {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
    const flag = (k: keyof Settings) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : DEFAULTS[k]);
    return { mapDetails: flag('mapDetails'), dimQuiet: flag('dimQuiet'), packQuiet: flag('packQuiet'),
      hideSleepers: flag('hideSleepers'), navigationAttentionOnly: flag('navigationAttentionOnly') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: Settings = load();

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  settings[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode: not remembered */ }
}

// ─── badge rules (badges.ts): how this viewer shows agents' tokens; none until they add some

const BADGE_KEYS = { rules: 'dispatchr.badges', artifacts: 'dispatchr.artifacts.badge', schedules: 'dispatchr.schedules.badge' } as const;
type BadgeKind = keyof typeof BADGE_KEYS;
type CountKind = Exclude<BadgeKind, 'rules'>;
export type BadgeSaveResult = 'saved' | 'conflict' | 'unavailable';

// Keep the raw value read by this tab: an older editor must not replace another tab's newer rules.
let storedBadgeValues = new Map<BadgeKind, string | null>();

function readBadgeSettings(): BadgeRuleSet {
  const values = new Map((Object.keys(BADGE_KEYS) as BadgeKind[]).map((kind) => [kind, localStorage.getItem(BADGE_KEYS[kind])]));
  const rawRules: unknown = JSON.parse(values.get('rules') ?? '[]');
  const rules = parseRules(rawRules);
  if (!Array.isArray(rawRules) || rules.length !== rawRules.length) throw new TypeError('Invalid saved token rules');
  const count = (kind: CountKind, fallback: BadgeRule) =>
    ({ ...(parseRules([JSON.parse(values.get(kind) ?? 'null')])[0] ?? fallback), name: kind });
  const next = {
    rules,
    artifacts: count('artifacts', DEFAULT_ARTIFACT_RULE),
    schedules: count('schedules', DEFAULT_SCHEDULE_RULE),
  };
  storedBadgeValues = values;
  return next;
}

function loadBadges(): BadgeRuleSet {
  try {
    return readBadgeSettings();
  } catch {
    return { rules: [], artifacts: { ...DEFAULT_ARTIFACT_RULE }, schedules: { ...DEFAULT_SCHEDULE_RULE } };
  }
}

/** The viewer's badge rules; replaced whole (never mutated) so caches keyed on the array stay right. */
export const badges: BadgeRuleSet = loadBadges();

/** Refresh when opening the editor, including edits saved by another tab since this one loaded. */
export function reloadBadgeSettings(): boolean {
  try {
    Object.assign(badges, readBadgeSettings());
    return true;
  } catch {
    return false;
  }
}

export function onBadgeStorageChange(fn: () => void) {
  addEventListener('storage', (event) => {
    if (event.key === null || Object.values(BADGE_KEYS).some((key) => key === event.key)) fn();
  });
}

function saveBadgeValue(kind: BadgeKind, value: BadgeRule | readonly BadgeRule[]): BadgeSaveResult {
  try {
    if (!storedBadgeValues.has(kind)) return 'unavailable';
    if (localStorage.getItem(BADGE_KEYS[kind]) !== storedBadgeValues.get(kind)) return 'conflict';
    const json = JSON.stringify(value);
    localStorage.setItem(BADGE_KEYS[kind], json);
    storedBadgeValues.set(kind, json);
    return 'saved';
  } catch {
    return 'unavailable';
  }
}

export function setBadgeRules(rules: BadgeRule[]): BadgeSaveResult {
  const result = saveBadgeValue('rules', rules);
  if (result === 'saved') badges.rules = rules;
  return result;
}

export function setCountRule(kind: CountKind, rule: BadgeRule): BadgeSaveResult {
  const next = { ...rule, name: kind };
  const result = saveBadgeValue(kind, next);
  if (result === 'saved') badges[kind] = next;
  return result;
}

// ─── folds: sets of keys, each toggled and remembered

function loadKeys(storageKey: string): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function toggleKey(keys: Set<string>, storageKey: string, key: string) {
  if (!keys.delete(key)) keys.add(key);
  try { localStorage.setItem(storageKey, JSON.stringify([...keys])); } catch { /* private mode: not remembered */ }
}

// Units list: by default every section is open and its quiet agents folded; this holds the keys that
// differ (a section folded, `quiet/` + a section opened to its quiet agents).
const SECTIONS_KEY = 'dispatchr.sections';
const sectionSet = loadKeys(SECTIONS_KEY);
/** Units-list keys toggled away from the default. */
export const sections: ReadonlySet<string> = sectionSet;

export function toggleSection(key: string) {
  toggleKey(sectionSet, SECTIONS_KEY, key);
}

const FOLDS_KEY = 'dispatchr.folded';
const foldSet = loadKeys(FOLDS_KEY);
/** The panels folded away: `left`, `right` (the side panels) and `card` (the unit card, to its header). */
export const folds: ReadonlySet<string> = foldSet;

export function toggleFold(panel: string) {
  toggleKey(foldSet, FOLDS_KEY, panel);
}
