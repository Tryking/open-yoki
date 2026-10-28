#!/usr/bin/env node
// Cloud singing / music on fal (optional; the local Seed-VC route in svc.sh is free).
//   node sing/cloud.mjs song   <out.mp3> "<style>" <lyrics.txt>                  new song with your lyrics (MiniMax Music v2)      ~$0.10
//   node sing/cloud.mjs cover  <reference.mp3> <out.mp3> <lyrics.txt> "<style>"  sing new lyrics over a reference melody (MiniMax cover)  ~$0.15
//   node sing/cloud.mjs lyrics <in.wav> <out.wav> "<old lyrics>" "<new lyrics>" "<tags>"   keep backing + melody, swap the words (ACE-Step)  ~$0.03
//   node sing/cloud.mjs mureka <out-prefix> <job.json>                           Mureka song; job: {upload:{melody|reference: file}, voice?: file, input:{lyrics, prompt?}}  ~$0.10
//   node sing/cloud.mjs sts    <source.wav> <target_voice.wav> <out.wav>         speech-to-speech voice swap, timing kept (Chatterbox HD)  ~$0.01-0.05
// Add --dry-run to print what would be sent. Lyrics: use [verse] / [chorus] tags for MiniMax.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "../lib/args.mjs";
import { need } from "../lib/env.mjs";
import { falRun, falUpload, fileUri, firstUrl } from "../lib/fal.mjs";
import { download, logSpend } from "../lib/media.mjs";

const { pos, flags } = parseArgs();
const [cmd, ...a] = pos;
const DRY = !!flags["dry-run"];
const read = (f) => fs.readFileSync(path.resolve(f), "utf8").trim();
const exists = (...fs_) => { for (const f of fs_) if (!fs.existsSync(path.resolve(f))) throw new Error("not found: " + f); };

const PLANS = {
  song: { model: "fal-ai/minimax-music/v2", usd: 0.1, need: 3 },
  cover: { model: "fal-ai/minimax-music/cover", usd: 0.15, need: 4 },
  lyrics: { model: "fal-ai/ace-step/audio-to-audio", usd: 0.03, need: 5 },
  mureka: { model: "mureka/api/generate/song", usd: 0.1, need: 2 },
  sts: { model: "resemble-ai/chatterboxhd/speech-to-speech", usd: 0.03, need: 3 },
};

async function main() {
  const p = PLANS[cmd];
  if (!p || a.length < p.need) { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((x) => x.startsWith("//")).join("\n")); process.exit(1); }
  console.log(`${cmd} · ${p.model} · ~$${p.usd}`);
  if (DRY) { console.log("(dry run: nothing sent)"); return; }
  need("fal");
  let res, out;
  if (cmd === "song") {
    [out] = a; const [, style, lyr] = a; exists(lyr);
    res = await falRun(p.model, { prompt: style, lyrics_prompt: read(lyr) });
  } else if (cmd === "cover") {
    const [ref, o, lyr, style] = a; out = o; exists(ref, lyr);
    res = await falRun(p.model, { audio_url: await falUpload(path.resolve(ref)), lyrics: read(lyr), prompt: style, audio_setting: { sample_rate: 44100, bitrate: 256000, format: "mp3" } });
  } else if (cmd === "lyrics") {
    const [src, o, original_lyrics, lyrics, tags] = a; out = o; exists(src);
    res = await falRun(p.model, { audio_url: await falUpload(path.resolve(src)), edit_mode: "lyrics", original_lyrics, lyrics, original_tags: tags, tags, number_of_steps: 60,
      ...(flags.seed ? { seed: +flags.seed } : {}), ...(flags["lyric-guidance"] ? { lyric_guidance_scale: +flags["lyric-guidance"] } : {}) });
  } else if (cmd === "mureka") {
    const [prefix, jobFile] = a; exists(jobFile);
    const job = JSON.parse(read(jobFile)), base = path.dirname(path.resolve(jobFile));
    const input = { ...job.input };
    for (const [purpose, f] of Object.entries(job.upload || {})) {
      const r = await falRun("mureka/api/files/upload", { purpose, file_url: await falUpload(path.resolve(base, f)) });
      input[`${purpose}_id`] = r.id || r.data?.id;
    }
    if (job.voice) {
      const r = await falRun("mureka/api/voice/clone", { audio_url: await falUpload(path.resolve(base, job.voice)), description: job.voiceName || "voice" });
      input.vocal_id = r.id || r.vocal_id || r.data?.id;
    }
    res = await falRun(p.model, input);
    const urls = [...new Set(JSON.stringify(res).match(/https:[^"]+\.(mp3|wav|flac)/g) || [])];
    for (const [k, u] of urls.entries()) console.log("✓ " + (await download(u, `${prefix}-${k}${path.extname(u)}`)));
    fs.writeFileSync(prefix + ".json", JSON.stringify(res, null, 1));
    logSpend(path.dirname(path.resolve(prefix)), { tool: "sing mureka", model: p.model, usd: p.usd, request_id: res.request_id });
    return;
  } else if (cmd === "sts") {
    const [src, tgt, o] = a; out = o; exists(src, tgt);
    res = await falRun(p.model, { source_audio_url: fileUri(path.resolve(src)), target_voice_audio_url: fileUri(path.resolve(tgt)), high_quality_audio: true }, { every: 3000 });
  }
  const url = firstUrl(res);
  if (!url) throw new Error("no audio in result: " + JSON.stringify(res).slice(0, 300));
  await download(url, path.resolve(out));
  logSpend(path.dirname(path.resolve(out)), { tool: `sing ${cmd}`, model: p.model, usd: p.usd, request_id: res.request_id });
  console.log("✓ " + out);
}
main().catch((e) => { console.error("✗ " + e.message); process.exit(1); });
