import { describe, expect, it } from 'vitest';
import { agentBadges, artifactBadge, badgeLook, badgesFor, badgesInStack, carriesAlarm, coalesce, DEFAULT_ARTIFACT_RULE, DEFAULT_SCHEDULE_RULE, glob, onePerWorkspace, parseRules, plainText, scheduleBadgeCounts, type BadgeRule, type BadgeRuleSet } from './badges';

const tok = (name: string, text = '', source = 'mr-status') => ({ source, name, text });
/** A rule set with the given token rules and the default count rules, unless replaced. */
const ruleSet = (rules: readonly BadgeRule[], counts: Partial<Pick<BadgeRuleSet, 'artifacts' | 'schedules'>> = {}): BadgeRuleSet =>
  ({ rules, artifacts: DEFAULT_ARTIFACT_RULE, schedules: DEFAULT_SCHEDULE_RULE, ...counts });

describe('badgesFor', () => {
  it('styles a token by the first rule that matches its name', () => {
    const rules: BadgeRule[] = [
      { name: 'mr_failed', icon: '✗', color: '#f85149', urgency: 'alarm' },
      { name: 'mr_*', icon: '⑂', urgency: 'quiet' },
    ];
    expect(badgesFor([tok('mr_failed', '2376')], rules)).toEqual([
      { source: 'mr-status', name: 'mr_failed', icon: '✗', text: '2376', show: 'both', color: '#f85149', urgency: 'alarm', ruled: true },
    ]);
    expect(badgesFor([tok('mr_opened', '2535')], rules)[0]).toMatchObject({ icon: '⑂', urgency: 'quiet' });
  });

  it('matches a rule on the reporting source too, when it names one', () => {
    const rules: BadgeRule[] = [{ name: 'status', source: 'ci-*', icon: '●', urgency: 'alarm' }];
    expect(badgesFor([tok('status', 'red', 'ci-runner')], rules)[0].ruled).toBe(true);
    expect(badgesFor([tok('status', 'red', 'tracker')], rules)[0].ruled).toBe(false);
  });

  it('shows unmatched tokens as they are, quiet, and drops hidden ones', () => {
    const badges = badgesFor([tok('task', 'Fix login'), tok('mr_draft', '9')], [{ name: 'mr_draft', hide: true }]);
    expect(badges).toEqual([{ source: 'mr-status', name: 'task', icon: '', text: 'Fix login', show: 'text', color: null, urgency: 'quiet', ruled: false }]);
  });

  it('orders the most urgent first, then by rule, then as rostr gave them', () => {
    const rules: BadgeRule[] = [{ name: 'a', urgency: 'notice' }, { name: 'b', urgency: 'alarm' }, { name: 'c', urgency: 'notice' }];
    expect(badgesFor([tok('x'), tok('c'), tok('a'), tok('b')], rules).map((b) => b.name)).toEqual(['b', 'a', 'c', 'x']);
  });

  it('keeps a token reported by two sources as two facts', () => {
    const both = [tok('mr_opened', '\u{F04C2} 301', 'herdr-pane'), tok('mr_opened', '301', 'herdr-workspace')];
    expect(badgesFor(both, [{ name: 'mr_opened', icon: '⑂' }])).toHaveLength(2);
    // A rule for one source styles only that source's copy.
    const styled = badgesFor(both, [{ name: 'mr_opened', source: 'herdr-workspace', icon: '⑂', urgency: 'alarm' }]);
    expect(styled.map((b) => [b.source, b.urgency, b.ruled])).toEqual([['herdr-workspace', 'alarm', true], ['herdr-pane', 'quiet', false]]);
  });
});

