#!/usr/bin/env node
// Old mouth vs new mouth: the same moments go through two mouth setups (different persona, prompt, heart note or
// model) and land side by side in one markdown file, with the line-lint numbers for each side underneath.
//
//   node run.mjs --a old.json --b new.json --moments moments.json --out out-dir
//
// old.json / new.json: a mouth config (see ../_lib/moments.mjs): provider fields + system_file + note_file + recent.
// Tip: change ONE thing between A and B (only the persona, or only the model), otherwise you cannot tell what helped.
import fs from 'node:fs';
import path from 'node:path';
import { runMoments, readJSON } from '../_lib/moments.mjs';
import { lint } from '../line-lint/lint.mjs';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const [fa, fb, fm] = [opt('--a'), opt('--b'), opt('--moments')];
if (!fa || !fb || !fm) { console.error('usage: node run.mjs --a old.json --b new.json --moments moments.json [--out dir]'); process.exit(2); }
const OUT = path.resolve(opt('--out') || 'mouth-compare-out');
const moments = readJSON(fm);
const A = { name: 'A', ...readJSON(fa) }, B = { name: 'B', ...readJSON(fb) };
const ra = await runMoments(A, moments, { base: path.dirname(path.resolve(fa)), log: console.log });
const rb = await runMoments(B, moments, { base: path.dirname(path.resolve(fb)), log: console.log });

const stat = r => {
  const L = lint(r.lines.filter(l => !l.failed).map(l => ({ who: 'host', text: l.text, at: null, name: '', to: '' })));
  const ph = Object.entries(L.phrases).filter(([, v]) => v.length).map(([k, v]) => `${k} ${v.length}`).join(', ') || 'none';
  return `${r.name}: avg ${L.length.mean} chars (sd ${L.length.sd}), questions ${Math.round(L.questionShare * 100)}%, repeats ${L.repeats.length}, phrase hits: ${ph}, worn: ${L.worn.slice(0, 3).map(w => w.word).join(' ') || 'none'}, failed ${r.lines.filter(l => l.failed).length}, $${r.usd.toFixed(4)}, ${r.avgMs} ms/line`;
};
const md = [`# ${A.name} vs ${B.name}`, '', `- ${stat(ra)}`, `- ${stat(rb)}`, '',
  ...moments.map((m, k) => `## ${k + 1}. ${m.label ? `[${m.label}] ` : ''}${m.more ? '(quiet, keep going)' : m.say}\n- ${A.name}: ${ra.lines[k].text}\n- ${B.name}: ${rb.lines[k].text}\n`)].join('\n');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'compare.md'), md);
fs.writeFileSync(path.join(OUT, 'compare.json'), JSON.stringify({ a: ra, b: rb }, null, 1));
console.log('wrote', path.join(OUT, 'compare.md'));
