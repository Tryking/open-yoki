// Key loading for every studio tool.
// Order: process.env wins, then tools/studio/.env (or the file named by STUDIO_ENV_FILE).
// Keys are never printed. A missing key exits with code 2 and a plain hint (English + Chinese).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let cache;
export function env() {
  if (cache) return cache;
  const file = process.env.STUDIO_ENV_FILE || path.join(STUDIO, ".env");
  const fromFile = {};
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) fromFile[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
  cache = { ...fromFile };
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && v !== "") cache[k] = v;
  return cache;
}

export const get = (name, def) => env()[name] ?? def;

// One entry per optional service. `key` is the variable that must be set.
export const SERVICES = {
  fal: { key: "FAL_KEY", name: "fal.ai", signup: "https://fal.ai/dashboard/keys",
    used: "image edits, Seedance/Kling video, music, sound effects, voice conversion, upscaling" },
  openrouter: { key: "OPENROUTER_API_KEY", name: "OpenRouter", signup: "https://openrouter.ai/settings/keys",
    used: "face check, storyboard lint, clip check, finding the person/face in a frame, audio judging" },
  viggle: { key: "VIGGLE_API_KEY", name: "Viggle", signup: "https://viggle.ai (API page)",
    used: "dance: put the character into a dance video" },
  volc: { key: "VOLC_API_KEY", name: "Volcengine Doubao TTS", signup: "https://console.volcengine.com/speech/app",
    used: "voice lines (text to speech)" },
  ark: { key: "ARK_API_KEY", name: "Volcengine Ark (Seedance)", signup: "https://console.volcengine.com/ark",
    used: "Seedance video straight from Volcengine (experimental adapter)" },
  libtv: { key: "LIBTV_PROJECT", name: "LibTV", signup: "https://www.liblib.tv (install its command-line client and log in)",
    used: "Kling O3 multi-reference video, OmniHuman lip-sync" },
};

export function missing(service, extra = "") {
  const s = SERVICES[service];
  console.error(
    `✗ ${s.name} is not set up. Add ${s.key}=... to tools/studio/.env (copy .env.example). Sign up: ${s.signup}\n` +
    `  Used for: ${s.used}.${extra ? " " + extra : ""}\n` +
    `  未配置 ${s.name}：在 tools/studio/.env 里填 ${s.key}（照 .env.example 抄一份），开号地址见上。不需要这个服务可以换别的适配或用 --dry-run 只看会发什么。`);
  process.exit(2);
}

export function need(service) {
  const s = SERVICES[service];
  const v = get(s.key);
  if (!v) missing(service);
  return v;
}

// LibTV is driven through its own command-line client, logged in once on this machine.
export function libtvConfig() {
  const project = get("LIBTV_PROJECT");
  const bin = get("LIBTV_BIN", path.join(os.homedir(), ".libtv/libtv"));
  if (!project) missing("libtv", "LIBTV_PROJECT = the project id shown in LibTV; LIBTV_BIN = path to the client if not ~/.libtv/libtv.");
  if (!fs.existsSync(bin)) missing("libtv", `Client not found at ${bin}; set LIBTV_BIN.`);
  return { project, bin };
}
