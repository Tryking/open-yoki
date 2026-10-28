// Replies on her X account. The client's inbox lists what people reply to / @ / quote on her account; new ones reach
// her heart as 【推特 …】 lines with a #推N number. When she wants to answer she writes a file into 想在推特回的/ whose
// first line is "回 #推N" (or "不理 #推N" to clear it); the client sends it as a real reply. Nothing anyone writes on X
// is ever run as a command: only her files are.
//
// client: { list(), reply(id, text), ignore(id) }, e.g. createXClient() from ./xapi.mjs.
//   list() → [{ id, kind: 'reply' | 'mention' | 'quote', text, url, author, name, followers, verified, ours }]
//   (ours: the text of her own post it answers, or '').
import fs from 'node:fs';
import path from 'node:path';
import { checkPost } from './outbox.mjs';

export const X_WANT = '想在推特回的', X_DONE = '推特回过的';

export function parseXFirst(line) {
  const m = String(line || '').trim().match(/^(回|回复|不理)\s*#推(\d+)\s*$/);
  return m ? { act: m[1] === '不理' ? 'ignore' : 'reply', n: +m[2] } : null;
}

// Binance's own accounts: the company, its people and chains. Lower case. Override with createXReply({ official }).
export const OFFICIAL = new Set(['binance', 'cz_binance', 'heyibinance', 'binancezh', 'binancewallet', 'binance_square', 'binancesquare', 'bnbchain',
  'bnbchainzh', 'bnbchaindevs', 'yingbinance', 'sisibinance', 'ancobinance', 'binanceresearch', 'binanceacademy', 'binancelabs', 'yzilabs', 'binance_aus', 'binanceafrica']);

export function createXReply({ home, stateDir, client, official = OFFICIAL, now = () => Date.now(), tz = 8, feed = () => {}, log = () => {}, perDay = 30, gapMs = 60e3, maxLen = 280, perPoll = 8, bigFollowers = 5000 }) {
  const want = path.join(home, X_WANT), done = path.join(home, X_DONE), FILE = path.join(stateDir, 'xreply.json');
  fs.mkdirSync(want, { recursive: true }); fs.mkdirSync(done, { recursive: true });
  const local = t => new Date(t + tz * 3600e3);
  const day = () => local(now()).toISOString().slice(0, 10);
  const hm = t => { const d = local(t); return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const stamp = () => `${day()} ${hm(now())}`;
  let s = { next: 1, items: {}, byId: {}, day: day(), said: 0, lastAt: 0 };
  try { s = { ...s, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  const save = () => fs.writeFileSync(FILE, JSON.stringify(s));
  const one = t => String(t || '').replace(/\s+/g, ' ').trim();
  const short = (t, n = 24) => { t = one(t); return t.slice(0, n) + (t.length > n ? '…' : ''); };
  const KIND = { reply: '回你', mention: '@你', quote: '转发引用你' };

  // New items from the inbox -> her heart. Each keeps a small number she can answer by.
  // Someone tagging a dozen accounts in his own post is not talking to her (most of an inbox can be that): cleared,
  // never shown. At most perPoll a time, oldest first; the rest come next time.
  // X puts every @ of the thread in front of a reply; those are not what he said to her (otherwise the leading tags
  // can fill the 400 characters she sees)
  const lead = t => String(t || '').match(/^(?:\s*@\w+)+/)?.[0] || '';
  // A crowd post stays when it tags Binance's own accounts, or comes from someone with a real following; the rest are
  // cleared.
  const officials = it => [...new Set((String(it.text).match(/@\w+/g) || []).map(h => h.slice(1)).filter(h => official.has(h.toLowerCase())))];
  const big = it => it.verified && it.followers >= bigFollowers;
  const crowd = it => !it.ours && (lead(it.text).match(/@\w+/g) || []).length >= 3 && !officials(it).length && !big(it);
  const said = t => { const l = lead(t), n = (l.match(/@\w+/g) || []).length; return n > 1 ? String(t).slice(l.length).trim() : String(t || '').trim(); };
  async function poll() {
    const items = await client.list();
    let fresh = 0;
    for (const it of items) {
      if (!it?.id || s.byId[it.id]) continue;
      if (crowd(it)) { try { await client.ignore(it.id); } catch (err) { log('xreply ignore: ' + err.message); } continue; }
      if (fresh >= perPoll) break;
      const n = s.next++;
      s.byId[it.id] = n; s.items[n] = { id: it.id, who: it.name || it.author || '有人', at: now() };
      const who = [it.name, it.author ? '@' + String(it.author).replace(/^@/, '') : ''].filter(Boolean).join(' ') || '有人';
      const on = it.ours ? `（你那条「${short(it.ours, 30)}」）` : '';
      const off = officials(it), tag = !it.ours && off.length ? `（他还 @ 了币安官方：${off.map(h => '@' + h).join(' ')}）` : '';
      const fame = big(it) ? `（蓝V，${it.followers >= 1e4 ? (it.followers / 1e4).toFixed(1) + ' 万' : it.followers} 粉丝）` : '';
      feed(`【推特 ${hm(now())} #推${n}】${who}${fame} ${KIND[it.kind] || '找你'}${on}${tag}：${one(said(it.text)).slice(0, 400) || '（只 @ 了你，没说话）'}`);
      fresh++;
    }
    const keys = Object.keys(s.items).map(Number).sort((a, b) => a - b);
    for (const k of keys.slice(0, Math.max(0, keys.length - 300))) { delete s.byId[s.items[k].id]; delete s.items[k]; }
    if (fresh) save();
    return fresh;
  }

  function finish(name, raw, how) {
    let to = path.join(done, name);
    if (fs.existsSync(to)) to = path.join(done, name.replace(/(\.\w+)?$/, `-${now()}$1`));
    fs.writeFileSync(to, `${how}\n\n${raw}\n`);
    fs.rmSync(path.join(want, name), { force: true });
  }

  let busy = false;
  async function scan() {
    if (busy) return; busy = true;
    try {
      if (s.day !== day()) { s.day = day(); s.said = 0; }
      let files = [];
      try { files = fs.readdirSync(want).filter(f => /\.(md|txt)$/.test(f)).map(f => ({ f, t: fs.statSync(path.join(want, f)).mtimeMs })).sort((a, b) => a.t - b.t).map(x => x.f); } catch {}
      for (const name of files) {
        if (now() - fs.statSync(path.join(want, name)).mtimeMs < 5e3) continue;
        const raw = fs.readFileSync(path.join(want, name), 'utf8').replace(/\uFFFD+/g, '').trim();
        const [first, ...rest] = raw.split('\n');
        const cmd = parseXFirst(first);
        // A reply can end with a note to herself like "（他是活人，回一句就行）"; a closing （…） is not sent
        const body = rest.join('\n').trim().replace(/\s*（[^（）]*）\s*$/, '').trim();
        const no = why => { finish(name, raw, `（${stamp()}）没发：${why}`); feed(`【推特】你想回的没发：${why}`); };
        if (!cmd) { no(`第一行要写“回 #推几”（或“不理 #推几”），这样才知道回谁。改好了重新放进 ${X_WANT}/ 就行`); continue; }
        const it = s.items[cmd.n];
        if (!it) { no(`找不到 #推${cmd.n}（太久以前的，或者编号写错了）`); continue; }
        if (it.done) { no(`#推${cmd.n} 已经${it.done}了`); continue; }
        if (cmd.act === 'ignore') {
          try { await client.ignore(it.id); } catch (err) { log('xreply ignore: ' + err.message); }
          it.done = '不理'; save(); finish(name, raw, `（${stamp()}）没理 #推${cmd.n}`); continue;
        }
        if (!body) { no('回的话是空的'); continue; }
        const why = body.length > maxLen ? `太长了（${body.length} 字，最多 ${maxLen}）` : checkPost(body);
        if (why) { no(`${why}。改好了重新放进 ${X_WANT}/ 就行`); continue; }
        if (s.said >= perDay) { finish(name, raw, `（${stamp()}）没发：今天推特已经回了 ${perDay} 条，明天再说。`); continue; }
        if (now() - s.lastAt < gapMs) break;   // wait for the gap; the file stays
        try {
          const r = await client.reply(it.id, body);
          s.said++; s.lastAt = now(); it.done = '回过'; save();
          finish(name, raw, `（${stamp()}）回了 ${it.who}${r?.url ? '\n' + r.url : ''}`);
          feed(`【推特】你回了 ${it.who}：「${short(body)}」`);
          log(`xreply: replied #推${cmd.n} (${name})`);
        } catch (err) {
          finish(name, raw, `（${stamp()}）没回成：${err.message}`);
          feed(`【推特】你想回 ${it.who} 的没回成：${short(err.message, 40)}`);
          log('xreply: ' + err.message);
        }
      }
      save();
    } finally { busy = false; }
  }

  return { poll, scan, state: () => s };
}
