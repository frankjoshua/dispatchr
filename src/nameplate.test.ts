import { describe, expect, it } from 'vitest';
import { coreName, NAMES_ZOOM, oneLine, plateRank, plateShown, splitCopy, wrapName } from './nameplate';

// A monospace font: every character 6 px wide; lines of at most 10 characters.
const width = (s: string) => [...s].length * 6;
const wrap = (name: string) => wrapName(name, 60, width);

describe('wrapName', () => {
  it('keeps a name that fits on one line whole', () => {
    expect(wrap('dispatchr')).toEqual(['dispatchr']);
  });

  it('breaks after dashes and underscores, the separator ending the line, each line as full as it fits', () => {
    expect(wrap('feat-port-noise-fixtures')).toEqual(['feat-port-', 'noise-', 'fixtures']);
    expect(wrap('CFO__install-to-paid')).toEqual(['CFO__', 'install-', 'to-paid']);
  });

  it('breaks at any non-alphanumeric character, but never inside a word of letters, accented ones included', () => {
    expect(wrap('reports/2026.weekly')).toEqual(['reports/', '2026.', 'weekly']);
    expect(wrap('café-réseau-ok')).toEqual(['café-', 'réseau-ok']);
  });

  it('drops the space a line ends on', () => {
    expect(wrap('chief of staff')).toEqual(['chief of', 'staff']);
  });

  it('cuts a run with nothing to break at where it overflows', () => {
    expect(wrap('abcdefghijklmnopqrstuvwxyz')).toEqual(['abcdefghij', 'klmnopqrst', 'uvwxyz']);
    expect(wrap('fix-868abcd6eabcdefghij')).toEqual(['fix-', '868abcd6ea', 'bcdefghij']);
  });

  it('never loses or reorders a character', () => {
    for (const name of ['ci-split-test-pipelines-868abcd12', 'a--b__c', 'x', 'feat-port-noise-fixtures-868abcd0j']) {
      const lines = wrap(name);
      expect(lines.join('').replace(/\s/g, '')).toBe(name.replace(/\s/g, ''));
      for (const line of lines) expect(width(line)).toBeLessThanOrEqual(60);
    }
  });
});

describe('coreName', () => {
  it('drops a leading kind of change and a tracker ID', () => {
    expect(coreName('feat-simulate-exposure-868abcd60')).toBe('simulate-exposure');
    expect(coreName('ci-drop-ios-simulator-lock-868abczdv')).toBe('drop-ios-simulator-lock');
    expect(coreName('Chore_user-e2e-run')).toBe('user-e2e-run');
  });

  it('keeps a copy number that follows the ID', () => {
    expect(coreName('fix-ios-screenshot-868abcd6e-2')).toBe('ios-screenshot-2');
  });

  it('leaves names without them alone: a kind word later on, plain numbers, short codes', () => {
    for (const name of ['information_reliability', 'CTO-73-2', 'choir-ci_speed', 'micro-ros2-teensy-4-srf04', 'CFO__install-to-paid']) {
      expect(coreName(name)).toBe(name);
    }
    expect(coreName('fix-revert-2567-timestamp-gap')).toBe('revert-2567-timestamp-gap');
  });

  it('keeps the whole name when nothing else would be left', () => {
    expect(coreName('ci')).toBe('ci');
    expect(coreName('feat-868abcd12')).toBe('feat-868abcd12');
  });
});

describe('oneLine', () => {
  // Lines of at most 20 characters.
  const line = (text: string) => oneLine(text, 120, width);

  it('keeps text that fits', () => {
    expect(line('social_media_manager')).toBe('social_media_manager');
  });

  it('cuts on a whole word when that keeps most of the line, else mid-word', () => {
    expect(line('child-pipelines-skip-security-wait')).toBe('child-pipelines…');
    expect(line('simulate-auto-white-balance')).toBe('simulate-auto-white…');
    expect(line('information_reliability')).toBe('information_reliabi…');
  });

  it('keeps a copy number after the cut, so an agent and its copy stay apart', () => {
    expect(line('strict-metrics-allowed-server-2')).toBe('strict-metrics…-2');
    expect(line('strict-metrics-allowed-server')).toBe('strict-metrics-allo…');
  });

  it('is never wider than the line', () => {
    for (const text of ['abcdefghijklmnopqrstuvwxyz0123', 'a-b-c-d-e-f-g-h-i-j-k-l-m-12', 'x_________________________y']) {
      expect(width(line(text))).toBeLessThanOrEqual(120);
    }
  });
});

describe('splitCopy', () => {
  it('splits off a one- or two-digit number after a separator', () => {
    expect(splitCopy('ios-screenshot-2')).toEqual(['ios-screenshot', '-2']);
    expect(splitCopy('skills_12')).toEqual(['skills', '_12']);
  });

  it('leaves longer numbers, digits inside a word and plain names whole', () => {
    for (const text of ['revert-2567', 'EVO-9b', 'ros2', 'dispatchr']) expect(splitCopy(text)).toEqual([text, '']);
  });
});

describe('plateShown', () => {
  it('far out, only loud, working and recent agents carry a plate', () => {
    expect(plateShown('idle', true, false, 0.2)).toBe(true);
    expect(plateShown('working', false, false, 0.2)).toBe(true);
    expect(plateShown('done', false, true, 0.2)).toBe(true);
    expect(plateShown('idle', false, false, 0.2)).toBe(false);
  });

  it('from NAMES_ZOOM, everyone does', () => {
    expect(plateShown('idle', false, false, NAMES_ZOOM)).toBe(true);
  });
});

describe('plateRank', () => {
  it('puts loud over working over recent over the rest, however bright', () => {
    const order = [plateRank('idle', true, false, 0), plateRank('working', false, false, 1), plateRank('idle', false, true, 1), plateRank('idle', false, false, 1)];
    expect([...order].sort((a, b) => b - a)).toEqual(order);
    expect(new Set(order).size).toBe(4);
  });

  it('puts the brighter on top within the same kind', () => {
    expect(plateRank('working', false, false, 0.9)).toBeGreaterThan(plateRank('working', false, false, 0.4));
  });
});
