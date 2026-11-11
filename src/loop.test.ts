import { describe, expect, it } from 'vitest';
import { jumpLoop, loopStops, stepLoop, workingLoop } from './loop';
import { attentionReason } from './attention';

describe('workingLoop', () => {
  it('includes every candidate, including never-visited and formerly capped-out agents', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `agent-${i}`);
    expect(workingLoop(ids, ['agent-17', 'agent-2'])).toEqual(['agent-17', 'agent-2', ...ids.filter((id) => id !== 'agent-17' && id !== 'agent-2')]);
    expect(workingLoop(ids, [])).toEqual(ids);
  });

  it('retains preferred order, deduplicates and leaves unavailable candidates out', () => {
    expect(workingLoop(['a', 'b', 'c', 'c'], ['missing', 'c', 'a', 'c'])).toEqual(['c', 'a', 'b']);
  });
});

describe('loopStops', () => {
  const loop = ['old-done', 'working', 'blocked', 'unvisited-done', 'idle'];
  const statuses: Record<string, string> = { 'old-done': 'done', working: 'working', blocked: 'blocked', 'unvisited-done': 'done', idle: 'idle' };
  const needs = (id: string) => attentionReason(statuses[id], []) !== null;

  it('filters attention independently of visit history or sleep, and shows everyone when disabled', () => {
    expect(loopStops(loop, new Set(), true, needs)).toEqual(['old-done', 'blocked', 'unvisited-done']);
    expect(loopStops(loop, new Set(), false, needs)).toEqual(loop);
  });

  it('honors explicit dismissals in both modes', () => {
    const dismissed = new Set(['old-done', 'working']);
    expect(loopStops(loop, dismissed, true, needs)).toEqual(['blocked', 'unvisited-done']);
    expect(loopStops(loop, dismissed, false, needs)).toEqual(['blocked', 'unvisited-done', 'idle']);
  });
});

describe('stepLoop', () => {
  const loop = ['a', 'b', 'c'];
  it('goes round both ways', () => {
    expect(stepLoop(loop, 'c', 1, new Set(loop))).toBe('a');
    expect(stepLoop(loop, 'a', -1, new Set(loop))).toBe('c');
    expect(stepLoop(loop, 'b', 1, new Set(loop))).toBe('c');
  });

  it('enters at the first agent going on, the last going back, from outside the loop', () => {
    expect(stepLoop(loop, 'gone', 1, new Set(loop))).toBe('a');
    expect(stepLoop(loop, null, -1, new Set(loop))).toBe('c');
    expect(stepLoop([], 'a', 1, new Set())).toBeNull();
  });

  it('continues from a selected agent that no longer needs attention', () => {
    const all = ['a', 'b', 'c', 'd'], ready = new Set(['a', 'd']);
    expect(stepLoop(all, 'c', 1, ready)).toBe('d');
    expect(stepLoop(all, 'c', -1, ready)).toBe('a');
    expect(stepLoop(all, 'a', 1, new Set())).toBeNull();
  });
});

describe('jumpLoop', () => {
  const loop = ['a', 'b', 'c', 'd'];

  it('puts C immediately after A and leaves both navigation directions usable', () => {
    const next = jumpLoop(loop, 'a', 'c');
    expect(next).toEqual(['a', 'c', 'b', 'd']);
    expect(stepLoop(next, 'c', -1, new Set(next))).toBe('a');
    expect(stepLoop(next, 'c', 1, new Set(next))).toBe('b');
  });

  it('moves a backward target after the current agent without reversing its neighbors', () => {
    expect(jumpLoop(loop, 'c', 'a')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('inserts a new target after the current stop', () => {
    expect(jumpLoop(loop, 'a', 'e')).toEqual(['a', 'e', 'b', 'c', 'd']);
  });

  it('keeps current and already-next targets stable, including a wrap to the first stop', () => {
    expect(jumpLoop(loop, 'a', 'a')).toEqual(loop);
    expect(jumpLoop(loop, 'a', 'b')).toEqual(loop);
    expect(jumpLoop(loop, 'd', 'a')).toEqual(loop);
  });

  it('keeps known targets in place without an anchor and appends new ones', () => {
    expect(jumpLoop(loop, null, 'c')).toEqual(loop);
    expect(jumpLoop(loop, 'gone', 'e')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(jumpLoop([], null, 'a')).toEqual(['a']);
  });
});
