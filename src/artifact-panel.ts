import type { Agent, Artifact } from './types';
import type { Tab } from './tabs';
import { artifactList, artifactView, newestFirst } from './artifacts';
import './artifact-panel.css';

export interface ArtifactPanel {
  readonly agentId: string | null;
  open(agent: Agent, at: { x: number; y: number }): void;
  update(agent: Agent | undefined): void;
  close(): void;
}

interface ArtifactRow {
  element: HTMLLIElement;
  artifact: Artifact;
  metadataJson: string;
  link: HTMLAnchorElement;
  title: HTMLElement;
  host: HTMLElement;
  url: HTMLElement;
  metadata: HTMLElement;
}

let panelSequence = 0;

export function mountArtifactPanel(
  onOpen: (agentId: string, artifact: Artifact, tab: Tab) => void,
): ArtifactPanel {
  const panel = document.createElement('section');
  panel.className = 'artifact-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  const id = `artifact-panel-${++panelSequence}`;
  panel.setAttribute('aria-labelledby', `${id}-title`);
  panel.setAttribute('aria-describedby', `${id}-agent`);

  const header = document.createElement('header');
  const heading = document.createElement('div');
  heading.className = 'artifact-panel-heading';
  const title = document.createElement('h2');
  title.id = `${id}-title`;
  title.textContent = 'Artifacts';
  const description = document.createElement('p');
  description.id = `${id}-agent`;
  const name = document.createElement('span');
  const count = document.createElement('span');
  count.className = 'artifact-panel-count';
  description.append(name, count);
  heading.append(title, description);
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'artifact-panel-close';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', 'Close artifacts');
  header.append(heading, closeButton);

  const body = document.createElement('div');
  body.className = 'artifact-panel-body';
  const list = document.createElement('ol');
  list.className = 'artifact-panel-list';
  const empty = document.createElement('p');
  empty.className = 'artifact-panel-empty';
  empty.textContent = 'No artifacts for this agent.';
  body.append(list, empty);
  panel.append(header, body);
  document.body.append(panel);

  let agentId: string | null = null;
  let at = { x: 0, y: 0 };
  let returnFocus: HTMLElement | null = null;
  let rows: ArtifactRow[] = [];

  function position() {
    if (panel.hidden) return;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const pad = 8;
    panel.style.maxWidth = `${Math.max(0, width - pad * 2)}px`;
    panel.style.maxHeight = `${Math.max(0, height - pad * 2)}px`;
    const rect = panel.getBoundingClientRect();
    const below = at.y + 14;
    const y = below + rect.height <= top + height - pad ? below : at.y - 14 - rect.height;
    panel.style.left = `${Math.max(left + pad, Math.min(at.x + 10, left + width - rect.width - pad))}px`;
    panel.style.top = `${Math.max(top + pad, Math.min(y, top + height - rect.height - pad))}px`;
  }

  function close() {
    if (panel.hidden) return;
    const restore = panel.contains(document.activeElement);
    agentId = null;
    panel.hidden = true;
    if (restore && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function createRow(artifact: Artifact): ArtifactRow {
    const element = document.createElement('li');
    element.className = 'artifact-panel-item';
    const link = document.createElement('a');
    link.className = 'artifact-panel-link';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const title = document.createElement('strong');
    const host = document.createElement('span');
    host.className = 'artifact-panel-host';
    const url = document.createElement('span');
    url.className = 'artifact-panel-url';
    link.append(title, host, url);

    const actions = document.createElement('div');
    actions.className = 'artifact-panel-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Open';
    open.title = 'Open in the shared tab';
    const newTab = document.createElement('button');
    newTab.type = 'button';
    newTab.textContent = 'New tab';
    newTab.title = 'Open in its own tab';
    actions.append(open, newTab);

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Details';
    const metadata = document.createElement('pre');
    details.append(summary, metadata);
    element.append(link, actions, details);
    const row: ArtifactRow = { element, artifact, metadataJson: '', link, title, host, url, metadata };
    const invoke = (tab: Tab) => {
      if (agentId !== null) onOpen(agentId, row.artifact, tab);
    };
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      invoke('shared');
    });
    open.addEventListener('click', () => invoke('shared'));
    newTab.addEventListener('click', () => invoke('own'));
    return row;
  }

  function render(agent: Agent) {
    const artifacts = newestFirst(artifactList(agent.artifacts));
    const scrollTop = body.scrollTop;
    const focused = document.activeElement;
    const hadFocus = focused instanceof HTMLElement && panel.contains(focused);
    if (name.textContent !== agent.name) name.textContent = agent.name;
    const countText = ` · ${artifacts.length} ${artifacts.length === 1 ? 'artifact' : 'artifacts'}`;
    if (count.textContent !== countText) count.textContent = countText;

    // Match URL occurrences, not unique URLs: rostr may return several entries for one address.
    const available = new Map<string, ArtifactRow[]>();
    for (const row of rows) {
      const matches = available.get(row.artifact.url);
      if (matches) matches.push(row);
      else available.set(row.artifact.url, [row]);
    }
    const next: ArtifactRow[] = [];
    for (const artifact of artifacts) {
      const row = available.get(artifact.url)?.shift() ?? createRow(artifact);
      const metadataJson = JSON.stringify(artifact.metadata, null, 2);
      const changed = row.link.getAttribute('href') !== artifact.url || row.metadataJson !== metadataJson;
      row.artifact = artifact;
      if (changed) {
        const view = artifactView(artifact);
        if (row.link.getAttribute('href') !== view.url) row.link.href = view.url;
        if (row.title.textContent !== view.title) row.title.textContent = view.title;
        if (row.host.textContent !== view.host) row.host.textContent = view.host;
        if (row.url.textContent !== view.url) row.url.textContent = view.url;
        if (row.metadataJson !== metadataJson) row.metadata.textContent = metadataJson;
        row.metadataJson = metadataJson;
      }
      next.push(row);
      const current = list.children.item(next.length - 1);
      if (current !== row.element) list.insertBefore(row.element, current);
    }
    for (const matches of available.values()) {
      for (const row of matches) row.element.remove();
    }
    rows = next;
    list.hidden = artifacts.length === 0;
    empty.hidden = artifacts.length !== 0;
    if (hadFocus && document.activeElement !== focused) {
      if (focused.isConnected) focused.focus({ preventScroll: true });
      else closeButton.focus({ preventScroll: true });
    }
    body.scrollTop = scrollTop;
    position();
  }

  closeButton.addEventListener('click', close);
  for (const event of ['click', 'auxclick', 'dblclick', 'pointerup', 'keydown']) {
    panel.addEventListener(event, (e) => e.stopPropagation());
  }
  // Guard before document capture handlers, so presses and scrolling here do not close other panels.
  window.addEventListener('pointerdown', (event) => {
    if (panel.hidden) return;
    if (event.composedPath().includes(panel)) event.stopPropagation();
    else close();
  }, true);
  window.addEventListener('wheel', (event) => {
    if (!panel.hidden && event.composedPath().includes(panel)) event.stopPropagation();
  }, { capture: true, passive: true });
  window.addEventListener('keydown', (event) => {
    if (panel.hidden || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }, true);
  window.addEventListener('resize', position);
  window.visualViewport?.addEventListener('resize', position);
  window.visualViewport?.addEventListener('scroll', position);
  body.addEventListener('toggle', position, true);

  return {
    get agentId() { return agentId; },
    open(agent, point) {
      const changedAgent = agentId !== agent.id;
      if (panel.hidden) {
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      if (changedAgent) {
        for (const row of rows) row.element.remove();
        rows = [];
        body.scrollTop = 0;
      }
      agentId = agent.id;
      at = { x: point.x, y: point.y };
      const wasHidden = panel.hidden;
      panel.hidden = false;
      render(agent);
      if (wasHidden || changedAgent) closeButton.focus({ preventScroll: true });
    },
    update(agent) {
      if (agentId === null) return;
      if (!agent) close();
      else if (agent.id === agentId) render(agent);
    },
    close,
  };
}
