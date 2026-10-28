#!/usr/bin/env node
// Old heart vs new heart: replay the same real "beats" (what the heart was fed at one moment) through two heart
// setups, each on its own scratch copy of the heart's home folder, and record what each one said back and which
// files it wrote. Nothing is sent anywhere; your real heart home is only copied, never touched.
//
//   node run.mjs --home ./heart-home --beats beats.json --a "<command>" --b "<command>" [--a-overlay dir] [--b-overlay dir] [--out dir] [--timeout 300]
//
// beats.json: [ { "label": "on air, busy", "lines": ["[chat 20:01] Sam: ...", "[market] BTC -2% in 5 min", ...] }, ... ]
//   (copy them from your heart's own log: the lines it received in one beat)
// <command>: how to run ONE beat of your heart. It runs in a shell with:
//   HEART_HOME   the scratch copy of the home folder (read and write here)
//   HEART_STATE  an empty scratch state folder (sessions, caches)
//   stdin        the beat's lines, one per line
//   stdout       whatever the heart "said" (its reply / its note), recorded as-is
// --a-overlay / --b-overlay: a folder whose files are copied over the scratch home before the run, e.g. a new
// instructions file for B only. Change one thing at a time.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const home = opt('--home'), beatsFile = opt('--beats');
if (!home || !beatsFile || !opt('--a') || !opt('--b')) { console.error('usage: node run.mjs --home dir --beats beats.json --a "<cmd>" --b "<cmd>" [--a-overlay dir] [--b-overlay dir] [--out dir]'); process.exit(2); }
const OUT = path.resolve(opt('--out') || 'heart-compare-out');
const timeoutMs = Number(opt('--timeout') || 300) * 1000;
const beats = JSON.parse(fs.readFileSync(beatsFile, 'utf8'));

const walk = (d, base = d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p, base) : e.isFile() ? [path.relative(base, p)] : [];
});
const snap = d => Object.fromEntries(walk(d).map(f => [f, crypto.createHash('sha1').update(fs.readFileSync(path.join(d, f))).digest('hex')]));

function runBeat(cmd, dir, state, lines) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const ch = spawn(cmd, { shell: true, env: { ...process.env, HEART_HOME: dir, HEART_STATE: state }, cwd: dir });
    let out = '', err = '';
    const timer = setTimeout(() => { ch.kill('SIGKILL'); err += '\n(timeout)'; }, timeoutMs);
    ch.stdout.on('data', d => (out += d));
    ch.stderr.on('data', d => (err += d));
    ch.on('close', code => { clearTimeout(timer); resolve({ said: out.trim(), err: code ? err.trim().slice(-400) : '', code, ms: Date.now() - t0 }); });
    ch.stdin.end(lines.join('\n') + '\n');
  });
}

const res = [];
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'heart-cmp-'));
for (const side of ['a', 'b']) {
  const cmd = opt('--' + side), overlay = opt(`--${side}-overlay`);
  for (const [i, b] of beats.entries()) {
    const dir = path.join(scratch, `${side}-${i}`, 'home'), state = path.join(scratch, `${side}-${i}`, 'state');
    fs.cpSync(home, dir, { recursive: true });
    fs.mkdirSync(state, { recursive: true });
    if (overlay) fs.cpSync(overlay, dir, { recursive: true });
    const before = snap(dir);
    const r = await runBeat(cmd, dir, state, b.lines);
    const after = snap(dir);
    const changed = Object.keys(after).filter(f => before[f] !== after[f]);
    const removed = Object.keys(before).filter(f => !(f in after));
    const files = Object.fromEntries(changed.map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8').slice(-600)]));
    res.push({ side, beat: i, label: b.label || '', lines: b.lines.slice(-12), ...r, changed, removed, files });
    console.log(side, i, (r.ms / 1000).toFixed(1) + 's', r.code ? `exit ${r.code}` : r.said.slice(0, 70).replace(/\n/g, ' '));
  }
}
fs.rmSync(scratch, { recursive: true, force: true });

const md = ['# Heart A vs B', '', `A: \`${opt('--a')}\`${opt('--a-overlay') ? ` + overlay ${opt('--a-overlay')}` : ''}`, `B: \`${opt('--b')}\`${opt('--b-overlay') ? ` + overlay ${opt('--b-overlay')}` : ''}`, ''];
for (const [i, b] of beats.entries()) {
  md.push(`## Beat ${i + 1}${b.label ? `: ${b.label}` : ''}`, '', 'Fed:', '', ...b.lines.slice(-12).map(l => `> ${l}`), '');
  for (const side of ['a', 'b']) {
    const r = res.find(x => x.side === side && x.beat === i);
    md.push(`### ${side.toUpperCase()} (${(r.ms / 1000).toFixed(1)} s${r.code ? `, exit ${r.code}` : ''})`, '', r.said ? r.said.split('\n').map(l => `> ${l}`).join('\n') : '(said nothing)', '',
      `Files written: ${r.changed.join(', ') || 'none'}${r.removed.length ? `; removed: ${r.removed.join(', ')}` : ''}`, '',
      ...Object.entries(r.files).flatMap(([f, t]) => [`<details><summary>${f} (last 600 chars)</summary>`, '', '```', t, '```', '</details>', '']),
      ...(r.err ? ['```', r.err, '```', ''] : []));
  }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'compare.md'), md.join('\n'));
fs.writeFileSync(path.join(OUT, 'compare.json'), JSON.stringify(res, null, 1));
console.log('wrote', path.join(OUT, 'compare.md'));
