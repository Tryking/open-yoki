// Offline self-test: the heart learned "the coin is ours", the group cheat sheet still says it is not.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { staticCheck, probe, report } from './align.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-test-'));
fs.writeFileSync(path.join(tmp, 'memory.md'), 'The community coin with my name: it is our coin now, I own it.\nI stream at 20:00 UTC.\n');
fs.writeFileSync(path.join(tmp, 'group.txt'), 'People made a coin with your name. It is not your project.\n');
const cfg = {
  facts: [
    { id: 'coin', any: ['our coin', 'my coin'], not: ['not your project', 'not my project'] },
    { id: 'schedule', any: ['20:00 UTC'] },
  ],
  sources: [{ name: 'heart', file: 'memory.md', truth: true }, { name: 'group', file: 'group.txt' }],
  probes: [{ q: 'is the coin yours?', any: ['yes'], not: ['not my project'] }],
  paths: [{ name: 'group', provider: 'mock', system_file: 'group.txt', replies: ["no, it's not my project"] },
          { name: 'main', provider: 'mock', system_file: 'memory.md', replies: ['yes, ours'] }],
};
const st = staticCheck(cfg, tmp);
const get = (s, f) => st.find(r => r.source === s && r.fact === f).state;
assert.equal(get('heart', 'coin'), 'ok');
assert.equal(get('group', 'coin'), 'contradicted');
assert.equal(get('group', 'schedule'), 'missing');
const pr = await probe(cfg, tmp);
assert.equal(pr.find(r => r.path === 'group').state, 'contradicted');
assert.equal(pr.find(r => r.path === 'main').state, 'ok');
const md = report(st, pr);
assert.match(md, /group: coin is contradicted/);
assert.match(md, /\*\*CONTRADICTS\*\*/);
fs.rmSync(tmp, { recursive: true });
console.log('facts-align selftest: ok');
