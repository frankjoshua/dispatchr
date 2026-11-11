import { EFFORT_ART, WORKER_ART } from './cubicles';
import { esc, statusIcon, statusOf } from './format';
import { CHARACTERS, MODEL_PRESETS, EFFORT_TIERS } from './inference';
import { characterSettings } from './character-settings';
import { painterFor } from './painters';
import { THEMES, theme } from './theme';
import './legend.css';

const ART = `${import.meta.env.BASE_URL}art/`;
const image = (name: string, alt = '') => `<img src="${ART}${esc(name)}.webp" alt="${esc(alt)}" decoding="async">`;

const STATES = [
  { status: 'working', label: 'Working', text: 'Taking a turn. Trips between the desk and copier (or the theme’s base) are normal work, not higher effort.' },
  { status: 'blocked', label: 'Blocked · needs you', text: 'Needs attention. The alert or waving pose takes priority over the effort posture.' },
  { status: 'done', label: 'Done', text: 'Finished its turn. Fast forward finds other done agents in your working loop even when asleep; looking at them does not wake them.' },
  { status: 'idle', label: 'Idle', text: 'No turn running. Resting characters keep their normal pose. In Cubicles, a desk block still shows the configured effort.' },
  { status: 'missing', label: 'Missing', text: 'rostr expects an agent that was not found. A stand-in or ghost is different from an idle agent.' },
  { status: 'exited', label: 'Exited', text: 'The process ended. Its stopped or fallen-over appearance is a status cue, not low effort.' },
  { status: 'node_offline', label: 'Computer offline', text: 'The computer is offline, so its floor and agents are dimmed. This is not an effort setting.' },
  { status: 'disabled', label: 'Disabled', text: 'The agent is disabled. Its greyed appearance is separate from its model or configured effort.' },
  { status: 'unknown', label: 'Unknown', text: 'No reliable status was reported. Model and effort observations may also be unknown; Show info keeps those distinctions.' },
] as const;

