#!/usr/bin/env node
// Original music and sound effects generated on fal (ElevenLabs models).
//   node mv/audio.mjs music <out.mp3> <seconds> "<prompt>" [--vocals]   instrumental unless --vocals   ~$0.60 per minute
//   node mv/audio.mjs sfx   <out.mp3> <seconds> "<description>"          one short effect                 cents
// --dry-run prints the plan. For music people already know, use a licensed track instead (rights are yours to check).
import path from "node:path";
import { parseArgs } from "../lib/args.mjs";
import { need } from "../lib/env.mjs";
import { falRun, firstUrl } from "../lib/fal.mjs";
import { download, logSpend } from "../lib/media.mjs";

const { pos, flags } = parseArgs();
const [cmd, out, secs, text] = pos;
async function main() {
  if (!["music", "sfx"].includes(cmd) || !out || !secs || !text) { console.log("Usage: node mv/audio.mjs music|sfx <out.mp3> <seconds> \"<prompt>\" [--vocals] [--dry-run]"); process.exit(1); }
  const model = cmd === "music" ? "fal-ai/elevenlabs/music" : "fal-ai/elevenlabs/sound-effects/v2";
  const usd = cmd === "music" ? +(0.6 * secs / 60).toFixed(2) : 0.02;
  console.log(`${cmd} · ${model} · ${secs} s · ~$${usd}`);
  if (flags["dry-run"]) return console.log("(dry run: nothing sent)");
  need("fal");
  const input = cmd === "music" ? { prompt: text, music_length_ms: Math.round(+secs * 1000), force_instrumental: !flags.vocals }
    : { text, duration_seconds: +secs, prompt_influence: 0.6 };
  const res = await falRun(model, input, { every: cmd === "music" ? 5000 : 3000 });
  await download(firstUrl(res), path.resolve(out));
  logSpend(path.dirname(path.resolve(out)), { tool: `mv ${cmd}`, model, usd, request_id: res.request_id });
  console.log("✓ " + out);
}
main().catch((e) => { console.error("✗ " + e.message); process.exit(1); });
