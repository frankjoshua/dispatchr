import { artifactList } from './artifacts';
import { obj, str, tokenList } from './data';
import { filter, filterActive, passes } from './filter';
import type { Agent, Channel, Inference, RNode, RostrEvent, Space, UsageFrame } from './types';
import { nextRun, type Run } from './runs';
import { buildTeams, type Team } from './teams';

/** How the store reads rostr (api.ts implements it over HTTP; main.ts plugs it in). */
export interface RostrSource {
  nodes(): Promise<RNode[]>;
  agents(): Promise<Agent[]>;
  spaces(): Promise<Space[]>;
  /** One page of the log after `since`; `next` is the last seq scanned (resume from it). */
  events(since: number): Promise<{ events: RostrEvent[]; next: number }>;
  /** The live stream from `since`: calls onOpen once connected, then yields until the server closes it. */
  stream(since: number, onOpen: () => void): AsyncIterable<StreamItem>;
}

export type StreamItem = { kind: 'event'; event: RostrEvent } | { kind: 'usage'; frame: UsageFrame };

// Everything dispatchr knows, from rostr only: the snapshot (nodes, agents, spaces), the event log
// paged from the start, then the live stream. Events patch existing records immediately; a debounced
// refetch adds newly seen agents and brings everything back to exactly what rostr says.

export type Conn = 'loading' | 'live' | 'reconnecting' | 'error';

export interface Pane {
  pane_id: string;
  herdr_name: string | null;
}

export interface BuzzInfo {
  identity: string | null;
  channel: string | null;
}

const MAX_EVENTS = 5000;
const REFRESH_DEBOUNCE_MS = 600;
// last_seen_at moves on every node heartbeat without an event; a slow poll keeps "seen …" and the
// heartbeat blink honest.
const POLL_MS = 30_000;

type ChangeListener = () => void;
type EventListener = (e: RostrEvent) => void;

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** The event carries a replacement observation; malformed pieces remain unknown. */
function inferenceFrom(value: unknown): Inference {
  const o = obj(value), m = obj(o.model), e = obj(o.effort);
  const modelSource = str(m.source), effortSource = str(e.source);
  const id = str(m.id), provider = str(m.provider);
  const configured = str(e.configured), level = str(e.level);
  const model = modelSource && (id || provider)
    ? { id, provider, source: modelSource, reported_at: str(m.reported_at) } : null;
  const effort = effortSource && (configured || level)
    ? { configured, level, source: effortSource, reported_at: str(e.reported_at) } : null;
  return model || effort ? { model, effort } : null;
}

class Store {
  /** Every computer rostr shows. */
  allNodes = new Map<string, RNode>();
  /** Every live agent rostr shows. */
  all = new Map<string, Agent>();
  /**
   * What the filter lets through (filter.ts): the agents that pass, and the computers with any of them
   * (every computer without a filter). The rest of dispatchr reads these and nothing else, so a
   * filtered-out agent, space or computer is simply not there.
   */
  nodes = new Map<string, RNode>();
  agents = new Map<string, Agent>();
  spaces = new Map<string, Space>();
  events: RostrEvent[] = [];
  /** agent id → its herdr pane, as last reported in the event log (viewers cannot read /contact). */
  panes = new Map<string, Pane>();
  /** channel id → Buzz settings from its latest channel_added/channel_changed event. */
  buzz = new Map<string, BuzzInfo>();
  /** agent id → time of its last status change. */
  statusSince = new Map<string, string>();
  /**
   * agent id → when it was last active (ms): started or ended a turn, or spent tokens (live frames, and
   * usage.ts from the hourly usage, for agents whose status herdr only guesses).
   */
  lastActive = new Map<string, number>();
  /** agent id → its current run (runs.ts): there from when it starts working until it stops for anything but blocked. */
  runs = new Map<string, Run>();
  conn: Conn = 'loading';
  error: string | null = null;
  lastSeq = 0;
  /** True once the event log has been paged to its end: before that, what the log tells is incomplete. */
  historyRead = false;

  private changeListeners = new Set<ChangeListener>();
  private eventListeners = new Set<EventListener>();
  private usageListeners = new Set<(frame: UsageFrame) => void>();
  private openListeners = new Set<() => void>();
  private refreshTimer = 0;
  private changeQueued = false;
  private refreshStarted = 0;
  private refreshApplied = 0;