export function mountLegend(trigger: HTMLElement): { open(): void } {
  const dialog = document.createElement('dialog');
  dialog.id = 'legend-dialog';
  dialog.className = 'legend-dialog';
  dialog.setAttribute('aria-labelledby', 'legend-title');
  dialog.setAttribute('aria-describedby', 'legend-context');
  dialog.innerHTML = `<header class="legend-header"><div><h2 id="legend-title">Map legend</h2><p id="legend-context"></p></div><button type="button" class="legend-close" aria-label="Close legend">×</button></header><div class="legend-body" tabindex="0" role="region" aria-label="Legend entries"></div>`;
  document.body.append(dialog);
  const body = dialog.querySelector<HTMLElement>('.legend-body')!;
  const context = dialog.querySelector<HTMLElement>('#legend-context')!;
  const closeButton = dialog.querySelector<HTMLButtonElement>('.legend-close')!;
  let returnFocus: HTMLElement | null = null;

  function render() {
    const office = theme.id === 'cubicles';
    const painter = painterFor(theme.id);
    context.textContent = `${THEMES.find((entry) => entry.id === theme.id)!.label} · characters, effort and activity`;
    const cast = CHARACTERS.map((entry) => ({
      ...entry,
      defaults: MODEL_PRESETS.filter((preset) => preset.kind === entry.id).map((preset) => preset.label).join(', '),
    }));
    const assignments = characterSettings.rules.length
      ? `<p class="legend-note">Your custom assignments, first match wins:</p><ol>${characterSettings.rules.map((rule) => `<li><code>${esc(rule.pattern)}</code> → ${esc(rule.character === 'runtime' ? 'Reported runtime' : CHARACTERS.find((entry) => entry.id === rule.character)!.label)}</li>`).join('')}</ol>`
      : '<p class="legend-note">No custom assignments. Choose Model characters… in Settings to override the defaults.</p>';
    const models = `<section aria-labelledby="legend-cast-title"><h3 id="legend-cast-title">Characters · graphics and defaults</h3><div class="legend-cast">${cast.map((entry) => `<figure>${image(painter?.unitArt(entry.id, entry.id) ?? `n_robot_${entry.id}`)}<figcaption><strong>${esc(entry.label)}</strong><span>${office ? `${esc(entry.appearance)} · ` : ''}Default: ${esc(entry.defaults)}</span></figcaption></figure>`).join('')}</div><p class="legend-note">These five graphic identities have matching robots, farmers, scientists and office workers. Custom model assignments apply across every theme before the built-in model presets. Unreported or unmatched models keep the reported runtime’s character; an unknown runtime uses the blue character. An explicit Runtime rule bypasses model presets. A face is not a model guarantee: Show info has the exact reported identifier.</p>${assignments}</section>`;
    const efforts = office ? `<section aria-labelledby="legend-effort-title"><h3 id="legend-effort-title">Effort · posture + desk block</h3><p class="legend-note">Examples use the blue-shirt worker. The same tiers apply to the whole office cast.</p><table class="legend-effort"><thead><tr><th scope="col">Setting</th><th scope="col">Desk / trip</th><th scope="col">Desk block</th></tr></thead><tbody>${EFFORT_TIERS.map((entry) => `<tr><th scope="row"><strong>${esc(entry.label)}</strong>${entry.tier === 0 ? '<small>Medium, low, minimal, none/off and auto</small>' : ''}</th><td><div class="legend-poses"><figure>${image(WORKER_ART.omp.desk[entry.tier], `${entry.label}, desk-side posture`)}<figcaption>Desk</figcaption></figure><figure>${image(WORKER_ART.omp.walk[entry.tier], `${entry.label}, walking posture`)}<figcaption>Trip</figcaption></figure></div></td><td><div class="legend-block">${image(EFFORT_ART[entry.tier])}<span>${entry.tier + 1} ${entry.tier === 0 ? 'slot' : 'slots'}</span></div></td></tr>`).join('')}</tbody></table><p class="legend-note">The desk block stays when the character walks away or sleeps. Effort changes posture, not walking speed. Auto, unreported and unrecognized settings share the baseline look; unknown is still unknown in Show info.</p></section>` : '';
    const states = `<section aria-labelledby="legend-state-title"><h3 id="legend-state-title">What they’re doing</h3><dl class="legend-states">${STATES.map((entry) => `<div><dt><span class="legend-status" style="--s:${statusOf(entry.status).c}" aria-hidden="true">${statusIcon(entry.status)}</span>${esc(entry.label)}</dt><dd>${esc(entry.text)}</dd></div>`).join('')}</dl></section>`;
    body.innerHTML = `${models}${efforts}${states}<section aria-labelledby="legend-quiet-title"><h3 id="legend-quiet-title">When the character disappears</h3><dl class="legend-terms"><div><dt>Asleep</dt><dd>Idle or done and quiet for over an hour, with Hide asleep characters enabled: only its place remains. Selecting it does not wake it. In Cubicles, its effort block stays visible.</dd></div><div><dt>Packed away</dt><dd>Quiet for over a week, with Pack away enabled: off the map. Search still finds it and brings its place back.</dd></div></dl></section><section aria-labelledby="legend-marks-title"><h3 id="legend-marks-title">Other marks</h3><dl class="legend-terms"><div><dt>Small characters · helpers</dt><dd>Smaller figures beside a desk show advisors, subagents or other helper activity recorded in usage. Their appearance does not identify the main agent’s model or effort.</dd></div><div><dt>Highlight / brightness</dt><dd>The highlight is selection; brightness follows recent activity. Neither is an effort setting.</dd></div><div><dt>Stack height</dt><dd>Follows the current working run. Paperwork, buildings or crops are separate from the effort block.</dd></div><div><dt>Badges</dt><dd>Token, artifact and schedule marks above a place. Your badge rules choose their icon, color and urgency in Settings → Badges.</dd></div><div><dt>Megaphone chip</dt><dd>The agent’s Buzz identity, not its model or effort.</dd></div></dl></section>`;
    body.insertAdjacentHTML('beforeend', `<section aria-labelledby="legend-navigation-title"><h3 id="legend-navigation-title">Navigation</h3><p class="legend-note">By default, the bottom strip shows every done, blocked or ruled-alarm agent—no eight-agent limit or visit-history requirement. In Settings, turn off “Navigation: only agents needing attention” to show all agents allowed by your space/tag filters. Swipe horizontally, scroll a trackpad or use the mouse wheel over the strip. Fast forward always seeks attention; Next and Previous follow the current mode. × hides an agent until you visit it again.</p></section>`);
  }

  function close() { if (dialog.open) dialog.close(); }
  closeButton.addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.target === dialog) close();
  });
  // Keep Escape and focus wrapping out of the map's window-level shortcut handlers.
  window.addEventListener('keydown', (event) => {
    if (!dialog.open || event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    } else if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const targets = [...dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]')]
        .filter((element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0);
      const first = targets[0], last = targets.at(-1), active = document.activeElement;
      if (!dialog.contains(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        (event.shiftKey ? last : first)?.focus({ preventScroll: true });
      }
    }
  }, true);
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  });
  theme.onChange(() => { if (dialog.open) render(); });

  return {
    open() {
      if (dialog.open) return;
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : trigger;
      render();
      body.scrollTop = 0;
      dialog.showModal();
      trigger.setAttribute('aria-expanded', 'true');
      closeButton.focus({ preventScroll: true });
    },
  };
}
