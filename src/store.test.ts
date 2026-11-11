import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { castFor, effortTier } from './inference';
import { runTime } from './runs';
import type { RostrSource, StreamItem } from './store';
import type { Agent, Inference, RostrEvent } from './types';

const AT = '2026-10-19T12:00:00Z';
function agent(id: string): Agent {
  return {
    id, name: id, space_id: 'work-space', space_slug: 'work', node_id: 'work-node', node_name: 'workstation',
    kind: 'omp', launcher: 'herdr', profile: 'omp', cwd: '/work/project', workspace_label: 'project',
    session_id: null, resume: true, relaunch_on_exit: false, enabled: true, tags: [], notes: '',
    principal_id: `principal-${id}`, created_at: AT, retired_at: null, status: 'working', node_state: 'online',
    channels: [], links: {}, tokens: [], artifacts: [], reports_to: null,
  };
}

const observation = (model: string, configured: string | null, level: string | null): Inference => ({
  model: { id: model, provider: null, source: 'omp-response', reported_at: AT },
  effort: { configured, level, source: 'omp-thinking', reported_at: null },
});

const event = (seq: number, agentId: string, type: string, data: RostrEvent['data'] = {}, at = AT): RostrEvent =>
  ({ seq, at, space_id: 'work-space', node_id: 'work-node', agent_id: agentId, actor_id: null, type, data });

