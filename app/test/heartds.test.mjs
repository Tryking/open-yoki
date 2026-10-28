// Her heart straight on DeepSeek: her own prompt, five file tools in her home, the CLI's result shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dsRunner } from '../server/heartds.mjs';

const KEY = 'test-deepseek-key-not-real';
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heartds-')), h = path.join(root, 'host'), sd = path.join(root, '.state', 'ds-sessions');
  fs.mkdirSync(h); fs.writeFileSync(path.join(h, '现在.md'), '# 现在\n心情：犯懒\n');
  fs.writeFileSync(path.join(root, 'secret.md'), 'outside');
  return { root, h, sd };
}
const call = (name, args, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const usage = { prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: 600, prompt_cache_miss_tokens: 400 };
// A fake DeepSeek: each reply in turn; every request body is kept.
function fake(replies, bodies = []) {
  return async (url, o) => {
    bodies.push({ url, headers: o.headers, ...JSON.parse(o.body) });
    const r = replies.shift();
    if (typeof r === 'function') return r(o);
    const message = Array.isArray(r) ? { role: 'assistant', content: null, tool_calls: r } : { role: 'assistant', content: r };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message }], usage }) };
  };
}

test('ds heart: reads, writes, answers; the session is saved, usage = the last prompt, cost counted', async () => {
  const { h, sd } = setup(), bodies = [];
  const run = dsRunner({ key: KEY, model: 'deepseek-flash', sessionDir: sd, fetchImpl: fake([[call('read_file', { path: '现在.md' })], [call('write_file', { path: '日记/x.md', content: '# x\n今天还行' })], '心里话：嗯。'], bodies) });
  const j = await run({ cwd: h, system: 'SYS', message: '【直播间】你好', resume: null });
  assert.equal(j.result, '心里话：嗯。');
  assert.equal(fs.readFileSync(path.join(h, '日记', 'x.md'), 'utf8'), '# x\n今天还行');
  assert.equal(bodies.length, 3);
  const b = bodies[0];
  assert.equal(b.url, 'https://api.deepseek.com/chat/completions'); assert.equal(b.headers.authorization, `Bearer ${KEY}`);
  assert.equal(b.model, 'deepseek-flash'); assert.deepEqual(b.thinking, { type: 'disabled' }); assert.equal(b.temperature, 1.0); assert.equal(b.max_tokens, 1500);
  assert.deepEqual(b.tools.map(t => t.function.name), ['list_dir', 'read_file', 'write_file', 'edit_file', 'append_file']);
  assert.deepEqual(b.messages, [{ role: 'system', content: 'SYS' }, { role: 'user', content: '【直播间】你好' }]);
  const tool = bodies[1].messages.find(m => m.role === 'tool');
  assert.equal(tool.tool_call_id, 'read_file'); assert.match(tool.content, /心情：犯懒/);
  assert.equal(bodies[1].messages.at(-2).tool_calls[0].function.name, 'read_file');
  assert.deepEqual(j.usage, { input_tokens: 400, cache_read_input_tokens: 600, cache_creation_input_tokens: 0, output_tokens: 300 });
  const cost = (1800 * 0.07 + 1200 * 0.56 + 300 * 1.68) / 1e6;
  assert.ok(j.total_cost_usd > 0 && Math.abs(j.total_cost_usd - cost) < 1e-12);
  const s = JSON.parse(fs.readFileSync(path.join(sd, j.session_id + '.json'), 'utf8'));
  assert.ok(Math.abs(s.total - cost) < 1e-12);
  assert.equal(s.messages[0].role, 'user', 'no system message saved');
  assert.deepEqual(s.messages.map(m => m.role), ['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant']);
  assert.equal(s.messages.at(-1).content, '心里话：嗯。');
});

