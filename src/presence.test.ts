import { describe, expect, it } from 'vitest';
import { activeAt, ASLEEP_MS, byRecency, foldQuiet, isQuiet, packs, PACK_MS, sleeps, type Item } from './presence';
import { DIMMEST } from './recency';
import type { Team } from './teams';
import type { Agent } from './types';

/** A test agent: only the fields these rules read (an unchecked cast; the rest of Agent is unused). */
const agent = (name: string, status = 'idle'): Agent => ({ id: name, name, status }) as unknown as Agent;
const NOW = 1_000_000_000_000;

describe('activeAt', () => {
  it('is now while working, else the last activity, else null', () => {
    const last = new Map([['a', NOW - 5000]]);
    expect(activeAt(agent('a', 'working'), last, NOW)).toBe(NOW);
    expect(activeAt(agent('a'), last, NOW)).toBe(NOW - 5000);
    expect(activeAt(agent('b'), last, NOW)).toBeNull();
  });
});

describe('packs', () => {
  const last = new Map([['old', NOW - PACK_MS - 1], ['new', NOW - 1000]]);
  it('packs agents quiet for over a week, or never seen', () => {
    expect(packs(agent('old'), last, NOW, false, false)).toBe(true);
    expect(packs(agent('never'), last, NOW, false, false)).toBe(true);
    expect(packs(agent('new'), last, NOW, false, false)).toBe(false);
  });
  it('never packs one that works, is blocked, is kept or carries an alarm', () => {
    expect(packs(agent('old', 'working'), last, NOW, false, false)).toBe(false);
    expect(packs(agent('old', 'blocked'), last, NOW, false, false)).toBe(false);
    expect(packs(agent('old'), last, NOW, true, false)).toBe(false);
    expect(packs(agent('old'), last, NOW, false, true)).toBe(false);
  });
});

describe('sleeps', () => {
  const last = new Map([['quiet', NOW - ASLEEP_MS - 60_000], ['recent', NOW - ASLEEP_MS + 60_000]]);
  it('sleeps once idle or done and quiet for over an hour, or never seen', () => {
    expect(sleeps(agent('quiet', 'done'), last, NOW)).toBe(true);
    expect(sleeps(agent('quiet', 'idle'), last, NOW)).toBe(true);
    expect(sleeps(agent('never', 'idle'), last, NOW)).toBe(true);
    expect(sleeps(agent('recent', 'done'), last, NOW)).toBe(false);
  });
  it('never sleeps while working, blocked or in any other state, however quiet', () => {
    for (const status of ['working', 'blocked', 'missing', 'exited']) expect(sleeps(agent('quiet', status), last, NOW)).toBe(false);
  });
});

describe('byRecency', () => {
  const times: Record<string, number | null> = { lead: 10, a: 50, b: 5, sublead: 1, s1: 90, x: null, y: null };
  const at = (a: Agent) => times[a.name] ?? null;
  const sub: Team = { manager: agent('sublead'), agents: [agent('sublead'), agent('s1')], teams: [] };
  const team: Team = { manager: agent('lead'), agents: [agent('lead'), agent('b'), agent('a'), agent('y'), agent('x')], teams: [sub] };
  const names = (items: Item[]): string[] => items.map((i) => ('agent' in i ? i.agent.name : `[${i.team.manager?.name}]`));

  it('orders agents (the lead too) and teams together, most recent first, never-seen by name', () => {
    // The sub-team is as recent as its latest member (s1 at 90), ahead of a (50); the lead (10) sorts in.
    expect(names(byRecency(team, at))).toEqual(['[sublead]', 'a', 'lead', 'b', 'x', 'y']);
  });

  it('orders inside teams the same way, the lead included', () => {
    const inner = byRecency(team, at).find((i) => 'team' in i);
    expect(inner && 'items' in inner ? names(inner.items) : []).toEqual(['s1', 'sublead']);
  });
});

describe('foldQuiet', () => {
  const quietOnes = new Set(['b', 'x', 'sublead']);
  const quiet = (a: Agent) => quietOnes.has(a.name);
  const mixed: Team = { manager: agent('sublead'), agents: [agent('sublead'), agent('s1')], teams: [] };
  const allQuiet: Team = { manager: agent('x'), agents: [agent('x'), agent('b')], teams: [] };
  const items: Item[] = [{ agent: agent('a') }, { team: mixed, items: [] }, { agent: agent('b') }, { team: allQuiet, items: [] }];
  const names = (list: Item[]): string[] => list.map((i) => ('agent' in i ? i.agent.name : `[${i.team.manager?.name}]`));

  it('folds quiet agents and teams whose members are all quiet; a team with anyone awake stays; order kept', () => {
    const { shown, quiet: folded } = foldQuiet(items, quiet);
    expect(names(shown)).toEqual(['a', '[sublead]']);
    expect(names(folded)).toEqual(['b', '[x]']);
  });
});

describe('isQuiet', () => {
  it('is quiet at the dimmest light, and not just above it', () => {
    expect(isQuiet(DIMMEST, agent('a'), null)).toBe(true);
    expect(isQuiet(DIMMEST + 0.001, agent('a'), null)).toBe(false);
    expect(isQuiet(1, agent('a'), null)).toBe(false);
  });

  it('is never quiet when blocked or selected, however dim', () => {
    expect(isQuiet(DIMMEST, agent('a', 'blocked'), null)).toBe(false);
    expect(isQuiet(DIMMEST, agent('a'), 'a')).toBe(false);
    expect(isQuiet(DIMMEST, agent('a'), 'b')).toBe(true);
  });
});
