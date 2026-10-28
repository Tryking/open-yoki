// Upload one picture as a Vidu avatar asset under any key and save its id in idols/<idol>/vidu-looks.json
// (no credits used). Handy for an extra look that is not a stage, e.g. a standing shot.
//   VIDU_KEY=... node tools/vidu-upload-one.mjs [--idol example] --file <picture> --key <look key>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, uploadAvatar, readLooks, saveLooks } from './vidu.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = arg('idol', 'example'), k = arg('key'), file = arg('file');
if (!k || !file) throw new Error('usage: node tools/vidu-upload-one.mjs [--idol example] --file <picture> --key <look key>');
const out = path.join(ROOT, 'idols', id, 'vidu-looks.json');
const aid = await uploadAvatar(path.resolve(file), `${id} ${k}`);
if (aid) {
  const saved = readLooks(out);
  saved.ids[k] = aid;
  saveLooks(out, saved);
}
