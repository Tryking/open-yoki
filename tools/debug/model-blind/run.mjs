#!/usr/bin/env node
// Blind model test: the same show moments go through every candidate model (same persona, same prompts); a page
// shuffles the answers per moment so a person picks "which one sounds like a real host" without knowing the model.
//
//   node run.mjs --candidates candidates.json --moments moments.json --out out-dir
//   node run.mjs --answers answers.json --out out-dir      (build the page from answers you collected yourself)
//
// candidates.json: { "system_file": "persona.md", "recent": 6,
//                    "candidates": [ { "name": "A", "provider": "openai", "base_url": "...", "model": "...", "key_env": "MY_KEY" }, ... ] }
//   any field of a candidate overrides the shared one (e.g. a candidate with its own system_file).
// answers.json:    { "candidates": ["A","B"], "moments": [ { "label": "...", "in": "...", "answers": { "A": "...", "B": "..." } } ] }
// Writes blind.html (open it in a browser, vote, press the result button) and key.json (which answer was which).
import fs from 'node:fs';
import path from 'node:path';
import { runMoments, readJSON } from '../_lib/moments.mjs';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const OUT = path.resolve(opt('--out') || 'model-blind-out');
const seed = Number(opt('--seed') || Date.now() % 100000);
let rnd = seed * 7919 % 2147483647 || 1;
const random = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;

let names, items, stats = {};
if (opt('--answers')) {
  const a = readJSON(opt('--answers'));
  names = a.candidates;
  items = a.moments.map(m => ({ label: m.label || '', ctx: m.in || '', answers: names.map(n => m.answers[n] ?? '(missing)') }));
} else {
  const cf = opt('--candidates'), mf = opt('--moments');
  if (!cf || !mf) { console.error('need --candidates and --moments (or --answers)'); process.exit(2); }
  const C = readJSON(cf), moments = readJSON(mf), base = path.dirname(path.resolve(cf));
  const shared = { ...C }; delete shared.candidates;
  const runs = [];
  for (const c of C.candidates) runs.push(await runMoments({ ...shared, ...c }, moments, { base, log: console.log }));
  names = runs.map(r => r.name);
  // a "keep going" moment shows no previous line: each model kept going from its own, and showing one would give it away
  items = moments.map((m, k) => ({ label: m.label || '', ctx: m.more ? '(nobody typed; each answer keeps going from its own last line)' : m.say, answers: runs.map(r => r.lines[k].text) }));
  stats = Object.fromEntries(runs.map(r => [r.name, { usd: r.usd, avgMs: r.avgMs }]));
}

// shuffle per moment; the page carries the key encoded and only decodes it when asked for the result
const order = items.map(() => names.map((_, i) => i).sort(() => random() - 0.5));
const key = { models: names, order, stats, seed };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 1));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const letters = 'ABCDEFGHIJ';
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blind test: which line sounds like a person</title>
<style>body{font:16px/1.6 -apple-system,"PingFang SC",sans-serif;max-width:760px;margin:0 auto;padding:24px 16px 80px;background:#111318;color:#ece6d8}
h1{font-size:22px}.m{margin:28px 0;padding-top:16px;border-top:1px solid #2a2d36}.w{color:#8d8a99;font-size:14px}.c{margin:4px 0 10px;color:#c9c3b4}
label{display:flex;gap:10px;padding:10px 12px;margin:6px 0;border:1px solid #2a2d36;border-radius:10px;cursor:pointer}
label:has(input:checked){border-color:#f0b90b;background:#1d1a10}b{color:#f0b90b}button{font:inherit;padding:10px 18px;border-radius:10px;border:0;background:#f0b90b;color:#111;cursor:pointer}
#res{white-space:pre-wrap;margin-top:16px}</style>
<h1>Which line sounds most like a real host? / 哪句最像真人主播说的？</h1>
<p>Same moment, ${names.length} answers, order shuffled every time. Pick one per moment, then press the button.<br>同一个场景，每题答案顺序都打乱了。每题选一句最像真人的，最后点按钮看结果。</p>
${items.map((it, k) => `<div class="m"><div class="w">${k + 1}. ${esc(it.label)}</div>${it.ctx ? `<div class="c">${esc(it.ctx)}</div>` : ''}
${order[k].map((i, j) => `<label><input type="radio" name="q${k}" value="${j}"><span><b>${letters[j]}</b>&nbsp; ${esc(it.answers[i])}</span></label>`).join('')}</div>`).join('')}
<button id="go">Show result / 看结果</button><div id="res"></div>
<script>
document.getElementById('go').onclick = () => {
  const key = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('${Buffer.from(JSON.stringify(key)).toString('base64')}'), c => c.charCodeAt(0))));
  const n = key.models.map(() => 0); let picked = 0;
  key.order.forEach((o, k) => { const v = document.querySelector('input[name=q' + k + ']:checked'); if (v) { n[o[+v.value]]++; picked++; } });
  document.getElementById('res').textContent = 'Answered ' + picked + ':\\n' + key.models.map((m, i) => m + ': ' + n[i] + ' votes' +
    (key.stats[m] ? ' (avg ' + (key.stats[m].avgMs / 1000).toFixed(1) + ' s per line, $' + key.stats[m].usd.toFixed(4) + ')' : '')).join('\\n');
};
</script></html>`;
fs.writeFileSync(path.join(OUT, 'blind.html'), html);
console.log('wrote', path.join(OUT, 'blind.html'));
for (const [m, s] of Object.entries(stats)) console.log(m, s.avgMs + 'ms avg', '$' + s.usd.toFixed(4));
