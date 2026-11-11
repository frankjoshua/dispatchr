import type { Agent } from './types';

export type EffortTier = 0 | 1 | 2 | 3;

export const EFFORT_TIERS = [
  { tier: 0, label: 'Medium or lower / auto', selectors: ['medium', 'low', 'minimal', 'none', 'off', 'no effort', 'auto'] },
  { tier: 1, label: 'High', selectors: ['high'] },
  { tier: 2, label: 'Extra high', selectors: ['extra high', 'extra_high', 'extra-high', 'xhigh'] },
  { tier: 3, label: 'Max', selectors: ['max'] },
] as const;

/** A visual tier only: unknown and automatic selectors are not observations of low effort. */
export function effortTier(inference: Agent['inference']): EffortTier {
  const effort = inference?.effort;
  const selected = (effort?.configured ?? effort?.level)?.trim().toLowerCase().replace(/\s+/g, ' ');
  for (const entry of EFFORT_TIERS) for (const selector of entry.selectors) {
    if (selector === selected) return entry.tier;
  }
  return 0;
}

// Anchored model-id families, not provider or launcher guesses. Provider-qualified ids keep their
// raw spelling in the card; only their final slash component participates in the cast preset.
const OPUS = /^claude-(?:opus-\d+(?:[.-]\d+)*|\d+(?:-\d+)*-opus)(?:-\d{8})?$/;
const SONNET = /^claude-(?:sonnet-\d+(?:[.-]\d+)*|\d+(?:-\d+)*-sonnet)(?:-\d{8})?$/;
const SOL = /^gpt-\d+(?:\.\d+)*-sol$/;
const GPT = /^gpt-(?:\d+(?:\.\d+)*|4o)(?:-(?:mini|nano|codex|max|pro|chat|latest))*(?:-\d{4}-\d{2}-\d{2})?$/;

export const CUBICLE_CASTS = [
  { label: 'Opus', kind: 'claude', appearance: 'Orange cardigan and glasses', patterns: [OPUS] },
  { label: 'Sonnet', kind: 'pi', appearance: 'Purple sweater and headset', patterns: [SONNET] },
  { label: 'Sol', kind: 'omp', appearance: 'Blue shirt and folder', patterns: [SOL] },
  { label: 'GPT / Codex', kind: 'codex', appearance: 'Green hoodie and laptop', patterns: [GPT, /^codex-mini-latest$/] },
] as const;

/** Cubicles' existing human cast; other themes continue to use the agent's runtime kind. */
export function castFor(agent: Pick<Agent, 'kind' | 'inference'>): string {
  const raw = agent.inference?.model?.id;
  if (!raw) return agent.kind;
  const id = raw.slice(raw.lastIndexOf('/') + 1).trim().toLowerCase();
  for (const entry of CUBICLE_CASTS) for (const pattern of entry.patterns) {
    if (pattern.test(id)) return entry.kind;
  }
  return agent.kind;
}
