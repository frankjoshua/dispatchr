import { describe, expect, it } from 'vitest';
import { CHARACTERS, castFor, characterIdFor, effortTier, parseCharacterRules, type CharacterRule } from './inference';
import type { Inference } from './types';

const effort = (configured: string | null, level: string | null): Inference => ({
  model: null, effort: { configured, level, source: 'omp-thinking', reported_at: null },
});
const observed = (id: string | null, provider: string | null = null): Inference => ({
  model: { id, provider, source: 'omp-response', reported_at: null }, effort: null,
});

describe('effort tiers', () => {
  it.each([
    ['medium', 0], ['low', 0], ['minimal', 0], ['no effort', 0], ['off', 0], ['auto', 0],
    ['high', 1], ['extra high', 2], ['xhigh', 2], ['extra_high', 2], ['extra-high', 2], ['max', 3],
    [' HIGH ', 1], [' Extra-High ', 2], ['MAX', 3], [' extra  HIGH ', 2],
    ['highest', 0], ['very high', 0], ['maximum', 0], ['future-effort', 0],
  ])('maps the exact selector %s to tier %s', (raw, tier) => {
    expect(effortTier(effort(raw as string, null))).toBe(tier);
  });

  it('keeps configured selectors authoritative, including auto and unknown selectors', () => {
    expect(effortTier(effort('auto', 'max'))).toBe(0);
    expect(effortTier(effort('off', 'max'))).toBe(0);
    expect(effortTier(effort('medium', 'max'))).toBe(0);
    expect(effortTier(effort('future-effort', 'max'))).toBe(0);
    expect(effortTier(effort('high', 'max'))).toBe(1);
    expect(effortTier(effort('max', 'high'))).toBe(3);
  });

  it('uses reported levels only when no selector was observed', () => {
    expect(effortTier(effort(null, 'high'))).toBe(1);
    expect(effortTier(effort(null, 'xhigh'))).toBe(2);
    expect(effortTier(effort(null, 'max'))).toBe(3);
    expect(effortTier(effort(null, 'unknown-level'))).toBe(0);
    expect(effortTier(effort(null, null))).toBe(0);
    expect(effortTier({ model: null, effort: null })).toBe(0);
    expect(effortTier(null)).toBe(0);
    expect(effortTier(undefined)).toBe(0);
  });

  it('does not rewrite raw observations when choosing a visual tier', () => {
    const inference = effort(' Auto ', 'MAX');
    expect(effortTier(inference)).toBe(0);
    expect(inference).toEqual(effort(' Auto ', 'MAX'));
  });
});

describe('existing human cast presets', () => {
  it.each([
    ['claude-opus-5-5', 'claude'], ['anthropic/claude-opus-5-5', 'claude'],
    ['claude-3-opus-20240229', 'claude'],
    ['claude-sonnet-5-5', 'pi'], ['gateway/anthropic/claude-sonnet-5-5', 'pi'],
    ['claude-3-5-sonnet-20241022', 'pi'],
    ['gpt-6.1-sol', 'omp'], ['openai-codex/gpt-6.1-sol', 'omp'],
    ['gpt-6.1-fable', 'fable'], ['openai-codex/gpt-6.1-fable', 'fable'],
    ['gateway/openai/GPT-6.1-FABLE', 'fable'], ['gpt-12-fable', 'fable'],
    ['gpt-5.6', 'codex'], ['openai/gpt-5.2-codex', 'codex'],
    ['gpt-4o', 'codex'], ['codex-mini-latest', 'codex'],
    [' ANTHROPIC/CLAUDE-OPUS-5-5 ', 'claude'],
  ])('uses %s as the %s cast regardless of runtime', (id, cast) => {
    expect(castFor({ kind: 'custom-runtime', inference: observed(id) })).toBe(cast);
  });

  it.each([
    'opus', 'sonnet', 'sol', 'my-claude-opus-5-5', 'claude-opus-5-5-impostor',
    'not-gpt-6.1-sol', 'gpt-6.1-solar', 'gpt-5.6-impostor', 'custom-codex',
    'fable', 'not-gpt-6.1-fable', 'gpt-6.1-fables', 'gpt-6.1-fable-preview',
    'gpt-6.1-fable-2026-11-11', 'gpt-6.1-fable/', 'gpt-fable', 'gpt-six-fable',
    'claude-haiku-5', 'claude-opus-5-5/', 'unknown-model',
  ])('retains runtime cast at matching boundaries: %s', (id) => {
    expect(castFor({ kind: 'custom-runtime', inference: observed(id, 'openai') })).toBe('custom-runtime');
  });

  it('does not infer models from provider, effort or runtime configuration', () => {
    expect(castFor({ kind: 'claude', inference: observed(null, 'openai-codex') })).toBe('claude');
    expect(castFor({ kind: 'pi', inference: effort('max', null) })).toBe('pi');
    expect(castFor({ kind: 'omp', inference: null })).toBe('omp');
    expect(castFor({ kind: 'custom-runtime' })).toBe('custom-runtime');
  });
});

