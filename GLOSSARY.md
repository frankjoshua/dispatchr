# Glossary

The names for the parts of dispatchr, so people and code say the same thing. Use the generic word
(left); each theme draws it its own way (the table at the end).

## The world

- **Map** — the game view: every computer's ground, its agents and their effects. Drawn by the
  **engine** (`map.ts`) from the **world** (`world.ts`, the layout).
- **Computer** — a machine running a rostr node; one area of ground on the map (a **slab** each in the
  phone's column layout, joined by **bridges**).
- **Base** — a computer's central building, where working characters carry their work. Its
  **heartbeat** blinks when the node reports in.
- **Space** — a rostr space (e.g. personal, work); a fenced area on its computer's ground, with its
  name on a **sign**.
- **Team** — a lead and the agents who report to it, inside a space; drawn as a block with the lead's
  name on a strip. Teams nest.
- **Reporting line** — the arc from an agent to the agent it reports to. **Goods** travel up it while
  the reporting agent works.
- **Scenery** — trees, lamps, chickens, drones: decoration on free ground.

## An agent on the map

- **Place** — the agent's spot: its building, plot, instrument column or cubicle.
- **Stack** — how tall the place stands: how long the agent's current **run** has been working (grows
  while it works, holds while blocked, drops back when done).
- **Run** — one stretch of work, from starting to stopping (pauses while blocked).
- **Light** — how bright the place and character are: **recency**, the agent's rank among the others
  by when it was last active.
- **Character** — the agent's figure: robot, farmer, scientist, office worker. It **walks** to the base
  and back while working (a **trip**, carrying **goods**).
- **Helpers** — extra characters beside the place: the agent's subagents and advisors from the last
  hour or two.
- **Status icon** — over the character: dots (working), ! (blocked), ✓ (done), z (idle), MISSING.
- **Model character** — the graphic identity chosen from an agent's reported model: blue for Sol,
  orange for Opus, purple for Sonnet, green for GPT/Codex, burgundy and gold for Fable by default.
  Each has matching art in all four themes. **Settings → Model characters…** overrides these defaults
  with ordered model-name or wildcard rules, saved in this browser. Unreported models keep their
  runtime character; choosing a graphic does not change the model or its reported evidence.
- **Effort tier** — Cubicles' four visual effort levels: medium or lower (auto included), high, extra
  high, max. Chosen from rostr's reported selector, or its reported level when no selector is known;
  never inferred from activity or spend. Missing evidence uses the baseline look, not a claimed setting.
- **Effort block** — the fixed four-slot indicator beside a cubicle's desk, with one through four
  filled slots for its effort tier. It stays when the character walks away or sleeps. Working
  characters use matching concentration postures; alerts, rest and stopped states keep their own poses.
- **Short name** — an agent's name as the map, the units list and the loop bar show it: without a
  leading kind of change (`feat-`, `fix-`…) or a tracker ID, cut with `…` to fit, a copy number (`-2`)
  kept. The selected agent shows its whole name instead, on the map and in the units list.
- **Name plate** — a pill under the agent's character (or on the empty spot when asleep) with its short
  name; the selected agent's whole name, wrapped. Where plates overlap, the more important one is drawn
  on top.
- **Badge** — a token, artifact count or schedule count shown over the place (see Tokens and badges).

## Agent states

- **Working, blocked, idle, done, missing, offline** — rostr's status. **Blocked** means it needs you.
- **Recent** — among the most recently active: lit, and for the top eight, name plates on at any zoom.
- **Asleep** — idle or done and quiet for over an hour: only its place shows, no character. Only its own
  activity wakes it; selecting or looking at it does not.
- **Packed away** — quiet for over a week: off the map, counted on its computer's and space's labels;
  search and the lists still find it.
- **Needs you** — blocked: lit and awake whatever else. (An alarm badge calls for attention too, but
  over a quiet place: it does not make the agent look active.)

## Tokens and badges

- **Token** — a named piece of display data about an agent, reported by a plugin on its computer and
  relayed by rostr without interpretation: `{source, name, text}`, e.g. `mr_failed` "2376".
- **Badge rule** — the viewer's rule for showing tokens: which names (a pattern, optionally which
  source), icon, colour, urgency, or hide. Ruled tokens show over the agent's place; every token shows
  in its card. Rules live in the viewer's settings, not in the code.
- **Badge** — a token, artifact count or schedule count as its rule shows it: a **pill** (icon and text, or either alone) or, for an icon
  alone and for every iconed badge when zoomed far out, a **marker** (a round disc over the place,
  like a quest marker). Icons are dispatchr's own (`@comment`, `@review`…: names in `badges.ts`, art in
  `icons.ts`) or an emoji.
