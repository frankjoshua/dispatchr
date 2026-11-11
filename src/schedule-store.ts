import { store } from './store';
import { scheduleBadgeCounts } from './badges';
import { filter } from './filter';
import type { Schedule } from './schedule-types';

export type ScheduleSnapshot =
  | { state: 'ready'; schedules: Schedule[] }
  | { state: 'unavailable' | 'forbidden' };

/** Schedule inventory is governed by space grants, independently of agents and computers. */
export interface ScheduleSource {
  schedules(): Promise<ScheduleSnapshot>;
}

export type ScheduleState = 'loading' | 'ready' | 'unavailable' | 'forbidden' | 'error';

// Freshness expires without an event; refetch even when the stream stays quiet.
const POLL_MS = 30_000;

export class Schedules {
  items: readonly Schedule[] = [];
  state: ScheduleState = 'loading';
  error: string | null = null;
  private source: ScheduleSource | null = null;
  private changeListeners = new Set<() => void>();
  private started = false;
  private pending = false;
  private request: Promise<void> | null = null;

  onChange(fn: () => void): void { this.changeListeners.add(fn); }
  private changed(): void { for (const fn of this.changeListeners) fn(); }

  start(source: ScheduleSource): void {
    this.source = source;
    this.items = [];
    this.state = 'loading';
    this.error = null;
    if (!this.started) {
      this.started = true;
      store.onOpen(() => { void this.refresh(); });
      store.onEvent((e) => {
        if (e.type === 'schedule_created' || e.type === 'schedule_changed') void this.refresh();
      });
      setInterval(() => {
        // A slow request already refreshes inventory; polls must not keep invalidating it.
        if (!this.request) void this.refresh();
      }, POLL_MS);
    }
    this.changed();
    void this.refresh();
  }

  refresh(): Promise<void> {
    this.pending = true;
    if (!this.request) {
      this.request = Promise.resolve().then(() => this.load()).finally(() => {
        this.request = null;
        if (this.pending) void this.refresh();
      });
    }
    return this.request;
  }

  private async load(): Promise<void> {
    while (this.pending) {
      this.pending = false;
      const source = this.source;
      try {
        if (!source) throw new Error('schedules.start(source) has not run');
        const snapshot = await source.schedules();
        // Events contain no projection: discard the response begun before one and fetch again.
        if (this.pending || source !== this.source) continue;
        this.items = snapshot.state === 'ready' ? snapshot.schedules : [];
        this.state = snapshot.state;
        this.error = null;
      } catch (err: unknown) {
        if (this.pending || source !== this.source) continue;
        this.items = [];
        this.state = 'error';
        this.error = `Could not load schedules: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.changed();
    }
  }
}

export const schedules = new Schedules();

/** agent id → how many schedules in the filtered spaces it is associated with (the schedule badge's count). */
export function currentScheduleCounts(): Map<string, number> {
  return scheduleBadgeCounts(schedules.state === 'ready' ? schedules.items : [], filter.spaces);
}
