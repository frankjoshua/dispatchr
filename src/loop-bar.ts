// The loop bar: the working loop (loop.ts) along the bottom of the map, each agent's status and short
// name over the badges it carries, the selected agent marked. Names stay short even when selected, so
// the bar holds still as you move through it. A tap on an agent goes there; ‹ and › (or , and .) step
// round, » (or >) fast-forwards round the loop to the next agent that needs attention (attention.ts),
// its tooltip naming that agent and why; an agent's × or a middle-click takes it out of the loop.

import { attentionReason, nextNeeding } from './attention';
import { esc, shortNameHtml, statusIcon, statusOf } from './format';
import { loopStops, stepLoop, workingLoop, type LoopMove } from './loop';
import { loopState } from './loop-state';
import { presence } from './presence-state';
import { searchAgents } from './search';
import { settings } from './settings';
import { store } from './store';
import type { Agent } from './types';
import './loop-bar.css';

export interface LoopBar {
  /** Redraws the bar from the loop, the selection and the agents' state. */
  render(): void;
  /** Next (1) or Previous (-1) round the loop. */
  step(dir: 1 | -1): void;
  /** On round the loop to the next agent that needs attention. */
  fastForward(): void;
}

export interface LoopBarHost {
  /** The selected agent: stepping starts there when it is in the loop. */
  selected(): string | null;
  /** An agent's badges as pills (the units list's). */
  pills(a: Agent): string;
  /** Goes to an agent; direct choices reorder, Next/Previous/Fast forward only step. */
  go(id: string, move: LoopMove): void;
}

