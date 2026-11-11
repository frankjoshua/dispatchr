import { activeAt } from './presence';
import type { Agent } from './types';

const SEPARATORS = /[-_\s./]+/;

/** All matching agents, most recently active first; working agents are active now, ties by name. */
export function searchAgents(
  agents: Iterable<Agent>, query: string, last: ReadonlyMap<string, number>, now: number,
): Agent[] {
  const terms = query.toLowerCase().split(SEPARATORS).filter(Boolean);
  const hits: Agent[] = [];
  for (const agent of agents) {
    if (terms.length) {
      const name = agent.name.toLowerCase(), label = (agent.workspace_label ?? '').toLowerCase();
      if (!terms.every((term) => name.includes(term) || label.includes(term))) continue;
    }
    hits.push(agent);
  }
  return hits.sort((a, b) =>
    (activeAt(b, last, now) ?? -Infinity) - (activeAt(a, last, now) ?? -Infinity)
    || a.name.localeCompare(b.name));
}
