// fal.ai adapter: queue submit -> poll -> result, plus file upload. Plain fetch, no SDK needed.
import fs from "node:fs";
import path from "node:path";
import { need } from "./env.mjs";

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".flac": "audio/flac", ".mp4": "video/mp4", ".mov": "video/quicktime" };
export const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || "application/octet-stream";
const H = () => ({ Authorization: `Key ${need("fal")}`, "Content-Type": "application/json" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const fileUri = (p) => `data:${mimeOf(p)};base64,${fs.readFileSync(p).toString("base64")}`;

// fal does not accept inline video; upload big files to fal storage and use the returned URL.
export async function falUpload(p) {
  const type = mimeOf(p);
  const init = await (await fetch("https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3", {
    method: "POST", headers: H(), body: JSON.stringify({ content_type: type, file_name: path.basename(p) }) })).json();
  if (!init.upload_url) throw new Error("fal upload failed: " + JSON.stringify(init).slice(0, 200));
  const put = await fetch(init.upload_url, { method: "PUT", headers: { "Content-Type": type }, body: fs.readFileSync(p) });
  if (!put.ok) throw new Error("fal upload failed " + put.status);
  return init.file_url;
}

export async function falRun(model, input, { every = 5000, maxMin = 45, log = console.log } = {}) {
  const sub = await (await fetch(`https://queue.fal.run/${model}`, { method: "POST", headers: H(), body: JSON.stringify(input) })).json();
  if (!sub.request_id) throw new Error(`fal ${model} submit failed: ${JSON.stringify(sub).slice(0, 400)}`);
  log(`→ fal ${model} queued ${sub.request_id}`);
  const t0 = Date.now(); let last;
  while (Date.now() - t0 < maxMin * 60000) {
    await sleep(every);
    const st = await (await fetch(sub.status_url, { headers: H() })).json();
    if (st.status === "COMPLETED") break;
    if (st.status && !["IN_QUEUE", "IN_PROGRESS"].includes(st.status)) throw new Error(`fal status: ${JSON.stringify(st).slice(0, 400)}`);
    if (st.status !== last) { log(`  … ${st.status}${st.queue_position != null ? " #" + st.queue_position : ""}`); last = st.status; }
  }
  const res = await (await fetch(sub.response_url, { headers: H() })).json();
  if (res.detail && !res.video && !res.images && !res.audio) throw new Error(`fal ${model}: ${JSON.stringify(res.detail).slice(0, 400)}`);
  return { ...res, request_id: sub.request_id };
}

// First media URL found anywhere in a fal response.
export function firstUrl(res, kind = /\.(mp4|mov|webm|mp3|wav|flac|m4a|png|jpe?g|webp)(\?|$)/i) {
  const direct = res.video?.url || res.audio?.url || res.audio_file?.url || res.images?.[0]?.url || res.image?.url;
  if (direct) return direct;
  const all = JSON.stringify(res).match(/https:[^"\s]+/g) || [];
  return all.find((u) => kind.test(u));
}