describe('coalesce', () => {
  it('shows badges that look the same once, naming every source', () => {
    const both = [tok('mr_opened', '\u{F04C2} 301', 'herdr-pane'), tok('mr_opened', '301', 'herdr-workspace')];
    expect(coalesce(badgesFor(both, [{ name: 'mr_opened', icon: '⑂' }]))).toEqual([
      { source: 'herdr-pane, herdr-workspace', name: 'mr_opened', icon: '⑂', text: '301', show: 'both', color: null, urgency: 'notice', ruled: true },
    ]);
    // Styled differently, or different text: still two.
    expect(coalesce(badgesFor(both, [{ name: 'mr_opened', source: 'herdr-workspace', urgency: 'alarm' }]))).toHaveLength(2);
    expect(coalesce(badgesFor([tok('mr_opened', '301', 'a'), tok('mr_opened', '302', 'b')], []))).toHaveLength(2);
  });
});

describe('onePerWorkspace', () => {
  it("shows a workspace's badge on the first of its agents only, a pane's own on each", () => {
    const rules: BadgeRule[] = [{ name: 'mr_opened', icon: '⑂' }, { name: 'mr_comments', icon: '💬' }, { name: 'title' }];
    const twin = badgesFor([tok('mr_opened', '2535', 'ws'), tok('mr_comments', '1', 'ws'), tok('title', 'Same title', 'pane')], rules);
    const lists = new Map([['a', twin], ['a2', twin], ['b', twin]]);
    const ws: Record<string, string | null> = { a: 'w1', a2: 'w1', b: null };
    const out = onePerWorkspace(lists, (id) => ws[id], (x) => x.source === 'ws');
    expect(out.get('a')?.map((x) => x.name)).toEqual(['mr_opened', 'mr_comments', 'title']);
    expect(out.get('a2')?.map((x) => x.name)).toEqual(['title']); // its pane's own stays
    expect(out.get('b')).toHaveLength(3); // no workspace: shown as is
    // A pane's badge does not count as shown for the workspace: a twin's workspace badge of the same look stays.
    const paneFirst = new Map([['a', badgesFor([tok('title', 'X', 'pane')], rules)], ['a2', badgesFor([tok('title', 'X', 'ws')], rules)]]);
    expect(onePerWorkspace(paneFirst, (id) => ws[id], (x) => x.source === 'ws').get('a2')).toHaveLength(1);
  });
});

describe('agentBadges', () => {
  const rules: BadgeRule[] = [{ name: 'mr_opened', icon: '@merge' }];
  const agent = (id: string, created_at: string, node_id = 'n1') => ({ id, created_at, node_id, workspace_label: 'feat', tokens: [tok('mr_opened', '2535', 'herdr-workspace')] });

  it("puts a workspace's shared badge on its oldest agent, whatever order the agents come in", () => {
    const out = agentBadges([agent('newer', '2026-10-08T10:00:00Z'), agent('older', '2026-10-07T10:00:00Z')], ruleSet(rules));
    expect(out.get('older')).toHaveLength(1);
    expect(out.get('newer')).toHaveLength(0);
  });

  it('keeps workspaces of the same name on different computers apart', () => {
    const out = agentBadges([agent('here', '2026-10-07T10:00:00Z'), agent('there', '2026-10-08T10:00:00Z', 'n2')], ruleSet(rules));
    expect(out.get('there')).toHaveLength(1);
  });
});

describe('carriesAlarm', () => {
  const carrier = { id: 'one', created_at: '2026-10-07T10:00:00Z', node_id: 'n1', workspace_label: null, tokens: [tok('mr_failed')], artifacts: [{ url: 'https://example.test/report', metadata: {} }] };
  const alarm: BadgeRule = { name: '*', urgency: 'alarm' };

  it('is an alarm from a token, the artifact count or the schedule count', () => {
    expect(carriesAlarm(carrier, ruleSet([{ name: 'mr_failed', urgency: 'alarm' }]), 0)).toBe(true);
    expect(carriesAlarm(carrier, ruleSet([], { artifacts: { ...DEFAULT_ARTIFACT_RULE, urgency: 'alarm' } }), 0)).toBe(true);
    expect(carriesAlarm(carrier, ruleSet([], { schedules: { ...DEFAULT_SCHEDULE_RULE, urgency: 'alarm' } }), 2)).toBe(true);
  });

  it('is not a notice, a hidden alarm rule, or an alarm count of nothing', () => {
    expect(carriesAlarm(carrier, ruleSet([{ name: 'mr_failed', urgency: 'notice' }]), 0)).toBe(false);
    expect(carriesAlarm(carrier, ruleSet([{ ...alarm, hide: true }]), 0)).toBe(false);
    expect(carriesAlarm({ ...carrier, tokens: [], artifacts: [] }, ruleSet([], { artifacts: { ...DEFAULT_ARTIFACT_RULE, urgency: 'alarm' }, schedules: { ...DEFAULT_SCHEDULE_RULE, urgency: 'alarm' } }), 0)).toBe(false);
  });
});

