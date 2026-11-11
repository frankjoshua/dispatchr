import {
  STATUS_ORDER, ago, basename, buzzLabel, channelColor, clock, describe, esc, kindOf, linksOf, nodeStateOf, shortNameHtml, spaceColor,
  statusIcon, statusOf, wholeNameHtml, type LinkLook,
} from './format';
import type { MapTap, MapView } from './map';
import type { api } from './api';
import { ledger, mountCounter, usageBlock } from './spend';
import { facets, filter, filterActive, saveFilter } from './filter';
import { badges, folds, sections, setSetting, settings, toggleFold, toggleSection } from './settings';
import { mountBadgeEditor } from './badge-editor';
import { mountArtifactPanel } from './artifact-panel';
import { badgeLook, badgesFor, coalesce, iconName, type Badge } from './badges';
import { iconSvg } from './icons';
import { hasOwnTab, openLink, type AgentLink, type Tab } from './tabs';
import { store } from './store';
import { teamMembers } from './teams';
import { byRecency, foldQuiet, isQuiet, type Item } from './presence';
import { presence } from './presence-state';
import { DIMMEST } from './recency';
import { painterFor } from './painters';
import { castFor } from './inference';
import { THEMES, theme } from './theme';
import type { Agent, ContactChannel, InferenceEffort, InferenceModel, RostrEvent } from './types';
import { usage } from './usage';
import { currentScheduleCounts, schedules } from './schedule-store';
import { mountUpcoming } from './schedule-panel';
import { loopState } from './loop-state';
import type { LoopMove } from './loop';
import { mountLoopBar } from './loop-bar';
import { mountLegend } from './legend';
import { searchAgents } from './search';

// The panels around the map: totals, computers, event log, roster and the read-only unit card. Plain
// DOM; every view of the map has a list here too.

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

// The agent's character from the map's art, as the card's portrait (the head end of the sprite).
const ART_KINDS = ['omp', 'claude', 'codex', 'pi'];
function portrait(a: Agent): string {
  const kind = ART_KINDS.includes(a.kind) ? a.kind : 'omp';
  const src = `${import.meta.env.BASE_URL}art/${painterFor(theme.id)?.unitArt(kind, castFor(a)) ?? `n_robot_${kind}`}.webp`;
  return `<img src="${src}" alt="" style="width:100%;height:100%;object-fit:cover;object-position:50% 6%">`;
}

const rawObservation = (value: string | null | undefined) =>
  value == null ? '<span class="dim">unknown · not reported</span>' : `<code>${esc(value)}</code>`;

function observationSource(value: InferenceModel | InferenceEffort | null | undefined): string {
  if (!value) return '';
  return ` <small class="observation-source">source ${esc(value.source)} · ${value.reported_at ? `reported <time title="${esc(value.reported_at)}">${esc(ago(value.reported_at))}</time>` : 'time not reported'}</small>`;
}

const FEED_MAX = 300;

