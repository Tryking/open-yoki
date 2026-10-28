// character.json: one master face + looks. Every path is relative to the character folder.
import fs from "node:fs";
import path from "node:path";
import { dims } from "./media.mjs";

export function loadCharacter(dir) {
  dir = path.resolve(dir);
  const f = path.join(dir, "character.json");
  if (!fs.existsSync(f)) throw new Error(`${dir} has no character.json (copy character/example/ and edit it)`);
  const c = JSON.parse(fs.readFileSync(f, "utf8"));
  const abs = (p) => (p ? path.resolve(dir, p) : p);
  c.dir = dir;
  c.face = abs(c.face);
  c.body = abs(c.body);
  c.sides = (c.sides || []).map(abs);
  if (c.live) c.live = { ...c.live, frame: abs(c.live.frame), body: abs(c.live.body) };
  c.calib = { bad: (c.calib?.bad || []).map(abs), good: (c.calib?.good || []).map(abs) };
  for (const [k, l] of Object.entries(c.looks || {})) { l.id = k; l.ref = abs(l.ref); l.sheet = abs(l.sheet); l.body = abs(l.body); }
  return c;
}

export function getLook(c, name) {
  const l = c.looks?.[name];
  if (!l) throw new Error(`no look "${name}". Looks: ${Object.keys(c.looks || {}).join(", ") || "none"}`);
  return l;
}

export const identityLine = (c) => `Face identity must match image 1 exactly: ${c.identity}.`;
export const outDir = (c, sub) => { const d = path.join(c.dir, "out", sub); fs.mkdirSync(d, { recursive: true }); return d; };

// Offline checks: returns { errors, warnings }. Used by character/validate.mjs and before paid calls.
export function validateCharacter(dir) {
  const errors = [], warnings = [];
  let c;
  try { c = loadCharacter(dir); } catch (e) { return { errors: [e.message], warnings, c: null }; }
  const rel = (p) => path.relative(c.dir, p);
  const img = (p, label, { min = 512, required = false } = {}) => {
    if (!p) { if (required) errors.push(`${label} is missing`); return; }
    if (!fs.existsSync(p)) { (required ? errors : warnings).push(`${label}: file not found ${rel(p)}`); return; }
    if (!/\.(png|jpe?g|webp)$/i.test(p)) errors.push(`${label}: ${rel(p)} is not png/jpg/webp`);
    try { const [w, h] = dims(p); if (Math.min(w, h) < min) warnings.push(`${label}: ${rel(p)} is ${w}x${h}; under ${min}px the face drifts more`); }
    catch { errors.push(`${label}: cannot read ${rel(p)}`); }
  };
  if (!c.name) errors.push("name is missing");
  img(c.face, "face (master face)", { required: true, min: 768 });
  if (!c.identity || c.identity.length < 40) errors.push("identity: write one English sentence (40+ chars) on eyes, eyelids, bangs, nose, lips, face shape, makeup");
  else if (/[㐀-鿿]/.test(c.identity)) warnings.push("identity: write it in English; image models follow English face descriptions more closely");
  img(c.body, "body (standing full-body photo)");
  if (!c.body) warnings.push("body: no standing full-body photo; dance results get worse without one");
  c.sides.forEach((p, i) => img(p, `sides[${i}]`));
  const looks = Object.values(c.looks || {});
  if (!looks.length) warnings.push("looks: none yet. Run look/look.mjs explore, pick the best, add it under looks");
  for (const l of looks) {
    if (!l.vibe) errors.push(`looks.${l.id}.vibe is missing (English: makeup, expression, mood)`);
    if (!l.ref && !l.sheet) warnings.push(`looks.${l.id}: no ref photo yet (needed for dance)`);
    img(l.ref, `looks.${l.id}.ref`); img(l.sheet, `looks.${l.id}.sheet`, { min: 512 }); img(l.body, `looks.${l.id}.body`);
  }
  if (c.live) img(c.live.frame, "live.frame", { required: true });
  for (const k of ["bad", "good"]) {
    c.calib[k].forEach((p, i) => img(p, `calib.${k}[${i}]`, { min: 64 }));
    if (c.calib[k].length && c.calib[k].length < 2) warnings.push(`calib.${k}: add at least 2 examples`);
  }
  if (!c.calib.bad.length || !c.calib.good.length) warnings.push("calib: no human-judged good/bad face crops yet; the face score is less reliable until you add some (from out/check/)");
  const aspect = c.aspect || "16:9";
  if (!["16:9", "9:16", "1:1"].includes(aspect)) errors.push(`aspect must be 16:9, 9:16 or 1:1 (got ${aspect})`);
  return { errors, warnings, c };
}
