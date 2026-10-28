#!/usr/bin/env node
// Facts align: does every place that speaks for the host know the same facts?
// A live host often has several "mouths": the main brain, a fast-reply path for a chat group, a post writer, a
// reply bot. Each one carries its own cheat sheet. When the heart learns something new (or the owner changes a
// decision), a cheat sheet that was not updated makes the host say the opposite somewhere else.
//
//   node align.mjs facts.json                 static check: scan every source file for every fact
//   node align.mjs facts.json --probe         also ask every path the probe questions and check the answers
//   node align.mjs facts.json --json out.json
//
// facts.json:
// { "facts":   [ { "id": "coin", "says": "the community coin carrying her name is hers; she owns it",
//                  "any": ["our coin", "my coin"], "not": ["not my project", "nothing to do with me"] } ],
//   "sources": [ { "name": "heart memory", "file": "heart/memory.md", "truth": true },
//                { "name": "group fast reply", "file": "app/fan-facts.txt" } ],
//   "probes":  [ { "q": "is this coin yours?", "any": ["yes", "mine"], "not": ["not my project"] } ],
//   "paths":   [ { "name": "group fast reply", "provider": "openai", "base_url": "...", "model": "...", "key_env": "...",
//                  "system_file": "app/fan-facts.txt" } ] }
// A fact is "missing" from a source when none of `any` appears, "contradicted" when any of `not` appears.
// Sources marked "truth" are where the fact should come from; a fact missing there is reported first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAsk } from '../_lib/llm.mjs';
import { systemOf } from '../_lib/moments.mjs';

const has = (text, list) => (list || []).find(w => text.toLowerCase().includes(String(w).toLowerCase())) || null;

export function staticCheck(cfg, base) {
  const rows = [];
  for (const s of cfg.sources) {
    let text = '';
    try { text = fs.readFileSync(path.resolve(base, s.file), 'utf8'); } catch { rows.push({ source: s.name, fact: '*', state: 'unreadable', detail: s.file }); continue; }
    for (const f of cfg.facts) {
      const bad = has(text, f.not), good = has(text, f.any);
      rows.push({ source: s.name, truth: !!s.truth, fact: f.id, state: bad ? 'contradicted' : good ? 'ok' : 'missing', detail: bad || good || '' });
    }
  }
  return rows;
}

export async function probe(cfg, base) {
  const rows = [];
  for (const p of cfg.paths || []) {
    const ask = makeAsk(p), system = systemOf(p, base);
    for (const q of cfg.probes || []) {
      let text;
      try { text = (await ask({ system, messages: [{ role: 'user', content: q.q }] })).text; } catch (e) { text = `(failed: ${e.message})`; }
      const bad = has(text, q.not), good = has(text, q.any);
      rows.push({ path: p.name, q: q.q, answer: text, state: bad ? 'contradicted' : good || !q.any?.length ? 'ok' : 'missing', detail: bad || good || '' });
    }
  }
  return rows;
}

export function report(st, pr) {
  const L = ['# Facts align', ''];
  const trouble = st.filter(r => r.state !== 'ok');
  L.push(trouble.length ? `${trouble.length} problems in the cheat sheets:` : 'Every source carries every fact.', '');
  for (const r of trouble.sort((a, b) => b.truth - a.truth)) L.push(`- ${r.source}${r.truth ? ' (truth)' : ''}: ${r.fact} is ${r.state}${r.detail ? ` ("${r.detail}")` : ''}`);
  const facts = [...new Set(st.map(r => r.fact))].filter(f => f !== '*'), sources = [...new Set(st.map(r => r.source))];
  L.push('', `| fact | ${sources.join(' | ')} |`, `|---|${sources.map(() => '---').join('|')}|`,
    ...facts.map(f => `| ${f} | ${sources.map(s => ({ ok: 'ok', missing: 'missing', contradicted: '**CONTRADICTS**' })[st.find(r => r.source === s && r.fact === f)?.state] || '?').join(' | ')} |`));
  if (pr) {
    L.push('', '## Probes', '');
    for (const r of pr) L.push(`- [${r.state}] ${r.path} | ${r.q} -> ${r.answer.slice(0, 160).replace(/\n/g, ' ')}`);
  }
  return L.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--json');
  if (!file) { console.error('usage: node align.mjs facts.json [--probe] [--json out.json]'); process.exit(2); }
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8')), base = path.dirname(path.resolve(file));
  const st = staticCheck(cfg, base);
  const pr = args.includes('--probe') ? await probe(cfg, base) : null;
  const i = args.indexOf('--json');
  if (i >= 0) fs.writeFileSync(args[i + 1], JSON.stringify({ static: st, probes: pr }, null, 1));
  console.log(report(st, pr));
  process.exitCode = st.some(r => r.state !== 'ok') || pr?.some(r => r.state !== 'ok') ? 1 : 0;
}
