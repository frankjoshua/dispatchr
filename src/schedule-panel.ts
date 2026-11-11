import type { Schedule, ScheduleLocation } from './schedule-types';
import type { ScheduleClassification } from './schedule-rules';
import { classifySchedule, groupSchedules, scheduleCountdown } from './schedule-rules';
import './schedule-panel.css';

export interface UpcomingInput {
  schedules: readonly Schedule[];
  state: 'loading' | 'ready' | 'unavailable' | 'forbidden' | 'error';
  error: string | null;
  spaceSlugs: ReadonlySet<string>;
  navigableAgents: ReadonlySet<string>;
}

export interface UpcomingPanel {
  render(input: UpcomingInput): void;
  setAgent(id: string | null): void;
}

interface TargetControl {
  element: HTMLElement;
  navigable: boolean;
}

interface ScheduleRow {
  element: HTMLLIElement;
  schedule: Schedule;
  name: HTMLElement;
  space: HTMLElement;
  status: HTMLElement;
  purpose: HTMLElement;
  source: HTMLElement;
  targets: HTMLElement;
  targetControls: Map<string, TargetControl>;
  noTargets: HTMLElement;
  hiddenTargets: HTMLElement;
  nextLabel: HTMLElement;
  time: HTMLTimeElement;
  countdown: HTMLElement;
  freshness: HTMLElement;
  running: HTMLElement;
  info: HTMLElement;
}

const localTime = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
});
const localFractionalTime = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, timeZoneName: 'short',
});

function exactTime(value: string | null): string {
  if (value === null) return 'Not reported';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Not reported';
  return (date.getMilliseconds() === 0 ? localTime : localFractionalTime).format(date);
}

