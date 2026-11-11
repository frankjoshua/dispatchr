import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loopStops, stepLoop, workingLoop } from './loop';
import type { loopState } from './loop-state';

const KEY = 'dispatchr.visits';
const all = ['a', 'b', 'c', 'd'];
let values: Map<string, string>;
type LoopState = typeof loopState;
const shown = (state: LoopState, candidates = all) =>
  loopStops(workingLoop(candidates, state.order), state.dismissed, false, () => false);

beforeEach(() => {
  vi.resetModules();
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

async function reload() {
  vi.resetModules();
  return (await import('./loop-state')).loopState;
}

describe('unlimited navigation persistence', () => {
  it('includes never-visited agents with no saved state', async () => {
    expect(shown(await reload())).toEqual(all);
  });

  it('migrates old timestamps to an order without expiring agents or restricting new ones', async () => {
    values.set(KEY, JSON.stringify([{ id: 'b', at: 0 }, { id: 'a', at: 86_400_000 }, { id: 'b', at: 10 * 86_400_000 }]));
    const state = await reload();
    expect(shown(state)).toEqual(['b', 'a', 'c', 'd']);
    expect(state.current).toBe('b');
    state.jump('c', 'a', all);
    const restored = await reload();
    expect(shown(restored)).toEqual(['b', 'a', 'c', 'd']);
    expect(restored.current).toBe('c');
    expect(JSON.parse(values.get(KEY)!)).not.toHaveProperty('visits');
  });

  it('retains a saved preferred sequence and accepts agents missing from its old history', async () => {
    values.set(KEY, JSON.stringify({ visits: [{ id: 'a', at: 0 }, { id: 'b', at: 1 }], order: ['b', 'a'] }));
    const state = await reload();
    expect(shown(state)).toEqual(['b', 'a', 'c', 'd']);
    state.jump('d', 'b', all);
    expect(shown(await reload())).toEqual(['b', 'd', 'a', 'c']);
  });

  it('reorders a direct jump, then preserves that order through repeated steps and reload', async () => {
    const state = await reload();
    state.jump('c', 'a', all);
    const order = ['a', 'c', 'b', 'd'];
    expect(shown(state)).toEqual(order);
    state.step('b', all);
    expect(shown(state)).toEqual(order);
    const restored = await reload();
    expect(shown(restored)).toEqual(order);
    expect(restored.current).toBe('b');
    expect(stepLoop(order, 'c', -1, new Set(order))).toBe('a');
    expect(stepLoop(order, 'c', 1, new Set(order))).toBe('b');
  });

  it('does not lose agents or accumulate visit logs in long sessions', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `agent-${i}`);
    const state = await reload();
    state.jump(ids[24], ids[0], ids);
    const order = [ids[0], ids[24], ...ids.slice(1,24)];
    for (let i = 0; i < 600; i++) state.step(ids[i % ids.length], ids);
    expect(shown(await reload(), ids)).toEqual(order);
    expect(JSON.parse(values.get(KEY)!)).toEqual({ order, current: ids[599 % ids.length], dismissed: [] });
  });

  it('keeps manual dismissals across reload and restores a deliberately revisited agent', async () => {
    const state = await reload();
    state.forget('c');
    expect(shown(await reload())).toEqual(['a', 'b', 'd']);
    const reopened = await reload();
    reopened.jump('c', 'a', all);
    expect(shown(reopened)).toEqual(['a', 'c', 'b', 'd']);
    expect(reopened.dismissed.has('c')).toBe(false);
  });

  it('does not discard hidden agents from the preferred sequence', async () => {
    const state = await reload();
    state.jump('c', 'a', all);
    expect(shown(state, ['a','d'])).toEqual(['a','d']);
    state.step('d', all);
    expect(shown(await reload())).toEqual(['a','c','b','d']);
  });

  it('drops a retired agent from the order and the dismissals on the next step', async () => {
    const state = await reload();
    state.jump('c', 'a', all);
    state.forget('d');
    state.forget('b');
    state.step('a', ['a', 'b', 'c']);
    expect(JSON.parse(values.get(KEY)!)).toEqual({ order: ['a', 'c', 'b'], current: 'a', dismissed: ['b'] });
  });

  it('drops a retired agent on a direct jump and keeps the jump order of the rest', async () => {
    const state = await reload();
    state.forget('a');
    state.step('b', all);
    state.jump('d', 'b', ['b', 'c', 'd']);
    expect(JSON.parse(values.get(KEY)!)).toEqual({ order: ['b', 'd', 'c'], current: 'd', dismissed: [] });
  });

  it('ignores malformed stored entries while keeping valid order and dismissals', async () => {
    values.set(KEY, JSON.stringify({ order: ['b', 7, 'b', 'a'], dismissed: [null, 'd'], current: 5 }));
    expect(shown(await reload())).toEqual(['b','a','c']);
  });
});
