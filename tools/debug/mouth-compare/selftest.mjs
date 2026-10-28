// Offline self-test: a "lecturing" mock mouth vs a "casual" one; the compare file must show both and the lint
// numbers must catch the lecturing side's disclaimers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mouth-test-'));
const w = (f, x) => fs.writeFileSync(path.join(tmp, f), typeof x === 'string' ? x : JSON.stringify(x));
w('old.md', 'You are a helpful host. Always remind people about risk.');
w('new.md', 'You are Mia, 24, streams crypto at night, says little, laughs easily.');
w('note.md', 'mood: a bit sleepy\nthinking about: late-night noodles');
w('old.json', { name: 'old', provider: 'mock', system_file: 'old.md', replies: ['投资有风险，不构成投资建议哦', '理性投资，一定要设止损', '投资有风险，大家注意'] });
w('new.json', { name: 'new', provider: 'mock', system_file: 'new.md', note_file: 'note.md', replies: ['我怎么知道，我又不是它爹', '刚煮了碗面', '你先睡，我盯着'] });
w('moments.json', [{ label: 'chat', say: '[chat] Sam: will BTC go up?' }, { label: 'chat', say: '[chat] Lee: what did you eat' }, { label: 'quiet', more: true }]);
execFileSync('node', [path.join(here, 'run.mjs'), '--a', path.join(tmp, 'old.json'), '--b', path.join(tmp, 'new.json'), '--moments', path.join(tmp, 'moments.json'), '--out', path.join(tmp, 'out')], { stdio: 'pipe' });
const md = fs.readFileSync(path.join(tmp, 'out', 'compare.md'), 'utf8');
assert.match(md, /old: 投资有风险/);
assert.match(md, /new: 我怎么知道/);
assert.match(md, /- old:.*disclaimer [23]/);
assert.match(md, /- new:.*phrase hits: none/);
fs.rmSync(tmp, { recursive: true });
console.log('mouth-compare selftest: ok');
