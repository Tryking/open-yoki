// Live on Binance Square: Square takes an RTMP address and key from its live console, like OBS. A headless browser
// opens relay/square.html on 127.0.0.1, joins our own Volcano room with an invisible viewer ticket, draws her picture with the line she is saying as a caption, and streams MediaRecorder chunks
// here; ffmpeg re-encodes them (steady keyframes, AAC) and pushes FLV to Square.
// The address and key live in <DATA_DIR>/square.json {"url": "rtmp://…", "key": "…", "size": "720x1280"}, written by
// deploy/set-square.sh; no restart needed, the file is read each time the feed starts.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const APP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STALL_MS = 15000;
// The 16:9 feed's two faces: her inner thoughts in a brush-like kai face (LXGW WenKai), prices in a narrow figure
// face (Oswald). Both are SIL OFL fonts in relay/fonts; the page falls back to system fonts without them.
const FONTS = { '/font/kai.ttf': 'kai.ttf', '/font/num.ttf': 'num.ttf' };

export function readSquare(file) {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!/^rtmps?:\/\/[^\s]+$/.test(c.url || '') || !c.key) return null;
    const [width, height] = String(c.size || '720x1280').split('x').map(Number);
    // fps 24 is what Vidu sends; 25 made the encoder repeat a frame every second.
    return { target: c.url.replace(/\/+$/, '') + '/' + c.key, width: width || 720, height: height || 1280, fps: Number(c.fps) || 24, kbps: Number(c.kbps) || 3000 };
  } catch { return null; }
}

// tap (mpegts: matroska fails its header inside tee): also write exactly what goes out to a local file, to check voice
// against mouth and timing (SQUARE_TAP).
export function squareArgs({ target, fps = 24, kbps = 3000, tap = '' }) {
  return ['-loglevel', 'warning', '-fflags', '+genpts', '-i', 'pipe:0',
    '-map', '0:v', '-map', '0:a',
    // 2 s keyframes and a capped bitrate: what live platforms ask of an OBS push.
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-r', String(fps), '-g', String(fps * 2), '-keyint_min', String(fps * 2), '-sc_threshold', '0',
    '-b:v', kbps + 'k', '-maxrate', kbps + 'k', '-bufsize', kbps * 2 + 'k', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    ...(tap ? ['-f', 'tee', [`[f=flv]${target}`, `[f=mpegts]${tap}`].join('|')] : ['-f', 'flv', target])];
}

