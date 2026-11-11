import { describe, expect, it } from 'vitest';
import { buildTeams, teamMembers, type Team } from './teams';
import type { Agent } from './types';

function agent(id: string): Agent {
  return {
    id, name: id, space_id: 'work-space', space_slug: 'work', node_id: 'work-node', node_name: 'workstation',
    kind: 'omp', launcher: 'herdr', profile: 'omp', cwd: '/work/project', workspace_label: null,
    session_id: null, resume: true, relaunch_on_exit: false, enabled: true, tags: [], notes: '',
    principal_id: `principal-${id}`, created_at: '2026-10-19T12:00:00Z', retired_at: null, status: 'idle',
    node_state: 'online', channels: [], links: {}, reports_to: null,
  };
}

/** Agents by id, and who each reports to (`reports`: agent id → its manager's id). */
function crew(ids: string[], reports: Record<string, string>) {
  const all = new Map(ids.map((id) => [id, agent(id)]));
  const pick = (...names: string[]) => names.map((id) => all.get(id)!);
  return { pick, managerOf: (a: Agent) => all.get(reports[a.id] ?? '') };
}

/** A team as names: its manager, its own agents and its nested teams. */
interface Shape { manager: string | null; agents: string[]; teams: Shape[] }
const shape = (t: Team): Shape => ({ manager: t.manager?.name ?? null, agents: t.agents.map((a) => a.name), teams: t.teams.map(shape) });

describe('buildTeams', () => {
  it('puts agents reporting to no one in the root, by name', () => {
    const { pick, managerOf } = crew(['zed', 'amy', 'kim'], {});
    expect(shape(buildTeams(pick('zed', 'amy', 'kim'), managerOf))).toEqual({ manager: null, agents: ['amy', 'kim', 'zed'], teams: [] });
  });

  it('nests a team where its lead reports, the lead first among its agents', () => {
    const { pick, managerOf } = crew(['lead', 'mid', 'worker', 'aide', 'solo'], { mid: 'lead', aide: 'lead', worker: 'mid' });
    expect(shape(buildTeams(pick('worker', 'solo', 'mid', 'lead', 'aide'), managerOf))).toEqual({
      manager: null,
      agents: ['solo'],
      teams: [{
        manager: 'lead',
        agents: ['lead', 'aide'],
        teams: [{ manager: 'mid', agents: ['mid', 'worker'], teams: [] }],
      }],
    });
  });

  it('puts an agent whose manager is not among the members in the root, still leading its own reports', () => {
    const { pick, managerOf } = crew(['boss', 'lead', 'worker'], { lead: 'boss', worker: 'lead' });
    expect(shape(buildTeams(pick('lead', 'worker'), managerOf))).toEqual({
      manager: null, agents: [], teams: [{ manager: 'lead', agents: ['lead', 'worker'], teams: [] }],
    });
    expect(shape(buildTeams(pick('worker'), managerOf))).toEqual({ manager: null, agents: ['worker'], teams: [] });
  });

  it('leaves a reporting loop flat in the root, each member once', () => {
    const { pick, managerOf } = crew(['a', 'b', 'c', 'free'], { a: 'b', b: 'c', c: 'a' });
    const root = buildTeams(pick('c', 'free', 'a', 'b'), managerOf);
    expect(shape(root)).toEqual({ manager: null, agents: ['free', 'a', 'b', 'c'], teams: [] });
  });

  it('places every member exactly once', () => {
    const { pick, managerOf } = crew(['a', 'b', 'c', 'd', 'e', 'f'], { b: 'a', c: 'b', d: 'b', e: 'f', f: 'e' });
    const names = teamMembers(buildTeams(pick('a', 'b', 'c', 'd', 'e', 'f'), managerOf)).map((x) => x.name).sort();
    expect(names).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});