export function mountUi(map: MapView, source: Pick<typeof api, 'contact' | 'me'>) {
  const stats = $('#stats'), conn = $('#conn'), nodes = $('#nodes'), nodesCount = $('#nodes-count');
  const roster = $('#roster'), unitsCount = $('#units-count'), card = $('#card'), feed = $('#feed'), ledgerEl = $('#ledger');
  const badgesDialog = $('#badges-dialog');
  const counter = mountCounter($('#spend'));
  const upcoming = mountUpcoming($('#upcoming'), (id) => flyTo(id));
  let selected: string | null = null;
  type SelectionMove = LoopMove | 'sync';
  const agentExists = (id: string) => store.agents.has(id);
  const navigationOrder = () => searchAgents(store.all.values(), '', store.lastActive, Date.now()).map((agent) => agent.id);
  /** Whether the unit card is open (Show info); it shows the selected agent. */
  let cardOpen = false;
  /** The agent the card shows, whose address book and hourly spend are loaded; null while it is closed. */
  let cardFor: string | null = null;
  let feedSeq = 0;
  /** agent id → its address book; null when this token may not read it. */
  const contacts = new Map<string, ContactChannel[] | null>();

  function loadContact(id: string) {
    source.contact(id).then((book) => {
      contacts.set(id, book);
      if (cardFor === id) renderCard();
    }).catch(() => { /* network trouble shows in the connection badge; the card keeps the event-log view */ });
  }

  // Live updates come several times a second: rewriting an unchanged panel would swap its controls out
  // from under a finger and lose the tap, so each part is only redrawn when its content differs. A
  // redraw keeps keyboard focus on the control with the same `data-k`.
  const drawn = new WeakMap<HTMLElement, string>();
  /** Writes a panel's HTML; false when it already shows it. */
  function draw(el: HTMLElement, html: string): boolean {
    if (drawn.get(el) === html) return false;
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && el.contains(active) ? active.dataset.k : undefined;
    el.innerHTML = html;
    drawn.set(el, html);
    if (focused) el.querySelector<HTMLElement>(`[data-k="${CSS.escape(focused)}"]`)?.focus();
    return true;
  }

  /**
   * A changed panel still must not be redrawn under a press: its redraw waits until the pointer is up
   * and the click delivered (the units list does the same around its double tap). Returns the check a
   * render starts with: true while it has to wait.
   */
  function pressGuard(el: HTMLElement, render: () => void): () => boolean {
    let pointer: number | null = null, dirty = false;
    const flush = () => {
      if (!dirty || pointer !== null) return;
      dirty = false;
      render();
    };
    el.addEventListener('pointerdown', (e) => { pointer = e.pointerId; });
    const release = (e: PointerEvent) => {
      if (pointer !== e.pointerId) return;
      // Let the native click dispatch before applying the queued redraw.
      setTimeout(() => {
        if (pointer === e.pointerId) pointer = null;
        flush();
      }, 0);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', () => { pointer = null; flush(); });
    return () => {
      if (pointer !== null) dirty = true;
      return pointer !== null;
    };
  }

  // ─── selection: the agent last picked anywhere (map, units list, search, log, spend, loop), ringed,
  // lit and named in full on the map, its name in the URL so a view can be bookmarked or opened in
  // another window. Picking never opens the unit card: Show info does, and the card then follows the
  // selection until it is closed.

  function select(id: string | null, move: SelectionMove = 'jump') {
    if (move !== 'sync') cancelRowTap();
    const from = selected;
    selected = id && agentExists(id) ? id : null;
    if (selected) {
      if (move === 'jump') loopState.jump(selected, from, navigationOrder());
      else if (move === 'step') loopState.step(selected, navigationOrder());
    }
    map.select(selected);
    const name = selected ? store.agents.get(selected)?.name : null;
    history.replaceState(null, '', name ? `#agent=${encodeURIComponent(name)}` : location.pathname + location.search);
    markSelectedRows();
    if (!selected) cardOpen = false;
    syncCard();
    renderRoster();
    loopBar.render();
    renderLedger();
  }

  function showCard(open: boolean) {
    cardOpen = open && selected !== null;
    syncCard();
  }

  function syncCard() {
    const shown = cardOpen ? selected : null;
    if (shown !== cardFor) {
      cardFor = shown;
      usage.watch(shown);
      if (shown) loadContact(shown);
    }
    document.body.classList.toggle('has-card', cardOpen);
    renderCard();
  }

  // ─── unit menu: a tap on a unit, its place or its name plate selects it and opens a small menu beside
  // it: Show info (the card) and the agent's links (rostr fills them from its computer's [links]); a tap
  // on a count badge selects it and opens what it counts. A double tap opens its web terminal at once.
  // A tap on open ground clears the selection (and closes the card).

  const menu = $('#unit-menu');
  let menuFor: string | null = null;
  let menuAt = { x: 0, y: 0 };
  const DOUBLE_TAP_MS = 500;
  let lastTap = { id: '', at: 0 };
  /**
   * An agent's link with two buttons: Open (the shared tab for its kind, or the agent's own tab if it
   * has one open) and New tab (the agent's own tab, in this window); clicking the link itself is Open,
   * and Ctrl/Cmd- or middle-click stay the browser's own new tab.
   */
  const linkItem = (agentId: string, l: LinkLook, hint = '') => {
    const popped = hasOwnTab(agentId, l.name);
    const data = `data-agent="${esc(agentId)}" data-link="${esc(l.name)}" data-href="${esc(l.href)}"`;
    return `<span class="linkrow"><a class="link" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer" ${data} data-k="link/${esc(l.name)}"><i>${esc(l.icon)}</i><span>${esc(l.label)}<small>${hint}${esc(l.host)}</small></span></a>`
      + `<span class="linkbtns"><button type="button" class="linkbtn" data-open ${data} data-k="open/${esc(l.name)}" title="${popped ? 'In its own tab' : 'In the shared tab'}">Open</button>`
      + `<button type="button" class="linkbtn${popped ? ' on' : ''}" data-popout ${data} data-k="own/${esc(l.name)}" title="${popped ? 'Its own tab is open: links for this agent go there' : 'In its own tab (or Shift + double-tap on the map)'}">${popped ? 'Its tab' : 'New tab'}</button></span></span>`;
  };

  const linkTo = (agentId: string, l: LinkLook): AgentLink => ({ agentId, link: l.name, href: l.href });
  /** An agent's web terminal link, if its computer has one. */
  const webLink = (a: Agent) => linksOf(a).find((l) => l.name === 'web');

  /**
   * Opens an agent's link from a click or tap (tabs.ts), falling back to a plain new tab if the browser
   * blocks it. With Shift held it waits for the event to end: Chrome makes a Shift-held open a new window.
   * Opening an agent also selects it and records a jump (or a stable navigation step).
   */
  function openAgentLink(l: AgentLink, tab: Tab, shiftHeld: boolean, move: LoopMove = 'jump') {
    if (l.link !== 'artifacts' && agentExists(l.agentId)) select(l.agentId, move);
    const go = () => {
      if (!openLink(l, tab)) window.open(l.href, '_blank', 'noopener,noreferrer');
      if (selected === l.agentId) renderCard(); // New tab turns into "Its tab" while it is open
    };
    if (shiftHeld) setTimeout(go);
    else go();
  }

  const artifactPanel = mountArtifactPanel((agentId, artifact, tab) => {
    openAgentLink({ agentId, link: 'artifacts', href: artifact.url, itemId: artifact.url }, tab, false);
  });

  function showArtifacts(id: string, at: { x: number; y: number }) {
    const agent = store.agents.get(id);
    if (!agent) return;
    select(id);
    closeMenu();
    artifactPanel.open(agent, at);
  }

  function showSchedules(agentId: string | null) {
    if (agentId && agentExists(agentId)) select(agentId);
    closeMenu();
    artifactPanel.close();
    upcoming.setAgent(agentId);
    if (folds.has('right')) togglePanel('right');
    setTab('upcoming');
  }

  /** A token as its badge in the card and the editor; dashed when no rule matches it. */
  const tokenChip = (b: Badge) => {
    const name = b.icon ? iconName(b.icon) : null;
    const icon = name ? iconSvg(name, 12) : esc(b.icon);
    return `<span class="token${b.urgency === 'alarm' ? ' alarm' : ''}${b.ruled ? '' : ' unruled'}"${b.color ? ` style="--c:${b.color}"` : ''} title="${esc(b.name)} · ${esc(b.source)}${b.ruled ? '' : ' · no rule'}">${icon}${esc(b.text || b.name)}</span>`;
  };

  const menuWaits = pressGuard(menu, renderMenu);
  function renderMenu(): void {
    if (menuWaits()) return;
    const a = menuFor ? store.agents.get(menuFor) : undefined;
    if (!a) { closeMenu(); return; }
    const k = kindOf(a.kind), st = statusOf(a.status);
    const links = linksOf(a).map((l) => linkItem(a.id, l, l.name === 'web' ? 'double-tap · ' : '')).join('');
    const scheduleCount = currentScheduleCounts().get(a.id) ?? 0;
    draw(menu, `<header style="--k:${k.c};--s:${st.c}"><i>${esc(k.glyph)}</i><b>${esc(a.name)}</b><small>${esc(st.label)}</small></header>
      <button type="button" class="link" data-info data-k="info"><i>ⓘ</i><span>Show info<small>status, folder, spend, events</small></span></button>${a.artifacts?.length ? `<button type="button" class="link" data-artifacts="${esc(a.id)}" data-k="artifacts"><i>${iconSvg('artifacts')}</i><span>Artifacts<small>${a.artifacts.length} available</small></span></button>` : ''}${scheduleCount ? `<button type="button" class="link" data-schedules="${esc(a.id)}" data-k="schedules"><i>${iconSvg('clock')}</i><span>Upcoming<small>${scheduleCount} schedules</small></span></button>` : ''}${links}`);
    menu.hidden = false;
    // Beside the tap, below it unless that runs off the screen, never past an edge.
    const r = menu.getBoundingClientRect(), pad = 8;
    const below = menuAt.y + 14 + r.height <= innerHeight - pad;
    menu.style.left = `${Math.min(Math.max(pad, menuAt.x + 10), innerWidth - r.width - pad)}px`;
    menu.style.top = `${below ? menuAt.y + 14 : Math.max(pad, menuAt.y - 14 - r.height)}px`;
  }

  function closeMenu() {
    menuFor = null;
    menu.hidden = true;
  }

  function openMenu(id: string, at: { x: number; y: number }) {
    menuFor = id;
    menuAt = at;
    renderMenu();
  }

  function tap(id: string | null, at: MapTap) {
    if (!id || !store.agents.has(id)) { closeMenu(); select(null); return; }
    if (at.action) {
      lastTap = { id: '', at: 0 };
      if (at.action === 'artifacts') showArtifacts(id, at);
      else showSchedules(id);
      return;
    }
    const double = lastTap.id === id && at.t - lastTap.at < DOUBLE_TAP_MS;
    lastTap = double ? { id: '', at: 0 } : { id, at: at.t };
    const web = double ? webLink(store.agents.get(id) as Agent) : undefined;
    if (web) {
      // Still inside the tap's own event (or just after, with Shift), so the browser lets it open a tab:
      // the shared terminal tab, or the agent's own with Shift (or when it already has one open).
      closeMenu();
      openAgentLink(linkTo(id, web), at.shift ? 'own' : 'shared', at.shift);
      return;
    }
    select(id);
    openMenu(id, at);
  }

  /** Selects an agent and flies the map to it, switching to the map on a phone. */
  function flyTo(id: string, move: SelectionMove = 'jump') {
    closeMenu();
    if (move !== 'sync' || selected !== id) select(id, move);
    setTab('map');
    // From another tab the map was hidden at zero size: let it lay out (and refit) first, or that refit
    // would undo the flight.
    requestAnimationFrame(() => requestAnimationFrame(() => { if (selected === id) map.focus(id); }));
  }

  // ─── working loop: deliberate jumps reorder the next stop; navigation steps keep the sequence.

  const loopEl = $('#loopbar');
  /** Goes to an agent: its web terminal in the shared tab (or its own tab, if open), and the map flies there. */
  function goTo(id: string, move: LoopMove) {
    const a = store.agents.get(id);
    if (!a) return;
    const web = webLink(a);
    if (web) openAgentLink(linkTo(id, web), 'shared', false, move);
    else select(id, move);
    flyTo(id, 'sync');
  }
  const loopBar = mountLoopBar(loopEl, { selected: () => selected, pills: pillsOf, go: goTo });
  // Fit and flights frame the map above whatever lies over its bottom: the loop bar, and the unit card
  // where it covers the map (a phone's bottom sheet; on a desktop it has a row of its own).
  const mapEl = $('#map');
  function updateInset() {
    const sheet = card.offsetHeight ? Math.max(0, mapEl.getBoundingClientRect().bottom - card.getBoundingClientRect().top) : 0;
    map.setInset(Math.max(loopEl.offsetHeight ? loopEl.offsetHeight + 20 : 0, sheet));
  }
  const insetWatch = new ResizeObserver(updateInset);
  insetWatch.observe(loopEl);
  insetWatch.observe(card);

  // Any press outside the menu closes it (a tap on another unit then opens that one's); so do the wheel,
  // a resize and choosing an item.
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node)) closeMenu();
  }, true);
  document.addEventListener('wheel', () => { if (!menu.hidden) closeMenu(); }, { capture: true, passive: true });
  addEventListener('resize', closeMenu);
  menu.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-info]') && menuFor) {
      select(menuFor, 'sync');
      showCard(true);
      closeMenu();
    } else if (t.closest('a, [data-open], [data-popout]')) setTimeout(closeMenu);
  });

  // Agents' links, in the menu and the card: the link or Open reuses a tab (tabs.ts) instead of opening
  // a new one; New tab gives the agent its own; Ctrl/Cmd/middle-click on the link stay the browser's.
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const artifactButton = t.closest<HTMLElement>('[data-artifacts]');
    if (artifactButton?.dataset.artifacts) {
      e.preventDefault();
      const rect = artifactButton.getBoundingClientRect();
      showArtifacts(artifactButton.dataset.artifacts, { x: rect.left, y: rect.bottom });
      return;
    }
    const scheduleButton = t.closest<HTMLElement>('[data-schedules]');
    if (scheduleButton?.dataset.schedules) { e.preventDefault(); showSchedules(scheduleButton.dataset.schedules); return; }
    const button = t.closest<HTMLElement>('[data-open], [data-popout]');
    const el = button ?? t.closest<HTMLElement>('a[data-link]');
    if (!el) return;
    const { agent: agentId, link, href } = el.dataset;
    if (!agentId || !link || !href) return;
    if (!button && (e.ctrlKey || e.metaKey || e.button !== 0)) {
      // Keep the anchor connected for the browser's native activation; it already belongs to the selection.
      if (link !== 'artifacts' && agentExists(agentId)) loopState.jump(agentId, selected, navigationOrder());
      return;
    }
    e.preventDefault();
    openAgentLink({ agentId, link, href }, el.hasAttribute('data-popout') ? 'own' : 'shared', e.shiftKey);
  });
  document.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const link = (e.target as HTMLElement).closest<HTMLElement>('a[data-agent][data-link]');
    const id = link?.dataset.agent;
    if (link && id && link.dataset.link !== 'artifacts' && agentExists(id)) loopState.jump(id, selected, navigationOrder());
  });

  function fromHash(move: LoopMove = 'jump') {
    const m = /agent=([^&]+)/.exec(location.hash);
    if (!m) return;
    const a = store.agentByName(decodeURIComponent(m[1]));
    if (a) flyTo(a.id, move);
  }

  // ─── top bar

  function renderStats() {
    const agents = [...store.agents.values()];
    const count = (s: string) => agents.filter((a) => a.status === s).length;
    const ns = [...store.nodes.values()];
    const online = ns.filter((n) => n.state === 'online').length;
    const cells: string[] = [
      cell('computers', `${online}/${ns.length}`, online === ns.length ? nodeStateOf('online').c : nodeStateOf('stale').c),
      cell('agents', String(agents.length), 'var(--txt)'),
    ];
    for (const s of STATUS_ORDER) {
      const n = count(s);
      if (n || s === 'working' || s === 'blocked') cells.push(cell(statusOf(s).label, String(n), n ? statusOf(s).c : 'var(--faint)', s));
    }
    stats.innerHTML = cells.join('');
    counter.update();
  }
  const cell = (label: string, value: string, c: string, status?: string) =>
    `<div class="stat${status ? ` st-${status}` : ''}"><small>${esc(label)}</small><b style="color:${c}">${esc(value)}</b></div>`;

  function renderConn() {
    const label = { loading: 'CONNECTING', live: 'LIVE', reconnecting: 'RECONNECTING', error: 'ERROR' }[store.conn];
    conn.className = `conn ${store.conn}`;
    conn.title = store.error ?? (store.conn === 'live' ? `following the event stream from seq ${store.lastSeq}` : '');
    conn.innerHTML = `<i></i><span>${label}</span>`;
  }

  // ─── computers

  function renderNodes() {
    const list = [...store.nodes.values()].sort((a, b) => a.name.localeCompare(b.name));
    nodesCount.textContent = `${list.length}`;
    if (!list.length) { nodes.innerHTML = '<p class="empty">No computers visible to this token.</p>'; return; }
    nodes.innerHTML = list.map((n) => {
      const st = nodeStateOf(n.state);
      const agents = [...store.agents.values()].filter((a) => a.node_id === n.id);
      const up = agents.filter((a) => statusOf(a.status).up).length;
      return `<div class="node" style="--c:${st.c}">
        <i class="dot"></i>
        <div><b>${esc(n.name)}</b><small>${esc(st.label)} · seen <time data-at="${esc(n.last_seen_at ?? '')}">${ago(n.last_seen_at)}</time> ago${n.versions?.herdr ? ` · herdr ${esc(n.versions.herdr)}` : ''}</small></div>
        <span class="num"><b>${up}</b><small>/${agents.length} up</small></span>
      </div>`;
    }).join('');
  }

  // ─── units list: the agents on the map (not packed away), each space and team as recent as its most
  // recent member and most recent first (presence.ts), dimmed like the map. Sections fold (▾/▸), and each
  // folds its quiet agents (at the map's dimmest) under "N quiet" by default (settings.ts sections). A
  // space or team name frames it on the map; an agent is selected and flown to (no menu) and a double tap
  // opens its terminal.

  let rowTap: { id: string; at: number; timer: number } | null = null;
  let rosterPointer: number | null = null;
  let rosterDirty = false;

  function flushRoster() {
    if (rosterDirty && rosterPointer === null && rowTap === null) renderRoster();
  }

  function cancelRowTap() {
    if (rowTap) clearTimeout(rowTap.timer);
    rowTap = null;
  }

  function renderRoster() {
    // A live reorder must not move or replace the second click's target.
    if (rosterPointer !== null || rowTap !== null) { rosterDirty = true; return; }
    rosterDirty = false;
    const all = [...store.agents.values()];
    const agents = all.filter((a) => !presence.packed.has(a.id));
    const away = all.length - agents.length;
    unitsCount.textContent = `${agents.filter((a) => statusOf(a.status).up).length}/${agents.length} up${away ? ` · ${away} packed away` : ''}`;
    if (!agents.length) {
      const why = store.conn === 'loading' ? 'Loading…' : filterActive() && store.all.size ? 'No agents match the filter.' : away ? 'Every agent is packed away (quiet for over a week): search finds them.' : 'No agents visible to this token.';
      draw(roster, `<p class="empty">${why}</p>`);
      return;
    }
    const at = presence.at;
    const groups = new Map<string, Agent[]>();
    for (const a of agents) {
      const key = `${a.node_id}/${a.space_id}`;
      groups.set(key, [...(groups.get(key) ?? []), a]);
    }
    const recency = (list: Agent[]) => Math.max(-Infinity, ...list.map((a) => at(a) ?? -Infinity));
    const titled = [...groups].map(([key, list]) => {
      const space = store.spaces.get(list[0].space_id);
      return { key, list, when: recency(list), title: `${space?.name ?? list[0].space_slug} ${list[0].node_name}` };
    }).sort((a, b) => b.when - a.when || a.title.localeCompare(b.title));
    draw(roster, titled.map(({ key, list }) => {
      const a0 = list[0];
      const name = store.spaces.get(a0.space_id)?.name ?? a0.space_slug;
      const packedHere = all.filter((a) => a.node_id === a0.node_id && a.space_id === a0.space_id && presence.packed.has(a.id)).length;
      const where = `data-node="${esc(a0.node_id)}" data-space="${esc(a0.space_id)}"`;
      const open = !sections.has(key);
      const small = `${esc(a0.node_name)}${open ? '' : ` · ${list.length} agent${list.length === 1 ? '' : 's'}`}${packedHere ? ` · ${packedHere} packed away` : ''}`;
      return `<div class="group" style="--c:${spaceColor(a0.space_slug)}">${header('space', { key, name, small, where })}${open ? sectionBody(byRecency(store.teams(list), at), where, key) : ''}</div>`;
    }).join(''));
  }

  /** A section header: its fold key, its name and note, and its data attributes for framing it on the map. */
  interface Head { key: string; name: string; small: string; where: string }

  /** A space's or team's header: its fold button, then its name (frames it on the map). */
  function header(kind: 'space' | 'team', h: Head): string {
    const open = !sections.has(h.key);
    const tag = kind === 'space' ? 'h3' : 'h4';
    return `<${tag}><button type="button" class="secfold" data-section="${esc(h.key)}" data-k="section/${esc(h.key)}" aria-expanded="${open}" aria-label="${open ? 'Fold' : 'Unfold'} ${esc(h.name)}">${open ? '▾' : '▸'}</button>`
      + `<button type="button" class="goto" ${h.where} data-k="goto/${esc(h.key)}" title="Show this ${kind} on the map"><i></i>${esc(h.name)}<small>${h.small}</small></button></${tag}>`;
  }

  /** A section's rows: the awake ones, then its quiet ones folded under "N quiet" unless opened. */
  function sectionBody(items: Item[], where: string, key: string): string {
    const { shown, quiet } = foldQuiet(items, quietAgent);
    if (!quiet.length) return itemRows(shown, where, key);
    const n = quiet.reduce((sum, i) => sum + ('agent' in i ? 1 : teamMembers(i.team).length), 0);
    const open = sections.has(`quiet/${key}`);
    return `${itemRows(shown, where, key)}<button type="button" class="quietfold" data-quiet="${esc(key)}" data-k="quiet/${esc(key)}" aria-expanded="${open}" title="Agents outside the most recent third, at the map's dimmest">${open ? '▾' : '▸'} ${n} quiet</button>${open ? itemRows(quiet, where, key) : ''}`;
  }

  /** Rows in order: agents, and teams as sections under their lead's name. */
  function itemRows(items: Item[], where: string, parent: string): string {
    return items.map((i) => {
      if ('agent' in i) return row(i.agent);
      const lead = i.team.manager;
      const key = `${parent}/${lead?.id ?? ''}`;
      const open = !sections.has(key);
      const members = teamMembers(i.team);
      const working = members.filter((a) => a.status === 'working').length;
      const head: Head = { key, name: lead?.name ?? '', small: `team · ${members.length}${working ? ` · ${working} working` : ''}`, where: `${where} data-lead="${esc(lead?.id ?? '')}"` };
      return `<section class="team">${header('team', head)}${open ? sectionBody(i.items, where, key) : ''}</section>`;
    }).join('');
  }

  /** The lowest a row dims to, for an agent at the map's dimmest. */
  const ROW_DIMMEST = 0.4;

  /** How bright a row is: the map's light for the agent (presence-state.ts), kept readable (40–100%). */
  function rowLight(a: Agent): number {
    if (!settings.dimQuiet || a.status === 'blocked' || a.id === selected) return 1;
    const b = presence.lit.get(a.id) ?? 1;
    return Math.round((ROW_DIMMEST + (1 - ROW_DIMMEST) * (b - DIMMEST) / (1 - DIMMEST)) * 100) / 100;
  }

  /** Quiet agents fold only while the list dims (settings.dimQuiet), as the rows only dim then. */
  const quietAgent = (a: Agent) => settings.dimQuiet && isQuiet(presence.lit.get(a.id) ?? 1, a, selected);

  /** An agent's row: its status icon, its name, and on a second line the badges the map shows over it. */
  function row(a: Agent): string {
    const st = statusOf(a.status);
    const pills = pillsOf(a);
    return `<div class="unit st-${esc(a.status)}${a.id === selected ? ' sel' : ''}" data-unit="${esc(a.id)}" style="--s:${st.c};--lit:${rowLight(a)}">
      <button type="button" class="unit-target" data-id="${esc(a.id)}" data-k="${esc(a.id)}">${statusIcon(a.status)}${rowName(a, a.id === selected)}</button>
      ${pills ? `<span class="pills">${pills}</span>` : ''}
      <span class="bar"></span>
    </div>`;
  }

  /** A row's name: the selected agent's whole, anyone else's short. */
  const rowName = (a: Agent, selectedRow: boolean) => (selectedRow ? wholeNameHtml(a.name) : shortNameHtml(a.name));

  /** Marks the selected agent's row (its whole name, scrolled into view) at once: a full redraw of the list may wait out a double tap (renderRoster). */
  function markSelectedRows() {
    for (const el of roster.querySelectorAll<HTMLElement>('.unit')) {
      const on = el.dataset.unit === selected;
      if (el.classList.contains('sel') === on) continue;
      el.classList.toggle('sel', on);
      const nm = el.querySelector('.nm'), a = store.agents.get(el.dataset.unit ?? '');
      if (nm && a) nm.outerHTML = rowName(a, on);
      if (on) el.scrollIntoView({ block: 'nearest' });
    }
  }

  /** The badges the map shows over an agent, as pills: under its row and in the loop bar. */
  function pillsOf(a: Agent): string {
    return (presence.badges.get(a.id) ?? []).filter((b) => b.ruled).map((b) => badgePill(b, a.id)).join('');
  }

  /** A badge as the map shows it up close (badgeLook): a pill with its icon and text, or an icon alone. */
  function badgePill(b: Badge, agentId: string): string {
    const look = badgeLook(b, false);
    const name = look.icon ? iconName(look.icon) : null;
    const icon = name ? iconSvg(name, 11) : look.icon ? `<span class="emo">${esc(look.icon)}</span>` : '';
    const content = `${icon}${look.marker ? '' : esc(look.text)}`;
    const attributes = `class="badge${look.marker ? ' marker' : ''}${b.urgency === 'alarm' ? ' alarm' : ''}"${b.color ? ` style="--c:${b.color}"` : ''} title="${esc(b.name)}${b.text ? ` · ${esc(b.text)}` : ''}"`;
    return b.action
      ? `<button type="button" ${attributes} data-${b.action}="${esc(agentId)}" aria-label="Open ${esc(b.text)} ${b.action}">${content}</button>`
      : `<span ${attributes}>${content}</span>`;
  }

  /** Frames a space (or a team in it) on the map, switching to the map on a phone first. */
  function showSpace(node: string, space: string, lead?: string) {
    closeMenu();
    setTab('map');
    requestAnimationFrame(() => requestAnimationFrame(() => map.focusSpace(node, space, lead || undefined)));
  }

  // A tap on an agent selects it at once and, after a double-tap's length, flies there; two taps open its
  // terminal, as on the map (Shift: its own tab).
  roster.addEventListener('pointerdown', (e) => { rosterPointer = e.pointerId; });
  const finishRosterPointer = (e: PointerEvent) => {
    if (rosterPointer !== e.pointerId) return;
    // Let the native click dispatch before applying queued redraws.
    setTimeout(() => {
      if (rosterPointer === e.pointerId) rosterPointer = null;
      flushRoster();
    }, 0);
  };
  window.addEventListener('pointerup', finishRosterPointer);
  window.addEventListener('pointercancel', finishRosterPointer);
  window.addEventListener('blur', () => { rosterPointer = null; cancelRowTap(); flushRoster(); });
  roster.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-artifacts], [data-schedules]')) { cancelRowTap(); return; }
    const fold = t.closest<HTMLElement>('[data-section], [data-quiet]');
    if (fold) {
      cancelRowTap();
      toggleSection(fold.dataset.section ?? `quiet/${fold.dataset.quiet ?? ''}`);
      renderRoster();
      return;
    }
    const head = t.closest<HTMLElement>('[data-space]');
    if (head?.dataset.node && head.dataset.space) { cancelRowTap(); showSpace(head.dataset.node, head.dataset.space, head.dataset.lead); return; }
    const id = t.closest<HTMLElement>('[data-unit]')?.dataset.unit;
    if (!id) return;
    const double = rowTap?.id === id && e.timeStamp - rowTap.at < DOUBLE_TAP_MS;
    cancelRowTap();
    if (double) {
      const a = store.agents.get(id);
      const web = a ? webLink(a) : undefined;
      if (web) openAgentLink(linkTo(id, web), e.shiftKey ? 'own' : 'shared', e.shiftKey);
      else flyTo(id);
      flushRoster();
      return;
    }
    select(id);
    rowTap = { id, at: e.timeStamp, timer: window.setTimeout(() => { rowTap = null; flyTo(id, 'sync'); flushRoster(); }, DOUBLE_TAP_MS) };
  });
  presence.onChange(() => { renderRoster(); loopBar.render(); }); // dimming and sleep follow the map's light

  // ─── unit card (read-only)

  const cardWaits = pressGuard(card, renderCard);
  /** The card's spend block as last written: it is swapped apart from the rest (renderCardUsage). */
  let cardUsage = '';

  function renderCard(): void {
    if (cardWaits()) return;
    const a = cardFor ? store.agents.get(cardFor) : undefined;
    if (!a) { draw(card, ''); return; }
    const k = kindOf(a.kind), st = statusOf(a.status);
    const team = store.reports(a.id), links = linksOf(a);
    const goto = (b: Agent) => `<button type="button" class="goto" data-goto="${esc(b.id)}" data-k="goto/${esc(b.id)}" style="--s:${statusOf(b.status).c}"><i></i>${esc(b.name)}</button>`;
    const pane = store.panes.get(a.id);
    const since = store.statusSince.get(a.id);
    const space = store.spaces.get(a.space_id);
    const node = store.nodes.get(a.node_id);
    const scheduleCount = currentScheduleCounts().get(a.id) ?? 0;
    // The address book when this token may read it; else what the event log told us.
    const book = contacts.get(a.id);
    const channels = (book ?? a.channels).map((c) => {
      const shown = book ? (book.find((b) => b.id === c.id)?.display?.text ?? null) : null;
      const fallback = c.type === 'buzz' ? `buzz · ${esc(buzzLabel(a) ?? '?')}` : c.type === 'herdr-pane' ? `pane${pane ? ` · ${esc(pane.pane_id)}` : ''}` : esc(c.type);
      const label = shown ? `${esc(c.type)} · ${esc(shown)}` : fallback;
      return `<li><i style="background:${channelColor(c.state)}"></i>${label}<small>${esc(c.state)} · ${esc(c.source)}</small></li>`;
    }).join('') || '<li class="empty">none</li>';
    const bookNote = book === null ? '<p class="note">pane and Buzz names from the event log · the address book needs member access</p>' : '';
    const events = store.agentEvents(a.id, 25).map((e) => feedItem(e)).join('') || '<li class="empty">no events in the log</li>';
    const scrolled = [...card.querySelectorAll<HTMLElement>('.body > *, .recent ol')].map((el) => el.scrollTop);
    const redrawn = draw(card, `
      <header style="--k:${k.c};--s:${st.c};--sp:${spaceColor(a.space_slug)}">
        <span class="badge" title="${esc(k.label)}">${portrait(a)}</span>
        <div class="title"><b>${esc(a.name)}</b><small>${esc(k.label)} · <span class="sp">${esc(space?.name ?? a.space_slug)}</span> · ${esc(a.node_name)}</small></div>
        <span class="pill st-${esc(a.status)}">${esc(st.icon)} ${esc(st.label)}${since ? ` · <time data-at="${esc(since)}">${ago(since)}</time>` : ''}</span>
        <button type="button" class="fold" data-fold="card" data-k="fold" title="Fold the card" aria-label="Fold the unit card" aria-expanded="${!folds.has('card')}">▾</button>
        <button type="button" class="close" data-k="close" aria-label="Close">✕</button>
      </header>
      <div class="body">
        <dl>
          ${links.length ? `<dt>open</dt><dd class="links">${links.map((l) => linkItem(a.id, l)).join('')}</dd>` : ''}
          ${a.tokens?.length ? `<dt>tokens</dt><dd class="tokens">${coalesce(badgesFor(a.tokens, badges.rules)).map(tokenChip).join('')}</dd>` : ''}
          ${a.artifacts?.length ? `<dt>artifacts</dt><dd><button type="button" class="chip" data-artifacts="${esc(a.id)}" data-k="artifacts">${iconSvg('artifacts')} ${a.artifacts.length} artifacts</button></dd>` : ''}
          ${scheduleCount ? `<dt>upcoming</dt><dd><button type="button" class="chip" data-schedules="${esc(a.id)}" data-k="schedules">${iconSvg('clock')} ${scheduleCount} schedules</button></dd>` : ''}
          ${a.reports_to ? `<dt>reports to</dt><dd>${reportsTo(a)}</dd>` : ''}
          ${team.length ? `<dt>team</dt><dd class="team">${team.map(goto).join('')}</dd>` : ''}
          <dt>folder</dt><dd class="path" title="${esc(a.cwd)}">${esc(a.cwd)}</dd>
          <dt>pane</dt><dd>${pane ? `<code>${esc(pane.pane_id)}</code>${pane.herdr_name ? ` · ${esc(pane.herdr_name)}` : ''}` : '<span class="dim">not reported</span>'}</dd>
          <dt>computer</dt><dd>${esc(a.node_name)} <span style="color:${nodeStateOf(node?.state ?? a.node_state).c}">${esc(nodeStateOf(node?.state ?? a.node_state).label)}</span></dd>
          <dt>session</dt><dd class="path" title="${esc(a.session_id ?? '')}">${a.session_id ? esc(basename(a.session_id)) : '<span class="dim">none recorded</span>'}</dd>
          <dt>observed model</dt><dd>${rawObservation(a.inference?.model?.id)}${observationSource(a.inference?.model)}</dd>
          <dt>provider</dt><dd>${rawObservation(a.inference?.model?.provider)}</dd>
          <dt>configured effort</dt><dd>${rawObservation(a.inference?.effort?.configured)}</dd>
          <dt>reported effort</dt><dd>${rawObservation(a.inference?.effort?.level)}${observationSource(a.inference?.effort)}</dd>
          <dt>launch</dt><dd>${esc(a.launcher)} · profile <code>${esc(a.profile)}</code>${a.workspace_label ? ` · label ${esc(a.workspace_label)}` : ''}</dd>
          <dt>policy</dt><dd>${a.enabled ? 'enabled' : 'disabled'} · ${a.resume ? 'resumes its session' : 'fresh start'} · ${a.relaunch_on_exit ? 'relaunches on exit' : 'stays down on exit'}</dd>
          ${a.tags.length ? `<dt>tags</dt><dd>${a.tags.map((t) => `<code>${esc(t)}</code>`).join(' ')}</dd>` : ''}
          ${a.notes ? `<dt>notes</dt><dd>${esc(a.notes)}</dd>` : ''}
          <dt>channels</dt><dd><ul class="chans">${channels}</ul>${bookNote}</dd>
        </dl>
        <div class="recent"><h3>RECENT EVENTS</h3><ol>${events}</ol></div>
      </div>`);
    if (redrawn) cardUsage = '';
    renderCardUsage();
    // A redraw keeps where each part was scrolled.
    if (redrawn) card.querySelectorAll<HTMLElement>('.body > *, .recent ol').forEach((el, i) => { el.scrollTop = scrolled[i] ?? 0; });
  }

  /** The card's spend block alone: live usage changes it every few seconds, and it has no controls to lose. */
  function renderCardUsage() {
    if (cardWaits()) return;
    const recent = card.querySelector('.recent');
    if (!cardFor || !recent) return;
    const html = usageBlock(cardFor);
    if (html === cardUsage) return;
    const old = card.querySelector<HTMLElement>('.usage');
    const top = old?.scrollTop ?? 0;
    if (old) old.outerHTML = html;
    else recent.insertAdjacentHTML('beforebegin', html);
    cardUsage = html;
    const next = card.querySelector<HTMLElement>('.usage');
    if (next) next.scrollTop = top;
  }

  /** Who the agent reports to, as the card shows it: a link to an agent on the map, else plain words. */
  function reportsTo(a: Agent): string {
    const r = a.reports_to;
    if (!r) return '';
    if (!('type' in r)) return `<span class="dim">an agent in a space you can't see</span>`;
    if (r.type === 'person') return `${esc(r.name)} <span class="dim">· person</span>`;
    const boss = store.agents.get(r.agent_id);
    if (boss) return `<button type="button" class="goto" data-goto="${esc(boss.id)}" data-k="goto/${esc(boss.id)}" style="--s:${statusOf(boss.status).c}"><i></i>${esc(boss.name)}</button>${boss.space_slug === a.space_slug ? '' : ` <span class="dim">· ${esc(r.space)}</span>`}`;
    return `${esc(r.name)} <span class="dim">· ${r.retired ? 'retired' : esc(r.space)}</span>`;
  }

  card.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.close')) showCard(false);
    const go = target.closest<HTMLElement>('[data-goto]')?.dataset.goto;
    if (go) flyTo(go);
  });

  // ─── event log

  /** An event as a log row; `navigates`: the row takes focus and flies to its agent (the event log's rows do). */
  function feedItem(e: RostrEvent, navigates = false): string {
    const d = describe(e);
    return `<li class="${d.quiet ? 'quiet' : ''}" data-agent="${esc(e.agent_id ?? '')}"${navigates && e.agent_id ? ' tabindex="0"' : ''} style="--c:${d.c}" title="${esc(new Date(e.at).toLocaleString())} · ${esc(e.type)} · seq ${e.seq}">
      <time>${clock(e.at)}</time><i>${esc(d.icon)}</i><span><b>${esc(d.who)}</b> ${d.what}</span></li>`;
  }

  function renderFeed() {
    const fresh = store.events.filter((e) => e.seq > feedSeq);
    if (!fresh.length) return;
    const initial = feedSeq === 0;
    feedSeq = fresh[fresh.length - 1].seq;
    const shown = fresh.filter((e) => store.visible(e));
    const html = shown.slice(-FEED_MAX).reverse().map((e) => feedItem(e, true)).join('');
    if (initial) {
      // The log is a live region: the history arriving at once is not announced, only what follows.
      feed.setAttribute('aria-live', 'off');
      requestAnimationFrame(() => feed.setAttribute('aria-live', 'polite'));
    }
    feed.insertAdjacentHTML('afterbegin', html);
    if (!initial) for (let i = 0; i < shown.length && i < feed.children.length; i++) feed.children[i].classList.add('new');
    while (feed.children.length > FEED_MAX) feed.lastElementChild?.remove();
  }

  /** Rows that fly to their agent: on a click, and on Enter or Space when a row has focus. */
  function rowsFlyTo(list: HTMLElement, rows: string, idOf: (row: HTMLElement) => string | undefined) {
    const go = (e: Event) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(rows);
      const id = row ? idOf(row) : undefined;
      if (!id || !store.agents.has(id)) return false;
      flyTo(id);
      return true;
    };
    list.addEventListener('click', go);
    list.addEventListener('keydown', (e) => {
      if (plainKey(e) && (e.key === 'Enter' || e.key === ' ') && go(e)) e.preventDefault();
    });
  }
  rowsFlyTo(feed, 'li[data-agent]', (row) => row.dataset.agent);

  // ─── spend ledger

  const ledgerWaits = pressGuard(ledgerEl, renderLedger);
  function renderLedger(): void {
    if (document.body.dataset.view !== 'spend' || ledgerWaits()) return;
    draw(ledgerEl, ledger(selected));
  }

  function renderUpcoming() {
    if (document.body.dataset.view !== 'upcoming') return;
    upcoming.render({
      schedules: schedules.items, state: schedules.state, error: schedules.error,
      spaceSlugs: filter.spaces, navigableAgents: new Set(store.agents.keys()),
    });
  }

  rowsFlyTo(ledgerEl, 'tr[data-id]', (row) => row.dataset.id);

  // ─── phone tabs

  function setTab(tab: string) {
    document.body.dataset.tab = tab;
    map.setCovered(tab !== 'map');
    for (const b of document.querySelectorAll<HTMLElement>('.tabs button')) {
      b.classList.toggle('on', b.dataset.tab === tab);
      b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false');
    }
    if (tab === 'units' || tab === 'spend' || tab === 'upcoming') setView(tab);
    // The selected agent's row, scrolled to while the list was hidden, is brought into view now.
    if (tab === 'units') roster.querySelector('.unit.sel')?.scrollIntoView({ block: 'nearest' });
  }
  for (const b of document.querySelectorAll<HTMLElement>('.tabs button')) b.addEventListener('click', () => {
    if (b.dataset.tab === 'upcoming') upcoming.setAgent(null);
    setTab(b.dataset.tab ?? 'map');
  });

  // The right panel shows units, session usage or the schedule inventory.
  function setView(view: string) {
    document.body.dataset.view = view;
    for (const b of document.querySelectorAll<HTMLElement>('.views button')) b.setAttribute('aria-selected', String(b.dataset.view === view));
    renderLedger();
    renderUpcoming();
  }
  for (const b of document.querySelectorAll<HTMLElement>('.views button')) b.addEventListener('click', () => {
    if (b.dataset.view === 'upcoming') upcoming.setAgent(null);
    setView(b.dataset.view ?? 'units');
  });
  setView('units');
  setTab('map');

  // ─── wiring

  $('#fit').addEventListener('click', () => map.fit());
  /** A key pressed alone (or with Shift), not held down, not composing, not already handled. */
  const plainKey = (e: KeyboardEvent) => !e.defaultPrevented && !e.isComposing && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey;
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing || e.repeat || document.querySelector('dialog[open]')) return;
    if (e.key.toLowerCase() === 'k' && (e.ctrlKey !== e.metaKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      openSearch(true);
      return;
    }
    if (!plainKey(e) || !searchMenu.hidden) return;
    if (e.target instanceof HTMLElement && (e.target.closest('input, textarea, select') || e.target.isContentEditable)) return;
    // An open popover takes the key: its own Escape closes it, and nothing else.
    if (!settingsMenu.hidden || !filterMenu.hidden || !badgesDialog.hidden) return;
    if (e.key === 'Escape') { if (!menu.hidden) closeMenu(); else if (cardOpen) showCard(false); else select(null); }
    if (e.key === 'i' && selected) showCard(!cardOpen);
    if (e.key === 'f' || e.key === 'F') map.fit();
    if (e.key === '[') togglePanel('left');
    if (e.key === ']') togglePanel('right');
    if (e.key === '/') { e.preventDefault(); openSearch(true); }
    if (e.key === '.') { e.preventDefault(); loopBar.step(1); }
    if (e.key === ',') { e.preventDefault(); loopBar.step(-1); }
    if (e.key === '>') { e.preventDefault(); loopBar.fastForward(); }
  });

  // ─── collapsible panels (side panels on desktop, the unit card everywhere); remembered per browser
  // (settings.ts folds)

  const unseenEl = $('#unseen'), railLeft = $('.left .rail');
  let unseen = 0;
  function applyFolds() {
    for (const p of ['left', 'right', 'card']) document.body.classList.toggle(`fold-${p}`, folds.has(p));
    for (const b of document.querySelectorAll<HTMLElement>('[data-fold]')) b.setAttribute('aria-expanded', String(!folds.has(b.dataset.fold ?? '')));
  }
  function togglePanel(panel: string) {
    toggleFold(panel);
    if (panel === 'left' && !folds.has('left')) { unseen = 0; unseenEl.textContent = ''; }
    applyFolds();
  }
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-fold]');
    if (b?.dataset.fold) togglePanel(b.dataset.fold);
  });
  applyFolds();

  // ─── settings menu (⚙): opens under its button, closes on a click outside or Escape

  const settingsBtn = $('#settings-btn'), settingsMenu = $('#settings-menu');
  const optDetails = $<HTMLInputElement>('#opt-map-details');
  optDetails.checked = settings.mapDetails;
  optDetails.addEventListener('change', () => setSetting('mapDetails', optDetails.checked));
  const optDim = $<HTMLInputElement>('#opt-dim-quiet');
  optDim.checked = settings.dimQuiet;
  optDim.addEventListener('change', () => { setSetting('dimQuiet', optDim.checked); renderRoster(); });
  const optPack = $<HTMLInputElement>('#opt-pack-quiet');
  optPack.checked = settings.packQuiet;
  optPack.addEventListener('change', () => { setSetting('packQuiet', optPack.checked); map.refresh(); });
  const optSleep = $<HTMLInputElement>('#opt-hide-sleepers');
  optSleep.checked = settings.hideSleepers;
  optSleep.addEventListener('change', () => setSetting('hideSleepers', optSleep.checked));
  const optAttention = $<HTMLInputElement>('#opt-navigation-attention');
  optAttention.checked = settings.navigationAttentionOnly;
  optAttention.addEventListener('change', () => {
    setSetting('navigationAttentionOnly', optAttention.checked);
    loopBar.render();
  });
  // Badge rules change the map, units list and open card at once.
  const badgeEditor = mountBadgeEditor(badgesDialog, () => { map.refresh(); renderRoster(); loopBar.render(); renderCard(); });
  $('#open-badges').addEventListener('click', () => { openSettings(false); badgeEditor.open(); });
  const legend = mountLegend($('#legend'));
  $('#legend').addEventListener('click', () => {
    closeMenu();
    artifactPanel.close();
    badgeEditor.close();
    openSearch(false);
    openSettings(false);
    openFilter(false);
    legend.open();
  });
  const openSettings = (open: boolean) => {
    settingsMenu.hidden = !open;
    settingsBtn.setAttribute('aria-expanded', String(open));
  };
  settingsBtn.addEventListener('click', () => openSettings(settingsMenu.hidden));
  document.addEventListener('click', (e) => {
    if (!settingsMenu.hidden && !(e.target as HTMLElement).closest('.settings')) openSettings(false);
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') openSettings(false); });

  // Who rostr takes this viewer for, so it is plain why they see what they see: a person signed in
  // through Tailscale sees their own grants; the proxy's token shows everyone the same.
  const who = $('#who');
  const loadWho = () => source.me().then((m) => {
    who.innerHTML = m.tailscale_login
      ? `Viewing as <b>${esc(m.principal.name)}</b> · ${esc(m.tailscale_login)} via Tailscale`
      : `Viewing as <b>${esc(m.principal.name)}</b> · a shared token: everyone sees the same`;
  }).catch(() => { who.textContent = 'rostr did not say who you are'; });
  store.onOpen(loadWho);

  // ─── filter (funnel): spaces and tags to focus on; whatever does not pass acts as if it did not
  // exist (store.ts). Opens under its button like the settings; changes apply at once and are remembered.

  const filterBtn = $('#filter-btn'), filterMenu = $('#filter-menu'), filterCount = $('#filter-count'), filterbar = $('#filterbar');
  let feedStale = false;
  const spaceName = (slug: string) => [...store.spaces.values()].find((s) => s.slug === slug)?.name ?? slug;

  function renderFilter() {
    const n = filter.spaces.size + filter.tags.size;
    filterCount.textContent = n ? String(n) : '';
    filterBtn.classList.toggle('on', n > 0);
    filterBtn.setAttribute('aria-label', n ? `Filter by space or tag, ${n} active` : 'Filter by space or tag');
    const focusedHere = () => filterMenu.contains(document.activeElement) || filterbar.contains(document.activeElement);
    const held = focusedHere();
    // On the map, what is filtered and the way out, so a focus is never forgotten.
    const chosen = [...[...filter.spaces].map(spaceName), ...[...filter.tags].map((t) => `#${t}`)];
    filterbar.hidden = !n;
    draw(filterbar, n
      ? `<button type="button" class="what" data-open-filter data-k="what"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M1.5 2.5h13l-5 6v5l-3 1.5v-6.5z" fill="currentColor"/></svg>${esc(chosen.join(' · '))}<small>${store.agents.size} of ${store.all.size}</small></button><button type="button" class="clear" data-clear-filter data-k="clear" aria-label="Clear the filter" title="Clear the filter">✕</button>`
      : '');
    if (!filterMenu.hidden) {
      const { spaces, tags } = facets(store.all.values(), filter);
      const chip = (kind: 'space' | 'tag', key: string, label: string, count: number, color?: string) =>
        `<button type="button" class="chip" data-filter-kind="${kind}" data-key="${esc(key)}" data-k="${kind}/${esc(key)}" aria-pressed="${(kind === 'space' ? filter.spaces : filter.tags).has(key)}"${color ? ` style="--c:${color}"` : ''}>${color ? '<i></i>' : ''}${esc(label)}<small>${count}</small></button>`;
      draw(filterMenu, `<h3>FILTER</h3>
      <h4>Spaces</h4><div class="chips">${[...spaces].sort(([a], [b]) => spaceName(a).localeCompare(spaceName(b))).map(([slug, count]) => chip('space', slug, spaceName(slug), count, spaceColor(slug))).join('')}</div>
      <h4>Tags</h4><div class="chips">${tags.size ? [...tags].sort(([a], [b]) => a.localeCompare(b)).map(([t, count]) => chip('tag', t, t, count)).join('') : '<p class="note">No agent has tags yet.</p>'}</div>
      <footer><span>${store.agents.size} of ${store.all.size} agents</span><button type="button" class="clear" data-clear-filter data-k="clear"${n ? '' : ' disabled'}>Clear</button></footer>`);
    }
    // Clearing takes its own control away (Clear disables itself, the bar hides): focus stays with the filter.
    if (held && !focusedHere()) ((filterMenu.hidden ? null : filterMenu.querySelector<HTMLElement>('.chip')) ?? filterBtn).focus();
  }

  function changeFilter() {
    saveFilter();
    feedStale = true; // the log is redrawn from the start for the new focus
    store.refilter();
  }

  const openFilter = (open: boolean) => {
    filterMenu.hidden = !open;
    filterBtn.setAttribute('aria-expanded', String(open));
    if (open) renderFilter();
  };
  filterBtn.addEventListener('click', () => openFilter(filterMenu.hidden));
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const chip = t.closest<HTMLElement>('[data-filter-kind]');
    const key = chip?.dataset.key;
    if (chip && key) {
      const set = chip.dataset.filterKind === 'space' ? filter.spaces : filter.tags;
      if (set.has(key)) set.delete(key);
      else set.add(key);
      changeFilter();
    } else if (t.closest('[data-clear-filter]')) {
      filter.spaces.clear();
      filter.tags.clear();
      changeFilter();
    } else if (t.closest('[data-open-filter]')) openFilter(true);
    else if (!filterMenu.hidden && !t.closest('.filter')) openFilter(false);
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') openFilter(false); });

  // Search opens the web terminal by default. Select only flies to the agent; packed-away agents are
  // brought back onto the map by either action.

  const searchBtn = $('#search-btn'), searchMenu = $('#search-menu'), searchResults = $('#search-results');
  const searchQ = $<HTMLInputElement>('#search-q');
  let searchHits: Agent[] = [];
  let searchAt = 0;
  let searchReturnFocus: HTMLElement | null = null;

  function renderSearch() {
    searchHits = searchAgents(store.agents.values(), searchQ.value, store.lastActive, Date.now());
    searchAt = Math.min(searchAt, Math.max(0, searchHits.length - 1));
    searchResults.innerHTML = searchHits.length ? searchHits.map((a, i) => {
      const k = kindOf(a.kind), st = statusOf(a.status), t = store.lastActive.get(a.id);
      const when = a.status === 'working' ? 'now' : t ? ago(new Date(t).toISOString()) : 'not lately';
      const web = webLink(a);
      return `<li><button type="button" class="search-open"${i === searchAt ? ' aria-current="true"' : ''} data-find="${esc(a.id)}" aria-label="Open web UI for ${esc(a.name)}" title="${web ? 'Open web UI (Enter)' : 'No web UI link reported'}"${web ? '' : ' disabled'}><i style="color:${k.c}">${esc(k.glyph)}</i><span>${esc(a.name)}<small>${esc(a.space_slug)} · ${esc(when)}${web ? '' : ' · no web UI'}</small></span><em style="color:${st.c}">${esc(st.label)}</em></button><button type="button" class="search-select" data-find-select="${esc(a.id)}" aria-label="Select ${esc(a.name)} on map" title="Select on map without opening the web UI">Select</button></li>`;
    }).join('') : '<li class="none">No agent by that name</li>';
  }

  function openSearch(open: boolean) {
    const wasOpen = !searchMenu.hidden;
    searchMenu.hidden = !open;
    searchBtn.setAttribute('aria-expanded', String(open));
    if (!open) return;
    if (!wasOpen) {
      searchReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      searchQ.value = '';
      searchAt = 0;
      renderSearch();
      searchResults.scrollTop = 0;
      badgeEditor.close();
      openSettings(false);
      openFilter(false);
    }
    searchQ.focus();
  }

  function pick(id: string) {
    const agent = store.agents.get(id);
    const web = agent && webLink(agent);
    if (!web) { renderSearch(); return; }
    // Open in the input/click event, before the map's asynchronous flight, to retain popup permission.
    openAgentLink(linkTo(id, web), 'shared', false);
    openSearch(false);
    flyTo(id, 'sync');
  }

  searchBtn.addEventListener('click', () => openSearch(searchMenu.hidden));
  searchQ.addEventListener('input', () => { searchAt = 0; renderSearch(); searchResults.scrollTop = 0; });
  searchQ.addEventListener('keydown', (e) => {
    if (!plainKey(e)) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      searchAt = (searchAt + (e.key === 'ArrowDown' ? 1 : -1) + searchHits.length) % Math.max(1, searchHits.length);
      renderSearch();
      searchResults.children.item(searchAt)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && searchHits[searchAt]) {
      e.preventDefault();
      pick(searchHits[searchAt].id);
    }
  });
  /** Back to what had focus before search opened, if it can still take it; else the search button. */
  function restoreFocusAfterSearch() {
    const target = searchReturnFocus;
    if (target?.isConnected && target.getClientRects().length && !target.closest('[hidden], [inert], :disabled') && target !== document.body) {
      target.focus();
    }
    if (document.activeElement === searchQ || searchMenu.contains(document.activeElement) || document.activeElement === document.body) searchBtn.focus();
  }
  addEventListener('keydown', (e) => {
    if (searchMenu.hidden || !plainKey(e) || e.key !== 'Escape') return;
    e.preventDefault();
    openSearch(false);
    restoreFocusAfterSearch();
  });
  searchResults.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const selectId = target.closest<HTMLElement>('[data-find-select]')?.dataset.findSelect;
    if (selectId) { openSearch(false); flyTo(selectId); return; }
    const id = target.closest<HTMLElement>('[data-find]')?.dataset.find;
    if (id) pick(id);
  });
  document.addEventListener('click', (e) => {
    if (!searchMenu.hidden && !(e.target as HTMLElement).closest('.search')) openSearch(false);
  });

  // ─── theme: the panels re-render so every inline colour comes from the new palette; the map
  // reads the theme each frame.

  const themeSel = $<HTMLSelectElement>('#theme');
  themeSel.innerHTML = THEMES.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('');
  themeSel.value = theme.id;
  themeSel.addEventListener('change', () => {
    const next = THEMES.find((t) => t.id === themeSel.value);
    if (next) theme.set(next.id);
  });
  theme.onChange(() => {
    themeSel.value = theme.id;
    map.refresh(); // district colours are fixed when the world is built
    feed.innerHTML = '';
    feedSeq = 0;
    renderStats();
    renderNodes();
    renderRoster();
    renderCard();
    renderLedger();
    renderUpcoming();
    renderFeed();
  });
  addEventListener('hashchange', () => fromHash());

  let hashApplied = false;
  store.onChange(() => {
    if (feedStale) { feedStale = false; feed.innerHTML = ''; feedSeq = 0; }
    renderFilter();
    if (selected && !store.agents.has(selected)) select(null);
    if (!menu.hidden) renderMenu(); // links follow the agent's pane
    artifactPanel.update(store.agents.get(artifactPanel.agentId ?? ''));
    map.refresh();
    renderStats();
    renderConn();
    renderNodes();
    renderRoster();
    renderCard();
    renderLedger();
    renderUpcoming();
    renderFeed();
    loopBar.render();
    if (!hashApplied && store.agents.size) { hashApplied = true; fromHash('step'); }
  });
  store.onEvent((e) => {
    if (!store.visible(e)) return; // filtered out: no effect, no count, no address-book reload
    map.event(e);
    // While the event log is folded away, its rail counts what arrived and pulses.
    if (folds.has('left') && !describe(e).quiet) {
      unseen += 1;
      unseenEl.textContent = String(unseen);
      railLeft.classList.remove('ping');
      void railLeft.offsetWidth;
      railLeft.classList.add('ping');
    }
    // A channel or pane change makes the open card's address book stale.
    if (e.agent_id && e.agent_id === cardFor && contacts.get(e.agent_id) !== null) loadContact(e.agent_id);
  });
  usage.onChange(() => {
    map.refresh();
    counter.update();
    renderRoster();
    loopBar.render();
    renderCardUsage();
    renderLedger();
  });
  usage.onFrame((id, cost, toks) => map.usage(id, cost, toks));
  schedules.onChange(() => {
    map.refresh();
    renderRoster();
    loopBar.render();
    renderCard();
    renderUpcoming();
    if (!menu.hidden) renderMenu();
  });

  // Relative times tick without re-rendering.
  setInterval(() => {
    const now = Date.now();
    for (const t of document.querySelectorAll<HTMLElement>('time[data-at]')) t.textContent = ago(t.dataset.at, now);
  }, 5000);

  renderConn();
  renderCard();
  return { tap };
}
