#!/usr/bin/env node
// Do the words survive the acting? Shouting, sobbing and mumbling can eat words. Transcribe every take with any
// speech-to-text you have and score how much of the script came back (character edit distance; laughs are free).
//
//   node words.mjs --work work/ --lines lines.json --asr "<command printing the transcript of $AUDIO>" [--files stitched,whole-level]
//   e.g. --asr 'whisper "$AUDIO" --model small --language zh --output_format txt --output_dir /tmp/asr >/dev/null && cat /tmp/asr/$(basename "$AUDIO" .wav).txt'
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function editDistance(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let p = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] !== b[j - 1])); p = t; }
  }
  return d[b.length];
}
// letters and digits only; Chinese by character, other scripts by lower-cased letters; "haha"/"哈哈" removed
const norm = s => String(s).toLowerCase().replace(/哈+|(ha){2,}h?/g, '').replace(/[^\p{L}\p{N}]/gu, '');
export const accuracy = (script, heard) => { const r = norm(script), h = norm(heard); return Math.max(0, 1 - editDistance(r, h) / Math.max(1, r.length)); };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const W = opt('--work') || 'work', asr = opt('--asr'), kinds = (opt('--files') || 'stitched,whole-level').split(',');
  if (!asr) { console.error('need --asr "<command using $AUDIO>"'); process.exit(2); }
  const lines = JSON.parse(fs.readFileSync(opt('--lines') || 'lines.json', 'utf8'));
  const out = [];
  for (const l of lines) {
    const d = path.join(W, l.id);
    if (!fs.existsSync(d)) continue;
    const script = l.chunks.map(c => c.text).join('');
    for (const f of fs.readdirSync(d).filter(f => kinds.some(k => f.endsWith(`-${k}.wav`)))) {
      const heard = execSync(asr, { env: { ...process.env, AUDIO: path.join(d, f) }, encoding: 'utf8' }).trim();
      const acc = +accuracy(script, heard).toFixed(2);
      out.push({ id: l.id, file: f, acc, heard });
      console.log(`${(l.id + '/' + f).padEnd(40)} ${acc.toFixed(2)}  ${heard}`);
    }
  }
  fs.writeFileSync(path.join(W, 'words.json'), JSON.stringify(out, null, 1));
}
