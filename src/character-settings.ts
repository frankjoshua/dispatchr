import { parseCharacterRules, type CharacterRule } from './inference';

const KEY = 'dispatchr.model-characters';
// Undefined means we could not read a valid baseline, so must not replace saved data.
let storedValue: string | null | undefined;

function readRules(): CharacterRule[] {
  const raw = localStorage.getItem(KEY);
  const rules = parseCharacterRules(JSON.parse(raw ?? '[]'));
  if (!rules) throw new TypeError('Invalid saved model character rules');
  storedValue = raw;
  return rules;
}

function loadRules(): CharacterRule[] {
  try { return readRules(); } catch { return []; }
}

/** Replaced whole so character resolution never observes a partially edited draft. */
export const characterSettings: { rules: readonly CharacterRule[] } = { rules: loadRules() };

export function reloadCharacterSettings(): boolean {
  try {
    characterSettings.rules = readRules();
    return true;
  } catch {
    return false;
  }
}

export function setCharacterRules(value: readonly CharacterRule[]): 'saved' | 'conflict' | 'unavailable' {
  const rules = parseCharacterRules(value);
  if (!rules) return 'unavailable';
  try {
    if (storedValue === undefined) {
      characterSettings.rules = rules;
      return 'unavailable';
    }
    if (localStorage.getItem(KEY) !== storedValue) return 'conflict';
    const json = JSON.stringify(rules);
    localStorage.setItem(KEY, json);
    storedValue = json;
    characterSettings.rules = rules;
    return 'saved';
  } catch {
    // The viewer can still use their choice in this tab without claiming it was persisted.
    characterSettings.rules = rules;
    return 'unavailable';
  }
}

export function onCharacterStorageChange(fn: () => void): void {
  addEventListener('storage', (event) => {
    if (event.key === null || event.key === KEY) fn();
  });
}
