// The show's music: chat goes better over popular songs, and viewers can request one. Whole songs from <dir>/index.json [{ id, title, artist, mood, dur }] play one
// after another under her voice (the feed page dips them to 30% of her level while she talks); a viewer typing
// 点歌 <name> puts that song next. Picking is the radio's: requests first, then the hour's moods, nothing again soon.
import fs from 'node:fs';
import path from 'node:path';
import { findSong, songMoodsAt, SONG_ASK } from './radio.mjs';

export function createSongs({ dir, now = () => Date.now(), rand = Math.random, log = () => {} }) {
  const list = () => { try { return (JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) || []).filter(s => s?.id && /^[\w-]+$/.test(s.id) && fs.existsSync(path.join(dir, s.id + '.m4a'))); } catch { return []; } };
  let asks = [], heard = [], current = null;
  function next() {
    const all = list();
    if (!all.length) return (current = null);
    let s = null, by = null;
    while (asks.length && !s) { const a = asks.shift(); s = all.find(x => x.id === a.id); by = a.by; }
    if (!s) {
      const fresh = all.filter(x => !heard.includes(x.id)), moods = songMoodsAt(now());
      const pool = fresh.filter(x => moods.includes(x.mood)).length ? fresh.filter(x => moods.includes(x.mood)) : fresh.length ? fresh : all;
      s = pool[Math.floor(rand() * pool.length)];
    }
    heard = [...heard.filter(id => id !== s.id), s.id].slice(-Math.min(60, Math.floor(all.length * 0.6)));
    current = { id: s.id, title: s.title, artist: s.artist || '', dur: Number(s.dur) || 240, by, at: now() };
    log(`show song ${s.title}${by ? ' (点歌 ' + by + ')' : ''}`);
    return current;
  }
  // a chat line that asks for a song: { title } found and queued next, { miss } not in the list, null = not a request
  function ask(who, text) {
    const m = String(text || '').match(SONG_ASK);
    if (!m) return null;
    const s = findSong(m[1], list());
    if (!s) return { miss: m[1].slice(0, 20) };
    asks = [...asks.filter(a => a.id !== s.id), { id: s.id, by: String(who || '').slice(0, 16) }].slice(-5);
    return { id: s.id, title: s.title };
  }
  return { next, ask, get current() { return current; }, get count() { return list().length; } };
}
