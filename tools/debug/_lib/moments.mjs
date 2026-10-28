// Run the same list of show moments through one "mouth" and collect what it says.
// moments.json: [{ "label": "chat", "say": "<what the host is told>" } | { "label": "...", "more": true }]
//   "say" is the event text exactly as your app would hand it to the model (e.g. "[chat] Sam: is BTC going up?").
//   "more": true means "nobody typed; keep going from your last line" and is filled with the previous answer.
// mouth config: provider fields (see llm.mjs) + system / system_file + optional note / note_file (the heart's
// "right now" note, appended to the system prompt) + recent: N (append the last N answers so the model can avoid
// repeating itself, like a live brain does).
import fs from 'node:fs';
import path from 'node:path';
import { makeAsk } from './llm.mjs';

export const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const readMaybe = (base, f) => (f ? fs.readFileSync(path.resolve(base, f), 'utf8') : '');

export function systemOf(cfg, base = '.') {
  const sys = cfg.system ?? readMaybe(base, cfg.system_file);
  const note = cfg.note ?? readMaybe(base, cfg.note_file);
  return note ? `${sys}\n\n[What is on your mind right now]\n${note.trim()}` : sys;
}

export async function runMoments(cfg, moments, { base = '.', timeoutMs = 60000, log = () => {} } = {}) {
  const ask = makeAsk(cfg);
  const system = systemOf(cfg, base);
  const said = [], out = [];
  let usd = 0;
  for (const [k, m] of moments.entries()) {
    const prev = said.at(-1) || '';
    let user = m.more ? `${m.say || 'Nobody is typing. Keep going from your last line, do not repeat it.'}\nYour last line: ${prev}` : m.say;
    if (cfg.recent && said.length) user += `\n\nYou just said:\n${said.slice(-cfg.recent).map(t => '- ' + t).join('\n')}\nSay it differently this time.`;
    let got, timer;
    try {
      got = await Promise.race([
        ask({ system, messages: [{ role: 'user', content: user }] }),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), timeoutMs); }),
      ]);
      if (!got.text) got.text = '(no answer)';
    } catch (e) { got = { text: `(failed: ${String(e.message).slice(0, 80)})`, ms: 0, cost: 0, failed: true }; }
    finally { clearTimeout(timer); }
    usd += got.cost || 0;
    said.push(got.text);
    out.push({ label: m.label || '', in: m.more ? `(quiet, keep going) ${prev}` : m.say, text: got.text, ms: got.ms, failed: !!got.failed });
    log(`${cfg.name} ${k + 1}/${moments.length} ${got.ms}ms ${got.text.slice(0, 50)}`);
  }
  const ok = out.filter(o => !o.failed);
  return { name: cfg.name, lines: out, usd, avgMs: ok.length ? Math.round(ok.reduce((a, b) => a + b.ms, 0) / ok.length) : 0 };
}
