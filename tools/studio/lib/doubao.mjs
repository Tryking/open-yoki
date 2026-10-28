// Volcengine Doubao TTS (v3 unidirectional HTTP). Speaker IDs starting with S_ are your own cloned
// voices (resource seed-icl-2.0); anything else is a stock voice (resource seed-tts-2.0).
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { need } from "./env.mjs";
import { ff, dur } from "./media.mjs";

export async function tts({ out, text, speaker, rate = 0, tone = "", pitch, sampleRate = 24000 }) {
  const key = need("volc");
  if (!speaker) throw new Error("no speaker: set DOUBAO_SPEAKER in .env or pass --speaker <voice id from the Volcengine console>");
  const req_params = { text, speaker, audio_params: { format: "pcm", sample_rate: sampleRate, speech_rate: Number(rate) } };
  const add = {};
  if (tone) { req_params.context_texts = [tone]; add.context_texts = [tone]; }
  if (pitch) add.post_process = { pitch: Number(pitch) };
  if (Object.keys(add).length) req_params.additions = JSON.stringify(add);
  const r = await fetch("https://openspeech.bytedance.com/api/v3/tts/unidirectional", {
    method: "POST",
    headers: { "X-Api-Key": key, "X-Api-Resource-Id": speaker.startsWith("S_") ? "seed-icl-2.0" : "seed-tts-2.0", "X-Api-Request-Id": randomUUID(), "Content-Type": "application/json" },
    body: JSON.stringify({ req_params }),
  });
  const parts = [];
  for (const line of (await r.text()).split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    if (j.code && j.code !== 20000000) throw new Error(`Doubao ${j.code} ${j.message}`);
    if (j.data) parts.push(Buffer.from(j.data, "base64"));
  }
  const pcm = out + ".pcm";
  fs.writeFileSync(pcm, Buffer.concat(parts));
  ff(["-f", "s16le", "-ar", String(sampleRate), "-ac", "1", "-i", pcm, out]);
  fs.rmSync(pcm);
  return { out, seconds: dur(out), chars: [...text].length };
}
