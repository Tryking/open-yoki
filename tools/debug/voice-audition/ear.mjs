#!/usr/bin/env node
// Blind ear: let an audio-capable model label the emotion of every take without knowing which one it was meant to
// be, then count how often the label matches. If a listener cannot hear "angry" in the angry take, the take is flat,
// no matter what the style instruction said.
//
//   node ear.mjs --work work/ --lines lines.json --model ear.json [--files "stitched,whole-level"] [--labels "excited,angry,..."] [--seed 1]
//   node ear.mjs --score blind.json --lines lines.json     (just recount an earlier result)
//
// ear.json: an OpenAI-compatible provider that accepts input_audio parts, e.g.
//   { "name": "ear", "provider": "openai", "base_url": "https://openrouter.ai/api/v1", "model": "<an audio model>", "key_env": "OPENROUTER_API_KEY" }
// The takes of one line are sent together, shuffled, as "clip 1..N"; the model answers one line per clip:
//   clip N | label | strength 0-10 | real non-speech sounds heard (crack, sob, yawn, gasp, laugh) or none
// Writes work/blind-<seed>.json and prints a hit table per emotion and per file kind.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeListen } from '../_lib/llm.mjs';

export function parseAnswer(txt, names) {
  const out = {};
  for (const l of String(txt).split('\n')) {
    const m = l.match(/clip\s*(\d+)\s*\|([^|]+)\|\s*([\d.]+)\s*\|(.*)/i);
    if (m && names[m[1] - 1]) out[names[m[1] - 1]] = { label: m[2].trim(), strength: +m[3], sounds: m[4].trim() };
  }
  return out;
}

export function score(blind, lines) {
  const want = Object.fromEntries(lines.map(l => [l.id, l.emo]));
  const rows = {};
  for (const [key, v] of Object.entries(blind)) {
    const [id, kind] = key.split('/'), emo = want[id];   // kind = file name without .wav, e.g. my-clone-stitched
    if (!emo) continue;
    for (const k of [`emotion ${emo}`, `file ${kind}`]) {
      rows[k] ??= { n: 0, hit: 0, strength: 0 };
      rows[k].n++; rows[k].strength += v.strength || 0;
      if (v.label.toLowerCase().includes(emo.toLowerCase())) rows[k].hit++;
    }
  }
  return Object.entries(rows).sort().map(([k, r]) => ({ group: k, takes: r.n, heard_right: r.hit, rate: +(r.hit / r.n).toFixed(2), avg_strength: +(r.strength / r.n).toFixed(1) }));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const lines = JSON.parse(fs.readFileSync(opt('--lines') || 'lines.json', 'utf8'));
  let blind;
  if (opt('--score')) blind = JSON.parse(fs.readFileSync(opt('--score'), 'utf8'));
  else {
    const W = opt('--work') || 'work', cfg = JSON.parse(fs.readFileSync(opt('--model') || 'ear.json', 'utf8'));
    const kinds = (opt('--files') || 'stitched,whole-level').split(',');
    const labels = (opt('--labels') || [...new Set(lines.map(l => l.emo)), 'calm/neutral'].join(',')).split(',');
    let s = Number(opt('--seed') || 1) * 7919; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const listen = makeListen(cfg);
    blind = {};
    for (const l of lines) {
      const d = path.join(W, l.id);
      if (!fs.existsSync(d)) continue;
      const files = fs.readdirSync(d).filter(f => f.endsWith('.wav') && kinds.some(k => f.endsWith(`-${k}.wav`))).sort(() => rnd() - 0.5);
      if (!files.length) continue;
      const content = [{ type: 'text', text: `Below are ${files.length} clips of the same voice saying the same words. Judge only HOW it sounds, not what the words mean.
Answer one line per clip, nothing else, in this format:
clip N | label | strength 0-10 | real non-speech sounds you hear (crack, sob, yawn, gasp, laugh) or none
Pick the label from: ${labels.join(', ')}.` }];
      files.forEach((f, k) => content.push({ type: 'text', text: `clip ${k + 1}:` }, { type: 'input_audio', input_audio: { data: fs.readFileSync(path.join(d, f)).toString('base64'), format: 'wav' } }));
      const r = await listen(content, files);
      const got = parseAnswer(r.text, files);
      for (const [f, v] of Object.entries(got)) blind[`${l.id}/${f.replace(/\.wav$/, '')}`] = v;
      console.log(l.id, Object.keys(got).length + '/' + files.length, 'labelled');
    }
    fs.writeFileSync(path.join(W, `blind-${opt('--seed') || 1}.json`), JSON.stringify(blind, null, 1));
  }
  console.table(score(blind, lines));
}
