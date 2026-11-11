import { basename, esc, money, pct, roleColor, tokens } from './format';
import { store } from './store';
import { ROLES, usage, type Spend } from './usage';

// Spend in the panels: the live counter in the top bar, the usage block of the unit card and the
// ledger (agents × roles, and models). Read-only views of usage.ts.

/** Money that fits a narrow table column: $3.22, $260, $1.6k. */
function short(s: Spend): string {
  const v = s.cost;
  const t = v < 10 ? `$${v.toFixed(2)}` : v < 1000 ? `$${Math.round(v)}` : `$${(v / 1000).toFixed(1)}k`;
  return s.complete ? t : `≥${t}`;
}

const cents = (usd: number) => `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The top-bar counter: total of current sessions, counting up as live frames arrive. */
export function mountCounter(el: HTMLElement) {
  el.innerHTML = '<small>spend · sessions</small><b></b><em></em>';
  const amount = el.querySelector('b')!, rate = el.querySelector('em')!;
  let shown = 0;
  let target = 0;
  let complete = true;
  let raf = 0;
  const drawRate = () => { rate.textContent = `+${cents(usage.rate())} · 5 min`; };
  const step = () => {
    shown += (target - shown) * 0.18;
    if (Math.abs(target - shown) < 0.005) shown = target;
    amount.textContent = `${complete ? '' : '≥ '}${cents(shown)}`;
    raf = shown === target ? 0 : requestAnimationFrame(step);
  };
  // The 5-minute figure drops as frames age out, with or without new ones.
  setInterval(() => { if (!el.hidden) drawRate(); }, 10_000);
  return {
    update() {
      el.hidden = usage.state !== 'ready';
      if (el.hidden) return;
      const t = usage.total();
      if (t.cost > target + 0.0001 && target > 0) {
        el.classList.remove('tick');
        void el.offsetWidth; // restart the animation
        el.classList.add('tick');
      }
      if (!target) shown = t.cost; // first load: no count-up from zero
      target = t.cost;
      complete = t.complete;
      drawRate();
      if (!raf) raf = requestAnimationFrame(step);
    },
  };
}

function roleBar(roles: Map<string, Spend>, total: number): string {
  if (total <= 0) return '';
  return `<div class="rolebar" aria-hidden="true">${ROLES.map((r) => {
    const c = roles.get(r)?.cost ?? 0;
    return c > 0 ? `<i style="width:${(c / total) * 100}%;background:${roleColor(r)}"></i>` : '';
  }).join('')}</div>`;
}

/** The unit card's usage block: cost of the current session, split by role and by model. */
export function usageBlock(agentId: string): string {
  if (usage.state !== 'ready') return '';
  const u = usage.agents.get(agentId);
  if (!u || (u.cost === 0 && u.tokens === 0)) {
    return `<div class="usage"><h3>SPEND · CURRENT SESSION</h3><p class="dim">${u?.session ? 'nothing spent in this session yet' : 'no session with usage'}</p></div>`;
  }
  const roleRows = ROLES.filter((r) => u.roles.has(r)).map((r) => {
    const s = u.roles.get(r);
    if (!s) return '';
    const names = [...s.names.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([n]) => n);
    const named = names.length ? `${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? ` +${names.length - 3}` : ''}` : '';
    return `<tr><td class="role"><i class="sw" style="background:${roleColor(r)}"></i>${r}</td><td class="nm" title="${esc(names.join(', '))}">${named}</td><td class="r">${tokens(s.tokens)}</td><td class="r m">${short(s)}</td></tr>`;
  }).join('');
  const modelRows = [...u.models.entries()].sort((a, b) => b[1].cost - a[1].cost)
    .map(([m, s]) => `<tr><td colspan="2">${esc(m)}</td><td class="r">${tokens(s.tokens)}</td><td class="r m">${short(s)}</td></tr>`).join('');
  const hours = usage.watched === agentId ? usage.hours : [];
  const peak = Math.max(...hours, 0);
  const spark = hours.length && peak > 0
    ? `<svg class="spark" viewBox="0 0 230 36" preserveAspectRatio="none" role="img" aria-label="Cost per hour over the last 24 hours"><polyline points="${hours.map((v, i) => `${(i * 230) / 23},${34 - (v / peak) * 30}`).join(' ')}" /></svg><small class="dim">last 24 h, per hour · peak ${money(peak)}</small>`
    : '';
  const unattributed = u.cost - [...u.roles.values()].reduce((n, s) => n + s.cost, 0);
  return `<div class="usage">
    <h3>SPEND · CURRENT SESSION <small title="${esc(u.session ?? '')}">${esc(basename(u.session).slice(0, 28))}</small></h3>
    <div class="tot"><b>${money(u.cost, u.complete)}</b><span>${pct(usage.share(agentId))} of spend · ${tokens(u.tokens)} tok</span></div>
    ${roleBar(u.roles, u.cost)}
    <table class="mini"><thead><tr><th>role</th><th></th><th class="r">tokens</th><th class="r">cost</th></tr></thead><tbody>${roleRows}${unattributed > 0.005 ? `<tr class="dim"><td colspan="3">live, not yet split</td><td class="r">${money(unattributed)}</td></tr>` : ''}</tbody></table>
    <table class="mini"><thead><tr><th colspan="2">model</th><th class="r">tokens</th><th class="r">cost</th></tr></thead><tbody>${modelRows}</tbody></table>
    ${spark}
  </div>`;
}

/** The ledger: every agent's current session split by role, then the models across all of them. */
export function ledger(selected: string | null): string {
  if (usage.state === 'unavailable') return '<p class="empty">This rostr has no usage API.</p>';
  if (usage.state === 'loading') return '<p class="empty">Loading usage…</p>';
  const total = usage.total();
  const rows = [...store.agents.values()]
    .map((a) => ({ a, u: usage.agents.get(a.id) }))
    .sort((x, y) => (y.u?.cost ?? 0) - (x.u?.cost ?? 0) || x.a.name.localeCompare(y.a.name));
  const models = new Map<string, Spend>();
  for (const { u } of rows) {
    for (const [m, s] of u?.models ?? []) {
      const t = models.get(m) ?? { cost: 0, tokens: 0, complete: true };
      t.cost += s.cost; t.tokens += s.tokens; t.complete &&= s.complete;
      models.set(m, t);
    }
  }
  const cell = (s: Spend | undefined) => `<td class="r">${s && s.cost > 0 ? short(s) : '<span class="dim">—</span>'}</td>`;
  return `<div class="ledger-head">
      <b>${money(total.cost, total.complete)}</b><span>current sessions · ${tokens(total.tokens)} tok</span>
    </div>
    <div class="ledger-roles">${ROLES.map((r) => `<span><i style="background:${roleColor(r)}"></i>${r}</span>`).join('')}</div>
    <table class="mini ledger-t">
      <thead><tr><th>agent</th>${ROLES.map((r) => `<th class="r" title="${r}"><i class="sw" style="background:${roleColor(r)}"></i>${r.slice(0, 3)}</th>`).join('')}<th class="r">total</th></tr></thead>
      <tbody>${rows.map(({ a, u }) => `<tr data-id="${esc(a.id)}" data-k="${esc(a.id)}" tabindex="0" class="${a.id === selected ? 'sel' : ''}${u && u.cost > 0 ? '' : ' none'}">
        <td class="nm" title="${esc(a.name)} · ${u ? pct(usage.share(a.id)) : '0%'} of spend">${esc(a.name)}</td>
        ${ROLES.map((r) => cell(u?.roles.get(r))).join('')}
        <td class="r m">${u && u.cost > 0 ? short(u) : '<span class="dim">—</span>'}</td></tr>`).join('')}</tbody>
    </table>
    <h3 class="sub">BY MODEL</h3>
    <table class="mini">
      <thead><tr><th>model</th><th class="r">tokens</th><th class="r">cost</th><th class="r">share</th></tr></thead>
      <tbody>${[...models.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([m, s]) => `<tr><td class="nm">${esc(m)}</td><td class="r">${tokens(s.tokens)}</td><td class="r m">${short(s)}</td><td class="r">${total.cost > 0 ? pct(s.cost / total.cost) : '—'}</td></tr>`).join('')}</tbody>
    </table>`;
}
