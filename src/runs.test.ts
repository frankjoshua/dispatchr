import { describe, expect, it } from 'vitest';
import { nextRun, runTime, type Run } from './runs';

const MIN = 60_000;
/** The run after each status change in turn, starting from none. */
const after = (...changes: [status: string | null, at: number][]) =>
  changes.reduce<Run | undefined>((run, [status, at]) => nextRun(run, status, at), undefined);

describe('nextRun', () => {
  it('starts a run when the agent starts working, counted from then', () => {
    const run = after(['working', 10 * MIN])!;
    expect(runTime(run, 10 * MIN)).toBe(0);
    expect(runTime(run, 25 * MIN)).toBe(15 * MIN);
  });

  it('holds while blocked and resumes the same run, the blocked time left out', () => {
    const blocked = after(['working', 0], ['blocked', 10 * MIN])!;
    expect(runTime(blocked, 10 * MIN)).toBe(10 * MIN);
    expect(runTime(blocked, 50 * MIN)).toBe(10 * MIN);
    const resumed = nextRun(blocked, 'working', 40 * MIN)!;
    expect(runTime(resumed, 45 * MIN)).toBe(15 * MIN);
    const again = after(['working', 0], ['blocked', 10 * MIN], ['working', 40 * MIN], ['blocked', 45 * MIN], ['working', 60 * MIN])!;
    expect(runTime(again, 62 * MIN)).toBe(17 * MIN);
  });

  it('keeps its start when working or blocked is reported twice', () => {
    expect(runTime(after(['working', 0], ['working', 5 * MIN])!, 8 * MIN)).toBe(8 * MIN);
    expect(runTime(after(['working', 0], ['blocked', 5 * MIN], ['blocked', 9 * MIN])!, 20 * MIN)).toBe(5 * MIN);
  });

  it.each(['done', 'idle', 'missing', 'exited', null])('ends the run on %s, working or blocked', (status) => {
    expect(after(['working', 0], [status, 5 * MIN])).toBeUndefined();
    expect(after(['working', 0], ['blocked', 5 * MIN], [status, 6 * MIN])).toBeUndefined();
  });

  it('starts from nothing after a run ended', () => {
    expect(runTime(after(['working', 0], ['done', 30 * MIN], ['working', 60 * MIN])!, 61 * MIN)).toBe(MIN);
  });

  it('creates nothing when blocked without a run', () => {
    expect(after(['blocked', 5 * MIN])).toBeUndefined();
  });

  it('leaves the run it was given untouched', () => {
    const run: Run = { worked: 0, since: 0 };
    nextRun(run, 'blocked', 5 * MIN);
    expect(run).toEqual({ worked: 0, since: 0 });
  });
});

describe('runTime', () => {
  it('never counts a stretch that starts after now', () => {
    expect(runTime({ worked: 3 * MIN, since: 10 * MIN }, 5 * MIN)).toBe(3 * MIN);
  });
});
