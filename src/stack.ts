import { runTime, type Run } from './runs';

// The Stack (GLOSSARY): how tall an agent's place stands, in px, from how long its current run has
// been working. It grows while the agent works, fast at first and on a log scale to full height at
// RUN_FULL_MIN, holds while it is blocked, and drops back to STACK_MIN when it stops.

export const STACK_MIN = 24;
/** What a full-height run adds to STACK_MIN. */
export const STACK_K = 150;
/** Minutes of working time at which the stack is full height. */
export const RUN_FULL_MIN = 60;

/** `since`: when the agent's status last changed, for a working agent whose run is unknown. */
export function stackHeight(status: string, run: Run | undefined, since: string | undefined, now: number): number {
  if (status !== 'working' && status !== 'blocked') return STACK_MIN;
  // Working with no start in the log (it began before what rostr kept): from its last status change.
  const ms = Math.max(0, run ? runTime(run, now) : status === 'working' ? now - (Date.parse(since ?? '') || now) : 0);
  return STACK_MIN + STACK_K * Math.min(1, Math.log1p(ms / 60_000) / Math.log1p(RUN_FULL_MIN));
}