test('ds heart: resume carries the talk under this beat\'s system; old tool results shrink; an unknown session starts fresh', async () => {
  const { h, sd } = setup(), bodies = [];
  const run = dsRunner({ key: KEY, model: 'm', sessionDir: sd, fetchImpl: fake([[call('read_file', { path: '现在.md' })], 'a', 'b', 'c', 'd', 'e'], bodies) });
  const j1 = await run({ cwd: h, system: 'S1', message: 'one', resume: null });
  const j2 = await run({ cwd: h, system: 'S2', message: 'two', resume: j1.session_id });
  assert.equal(j2.session_id, j1.session_id);
  assert.equal(bodies[2].messages[0].content, 'S2');
  assert.deepEqual(bodies[2].messages.slice(1).map(m => m.content ?? null).filter(x => typeof x === 'string').at(-1), 'two');
  assert.match(bodies[2].messages.find(m => m.role === 'tool').content, /犯懒/, 'still among the last 2 beats');
  assert.ok(j2.total_cost_usd > j1.total_cost_usd, 'running total for the session');
  await run({ cwd: h, system: 'S3', message: 'three', resume: j1.session_id });
  assert.match(bodies[3].messages.find(m => m.role === 'tool').content, /犯懒/);
  await run({ cwd: h, system: 'S4', message: 'four', resume: j1.session_id });
  assert.equal(bodies[4].messages.find(m => m.role === 'tool').content, '（已读过）', 'three beats back: only that she read it');
  assert.deepEqual(bodies[4].messages.filter(m => m.role === 'user').map(m => m.content), ['one', 'two', 'three', 'four']);
  // a CLI session id after the switch, or a pruned file: a new session
  const old = path.join(sd, 'stale.json'); fs.writeFileSync(old, '{}'); fs.utimesSync(old, new Date(Date.now() - 4 * 86400e3), new Date(Date.now() - 4 * 86400e3));
  const j5 = await run({ cwd: h, system: 'S5', message: 'five', resume: 'cli-session-123' });
  assert.notEqual(j5.session_id, 'cli-session-123');
  assert.deepEqual(bodies[5].messages, [{ role: 'system', content: 'S5' }, { role: 'user', content: 'five' }]);
  assert.ok(!fs.existsSync(old), 'sessions older than 3 days are pruned when a new one starts');
  assert.ok(fs.existsSync(path.join(sd, j1.session_id + '.json')));
});

test('ds heart: nothing outside her home, and only notes get written', async () => {
  const { root, h, sd } = setup(), bodies = [];
  fs.symlinkSync(root, path.join(h, 'out'));
  fs.symlinkSync(path.join(root, 'nothing-yet.md'), path.join(h, 'dangling.md'));
  const tries = [call('read_file', { path: '../secret.md' }, 't1'), call('read_file', { path: '/etc/passwd' }, 't2'), call('read_file', { path: 'out/secret.md' }, 't3'),
    call('write_file', { path: 'out/new.md', content: 'x' }, 't4'), call('write_file', { path: 'run.sh', content: 'rm -rf /' }, 't5'), call('list_dir', { path: '..' }, 't6'),
    call('write_file', { path: 'dangling.md', content: 'x' }, 't7'), call('append_file', { path: '../secret.md', content: 'x' }, 't8'), call('edit_file', { path: '../secret.md', old: 'outside', new: 'x' }, 't9')];
  const run = dsRunner({ key: KEY, model: 'm', sessionDir: sd, fetchImpl: fake([tries, '好吧'], bodies) });
  const j = await run({ cwd: h, system: 'S', message: 'm', resume: null });
  assert.equal(j.result, '好吧');
  const outs = bodies[1].messages.filter(m => m.role === 'tool');
  assert.equal(outs.length, 9);
  for (const o of outs) assert.match(o.content, /^不行：/, o.tool_call_id);
  assert.match(outs[0].content, /只能在家里读写/); assert.match(outs[4].content, /\.md/);
  assert.equal(fs.readFileSync(path.join(root, 'secret.md'), 'utf8'), 'outside');
  assert.ok(!fs.existsSync(path.join(root, 'new.md')) && !fs.existsSync(path.join(root, 'nothing-yet.md')) && !fs.existsSync(path.join(h, 'run.sh')));
});

test('ds heart: edit needs one exact match; list marks folders; a long file is read by lines', async () => {
  const { h, sd } = setup(), bodies = [];
  fs.mkdirSync(path.join(h, '日记')); fs.writeFileSync(path.join(h, 'a.md'), 'x\ny\nx\n'); fs.writeFileSync(path.join(h, 'lines.txt'), '1\n2\n3\n4\n5');
  const run = dsRunner({ key: KEY, model: 'm', sessionDir: sd, fetchImpl: fake([[call('edit_file', { path: 'a.md', old: 'x', new: 'z' }, 'e1'), call('edit_file', { path: 'a.md', old: 'q', new: 'z' }, 'e2'),
    call('edit_file', { path: 'a.md', old: 'y', new: 'Y' }, 'e3'), call('list_dir', { path: '.' }, 'l'), call('read_file', { path: 'lines.txt', offset: 2, limit: 2 }, 'r'),
    call('append_file', { path: '日记/a.md', content: 'hi' }, 'p')], 'ok'], bodies) });
  await run({ cwd: h, system: 'S', message: 'm', resume: null });
  const o = Object.fromEntries(bodies[1].messages.filter(m => m.role === 'tool').map(m => [m.tool_call_id, m.content]));
  assert.match(o.e1, /出现了 2 次/); assert.match(o.e2, /没找到/); assert.equal(o.e3, '好了');
  assert.equal(fs.readFileSync(path.join(h, 'a.md'), 'utf8'), 'x\nY\nx\n');
  assert.deepEqual(o.l.split('\n'), ['a.md', 'lines.txt', '日记/', '现在.md']);
  assert.equal(o.r, '2\n3'); assert.equal(fs.readFileSync(path.join(h, '日记', 'a.md'), 'utf8'), 'hi');
});

