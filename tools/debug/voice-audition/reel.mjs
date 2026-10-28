#!/usr/bin/env node
// One file to listen to: takes in order with a short pause between them and a longer one between groups, every take
// brought to the same loudness (one gain per take, so the swings inside it survive). Put "old" before "new" so the
// person judging hears the difference straight away. Tell them the order; do not make them hunt through files.
//
//   node reel.mjs --out listen.wav  old.wav new.wav  --  old2.wav new2.wav  [--gap 0.9] [--group-gap 1.8]
//   (a lone "--" starts a new group). Output is WAV; convert with ffmpeg if you need mp3.
import path from 'node:path';
import { load, writeWav, rms, concat } from './audio.mjs';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const out = opt('--out') || 'listen.wav', gap = Number(opt('--gap') || 0.9), ggap = Number(opt('--group-gap') || 1.8), SR = 24000;
const level = x => { let top = 0; const w = 0.3 * SR; for (let i = 0; i + w <= x.length; i += w / 4) top = Math.max(top, rms(x, i, i + w)); const g = 0.25 / (top || 1e-9); return x.map(v => Math.max(-0.98, Math.min(0.98, v * g))); };
const parts = [];
for (const a of args) {
  if (a === '--') { parts.push(new Float32Array(Math.round((ggap - gap) * SR))); continue; }
  parts.push(level(load(a, SR)), new Float32Array(Math.round(gap * SR)));
}
if (!parts.length) { console.error('usage: node reel.mjs --out listen.wav a.wav b.wav -- c.wav d.wav'); process.exit(2); }
const x = concat(parts);
writeWav(out, x, SR);
console.log('wrote', path.resolve(out), (x.length / SR).toFixed(1) + 's');
