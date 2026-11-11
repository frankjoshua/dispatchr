import './model-character-editor.css';
import { CHARACTERS, MODEL_PRESETS, characterIdFor, parseCharacterRules, type CharacterRule } from './inference';
import { characterSettings, onCharacterStorageChange, reloadCharacterSettings, setCharacterRules } from './character-settings';
import { esc } from './format';
import { painterFor } from './painters';
import { store } from './store';
import { theme } from './theme';

interface Row extends CharacterRule { key: number }

export interface ModelCharacterEditor {
  open(): void;
  close(): void;
}

/** A draft lives outside stream-driven panels; only Apply changes the effective characters. */
export function mountModelCharacterEditor(dialog: HTMLDialogElement, onChange: () => void): ModelCharacterEditor {
  let rows: Row[] = [];
  let nextKey = 0;
  let initialized = false;
  let dirty = false;
  let localOnly = false;
  let conflict = false;
  let observedHtml = '';

  dialog.innerHTML = `
    <header class="character-header"><h2 id="model-characters-title">Model characters</h2>
      <button type="button" data-action="close" aria-label="Close model characters">✕</button></header>
    <div class="character-content">
      <p id="model-characters-help">Choose a character for each reported model, in every theme. The first custom match wins.
        Patterns ignore case; <code>*</code> matches any text. Include <code>/</code> to match a provider-qualified ID;
        otherwise the final model name is matched. Defaults apply when no custom rule matches.
        Runtime fallback uses the agent’s runtime kind instead of a model default.</p>
      <section aria-labelledby="character-gallery-heading"><h3 id="character-gallery-heading">Characters · current theme</h3>
        <div class="character-gallery" data-gallery></div></section>
      <section aria-labelledby="character-rules-heading"><h3 id="character-rules-heading">Custom rules · highest priority first</h3>
        <div class="character-rules" data-rules></div>
        <button type="button" data-action="add">+ Rule</button>
        <p class="character-note">Up to 64 rules; each pattern can contain up to 160 characters. Apply when ready; typing does not change the map.</p></section>
      <section aria-labelledby="character-observed-heading"><h3 id="character-observed-heading">Reported model IDs</h3>
        <div class="character-observed"><select data-observed aria-label="Reported model ID"></select>
          <button type="button" data-action="observed">Add exact rule</button></div>
        <p class="character-note" data-observed-note></p></section>
      <details><summary>Built-in defaults</summary><div class="character-defaults" data-defaults></div>
        <p class="character-note">Other or unreported models use the runtime character. Reset removes only custom rules, never these defaults.</p></details>
    </div>
    <footer class="character-footer">
      <p class="character-status" data-status role="status" aria-live="polite"></p>
      <div class="character-actions"><button type="button" data-action="reload">Reload saved rules</button>
        <button type="button" data-action="reset">Reset to defaults</button>
        <button type="button" class="character-apply" data-action="apply">Save and apply</button></div>
    </footer>`;

  const rulesEl = dialog.querySelector<HTMLElement>('[data-rules]')!;
  const observed = dialog.querySelector<HTMLSelectElement>('[data-observed]')!;
  const status = dialog.querySelector<HTMLElement>('[data-status]')!;
  const button = (action: string) => dialog.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
  const image = (cast: string) => {
    const id = characterIdFor(cast);
    const art = painterFor(theme.id)?.unitArt(id, id) ?? `n_robot_${id}`;
    return `${import.meta.env.BASE_URL}art/${art}.webp`;
  };
  const appearance = (cast: string) => CHARACTERS.find((entry) => entry.id === cast)?.appearance ?? 'Runtime fallback';
  const thumbnail = (cast: string) => `<img src="${image(cast)}" alt="" loading="lazy">`;
  const setStatus = (message: string, error = false) => {
    status.textContent = message;
    status.classList.toggle('error', error);
  };

  function renderArt() {
    dialog.querySelector<HTMLElement>('[data-gallery]')!.innerHTML = CHARACTERS.map((entry) =>
      `<figure>${thumbnail(entry.id)}<figcaption>${esc(entry.appearance)}</figcaption></figure>`).join('');
    dialog.querySelector<HTMLElement>('[data-defaults]')!.innerHTML = MODEL_PRESETS.map((entry) =>
      `<div>${thumbnail(entry.kind)}<span><b>${esc(entry.label)}</b><small>${esc(appearance(entry.kind))}</small></span></div>`).join('');
    for (const row of rows) updatePreview(row);
  }

  function updatePreview(row: Row) {
    const preview = rulesEl.querySelector<HTMLElement>(`[data-row="${row.key}"] [data-preview]`);
    if (!preview) return;
    preview.innerHTML = row.character === 'runtime'
      ? '<span class="character-runtime">Runtime<br>kind</span>' : thumbnail(row.character);
    preview.title = appearance(row.character);
  }

  function renderRows(focusKey?: number) {
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && rulesEl.contains(active) ? active : null;
    const oldKey = focused?.closest<HTMLElement>('[data-row]')?.dataset.row;
    const field = focused?.dataset.field ?? focused?.dataset.action;
    const selection = focused instanceof HTMLInputElement ? [focused.selectionStart, focused.selectionEnd] : null;
    rulesEl.innerHTML = rows.map((row, index) => `
      <div class="character-rule" data-row="${row.key}">
        <span class="character-priority" aria-hidden="true">${index + 1}</span>
        <label class="character-pattern"><span>Model name or pattern</span>
          <input data-field="pattern" type="text" maxlength="160" value="${esc(row.pattern)}" placeholder="gpt-*-fable" spellcheck="false" autocomplete="off" aria-label="Rule ${index + 1} model name or pattern"></label>
        <label class="character-choice"><span>Character</span><select data-field="character" aria-label="Rule ${index + 1} character">
          ${CHARACTERS.map((entry) => `<option value="${entry.id}"${row.character === entry.id ? ' selected' : ''}>${esc(entry.appearance)}</option>`).join('')}
          <option value="runtime"${row.character === 'runtime' ? ' selected' : ''}>Runtime fallback (agent kind)</option></select></label>
        <div class="character-preview" data-preview></div>
        <div class="character-order"><button type="button" data-action="up" aria-label="Move rule ${index + 1} up"${index ? '' : ' disabled'}>↑</button>
          <button type="button" data-action="down" aria-label="Move rule ${index + 1} down"${index + 1 < rows.length ? '' : ' disabled'}>↓</button>
          <button type="button" data-action="remove" aria-label="Remove rule ${index + 1}">Remove</button></div>
      </div>`).join('') || '<p class="character-note">No custom rules. Built-in defaults are active.</p>';
    for (const row of rows) updatePreview(row);
    button('add').disabled = rows.length >= 64;
    button('observed').disabled = rows.length >= 64 || !observed.value || observed.value.length > 160 || observed.value.includes('*');
    const key = focusKey ?? (oldKey === undefined ? undefined : Number(oldKey));
    if (key !== undefined) {
      const row = rulesEl.querySelector<HTMLElement>(`[data-row="${key}"]`);
      const target = row?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(focusKey === undefined && field
        ? `[data-field="${field}"], [data-action="${field}"]:not(:disabled)` : '[data-field="pattern"]')
        ?? row?.querySelector<HTMLInputElement>('[data-field="pattern"]');
      target?.focus();
      if (target instanceof HTMLInputElement && selection && focusKey === undefined) target.setSelectionRange(selection[0], selection[1]);
    }
  }

  function renderObserved() {
    const ids = new Set<string>();
    for (const agent of store.all.values()) {
      const id = agent.inference?.model?.id;
      if (id?.trim()) ids.add(id);
    }
    // Updating options must not lose a chosen ID, even when its agent disappears mid-edit.
    const selected = observed.value;
    if (selected) ids.add(selected);
    const html = '<option value="">Choose a reported model…</option>' + [...ids].sort().map((id) =>
      `<option value="${esc(id)}">${esc(id)}</option>`).join('');
    if (html !== observedHtml) {
      observed.innerHTML = observedHtml = html;
      observed.value = selected;
    }
    button('observed').disabled = rows.length >= 64 || !observed.value || observed.value.length > 160 || observed.value.includes('*');
    dialog.querySelector<HTMLElement>('[data-observed-note]')!.textContent = ids.size
      ? 'Choose an ID to add a rule without changing your existing draft. Select its character, then save and apply.'
      : 'No model IDs have been reported by your agents yet. You can still add a pattern above.';
  }

  function markDirty() {
    dirty = true;
    if (!conflict) setStatus('Unsaved draft. Save and apply to change the map and portraits.');
  }

  function apply(reset = false) {
    if (conflict) {
      setStatus('Not applied: another tab changed these rules. Reload saved rules before applying your draft.', true);
      return;
    }
    const parsed = parseCharacterRules(rows.map(({ pattern, character }) => ({ pattern, character })));
    for (const row of rows) {
      const input = rulesEl.querySelector<HTMLInputElement>(`[data-row="${row.key}"] [data-field="pattern"]`);
      input?.setAttribute('aria-invalid', String(!parseCharacterRules([{ pattern: row.pattern, character: row.character }])));
    }
    if (!parsed) {
      setStatus('Not applied: finish or remove empty or invalid model patterns.', true);
      rulesEl.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    const result = setCharacterRules(parsed);
    if (result === 'conflict') {
      conflict = true;
      setStatus('Not applied: another tab saved newer rules. Reload saved rules to discard this draft and use them.', true);
      if (reloadCharacterSettings()) onChange();
      return;
    }
    dirty = false;
    localOnly = result === 'unavailable';
    setStatus(result === 'saved'
      ? `${reset ? 'Defaults restored' : 'Characters applied'} and saved in this browser only.`
      : 'Applied in this tab only: browser storage is unavailable or full. These changes will not survive a reload.', localOnly);
    onChange();
  }

  function reload() {
    if (!reloadCharacterSettings()) {
      setStatus('Could not read valid saved rules from browser storage. Your draft and current characters are unchanged.', true);
      return;
    }
    rows = characterSettings.rules.map((rule) => ({ ...rule, key: nextKey++ }));
    initialized = true;
    dirty = localOnly = conflict = false;
    renderRows();
    setStatus('Saved rules reloaded. Custom rules are stored in this browser only.');
    onChange();
  }

  dialog.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.field !== 'pattern') return;
    const row = rows.find((item) => String(item.key) === target.closest<HTMLElement>('[data-row]')?.dataset.row);
    if (!row) return;
    row.pattern = target.value;
    target.removeAttribute('aria-invalid');
    markDirty();
  });
  dialog.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target === observed) { renderObserved(); return; }
    const row = rows.find((item) => String(item.key) === target.closest<HTMLElement>('[data-row]')?.dataset.row);
    if (!row || target.dataset.field !== 'character') return;
    row.character = target.value as CharacterRule['character'];
    updatePreview(row);
    markDirty();
  });
  dialog.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'close') { close(); return; }
    if (action === 'apply') { apply(); return; }
    if (action === 'reload') { reload(); return; }
    if (action === 'reset') {
      if (conflict) { setStatus('Reload saved rules before resetting defaults; another tab changed these rules.', true); return; }
      rows = [];
      dirty = true;
      renderRows();
      apply(true);
      return;
    }
    if (action === 'add' || action === 'observed') {
      if (rows.length >= 64) return;
      const pattern = action === 'observed' ? observed.value : '';
      if (action === 'observed' && (!pattern || pattern.length > 160 || pattern.includes('*'))) return;
      const row: Row = { key: nextKey++, pattern, character: CHARACTERS[0].id };
      rows.push(row);
      markDirty();
      renderRows(row.key);
      return;
    }
    const index = rows.findIndex((item) => String(item.key) === target.closest<HTMLElement>('[data-row]')?.dataset.row);
    if (index < 0) return;
    if (action === 'remove') {
      rows.splice(index, 1);
      markDirty();
      renderRows(rows[Math.min(index, rows.length - 1)]?.key);
      if (!rows.length) button('add').focus();
    } else if (action === 'up' || action === 'down') {
      const next = index + (action === 'up' ? -1 : 1);
      if (next < 0 || next >= rows.length) return;
      [rows[index], rows[next]] = [rows[next], rows[index]];
      markDirty();
      renderRows();
    }
  });
  dialog.addEventListener('close', () => document.querySelector<HTMLElement>('#settings-btn')?.focus());
  // Keep Escape's native modal behavior, but do not let it reach map/panel handlers.
  dialog.addEventListener('keydown', (event) => event.stopPropagation());

  function open() {
    if (dialog.open) return;
    if (!initialized || (!dirty && !localOnly && !conflict)) {
      const loaded = reloadCharacterSettings();
      rows = characterSettings.rules.map((rule) => ({ ...rule, key: nextKey++ }));
      initialized = true;
      setStatus(loaded ? 'Custom rules are saved in this browser only.' : 'Browser storage could not be read. Changes can still apply in this tab.', !loaded);
      onChange();
    }
    renderRows();
    renderArt();
    renderObserved();
    dialog.showModal();
    button('close').focus();
  }

  function close() { if (dialog.open) dialog.close(); }

  onCharacterStorageChange(() => {
    // Apply the other tab's effective choices immediately, but never replace an open/unsaved draft.
    const loaded = reloadCharacterSettings();
    if (loaded) onChange();
    if (dialog.open || dirty || localOnly) {
      conflict = true;
      setStatus(loaded
        ? 'Rules changed in another tab and are now shown on the map. Your draft is kept; reload saved rules before applying.'
        : 'Rules changed in another tab, but could not be read. Your draft is kept; reload saved rules before applying.', true);
    } else if (loaded) {
      initialized = false;
    }
  });
  store.onChange(() => { if (dialog.open) renderObserved(); });
  theme.onChange(() => { if (dialog.open) renderArt(); });
  return { open, close };
}
