// Keeps the page's copy of the room current: the server pushes a full snapshot on connect and then patches (see
// server/live.mjs); if the stream is refused, the page polls /api/state.
const LISTS = new Set(['chat', 'feed']);

export function applyPatch(town, { time, parts }) {
  const next = { ...town, time };
  for (const [k, v] of Object.entries(parts)) {
    if (!LISTS.has(k) || !Array.isArray(town[k])) { next[k] = v; continue; }
    const byId = new Map(town[k].map(item => [item.id, item]));
    for (const item of v.items) byId.set(item.id, item);
    next[k] = (v.ids || town[k].map(item => item.id)).map(id => byId.get(id)).filter(Boolean);
  }
  return next;
}

export function watchRoom({ onRoom, onOffline, pollMs = 10000, retryStreamMs = 60000 }) {
  let town = null, stream = null, poll = null, retry = null;
  const set = t => { town = t; onRoom(t); };
  async function fetchOnce() {
    try {
      const r = await fetch('/api/state');
      if (!r.ok) throw new Error(r.status);
      set(await r.json()); onOffline(false);
    } catch { onOffline(true); }
  }
  const startPolling = () => { if (!poll) { fetchOnce(); poll = setInterval(fetchOnce, pollMs); } };
  const stopPolling = () => { clearInterval(poll); poll = null; };
  function connect() {
    if (typeof EventSource === 'undefined') return startPolling();
    stream = new EventSource('/api/stream');
    stream.addEventListener('full', e => { stopPolling(); set(JSON.parse(e.data)); onOffline(false); });
    stream.addEventListener('patch', e => { if (town) set(applyPatch(town, JSON.parse(e.data))); });
    stream.onerror = () => {
      // CONNECTING means the browser is already retrying; CLOSED means the server said no (busy or limited).
      if (stream.readyState !== EventSource.CLOSED) return onOffline(true);
      stream = null;
      startPolling();
      retry = setTimeout(connect, retryStreamMs);
    };
  }
  connect();
  return () => { stream?.close(); stopPolling(); clearTimeout(retry); };
}