describe('artifact badges', () => {
  it('counts each agent’s own records even when agents share a workspace', () => {
    const base = { created_at: '2026-10-07T10:00:00Z', node_id: 'n1', workspace_label: 'shared' };
    const item = { url: 'https://example.test/report', metadata: {} };
    const out = agentBadges([{ ...base, id: 'one', artifacts: [item] }, { ...base, id: 'two', artifacts: [item, item] }], ruleSet([]));
    expect(out.get('one')?.[0]).toMatchObject({ text: '1', action: 'artifacts' });
    expect(out.get('two')?.[0]).toMatchObject({ text: '2', action: 'artifacts' });
  });

  it('omits empty or explicitly hidden counts', () => {
    expect(artifactBadge(0, DEFAULT_ARTIFACT_RULE)).toBeNull();
    expect(artifactBadge(3, { ...DEFAULT_ARTIFACT_RULE, hide: true })).toBeNull();
  });

  it('uses the normal urgency and display choices', () => {
    const text = artifactBadge(3, { ...DEFAULT_ARTIFACT_RULE, show: 'text', urgency: 'quiet' })!;
    expect(text.urgency).toBe('quiet');
    expect(badgeLook(text, true)).toEqual({ icon: '', text: '3', marker: false });
    const icon = artifactBadge(3, { ...DEFAULT_ARTIFACT_RULE, show: 'icon', urgency: 'alarm' })!;
    expect(icon.urgency).toBe('alarm');
    expect(badgeLook(icon, false)).toEqual({ icon: '@artifacts', text: '', marker: true });
  });

  it('keeps the clickable count reachable when other badges fill the stack', () => {
    const tokens = badgesFor([tok('a'), tok('b'), tok('c')], [{ name: '*', urgency: 'alarm' }]);
    const artifact = artifactBadge(2, DEFAULT_ARTIFACT_RULE)!;
    expect(badgesInStack([...tokens, artifact], 3).map((b) => b.name)).toEqual(['a', 'b', 'artifacts']);
    expect(badgesInStack([...tokens, artifact], 0)).toEqual([]);
  });
});

