# API gaps

What dispatchr needs from [rostr](https://github.com/frankjoshua/rostr) that its API (`openapi.yaml`
there, also served by every rostr server at `GET /openapi.yaml`) does not offer yet, with the
workaround in place. Each item is a proposal for rostr; dispatchr works around it until rostr ships it.

## 1. Viewers cannot see where an agent lives (pane, Buzz identity)

- **What:** a viewer token gets `GET /v1/agents/{ref}/contact` → 403 (`contact` needs member), and
  `GET /v1/agents` only returns `ChannelSummary` (`id, type, source, state`). So an observer cannot show
  an agent's pane (`w8E:p1`) or its Buzz identity, though both are in the event log it can read.
- **Why:** the observer's core view is "this agent, in this pane, on this Buzz channel". The address
  itself is not a capability; the commands (`display.commands`) and channel `config` are.
- **Shape wanted:** a display label on the summary, visible to viewers, without config or commands:

  ```yaml
  ChannelSummary:
    properties:
      id, type, source, state: …           # as today
      label: { type: [string, 'null'] }    # e.g. "w8E:p1 · dispatchr", "Buzz #ops"
  ```

- **Workaround:** dispatchr reads the label from the log: the pane from `address_changed` (herdr-pane
  `new.pane_id`, `new.herdr_name`) and `launched`/`resumed`/`renamed`/`adopted` (`pane_id`); the Buzz
  identity from `channel_added` and `channel_changed` (`config.identity`). It still calls `/contact` and uses its
  `display.text` when the token is allowed to.

## 2. No way to read the newest events first

- **What:** `GET /v1/events` only pages forward from `since`. To show the last N events (the feed, an
  agent's recent events), a client has to page the whole visible log from seq 0.
- **Why:** start-up time and traffic grow with the log (90 days by default) though the UI shows the
  last few hundred.
- **Shape wanted:** `GET /v1/events?before=<seq>&limit=N` returning the page that ends just before
  `before` (or the newest page without it), same `EventPage` shape plus `prev` to keep paging back;
  works with `agent=` and `space=`.
- **Workaround:** dispatchr pages from 0 (1000 per page) at start and keeps the newest 5000 in memory.

## 3. No "since when" on an agent's status

- **What:** `AgentView.status` has no timestamp. `/health` computes `running_since`/`missing_since`
  internally but the agent views do not expose them.
- **Why:** "working for 14 m", "missing for 2 h" is the first thing an observer asks.
- **Shape wanted:** `status_since: { type: [string, 'null'] }` on `AgentView` (time of the last status
  change, or of creation).
- **Workaround:** the `at` of the newest `status_changed` event for the agent in the loaded log; blank
  when there is none.

## 4. The event stream is held back behind a buffering proxy

- **What:** over HTTP/1.1, a TLS proxy in front of rostr may hold small SSE frames until a
  buffer fills (a fresh `GET /v1/stream?since=<last>` sends nothing for seconds; over HTTP/2, or once
  enough bytes are queued, the frames arrive at once). Vite's dev proxy speaks HTTP/1.1 only.
- **Why:** the map must react when an event happens, not when a buffer fills.
- **Shape wanted:** the stream response sets `X-Accel-Buffering: no` (honoured by nginx/openresty),
  and the deploy docs mention `proxy_buffering off` for `/v1/stream`.
- **Workaround:** the dev server forwards `/v1/stream` to an `https` rostr over HTTP/2
  (`vite.config.ts`).

## 5. Event payloads are untyped in the contract

- **What:** `Event.data` is `{ type: object, description: Type-specific }`.
- **Why:** a client reads `pane_id`, `new`/`old`, `to`, `config.identity`, `herdr_name`, `continued`…
  from the payloads; today those names come from reading the server and node code.
- **Shape wanted:** a `oneOf` (discriminated by `type`) of per-type data schemas, at least for
  `status_changed`, `launched`/`resumed`/`exited`/`renamed`, `address_changed`, `channel_*`,
  `session_recorded`, `node_*`.
- **Workaround:** dispatchr reads every payload field through guards (`src/data.ts`) and shows a
  generic line for anything it does not recognise.

## 6. Which session is current is not stated

- **What:** `AgentView.session_id` is null for most agents in practice, while
  `/v1/usage?by=session` shows the sessions they are spending in. Neither says which session is the
  agent's current one.
- **Why:** dispatchr shows the current session's spend; a finished session is cleared.
- **Shape wanted:** the session the node last saw in the agent's pane on `AgentView` (e.g.
  `current_session`), or `current: true` on usage rows grouped `by=session`.
- **Workaround:** the recorded `session_id` when there is one, else the session with the newest usage
  hour: the last 7 days in one query for all agents, then the whole retention, per agent, for agents
  idle longer (`src/usage.ts`).

## 7. A viewer's settings cannot follow them across devices

- **What:** dispatchr's settings (badge rules, theme, dimming, packing, sleepers) and the working loop's
  order live in each browser's storage. rostr has nowhere to keep a person's
  own preferences, and a viewer may only read.
- **Why:** people customize the game per person (which tokens show as badges, and how); doing it again
  on every device, and losing it with a cleared browser, defeats the point.
- **Shape wanted:** per-principal, per-app preferences: an opaque JSON document rostr never interprets,
  readable and writable only by its own principal, whatever their role (a viewer may write their own):

  ```yaml
  /v1/me/preferences/{app}:            # app: ^[a-z][a-z0-9_-]{0,31}$, e.g. dispatchr
    get:  → 200 { revision: integer, updated_at: string, value: object } | 404 (none saved yet)
    put:  body { value: object } (≤ 64 KiB as JSON), header If-Match: <revision> (absent: create only)
          → 200 { revision, updated_at, value } | 409 { revision, value } (someone saved first)
  ```

  Revisions make two devices safe: a client writes with the revision it last read, and a 409 returns
  the current document so it can merge or ask, never silently overwrite. Under a shared token every
  viewer shares one principal, so one document; per-person sign-in (Tailscale) gives each their own.
- **Workaround:** settings stay in the browser; ⚙ → Badges… exports and imports badge rules as JSON.
