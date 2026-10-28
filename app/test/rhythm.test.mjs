// Rhythm: 先垫一声 (a ready-made sound the instant a comment lands) and comments read together.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fillerKind, createFiller } from '../server/filler.mjs';
import { createWorld } from '../server/world.mjs';
import { createBrain, promptFor } from '../server/brain.mjs';

const idol = (await import('../idols/example/config.mjs')).default;
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('a comment gets the kind of sound it calls for', () => {
  assert.equal(fillerKind('哈哈哈笑死我了'), 'laugh');
  assert.equal(fillerKind('今天又爆仓了'), 'sad');
  assert.equal(fillerKind('你今天好好看'), 'praise');
  assert.equal(fillerKind('卧槽拉盘了'), 'wow');
  assert.equal(fillerKind('BTC年底能到多少'), 'ask');
  assert.equal(fillerKind('晚上好'), 'hm');
});

test('her sounds are made once in her voice, then picked sparingly and never twice in a row', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fill-'));
  const made = [];
  const voice = { voiceId: 'S_test', pcm: async (text, id, tone) => { made.push([text, tone]); return Buffer.alloc(4800); } };
  let t = 0;
  const f = createFiller({ idol, voice, dir, gapMs: 1000, chance: 1, rand: () => 0, now: () => t });
  const n = await f.warm();
  assert.equal(n, Object.values(idol.fillers).reduce((a, k) => a + k.says.length, 0));
  // a sound can carry its own tone (a giggle, a sigh, a hum each read their own way); otherwise its kind's tone
  for (const k of Object.values(idol.fillers)) for (const s of k.says) {
    const [say, tone] = typeof s === 'string' ? [s, k.tone] : [s.say, s.tone || k.tone];
    assert.ok(made.some(([text, t]) => text === say && (t || undefined) === (tone || undefined)), say);
  }
  for (const [, tone] of made) assert.ok(!tone || idol.avatar.doubao.tones[tone], tone);
  // a second start reads them off disk instead of paying for them again
  const again = createFiller({ idol, voice, dir, chance: 1, rand: () => 0, now: () => t });
  made.length = 0; await again.warm(); assert.equal(made.length, 0);

  const a = f.pick('哈哈哈哈');
  assert.equal(a.kind, 'laugh'); assert.ok(idol.fillers.laugh.says.map(x => x.say ?? x).includes(a.text)); assert.equal(a.pcm.length, 4800);
  assert.equal(f.pick('哈哈'), null, 'too soon after the last one');
  t = 2000;
  const b = f.pick('哈哈');
  assert.equal(b.kind, 'laugh'); assert.notEqual(b.text, a.text);
  const skip = createFiller({ idol, voice, dir, chance: 0.5, rand: () => 0.9, now: () => t });
  await skip.warm();
  assert.equal(skip.pick('哈哈'), null, 'not every comment gets one');
});

test('an idol without fillers, or a voice that cannot make PCM, has none', () => {
  assert.equal(createFiller({ idol: { ...idol, fillers: null }, voice: { pcm: async () => null }, dir: os.tmpdir() }), null);
  assert.equal(createFiller({ idol, voice: null, dir: os.tmpdir() }), null);
});

test('comments waiting together are answered together: one call sees them all', async () => {
  const world = createWorld({ idol });
  const asked = [], spoken = [];
  const brain = createBrain({ idol, world, ask: async m => { asked.push(m[1].content); return { text: '想：开心｜一起回\n[开心][无][热情]糖糖 Ken 阿杰 夜猫子都来啦', cost: 0 }; },
    speak: async l => { spoken.push(l.text); }, viewers: () => 3, onAir: () => true, idleMs: 1e9 });
  for (const [name, text] of [['糖糖', '晚上好'], ['Ken88', '装什么可爱'], ['阿杰', 'BTC能到多少'], ['夜猫子', '爆了']])
    brain.add({ kind: 'chat', addr: 'guest-sq-' + name, name, text, tier: 'guest', tierName: '游客', from: 'square' });
  brain.start();
  await sleep(80);
  brain.stop();
  const chats = asked.filter(a => a.includes('【弹幕'));   // (the room going 0 → 3 is also greeted, separately)
  assert.equal(chats.length, 1);
  assert.match(chats[0], /同一时间弹幕里还有：.*Ken88：装什么可爱.*阿杰：BTC能到多少.*夜猫子：爆了/);
  assert.equal(brain.queue.length, 0);
  assert.doesNotMatch(promptFor(idol, { kind: 'chat', addr: 'guest-1', name: '老王', text: '睡不着' }, world.w).text, /同一时间/);
});

