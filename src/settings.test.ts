import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BadgeRule } from './badges';

const RULES_KEY = 'dispatchr.badges';
const comment: BadgeRule = { name: 'mr_comments', icon: '@comment', urgency: 'notice', color: '#f0883e', show: 'both' };
let values: Map<string, string>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };

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
  return import('./settings');
}

describe('badge settings persistence', () => {
  it('retains token rules and display choices after loading a new page', async () => {
    const first = await import('./settings');
    first.setBadgeRules([comment, { name: 'repo', source: 'herdr-pane', hide: true }]);
    const reloaded = await anotherTab();
    expect(reloaded.badges.rules).toEqual([comment, { name: 'repo', source: 'herdr-pane', hide: true }]);
  });

  it('keeps newer token rules when an older tab edits its artifact rule', async () => {
    const older = await import('./settings');
    const newer = await anotherTab();
    newer.setBadgeRules([comment]);
    older.setCountRule('artifacts', { name: 'ignored', icon: '@flag', urgency: 'alarm' });
    const reloaded = await anotherTab();
    expect(reloaded.badges.rules).toEqual([comment]);
    expect(reloaded.badges.artifacts).toEqual({ name: 'artifacts', icon: '@flag', urgency: 'alarm' });
  });

  it('rejects stale token edits, then allows editing after reloading the saved rules', async () => {
    const older = await import('./settings');
    const newer = await anotherTab();
    newer.setBadgeRules([comment]);
    expect(older.setBadgeRules([])).toBe('conflict');
    expect(JSON.parse(values.get(RULES_KEY)!)).toEqual([comment]);
    older.reloadBadgeSettings();
    expect(older.badges.rules).toEqual([comment]);
    older.setBadgeRules([{ ...comment, urgency: 'alarm' }]);
    expect((await anotherTab()).badges.rules).toEqual([{ ...comment, urgency: 'alarm' }]);
  });

  it('does not replace a count rule saved by another tab', async () => {
    const older = await import('./settings');
    const newer = await anotherTab();
    newer.setCountRule('schedules', { name: 'schedules', icon: '@bell', hide: true });
    expect(older.setCountRule('schedules', { name: 'schedules', urgency: 'alarm' })).toBe('conflict');
    expect((await anotherTab()).badges.schedules).toEqual({ name: 'schedules', icon: '@bell', hide: true });
  });

  it('does not apply an edit when storage refuses the write', async () => {
    values.set(RULES_KEY, JSON.stringify([comment]));
    const settings = await import('./settings');
    storage.setItem.mockImplementation(() => { throw new Error('Quota exceeded'); });
    expect(settings.setBadgeRules([])).toBe('unavailable');
    expect(settings.badges.rules).toEqual([comment]);
    expect(JSON.parse(values.get(RULES_KEY)!)).toEqual([comment]);
  });

  it('does not overwrite unreadable saved rules with empty defaults', async () => {
    values.set(RULES_KEY, '{broken');
    const settings = await import('./settings');
    expect(settings.reloadBadgeSettings()).toBe(false);
    expect(settings.setBadgeRules([])).toBe('unavailable');
    expect(values.get(RULES_KEY)).toBe('{broken');
  });
});

describe('navigation mode persistence', () => {
  it('enables attention-only navigation for existing preferences and retains an explicit all-agents choice', async () => {
    values.set('dispatchr.settings', JSON.stringify({ hideSleepers: false, dimQuiet: false }));
    const first = await import('./settings');
    expect(first.settings.navigationAttentionOnly).toBe(true);
    first.setSetting('navigationAttentionOnly', false);
    const reloaded = await anotherTab();
    expect(reloaded.settings.navigationAttentionOnly).toBe(false);
    expect(reloaded.settings.hideSleepers).toBe(false);
    expect(reloaded.settings.dimQuiet).toBe(false);
    reloaded.setSetting('navigationAttentionOnly', true);
    expect((await anotherTab()).settings.navigationAttentionOnly).toBe(true);
  });
});

describe('fold persistence', () => {
  it('remembers folded panels, unfolds on a second toggle, and keeps them apart from the units list sections', async () => {
    const first = await import('./settings');
    first.toggleFold('left');
    first.toggleFold('card');
    first.toggleFold('left');
    first.toggleSection('quiet/a');
    const reloaded = await anotherTab();
    expect([...reloaded.folds]).toEqual(['card']);
    expect([...reloaded.sections]).toEqual(['quiet/a']);
  });

  it('ignores a stored value that is not a list of names', async () => {
    values.set('dispatchr.folded', JSON.stringify(['right', 3, null]));
    values.set('dispatchr.sections', '{broken');
    const settings = await import('./settings');
    expect([...settings.folds]).toEqual(['right']);
    expect(settings.sections.size).toBe(0);
  });
});
