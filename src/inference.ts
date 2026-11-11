import type { Agent } from './types';
import { glob, type Glob } from './badges';

export type CharacterId = 'omp' | 'claude' | 'codex' | 'pi' | 'fable';

export const CHARACTERS = [
  { id: 'omp', label: 'Blue shirt', appearance: 'Blue shirt and folder' },
  { id: 'claude', label: 'Orange cardigan', appearance: 'Orange cardigan and glasses' },
  { id: 'codex', label: 'Green hoodie', appearance: 'Green hoodie and laptop' },
  { id: 'pi', label: 'Purple headset', appearance: 'Purple sweater and headset' },
  { id: 'fable', label: 'Burgundy waistcoat', appearance: 'Burgundy waistcoat, gold accents and silver hair' },
] as const satisfies readonly { id: CharacterId; label: string; appearance: string }[];

/** A finite sprite identity; unrecognized runtimes keep the baseline graphic. */
export function characterIdFor(value: string): CharacterId {
  switch (value) {
    case 'omp': case 'claude': case 'codex': case 'pi': case 'fable': return value;
    default: return 'omp';
  }
}

export interface CharacterRule {
  pattern: string;
  character: CharacterId | 'runtime';
}

/** Invalid imports are rejected together, never partially applied. */
export function parseCharacterRules(value: unknown): CharacterRule[] | null {
  if (!Array.isArray(value) || value.length > 64) return null;
  const rules: CharacterRule[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const { pattern, character } = entry as Record<string, unknown>;
    if (typeof pattern !== 'string' || pattern.length > 160 || !pattern.trim()) return null;
    if (typeof character !== 'string' || (character !== 'runtime' && !CHARACTERS.some((item) => item.id === character))) return null;
    rules.push({ pattern: pattern.trim().toLowerCase(), character: character as CharacterRule['character'] });
  }
  return rules;
}

interface CompiledCharacterRule { model: Glob; fullId: boolean; character: CharacterRule['character'] }
const compiledRules = new WeakMap<readonly CharacterRule[], CompiledCharacterRule[]>();
const NO_RULES: readonly CharacterRule[] = [];

function compileRules(rules: readonly CharacterRule[]): CompiledCharacterRule[] {
  let compiled = compiledRules.get(rules);
  if (!compiled) {
    compiled = rules.map((rule) => {
      const pattern = rule.pattern.trim().toLowerCase();
      return { model: glob(pattern), fullId: pattern.includes('/'), character: rule.character };
    });
    compiledRules.set(rules, compiled);
  }
  return compiled;
}

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
const FABLE = /^gpt-\d+(?:\.\d+)*-fable$/;
const GPT = /^gpt-(?:\d+(?:\.\d+)*|4o)(?:-(?:mini|nano|codex|max|pro|chat|latest))*(?:-\d{4}-\d{2}-\d{2})?$/;

export const MODEL_PRESETS = [
  { label: 'Opus', kind: 'claude', appearance: 'Orange cardigan and glasses', patterns: [OPUS] },
  { label: 'Sonnet', kind: 'pi', appearance: 'Purple sweater and headset', patterns: [SONNET] },
  { label: 'Sol', kind: 'omp', appearance: 'Blue shirt and folder', patterns: [SOL] },
  { label: 'Fable', kind: 'fable', appearance: 'Burgundy waistcoat, gold accents and silver hair', patterns: [FABLE] },
  { label: 'GPT / Codex', kind: 'codex', appearance: 'Green hoodie and laptop', patterns: [GPT, /^codex-mini-latest$/] },
] as const;

/** Viewer rules take precedence over model presets; neither changes the reported runtime or model. */
export function castFor(agent: Pick<Agent, 'kind' | 'inference'>, rules: readonly CharacterRule[] = NO_RULES): string {
  const raw = agent.inference?.model?.id;
  if (!raw?.trim()) return agent.kind;
  const fullId = raw.trim().toLowerCase();
  const id = fullId.slice(fullId.lastIndexOf('/') + 1);
  for (const entry of compileRules(rules)) {
    if (entry.model.test(entry.fullId ? fullId : id)) return entry.character === 'runtime' ? agent.kind : entry.character;
  }
  for (const entry of MODEL_PRESETS) for (const pattern of entry.patterns) {
    if (pattern.test(id)) return entry.kind;
  }
  return agent.kind;
}
