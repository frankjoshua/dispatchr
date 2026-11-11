// How recently each agent was active, as a brightness by rank among the agents on the map rather than by
// the clock: the most recent are full brightness, grading down through the most recent third, and the
// rest sit at the dimmest. A rank, not a distance in time, so one agent busy right now does not push
// everyone else down, and minutes or days ago read the same. Agents active within ten minutes of each
// other count as equally recent: if all were active about as recently, none dims.

/** The dimmest an agent gets. */
export const DIMMEST = 0.35;
/** Agents within this of each other count as just as recent. */
const SAME_MS = 10 * 60_000;
/** The share of agents, most recent first, that grade from full brightness down to DIMMEST. */
const GRADED = 1 / 3;

/** `last`: agent id → when it was last active (ms), or null if never seen active. */
export function brightness(last: ReadonlyMap<string, number | null>, now: number): Map<string, number> {
  const times = [...last.values()].filter((t): t is number => t !== null).map((t) => Math.min(t, now));
  if (!times.length) return new Map([...last.keys()].map((id) => [id, 1]));
  return new Map([...last].map(([id, t]) => {
    if (t === null) return [id, DIMMEST];
    const at = Math.min(t, now);
    const ahead = times.filter((u) => u > at + SAME_MS).length;
    return [id, 1 - (1 - DIMMEST) * Math.min(1, ahead / last.size / GRADED)];
  }));
}
