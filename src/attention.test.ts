import { describe, expect, it } from 'vitest';
import { attentionReason, nextNeeding } from './attention';
import type { Badge } from './badges';

const badge = (urgency: Badge['urgency'], ruled = true, name = 'mr_failed'): Badge => ({ source: 'herdr-pane', name, icon: '', text: '', show: 'both', color: null, urgency, ruled });

describe('attentionReason', () => {
  it('is blocked, a ruled alarm badge, or the reported done state', () => {
    expect(attentionReason('blocked', [])).toBe('blocked');
    expect(attentionReason('working', [badge('notice', true, 'mr_review'), badge('alarm')])).toBe('alarm badge mr_failed');
    expect(attentionReason('done', [])).toBe('done');
  });

  it('does not stop for ordinary work, idle, notices, or unruled alarms', () => {
    expect(attentionReason('working', [])).toBeNull();
    expect(attentionReason('idle', [badge('notice')])).toBeNull();
    expect(attentionReason('idle', [badge('alarm', false)])).toBeNull();
  });

  it('names a ruled alarm before the done reason', () => {
    expect(attentionReason('done', [badge('alarm', true, 'mr_merged')])).toBe('alarm badge mr_merged');
    expect(attentionReason('idle', [badge('alarm', true, 'repo')])).toBe('alarm badge repo');
  });
});

describe('nextNeeding', () => {
  const loop = ['a', 'b', 'c', 'd'];
  const waiting = (...ids: string[]) => (id: string) => ids.includes(id);

  it('skips agents that need nothing, going round', () => {
    expect(nextNeeding(loop, 'a', 'a', waiting('c'))).toBe('c');
    expect(nextNeeding(loop, 'c', 'c', waiting('a', 'c'))).toBe('a');
  });

  it('never stops at the selected agent when no other agent needs attention', () => {
    expect(nextNeeding(loop, 'b', 'b', waiting('b'))).toBeNull();
    expect(nextNeeding(loop, 'b', 'b', waiting())).toBeNull();
  });

  it('from outside the loop, the first that needs attention', () => {
    expect(nextNeeding(loop, 'gone', 'gone', waiting('b', 'd'))).toBe('b');
    expect(nextNeeding(loop, null, null, waiting('d'))).toBe('d');
  });

  it('can reach the last visited waiting agent when nothing is selected', () => {
    expect(nextNeeding(loop, 'c', null, waiting('c'))).toBe('c');
    expect(nextNeeding(loop, 'c', 'outside', waiting('c'))).toBe('c');
  });
});
