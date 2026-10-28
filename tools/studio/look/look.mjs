#!/usr/bin/env node
// Looks for one character: explore directions, turnaround sheet, outfit swap, style pack, 3/4 side faces.
// All image work is an EDIT of the master face (always reference image 1), via fal nano-banana-pro/edit.
// Usage:
//   node look/look.mjs explore <char> "<direction>" [--n 3]
//   node look/look.mjs sheet   <char> <look> [--n 1]
//   node look/look.mjs outfit  <char> <look> "<clothes>" [--image clothes.png] [--name tag] [--n 2]
//   node look/look.mjs style   <char> <styleKey> [--styles look/styles.example.json] [--n 1]
//   node look/look.mjs sides   <char>
//   node look/look.mjs status  <char>
// Add --dry-run to any paid command to print the prompt, references and cost without calling anything.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../lib/args.mjs";
import { loadCharacter, getLook, identityLine, outDir } from "../lib/character.mjs";
import { imageUri, download, stamp, slug, logSpend } from "../lib/media.mjs";
import { falRun } from "../lib/fal.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODEL = "fal-ai/nano-banana-pro/edit";
const PRICE = 0.15; // USD per image, approx.
const { pos, flags } = parseArgs();
const [cmd, dir, ...rest] = pos;
const DRY = !!flags["dry-run"];
const log = (...a) => console.log(...a);

async function edit(c, sub, tag, prompt, refs, { aspect, n }) {
  for (const r of refs) if (!fs.existsSync(r)) throw new Error(`reference image not found: ${r}`);
  log(`model ${MODEL} · ${n} image(s) · ${aspect} · about $${(PRICE * n).toFixed(2)}`);
  log(`refs (in order): ${refs.map((r) => path.relative(c.dir, r)).join(" → ")}`);
  log(`prompt: ${prompt}`);
  if (DRY) { log("(dry run: nothing sent)"); return []; }
  const res = await falRun(MODEL, { prompt, image_urls: refs.map((f) => imageUri(f)), aspect_ratio: aspect, resolution: "2K", num_images: n });
  if (!res.images?.length) throw new Error("fal returned no images: " + JSON.stringify(res).slice(0, 300));
  const d = outDir(c, sub), files = [];
  for (const [i, im] of res.images.entries()) files.push(await download(im.url, path.join(d, `${tag}-${stamp()}-${i + 1}.png`)));
  logSpend(path.join(c.dir, "out"), { tool: `look ${cmd}`, model: MODEL, usd: +(PRICE * n).toFixed(2), request_id: res.request_id });
  log(files.join("\n"));
  return files;
}

const vertical = (c) => (c.aspect === "9:16" ? "9:16" : "3:4");

