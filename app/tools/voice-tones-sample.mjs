// Say one sample line in each tone of the idol's Doubao voice (idol.avatar.doubao.tones), plus the plain voice, and
// join them into one file to listen through. Use it to tune each tone's context sentence and speed.
//   VOLC_API_KEY=... [DOUBAO_VOICE_ID=...] node tools/voice-tones-sample.mjs [--idol example] [--out <folder>] ["line"]
// Needs ffmpeg. Costs Doubao characters (a few hundred).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { doubaoVoice } from '../server/voice.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const id = arg('idol', 'example');
const idol = (await import(`../idols/${id}/config.mjs`)).default;
const dv = idol.avatar?.doubao || {};
const voiceId = process.env.DOUBAO_VOICE_ID || dv.voiceId;
if (!process.env.VOLC_API_KEY) throw new Error('set VOLC_API_KEY');
if (!voiceId) throw new Error('set DOUBAO_VOICE_ID or idol.avatar.doubao.voiceId');
const line = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'))
  || '哈喽，晚上好呀！今天来的人好多喔，我数一下，一、二、三……好啦数不过来，反正比昨天多，开心！';
const out = path.resolve(arg('out', path.join(os.tmpdir(), `voice-tones-${id}`)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-tones-'));
fs.mkdirSync(out, { recursive: true });

const v = doubaoVoice({ key: process.env.VOLC_API_KEY, dir: tmp, voiceId, context: dv.context || '', speed: dv.speed || 0, tones: dv.tones || {} });
const parts = [];
for (const tone of ['', ...Object.keys(dv.tones || {})]) {
  const name = tone || 'plain';
  const r = await v.say(line, null, 'tone' + parts.length, tone || undefined);
  if (!r) { console.log(name, 'FAILED'); continue; }
  const f = path.join(out, `${parts.length + 1}-${name}.mp3`);
  fs.copyFileSync(path.join(tmp, `tone${parts.length}.mp3`), f);
  parts.push(f);
  console.log(name, r.durationMs, 'ms');
}
// one file to listen through, with a short silent gap between lines
const gap = path.join(tmp, 'gap.mp3'), list = path.join(tmp, 'list.txt');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '1.2', '-c:a', 'libmp3lame', '-b:a', '64k', gap]);
fs.writeFileSync(list, parts.flatMap(p => [`file '${p}'`, `file '${gap}'`]).join('\n'));
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k', path.join(out, 'all.mp3')]);
console.log('done', out);
