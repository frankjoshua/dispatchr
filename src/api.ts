import { isObj } from './data';
import type { ScheduleSnapshot } from './schedule-store';
import type { Schedule } from './schedule-types';
import type { StreamItem } from './store';
import type { Agent, ContactChannel, Me, RNode, RostrEvent, Space, UsageFrame, UsagePage } from './types';

// The rostr API, GET only. With VITE_ROSTR_URL (rostr's tailnet address) the browser calls rostr there
// and the viewer is whoever Tailscale says they are; without it, same origin, through the dev server's
// proxy and its token. It implements the store, usage and schedule source contracts; main.ts plugs
// it into the store, usage, schedules and the panels.

const BASE = (import.meta.env.VITE_ROSTR_URL ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, detail: string) {
    super(`${status} ${code}: ${detail}`);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const body: { error?: string; detail?: string } = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? 'http_error', body.detail ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  nodes: () => get<{ nodes: RNode[] }>('/v1/nodes').then((r) => r.nodes),
  agents: () => get<{ agents: Agent[] }>('/v1/agents').then((r) => r.agents),
  spaces: () => get<{ spaces: Space[] }>('/v1/spaces').then((r) => r.spaces),
  schedules: (): Promise<ScheduleSnapshot> =>
    get<{ schedules: Schedule[] }>('/v1/schedules')
      .then((r): ScheduleSnapshot => ({ state: 'ready', schedules: r.schedules }))
      .catch((err: unknown): ScheduleSnapshot => {
        if (err instanceof ApiError && err.status === 404) return { state: 'unavailable' };
        if (err instanceof ApiError && err.status === 403) return { state: 'forbidden' };
        throw err;
      }),
  /** Who rostr takes the viewer for: the Tailscale login's person, or the proxy's token. */
  me: () => get<Me>('/v1/me'),
  // One page of the log in seq order; `next` is the last seq scanned (resume from it even if all hidden).
  events: (since: number, limit = 1000) =>
    get<{ events: RostrEvent[]; next: number }>(`/v1/events?since=${since}&limit=${limit}`),
  // The address book needs member on the agent: null when this token may only view (403); an empty list
  // when the agent has no channel (409).
  contact: (ref: string) =>
    get<{ channels: ContactChannel[] }>(`/v1/agents/${encodeURIComponent(ref)}/contact`)
      .then((r): ContactChannel[] | null => r.channels)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) return null;
        if (err instanceof ApiError && err.status === 409) return [];
        throw err;
      }),
  // Summed usage buckets of the agents this token can see. `by` names the row keys. null: this rostr
  // has no usage API (404).
  usage: (q: { from?: string; to?: string; agent?: string; by: string }) =>
    get<UsagePage>(`/v1/usage?${new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1]))}`)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }),
  stream,
};

const SILENT_MS = 60_000; // rostr pings every 25 s

// GET /v1/stream over fetch, since EventSource cannot send headers (the dev proxy adds them today, a
// hosted build may not). Calls onOpen once the response is up, yields each log event and usage frame,
// and returns when the server closes the stream. A stream silent for SILENT_MS is taken for dead (a
// sleeping laptop, a changed network) and throws; however it ends, the connection is closed.
async function* stream(since: number, onOpen: () => void): AsyncGenerator<StreamItem> {
  const ctrl = new AbortController();
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => ctrl.abort(new Error(`no data from /v1/stream for ${SILENT_MS / 1000} s`)), SILENT_MS);
  };
  try {
    arm();
    const res = await fetch(`${BASE}/v1/stream?since=${since}`, { headers: { accept: 'text/event-stream' }, signal: ctrl.signal });
    if (!res.ok || !res.body) throw new ApiError(res.status, 'stream', res.statusText);
    onOpen();
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      arm();
      if (done) return;
      buf += value;
      let cut: number;
      while ((cut = buf.search(/\r?\n\r?\n/)) >= 0) {
        const lines = buf.slice(0, cut).split(/\r?\n/);
        buf = buf.slice(cut).replace(/^\r?\n\r?\n/, '');
        const field = (name: string) => lines.filter((l) => l.startsWith(`${name}:`)).map((l) => l.slice(name.length + 1).replace(/^ /, ''));
        const data = field('data').join('\n');
        if (!data) continue;
        const frame: unknown = JSON.parse(data);
        if (!isObj(frame)) continue;
        // Usage frames are ephemeral (no id, never replayed); everything else with a seq is a log event.
        if (field('event')[0] === 'usage') {
          if (Array.isArray(frame.agents)) yield { kind: 'usage', frame: frame as unknown as UsageFrame }; // shape per the contract's UsageFrame
        } else if (typeof frame.seq === 'number') {
          yield { kind: 'event', event: frame as unknown as RostrEvent }; // shape per the contract's Event
        }
      }
    }
  } finally {
    clearTimeout(watchdog);
    ctrl.abort();
  }
}
