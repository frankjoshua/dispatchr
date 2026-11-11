# Security

## Reporting a problem

Please report privately, not in a public issue: use **Report a vulnerability** on the repository's
Security tab (GitHub private vulnerability reporting). You should hear back within a week.

## What dispatchr handles

dispatchr is a static site that reads a rostr server from the browser. It is view only: it sends
nothing but `GET`.

- **Tokens.** In proxy mode (`ROSTR_URL` + `ROSTR_TOKEN`) the dev server adds the token to the
  requests it forwards; it is never part of the browser bundle or a production build. In direct mode
  there is no token: rostr identifies each viewer through Tailscale.
- **Text from rostr** (agent names, tokens, artifact metadata, event payloads) is treated as
  untrusted and escaped before it reaches the page. The nginx config in `deploy/` also sends a
  Content-Security-Policy that allows only the site's own scripts.
- **Links from rostr** (an agent's links and artifacts) are opened only when they are absolute
  `http(s)` URLs. dispatchr reuses a browser tab per kind of link, so an opened page keeps a
  reference to dispatchr's tab and could navigate it (it cannot read it). Links come from your own
  computers' rostr configuration and your own agents; treat an agent that can write artifacts as
  able to choose where that tab goes.

Problems in any of these are in scope. rostr itself is a separate project.
