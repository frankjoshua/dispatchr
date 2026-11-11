import { store } from './store';
import type { RostrEvent, TokenCounts, UsageFrame, UsagePage, UsageRole, UsageRow } from './types';

/** How usage is read (api.ts implements it over HTTP; main.ts plugs it in). null: this rostr has no usage. */
export interface UsageSource {
  usage(q: { from?: string; to?: string; agent?: string; by: string }): Promise<UsagePage | null>;
}

// Cost and tokens of each agent's current session, from GET /v1/usage, kept live by the stream's
// ephemeral `usage` frames. A finished session is cleared, so the current session is the measure.
//
// "Current session": the one rostr recorded for the agent, else the session with the newest usage
// (agents report usage before rostr has recorded their session). Frames carry per-agent deltas
// only, so they move totals at once and a throttled refetch brings back the role and model split.

export const ROLES: UsageRole[] = ['main', 'advisor', 'subagent', 'helper'];
const EPOCH = '1970-01-01T00:00:00.000Z';
const RECENT_MS = 7 * 86_400_000; // first look for an agent's newest session here (one cheap query for all)
const RESYNC_MS = 15_000; // after live frames, refetch the exact split this long after the first one
const RATE_MS = 5 * 60_000; // the live counter's window
const HOUR_MS = 3_600_000;

/** agent id → its session with the newest usage hour (ties: the greater session ref). */
export function newestSessions(rows: UsageRow[]): Map<string, { session: string; hour: string }> {
  const newest = new Map<string, { session: string; hour: string }>();
  for (const r of rows) {
    if (!r.agent_id || !r.session || !r.hour) continue;
    const best = newest.get(r.agent_id);
    if (!best || r.hour > best.hour || (r.hour === best.hour && r.session > best.session)) newest.set(r.agent_id, { session: r.session, hour: r.hour });
  }
  return newest;
}

export interface Spend {
  /** USD, known costs only. */
  cost: number;
  /** False when some of it had no known price: show as "at least". */
  complete: boolean;
  tokens: number;
}

export interface AgentUsage extends Spend {
  session: string | null;
  kinds: TokenCounts;
  roles: Map<UsageRole, Spend & { names: Map<string, Spend> }>;
  models: Map<string, Spend>;
}

const tokensOf = (c: TokenCounts) => c.input + c.output + c.cache_read + c.cache_write + c.reasoning;
const blankSpend = (): Spend => ({ cost: 0, complete: true, tokens: 0 });
const blank = (session: string | null): AgentUsage => ({
  ...blankSpend(), session, kinds: { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 }, roles: new Map(), models: new Map(),
});
function addTo(s: Spend, cost: number, tokens: number, complete: boolean) {
  s.cost += cost;
  s.tokens += tokens;
  s.complete &&= complete;
}

/** A subagent or advisor an agent ran lately (map.ts draws them beside it while it works). */
export interface Helper { role: 'subagent' | 'advisor'; name: string }

/** agent id → its subagents and advisors in `rows` (usage by agent, role, name), busiest first. */
export function helpersOf(rows: UsageRow[]): Map<string, Helper[]> {
  const out = new Map<string, (Helper & { tokens: number })[]>();
  for (const r of rows) {
    if (!r.agent_id || !r.name || (r.role !== 'subagent' && r.role !== 'advisor')) continue;
    const list = out.get(r.agent_id) ?? [];
    list.push({ role: r.role, name: r.name, tokens: tokensOf(r) });
    out.set(r.agent_id, list);
  }
  return new Map([...out].map(([id, list]) => [id, list.sort((a, b) => b.tokens - a.tokens).map(({ role, name }) => ({ role, name }))]));
}

class Usage {
  state: 'loading' | 'ready' | 'unavailable' = 'loading';
  agents = new Map<string, AgentUsage>();
  /** Cost per hour of the watched agent's current session, oldest first, the last entry being this hour. */
  hours: number[] = [];
  watched: string | null = null;
  /** agent id → the subagents and advisors it ran this hour or last (refreshed with the rest). */
  helpers = new Map<string, Helper[]>();
  private recent: { at: number; cost: number; agent: string }[] = [];
  private changeListeners = new Set<() => void>();
  private frameListeners = new Set<(agentId: string, cost: number, tokens: number) => void>();
  private resyncTimer = 0;
  private source: UsageSource | null = null;
  private get src(): UsageSource {
    if (!this.source) throw new Error('usage.start(source) has not run');
    return this.source;
  }

  onChange(fn: () => void) { this.changeListeners.add(fn); }
  /** One call per agent in a live frame, with that agent's delta. */
  onFrame(fn: (agentId: string, cost: number, tokens: number) => void) { this.frameListeners.add(fn); }
  private changed() { for (const fn of this.changeListeners) fn(); }

  start(source: UsageSource) {
    this.source = source;
    store.onOpen(() => this.refresh());
    store.onUsage((f) => this.apply(f));
    store.onEvent((e: RostrEvent) => {
      // A new session clears the tower; new or retired agents change everyone's share.
      if (['session_recorded', 'agent_created', 'adopted', 'agent_retired'].includes(e.type)) this.resync(1000);
    });
  }

  /** Sum over the agents on the map. */
  total(): Spend {
    const t = blankSpend();
    for (const [id, u] of this.agents) if (store.agents.has(id)) addTo(t, u.cost, u.tokens, u.complete);
    return t;
  }

  share(agentId: string, total = this.total().cost): number {
    return total > 0 ? (this.agents.get(agentId)?.cost ?? 0) / total : 0;
  }

  /** Cost seen in live frames over the last five minutes, for the agents on the map. */
  rate(): number {
    const cut = Date.now() - RATE_MS;
    this.recent = this.recent.filter((r) => r.at >= cut);
    return this.recent.reduce((n, r) => n + (store.agents.has(r.agent) ? r.cost : 0), 0);
  }

