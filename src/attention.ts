// Needs attention (GLOSSARY): the agents in the working loop waiting on the viewer, which Fast forward
// (») goes to in turn.

import type { Badge } from './badges';

/** Why an agent needs attention: blocked, a ruled alarm badge, or the same reported done state shown by the UI. */
export function attentionReason(status: string, badges: readonly Badge[]): string | null {
  if (status === 'blocked') return 'blocked';
  const alarm = badges.find((b) => b.ruled && b.urgency === 'alarm');
  if (alarm) return `alarm badge ${alarm.name}`;
  return status === 'done' ? 'done' : null;
}

/**
 * Fast forward from a navigation cursor, excluding only the actual selected agent. With no selection,
 * a full wrap may revisit the cursor itself; otherwise the sole waiting agent could be unreachable.
 */
export function nextNeeding(loop: readonly string[], current: string | null, selected: string | null, needs: (id: string) => boolean): string | null {
  const i = current === null ? -1 : loop.indexOf(current);
  for (let k = 1; k <= loop.length; k++) {
    const id = loop[(i + k) % loop.length];
    if (id !== selected && needs(id)) return id;
  }
  return null;
}
