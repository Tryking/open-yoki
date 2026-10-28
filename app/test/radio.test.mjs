// The radio between shows: answers come from Binance's own announcements, never made up; no coin calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickFacts, radioPrompt, cleanAnswer, idleLine, createRadio, radioTitle, SONG_ASK, findSong, songMoodsAt } from '../server/radio.mjs';

const FACTS = [
  { title: '在币安任一账户中持有RLUSD，瓜分60万XRP奖励', date: 1792576807719, body: '持有 RLUSD 即可参与' },
  { title: '现货交易量锦标赛第七期：交易瓜分高达400 BNB奖池', date: 1792573211715, body: '活动期间：2026年10月21日18:00至2026年10月28日18:00，累计交易至少500美元' },
  { title: '币安Alpha交易竞赛：交易NeoSoul (DNA) ，分享20万美元等值奖励', date: 1792494006923, body: 'Alpha 交易 DNA' },
];

test('radio: the question finds its announcement', () => {
  assert.equal(pickFacts('锦标赛第七期怎么参加', FACTS)[0].title, FACTS[1].title);
  assert.equal(pickFacts('RLUSD 有什么活动', FACTS)[0].title, FACTS[0].title);
  assert.equal(pickFacts('Alpha 的 DNA 比赛', FACTS)[0].title, FACTS[2].title);
  assert.deepEqual(pickFacts('今天天气怎么样', FACTS), []);
});

test('radio: the prompt holds the rules and only real announcements', () => {
  const [sys, user] = radioPrompt({ host: '小例', showAt: '19:00', topics: ['你自己的产品：只按资料说'], name: '糖糖', q: '第七期怎么参加', facts: pickFacts('锦标赛第七期', FACTS), all: FACTS, at: Date.UTC(2026, 9, 21, 15) });
  assert.match(sys.content, /你是 小例/);
  assert.match(sys.content, /绝不编奖励/);
  assert.match(sys.content, /这里没有实时行情/);
  assert.match(sys.content, /19:00 正式直播时/);
  assert.match(sys.content, /不用先撇清/);                       // no unprompted disclaimers
  assert.match(sys.content, /用什么语言写，你就用什么语言回/);   // foreign viewers are answered in their language
  assert.match(sys.content, /2026年10月21日18:00至2026年10月28日18:00/);
  assert.match(sys.content, /3\. 你自己的产品/);
  assert.match(sys.content, /不念合约地址/);
  assert.equal(user.content, '糖糖：第七期怎么参加');
  const none = radioPrompt({ name: 'a', q: 'b', facts: [], all: [] })[0].content;
  assert.match(none, /公告还没拿到/);
  assert.match(none, /下次正式直播时/);
  assert.match(none, /你的照片和字幕/);
});

test('radio: answers are cleaned and kept short', () => {
  assert.equal(cleanAnswer('小例：**糖糖**你好（笑）呀', 160, '小例'), '糖糖你好呀');
  assert.equal(cleanAnswer('主播：你好'), '你好');
  const long = '一二三四五六七八九十。'.repeat(20);
  assert.ok(cleanAnswer(long).length <= 160);
  const commas = '第七期是十月二十一号开始，'.repeat(15);
  assert.ok(cleanAnswer(commas).endsWith('开始。'));
  assert.ok(cleanAnswer(long).endsWith('。'));
  assert.equal(cleanAnswer(''), '');
  const en = 'Hey Lucius! Agent ID is a .ai name in your Binance Wallet. ' + 'Names stay with the wallet that claimed them. '.repeat(12);
  assert.ok(cleanAnswer(en).length > 200 && /\.$/.test(cleanAnswer(en)));   // English is not cut at 160 letters
});

test('radio: idle lines and title come from the host config, with generic fallbacks', () => {
  assert.equal(idleLine({ host: '小例', lines: ['我自己的一句'] }, () => 0), '我自己的一句');
  assert.match(idleLine({ host: '小例' }, () => 0), /小例/);
  assert.equal(radioTitle({ name: '小例' }), '小例 电台');
  assert.equal(radioTitle({ name: '小例', radio: { title: '小例 下播陪聊' } }), '小例 下播陪聊');
});

