#!/usr/bin/env node
// Check clips and finished films.
//   node check/clip.mjs check <clip.mp4> <cards.json> --shot <id> [--frames 6]   does this clip pass its shot card? (OpenRouter ~$0.004)
//   node check/clip.mjs cut   <film.mp4> [cards.json] --goal "<one line>" [--frames 16] [--vertical|--horizontal] [--offline]
//        before publishing: export settings, loudness/peaks/clicks, black frames (measured by ffmpeg, always exact)
//        + story / cuts / continuity / captions / ending judged from frames by a model (skipped with --offline)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "../lib/args.mjs";
import { askJSON } from "../lib/openrouter.mjs";
import { ffLog } from "../lib/media.mjs";

const { pos, flags } = parseArgs();
const [cmd, a, b] = pos;

function frames(clip, n) {
  const d = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clip]).toString().trim();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clip-"));
  const list = [];
  for (let i = 0; i < n; i++) {
    const t = Math.min(d - 0.05, (d * (i + 0.5)) / n), f = path.join(dir, `f${i}.jpg`);
    execFileSync("ffmpeg", ["-v", "error", "-ss", t.toFixed(2), "-i", clip, "-frames:v", "1", "-vf", "scale=768:-2", "-q:v", "4", f]);
    list.push({ t, uri: "data:image/jpeg;base64," + fs.readFileSync(f).toString("base64") });
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { dur: d, list };
}

const CHECK_SYSTEM = `You are checking a generated AI video clip against its shot card. Frames are in time order. Judge only what is visible.
For each check answer pass true/false with a short reason; pass=null if the frames cannot show it.
Also look for common failures not on the card: deformed hands or wrong finger count, objects appearing/vanishing or switching hands, the face changing between frames, garbled text or logos, the action not reaching its end state, a frozen clip.
Reply JSON only: {"results":[{"check":"","pass":true,"why":""}],"extra_issues":[""],"usable":"which part is usable, e.g. 'frames 2-5' or 'none'","verdict":"pass"|"fail"|"unsure"}`;

async function check(clip, cardFile, shot, n) {
  let card = JSON.parse(fs.readFileSync(cardFile, "utf8"));
  if (card.cards) {
    if (shot == null) throw new Error("this file has several cards: pass --shot <id>");
    card = card.cards.find((c) => String(c.id) === String(shot));
    if (!card) throw new Error(`no card with id ${shot}`);
  }
  if (!card.checks?.length) throw new Error("this card has no checks (run shots/card.mjs lint first)");
  const { dur, list } = frames(clip, n);
  const { data, cost } = await askJSON({ system: CHECK_SYSTEM, maxTokens: 3000,
    content: [{ type: "text", text: `Shot card:\n${JSON.stringify(card, null, 1)}\n\nClip ${dur.toFixed(1)} s; ${n} frames at ${list.map((f) => f.t.toFixed(1) + "s").join(", ")}.` }, ...list.map((f) => ({ type: "image_url", image_url: { url: f.uri } }))] });
  const mark = (p) => (p === true ? "✓" : p === false ? "✗" : "?");
  console.log(`${path.basename(clip)}  verdict: ${data.verdict}  usable: ${data.usable}`);
  for (const r of data.results || []) console.log(` ${mark(r.pass)} ${r.check} — ${r.why}`);
  for (const e of data.extra_issues || []) if (e) console.log(` ! ${e}`);
  console.log(`cost $${cost ?? "?"}`);
}

export function probe(clip) {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", clip]).toString());
  const v = j.streams.find((s) => s.codec_type === "video"), au = j.streams.find((s) => s.codec_type === "audio");
  const [n, d] = (v?.r_frame_rate || "0/1").split("/").map(Number);
  return { container: j.format.format_name, dur: +j.format.duration, kbps: Math.round(j.format.bit_rate / 1000),
    video: v && { codec: v.codec_name, w: v.width, h: v.height, fps: +(n / d).toFixed(2) }, audio: au && { codec: au.codec_name, rate: +au.sample_rate, ch: au.channels } };
}

