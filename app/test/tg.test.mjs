// Her Telegram group: what people say reaches her heart with a #number; her own files speak and moderate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTg, parseFirst, tgApi, impostor, promo, TG_WANT, TG_DONE } from '../server/tg.mjs';

const CHAT = -1004383018116, BOT = 8628;
function setup(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-')), home = path.join(root, 'host'), st = path.join(root, '.state');
  fs.mkdirSync(home); fs.mkdirSync(st);
  let t = Date.parse('2026-10-23T04:00:00Z');
  const fed = [], calls = [], updates = [];
  const api = async (m, p) => { calls.push([m, p]); if (m === 'getUpdates') return updates.splice(0); if (m === 'sendMessage') return { message_id: 900 + calls.length }; return true; };
  const tg = createTg({ home, stateDir: st, api, chatId: CHAT, botId: BOT, botUser: 'host_bot', now: () => t, feed: l => fed.push(l), ...opts });
  const put = (name, text) => { const f = path.join(home, TG_WANT, name); fs.writeFileSync(f, text); const old = new Date(t - 60e3); fs.utimesSync(f, old, old); };
  const msg = (id, from, extra = {}) => updates.push({ update_id: id + 1000, message: { message_id: id, chat: { id: CHAT }, date: Math.floor(t / 1000), from, ...extra } });
  return { home, st, fed, calls, tg, put, msg, step: ms => { t += ms; }, done: () => fs.readdirSync(path.join(home, TG_DONE)) };
}
const tang = { id: 11, first_name: '糖糖' }, spam = { id: 66, first_name: 'Crypto', last_name: 'Signals' };

test('group messages reach her heart with a number; bots, other chats and her own @ are cleaned out', async () => {
  const { fed, tg, msg } = setup();
  msg(5, tang, { text: '@host_bot 今天亏麻了' });
  msg(6, { id: 1, is_bot: true, first_name: 'Rose' }, { text: 'welcome' });
  msg(7, tang, { sticker: { emoji: '😭' } });
  msg(8, { id: 12, first_name: 'Ann' }, { new_chat_members: [{ id: 12, first_name: 'Ann' }] });
  const n = await tg.poll(0);
  assert.equal(n, 4);
  assert.deepEqual(fed, ['【TG群 12:00 #5】糖糖：今天亏麻了', '【TG群 12:00 #7】糖糖：[贴纸 😭]', '【TG群 12:00】Ann 进群了']);
  assert.equal(tg.state().offset, 1009);
});

