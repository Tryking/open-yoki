#!/usr/bin/env node
// Generate one shot from a job file. Services are optional adapters; pick one with "via".
//   node shots/gen.mjs <job.json> [--dry-run] [--out <dir>]
// Job: { name, via, prompt, duration, aspect, images:[...], audio:[...], video, sound, model, extra:{}, usd }
// Paths in a job are relative to the job file. Output: <out>/shots/<name>/video.mp4 (+ input.json, result.json).
//
// via:
//   fal-seedance  Seedance reference-to-video on fal (images + optional audio refs, can make its own sound)  ~$0.22/s (draft)
//   libtv-o3      Kling O3 on LibTV: 1 image → singleImage2video; images + video → mixed2video                  LibTV credits
//   libtv-omni    OmniHuman 1.5 on LibTV: one image + one voice track → talking/lip-synced clip                LibTV credits
//   ark-seedance  Seedance straight from Volcengine Ark (experimental, set ARK_SEEDANCE_MODEL)                  Ark pricing
//   fal           any fal model: "model" + "input"; strings "@file:<path>" inside input are uploaded           job.usd
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "../lib/args.mjs";
import { need, get } from "../lib/env.mjs";
import { falRun, falUpload, fileUri, firstUrl } from "../lib/fal.mjs";
import { ff, download, logSpend, outRoot, imageUri, tmpFile } from "../lib/media.mjs";

const { pos, flags } = parseArgs();
const DRY = !!flags["dry-run"];
if (!pos[0]) { console.log("Usage: node shots/gen.mjs <job.json> [--dry-run] [--out dir]  (see file header)"); process.exit(1); }
const jobFile = path.resolve(pos[0]);
const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
const at = (p) => path.resolve(path.dirname(jobFile), p);
const images = (job.images || []).map(at), audio = (job.audio || []).map(at), video = job.video ? at(job.video) : null;
for (const p of [...images, ...audio, ...(video ? [video] : [])]) if (!fs.existsSync(p)) { console.error(`✗ input not found: ${p}`); process.exit(1); }
const sec = +job.duration || 5;
const aspect = job.aspect || "16:9";
const out = path.join(outRoot(flags.out), "shots", job.name || path.basename(jobFile, ".json"));

const PLAN = {
  "fal-seedance": { model: job.model || "bytedance/seedance-2.5/reference-to-video", usd: job.usd ?? +(0.22 * sec).toFixed(2), service: "fal" },
  "libtv-o3": { model: "Kling O3", usd: null, service: "libtv" },
  "libtv-omni": { model: "OmniHuman 1.5", usd: null, service: "libtv" },
  "ark-seedance": { model: job.model || get("ARK_SEEDANCE_MODEL", "(set ARK_SEEDANCE_MODEL)"), usd: job.usd ?? null, service: "ark" },
  fal: { model: job.model, usd: job.usd ?? null, service: "fal" },
};
const plan = PLAN[job.via];
if (!plan) { console.error(`✗ unknown via "${job.via}". Use one of: ${Object.keys(PLAN).join(", ")}`); process.exit(1); }

console.log(`${job.name}: via ${job.via} · ${plan.model} · ${sec}s ${aspect} · cost ${plan.usd != null ? "~$" + plan.usd : "see the service's price list"}`);
console.log(`refs: images ${images.length}, audio ${audio.length}, video ${video ? 1 : 0}`);
console.log(`prompt: ${job.prompt || "(none)"}`);
if (DRY) { console.log("(dry run: nothing sent)"); process.exit(0); }

async function viaFalSeedance() {
  const input = { task: "reference", prompt: job.prompt, duration: String(sec), aspect_ratio: aspect, generate_audio: !!job.sound, draft: job.draft ?? true,
    image_urls: images.map((p) => imageUri(p)), ...(audio.length ? { audio_urls: audio.map(fileUri) } : {}), ...(job.extra || {}) };
  return falRun(plan.model, input, { every: 6000 });
}

async function viaFal() {
  if (!job.model || !job.input) throw new Error('via "fal" needs "model" and "input"');
  const walk = async (v) => {
    if (typeof v === "string" && v.startsWith("@file:")) { const p = at(v.slice(6)); return /\.(mp4|mov|webm)$/i.test(p) ? falUpload(p) : fileUri(p); }
    if (Array.isArray(v)) return Promise.all(v.map(walk));
    if (v && typeof v === "object") return Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await walk(x)])));
    return v;
  };
  return falRun(job.model, await walk(job.input), { every: 6000 });
}

