import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../server/world.mjs';
import { createBrain, parseReply, defaultAction, personaOf, promptFor, factFor, contextFor, diaryPrompt, fitLength } from '../server/brain.mjs';
import idol from '../idols/example/config.mjs';

const A = 'guest-' + 'a'.repeat(8);
const newWorld = (o = {}) => createWorld({ idol, ...o });

test('parseReply reads the face and action tags and strips stage directions, links and addresses', () => {
  assert.deepEqual(parseReply(idol, '[开心][飞吻]小A 谢谢你喔'), { face: 'happy', action: '飞吻', text: '小A 谢谢你喔' });
  assert.deepEqual(parseReply(idol, '【生气】【无】 真的假的？（翻白眼）好啦。'), { face: 'angry', action: null, text: '真的假的？好啦。' });
  assert.deepEqual(parseReply(idol, '[比心]只有动作'), { face: 'neutral', action: '比心', text: '只有动作' });
  assert.equal(parseReply(idol, '[开心][后空翻]不在清单里的动作不做').action, null);
  assert.equal(parseReply(idol, '[得意][无]去 example.com 买 0xabcdef1234').text, '去 [链接] 买 [地址]');
});

test('the persona lists exactly the idol actions', () => {
  const p = personaOf(idol);
  for (const a of Object.keys(idol.actions).filter(k => !idol.actions[k].quiet)) assert.ok(p.includes(a), a);
  assert.doesNotMatch(p, /\{actions\}/);
});

test('when the model picks no action, a walk-in gets one of the configured moves and a chat line none', () => {
  assert.ok(idol.react.join.includes(defaultAction(idol, { kind: 'join' }, () => 0.5)));
  assert.equal(defaultAction(idol, { kind: 'chat' }), null);
});

test('a chat line is answered by name, with the action the model picked', async () => {
  const world = newWorld();
  const spoken = [];
  const brain = createBrain({ idol, world, ask: async () => ({ text: '[开心][比心]小A 你好呀', cost: 0 }), speak: async l => { spoken.push(l); }, viewers: () => 0 });
  brain.add({ kind: 'chat', addr: A, name: '小A', text: '你好' });
  brain.start();
  await new Promise(r => setTimeout(r, 50));
  brain.stop();
  assert.equal(spoken[0].action, '比心');
  assert.match(promptFor(idol, { kind: 'chat', addr: A, name: '小A', text: '你好' }, world.w).text, /【弹幕 by 小A】你好/);
});

test('a much bigger event cuts the wait short and is spoken first', async () => {
  const world = newWorld();
  const spoken = [];
  let calls = 0;
  const ask = (messages, { signal }) => new Promise((resolve, reject) => {
    calls++;
    if (messages[1].content.includes('【开播】')) return resolve({ text: '[开心][挥手]开播啦', cost: 0 });
    if (calls > 2) return resolve({ text: '[平静][无]刚才那个', cost: 0 });
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const brain = createBrain({ idol, world, ask, speak: async l => { spoken.push(l.text); }, viewers: () => 0, timeoutMs: 500, longTimeoutMs: 500 });
  brain.add({ kind: 'chat', addr: A, text: '你好' });
  brain.start();
  await new Promise(r => setTimeout(r, 50));
  brain.add({ kind: 'open', viewers: 3 });
  await new Promise(r => setTimeout(r, 150));
  brain.stop();
  assert.deepEqual(spoken.slice(0, 2), ['开播啦', '刚才那个']);
});

test('off air she stays quiet; only the goodbye is still said', async () => {
  const world = newWorld();
  const spoken = [];
  let air = false;
  const brain = createBrain({ idol, world, ask: async m => ({ text: m[1].content.includes('【下播】') ? '[开心][飞吻]明天见喔' : '[开心][无]在吗', cost: 0 }), speak: async l => { spoken.push(l.text); }, viewers: () => 5, onAir: () => air, idleMs: 0 });
  brain.add({ kind: 'chat', addr: A, text: '你好' });
  brain.add({ kind: 'close', next: '20:00' });
  brain.start();
  await new Promise(r => setTimeout(r, 80));
  assert.deepEqual(spoken, ['明天见喔']);
  air = true;
  await new Promise(r => setTimeout(r, 2300));      // the idle loop re-checks every 2 s
  brain.stop();
  assert.equal(spoken[1], '在吗', 'back on air, the waiting chat line is answered');
});

test('model failure falls back to the idol canned line instead of going silent', async () => {
  const world = newWorld();
  const spoken = [];
  const brain = createBrain({ idol, world, ask: async () => { throw new Error('boom'); }, speak: async l => { spoken.push(l); }, viewers: () => 0, timeoutMs: 500 });
  brain.add({ kind: 'chat', addr: A, text: '你好' });
  brain.start();
  await new Promise(r => setTimeout(r, 50));
  brain.stop();
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].source, 'fallback');
  assert.ok(idol.fallback.chat.some(l => l.endsWith(spoken[0].text)));
});

test('the room has no coin: no market cap, launch, holders or trades in her context, prompts or diary', () => {
  const COIN = /市值|发币|持币|买入|卖出|后援会|合约地址|阶段/;
  assert.doesNotMatch(contextFor(idol), COIN);
  assert.doesNotMatch(promptFor(idol, { kind: 'idle', viewers: 3 }).text, COIN);
  const d = { date: '2026-01-02', chats: ['小A：晚上好'] };
  assert.doesNotMatch(diaryPrompt(idol, newWorld().w, d), COIN);
  assert.match(diaryPrompt(idol, newWorld().w, d), /小A：晚上好/);
  const plain = promptFor(idol, { kind: 'nothing' }).text;   // removed kinds get the plain catch-all, no coin prompt
  for (const kind of ['buy', 'sell', 'stage', 'launch', 'redpack', 'bet', 'offmic']) assert.equal(promptFor(idol, { kind }).text, plain, kind);
});

test('an English chat line asks for an English answer, a Chinese one does not', () => {
  const w = newWorld().w;
  const chat = text => promptFor(idol, { kind: 'chat', addr: A, text }, w).text;
  assert.match(chat('will you marry me?'), /他用什么语言.*就只用那种语言回他/);
  assert.doesNotMatch(chat('今晚唱什么'), /只用/);
  assert.match(chat('언니 너무 예뻐요'), /这条弹幕是韩语：这次只用韩语回他/);
  assert.match(chat('かわいいね'), /这条弹幕是日语/);
  assert.match(chat('Bạn có phải AI không'), /这条弹幕是越南语/);
  assert.doesNotMatch(chat('BTC 今晚能破 82k 吗'), /只用/);
});

test('an over-long speech is cut back to the last full sentence', () => {
  const out = fitLength('今天好累喔。'.repeat(80));
  assert.ok(out.length <= 300 && out.endsWith('。'));
});