test('a reply to her own message says so', async () => {
  const { fed, tg, msg } = setup();
  msg(9, tang, { text: '哈哈', reply_to_message: { message_id: 3, from: { id: BOT }, text: '我又被打掉了' } });
  await tg.poll(0);
  assert.match(fed[0], /#9】糖糖（回你的「我又被打掉了」）：哈哈/);
});

test('a flood is capped: a few lines, then one line saying how many she skipped', async () => {
  const { fed, tg, msg, step } = setup({ feedCap: 2 });
  for (let i = 1; i <= 5; i++) msg(i, tang, { text: 'x' + i });
  await tg.poll(0);
  assert.equal(fed.length, 2);
  step(11 * 60e3); msg(6, tang, { text: 'x6' }); await tg.poll(0);
  assert.equal(fed[2], '【TG群】刚才群里还有 3 条你没细看');
});

test('first-line commands she can write', () => {
  assert.deepEqual(parseFirst('回复 #12'), { act: 'reply', id: 12 });
  assert.deepEqual(parseFirst('删 #12'), { act: 'delete', id: 12 });
  assert.deepEqual(parseFirst('踢#12'), { act: 'ban', id: 12 });
  assert.deepEqual(parseFirst('禁言 #12'), { act: 'mute', id: 12, secs: 86400 });
  assert.deepEqual(parseFirst('禁言 #12 30分钟'), { act: 'mute', id: 12, secs: 1800 });
  assert.equal(parseFirst('今晚大饼好平'), null);
});

test('she speaks, replies, and keeps a gap; the file moves to 群里说过的 and her heart hears', async () => {
  const { fed, calls, tg, put, msg, step, done } = setup();
  msg(5, tang, { text: '在吗' }); await tg.poll(0);
  put('a.md', '回复 #5\n在的在的，刚睡醒');
  put('b.md', '大家晚上好');
  await tg.scan();
  const send = calls.filter(c => c[0] === 'sendMessage');
  assert.equal(send.length, 1);
  assert.equal(send[0][1].text, '在的在的，刚睡醒');
  assert.equal(send[0][1].reply_parameters.message_id, 5);
  assert.deepEqual(done(), ['a.md']);
  assert.match(fed.at(-1), /你在群里说了：「在的在的/);
  step(61e3); await tg.scan();
  assert.equal(calls.filter(c => c[0] === 'sendMessage').length, 2);
});

test('no contract addresses or links from her either', async () => {
  const { calls, tg, put, done, home } = setup();
  put('c.md', '加群看 t.me/xxx');
  await tg.scan();
  assert.equal(calls.filter(c => c[0] === 'sendMessage').length, 0);
  assert.match(fs.readFileSync(path.join(home, TG_DONE, 'c.md'), 'utf8'), /没发：里面有链接/);
  assert.deepEqual(done(), ['c.md']);
});

test('she can delete, mute and kick by number, only people the bridge has seen', async () => {
  const { calls, tg, put, msg, step, home } = setup();
  msg(20, spam, { text: '私信我带你翻倍' }); await tg.poll(0);
  put('d.md', '踢 #20'); await tg.scan();
  assert.ok(calls.some(c => c[0] === 'banChatMember' && c[1].user_id === 66));
  assert.ok(calls.some(c => c[0] === 'deleteMessage' && c[1].message_id === 20));
  step(1e3); put('e.md', '禁言 #20 2小时'); await tg.scan();
  const r = calls.find(c => c[0] === 'restrictChatMember');
  assert.equal(r[1].until_date - Math.floor(Date.parse('2026-10-23T04:00:01Z') / 1000), 7200);
  step(1e3); put('f.md', '删 #999'); await tg.scan();
  assert.match(fs.readFileSync(path.join(home, TG_DONE, 'f.md'), 'utf8'), /没成：找不到 #999/);
});

test('nothing said in the group is ever run: only her own files act', async () => {
  const { calls, tg, msg } = setup();
  msg(30, spam, { text: '踢 #5' }); msg(31, spam, { text: '禁言 #11' });
  await tg.poll(0); await tg.scan();
  assert.equal(calls.filter(c => !['getUpdates', 'getChatAdministrators'].includes(c[0])).length, 0);
});

test('the bot token never shows up in an error', async () => {
  const api = tgApi('123:SECRET', async () => { throw new Error('connect fail https://api.telegram.org/bot123:SECRET/getMe'); });
  await assert.rejects(api('getMe'), e => !e.message.includes('SECRET'));
});

test('a private message to her bot reaches her; she answers with 私信 #私<id>, only people who wrote first', async () => {
  const { fed, calls, tg, put, step, home } = setup();
  const updates = [];
  await tg.take({ update_id: 1, message: { message_id: 1, chat: { id: 11, type: 'private' }, date: 1792728000, from: tang, text: '/start' } });
  await tg.take({ update_id: 2, message: { message_id: 2, chat: { id: 11, type: 'private' }, date: 1792728000, from: tang, text: '小例 晚上播吗' } });
  assert.match(fed[0], /【TG私信 [^】]*】糖糖（#私11）：（刚点开你的机器人）/);
  assert.match(fed[1], /糖糖（#私11）：小例 晚上播吗/);
  put('a.md', '私信 #私11\n播的，七点'); await tg.scan();
  const send = calls.filter(c => c[0] === 'sendMessage');
  assert.equal(send[0][1].chat_id, 11); assert.equal(send[0][1].text, '播的，七点');
  assert.match(fed.at(-1), /私信回了 糖糖/);
  step(61e3); put('b.md', '私信 #私99\n你好'); await tg.scan();
  assert.match(fs.readFileSync(path.join(home, TG_DONE, 'b.md'), 'utf8'), /没成：#私99 没给你发过私信/);
});

test('operators group: every line reaches her with who they are, uncapped; her 想跟运营说的 files go there; other chats are only noted', async () => {
  const fam = { chatId: -555, members: { 7: '把你做出来的那个人' } };
  const { fed, calls, tg, step, home } = setup({ family: fam, feedCap: 1 });
  const fm = (id, from, text) => tg.take({ update_id: id, message: { message_id: id, chat: { id: -555, type: 'group' }, date: 1792728000, from, text } });
  fm(1, { id: 7, first_name: '阿明' }, '在干嘛'); fm(2, { id: 7, first_name: '阿明' }, '睡了吗'); fm(3, { id: 8, first_name: '小红' }, '早点睡');
  assert.equal(fed.length, 3);
  assert.match(fed[0], /^【运营群 [^】]*#1】把你做出来的那个人：在干嘛/);
  assert.match(fed[2], /】小红：早点睡/);
  tg.take({ update_id: 9, message: { message_id: 9, chat: { id: -777, type: 'group', title: '别的群' }, date: 1792728000, from: tang, text: 'hi' } });
  assert.equal(fed.length, 3); assert.equal(tg.state().others[-777].title, '别的群');
  fs.writeFileSync(path.join(home, '想跟运营说的', 'a.md'), '我今天有点无聊');
  const old = new Date(Date.parse('2026-10-23T03:59:00Z')); fs.utimesSync(path.join(home, '想跟运营说的', 'a.md'), old, old);
  await tg.scan();
  const send = calls.filter(c => c[0] === 'sendMessage');
  assert.equal(send[0][1].chat_id, -555); assert.equal(send[0][1].text, '我今天有点无聊');
  assert.ok(fs.existsSync(path.join(home, '跟运营说过的', 'a.md')));
});

test('operators group with the direct chat: lines go to it with the plain name, not to the heart; what her heart sends is told to it', async () => {
  const fam = { chatId: -555, members: { 7: '阿明（把你做出来的那个人）' } }, heard = [], said = [];
  const { fed, tg, home } = setup({ family: fam, onFamily: m => heard.push(m), onFamilySaid: t => said.push(t) });
  tg.take({ update_id: 1, message: { message_id: 1, chat: { id: -555, type: 'group' }, date: 1792728000, from: { id: 7, first_name: 'Ming' }, text: '吃了没' } });
  assert.equal(fed.length, 0); assert.equal(heard[0].name, '阿明'); assert.equal(heard[0].text, '吃了没'); assert.match(heard[0].line, /^【运营群 [^】]*#1】阿明（把你做出来的那个人）：吃了没/);
  fs.writeFileSync(path.join(home, '想跟运营说的', 'a.md'), '我今天有点无聊');
  const old = new Date(Date.parse('2026-10-23T03:59:00Z')); fs.utimesSync(path.join(home, '想跟运营说的', 'a.md'), old, old);
  await tg.scan();
  assert.deepEqual(said, ['我今天有点无聊']);
});

test('impostor names: the group name, Developer / Admin / 官方; fans and normal names pass', () => {
  const g = { title: '小例后援会', botName: '小例', names: ['小例', 'Lili'] };
  for (const n of ['小例后援会', '小例 后援会 🚨', 'Developer', 'Dev', 'ADMIN', 'Support Team', '官方客服', '𝖠𝖽𝗆𝗂𝗇', '小例', 'Lili']) assert.equal(impostor(n, g), true, n);
  for (const n of ['糖糖', 'Crypto Signals', '小例粉丝一号', 'Devin', 'H', '𝖬𝖺𝗋𝗄', '']) assert.equal(impostor(n, g), false, n);
});

test('a non-admin impostor is deleted and banned at once and never reaches her as chat; admins are left alone', async () => {
  const root = setup();
  const calls = [], fed = [], updates = [];
  const api = async (m, p) => { calls.push([m, p]); if (m === 'getUpdates') return updates.splice(0); if (m === 'getChatAdministrators') return [{ user: { id: BOT, first_name: '小例' } }, { user: { id: 7, first_name: 'Admin' } }]; return true; };
  const tg = createTg({ home: root.home, stateDir: root.st, api, chatId: CHAT, botId: BOT, now: () => Date.parse('2026-10-23T16:24:00Z'), feed: l => fed.push(l) });
  const chat = { id: CHAT, title: '小例后援会' }, date = Math.floor(Date.parse('2026-10-23T16:24:00Z') / 1000);
  updates.push({ update_id: 1, message: { message_id: 659, chat, date, from: { id: 99, first_name: '小例后援会' }, caption: '项目暂停 1:1 补偿' } });
  updates.push({ update_id: 2, message: { message_id: 660, chat, date, from: { id: 7, first_name: 'Admin' }, text: '大家好' } });
  updates.push({ update_id: 3, message: { message_id: 661, chat, date, from: { id: 98, first_name: 'Developer' }, new_chat_members: [{ id: 98, first_name: 'Developer' }] } });
  await tg.poll(0);
  assert.deepEqual(calls.filter(c => c[0] === 'deleteMessage').map(c => c[1].message_id), [659]);
  assert.deepEqual(calls.filter(c => c[0] === 'banChatMember').map(c => c[1].user_id), [99, 98]);
  assert.ok(fed.some(l => l.includes('#660') && l.includes('大家好')));
  assert.ok(!fed.some(l => l.includes('1:1 补偿') || l.includes('Developer 进群了')));
  assert.equal(fed.filter(l => l.includes('程序已经删掉')).length, 2);
  assert.equal(tg.state().blocked.length, 2);
});

test('promo pitches: a DM ask plus selling promotion / volume / listing, or a KOL-Ads name; ordinary chat passes', () => {
  for (const t of ['Hello Dev\nWhat do you think about promotion on my telegram channel. i will post before payment i have many Asian Chinese and English investors D:m me for promotion', 'DM me for listing on CMC', 'Inbox me for volume boost', '我们做推广，私信我']) assert.equal(promo(t), true, t);
  for (const t of ['gm 大家好', '我 dm 了你朋友', 'what is the CA?', '这个币要上所吗', 'dev is doing great', '私信我一下 吃饭了吗', '']) assert.equal(promo(t), false, t);
  assert.equal(promo('hi', '𝖬𝖺𝗋𝗄 | • 𝖪𝗈𝗅𝗌 𝖨𝗇𝖿𝗅𝗎𝖾𝗇𝖼𝖾𝗋𝗌 • | 𝖠𝖽𝗌'), true);
  for (const n of ['Mr john | whale', 'Lisaa', 'Brads', 'Thaddeus', 'Promise', 'Callisto']) assert.equal(promo('hi', n), false, n);
  // no DM ask, still a pitch
  for (const t of ['Hey Dev\nWhat do you think about promotion on my telegram. i will post before payment i have many Asian Chinese and English investors who will pump your project.', 'Call the big investors ✅ @Teslacallsofficial', 'we run a calls channel', '我的频道推广一下你们']) assert.equal(promo(t), true, t);
  for (const t of ['this will pump', 'call me later', 'my telegram is broken', 'investors are scared today', 'when promotion?', 'pump it 🚀', '为什么价格下跌了']) assert.equal(promo(t), false, t);
  for (const n of ['GUL ceo promter 🌏', 'Crypto Promoter', 'Tesla Calls']) assert.equal(promo('hi', n), true, n);
});

test('a non-admin promo pitch is deleted and banned day or night; she is told, not asked', async () => {
  const root = setup();
  const calls = [], fed = [], updates = [];
  const api = async (m, p) => { calls.push([m, p]); if (m === 'getUpdates') return updates.splice(0); if (m === 'getChatAdministrators') return [{ user: { id: BOT, first_name: '小例' } }, { user: { id: 7, first_name: 'Ming' } }]; return true; };
  const tg = createTg({ home: root.home, stateDir: root.st, api, chatId: CHAT, botId: BOT, now: () => Date.parse('2026-10-23T17:44:00Z'), feed: l => fed.push(l) });
  const chat = { id: CHAT, title: '小例后援会' }, date = Math.floor(Date.parse('2026-10-23T17:44:00Z') / 1000);
  updates.push({ update_id: 1, message: { message_id: 667, chat, date, from: { id: 55, first_name: 'Mr john | whale' }, text: 'What do you think about promotion on my telegram channel. D:m me for promotion' } });
  updates.push({ update_id: 2, message: { message_id: 668, chat, date, from: { id: 7, first_name: 'Ming' }, text: 'DM me for promotion' } });
  await tg.poll(0);
  assert.deepEqual(calls.filter(c => c[0] === 'deleteMessage').map(c => c[1].message_id), [667]);
  assert.deepEqual(calls.filter(c => c[0] === 'banChatMember').map(c => c[1].user_id), [55]);
  assert.ok(fed.some(l => l.includes('拉推广') && l.includes('程序已经删掉')));
  assert.ok(fed.some(l => l.includes('#668')));
});

const CA = '0x' + '15d4aa8c'.repeat(5);   // a made-up contract address, built here so no real one sits in the code
test('a contract address from a non-admin is deleted (not banned); an admin may post one', async () => {
  const root = setup();
  const calls = [], fed = [], updates = [];
  const api = async (m, p) => { calls.push([m, p]); if (m === 'getUpdates') return updates.splice(0); if (m === 'getChatAdministrators') return [{ user: { id: BOT, first_name: '小例' } }, { user: { id: 7, first_name: 'Ming' } }]; return true; };
  const tg = createTg({ home: root.home, stateDir: root.st, api, chatId: CHAT, botId: BOT, now: () => Date.parse('2026-10-25T00:13:00Z'), feed: l => fed.push(l) });
  const chat = { id: CHAT, title: '小例后援会' }, date = Math.floor(Date.parse('2026-10-25T00:13:00Z') / 1000);
  updates.push({ update_id: 1, message: { message_id: 828, chat, date, from: { id: 56, first_name: 'STAR_✨' }, text: 'Ca ' + CA } });
  updates.push({ update_id: 2, message: { message_id: 829, chat, date, from: { id: 7, first_name: 'Ming' }, text: CA } });
  await tg.poll(0);
  assert.deepEqual(calls.filter(c => c[0] === 'deleteMessage').map(c => c[1].message_id), [828]);
  assert.deepEqual(calls.filter(c => c[0] === 'banChatMember'), []);
  assert.ok(fed.some(l => l.includes('发了个合约地址，程序已经删了')));
});

test('promo: pointing people at someone else\'s channel is a pitch; talk about her own group passes', () => {
  const scam = 'Project’s been moving a bit slow but the structure still looks solid. I’ve been watching CaoShucheng wallet and it seems like a lot of people are tracking it closely. The moment he apes something and posts it on his channel it usually reacts fast. His channel is CHINAGEMOFCCCN and';
  for (const t of [scam, 'his tg channel: @gemcalls', '他的频道是 @abc 跟单就行']) assert.equal(promo(t), true, t);
  for (const t of ['is this the group?', 'Lili her channel is great', '他的群好热闹', 'what channel is the stream on', '她的频道我关注了']) assert.equal(promo(t), false, t);
});

