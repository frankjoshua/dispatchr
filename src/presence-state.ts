import { agentBadges, carriesAlarm, type Badge } from './badges';
import { brightness } from './recency';
import { activeAt, NAMED, packs } from './presence';
import { badges as badgeSettings, settings } from './settings';
import { store } from './store';
import type { Agent } from './types';
import { currentScheduleCounts } from './schedule-store';

class Presence {
  /** Packed away: off the map and out of the units list. */
  packed = new Set<string>();
  /** Packed agents looked for (search, a pick): back until reload. */
  readonly revealed = new Set<string>();
  /** agent id → brightness (recency.ts) among the agents not packed away. */
  lit = new Map<string, number>();
  /** The NAMED most recently active agents not packed away. */
  named = new Set<string>();
  /** agent id → its badges (badges.ts agentBadges) among the agents not packed away: the map's, the units list's and the loop bar's. */
  badges = new Map<string, Badge[]>();
  private listeners = new Set<() => void>();

  /** Called when brightness or names move (the panels redraw). */
  onChange(fn: () => void) { this.listeners.add(fn); }

  /** Who is packed away now; `keep`: an agent being looked at stays. Only once the log is read. */
  repack(keep: string | null) {
    const out = new Set<string>();
    if (settings.packQuiet && store.historyRead) {
      const now = Date.now();
      const scheduleCounts = currentScheduleCounts();
      for (const a of store.agents.values()) {
        const alarmed = carriesAlarm(a, badgeSettings, scheduleCounts.get(a.id) ?? 0);
        if (packs(a, store.lastActive, now, a.id === keep || this.revealed.has(a.id), alarmed)) out.add(a.id);
      }
    }
    this.packed = out;
  }

  /** Brightness, names and badges among the agents not packed away; tells listeners when brightness or names moved. */
  relight(now = Date.now()) {
    const shown = [...store.agents.values()].filter((a) => !this.packed.has(a.id));
    this.badges = agentBadges(shown, badgeSettings, currentScheduleCounts());
    const last = new Map(shown.map((a) => [a.id, activeAt(a, store.lastActive, now)]));
    const lit = brightness(last, now);
    const named = new Set([...last].flatMap(([id, t]) => (t === null ? [] : [[id, t] as const])).sort((a, b) => b[1] - a[1]).slice(0, NAMED).map(([id]) => id));
    const moved = lit.size !== this.lit.size || [...lit].some(([id, b]) => Math.abs(b - (this.lit.get(id) ?? -1)) > 0.01)
      || named.size !== this.named.size || [...named].some((id) => !this.named.has(id));
    this.lit = lit;
    this.named = named;
    if (moved) for (const fn of this.listeners) fn();
  }

  /** When an agent was last active (ms), for ordering; null if never seen. */
  at = (a: Agent): number | null => activeAt(a, store.lastActive, Date.now());
}

export const presence = new Presence();
