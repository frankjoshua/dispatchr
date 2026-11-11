# CLAUDE.md — dispatchr

The game-like observer UI for rostr. Read `README.md` first; `GLOSSARY.md` names every part of the
game. Use those names in code, docs and conversation.

- dispatchr is a pure API client: everything comes from rostr's REST API (`openapi.yaml` in a rostr
  checkout, `../rostr` here) and `GET /v1/stream`. Never call herdr, agents or Buzz directly, never
  read rostr's database.
- An API gap is a rostr change, never a private workaround: record it in `API-GAPS.md` (what, why, the
  shape wanted). With a rostr checkout, add it there (with its test and the OpenAPI entry), then use
  it here.
- Show only what rostr knows: agents, computers (nodes), spaces, channels, status, events, usage. Game
  mechanics (levels, goals, streaks, achievements, celebrations) are derived from that data, never
  invented or stored anywhere else.
- Test against a throwaway rostr (`../rostr/test/harness/run --shell`), never against the live
  server's write endpoints.
- This is open source: no hostnames, tokens or people in committed code, fixtures or screenshots.

## Direction

dispatchr is becoming a polished, AAA-feeling game that makes work fun: a productivity tool you want to
open. The owner uses it every day, so it gets there in steps, never a big-bang rewrite: each step ships,
keeps working, and leaves room for new features alongside. The rough path: target frames (what the
finished game looks like) → pick the game loop (which mechanics) → a vertical slice at full polish →
carry it across the rest.

Every change moves the codebase toward that, so leave each part more solid than you found it:

- **Layers.** Data (store, usage) → game rules (pure functions over that data: runs, recency, packing,
  helpers, badges, progression) → engine (scene, camera, animation, rendering; knows nothing about
  rostr) → presentation (themes: palette, sprites, painters) and the DOM panels. Rules never draw;
  the engine never fetches.
- **Testable.** Game rules are pure modules with unit tests (`recency.ts` is the model). New rules
  come with tests; untested rules get them when touched.
- **Fast engine.** 60 fps on a phone is the bar. Per-frame code allocates nothing it can keep, and
  every visual effect is measured on a throttled phone view before it ships. GPU rendering (WebGL) is
  the expected destination for the look; keep the renderer behind `MapView` so it can be swapped.
- **Bounded.** The tab stays open for days, mostly in the background, where browsers stop animation
  frames while events keep arriving. Nothing kept for the life of the tab may grow without bound:
  queues have a cap, and per-agent state goes when the agent does.
- **Expandable.** Themes, effects, badges and mechanics plug in through small interfaces
  (`Painter`, settings), not by branching inside the renderer.
- **User customizable.** Viewers choose what they see and how, and visual rules are data, e.g. which
  tokens (an MR's failed pipeline, a review asked of you, unread comments) show as badges, with what
  icon, colour and urgency. Nothing specific to one person's workflow goes in the code; presets are
  data. Settings follow the person, not the browser: the source of truth is their own preferences in
  rostr (`API-GAPS.md` #7, pending), with the browser's copy only a cache and offline fallback. Such
  data still has to come through rostr first (`API-GAPS.md`).
