import { describe, expect, it } from 'vitest';
import { brightness, DIMMEST } from './recency';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** Brightness per agent, for agents last active `ago` ms before NOW (null: never seen), named a, b, c… */
function lights(...ago: (number | null)[]): number[] {
  const last = new Map<string, number | null>(ago.map((t, i) => [String.fromCharCode(97 + i), t === null ? null : NOW - t]));
  return [...brightness(last, NOW).values()];
}

describe('brightness', () => {
  it('goes by rank, not by how long ago: minutes and weeks apart read the same', () => {
    const close = lights(0, 15 * MIN, 30 * MIN, 45 * MIN, HOUR, 2 * HOUR);
    const far = lights(0, DAY, 3 * DAY, 10 * DAY, 30 * DAY, 90 * DAY);
    expect(far).toEqual(close);
  });

  it('grades from full through the most recent third, the rest at the dimmest', () => {
    const [first, second, third, ...rest] = lights(0, HOUR, 2 * HOUR, 3 * HOUR, 4 * HOUR, 5 * HOUR, 6 * HOUR, 7 * HOUR, 8 * HOUR);
    expect(first).toBe(1);
    expect(second).toBeCloseTo(1 - (1 - DIMMEST) / 3);
    expect(third).toBeCloseTo(1 - (1 - DIMMEST) * 2 / 3);
    expect(rest).toEqual([DIMMEST, DIMMEST, DIMMEST, DIMMEST, DIMMEST, DIMMEST]);
  });

  it('does not depend on the order the agents come in', () => {
    expect(lights(5 * HOUR, 0, 3 * HOUR, HOUR, 2 * HOUR, 4 * HOUR)).toEqual([DIMMEST, 1, DIMMEST, 1 - (1 - DIMMEST) / 2, DIMMEST, DIMMEST]);
  });

  it('counts agents within ten minutes of each other as equally recent', () => {
    expect(lights(0, 10 * MIN)).toEqual([1, 1]);
    expect(lights(0, 10 * MIN + 1)).toEqual([1, DIMMEST]);
    // Each within ten minutes of the next, not of the first: only those further behind rank lower.
    expect(lights(0, 8 * MIN, 16 * MIN, 24 * MIN, HOUR, 2 * HOUR)).toEqual([1, 1, 1 - (1 - DIMMEST) / 2, DIMMEST, DIMMEST, DIMMEST]);
  });

  it('dims nobody when all were active about as recently', () => {
    expect(lights(3 * DAY, 3 * DAY + MIN, 3 * DAY + 5 * MIN, 3 * DAY + 9 * MIN)).toEqual([1, 1, 1, 1]);
  });

  it('puts an agent never seen active at the dimmest, and counts it among the agents graded', () => {
    expect(lights(null, 0, null, null, null, HOUR)).toEqual([DIMMEST, 1, DIMMEST, DIMMEST, DIMMEST, 1 - (1 - DIMMEST) / 2]);
  });

  it('lights everyone fully when nobody was ever seen active', () => {
    expect(lights(null, null, null)).toEqual([1, 1, 1]);
    expect(lights()).toEqual([]);
  });

  it('takes a time in the future as now', () => {
    expect(lights(-HOUR, 5 * MIN)).toEqual([1, 1]);
    expect(lights(-HOUR, -DAY, 5 * MIN)).toEqual([1, 1, 1]);
  });
});
