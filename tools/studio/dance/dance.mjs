#!/usr/bin/env node
// Dance clips: put your character into a dance video, then check the face.
//   node dance/dance.mjs driver <dance.mp4>                                       offline: is this a good driving video?
//   node dance/dance.mjs frame  <char> <video|image> [--box t,b,l,r] [--full]    offline with --box: crop to 9:16 head-to-knees
//   node dance/dance.mjs bind   <char> <look> <dance.mp4> [--std] [--sound]      DEFAULT. Kling 3.0 motion control + face binding (fal)
//   node dance/dance.mjs o3     <char> <look> <dance.mp4> [--live] [--full] [--music a.mp3]   Kling O3 multi-reference (LibTV)
//   node dance/dance.mjs viggle <char> <look> <dance.mp4> [--bg transparent]    Viggle (character swap, alpha output)
// Common: --dry-run (print plan + cost, spend nothing), --no-check (skip the automatic face check), --name tag
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "../lib/args.mjs";
import { need } from "../lib/env.mjs";
import { loadCharacter, getLook, identityLine, outDir } from "../lib/character.mjs";
import { ff, dur, dims, sh, grab, jpgUri, hasAudio, isImage, stamp, slug, download, logSpend } from "../lib/media.mjs";
import { falRun, falUpload, firstUrl } from "../lib/fal.mjs";
import { askBoxes } from "../lib/openrouter.mjs";
import { checkFace } from "../check/face.mjs";

const { pos, flags } = parseArgs();
const [cmd] = pos;
const DRY = !!flags["dry-run"];
const log = (...a) => console.log(...a);
const SEG_MAX = 10; // Kling O3: max 10 s per generation

// ---------- driver: offline sanity check of a dance video ----------
function driver(file) {
  const d = dur(file), [w, h] = dims(file);
  const fps = sh("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", file]).trim();
  log(`${path.basename(file)}: ${d.toFixed(1)} s · ${w}x${h} · ${fps} fps · audio ${hasAudio(file) ? "yes" : "no"}`);
  const notes = [];
  if (d > 15) notes.push(`long (${d.toFixed(0)} s): bind does one call; o3 splits into ${Math.ceil(d / SEG_MAX)} segments with visible seams. Cut a 6–10 s chorus.`);
  if (Math.min(w, h) < 540) notes.push("low resolution: the model sees less of the moves");
  if (w > h) notes.push("landscape source: it will be cropped to 9:16 around the dancer for o3; bind keeps the source framing");
  log(notes.length ? notes.map((n) => "  ! " + n).join("\n") : "  ok");
  log(`Pick drivers by eye (matters more than the prompt):
  · standing, facing the camera, half or 3/4 body, no spins or hair flips (faces blur mid-turn)
  · calm, pleasant expression: motion transfer copies the dancer's pouts, O-mouths and grimaces
  · not a blank face either: a dancer who smiles, blinks and tilts a little gives a lively result
  · no subtitles, watermarks or stickers; one dancer; a well-known trending dance people recognise`);
}

