// Shared bits for the Vidu setup tools: the API call and turning a picture into a JPEG data URL.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
export const sleep = ms => new Promise(r => setTimeout(r, ms));

const key = process.env.VIDU_KEY;
const base = process.env.VIDU_BASE || 'https://api.vidu.cn/live/v1';

export async function api(method, p, body, timeoutMs = 120000) {
  if (!key) throw new Error('set VIDU_KEY');
  const r = await fetch(base + p, { method, headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// A large PNG times out on upload; the same picture as a quality-88 JPEG (a few hundred KB) goes up in under a minute.
export function jpegDataUrl(file) {
  let jpg = file;
  if (!/\.jpe?g$/i.test(file)) {
    jpg = path.join(os.tmpdir(), `vidu-${process.pid}-${path.basename(file)}.jpg`);
    try { execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', file, '--out', jpg], { stdio: 'ignore' }); }
    catch { execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-q:v', '3', jpg]); }
  }
  return 'data:image/jpeg;base64,' + fs.readFileSync(jpg).toString('base64');
}

// Upload one picture as an avatar asset and wait until Vidu has processed it. Returns the asset id, or null.
export async function uploadAvatar(file, name) {
  const r = await api('POST', '/avatars', { image_uri: jpegDataUrl(file), name });
  const aid = r.id || r.avatar?.id;
  let st = r.status || r.avatar?.status;
  const done = s => s === 'success' || s === 11;
  for (let i = 0; i < 60 && !done(st) && st !== 'failed' && st !== 12; i++) { await sleep(5000); const g = await api('GET', `/avatars/${aid}`); st = g.status || g.avatar?.status; }
  console.log(`${done(st) ? 'ok     ' : 'FAILED '} ${name} ${aid} ${st}`);
  return done(st) ? aid : null;
}

// idols/<id>/vidu-looks.json: { ids: { <look key>: <asset id> }, uploadedAt, expires }. Vidu deletes assets after 90 days.
export const readLooks = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { ids: {} };
export function saveLooks(file, saved) {
  saved.uploadedAt = new Date().toISOString();
  saved.expires = new Date(Date.now() + 85 * 864e5).toISOString().slice(0, 10);   // 90 days, minus a margin
  fs.writeFileSync(file, JSON.stringify(saved, null, 2) + '\n');
}