function locationText(location: ScheduleLocation): string {
  return `${location.label} (${location.kind})${location.ref ? ` · reference: ${location.ref}` : ''}`;
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

export function mountUpcoming(el: HTMLElement, onAgent: (id: string) => void): UpcomingPanel {
  el.classList.add('schedule-panel');
  const header = document.createElement('header');
  header.className = 'schedule-panel-header';
  const heading = document.createElement('h2');
  heading.textContent = 'Upcoming';
  const filter = document.createElement('p');
  filter.className = 'schedule-agent-filter';
  const filterLabel = document.createElement('span');
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = 'Show all agents';
  filter.append(filterLabel, clear);
  header.append(heading, filter);
  const notice = document.createElement('p');
  notice.className = 'schedule-notice';
  notice.setAttribute('role', 'status');
  const list = document.createElement('ol');
  list.className = 'schedule-list';
  list.setAttribute('aria-label', 'Upcoming and unconfirmed schedules');
  const paused = document.createElement('details');
  paused.className = 'schedule-paused';
  const pausedSummary = document.createElement('summary');
  const pausedList = document.createElement('ol');
  pausedList.className = 'schedule-list';
  pausedList.setAttribute('aria-label', 'Paused schedules');
  paused.append(pausedSummary, pausedList);
  el.append(header, notice, list, paused);

  let input: UpcomingInput | null = null;
  let agentId: string | null = null;
  const rows = new Map<string, ScheduleRow>();
  let pressedPointer: number | null = null;
  let queuedUpdate = false;

  function createRow(schedule: Schedule): ScheduleRow {
    const element = document.createElement('li');
    element.className = 'schedule-row';
    const title = document.createElement('div');
    title.className = 'schedule-row-title';
    const name = document.createElement('h3');
    const status = document.createElement('span');
    status.className = 'schedule-status';
    title.append(name, status);
    const space = document.createElement('p');
    space.className = 'schedule-space';
    const purpose = document.createElement('p');
    purpose.className = 'schedule-purpose';
    const next = document.createElement('p');
    next.className = 'schedule-next';
    const nextLabel = document.createElement('strong');
    const time = document.createElement('time');
    const countdown = document.createElement('span');
    countdown.className = 'schedule-countdown';
    next.append(nextLabel, time, countdown);
    const targetsLabel = document.createElement('p');
    targetsLabel.className = 'schedule-targets-label';
    targetsLabel.textContent = 'Target agents';
    const targets = document.createElement('div');
    targets.className = 'schedule-targets';
    const noTargets = document.createElement('p');
    const hiddenTargets = document.createElement('p');
    hiddenTargets.className = 'schedule-hidden-targets';
    const source = document.createElement('p');
    source.className = 'schedule-source';
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Schedule details';
    const freshness = document.createElement('p');
    const running = document.createElement('p');
    const info = document.createElement('pre');
    details.append(summary, freshness, running, info);
    element.append(title, space, purpose, next, targetsLabel, targets, noTargets, hiddenTargets, source, details);
    return {
      element, schedule, name, space, status, purpose, source, targets, targetControls: new Map(),
      noTargets, hiddenTargets, nextLabel, time, countdown, freshness, running, info,
    };
  }

  function updateData(row: ScheduleRow, schedule: Schedule, current: UpcomingInput): void {
    row.schedule = schedule;
    setText(row.name, schedule.name);
    setText(row.space, `Space: ${schedule.space_slug}`);
    setText(row.purpose, schedule.definition.summary);
    row.purpose.hidden = schedule.definition.summary === '';
    setText(row.source, `Source: ${schedule.source.kind} · Definition location: ${locationText(schedule.source.location)}`);
    const visible = schedule.agents.filter((agent) => schedule.execution.agent_ids.includes(agent.id));
    const ids = new Set<string>();
    for (let index = 0; index < visible.length; index++) {
      const agent = visible[index];
      ids.add(agent.id);
      const navigable = !agent.retired && current.navigableAgents.has(agent.id);
      let control = row.targetControls.get(agent.id);
      if (!control || control.navigable !== navigable) {
        const element = document.createElement(navigable ? 'button' : 'span');
        element.className = 'schedule-target';
        if (element instanceof HTMLButtonElement) {
          element.type = 'button';
          element.addEventListener('click', () => {
            if (input?.navigableAgents.has(agent.id) && !row.schedule.agents.find((target) => target.id === agent.id)?.retired) {
              onAgent(agent.id);
            }
          });
        }
        control?.element.replaceWith(element);
        control = { element, navigable };
        row.targetControls.set(agent.id, control);
      }
      const label = `${agent.name} · ${agent.space_slug}${agent.retired ? ' · retired' : ''}`;
      setText(control.element, label);
      if (navigable) control.element.setAttribute('aria-label', `Show ${agent.name} on the map`);
      const at = row.targets.children.item(index);
      if (at !== control.element) row.targets.insertBefore(control.element, at);
    }
    for (const [id, control] of row.targetControls) {
      if (ids.has(id)) continue;
      control.element.remove();
      row.targetControls.delete(id);
    }
    row.noTargets.hidden = visible.length > 0;
    setText(row.noTargets, schedule.hidden_agent_count > 0 ? 'No visible target agents' : 'No target agents');
    row.hiddenTargets.hidden = schedule.hidden_agent_count === 0;
    setText(row.hiddenTargets, `${schedule.hidden_agent_count} hidden target ${schedule.hidden_agent_count === 1 ? 'association' : 'associations'}`);
    const observation = schedule.observation;
    const last = observation?.last_run;
    const lines = [
      `Native rule: ${schedule.definition.native ?? 'Not reported'}`,
      `Rule timezone: ${schedule.definition.timezone ?? 'Not reported'}`,
      `Native source enabled: ${schedule.enabled === null ? 'Unknown' : schedule.enabled ? 'Yes' : 'No'}`,
      `Native source key: ${schedule.source.key}`,
      `Definition location: ${locationText(schedule.source.location)}`,
      `Execution placement: ${locationText(schedule.execution.placement)}`,
      `Observed at: ${exactTime(observation?.observed_at ?? null)}`,
      `Fresh until: ${exactTime(observation?.fresh_until ?? null)}`,
      '',
      last ? [
        'Last reported run:',
        `  Started: ${exactTime(last.started_at)}`,
        `  Finished: ${exactTime(last.finished_at)}`,
        `  Reported result: ${last.outcome ?? 'Unknown'}`,
        `  Exit code: ${last.exit_code ?? 'Not reported'}`,
        `  Executor: ${last.location ? locationText(last.location) : 'Not reported'}`,
      ].join('\n') : 'Last reported run: Not reported',
      '',
      `Source locator:\n${JSON.stringify(schedule.source.locator, null, 2)}`,
      `Metadata:\n${JSON.stringify(schedule.metadata, null, 2)}`,
    ];
    setText(row.info, lines.join('\n'));
  }

  function updateClock(row: ScheduleRow, evidence: ScheduleClassification, now: number): void {
    const labels = {
      running: `Running · ${evidence.runningCount}`,
      upcoming: 'Upcoming', due: 'Awaiting update', unconfirmed: 'Next run unconfirmed', paused: 'Paused',
    };
    setText(row.status, labels[evidence.kind]);
    row.status.dataset.kind = evidence.kind;
    const next = row.schedule.observation?.next_run_at ?? null;
    setText(row.nextLabel, evidence.kind === 'paused' ? 'Last reported next run'
      : evidence.nextState === 'unconfirmed' ? 'Next run unconfirmed · last reported time' : 'Next run');
    setText(row.time, exactTime(next));
    row.time.dateTime = next ?? '';
    row.time.title = next ?? '';
    setText(row.countdown, evidence.kind === 'paused' ? 'Native source disabled'
      : evidence.nextState === 'unconfirmed' ? 'Awaiting fresh source evidence'
      : evidence.nextRunAt === null ? 'Not reported' : scheduleCountdown(evidence.nextRunAt, now));
    setText(row.freshness, `Observation freshness: ${evidence.freshness}`);
    const count = row.schedule.observation?.running_count;
    setText(row.running, count === null || count === undefined ? 'Running count: Unknown'
      : evidence.freshness === 'fresh' ? `Running count: ${count}`
      : `Last reported running count: ${count} (${evidence.freshness}; not current evidence)`);
  }

  function refresh(dataChanged: boolean): void {
    if (!input) return;
    if (pressedPointer !== null) { queuedUpdate ||= dataChanged; return; }
    queuedUpdate = false;
    const current = input;
    const scrollTop = el.scrollTop;
    const focused = document.activeElement;
    const hadFocus = focused instanceof HTMLElement && el.contains(focused);
    filter.hidden = agentId === null;
    const targetName = agentId === null ? null : current.schedules.flatMap((schedule) => schedule.agents).find((agent) => agent.id === agentId)?.name;
    setText(filterLabel, targetName ? `Schedules targeting ${targetName}` : 'Schedules targeting the selected agent');
    let message = '';
    if (current.state === 'loading') message = 'Loading schedule inventory…';
    else if (current.state === 'unavailable') message = 'Schedule inventory is unavailable on this rostr API version.';
    else if (current.state === 'forbidden') message = 'Schedule inventory access is forbidden. Schedule space grants are separate from agent and computer grants.';
    else if (current.state === 'error') message = `Schedule inventory could not be refreshed${current.error ? `: ${current.error}` : '.'}`;
    const now = Date.now();
    const groups = groupSchedules(current.schedules, { spaceSlugs: current.spaceSlugs, agentId }, now);
    const showInventory = current.state === 'ready' || current.state === 'error';
    const present = new Set<string>();
    for (const [schedules, destination] of [[groups.actionable, list], [groups.paused, pausedList]] as const) {
      for (let index = 0; index < schedules.length; index++) {
        const schedule = schedules[index];
        present.add(schedule.id);
        let row = rows.get(schedule.id);
        if (!row) {
          row = createRow(schedule);
          rows.set(schedule.id, row);
          updateData(row, schedule, current);
        } else if (dataChanged) updateData(row, schedule, current);
        updateClock(row, classifySchedule(schedule, now), now);
        const at = destination.children.item(index);
        if (at !== row.element) destination.insertBefore(row.element, at);
        if (destination === pausedList && hadFocus && row.element.contains(focused)) paused.open = true;
      }
    }
    for (const [id, row] of rows) {
      if (present.has(id)) continue;
      row.element.remove();
      rows.delete(id);
    }
    list.hidden = !showInventory || groups.actionable.length === 0;
    paused.hidden = !showInventory || groups.paused.length === 0;
    setText(pausedSummary, `Paused (${groups.paused.length})`);
    if (current.state === 'ready' && present.size === 0) {
      message = current.schedules.length === 0 ? 'No schedules registered in your visible inventory.'
        : 'No schedules match the selected space or agent filters.';
    }
    notice.hidden = message === '';
    setText(notice, message);
    if (hadFocus && document.activeElement !== focused) {
      if (focused.isConnected) focused.focus({ preventScroll: true });
      else {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
    el.scrollTop = scrollTop;
  }

  clear.addEventListener('click', () => {
    agentId = null;
    refresh(false);
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  });
  el.addEventListener('pointerdown', (event) => { pressedPointer = event.pointerId; });
  const finishPointer = (event: PointerEvent) => {
    if (pressedPointer !== event.pointerId) return;
    setTimeout(() => {
      if (pressedPointer === event.pointerId) pressedPointer = null;
      refresh(queuedUpdate);
    }, 0);
  };
  window.addEventListener('pointerup', finishPointer);
  window.addEventListener('pointercancel', finishPointer);
  window.addEventListener('blur', () => { pressedPointer = null; refresh(queuedUpdate); });
  window.setInterval(() => {
    if (el.isConnected && el.getClientRects().length > 0 && document.visibilityState !== 'hidden') refresh(false);
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh(false);
  });
  filter.hidden = true;
  list.hidden = true;
  paused.hidden = true;
  notice.textContent = 'Loading schedule inventory…';
  return {
    render(next) {
      input = next;
      refresh(true);
    },
    setAgent(id) {
      agentId = id;
      refresh(false);
    },
  };
}
