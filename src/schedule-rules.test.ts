import { describe, expect, it } from 'vitest';
import type { Schedule, ScheduleObservation } from './schedule-types';
import { classifySchedule, groupSchedules, scheduleCountdown, scheduleFreshness } from './schedule-rules';

const now = Date.parse('2026-10-11T12:00:00Z');
const freshObservation: ScheduleObservation = {
  observed_at: '2026-10-11T11:59:00Z',
  fresh_until: '2026-10-11T12:01:00Z',
  running_count: 0,
  next_run_at: '2026-10-11T12:00:30Z',
  last_run: null,
};

function schedule(fields: Partial<Schedule> = {}): Schedule {
  return {
    id: 'schedule-a', space_id: 'space-a', space_slug: 'operations', name: 'Routine check',
    source: { kind: 'native', key: 'check', location: { kind: 'external', label: 'Definition authority' }, locator: {} },
    enabled: true,
    definition: { native: null, timezone: null, summary: 'Checks the reported inventory' },
    execution: { placement: { kind: 'unknown', label: 'Unknown' }, agent_ids: [] },
    observation: { ...freshObservation }, metadata: {}, freshness: 'fresh', agents: [], hidden_agent_count: 0,
    created_at: '2026-10-11T11:00:00Z', updated_at: '2026-10-11T11:59:00Z',
    created_by: 'registry', updated_by: 'registry',
    ...fields,
  };
}

const all = { spaceSlugs: new Set<string>(), agentId: null };

describe('scheduleFreshness', () => {
  it('expires at the exact fresh_until boundary without an event or refreshed server flag', () => {
    const item = schedule();
    const expiry = Date.parse(freshObservation.fresh_until ?? '');
    expect(scheduleFreshness(item, expiry - 1)).toBe('fresh');
    expect(scheduleFreshness(item, expiry)).toBe('stale');
    expect(scheduleFreshness(item, expiry + 1)).toBe('stale');
    expect(item.freshness).toBe('fresh');
  });

  it('leaves missing observations and null expiry unknown, even with a reported fresh flag', () => {
    expect(scheduleFreshness(schedule({ observation: null }), now)).toBe('unknown');
    expect(scheduleFreshness(schedule({ observation: { ...freshObservation, fresh_until: null } }), now)).toBe('unknown');
  });

  it('uses expiry evidence rather than a stale API-derived field', () => {
    expect(scheduleFreshness(schedule({ freshness: 'stale' }), now)).toBe('fresh');
  });
});

describe('classifySchedule', () => {
  it('keeps a null running count unknown rather than assuming zero or running', () => {
    const evidence = classifySchedule(schedule({ observation: { ...freshObservation, running_count: null } }), now);
    expect(evidence.kind).toBe('upcoming');
    expect(evidence.runningCount).toBeNull();
  });

  it('keeps disabled schedules with fresh in-flight executions actionable', () => {
    const item = schedule({ enabled: false, observation: { ...freshObservation, running_count: 2 } });
    expect(classifySchedule(item, now).kind).toBe('running');
    expect(groupSchedules([item], all, now).actionable).toEqual([item]);
    const expiry = Date.parse(freshObservation.fresh_until ?? '');
    expect(classifySchedule(item, expiry).kind).toBe('paused');
    expect(classifySchedule(item, expiry).runningCount).toBeNull();
    expect(groupSchedules([item], all, expiry).paused).toEqual([item]);
  });

  it('does not describe stale or unknown running evidence as currently running', () => {
    const item = schedule({ observation: { ...freshObservation, running_count: 3 } });
    expect(classifySchedule(item, now + 60000).kind).toBe('unconfirmed');
    expect(classifySchedule(item, now + 60000).runningCount).toBeNull();
    item.observation = { ...freshObservation, running_count: 3, fresh_until: null };
    expect(classifySchedule(item, now).kind).toBe('unconfirmed');
  });

  it('retains stale next time as reported evidence, not a live countdown or future promise', () => {
    const item = schedule({ observation: { ...freshObservation, fresh_until: '2026-10-11T12:00:00Z' } });
    const evidence = classifySchedule(item, now);
    expect(evidence.kind).toBe('unconfirmed');
    expect(evidence.nextState).toBe('unconfirmed');
    expect(evidence.nextRunAt).toBe(now + 30000);
    expect(groupSchedules([item], all, now).actionable).toEqual([item]);
  });

  it('classifies a fresh past or exact due time as awaiting update, never failure', () => {
    for (const next_run_at of ['2026-10-11T11:59:59Z', '2026-10-11T12:00:00Z']) {
      const evidence = classifySchedule(schedule({ observation: { ...freshObservation, next_run_at } }), now);
      expect(evidence.kind).toBe('due');
      expect(evidence.nextState).toBe('due');
    }
  });

  it('does not calculate triggers from native expressions or treat an enabled source as running', () => {
    const item = schedule({
      definition: { native: '* * * * *', timezone: 'UTC', summary: 'Native rule' },
      observation: { ...freshObservation, next_run_at: null },
    });
    expect(classifySchedule(item, now).kind).toBe('unconfirmed');
    expect(classifySchedule(item, now).nextRunAt).toBeNull();
    expect(classifySchedule(schedule({ observation: null }), now).kind).toBe('unconfirmed');
  });

  it('does not mistake unknown enabled state for paused', () => {
    expect(classifySchedule(schedule({ enabled: null }), now).kind).toBe('upcoming');
    expect(classifySchedule(schedule({ enabled: false }), now).kind).toBe('paused');
  });
});

