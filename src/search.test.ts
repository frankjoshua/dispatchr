import { describe, expect, it } from 'vitest';
import { searchAgents } from './search';
import type { Agent } from './types';

const NOW = 1_000_000_000_000;
const agent = (name: string, status = 'idle', workspace_label: string | null = null): Agent =>
  ({ id: name, name, status, workspace_label }) as Agent;
const find = (agents: Agent[], query: string, last: ReadonlyMap<string, number> = new Map()) =>
  searchAgents(agents, query, last, NOW).map((a) => a.name);
const ciSpeed = 'chore-ci-speed-improvements';

describe('agent search', () => {
  it('matches a fragment inside a word, ignoring case and leading change kinds', () => {
    expect(find([agent(ciSpeed)], 'PEED')).toEqual([ciSpeed]);
  });

  it('finds a hyphenated name from partial words separated by spaces', () => {
    expect(find([agent(ciSpeed)], 'CI sp')).toEqual([ciSpeed]);
  });

  it('matches nonadjacent fragments in either order', () => {
    expect(find([agent(ciSpeed)], 'impr ci')).toEqual([ciSpeed]);
  });

  it('treats query and name separators alike', () => {
    expect(find([agent('chore/ci_speed.improvements')], '  CI--sp\t')).toEqual(['chore/ci_speed.improvements']);
  });

  it('requires every fragment, rather than returning an agent for just one', () => {
    expect(find([agent(ciSpeed)], 'ci cleanup')).toEqual([]);
  });

  it('also finds fragments in a workspace label', () => {
    expect(find([agent('build-worker', 'idle', 'Team/CI_speed-improvements')], 'ci impr')).toEqual(['build-worker']);
  });

  it('does not invent a match when the name misses and the label is absent', () => {
    expect(find([agent('fix-rendering')], 'ci')).toEqual([]);
  });

  it('returns every matching agent, including a recent match beyond the first eight', () => {
    const names = Array.from({ length: 20 }, (_, i) => `ci-task-${String(i + 1).padStart(2, '0')}`);
    const last = new Map(names.map((name, i) => [name, NOW - (i + 1) * 1000]));
    last.set(ciSpeed, NOW - 1);
    const agents = [...names.map((name) => agent(name)), agent(ciSpeed), agent('fix-database')];
    expect(find(agents, 'ci', last)).toEqual([ciSpeed, ...names]);
  });

  it('orders by activity, not by name-prefix or label match strength', () => {
    const agents = [agent('ci-old'), agent(ciSpeed), agent('worker', 'idle', 'CI review')];
    const last = new Map([['ci-old', NOW - 3000], [ciSpeed, NOW - 2000], ['worker', NOW - 1000]]);
    expect(find(agents, 'ci', last)).toEqual(['worker', ciSpeed, 'ci-old']);
  });

  it('lists all agents by recency when the query is empty', () => {
    const agents = [agent('old'), agent('never'), agent('new')];
    const last = new Map([['old', NOW - 2000], ['new', NOW - 1000]]);
    expect(find(agents, '   ', last)).toEqual(['new', 'old', 'never']);
  });

  it('puts working agents first and keeps tied or unknown activity ordered by name', () => {
    const agents = ['never-z', 'recent-z', 'working', 'never-a', 'recent-a']
      .map((name) => agent(name, name === 'working' ? 'working' : 'idle'));
    const last = new Map([['working', NOW - 5000], ['recent-z', NOW - 1000], ['recent-a', NOW - 1000]]);
    expect(find(agents, '', last)).toEqual(['working', 'recent-a', 'recent-z', 'never-a', 'never-z']);
  });
});
