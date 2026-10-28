#!/usr/bin/env node
// Put each line's chunks back together the way a person says it: trim silence around every chunk, bring every chunk
// to the same level first, then apply its planned gain (dB) and the pause before it (ms; negative = she cuts in over
// her own tail, crossfaded). Many TTS engines flatten loudness, so the swings are put back here.
//
//   node stitch.mjs --work work/ --lines lines.json --voice my-clone
// Writes work/<id>/<voice>-stitched.wav and a level-matched <voice>-whole-level.wav to compare against.
import fs from 'node:fs';
import path from 'node:path';
import { load, writeWav, rms, db, concat } from './audio.mjs';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const W = opt('--work') || 'work', V = opt('--voice'), SR = Number(opt('--sr') || 24000);
const lines = JSON.parse(fs.readFileSync(opt('--lines') || 'lines.json', 'utf8'));

export function trim(x, floorDb = -40, pad = 0.03) {
  const h = Math.floor(0.01 * SR), e = [];
  for (let i = 0; i + h <= x.length; i += h) e.push(rms(x, i, i + h));
  const top = Math.max(...e, 1e-9), on = e.map((v, i) => [db(v / top), i]).filter(([v]) => v > floorDb).map(([, i]) => i);
  if (!on.length) return x;
  return x.slice(Math.max(0, on[0] * h - pad * SR), Math.min(x.length, (on.at(-1) + 1) * h + pad * SR));
}
const limit = x => { const pk = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0); if (pk <= 0.97) return x; return pk < 1.6 ? x.map(v => Math.tanh(v * 1.2) / Math.tanh(1.2) * 0.97) : x.map(v => v / pk * 0.97); };

for (const l of lines) {
  const d = path.join(W, l.id);
  if (!fs.existsSync(d)) continue;
  const whole = path.join(d, `${V}-whole.wav`);
  if (fs.existsSync(whole)) { const x = trim(load(whole, SR)), g = 0.1 / (rms(x) + 1e-9); writeWav(path.join(d, `${V}-whole-level.wav`), limit(x.map(v => v * g)), SR); }
  const parts = [];
  for (const [i, c] of l.chunks.entries()) {
    const p = path.join(d, `${V}-chunk-${i}.wav`);
    if (!fs.existsSync(p)) { parts.length = 0; break; }
    const x = trim(load(p, SR)), g = 0.1 / (rms(x) + 1e-9) * 10 ** ((c.gain || 0) / 20);
    parts.push([x.map(v => v * g), c.gap || 0]);
  }
  if (!parts.length) continue;
  let out = parts[0][0];
  for (const [x, gap] of parts.slice(1)) {
    const g = Math.round(gap / 1000 * SR);
    if (g >= 0) out = concat([out, new Float32Array(g), x]);
    else {
      const n = Math.min(-g, x.length, out.length), mid = new Float32Array(n);
      for (let i = 0; i < n; i++) { const f = i / n; mid[i] = out[out.length - n + i] * (1 - f) + x[i] * f; }
      out = concat([out.slice(0, out.length - n), mid, x.slice(n)]);
    }
  }
  writeWav(path.join(d, `${V}-stitched.wav`), limit(out), SR);
  console.log(l.id, V, (out.length / SR).toFixed(1) + 's');
}