  onChange(fn: ChangeListener) { this.changeListeners.add(fn); }
  onEvent(fn: EventListener) { this.eventListeners.add(fn); }
  /** Live usage frames: not in the log, never replayed. */
  onUsage(fn: (frame: UsageFrame) => void) { this.usageListeners.add(fn); }
  /** Each time the stream (re)connects, i.e. after anything ephemeral may have been missed. */
  onOpen(fn: () => void) { this.openListeners.add(fn); }

  private changed() {
    if (this.changeQueued) return;
    this.changeQueued = true;
    queueMicrotask(() => {
      this.changeQueued = false;
      this.applyFilter();
      for (const fn of this.changeListeners) fn();
    });
  }

  private applyFilter() {
    this.agents = new Map([...this.all].filter(([, a]) => passes(a)));
    const used = new Set([...this.agents.values()].map((a) => a.node_id));
    this.nodes = filterActive() ? new Map([...this.allNodes].filter(([id]) => used.has(id))) : new Map(this.allNodes);
  }

  /** After the filter changed (filter.ts): recompute what is visible and tell everyone. */
  refilter() { this.changed(); }

  /** Whether an event is about something the filter lets through. Events about no agent or computer stay. */
  visible(e: RostrEvent): boolean {
    if (!filterActive()) return true;
    if (e.type === 'schedule_created' || e.type === 'schedule_changed') {
      const slug = this.spaces.get(e.space_id ?? '')?.slug;
      return !filter.spaces.size || (!!slug && filter.spaces.has(slug));
    }
    if (e.agent_id) {
      // The agent itself, not the visible list: that is only rebuilt once this event has been applied.
      const a = this.all.get(e.agent_id);
      if (a) return passes(a);
      // A retired or unseen agent: its space can still be judged, its tags cannot.
      const slug = this.spaces.get(e.space_id ?? '')?.slug;
      return !filter.tags.size && (!filter.spaces.size || (!!slug && filter.spaces.has(slug)));
    }
    return e.node_id ? this.nodes.has(e.node_id) : true;
  }

  private source: RostrSource | null = null;
  private get src(): RostrSource {
    if (!this.source) throw new Error('store.start(source) has not run');
    return this.source;
  }

  async start(source: RostrSource) {
    this.source = source;
    try {
      await this.refresh();
      await this.loadHistory();
      // What changed while the log was paged is in the log, not in the snapshot taken before it.
      this.scheduleRefresh();
    } catch (err) {
      this.fail(err);
      setTimeout(() => this.start(source), 5000);
      return;
    }
    this.follow();
    setInterval(() => this.refresh().catch((err) => this.fail(err)), POLL_MS);
  }

  private fail(err: unknown) {
    this.conn = 'error';
    this.error = err instanceof Error ? err.message : String(err);
    this.changed();
  }

  async refresh() {
    const started = ++this.refreshStarted;
    const [nodes, agents, spaces] = await Promise.all([this.src.nodes(), this.src.agents(), this.src.spaces()]);
    // Refetches overlap (debounce, poll, reconnect): a response older than the one applied is dropped.
    if (started < this.refreshApplied) return;
    this.refreshApplied = started;
    const previous = this.all;
    this.allNodes = new Map(nodes.map((n) => [n.id, n]));
    this.all = new Map(agents.filter((a) => !a.retired_at).map((a) => {
      a.artifacts = artifactList(a.artifacts);
      return [a.id, a];
    }));
    // Only agents a snapshot held: a new agent's first events arrive before the snapshot with it.
    for (const [id, a] of previous) if (!this.all.has(id)) this.forget(id, a.channels);
    this.spaces = new Map(spaces.map((s) => [s.id, s]));
    this.changed();
  }

  /** Drops what is kept per agent (and for its channels), for one that is gone. */
  private forget(id: string, channels: readonly Channel[] = this.all.get(id)?.channels ?? []) {
    this.panes.delete(id);
    this.statusSince.delete(id);
    this.lastActive.delete(id);
    this.runs.delete(id);
    for (const c of channels) this.buzz.delete(c.id);
  }

