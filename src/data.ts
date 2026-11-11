import type { AgentToken } from './types';

// Small readers for untyped event payloads: rostr's event `data` differs per type and is not validated.

export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export const obj = (v: unknown): Obj => (isObj(v) ? v : {});
export const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** A token list from an event payload: the well-formed `{source, name, text}` entries. */
export const tokenList = (v: unknown): AgentToken[] =>
  (Array.isArray(v) ? v : []).flatMap((t) => {
    const o = obj(t);
    return typeof o.source === 'string' && typeof o.name === 'string' && typeof o.text === 'string' ? [{ source: o.source, name: o.name, text: o.text }] : [];
  });
