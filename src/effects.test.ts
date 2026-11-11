import { describe, expect, it } from 'vitest';
import { Effects } from './effects';

const names = (q: Effects<{ t: number; name: string }>) => [...q].map((e) => e.name);

describe('Effects', () => {
  it('holds at most its limit while nothing ages it, keeping the newest', () => {
    const q = new Effects<{ t: number; name: string }>(3);
    for (let i = 0; i < 10_000; i++) q.add({ t: 0, name: `e${i}` });
    expect(names(q)).toEqual(['e9997', 'e9998', 'e9999']);
  });

  it('ages effects and drops each as it reaches its life, in order, telling the caller', () => {
    const q = new Effects<{ t: number; name: string }>(8);
    q.add({ t: 0, name: 'a' });
    q.add({ t: 0.5, name: 'b' });
    q.add({ t: 0.2, name: 'c' });
    const done: string[] = [];
    q.step(0.5, 1, (e) => done.push(e.name));
    expect(names(q)).toEqual(['a', 'c']);
    expect(done).toEqual(['b']);
    q.step(0.5, 1, (e) => done.push(e.name));
    expect(names(q)).toEqual([]);
    expect(done).toEqual(['b', 'a', 'c']);
  });

  it('lets an effect outlive 1 when its life is longer', () => {
    const q = new Effects<{ t: number }>(8);
    q.add({ t: 0 });
    q.step(1.2, 1.5);
    expect(q.size).toBe(1);
    q.step(0.3, 1.5);
    expect(q.size).toBe(0);
  });
});
