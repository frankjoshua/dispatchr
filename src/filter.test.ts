import { describe, expect, it } from 'vitest';
import { facets } from './filter';
import type { Agent } from './types';

/** A test agent: only the fields the rule reads (an unchecked cast; the rest of Agent is unused). */
const agent = (space_slug: string, ...tags: string[]): Agent => ({ space_slug, tags }) as unknown as Agent;
const none = { spaces: new Set<string>(), tags: new Set<string>() };

describe('facets', () => {
  const agents = [agent('work', 'ui', 'api'), agent('work', 'ui'), agent('home')];

  it('counts agents per space and per tag, an agent once under each of its tags', () => {
    const { spaces, tags } = facets(agents, none);
    expect([...spaces]).toEqual([['work', 2], ['home', 1]]);
    expect([...tags]).toEqual([['ui', 2], ['api', 1]]);
  });

  it('keeps a chosen space or tag that no agent carries, at zero, without touching the counted ones', () => {
    const { spaces, tags } = facets(agents, { spaces: new Set(['gone', 'work']), tags: new Set(['old']) });
    expect(spaces.get('gone')).toBe(0);
    expect(spaces.get('work')).toBe(2);
    expect(tags.get('old')).toBe(0);
    expect(tags.get('ui')).toBe(2);
  });
});