/** A rostr with a fixed history and a changeable agent list; `send` delivers a live event. */
function fakeRostr(initial: Agent[], history: RostrEvent[] = []) {
  let agents = initial;
  let next = Promise.withResolvers<RostrEvent>();
  const source: RostrSource = {
    nodes: async () => [],
    agents: async () => structuredClone(agents),
    spaces: async () => [{ id: 'work-space', name: 'Work', slug: 'work' }],
    events: async (since) => ({ events: since ? [] : history, next: history.at(-1)?.seq ?? 0 }),
    async *stream(_since, onOpen): AsyncIterable<StreamItem> {
      onOpen();
      for (;;) {
        const sent = await next.promise;
        next = Promise.withResolvers<RostrEvent>();
        yield { kind: 'event', event: sent };
      }
    },
  };
  return {
    source,
    setAgents(list: Agent[]) { agents = list; },
    async send(e: RostrEvent) {
      next.resolve(e);
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

async function liveAgent(initial: Agent, history: RostrEvent[] = []) {
  // Reload the singleton after resetModules and storage stubs; a static import retains prior tests' state.
  const { store } = await import('./store');
  const rostr = fakeRostr([initial], history);
  let seq = history.at(-1)?.seq ?? 0;
  await store.start(rostr.source);
  await vi.advanceTimersByTimeAsync(0);
  return {
    store,
    send: (type: string, data: RostrEvent['data']) => rostr.send(event(++seq, initial.id, type, data)),
    replaceSnapshot(value: Agent) { rostr.setAgents([value]); },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('localStorage', { getItem: () => null });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('new agents arriving before their snapshot', () => {
  it.each(['agent_created', 'adopted'])('publishes only complete agents while an %s refetch is delayed', async (type) => {
    const { store } = await import('./store');
    const existing = agent('existing'), added = agent('new-agent');
    const pending = Promise.withResolvers<Agent[]>();
    const batch = Promise.withResolvers<RostrEvent[]>();
    let inventory: Promise<Agent[]> = Promise.resolve([existing]);
    const source: RostrSource = {
      nodes: async () => [], agents: () => inventory,
      spaces: async () => [{ id: 'work-space', name: 'Work', slug: 'work' }],
      events: async () => ({ events: [], next: 0 }),
      async *stream(_since, onOpen): AsyncIterable<StreamItem> {
        onOpen();
        for (const event of await batch.promise) yield { kind: 'event', event };
        await new Promise(() => {});
      },
    };
    const observed: Agent[][] = [];
    store.onChange(() => { observed.push([...store.agents.values()]); });
    await store.start(source);
    inventory = pending.promise;
    const base = { at: AT, space_id: 'work-space', node_id: 'work-node', agent_id: added.id, actor_id: null };
    // Creation events carry desiredRow, not AgentView: no created_at, node_id or channels.
    batch.resolve([
      { ...base, seq: 1, type, data: { agent: {
        id: added.id, space_id: added.space_id, space_slug: added.space_slug, name: added.name, kind: added.kind,
        launcher: added.launcher, profile: added.profile, cwd: added.cwd, workspace_label: added.workspace_label,
        session_id: null, resume: true, relaunch_on_exit: false, enabled: true, tags: [], revision: 1, reports_to: null,
      } } },
      { ...base, seq: 2, type: 'status_changed', data: { old: 'idle', new: 'working' } },
    ]);
    await vi.advanceTimersByTimeAsync(1500);
    expect([...store.agents.keys()]).toEqual([existing.id]);
    expect(observed.flat().map((item) => item.id)).not.toContain(added.id);
    expect(store.events.map((event) => event.type)).toEqual([type, 'status_changed']);
    pending.resolve([existing, added]);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.agents.get(added.id)).toEqual(added);
  });
});

describe('main-session observations', () => {
  it('shows the snapshot rather than replaying older model or effort observations over it', async () => {
    const initial = { ...agent('observed'), status: 'idle', inference: observation('claude-sonnet-5-5', null, 'xhigh') };
    const { store } = await liveAgent(initial, [{
      seq: 1, at: AT, space_id: initial.space_id, node_id: initial.node_id, agent_id: initial.id,
      actor_id: null, type: 'inference_changed',
      data: { old: null, new: observation('claude-opus-5-5', 'max', null), pane_id: 'w1:p1' },
    }]);
    const shown = store.agents.get(initial.id)!;
    expect(castFor(shown)).toBe('pi');
    expect(effortTier(shown.inference)).toBe(2);
    expect(shown.inference).toEqual(initial.inference);
    expect(store.lastActive.has(initial.id)).toBe(false);
  });

  it('changes live visual facts without inventing activity, a run or a reported provider', async () => {
    const initial = { ...agent('observed'), kind: 'claude', status: 'idle' };
    const { store, send } = await liveAgent(initial);
    const active = Date.parse(AT) - 7_200_000;
    store.noteActive(initial.id, active);
    const raw = observation('openai-codex/gpt-6.1-sol', 'auto', 'max');
    await send('inference_changed', { old: null, new: raw, pane_id: 'w1:p1' });
    expect(castFor(store.agents.get(initial.id)!)).toBe('omp');
    expect(effortTier(store.agents.get(initial.id)!.inference)).toBe(0);
    expect(store.agents.get(initial.id)!.inference).toEqual(raw);
    for (const [selector, tier] of [['high', 1], ['xhigh', 2], ['max', 3]] as const) {
      await send('inference_changed', { old: null, new: observation('claude-opus-5-5', selector, null), pane_id: 'w1:p1' });
      expect(effortTier(store.agents.get(initial.id)!.inference)).toBe(tier);
      expect(castFor(store.agents.get(initial.id)!)).toBe('claude');
    }
    expect(store.agents.get(initial.id)!.status).toBe('idle');
    expect(store.lastActive.get(initial.id)).toBe(active);
    expect(store.statusSince.has(initial.id)).toBe(false);
    expect(store.runs.has(initial.id)).toBe(false);
  });

  it('clears observations immediately and reads only well-formed event pieces', async () => {
    const initial = { ...agent('observed'), kind: 'pi', status: 'idle', inference: observation('gpt-6.1-sol', 'max', null) };
    const { store, send } = await liveAgent(initial);
    await send('inference_changed', { old: initial.inference, new: null, pane_id: 'w1:p1' });
    expect(effortTier(store.agents.get(initial.id)!.inference)).toBe(0);
    expect(castFor(store.agents.get(initial.id)!)).toBe('pi');
    await send('inference_changed', { old: null, new: {
      model: { id: 'gpt-6.1-sol', provider: 'openai' },
      effort: { configured: 'future-effort', level: 'max', source: 'omp-thinking', reported_at: null },
    }, pane_id: 'w1:p1' });
    expect(store.agents.get(initial.id)!.inference).toEqual({
      model: null, effort: { configured: 'future-effort', level: 'max', source: 'omp-thinking', reported_at: null },
    });
    expect(effortTier(store.agents.get(initial.id)!.inference)).toBe(0);
    await send('inference_changed', { new: null });
    expect(store.agents.get(initial.id)!.inference?.effort?.configured).toBe('future-effort');
  });

  it('drops earlier-session evidence until the authoritative snapshot supplies matching observations', async () => {
    const initial = { ...agent('observed'), status: 'idle', session_id: 'session-one', inference: observation('claude-opus-5-5', 'max', null) };
    const { store, send, replaceSnapshot } = await liveAgent(initial);
    await send('session_recorded', { old: 'session-one', new: 'session-one' });
    expect(effortTier(store.agents.get(initial.id)!.inference)).toBe(3);
    await send('session_recorded', { old: 'session-one', new: 'session-two' });
    expect(store.agents.get(initial.id)!.session_id).toBe('session-two');
    expect(effortTier(store.agents.get(initial.id)!.inference)).toBe(0);
    expect(store.agents.get(initial.id)!.inference).toBeNull();
    replaceSnapshot({ ...initial, session_id: 'session-two', inference: observation('claude-sonnet-5-5', 'high', null) });
    await store.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(castFor(store.agents.get(initial.id)!)).toBe('pi');
    expect(effortTier(store.agents.get(initial.id)!.inference)).toBe(1);
    expect(store.lastActive.has(initial.id)).toBe(false);
  });

  it('does not let same-report inference survive a later session replacement without session provenance', async () => {
    const initial = { ...agent('observed'), status: 'idle', session_id: 'session-one' };
    const { store, send } = await liveAgent(initial);
    await send('inference_changed', { old: null, new: observation('gpt-6.1-sol', 'max', null), pane_id: 'w1:p1' });
    await send('session_recorded', { old: 'session-one', new: 'session-two' });
    expect(store.agents.get(initial.id)!.inference).toBeNull();
    expect(store.lastActive.has(initial.id)).toBe(false);
  });

  it('keeps address-only changes but clears evidence on a different pane', async () => {
    const initial = { ...agent('observed'), status: 'idle', inference: observation('gpt-6.1-sol', 'max', null) };
    const { store, send } = await liveAgent(initial);
    await send('address_changed', { type: 'buzz', old: null, new: { pane_id: 'w2:p1' } });
    await send('address_changed', { type: 'herdr-pane', old: { pane_id: 'w1:p1' }, new: { pane_id: 'w1:p1', herdr_name: 'renamed' } });
    expect(effortTier(store.agents.get(initial.id)!.inference)).toBe(3);
    await send('address_changed', { type: 'herdr-pane', old: { pane_id: 'w1:p1' }, new: { pane_id: 'w2:p1' } });
    expect(store.agents.get(initial.id)!.inference).toBeNull();
    expect(store.lastActive.has(initial.id)).toBe(false);
  });

  it.each([
    ['status_changed', { old: 'idle', new: 'missing' }],
    ['channel_gone', { type: 'herdr-pane', channel_id: 'pane-channel' }],
    ['launched', { pane_id: 'w2:p1' }],
    ['resumed', { pane_id: 'w2:p1' }],
    ['agent_changed', { changes: { kind: { old: 'omp', new: 'claude' } } }],
    ['agent_changed', { changes: { node_id: { old: 'work-node', new: 'other-node' } } }],
  ] as const)('clears evidence when its binding changes via %s', async (type, data) => {
    const initial = { ...agent('observed'), status: 'idle', inference: observation('gpt-6.1-sol', 'max', null) };
    const { store, send } = await liveAgent(initial);
    await send(type, data);
    expect(store.agents.get(initial.id)!.inference).toBeNull();
    expect(store.lastActive.has(initial.id)).toBe(false);
  });
});

describe('Buzz identity', () => {
  it('follows a later change to the channel', async () => {
    const initial = agent('talker');
    const channel = (identity: string) => ({ type: 'buzz', config: { identity, channel: 'general' }, ord: 0 });
    const { store, send } = await liveAgent(initial, [event(1, initial.id, 'channel_added', { channel_id: 'buzz-1', ...channel('a') })]);
    expect(store.buzz.get('buzz-1')).toEqual({ identity: 'a', channel: 'general' });
    await send('channel_changed', { channel_id: 'buzz-1', old: channel('a'), new: channel('b') });
    expect(store.buzz.get('buzz-1')).toEqual({ identity: 'b', channel: 'general' });
  });
});

describe('a history page that fails', () => {
  it('resumes after the last page read instead of recording the log twice', async () => {
    const { store } = await import('./store');
    const start = Date.parse(AT), MIN = 60_000;
    const changed = (seq: number, from: string, to: string, min: number) =>
      event(seq, 'one', 'status_changed', { old: from, new: to }, new Date(start + min * MIN).toISOString());
    const pages = new Map<number, { events: RostrEvent[]; next: number }>([
      [0, { events: [changed(1, 'idle', 'working', 0), changed(2, 'working', 'blocked', 10)], next: 2 }],
      [2, { events: [changed(3, 'blocked', 'working', 30)], next: 3 }],
      [3, { events: [], next: 3 }],
    ]);
    const asked: number[] = [];
    let failures = 1;
    await store.start({
      ...fakeRostr([agent('one')]).source,
      events: async (since) => {
        asked.push(since);
        if (since === 2 && failures-- > 0) throw new Error('page failed');
        return pages.get(since)!;
      },
    });
    expect(store.conn).toBe('error');
    expect(store.historyRead).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.historyRead).toBe(true);
    expect(store.conn).toBe('live');
    expect(asked).toEqual([0, 2, 2, 3]);
    expect(store.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    // Ten minutes worked before it blocked, banked once, and five since it went on.
    expect(runTime(store.runs.get('one')!, start + 35 * MIN)).toBe(15 * MIN);
  });
});

describe('overlapping refetches', () => {
  const withStatus = (status: string) => [{ ...agent('one'), status }];

  it('keeps the newer snapshot when an older response lands after it, and applies those landing in order', async () => {
    const { store } = await import('./store');
    let answer: () => Promise<Agent[]> = async () => withStatus('idle');
    await store.start({ ...fakeRostr([]).source, agents: () => answer() });
    const refetch = () => {
      const response = Promise.withResolvers<Agent[]>();
      answer = () => response.promise;
      const applied = store.refresh();
      return async (status: string) => {
        response.resolve(withStatus(status));
        await applied;
        return store.all.get('one')?.status;
      };
    };
    const older = refetch(), newer = refetch();
    expect(await newer('blocked')).toBe('blocked');
    expect(await older('idle')).toBe('blocked');
    const first = refetch(), second = refetch();
    expect(await first('done')).toBe('done');
    expect(await second('working')).toBe('working');
  });

  it('refetches once the history is read, for what changed while it was paged', async () => {
    const { store } = await import('./store');
    const rostr = fakeRostr(withStatus('idle'));
    await store.start({
      ...rostr.source,
      events: (since) => {
        rostr.setAgents(withStatus('working'));
        return rostr.source.events(since);
      },
    });
    expect(store.all.get('one')?.status).toBe('idle');
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.all.get('one')?.status).toBe('working');
  });
});

describe('agents that are gone', () => {
  /** Events that leave every kind of per-agent entry: a pane, a status time, activity and a run. */
  const traces = (id: string, seq: number) => [
    event(seq, id, 'launched', { pane_id: `w1:${id}` }),
    event(seq + 1, id, 'status_changed', { old: 'idle', new: 'working' }),
  ];
  const ALL = ['lastActive', 'statusSince', 'runs', 'panes'] as const;
  const NONE: string[] = [];
  /** Which of the store's per-agent maps still hold `id`. */
  const kept = (store: Record<(typeof ALL)[number], ReadonlyMap<string, unknown>>, id: string) => ALL.filter((k) => store[k].has(id));

  it('forgets an agent a later snapshot no longer holds, but not one no snapshot has held yet', async () => {
    const { store } = await import('./store');
    const rostr = fakeRostr([agent('leaving'), agent('staying')], [...traces('leaving', 1), ...traces('staying', 3), ...traces('arriving', 5)]);
    await store.start(rostr.source);
    expect(kept(store, 'leaving')).toEqual(ALL);
    rostr.setAgents([agent('staying')]);
    await store.refresh();
    expect(kept(store, 'leaving')).toEqual(NONE);
    expect(kept(store, 'staying')).toEqual(ALL);
    expect(kept(store, 'arriving')).toEqual(ALL);
    rostr.setAgents([agent('staying'), agent('arriving')]);
    await store.refresh();
    expect(kept(store, 'arriving')).toEqual(ALL);
    rostr.setAgents([agent('staying')]);
    await store.refresh();
    expect(kept(store, 'arriving')).toEqual(NONE);
    expect(kept(store, 'staying')).toEqual(ALL);
  });

  it('forgets an agent when it is retired, in the history or live', async () => {
    const { store } = await import('./store');
    const retired = { by: 'node', reason: 'exited' };
    const rostr = fakeRostr([agent('one')], [...traces('long-gone', 1), event(3, 'long-gone', 'agent_retired', retired), ...traces('one', 4)]);
    await store.start(rostr.source);
    await vi.advanceTimersByTimeAsync(0);
    expect(kept(store, 'long-gone')).toEqual(NONE);
    expect(kept(store, 'one')).toEqual(ALL);
    await rostr.send(event(6, 'one', 'agent_retired', retired));
    expect(kept(store, 'one')).toEqual(NONE);
    expect(store.all.has('one')).toBe(false);
  });

  it('forgets the Buzz settings of a gone agent\'s channels', async () => {
    const { store } = await import('./store');
    const buzz = { id: 'buzz-1', type: 'buzz', source: 'configured', state: 'attached' };
    const added = event(1, 'leaving', 'channel_added', { channel_id: 'buzz-1', type: 'buzz', config: { identity: 'a', channel: 'general' } });
    const rostr = fakeRostr([{ ...agent('leaving'), channels: [buzz] }, agent('staying')], [added]);
    await store.start(rostr.source);
    expect(store.buzz.has('buzz-1')).toBe(true);
    rostr.setAgents([agent('staying')]);
    await store.refresh();
    expect(store.buzz.has('buzz-1')).toBe(false);
  });
});
