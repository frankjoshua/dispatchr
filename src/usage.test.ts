import { beforeAll, describe, expect, it } from 'vitest';
import { store } from './store';
import { helpersOf, newestSessions, usage } from './usage';
import type { Agent, UsageRow } from './types';

const HOUR_MS = 3_600_000;
const row = (r: Partial<UsageRow>): UsageRow => ({ input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, cost: 0, cost_complete: true, ...r });

describe('newestSessions', () => {
  const EARLY = '2026-10-19T10:00:00.000Z', LATE = '2026-10-19T11:00:00.000Z';
  const sessions = (rows: UsageRow[]) => Object.fromEntries([...newestSessions(rows)].map(([id, s]) => [id, s.session]));

  it("picks each agent's session with the newest usage hour, in whatever order the rows come", () => {
    const rows = [
      row({ agent_id: 'one', session: 'second', hour: LATE }),
      row({ agent_id: 'one', session: 'first', hour: EARLY }),
      row({ agent_id: 'two', session: 'first', hour: EARLY }),
      row({ agent_id: 'one', session: 'second', hour: EARLY }),
    ];
    expect(sessions(rows)).toEqual({ one: 'second', two: 'first' });
    expect(sessions([...rows].reverse())).toEqual({ one: 'second', two: 'first' });
  });

  it('breaks a tie on the hour by the greater session ref', () => {
    const a = row({ agent_id: 'one', session: 'session-a', hour: LATE }), b = row({ agent_id: 'one', session: 'session-b', hour: LATE });
    expect(sessions([a, b])).toEqual({ one: 'session-b' });
    expect(sessions([b, a])).toEqual({ one: 'session-b' });
    // The hour decides first: a greater ref in an older hour loses.
    expect(sessions([a, row({ agent_id: 'one', session: 'session-z', hour: EARLY })])).toEqual({ one: 'session-a' });
  });

  it('ignores rows that name no agent, session or hour', () => {
    expect(sessions([
      row({ session: 'stray', hour: LATE }),
      row({ agent_id: 'one', hour: LATE }),
      row({ agent_id: 'one', session: 'undated' }),
    ])).toEqual({});
  });
});

describe('helpersOf', () => {
  it("lists each agent's named subagents and advisors, the busiest first by every kind of token", () => {
    const rows = [
      row({ agent_id: 'one', role: 'subagent', name: 'scout', input: 10, output: 20 }),
      row({ agent_id: 'one', role: 'advisor', name: 'critic', cache_read: 500 }),
      row({ agent_id: 'one', role: 'subagent', name: 'builder', reasoning: 40, cache_write: 60 }),
      row({ agent_id: 'two', role: 'advisor', name: 'critic', input: 1 }),
    ];
    expect(Object.fromEntries(helpersOf(rows))).toEqual({
      one: [{ role: 'advisor', name: 'critic' }, { role: 'subagent', name: 'builder' }, { role: 'subagent', name: 'scout' }],
      two: [{ role: 'advisor', name: 'critic' }],
    });
  });

  it('ignores the main session, helper rows and rows without a name or an agent, however busy', () => {
    const rows = [
      row({ agent_id: 'one', role: 'main', name: 'main', output: 9000 }),
      row({ agent_id: 'one', role: 'helper', name: 'titler', output: 8000 }),
      row({ agent_id: 'one', role: 'subagent', name: null, output: 7000 }),
      row({ agent_id: 'one', role: 'advisor', output: 6000 }),
      row({ role: 'subagent', name: 'stray', output: 5000 }),
      row({ agent_id: 'one', role: 'subagent', name: 'scout', output: 1 }),
    ];
    expect(Object.fromEntries(helpersOf(rows))).toEqual({ one: [{ role: 'subagent', name: 'scout' }] });
    expect(helpersOf(rows.slice(0, 5)).size).toBe(0);
  });
});

describe('current session', () => {
  let rows: UsageRow[] = [];
  beforeAll(() => usage.start({
    usage: async (q) => ({
      from: q.from ?? '', to: '', by: q.by.split(','),
      rows: rows.filter((r) => (!q.agent || r.agent_id === q.agent) && (!q.from || !r.hour || r.hour >= q.from)),
    }),
  }));

  /** Usage of agent `one` in `session`, in the hour `hoursAgo` before this one. */
  const spent = (session: string, hoursAgo: number, cost: number) => row({
    agent_id: 'one', session, role: 'main', name: null, model: 'model', cost,
    hour: new Date((Math.floor(Date.now() / HOUR_MS) - hoursAgo) * HOUR_MS).toISOString(),
  });

  /** What usage shows for agent `one` with `recorded` as rostr's session for it, given `usageRows`. */
  async function shown(recorded: string | null, usageRows: UsageRow[]) {
    const one: Agent = {
      id: 'one', name: 'one', space_id: 'work-space', space_slug: 'work', node_id: 'work-node', node_name: 'workstation',
      kind: 'omp', launcher: 'herdr', profile: 'omp', cwd: '/work/project', workspace_label: null,
      session_id: recorded, resume: true, relaunch_on_exit: false, enabled: true, tags: [], notes: '',
      principal_id: 'principal-one', created_at: '2026-10-19T12:00:00Z', retired_at: null, status: 'idle',
      node_state: 'online', channels: [], links: {}, reports_to: null,
    };
    store.all = new Map([[one.id, one]]);
    rows = usageRows;
    await usage.refresh();
    const u = usage.agents.get(one.id);
    return u && { session: u.session, cost: u.cost };
  }

  it('is the session rostr recorded, even when another has newer usage', async () => {
    expect(await shown('recorded', [spent('recorded', 30, 1), spent('newer', 1, 10)])).toEqual({ session: 'recorded', cost: 1 });
  });

  it('is the session with the newest usage when rostr has recorded none', async () => {
    expect(await shown(null, [spent('older', 30, 1), spent('newer', 1, 10), spent('newer', 2, 5)])).toEqual({ session: 'newer', cost: 15 });
  });

  it('is the greater session ref when two sessions spent in the same newest hour', async () => {
    expect(await shown(null, [spent('session-b', 2, 2), spent('session-a', 2, 1)])).toEqual({ session: 'session-b', cost: 2 });
  });

  it('is still the newest session when the agent has spent nothing for over a week', async () => {
    expect(await shown(null, [spent('long-ago', 60 * 24, 2), spent('last-month', 30 * 24, 1)])).toEqual({ session: 'last-month', cost: 1 });
  });

  it('shows nothing for an agent without a session or usage', async () => {
    expect(await shown(null, [])).toBeUndefined();
  });
});
