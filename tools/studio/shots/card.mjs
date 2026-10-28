#!/usr/bin/env node
// Storyboard → shot cards → generation jobs.
//   node shots/card.mjs rules <storyboard.json>                       offline rule check (free)
//   node shots/card.mjs lint  <storyboard.json> [out.cards.json]      model rewrites shots into 9-line cards + risks (OpenRouter, ~$0.01)
//   node shots/card.mjs jobs  <storyboard.json> [--char <dir>] [--via fal-seedance] [--out studio-out/jobs]   one gen.mjs job per shot (offline)
// Storyboard: an array of shots or {aspect, shots:[...]}; any fields (id, duration, framing, camera, action, start, end, prompt, line, via, images ...).
// Method adapted from a public AI-video primer series by @AdrianPunk115 (structure, shots, continuity, editing).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../lib/args.mjs";
import { askJSON, VISION_MODEL } from "../lib/openrouter.mjs";
import { loadCharacter, identityLine } from "../lib/character.mjs";
import { ruleCheck } from "./rules.mjs";
import { outRoot } from "../lib/media.mjs";

const { pos, flags } = parseArgs();
const [cmd, file, outArg] = pos;

export function loadStoryboard(f) {
  const d = JSON.parse(fs.readFileSync(f, "utf8"));
  const shots = Array.isArray(d) ? d : d.shots;
  if (!Array.isArray(shots)) throw new Error("storyboard needs an array of shots, or {shots:[...]}");
  return { meta: Array.isArray(d) ? {} : d, shots: shots.map((s, i) => ({ id: s.id ?? i + 1, ...s })) };
}

function printRules(r) {
  for (const s of r.shots) {
    console.log(`#${s.id} [${s.risk}]${s.findings.length ? "" : " ok"}`);
    for (const f of s.findings) console.log(`   ${f.level === "high" ? "✗" : f.level === "mid" ? "!" : "·"} ${f.msg}`);
  }
  for (const x of r.sequence) console.log("sequence: " + x);
}

const CARD_FIELDS = `Each card has these fields (same language as the input):
- task: the ONE thing this shot must make the viewer understand.
- framing: actual frame range (full body / waist up / face / hands and object) and what must stay in frame.
- viewpoint: where the camera stands and looks from.
- action: who does ONE main action.
- camera: fixed (relative to what) or ONE clear move. Do not stack moves.
- focus_light: what must be sharp; where the key light comes from.
- start: state at the first frame (positions, what each hand holds).
- end: state at the last frame.
- keep: what must match the previous shot (look, outfit, props, which hand holds what, screen direction, 180-degree line, light direction).
- checks: 2-5 pass/fail checks verifiable from frames of the clip.`;

const LINT_SYSTEM = `You are a film editor reviewing an AI-video storyboard before any clip is generated. Method:
- One shot = one viewing task; a shot that adds no information should be cut or merged.
- Write visible states, not adjectives.
- Every shot needs a start state, ONE main action and an end state, so the clip can be checked.
- Camera: fixed relative to something, or one clear move. A cut to another angle is a new shot.
- Framing by need: environment = wide; movement = full body; expression + gesture = waist up; reaction = chest up; detail = close-up. Faces in full-body shots are tiny and drift; keep talking/singing shots waist-up or closer.
- Continuity: screen direction, 180-degree line, what each hand holds, light direction.
- Risky for video models: exact finger counts, objects passing between hands, text/logos, a face turning, many people doing the same gesture. Each gets an explicit check.
- Editing needs: every action gets its result and usually a reaction; leave a little still time before and after each action for cut room; decide 16:9 or 9:16 before generating.
- Dances are performed standing, never seated.

${CARD_FIELDS}

List problems with the ORIGINAL shot in "issues" (short, concrete; empty if none) and "risk": "low"|"mid"|"high".
Review the whole sequence in "sequence_issues". Keep every shot id. Reply JSON only:
{"cards":[{"id":1,"task":"","framing":"","viewpoint":"","action":"","camera":"","focus_light":"","start":"","end":"","keep":"","checks":[""],"issues":[""],"risk":"low"}],"sequence_issues":[""]}`;

