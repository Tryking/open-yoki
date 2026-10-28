// Clone a voice with Doubao voice cloning 2.0 (Volcengine). Buy a cloning slot in the Volcengine console first; the
// slot id becomes the voice id (DOUBAO_VOICE_ID or idol.avatar.doubao.voiceId). Optionally saves Doubao's demo audio.
//   VOLC_API_KEY=... node tools/volc-clone.mjs <slot id> <reference.wav> [demo.mp3] ["demo text"]
// Use 10–30 s of clean speech. MODEL_TYPE=<n> picks a model type; EXTRA='{"...":...}' adds extra_params.
import fs from 'node:fs';
import crypto from 'node:crypto';

const [slot, file, out, demo] = process.argv.slice(2);
if (!slot || !file) throw new Error('usage: node tools/volc-clone.mjs <slot id> <reference.wav> [demo.mp3] ["demo text"]');
if (!process.env.VOLC_API_KEY) throw new Error('set VOLC_API_KEY');
const body = { speaker_id: slot, audio: { data: fs.readFileSync(file).toString('base64'), format: file.split('.').pop() }, language: 0, ...(process.env.MODEL_TYPE ? { model_type: Number(process.env.MODEL_TYPE) } : {}), extra_params: { ...(demo ? { demo_text: demo } : {}), ...JSON.parse(process.env.EXTRA || '{}') } };
const r = await fetch('https://openspeech.bytedance.com/api/v3/tts/voice_clone', { method: 'POST', headers: { 'X-Api-Key': process.env.VOLC_API_KEY, 'X-Api-Request-Id': crypto.randomUUID(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const j = await r.json().catch(() => ({}));
const { demo_audio, ...rest } = j;
console.log(r.status, JSON.stringify(rest).slice(0, 400));
if (demo_audio && out) {
  const a = String(demo_audio);
  if (/^https?:/.test(a)) fs.writeFileSync(out, Buffer.from(await (await fetch(a)).arrayBuffer()));
  else fs.writeFileSync(out, Buffer.from(a, 'base64'));
  console.log('demo saved', out, fs.statSync(out).size);
}