describe('schedule badges', () => {
  const agent = (id: string) => ({ id, created_at: '2026-10-07T10:00:00Z', node_id: 'n1', workspace_label: 'shared' });

  it('counts each visible schedule association, including multiple targets, within the selected spaces', () => {
    const rows = [
      { space_slug: 'work', execution: { agent_ids: ['one', 'two'] } },
      { space_slug: 'work', execution: { agent_ids: ['two'] } },
      { space_slug: 'personal', execution: { agent_ids: ['one'] } },
      { space_slug: 'work', execution: { agent_ids: [] } },
    ];
    const counts = scheduleBadgeCounts(rows, new Set(['work']));
    expect([...counts]).toEqual([['one', 1], ['two', 2]]);
    const lists = agentBadges([agent('one'), agent('two')], ruleSet([]), counts);
    expect(lists.get('one')?.[0]).toMatchObject({ text: '1', icon: '@clock', action: 'schedules' });
    expect(lists.get('two')?.[0]).toMatchObject({ text: '2', action: 'schedules' });
  });

  it('applies schedule choices without changing artifact or token actions', () => {
    const carrier = { ...agent('one'), tokens: [tok('schedules', 'token')], artifacts: [{ url: 'https://example.test/report', metadata: {} }] };
    const rule: BadgeRule = { name: 'ignored', icon: '@bell', color: '#123456', urgency: 'quiet', show: 'text' };
    const list = agentBadges([carrier], ruleSet([{ name: '*', icon: '@flag' }], { schedules: rule }), new Map([['one', 4]])).get('one')!;
    const schedule = list.find((b) => b.action === 'schedules')!;
    expect(schedule).toMatchObject({ name: 'schedules', text: '4', icon: '@bell', color: '#123456', urgency: 'quiet' });
    expect(badgeLook(schedule, true)).toEqual({ icon: '', text: '4', marker: false });
    expect(list.find((b) => b.action === 'artifacts')).toMatchObject({ text: '1', urgency: 'notice' });
    expect(list.find((b) => b.source === 'mr-status')).toMatchObject({ text: 'token', icon: '@flag' });
  });

  it('omits zero, missing and hidden counts even for alarms', () => {
    for (const count of [undefined, 0, 3]) {
      const counts = count === undefined ? new Map<string, number>() : new Map([['one', count]]);
      const list = agentBadges([agent('one')], ruleSet([], { schedules: { name: 'schedules', urgency: 'alarm', hide: count === 3 } }), counts).get('one');
      expect(list).toEqual([]);
    }
  });

  it('keeps icon-only schedules clickable and falls back to text when their icon is removed', () => {
    const counts = new Map([['one', 2]]);
    const icon = agentBadges([agent('one')], ruleSet([], { schedules: { name: 'schedules', icon: '@bell', show: 'icon', urgency: 'alarm' } }), counts).get('one')![0];
    expect(badgeLook(icon, false)).toEqual({ icon: '@bell', text: '', marker: true });
    expect(icon).toMatchObject({ action: 'schedules', urgency: 'alarm' });
    const text = agentBadges([agent('one')], ruleSet([], { schedules: { name: 'schedules', show: 'icon' } }), counts).get('one')![0];
    expect(badgeLook(text, true)).toEqual({ icon: '', text: '2', marker: false });
    expect(text.action).toBe('schedules');
  });

  it('keeps both interactive counts reachable when token badges fill the stack', () => {
    const list = agentBadges([{ ...agent('one'), tokens: [tok('a'), tok('b'), tok('c')], artifacts: [{ url: 'https://example.test/report', metadata: {} }] }],
      ruleSet([{ name: '*', urgency: 'alarm' }]), new Map([['one', 2]])).get('one')!;
    expect(badgesInStack(list, 3).map((b) => b.name)).toEqual(['a', 'artifacts', 'schedules']);
  });
});

describe('badgesFor, more', () => {

  it('shows what the rule asks: icon and text, the icon alone, the text alone; text when there is no icon', () => {
    const show = (rule: BadgeRule) => badgesFor([tok('mr_review', 'someone')], [rule])[0];
    expect(show({ name: 'mr_review', icon: '@review' })).toMatchObject({ show: 'both', icon: '@review', text: 'someone' });
    expect(show({ name: 'mr_review', icon: '@review', show: 'icon' })).toMatchObject({ show: 'icon', text: 'someone' });
    expect(show({ name: 'mr_review', icon: '@review', show: 'text' }).show).toBe('text');
    expect(show({ name: 'mr_review', show: 'icon' }).show).toBe('text');
  });
});

describe('badgeLook', () => {
  const badge = (show: 'both' | 'icon' | 'text', text = '2376') =>
    badgesFor([tok('mr_failed', text)], [{ name: 'mr_failed', icon: '@alert', show }])[0];

  it('keeps a text-only badge text only at every zoom', () => {
    for (const far of [false, true]) expect(badgeLook(badge('text'), far)).toEqual({ icon: '', text: '2376', marker: false });
  });

  it('makes an icon-only badge a marker at every zoom', () => {
    for (const far of [false, true]) expect(badgeLook(badge('icon'), far)).toEqual({ icon: '@alert', text: '', marker: true });
  });

  it('shows icon and text up close, the marker far out', () => {
    expect(badgeLook(badge('both'), false)).toEqual({ icon: '@alert', text: '2376', marker: false });
    expect(badgeLook(badge('both'), true)).toEqual({ icon: '@alert', text: '', marker: true });
  });

  it('falls back to the token name when there is nothing else to show', () => {
    expect(badgeLook(badge('text', ''), true)).toEqual({ icon: '', text: 'mr_failed', marker: false });
  });
});

