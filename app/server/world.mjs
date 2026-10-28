// The host's world: mood, what she last said and did, the public chat, the feed and the diary. Pure state plus
// rules; it never calls the model or the avatar. Every change bumps `version` so the live room knows to rebuild.
// The room has no coin: no market cap, stages, holders or fan club, and everyone in the chat is a guest.
import fs from 'node:fs';
import path from 'node:path';

const KEEP = { chat: 40, feed: 30, diary: 60, lines: 12 };

export const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
export const whoOf = a => /^guest-/.test(a || '') ? '游客' + a.slice(-4) : short(a);
// Chat and model input never carry contract addresses or links (they would be read out loud as shilling).
export const scrub = text => String(text).replace(/https?:\/\/\S+|www\.\S+|\b\S+\.(com|io|xyz|app|sh|net|org|fun|meme)\b\S*/gi, '[链接]')
  .replace(/0x[0-9a-fA-F]{6,}/g, '[地址]').replace(/\s+/g, ' ').trim();

export function newWorld() {
  return {
    stage: 0, mood: 'calm',
    line: null, recent: [], talk: [], chat: [], feed: [], diary: [],
    day: null, seq: 0,
  };
}

export function createWorld({ idol, file, now = () => Date.now() } = {}) {
  let w = newWorld(), version = 0, dirty = false;
  if (file && fs.existsSync(file)) w = { ...w, ...JSON.parse(fs.readFileSync(file, 'utf8')), stage: 0 };
  const id = p => `${p}${(++w.seq).toString(36)}`;
  const changed = () => { version++; dirty = true; };
  const push = (list, item, keep) => { list.unshift(item); if (list.length > keep) list.length = keep; };
  const offset = (idol?.tz ?? 8) * 3600e3;

  function today(t = now()) {
    const date = new Date(t + offset).toISOString().slice(0, 10);
    if (!w.day || w.day.date !== date) w.day = { date, chats: [] };
    return w.day;
  }

  // `request` = a 点播 (someone asked her for an action); it shows in the chat so the room sees who asked for what.
  // `who` = a nickname the visitor picked; `from` = where the line came from ('web', 'square' or 'x').
  function chat({ addr, text, request = null, who = null, from = null, at = now() }) {
    addr = String(addr).toLowerCase();
    const item = { id: id('c'), addr, who: who || whoOf(addr), ...(from ? { from } : {}), tier: 'guest', tierName: '游客', text: scrub(text).slice(0, 80), at, ...(request ? { request } : {}) };
    push(w.chat, item, KEEP.chat);
    const d = today(at);
    if (d.chats.length < 30) d.chats.push(`${item.who}：${item.text}`);
    changed();
    return item;
  }

  function say({ text, face, action = null, tone = null, bgm = null, seen = null, audio = null, durationMs = 0, kind, replyTo = null, at = now() }) {
    w.line = { id: id('l'), text, face, action, ...(tone ? { tone } : {}), ...(bgm ? { bgm } : {}), ...(seen ? { seen } : {}), audio, durationMs, kind, at, replyTo };
    w.recent.unshift(text); w.recent.length = Math.min(w.recent.length, KEEP.lines);
    const to = replyTo && w.chat.find(x => x.id === replyTo);
    if (to) to.replied = true;
    // What she said, with the time and who she was answering, so a reply can follow the conversation.
    push(w.talk ||= [], { at, text, ...(to ? { to: to.who } : {}) }, KEEP.lines * 2);
    changed();
    return w.line;
  }

  function addDiary({ date, text, at = now() }) {
    w.diary = w.diary.filter(x => x.date !== date);
    push(w.diary, { date, text, at }, KEEP.diary);
    changed();
  }

  function save() {
    if (!file || !dirty) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(w));
    fs.renameSync(file + '.tmp', file);
    dirty = false;
  }

  return {
    get w() { return w; }, version: () => version, touch: changed,
    chat, say, addDiary, today, save,
  };
}

export const MOODS = { calm: '平静', happy: '开心', excited: '兴奋', sad: '失落', angry: '暴躁' };
