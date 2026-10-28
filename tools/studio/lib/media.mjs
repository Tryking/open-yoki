// ffmpeg / ffprobe helpers shared by the studio tools.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

export const sh = (cmd, args, opt = {}) => execFileSync(cmd, args, { maxBuffer: 256 << 20, ...opt }).toString();
export function ff(args) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-nostdin", ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.error) throw new Error("ffmpeg not found: install ffmpeg first (brew install ffmpeg / apt install ffmpeg)");
  if (r.status) throw new Error("ffmpeg: " + (r.stderr || "").slice(0, 400));
}
export const ffLog = (args) => { const r = spawnSync("ffmpeg", args, { encoding: "utf8", maxBuffer: 64 << 20 }); return (r.stderr || "") + (r.stdout || ""); };
export const dur = (f) => +sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).trim();
export const dims = (f) => sh("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", f]).trim().split(",").map(Number);
export const hasAudio = (f) => !!sh("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", f]).trim();
export const isImage = (f) => /\.(png|jpe?g|webp)$/i.test(f);
export const stamp = () => new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
export const slug = (s, n = 30) => String(s).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, n) || "x";
export const tmpFile = (ext) => path.join(os.tmpdir(), `studio-${process.pid}-${Math.random().toString(36).slice(2)}${ext}`);

// One frame (or a still image) scaled so its long side is `long` px, as a temp jpg.
export function grab(src, t, long = 512) {
  const out = tmpFile(".jpg");
  ff([...(t != null ? ["-ss", t.toFixed(2)] : []), "-i", src, "-frames:v", "1",
    "-vf", `scale='if(gt(iw,ih),${long},-2)':'if(gt(iw,ih),-2,${long})'`, "-q:v", "3", out]);
  return out;
}
export const jpgUri = (f) => "data:image/jpeg;base64," + fs.readFileSync(f).toString("base64");

// Any image -> jpeg data URI, long side capped (some moderation filters reject huge PNGs).
export function imageUri(file, long = 1600) {
  const tmp = tmpFile(".jpg");
  ff(["-i", file, "-vf", `scale='if(gt(iw,ih),min(${long},iw),-2)':'if(gt(iw,ih),-2,min(${long},ih))'`, "-q:v", "2", tmp]);
  const u = jpgUri(tmp);
  fs.rmSync(tmp, { force: true });
  return u;
}

export async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed ${r.status} ${url.slice(0, 80)}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}

// Append what a paid call cost (estimate) to <dir>/spend.jsonl so you can add it up later.
export function logSpend(dir, row) {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, "spend.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n");
}

// Default output folder for tools that are not tied to a character folder.
export const outRoot = (flag) => path.resolve(flag || process.env.STUDIO_OUT || "studio-out");
