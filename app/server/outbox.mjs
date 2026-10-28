// Her own posts. Her heart writes a file into 想发的动态/ in her home when she wants to post something; the server
// checks it against what she promised (no contract addresses, no links), keeps her to a few a day, and queues it.
// The Square poster (ops/, on a host that can reach binance.com) takes it from /api/square/outbox, posts it with
// Square's official OpenAPI and reports back; the file then moves to 发过的动态/ with how it went, and her heart is told.
// Given an X client (createXClient from ./xapi.mjs with user keys), the server also posts it on X the moment it is
// queued; the X link (or why it failed) goes into the same note and her feed.
import fs from 'node:fs';
import path from 'node:path';

export const WANT = '想发的动态', DONE = '发过的动态';

// What stops a post before it goes out: said back to her in plain words, so she can fix it and try again.
export function checkPost(text) {
  const t = String(text || '').trim();
  if (!t) return '是空的';
  const max = 2000;
  if (t.length > max) return `太长了（${t.length} 字，最多 ${max}）`;
  if (/0x[0-9a-fA-F]{40}/.test(t)) return '里面有合约地址';
  if (/https?:\/\/|www\.|t\.me\/|\b[a-z0-9-]+\.(com|io|xyz|net|org|tv|app)\b/i.test(t)) return '里面有链接';
  return null;
}

export function createOutbox({ home, stateDir, perDay = 5, gapMs = 30 * 60e3, lostMs = 30 * 60e3, tz = 8, now = () => Date.now(), feed = () => {}, log = () => {}, x = null }) {
  const want = path.join(home, WANT), done = path.join(home, DONE), FILE = path.join(stateDir, 'outbox.json');
  fs.mkdirSync(want, { recursive: true }); fs.mkdirSync(done, { recursive: true });
  const local = t => new Date(t + tz * 3600e3);
  const day = () => local(now()).toISOString().slice(0, 10);
  const stamp = () => { const d = local(now()); return `${d.toISOString().slice(0, 10)} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  let s = { day: day(), count: 0, lastAt: 0, items: [] };
  try { s = { ...s, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  const save = () => fs.writeFileSync(FILE, JSON.stringify(s));
  const short = t => t.replace(/\s+/g, ' ').slice(0, 24) + (t.length > 24 ? '…' : '');

  // The file goes to 发过的动态/ with a first line saying what happened; a name already there gets the time added.
  function finish(name, text, how) {
    let to = path.join(done, name);
    if (fs.existsSync(to)) to = path.join(done, name.replace(/(\.\w+)?$/, `-${now()}$1`));
    fs.writeFileSync(to, `${how}\n\n${text}\n`);
    try { fs.rmSync(path.join(want, name)); } catch {}
    return to;
  }

  // X: posted when queued, not waiting for Square. it.x = { ok, url } | { ok: false, error } once X answers.
  const xNote = it => !it.x || it.x.wait ? '' : it.x.ok ? `\n推特：${it.x.url || '发出去了'}` : `\n推特没发出去：${it.x.error}`;
  const pending = new Set();
  function postX(it) {
    if (!x?.configured?.user) return;
    it.x = { wait: true };
    const p = Promise.resolve().then(() => x.post(it.text)).then(
      r => { it.x = { ok: true, url: String(r?.url || '').slice(0, 200), id: r?.id ? String(r.id) : '' }; },
      err => { it.x = { ok: false, error: String(err?.message || err).slice(0, 200) }; })
      .then(() => {
        feed(it.x.ok ? `【推特】你那条动态发到推特了：「${short(it.text)}」${it.x.url ? ' ' + it.x.url : ''}` : `【推特】你那条动态没发到推特：${it.x.error.slice(0, 60)}`);
        // Square answered first: the note is already written, add X to it
        if (it.doneFile) try { fs.appendFileSync(it.doneFile, xNote(it).trim() + '\n'); } catch {}
        log(`outbox: x ${it.x.ok ? 'posted' : 'failed'} ${it.name}`);
        save();
      }).catch(err => log(`outbox: x ${err.message}`)).finally(() => pending.delete(p));
    pending.add(p);
  }

  // Every minute or so: settle what the poster never answered, then queue the oldest file if today's posts and the gap allow.
  function scan() {
    if (s.day !== day()) { s.day = day(); s.count = 0; }
    for (const it of s.items.filter(i => i.takenAt && now() - i.takenAt > lostMs)) {
      it.doneFile = finish(it.name, it.raw || it.text, `（${stamp()}）不知道发没发出去：交出去以后一直没回音。去广场看看有没有，没有就再放一次。${xNote(it)}`);
      feed(`【广场】你那条动态「${short(it.text)}」不知道发没发出去`);
      s.items = s.items.filter(i => i !== it);
    }
    let files = [];
    try { files = fs.readdirSync(want).filter(f => /\.(md|txt)$/.test(f)).map(f => ({ f, t: fs.statSync(path.join(want, f)).mtimeMs })).sort((a, b) => a.t - b.t).map(x => x.f); } catch {}
    for (const name of files) {
      if (s.items.some(i => i.name === name)) continue;
      // a file still being written (changed in the last few seconds) waits for the next scan
      if (now() - fs.statSync(path.join(want, name)).mtimeMs < 5e3) continue;
      const raw = fs.readFileSync(path.join(want, name), 'utf8').replace(/\uFFFD+/g, '').trim();
      const why = checkPost(raw);
      if (why) { finish(name, raw, `（${stamp()}）没发：${why}。改好了重新放进 ${WANT}/ 就行。`); feed(`【广场】你想发的「${short(raw)}」没发出去：${why}`); continue; }
      if (s.items.length || now() - s.lastAt < gapMs) break;   // one at a time, half an hour apart
      if (s.count >= perDay) break;
      const it = { id: `p${now()}`, name, text: raw, raw, at: now() };
      s.items.push(it);
      postX(it);
      s.count++;
      s.lastAt = now();
      log(`outbox: queued ${name}`);
    }
    save();
  }

  // The Square poster asks for what to post; an item is handed out once.
  function take() {
    const out = s.items.filter(i => !i.takenAt);
    for (const i of out) i.takenAt = now();
    if (out.length) save();
    return out.map(i => ({ id: i.id, text: i.text }));
  }

  function settle({ id, ok, link, error } = {}) {
    const it = s.items.find(i => i.id === id);
    if (!it) return false;
    s.items = s.items.filter(i => i !== it);
    if (ok) {
      it.doneFile = finish(it.name, it.raw || it.text, `（${stamp()}）发出去了${link ? '：' + String(link).slice(0, 200) : ''}${xNote(it)}`);
      feed(`【广场】你那条动态发出去了：「${short(it.text)}」`);
    } else {
      // a refused post does not use up one of today's
      s.count = Math.max(0, s.count - 1);
      s.lastAt = 0;
      it.doneFile = finish(it.name, it.raw || it.text, `（${stamp()}）没发出去：${String(error || '不知道为什么').slice(0, 200)}${xNote(it)}`);
      feed(`【广场】你那条动态没发出去：${String(error || '').slice(0, 60)}`);
    }
    log(`outbox: ${ok ? 'posted' : 'failed'} ${it.name}`);
    save();
    return true;
  }

  // flush(): wait for X posts still in flight (tests, shutdown).
  return { scan, take, settle, flush: () => Promise.all([...pending]), get state() { return s; } };
}