// ---------- frame: crop to 9:16 from top of head to the knees ----------
// In full-body dance frames the face is a few dozen pixels and models paint an "average face"; head-to-knees keeps it.
async function personBox(src, video) {
  const pics = video ? [0.05, 0.18, 0.31, 0.44, 0.57, 0.7, 0.83, 0.95].map((k) => jpgUri(grab(src, dur(src) * k))) : [jpgUri(grab(src, null, 768))];
  const b = await askBoxes(pics, "the main person: top = top of hair/hat, bottom = the knees, left/right = outermost body extent including arms and hands");
  return { top: Math.min(...b.map((x) => x.top)), bottom: Math.max(...b.map((x) => x.bottom)), left: Math.min(...b.map((x) => x.left)), right: Math.max(...b.map((x) => x.right)) };
}
export async function frameToKnees(src, out, { full = false, loose = 1, box } = {}) {
  const video = !isImage(src);
  const [w, h] = dims(src);
  let cw, ch, x, y, b = box;
  if (full) { ch = h; cw = Math.min(w, Math.round((h * 9) / 16)); x = Math.round((w - cw) / 2); y = 0; }
  else {
    b ||= await personBox(src, video);
    const pad = (b.bottom - b.top) * (0.06 + (loose - 1) / 2);
    ch = Math.round((b.bottom - b.top + 2 * pad) * h);
    cw = Math.round((ch * 9) / 16);
    const wide = Math.round((b.right - b.left) * w * 1.2); // arm extent is usually under-estimated: +20 %
    if (cw < wide) { cw = Math.min(wide, Math.round(cw * 1.15)); ch = Math.round((cw * 16) / 9); } // widen at most 1.15x, wider = face smaller again
    if (cw > w) { cw = w; ch = Math.round((w * 16) / 9); }
    if (ch > h) { ch = h; cw = Math.round((h * 9) / 16); }
    x = Math.max(0, Math.min(w - cw, Math.round(((b.left + b.right) / 2) * w - cw / 2)));
    y = Math.max(0, Math.min(h - ch, Math.round((b.top - pad) * h)));
  }
  cw -= cw % 2; ch -= ch % 2;
  // Driving video at 720x1280 ~3 Mbps: 4–6 Mbps 1080p drivers failed for us, 3 Mbps passed. Output sharpness is the model's own.
  if (video) ff(["-i", src, "-vf", `crop=${cw}:${ch}:${x}:${y},scale=720:1280:flags=lanczos,fps=25`, "-c:v", "libx264", "-preset", "medium", "-b:v", "2800k", "-maxrate", "3500k", "-bufsize", "6000k", "-pix_fmt", "yuv420p", ...(hasAudio(src) ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]), out]);
  else ff(["-i", src, "-vf", `crop=${cw}:${ch}:${x}:${y},scale=1080:1920:flags=lanczos`, "-q:v", "2", out]);
  log(`  crop ${cw}x${ch}+${x}+${y} of ${w}x${h} → ${out}`);
  return { out, box: b };
}
const parseBox = (s) => { const [top, bottom, left, right] = String(s).split(",").map(Number); return { top, bottom, left, right }; };

async function afterwards(c, file) {
  log(`dance clip: ${file}`);
  if (flags["no-check"]) return;
  log("automatic face check:");
  await checkFace(c, file, { frames: 6 });
}

// ---------- bind: Kling 3.0 motion control with a bound face element (fal) ----------
// Best when the clip must follow the steps exactly. Element: frontal = master face, refs = two 3/4 faces made from it.
async function bind(c, l, video) {
  const std = !!flags.std, model = `fal-ai/kling-video/v3/${std ? "standard" : "pro"}/motion-control`;
  const image = l.body || c.body || l.ref;
  if (!image || !fs.existsSync(image)) throw new Error("bind needs a full-body image: body in character.json (or looks.<id>.body)");
  const sides = c.sides.filter((p) => fs.existsSync(p));
  const sec = dur(video), usd = +(sec * (std ? 0.126 : 0.168)).toFixed(2);
  const prompt = flags.prompt || "@Element1 dances, her face stays exactly @Element1: same eyes, nose, lips and face shape, calm soft closed-mouth smile.";
  log(`bind · ${model} · ${sec.toFixed(1)} s · ~$${usd} · image ${path.relative(c.dir, image)} · face element ${sides.length ? "master + " + sides.length + " side view(s)" : "master only (make sides with look.mjs sides)"}`);
  log(`prompt: ${prompt}`);
  if (DRY) return log("(dry run: nothing sent)");
  need("fal");
  const input = { image_url: await falUpload(image), video_url: await falUpload(video), character_orientation: "video", keep_original_sound: !!flags.sound, prompt,
    elements: [{ frontal_image_url: await falUpload(c.face), reference_image_urls: await Promise.all((sides.length ? sides : [c.face]).map(falUpload)) }] };
  const res = await falRun(model, input, { every: 8000 });
  const out = path.join(outDir(c, "dance"), `${slug(flags.name || path.basename(video, path.extname(video)), 24)}-bind-${stamp()}.mp4`);
  await download(firstUrl(res), out);
  logSpend(path.join(c.dir, "out"), { tool: "dance bind", model, usd, request_id: res.request_id });
  await afterwards(c, out);
}