async function main() {
  if (!cmd || !dir) { log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).join("\n")); process.exit(1); }
  const c = loadCharacter(dir);
  if (!c.face || !fs.existsSync(c.face)) throw new Error("character.json: face (master face) is missing; run character/validate.mjs");
  const n = +(flags.n || 0);

  if (cmd === "explore") {
    const direction = rest[0];
    if (!direction) throw new Error('explore needs a direction, e.g. "sweet pastel streamer, soft pink cardigan, two low pigtails"');
    const prompt = `Photo of the SAME person as image 1. ${identityLine(c)} New look: ${direction}. Keep the face exactly; only hair, makeup, outfit and mood follow the new look. ` +
      `${c.scene ? `Setting: ${c.scene}. ` : ""}Waist-up, facing the camera, soft frontal key light on the face, photorealistic, natural skin texture. No text, no watermark.`;
    await edit(c, "explore", slug(direction, 24), prompt, [c.face], { aspect: vertical(c), n: n || 3 });
    log("Pick the best one, save it as looks/<name>.png and add it under looks in character.json.");
  } else if (cmd === "sheet") {
    const l = getLook(c, rest[0]);
    const refs = [c.face, ...(l.ref ? [l.ref] : []), ...(c.body ? [c.body] : [])];
    const prompt = `Character turnaround sheet of the SAME person. ${identityLine(c)} ${l.ref ? "Makeup, expression and vibe must match image 2. " : ""}Outfit: ${l.outfit || c.outfit}. ` +
      `One clean dark-grey studio backdrop, soft beauty light with warm rim light. Layout: left large panel = face close-up front; middle = full body front standing; right column top = full body three-quarter view; right column bottom = full body side view. Same face in every panel. ` +
      `Vibe: ${l.vibe}. Photorealistic, editorial photo quality. No text, no watermark.`;
    await edit(c, "sheets", l.id, prompt, refs, { aspect: "16:9", n: n || 1 });
    log(`If you like it, point looks.${l.id}.sheet at it.`);
  } else if (cmd === "outfit") {
    const l = getLook(c, rest[0]);
    const desc = rest[1];
    if (!desc) throw new Error('outfit needs a clothes description, e.g. "white hoodie and light jeans"');
    const image = flags.image ? path.resolve(flags.image) : null;
    const refs = [c.face, ...(l.ref ? [l.ref] : []), ...(image ? [image] : [])];
    const prompt = `Photo of the SAME person. ${identityLine(c)} Keep the hairstyle, makeup and vibe from image ${l.ref ? 2 : 1} (${l.vibe}). ` +
      `Change ONLY the clothes to: ${desc}${image ? ` (the outfit in image ${refs.length})` : ""}. Do not change the face, hair or body shape. ` +
      `${c.scene ? `Setting: ${c.scene}. ` : ""}Full body from head to shoes, standing naturally, soft frontal key light, photorealistic, editorial quality, vertical. No text, no watermark.`;
    await edit(c, "outfits", `${l.id}-${slug(flags.name || desc, 24)}`, prompt, refs, { aspect: "9:16", n: n || 2 });
    log("To keep it as a new look, add an entry under looks with ref pointing at the best image.");
  } else if (cmd === "style") {
    const file = path.resolve(flags.styles || path.join(HERE, "styles.example.json"));
    const pack = JSON.parse(fs.readFileSync(file, "utf8"));
    const st = pack.styles?.[rest[0]];
    if (!st) throw new Error(`no style "${rest[0]}" in ${path.basename(file)}. Styles: ${Object.keys(pack.styles || {}).join(", ")}`);
    const prompt = `${pack.common} Face identity: ${c.identity}. ${c.scene ? `Setting: ${c.scene}. ` : ""}${st.prompt}`;
    await edit(c, "styles", rest[0], prompt, [c.face, ...(c.live?.frame && fs.existsSync(c.live.frame) ? [c.live.frame] : [])], { aspect: c.aspect === "16:9" ? "16:9" : "9:16", n: n || 1 });
  } else if (cmd === "sides") {
    const prompt = (dirn) => `The SAME person as image 1, same hair, same makeup, same clothes. ${identityLine(c)} Head and shoulders, three-quarter view turned to the ${dirn} (about 40 degrees), eyes looking slightly toward the camera, neutral soft smile, even soft light, plain light-grey background, photorealistic, sharp. No text.`;
    await edit(c, "sides", "left", prompt("left"), [c.face], { aspect: "1:1", n: 1 });
    await edit(c, "sides", "right", prompt("right"), [c.face], { aspect: "1:1", n: 1 });
    log("Look at both next to the master face (check/face.mjs <char> <image> --offline makes a side-by-side), then list them under sides.");
  } else if (cmd === "status") {
    log(`${c.name} · master face ${path.relative(c.dir, c.face)} · aspect ${c.aspect || "16:9"}`);
    for (const l of Object.values(c.looks || {})) log(`  ${l.id}: ${l.label || ""} ${l.ref ? "ref ✓" : "ref -"} ${l.sheet ? "sheet ✓" : "sheet -"} · ${l.use || ""}`);
    const o = path.join(c.dir, "out");
    if (fs.existsSync(o)) for (const s of fs.readdirSync(o)) if (fs.statSync(path.join(o, s)).isDirectory()) log(`  out/${s}: ${fs.readdirSync(path.join(o, s)).length}`);
  } else throw new Error(`unknown command ${cmd}`);
}

main().catch((e) => { console.error("✗ " + e.message); process.exit(1); });