export function createSquare({ file, bgmDir = '', songDir = '', room, still = '', clips = [], status, ffmpeg = 'ffmpeg', chromiumPath, log = console.log, tap = '', onSongEnded = null, page = {} }) {
  let run = null;
  const configured = () => !!readSquare(file);

  async function start() {
    if (run) return;
    const cfg = readSquare(file);
    if (!cfg) return;
    const me = run = { lastChunk: Date.now(), started: false, socks: new Set() };
    me.server = createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/config') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ ...page, ...room.viewer(), width: cfg.width, height: cfg.height, fps: cfg.fps, kbps: cfg.kbps, still: '/still', clips }));
      }
      const song = bgmDir && /^\/bgm\/[a-z0-9_-]+\.m4a$/.test(u.pathname) ? path.join(bgmDir, u.pathname.slice(5)) : null;
      const whole = songDir && /^\/song\/[\w-]+\.m4a$/.test(u.pathname) ? path.join(songDir, u.pathname.slice(6)) : null;
      const sfx = /^\/sfx\/[a-z]+\.mp3$/.test(u.pathname) ? path.join(APP, 'relay', 'sfx', u.pathname.slice(5)) : null;
      const clip = /^\/clip\/[a-z]+\.mp4$/.test(u.pathname) && clips.includes(u.pathname.slice(6, -4)) ? path.join(APP, 'relay', 'clips', u.pathname.slice(6)) : null;
      const file = song || whole || sfx || clip || (u.pathname === '/' ? path.join(APP, 'relay', 'square.html') : u.pathname === '/vendor/volc-rtc.min.js' ? path.join(APP, 'public', 'vendor', 'volc-rtc.min.js') : FONTS[u.pathname] ? path.join(APP, 'relay', 'fonts', FONTS[u.pathname]) : u.pathname === '/still' && still ? still : null);
      if (!file || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.m4a') ? 'audio/mp4' : file.endsWith('.mp3') ? 'audio/mpeg' : file.endsWith('.mp4') ? 'video/mp4' : file.endsWith('.ttf') ? 'font/ttf' : 'image/jpeg');
      fs.createReadStream(file).pipe(res);
    });
    const wss = new WebSocketServer({ server: me.server, path: '/media' });
    wss.on('connection', sock => {
      me.socks.add(sock);
      for (const m of [lastBoard, lastFocus, lastSong]) if (m) try { sock.send(m); } catch {}
      sock.on('close', () => me.socks.delete(sock));
      sock.on('message', (data, binary) => {
        if (run !== me) return;
        if (!binary) {
          const m = JSON.parse(String(data));
          if (m.log) log('square page: ' + m.log);
          if (m.started) { me.started = true; status?.('square', true); log(`square feed recording ${m.started}`); }
          if (m.ended) { status?.('square', false, m.ended); restart(me); }
          if (m.songEnded) onSongEnded?.(m.songEnded);
          return;
        }
        me.lastChunk = Date.now();
        if (!me.ff) {
          me.ff = spawn(ffmpeg, squareArgs({ ...cfg, tap: tap && tap.replace('%t', Date.now()) }), { stdio: ['pipe', 'ignore', 'pipe'] });
          // ffmpeg prints the target on errors; never let a stream key reach the log.
          me.ff.stderr.on('data', d => { const s = String(d).split(cfg.target).join('rtmp://…'); log('square ffmpeg: ' + s.trim().slice(0, 200)); });
          me.ff.stdin.on('error', () => {});
          me.ff.on('exit', code => { if (run === me) { status?.('square', false, 'ffmpeg exited ' + code); restart(me); } });
        }
        me.ff.stdin.write(data);
      });
    });
    await new Promise(r => me.server.listen(0, '127.0.0.1', r));
    const { chromium } = await import('playwright-core');
    me.browser = await chromium.launch({
      headless: true, executablePath: chromiumPath,
      args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    });
    const page = await me.browser.newPage({ viewport: { width: cfg.width, height: cfg.height } });
    page.on('pageerror', e => log('square page error: ' + e.message.slice(0, 200)));
    await page.goto(`http://127.0.0.1:${me.server.address().port}/`);
    me.timer = setInterval(() => {
      if (run === me && Date.now() - me.lastChunk > STALL_MS) { status?.('square', false, 'no picture for 15 s'); restart(me); }
    }, 5000);
    log('square feed starting ' + cfg.width + 'x' + cfg.height);
  }

  // A dying feed restarts once, 10 s later (a wrong key would otherwise hammer Square).
  function restart(me) {
    if (run !== me || me.restarting) return;
    me.restarting = true;
    log('square feed restarting in 10 s');
    stop().then(() => setTimeout(() => start().catch(e => status?.('square', false, 'restart failed ' + e.message)), 10000));
  }

  async function stop() {
    const me = run;
    run = null;
    if (!me) return;
    clearInterval(me.timer);
    try { me.ff?.stdin.end(); } catch {}
    setTimeout(() => { try { me.ff?.kill('SIGKILL'); } catch {} }, 3000);
    await me.browser?.close().catch(() => {});
    me.server?.close();
  }

  // The line she is saying now (and whom she is answering), drawn as the caption on the Square picture, with the
  // thought behind it (brain's 想：<mood>｜<why>) for the 16:9 feed's 心里话, and the effect of her move (heart, kiss …).
  function caption(text, who = '', head = '', inner = '', fx = '') {
    if (!run) return;
    const m = JSON.stringify({ caption: String(text || '').slice(0, 120), who: String(who || '').slice(0, 16), head: String(head || '').slice(0, 48), think: splitInner(inner), ...(/^[a-z]{2,8}$/.test(fx || '') ? { fx } : {}) });
    for (const s of run.socks) try { s.send(m); } catch {}
  }

  // One of her big moves (bigmoves.mjs): the page plays the clip over her live picture.
  function clip(name) {
    if (!run || !clips.includes(name)) return false;
    let sent = false;
    for (const s of run.socks) try { s.send(JSON.stringify({ clip: name })); sent = true; } catch {}
    return sent;
  }

  // A song she put on: the feed page mixes its hook under her voice.
  function bgm(url) {
    if (!run || !/^\/bgm\/[a-z0-9_-]+\.m4a$/.test(url)) return;
    for (const s of run.socks) try { s.send(JSON.stringify({ bgm: url })); } catch {}
  }

  // A whole song under her voice on the show (songs.mjs picks it; the songs are the operator's own files).
  function song(s) {
    if (!run || !s?.id || !/^[\w-]+$/.test(s.id)) return false;
    const m = lastSong = JSON.stringify({ song: { id: s.id, title: String(s.title || '').slice(0, 40), url: `/song/${s.id}.m4a`, by: s.by ? String(s.by).slice(0, 16) : null } });
    let sent = false;
    for (const x of run.socks) try { x.send(m); sent = true; } catch {}
    return sent;
  }
  let lastSong = '';
  // A short sound over everything (a big market move, a big gift): one of relay/sfx.
  function sting(name) {
    if (!run || !/^[a-z]+$/.test(name)) return;
    for (const x of run.socks) try { x.send(JSON.stringify({ sting: name })); } catch {}
  }

  // The majors she watches (market.mjs), for the right-hand column of a 16:9 feed; kept so a restarted page gets them at once.
  let lastBoard = '';
  function board(list) {
    lastBoard = JSON.stringify({ board: (list || []).slice(0, 6).map(c => ({ coin: String(c.coin).slice(0, 10), price: String(c.price).slice(0, 14), pct: String(c.pct).slice(0, 8), up: !!c.up })) });
    if (run) for (const s of run.socks) try { s.send(lastBoard); } catch {}
  }

  // The coin she is watching: code, price, 24 h change, the last day of hourly candles and her own words about it,
  // for the big card on the right of a 16:9 feed; kept like the board.
  let lastFocus = '';
  function focus(f) {
    if (!f?.coin) return;
    const k = (Array.isArray(f.candles) ? f.candles : []).slice(-24).filter(c => [c.o, c.h, c.l, c.c].every(Number.isFinite)).map(c => [c.o, c.h, c.l, c.c]);
    lastFocus = JSON.stringify({ focus: { coin: String(f.coin).slice(0, 10), price: String(f.price || '').slice(0, 14), pct: String(f.pct || '').slice(0, 8), up: !!f.up, view: String(f.view || '').slice(0, 40), k } });
    if (run) for (const s of run.socks) try { s.send(lastFocus); } catch {}
  }

  return { start, stop, caption, bgm, song, sting, clip, board, focus, configured, get on() { return !!run; }, get live() { return !!run?.started; } };
}