- **Urgency** — **alarm** (pulses, never packed away; the agent keeps its own light and sleep),
  **notice** (shown), **quiet** (only up close or in the card).
- **Artifact** — an agent-owned `{url, metadata}` pointer stored by rostr, independent of its pane.
  Its **artifact badge** is a clickable count with the same display and urgency choices as token badges.
  The **artifact chooser** lists its links, most recent first, and metadata; agents sharing a workspace keep separate lists.
- **Schedule** — a space-owned inventory record in rostr: a reported native trigger, definition
  location, execution placement, optional target agents and observation evidence. It is not an agent.
  Its **clock badge** counts visible associations for that agent, including paused schedules, and has
  the same configurable urgency and display choices as an artifact badge: quiet shows only up close.
  **Upcoming** is the chronological view; stale or missing evidence leaves its next run unconfirmed.

## Around the map

- **Top bar** — the HUD: the **spend counter**, the **counts**, **search**, **filter**, **settings** and
  the **live** badge.
- **Legend** — the illustrated key beside Fit on the map: the current theme's characters, effort
  postures and blocks, activity states and other marks. Opens without changing selection.
- **Selected agent** — the one agent last picked anywhere (its unit, place, name plate or badge, a list
  row, a search result, an event, a loop step), shown as selected everywhere at once: ringed and lit on
  the map, highlighted in the units list and the loop bar, its whole name on the map and in the list, in the URL as
  `#agent=<name>`. Selecting never opens the card.
- **Unit menu** — what a tap on a character, its place or its name plate opens, beside it (the agent is selected too): Show
  info, artifacts, Upcoming and agent links.
- **Shared tab** — the one browser tab each kind of link reuses (every agent's web terminal takes turns
  in it; **Open**). **Own tab** — an agent's tab of its own in the same window (**New tab**, or Shift +
  double-tap), used for all that agent's links while it is open.
- **Working loop** — the unlimited sequence of agents allowed by the space/tag filters. By default
  its **loop bar** shows only agents that need attention; Settings can switch it to all agents.
  There is no visit-history requirement. A direct jump puts its target after the current agent;
  Next, Previous and Fast forward preserve that order while traversing eligible stops. The strip
  scrolls by touch, trackpad or mouse wheel. **×** or middle-click hides a stop until revisited.
  Mode, order and dismissals survive page reloads.
- **Needs attention** — blocked, carrying a ruled alarm badge, or reported done, even if its character
  is asleep. Fast forward uses these same visible status facts within the working loop, skips the
  actual selected agent, and does not wake agents or change their status.
- **Card** — the selected agent's details, open only after Show info: who it reports to, folder, status,
  tokens, artifacts, spend, events.
- **Panels** — **Computers** and the **event log** (left), the **units** list, **Spend** and **Upcoming**
  (right); on a phone, tabs. The **units list** shows the agents on the map, most recently active
  first (spaces, teams and agents alike), dimmed like the map; its sections fold, each folds its
  **quiet** agents (at the map's dimmest) by default, and its headers and rows navigate the map.
- **Effects** — event reactions on the map: **embers** (spend landing), **rings** (a pick, a
  session), **beams** (a launch, a resume, a moved address, a new reporting line), **warp** (a launch),
  **flash** (an alert), **floats** (text). They play only while the map is being drawn, and each kind
  is a short queue (`effects.ts`).

## Under the hood

- **Theme** — a whole look: a palette (`theme.ts`) and, for painted themes, a **painter**
  (`painters.ts`: farm, lab, cubicles) that draws the ground, places, characters and scenery; the neon
  city is drawn by the engine itself.
- **Sprite** — a piece of art (`public/art/`); **shade** is a darkened copy for quiet agents.
- **Game rules** — pure, unit-tested functions over rostr's data: recency (`recency.ts`), runs and the
  stack (`runs.ts`, `stack.ts`), packing, sleep and ordering (`presence.ts`), teams (`teams.ts`),
  badges, attention and the working loop. `presence-state.ts` connects those rules to data and
  preferences for the map and panels.

## Per theme

| Generic | Neon city | Farm | Lab | Cubicles |
|---|---|---|---|---|
| Computer | island | farm | lab floor | office floor |
| Base | core | barn | bioreactor | print-and-coffee corner |
| Space | district | fenced field | glass-walled wing | department |
| Team | block | (fenced) team | bay | pod |
| Place | tower | crop plot | instrument column | cubicle |
| Stack | tower height | crop height | instruments stacked | paperwork pile |
| Character | robot | farmer | scientist | office worker |
| Missing | hologram robot | scarecrow | empty lab coat | empty chair with a jacket |
| Reporting line | light arc | dashed rope | tubing | dotted line |
| Buzz channel | roof antenna | mailbox | intercom | desk phone |
| Spend landing | embers | coins | golden drops | banknotes |
