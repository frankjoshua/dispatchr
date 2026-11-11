import type { Schedule, ScheduleFreshness } from './schedule-types';

export type ScheduleKind = 'running' | 'upcoming' | 'due' | 'unconfirmed' | 'paused';
export type ScheduleNextState = 'upcoming' | 'due' | 'unconfirmed';

export interface ScheduleClassification {
  kind: ScheduleKind;
  freshness: ScheduleFreshness;
  nextState: ScheduleNextState;
  nextRunAt: number | null;
  runningCount: number | null;
}

export interface ScheduleFilter {
  spaceSlugs: ReadonlySet<string>;
  agentId: string | null;
}

export interface ScheduleGroups {
  actionable: Schedule[];
  paused: Schedule[];
}

export function scheduleFreshness(schedule: Schedule, now: number): ScheduleFreshness {
  const expiry = schedule.observation?.fresh_until;
  if (!expiry) return 'unknown';
  const at = Date.parse(expiry);
  if (!Number.isFinite(at)) return 'unknown';
  return now < at ? 'fresh' : 'stale';
}

export function classifySchedule(schedule: Schedule, now: number): ScheduleClassification {
  const freshness = scheduleFreshness(schedule, now);
  const reportedNext = schedule.observation?.next_run_at;
  const parsedNext = reportedNext ? Date.parse(reportedNext) : NaN;
  const nextRunAt = Number.isFinite(parsedNext) ? parsedNext : null;
  const runningCount = freshness === 'fresh' ? schedule.observation?.running_count ?? null : null;
  const nextState: ScheduleNextState = freshness !== 'fresh' || nextRunAt === null
    ? 'unconfirmed' : nextRunAt <= now ? 'due' : 'upcoming';
  const kind: ScheduleKind = runningCount !== null && runningCount > 0 ? 'running'
    : schedule.enabled === false ? 'paused' : nextState;
  return { kind, freshness, nextState, nextRunAt, runningCount };
}

export function groupSchedules(
  schedules: readonly Schedule[],
  filter: ScheduleFilter,
  now: number,
): ScheduleGroups {
  const actionable: Schedule[] = [];
  const paused: Schedule[] = [];
  const times = new Map<string, number>();
  for (const schedule of schedules) {
    if (filter.spaceSlugs.size > 0 && !filter.spaceSlugs.has(schedule.space_slug)) continue;
    if (filter.agentId !== null && !schedule.execution.agent_ids.includes(filter.agentId)) continue;
    const evidence = classifySchedule(schedule, now);
    times.set(schedule.id, evidence.nextRunAt ?? Infinity);
    (evidence.kind === 'paused' ? paused : actionable).push(schedule);
  }
  const compare = (a: Schedule, b: Schedule): number => {
    const aTime = times.get(a.id) ?? Infinity;
    const bTime = times.get(b.id) ?? Infinity;
    if (aTime !== bTime) return aTime < bTime ? -1 : 1;
    const nameOrder = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    return nameOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  };
  actionable.sort(compare);
  paused.sort(compare);
  return { actionable, paused };
}

export function scheduleCountdown(nextRunAt: number, now: number): string {
  if (nextRunAt <= now) return 'Due time passed · awaiting update';
  let seconds = Math.ceil((nextRunAt - now) / 1000);
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  return `in ${days ? `${days}d ` : ''}${days || hours ? `${hours}h ` : ''}${days || hours || minutes ? `${minutes}m ` : ''}${seconds}s`;
}
