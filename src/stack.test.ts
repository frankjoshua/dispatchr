import { describe, expect, it } from 'vitest';
import { RUN_FULL_MIN, STACK_K, STACK_MIN, stackHeight } from './stack';

const MIN = 60_000;
const NOW = Date.parse('2026-01-01T12:00:00Z');
const FULL = STACK_MIN + STACK_K;
/** A run that has been working, unblocked, for `minutes`. */
const workingFor = (minutes: number) => ({ worked: 0, since: NOW - minutes * MIN });

describe('stackHeight', () => {
  it('stands at the minimum for an agent that is not in a run, whatever run is left over', () => {
    for (const status of ['idle', 'done', 'missing', 'exited', 'unknown']) {
      expect(stackHeight(status, workingFor(45), '2026-01-01T09:00:00Z', NOW)).toBe(STACK_MIN);
    }
  });

  it('starts at the minimum and grows with working time, fastest at first', () => {
    expect(stackHeight('working', workingFor(0), undefined, NOW)).toBe(STACK_MIN);
    const h1 = stackHeight('working', workingFor(1), undefined, NOW);
    const h10 = stackHeight('working', workingFor(10), undefined, NOW);
    const h30 = stackHeight('working', workingFor(30), undefined, NOW);
    expect(h1).toBeGreaterThan(STACK_MIN);
    expect(h10).toBeGreaterThan(h1);
    expect(h30).toBeGreaterThan(h10);
    expect(h30).toBeLessThan(FULL);
    expect(h10 - h1).toBeGreaterThan(h30 - h10);
  });

  it('reaches full height at the full-height run and stays there', () => {
    expect(stackHeight('working', workingFor(RUN_FULL_MIN), undefined, NOW)).toBeCloseTo(FULL);
    expect(stackHeight('working', workingFor(RUN_FULL_MIN * 8), undefined, NOW)).toBe(FULL);
  });

  it('holds a blocked run at its banked time, however long it stays blocked', () => {
    const banked = { worked: 10 * MIN, since: null };
    const held = stackHeight('blocked', banked, undefined, NOW);
    expect(held).toBeCloseTo(stackHeight('working', workingFor(10), undefined, NOW));
    expect(stackHeight('blocked', banked, undefined, NOW + 5 * 60 * MIN)).toBe(held);
  });

  it('adds the present stretch to the time banked before the run last blocked', () => {
    const resumed = { worked: 10 * MIN, since: NOW - 5 * MIN };
    expect(stackHeight('working', resumed, undefined, NOW)).toBeCloseTo(stackHeight('working', workingFor(15), undefined, NOW));
  });

  it('measures a working agent with no known run from its last status change', () => {
    const since = new Date(NOW - 10 * MIN).toISOString();
    expect(stackHeight('working', undefined, since, NOW)).toBeCloseTo(stackHeight('working', workingFor(10), undefined, NOW));
    expect(stackHeight('working', undefined, undefined, NOW)).toBe(STACK_MIN);
    expect(stackHeight('blocked', undefined, since, NOW)).toBe(STACK_MIN);
  });

  it('never goes under the minimum when the clock is behind the run', () => {
    const ahead = new Date(NOW + 10 * MIN).toISOString();
    expect(stackHeight('working', undefined, ahead, NOW)).toBe(STACK_MIN);
    expect(stackHeight('working', { worked: 0, since: NOW + 10 * MIN }, undefined, NOW)).toBe(STACK_MIN);
  });
});
