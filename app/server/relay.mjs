// The server watches for everyone (fallback when there is no own RTC room): Vidu's managed RTC hands out one viewer
// ticket, so the server uses it. A headless browser opens relay/relay.html on 127.0.0.1, joins the TRTC room and streams MediaRecorder
// chunks back here; ffmpeg turns them into short-segment HLS under <dir> that every visitor's page plays (a few seconds
// behind real time). One relay per broadcast: start(rtc) when she goes on air, stop() when she goes off.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const HERE = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'relay');
const STALL_MS = 15000;          // no media this long while on air: restart the relay

export function createRelay({ dir, status, ffmpeg = 'ffmpeg', chromiumPath, log = console.log }) {
  let run = null;                // { rtc, server, browser, ff, lastChunk, started, timer }

  function ffmpegArgs() {
    return ['-loglevel', 'warning', '-fflags', '+genpts', '-i', 'pipe:0',
      '-map', '0:v', '-map', '0:a?',
      // 1 s keyframes so segments are 1 s; veryfast/zerolatency keeps one 720×1280 stream to about one CPU core.
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-r', '25', '-g', '25', '-keyint_min', '25', '-sc_threshold', '0',
      '-b:v', '2000k', '-maxrate', '2500k', '-bufsize', '2000k', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k', '-ar', '44100',
      '-f', 'hls', '-hls_time', '1', '-hls_list_size', '8', '-hls_flags', 'delete_segments+independent_segments+omit_endlist',
      '-hls_segment_filename', path.join(dir, 'seg-%05d.ts'), path.join(dir, 'index.m3u8')];
  }

  async function start(rtc) {
    if (run) await stop();
    if (!rtc?.token) { status?.('relay', false, 'no rtc ticket'); return; }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const me = run = { rtc, lastChunk: Date.now(), started: false };

    // Local page server: relay.html, the TRTC SDK, the ticket, and the media socket. 127.0.0.1 only.
    me.server = createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/config') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(rtc)); }
      const file = u.pathname === '/' ? 'relay.html' : u.pathname === '/vendor/trtc.js' ? 'vendor/trtc.js' : null;
      if (!file) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
      fs.createReadStream(path.join(HERE, file)).pipe(res);
    });
    const wss = new WebSocketServer({ server: me.server, path: '/media' });
    wss.on('connection', sock => sock.on('message', (data, binary) => {
      if (run !== me) return;
      if (!binary) {
        const m = JSON.parse(String(data));
        if (m.log) log('relay page: ' + m.log);
        if (m.started) { me.started = true; status?.('relay', true); log(`relay recording ${m.started} audio=${m.audio}`); }
        if (m.ended) { status?.('relay', false, m.ended); restart(me); }
        return;
      }
      me.lastChunk = Date.now();
      if (!me.ff) {
        me.ff = spawn(ffmpeg, ffmpegArgs(), { stdio: ['pipe', 'ignore', 'pipe'] });
        me.ff.stderr.on('data', d => log('relay ffmpeg: ' + String(d).trim().slice(0, 200)));
        me.ff.stdin.on('error', () => {});
        me.ff.on('exit', code => { if (run === me) { status?.('relay', false, 'ffmpeg exited ' + code); restart(me); } });
      }
      me.ff.stdin.write(data);
    }));
    await new Promise(r => me.server.listen(0, '127.0.0.1', r));
    const port = me.server.address().port;

    const { chromium } = await import('playwright-core');
    me.browser = await chromium.launch({
      headless: true, executablePath: chromiumPath,
      args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    });
    const page = await me.browser.newPage({ viewport: { width: 720, height: 1280 } });
    page.on('pageerror', e => log('relay page error: ' + e.message.slice(0, 200)));
    await page.goto(`http://127.0.0.1:${port}/`);

    me.timer = setInterval(() => {
      if (run === me && Date.now() - me.lastChunk > STALL_MS) { status?.('relay', false, 'no picture for 15 s'); restart(me); }
    }, 5000);
  }

  // Restart with the same ticket (it lasts the whole broadcast). Guarded so a dying run restarts once.
  function restart(me) {
    if (run !== me || me.restarting) return;
    me.restarting = true;
    log('relay restarting');
    start(me.rtc).catch(e => status?.('relay', false, 'restart failed ' + e.message));
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

  return {
    start, stop,
    // The page plays HLS once ffmpeg has written a playlist.
    view: () => run?.started && fs.existsSync(path.join(dir, 'index.m3u8')) ? { kind: 'hls', src: '/hls/index.m3u8' } : null,
    get on() { return !!run; },
  };
}
