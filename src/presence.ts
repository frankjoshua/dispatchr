// Pure packing, sleep and recency rules shared by the map and panels.

import { DIMMEST } from './recency';
import { teamMembers, type Team } from './teams';
import type { Agent } from './types';

/** Quiet this long, an agent is packed away (settings.packQuiet) unless working, blocked, kept or alarmed. */
export const PACK_MS = 7 * 86_400_000;
/** Idle or done and quiet this long, an agent is asleep (settings.hideSleepers): its character has gone home. */
export const ASLEEP_MS = 60 * 60_000;
/** This many of the most recently active agents keep their names on at any zoom. */
export const NAMED = 8;

/** When an agent was last active (ms): now while it works, else its last activity; null if never seen. */
export function activeAt(a: Agent, last: ReadonlyMap<string, number>, now: number): number | null {
  return a.status === 'working' ? now : last.get(a.id) ?? null;
}

/** Whether an agent is packed away: quiet for over PACK_MS (or never seen), and not working, blocked, kept or alarmed. */
export function packs(a: Agent, last: ReadonlyMap<string, number>, now: number, kept: boolean, alarmed: boolean): boolean {
  if (kept || alarmed || a.status === 'working' || a.status === 'blocked') return false;
  const t = last.get(a.id);
  return t === undefined || now - t > PACK_MS;
}

/**
 * Whether an agent is asleep: idle or done, and quiet for over ASLEEP_MS (or never seen). Only its own
 * activity wakes it; being selected or looked at does not.
 */
export function sleeps(a: Agent, last: ReadonlyMap<string, number>, now: number): boolean {
  if (a.status !== 'idle' && a.status !== 'done') return false;
  const t = last.get(a.id);
  return t === undefined || now - t > ASLEEP_MS;
}

/** A row of a recency-ordered team: an agent, or a team with its own rows. */
export type Item = { agent: Agent } | { team: Team; items: Item[] };

/** The latest activity of anyone in a team (its lead included); -Infinity if none was ever seen. */
export function teamRecency(t: Team, at: (a: Agent) => number | null): number {
  return Math.max(-Infinity, ...teamMembers(t).map((a) => at(a) ?? -Infinity));
}

/**
 * A team's rows, most recently active first: its agents (the lead too: its name heads the team) and the
 * teams inside it together, each team as recent as its most recent member; never-seen and tied ones by
 * name.
 */
export function byRecency(t: Team, at: (a: Agent) => number | null): Item[] {
  const rows: { item: Item; when: number; name: string }[] = [
    ...t.agents.map((a) => ({ item: { agent: a } as Item, when: at(a) ?? -Infinity, name: a.name })),
    ...t.teams.map((sub) => ({ item: { team: sub, items: byRecency(sub, at) } as Item, when: teamRecency(sub, at), name: sub.manager?.name ?? '' })),
  ];
  return rows.sort((a, b) => b.when - a.when || a.name.localeCompare(b.name)).map((r) => r.item);
}

/**
 * Whether an agent is quiet in the units list: at the map's dimmest (`lit`, its light from recency.ts);
 * never a blocked or the selected agent.
 */
export function isQuiet(lit: number, a: Agent, selected: string | null): boolean {
  return lit <= DIMMEST && a.status !== 'blocked' && a.id !== selected;
}

/** A team's rows split into those shown and the quiet ones folded away; a team is quiet when all its members are. Order kept. */
export function foldQuiet(items: Item[], quiet: (a: Agent) => boolean): { shown: Item[]; quiet: Item[] } {
  const folds = (i: Item) => ('agent' in i ? quiet(i.agent) : teamMembers(i.team).every(quiet));
  return { shown: items.filter((i) => !folds(i)), quiet: items.filter(folds) };
}