// Her thought behind a line, as brain writes it ("想：<mood>｜<why>｜…"): the mood and the first reason, for 心里话.
// A host's plan rather than a feeling ("得招呼住", "别冷场" — about a third of the thoughts on a first night) is not
// shown as her 心里话.
export const HOST_PLAN = /招呼|别冷场|冷场|接住|接一句|接个话|回他|回一句|先接|留住|把人留|撑场|换个话题|换个话头|带过|圆一下|欢迎一下/;
export function splitInner(inner) {
  if (HOST_PLAN.test(String(inner || ''))) return null;
  const parts = String(inner || '').replace(/^想[:：]\s*/, '').split(/[｜|]/).map(x => x.trim().replace(/[。.]+$/, '')).filter(Boolean);
  if (!parts.length) return null;
  return parts.length === 1 ? { mood: '', text: parts[0].slice(0, 30) } : { mood: parts[0].slice(0, 8), text: parts[1].slice(0, 30) };
}

// What she just said about a coin, cut to the sentence that names it (by code or nickname) (≤ 28 characters), for the card on the right.
export function coinView(text, names) {
  const s = String(text || '').replace(/\s+/g, ' ').trim(), ns = [].concat(names).map(n => String(n).toUpperCase());
  const one = s.split(/(?<=[。！？!?])/).find(x => ns.some(n => x.toUpperCase().includes(n))) || '';
  const t = one.trim();
  return t.length > 28 ? t.slice(0, 27) + '…' : t;
}

