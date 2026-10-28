// Her Telegram group. Her bot is an admin of her fan group, and her heart holds the admin rights: what people say there reaches her heart as 【TG群 …】 lines with a #number; when she wants
// to say something she writes a file into 想在群里说的/, the same way she posts. A first line like "回复 #123",
// "删 #123", "禁言 #123 1天" or "踢 #123" replies to or acts on that message. Nothing anyone says in the group is ever
// run as a command here: only her own files are.
import fs from 'node:fs';
import path from 'node:path';
import { checkPost } from './outbox.mjs';

export const TG_WANT = '想在群里说的', TG_DONE = '群里说过的', FAM_WANT = '想跟运营说的', FAM_DONE = '跟运营说过的';

export function tgApi(token, fetchFn = globalThis.fetch) {
  return async (method, params = {}, timeoutMs = 40e3) => {
    let r;
    try {
      r = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) { throw new Error(`${method}: ${String(err.message || err).split(token).join('***')}`); }
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(`${method}: ${String(j.description || r.status).split(token).join('***')}`);
    return j.result;
  };
}

const UNITS = { 分钟: 60, 小时: 3600, 天: 86400 };

export function parseFirst(line) {
  const l = String(line || '').trim();
  let m;
  if ((m = l.match(/^回复\s*#(\d+)\s*$/))) return { act: 'reply', id: +m[1] };
  if ((m = l.match(/^私信\s*#私(\d+)\s*$/))) return { act: 'dm', uid: +m[1] };
  if ((m = l.match(/^删\s*#(\d+)\s*$/))) return { act: 'delete', id: +m[1] };
  if ((m = l.match(/^踢\s*#(\d+)\s*$/))) return { act: 'ban', id: +m[1] };
  if ((m = l.match(/^禁言\s*#(\d+)\s*(?:(\d+)\s*(分钟|小时|天))?\s*$/))) {
    const secs = m[2] ? Math.min(+m[2] * UNITS[m[3]], 30 * 86400) : 86400;
    return { act: 'mute', id: +m[1], secs: Math.max(secs, 60) };
  }
  return null;
}

// Impostors: scammers rename to the group's own name (and copy its picture) or to Developer / Admin / 官方, then post
// "project paused, 1:1 compensation, DM me", usually after midnight. A non-admin with such a name is deleted and banned
// by the program at once, day or night, without waiting for her heart.
const norm = t => String(t || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}\p{Extended_Pictographic}]/gu, '');
export function impostor(name, { title = '', botName = '', names = [] } = {}) {
  const n = norm(name);
  if (!n) return false;
  const own = [title, botName, ...names].map(norm).filter(Boolean);
  if (own.includes(n) || (norm(title) && n.includes(norm(title)))) return true;
  return /^(dev|devs|mod|mods|team|ceo|owner|founder)$/.test(n) || /developer|admin|moderator|support|official|官方|管理员|客服|开发者|群主/.test(n);
}

// Paid-promotion pitches ("promotion on my telegram channel … DM me for promotion") tend to land at night. Only the
// plain kind is caught: asking for a DM *and* selling promotion / volume / listing in the same message, or a name that
// says KOL / Ads / promotion.
const CA = /0x[0-9a-fA-F]{40}|\b[1-9A-HJ-NP-Za-km-z]{30,44}pump\b/;
export function promo(text, name = '') {
  const t = String(text || '').normalize('NFKC').toLowerCase(), n = norm(name);
  if (/kols?influencer|influencers|promotion|prom(o|ot|t)er|marketing|calls(official)?$|^ads$|推广|刷量/.test(n)) return true;
  const dm = /\b(d\W?m|p\W?m|inbox|message)\s*me\b|\bdm\s+(for|to)\b|私信我|私聊我|加我|联系我/.test(t);
  const sell = /promot|marketing|\blisting|\bvolume\b|\bkols?\b|influencer|\bshill|trending|investors|推广|宣传|刷量|拉盘|上所|做市|合作/.test(t);
  // Pitches that skip the DM words: "I've been watching X's wallet … he posts it on his channel" (someone else's channel
  // plus wallet / calls / copy-trade talk), "promotion on my telegram … investors who will pump your project",
  // "Call the big investors @…calls…"; these say it on their own.
  const pitch = /promot\w*\s+(on|in|at)\s+(my|our)\b|before payment|after payment|investors?\s+(who|that)\s+(will|can)|pump\s+your\s+(project|token|coin)|call\s+(the\s+)?(big\s+)?investors|@\w*calls\w*|\bcalls?\s+(channel|group)\b|我的(频道|群)(里)?(推广|宣传)/.test(t);
  const chan = /\b(his|her|their)\s+(tg\s+|telegram\s+)?(channel|group)\b|(他|她)的(频道|群)/.test(t) && /wallet|\bapes?\b|\bcalls?\b|signals?|跟单|钱包|喊单/.test(t);
  return (dm && sell) || pitch || chan;
}

// family: the private group with the people who run her (optional), { chatId, members: { <uid>: '名字（介绍）' } };
// they can talk to her and she can talk to them when she wants. onFamily / onFamilySaid (family.mjs): those messages go
// to her direct chat there instead of the heart. names: her own names (impostors copy them); botUser: the bot's
// @username, so "@bot" in a message counts as talking to her.
export function createTg({ home, stateDir, api, chatId, botId = null, botUser = '', names = [], family = null, onFamily = null, onFamilySaid = null, now = () => Date.now(), tz = 8, feed = () => {}, log = () => {},
  perDay = 40, gapMs = 60e3, actsPerDay = 30, feedCap = 20, feedWindowMs = 10 * 60e3 }) {
  const want = path.join(home, TG_WANT), done = path.join(home, TG_DONE), FILE = path.join(stateDir, 'tg.json');
  fs.mkdirSync(want, { recursive: true }); fs.mkdirSync(done, { recursive: true });
  const fwant = path.join(home, FAM_WANT), fdone = path.join(home, FAM_DONE);
  if (family?.chatId) { fs.mkdirSync(fwant, { recursive: true }); fs.mkdirSync(fdone, { recursive: true }); }
  const local = t => new Date(t + tz * 3600e3);
  const day = () => local(now()).toISOString().slice(0, 10);
  const hm = t => { const d = local(t); return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const stamp = () => `${day()} ${hm(now())}`;
  let s = { offset: 0, day: day(), said: 0, acts: 0, lastAt: 0, seen: {}, win: 0, fed: 0, skipped: 0, others: {} };
  try { s = { ...s, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  const save = () => fs.writeFileSync(FILE, JSON.stringify(s));
  const short = t => t.replace(/\s+/g, ' ').slice(0, 24) + (t.length > 24 ? '…' : '');
  const who = u => [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim() || (u?.username ? '@' + u.username : '有人');
  function remember(id, rec) {
    s.seen[id] = rec;
    const keys = Object.keys(s.seen);
    if (keys.length > 400) for (const k of keys.sort((a, b) => a - b).slice(0, keys.length - 400)) delete s.seen[k];
  }

  // what people said, a few at a time so a flood does not drown her
  function tell(line) {
    if (now() - s.win > feedWindowMs) {
      if (s.skipped) feed(`【TG群】刚才群里还有 ${s.skipped} 条你没细看`);
      s.win = now(); s.fed = 0; s.skipped = 0;
    }
    if (s.fed >= feedCap) { s.skipped++; return; }
    s.fed++; feed(line);
  }

  function take(u) {
    const m = u.message;
    if (!m) return;
    // someone wrote to her bot directly
    if (m.chat?.type === 'private' && m.from && !m.from.is_bot) {
      let t = (m.text || m.caption || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (/^\/start\b/.test(t)) t = '（刚点开你的机器人）';
      if (!t) t = m.sticker ? `[贴纸${m.sticker.emoji ? ' ' + m.sticker.emoji : ''}]` : m.photo ? '[一张图]' : '';
      if (!t) return;
      s.dms = s.dms || {}; s.dms[m.from.id] = who(m.from);
      tell(`【TG私信 ${hm(m.date * 1000)}】${who(m.from)}（#私${m.from.id}）：${t}`);
      return;
    }
    // the operators' group: everything reaches her, never capped, never moderated
    if (family?.chatId && m.chat?.id === family.chatId) {
      if (!m.from || m.from.is_bot || m.new_chat_members) return;
      let t = m.text || m.caption || '';
      if (!t) t = m.sticker ? `[贴纸${m.sticker.emoji ? ' ' + m.sticker.emoji : ''}]` : m.photo ? '[一张图]' : (m.video || m.animation) ? '[一段视频]' : m.voice ? '[一条语音]' : '';
      if (!t) return;
      const name = family.members?.[m.from.id] || who(m.from);
      const r = m.reply_to_message, to = r ? (r.from?.id === botId ? `（回你的「${short(r.text || '')}」）` : '') : '';
      const line = `【运营群 ${hm(m.date * 1000)} #${m.message_id}】${name}${to}：${t.replace(/\s+/g, ' ').trim().slice(0, 600)}`;
      if (onFamily) onFamily({ name: name.split('（')[0].trim(), text: t.replace(/\s+/g, ' ').trim().slice(0, 600), line }); else feed(line);
      return;
    }
    if (m.chat?.id !== chatId) {
      // another chat she was added to: remembered (title, who spoke last) so it can be wired up, never read to her
      if (m.chat?.id) { s.others[m.chat.id] = { title: m.chat.title || '', type: m.chat.type, from: m.from ? { id: m.from.id, name: who(m.from) } : null, at: m.date * 1000 }; }
      return;
    }
    if (m.new_chat_members?.length) {
      const names = m.new_chat_members.filter(x => !x.is_bot && !suspect(m, x)).map(who);
      if (names.length) tell(`【TG群 ${hm(m.date * 1000)}】${names.join('、')} 进群了`);
      return;
    }
    if (!m.from || m.from.is_bot) return;
    if (suspect(m, m.from)) return;
    let text = m.text || m.caption || '';
    if (!text && m.sticker) text = `[贴纸${m.sticker.emoji ? ' ' + m.sticker.emoji : ''}]`;
    else if (!text && m.photo) text = '[一张图]';
    else if (!text && (m.video || m.animation)) text = '[一段视频]';
    else if (!text && m.voice) text = '[一条语音]';
    if (!text) return;
    const bot = botU ? new RegExp('@' + botU.replace(/^@/, '').replace(/\W/g, '') + '\\b', 'i') : null;
    if (bot) text = text.replace(new RegExp(bot.source, 'gi'), '');
    text = text.replace(/\s+/g, ' ').trim().slice(0, 300) || '（只@了你）';
    remember(m.message_id, { uid: m.from.id, name: who(m.from), at: m.date * 1000 });
    const r = m.reply_to_message;
    const to = r ? (r.from?.id === botId ? `（回你的「${short(r.text || '')}」）` : `（回 ${who(r.from)}）`) : '';
    const line = `【TG群 ${hm(m.date * 1000)} #${m.message_id}】${who(m.from)}${to}：${text}`;
    tell(line);
  }

  // the group's admins, refreshed every 10 minutes: only non-admins are ever treated as impostors
  let admins = null, adminsAt = 0, botName = '', botU = String(botUser || '');
  async function loadAdmins() {
    if (now() - adminsAt < 10 * 60e3) return;
    adminsAt = now();
    try {
      const list = await api('getChatAdministrators', { chat_id: chatId });
      if (Array.isArray(list)) { admins = new Set(list.map(a => a.user.id)); const me = list.find(a => a.user.id === botId)?.user; botName = who(me) || botName; botU ||= me?.username || ''; }
    } catch (err) { log('tg admins: ' + err.message); }
  }
  const pending = [];   // impostors seen in take(), acted on in poll()
  function suspect(m, u) {
    if (!admins || admins.has(u.id) || u.id === botId) return false;
    const fake = impostor(who(u), { title: m.chat?.title || '', botName, names });
    // a contract address from anyone but an admin is deleted (not banned): the group never keeps addresses scammers can use
    const ca = !fake && !m.new_chat_members && CA.test(m.text || m.caption || '');
    if (!fake && !ca && !promo(m.new_chat_members ? '' : m.text || m.caption || '', who(u))) return false;
    pending.push({ uid: u.id, name: who(u), id: m.new_chat_members ? null : m.message_id, at: m.date * 1000, why: fake ? 'fake' : ca && !promo(m.text || m.caption || '', who(u)) ? 'ca' : 'promo' });
    return true;
  }
  async function sweep() {
    while (pending.length) {
      const p = pending.shift();
      if (p.id) await api('deleteMessage', { chat_id: chatId, message_id: p.id }).catch(() => {});
      if (p.why === 'ca') { log(`tg ca deleted: ${p.name} (${p.uid})`); tell(`【TG群 ${hm(p.at)}】“${p.name}”在群里发了个合约地址，程序已经删了（没踢人）。群里不放地址，他再发你可以说他一句。`); continue; }
      const ok = await api('banChatMember', { chat_id: chatId, user_id: p.uid, revoke_messages: true }).then(() => true, err => { log('tg ban: ' + err.message); return false; });
      log(`tg ${p.why === 'promo' ? 'promo' : 'impostor'} ${ok ? 'banned' : 'ban failed'}: ${p.name} (${p.uid})`);
      if (ok) { s.blocked = [...(s.blocked || []), { uid: p.uid, name: p.name, at: p.at }].slice(-50); tell(p.why === 'promo' ? `【TG群 ${hm(p.at)}】“${p.name}”来拉推广、卖量，程序已经删掉他的消息、把他踢了（不用你管）` : `【TG群 ${hm(p.at)}】有人起名“${p.name}”冒充管理/官方，程序已经删掉他的消息、把他踢了（不用你管）`); }
    }
  }

  async function poll(timeout = 25) {
    await loadAdmins();
    const ups = await api('getUpdates', { offset: s.offset, timeout, allowed_updates: ['message'] }, (timeout + 15) * 1000);
    for (const u of ups || []) { s.offset = u.update_id + 1; try { take(u); } catch (err) { log('tg take: ' + err.message); } }
    await sweep();
    if (ups?.length) save();
    return ups?.length || 0;
  }

  function finish(name, text, how) {
    let to = path.join(done, name);
    if (fs.existsSync(to)) to = path.join(done, name.replace(/(\.\w+)?$/, `-${now()}$1`));
    fs.writeFileSync(to, `${how}\n\n${text}\n`);
    try { fs.rmSync(path.join(want, name)); } catch {}
  }

  async function act(cmd) {
    const rec = s.seen[cmd.id];
    if (!rec) throw new Error(`找不到 #${cmd.id}（太久以前的，或者不是群里的人说的）`);
    if (cmd.act === 'delete') await api('deleteMessage', { chat_id: chatId, message_id: cmd.id });
    if (cmd.act === 'mute') await api('restrictChatMember', { chat_id: chatId, user_id: rec.uid, until_date: Math.floor(now() / 1000) + cmd.secs,
      permissions: { can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false, can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false, can_add_web_page_previews: false } });
    if (cmd.act === 'ban') { await api('deleteMessage', { chat_id: chatId, message_id: cmd.id }).catch(() => {}); await api('banChatMember', { chat_id: chatId, user_id: rec.uid }); }
    return rec;
  }

  // Every half minute: one file at a time, oldest first.
  let busy = false;
  async function scan() {
    if (busy) return; busy = true;
    try {
      if (s.day !== day()) { s.day = day(); s.said = 0; s.acts = 0; }
      let files = [];
      try { files = fs.readdirSync(want).filter(f => /\.(md|txt)$/.test(f)).map(f => ({ f, t: fs.statSync(path.join(want, f)).mtimeMs })).sort((a, b) => a.t - b.t).map(x => x.f); } catch {}
      for (const name of files) {
        if (now() - fs.statSync(path.join(want, name)).mtimeMs < 5e3) continue;
        const raw = fs.readFileSync(path.join(want, name), 'utf8').replace(/\uFFFD+/g, '').trim();
        const [first, ...rest] = raw.split('\n');
        const cmd = parseFirst(first);
        const body = (cmd ? rest.join('\n') : raw).trim();
        const isAct = cmd && !['reply', 'dm'].includes(cmd.act);
        if (!body && !isAct) { finish(name, raw, `（${stamp()}）没发：是空的。`); continue; }
        const why = body ? (body.length > 1000 ? `太长了（${body.length} 字，最多 1000）` : checkPost(body)) : null;
        if (why) { finish(name, raw, `（${stamp()}）没发：${why}。改好了重新放进 ${TG_WANT}/ 就行。`); feed(`【TG群】你想在群里说的「${short(body)}」没发出去：${why}`); continue; }
        if (isAct && s.acts >= actsPerDay) { finish(name, raw, `（${stamp()}）没做：今天管群的动作已经 ${actsPerDay} 次了，明天再说。`); continue; }
        if (body && (s.said >= perDay || now() - s.lastAt < gapMs)) break;   // wait for the gap; the file stays
        const notes = [];
        try {
          if (isAct) {
            const rec = await act(cmd); s.acts++;
            notes.push({ delete: `删了 ${rec.name} 那条`, mute: `把 ${rec.name} 禁言了`, ban: `把 ${rec.name} 踢出去了` }[cmd.act]);
          }
          if (body) {
            if (cmd?.act === 'dm' && !s.dms?.[cmd.uid]) throw new Error(`#私${cmd.uid} 没给你发过私信，机器人不能先找他`);
            const p = { chat_id: cmd?.act === 'dm' ? cmd.uid : chatId, text: body };
            if (cmd?.act === 'reply') p.reply_parameters = { message_id: cmd.id, allow_sending_without_reply: true };
            const sent = await api('sendMessage', p);
            s.said++; s.lastAt = now();
            if (sent?.message_id) remember(sent.message_id, { uid: botId, name: '你自己', at: now() });
            notes.push(cmd?.act === 'dm' ? `私信回了 ${s.dms[cmd.uid]}` : '在群里说了');
          }
          finish(name, raw, `（${stamp()}）${notes.join('，')}`);
          feed(`【TG群】你${notes.join('，')}${body ? `：「${short(body)}」` : ''}`);
          log(`tg: ${notes.join(', ')} (${name})`);
        } catch (err) {
          finish(name, raw, `（${stamp()}）没成：${err.message}`);
          feed(`【TG群】你想做的没成：${short(err.message)}`);
          log('tg: ' + err.message);
        }
        save();
      }
      if (family?.chatId) {
        let ff = [];
        try { ff = fs.readdirSync(fwant).filter(f => /\.(md|txt)$/.test(f)).map(f => ({ f, t: fs.statSync(path.join(fwant, f)).mtimeMs })).sort((a, b) => a.t - b.t).map(x => x.f); } catch {}
        for (const name of ff) {
          if (now() - fs.statSync(path.join(fwant, name)).mtimeMs < 5e3) continue;
          if (now() - (s.famAt || 0) < 15e3) break;
          const raw = fs.readFileSync(path.join(fwant, name), 'utf8').replace(/\uFFFD+/g, '').trim();
          const [first, ...rest] = raw.split('\n'); const cmd = parseFirst(first);
          const body = (cmd?.act === 'reply' ? rest.join('\n') : raw).trim().slice(0, 3000);
          let to = path.join(fdone, name); if (fs.existsSync(to)) to = path.join(fdone, name.replace(/(\.\w+)?$/, `-${now()}$1`));
          if (!body) { fs.writeFileSync(to, `（${stamp()}）没发：是空的。\n`); fs.rmSync(path.join(fwant, name), { force: true }); continue; }
          try {
            const p = { chat_id: family.chatId, text: body };
            if (cmd?.act === 'reply') p.reply_parameters = { message_id: cmd.id, allow_sending_without_reply: true };
            await api('sendMessage', p); s.famAt = now();
            fs.writeFileSync(to, `（${stamp()}）发到运营群了\n\n${raw}\n`);
            feed(`【运营群】你说了：「${short(body)}」`); onFamilySaid?.(body); log(`tg family: sent ${name}`);
          } catch (err) { fs.writeFileSync(to, `（${stamp()}）没发出去：${err.message}\n\n${raw}\n`); feed(`【运营群】你想说的没发出去：${short(err.message)}`); }
          fs.rmSync(path.join(fwant, name), { force: true });
        }
      }
      save();
    } finally { busy = false; }
  }

  return { poll, scan, take, state: () => s };
}
