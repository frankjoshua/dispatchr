import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CharacterRule } from './inference';

// Fresh imports intentionally exercise page/tab loading boundaries; static imports cannot reload state.
const KEY = 'dispatchr.model-characters';
const fable: CharacterRule = { pattern: 'gpt-6.1-fable', character: 'fable' };
let values: Map<string, string>;
let storage: { getItem: Mock<(key: string) => string | null>; setItem: Mock<(key: string, value: string) => void> };

beforeEach(() => {
  vi.resetModules();
  values = new Map();
  storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => { vi.unstubAllGlobals(); });

async function anotherTab() {
  vi.resetModules();
  return import('./character-settings');
}

describe('model character settings', () => {
  it('persists ordered overrides and runtime fallback after a page reload', async () => {
    const first = await import('./character-settings');
    const rules: CharacterRule[] = [
      { pattern: 'provider/gpt-6.1-fable', character: 'codex' },
      { pattern: 'gpt-*-fable', character: 'runtime' },
      fable,
    ];
    expect(first.setCharacterRules(rules)).toBe('saved');
    expect((await anotherTab()).characterSettings.rules).toEqual(rules);
  });

  it('normalizes persisted patterns and does not retain the caller’s mutable draft', async () => {
    const settings = await import('./character-settings');
    const draft: CharacterRule[] = [{ pattern: '  GPT-*-FABLE  ', character: 'pi' }];
    expect(settings.setCharacterRules(draft)).toBe('saved');
    draft[0].character = 'codex';
    draft.push(fable);
    expect(settings.characterSettings.rules).toEqual([{ pattern: 'gpt-*-fable', character: 'pi' }]);
    expect((await anotherTab()).characterSettings.rules).toEqual([{ pattern: 'gpt-*-fable', character: 'pi' }]);
  });

  it('resets only custom rules by saving an empty list', async () => {
    const settings = await import('./character-settings');
    settings.setCharacterRules([{ pattern: 'gpt-*-fable', character: 'omp' }]);
    expect(settings.setCharacterRules([])).toBe('saved');
    expect((await anotherTab()).characterSettings.rules).toEqual([]);
    expect(values.get(KEY)).toBe('[]');
  });

  it('rejects a stale tab’s edit without applying it, then permits a deliberate reload', async () => {
    const older = await import('./character-settings');
    const newer = await anotherTab();
    expect(newer.setCharacterRules([fable])).toBe('saved');
    expect(older.setCharacterRules([{ pattern: '*', character: 'omp' }])).toBe('conflict');
    expect(older.characterSettings.rules).toEqual([]);
    expect(JSON.parse(values.get(KEY)!)).toEqual([fable]);
    expect(older.reloadCharacterSettings()).toBe(true);
    expect(older.characterSettings.rules).toEqual([fable]);
    expect(older.setCharacterRules([{ ...fable, character: 'pi' }])).toBe('saved');
    expect((await anotherTab()).characterSettings.rules).toEqual([{ ...fable, character: 'pi' }]);
  });

  it('applies in this tab but reports unavailable when a write fails, without replacing saved rules', async () => {
    values.set(KEY, JSON.stringify([fable]));
    const settings = await import('./character-settings');
    storage.setItem.mockImplementation(() => { throw new Error('Quota exceeded'); });
    const next: CharacterRule[] = [{ ...fable, character: 'claude' }];
    expect(settings.setCharacterRules(next)).toBe('unavailable');
    expect(settings.characterSettings.rules).toEqual(next);
    expect(JSON.parse(values.get(KEY)!)).toEqual([fable]);
  });

  it('remains usable in this tab when storage cannot even be read', async () => {
    storage.getItem.mockImplementation(() => { throw new Error('Storage blocked'); });
    const settings = await import('./character-settings');
    expect(settings.reloadCharacterSettings()).toBe(false);
    expect(settings.setCharacterRules([fable])).toBe('unavailable');
    expect(settings.characterSettings.rules).toEqual([fable]);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('does not overwrite malformed saved data with fallback defaults', async () => {
    values.set(KEY, '{broken');
    const settings = await import('./character-settings');
    expect(settings.reloadCharacterSettings()).toBe(false);
    expect(settings.setCharacterRules([fable])).toBe('unavailable');
    expect(settings.characterSettings.rules).toEqual([fable]);
    expect(values.get(KEY)).toBe('{broken');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('validates atomically and refuses invalid or unbounded rules without applying or writing', async () => {
    const settings = await import('./character-settings');
    settings.setCharacterRules([fable]);
    storage.setItem.mockClear();
    for (const rules of [
      [fable, { pattern: '', character: 'omp' }],
      [{ pattern: 'x'.repeat(161), character: 'omp' }],
      Array.from({ length: 65 }, () => fable),
      [{ pattern: '*', character: 'unknown' }],
    ]) {
      expect(settings.setCharacterRules(rules as CharacterRule[])).toBe('unavailable');
      expect(settings.characterSettings.rules).toEqual([fable]);
    }
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('retains effective choices when saved data becomes invalid during a reload', async () => {
    const settings = await import('./character-settings');
    settings.setCharacterRules([fable]);
    values.set(KEY, JSON.stringify([{ pattern: '*', character: 'nonexistent' }]));
    expect(settings.reloadCharacterSettings()).toBe(false);
    expect(settings.characterSettings.rules).toEqual([fable]);
  });

});