describe('viewer character assignments', () => {
  it('uses the first custom match before the built-in presets', () => {
    const agent = { kind: 'claude', inference: observed('openai/gpt-6.1-sol') };
    const rules: CharacterRule[] = [
      { pattern: 'gpt-*', character: 'fable' },
      { pattern: 'gpt-6.1-sol', character: 'pi' },
    ];
    expect(castFor(agent, rules)).toBe('fable');
    expect(castFor(agent, [...rules].reverse())).toBe('pi');
    expect(castFor(agent, [])).toBe('omp');
  });

  it('matches provider-qualified patterns against the whole identifier only', () => {
    const rules: CharacterRule[] = [{ pattern: 'openai/gpt-*', character: 'fable' }];
    expect(castFor({ kind: 'pi', inference: observed('openai/gpt-6.1-sol') }, rules)).toBe('fable');
    expect(castFor({ kind: 'pi', inference: observed('other/gpt-6.1-sol') }, rules)).toBe('omp');
    expect(castFor({ kind: 'pi', inference: observed('gateway/openai/gpt-6.1-sol') }, rules)).toBe('omp');
    expect(castFor({ kind: 'pi', inference: observed('gateway/openai/gpt-6.1-sol') },
      [{ pattern: '*/openai/gpt-*', character: 'fable' }])).toBe('fable');
  });

  it('matches unqualified patterns against the basename, trimming and ignoring case', () => {
    const rules: CharacterRule[] = [{ pattern: ' GPT-6.1-FABLE ', character: 'codex' }];
    expect(castFor({ kind: 'pi', inference: observed(' GATEWAY/OPENAI/GPT-6.1-FABLE ') }, rules)).toBe('codex');
    expect(castFor({ kind: 'pi', inference: observed('gpt-6.1-fable') }, rules)).toBe('codex');
    expect(castFor({ kind: 'pi', inference: observed('openai/other') },
      [{ pattern: 'openai*', character: 'fable' }])).toBe('pi');
  });

  it('treats everything except the wildcard as literal text', () => {
    const rules: CharacterRule[] = [{ pattern: 'model.[x]+?*', character: 'fable' }];
    expect(castFor({ kind: 'pi', inference: observed('model.[x]+?revision') }, rules)).toBe('fable');
    expect(castFor({ kind: 'pi', inference: observed('modelAxrevision') }, rules)).toBe('pi');
    expect(castFor({ kind: 'pi', inference: observed('model.[x]+?') }, rules)).toBe('fable');
    expect(castFor({ kind: 'pi', inference: observed('prefix-model.[x]+?revision') }, rules)).toBe('pi');
  });

  it('allows Runtime to bypass a recognized preset and later rules', () => {
    expect(castFor({ kind: 'custom-runtime', inference: observed('openai/gpt-6.1-fable') }, [
      { pattern: 'gpt-*', character: 'runtime' }, { pattern: '*', character: 'omp' },
    ])).toBe('custom-runtime');
  });

  it('never invents a model when a wildcard rule exists', () => {
    const rules: CharacterRule[] = [{ pattern: '*', character: 'fable' }];
    for (const inference of [undefined, null, observed(null, 'openai'), observed(''), observed('   '), effort('max', null)]) {
      expect(castFor({ kind: 'claude', inference }, rules)).toBe('claude');
    }
  });

  it('leaves unmatched custom models on their runtime', () => {
    expect(castFor({ kind: 'custom-runtime', inference: observed('provider/unknown') },
      [{ pattern: 'other*', character: 'fable' }])).toBe('custom-runtime');
  });
});

describe('character rule validation', () => {
  it('accepts all finite characters and runtime, and normalizes pattern copies', () => {
    const rules = [...CHARACTERS.map(({ id }) => ({ pattern: ' MODEL-* ', character: id })),
      { pattern: ' Provider/Model ', character: 'runtime' }];
    expect(parseCharacterRules(rules)).toEqual(rules.map((rule) => ({
      ...rule, pattern: rule.pattern.trim().toLowerCase(),
    })));
    expect(rules[0].pattern).toBe(' MODEL-* ');
    expect(parseCharacterRules([])).toEqual([]);
  });

  it('enforces the rule-count and pattern-length bounds inclusively', () => {
    expect(parseCharacterRules(Array.from({ length: 64 }, () => ({ pattern: '*', character: 'omp' })))).toHaveLength(64);
    expect(parseCharacterRules(Array.from({ length: 65 }, () => ({ pattern: '*', character: 'omp' })))).toBeNull();
    expect(parseCharacterRules([{ pattern: 'x'.repeat(160), character: 'fable' }])).toHaveLength(1);
    expect(parseCharacterRules([{ pattern: 'x'.repeat(161), character: 'fable' }])).toBeNull();
  });

  it.each([
    null, undefined, {}, '[]', [null], [undefined], [[]], [42],
    [{}], [{ pattern: '', character: 'omp' }], [{ pattern: '   ', character: 'omp' }],
    [{ pattern: 12, character: 'omp' }], [{ pattern: '*', character: null }],
    [{ pattern: '*', character: 'unknown' }], [{ pattern: '*', character: 'OMP' }],
    [{ pattern: '*', character: 'omp' }, { pattern: '*', character: 'not-a-character' }],
  ].map((value) => [value]))('rejects invalid input atomically: %j', (value) => {
    expect(parseCharacterRules(value)).toBeNull();
  });
});

describe('finite character sprites', () => {
  it('preserves each catalog identity but falls back for unknown runtimes', () => {
    for (const { id } of CHARACTERS) expect(characterIdFor(id)).toBe(id);
    for (const value of ['', 'unknown', '../fable', 'FABLE', 'toString', '__proto__']) {
      expect(characterIdFor(value)).toBe('omp');
    }
  });
});
