import type { Agent } from './types';

export interface Team {
  /** Who leads it; null for the whole group. */
  manager: Agent | null;
  /** The manager first, then its reports that lead no team of their own; by name. */
  agents: Agent[];
  /** Its reports that lead teams of their own; by name. */
  teams: Team[];
}

/** Everyone in a team, its nested teams included. */
export function teamMembers(t: Team): Agent[] {
  return [...t.agents, ...t.teams.flatMap(teamMembers)];
}

/**
 * `members` as nested teams: the root holds the members reporting to no one among them; a member
 * with reports among them leads a team of its own, nested where it reports. `managerOf` names who
 * an agent reports to, if anyone. A loop (rostr refuses them) has no root: its members end up in the
 * root's own agents.
 */
export function buildTeams(members: Agent[], managerOf: (a: Agent) => Agent | undefined): Team {
  const byName = [...members].sort((a, b) => a.name.localeCompare(b.name));
  const here = new Set(members.map((a) => a.id));
  const under = new Map<string, Agent[]>();
  for (const a of byName) {
    const m = managerOf(a);
    if (m && here.has(m.id)) under.set(m.id, [...(under.get(m.id) ?? []), a]);
  }
  const seen = new Set<string>();
  const build = (manager: Agent | null, list: Agent[]): Team => {
    const team: Team = { manager, agents: manager ? [manager] : [], teams: [] };
    for (const a of list) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      const reports = under.get(a.id);
      if (reports) team.teams.push(build(a, reports));
      else team.agents.push(a);
    }
    return team;
  };
  const root = build(null, byName.filter((a) => !here.has(managerOf(a)?.id ?? '')));
  for (const a of byName) if (!seen.has(a.id)) root.agents.push(a);
  return root;
}
