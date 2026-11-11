import type { Agent } from './types';

// What the viewer focuses on, remembered per browser: agents in any of the chosen spaces and with any of
// the chosen tags (both, when both are chosen). Nothing chosen in a group means that group lets all through.
// Everything else in dispatchr acts as if a filtered-out agent did not exist (see store.ts).

const KEY = 'dispatchr.filter';

export const filter = { spaces: new Set<string>(), tags: new Set<string>() };

function load() {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
    const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
    filter.spaces = new Set(strings(o.spaces));
    filter.tags = new Set(strings(o.tags));
  } catch { /* nothing remembered */ }
}
load();

export const filterActive = () => filter.spaces.size > 0 || filter.tags.size > 0;

/** Whether the agent passes the filter. `spaces` holds space slugs. */
export function passes(a: Agent): boolean {
  return (!filter.spaces.size || filter.spaces.has(a.space_slug)) && (!filter.tags.size || a.tags.some((t) => filter.tags.has(t)));
}

/**
 * Every space (by slug) and tag among the agents with how many carry each, and any chosen one that
 * none carries now (at 0, so it can still be cleared).
 */
export function facets(agents: Iterable<Agent>, chosen: Readonly<typeof filter>): { spaces: Map<string, number>; tags: Map<string, number> } {
  const spaces = new Map<string, number>(), tags = new Map<string, number>();
  for (const a of agents) {
    spaces.set(a.space_slug, (spaces.get(a.space_slug) ?? 0) + 1);
    for (const t of a.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
  }
  for (const s of chosen.spaces) if (!spaces.has(s)) spaces.set(s, 0);
  for (const t of chosen.tags) if (!tags.has(t)) tags.set(t, 0);
  return { spaces, tags };
}

export function saveFilter() {
  try { localStorage.setItem(KEY, JSON.stringify({ spaces: [...filter.spaces], tags: [...filter.tags] })); } catch { /* private mode */ }
}
