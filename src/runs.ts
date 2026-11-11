// Runs (GLOSSARY): one stretch of work, from starting to stopping, pausing while blocked. The store
// keeps each agent's current run from its status changes; the stack on the map stands as tall as the
// run has worked.

/** An agent's current run. */
export interface Run {
  /** Working time banked before it last blocked (ms). */
  worked: number;
  /** When its present working stretch began (ms); null while blocked. */
  since: number | null;
}

/** How long a run has been working, at `now` (ms). */
export function runTime(run: Run, now: number): number {
  return run.worked + (run.since === null ? 0 : Math.max(0, now - run.since));
}

/**
 * The run after a status change to `status` at `at` (ms): working starts one or resumes a blocked
 * one, blocked banks the stretch worked so far, anything else ends it (undefined).
 */
export function nextRun(run: Run | undefined, status: string | null, at: number): Run | undefined {
  if (status === 'working') {
    if (!run) return { worked: 0, since: at };
    return run.since === null ? { worked: run.worked, since: at } : run;
  }
  if (status === 'blocked') return run && run.since !== null ? { worked: run.worked + at - run.since, since: null } : run;
  return undefined;
}