test('ds heart: an HTTP error never shows the key; a slow beat times out; an empty answer with nothing written throws', async () => {
  const { h, sd } = setup();
  const e401 = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: `Authentication Fails, Your api key: ${KEY} / ****cdef is invalid` } }) });
  const err = await dsRunner({ key: KEY, model: 'm', sessionDir: sd, fetchImpl: e401 })({ cwd: h, system: 'S', message: 'm', resume: null }).catch(e => e);
  assert.match(err.message, /deepseek 401/); assert.ok(!err.message.includes(KEY) && !err.message.includes('cdef'), err.message);
  const hang = (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(o.signal.reason)));
  await assert.rejects(dsRunner({ key: KEY, model: 'm', sessionDir: sd, timeoutMs: 50, fetchImpl: hang })({ cwd: h, system: 'S', message: 'm', resume: null }), /timed out/);
  await assert.rejects(dsRunner({ key: KEY, model: 'm', sessionDir: sd, fetchImpl: fake(['  ']) })({ cwd: h, system: 'S', message: 'm', resume: null }), /empty/);
  assert.deepEqual(fs.readdirSync(sd), [], 'a failed beat saves no session');
});

test('ds heart: after maxRounds of tools one last call without tools puts it into words', async () => {
  const { h, sd } = setup(), bodies = [];
  const look = () => [call('list_dir', { path: '.' })];
  const run = dsRunner({ key: KEY, model: 'm', sessionDir: sd, maxRounds: 3, fetchImpl: fake([look(), look(), look(), '想完了'], bodies) });
  const j = await run({ cwd: h, system: 'S', message: 'm', resume: null });
  assert.equal(j.result, '想完了'); assert.equal(bodies.length, 4);
  assert.equal(bodies[3].tool_choice, 'none'); assert.equal(bodies[2].tool_choice, undefined);
});

test('ds heart: U+FFFD never gets into her files or her answer', async () => {
  const { h, sd } = setup(), bodies = [];
  fs.writeFileSync(path.join(h, 'bad.md'), '好\uFFFD\uFFFD的');
  const run = dsRunner({ key: KEY, model: 'm', sessionDir: sd, fetchImpl: fake([[call('read_file', { path: 'bad.md' }, 'r'), call('write_file', { path: 'w.md', content: '写\uFFFD了' }, 'w')], '说\uFFFD完'], bodies) });
  const j = await run({ cwd: h, system: 'S', message: '来\uFFFD了', resume: null });
  assert.equal(j.result, '说完');
  assert.equal(bodies[0].messages[1].content, '来了');
  assert.equal(bodies[1].messages.find(m => m.tool_call_id === 'r').content, '好的');
  assert.equal(fs.readFileSync(path.join(h, 'w.md'), 'utf8'), '写了');
});

test('ds heart: extra tools (going online) join only while offered; their answer goes back to her, a throw becomes text', async () => {
  const { h, sd } = setup(), bodies = [], ran = [];
  let offered = true;
  const extra = { get tools() { return offered ? [{ type: 'function', function: { name: 'web_search', description: 's', parameters: { type: 'object', properties: {} } } }] : []; },
    run: async (n, a) => { ran.push([n, a]); if (a.query === 'bad') throw new Error('net down'); return '（下面是你在网上看到的）猫\uFFFD'; } };
  const run = dsRunner({ key: KEY, model: 'm', sessionDir: sd, extra, fetchImpl: fake([[call('web_search', { query: '猫' }, 'a'), call('web_search', { query: 'bad' }, 'b')], '心里话：看完了。', '心里话：没上网。'], bodies) });
  const j = await run({ cwd: h, system: 'S', message: 'x', resume: null });
  assert.equal(j.result, '心里话：看完了。');
  assert.deepEqual(ran, [['web_search', { query: '猫' }], ['web_search', { query: 'bad' }]]);
  assert.ok(bodies[0].tools.some(t => t.function.name === 'web_search'));
  const tools = bodies[1].messages.filter(m => m.role === 'tool');
  assert.equal(tools[0].content, '（下面是你在网上看到的）猫'); assert.match(tools[1].content, /^没打开：net down/);
  offered = false;
  await run({ cwd: h, system: 'S', message: 'y', resume: null });
  assert.ok(!bodies[2].tools.some(t => t.function.name === 'web_search'));
});

test('ds heart: the answer says how many tools she used this beat', async () => {
  const { h, sd } = setup();
  const a = await dsRunner({ key: KEY, model: 'm', sessionDir: sd, fetchImpl: fake([[call('read_file', { path: '现在.md' }), call('list_dir', { path: '.' })], '心里话：嗯。']) })({ cwd: h, system: 'S', message: 'x', resume: null });
  assert.equal(a.tools, 2);
  const b = await dsRunner({ key: KEY, model: 'm', sessionDir: sd, fetchImpl: fake(['心里话：嗯。']) })({ cwd: h, system: 'S', message: 'x', resume: null });
  assert.equal(b.tools, 0);
});
