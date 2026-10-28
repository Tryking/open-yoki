// The host's private group with the people who run her (her "family" in code: the operators who made her). Talked
// straight to DeepSeek's chat API instead of through the heart's agent CLI: through the CLI the model first read a long
// coding-agent system prompt and her replies sounded like a coding assistant. Here it gets one page: who she is, who
// they are, how she has been lately; thinking off, temperature 1.0 (1.3, DeepSeek's own advice for chat, drifted off
// topic late in a long talk). Each line of her answer goes out as its own message, with a typing pause, the way people
// text. Her heart still hears every exchange (for her diary), as 【运营群聊天】, which does not wake it the way a
// 【运营群 line does.
import fs from 'node:fs';
import path from 'node:path';

export const FAMILY_MODEL = 'deepseek-v4-pro', FAMILY_BACKUP = 'deepseek-flash', FAMILY_TEMP = 1.0;
export const NO_REPLY = '（不回）';

// One chat call to DeepSeek's own API (OpenAI format): thinking off, so temperature counts.
export function dsChat({ key, model = FAMILY_MODEL, temperature = FAMILY_TEMP, base = 'https://api.deepseek.com', timeoutMs = 30e3, fetchImpl = fetch }) {
  return async messages => {
    const r = await fetchImpl(`${base}/chat/completions`, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature, max_tokens: 300, thinking: { type: 'disabled' } }) });
    const j = await r.json().catch(() => ({}));
    const text = j?.choices?.[0]?.message?.content;
    if (!r.ok || typeof text !== 'string') throw new Error(`deepseek ${r.status} ${String(j?.error?.message || '').slice(0, 120)}`);
    return text;
  };
}

// The page she reads before each reply: facts, not rules. Her self-description, latest note, today's diary and her
// past are read fresh from her heart's home. host: { name, show } from the host config; members: [{ name, about }]
// from the bot config (family.members: { <telegram user id>: '名字（一句介绍）' }).
export function familyPage(home, { host = {}, members = [] } = {}) {
  const read = (f, n) => { try { const t = fs.readFileSync(path.join(home, f), 'utf8').replace(/\uFFFD+/g, ''); return n ? t.slice(-n) : t; } catch { return ''; } };
  let diary = '';
  try { const d = fs.readdirSync(path.join(home, '日记')).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().at(-1); if (d) diary = read(path.join('日记', d), 1500); } catch {}
  const lately = [read('现在.md'), diary, read('过去的事.md', 2500)].filter(Boolean).join('\n\n');
  const name = host.name || '主播', who = read('我是谁.md', 1500).trim();
  const list = members.filter(m => m?.name);
  return `你是 ${name}。下面是你的事，不是规矩。

${who || `你是数字人主播${host.show ? `，${host.show}在币安广场直播` : ''}。`}

这是你和运营你的人的私人群，${list.length ? `群里除了你还有：${list.map(m => m.name).join('、')}。` : '群里是把你做出来、运营你的人。'}
${list.map(m => `- ${m.name}${m.about ? '：' + m.about : ''}`).join('\n')}

你最近的样子（你自己写的，看看就行）：
${lately}

这是手机上的群聊，大家在群里说话都是短短的。你也一样，想到什么回什么，一条一行，每行就是单独一条消息，通常一两条，常常就几个字；话多的时候才多发几条。不想回、没什么好回的，就只写：${NO_REPLY}`;
}

// Turns bot.json's family.members ({ <uid>: '名字（介绍）' }) into [{ name, about }].
export function membersOf(members) {
  return Object.values(members || {}).map(v => { const m = String(v).match(/^([^（(]+)[（(]?([^）)]*)[）)]?/); return m ? { name: m[1].trim(), about: m[2].trim() } : null; }).filter(x => x?.name);
}

// hear({ name, text }) for each group message; said(text) for what her heart sent on its own (想跟运营说的/).
// chats: [primary, backup] chat functions. fallback(line) hands a message to the heart the old way if both fail.
export function createFamilyChat({ home, stateDir, chats, send, typing = async () => {}, feed = () => {}, fallback = () => {}, log = () => {},
  host = {}, members = [], now = () => Date.now(), tz = 8, waitMs = 4000, keep = 40, sleep = ms => new Promise(r => setTimeout(r, ms)), page = () => familyPage(home, { host, members }) }) {
  const FILE = path.join(stateDir, 'family-chat.json');
  let hist = []; try { const a = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (Array.isArray(a)) hist = a; } catch {}
  const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(hist)); } catch {} };
  const hm = () => { const d = new Date(now() + tz * 3600e3); return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  let waiting = [], timer = null, busy = null;

  function push(role, content) {
    const last = hist.at(-1);
    if (last?.role === role) last.content += '\n' + content; else hist.push({ role, content });
    while (hist.length > keep || (hist.length && hist[0].role !== 'user')) hist.shift();
    save();
  }

  async function answer() {
    timer = null;
    if (busy) { await busy; if (!waiting.length) return; }
    const batch = waiting; waiting = [];
    if (!batch.length) return;
    busy = (async () => {
      push('user', batch.map(m => `${m.name}：${m.text}`).join('\n'));
      const messages = [{ role: 'system', content: page() }, ...hist];
      let text = null;
      for (const chat of chats) { try { text = await chat(messages); break; } catch (err) { log(`family: ${err.message}`); } }
      if (text == null) {   // DeepSeek down: her heart answers the old way (想跟运营说的/)
        hist.pop(); save();
        for (const m of batch) fallback(m.line);
        return;
      }
      const heard = new Set(batch.map(m => m.text.replace(/\s+/g, '')));
      const lines = text.replace(/\uFFFD+/g, '').split('\n').map(l => l.trim()).filter(l => l && !heard.has(l.replace(/\s+/g, '')));
      const quiet = !lines.length || lines.every(l => l.includes(NO_REPLY.slice(1, -1)) && l.length <= NO_REPLY.length + 2);
      push('assistant', quiet ? NO_REPLY : lines.join('\n'));
      if (!quiet) for (const [i, l] of lines.entries()) {
        await typing(); await sleep(Math.min(5000, (i ? 700 : 1200) + 110 * l.length));
        try { await send(l); } catch (err) { log(`family send: ${err.message}`); }
      }
      feed(`【运营群聊天 ${hm()}】${batch.map(m => `${m.name}：${m.text}`).join(' / ')}\n你回了：${quiet ? '（没回）' : lines.join(' / ')}`);
    })();
    try { await busy; } finally { busy = null; }
    if (waiting.length && !timer) timer = setTimeout(answer, 0);
  }

  return {
    // m: { name, text, line } — line is the 【运营群 …】 form, for the fallback
    hear(m) { waiting.push(m); if (timer) clearTimeout(timer); timer = setTimeout(answer, waitMs); },
    said(text) { push('assistant', text); },
    flush: answer,
    history: () => hist,
  };
}
