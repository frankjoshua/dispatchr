import { describe, expect, it } from 'vitest';
import { castFor, effortTier } from './inference';
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
    ['gpt-5.6', 'codex'], ['openai/gpt-5.2-codex', 'codex'],
    ['gpt-4o', 'codex'], ['codex-mini-latest', 'codex'],
    [' ANTHROPIC/CLAUDE-OPUS-5-5 ', 'claude'],
  ])('uses %s as the %s cast regardless of runtime', (id, cast) => {
    expect(castFor({ kind: 'custom-runtime', inference: observed(id) })).toBe(cast);
  });

  it.each([
    'opus', 'sonnet', 'sol', 'my-claude-opus-5-5', 'claude-opus-5-5-impostor',
    'not-gpt-6.1-sol', 'gpt-6.1-solar', 'gpt-5.6-impostor', 'custom-codex',
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
