// Offline self-test: two mock models, build the page, decode the key, check every answer is on the page once.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blind-test-'));
fs.writeFileSync(path.join(tmp, 'persona.md'), 'You are a casual live-stream host.');
fs.writeFileSync(path.join(tmp, 'candidates.json'), JSON.stringify({ system_file: 'persona.md', recent: 4, candidates: [
  { name: 'calm', provider: 'mock', replies: ['calm one', 'calm two', 'calm three'] },
  { name: 'loud', provider: 'mock', replies: ['LOUD ONE', 'LOUD TWO', 'LOUD THREE'] },
] }));
fs.writeFileSync(path.join(tmp, 'moments.json'), JSON.stringify([
  { label: 'chat', say: '[chat] Sam: is BTC going up?' }, { label: 'quiet', say: '[quiet] nobody typed for 3 minutes' }, { label: 'keep going', more: true },
]));
const out = path.join(tmp, 'out');
execFileSync('node', [path.join(here, 'run.mjs'), '--candidates', path.join(tmp, 'candidates.json'), '--moments', path.join(tmp, 'moments.json'), '--out', out, '--seed', '42'], { stdio: 'pipe' });
const html = fs.readFileSync(path.join(out, 'blind.html'), 'utf8');
const key = JSON.parse(fs.readFileSync(path.join(out, 'key.json'), 'utf8'));
for (const a of ['calm one', 'calm two', 'calm three', 'LOUD ONE', 'LOUD TWO', 'LOUD THREE']) assert.equal(html.split(a).length - 1, 1, a);
// the key in the page is the same as key.json
const b64 = html.match(/atob\('([^']+)'\)/)[1];
assert.deepEqual(JSON.parse(Buffer.from(b64, 'base64').toString()), key);
// the first option of moment 0 really is the model the key says
const first = html.split('<div class="m">')[1].match(/<b>A<\/b>&nbsp; ([^<]+)/)[1];
assert.equal(first, key.models[key.order[0][0]] === 'calm' ? 'calm one' : 'LOUD ONE');
// --answers mode
fs.writeFileSync(path.join(tmp, 'answers.json'), JSON.stringify({ candidates: ['x', 'y'], moments: [{ label: 'l', in: 'c', answers: { x: 'ex', y: 'why' } }] }));
execFileSync('node', [path.join(here, 'run.mjs'), '--answers', path.join(tmp, 'answers.json'), '--out', path.join(tmp, 'out2')], { stdio: 'pipe' });
assert.match(fs.readFileSync(path.join(tmp, 'out2', 'blind.html'), 'utf8'), /why/);
fs.rmSync(tmp, { recursive: true });
console.log('model-blind selftest: ok');