// ---------- o3: Kling O3 multi-reference on LibTV ----------
// Refs in fixed order: master face → look photo → standing body (cropped head-to-knees) + driving video.
// Some crops make Kling refuse outright; on failure step down: default crop → 1.3x looser → no crop.
async function o3(c, l, video) {
  const live = !!flags.live;
  if (live && !c.live?.frame) throw new Error("character.json has no live.frame (screenshot of your stream picture)");
  const id = `${slug(flags.name || path.basename(video, path.extname(video)), 20)}-${stamp()}`;
  let total = dur(video);
  if (total > SEG_MAX && total % SEG_MAX < 1.5) total = Math.floor(total / SEG_MAX) * SEG_MAX; // drop a <1.5 s tail: one less seam
  const nSeg = Math.ceil(total / SEG_MAX - 1e-6);
  const lens = Array.from({ length: nSeg }, (_, i) => Math.floor(total / nSeg) + (i < Math.round(total) % nSeg ? 1 : 0)).map((x) => Math.max(3, Math.min(SEG_MAX, x)));
  log(`o3 · Kling O3 mixed2video · ${total.toFixed(1)} s in ${nSeg} segment(s): ${lens.join(" + ")} s · LibTV credits, ~10–15 min per 10 s`);
  if (DRY) return log("(dry run: nothing sent)");
  const { upload, runNode } = await import("../lib/libtv.mjs");
  const work = outDir(c, `dance/${id}`);
  const refImgs = [[c.face, false]];
  if (live) refImgs.push([c.live.frame, false]); else if (l.ref) refImgs.push([l.ref, false]); else if (l.sheet) refImgs.push([l.sheet, false]);
  const body = live ? c.live.body || c.body : l.body || c.body;
  if (body) refImgs.push([body, true]);
  const refNames = [];
  for (const [i, [f, crop]] of refImgs.entries()) {
    const tmp = path.join(work, `ref${i}.jpg`);
    if (crop) await frameToKnees(f, tmp, { full: !!flags.full }); else ff(["-i", f, "-vf", "scale='min(1600,iw)':-2", "-q:v", "2", tmp]);
    upload(tmp, `${id}-ref${i}`); refNames.push(`${id}-ref${i}`);
  }
  const vibe = live ? c.live.vibe || "" : l.vibe, outfit = live ? c.live.outfit || c.outfit : l.outfit || c.outfit;
  const prompt = `The person from the reference images. ${identityLine(c)} Outfit: ${outfit}. Vibe: ${vibe}. She performs exactly the dance moves from the reference video with the same timing, standing. ${c.scene ? `Setting: ${c.scene}. ` : ""}Fixed camera, same framing as the reference video, soft frontal key light on her face, photorealistic, sharp detailed face.`;
  const LADDER = flags.full ? [{ full: true }] : [{ loose: 1 }, { loose: 1.3 }, { full: true }];
  let rung = 0, box;
  const driverFor = async (r) => { const f = path.join(work, `driver-${r}.mp4`); if (!fs.existsSync(f)) { const res = await frameToKnees(video, f, { box, ...LADDER[r] }); box ||= res.box; } return f; };
  const sets = (sec) => ["model=Kling O3", "modeType=mixed2video", "quality=high", `duration=${sec}`, "ratio=9:16", "enableSound=off"];
  const segs = [];
  for (let i = 0, ss = 0; i < nSeg; ss += lens[i], i++) {
    let url;
    for (;;) {
      const drv = path.join(work, `drv${i}-${rung}.mp4`);
      ff(["-ss", ss.toFixed(3), "-t", String(lens[i]), "-i", await driverFor(rung), "-c:v", "libx264", "-b:v", "2800k", "-maxrate", "3500k", "-bufsize", "6000k", "-pix_fmt", "yuv420p", "-an", drv]);
      upload(drv, `${id}-drv${i}-${rung}`);
      log(`segment ${i + 1}/${nSeg} (crop level ${rung + 1}): generating`);
      try { url = await runNode(`${id}-o3-${i}-${rung}`, sets(lens[i]), [...refNames, `${id}-drv${i}-${rung}`], prompt); break; }
      catch (e) { if (!e.genFailed || rung >= LADDER.length - 1) throw e; rung++; log(`  ${e.message}\n  trying the next crop level`); }
    }
    segs.push(await download(url, path.join(work, `seg${i}.mp4`)));
  }
  if (rung) log("  note: a looser crop was used, the face is smaller than usual; look at the face check closely");
  const list = path.join(work, "list.txt");
  fs.writeFileSync(list, segs.map((s) => `file '${s}'`).join("\n"));
  const silent = path.join(work, "joined.mp4");
  ff(["-f", "concat", "-safe", "0", "-i", list, "-vf", "scale=1080:1920,fps=30", "-c:v", "libx264", "-crf", "16", "-an", silent]);
  const out = path.join(c.dir, "out", "dance", `${id}.mp4`);
  const audioSrc = flags.music ? path.resolve(flags.music) : video;
  if (hasAudio(audioSrc)) ff(["-i", silent, "-i", audioSrc, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-af", `afade=t=out:st=${(dur(silent) - 0.4).toFixed(2)}:d=0.4`, "-shortest", out]);
  else { log("  no audio in the dance video; add --music <audio> (same start point)"); fs.copyFileSync(silent, out); }
  if (live) {
    const blended = out.replace(/\.mp4$/, "-live.mp4"), d = dur(out);
    ff(["-loop", "1", "-t", "0.6", "-i", c.live.frame, "-i", out, "-loop", "1", "-t", "0.6", "-i", c.live.frame, "-filter_complex",
      `[0]scale=1080:1920,setsar=1,fps=30,format=yuv420p[a];[1:v]scale=1080:1920,setsar=1,fps=30,format=yuv420p[b];[2]scale=1080:1920,setsar=1,fps=30,format=yuv420p[c];` +
      `[a][b]xfade=transition=fade:duration=0.3:offset=0.3[ab];[ab][c]xfade=transition=fade:duration=0.3:offset=${d.toFixed(2)}[v]`,
      "-map", "[v]", ...(hasAudio(out) ? ["-map", "1:a", "-af", "adelay=300:all=1,afade=t=in:d=0.3", "-c:a", "aac"] : []), "-c:v", "libx264", "-crf", "16", blended]);
    log(`live-insert version (cross-fades from/to your stream picture): ${blended}`);
  }
  await afterwards(c, out);
}

// ---------- viggle ----------
async function viggle(c, l, video) {
  const image = l.ref || l.body || c.body || c.face;
  log(`viggle · image ${path.relative(c.dir, image)} · background ${flags.bg || "transparent"} · Viggle credits`);
  if (DRY) return log("(dry run: nothing sent)");
  const key = need("viggle"), H = { Authorization: `Bearer ${key}` }, B = "https://apis.viggle.ai/v1";
  const f = new FormData();
  f.append("image", new Blob([fs.readFileSync(image)]), path.basename(image));
  f.append("motion_video", new Blob([fs.readFileSync(video)]), "motion.mp4");
  f.append("background_mode", flags.bg || "transparent");
  const r = await (await fetch(`${B}/renders`, { method: "POST", headers: H, body: f })).json();
  if (!r.id) throw new Error("Viggle create failed: " + JSON.stringify(r).slice(0, 300));
  const dir = outDir(c, `dance/viggle-${stamp()}`);
  for (let i = 0; i < 150; i++) {
    await new Promise((s) => setTimeout(s, 6000));
    const g = await (await fetch(`${B}/renders/${r.id}`, { headers: H })).json();
    if (i % 5 === 0) log(`  ${g.status} ${g.stage || ""} ${g.progress ?? ""}`);
    if (["ready", "failed", "cancelled"].includes(g.status)) {
      fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(g, null, 1));
      if (g.status !== "ready") throw new Error("Viggle " + g.status + ": " + JSON.stringify(g.error));
      for (const k of ["video_url", "alpha_url"]) if (g[k]) await download(g[k], path.join(dir, `${k}.mp4`));
      logSpend(path.join(c.dir, "out"), { tool: "dance viggle", model: "viggle", usd: null, request_id: r.id });
      return afterwards(c, path.join(dir, "video_url.mp4"));
    }
  }
  throw new Error("Viggle timed out");
}

async function main() {
  if (cmd === "driver" && pos[1]) return driver(path.resolve(pos[1]));
  if (cmd === "frame" && pos[2]) {
    const c = loadCharacter(pos[1]), src = path.resolve(pos[2]);
    const out = path.join(outDir(c, "frame"), path.basename(src).replace(/\.\w+$/, isImage(src) ? ".jpg" : ".mp4"));
    return frameToKnees(src, out, { full: !!flags.full, box: flags.box ? parseBox(flags.box) : undefined });
  }
  if (["bind", "o3", "viggle"].includes(cmd) && pos[3]) {
    const c = loadCharacter(pos[1]), l = getLook(c, pos[2]), video = path.resolve(pos[3]);
    if (!fs.existsSync(video)) throw new Error("dance video not found: " + video);
    if (!c.face || !fs.existsSync(c.face)) throw new Error("master face missing (character/validate.mjs)");
    return cmd === "bind" ? bind(c, l, video) : cmd === "o3" ? o3(c, l, video) : viggle(c, l, video);
  }
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((x) => x.startsWith("//")).join("\n"));
  process.exit(1);
}
main().catch((e) => { console.error("✗ " + e.message); process.exit(1); });
