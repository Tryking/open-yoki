#!/usr/bin/env node
// Render every line twice: once whole (one request, one style instruction) and once in chunks (each chunk with its own
// instruction and speed), so stitch.mjs can put the chunks back together with their own loudness and pauses.
//
//   node render.mjs --lines lines.json --voices voices.json --voice my-clone --out work/   [--only regex] [--force]
//
// Writes work/<line id>/<voice>-whole.wav and <voice>-chunk-N.wav (mono, 24 kHz).
// Engines (voices.json):
//   doubao   Volcengine Doubao TTS v3 HTTP (unidirectional). key from env key_env; speaker id from `speaker` or from
//            env `speaker_env` (keep your cloned voice id out of the repo). `additions` merged into the request.
//            "ctx" goes in as context_texts (the style instruction), "speed" as speech_rate (-50..100).
//   command  any TTS you can call from a shell: gets TTS_TEXT, TTS_CTX, TTS_SPEED, TTS_OUT (a .wav path to write)
//   mock     offline test tone, no network
// Costs money on paid engines: run with --only first to try one line.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { writeWav, pcmToFloat, load } from './audio.mjs';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const lines = JSON.parse(fs.readFileSync(opt('--lines') || 'lines.json', 'utf8'));
const voices = JSON.parse(fs.readFileSync(opt('--voices') || 'voices.json', 'utf8'));
const name = opt('--voice'), V = voices[name], OUT = opt('--out') || 'work';
if (!V) { console.error(`voice "${name}" not in voices file`); process.exit(2); }
const only = opt('--only') ? new RegExp(opt('--only')) : null, force = args.includes('--force');
const SR = V.sample_rate || 24000;
let chars = 0; const lat = [];

function mockTone(text, ctx, speed) {
  // a vowel-like tone whose pitch glides and loudness swings more when the instruction sounds heated
  const hot = /喊|尖|激动|火|急|快|shout|loud|excited/i.test(ctx), dur = Math.max(0.5, text.length * 0.18 / (1 + speed / 100));
  const n = Math.floor(dur * SR), x = new Float32Array(n), f0 = hot ? 260 : 210, swing = hot ? 0.5 : 0.1;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = f0 * (1 + swing * Math.sin(2 * Math.PI * 0.7 * t)), syl = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t);
    ph += 2 * Math.PI * f / SR;
    x[i] = 0.3 * syl * (Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.2 * Math.sin(3 * ph)) * (hot ? 1 : 0.6);
  }
  return x;
}

async function tts(text, ctx, speed) {
  const t0 = Date.now();
  let x;
  if (V.engine === 'mock') x = mockTone(text, ctx, speed);
  else if (V.engine === 'command') {
    const tmp = path.join(OUT, `.tmp-${randomUUID()}.wav`);
    execSync(V.cmd, { env: { ...process.env, TTS_TEXT: text, TTS_CTX: ctx, TTS_SPEED: String(speed), TTS_OUT: tmp }, stdio: 'inherit' });
    x = load(tmp, SR); fs.rmSync(tmp);
  } else if (V.engine === 'doubao') {
    const key = process.env[V.key_env], speaker = V.speaker_env ? process.env[V.speaker_env] : V.speaker;
    if (!key || !speaker) throw new Error(`set ${V.key_env}${V.speaker_env ? ' and ' + V.speaker_env : ''}`);
    const req_params = { text, speaker, audio_params: { format: 'pcm', sample_rate: SR, speech_rate: speed }, additions: JSON.stringify({ context_texts: [ctx], ...(V.additions || {}) }) };
    const r = await fetch(V.url || 'https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
      method: 'POST', headers: { 'X-Api-Key': key, 'X-Api-Resource-Id': V.resource, 'X-Api-Request-Id': randomUUID(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ req_params }),
    });
    const parts = [];
    for (const l of (await r.text()).split('\n')) {
      if (!l.trim()) continue;
      const j = JSON.parse(l);
      if (j.code && j.code !== 20000000) throw new Error(`${j.code} ${String(j.message).slice(0, 120)}`);
      if (j.data) parts.push(Buffer.from(j.data, 'base64'));
    }
    x = pcmToFloat(Buffer.concat(parts));
  } else throw new Error(`unknown engine ${V.engine}`);
  chars += text.length; lat.push({ text, ms: Date.now() - t0 });
  return x;
}

fs.mkdirSync(OUT, { recursive: true });
const full = l => l.chunks.map(c => c.text).join('');
for (const l of lines) {
  if (only && !only.test(l.id)) continue;
  const d = path.join(OUT, l.id); fs.mkdirSync(d, { recursive: true });
  const jobs = [[`${name}-whole.wav`, full(l), l.whole, 10], ...l.chunks.map((c, i) => [`${name}-chunk-${i}.wav`, c.text, c.ctx, c.speed])];
  // the chunks of one line go out together, as they would live
  await Promise.all(jobs.map(async ([f, text, ctx, speed]) => {
    const p = path.join(d, f);
    if (fs.existsSync(p) && !force) return;
    try { writeWav(p, await tts(text, ctx, speed), SR); } catch (e) { console.log(l.id, f, 'FAILED', e.message); }
  }));
  console.log(l.id, 'ok');
}
const ms = lat.map(x => x.ms).sort((a, b) => a - b);
console.log(`${name}: ${chars} chars sent, request time median ${ms[ms.length >> 1] ?? 0} ms, max ${ms.at(-1) ?? 0} ms`);
fs.writeFileSync(path.join(OUT, `latency-${name}.json`), JSON.stringify(lat, null, 1));