export function measure(clip, dur, hasAudio) {
  const out = {};
  if (hasAudio) {
    const s = ffLog(["-hide_banner", "-nostats", "-i", clip, "-af", "ebur128=peak=true,silencedetect=n=-45dB:d=0.6", "-f", "null", "-"]);
    out.lufs = +(s.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop()?.match(/-?[\d.]+/)[0] ?? NaN);
    out.true_peak_dbtp = +(s.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.pop()?.match(/-?[\d.]+/)[0] ?? NaN);
    out.silences = [...s.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map((m) => `${(+m[1]).toFixed(1)}-${(+m[2]).toFixed(1)}s`);
    const edge = (ss, t) => { const r = ffLog(["-hide_banner", "-nostats", "-ss", String(ss), "-t", String(t), "-i", clip, "-af", "volumedetect", "-f", "null", "-"]); return +(r.match(/mean_volume: (-?[\d.]+)/)?.[1] ?? NaN); };
    out.first_0_2s_db = edge(0, 0.2); out.last_0_2s_db = edge(Math.max(0, dur - 0.2), 0.2);
  }
  const bl = ffLog(["-hide_banner", "-nostats", "-i", clip, "-vf", "blackdetect=d=0.3:pix_th=0.08", "-an", "-f", "null", "-"]);
  out.black = [...bl.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => `${(+m[1]).toFixed(1)}-${(+m[2]).toFixed(1)}s`);
  return out;
}

export function exportNotes(p, m, vertical) {
  const n = [];
  if (!/mp4|mov/.test(p.container)) n.push(`container ${p.container}; MP4 is safest`);
  if (p.video?.codec !== "h264") n.push(`video codec ${p.video?.codec}; H.264 is safest`);
  if (!p.audio) n.push("no audio track");
  else if (p.audio.codec !== "aac") n.push(`audio codec ${p.audio.codec}; AAC is safest`);
  const isV = p.video.h > p.video.w;
  if (vertical != null && isV !== vertical) n.push(`picture is ${isV ? "vertical" : "horizontal"} ${p.video.w}x${p.video.h}; asked for ${vertical ? "vertical" : "horizontal"}`);
  if (Math.max(p.video.w, p.video.h) < 1280) n.push(`${p.video.w}x${p.video.h} is small; platforms will make it softer`);
  if (p.kbps < 2500) n.push(`bitrate ${p.kbps} kbps is low; detail gets crushed`);
  if (m.true_peak_dbtp > -1) n.push(`peak ${m.true_peak_dbtp} dBTP is above -1: may clip`);
  if (m.lufs < -20) n.push(`loudness ${m.lufs} LUFS is quiet (phones; -16 to -14 is common online)`);
  if (m.lufs > -11) n.push(`loudness ${m.lufs} LUFS is loud`);
  if (m.first_0_2s_db > -25) n.push(`first 0.2 s already loud (${m.first_0_2s_db} dB): possible click, add a short fade-in`);
  if (m.last_0_2s_db > -25) n.push(`last 0.2 s still loud (${m.last_0_2s_db} dB): sound cut off, add a short fade-out`);
  if (m.black?.length) n.push(`black frames: ${m.black.join(", ")}`);
  return n;
}

const CUT_SYSTEM = `You are reviewing a FINISHED short AI video before it is published.
- Story: can a first-time viewer say what happened? prepare / action / result / reaction; an action with no result or reaction leaves the beat unfinished.
- Cuts: too early if the viewer is still finding the point; too late if nothing changes any more.
- Continuity across cuts: hands, props, direction, action progress; a face/outfit must not change within the same moment.
- Captions: readable at phone size, one idea at a time, not over faces or the key action, no spoilers, no typos in names/numbers/negations, clear of platform buttons (bottom ~15% and right edge on vertical video).
- Ending: last line, music and picture end as intended.
You get frames with timestamps plus measured numbers. You cannot hear: judge sound only from the numbers.
Reply JSON only: {"one_line":"","story":[""],"cuts":[""],"continuity":[""],"text":[""],"ending":"","sound":[""],"export":[""],"fix_first":[""],"verdict":"publish"|"fix"|"redo"}`;

async function cut(clip, cardFile, goal, n, vertical, offline) {
  const p = probe(clip), m = measure(clip, p.dur, !!p.audio), notes = exportNotes(p, m, vertical);
  console.log(`${path.basename(clip)}  ${p.video.w}x${p.video.h} ${p.video.fps}fps ${p.dur.toFixed(1)}s ${p.kbps}kbps  loudness ${m.lufs ?? "-"} LUFS  peak ${m.true_peak_dbtp ?? "-"} dBTP`);
  console.log(notes.length ? "measured problems:\n - " + notes.join("\n - ") : "measured: export and sound OK");
  if (offline) return { probe: p, measure: m, notes };
  const { list } = frames(clip, n);
  const cards = cardFile ? JSON.parse(fs.readFileSync(cardFile, "utf8")) : null;
  const { data, cost } = await askJSON({ system: CUT_SYSTEM, maxTokens: 4000, content: [{ type: "text", text: `${goal ? `Goal: ${goal}\n` : ""}${cards ? `Planned cards:\n${JSON.stringify(cards.cards || cards).slice(0, 12000)}\n` : ""}Export: ${JSON.stringify(p)}\nMeasurements: ${JSON.stringify(m)}\nRule notes: ${JSON.stringify(notes)}\n${n} frames at ${list.map((f) => f.t.toFixed(1) + "s").join(", ")}.` }, ...list.map((f) => ({ type: "image_url", image_url: { url: f.uri } }))] });
  const sec = (t, x) => { const a = (Array.isArray(x) ? x : [x]).filter(Boolean); if (a.length) console.log(`${t}\n - ${a.join("\n - ")}`); };
  console.log(`verdict: ${data.verdict} · a viewer would say: ${data.one_line}`);
  sec("story", data.story); sec("cuts", data.cuts); sec("continuity", data.continuity); sec("captions", data.text); sec("ending", data.ending); sec("sound", data.sound); sec("export", data.export); sec("fix first", data.fix_first);
  console.log(`cost $${cost ?? "?"}`);
}

async function main() {
  if (cmd === "check" && a && b) return check(path.resolve(a), path.resolve(b), flags.shot, +(flags.frames || 6));
  if (cmd === "cut" && a) return cut(path.resolve(a), b ? path.resolve(b) : null, flags.goal, +(flags.frames || 16), flags.vertical ? true : flags.horizontal ? false : null, !!flags.offline);
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((x) => x.startsWith("//")).join("\n"));
  process.exit(1);
}
main().catch((e) => { console.error("✗ " + e.message); process.exit(1); });
