import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Schedules } from './schedule-store';
import type { ScheduleSnapshot, ScheduleSource } from './schedule-store';
import type { Schedule } from './schedule-types';

function record(id: string): Schedule {
  return {
    id, name: id, space_id: 'space', space_slug: 'work', enabled: true,
    source: { kind: 'cron', key: id, location: { kind: 'external', label: 'Test source' }, locator: {} },
    definition: { native: '0 * * * *', timezone: 'UTC', summary: 'Check' },
    execution: { placement: { kind: 'unknown', label: 'Unknown' }, agent_ids: [] },
    observation: null, metadata: {}, freshness: 'unknown', agents: [], hidden_agent_count: 0,
    created_at: '2026-10-11T00:00:00Z', updated_at: '2026-10-11T00:00:00Z', created_by: 'test', updated_by: 'test',
  };
}

function pendingSnapshot() {
  let resolve!: (value: ScheduleSnapshot) => void;
  const promise = new Promise<ScheduleSnapshot>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('schedule inventory refresh', () => {
  it('does not publish an obsolete snapshot after a change arrives during its request', async () => {
    const first = pendingSnapshot(), next = pendingSnapshot();
    let requests = 0;
    const source: ScheduleSource = { schedules: () => ++requests === 1 ? first.promise : next.promise };
    const inventory = new Schedules();
    const observed: string[][] = [];
    inventory.onChange(() => { observed.push(inventory.items.map((item) => item.id)); });
    inventory.start(source);
    await Promise.resolve();
    const completed = inventory.refresh();
    first.resolve({ state: 'ready', schedules: [record('obsolete')] });
    await Promise.resolve();
    await Promise.resolve();
    expect(inventory.items).toEqual([]);
    next.resolve({ state: 'ready', schedules: [record('current')] });
    await completed;
    expect(inventory.items.map((item) => item.id)).toEqual(['current']);
    expect(observed.some((ids) => ids.includes('obsolete'))).toBe(false);
  });

  it.each(['forbidden', 'unavailable'] as const)('clears previously visible records when the inventory becomes %s', async (state) => {
    let snapshot: ScheduleSnapshot = { state: 'ready', schedules: [record('visible')] };
    const inventory = new Schedules();
    inventory.start({ schedules: async () => snapshot });
    await inventory.refresh();
    expect(inventory.items.map((item) => item.id)).toEqual(['visible']);
    snapshot = { state };
    await inventory.refresh();
    expect(inventory.state).toBe(state);
    expect(inventory.items).toEqual([]);
  });

  it('exposes a failed load as an error rather than a successful empty inventory', async () => {
    const inventory = new Schedules();
    inventory.start({ schedules: async () => { throw new Error('Source unreachable'); } });
    await inventory.refresh();
    expect(inventory.state).toBe('error');
    expect(inventory.error).toContain('Source unreachable');
    expect(inventory.items).toEqual([]);
  });

  it('does not starve a slow request by invalidating it on every poll', async () => {
    const response = pendingSnapshot();
    const inventory = new Schedules();
    inventory.start({ schedules: () => response.promise });
    const completed = inventory.refresh();
    await vi.advanceTimersByTimeAsync(90_000);
    response.resolve({ state: 'ready', schedules: [record('loaded')] });
    await completed;
    expect(inventory.state).toBe('ready');
    expect(inventory.items.map((item) => item.id)).toEqual(['loaded']);
  });
});
