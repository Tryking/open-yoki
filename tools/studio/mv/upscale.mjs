#!/usr/bin/env node
// Upscale a finished low-res clip (e.g. 480p draft renders) to ~1080p with Topaz on fal.
//   node mv/upscale.mjs <in.mp4> <out.mp4> [--factor 2.25] [--model Proteus] [--dry-run]     ~$2.5 for a ~30 s clip (what we paid)
// Upscaling sharpens; it does not add motion or fix a drifted face. Fix faces before upscaling.
import path from "node:path";
import { parseArgs } from "../lib/args.mjs";
import { need } from "../lib/env.mjs";
import { falRun, falUpload, firstUrl } from "../lib/fal.mjs";
import { download, logSpend, dur } from "../lib/media.mjs";

const { pos, flags } = parseArgs();
const [src, out] = pos;
async function main() {
  if (!src || !out) { console.log("Usage: node mv/upscale.mjs <in.mp4> <out.mp4> [--factor 2.25] [--dry-run]"); process.exit(1); }
  const model = "fal-ai/topaz/upscale/video";
  console.log(`upscale · ${model} · ${dur(path.resolve(src)).toFixed(1)} s · factor ${flags.factor || 2.25}`);
  if (flags["dry-run"]) return console.log("(dry run: nothing sent)");
  need("fal");
  const res = await falRun(model, { video_url: await falUpload(path.resolve(src)), model: flags.model || "Proteus", upscale_factor: +(flags.factor || 2.25), H264_output: true }, { every: 8000 });
  await download(firstUrl(res), path.resolve(out));
  logSpend(path.dirname(path.resolve(out)), { tool: "mv upscale", model, usd: 2.5, request_id: res.request_id });
  console.log("✓ " + out);
}
main().catch((e) => { console.error("✗ " + e.message); process.exit(1); });
