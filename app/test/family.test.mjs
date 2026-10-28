// Her operators' group talks straight to DeepSeek: one page of facts, thinking off, each line its own message.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFamilyChat, dsChat, familyPage, membersOf, FAMILY_MODEL, FAMILY_BACKUP, FAMILY_TEMP, NO_REPLY } from '../server/family.mjs';

function setup(replies, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fam-')), home = path.join(root, 'host'), st = path.join(root, '.state');
  fs.mkdirSync(path.join(home, '日记'), { recursive: true }); fs.mkdirSync(st);
  fs.writeFileSync(path.join(home, '现在.md'), '# 现在\n心情：犯懒'); fs.writeFileSync(path.join(home, '日记', '2026-10-23.md'), '# 2026-10-23\n欠阿明一首诗');
  const sent = [], fed = [], back = [], asked = [];
  const chat = async m => { asked.push(m); const r = replies.shift(); if (r instanceof Error) throw r; return r; };
  const fc = createFamilyChat({ home, stateDir: st, chats: [chat, ...(opts.backup ? [opts.backup] : [])], send: async t => sent.push(t), feed: l => fed.push(l), fallback: l => back.push(l),
    host: { name: '小例' }, members: [{ name: '阿明', about: '做交易的那个人' }, { name: '小红', about: '' }], waitMs: 5, sleep: async () => {}, now: () => Date.parse('2026-10-24T08:00:00Z') });
  return { fc, sent, fed, back, asked, st, home };
}
const say = (fc, name, text) => fc.hear({ name, text, line: `【运营群 16:00 #1】${name}：${text}` });

test('family: messages a moment apart become one turn; each line of her answer is its own message; her heart hears it', async () => {
  const { fc, sent, fed, asked } = setup(['跟你学的。\n没镜子是吧。']);
  say(fc, '小红', '你说话怎么这么谄媚呢'); say(fc, '小红', '格局呢。志气呢');
  await new Promise(r => setTimeout(r, 30)); await fc.flush();
  assert.equal(asked.length, 1);
  const m = asked[0];
  assert.equal(m[0].role, 'system'); assert.match(m[0].content, /^你是 小例/); assert.doesNotMatch(m[0].content, /Claude Code|编程/);
  assert.match(m[0].content, /犯懒/); assert.match(m[0].content, /欠阿明一首诗/); assert.match(m[0].content, /群里除了你还有：阿明、小红。\n- 阿明：做交易的那个人\n- 小红\n/);
  assert.deepEqual(m.slice(1), [{ role: 'user', content: '小红：你说话怎么这么谄媚呢\n小红：格局呢。志气呢' }]);
  assert.deepEqual(sent, ['跟你学的。', '没镜子是吧。']);
  assert.match(fed[0], /^【运营群聊天 16:00】小红：你说话怎么这么谄媚呢 \/ 小红：格局呢。志气呢\n你回了：跟你学的。 \/ 没镜子是吧。/);
  assert.doesNotMatch(fed[0], /^【运营群 /, 'does not wake the heart like an operators-group line');
});

test('family: she may not answer; she never just echoes them; history survives a restart and starts with them', async () => {
  const { fc, sent, st, asked } = setup([NO_REPLY, '喊我女王陛下！\n女王陛下。']);
  say(fc, '阿明', '嗯'); await new Promise(r => setTimeout(r, 20)); await fc.flush();
  assert.deepEqual(sent, []);
  say(fc, '小红', '喊我女王陛下！'); await new Promise(r => setTimeout(r, 20)); await fc.flush();
  assert.deepEqual(sent, ['女王陛下。']);
  fc.said('我今天有点无聊');   // her heart wrote to them on its own
  const h = JSON.parse(fs.readFileSync(path.join(st, 'family-chat.json'), 'utf8'));
  assert.deepEqual(h.map(x => x.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(h[1].content, NO_REPLY); assert.equal(h[3].content, '女王陛下。\n我今天有点无聊');
  assert.equal(asked[1].length, 4);   // system + 嗯 + （不回） + 喊我女王陛下
});

test('family: DeepSeek Pro down → Flash; both down → the heart gets the lines the old way', async () => {
  const flash = []; const a = setup([new Error('503')], { backup: async m => { flash.push(m); return '在呢'; } });
  say(a.fc, '阿明', '在吗'); await new Promise(r => setTimeout(r, 20)); await a.fc.flush();
  assert.deepEqual(a.sent, ['在呢']); assert.equal(flash.length, 1);
  const b = setup([new Error('503')]);
  say(b.fc, '阿明', '在吗'); await new Promise(r => setTimeout(r, 20)); await b.fc.flush();
  assert.deepEqual(b.sent, []); assert.deepEqual(b.back, ['【运营群 16:00 #1】阿明：在吗']);
  assert.deepEqual(b.fc.history(), []);
});

test('family: straight to DeepSeek with thinking off and temperature 1.0 (1.3 went off the rails); wired in the server', async () => {
  let body, url;
  const run = dsChat({ key: 'k', fetchImpl: async (u, o) => { url = u; body = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '嗯' } }] }) }; } });
  assert.equal(await run([{ role: 'user', content: 'hi' }]), '嗯');
  assert.equal(url, 'https://api.deepseek.com/chat/completions');
  assert.deepEqual(body.thinking, { type: 'disabled' }); assert.equal(body.temperature, 1.0); assert.equal(body.model, 'deepseek-v4-pro');
  assert.equal(FAMILY_MODEL, 'deepseek-v4-pro'); assert.equal(FAMILY_BACKUP, 'deepseek-flash'); assert.equal(FAMILY_TEMP, 1.0);
  const src = fs.readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');
  for (const lit of ['createFamilyChat', 'env.HEART_KEY_DS', 'onFamily: famChat', 'onFamilySaid']) assert.ok(src.includes(lit), lit);
  assert.match(familyPage(fs.mkdtempSync(path.join(os.tmpdir(), 'fp-'))), /一条一行，每行就是单独一条消息/);
});

test('family: members come from the bot config as 名字（介绍）; an empty page still reads as the operators group', () => {
  assert.deepEqual(membersOf({ 7: '阿明（做交易的那个人）', 8: '小红', 9: '' }), [{ name: '阿明', about: '做交易的那个人' }, { name: '小红', about: '' }]);
  assert.deepEqual(membersOf(undefined), []);
  const p = familyPage(fs.mkdtempSync(path.join(os.tmpdir(), 'fp-')));
  assert.match(p, /^你是 主播。/); assert.match(p, /群里是把你做出来、运营你的人/);
});
