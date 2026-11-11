import http2 from 'node:http2';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Connect, type Plugin, type ProxyOptions } from 'vite';

// dispatchr has no backend. Two ways to reach rostr, never both:
// - Direct (VITE_ROSTR_URL, rostr's tailnet address): the browser calls rostr itself and each viewer is
//   who Tailscale says they are, seeing what their own grants allow. No proxy at all then, so no token
//   here can show anyone more.
// - Proxy (ROSTR_URL + ROSTR_TOKEN): Vite forwards /v1/* to rostr and adds the token here, so it never
//   reaches the browser bundle (only VITE_* variables are exposed to client code). Everyone sees what
//   the token sees: for throwaway servers and a rostr without a tailnet address.
// Only GET goes through either way: dispatchr is view-only.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', ['ROSTR_', 'DISPATCHR_', 'VITE_']);
  // Where the built site lives on its host, e.g. `/map/` on rostr's own tailnet address (same origin:
  // the browser's /v1 calls go straight to rostr, no CORS). Default: the root.
  const base = env.DISPATCHR_BASE || '/';
  // Vite refuses unknown Host headers; a name it is reached by through a proxy (e.g. `tailscale serve`)
  // goes in DISPATCHR_ALLOWED_HOSTS.
  const allowedHosts = (env.DISPATCHR_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  // A build is a static site: it reaches rostr directly (VITE_ROSTR_URL, or its own origin when empty),
  // never through a proxy, so it needs no token. Unit tests need no server configuration either.
  if (env.VITE_ROSTR_URL || mode === 'production' || mode === 'test') {
    return {
      base,
      server: { port: 5180, strictPort: true, allowedHosts },
      preview: { port: 5180, strictPort: true, allowedHosts },
    };
  }
  if (!env.ROSTR_URL) throw new Error('Set VITE_ROSTR_URL (rostr on your tailnet) or ROSTR_URL and ROSTR_TOKEN: copy .env.example to .env');
  const auth: Record<string, string> = env.ROSTR_TOKEN ? { authorization: `Bearer ${env.ROSTR_TOKEN}` } : {};
  const proxy: Record<string, ProxyOptions> = {
    '/v1': {
      target: env.ROSTR_URL,
      changeOrigin: true,
      headers: auth,
      bypass: (req) => (req.method === 'GET' ? undefined : false),
    },
  };
  return {
    plugins: [streamOverHttp2(env.ROSTR_URL, auth)],
    server: { port: 5180, strictPort: true, proxy, allowedHosts },
    preview: { port: 5180, strictPort: true, proxy, allowedHosts },
  };
});

// A TLS proxy in front of rostr may buffer small SSE chunks on HTTP/1.1 (the only protocol Vite's proxy
// speaks), holding live events back until a buffer fills; over HTTP/2 they arrive at once. So
// /v1/stream to an https rostr goes over HTTP/2. See API-GAPS.md.
function streamOverHttp2(target: string, auth: Record<string, string>): Plugin {
  const base = new URL(target);
  const handle: Connect.NextHandleFunction = (req: IncomingMessage, res: ServerResponse, next) => {
    if (base.protocol !== 'https:' || req.method !== 'GET' || !req.url?.startsWith('/v1/stream')) return next();
    const session = http2.connect(base.origin);
    const fail = (err: Error) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(res.headersSent ? undefined : JSON.stringify({ error: 'bad_gateway', detail: err.message }));
      session.close();
    };
    session.on('error', fail);
    const lastEventId = req.headers['last-event-id'];
    const up = session.request({
      ':method': 'GET',
      ':path': base.pathname.replace(/\/$/, '') + req.url,
      accept: 'text/event-stream',
      ...auth,
      ...(typeof lastEventId === 'string' ? { 'last-event-id': lastEventId } : {}),
    });
    up.on('response', (headers) => {
      res.writeHead(Number(headers[':status']) || 502, {
        'content-type': String(headers['content-type'] ?? 'text/event-stream'),
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.flushHeaders();
      up.pipe(res);
    });
    up.on('error', fail);
    up.on('end', () => { res.end(); session.close(); });
    req.on('close', () => { up.close(); session.close(); });
  };
  return {
    name: 'rostr-stream-http2',
    configureServer: (server) => { server.middlewares.use(handle); },
    configurePreviewServer: (server) => { server.middlewares.use(handle); },
  };
}
