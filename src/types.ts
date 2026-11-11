// Shapes of the rostr API responses dispatchr reads (see rostr's openapi.yaml). Only the fields used here.

export type NodeState = 'online' | 'stale' | 'offline' | string;

export interface RNode {
  id: string;
  name: string;
  versions?: Record<string, string> | null;
  plugins?: string[];
  accepted_spaces?: string[];
  connected: boolean;
  last_seen_at: string | null;
  state: NodeState;
  agent_count: number;
}

export interface Channel {
  id: string;
  type: string; // 'herdr-pane' | 'buzz' | …
  source: 'observed' | 'configured' | string;
  state: string; // ok | attached | detached | pending | failed | gone | unknown
}

// idle | working | blocked | done | exited | unknown (from herdr) · missing | disabled | node_offline | retired (rostr)
export type Status = string;

export interface Artifact {
  url: string;
  metadata: Record<string, unknown>;
}

export interface InferenceModel {
  id: string | null;
  provider: string | null;
  source: string;
  reported_at: string | null;
}

export interface InferenceEffort {
  configured: string | null;
  level: string | null;
  source: string;
  reported_at: string | null;
}

/** Last-reported main-session evidence, not a promise about the next request. */
export type Inference = { model: InferenceModel | null; effort: InferenceEffort | null } | null;

export interface Agent {
  id: string;
  space_id: string;
  space_slug: string;
  name: string;
  kind: string;
  launcher: string;
  profile: string;
  cwd: string;
  workspace_label: string | null;
  session_id: string | null;
  resume: boolean;
  relaunch_on_exit: boolean;
  enabled: boolean;
  tags: string[];
  node_id: string;
  node_name: string;
  notes: string;
  /** The agent's own principal: what reports_to and its events name. */
  principal_id: string;
  created_at: string;
  retired_at: string | null;
  status: Status;
  node_state: NodeState;
  channels: Channel[];
  /**
   * Who the agent reports to: another agent, a person, or `{hidden: true}` when the caller may not see
   * that agent. It describes only; it never grants access.
   */
  reports_to: ReportsTo | null;
  /**
   * Named http(s) links to the agent's bound pane (`web` → a web terminal on it, …), filled by its
   * computer from the `[links]` templates in its rostr config; `{}` without a bound pane.
   */
  links: Record<string, string>;
  /**
   * Display data for the agent, relayed uninterpreted: what herdr's plugins report on its workspace and
   * on its pane (the same name may come from both). Absent from a rostr older than tokens.
   */
  tokens?: AgentToken[];
  /** Agent-owned output links with opaque metadata; absent from older rostr versions. */
  artifacts?: Artifact[];
  /** Absent on older servers; null when the bound kind/session has no observations. */
  inference?: Inference;
}

export interface AgentToken {
  /** Where rostr read it: `herdr-workspace` or `herdr-pane` (herdr does not say which plugin wrote it). */
  source: string;
  name: string;
  /** Display text; may carry icon-font glyphs. */
  text: string;
}

export type ReportsTo =
  | { hidden: true }
  | { type: 'person'; principal_id: string; name: string }
  | { type: 'agent'; principal_id: string; agent_id: string; name: string; space: string; retired: boolean };

export interface Space {
  id: string;
  name: string;
  slug: string;
}

/** GET /v1/me, the parts dispatchr shows: who rostr takes the viewer for. */
export interface Me {
  principal: { id: string; name: string; type: string };
  /** Set when that person signed in through Tailscale (rostr's tailnet address). */
  tailscale_login: string | null;
}

/** A full address-book entry from GET /v1/agents/{ref}/contact (member on the agent). */
export interface ContactChannel extends Channel {
  config: Record<string, unknown>;
  display: { text?: string } | null;
  reason?: string;
}

export interface RostrEvent {
  seq: number;
  at: string;
  space_id: string | null;
  node_id: string | null;
  agent_id: string | null;
  actor_id: string | null;
  type: string;
  // Per-type payload; read it through the guards in data.ts.
  data: Record<string, unknown>;
}

export type UsageRole = 'main' | 'advisor' | 'subagent' | 'helper';

export interface TokenCounts {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  reasoning: number;
}

/** One row of GET /v1/usage: the keys named in `by`, plus the summed counters. */
export interface UsageRow extends TokenCounts {
  agent_id?: string;
  agent?: string;
  space?: string;
  node_id?: string;
  node?: string;
  role?: UsageRole;
  name?: string | null;
  model?: string | null;
  hour?: string;
  session?: string;
  /** USD, the sum of known costs. */
  cost: number;
  cost_complete: boolean;
}

export interface UsagePage {
  from: string;
  to: string;
  by: string[];
  rows: UsageRow[];
}

/** `data` of an `event: usage` frame on /v1/stream: per agent, the change since the last stored values. */
export interface UsageFrame {
  node_id: string;
  agents: (TokenCounts & { agent_id: string; space_id: string; cost: number })[];
}