test('on Square she keeps talking with nobody in the room, and knows nobody is there', async () => {
  const run = async alone => {
    const world = createWorld({ idol }), asked = [];
    const brain = createBrain({ idol: { ...idol, idleSelf: 0, segments: [] }, world, ask: async m => { asked.push(m[1].content); return { text: '想：无聊｜自己待着\n[平静][无][慵懒]嗯……', cost: 0 }; },
      speak: () => sleep(30), viewers: () => 0, alone: () => alone, onAir: () => true, idleMs: -1, rand: () => 0.9 });
    brain.start(); await sleep(150); brain.stop();
    return asked;
  };
  const off = await run(false);
  assert.equal(off.length, 0, 'off Square nobody watching means no talking');
  const on = await run(true);
  assert.ok(on.length >= 1);
  assert.match(on[0], /一个人都没有/);
});

test('the sound brings its own face: each kind has moves she really has', () => {
  for (const [kind, k] of Object.entries(idol.fillers)) for (const a of k.act || []) assert.ok(idol.actions[a], `${kind}: ${a}`);
  const f = createFiller({ idol, voice: { voiceId: 'v', pcm: async () => Buffer.alloc(10) }, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'fill-')), chance: 1, rand: () => 0 });
  return f.warm().then(() => { const p = f.pick('哈哈哈'); assert.ok(idol.fillers.laugh.act.includes(p.act)); });
});

test('a comment folded in but not named gets its own turn next; one she named does not', async () => {
  const world = createWorld({ idol });
  const asked = [];
  let n = 0;
  const brain = createBrain({ idol, world, ask: async m => { asked.push(m[1].content); n++; return { text: n === 1 ? '想：开心｜一起回\n[开心][无][热情]糖糖晚上好呀，阿杰你别急' : '想：开心｜回他\n[开心][无][热情]好的好的', cost: 0 }; },
    speak: async () => {}, viewers: () => 3, onAir: () => true, idleMs: 1e9 });
  for (const [name, text] of [['糖糖', '晚上好'], ['Ken88', '装什么可爱'], ['阿杰', 'BTC能到多少']])
    brain.add({ kind: 'chat', addr: 'guest-sq-' + name, name, text, tier: 'guest', tierName: '游客', from: 'square' });
  brain.start();
  await sleep(80);
  brain.stop();
  const chats = asked.filter(a => a.includes('【弹幕'));
  assert.equal(chats.length, 2, 'the skipped one is asked again, once');
  assert.match(chats[1], /【弹幕 by Ken88】装什么可爱/);
  assert.match(chats[1], /刚才弹幕太多没顾上/);
  assert.ok(!chats.slice(1).some(c => /【弹幕 by 阿杰】/.test(c)), 'named in the first line: not asked again');
});

test('a comment that has waited climbs past newer ones of the same kind', async () => {
  let t = 0;
  const world = createWorld({ idol });
  const asked = [];
  const brain = createBrain({ idol, world, now: () => t, ask: async m => { asked.push(m[1].content); return { text: '想：开心｜回\n[开心][无][热情]嗯嗯', cost: 0 }; },
    speak: async () => {}, viewers: () => 3, onAir: () => true, idleMs: 1e9 });
  brain.add({ kind: 'chat', addr: 'guest-sq-a', name: '老A', text: '早来的', tier: 'guest', tierName: '游客', from: 'square' });
  t = 20e3;
  brain.add({ kind: 'chat', addr: 'guest-sq-b', name: '新来B', text: '后来的', tier: 'guest', tierName: '游客', from: 'square' });
  brain.start(); await sleep(60); brain.stop();
  const first = asked.find(a => a.includes('【弹幕'));
  assert.match(first, /【弹幕 by 老A】早来的/);
});

test('owning up to yesterday: the open beat owns up to the settled call once, then never again', async () => {
  const { createMemory } = await import('../server/memory.mjs');
  const memory = createMemory({ now: () => Date.now() });
  memory.call({ subject: 'BTC', say: 'BTC 明天这个时候会比现在高', dir: 'up', price: 82407, due: Date.now() - 1 });
  memory.settle({ subject: 'BTC', result: 'BTC 从 82407 到 81496（-1.1%）', right: false });
  const run = async () => {
    const world = createWorld({ idol }), asked = [];
    const brain = createBrain({ idol, world, memory, ask: async m => { asked.push(m[1].content); return { text: '想：心虚｜认账\n[尴尬][无][嘀咕]昨天押错了，打脸', cost: 0 }; },
      speak: async () => {}, viewers: () => 3, onAir: () => true, idleMs: 1e9 });
    brain.add({ kind: 'open', viewers: 3 });
    brain.start(); await sleep(60); brain.stop();
    return asked.find(a => a.includes('【开播】')) || '';
  };
  const first = await run();
  assert.match(first, /先认账：.*BTC 从 82407 到 81496.*说错了，大方认/);
  assert.equal(memory.unowned(), null);
  assert.doesNotMatch(await run(), /先认账/);
});
