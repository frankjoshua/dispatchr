# dispatchr guide

What every part of dispatchr shows and does. [GLOSSARY.md](../GLOSSARY.md) names the parts; the
[README](../README.md) says how to run it.

- **Map.** Each computer (rostr node) is a floating island; its core pulses with the node's heartbeat
  and the island dims and flickers when the node goes stale or offline. Each space is a district in
  its own colour. Each agent is a building with its unit standing in front:
  - working: lit, flickering windows, a crystal over the roof, the unit bobs and throws sparks;
  - idle: a few lit windows and a drifting `z`; blocked: gold light and a bouncing `!`;
  - missing: a flickering ghost in a red dashed ring; exited: dark building, the unit fallen over;
  - computer offline or disabled: greyed out.
  
  Each agent's **name plate** under its unit is a dark pill with its **short name** on one line: the
  name without a leading kind of change (`feat-`, `fix-`, `ci-`, `chore-`…) or a tracker ID
  (`868abcd0j`), cut with `…` if still too long, a copy number (`-2`) kept. The units list and the loop
  bar use the same short names. The selected agent shows its whole name on its plate and in the units
  list (the loop bar keeps short names, so it holds still), on the plate
  wrapped after dashes, underscores and other non-alphanumeric characters. Plates sit above the
  badges, and where they overlap the more important one is drawn on top (hovered, selected or blocked
  agents, then working, then recent, then the brightest); none is hidden for overlapping. A roof antenna is the agent's
  Buzz channel (waves while attached, amber blink while pending, red when down); the megaphone chip
  under the name plate shows its Buzz identity (and its pane, with the map-labels setting).
- **Legend (beside Fit on the map).** Opens a visual key for the current theme: character identities,
  desk-side and walking effort postures, effort-block levels, activity/status icons, helpers, asleep
  and packed-away agents, and the other map marks. It uses the same art and model/effort definitions as
  the map. Scroll for the explanations; Close, Escape or a tap outside dismisses it and restores
  focus without changing the selected agent. Keyboard focus stays inside while it is open.
- **Model characters.** All four themes follow reported model-family presets: Opus uses the orange
  identity, Sonnet purple, Sol blue, GPT/Codex green, and Fable burgundy and gold with silver hair
  (a crowned burgundy robot in Neon city). Unrecognized or unreported models keep the runtime's
  character; a provider or launcher is never treated as evidence of a model.
  In **Settings → Model characters…**, preview all five graphics, choose a reported model ID to add
  an exact rule, or enter a pattern with `*`. Choose its character and **Save and apply**: the map and
  open unit card update together, in every theme. Rules ignore case; without `/` they match the final
  model name, with `/` the whole provider-qualified ID. The first custom match wins; move rules up
  or down to change priority. **Runtime fallback** overrides a model preset with the runtime's
  character. **Reset to defaults** removes custom rules. Drafts do not change the map until applied.
  Choices are stored in this browser only; storage failure is reported as applying in this tab only.
  Another tab's saved change updates the map without replacing an open draft; **Reload saved rules**
  resolves the conflict before another save. Unknown model observations remain unknown in Show info.
- **Cubicles effort.** The chosen character keeps the same model identity at every effort tier.

  Working characters have increasingly focused desk-side and walking postures. Each cubicle also
  has a fixed four-slot **effort block**, visible while its character is on a trip or asleep:

  | Effort setting | Filled slots |
  |---|---:|
  | Medium, low, minimal, none/off, or auto | 1 |
  | High | 2 |
  | Extra high (`xhigh`) | 3 |
  | Max | 4 |

  A configured selector takes precedence over a reported level, so auto stays in the lowest visual
  tier even if a level is reported. Without a selector, the reported level is used. Missing or
  unrecognized observations also use the baseline appearance, not an invented effort value.
  **Show info** retains the raw model/provider, configured and reported effort, source and report time;
  unknown remains unknown there. No model or effort text is added to the map, and no wearable cue is
  used. Alert and stopped poses still take priority; idle/done characters keep their resting pose.
  Effort does not change status, stack height, recency, trip speed or sleep. Live observations update
  from rostr; session or pane replacement clears earlier evidence until a matching snapshot arrives.
