// One room snapshot shared by every viewer. It is rebuilt
// only after the world changes or once it is `maxAgeMs` old, kept as ready-to-send JSON and gzip, and pushed to
// stream subscribers as patches: a list sends only the entries that changed, anything else only when it changed.
import { gzipSync } from 'node:zlib';

export const LISTS = new Set(['chat', 'feed']);

export function liveRoom({ build, version, now = () => Date.now(), maxAgeMs = 2000, tickMs = 1000, heartbeatMs = 25000, maxClients = 2000, maxPerIp = 6 }) {
  let snap = null;
  let pushed = null; // the snapshot subscribers last received
  const clients = new Set();
  const perIp = new Map();

  function current() {
    const v = version(), t = now();
    if (snap && snap.v === v && t - snap.at < maxAgeMs) return snap;
    const data = build();
    const json = JSON.stringify(data);
    // Per-entry JSON lets the next patch compare entries without walking objects.
    const parts = {};
    for (const [k, value] of Object.entries(data)) {
      if (k === 'time') continue;
      parts[k] = LISTS.has(k) ? new Map(value.map(item => [item.id, JSON.stringify(item)])) : JSON.stringify(value);
    }
    snap = { v, at: t, data, json, gz: null, parts };
    return snap;
  }
  const gzipped = s => (s.gz ||= gzipSync(s.json, { level: 6 }));

  function patch(from, to) {
    const out = {};
    for (const [k, part] of Object.entries(to.parts)) {
      const before = from.parts[k];
      if (!(part instanceof Map)) { if (part !== before) out[k] = to.data[k]; continue; }
      const items = to.data[k].filter(item => before.get(item.id) !== part.get(item.id));
      const ids = [...part.keys()], was = [...before.keys()];
      const reordered = ids.length !== was.length || ids.some((id, i) => id !== was[i]);
      if (items.length || reordered) out[k] = reordered ? { items, ids } : { items };
    }
    return Object.keys(out).length ? { time: to.data.time, parts: out } : null;
  }

  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);

  function subscribe(res, ip) {
    if (clients.size >= maxClients || (perIp.get(ip) || 0) >= maxPerIp) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '60' });
      return res.end(JSON.stringify({ error: 'too many live viewers right now; poll /api/state instead', retryAfter: 60 }));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    const client = { res, ip, beat: now() };
    clients.add(client);
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    // A new subscriber starts from whatever the others were last sent, so the next patch fits it too.
    send(res, 'full', (pushed || (pushed = current())).json);
    res.on('close', () => {
      clients.delete(client);
      const n = perIp.get(ip) - 1;
      if (n > 0) perIp.set(ip, n); else perIp.delete(ip);
    });
  }

  const timer = setInterval(() => {
    if (!clients.size) { pushed = null; return; }
    const next = current();
    const t = now();
    if (next !== pushed) {
      const p = pushed && patch(pushed, next);
      pushed = next;
      if (p) { const line = JSON.stringify(p); for (const c of clients) { send(c.res, 'patch', line); c.beat = t; } return; }
    }
    // Comments keep proxies from closing a quiet stream.
    for (const c of clients) if (t - c.beat >= heartbeatMs) { c.res.write(': ping\n\n'); c.beat = t; }
  }, tickMs);
  timer.unref();

  return {
    current, gzipped, subscribe, patch,
    stop() { clearInterval(timer); for (const c of clients) c.res.end(); clients.clear(); perIp.clear(); },
    get viewers() { return clients.size; },
  };
}

// Is anyone watching, counting the last graceMs: Vidu bills by the second, so with an empty room she
// hangs up and the first viewer brings her back. A page refresh inside the grace keeps her connected.
export function watchGate({ graceMs = 90e3, viewers, now = () => Date.now() }) {
  let last = -Infinity;
  return () => { if (viewers() > 0) last = now(); return now() - last < graceMs; };
}
