// Offline self-test: two fake hearts. A only answers; B also updates its "now" note and keeps a diary.
// The real home folder must stay untouched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heart-test-'));
const home = path.join(tmp, 'home');
fs.mkdirSync(path.join(home, 'diary'), { recursive: true });
fs.writeFileSync(path.join(home, 'now.md'), 'mood: calm\n');
fs.writeFileSync(path.join(home, 'rules.md'), 'old rules\n');
fs.writeFileSync(path.join(tmp, 'beats.json'), JSON.stringify([{ label: 'busy', lines: ['[chat] Sam: you there?', '[market] BTC -2%'] }, { label: 'quiet', lines: ['[quiet] 5 min'] }]));
const heartA = path.join(tmp, 'a.mjs'), heartB = path.join(tmp, 'b.mjs');
fs.writeFileSync(heartA, `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('A got '+s.trim().split('\\n').length+' lines'));`);
fs.writeFileSync(heartB, `import fs from 'node:fs';let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const h=process.env.HEART_HOME;fs.writeFileSync(h+'/now.md','mood: '+(s.includes('BTC')?'nervous':'sleepy')+'\\n');
  fs.appendFileSync(h+'/diary/today.md',s);console.log('B: rules say '+fs.readFileSync(h+'/rules.md','utf8').trim());});`);
fs.mkdirSync(path.join(tmp, 'overlay'));
fs.writeFileSync(path.join(tmp, 'overlay', 'rules.md'), 'new rules\n');
execFileSync('node', [path.join(here, 'run.mjs'), '--home', home, '--beats', path.join(tmp, 'beats.json'), '--a', `node ${heartA}`, '--b', `node ${heartB}`, '--b-overlay', path.join(tmp, 'overlay'), '--out', path.join(tmp, 'out')], { stdio: 'pipe' });
const res = JSON.parse(fs.readFileSync(path.join(tmp, 'out', 'compare.json'), 'utf8'));
const get = (s, i) => res.find(r => r.side === s && r.beat === i);
assert.equal(get('a', 0).said, 'A got 2 lines');
assert.deepEqual(get('a', 0).changed, []);
assert.equal(get('b', 0).said, 'B: rules say new rules');
assert.deepEqual(get('b', 0).changed.sort(), ['diary/today.md', 'now.md']);
assert.match(get('b', 0).files['now.md'], /nervous/);
assert.match(get('b', 1).files['now.md'], /sleepy/);
assert.equal(fs.readFileSync(path.join(home, 'now.md'), 'utf8'), 'mood: calm\n', 'real home untouched');
assert.equal(fs.readFileSync(path.join(home, 'rules.md'), 'utf8'), 'old rules\n', 'overlay only on the copy');
assert.match(fs.readFileSync(path.join(tmp, 'out', 'compare.md'), 'utf8'), /Files written: diary\/today.md, now.md|Files written: now.md, diary\/today.md/);
fs.rmSync(tmp, { recursive: true });
console.log('heart-compare selftest: ok');
