// Safe schedule inventory from rostr's ScheduleView; native schedulers keep control of execution.

export type ScheduleFreshness = 'fresh' | 'stale' | 'unknown';

export interface ScheduleLocation {
  kind: 'node' | 'pool' | 'external' | 'unknown';
  label: string;
  node_id?: string;
  ref?: string;
}

export interface ScheduleSourceInfo {
  kind: string;
  key: string;
  location: ScheduleLocation;
  locator: Record<string, unknown>;
}

export interface ScheduleDefinition {
  native: string | null;
  timezone: string | null;
  summary: string;
}

export interface ScheduleExecution {
  placement: ScheduleLocation;
  /** Only target ids visible to this viewer; associations do not grant agent access. */
  agent_ids: string[];
}

export interface ScheduleLastRun {
  started_at: string | null;
  finished_at: string | null;
  outcome: 'succeeded' | 'failed' | null;
  exit_code: number | null;
  location: ScheduleLocation | null;
}

export interface ScheduleObservation {
  observed_at: string;
  fresh_until: string | null;
  running_count: number | null;
  next_run_at: string | null;
  last_run: ScheduleLastRun | null;
}

export interface ScheduleAgentSummary {
  id: string;
  name: string;
  space_slug: string;
  retired: boolean;
}

export interface Schedule {
  id: string;
  space_id: string;
  space_slug: string;
  name: string;
  source: ScheduleSourceInfo;
  enabled: boolean | null;
  definition: ScheduleDefinition;
  execution: ScheduleExecution;
  observation: ScheduleObservation | null;
  metadata: Record<string, unknown>;
  freshness: ScheduleFreshness;
  agents: ScheduleAgentSummary[];
  hidden_agent_count: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}
