# Contributing to dispatchr

Thanks for looking. dispatchr is small and opinionated; these are the rules it is built by.

## Set up

Node 22 (see `.nvmrc`) and a [rostr](https://github.com/frankjoshua/rostr) server to watch:

```bash
npm ci
cp .env.example .env     # how to reach rostr
npm run dev              # http://localhost:5180
```

For development, watch a throwaway rostr rather than a real one: rostr's test harness
(`test/harness/run --shell` in a rostr checkout) starts a server with made-up agents; the README says
how to point a dev server at it.

Before opening a pull request:

```bash
npm test                 # the game rules' unit tests
npm run build            # type-checks, then builds
```

## What dispatchr is

- **A pure rostr client, view only.** Everything on screen comes from rostr's REST API and
  `GET /v1/stream`. It never talks to herdr, the agents or Buzz, and it only sends `GET`.
- **What the API lacks goes in [API-GAPS.md](API-GAPS.md)** (what, why, the shape wanted) as a
  proposal for rostr, with the workaround used here until rostr ships it.
- **Game mechanics are derived, never invented.** Height, light, sleep, badges and the working loop
  are all computed from rostr's data; nothing is stored elsewhere except the viewer's own settings.

## How the code is laid out

Data (`store`, `usage`) → game rules → engine (`map`, `world`, effects, camera) → presentation
(themes and their painters) and the DOM panels. Rules never draw; the engine never fetches.

- **Rules are pure modules with unit tests** (`presence.ts` and `presence.test.ts` are the model). A
  new rule comes with tests that would catch a real behaviour bug; a rule you touch that has none
  gets them.
- **60 fps on a phone.** Code that runs every frame allocates nothing it can keep. Measure a visual
  effect on a CPU-throttled phone viewport before sending it.
- **Nothing kept for the life of the tab may grow without bound.** People leave dispatchr open for
  days, often in the background, where the browser stops animation frames while events keep
  arriving.
- **Themes, effects and badges plug in** through small interfaces (`Painter`, settings), not by
  branching inside the renderer. Visual rules are the viewer's data, not code.
- **TypeScript is strict; no `any`.** Text from rostr reaches HTML only through `esc`, and a URL from
  rostr becomes a link only after an http(s) check.
- **Use the names in [GLOSSARY.md](GLOSSARY.md)** in code, docs and discussion.
- **No hostnames, tokens or people** in code, fixtures or screenshots: use made-up names.

`CLAUDE.md` holds the same rules for coding agents.

## Reporting a security problem

See [SECURITY.md](SECURITY.md).
