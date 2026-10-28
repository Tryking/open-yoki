#!/usr/bin/env node
// Face check: did the face drift? Crops the face from N frames, puts it next to the master face, scores it.
//   node check/face.mjs <char> <video|image> [--frames 6]            crop + score (OpenRouter, ~$0.01)
//   node check/face.mjs <char> <video|image> [--frames 6] --offline  side-by-side sheet only (free; center crop or --box)
//   --box top,bottom,left,right  (0-1) face box to use instead of asking a model, same box for all frames
// Output: <char>/out/check/<file>/face0-master.jpg, face1..N.jpg, compare_master_left.jpg, result.json
// The score is a helper. Pass/fail is decided by a human looking at compare_master_left.jpg.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../lib/args.mjs";
import { loadCharacter, outDir } from "../lib/character.mjs";
import { ff, dur, dims, grab, jpgUri, isImage } from "../lib/media.mjs";
import { askJSON, askBoxes, VISION_MODEL } from "../lib/openrouter.mjs";

const SYSTEM = `You are a strict beauty editor checking AI-generated face crops against the reference face (image 1). Crops are enlarged; low resolution itself is not a fault, a drifted face is.
Score each crop 0-10 on:
- same: clearly the same person as image 1? Compare eye size and shape, eyelids, nose, lip shape, face shape, bangs. A pretty but generic "average AI face" is at most 5. Smaller eyes, a longer face or a different nose are each -2.
- pretty: would a fan call it attractive? Heavy or muddy makeup, blank stare, stiff smile, asymmetric or melted eyes, bad teeth are each -2 or worse.
Calibration: 9-10 indistinguishable and attractive; 7-8 small drift a fan forgives; 5-6 noticeably different or plainer; <=4 wrong person or broken.
If drifted/accepted examples are given, first decide for each new crop which group it is closer to ("closer":"good"|"bad"), looking hardest at eye size and shape, lips and how lively the face is; then score.
Reply JSON only: {"frames":[{"i":1,"closer":"good","same":0,"pretty":0,"note":""}],"identity":0,"pretty":0,"problems":[""],"verdict":"pass"|"fail"}. identity/pretty = average rounded down. pass only if identity>=8 and pretty>=7, no frame below 6, and (with examples) at least two thirds of crops closer to "good".`;

function cropSquare(src, box, out) {
  const [w, h] = dims(src);
  const fw = (box.right - box.left) * w, fh = (box.bottom - box.top) * h;
  const side = Math.min(w, h, Math.round(Math.max(fw, fh) * 1.5));
  const x = Math.max(0, Math.min(w - side, Math.round(((box.left + box.right) / 2) * w - side / 2)));
  const y = Math.max(0, Math.min(h - side, Math.round(((box.top + box.bottom) / 2) * h - side / 2)));
  ff(["-i", src, "-vf", `crop=${side}:${side}:${x}:${y},scale=512:512:flags=lanczos`, "-q:v", "2", out]);
  return Math.round(Math.max(fw, fh));
}
const CENTER = { top: 0.15, bottom: 0.55, left: 0.3, right: 0.7 };
const parseBox = (s) => { const [top, bottom, left, right] = String(s).split(",").map(Number); return { top, bottom, left, right }; };

