// Offline self-test: start the fake API on a free port, send one OpenAI-style and one Anthropic-style request.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start, summarize } from './capture.mjs';

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cap-')), 'c.jsonl');
const srv = await start({ port: 0, out });
const base = `http://127.0.0.1:${srv.address().port}`;
const log = console.log; console.log = () => {};
const r1 = await (await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { authorization: 'Bearer SECRET', 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'm', temperature: 1, messages: [{ role: 'system', content: 'You are Mia.' }, { role: 'user', content: 'hi' }] }) })).json();
const r2 = await (await fetch(base + '/v1/messages', { method: 'POST', headers: { 'x-api-key': 'SECRET', 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'c', system: [{ type: 'text', text: 'You are a coding agent. '.repeat(100) }], tools: [{ name: 'Read' }, { name: 'Bash' }], thinking: { type: 'adaptive' }, messages: [{ role: 'user', content: 'beat' }] }) })).json();
console.log = log;
srv.closeAllConnections(); srv.close();
assert.equal(r1.choices[0].message.content, '(captured)');
assert.equal(r2.content[0].text, '(captured)');
const raw = fs.readFileSync(out, 'utf8');
assert.ok(!raw.includes('SECRET'), 'keys are never written');
const [a, b] = raw.trim().split('\n').map(l => summarize(JSON.parse(l)));
assert.equal(a.system_chars, 12); assert.equal(a.temperature, 1);
assert.equal(b.tools, 2); assert.equal(b.temperature, '(not set)'); assert.match(b.thinking, /adaptive/); assert.ok(b.system_chars > 2000);
console.log('capture selftest: ok');