export function mountLoopBar(el: HTMLElement, host: LoopBarHost): LoopBar {
  // Keep the controls attached so a state update cannot discard a press or keyboard focus.
  el.innerHTML = `<button type="button" class="loop-step" data-step="-1" title="Previous agent (,)" aria-label="Previous agent">‹</button><ol tabindex="0" aria-label="Agent navigation"></ol>
    <button type="button" class="loop-step" data-step="1" title="Next agent (.)" aria-label="Next agent">›</button>
    <button type="button" class="loop-step loop-ff" data-ff disabled aria-label="Next agent that needs attention, 0 waiting">»<small aria-hidden="true"></small></button>`;
  const list = el.querySelector<HTMLOListElement>('ol')!;
  const forward = el.querySelector<HTMLButtonElement>('[data-ff]')!;
  const waitingCount = forward.querySelector('small')!;
  const previous = el.querySelector<HTMLButtonElement>('[data-step="-1"]')!;
  const nextButton = el.querySelector<HTMLButtonElement>('[data-step="1"]')!;
  const ordered = () => workingLoop(
    searchAgents(store.agents.values(), '', store.lastActive, Date.now()).map((agent) => agent.id), loopState.order,
  );
  // Retain the anchor even when its status just stopped needing attention.
  const from = (loop: readonly string[]) => {
    const selected = host.selected();
    return selected && loop.includes(selected) ? selected : loopState.current;
  };
  /** The same reported status and ruled alarm badges the UI shows, independently of sleep. */
  const reasonOf = (id: string) => {
    const a = store.agents.get(id);
    return a ? attentionReason(a.status, presence.badges.get(id) ?? []) : null;
  };
  const needs = (id: string) => !loopState.dismissed.has(id) && reasonOf(id) !== null;
  const shownStops = (loop: readonly string[]) => loopStops(loop, loopState.dismissed, settings.navigationAttentionOnly, needs);

  function step(dir: 1 | -1) {
    const loop = ordered();
    const to = stepLoop(loop, from(loop), dir, new Set(shownStops(loop)));
    if (to) host.go(to, 'step');
  }

  function fastForward() {
    const loop = ordered();
    const to = nextNeeding(loop, from(loop), host.selected(), needs);
    if (to) host.go(to, 'step');
  }

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const dir = t.closest<HTMLElement>('[data-step]')?.dataset.step;
    if (dir) { step(dir === '1' ? 1 : -1); return; }
    if (t.closest('[data-ff]')) { fastForward(); return; }
    // A badge that opens something (artifacts, schedules) does that instead (ui.ts).
    if (t.closest('[data-artifacts], [data-schedules]')) return;
    const id = t.closest<HTMLElement>('[data-go]')?.dataset.go;
    if (!id) return;
    if (t.closest('[data-forget]')) loopState.forget(id);
    else host.go(id, 'jump');
  });
  // A middle click takes an agent out of the loop, as it closes a browser tab (and must not start autoscroll).
  el.addEventListener('mousedown', (e) => { if (e.button === 1 && (e.target as HTMLElement).closest('[data-go]')) e.preventDefault(); });
  el.addEventListener('auxclick', (e) => {
    const id = e.button === 1 ? (e.target as HTMLElement).closest<HTMLElement>('[data-go]')?.dataset.go : undefined;
    if (id) { e.preventDefault(); loopState.forget(id); }
  });

  let pointer: { id: number; x: number; y: number } | null = null;
  let suppressClick = false, scrolling = false, dirty = false;
  let scrollTimer = 0;
  const flush = () => { if (dirty && !pointer && !scrolling) render(); };
  list.addEventListener('pointerdown', (event) => {
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    suppressClick = false;
  });
  list.addEventListener('pointermove', (event) => {
    if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 6) suppressClick = true;
  });
  const release = (event: PointerEvent) => {
    if (pointer?.id !== event.pointerId) return;
    if (event.type === 'pointercancel') suppressClick = true;
    // Leave the pressed chip in place until its native click has been delivered.
    setTimeout(() => { if (pointer?.id === event.pointerId) pointer = null; flush(); }, 0);
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', () => { pointer = null; suppressClick = true; flush(); });
  list.addEventListener('click', (event) => {
    if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  list.addEventListener('scroll', () => {
    scrolling = true;
    clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => { scrolling = false; flush(); }, 140);
  }, { passive: true });
  list.addEventListener('wheel', (event) => {
    if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || list.scrollWidth <= list.clientWidth) return;
    event.preventDefault();
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? list.clientWidth : 1;
    list.scrollLeft += event.deltaY * unit;
  }, { passive: false });

  const rows = new Map<string, { element: HTMLLIElement; content: string }>();
  let lastSelected: string | null = null, lastMode = settings.navigationAttentionOnly;
  function render() {
    if (pointer || scrolling) { dirty = true; return; }
    dirty = false;
    const all = ordered(), ids = shownStops(all), start = from(all), selected = host.selected();
    const waiting = all.filter((id) => id !== selected && needs(id)).length;
    const next = nextNeeding(all, start, selected, needs);
    const nextAgent = next ? store.agents.get(next) : undefined;
    const nextStop = nextAgent ? `${nextAgent.name}, ${reasonOf(nextAgent.id)}` : null;
    const modeChanged = lastMode !== settings.navigationAttentionOnly;
    const reveal = selected !== lastSelected || modeChanged;
    const was = list.scrollLeft;
    const anchor = [...list.children].find((item) => (item as HTMLElement).offsetLeft + (item as HTMLElement).offsetWidth > was) as HTMLElement | undefined;
    const anchorId = anchor?.dataset.go, anchorOffset = anchor ? anchor.offsetLeft - was : 0;
    el.hidden = store.agents.size === 0;
    previous.disabled = nextButton.disabled = ids.length === 0;
    forward.disabled = waiting === 0;
    forward.title = `Next agent that needs attention (>): ${nextStop ? `${nextStop} · ${waiting} waiting` : 'none waiting'}`;
    forward.setAttribute('aria-label', `Next agent that needs attention, ${waiting} waiting`);
    waitingCount.textContent = String(waiting);
    waitingCount.style.visibility = waiting ? 'visible' : 'hidden';
    list.setAttribute('aria-label', settings.navigationAttentionOnly ? 'Agents needing attention' : 'All agents');
    const kept = new Set(ids);
    for (const [id, row] of rows) if (!kept.has(id)) { row.element.remove(); rows.delete(id); }
    list.querySelector('.loop-empty')?.remove();
    ids.forEach((id, index) => {
      const a = store.agents.get(id)!;
      let row = rows.get(id);
      if (!row) {
        row = { element: document.createElement('li'), content: '' };
        row.element.dataset.go = id;
        rows.set(id, row);
      }
      const on = id === selected, badges = host.pills(a);
      row.element.className = `loop-agent${on ? ' sel' : ''}`;
      row.element.style.setProperty('--s', statusOf(a.status).c);
      const content = `<button type="button" class="loop-go"${on ? ' aria-current="true"' : ''} title="${esc(a.name)}">${statusIcon(a.status)}${shortNameHtml(a.name)}</button>`
        + `${badges ? `<span class="pills">${badges}</span>` : ''}`
        + `<button type="button" class="loop-forget" data-forget title="Remove from navigation until visited again (middle-click)" aria-label="Remove ${esc(a.name)} from navigation">×</button>`;
      if (content !== row.content) {
        const focused = row.element.contains(document.activeElement);
        const closing = focused && (document.activeElement as HTMLElement).hasAttribute('data-forget');
        row.element.innerHTML = row.content = content;
        if (focused) row.element.querySelector<HTMLElement>(closing ? '[data-forget]' : '.loop-go')?.focus({ preventScroll: true });
      }
      const here = list.children.item(index);
      if (here !== row.element) list.insertBefore(row.element, here);
    });
    if (!ids.length) {
      const empty = document.createElement('li');
      empty.className = 'loop-empty';
      empty.textContent = settings.navigationAttentionOnly ? 'No agents need attention' : 'No agents in navigation';
      list.append(empty);
    }
    const preserved = anchorId ? rows.get(anchorId)?.element : null;
    list.scrollLeft = modeChanged ? 0 : preserved ? preserved.offsetLeft - anchorOffset : was;
    lastSelected = selected;
    lastMode = settings.navigationAttentionOnly;
    const here = selected ? rows.get(selected)?.element : null;
    if (!reveal || !here) return;
    const box = list.getBoundingClientRect(), at = here.getBoundingClientRect();
    const by = at.left < box.left ? at.left - box.left - 8 : at.right > box.right ? at.right - box.right + 8 : 0;
    if (by) list.scrollLeft += by;
  }
  loopState.onChange(render);

  return { render, step, fastForward };
}