- **Events.** The log on the left follows `GET /v1/stream`; the map replays each event as it arrives:
  a launch or resume beams the unit in from the computer's core, an exit or a failed launch flashes,
  status changes ring the unit, channel changes pulse the antenna, computers connecting or going
  stale ring the island. Big ones get a banner. A new reporting line beams up from the agent to its
  new manager. New or adopted agents enter the scene after their full API record is fetched; their
  event payload alone is not a complete agent record. Effects play only while the map is being drawn:
  what happens while the tab is in the background is in the log when you come back, not replayed.
- **Teams and reporting lines** (rostr's `reports_to`). In each district, an agent with reports leads
  a team: a fenced block (a railed patch on the farm) under its name, holding it and its direct
  reports; a report with reports of its own leads a block nested inside, as deep as the teams go.
  Agents in no team stand in the district's own rows. An arc joins each agent to the agent it reports
  to, in the manager's colour (a dashed rope on the farm); the selected or hovered agent's lines and
  team light up, and goods flow up a working agent's line.
  The units list has the same nested team sections under each space.
- **Units list.** The agents on the map, in the same order of recency: the space with the most
  recently active agent comes first, and inside it teams and agents most recent first (a team is as
  recent as its most recent member; its lead's name heads it, and the lead's own row sorts in with the
  rest). Each row is the agent's status as an icon (typing dots for working, a warning diamond for
  blocked, a tick for done, a z for idle…), its short name (the whole name, wrapping, when selected;
  the full name as a tooltip), and under it the badges the map shows over its
  place. Packed-away agents are left out, as on the map (counted in the header and per space; search
  still finds them), and rows dim with recency like the map's places. Each section ends with its
  **quiet** agents (at the map's dimmest: outside the most recent third) folded under "▸ N quiet"; a
  team counts as quiet when all its members are, and blocked or selected agents never fold. Every space
  and team folds with ▾/▸ on its header; both are remembered per browser. It navigates the map: a space
  or team name frames it, a tap on an agent selects it at once and then flies there, and a double tap
  opens its web terminal (Shift: its own tab). On a phone each switches to the map first. Double taps
  allow 500 ms between clicks; a single units-list tap waits that window before flying so it can
  distinguish a double tap.
  Ordinary badge pills and row padding belong to the agent's click target; artifact counts are separate
  buttons opening the chooser. Row contents stay stable during a press or double-tap window, then
  apply any queued live updates. Unchanged rows are not replaced, and interactive row/canvas clicks
  do not select text.
- **Selected agent.** Tap an agent anywhere and it is selected: its unit, place, name plate or badge on
  the map, its row in the units list, a search result, an event in the log, a row in Spend or a target
  in Upcoming, or a step round the working loop. Picking from a list or the log also flies the map
  there, and the camera keeps the agent in frame as the map changes around it until you move the
  camera. The selected agent is the same everywhere at once: ringed and lit on the map (an asleep one stays asleep), its row
  in the units list and its place in the loop bar highlighted (the list scrolls to it), its whole name
  on its plate and its row, and its name in the URL (`#agent=<name>` selects it on load). Selecting never
  opens the unit card. A tap on open ground, or `Esc` with nothing else open, clears it.
- **Unit menu.** Tap or click a unit, its place or its name plate on the map: it is selected and a small menu opens
  beside it: **Show info** (the
  unit card) and the agent's links (rostr's `links`: its computer fills them from the `[links]`
  templates in its config, e.g. `web` → that agent's pane in a web terminal). **Double-tap** (or
  double-click) a unit to open its web terminal straight away. Known link names get a label and icon
  (Web terminal, Terminal, Code, SSH, Files); others are shown as written. The card's **Open** row has
  the same. A `links_changed` event moves them at once when the agent's pane moves. dispatchr only
  shows links: what they open, and who may use it, is up to the computer.
  Links open without piling up tabs. Each link has two buttons: **Open** uses the one **shared tab** for
  its kind (open another agent's web terminal and the same tab switches to it), and **New tab** gives
  the agent its **own tab** in the same window, to keep or drag elsewhere (the button then reads "Its
  tab"). While an agent's own tab is open, all its links go there; close it and they go back to the
  shared tab. A click on the link itself is Open; **Shift + double-tap** on the map is New tab; Ctrl/Cmd-
  or middle-click is still the browser's own new tab. Reusing a tab keeps it
  related to dispatchr, so the page it shows could send dispatchr's tab elsewhere (it cannot read it);
  links come from your computers' rostr config and are http(s) only.
- **Unit card.** **Show info** in a unit's menu, or `I` with an agent selected, opens it; while open
  it shows the selected agent (pick another and it follows). ✕, `I` or `Esc` closes it and keeps the
  selection; a tap on open ground closes it and clears the selection. On a phone it is a bottom sheet,
  and an agent flown to stays in frame above it. It shows who the agent reports to and its team
  (one tap to either), folder, kind, space, computer, pane, session, launch profile and policy,
  channels and the agent's recent events. A manager you may not see reads “an agent in a space you
  can't see”; a person or a retired agent is named.
- **Camera.** **Fit** or `F` zooms as close as the agents (places, units, the names and badges drawn
  at that zoom) and the computers' bases allow, with an 8px border; bare ground, island edges and
  computer labels may crop. Small maps can zoom beyond 1.25; a large one can fit below the usual
  furthest zoom, which the wheel and pinch then keep as their limit. Picking a space or team frames
  its whole area, above the loop bar and the card. Wheel or pinch zooms, drag pans.
- **Search (labelled in the top bar; `/`, `Ctrl+K` or `⌘K`).** The desktop button shows its keyboard
  hint; phones keep the label and a larger touch target. Each shortcut opens and focuses the search
  field; `Ctrl+K` / `⌘K` also work while editing, and keep an already-open query. `/` does not interrupt
  typing in inputs, textareas or editable content. Escape closes search and restores focus.
  Type any part of a name or its herdr label, ignoring case. Spaces, dashes, underscores, dots and
  slashes separate search fragments; every fragment must match, in any order. For example, `ci sp`
  or `peed` finds `chore-ci-speed-improvements`. Every matching agent is listed, most recently
  active first (working agents are active now; ties by name), regardless of where the name matches.
  With nothing typed it lists all agents in that same order. Long result lists scroll while the
  search field stays visible; arrow keys choose a result and keep it in view.
  Enter or clicking its name opens its web UI, reusing the shared web tab (or that agent's own tab
  if already open), selects the agent and flies the map to it. The secondary **Select** button selects
  and flies without opening a tab, menu or info card. Both actions update navigation order and bring
  back a packed-away agent. Agents with no web UI link show that explicitly; only Select is available.
- **Working loop (`.` Next, `,` Previous, `>` Fast forward).** Navigation has no agent limit and no
  visit-history requirement. In **Settings → Navigation: only agents needing attention** (on by
  default), the bar lists done, blocked and ruled-alarm agents. Turn it off to navigate all agents
  allowed by the current space/tag filters. Unvisited, long-quiet and packed-away agents are included;
  choosing a packed-away agent brings its place back. If none need attention, the bar says so.

  A direct jump from anywhere in dispatchr inserts the target immediately after the current agent,
  preserving everyone else's relative order: from A in `A B C D`, choosing C gives `A C B D`.
  Next, Previous and Fast forward traverse the sequence **without reordering**. In attention-only
  mode they skip ordinary working/idle agents. If the selected agent stops needing attention, steps
  continue from its place in the underlying sequence rather than restarting at the first agent.
  A selection alone still does not open a web tab or info card.

  Each chip has a short name above its badges. Swipe the strip horizontally on touch, use a
  trackpad's horizontal scroll, or roll the mouse wheel over it. The scrollbar is available on
  desktop. Live updates wait out a press/swipe and preserve the viewed position; they do not snap
  back to the selected chip. Choosing a different agent reveals it in the strip. Next/Previous
  controls stay fixed outside the scrolling list.

  **Fast forward** goes round to the next agent that is blocked, has a ruled alarm badge, or has the
  reported **done** state shown by its check mark, in either mode. Sleep or missing activity history
  does not suppress it, and navigation never wakes agents. The selected agent is skipped; with no
  selection it can reach the sole waiting agent. The count, enabled state and tooltip use these same
  candidates. **×** or middle-click explicitly hides an agent until you visit it again, in either mode.
  A chip tap or navigation step opens its web terminal and flies there; badge buttons open what they
  count instead. Fit frames above the bar. The mode, preferred order and dismissals are remembered
  per browser (API-GAPS.md #7); agents that no longer exist leave the order.
- **Spend** lives in the panels, not the skyline. Advisor, subagent and helper usage count toward the
  agent that ran them. The current session is the one rostr recorded for the agent, else the session
  with the newest usage. Each live `usage` frame sends embers into the agent's roof and ticks the
  counter in the top bar (total, plus the last five minutes). The
  unit card splits it by role (with advisor and subagent names) and by model, with the last 24 hours
  per hour; the **Spend** view lists every agent by role and every model. Costs rostr could not price
  read “≥”.
- **Height** is how long the agent's current run has been working (rostr's `status_changed`): its
  building, crop or stack grows while it works, quickly at first and on a log scale to full height
  after an hour, holds while it is blocked (the run goes on if it resumes), and drops back to a stub
  when it is done, idle or stops. So what stands up on the map is what is working, and for how long.
- **Recency.** How recently each agent was active, ranked against the other agents on the map rather
  than the clock, sets its light: whatever was active most recently is bright, minutes or days ago,
  and one agent busy right now does not push the rest down. Active means working now, starting or
  ending a turn, or spending tokens (to the hour, from the usage of the last week, which covers agents
  whose status herdr only guesses). The most recent are full brightness, grading down through the
  most recent third; the rest are dim. Agents active within ten minutes of each other rank together,
  so if all were active about as recently, none dims. The eight most recent keep their names on at
  any zoom. A dim
  agent's building or crop and its unit darken and its reporting line fades. In the city that is night
  falling on quiet towers; the farm's bright grass would hide that, so there the whole farm sits in
  shade, quiet plots go darker than the ground and the most recent stand in a pool of sunlight.
  Blocked, selected and hovered agents stay lit.
- **Packed away.** Agents quiet for over a week leave the map (the computer and space labels count
  them: “· 14 packed away”), unless blocked; the lists, counts and search still have them, and finding
  or picking one brings it back for the visit.
- **Asleep.** An idle or done agent quiet for over an hour shows only its place: its character, with
  its status and helpers, has gone home, so the characters on the map are the ones up and about. A
  name, if it has one showing, stays on the empty spot. Selecting, hovering or finding it does not wake
  it: only its own activity does (starting work, spending). Blocked agents never sleep.
- **Helpers.** The subagents and advisors an agent ran this hour or last (rostr's usage by role and
  name) stand around its building or plot, busy while it works and at rest otherwise, up to three,
  busiest first, named once you zoom in or select the agent. The other agent kinds' characters play
  them, so they show even when every agent is omp: a subagent is the Claude or Codex robot, farmer,
  scientist or office worker (fixed by its name), an advisor the pi one.
- **Badges.** Plugins on an agent's computer report **tokens** for it (display data such as a merge
  request's state, a task's title, the last prompt); rostr relays them uninterpreted from the agent's
  herdr workspace (source `herdr-workspace`) and pane (`herdr-pane`), and dispatchr
  shows them by **badge rules** each viewer writes in ⚙ → Badges…: a token name pattern (`mr_failed`,
  `ci_*`), an icon, a colour, an urgency, what to show, or hide. Icons are dispatchr's own game icons
  (alert, comment, review, merge, check, cross, draft, running, clock, bell, flag, star, lock, person, artifacts;
  drawn crisp at any zoom) or any emoji. A rule shows **icon + text**, the **icon** alone or the
  **text** alone: an icon alone, and any badge with an icon when zoomed far out, becomes a round
  marker over the place in the rule's colour, like a quest marker. Badges stack in a column over the
  agent's place, up to three, most urgent at the top: **alarm** pulses (a marker sends out rings) and keeps the agent on
  the map (never packed away), but does not light it or wake its character, so a failing MR on an idle
  pane is a loud marker over a quiet place; **notice** always shows, **quiet** shows from zoom 0.75 or when
  the agent is looked at. The first matching rule wins; tokens without a rule show only in the agent's
  card. The editor lists the tokens your agents carry (a tap adds a rule), offers presets (merge
  requests), and shares rules as JSON. Token rules are kept per browser and site address; none ship by
  default. The editor reports whether a change was saved. Invalid drafts and failed storage writes
  leave saved rules intact; an edit in another tab prompts **Reload saved rules** rather than
  overwriting it. Artifact and schedule changes save independently of token rules. Export the JSON
  before changing browsers or clearing site data: settings do not yet sync through rostr (API-GAPS.md #7).
  Agents in one herdr workspace all carry its tokens: on the map those show once, on the oldest of
  them; each pane's own tokens stay on its agent. `tokens_changed` events update badges at once and
  show in the event log as quiet lines.
- **Artifacts.** rostr's agent-owned `{url, metadata}` records appear as a clickable count in the same
  badge stack and units-list badge line. In ⚙ → Badges… → Artifacts, choose its icon, colour, urgency
  (quiet, notice or alarm), icon + text / icon / text, or hide. The default is a notice with its icon and
  count; an empty list has no badge. Alarm artifacts bounce and prevent packing, without changing
  the agent's activity, light or sleep. One map-stack row stays available for the clickable count.
  Tap it for the artifact chooser: titles (a string `metadata.title`, else the URL's filename or host),
  links most recent first (by a `metadata.updated_at` time, newest first; any without one after, the
  last added first), and expandable metadata. **Open** reuses an artifact-viewing tab; **New tab**
  keeps that artifact in its own tab. The unit menu and card also open the chooser; Escape, outside
  tap or its close button dismisses it. Changes update the count and open chooser through
  `agent_changed`. Lists remain separate for agents sharing a workspace. dispatchr neither fetches
  nor embeds content; only absolute http(s) URLs are opened, and their targets decide access.
- **Upcoming.** The right-panel and phone tab lists rostr's independent, space-owned schedule inventory,
  ordered across agents by reported next-run time (unknown times last). Each entry shows its name,
  purpose, exact viewer-local time and countdown, visible target agents, and definition source/location.
  Expand **Schedule details** for the native rule and timezone, execution placement, observation age,
  last reported result, locator and metadata. Native cron/systemd expressions are never interpreted.
  Stale or unknown evidence says **Next run unconfirmed** instead of promising a run; a fresh past
  timestamp says the due time passed and awaits an update, not that execution failed.
  Paused schedules collapse below the list, except disabled schedules with fresh in-flight runs stay
  visible as running. Freshness and countdowns update without needing a new event. A clock/count badge
  on an agent's place and units-list row opens Upcoming filtered to its associations; **Show all
  agents** or the Upcoming tab restores the global list. In ⚙ → Badges… → Schedules, choose quiet
  (only up close, at the same zoom as other quiet badges), notice (always shown), alarm, icon, colour,
  display or hide. Choices are remembered per browser; quiet only changes map visibility, not access
  through the units list, menu, card or Upcoming. Alarms prevent packing without making the agent
  active. Counts include paused associations, never imply agent activity, and a schedule may target
  multiple agents or none. Target buttons select live
  agents and centre them on the map without opening their menu. Space filters apply to the schedule's owning space;
  agent tags do not hide independent schedules. `schedule_created`/`schedule_changed`, reconnects and a
  slow poll refresh records. Access denial, older APIs and failed loads remain distinct from an empty
  inventory. dispatchr does not discover, configure or execute schedules; empty means none registered
  for this viewer, not that the computer has no timers or cron jobs.
- **Art and life.** Robots, farmers, crops, the computers' cores and barns, trees, lamps and textures are
  generated sprite art (`public/art/`). A working unit walks back and forth between its building and
  its computer's core (the base; the barn on the farm), finding its way around the buildings, carrying
  a data cube or a sheaf of its crop out and walking back empty; when it stops working it walks home.
  On a phone the slabs are joined by bridges. Drones and
  little cars move through the city, chickens and birds through the farm, whose light follows the
  viewer's clock (dusk glow, then night with fireflies and lit barns). The camera sweeps in on load.
- **Filter (funnel beside ⚙)**, remembered per browser: choose spaces and agent tags to focus on. Any
  of the chosen spaces, any of the chosen tags, and both when both are chosen. Whatever does not pass
  acts as if it did not exist: its units, districts and computers leave the map (no empty spaces or
  islands), and the units list, counts, spend, event log and map effects leave it out too. A pill on the
  map says what is filtered, with ✕ to clear it.
- **Settings (⚙ in the top bar)**, remembered per browser: the theme; *pane ids on the map* (off by
  default); *dim agents that have been quiet longest* (on; see Recency); *pack away agents quiet for
  over a week* (on; see Packed away); *hide characters of agents asleep over an hour* (on; see
  Asleep); *Badges…*, the badge rule editor (see Badges); and *Model characters…* (see Model characters).
- **Themes.** *Neon city* is the look above.
  *Farm* turns each computer into a grassy farm with a red barn (its hayloft lamp is the heartbeat),
  each space into a fenced field with a sign, and each agent into a plot of crops tended by a
  farmer: corn for omp, sunflowers for Claude Code, wheat for the rest, growing while the agent works
  (see Height). Working farmers swing their hoes and their crops rustle; a missing agent's farmer is a
  scarecrow; an exited one lies down and the crops wither. Live spend flies in as coins, and Buzz
  is a mailbox with its flag up while attached. The panels turn to parchment and wood.
  *Lab* turns each computer into a bright lab floor with a bioreactor (its lid lamp is the heartbeat),
  each space into a glass-walled wing and each team into a bay. Each agent is a column of lab
  instruments, stacking up while it works, and a scientist using the selected model character,
  sitting with coffee when idle or done, waving a red paddle under a red beacon when blocked. A missing
  agent's scientist is an empty lab coat on a stand. Reporting lines are tubing, Buzz is an intercom,
  and live spend flies in as golden drops.
  *Cubicles* turns each computer into an office floor with a print-and-coffee corner, each space into
  a department and each team into a pod. Each agent is a cubicle whose paperwork piles up while it
  works, and an office worker using the selected model character, jumping and waving under a red
  flag and warning light when blocked. A missing agent is an empty chair with a jacket over it. Buzz is
  a desk phone that rings while pending, and live spend flies in as banknotes. Red is kept for blocked:
  neither theme gives a space a red, pink or orange colour.
- **Folding.** The side panels fold to a thin rail (the ◂/▸ buttons, or `[` and `]`); the event-log
  rail counts events that arrived while it was folded. The unit card folds to its header (▾), on the
  phone too, where it is a bottom sheet. The browser remembers what is folded.
- **Phone.** The map stacks districts down the screen; units, spend, Upcoming and the event log are tabs; the
  unit card is a bottom sheet. The map pauses its drawing while a tab covers it.
- **Keyboard.** Besides the shortcuts above, rows in the event log and in Spend take focus and fly to
  their agent on Enter or Space; focus stays where it was when a panel redraws; and while Settings,
  Filter, Badges or Model characters is open, `Esc` closes just that.