describe('glob', () => {
  it('matches whole names, * as any run, everything else literally', () => {
    expect(glob('mr_*').test('mr_failed')).toBe(true);
    expect(glob('mr_*').test('xmr_failed')).toBe(false);
    expect(glob('a.b').test('axb')).toBe(false);
    expect(glob('*_draft').test('pr_draft')).toBe(true);
  });

  it('matches a pattern without * only exactly', () => {
    expect(glob('mr_failed').test('mr_failed')).toBe(true);
    expect(glob('mr_failed').test('mr_failed_twice')).toBe(false);
    expect(glob('mr_failed').test('xmr_failed')).toBe(false);
    expect(glob('mr_failed').test('')).toBe(false);
  });

  it('matches anything with * alone, the empty string included', () => {
    expect(glob('*').test('mr_failed')).toBe(true);
    expect(glob('*').test('')).toBe(true);
    expect(glob('**').test('')).toBe(true);
  });

  it('needs the parts between * in order, none overlapping another', () => {
    expect(glob('a*b*c').test('abc')).toBe(true);
    expect(glob('a*b*c').test('a-b-b-c')).toBe(true);
    expect(glob('a*b*c').test('acb')).toBe(false);
    expect(glob('a*b*c').test('ab')).toBe(false);
    expect(glob('a*b*c').test('ac')).toBe(false);
    expect(glob('ab*bc').test('abc')).toBe(false);
    expect(glob('ab*bc').test('abbc')).toBe(true);
    expect(glob('a*bc*c').test('abc')).toBe(false);
    expect(glob('a*bc*c').test('abcc')).toBe(true);
  });

  it('answers a pattern of many * at once instead of backtracking', () => {
    const pattern = `${'*'.repeat(40)}zz`;
    expect(glob(pattern).test('mr_failed')).toBe(false);
    expect(glob(pattern).test('mr_failed_zz')).toBe(true);
    expect(glob(`${'*a'.repeat(30)}*b`).test('a'.repeat(60))).toBe(false);
  });
});

describe('plainText', () => {
  it('drops icon-font glyphs and tidies the spaces', () => {
    expect(plainText('\u{F0159} 2376 \u{F0159}')).toBe('2376');
    expect(plainText('\uF4C2  2535\u{F06D0}')).toBe('2535');
    expect(plainText('a reviewer')).toBe('a reviewer');
  });
});

describe('parseRules', () => {
  it('keeps well-formed rules and drops the rest', () => {
    expect(parseRules([
      { name: 'mr_failed', icon: '✗', color: '#f85149', urgency: 'alarm', source: 'mr-status' },
      { name: 'Bad Name' },
      { name: 'ok', color: 'red', urgency: 'loud', hide: 'yes' },
      'nonsense',
    ])).toEqual([
      { name: 'mr_failed', icon: '✗', color: '#f85149', urgency: 'alarm', source: 'mr-status' },
      { name: 'ok' },
    ]);
    expect(parseRules({ not: 'a list' })).toEqual([]);
  });

  it('keeps built-in icon names it knows and an older rule’s icon-only choice', () => {
    expect(parseRules([{ name: 'a', icon: '@comment', show: 'icon' }, { name: 'b', icon: '@nope' }, { name: 'c', icon: '👁', iconOnly: true }])).toEqual([
      { name: 'a', icon: '@comment', show: 'icon' },
      { name: 'b' },
      { name: 'c', icon: '👁', show: 'icon' },
    ]);
  });

  it('spells colours out in full, so they can be tinted', () => {
    expect(parseRules([{ name: 'a', color: '#F80' }])[0].color).toBe('#ff8800');
  });
});