  private scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.refresh().catch((err) => this.fail(err)), REFRESH_DEBOUNCE_MS);
  }

  // ponytail: no "latest N" in the API (API-GAPS.md), so the whole visible log is paged from seq 0.
  // Resumes from lastSeq, so a retry after a failed page records nothing twice.
  private async loadHistory() {
    for (;;) {
      const page = await this.src.events(this.lastSeq);
      for (const e of page.events) this.record(e);
      if (page.next === this.lastSeq) break;
      this.lastSeq = page.next;
    }
    this.historyRead = true;
    this.changed();
  }

  private async follow() {
    let backoff = 1000;
    for (;;) {
      const opened = () => {
        this.conn = 'live';
        this.error = null;
        backoff = 1000;
        this.changed();
        for (const fn of this.openListeners) fn();
      };
      try {
        for await (const item of this.src.stream(this.lastSeq, opened)) {
          if (item.kind === 'event') this.receive(item.event);
          else {
            const now = Date.now();
            for (const a of item.frame.agents) this.noteActive(a.agent_id, now);
            for (const fn of this.usageListeners) fn(item.frame);
          }
        }
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      }
      this.conn = 'reconnecting';
      this.changed();
      await delay(backoff);
      backoff = Math.min(backoff * 2, 15_000);
      // Anything missed while down: the stream replays from lastSeq; the snapshot is refetched.
      this.refresh().catch((err) => this.fail(err));
    }
  }

  private receive(e: RostrEvent) {
    if (e.seq <= this.lastSeq) return;
    this.lastSeq = e.seq;
    const previousPane = e.agent_id ? this.panes.get(e.agent_id)?.pane_id : undefined;
    this.record(e);
    this.apply(e, previousPane);
    for (const fn of this.eventListeners) fn(e);
    if (e.agent_id || e.node_id) this.scheduleRefresh();
    this.changed();
  }

  /** Records activity at `at` (ms) unless the agent is already known active later. */
  noteActive(id: string, at: number) {
    if (at > (this.lastActive.get(id) ?? -Infinity)) this.lastActive.set(id, at);
  }

  /** Keeps the event and the facts only the log carries (pane, Buzz identity, status time, run); a retired agent's are dropped. */
  private record(e: RostrEvent) {
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    const d = e.data;
    const id = e.agent_id;
    if (!id) return;
    switch (e.type) {
      case 'address_changed': {
        const next = obj(d.new);
        const pane = str(next.pane_id);
        if (d.type === 'herdr-pane' && pane) this.panes.set(id, { pane_id: pane, herdr_name: str(next.herdr_name) });
        break;
      }
      case 'launched':
      case 'resumed':
      case 'renamed':
      case 'adopted': {
        const pane = str(d.pane_id);
        if (pane) this.panes.set(id, { pane_id: pane, herdr_name: str(d.herdr_name) ?? this.panes.get(id)?.herdr_name ?? null });
        break;
      }
      case 'status_changed': {
        this.statusSince.set(id, e.at);
        const at = Date.parse(e.at);
        if (d.old === 'working' || d.new === 'working') this.noteActive(id, at);
        const run = nextRun(this.runs.get(id), str(d.new), at);
        if (run) this.runs.set(id, run);
        else this.runs.delete(id);
        break;
      }
      case 'channel_added':
      case 'channel_changed': {
        // channel_changed carries the whole channel under `new`; channel_added carries it at the top.
        const ch = e.type === 'channel_added' ? d : obj(d.new);
        const cfg = obj(ch.config);
        const channelId = str(d.channel_id);
        if (ch.type === 'buzz' && channelId) this.buzz.set(channelId, { identity: str(cfg.identity), channel: str(cfg.channel) });
        break;
      }
      case 'agent_retired':
        this.forget(id);
        break;
    }
  }

  /** Patches the snapshot from a live event so the map moves before the refetch lands. */
  private apply(e: RostrEvent, previousPane?: string) {
    const d = e.data;
    const agent = e.agent_id ? this.all.get(e.agent_id) : undefined;
    if (e.type.startsWith('node_')) {
      const node = e.node_id ? this.allNodes.get(e.node_id) : undefined;
      if (!node) return;
      if (e.type === 'node_connected') { node.connected = true; node.state = 'online'; }
      if (e.type === 'node_disconnected') node.connected = false;
      if (e.type === 'node_stale') node.state = 'stale';
      if (e.type === 'node_offline') node.state = 'offline';
      return;
    }
    // Creation/adoption events carry desiredRow, not AgentView (no created_at or node_id).
    // New agents enter through the snapshot refetch; only complete records may reach the scene.
    if (!agent) return;
    switch (e.type) {
      case 'agent_retired':
        this.all.delete(agent.id);
        break;
      case 'status_changed': {
        const status = str(d.new);
        if (status) agent.status = status;
        if (status === 'missing') agent.inference = null;
        break;
      }
      case 'exited':
        agent.status = 'exited';
        break;
      case 'session_recorded': {
        const session = str(d.new);
        if (session !== agent.session_id) agent.inference = null;
        agent.session_id = session;
        break;
      }
      case 'inference_changed': {
        const pane = str(d.pane_id);
        if (!pane || !Object.hasOwn(d, 'new')) break;
        agent.inference = inferenceFrom(d.new);
        break;
      }
      case 'address_changed': {
        if (d.type !== 'herdr-pane') break;
        const next = str(obj(d.new).pane_id), old = str(obj(d.old).pane_id);
        if (next !== old) agent.inference = null;
        break;
      }
      case 'launched':
      case 'resumed': {
        const pane = str(d.pane_id);
        if (pane && pane !== previousPane) agent.inference = null;
        break;
      }
      case 'links_changed':
        // The event carries the whole new set: the map's menu follows a pane move at once.
        agent.links = Object.fromEntries(Object.entries(obj(d.new)).filter((kv): kv is [string, string] => typeof kv[1] === 'string'));
        break;
      case 'tokens_changed':
        // The whole new set: badges change the moment the plugin reports, not at the refetch.
        agent.tokens = tokenList(d.new);
        break;
      case 'agent_changed': {
        const changes = obj(d.changes);
        if (Object.hasOwn(changes, 'artifacts')) agent.artifacts = artifactList(obj(changes.artifacts).new);
        if (['kind', 'node_id', 'session_id'].some((key) => Object.hasOwn(changes, key) && obj(changes[key]).old !== obj(changes[key]).new)) agent.inference = null;
        break;
      }
      case 'reports_to_changed': {
        // A new agent target is patched in now; a person or an unseen agent waits for the refetch.
        const next = str(d.new);
        const target = next ? this.agentByPrincipal(next) : undefined;
        if (!next) agent.reports_to = null;
        else if (target) agent.reports_to = { type: 'agent', principal_id: next, agent_id: target.id, name: target.name, space: target.space_slug, retired: false };
        break;
      }
      case 'channel_added': {
        const channelId = str(d.channel_id);
        if (channelId && !agent.channels.some((c) => c.id === channelId)) {
          const ch: Channel = { id: channelId, type: str(d.type) ?? '?', source: 'configured', state: 'pending' };
          agent.channels = [...agent.channels, ch];
        }
        break;
      }
      case 'channel_removed':
      case 'channel_gone':
        agent.channels = agent.channels.filter((c) => c.id !== d.channel_id);
        if (d.type === 'herdr-pane') agent.inference = null;
        break;
      default:
        if (e.type.startsWith('channel_')) {
          const to = str(d.to);
          const ch = agent.channels.find((c) => c.id === d.channel_id);
          if (ch && to) ch.state = to;
        }
    }
  }

  // ─── derived reads

  agentEvents(agentId: string, limit = 20): RostrEvent[] {
    const out: RostrEvent[] = [];
    for (let i = this.events.length - 1; i >= 0 && out.length < limit; i--) {
      if (this.events[i].agent_id === agentId) out.push(this.events[i]);
    }
    return out;
  }

  /** Any live agent by name, filtered out or not: callers check `agents` for what is on screen. */
  agentByName(name: string): Agent | undefined {
    for (const a of this.all.values()) if (a.name === name) return a;
    return undefined;
  }

  agentByPrincipal(principalId: string): Agent | undefined {
    for (const a of this.all.values()) if (a.principal_id === principalId) return a;
    return undefined;
  }

  /** The live agent `a` reports to, if it reports to an agent on the map. */
  manager(a: Agent): Agent | undefined {
    const r = a.reports_to;
    return r && 'type' in r && r.type === 'agent' ? this.agents.get(r.agent_id) : undefined;
  }

  /** The agents reporting directly to `id`, by name. */
  reports(id: string): Agent[] {
    return [...this.agents.values()].filter((a) => this.manager(a)?.id === id).sort((x, y) => x.name.localeCompare(y.name));
  }

  /** `members` as nested teams (teams.ts buildTeams), by who reports to whom on the map. */
  teams(members: Agent[]): Team {
    return buildTeams(members, (a) => this.manager(a));
  }
}

export const store = new Store();