async function lint(f, out) {
  const { shots } = loadStoryboard(f);
  const rules = ruleCheck(shots);
  console.log("— rule check (offline) —"); printRules(rules);
  const { data, cost } = await askJSON({ system: LINT_SYSTEM, content: `Storyboard (${shots.length} shots, JSON):\n${JSON.stringify(shots, null, 1)}\n\nOffline rule findings:\n${JSON.stringify(rules.shots)}`, maxTokens: 12000 });
  out ||= f.replace(/\.json$/, "") + ".cards.json";
  fs.writeFileSync(out, JSON.stringify({ source: path.basename(f), model: VISION_MODEL(), made: new Date().toISOString(), rules: rules.shots, ...data }, null, 1));
  console.log("— model cards —");
  for (const c of data.cards) console.log(`#${c.id} [${c.risk}] ${c.task}${c.issues?.length ? "\n   - " + c.issues.join("\n   - ") : ""}`);
  if (data.sequence_issues?.length) console.log("sequence:\n - " + data.sequence_issues.join("\n - "));
  console.log(`cards saved: ${out}  cost $${cost ?? "?"}`);
}

// Turn each shot into a gen.mjs job. Prompt = identity + visible start/action/end + camera + framing.
function jobs(f) {
  const { meta, shots } = loadStoryboard(f);
  // --char is relative to where you run the command; "character" inside the storyboard is relative to the storyboard file
  const c = flags.char ? loadCharacter(path.resolve(flags.char)) : meta.character ? loadCharacter(path.resolve(path.dirname(f), meta.character)) : null;
  const outDir = path.resolve(flags.out || path.join(outRoot(), "jobs"));
  fs.mkdirSync(outDir, { recursive: true });
  const aspect = meta.aspect || c?.aspect || "16:9";
  const written = [];
  for (const s of shots) {
    const look = c && s.look ? c.looks?.[s.look] : null;
    const prompt = [
      c ? `The person from image 1. ${identityLine(c)}` : "",
      look ? `Look: ${look.vibe}. Outfit: ${look.outfit || c.outfit}.` : c?.outfit ? `Outfit: ${c.outfit}.` : "",
      s.prompt || "",
      s.framing ? `Framing: ${s.framing}.` : "",
      s.camera ? `Camera: ${s.camera}.` : "",
      s.start ? `First frame: ${s.start}.` : "",
      s.action ? `Action: ${s.action}.` : "",
      s.end ? `Last frame: ${s.end}.` : "",
      s.line ? `Spoken line: "${s.line}".` : "",
      c?.scene && !/setting|room|background/i.test(s.prompt || "") ? `Setting: ${c.scene}.` : "",
      "Photorealistic, natural motion, sharp face, no text, no watermark.",
    ].filter(Boolean).join(" ");
    const rel = (p) => path.relative(outDir, p);
    const images = s.images ? s.images.map((p) => rel(path.resolve(path.dirname(f), p))) : c ? [rel(c.face), ...(look?.ref ? [rel(look.ref)] : [])] : [];
    const job = { name: `${String(s.id).padStart(2, "0")}-${String(s.title || "shot").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 20)}`, shot: s.id,
      via: s.via || flags.via || "fal-seedance", prompt, duration: +s.duration || 5, aspect, images, audio: s.audio || [], sound: !!s.sound };
    const jf = path.join(outDir, `${job.name}.json`);
    fs.writeFileSync(jf, JSON.stringify(job, null, 1));
    written.push(jf);
  }
  console.log(`${written.length} job(s) in ${outDir}\nnext: node shots/gen.mjs <job.json> --dry-run   (then without --dry-run to spend)`);
}

async function main() {
  if (!cmd || !file) { console.log("Usage: card.mjs rules|lint|jobs <storyboard.json> ... (see file header)"); process.exit(1); }
  if (cmd === "rules") { const r = ruleCheck(loadStoryboard(file).shots); printRules(r); if (flags.json) fs.writeFileSync(flags.json, JSON.stringify(r, null, 1)); }
  else if (cmd === "lint") await lint(file, outArg);
  else if (cmd === "jobs") jobs(file);
  else throw new Error("unknown command " + cmd);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error("✗ " + e.message); process.exit(1); });