test('radio: no feed, no answers; off unless the Square side says so', async () => {
  const r = createRadio({ file: '/nonexistent/square.json', stateFile: '/nonexistent/radio.json', factsFile: '/nonexistent/facts.json', ask: async () => { throw new Error('should not ask'); }, voice: null, audioDir: '/tmp' });
  assert.equal(r.wanted(), false);
  assert.equal(r.chat('a', '你好'), false);
  await r.keep(false);
  assert.equal(r.on, false);
  await r.close();
});

test('radio music: 点歌 finds the song, other chat is not a request, late night plays soft', () => {
  const songs = [{ id: 'haoyunlai', title: '好运来', artist: '祖海', mood: '财运' }, { id: 'gugong', title: '孤勇者', artist: '陈奕迅', mood: '装逼大气' }, { id: 'running90s', title: 'Running in the 90s', artist: 'Max Coveri', mood: '拉盘嗨' }];
  const ask = t => { const m = String(t).match(SONG_ASK); return m ? findSong(m[1], songs)?.id || 'miss' : null; };
  assert.equal(ask('点歌 好运来'), 'haoyunlai');
  assert.equal(ask('点歌《孤勇者》'), 'gugong');
  assert.equal(ask('来一首孤勇者吧'), 'gugong');
  assert.equal(ask('点歌 running in the 90s'), 'running90s');
  assert.equal(ask('点歌 稻香'), 'miss');
  assert.equal(ask('币安神算子怎么玩'), null);
  assert.equal(ask('你好'), null);
  assert.ok(songMoodsAt(Date.UTC(2026, 9, 21, 19)).includes('深夜emo'));      // 03:00 Beijing
  assert.ok(!songMoodsAt(Date.UTC(2026, 9, 21, 19)).includes('拉盘嗨'));
  assert.ok(songMoodsAt(Date.UTC(2026, 9, 21, 14)).includes('拉盘嗨'));       // 22:00 Beijing
});

test('radio voice: a notch slower than the evening show, which keeps its own speed', async () => {
  const { radioSpeed } = await import('../server/radio.mjs');
  const { doubaoVoice } = await import('../server/voice.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dv = { voiceId: 'test-voice', speed: 6 };
  assert.equal(radioSpeed(dv), -4);
  assert.ok(radioSpeed(dv) < dv.speed);
  assert.equal(radioSpeed({ speed: 0 }), -10);
  assert.equal(radioSpeed({ speed: 6, radioSpeed: -2 }), -2);
  assert.equal(radioSpeed({ speed: -45 }), -50, 'Doubao floor');
  // what goes to Doubao: the radio's voice asks for its own speech_rate, the show's for the stage one
  const sent = [];
  const fetchImpl = async (u, o) => { sent.push(JSON.parse(o.body).req_params.audio_params.speech_rate); return { ok: true, status: 200, text: async () => [JSON.stringify({ code: 0, data: Buffer.from('ab').toString('base64') }), JSON.stringify({ code: 20000000 })].join('\n') }; };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-radio-voice-'));
  await doubaoVoice({ key: 'k', dir, voiceId: dv.voiceId, speed: dv.speed, fetchImpl }).say('你好', null, 'show1');
  await doubaoVoice({ key: 'k', dir, voiceId: dv.voiceId, speed: radioSpeed(dv), fetchImpl }).say('你好', null, 'radio1');
  assert.deepEqual(sent, [6, -4]);
  const index = fs.readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');
  assert.match(index, /const radioVoice = stageVoice && useDoubao \? doubaoVoice\(\{[^}]*speed: radioSpeed\(dv\)/);
  assert.match(index, /createRadio\(\{[^\n]*voice: radioVoice,/);
  assert.match(index, /doubaoVoice\(\{ key: volcKey, dir: voiceDir, dailyChars, voiceId: dv\.voiceId, context: dv\.context, speed: dv\.speed \|\| 0, tones/, 'the stage voice keeps dv.speed');
});