  watch(agentId: string | null) {
    this.watched = agentId;
    this.hours = [];
    if (agentId) this.loadHours(agentId);
  }

  async refresh() {
    clearTimeout(this.resyncTimer);
    this.resyncTimer = 0;
    try {
      const now = Date.now();
      const [recent, totals, crew] = await Promise.all([
        this.src.usage({ from: new Date(now - RECENT_MS).toISOString(), by: 'agent,session,hour' }),
        this.src.usage({ from: EPOCH, by: 'agent,session,role,name,model' }),
        this.src.usage({ from: new Date(Math.floor(now / HOUR_MS) * HOUR_MS - HOUR_MS).toISOString(), by: 'agent,role,name' }),
      ]);
      if (!recent || !totals) {
        this.state = 'unavailable'; // a rostr without usage: recency rests on status changes alone
        this.changed();
        return;
      }
      const newest = newestSessions(recent.rows);
      // Spending in an hour counts as activity then (to the hour; never later than now): it covers the
      // agents whose status herdr only guesses, which change status rarely or never. Live agents only:
      // the store keeps nothing about one that is gone.
      for (const r of recent.rows) if (r.agent_id && r.hour && store.all.has(r.agent_id)) store.noteActive(r.agent_id, Math.min(now, Date.parse(r.hour) + HOUR_MS));
      // Every session each agent has usage for, over the whole retention.
      const known = new Map<string, Set<string>>();
      for (const r of totals.rows) {
        if (!r.agent_id || !r.session) continue;
        const set = known.get(r.agent_id) ?? new Set<string>();
        set.add(r.session);
        known.set(r.agent_id, set);
      }
      const next = new Map<string, AgentUsage>();
      const idle: string[] = [];
      // Every live agent, filtered out or not: widening the filter needs no reload.
      for (const a of store.all.values()) {
        const session = a.session_id ?? newest.get(a.id)?.session ?? null;
        if (session) next.set(a.id, blank(session));
        else if (known.has(a.id)) idle.push(a.id);
      }
      // Idle for over a week but never cleared: its newest session is still the current one. One
      // query per such agent, only when it has more than one session to choose from.
      await Promise.all(idle.map(async (id) => {
        const sessions = [...(known.get(id) ?? [])];
        const session = sessions.length === 1
          ? sessions[0]
          : newestSessions((await this.src.usage({ agent: id, from: EPOCH, by: 'agent,session,hour' }))?.rows ?? []).get(id)?.session;
        if (session) next.set(id, blank(session));
      }));
      for (const r of totals.rows) {
        const u = r.agent_id ? next.get(r.agent_id) : undefined;
        if (!u || r.session !== u.session) continue;
        const tokens = tokensOf(r);
        addTo(u, r.cost, tokens, r.cost_complete);
        for (const k of Object.keys(u.kinds) as (keyof TokenCounts)[]) u.kinds[k] += r[k];
        const role = r.role ?? 'main';
        const rs = u.roles.get(role) ?? { ...blankSpend(), names: new Map<string, Spend>() };
        addTo(rs, r.cost, tokens, r.cost_complete);
        if (r.name) {
          const ns = rs.names.get(r.name) ?? blankSpend();
          addTo(ns, r.cost, tokens, r.cost_complete);
          rs.names.set(r.name, ns);
        }
        u.roles.set(role, rs);
        const model = r.model ?? 'unknown model';
        const ms = u.models.get(model) ?? blankSpend();
        addTo(ms, r.cost, tokens, r.cost_complete);
        u.models.set(model, ms);
      }
      this.agents = next;
      this.helpers = helpersOf(crew?.rows ?? []);
      this.state = 'ready';
      if (this.watched) await this.loadHours(this.watched, false);
    } catch (err) {
      console.warn('usage refresh failed', err);
    }
    this.changed();
  }

  private async loadHours(agentId: string, notify = true) {
    const session = this.agents.get(agentId)?.session;
    const thisHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    const hours = new Array<number>(24).fill(0);
    if (session) {
      const page = await this.src.usage({ agent: agentId, from: new Date(thisHour - 23 * HOUR_MS).toISOString(), by: 'session,hour' })
        .catch(() => null);
      for (const r of page?.rows ?? []) {
        if (r.session !== session || !r.hour) continue;
        const i = 23 - Math.round((thisHour - Date.parse(r.hour)) / HOUR_MS);
        if (i >= 0 && i < 24) hours[i] += r.cost;
      }
    }
    if (this.watched !== agentId) return;
    this.hours = hours;
    if (notify) this.changed();
  }

  private apply(frame: UsageFrame) {
    const at = Date.now();
    for (const d of frame.agents) {
      let u = this.agents.get(d.agent_id);
      if (!u) {
        u = blank(store.all.get(d.agent_id)?.session_id ?? null);
        this.agents.set(d.agent_id, u);
      }
      const tokens = tokensOf(d);
      addTo(u, d.cost, tokens, true);
      for (const k of Object.keys(u.kinds) as (keyof TokenCounts)[]) u.kinds[k] += d[k];
      if (d.agent_id === this.watched && this.hours.length) this.hours[23] += d.cost;
      this.recent.push({ at, cost: d.cost, agent: d.agent_id });
      for (const fn of this.frameListeners) fn(d.agent_id, d.cost, tokens);
    }
    if (!this.resyncTimer) this.resync(RESYNC_MS);
    this.changed();
  }

  private resync(ms: number) {
    clearTimeout(this.resyncTimer);
    this.resyncTimer = window.setTimeout(() => this.refresh(), ms);
  }
}

export const usage = new Usage();
