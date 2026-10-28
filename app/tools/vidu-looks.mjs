// Upload each stage look (plus the optional off-camera look `off`) as a Vidu avatar asset and save the ids to
// idols/<idol>/vidu-looks.json, which the config reads as idol.avatar.viduLooks. Creating assets costs no credits;
// Vidu deletes them after 90 days, so re-run with --force before `expires`.
//   VIDU_KEY=... node tools/vidu-looks.mjs [--idol example] [--src <folder>] [--only s1,off] [--force 1] [--prefix wide-]
// --src holds one picture per look named <stage key>.png or .jpg; default public/art/<idol>/looks (what the page shows).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, uploadAvatar, readLooks, saveLooks } from './vidu.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = arg('idol', 'example');
const idol = (await import(`../idols/${id}/config.mjs`)).default;
const out = path.join(ROOT, 'idols', id, 'vidu-looks.json');
const src = path.resolve(arg('src', path.join(ROOT, 'public', 'art', id, 'looks')));
const prefix = arg('prefix', '');
const only = arg('only', '').split(',').filter(Boolean);

const saved = readLooks(out);
const keys = [...idol.stages.map(s => s.key), 'off'].filter(k => !only.length || only.includes(k));
for (const k of keys) {
  if (saved.ids[prefix + k] && !arg('force')) { console.log(`kept    ${prefix + k} ${saved.ids[prefix + k]}`); continue; }
  const file = ['png', 'jpg', 'jpeg'].map(x => path.join(src, `${k}.${x}`)).find(f => fs.existsSync(f));
  if (!file) { console.log(`missing ${path.join(src, k)}.png/.jpg`); continue; }
  const aid = await uploadAvatar(file, `${idol.short || id} ${k} ${idol.stages.find(s => s.key === k)?.name || 'off'}`);
  if (!aid) continue;
  saved.ids[prefix + k] = aid;
  saveLooks(out, saved);
}
