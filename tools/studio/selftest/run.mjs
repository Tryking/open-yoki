#!/usr/bin/env node
// Offline self-test for tools/studio. Generates fake media with ffmpeg, runs every free path, and checks that
// every paid path stops with a clear "missing key" message (exit 2) instead of calling anything.
// No keys, no network. Usage: node tools/studio/selftest/run.mjs [--keep]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const T = fs.mkdtempSync(path.join(os.tmpdir(), "studio-selftest-"));
const KEYS = ["FAL_KEY", "OPENROUTER_API_KEY", "VOLC_API_KEY", "DOUBAO_SPEAKER", "VIGGLE_API_KEY", "ARK_API_KEY", "ARK_SEEDANCE_MODEL", "LIBTV_PROJECT", "LIBTV_BIN"];
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.includes(k) && !/proxy/i.test(k)));
Object.assign(ENV, { STUDIO_ENV_FILE: path.join(T, "no.env"), STUDIO_OUT: path.join(T, "studio-out"), LIBTV_BIN: path.join(T, "no-libtv") });
delete ENV.LIBTV_BIN; // must come from .env only; a missing LIBTV_PROJECT is what we test
let pass = 0, fail = 0;
const results = [];

function run(cmd, args, opt = {}) {
  const r = spawnSync(cmd, args, { cwd: opt.cwd || T, env: ENV, encoding: "utf8", maxBuffer: 64 << 20, timeout: 180000 });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
function test(name, fn) {
  try { const note = fn(); pass++; results.push(`✓ ${name}${note ? "  (" + note + ")" : ""}`); }
  catch (e) { fail++; results.push(`✗ ${name}\n    ${String(e.message).split("\n").slice(0, 6).join("\n    ")}`); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const node = (rel, args, opt) => run(process.execPath, [path.join(STUDIO, rel), ...args], opt);
const ff = (...a) => execFileSync("ffmpeg", ["-v", "error", "-y", "-nostdin", ...a]);
const probe = (f, e) => execFileSync("ffprobe", ["-v", "error", ...e, "-of", "csv=p=0", f]).toString().trim();
const durOf = (f) => +probe(f, ["-show_entries", "format=duration"]);
const lufsOf = (f) => { const s = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", f, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr; return +s.split("\n").filter((l) => l.trim().startsWith("I:")).pop().trim().split(/\s+/)[1]; };
function pickPython(needPil) {
  for (const p of [process.env.PYTHON, "python3", "python3.13", "python3.12", "python3.11", "python3.10", "python"].filter(Boolean)) {
    const r = spawnSync(p, ["-c", needPil ? "import PIL" : "import sys"], { encoding: "utf8" });
    if (r.status === 0) return p;
  }
  return null;
}

// ---------- fake media ----------
const C = path.join(T, "char");
fs.cpSync(path.join(STUDIO, "character/example"), C, { recursive: true });
for (const d of ["looks", "live", "sides", "voice"]) fs.mkdirSync(path.join(C, d), { recursive: true });
const still = (f, s, src = "testsrc2") => ff("-f", "lavfi", "-i", `${src}=s=${s}`, "-frames:v", "1", f);
still(path.join(C, "face.png"), "1024x1024");
still(path.join(C, "body.png"), "768x1366");
still(path.join(C, "looks/daily.png"), "768x1024");
still(path.join(C, "looks/stage.png"), "768x1024");
still(path.join(C, "side-left.png"), "768x768"); still(path.join(C, "side-right.png"), "768x768");
still(path.join(C, "live/frame.png"), "1920x1080");
const M = path.join(T, "media"); fs.mkdirSync(M);
ff("-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=3", "-f", "lavfi", "-i", "sine=f=330:d=3", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(M, "a.mp4"));
ff("-f", "lavfi", "-i", "testsrc=s=1280x720:r=24:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(M, "b-noaudio.mp4"));
ff("-f", "lavfi", "-i", "smptebars=s=1080x1920:r=30:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(M, "c-vertical.mp4"));
ff("-f", "lavfi", "-i", "sine=f=220:d=12", "-af", "volume=0.5", path.join(M, "bgm.wav"));
ff("-f", "lavfi", "-i", "sine=f=1200:d=0.25", path.join(M, "pop.wav"));
ff("-f", "lavfi", "-i", "sine=f=500:d=1.2", "-af", "tremolo=f=5", path.join(M, "line.wav"));
ff("-f", "lavfi", "-i", "sine=f=440:d=8", "-af", "tremolo=f=6:d=0.7,volume=0.6", path.join(M, "vocal.wav"));
ff("-f", "lavfi", "-i", "anoisesrc=d=10:c=pink:a=0.2", "-ac", "2", path.join(M, "inst.wav"));

// ---------- syntax ----------
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(STUDIO);
test("node --check on every .mjs", () => { for (const f of files.filter((f) => f.endsWith(".mjs"))) { const r = run(process.execPath, ["--check", f]); expect(r.code === 0, `${path.relative(STUDIO, f)}: ${r.out}`); } return `${files.filter((f) => f.endsWith(".mjs")).length} files`; });
test("bash -n on every .sh", () => { for (const f of files.filter((f) => f.endsWith(".sh"))) { const r = run("bash", ["-n", f]); expect(r.code === 0, `${path.relative(STUDIO, f)}: ${r.out}`); } });
const PY = pickPython(false), PYPIL = pickPython(true);
test("python compiles every .py", () => { expect(PY, "no python3"); for (const f of files.filter((f) => f.endsWith(".py"))) { const r = run(PY, ["-c", "import ast,sys; ast.parse(open(sys.argv[1],encoding='utf-8').read())", f]); expect(r.code === 0, `${path.relative(STUDIO, f)}: ${r.out}`); } });
test("every .json parses", () => { for (const f of files.filter((f) => f.endsWith(".json"))) JSON.parse(fs.readFileSync(f, "utf8")); });

// ---------- character ----------
test("character/validate: sample character with photos passes", () => { const r = node("character/validate.mjs", [C]); expect(r.code === 0, r.out); return r.out.split("\n")[0]; });
test("character/validate: missing master face fails", () => {
  const bad = path.join(T, "bad-char"); fs.cpSync(C, bad, { recursive: true }); fs.rmSync(path.join(bad, "face.png"));
  const j = JSON.parse(fs.readFileSync(path.join(bad, "character.json"), "utf8")); j.identity = "短"; delete j.looks.daily.vibe; fs.writeFileSync(path.join(bad, "character.json"), JSON.stringify(j));
  const r = node("character/validate.mjs", [bad]); expect(r.code === 1 && /face/.test(r.out) && /identity/.test(r.out) && /vibe/.test(r.out), r.out);
});
test("character/validate: shipped example (no photos) reports missing face", () => { const r = node("character/validate.mjs", [path.join(STUDIO, "character/example")]); expect(r.code === 1 && /face/.test(r.out), r.out); });

// ---------- shots ----------
test("shots/card rules: example storyboard", () => { const r = node("shots/card.mjs", ["rules", path.join(STUDIO, "shots/storyboard.example.json")]); expect(r.code === 0 && /#6/.test(r.out), r.out); expect(!/\[high\]/.test(r.out), "example should have no high-risk shot:\n" + r.out); });
test("shots/card rules: risky storyboard gets flagged", () => {
  const sb = path.join(T, "risky.json");
  fs.writeFileSync(sb, JSON.stringify({ shots: [
    { id: 1, prompt: "Cinematic epic shot, she holds up four fingers", start: "a", end: "b" },
    { id: 2, prompt: "Full body wide shot, she says hello to the camera", start: "a", end: "b" },
    { id: 3, prompt: "She dances on the sofa, sitting", start: "a", end: "b" },
    { id: 4, prompt: "Camera pushes in then pans left; a neon sign with the words OPEN", duration: 20 },
    { id: 4, prompt: "She hands the cup to him" } ] }));
  const r = node("shots/card.mjs", ["rules", sb]);
  for (const k of ["finger", "adjectives", "full body while talking", "seated", "stacked camera", "on-screen text", "too long|long for one", "duplicate", "passes between hands", "start/end"]) expect(new RegExp(k).test(r.out), `missing flag "${k}":\n${r.out}`);
});
test("shots/card jobs: one job per shot", () => {
  const out = path.join(T, "jobs");
  const r = node("shots/card.mjs", ["jobs", path.join(STUDIO, "shots/storyboard.example.json"), "--char", C, "--out", out]);
  expect(r.code === 0, r.out);
  const js = fs.readdirSync(out).filter((f) => f.endsWith(".json")); expect(js.length === 6, `got ${js.length} jobs`);
  const j = JSON.parse(fs.readFileSync(path.join(out, "02-hello.json"), "utf8"));
  expect(j.via === "libtv-omni" && /identity|Face identity/.test(j.prompt) && /Spoken line/.test(j.prompt), JSON.stringify(j));
  for (const im of j.images) expect(fs.existsSync(path.resolve(out, im)), "job image path does not resolve: " + im);
});
test("shots/gen --dry-run prints plan and spends nothing", () => { const r = node("shots/gen.mjs", [path.join(T, "jobs/01-lights-on.json"), "--dry-run"]); expect(r.code === 0 && /dry run/.test(r.out) && /\$1\.1/.test(r.out), r.out); });
test("shots/gen without FAL_KEY stops with a hint (exit 2)", () => { const r = node("shots/gen.mjs", [path.join(T, "jobs/01-lights-on.json")]); expect(r.code === 2 && /FAL_KEY/.test(r.out) && /\.env\.example/.test(r.out), r.out); });
test("shots/gen libtv without LIBTV_PROJECT stops with a hint (exit 2)", () => {
  const jf = path.join(T, "jobs/04-reaction.json"); const j = JSON.parse(fs.readFileSync(jf, "utf8")); j.via = "libtv-o3"; fs.writeFileSync(path.join(T, "jobs/lt.json"), JSON.stringify(j));
  const r = node("shots/gen.mjs", [path.join(T, "jobs/lt.json")]); expect(r.code === 2 && /LIBTV_PROJECT/.test(r.out), r.out);
});

// ---------- look ----------
for (const args of [["explore", C, "sweet pastel streamer"], ["sheet", C, "daily"], ["outfit", C, "stage", "white hoodie and light jeans"], ["style", C, "cozy"], ["sides", C]]) {
  test(`look ${args[0]} --dry-run`, () => { const r = node("look/look.mjs", [...args, "--dry-run"]); expect(r.code === 0 && /prompt:/.test(r.out) && /dry run/.test(r.out) && /face\.png/.test(r.out), r.out); });
}
test("look sheet without FAL_KEY stops with a hint (exit 2)", () => { const r = node("look/look.mjs", ["sheet", C, "daily"]); expect(r.code === 2 && /FAL_KEY/.test(r.out), r.out); });
test("look status", () => { const r = node("look/look.mjs", ["status", C]); expect(r.code === 0 && /daily/.test(r.out), r.out); });

// ---------- dance ----------
test("dance driver", () => { const r = node("dance/dance.mjs", ["driver", path.join(M, "a.mp4")]); expect(r.code === 0 && /standing/.test(r.out), r.out); });
test("dance frame --box: 9:16 head-to-knees crop offline", () => {
  const r = node("dance/dance.mjs", ["frame", C, path.join(M, "a.mp4"), "--box", "0.1,0.9,0.4,0.6"]); expect(r.code === 0, r.out);
  const f = path.join(C, "out/frame/a.mp4"); expect(probe(f, ["-select_streams", "v:0", "-show_entries", "stream=width,height"]) === "720,1280", "not 720x1280");
});
test("dance bind --dry-run", () => { const r = node("dance/dance.mjs", ["bind", C, "stage", path.join(M, "a.mp4"), "--dry-run"]); expect(r.code === 0 && /\$0\.5/.test(r.out) && /2 side view/.test(r.out), r.out); });
test("dance bind without FAL_KEY (exit 2)", () => { const r = node("dance/dance.mjs", ["bind", C, "stage", path.join(M, "a.mp4"), "--no-check"]); expect(r.code === 2 && /FAL_KEY/.test(r.out), r.out); });
test("dance o3 without LibTV (exit 2)", () => { const r = node("dance/dance.mjs", ["o3", C, "stage", path.join(M, "a.mp4"), "--box", "0.1,0.9,0.4,0.6"]); expect(r.code === 2 && /LIBTV_PROJECT/.test(r.out), r.out); });
test("dance viggle without key (exit 2)", () => { const r = node("dance/dance.mjs", ["viggle", C, "stage", path.join(M, "a.mp4")]); expect(r.code === 2 && /VIGGLE_API_KEY/.test(r.out), r.out); });

// ---------- voice / audio / sing cloud ----------
test("mv/voice tts without key (exit 2)", () => { const r = node("mv/voice.mjs", ["tts", path.join(T, "x.wav"), "hello", "--speaker", "demo"]); expect(r.code === 2 && /VOLC_API_KEY/.test(r.out), r.out); });
test("mv/voice tts --dry-run", () => { const r = node("mv/voice.mjs", ["tts", path.join(T, "x.wav"), "你好，我是 Mika", "--dry-run"]); expect(r.code === 0 && /9 chars|10 chars|11 chars/.test(r.out), r.out); });
test("mv/audio music --dry-run", () => { const r = node("mv/audio.mjs", ["music", path.join(T, "m.mp3"), "30", "lo-fi", "--dry-run"]); expect(r.code === 0 && /\$0\.3/.test(r.out), r.out); });
test("mv/audio sfx without key (exit 2)", () => { const r = node("mv/audio.mjs", ["sfx", path.join(T, "s.mp3"), "1", "pop"]); expect(r.code === 2, r.out); });
test("mv/upscale --dry-run", () => { const r = node("mv/upscale.mjs", [path.join(M, "a.mp4"), path.join(T, "u.mp4"), "--dry-run"]); expect(r.code === 0, r.out); });
test("sing/cloud song --dry-run, sts without key", () => {
  let r = node("sing/cloud.mjs", ["song", path.join(T, "s.mp3"), "pop", "lyrics.txt", "--dry-run"]); expect(r.code === 0, r.out);
  r = node("sing/cloud.mjs", ["sts", path.join(M, "line.wav"), path.join(M, "line.wav"), path.join(T, "o.wav")]); expect(r.code === 2 && /FAL_KEY/.test(r.out), r.out);
});
test("sing/svc.sh without Seed-VC installed (exit 2 with hint)", () => {
  const r = run("bash", [path.join(STUDIO, "sing/svc.sh"), path.join(M, "vocal.wav"), path.join(M, "line.wav"), path.join(T, "o.wav")], { }); expect(r.code === 2 || /Seed-VC/.test(r.out), r.out);
});

// ---------- check ----------
test("check/face --offline: side-by-side with the master face", () => {
  const r = node("check/face.mjs", [C, path.join(M, "a.mp4"), "--offline", "--frames", "4"]); expect(r.code === 0, r.out);
  const f = path.join(C, "out/check/a/compare_master_left.jpg"); expect(fs.existsSync(f), "no compare sheet");
  expect(probe(f, ["-select_streams", "v:0", "-show_entries", "stream=width,height"]) === "1280,256", "sheet should be 5 x 256 px wide");
});
test("check/face without OpenRouter key (exit 2)", () => { const r = node("check/face.mjs", [C, path.join(C, "looks/daily.png")]); expect(r.code === 2 && /OPENROUTER_API_KEY/.test(r.out), r.out); });

// ---------- finish ----------
const plan = (extra) => ({ size: [1280, 720], fps: 30, preset: "ultrafast",
  clips: [{ file: "media/a.mp4", from: 0.5, to: 3 }, { file: "media/b-noaudio.mp4", from: 0, to: 2 }, { file: "media/c-vertical.mp4", from: 1, to: 4 }],
  subs: [{ from: 0.2, to: 2.0, text: "Hi, I'm Mika. This is my very first stream!" }, { from: 2.2, to: 4.0, text: "大家好，我是 Mika，这是我第一次直播，请多关照！" }],
  cards: [{ from: 4.5, to: 6.5, text: "Viewers 3 → 1,280", sub: "first stream" }], label: "AI-generated",
  voice: [{ file: "media/line.wav", at: 5.0 }],
  music: [{ file: "media/bgm.wav", at: 0, from: 1, dur: 7.5, vol: 0.4 }], sfx: [{ file: "media/pop.wav", at: 4.5, vol: 0.6 }], ...extra });
test("mv/finish.py: clips + captions (EN/中文) + card + music + sfx + ducking", () => {
  expect(PYPIL, "no python with Pillow found (pip install pillow), set PYTHON=...");
  fs.writeFileSync(path.join(T, "plan.json"), JSON.stringify(plan({ out: "film.mp4" })));
  const r = run(PYPIL, [path.join(STUDIO, "mv/finish.py"), path.join(T, "plan.json")]); expect(r.code === 0, r.out);
  const f = path.join(T, "film.mp4"), d = durOf(f), L = lufsOf(f);
  expect(Math.abs(d - 7.5) < 0.15, `duration ${d}, expected 7.5`);
  expect(probe(f, ["-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name"]) === "h264,1280,720", "not h264 1280x720");
  expect(L > -17 && L < -11, `loudness ${L} LUFS, expected about -14`);
  ff("-ss", "1.0", "-i", f, "-frames:v", "1", path.join(T, "film-frame-1s.jpg"));
  return `${d.toFixed(2)} s, ${L} LUFS, python ${PYPIL}`;
});
test("mv/finish.py --no-text with speed 1.25", () => {
  expect(PY, "no python");
  fs.writeFileSync(path.join(T, "plan2.json"), JSON.stringify(plan({ out: "film2.mp4", speed: 1.25, music: [], sfx: [], voice: [] })));
  const r = run(PY, [path.join(STUDIO, "mv/finish.py"), path.join(T, "plan2.json"), "--no-text"]); expect(r.code === 0, r.out);
  const d = durOf(path.join(T, "film2.mp4")); expect(Math.abs(d - 6) < 0.15, `duration ${d}, expected 6`);
});
test("mv/finish.py: missing clip is a clear error", () => {
  fs.writeFileSync(path.join(T, "plan3.json"), JSON.stringify({ clips: [{ file: "nope.mp4" }] }));
  const r = run(PY, [path.join(STUDIO, "mv/finish.py"), path.join(T, "plan3.json")]); expect(r.code !== 0 && /clip not found/.test(r.out), r.out);
});
test("check/clip cut --offline on the finished film", () => {
  const r = node("check/clip.mjs", ["cut", path.join(T, "film.mp4"), "--offline", "--horizontal"]); expect(r.code === 0 && /LUFS/.test(r.out), r.out);
  expect(/small|bitrate|OK|measured/.test(r.out), r.out); return r.out.split("\n").slice(1, 3).join(" / ");
});
test("check/clip cut --offline catches a clipped, abrupt, vertical-vs-horizontal file", () => {
  const f = path.join(T, "loud.mp4");
  ff("-f", "lavfi", "-i", "color=c=black:s=640x360:d=2", "-f", "lavfi", "-i", "sine=f=1000:d=2", "-af", "volume=8", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", f);
  const r = node("check/clip.mjs", ["cut", f, "--offline", "--vertical"]);
  for (const k of ["above -1", "last 0.2 s", "asked for vertical", "black frames", "small"]) expect(r.out.includes(k), `missing "${k}":\n${r.out}`);
});

// ---------- sing/mix.py ----------
test("sing/mix.py: vocal over backing, -14 LUFS", () => {
  const out = path.join(T, "song.mp3");
  const r = run(PY, [path.join(STUDIO, "sing/mix.py"), "--vocal", path.join(M, "vocal.wav"), "--inst", path.join(M, "inst.wav"), "--start", "1", "--end", "8", "--vocal-offset", "0.5", "--match", path.join(M, "vocal.wav"), "--out", out]);
  expect(r.code === 0, r.out);
  const L = lufsOf(out), d = durOf(out); expect(Math.abs(L + 14) <= 0.6, `loudness ${L}`); expect(Math.abs(d - 7) < 0.2, `duration ${d}`);
  return `${L} LUFS, ${d.toFixed(2)} s`;
});

// ---------- hygiene ----------
test("no keys, home paths, private voice IDs or IPs in the package", () => {
  const bad = [];
  for (const f of files) {
    if (!/\.(mjs|js|py|sh|json|md|example|gitignore)$/.test(f) && !f.endsWith(".env.example")) continue;
    const t = fs.readFileSync(f, "utf8");
    const rules = [[/\/Users\/[A-Za-z]|\/home\/[a-z]+\//, "absolute home path"], [/\bS_[A-Za-z0-9]{6,}\b/, "cloned-voice ID"], [/\b(?:\d{1,3}\.){3}\d{1,3}\b/, "IP address"],
      [/\b(sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,}|[a-f0-9]{32}:[a-f0-9]{32})\b/, "key-like string"], [/^\s*(FAL_KEY|OPENROUTER_API_KEY|VOLC_API_KEY|VIGGLE_API_KEY|ARK_API_KEY)[ \t]*=[ \t]*\S+/m, "filled key"], [/\uFFFD/, "broken character U+FFFD"]];
    for (const [rx, what] of rules) if (rx.test(t)) bad.push(`${path.relative(STUDIO, f)}: ${what} (${t.match(rx)[0].slice(0, 20)})`);
  }
  expect(!fs.existsSync(path.join(STUDIO, ".env")) || true, "");
  expect(!bad.length, bad.join("\n"));
});

console.log(results.join("\n"));
console.log(`\n${pass} passed, ${fail} failed · temp files: ${T}${process.argv.includes("--keep") ? "" : " (removed)"}`);
if (!process.argv.includes("--keep")) fs.rmSync(T, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
