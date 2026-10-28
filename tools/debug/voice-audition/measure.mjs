#!/usr/bin/env node
// How much does a take move? Compare your synthetic voice with a real recording of a person saying similar lines.
// Per file: pitch range (semitones between the 10th and 90th percentile of voiced pitch) and spread (std),
// loudness range (dB between loud and quiet 300 ms stretches while talking), tempo ratio (fastest phrase vs slowest,
// syllable-like peaks per second; phrases split at pauses >= 180 ms).
// A flat, "AI-sounding" take scores low on all three. Real people speaking with feeling move a lot more.
//
//   node measure.mjs file_or_dir ... [--json out.json]
// Pure JS (YIN pitch); ffmpeg only needed for non-WAV input.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, rms, db, percentile } from './audio.mjs';

const SR = 16000;

// YIN pitch per 10 ms frame; NaN when unvoiced
export function pitchTrack(x, { fmin = 100, fmax = 1000, frame = 1024, hop = 160, thresh = 0.15 } = {}) {
  const tmin = Math.floor(SR / fmax), tmax = Math.ceil(SR / fmin), out = [];
  const loud = rms(x) * 0.25;
  const d = new Float64Array(tmax + 1);
  for (let s = 0; s + frame + tmax < x.length; s += hop) {
    if (rms(x, s, s + frame) < loud) { out.push(NaN); continue; }
    d[0] = 0; let run = 0, best = -1;
    for (let t = 1; t <= tmax; t++) {
      let acc = 0;
      for (let i = 0; i < frame; i++) { const v = x[s + i] - x[s + i + t]; acc += v * v; }
      run += acc; d[t] = run ? acc * t / run : 1;
    }
    for (let t = tmin; t <= tmax; t++) if (d[t] < thresh) { while (t + 1 <= tmax && d[t + 1] < d[t]) t++; best = t; break; }
    if (best < 0) { out.push(NaN); continue; }
    // parabolic interpolation around the dip
    const a = d[best - 1] ?? d[best], b = d[best], c = d[best + 1] ?? d[best];
    const shift = (a - 2 * b + c) ? (a - c) / (2 * (a - 2 * b + c)) : 0;
    out.push(SR / (best + shift));
  }
  return out;
}

export function measure(x) {
  const peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  x = x.map(v => v / peak);
  const f0 = pitchTrack(x).filter(v => !Number.isNaN(v));
  let st = f0.map(v => 12 * Math.log2(v / 100));
  // drop octave jumps: a frame more than 9 semitones off the median of its 9 neighbours
  st = st.filter((v, i) => { const w = st.slice(Math.max(0, i - 4), i + 5).sort((a, b) => a - b); return Math.abs(v - w[w.length >> 1]) < 9; });
  const mean = st.reduce((a, b) => a + b, 0) / (st.length || 1);
  const pitchRange = st.length ? percentile(st, 90) - percentile(st, 10) : 0;
  const pitchStd = st.length ? Math.sqrt(st.reduce((a, b) => a + (b - mean) ** 2, 0) / st.length) : 0;
  // loudness, 300 ms windows / 50 ms hop, only windows within 35 dB of the loudest
  const win = 0.3 * SR, hop = 0.05 * SR, L = [];
  for (let s = 0; s + win <= x.length; s += hop) L.push(db(rms(x, s, s + win)));
  const top = Math.max(...L, -200), sp = L.filter(v => v > top - 35);
  const loudRange = sp.length ? percentile(sp, 95) - percentile(sp, 10) : 0;
  // tempo: 10 ms envelope, smoothed; peaks = syllable nuclei; phrases split where it stays low >= 180 ms
  const h = 0.01 * SR, env = [];
  for (let s = 0; s + 0.03 * SR <= x.length; s += h) env.push(db(rms(x, s, s + 0.03 * SR)));
  const sm = env.map((_, i) => { const w = env.slice(Math.max(0, i - 2), i + 3); return w.reduce((a, b) => a + b, 0) / w.length; });
  const emax = Math.max(...sm, -200), thr = emax - 30;
  const peaks = [];
  for (let i = 1; i < sm.length - 1; i++) {
    if (sm[i] > thr + 6 && sm[i] >= sm[i - 1] && sm[i] > sm[i + 1] && (!peaks.length || i - peaks.at(-1) >= 8)) {
      const lo = Math.min(...sm.slice(Math.max(0, i - 15), i)), lo2 = Math.min(...sm.slice(i + 1, i + 16));
      if (sm[i] - Math.max(lo, lo2) >= 4) peaks.push(i);
    }
  }
  const phrases = []; let start = null, low = 0;
  sm.forEach((v, i) => { if (v > thr) { if (start === null) start = i; low = 0; } else if (start !== null && ++low >= 18) { phrases.push([start, i - low]); start = null; low = 0; } });
  if (start !== null) phrases.push([start, sm.length]);
  const rates = phrases.map(([a, b]) => [a, b, (b - a) * 0.01]).filter(p => p[2] >= 0.6).map(([a, b, dur]) => peaks.filter(p => p >= a && p <= b).length / dur);
  const tempo = rates.length >= 2 && Math.min(...rates) > 0 ? Math.max(...rates) / Math.min(...rates) : 1;
  return { sec: +(x.length / SR).toFixed(2), pitch_range_st: +pitchRange.toFixed(1), pitch_std_st: +pitchStd.toFixed(2), loud_range_db: +loudRange.toFixed(1),
    tempo_ratio: +tempo.toFixed(2), phrases: rates.length, f0_median: Math.round(percentile(f0, 50)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), j = args.indexOf('--json');
  const out = j >= 0 ? args.splice(j, 2)[1] : null;
  const files = args.flatMap(a => fs.statSync(a).isDirectory() ? fs.readdirSync(a).sort().filter(f => /\.(wav|mp3|m4a|pcm)$/i.test(f)).map(f => path.join(a, f)) : [a]);
  if (!files.length) { console.error('usage: node measure.mjs file_or_dir ... [--json out.json]'); process.exit(2); }
  const rows = [];
  for (const f of files) {
    const r = { file: path.basename(f), ...measure(load(f, SR)) }; rows.push(r);
    console.log(`${r.file.slice(0, 34).padEnd(34)} ${String(r.sec).padStart(5)}s  pitch range ${String(r.pitch_range_st).padStart(5)} st (std ${r.pitch_std_st})  loudness range ${String(r.loud_range_db).padStart(5)} dB  tempo ${r.tempo_ratio} (${r.phrases} phrases)  median ${r.f0_median} Hz`);
  }
  if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 1));
}
