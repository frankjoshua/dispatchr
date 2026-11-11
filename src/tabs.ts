// Where an agent's links open, so tabs do not pile up: one shared tab per kind of link (every agent's web
// terminal takes turns in it), or the agent's own tab once popped out (to drag to another window), used
// for that agent while it stays open.
//
// Tabs are reused by name, which keeps them related to dispatchr: the opened page could send dispatchr's
// tab elsewhere (it cannot read it). Links come from the agent's own computer (rostr's [links],
// http(s) only), so that is accepted; cutting the relation would make every open a new tab again.

/** Which tab a link opens in: the shared one for its kind, or the agent's own. */
export type Tab = 'shared' | 'own';
/** An agent's link: whose, which kind (`web`), and where it goes. */
export interface AgentLink { agentId: string; link: string; href: string; itemId?: string }

const own = new Map<string, Window>();
const keyOf = (agentId: string, link: string) => `${agentId}\n${link}`;
const tabName = (s: string) => `dispatchr-${s.replace(/[^a-z0-9_-]/gi, '-')}`;

/** Whether the agent's own tab for this link is open (opened from this page since it loaded). */
export function hasOwnTab(agentId: string, link: string): boolean {
  const w = own.get(keyOf(agentId, link));
  return !!w && !w.closed;
}

/**
 * Opens an agent's link from a click or tap (browsers allow it only then): in the agent's own tab when
 * asked or when it already has one open, else in the shared tab for that kind of link. Returns false
 * when the browser blocked it.
 */
export function openLink(l: AgentLink, tab: Tab): boolean {
  const key = keyOf(l.agentId, l.link) + (l.itemId ? `\n${l.itemId}` : '');
  if (own.get(key)?.closed) own.delete(key);
  const pop = tab === 'own' || own.has(key);
  const target = pop ? tabName(`${l.link}-${l.agentId}`) + (l.itemId ? encodeURIComponent(`/${l.itemId}`) : '') : tabName(l.link);
  const w = window.open(l.href, target);
  if (!w) return false;
  if (pop) own.set(key, w);
  w.focus();
  return true;
}
