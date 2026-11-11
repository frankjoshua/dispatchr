// The working loop's order, current stop and explicit dismissals, remembered per browser
// (API-GAPS.md #7). Old visit logs migrate into the order only; they never restrict which agents can
// enter navigation.

import { isObj } from './data';
import { jumpLoop, workingLoop } from './loop';

/** Named for the visit logs it once held; kept so saved loops survive. */
const KEY = 'dispatchr.visits';
interface LoopState { order: string[]; current: string | null; dismissed: Set<string> }
const strings = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : [];

function load(): LoopState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const saved = isObj(value) ? value : {};
    const raw = Array.isArray(value) ? value : saved.visits;
    const legacy = Array.isArray(raw) ? raw.filter((v): v is { id: string; at: number } =>
      isObj(v) && typeof v.id === 'string' && typeof v.at === 'number' && Number.isFinite(v.at))
      .sort((a, b) => a.at - b.at) : [];
    return {
      order: [...new Set([...strings(saved.order), ...legacy.map((v) => v.id)])],
      current: typeof saved.current === 'string' ? saved.current : legacy.at(-1)?.id ?? null,
      dismissed: new Set(strings(saved.dismissed)),
    };
  } catch {
    return { order: [], current: null, dismissed: new Set() };
  }
}

let { order, current, dismissed } = load();
const listeners = new Set<() => void>();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ order, current, dismissed: [...dismissed] })); } catch { /* private mode: not remembered */ }
  for (const fn of listeners) fn();
}

/** Makes `id` the current stop of the new order; agents no longer among the candidates leave the dismissals with it. */
function arrive(id: string, next: string[]) {
  order = next;
  const kept = new Set(order);
  dismissed = new Set([...dismissed].filter((x) => x !== id && kept.has(x)));
  current = id;
  save();
}

export const loopState = {
  get order(): readonly string[] { return order; },
  get current(): string | null { return current; },
  get dismissed(): ReadonlySet<string> { return dismissed; },
  /**
   * A direct choice goes after the current stop, including when neither agent was visited before.
   * `candidates`: every live agent, filtered out or not; the order keeps only those.
   */
  jump(id: string, from: string | null, candidates: Iterable<string>) {
    const loop = workingLoop(candidates, order);
    const anchor = from && loop.includes(from) ? from : current;
    arrive(id, jumpLoop(loop, anchor, id));
  },
  /** Next/Previous/Fast forward and restored page selections do not reorder known stops. `candidates` as for `jump`. */
  step(id: string, candidates: Iterable<string>) {
    arrive(id, [...new Set([...workingLoop(candidates, order), id])]);
  },
  /** Hide this stop until a deliberate visit, without changing its place in the sequence. */
  forget(id: string) {
    dismissed.add(id);
    save();
  },
  onChange(fn: () => void) { listeners.add(fn); },
};