// Comments read off her Square room arrive in batches from the reader (POST /api/square/comments). The same comment
// can be read twice while the page scrolls, so a name+text pair counts once per 3 minutes. The reader can also take
// the row's 举报 (report) button with the text, and Square's own notice "听众对 $BTC 感兴趣：添加交易对" looks like a
// comment; both are cleaned here.
export function cleanComments(items, { seen, nickOf, now = Date.now() }) {
  const out = [];
  for (const it of Array.isArray(items) ? items.slice(0, 20) : []) {
    const text = String(it?.text || '').replace(/\s+/g, ' ').trim().replace(/\s*举报$/, '').slice(0, 80);
    if (!text || /^听众对.*感兴趣$/.test(String(it?.name || '').trim()) || text === '添加交易对') continue;
    const name = nickOf(it?.name) || '广场网友';
    const k = name + '\n' + text;
    if (seen.has(k) && now - seen.get(k) < 3 * 60e3) continue;
    seen.set(k, now);
    out.push({ name, text });
  }
  if (seen.size > 2000) for (const [k, t] of seen) if (now - t > 3 * 60e3) seen.delete(k);
  return out;
}

// Her Square room as Square counts it: who is watching now, total listens, tonight's peak, and who walks
// in by nickname. The reader posts them (POST /api/square/room) off the room page's chat socket (src 'im', sent when a
// number changes) and room-detail every 30 s (src 'detail', the backup; ignored while the socket has spoken within
// 90 s). A count not refreshed for staleMs is not trusted. The same person walking back in within rejoinMs is not news.
const THANKS = ['follow', 'gift', 'tip', 'red'];
export function createSquareRoom({ now = () => Date.now(), staleMs = 5 * 60e3, rejoinMs = 10 * 60e3 } = {}) {
  let online = null, at = 0, imAt = -Infinity, pv = 0, peak = 0, listens = 0;
  const greeted = new Map();
  const num = x => { const n = Number(x); return x !== null && x !== '' && Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 1e7) : null; };

  function take(body, nickOf = x => String(x || '').trim() || null) {
    const t = now(), im = body?.src !== 'detail';
    const o = num(body?.online), p = num(body?.pv);
    if (im && (o != null || p != null)) imAt = t;
    if (im || t - imAt > 90e3) {
      if (o != null) { online = o; at = t; peak = Math.max(peak, o); }
      if (p != null) { pv = p; listens = Math.max(listens, p); }
    }
    const joins = [], thanks = [];
    let ended = false, warned = false;
    for (const e of Array.isArray(body?.events) ? body.events.slice(0, 50) : []) {
      if (e?.type === 'end') { ended = true; online = 0; at = t; continue; }
      if (e?.type === 'warning') { warned = true; continue; }
      // follows, gifts, tips and red envelopes viewers send her (Square's own events): type names from Square's web
      // bundle; thanked on air only, nothing here moves any money
      if (THANKS.includes(e?.type)) { thanks.push({ act: e.type, name: nickOf(e.name), what: String(e.what || '').replace(/[\r\n]/g, ' ').trim().slice(0, 30) || null, usd: Number.isFinite(Number(e.usd)) && Number(e.usd) > 0 ? Math.min(Number(e.usd), 1e5) : null }); continue; }
      const name = e?.type === 'enter' ? nickOf(e.name) : null;
      if (!name || t - (greeted.get(name) ?? -Infinity) < rejoinMs) continue;
      greeted.set(name, t);
      joins.push(name);
    }
    if (greeted.size > 2000) for (const [k, g] of greeted) if (t - g > rejoinMs) greeted.delete(k);
    return { joins, thanks: thanks.slice(0, 20), ended, warned };
  }

  // A new show starts its own peak and listens.
  function reset() { online = null; at = 0; imAt = -Infinity; pv = 0; peak = 0; listens = 0; greeted.clear(); }

  return { take, reset, get online() { return online != null && now() - at < staleMs ? online : null; }, get pv() { return pv; }, get peak() { return peak; }, get listens() { return listens; } };
}

// How many are watching, for her brain: while she is on Square, Square's own count plus the site's, so the
// site's number no longer stands in for Square's. Without Square's count (reader down, or no number yet) a Square
// push still counts as one, as before.
export function watching({ onSquare = false, square = null, site = 0 } = {}) {
  if (onSquare && square != null) return square + site;
  return site || (onSquare ? 1 : 0);
}
