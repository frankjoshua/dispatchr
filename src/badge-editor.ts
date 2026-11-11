// The Badges editor (⚙ → Badges…): the viewer's rules for showing agents' tokens (badges.ts). Every
// change applies at once; rules are saved per browser (settings.ts). Knows nothing about any token: it
// lists the ones the viewer's agents carry so a rule is one tap away, and offers presets as data.

import { ICON_NAMES, PRESETS, SHOWS, URGENCIES, glob, iconName, parseRules, type BadgeRule, type Show } from './badges';
import { ICONS, iconSvg } from './icons';
import { esc } from './format';
import { badges, onBadgeStorageChange, reloadBadgeSettings, setBadgeRules, setCountRule } from './settings';
import { store } from './store';

const NEW_COLOR = '#58a6ff';
/** The count rules' rows in the editor, apart from the token rules (rows 0, 1, …). */
const ARTIFACT_ROW = -1, SCHEDULE_ROW = -2;

export interface BadgeEditor {
  open(): void;
  close(): void;
}

export function mountBadgeEditor(dialog: HTMLElement, onChange: () => void): BadgeEditor {
  /** The rows as typed; only the well-formed ones (parseRules) take effect. */
  let rows: BadgeRule[] = [];
  let artifactRule: BadgeRule = { ...badges.artifacts };
  let scheduleRule: BadgeRule = { ...badges.schedules };
  let saveMessage = '';
  let saveFailed = false;
  let reloadAvailable = false;

  /** The rule a row edits: a count rule, or a token rule by its index. */
  const ruleAt = (i: number): BadgeRule | undefined => (i === ARTIFACT_ROW ? artifactRule : i === SCHEDULE_ROW ? scheduleRule : rows[i]);

  function saveStatus(message: string, failed = false, reload = false) {
    saveMessage = message;
    saveFailed = failed;
    reloadAvailable = reload;
    const status = dialog.querySelector<HTMLElement>('[data-save-status]');
    if (status) { status.textContent = message; status.classList.toggle('error', failed); }
    const button = dialog.querySelector<HTMLButtonElement>('[data-act="reload"]');
    if (button) button.hidden = !reload;
  }

  function apply(i: number) {
    if (reloadAvailable) return;
    const rules = parseRules(rows);
    if (i >= 0 && rules.length !== rows.length) {
      saveStatus('Not saved: finish or remove the highlighted token rules.', true);
      return;
    }
    // Editing a count must never save an unrelated (possibly stale) token-rule draft.
    const result = i === ARTIFACT_ROW ? setCountRule('artifacts', artifactRule)
      : i === SCHEDULE_ROW ? setCountRule('schedules', scheduleRule) : setBadgeRules(rules);
    if (result !== 'saved') {
      saveStatus(result === 'conflict'
        ? 'Not saved: these settings changed in another tab. Reload saved rules before editing again.'
        : 'Not saved: browser storage is unavailable or full. Your previously saved rules have not been replaced.',
      true, result === 'conflict');
      return;
    }
    saveStatus(`${i === ARTIFACT_ROW ? 'Artifact rule' : i === SCHEDULE_ROW ? 'Schedule rule' : 'Token rules'} saved in this browser.`);
    onChange();
    renderSeen();
    const json = dialog.querySelector<HTMLTextAreaElement>('[data-json]');
    if (json && document.activeElement !== json) json.value = JSON.stringify(rules, null, 2);
  }

  /** Token names on the agents in view, with how many carry each and whether a rule takes it. */
  function seen() {
    const count = new Map<string, number>();
    for (const a of store.agents.values()) for (const t of a.tokens ?? []) count.set(t.name, (count.get(t.name) ?? 0) + 1);
    const patterns = parseRules(rows).map((r) => glob(r.name));
    return [...count].sort((a, b) => a[0].localeCompare(b[0])).map(([name, n]) => ({ name, n, ruled: patterns.some((p) => p.test(name)) }));
  }

  /** The chips as last written: an unchanged list is left alone, so a press on a chip still lands. */
  let seenHtml: string | null = null;
  function renderSeen() {
    const el = dialog.querySelector('[data-seen]');
    if (!el) return;
    const list = seen();
    const html = list.length
      ? list.map((t) => `<button type="button" class="chip${t.ruled ? ' ruled' : ''}" data-seen-name="${esc(t.name)}" title="${t.ruled ? 'has a rule' : 'add a rule for it'}">${esc(t.name)} <small>×${t.n}</small></button>`).join('')
      : '<p class="note">None of your agents carries a token yet. They come from plugins on your computers, through rostr.</p>';
    if (html === seenHtml) return;
    el.innerHTML = seenHtml = html;
  }

  /** The rule whose icon picker is open. */
  let picking: number | null = null;

  /** A rule's icon as the picker button shows it: the built-in one drawn, an emoji as is, else a dot. */
  const iconHtml = (icon: string | undefined) => {
    const name = icon ? iconName(icon) : null;
    return name ? iconSvg(name, 16) : icon ? esc(icon) : '·';
  };

  const SHOW_LABEL: Record<Show, string> = { both: 'icon + text', icon: 'icon', text: 'text' };

  const row = (r: BadgeRule, i: number) => `
    <div class="rule${parseRules([r]).length ? '' : ' bad'}" data-i="${i}">
      <button type="button" class="mini" data-act="up" title="Move up (the first match wins)" aria-label="Move rule up"${i > 0 ? '' : ' disabled'}>↑</button>
      <input data-f="name" value="${esc(r.name)}" placeholder="mr_failed, ci_*" aria-label="${i < 0 ? 'Count name' : 'Token name pattern'}" spellcheck="false" autocomplete="off"${i < 0 ? ` disabled title="Count of this agent’s ${i === ARTIFACT_ROW ? 'artifacts' : 'schedule associations'} in rostr"` : ''}>
      <button type="button" class="mini icon-btn${picking === i ? ' on' : ''}" data-act="pick" title="Icon" aria-label="Choose an icon" style="color:${esc(r.color ?? NEW_COLOR)}">${iconHtml(r.icon)}</button>
      <input data-f="color" type="color" value="${esc(r.color ?? NEW_COLOR)}" aria-label="Colour">
      <select data-f="urgency" aria-label="Urgency">${URGENCIES.map((u) => `<option${(r.urgency ?? 'notice') === u ? ' selected' : ''}>${u}</option>`).join('')}</select>
      <select data-f="show" aria-label="Show">${SHOWS.map((s) => `<option value="${s}"${(r.show ?? 'both') === s ? ' selected' : ''}>${SHOW_LABEL[s]}</option>`).join('')}</select>
      <label class="hide"><input data-f="hide" type="checkbox"${r.hide ? ' checked' : ''}>hide</label>
      <button type="button" class="mini" data-act="remove" title="Remove" aria-label="Remove rule"${i < 0 ? ' disabled' : ''}>✕</button>
    </div>${picking === i ? `
    <div class="picker" data-i="${i}">
      ${ICON_NAMES.map((name) => `<button type="button" data-icon="@${name}" title="${esc(ICONS[name].label)}" aria-label="${esc(ICONS[name].label)}"${r.icon === `@${name}` ? ' class="on"' : ''}>${iconSvg(name, 18)}</button>`).join('')}
      <button type="button" data-icon="" title="No icon" aria-label="No icon">·</button>
      <input data-f="icon" value="${esc(r.icon && !iconName(r.icon) ? r.icon : '')}" placeholder="or an emoji" aria-label="Emoji or symbol" maxlength="4">
    </div>` : ''}`;

  function render() {
    dialog.innerHTML = `
      <header><h3>BADGES</h3><button type="button" class="mini" data-act="close" aria-label="Close">✕</button></header>
      <p class="note${saveFailed ? ' error' : ''}" data-save-status role="status">${esc(saveMessage)}</p>
      <button type="button" class="chip" data-act="reload"${reloadAvailable ? '' : ' hidden'}>Reload saved rules</button>
      <p class="note">Tokens are display data that plugins on your computers report for each agent, such as a
        merge request's state. A rule picks tokens by name (<code>*</code> matches anything) and says how they show
        on the map: <b>alarm</b> pulses and keeps the agent on the map, <b>notice</b> always shows, <b>quiet</b> only up close.
        The first matching rule wins; tokens without one show only in the agent's card.</p>
      <h4>Artifacts</h4>
      <p class="note">A clickable count in the same badge stack: quiet up close, notice always, alarm bounces. Tap it to choose an artifact.</p>
      <div class="rules">${row(artifactRule, ARTIFACT_ROW)}</div>
      <h4>Schedules</h4>
      <p class="note">A clickable count of schedule associations, including paused schedules: quiet only up close, notice always, alarm keeps the agent on the map without making it active. Tap it to open Upcoming.</p>
      <div class="rules">${row(scheduleRule, SCHEDULE_ROW)}</div>
      <h4>Token rules</h4>
      <div class="rules">${rows.map(row).join('') || '<p class="note">No rules yet.</p>'}</div>
      <div class="actions">
        <button type="button" class="chip" data-act="add">+ Rule</button>
        ${PRESETS.map((p) => `<button type="button" class="chip" data-preset="${esc(p.id)}">+ ${esc(p.label)}</button>`).join('')}
      </div>
      <h4>On your agents</h4>
      <div class="seen" data-seen></div>
      <details><summary>Share these rules (JSON)</summary>
        <textarea data-json rows="6" spellcheck="false">${esc(JSON.stringify(parseRules(rows), null, 2))}</textarea>
        <button type="button" class="chip" data-act="import">Use the rules above</button> <span class="note" data-json-note></span>
      </details>`;
    seenHtml = null;
    renderSeen();
  }

  dialog.addEventListener('input', (e) => {
    const field = e.target as HTMLInputElement | HTMLSelectElement;
    const i = Number(field.closest<HTMLElement>('[data-i]')?.dataset.i);
    const f = field.dataset.f;
    const r = ruleAt(i);
    if (!f || Number.isNaN(i) || !r) return;
    if (f === 'name') r.name = field.value.trim();
    else if (f === 'icon') {
      // An emoji typed in the picker: keep the box focused, refresh only the rule's icon button.
      r.icon = field.value.trim() || undefined;
      const btn = dialog.querySelector<HTMLElement>(`.rule[data-i="${i}"] [data-act="pick"]`);
      if (btn) btn.innerHTML = iconHtml(r.icon);
    }
    else if (f === 'show') r.show = field.value as Show;
    else if (f === 'color') r.color = field.value;
    else if (f === 'urgency') r.urgency = field.value as BadgeRule['urgency'];
    else if (f === 'hide') r.hide = (field as HTMLInputElement).checked || undefined;
    field.closest('.rule')?.classList.toggle('bad', !parseRules([r]).length);
    apply(i);
  });

  dialog.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    const i = Number(t.closest<HTMLElement>('[data-i]')?.dataset.i);
    const preset = t.closest<HTMLElement>('[data-preset]')?.dataset.preset;
    const seenName = t.closest<HTMLElement>('[data-seen-name]')?.dataset.seenName;
    const icon = t.closest<HTMLElement>('[data-icon]')?.dataset.icon;
    if (act === 'close') { close(); return; }
    if (act === 'reload') { open(); return; }
    // A redraw replaces the pressed control: focus goes to its replacement, or to what the action made.
    const focus = (selector: string) => dialog.querySelector<HTMLElement>(selector)?.focus();
    if (act === 'pick') { picking = picking === i ? null : i; render(); focus(`.rule[data-i="${i}"] [data-act="pick"]`); return; }
    const count = rows.length;
    const picked = ruleAt(i);
    if (icon !== undefined && picked) { picked.icon = icon || undefined; picking = null; }
    else if (act === 'add') rows.push({ name: '', icon: '@flag', color: NEW_COLOR, urgency: 'notice' });
    else if (act === 'remove' && rows[i]) rows.splice(i, 1);
    else if (act === 'up' && i > 0) [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
    else if (preset) rows.push(...(PRESETS.find((p) => p.id === preset)?.rules ?? []).filter((r) => !rows.some((x) => x.name === r.name)).map((r) => ({ ...r })));
    else if (seenName && !t.closest('.ruled')) rows.push({ name: seenName, icon: '@flag', color: NEW_COLOR, urgency: 'notice' });
    else if (act === 'import') {
      const note = dialog.querySelector('[data-json-note]');
      try {
        const value: unknown = JSON.parse(dialog.querySelector<HTMLTextAreaElement>('[data-json]')?.value ?? '[]');
        const parsed = parseRules(value);
        if (!Array.isArray(value) || parsed.length !== value.length) {
          if (note) note.textContent = 'Use an array of valid token rules. Saved rules have not changed.';
          return;
        }
        rows = parsed;
      } catch {
        if (note) note.textContent = 'That is not JSON.';
        return;
      }
    } else return;
    picking = null; // rows may have moved: no picker stays open on the wrong rule
    render();
    apply(icon !== undefined ? i : 0);
    focus(icon !== undefined ? `.rule[data-i="${i}"] [data-act="pick"]`
      : act === 'remove' ? '[data-act="add"]'
      : act === 'up' ? `.rule[data-i="${i}"] [data-act="up"]`
      : act === 'import' ? '[data-act="import"]'
      : rows.length > count ? `.rule[data-i="${rows.length - 1}"] [data-f="name"]`
      : `[data-preset="${CSS.escape(preset ?? '')}"]`);
  });

  function open() {
    const loaded = reloadBadgeSettings();
    saveMessage = loaded ? 'Changes save automatically in this browser only.' : 'Could not read saved rules from browser storage.';
    saveFailed = !loaded;
    reloadAvailable = false;
    rows = badges.rules.map((r) => ({ ...r }));
    artifactRule = { ...badges.artifacts };
    scheduleRule = { ...badges.schedules };
    picking = null;
    render();
    dialog.hidden = false;
    onChange();
    dialog.querySelector<HTMLElement>('[data-act="close"]')?.focus();
  }

  function close() {
    const within = dialog.contains(document.activeElement);
    dialog.hidden = true;
    if (within) document.querySelector<HTMLElement>('#settings-btn')?.focus();
  }

  onBadgeStorageChange(() => {
    if (dialog.hidden) {
      if (reloadBadgeSettings()) onChange();
    } else {
      saveStatus('Settings changed in another tab. Reload saved rules before editing again.', true, true);
    }
  });

  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dialog.hidden) close(); });
  store.onChange(() => { if (!dialog.hidden) renderSeen(); });
  return { open, close };
}
