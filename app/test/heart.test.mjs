// Her heart on the server: fed what happens, beats now and then, leaves a note the mouth reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHeart, claudeRunner } from '../server/heart.mjs';
import { createWorld } from '../server/world.mjs';
import { createBrain, worn } from '../server/brain.mjs';

const idol = (await import('../idols/example/config.mjs')).default;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function home() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heart-')), h = path.join(root, 'host');
  fs.mkdirSync(h);
  for (const f of ['我是谁.md', '过去的事.md', '给我的建议.md', '边界.md']) fs.writeFileSync(path.join(h, f), `# ${f}\n内容`);
  fs.writeFileSync(path.join(h, '现在.md'), '# 现在\n\n心情：平静\n');
  return { root, h, st: path.join(root, '.state') };
}
const reply = (mood, total) => ({ session_id: 'S1', total_cost_usd: total, result: `心里话：嗯。\n现在：\n心情：${mood}\n为什么：有人来了\n在想：他是谁\n对在场的人：糖糖，喜欢\n接下来想：逗逗她` });

test('a beat hands her everything since the last one, resumes her session and saves her note', async () => {
  const { h, st } = home(), calls = [];
  const heart = createHeart({ home: h, stateDir: st, name: '小雅', run: async a => { calls.push(a); return reply(calls.length === 1 ? '开心' : '得意', calls.length * 0.03); } });
  assert.equal(await heart.beat(), null, 'nothing happened, no beat');
  heart.feed('【直播间 2:30】糖糖：晚上好'); heart.feed('【她刚说了】糖糖来啦\uFFFD');
  await heart.beat();
  assert.equal(calls[0].message, '【直播间 2:30】糖糖：晚上好\n【她刚说了】糖糖来啦');
  assert.equal(calls[0].resume, null);
  assert.equal(calls[0].cwd, h);
  assert.match(calls[0].system, /你是小雅的心/);
  assert.match(calls[0].system, /# 我是谁\.md/);
  assert.match(heart.note(), /^心情：开心\n为什么：有人来了/);
  heart.feed('【直播间 2:31】糖糖：哈哈');
  await heart.beat();
  assert.equal(calls[1].resume, 'S1', 'the same session goes on');
  assert.match(heart.note(), /心情：得意/);
  const log = fs.readFileSync(path.join(st, 'log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(log.length, 2);
  assert.ok(Math.abs(log[1].cost - 0.03) < 1e-9, 'each beat costs the difference of the running total');
  assert.ok(Math.abs(heart.spent - 0.06) < 1e-9);
});

test('a failed beat loses nothing: the lines go in the next one', async () => {
  const { h, st } = home();
  let fail = true; const seen = [];
  const heart = createHeart({ home: h, stateDir: st, run: async a => { seen.push(a.message); if (fail) throw new Error('relay down'); return reply('平静', 0.01); } });
  heart.feed('a'); await heart.beat();
  assert.equal(heart.pending, 1);
  fail = false; heart.feed('b'); await heart.beat();
  assert.equal(seen.at(-1), 'a\nb');
  assert.equal(heart.pending, 0);
});

test('pace: quick on air, a quiet beat now and then in her waking hours, asleep at night, fresh session each show', async () => {
  const { h, st } = home(), calls = [];
  let t = Date.parse('2026-10-16T06:00:00Z'), live = false;   // 14:00 Beijing
  const heart = createHeart({ home: h, stateDir: st, now: () => t, onAir: () => live, onAirGapMs: 40e3, dayGapMs: 25 * 60e3,
    run: async a => { calls.push(a); return reply('平静', 0.01 * calls.length); } });
  await heart.tick();
  assert.match(calls[0].message, /14:00】（没在播，她自己待着）/);
  t += 60e3; await heart.tick(); assert.equal(calls.length, 1, 'off air: not again for a while');
  t += 25 * 60e3; await heart.tick(); assert.equal(calls.length, 2);
  live = true; t += 1000; await heart.tick();
  assert.match(calls[2].message, /开播了/);
  assert.equal(calls[2].resume, null, 'a new show starts a new session');
  heart.feed('【直播间】糖糖：嗨'); t += 10e3; await heart.tick(); assert.equal(calls.length, 3, 'on air: not before the gap');
  t += 31e3; await heart.tick(); assert.equal(calls.length, 4); assert.equal(calls[3].resume, 'S1');
  t += 60e3; await heart.tick(); assert.equal(calls.length, 4, 'on air with nothing new: no beat');
  live = false; t += 1000; await heart.tick();
  assert.match(calls[4].message, /下播了/);
  assert.equal(calls[4].resume, 'S1', 'the end of a show stays in the show\'s session');
  t = Date.parse('2026-10-16T19:00:00Z');   // 3:00 Beijing: asleep
  await heart.tick(); assert.equal(calls.length, 5);
  live = true; t += 1000; await heart.tick();
  const again = createHeart({ home: h, stateDir: st, now: () => t, onAir: () => false, run: async a => { calls.push(a); return reply('平静', 0.01); } });
  await again.tick();
  assert.match(calls.at(-1).message, /下播了/, 'a restart that ends the show still says goodbye');
});

test('the claude runner keeps her in her own folder and sends the message on stdin', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heart-bin-')), bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args"\ncat > "${dir}/stdin"\nenv > "${dir}/env"\necho '{"session_id":"X","result":"ok","total_cost_usd":0.01}'\n`);
  fs.chmodSync(bin, 0o755);
  process.env.VIDU_KEY_TEST = 'x';
  const run = claudeRunner({ key: 'k-test', model: 'claude-sonnet-5-5', configDir: path.join(dir, 'st', 'cfg'), bin });
  const j = await run({ cwd: dir, system: 'SYS', message: '【直播间】你好', resume: 'R1' });
  assert.equal(j.session_id, 'X');
  const args = fs.readFileSync(path.join(dir, 'args'), 'utf8');
  assert.match(args, /--resume\nR1/);
  assert.match(args, /Read\(\.\/\*\*\) Edit\(\.\/\*\*\) Write\(\.\/\*\*\) Glob Grep/);
  assert.match(args, /Bash WebFetch .*Read\(\/\/etc\/\*\*\).*Read\(\/\/proc\/\*\*\)/);
  // the state dir beside her home (logs, sessions, group ids) and /tmp are shut to Read, Grep and Glob alike
  assert.ok(args.includes(`Read(/${path.resolve(dir, 'st')}/**)`), 'state dir shut'); assert.equal(args.includes('Read(//tmp/**)'), !path.resolve(dir).startsWith('/tmp/'), '/tmp shut unless her home is in it');
  assert.equal(fs.readFileSync(path.join(dir, 'stdin'), 'utf8'), '【直播间】你好');
  const env = fs.readFileSync(path.join(dir, 'env'), 'utf8');
  assert.match(env, /^ANTHROPIC_API_KEY=k-test$/m); assert.match(env, /^ANTHROPIC_BASE_URL=https:\/\/api\.anthropic\.com$/m);
  assert.doesNotMatch(env, /ANTHROPIC_AUTH_TOKEN/);
  assert.doesNotMatch(env, /OPENROUTER|DOUBAO|VIDU/, 'none of the server\'s other keys');
});

test('the mouth reads the heart note before it speaks', async () => {
  const world = createWorld({ idol }), asked = [];
  const brain = createBrain({ idol, world, ask: async m => { asked.push(m[0].content); return { text: '想：开心｜嗯\n[开心][无][热情]来啦', cost: 0 }; },
    speak: () => sleep(10), viewers: () => 1, onAir: () => true, idleMs: 1e9, heart: () => '心情：有点委屈\n对在场的人：Ken88，不服气' });
  brain.add({ kind: 'chat', addr: 'guest-sq-k', name: 'Ken88', text: '你就是个AI', tier: 'guest', tierName: '游客', from: 'square' });
  brain.start(); await sleep(80); brain.stop();
  const sys = asked.find(s => s.includes('你此刻心里'));
  assert.ok(sys, 'the note is in the prompt');
  assert.match(sys, /心情：有点委屈\n对在场的人：Ken88，不服气/);
});

test('with a heart note she speaks through the short mouth; without one, the full persona', async () => {
  const { personaOf } = await import('../server/brain.mjs');
  for (const note of ['心情：开心', '']) {
    const world = createWorld({ idol }), asked = [];
    const brain = createBrain({ idol, world, ask: async m => { asked.push(m[0].content); return { text: '想：开心｜嗯\n[开心][无][热情]来啦', cost: 0 }; },
      speak: () => sleep(10), viewers: () => 1, onAir: () => true, idleMs: 1e9, heart: () => note });
    brain.add({ kind: 'chat', addr: 'guest-sq-k', name: 'Ken88', text: '你是不是AI', tier: 'guest', tierName: '游客', from: 'square' });
    brain.start(); await sleep(80); brain.stop();
    const sys = asked[0];
    assert.doesNotMatch(sys, /\{actions\}|\{tones\}/);
    assert.ok(sys.startsWith(personaOf(idol, note ? idol.mouth.persona : idol.persona).slice(0, 20)), note ? 'the short mouth' : 'the full persona');
  }
});

test('new mouth: memes come bare, and a pet word she just said is held back next time', async () => {
  const idol2 = { ...idol, mouth: { ...idol.mouth, tics: ['口头禅'] } };
  const world = createWorld({ idol: idol2 }), asked = [];
  const memes = { offer: (e, o) => ({ text: o?.bare ? '【能用的梗】bare' : '【能用的梗】full', memes: [], songs: [] }), forget() {}, took() {} };
  const brain = createBrain({ idol: idol2, world, memes, ask: async m => { asked.push(m); return { text: '想：得意｜嗯\n[得意][无][热情]口头禅今晚在呢', cost: 0 }; },
    speak: async (line, e) => { world.say({ text: line.text, face: line.face, kind: e.kind }); await sleep(5); }, viewers: () => 1, onAir: () => true, idleMs: 1e9, heart: () => '心情：得意' });
  for (const t of ['晚上好', '在吗']) brain.add({ kind: 'chat', addr: 'guest-sq-a', name: 'A', text: t, tier: 'guest', tierName: '游客', from: 'square' });
  brain.start(); await sleep(150); brain.stop();
  assert.ok(asked.length >= 2);
  assert.match(asked[0][1].content, /bare/);
  assert.doesNotMatch(asked[0][0].content, /刚才说过，这次别再说/);
  assert.match(asked.at(-1)[0].content, /这几个词你刚才说过，这次别再说：口头禅/, `${asked.length} asks`);
});

test('thanks: follows waiting in line fold into one line, a gift names what came, nobody hears the price', async () => {
  const world = createWorld({ idol }), asked = [];
  let release; const gate = new Promise(r => { release = r; });
  const brain = createBrain({ idol, world, ask: async m => { asked.push(m[1].content); await gate; return { text: '想：开心｜谢谢\n[开心][比心][热情]谢啦', cost: 0 }; },
    speak: () => sleep(5), viewers: () => 1, onAir: () => true, idleMs: 1e9 });
  brain.add({ kind: 'chat', addr: 'guest-sq-a', name: 'A', text: '嗨', tier: 'guest', tierName: '游客', from: 'square' });
  brain.start(); await sleep(20);
  brain.add({ kind: 'thanks', act: 'follow', name: '阿呆' }); brain.add({ kind: 'thanks', act: 'follow', name: '糖糖' });
  brain.add({ kind: 'thanks', act: 'gift', name: 'Ken', what: '小心心' });
  release(); await sleep(150); brain.stop();
  assert.ok(asked.some(t => /【关注】阿呆、糖糖 刚关注了你/.test(t)), asked.join('\n'));
  assert.ok(asked.some(t => /【礼物】Ken 送了你「小心心」.*别报价钱/.test(t)));
});

test('a restart does not wake her for another daytime beat', async () => {
  const { h, st } = home(), calls = [];
  let t = Date.parse('2026-10-16T06:00:00Z');
  const mk = () => createHeart({ home: h, stateDir: st, now: () => t, onAir: () => false, dayGapMs: 3 * 3600e3, run: async a => { calls.push(a); return reply('平静', 0.01); } });
  await mk().tick(); assert.equal(calls.length, 1);
  t += 60e3; await mk().tick(); assert.equal(calls.length, 1);
});

test('her day: daytime beats bring what she really saw, and she hears about the show half an hour before', async () => {
  const { h, st } = home(), calls = [];
  let t = Date.parse('2026-10-17T05:00:00Z'), seen = ['【盘面 13:00】BTC 81,000（+1.0%）', '【刷广场 13:00】阿土：又割在地板（30 条评论）'];   // 13:00 Beijing
  const heart = createHeart({ home: h, stateDir: st, now: () => t, onAir: () => false, dayGapMs: 45 * 60e3, showAt: '19:00',
    daytime: () => { const s = seen; seen = []; return s; }, run: async a => { calls.push(a); return reply('平静', 0.01 * calls.length); } });
  await heart.tick();
  assert.match(calls[0].message, /【盘面 13:00】BTC[\s\S]*【刷广场 13:00】阿土/);
  assert.doesNotMatch(calls[0].message, /自己待着/, 'she had a day, not an empty beat');
  t += 46 * 60e3; await heart.tick();
  assert.match(calls[1].message, /自己待着/, 'nothing new: a quiet beat');
  t = Date.parse('2026-10-17T10:31:00Z'); await heart.tick();   // 18:31: inside the gap of a beat at 18:20? no beat since 13:46, so due anyway
  assert.match(calls.at(-1).message, /还有 29 分钟开播/);
  const n = calls.length;
  t += 60e3; await heart.tick(); assert.equal(calls.length, n, 'told once');
  t = Date.parse('2026-10-17T11:01:00Z'); await heart.tick(); assert.equal(calls.length, n, 'after the start time it is not "soon"');
});

test('her day in the note wears out like any other thought', () => {
  assert.equal(worn('心情：开心\n今晚想聊：广场那个割地板的\n盘上：BTC 拿着', ['刚才广场有人割在地板了', '广场上那个老哥太惨了']), '心情：开心\n盘上：BTC 拿着');
});


// A relay first, Anthropic behind it; a failed relay never stops her heart.
test('heart relay: a bearer-token relay runner sends its own key var to its own base, falls back on failure', async () => {
  const { fallbackRunner } = await import('../server/heart.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heart-relay-')), bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh\ncat > /dev/null\nenv > "${dir}/env"\necho '{"session_id":"X","result":"ok","total_cost_usd":0.01}'\n`);
  fs.chmodSync(bin, 0o755);
  const relay = claudeRunner({ key: 'r-test', keyVar: 'ANTHROPIC_AUTH_TOKEN', baseUrl: 'https://relay.example.com', model: 'claude-sonnet-5-5', configDir: path.join(dir, 'cfg'), bin });
  const j = await fallbackRunner([['relay', relay]])({ cwd: dir, system: 'S', message: 'm' });
  assert.equal(j.via, 'relay'); assert.equal(j.result, 'ok');
  const env = fs.readFileSync(path.join(dir, 'env'), 'utf8');
  assert.match(env, /^ANTHROPIC_AUTH_TOKEN=r-test$/m); assert.match(env, /^ANTHROPIC_BASE_URL=https:\/\/relay\.example\.com$/m);
  assert.doesNotMatch(env, /^ANTHROPIC_API_KEY=/m);
  const notes = [], calls = [];
  const bad = async () => { calls.push('relay'); throw new Error('401 bad key'); };
  const good = async () => { calls.push('anthropic'); return { session_id: 'S', result: 'fine' }; };
  const r = await fallbackRunner([['relay', bad], ['anthropic', good]], m => notes.push(m))({});
  assert.deepEqual(calls, ['relay', 'anthropic']); assert.equal(r.via, 'anthropic');
  assert.match(notes[0], /relay failed, 401 bad key/);
  await assert.rejects(fallbackRunner([['relay', bad], ['anthropic', bad]])({}), /401/);
});

// DeepSeek first (a fast model on air, a stronger one off air), Claude behind; a session never crosses providers.
test('heart relay: runners picked per beat; a DeepSeek session is not resumed on Claude, nor back', async () => {
  const { fallbackRunner } = await import('../server/heart.mjs');
  const calls = []; let live = true, dsDown = false;
  const mk = (name, sid) => async o => { calls.push([name, o.resume]); if (name.startsWith('ds') && dsDown) throw new Error('503'); return { session_id: sid, result: 'ok' }; };
  const run = fallbackRunner(() => [live ? ['ds-flash', mk('ds-flash', 'D1'), 'deepseek'] : ['ds-pro', mk('ds-pro', 'D2'), 'deepseek'], ['claude', mk('claude', 'C1'), 'claude']]);
  assert.equal((await run({ resume: 'OLD' })).via, 'ds-flash');   // after a restart the provider is unknown: resume as asked
  live = false;
  assert.equal((await run({ resume: 'D1' })).via, 'ds-pro');      // the show ends: Pro carries Flash's session
  dsDown = true;
  assert.equal((await run({ resume: 'D2' })).via, 'claude');        // DeepSeek down: Claude starts fresh
  dsDown = false;
  assert.equal((await run({ resume: 'C1' })).via, 'ds-pro');      // and back: fresh again
  assert.deepEqual(calls, [['ds-flash', 'OLD'], ['ds-pro', 'D1'], ['ds-pro', 'D2'], ['claude', null], ['ds-pro', null]]);
  const src = fs.readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');
  for (const lit of ['HEART_KEY_DS', "'deepseek-flash'", "'deepseek-v4-pro'", 'https://api.deepseek.com/anthropic', 'showOpen ? live : day']) assert.ok(src.includes(lit), lit);
});

test('a session that has grown long starts fresh on the next beat (every beat re-reads all of it)', async () => {
  const { h, st } = home(), calls = [];
  let ctx = 40e3;
  const heart = createHeart({ home: h, stateDir: st, maxContext: 80e3,
    run: async a => { calls.push(a); return { ...reply('平静', 0.01 * calls.length), usage: { input_tokens: 10, cache_read_input_tokens: ctx, cache_creation_input_tokens: 500 } }; } });
  heart.feed('a'); await heart.beat();
  heart.feed('b'); await heart.beat();
  assert.equal(calls[1].resume, 'S1', 'short session goes on');
  ctx = 90e3; heart.feed('c'); await heart.beat();
  assert.equal(calls[2].resume, 'S1');
  heart.feed('d'); await heart.beat();
  assert.equal(calls[3].resume, null, 'past the limit the next beat is a fresh session');
  const log = fs.readFileSync(path.join(st, 'log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(log[2].ctx, 90510);
});

test('a fresh session hears what she was just thinking and today\'s diary; the show\'s talkers come with the goodbye', async () => {
  const { h, st } = home(), calls = [];
  let t = Date.parse('2026-10-22T11:00:00Z'), live = false, ctx = 10e3;   // 19:00 Beijing
  fs.mkdirSync(path.join(h, '日记')); fs.writeFileSync(path.join(h, '日记', '2026-10-22.md'), '# 10-22\n下午刷到一条好笑的帖子');
  fs.mkdirSync(path.join(h, '认识的人')); fs.writeFileSync(path.join(h, '认识的人', '糖糖.md'), '# 糖糖\n常来');
  const heart = createHeart({ home: h, stateDir: st, now: () => t, onAir: () => live, maxContext: 80e3,
    run: async a => { calls.push(a); return { ...reply('开心', 0.01 * calls.length), result: `心里话：第${calls.length}下，糖糖又来了\n现在：\n心情：开心`, usage: { cache_read_input_tokens: ctx } }; } });
  live = true; await heart.tick();
  assert.doesNotMatch(calls[0].message, /接着刚才/, 'nothing to carry at the start of a show');
  heart.feed('【直播间 19:01】糖糖：晚上好'); heart.feed('【直播间 19:01】阿呆（X）：hi'); heart.feed('【直播间 19:01】糖糖：在吗');
  ctx = 90e3; t += 60e3; await heart.tick();
  heart.feed('【直播间 19:03】阿呆（X）：走了'); t += 60e3; await heart.tick();
  assert.equal(calls[2].resume, null, 'past the limit: a new session');
  assert.match(calls[2].message, /【接着刚才】[\s\S]*第1下，糖糖又来了[\s\S]*第2下[\s\S]*下午刷到一条好笑的帖子[\s\S]*阿呆（X）：走了$/);
  live = false; t += 60e3; await heart.tick();
  assert.match(calls.at(-1).message, /下播了[\s\S]*今晚说过话的人：糖糖 2 句、阿呆 2 句（还没有页）/);
});

test('off air her mind wanders to her own posts, people and old diaries, and once a day she looks back', async () => {
  const { h, st } = home(), calls = [];
  let t = Date.parse('2026-10-22T05:00:00Z');   // 13:00 Beijing
  fs.mkdirSync(path.join(h, '日记')); fs.writeFileSync(path.join(h, '日记', '2026-10-21.md'), '# 10-21\n昨晚 BTC 我看错了');
  fs.mkdirSync(path.join(h, '发过的动态')); fs.writeFileSync(path.join(h, '发过的动态', '2026-10-20-第一次.md'), '（10-20 发在广场）第一次上广场');
  fs.mkdirSync(path.join(h, '认识的人')); fs.writeFileSync(path.join(h, '认识的人', '糖糖.md'), '# 糖糖\n常来，爱开玩笑');
  const heart = createHeart({ home: h, stateDir: st, now: () => t, onAir: () => false, dayGapMs: 45 * 60e3, run: async a => { calls.push(a); return reply('平静', 0.01 * calls.length); } });
  await heart.tick();
  assert.match(calls[0].message, /【回头看】[\s\S]*10-21：昨晚 BTC 我看错了[\s\S]*我慢慢变成的样子\.md/);
  const seen = [];
  for (let i = 0; i < 3; i++) { t += 46 * 60e3; await heart.tick(); seen.push(calls.at(-1).message); }
  assert.match(seen.join('\n'), /【翻到自己以前发的】2026-10-20-第一次：（10-20 发在广场）第一次上广场/);
  assert.match(seen.join('\n'), /【想起一个人】糖糖：常来，爱开玩笑/);
  assert.match(seen.join('\n'), /【翻到以前的日记】2026-10-21：昨晚 BTC 我看错了/);
  assert.ok(seen.every(m => !/自己待着/.test(m)), 'she had something on her mind each time');
  fs.writeFileSync(path.join(h, '我慢慢变成的样子.md'), '# 我慢慢变成的样子\n10-22 不那么怕看错了');
  t += 46 * 60e3; await heart.tick();
  assert.match(calls.at(-1).system, /不那么怕看错了/, 'what she wrote about herself goes in every beat');
  const again = createHeart({ home: h, stateDir: st, now: () => t + 50 * 60e3, onAir: () => false, dayGapMs: 45 * 60e3, run: async a => { calls.push(a); return reply('平静', 0.01); } });
  await again.tick();
  assert.doesNotMatch(calls.at(-1).message, /回头看/, 'a restart does not make her look back twice a day');
});

test('a message in her Telegram group gets her to look within 5 minutes by day (otherwise 45)', async () => {
  const { h, st } = home(), calls = [];
  let t = Date.parse('2026-10-23T05:00:00Z');   // 13:00 Beijing
  const heart = createHeart({ home: h, stateDir: st, now: () => t, onAir: () => false, dayGapMs: 45 * 60e3, run: async a => { calls.push(a); return reply('平静', 0.01 * calls.length); } });
  await heart.tick(); const n = calls.length;
  t += 4 * 60e3; heart.feed('【TG群 13:04 #5】Tiffany：D.M me now for volume'); await heart.tick();
  assert.equal(calls.length, n, 'not before 5 minutes');
  t += 61e3; await heart.tick();
  assert.equal(calls.length, n + 1);
  assert.match(calls.at(-1).message, /【TG群 13:04 #5】Tiffany/);
  t += 6 * 60e3; heart.feed('【TG群】你在群里说了：「好」'); await heart.tick();
  assert.equal(calls.length, n + 1, 'only what people say wakes her early, not her own receipts');
});

test('lines she has not looked at yet survive a restart', async () => {
  const { h, st } = home(), calls = [];
  let t = Date.parse('2026-10-23T05:00:00Z');
  const a = createHeart({ home: h, stateDir: st, now: () => t, onAir: () => false, dayGapMs: 45 * 60e3, run: async x => { calls.push(x); return reply('平静', 0.01); } });
  await a.tick(); t += 60e3;
  a.feed('【TG群 13:01 #7】糖糖：在吗');
  const b = createHeart({ home: h, stateDir: st, now: () => t + 5 * 60e3, onAir: () => false, dayGapMs: 45 * 60e3, run: async x => { calls.push(x); return reply('平静', 0.01); } });
  t += 46 * 60e3; await b.tick();
  assert.match(calls.at(-1).message, /#7】糖糖：在吗/);
});

test('the operators\' group wakes her within a minute, even at night', async () => {
  const { h, st } = home(), calls = [];
  let t = Date.parse('2026-10-22T18:00:00Z');   // 02:00 Beijing, asleep
  const heart = createHeart({ home: h, stateDir: st, now: () => t, onAir: () => false, dayGapMs: 45 * 60e3, run: async a => { calls.push(a); return reply('平静', 0.01 * (calls.length + 1)); } });
  heart.feed('【下午】x'); await heart.tick(); const n = calls.length;
  t += 30e3; heart.feed('【运营群 2:00 #1】运营：睡了吗'); await heart.tick();
  assert.equal(calls.length, n);
  t += 31e3; await heart.tick();
  assert.equal(calls.length, n + 1);
});

// Straight on DeepSeek (heartds.mjs) nothing loads CLAUDE.md for her, so it goes in her prompt.
test('withHouse puts her home\'s CLAUDE.md in the prompt and drops the "not a coding assistant" line', async () => {
  const { h, st } = home(), calls = [];
  fs.writeFileSync(path.join(h, 'CLAUDE.md'), '# 家里的说明\n日记写在 日记/');
  const run = async a => { calls.push(a); return reply('平静', 0.01); };
  const a = createHeart({ home: h, stateDir: st, run, withHouse: true, name: '小雅' });
  a.feed('x'); await a.beat();
  assert.match(calls[0].system, /^你是小雅。下面是你家里的说明和你自己的东西。你用工具在家里读写文件。\n\n# 家里的说明/);
  assert.match(calls[0].system, /# 我是谁\.md/); assert.doesNotMatch(calls[0].system, /编程助手/);
  const b = createHeart({ home: h, stateDir: st + '2', run });
  b.feed('y'); await b.beat();
  assert.match(calls[1].system, /^从现在起你不是编程助手/); assert.doesNotMatch(calls[1].system, /家里的说明/);
});

test('direct mouth: a page of her facts, the comment as a fact, no rule lists; the old mouth stays without the flag', async () => {
  const { factFor, deepseek } = await import('../server/brain.mjs');
  for (const direct of [true, false]) {
    const world = createWorld({ idol }), asked = [];
    const brain = createBrain({ idol, world, direct, ask: async m => { asked.push(m); return { text: '想：开心｜嗯\n[开心][无][热情]来啦', cost: 0 }; },
      speak: () => sleep(10), viewers: () => 1, onAir: () => true, idleMs: 1e9, heart: () => '心情：开心' });
    brain.add({ kind: 'chat', addr: 'guest-sq-k', name: 'Ken88', text: '你是不是AI', tier: 'guest', tierName: '游客', from: 'square' });
    brain.start(); await sleep(80); brain.stop();
    const [sys, user] = asked[0].map(x => x.content);
    if (direct) {
      assert.match(sys, /【你此刻心里[^】]*】\n心情：开心/);
      assert.doesNotMatch(sys, /\{actions\}|\{tones\}|真人主播这样说话|第一场直播|嘴最容易犯/);
      assert.match(user, /^【弹幕】Ken88：你是不是AI/);
      assert.doesNotMatch(user, /你刚说过这几句|这次的长度/);
    } else assert.doesNotMatch(user, /^【弹幕】Ken88：/, 'without the flag the old rule-style prompt');
  }
  assert.equal(factFor(idol, { kind: 'idle', viewers: 3, quietMin: 3 }, {}), '【直播间】有一阵子没人打字了，有人在看。');
  assert.doesNotMatch(factFor(idol, { kind: 'diaryNote', preview: '今天' }, { talk: [] }), /字以内/);
  // the direct call: thinking off, temperature 1.0, the key never in an error
  const sent = [];
  const ask = deepseek({ key: 'sk-K9', fetchImpl: async (u, o) => { sent.push([u, JSON.parse(o.body)]); return { ok: true, json: async () => ({ choices: [{ message: { content: 'hi' } }], usage: { prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 50, completion_tokens: 10 } }) }; } });
  const r = await ask([{ role: 'user', content: 'x' }]);
  assert.equal(r.text, 'hi'); assert.ok(r.cost > 0);
  assert.equal(sent[0][0], 'https://api.deepseek.com/chat/completions');
  assert.deepEqual([sent[0][1].model, sent[0][1].temperature, sent[0][1].thinking.type, sent[0][1].max_tokens], ['deepseek-flash', 1, 'disabled', 200]);
  const bad = deepseek({ key: 'sk-K9', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key sk-K9' } }) }) });
  await assert.rejects(bad([]), e => !e.message.includes('sk-K9'));
});

test('her 现在 note is read however DeepSeek lays it out', async () => {
  const { nowOf } = await import('../server/heart.mjs');
  assert.equal(nowOf('心里话：嗯\n\n现在：\n心情：静\n为什么：空场'), '心情：静\n为什么：空场');
  assert.equal(nowOf('心里话：嗯\n\n现在：懒得招呼了\n\n心情：疲\n\n为什么：没人'), '心情：疲\n为什么：没人');
  assert.equal(nowOf('心里话：嗯\n\n心情：爽快\n为什么：踢得对'), '心情：爽快\n为什么：踢得对');
  assert.equal(nowOf('下播了。\n**今晚记下的：** 日记\n\n现在：心情松了点，还有点不服。'), '心情松了点，还有点不服。');
  assert.equal(nowOf('记好了。'), null);
});

// A new book mid-show also gets tonight so far; once a week she folds the diary into 过去的事.md.
test('mid-show new session carries tonight: when it started, who talked, what the mouth said last', async () => {
  const { h, st } = home(), calls = [];
  let t = Date.parse('2026-10-24T11:00:40Z'), live = false, ctx = 10e3;
  const heart = createHeart({ home: h, stateDir: st, now: () => t, onAir: () => live, maxContext: 80e3,
    run: async a => { calls.push(a); return { ...reply('开心', 0.01 * calls.length), usage: { cache_read_input_tokens: ctx } }; } });
  live = true; await heart.tick();
  heart.feed('【直播间 19:01】糖糖：念首诗'); heart.feed('【她刚说了】诗我先欠着，八点半还你');
  ctx = 90e3; t += 60e3; await heart.tick();
  heart.feed('【直播间 19:03】阿呆：hi'); t += 60e3; await heart.tick();
  assert.match(calls[2].message, /今晚到现在（19:00 开播）[\s\S]*糖糖 1 句[\s\S]*嘴最近说的：\n- 19:00 诗我先欠着，八点半还你/);
});

test('once a week she is asked to fold the past days of diary into 过去的事.md, then not again for a week', async () => {
  const { h, st } = home(), calls = [];
  fs.mkdirSync(path.join(h, '日记'));
  for (const d of ['16', '17', '18', '19', '20', '21', '22', '23']) fs.writeFileSync(path.join(h, '日记', `2026-10-${d}.md`), `# 10-${d}\n过了一天`);
  let t = Date.parse('2026-10-24T05:00:00Z');   // 13:00 Beijing, awake
  const heart = createHeart({ home: h, stateDir: st, now: () => t, onAir: () => false, dayGapMs: 45 * 60e3, run: async a => { calls.push(a); return reply('平静', 0.01 * calls.length); } });
  await heart.tick();
  assert.match(calls[0].message, /【整理】[\s\S]*日记\/2026-10-16\.md[\s\S]*日记\/2026-10-23\.md[\s\S]*过去的事\.md/);
  t += 50 * 60e3; await heart.tick();
  t += 2 * 864e5; await heart.tick();
  assert.ok(calls.slice(1).every(c => !/【整理】/.test(c.message)));
  for (const d of ['25', '26', '27']) fs.writeFileSync(path.join(h, '日记', `2026-10-${d}.md`), `# 10-${d}\n又一天`);
  t += 5 * 864e5; await heart.tick();
  assert.match(calls.at(-1).message, /【整理】[\s\S]*2026-10-25[\s\S]*2026-10-27/);
  assert.doesNotMatch(calls.at(-1).message, /【整理】[^\n]*2026-10-23/);
});

test('off air, a session where she only talks for idleBeats in a row starts fresh; a tool or the show resets the count', async () => {
  const { h, st } = home(), calls = [], logs = [];
  let tools = 0, live = false;
  const heart = createHeart({ home: h, stateDir: st, idleBeats: 3, onAir: () => live, log: m => logs.push(m),
    run: async a => { calls.push(a); return { ...reply('平静', 0.01 * calls.length), tools }; } });
  const go = async () => { heart.feed('x'); await heart.beat(); };
  await go(); await go();
  tools = 1; await go();
  tools = 0; await go(); await go();
  assert.ok(calls.slice(1).every(c => c.resume === 'S1'), 'a tool in the middle resets the count');
  await go();
  assert.ok(logs.some(m => /3 beats without doing anything/.test(m)));
  await go();
  assert.equal(calls.at(-1).resume, null, 'the next beat starts over');
  live = true; await go(); await go(); await go(); await go();
  assert.equal(logs.filter(m => /without doing anything/.test(m)).length, 1, 'on air never counts');
  const src = fs.readFileSync(new URL('../server/heartds.mjs', import.meta.url), 'utf8');
  assert.match(src, /tools: used \}/);
});

test('a flood of room joins never pushes out what people said in TG, X or the operators\' group', async () => {
  const { h, st } = home(), calls = [];
  const heart = createHeart({ home: h, stateDir: st, maxLines: 5, run: async a => { calls.push(a); return reply('平静', 0.01); } });
  heart.feed('【TG群 17:47 #720】小米粥：在吗？');
  heart.feed('【推特 17:48】@a：hi');
  for (let i = 0; i < 20; i++) heart.feed(`【直播间 17:49】路人${i} 进来了，现在 0 个人在看`);
  heart.feed('【运营群 17:50 #9】运营：在吗');
  await heart.beat();
  const got = calls[0].message.split('\n');
  assert.equal(got.length, 5);
  assert.deepEqual(got.filter(l => !/进来了/.test(l)), ['【TG群 17:47 #720】小米粥：在吗？', '【推特 17:48】@a：hi', '【运营群 17:50 #9】运营：在吗']);
  assert.deepEqual(got.filter(l => /进来了/.test(l)), ['【直播间 17:49】路人18 进来了，现在 0 个人在看', '【直播间 17:49】路人19 进来了，现在 0 个人在看'], 'the newest room lines stay');
});
