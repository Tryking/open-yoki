// Offline self-test: mock voice -> render -> stitch -> measure -> reel -> blind ear (mock model) -> words (mock ASR).
// Also checks the pitch tracker on a known glide. node selftest.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { measure } from './measure.mjs';
import { score, parseAnswer } from './ear.mjs';
import { accuracy } from './words.mjs';
import { load } from './audio.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const node = (f, ...a) => execFileSync('node', [path.join(here, f), ...a], { encoding: 'utf8', stdio: 'pipe' });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-test-'));
const W = path.join(tmp, 'work'), lines = path.join(here, 'lines.example.json'), voices = path.join(here, 'voices.example.json');

// 1. the pitch tracker on a tone gliding 200 -> 300 Hz (7.0 semitones) with loud/quiet halves
const SR = 16000, n = 3 * SR, x = new Float32Array(n); let ph = 0;
for (let i = 0; i < n; i++) { const f = 200 * (1.5 ** (i / n)); ph += 2 * Math.PI * f / SR; x[i] = (i < n / 2 ? 0.8 : 0.2) * (Math.sin(ph) + 0.3 * Math.sin(2 * ph)); }
const m = measure(x);
assert.ok(m.pitch_range_st > 4.5 && m.pitch_range_st < 6.5, 'glide range ' + m.pitch_range_st);   // 10th..90th percentile of 7 st = 5.6
assert.ok(m.f0_median > 230 && m.f0_median < 260, 'median ' + m.f0_median);
assert.ok(m.loud_range_db > 8, 'loudness range ' + m.loud_range_db);

// 2. the chain on the mock voice
node('render.mjs', '--lines', lines, '--voices', voices, '--voice', 'mock', '--out', W);
node('stitch.mjs', '--work', W, '--lines', lines, '--voice', 'mock');
for (const id of ['excited-1', 'angry-1', 'panic-1', 'hurt-1', 'excited-en-1']) {
  for (const f of ['mock-whole.wav', 'mock-chunk-0.wav', 'mock-stitched.wav', 'mock-whole-level.wav']) assert.ok(fs.existsSync(path.join(W, id, f)), id + '/' + f);
}
// stitching with planned gains must move loudness more than the single whole take
const st = measure(load(path.join(W, 'angry-1', 'mock-stitched.wav'))), wh = measure(load(path.join(W, 'angry-1', 'mock-whole-level.wav')));
assert.ok(st.loud_range_db > wh.loud_range_db, `stitched ${st.loud_range_db} dB vs whole ${wh.loud_range_db} dB`);
const out = node('measure.mjs', path.join(W, 'angry-1'), '--json', path.join(tmp, 'm.json'));
assert.match(out, /pitch range/);
assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'm.json'), 'utf8')).length, 6);

// 3. reel
node('reel.mjs', '--out', path.join(tmp, 'listen.wav'), path.join(W, 'angry-1', 'mock-whole-level.wav'), path.join(W, 'angry-1', 'mock-stitched.wav'), '--', path.join(W, 'panic-1', 'mock-stitched.wav'));
assert.ok(fs.statSync(path.join(tmp, 'listen.wav')).size > 50000);

// 4. blind ear with the mock model (labels everything calm), then scoring of a hand-made result
fs.writeFileSync(path.join(tmp, 'ear.json'), JSON.stringify({ name: 'ear', provider: 'mock' }));
node('ear.mjs', '--work', W, '--lines', lines, '--model', path.join(tmp, 'ear.json'));
const blind = JSON.parse(fs.readFileSync(path.join(W, 'blind-1.json'), 'utf8'));
assert.equal(Object.keys(blind).length, 10, 'two files per line labelled');
assert.deepEqual(parseAnswer('clip 2 | angry | 8 | crack\nclip 1 | calm | 2 | none', ['a.wav', 'b.wav']), { 'b.wav': { label: 'angry', strength: 8, sounds: 'crack' }, 'a.wav': { label: 'calm', strength: 2, sounds: 'none' } });
const sc = score({ 'angry-1/v-stitched': { label: 'angry', strength: 8 }, 'angry-1/v-whole-level': { label: 'calm', strength: 3 }, 'panic-1/v-stitched': { label: 'panic', strength: 7 } }, JSON.parse(fs.readFileSync(lines, 'utf8')));
assert.equal(sc.find(r => r.group === 'file v-stitched').rate, 1);
assert.equal(sc.find(r => r.group === 'emotion angry').rate, 0.5);

// 5. words: mock ASR that "hears" the angry line with one word lost
assert.equal(accuracy('别点！都别点！', '别点都别点'), 1);
assert.ok(accuracy('我也亏了好不好', '我也亏了') < 0.7);
assert.equal(accuracy('No way, haha no way', 'no way no way'), 1);
fs.writeFileSync(path.join(tmp, 'asr.sh'), 'echo "谁发的这个链接 别点都别点那是骗子 我直接踢了真的是"\n');
const w = node('words.mjs', '--work', W, '--lines', lines, '--asr', `sh ${path.join(tmp, 'asr.sh')}`, '--files', 'stitched');
assert.match(w, /angry-1\/mock-stitched\.wav\s+0\.[89]/);
fs.rmSync(tmp, { recursive: true });
console.log('voice-audition selftest: ok');