export async function checkFace(c, file, { frames = 6, offline = false, box = null, log = console.log } = {}) {
  const img = isImage(file);
  const shots = img ? [grab(file, null, 1600)] : Array.from({ length: frames }, (_, i) => grab(file, dur(file) * (i + 0.5) / frames, 1600));
  const dir = outDir(c, `check/${path.basename(file).replace(/\.\w+$/, "")}`);
  let boxes, refBox;
  if (box) { boxes = shots.map(() => box); refBox = box; }
  else if (offline) { boxes = shots.map(() => CENTER); refBox = CENTER; }
  else {
    boxes = await askBoxes(shots.map((f) => jpgUri(grab(f, null, 768))), "the main person's face (forehead/bangs to chin, ear to ear)");
    [refBox] = await askBoxes([jpgUri(grab(c.face, null, 768))], "the main person's face (forehead/bangs to chin, ear to ear)");
  }
  const crops = shots.map((f, i) => { const out = path.join(dir, `face${i + 1}.jpg`); return { out, px: cropSquare(f, boxes[i] || boxes[boxes.length - 1], out) }; });
  const ref = path.join(dir, "face0-master.jpg");
  cropSquare(c.face, offline && !box ? { top: 0.1, bottom: 0.9, left: 0.1, right: 0.9 } : refBox, ref);
  const sheet = path.join(dir, "compare_master_left.jpg");
  ff(["-i", ref, ...crops.flatMap((x) => ["-i", x.out]), "-filter_complex",
    `[0]scale=256:256[r];` + crops.map((_, i) => `[${i + 1}]scale=256:256[f${i}]`).join(";") + `;[r]${crops.map((_, i) => `[f${i}]`).join("")}hstack=${crops.length + 1}`, "-q:v", "3", sheet]);
  for (const f of shots) fs.rmSync(f, { force: true });
  if (offline) { log(`side-by-side (master face on the left): ${sheet}\n(offline: no score. Look at eye size and shape, bangs, nose, lips, face shape.)`); return { sheet, offline: true }; }

  const cal = c.calib, calImgs = [...cal.bad, ...cal.good];
  let n = 2; const tag = (k) => { const a = n; n += k; return k === 1 ? `image ${a}` : `images ${a}-${n - 1}`; };
  const calText = calImgs.length ? ` ${cal.bad.length ? `${tag(cal.bad.length)} = DRIFTED examples a human rejected.` : ""}${cal.good.length ? ` ${tag(cal.good.length)} = ACCEPTED examples.` : ""} Use them as the scale.` : "";
  const content = [{ type: "text", text: `Image 1 = reference face.${calText} Then ${crops.length} NEW face crop(s) to score (${tag(crops.length)}); original face size in px: ${crops.map((x) => x.px).join(", ")}. Number them 1..${crops.length} in "frames".` },
    { type: "image_url", image_url: { url: jpgUri(ref) } }, ...calImgs.map((f) => ({ type: "image_url", image_url: { url: jpgUri(f) } })), ...crops.map((x) => ({ type: "image_url", image_url: { url: jpgUri(x.out) } }))];
  const { data: d, cost } = await askJSON({ system: SYSTEM, content, maxTokens: 3000 });
  const small = crops.filter((x) => x.px < 120).length;
  log(`face check: ${d.verdict === "pass" ? "PASS" : "FAIL"} · same person ${d.identity}/10 · attractive ${d.pretty}/10${small ? ` · ${small} frame(s) have a face under 120 px: frame tighter` : ""}`);
  if (calImgs.length) log(`  closer to accepted examples: ${(d.frames || []).filter((f) => f.closer === "good").length}/${(d.frames || []).length}`);
  for (const f of d.frames || []) log(`  frame ${f.i}${f.closer ? (f.closer === "good" ? " ○" : " ×") : ""} same ${f.same} pretty ${f.pretty} ${f.note || ""}`);
  for (const p of d.problems || []) if (p) log(`  ! ${p}`);
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({ model: VISION_MODEL(), ...d }, null, 1));
  log(`  side-by-side: ${sheet}\n  (the model can be wrong; a human looking at the side-by-side decides) cost $${cost ?? "?"}`);
  return { sheet, ...d };
}

async function main() {
  const { pos, flags } = parseArgs();
  if (!pos[1]) { console.log("Usage: node check/face.mjs <char> <video|image> [--frames 6] [--offline] [--box t,b,l,r]"); process.exit(1); }
  const c = loadCharacter(pos[0]);
  if (!c.face || !fs.existsSync(c.face)) throw new Error("master face missing (character/validate.mjs)");
  const file = path.resolve(pos[1]);
  if (!fs.existsSync(file)) throw new Error("not found: " + file);
  await checkFace(c, file, { frames: +(flags.frames || 6), offline: !!flags.offline, box: flags.box ? parseBox(flags.box) : null });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error("✗ " + e.message); process.exit(1); });
