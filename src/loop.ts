// The working loop: every available agent, in the viewer's preferred order. Filtering attention or
// dismissing a stop never changes the underlying order, so steps can continue past a hidden selection.

export type LoopMove = 'jump' | 'step';

/** All candidates, once each: saved order first, then newcomers in the supplied order. */
export function workingLoop(candidates: Iterable<string>, order: readonly string[]): string[] {
  const available = new Set(candidates), result: string[] = [];
  for (const id of order) if (available.delete(id)) result.push(id);
  return result.concat([...available]);
}

/** Which stops are shown and traversed; membership never depends on visit history. */
export function loopStops(
  loop: readonly string[], dismissed: ReadonlySet<string>, attentionOnly: boolean, needs: (id: string) => boolean,
): string[] {
  return loop.filter((id) => !dismissed.has(id) && (!attentionOnly || needs(id)));
}

/** Makes a direct jump the next stop, preserving the relative order of the other agents. */
export function jumpLoop(loop: readonly string[], current: string | null, to: string): string[] {
  const at = current === null ? -1 : loop.indexOf(current);
  if (at < 0 || current === to || loop[(at + 1) % loop.length] === to) {
    return loop.includes(to) ? [...loop] : [...loop, to];
  }
  const next = loop.filter((id) => id !== to);
  next.splice(next.indexOf(current as string) + 1, 0, to);
  return next;
}

/** Step through eligible stops without losing the position of a current agent that just became ineligible. */
export function stepLoop(
  loop: readonly string[], current: string | null, dir: 1 | -1, eligible: ReadonlySet<string>,
): string | null {
  const index = current === null ? -1 : loop.indexOf(current);
  const start = index < 0 && dir < 0 ? 0 : index;
  for (let n = 1; n <= loop.length; n++) {
    const id = loop[(start + dir * n + loop.length) % loop.length];
    if (eligible.has(id)) return id;
  }
  return null;
}