describe('groupSchedules', () => {
  it('filters plural execution targets without requiring an agent-owned schedule', () => {
    const plural = schedule({ execution: { placement: { kind: 'pool', label: 'Execution pool' }, agent_ids: ['unit-a', 'unit-b'] } });
    const untargeted = schedule({ id: 'untargeted' });
    expect(groupSchedules([plural, untargeted], { ...all, agentId: 'unit-a' }, now).actionable).toEqual([plural]);
    expect(groupSchedules([plural, untargeted], { ...all, agentId: 'unit-b' }, now).actionable).toEqual([plural]);
    expect(groupSchedules([plural, untargeted], { ...all, agentId: 'unit-c' }, now).actionable).toEqual([]);
    expect(groupSchedules([plural, untargeted], all, now).actionable).toHaveLength(2);
  });

  it('filters schedule ownership by space slug, independent of target agent space', () => {
    const item = schedule({
      agents: [{ id: 'unit-a', name: 'Review unit', space_slug: 'research', retired: false }],
      execution: { placement: { kind: 'unknown', label: 'Unknown' }, agent_ids: ['unit-a'] },
    });
    expect(groupSchedules([item], { spaceSlugs: new Set(['operations']), agentId: 'unit-a' }, now).actionable).toEqual([item]);
    expect(groupSchedules([item], { spaceSlugs: new Set(['research']), agentId: 'unit-a' }, now).actionable).toEqual([]);
  });

  it('orders reported next timestamps chronologically with stable name and id ties, missing times last', () => {
    const late = schedule({ id: 'late', name: 'A', observation: { ...freshObservation, next_run_at: '2026-10-11T12:00:40Z' } });
    const firstB = schedule({ id: 'b', name: 'A' });
    const firstA = schedule({ id: 'a', name: 'A' });
    const secondName = schedule({ id: 'c', name: 'B' });
    const missing = schedule({ id: 'missing', observation: null });
    const items = [late, firstB, missing, secondName, firstA];
    const original = [...items];
    expect(groupSchedules(items, all, now).actionable.map((item) => item.id)).toEqual(['a', 'b', 'c', 'late', 'missing']);
    expect(items).toEqual(original);
    expect(groupSchedules([...items].reverse(), all, now).actionable.map((item) => item.id)).toEqual(['a', 'b', 'c', 'late', 'missing']);
  });

  it('keeps paused separate below actionable rows, including stale and due schedules', () => {
    const paused = schedule({ id: 'paused', enabled: false });
    const stale = schedule({ id: 'stale', observation: { ...freshObservation, fresh_until: '2026-10-11T12:00:00Z' } });
    const due = schedule({ id: 'due', observation: { ...freshObservation, next_run_at: '2026-10-11T11:59:30Z' } });
    const groups = groupSchedules([paused, stale, due], all, now);
    expect(groups.actionable).toEqual([due, stale]);
    expect(groups.paused).toEqual([paused]);
  });
});

describe('scheduleCountdown', () => {
  it('uses seconds up to the boundary without showing zero before it is due', () => {
    expect(scheduleCountdown(now + 30000, now)).toBe('in 30s');
    expect(scheduleCountdown(now + 1, now)).toBe('in 1s');
    expect(scheduleCountdown(now, now)).toBe('Due time passed · awaiting update');
    expect(scheduleCountdown(now - 1, now)).toBe('Due time passed · awaiting update');
  });

  it('keeps longer countdowns explicit across days, hours and minutes', () => {
    expect(scheduleCountdown(now + 90061000, now)).toBe('in 1d 1h 1m 1s');
    expect(scheduleCountdown(now + 3600000, now)).toBe('in 1h 0m 0s');
    expect(scheduleCountdown(now + 60000, now)).toBe('in 1m 0s');
  });
});
