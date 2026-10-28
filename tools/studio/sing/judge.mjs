#!/usr/bin/env node
// Blind listening test by an audio model (OpenRouter): takes are shuffled and relabelled every round, scores averaged.
//   node sing/judge.mjs [--ref speaking.wav] [--rounds 3] [--from 8] [--len 25] [--brief "what the song is"] take1.mp3 take2.mp3 ...
// Scores 1-10: quality (natural, full, no robotic/metallic/nasal artifacts), same (sounds like the --ref voice), overall.
// ~$0.05-0.2 per round depending on length. The model is a filter, not the final judge: listen to the top two yourself.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "../lib/args.mjs";
import { askJSON, AUDIO_MODEL } from "../lib/openrouter.mjs";
import { tmpFile } from "../lib/media.mjs";

const { pos: takes, flags } = parseArgs();
if (takes.length < 2) { console.log("Usage: node sing/judge.mjs [--ref voice.wav] [--rounds 3] take1 take2 ..."); process.exit(1); }
const clip = (f, from, len) => {
  const mp3 = tmpFile(".mp3");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(from), "-t", String(len), "-i", f, "-ac", "1", "-b:a", "96k", mp3]);
  return fs.readFileSync(mp3).toString("base64");
};
const from = +(flags.from ?? 0), len = +(flags.len ?? 25), rounds = +(flags.rounds ?? 3);
const data = Object.fromEntries(takes.map((t) => [t, clip(path.resolve(t), from, len)]));
const ref = flags.ref ? clip(path.resolve(flags.ref), 0, 30) : null;
const res = Object.fromEntries(takes.map((t) => [t, []]));
let cost = 0;
for (let r = 0; r < rounds; r++) {
  const order = [...takes].sort(() => Math.random() - 0.5);
  const content = [];
  if (ref) content.push({ type: "text", text: "Reference: the target voice speaking." }, { type: "input_audio", input_audio: { data: ref, format: "mp3" } });
  order.forEach((t, i) => content.push({ type: "text", text: `Take X${i + 1}:` }, { type: "input_audio", input_audio: { data: data[t], format: "mp3" } }));
  content.push({ type: "text", text: `${order.length} takes of the same song section${flags.brief ? ` (${flags.brief})` : ""}. You are a strict vocal producer. For each take give 1-10: quality (natural, full tone, no robotic/metallic/nasal/buzzy artifacts, clean sustains), ${ref ? "same (how much it sounds like the reference voice: timbre, age, texture), " : ""}overall (would you release it). Use the full scale. Reply JSON only: {"X1":{"quality":0,${ref ? '"same":0,' : ""}"overall":0,"flaw":"short"}}` });
  try {
    const { data: d, cost: c } = await askJSON({ content, model: flags.model || AUDIO_MODEL(), maxTokens: 2000, temperature: 0.5 });
    cost += c || 0;
    order.forEach((t, i) => d[`X${i + 1}`] && res[t].push(d[`X${i + 1}`]));
  } catch (e) { console.error(`round ${r + 1} failed: ${e.message.slice(0, 150)}`); }
}
const avg = (rs, k) => (rs.length ? (rs.reduce((a, x) => a + (+x[k] || 0), 0) / rs.length).toFixed(1) : "-");
const rows = takes.map((t) => ({ t, rs: res[t] })).sort((a, b) => avg(b.rs, "overall") - avg(a.rs, "overall"));
for (const { t, rs } of rows) console.log(`${path.basename(t).padEnd(28)} quality ${avg(rs, "quality")}${ref ? ` same ${avg(rs, "same")}` : ""} overall ${avg(rs, "overall")} n=${rs.length} | ${(rs[0]?.flaw || "").slice(0, 80)}`);
console.log(`cost ~$${cost.toFixed(3)}`);