async function viaLibtv(kind) {
  const { upload, runNode } = await import("../lib/libtv.mjs");
  const id = `${(job.name || "shot").replace(/[^A-Za-z0-9-]+/g, "-")}-${Date.now().toString(36)}`;
  const lefts = [];
  for (const [i, p] of images.entries()) { const jpg = tmpFile(".jpg"); ff(["-i", p, "-vf", "scale='min(1920,iw)':-2", "-q:v", "2", jpg]); upload(jpg, `${id}-img${i}`); lefts.push(`${id}-img${i}`); }
  let sets;
  if (kind === "omni") {
    if (images.length !== 1 || audio.length !== 1) throw new Error("libtv-omni needs exactly one image and one audio file");
    const mp3 = tmpFile(".mp3"); ff(["-i", audio[0], "-ac", "1", "-ar", "44100", "-b:a", "160k", mp3]); upload(mp3, `${id}-aud`); lefts.push(`${id}-aud`);
    sets = ["model=OmniHuman 1.5", "modeType=audio2video"];
  } else {
    if (video) { upload(video, `${id}-drv`); lefts.push(`${id}-drv`); }
    const mode = video ? "mixed2video" : "singleImage2video";
    sets = ["model=Kling O3", `modeType=${mode}`, "quality=high", `duration=${Math.min(10, Math.round(sec))}`, `ratio=${aspect}`, `enableSound=${job.sound ? "on" : "off"}`];
  }
  sets.push(...(job.libtv_sets || []));
  const url = await runNode(`${id}-${kind}`, sets, lefts, kind === "omni" ? job.prompt || "" : job.prompt);
  return { video: { url } };
}

async function viaArk() {
  const key = need("ark");
  const model = plan.model;
  if (!model || model.startsWith("(")) throw new Error("set ARK_SEEDANCE_MODEL (model id from your Ark console) or job.model");
  const content = [{ type: "text", text: `${job.prompt} --ratio ${aspect} --duration ${Math.round(sec)}` }, ...images.slice(0, 1).map((p) => ({ type: "image_url", image_url: { url: imageUri(p) } }))];
  const base = get("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3");
  const H = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const sub = await (await fetch(`${base}/contents/generations/tasks`, { method: "POST", headers: H, body: JSON.stringify({ model, content }) })).json();
  if (!sub.id) throw new Error("Ark submit failed: " + JSON.stringify(sub).slice(0, 300));
  for (let i = 0; i < 400; i++) {
    await new Promise((r) => setTimeout(r, 6000));
    const t = await (await fetch(`${base}/contents/generations/tasks/${sub.id}`, { headers: H })).json();
    if (t.status === "succeeded") return { video: { url: t.content?.video_url }, request_id: sub.id };
    if (["failed", "cancelled"].includes(t.status)) throw new Error("Ark task " + t.status + ": " + JSON.stringify(t.error || t).slice(0, 300));
  }
  throw new Error("Ark task timed out");
}

async function main() {
  if (plan.service === "fal") need("fal");
  if (plan.service === "ark") need("ark");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "input.json"), JSON.stringify({ ...job, at: new Date().toISOString() }, null, 1));
  const res = job.via === "fal-seedance" ? await viaFalSeedance() : job.via === "fal" ? await viaFal()
    : job.via === "libtv-o3" ? await viaLibtv("o3") : job.via === "libtv-omni" ? await viaLibtv("omni") : await viaArk();
  fs.writeFileSync(path.join(out, "result.json"), JSON.stringify(res, null, 1));
  const url = firstUrl(res);
  if (!url) throw new Error("no video in result: " + JSON.stringify(res).slice(0, 300));
  const file = await download(url, path.join(out, "video.mp4"));
  logSpend(outRoot(flags.out), { tool: "shots/gen", via: job.via, model: plan.model, name: job.name, usd: plan.usd, request_id: res.request_id });
  console.log(`✓ ${file}\nnext: node check/clip.mjs check ${path.relative(process.cwd(), file)} <cards.json> --shot ${job.shot ?? "<id>"}`);
}
main().catch((e) => { console.error("✗ " + e.message); process.exit(1); });
