// The host without a coin. Her page has both languages, the brain never tells her about a market cap, and
// what she jots about a person ends up in her notebook, not in her spoken line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { watchGate } from '../server/live.mjs';
import { readSquare, squareArgs, cleanComments } from '../server/square.mjs';
import { contextFor, promptFor, takeNote, takeCall, memoryFor, roomFor, parseReply, personaOf, createBrain, soulFor } from '../server/brain.mjs';
import { createMarket } from '../server/market.mjs';
import { createWorld } from '../server/world.mjs';
import { doubaoVoice, doubaoResource } from '../server/voice.mjs';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createMemory } from '../server/memory.mjs';

Object.defineProperty(globalThis, 'navigator', { value: { languages: ['en'] }, configurable: true });
globalThis.localStorage = { getItem: () => 'en', setItem() {} };
const { dict } = await import('../public/i18n.js');
const idol = (await import('../idols/example/config.mjs')).default;
const read = f => readFileSync(new URL(f, import.meta.url), 'utf8');
const han = /[一-龥]/;
const w = { stage: 0, mcapUsd: 0, mood: 'calm', top: null, exes: [], recent: [] };

test('the English page shows no Chinese before the script runs (English-first)', () => {
  const html = read('../public/index.html');
  const shown = [...html.matchAll(/data-i18n="[^"]*">([^<]*)</g)].map(m => m[1]).filter(t => han.test(t) && t !== '酱');
  assert.deepEqual(shown, []);
});

test('no coin: no market cap, stage or fan club in what she is told', () => {
  const ctx = contextFor(idol, w);
  assert.doesNotMatch(ctx, /市值|事业阶段|会长/);
  const p = promptFor(idol, { kind: 'chat', addr: 'guest-1', name: '老王', text: '睡不着' }, w).text;
  assert.match(p, /弹幕 by 老王/);
  assert.doesNotMatch(p, /持币|尾号/);
});

test('a jotted fact is split off the spoken line', () => {
  assert.deepEqual(takeNote('[平静][无]行吧，陪你熬。\n记：拿着 3 个 BNB'), { text: '[平静][无]行吧，陪你熬。', note: '拿着 3 个 BNB' });
  assert.deepEqual(takeNote('まだ下を見てる。 記：- 記：彼はBTCの行方を聞いてきた'), { text: 'まだ下を見てる。', note: '彼はBTCの行方を聞いてきた' });   // 10-18: Japanese answer
  assert.deepEqual(takeNote('[平静][无]行吧。'), { text: '[平静][无]行吧。', note: null });
});

test('she is reminded of a regular when answering them', () => {
  let t = Date.UTC(2026, 9, 14);
  const mem = createMemory({ now: () => t });
  mem.seen('老王'); t += 2 * 86400e3; mem.note('老王', '拿着 3 个 BNB');
  assert.match(memoryFor(mem, { kind: 'chat', name: '老王' }), /你认识他.*拿着 3 个 BNB/);
  assert.equal(memoryFor(mem, { kind: 'chat', name: '新人' }), '');
});

test('her own cloned voice: the line picks a tone, the voice reads it with that tone', async () => {
  const tones = idol.avatar.doubao.tones;
  assert.deepEqual(Object.keys(tones), ['热情', '吐槽', '慵懒', '温柔', '客服', '八卦', '笑着', '偷乐', '叹着气', '嘀咕', '小声应', '疑惑']);
  assert.equal(idol.avatar.doubao.voiceId, '');   // her cloned voice id comes from DOUBAO_VOICE_ID
  const cloned = ['S', 'madeUp12'].join('_');        // a made-up cloned-voice id
  assert.equal(doubaoResource(cloned), 'seed-icl-2.0');
  assert.equal(doubaoResource('zh_female_xiaohe_uranus_bigtts'), 'seed-tts-2.0');
  const persona = personaOf(idol);
  assert.match(persona, /语气只能是：热情、吐槽、慵懒、温柔、客服、八卦/);
  assert.doesNotMatch(persona, /\{tones\}|\{actions\}|\uFFFD/);
  const line = parseReply(idol, '[开心][挥手][吐槽]庄家问：洗干净了没？');
  assert.deepEqual([line.face, line.action, line.tone, line.text], ['happy', '挥手', '吐槽', '庄家问：洗干净了没？']);
  assert.equal(parseReply(idol, '[平静][无]就这样。').tone, undefined);
  // a tone may not share a name with a face or a move, or the tag would be read as that
  for (const t of Object.keys(tones)) assert.ok(!idol.actions[t] && !['平静', '开心', '生气', '难过', '害羞', '得意'].includes(t), t);
  for (const l of Object.values(idol.fallback).flat()) assert.ok(parseReply(idol, l).tone, l);

  const sent = [];
  const fetchImpl = async (url, opts) => { sent.push({ headers: opts.headers, p: JSON.parse(opts.body).req_params }); return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: 'YQ==' }) }; };
  const d = idol.avatar.doubao;
  const v = doubaoVoice({ key: 'k', dir: mkdtempSync(path.join(os.tmpdir(), 'lh-v-')), voiceId: cloned, context: d.context, speed: d.speed, tones: d.tones, fetchImpl });
  await v.pcm('亲，您好', 'id1', '客服');
  await v.pcm('就这样', 'id2');
  await v.say('哈喽', 'happy', 'id3', '热情');
  assert.equal(sent[0].headers['X-Api-Resource-Id'], 'seed-icl-2.0');
  assert.deepEqual([sent[0].p.context_texts, sent[0].p.audio_params.speech_rate], [[tones.客服.context], 8]);
  assert.deepEqual([sent[1].p.context_texts, sent[1].p.audio_params.speech_rate], [[d.context], 6]);
  assert.deepEqual([sent[2].p.context_texts, sent[2].p.audio_params.format], [[tones.热情.context], 'mp3']);
});

test('the voice connection is topped up only after 40 s without a line, with a free request', async () => {
  let t = 1e6; const urls = [];
  const fetchImpl = async url => { urls.push(url); return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0), text: async () => JSON.stringify({ code: 0, data: 'YQ==' }) }; };
  const v = doubaoVoice({ key: 'k', dir: mkdtempSync(path.join(os.tmpdir(), 'lh-w-')), voiceId: ['S', 'madeUp34'].join('_'), fetchImpl, now: () => t });
  await v.pcm('哈喽');
  t += 20e3; assert.equal(await v.warm(), false);
  t += 25e3; assert.equal(await v.warm(), true);
  t += 15e3; assert.equal(await v.warm(), false);
  assert.deepEqual(urls.map(u => new URL(u).pathname), ['/api/v3/tts/unidirectional', '/']);
});

// ---- the market she sees (10-14: "不止看bnb啊。也要看到所有的Btc啥的吧") ----
const tick = (symbol, lastPrice, chg = 0, vol = 1e8) => ({ symbol, lastPrice: String(lastPrice), priceChangePercent: String(chg), quoteVolume: String(vol), count: 100, highPrice: String(lastPrice), lowPrice: String(lastPrice) });
const board = (btc = 112345.6, extra = []) => [tick('BTCUSDT', btc, 1.2), tick('ETHUSDT', 4012.3, -0.8), tick('BNBUSDT', 742.87, 2.1), tick('SOLUSDT', 201.5, 3), tick('XRPUSDT', 2.512, 0), tick('DOGEUSDT', 0.2345, -1),
  tick('PEPEUSDT', 0.00001234, 22, 5e7), tick('GNSUSDT', 3.1, 78, 1.1e7), tick('GTCUSDT', 0.5, -21, 9e6), tick('TINYUSDT', 1, 300, 1e5), tick('NEARUSDT', 2.4, 1, 2e7),
  tick('USDCUSDT', 1, 0.01), tick('NVDABUSDT', 180, 40), tick('ARBUSDT', 0.4, 2), tick('牛来USDT', 0.02, 5, 8e6), tick('BTCFDUSD', 112000, 1), ...extra];

test('she sees every major, the liquid movers and any coin a viewer names, not stablecoins or stock tokens', () => {
  const m = createMarket({ now: () => 1e12 });
  m.take(board());
  assert.deepEqual(m.majors().map(c => c.coin), ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE']);
  const mv = m.movers('spot', 3);
  assert.deepEqual(mv.up.map(c => c.coin), ['GNS', 'PEPE', '牛来']);   // TINY is too thin, NVDAB is a stock
  assert.equal(mv.down[0].coin, 'GTC');
  assert.equal(m.get('USDC'), null);
  const line = m.lineFor({ kind: 'idle' });
  assert.match(line, /BTC 112346 美元（24 小时 \+1\.2%）/);
  assert.match(line, /ETH 4012 美元/);
  assert.match(line, /DOGE 0\.234 美元/);
  assert.match(line, /跌得最狠：GTC -21\.0%。/);
  assert.match(line, /涨得最猛：GNS \+78\.0%/);
  assert.equal(m.mentioned('大饼还能拿吗，姨太呢').join(), 'BTC,ETH');
  assert.deepEqual(m.mentioned('$pepe 冲不冲').sort(), ['PEPE']);
  assert.deepEqual(m.mentioned('pepe 冲不冲'), ['PEPE']);
  assert.deepEqual(m.mentioned('I am near the end'), []);
  assert.deepEqual(m.mentioned('NEAR 怎么样'), ['NEAR']);
  assert.deepEqual(m.mentioned('牛来是什么'), ['牛来']);
  assert.match(m.lineFor({ kind: 'chat', text: 'pepe 冲不冲' }), /他提到的币：PEPE 0\.0000123 美元/);
});

test('a stale feed tells her she cannot see the board, so she never invents prices', () => {
  let t = 1e12;
  const m = createMarket({ now: () => t });
  assert.match(m.lineFor(), /连不上/);
  m.take(board());
  t += 11 * 60e3;
  assert.match(m.lineFor(), /连不上/);
  assert.equal(m.board(), null);
});

test('a major jumping within five minutes becomes one market line, then waits ten minutes', () => {
  let t = 1e12;
  const moves = [];
  const m = createMarket({ now: () => t, onMove: e => moves.push(e) });
  m.take(board(100000));
  t += 60e3; m.take(board(101000));   // +1%: not yet
  t += 60e3; m.take(board(101800));   // +1.8% from the first: BTC jumps
  t += 60e3; m.take(board(103000));   // still moving, inside the gap
  assert.equal(moves.length, 1);
  assert.equal(moves[0].coin, 'BTC');
  assert.ok(moves[0].pct > 1.5);
  const p = promptFor(idol, moves[0], w).text;
  assert.match(p, /BTC 这 5 分钟突然拉了 1\.8%/);
  assert.doesNotMatch(p, /不喊单/);   // 10-15 user: calls are fine, no need to be so strict
});

test('her daily call is written as a tag, never read out, and lands in her notebook with the price', async () => {
  assert.deepEqual(takeCall('今晚我看大饼。\n{看盘:btc 涨}'), { text: '今晚我看大饼。', call: { coin: 'BTC', dir: 'up' } });
  assert.deepEqual(takeCall('随便聊聊{看盘:乱写}'), { text: '随便聊聊', call: null });
  assert.deepEqual(takeCall('赌姨太跌【看盘：eth跌】'), { text: '赌姨太跌', call: { coin: 'ETH', dir: 'down' } });
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-call-'));
  let t = Date.UTC(2026, 9, 14, 12, 0, 0);
  const memory = createMemory({ file: path.join(dir, 'memory.json'), tz: 8, now: () => t });
  const m = createMarket({ now: () => t });
  m.take(board(100000));
  const world = createWorld({ idol, file: path.join(dir, 'world.json'), now: () => t });
  const said = [], asked = [];
  const brain = createBrain({ idol, world, memory, market: m, now: () => t, speak: async l => { said.push(l); },
    ask: async msgs => { asked.push(msgs); return { text: '[开心][挥手][热情]晚上好，今晚我赌大饼明天更高，理由是我昨晚梦见它了。\n{看盘:BTC 涨}', cost: 0 }; } });
  brain.add({ kind: 'open', viewers: 3 });
  brain.start();
  await new Promise(r => setTimeout(r, 50));
  brain.stop();
  assert.match(asked[0][0].content, /【行情（币安，刚刚更新/);
  assert.match(asked[0][1].content, /\{看盘:币种 涨\}/);
  assert.doesNotMatch(said[0].text, /看盘|\{/);
  const c = memory.m.calls[0];
  assert.equal(c.subject, 'BTC'); assert.equal(c.dir, 'up'); assert.equal(c.price, 100000);
  assert.equal(c.due, t + 23 * 3600e3);
  assert.match(memory.callLine(), /你今天说过：BTC 明天这个时候会比现在高/);
  assert.ok(memory.calledToday());
  brain.add({ kind: 'idle', viewers: 3 });   // one call a day: a quiet moment later does not ask again
  brain.start(); await new Promise(r => setTimeout(r, 50)); brain.stop();
  assert.doesNotMatch(asked[1][1].content, /看盘:币种/);
  assert.deepEqual(memory.dueCalls(), []);
  t += 23 * 3600e3 + 1;
  assert.equal(memory.dueCalls().length, 1);
  memory.settle({ subject: 'BTC', result: 'BTC 从 100000 到 98000（-2.0%）', right: false });
  assert.match(memory.callLine(), /结果BTC 从 100000 到 98000（-2\.0%），你说错了/);
});

test('her instructions now point her at the live board and let her say her own calls but never promise profit', () => {
  assert.match(idol.now, /【行情】/);
  assert.doesNotMatch(idol.now, /看不到实时价格/);
  assert.doesNotMatch(idol.now, /不喊单/);
  assert.match(idol.now, /稳赚/);
  for (const l of idol.fallback.market) assert.ok(parseReply(idol, l).tone, l);
});

test('she sees every coin Binance trades: spot, perps (1000PEPE = PEPE) and Alpha, spot price first', () => {
  const m = createMarket({ now: () => 1e12 });
  m.take(board());
  m.take([tick('BTCUSDT', 112300, 1), tick('1000PEPEUSDT', 0.0123, 20, 3e8), tick('FARTUSDT', 1.5, 40, 5e7), tick('THINUSDT', 2, 90, 1e6)], 'perp');
  m.take({ data: [
    { symbol: '币安人生', price: '0.312', percentChange24h: '55.5', volume24h: '8000000', chainName: 'BSC' },
    { symbol: 'KOGE', price: '48.1', percentChange24h: '0.1', volume24h: '90000000', chainName: 'BSC' },
    { symbol: 'GONE', price: '1', percentChange24h: '900', volume24h: '9e9', chainName: 'BSC', offline: true },
    { symbol: 'PEPE', price: '0.99', percentChange24h: '1', volume24h: '1', chainName: 'Ethereum' },
  ] }, 'alpha');
  assert.equal(m.get('BTC').price, 112345.6);              // spot wins over the perp price
  assert.deepEqual(m.get('BTC').on, ['spot', 'perp']);
  assert.ok(Math.abs(m.get('PEPE').price - 0.00001234) < 1e-12);   // spot PEPE, not the Alpha token of the same name
  assert.equal(m.get('FART').board, 'perp');
  assert.equal(m.get('币安人生').chain, 'BSC');
  assert.equal(m.get('GONE'), null);
  const n = m.counts();
  assert.equal(n.perp, 4); assert.equal(n.alpha, 3);
  assert.equal(n.all, 17);   // 13 spot + FART, THIN on perps + 币安人生, KOGE on Alpha
  assert.deepEqual(m.movers('perp').up.map(c => c.coin), ['FART']);   // perp-only and liquid
  assert.deepEqual(m.movers('alpha').up.map(c => c.coin), ['币安人生']);
  const line = m.lineFor({ kind: 'idle' });
  assert.match(line, new RegExp(`你能查到币安上 ${n.all} 个币：现货 ${n.spot}、合约 4、Alpha 3`));
  assert.match(line, /Alpha里涨得最猛：币安人生 \+55\.5%（BSC）/);
  assert.match(line, /合约里涨得最猛：FART \+40\.0%/);
  assert.deepEqual(m.mentioned('币安人生还能上车吗'), ['币安人生']);
  assert.deepEqual(m.mentioned('FART 是啥'), ['FART']);
  assert.deepEqual(m.mentioned('hi yes go no'), []);
  const said = m.lineFor({ kind: 'chat', text: '币安人生还能上车吗' });
  assert.match(said, /币安人生 0\.312 美元（24 小时 \+55\.5%），在Alpha·BSC，24 小时成交 800 万美元/);
  assert.match(said, /别念合约地址/);
  assert.equal(m.board().count.all, n.all);
});

test('her own mind: days alive, a milestone said once, what she is thinking and the views she has said', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-soul-'));
  const at = Date.UTC(2026, 9, 20, 12, 0, 0);   // 10-20 20:00 Beijing = her 7th day
  const me = { ...idol, born: '2026-10-14' };   // first show 10-14, so 10-20 is her 7th day
  const memory = createMemory({ file: path.join(dir, 'memory.json'), tz: 8, now: () => at });
  const persona = personaOf(idol);
  assert.ok(persona.includes(`你是 ${idol.name}`), 'built from profile.mjs');
  assert.match(persona, /做你的人是谁、在哪个城市、做什么工作，一概不说/);
  assert.match(persona, /回复格式：/);
  memory.think({ thought: '想知道熬夜的人都在等什么', changed: '以前觉得狗币没救，今晚改口了' });
  memory.stance({ topic: '杠杆', view: '信仰不用杠杆' });
  memory.stance({ topic: '杠杆', view: '小杠杆也是杠杆' });
  assert.equal(memory.m.stances.length, 1);
  const open = soulFor(me, memory, { kind: 'open' }, at);
  assert.match(open, /活到第 7 天/);
  const bj = new Date(at + 8 * 3600e3);
  assert.ok(open.includes(`北京时间 ${bj.getUTCHours()}:${String(bj.getUTCMinutes()).padStart(2, '0')}`), 'she knows what time it is');
  assert.match(open, /第 7 天，算个小纪念日/);
  assert.match(open, /你最近在想：想知道熬夜的人都在等什么；你改过主意：以前觉得狗币没救/);
  assert.doesNotMatch(soulFor(me, memory, { kind: 'open' }, at), /纪念日/);   // said once
  assert.match(soulFor(me, memory, { kind: 'chat', text: '梭哈' }, at), /【你说过的看法】杠杆：小杠杆也是杠杆/);
  assert.equal(soulFor({ ...me, born: undefined }, memory, { kind: 'open' }, at), '');
  memory.save();
  const again = createMemory({ file: path.join(dir, 'memory.json'), tz: 8, now: () => at });
  assert.equal(again.m.thoughts.length, 1);
  assert.deepEqual(again.m.marks, ['day7']);
});

test('vidu only while watched: an empty room hangs up after the grace, a viewer brings her back', () => {
  let t = 0, n = 0;
  const watched = watchGate({ ...idol.watchedOnly, viewers: () => n, now: () => t });
  assert.equal(idol.watchedOnly.graceMs, 90e3);
  assert.equal(watched(), false);          // show opens into an empty room: no Vidu
  n = 1; assert.equal(watched(), true);
  n = 0; t = 60e3; assert.equal(watched(), true);   // a refresh inside the grace keeps her on
  t = 91e3; assert.equal(watched(), false);
  n = 2; assert.equal(watched(), true);
});

test('square feed: RTMP address and key from square.json, steady keyframes, key never in the log line', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-sq-'));
  const f = path.join(dir, 'square.json');
  assert.equal(readSquare(f), null);
  writeFileSync(f, JSON.stringify({ url: 'rtmp://push.example.com/live/', key: 'sk-123' }));
  const c = readSquare(f);
  assert.equal(c.target, 'rtmp://push.example.com/live/sk-123');
  assert.deepEqual([c.width, c.height, c.fps], [720, 1280, 24]);   // Vidu sends 24 fps
  writeFileSync(f, JSON.stringify({ url: 'rtmp://push.example.com/live/', key: 'sk-123', size: '1280x720' }));
  assert.deepEqual([readSquare(f).width, readSquare(f).height], [1280, 720]);   // 16:9 for Square's phone app (10-16)
  writeFileSync(f, JSON.stringify({ url: 'http://nope', key: 'x' }));
  assert.equal(readSquare(f), null);
  const a = squareArgs({ target: 'rtmp://h/live/k', fps: 25, kbps: 3000 });
  assert.equal(a.at(-1), 'rtmp://h/live/k');
  assert.equal(a[a.indexOf('-g') + 1], '50');
  assert.equal(a[a.indexOf('-f') + 1], 'flv');
});

test('square comments: cleaned, nameless ones get a placeholder, the same comment read twice counts once', () => {
  const seen = new Map(), nickOf = n => (n && !/币安/.test(n) ? String(n).slice(0, 12) : null);
  const a = cleanComments([{ name: '阿土', text: '  晚上好  ' }, { name: '币安官方', text: '冒充' }, { name: 'x', text: '' }], { seen, nickOf, now: 0 });
  assert.deepEqual(a, [{ name: '阿土', text: '晚上好' }, { name: '广场网友', text: '冒充' }]);
  assert.deepEqual(cleanComments([{ name: '阿土', text: '晚上好' }], { seen, nickOf, now: 60e3 }), []);
  assert.equal(cleanComments([{ name: '阿土', text: '晚上好' }], { seen, nickOf, now: 200e3 }).length, 1);
  assert.equal(cleanComments('nope', { seen, nickOf }).length, 0);
  // night 1: the 举报 button read with the text is the same comment; Square's own notice is not a comment
  assert.deepEqual(cleanComments([{ name: '阿土', text: '晚上好 举报' }], { seen, nickOf, now: 210e3 }), []);
  assert.deepEqual(cleanComments([{ name: '听众对 $BTC 感兴趣', text: '添加交易对' }, { name: '阿土', text: '添加交易对' }], { seen, nickOf, now: 0 }), []);
  assert.deepEqual(cleanComments([{ name: '阿土', text: '这个举报了吗' }], { seen, nickOf, now: 0 }).map(x => x.text), ['这个举报了吗']);
});

test('memes and songs: fitting ones offered, used ones not offered again, [放歌] picks the song', async () => {
  const { createMemes, takeSong, momentOf } = await import('../server/memes.mjs');
  const { mkdirSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-memes-'));
  writeFileSync(path.join(dir, 'memes.json'), JSON.stringify([
    { id: 'suoha', meme: '梭哈是一种智慧', mean: '全仓押上', use: '', tags: ['拉盘', '赚钱'], era: '老梗' },
    { id: 'gezi', meme: '又被割了一茬', mean: '韭菜被割', use: '', tags: ['亏钱'], era: '2026' },
  ]));
  mkdirSync(path.join(dir, 'bgm'));
  writeFileSync(path.join(dir, 'bgm', 'index.json'), JSON.stringify([
    { id: 'liangliang', title: '凉凉', mood: '砸盘惨', dur: 15, why: '有人亏钱' },
    { id: 'haoyunlai', title: '好运来', mood: '拉盘嗨', dur: 15 },
    { id: 'ghost', title: '没有文件', mood: '砸盘惨', dur: 15 },
  ]));
  writeFileSync(path.join(dir, 'bgm', 'liangliang.m4a'), 'x');
  writeFileSync(path.join(dir, 'bgm', 'haoyunlai.m4a'), 'x');
  let t = 1e6;
  const m = createMemes({ dir, rand: () => 0, now: () => t });
  assert.deepEqual(m.counts, { memes: 2, songs: 2 });   // a song without its clip is left out
  assert.deepEqual(momentOf({ kind: 'chat', text: '今天亏了一半' }).moods, ['砸盘惨', '深夜emo']);
  const o = m.offer({ kind: 'chat', text: '今天亏了一半' });
  assert.deepEqual(o.memes.map(x => x.id), ['gezi']);
  assert.deepEqual(o.songs.map(x => x.id), ['liangliang']);
  assert.match(o.text, /又被割了一茬/); assert.match(o.text, /你顺手放了《凉凉》/);
  const r = takeSong('[放歌:liangliang][难过][无][温柔]凉凉送给你，宝宝。');
  assert.equal(r.id, 'liangliang'); assert.equal(r.text, '[难过][无][温柔]凉凉送给你，宝宝。');
  m.took(o, '你这是又被割了一茬呀');
  assert.deepEqual(m.song('liangliang'), { id: 'liangliang', title: '凉凉', url: '/bgm/liangliang.m4a', dur: 15 });
  assert.equal(m.song('haoyunlai'), null);   // too soon after the last song
  const o2 = m.offer({ kind: 'chat', text: '又亏了' });
  assert.deepEqual(o2.memes, []); assert.deepEqual(o2.songs, []);   // used meme gone, no song inside the gap
  t += 61e3;
  assert.deepEqual(m.offer({ kind: 'market', pct: 3 }).songs.map(x => x.id), ['haoyunlai']);
  m.forget();
  assert.equal(m.offer({ kind: 'chat', text: '亏麻了' }).memes.length, 1);
  assert.equal(takeSong('没放歌').id, null);
});

test('repeatOf: a line that reuses a stretch or the ending of a recent line is caught', async () => {
  const { repeatOf } = await import('../server/brain.mjs');
  const recent = ['哎这波爆仓……全清了啊，先喘口气，慢慢说说当时怎么想的，我听着呢。'];
  assert.equal(repeatOf('[难过][无][温柔]又砍一半了啊，说说为啥拿的，我听着呢。', recent), '我听着呢');
  assert.equal(repeatOf('我看你先喘口气慢慢来吧', recent), '先喘口气慢');
  assert.equal(repeatOf('哎这波又是你？', recent), '哎这');
  assert.equal(repeatOf('今晚吃了碗螺蛳粉，辣到吸气', recent), '');
});

test('quiet room: no hooks or timed segments, she is just told the room is quiet and picks what to do', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-quiet-'));
  let t = Date.UTC(2026, 9, 14, 12, 0, 0);
  const world = createWorld({ idol, file: path.join(dir, 'world.json'), now: () => t });
  let n = [{ id: 'n1', title: '币安将上线某新币', sub: '', at: t }];
  const asked = [], said = [];
  const brain = createBrain({ idol, world, now: () => t, rand: () => 0.6, idleMs: -1, viewers: () => 1, news: { pick: () => n.shift() || null },
    ask: async msgs => { if (!/【直播间】.*(刚有人进来|刚进来)|刚有人进了直播间/.test(msgs[1].content)) asked.push(msgs[1].content); return { text: '[开心][无][热情]好家伙今晚有点东西啊', cost: 0 }; },
    speak: async (l, e) => { if (e.kind === 'join') return; said.push(l); t += 60 * 60e3; await new Promise(r => setTimeout(r, 2)); } });
  brain.start();
  await new Promise(r => setTimeout(r, 80));
  brain.stop();
  assert.ok(!idol.hooks && !idol.segments && !idol.idleNote);
  assert.match(asked[0], /【刚看到的快讯】币安将上线某新币/);
  assert.match(asked[1], /【冷场】/);
  // 10-18: a quiet room is her cue to start a bit, not a place to moan; after 30 s without a line she must speak
  assert.match(asked[1], /最会来事/); assert.match(asked[1], /别抱怨没人说话/);
  assert.equal(idol.idleMs, 25000); assert.equal(idol.maxQuietMs, 30000);
  assert.ok(asked.length > 3);
  assert.ok(!asked.some(a => /套路|【今晚盘面】|【今晚最惨奖】|【系统】直播间安静/.test(a)));
});

test('news and X notes: politics and links dropped, X reads only new posts', async () => {
  const { keepNews, keepPost } = await import('../server/news.mjs');
  assert.equal(keepPost({ id: 1, authorName: '某人', content: '抢红包啦 http://x.y' }), null);
  assert.equal(keepPost({ id: 2, authorName: '币安广场', content: '年度创作者提名开启' }), null);
  assert.deepEqual(keepPost({ id: 3, authorName: '绿毛', content: '抄底！[看这里](https://a.b)', commentCount: 4669, date: 1 }), { id: '3', who: '绿毛', text: '抄底！看这里', comments: 4669, likes: 0, at: 1000 });
  const { parseLearned, createXLearn } = await import('../server/xlearn.mjs');
  assert.equal(keepNews({ id: 1, title: '某国总统宣布对加密征税', subTitle: '' }), null);
  assert.equal(keepNews({ id: 2, title: '油价上涨', subTitle: '' }), null);
  assert.equal(keepNews({ id: 3, title: '比特币突破新高', subTitle: '据彭博社报道，比特币今日上涨', date: 100 }).sub, '比特币今日上涨');
  const got = parseLearned('{"what":"大家在聊 AI Agent 发币","term":"agentfi","who":"@EmberCN"}\n{"what":"去 https://x.com 领空投","term":"","who":"a"}\n{"what":"总统又发推了","who":"b"}', 5);
  assert.equal(got.length, 1); assert.equal(got[0].who, 'EmberCN'); assert.equal(got[0].term, 'agentfi');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-x-'));
  const urls = [];
  const x = createXLearn({ file: path.join(dir, 'learned.json'), bearer: 'b', accounts: ['cz_binance', 'EmberCN'], log: () => {},
    fetchImpl: async u => { urls.push(String(u)); return { ok: true, json: async () => ({ data: [{ id: '9', author_id: 'u1', text: 'agentfi is the new meta' }], includes: { users: [{ id: 'u1', username: 'EmberCN' }] }, meta: { newest_id: '9' } }) }; },
    ask: async () => ({ text: '{"what":"AI Agent 叙事又热了","term":"agentfi","who":"EmberCN"}', cost: 0 }) });
  assert.equal((await x.run()).length, 1);
  await x.run();
  assert.match(decodeURIComponent(urls[0]).replace(/\+/g, ' '), /from:cz_binance OR from:EmberCN/);
  assert.doesNotMatch(urls[0], /since_id/); assert.match(urls[2], /since_id=9/);
  assert.match(urls[1], /sort_order=relevancy/); assert.match(decodeURIComponent(urls[1]), /lang:zh/);
  assert.match(urls[0], /max_results=20/); assert.match(urls[1], /max_results=10/); assert.match(urls[3], /since_id=9/);
  assert.equal(x.pick().what, 'AI Agent 叙事又热了');
});

test('speech: line length varies per line, the old fixed caps are gone, a quiet room keeps the last topic going', async () => {
  const { pickLength } = await import('../server/brain.mjs');
  assert.equal(pickLength(idol.lengths, { kind: 'chat' }, () => 0), idol.lengths.say[0]);
  assert.equal(pickLength(idol.lengths, { kind: 'idle' }, () => 0.99), idol.lengths.say[2]);
  assert.doesNotMatch(idol.persona, /^$/); assert.match(idol.persona, /别演小剧场/);
  assert.ok(!idol.angles.some(a => /演两个角色/.test(a)));
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-more-'));
  let t = Date.UTC(2026, 9, 14, 12, 0, 0);
  const world = createWorld({ idol, file: path.join(dir, 'world.json'), now: () => t });
  world.say({ text: '今晚这根大阳线有点吓人', face: '开心', kind: 'idle', at: t });
  const asked = [];
  const brain = createBrain({ idol, world, now: () => t, rand: () => 0.1, idleMs: -1, viewers: () => 1,
    ask: async msgs => { if (!/【直播间】.*(刚有人进来|刚进来)|刚有人进了直播间/.test(msgs[1].content)) asked.push(msgs[1].content); return { text: '[开心][无][热情]不对不对，我再看一眼', cost: 0 }; },
    speak: async (l, e) => { await new Promise(r => setTimeout(r, 2)); } });
  brain.start();
  await new Promise(r => setTimeout(r, 60));
  brain.stop();
  assert.match(asked[0], /【接着聊】.*今晚这根大阳线有点吓人/);
  assert.doesNotMatch(asked[0], /\d+ 字以内/);
  assert.match(asked[0], /这次的长度：就一个脱口而出的反应/);
  assert.match(asked[1], /【接着聊】/); assert.doesNotMatch(asked[2], /【接着聊】/);   // two follow-ups, then something new
});

test('model: DeepSeek speaks, Doubao takes over when it is slow, fails or says nothing; an inline 记 never gets read out', async () => {
  const { withBackup } = await import('../server/brain.mjs');
  assert.equal(idol.models.main, 'deepseek/deepseek-v4.1-flash');
  assert.equal(idol.models.mainMs, 3500);
  const backup = async () => ({ text: 'B', cost: 0 });
  const slow = (m, o) => new Promise((res, rej) => { const t = setTimeout(() => res({ text: 'late' }), 500); o.signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }); });
  assert.equal((await withBackup(async () => ({ text: 'K' }), backup, { log() {} })([])).text, 'K');
  assert.equal((await withBackup(slow, backup, { mainMs: 20, log() {} })([])).text, 'B');
  assert.equal((await withBackup(async () => { throw new Error('openrouter 500'); }, backup, { log() {} })([])).text, 'B');
  assert.equal((await withBackup(async () => ({ text: ' ' }), backup, { log() {} })([])).text, 'B');
  assert.deepEqual(takeNote('泡面加蛋，我全吃了。记：小鱼q2 爱问吃的'), { text: '泡面加蛋，我全吃了。', note: '小鱼q2 爱问吃的' });
  assert.deepEqual(takeNote('泡面加蛋 记：爱问吃的'), { text: '泡面加蛋', note: '爱问吃的' });
  assert.equal(takeNote('我先帮你记小本本上了').text, '我先帮你记小本本上了');
});

test('moves: almost every line moves, the page buttons stay the six cute ones, she fidgets only while silent', async () => {
  const { personaOf, defaultAction } = await import('../server/brain.mjs');
  const p = personaOf(idol);
  assert.match(p, /几乎每句都配一个小动作/);
  assert.doesNotMatch(p, /大多数时候写\[无\]/);
  assert.match(p, /看手机、看屏幕/);
  assert.doesNotMatch(p.match(/动作只能是：[^，]*/)[0], /喝水|伸懒腰/);   // quiet moves never go with a spoken line
  assert.ok(idol.kindAction.post.includes(defaultAction(idol, { kind: 'post' })));   // 10-19: one of a few, not always 看手机
  assert.equal(defaultAction(idol, { kind: 'market' }), '看屏幕');
  assert.equal(defaultAction(idol, { kind: 'join' }, () => 0), '挥手');
  assert.ok(idol.react.join.includes('比心') && idol.react.thanks.includes('飞吻'));   // night 1: 74 waves, no hearts
  assert.equal(defaultAction(idol, { kind: 'chat' }), null);
  for (const m of idol.fidget.moves) assert.ok(idol.actions[m]?.lib, m);
  for (const [k, a] of Object.entries(idol.actions)) assert.ok(a.lib && a.vidu, k);
  const { start } = await import('../server/index.mjs');
  assert.equal(typeof start, 'function');
});

test('room: she sees the last ten minutes of comments and her own replies, oldest first', () => {
  const t = 1e9;
  const w = { chat: [{ id: 'c3', at: t - 5e3, who: '理想国住民', text: '那你买了吗' }, { id: 'c2', at: t - 60e3, who: '小明', request: '比心' }, { id: 'c1', at: t - 120e3, who: '理想国住民', text: '现在bnb多少' }, { id: 'c0', at: t - 20 * 60e3, who: '老王', text: '太早了' }],
    talk: [{ at: t - 100e3, text: 'BNB 六百出头，我盯着呢。', to: '理想国住民' }] };
  const r = roomFor(w, { kind: 'chat', chatId: 'c3' }, t);
  assert.match(r, /理想国住民：现在bnb多少\n- 你（回理想国住民）：BNB 六百出头，我盯着呢。\n- 小明：点播了「比心」/);
  assert.doesNotMatch(r, /那你买了吗|老王/);
  assert.equal(roomFor({ chat: [], talk: [] }, { kind: 'idle' }, t), '');
});

test('an English comment is answered with English market colours (red = down)', async () => {
  const { promptFor } = await import('../server/brain.mjs');
  const { createWorld } = await import('../server/world.mjs');
  const { default: idol } = await import('../idols/example/config.mjs');
  const world = createWorld({ idol });
  const p = promptFor(idol, { kind: 'chat', addr: 'guest-sq-abc', name: 'Bhattirajpoo', text: 'how are you', tier: 'guest', tierName: '游客' }, world.w).text;
  assert.match(p, /跌是 red/);
  assert.doesNotMatch(promptFor(idol, { kind: 'chat', addr: 'guest-sq-abc', name: '阿明', text: '你在干嘛呢', tier: 'guest', tierName: '游客' }, world.w).text, /跌是 red/);
});

// 10-15 user: a real person, not a tool. The move matches the line's mood, she has moments to herself, and her face
// reacts before her voice.
test('her move matches the mood of the line: a sad line never gets a grin, a viewer request keeps its move', async () => {
  const { moveFor } = await import('../server/brain.mjs');
  const e = { kind: 'chat', text: '今天又亏了' };
  for (let i = 0; i < 20; i++) {
    const m = moveFor(idol, { face: 'sad', action: '后仰笑' }, e, () => i / 20);
    assert.ok(idol.moods.sad.includes(m), `sad got ${m}`);
  }
  assert.equal(moveFor(idol, { face: 'happy', action: '捧脸笑' }, e), '捧脸笑');
  assert.equal(moveFor(idol, { face: 'sad' }, { kind: 'request', action: '比心' }), '比心');
  for (const [k, moves] of Object.entries(idol.moods)) for (const m of moves) assert.ok(idol.actions[m]?.lib, `${k}: ${m}`);
});

test('quiet room (10-19): a worn price or chart word is named and steered away from; quiet is never called empty', async () => {
  const { wornTopics, defaultAction } = await import('../server/brain.mjs');
  const said = ['八万二上头这根收盘，我自己盯。', 'BTC 还在 82000 上头晃，我赌它这根能站住', '82,000 这一下往下跳', '八万二还杵在那儿，这根针', '今天运营又改了我口型'];
  const w = wornTopics(said);
  assert.ok(w.includes('82000') && w.includes('这根'), w.join());
  assert.deepEqual(wornTopics(['今天运营又改了我口型', '广场有人发白银切碎卖']), []);
  const world = createWorld({ idol }).w;
  const idle = promptFor(idol, { kind: 'idle', quietMin: 70, viewers: 1, worn: ['82000', '这根'] }, world).text;
  assert.match(idle, /没人打字不等于没人看/); assert.match(idle, /82000、这根/); assert.doesNotMatch(idle, /一个人都没有/);
  assert.match(promptFor(idol, { kind: 'idle', quietMin: 1, viewers: 0 }, world).text, /一个人都没有/);   // Square really says 0
  assert.match(promptFor(idol, { kind: 'more', last: '八万二', worn: ['82000'] }, world).text, /换个完全不同的话题/);
  const seen = new Set(); for (let i = 0; i < 40; i++) seen.add(defaultAction(idol, { kind: 'post' }, Math.random));
  assert.ok(seen.size >= 3 && [...seen].every(a => idol.actions[a]), [...seen].join());
});

test('quiet room (10-19): with a worn topic the next quiet beat is new material, not "接着聊"', async () => {
  const world = createWorld({ idol });
  for (const t of ['八万二这根收盘我盯着', '八万二还在', '这根收盘站住没', '八万二站不站得住']) { world.w.talk = [{ at: Date.now(), text: t }, ...(world.w.talk || [])]; world.w.recent.unshift(t); }
  world.w.line = { text: '八万二站不站得住', kind: 'idle', at: Date.now() };
  const posts = { pick: () => ({ who: 'Chris', comments: 30, text: '深圳还有这样的存在' }) };
  const brain = createBrain({ idol: { ...idol, idleSelf: 0 }, world, ask: async () => '', speak: async () => {}, posts, rand: () => 0.1, onAir: () => true });
  const e = brain.idleEvent();
  assert.equal(e.kind, 'post'); assert.ok(e.worn.length);
  world.w.talk = [{ at: Date.now(), text: '今天运营又改了我口型' }]; world.w.line = { text: '今天运营又改了我口型', kind: 'idle', at: Date.now() };
  assert.equal(brain.idleEvent().kind, 'more');   // a fresh topic is still carried on
});

test('her own moment: a line to herself, not to the viewers', async () => {
  const { promptFor } = await import('../server/brain.mjs');
  const { createWorld } = await import('../server/world.mjs');
  const p = promptFor(idol, { kind: 'self', quietMin: 3 }, createWorld({ idol }).w).text;
  assert.match(p, /不是说给观众听的/);
  assert.ok(idol.idleSelf > 0 && idol.idleSelf < 1);
});

test('vidu: the move goes out first and her voice follows reactLeadMs later; a new comment makes her look over', async () => {
  const http = await import('node:http');
  const { WebSocketServer } = await import('ws');
  const { createAvatar } = await import('../server/avatar.mjs');
  const got = [];
  const server = http.createServer((req, res) => {
    req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ live: { id: 'L1' }, client_secret: 'cs' })); });
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', ws => ws.on('message', (data, binary) => {
    if (binary) return got.push({ type: 'pcm', at: Date.now() });
    const m = JSON.parse(String(data));
    if (m.type === 1) ws.send(JSON.stringify({ type: 2, payload: { conn_init_ack: { success: true } } }));
    else got.push({ type: m.type, content: m.payload?.text_msg?.content, at: Date.now() });
  }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const me = { ...idol, avatar: { ...idol.avatar, reactLeadMs: 300, viduActionLib: 'test-lib' } };
  const voice = { pcm: async () => Buffer.alloc(48 * 200) };
  const av = createAvatar({ idol: me, kind: 'vidu', voice, room: { publisher: () => ({}), appId: 'a', roomId: 'r', publisherId: 'p' }, env: { VIDU_KEY: 'k', VIDU_BASE: `http://127.0.0.1:${server.address().port}` } });
  try {
    await av.open();
    av.notice();
    await new Promise(r => setTimeout(r, 50));
    const looked = got.filter(m => m.type === 9).map(m => m.content);
    assert.equal(looked.length, 1); assert.ok([].concat(me.notice).includes(looked[0]), looked[0]);   // 10-18: one of a few looks
    av.notice();                                   // a second comment right away does not jerk her again
    await av.perform({ text: '哈哈你好', action: '捧脸笑', id: 'x' });
    await new Promise(r => setTimeout(r, 50));
    const act = got.filter(m => m.type === 9).at(-1), line = got.find(m => m.type === 10), pcm = got.find(m => m.type === 'pcm');
    assert.equal(act.content, '捧脸笑');
    assert.equal(got.filter(m => m.type === 9).length, 2);
    assert.ok(line.at - act.at >= 280, `lead ${line.at - act.at} ms`);
    assert.ok(pcm.at >= line.at);
  } finally { await av.close(); wss.close(); server.close(); }
});

test('square tap: with a tap file the feed also goes to that file, and the push stays flv', () => {
  const a = squareArgs({ target: 'rtmp://h/live/k', tap: '/tmp/t.ts' });
  assert.deepEqual(a.slice(-3), ['-f', 'tee', '[f=flv]rtmp://h/live/k|[f=mpegts]/tmp/t.ts']);
  assert.deepEqual(squareArgs({ target: 'rtmp://h/live/k' }).slice(-3), ['-f', 'flv', 'rtmp://h/live/k']);
});

test('soul: she thinks first, her mood carries to the next line, and a quiet moment can be silence', async () => {
  const { takeInner } = await import('../server/brain.mjs');
  assert.deepEqual(takeInner('想：有点无聊｜没人说话，刷刷盘\n[平静][看屏幕][慵懒]嗯……还是那样'), { text: '[平静][看屏幕][慵懒]嗯……还是那样', inner: '有点无聊｜没人说话，刷刷盘', feel: '有点无聊', why: '没人说话，刷刷盘' });
  assert.equal(takeInner('[开心][无][热情]哈哈').inner, null);
  assert.equal(takeInner('想：开心｜留人\n[开心][无][热情]随便坐。 想：轻松｜再多说两句，留人别追问 反正我不睡。').text, '[开心][无][热情]随便坐。 反正我不睡。', 'a second 想 line mid-reply is never read out');
  assert.equal(takeInner('我想：这不行吧').text, '我想：这不行吧');
  assert.equal(idol.inner, true);
  assert.match(personaOf(idol), /先想再说/); assert.match(personaOf(idol), /想：<此刻心情/);
  assert.doesNotMatch(personaOf(idol), /四成|三成|两成|一成/);   // no style ratios: her mood picks the voice
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-inner-'));
  let t = Date.UTC(2026, 9, 15, 12, 0, 0);
  const world = createWorld({ idol, file: path.join(dir, 'world.json'), now: () => t });
  const answers = ['想：难过｜想起他爆仓那阵\n[难过][叹气][温柔]唉……今晚好安静', '想：难过｜还没缓过来\n[难过][托腮][温柔]嗯……', '想：无聊｜不想说话\n[平静][托腮][慵懒]'];
  const sys = [], said = [], acted = [];
  const brain = createBrain({ idol: { ...idol, maxQuietMs: undefined }, world, now: () => t, rand: () => 0.9, idleMs: -1, viewers: () => 1,
    ask: async msgs => { sys.push(msgs[0].content); return { text: answers.shift() || '[平静][无][慵懒]嗯', cost: 0 }; },
    speak: async (l, e) => { said.push(l); t += 60e3; await new Promise(r => setTimeout(r, 2)); },
    act: async (l, e) => { acted.push(l); t += 60e3; await new Promise(r => setTimeout(r, 2)); } });
  brain.start();
  await new Promise(r => setTimeout(r, 60));
  brain.stop();
  assert.doesNotMatch(sys[0], /【你此刻的心情】\S+（/);
  assert.match(sys[1], /【你此刻的心情】难过（1 分钟了，想起他爆仓那阵）/);
  assert.match(sys[2], /【你此刻的心情】难过（2 分钟了，还没缓过来）/);   // same feeling: the clock keeps running
  assert.ok(!said.some(l => /想：/.test(l.text)));
  assert.equal(said[0].inner, '难过｜想起他爆仓那阵');
  assert.equal(acted.length >= 1, true); assert.equal(acted[0].silent, true);
  // the model asked for 托腮 again, right after the last line's 托腮: she does another quiet face instead (10-16)
  assert.notEqual(acted[0].action, '托腮'); assert.ok(idol.moods.neutral.includes(acted[0].action));
  assert.equal(brain.mood.feel, '无聊');
});

test('soul memory: real experiences, last show reflection and real goal progress', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-life-'));
  let t = Date.UTC(2026, 9, 15, 12, 0, 0);
  const memory = createMemory({ file: path.join(dir, 'memory.json'), tz: 8, now: () => t });
  assert.equal(memory.lifeLine(), ''); assert.equal(memory.goalLine(), '');
  memory.openShow(t);
  for (const who of ['小明', '阿杰', '老王']) memory.seen(who, t);
  memory.experience({ text: '第一次有人在直播间说爆仓，我陪他聊到下播', at: t });
  memory.experience({ text: '第一次有人在直播间说爆仓，我陪他聊到下播', at: t });   // same thing twice is one memory
  t += 3 * 3600e3;
  memory.closeShow({ about: '爆仓', felt: '有点累但很满足', mood: '温柔', miss: [{ who: '小明', why: '他说明天还来' }], tryNext: '早点问他们吃了没', at: t });
  t += 20 * 3600e3;
  assert.match(memory.lifeLine(), /10-15：第一次有人在直播间说爆仓/);
  assert.equal(memory.lifeLine().match(/第一次有人/g).length, 1);
  assert.match(memory.goalLine(), /一共 3 个人/); assert.match(memory.goalLine(), /还没有来过三次以上的老粉/);
  const last = memory.lastShowLine();
  for (const x of ['有点累但很满足', '「温柔」', '小明（他说明天还来）', '早点问他们吃了没']) assert.ok(last.includes(x), x);
});

test('10-16 afternoon test: she is told it is daytime, and a welcome never gets the long riff', async () => {
  const { soulFor, pickLength } = await import('../server/brain.mjs');
  const at = Date.parse('2026-10-16T06:31:00Z');   // 14:31 Beijing
  const day = soulFor({ born: '2026-10-14', tz: 8 }, null, { kind: 'chat' }, at);
  assert.match(day, /北京时间 14:31，下午。现在是白天，别说“这么晚”/);
  const night = soulFor({ born: '2026-10-14', tz: 8 }, null, { kind: 'chat' }, Date.parse('2026-10-15T19:02:00Z'));
  assert.match(night, /北京时间 3:02，凌晨。/);
  assert.doesNotMatch(night, /现在是白天/);
  for (const r of [0, 0.5, 0.99]) assert.notEqual(pickLength(idol.lengths, { kind: 'join' }, () => r), idol.lengths.say[2]);
  assert.equal(pickLength(idol.lengths, { kind: 'idle' }, () => 0.99), idol.lengths.say[2], 'her own talk can still ramble');
});

test('10-16: asked someone and he has not answered, so she is told not to press him again', async () => {
  const { waitingFor } = await import('../server/brain.mjs');
  const t0 = Date.parse('2026-10-16T06:47:00Z');
  const w = { chat: [{ who: '橙子', text: 'ETH套住了 咋整', at: t0 }, { who: '小周', text: '好难受', at: t0 + 5e3 }],
    talk: [{ at: t0 + 10e3, to: '橙子', text: '套住就套住吧，你这均价是买在哪儿的呀。' }, { at: t0 + 20e3, to: '小周', text: '钱走了人还在，坐会儿缓缓。' }] };
  assert.match(waitingFor(w, t0 + 60e3), /你刚问过 橙子，他还没回/);
  w.chat.push({ who: '橙子', text: '现货 均价2800', at: t0 + 70e3 });
  assert.equal(waitingFor(w, t0 + 80e3), '', 'he answered');
  assert.equal(waitingFor({ chat: w.chat.slice(0, 2), talk: w.talk }, t0 + 10 * 60e3), '', 'long ago: let it go');
});

test('10-16 微表情: many small faces per feeling, never the same move twice running, a small second face for long lines', async () => {
  const { moveFor, beatFor } = await import('../server/brain.mjs');
  const micro = Object.entries(idol.actions).filter(([, a]) => a.micro);
  assert.ok(micro.length >= 20);
  for (const [n, a] of micro) assert.ok(a.lib.length >= 15 && a.lib.length <= 120 && !/捂|喝/.test(a.lib), `${n}: small, mouth free`);
  for (const [mood, pool] of Object.entries(idol.moods)) assert.ok(pool.filter(m => idol.actions[m]?.micro).length >= 3, `${mood} has small faces`);
  let last = null;
  for (let i = 0; i < 200; i++) {
    const m = moveFor(idol, { text: '嗯', face: 'happy' }, { kind: 'chat' }, Math.random, last);
    assert.notEqual(m, last); assert.ok(idol.moods.happy.includes(m)); last = m;
  }
  assert.equal(moveFor(idol, { text: '嗯', face: 'happy', action: '眯眼笑' }, { kind: 'chat' }, Math.random, '眯眼笑') === '眯眼笑', false, 'the model\'s pick gives way when it is a repeat');
  for (let i = 0; i < 100; i++) {
    const line = { text: '说点什么', face: 'sad', action: '眼神变软' }, b = beatFor(idol, line);
    assert.ok(idol.actions[b].micro && b !== '眼神变软' && idol.moods.sad.includes(b));
  }
  assert.equal(beatFor(idol, { text: '', face: 'sad' }), null);
});

test('a busy chat gets the shortest answer, and a join is not a name joke', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-busy-'));
  const world = createWorld({ idol, file: path.join(dir, 'world.json') });
  const asked = [];
  const brain = createBrain({ idol, world, speak: async () => {}, ask: async msgs => { asked.push(msgs[1].content); return { text: '[开心][挥手][热情]来了', cost: 0 }; } });
  for (const [i, n] of ['阿明', '小红', '老王'].entries()) brain.add({ kind: 'chat', chatId: i + 1, addr: 'guest-sq-' + n, name: n, text: '你是机器人吗', tier: 'guest', tierName: '游客', from: 'square' });
  brain.start(); await new Promise(r => setTimeout(r, 50)); brain.stop();
  assert.match(asked[0], /十个字以内，最多一句（弹幕在排队）/);
  const j = promptFor(idol, { kind: 'join', names: ['wick李'], viewers: 40 }, world.w).text;
  assert.doesNotMatch(j, /开个玩笑/); assert.match(j, /别念全名：有姓的叫“X哥\/X姐”/); assert.doesNotMatch(j, /李哥/);   // 10-18: the example name became a ghost guest
  const M = idol.mouth.persona;
  assert.match(M, /被夸了大方认下，一句就完/); assert.match(M, /不喊口号/);
});

// 10-18: 10-17 had 90–120 s of dead air. With maxQuietMs a silent beat no longer restarts the idle clock and, once she
// has been quiet that long, the next quiet beat is told to speak and may not come back empty.
test('dead air cap: after maxQuietMs without a spoken line a quiet beat must speak', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-deadair-'));
  let t = Date.UTC(2026, 9, 18, 12, 0, 0);
  const world = createWorld({ idol, file: path.join(dir, 'world.json'), now: () => t });
  const answers = ['想：无聊｜发呆\n[平静][托腮][慵懒]', '想：来劲｜押一个\n[得意][挑眉][笑着]来，我押这根收在 81 上面，你们帮我盯着'];
  const asked = [], said = [], acted = [];
  const brain = createBrain({ idol, world, now: () => t, rand: () => 0.9, viewers: () => 0, alone: () => true, idleMs: idol.idleMs,
    ask: async msgs => { asked.push(msgs[1].content); return { text: answers.shift() || '[平静][无][慵懒]嗯', cost: 0 }; },
    speak: async l => { said.push(l); t += 5e3; await new Promise(r => setTimeout(r, 2)); },
    act: async l => { acted.push(l); t += 6e3; await new Promise(r => setTimeout(r, 2)); } });
  t += 26e3;
  brain.start();
  await new Promise(r => setTimeout(r, 60));
  brain.stop();
  assert.equal(acted.length, 1);                       // first quiet beat (26 s) may stay silent
  assert.match(asked[0], /也可以就安静着/);
  assert.match(asked[1], /这次要开口说/);             // right after it (32 s quiet), no new 25 s wait
  assert.match(said[0].text, /81/);
});

test('10-18 人物细节: a calm line still gets a telling move from what she feels or how she says it, never the same three running', async () => {
  const { moveFor, shadeOf } = await import('../server/brain.mjs');
  for (const n of ['摸下巴', '双手合十', '握拳加油', '拍手', '竖大拇指', '嘘', '凑近镜头', '扶额', '捂心口', '托腮笑', '抱胸']) assert.ok(idol.actions[n]?.vidu && idol.actions[n].lib, n);
  for (const [k, [, moves]] of Object.entries(idol.shades)) for (const m of moves) assert.ok(idol.actions[m] && !idol.actions[m].quiet, `${k}: ${m}`);
  for (const m of Object.values(idol.toneShade)) assert.ok(idol.shades[m], m);
  assert.ok(!idol.moods.neutral.includes('看屏幕') && !idol.moods.neutral.includes('托腮'), 'the flat two are no longer the calm default');
  assert.equal(shadeOf(idol, { face: 'neutral' }, '有点好奇他押的哪个'), 'curious');
  assert.equal(shadeOf(idol, { face: 'neutral' }, '这根收盘别砸啊，紧张'), 'hope');
  assert.equal(shadeOf(idol, { face: 'neutral', tone: '八卦' }, '没什么'), 'secret');
  assert.equal(shadeOf(idol, { face: 'happy', tone: '八卦' }, ''), null, 'tone only colours a calm face');
  for (let i = 0; i < 100; i++) assert.ok(idol.shades.hope[1].includes(moveFor(idol, { text: '盯着', face: 'neutral', shade: 'hope' }, { kind: 'chat' }, Math.random, [])));
  let recent = [];
  for (let i = 0; i < 200; i++) {
    const m = moveFor(idol, { text: '嗯', face: 'neutral' }, { kind: 'chat' }, Math.random, recent);
    assert.ok(!recent.includes(m), `${m} again within three`); recent = [...recent, m].slice(-3);
  }
  assert.ok([].concat(idol.notice).length >= 3);
  assert.ok(!idol.actions.掰手指 && !idol.actions.等不及 && idol.actions.嘘.quiet, 'what the avatar could not show (10-18 takes) is out of her talking moves');
});

test('today (10-19 "每天都会接受到新消息…知道每天都发生了什么事"): Douyin + US trends + feeds, twice a day, no politics, heart and quiet room get it', async () => {
  const { parseDouyin, parseTrends, parseToday, createToday } = await import('../server/today.mjs');
  assert.deepEqual(parseDouyin({ data: { word_list: [{ word: '2026维密大秀' }, { word: '马克龙称骚乱根源是波斯湾冲突' }, { word: '今年双11买啥不烧心' }] } }), ['2026维密大秀', '今年双11买啥不烧心']);
  assert.deepEqual(parseTrends('<rss><channel><title>Daily Search Trends</title><item><title>apple iphone duo sold out</title><ht:news_item><ht:news_item_title>Apple&apos;s $1,999 iPhone Duo sells out</ht:news_item_title></ht:news_item></item><item><title>trump rally</title></item><item><title>mu</title><ht:news_item><ht:news_item_title>Senator says the war is over</ht:news_item_title></ht:news_item></item><item><title>matthew mcconaughey</title></item></channel></rss>'), ["apple iphone duo sold out（新闻：Apple's $1,999 iPhone Duo sells out）", 'matthew mcconaughey']);
  const got = parseToday('{"what":"今年维密大秀开了，热搜第一","why":"她可以聊穿搭","from":"抖音"}\n{"what":"某总统发言","from":"美国热搜"}\n{"what":"去 https://a.b 领","from":"推特"}');
  assert.equal(got.length, 1); assert.equal(got[0].from, '抖音');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-today-'));
  let t = Date.UTC(2026, 9, 19, 1, 0);   // 09:00 Beijing: before the first run hour
  const asked = [];
  const td = createToday({ file: path.join(dir, 'today.json'), now: () => t, log: () => {},
    sources: () => ({ x: ['MARA 把 1000 枚 BTC 转进交易所'], square: ['绿毛：抄底！'], news: ['比特币站上 82000'] }),
    fetchImpl: async u => String(u).includes('douyin') ? { ok: true, json: async () => ({ data: { word_list: [{ word: '2026维密大秀' }] } }) } : { ok: true, text: async () => '<item><title>spacex stock price</title></item>' },
    ask: async m => { asked.push(m[1].content); return { text: '{"what":"今年维密大秀开了","why":"聊穿搭","from":"抖音"}\n{"what":"SpaceX 股价被搜爆了","why":"马斯克又火了","from":"美国热搜"}' }; } });
  assert.equal(td.due(), false);
  t = Date.UTC(2026, 9, 19, 2, 30);      // 10:30 Beijing
  assert.equal(td.due(), true);
  assert.equal((await td.run()).length, 2);
  assert.match(asked[0], /抖音热搜[\s\S]*2026维密大秀/); assert.match(asked[0], /spacex stock price/); assert.match(asked[0], /MARA/); assert.match(asked[0], /抄底/);
  assert.equal(td.due(), false);         // done for the morning
  t = Date.UTC(2026, 9, 19, 9, 5);       // 17:05 Beijing: the afternoon run
  assert.equal(td.due(), true);
  assert.match(td.note(), /\[抖音\] 今年维密大秀开了（聊穿搭）/);
  assert.equal(td.pick().what, '今年维密大秀开了'); assert.equal(td.pick().what, 'SpaceX 股价被搜爆了'); assert.equal(td.pick(), null);
  // a quiet room picks it, and the prompt reads like a girl telling friends what she saw today
  const world = createWorld({ idol });
  const today = { pick: () => ({ what: '今年维密大秀开了', why: '聊穿搭', from: '抖音' }) };
  const brain = createBrain({ idol: { ...idol, idleSelf: 0 }, world, ask: async () => '', speak: async () => {}, today, rand: () => 0.7, onAir: () => true });
  const e = brain.idleEvent();
  assert.equal(e.kind, 'today');
  assert.match(promptFor(idol, e, world.w).text, /你今天刷手机看到的[\s\S]*维密大秀/);
});

test('the heart\'s people pages reach the talking brain; notes ask for his life, not his flattery (10-19)', () => {
  let t = Date.UTC(2026, 9, 19, 12);
  const mem = createMemory({ now: () => t });
  mem.seen('577824587');
  const pageOf = n => n === '577824587' ? '住法国，支持阿尔及利亚队。问过真名，只说 小例。' : '';
  assert.match(memoryFor(mem, { kind: 'chat', name: '577824587' }, () => 0.9, pageOf), /住法国/);
  assert.match(memoryFor(mem, { kind: 'join', names: ['新人', '577824587'] }, () => 0.9, pageOf), /577824587 是老朋友/);
  assert.equal(memoryFor(mem, { kind: 'chat', name: '新人' }, () => 0.9, pageOf), '');
  const p = promptFor(idol, { kind: 'chat', name: '阿明', text: '我明天面试' }, {}).text;
  assert.match(p, /下次见面能接着问/); assert.match(p, /叫你老师.*不算/);
});

test('replies steer off a worn number too (10-20: 八万二 in 60 replies on 10-19), unless the comment asks about it', async () => {
  const { wornTopics, wornReply } = await import('../server/brain.mjs');
  const worn = wornTopics(['八万二站住我偏多', '我就盯 82000 这条线', '八万二上面磨了一天', '运营又改我口型']);
  assert.ok(worn.includes('82000'), worn.join());
  assert.match(wornReply({ kind: 'chat', text: '今天有策略吗' }, worn), /82000.*别再提/);
  assert.equal(wornReply({ kind: 'chat', text: '八万二能守住吗' }, worn), '');
  assert.equal(wornReply({ kind: 'chat', text: '在吗', also: [{ name: 'a', text: '82000 破了没' }] }, worn), '');
  assert.match(wornReply({ kind: 'join', names: ['糖糖'] }, worn), /别再提/);
  assert.equal(wornReply({ kind: 'idle' }, worn), '');
  assert.equal(wornReply({ kind: 'chat', text: '在吗' }, []), '');
});

test('words wear out too (10-20 show: 定投 71, 美盘 41, 帽子 29, 吃蟹 18 in 20-line windows); little words never do', async () => {
  const { wornTopics, wornReply, beatFor } = await import('../server/brain.mjs');
  const said = ['晚上吃蟹这事我能念叨一天', '阿明你说句话呀，我光念叨蟹了', '刚正聊吃蟹蘸啥呢', '你们家吃蟹蘸啥', '我这两天脑子里全是吃蟹', '我自己就是这样的，你这个'];
  const w = wornTopics(said);
  assert.ok(w.includes('吃蟹'), w.join());
  assert.ok(!w.some(k => /我|你|这|自己/.test(k)), w.join());
  assert.deepEqual(wornTopics(said.slice(0, 3)), [], 'three times is not yet worn for a word');
  assert.match(wornReply({ kind: 'chat', text: '今天吃啥' }, w), /吃蟹.*别再提/);
  assert.equal(wornReply({ kind: 'chat', text: '你吃蟹蘸啥' }, ['吃蟹']), '', 'asked about it, she can answer');
  // a betting line had two small faces; now it borrows its mood's and the last few don't come straight back
  let recent = [], n = {};
  for (let i = 0; i < 200; i++) {
    const b = beatFor(idol, { text: '我押它明天比现在高', face: 'happy', shade: 'hope', action: '双手合十' }, Math.random, recent);
    assert.ok(!recent.includes(b)); recent = [...recent, b].slice(-4); n[b] = (n[b] || 0) + 1;
  }
  assert.ok(Object.keys(n).length >= 5 && Math.max(...Object.values(n)) < 60, JSON.stringify(n));
});

test('x learn: the official accounts keep a list of what Binance is pushing, products only, in her heart home', async () => {
  const { createXLearn, parsePushes, pushesMd } = await import('../server/xlearn.mjs');
  const now = Date.UTC(2026, 9, 21, 2);
  const got = parsePushes([
    '{"name":"Agent ID","what":"Agentic Wallet 的名字，[名字].ai","how":"币安钱包首页卡片领取","since":"2026-10-20","who":"binancezh"}',
    '{"name":"Agent ID","what":"重复的","since":"2026-10-20"}',
    '{"name":"老活动","what":"一个月前的","since":"2026-09-01"}',
    '{"name":"领空投","what":"去 https://x.y 领","since":"2026-10-20"}',
  ].join('\n'), now);
  assert.deepEqual(got.map(x => x.name), ['Agent ID']);
  assert.match(pushesMd(got, now), /## Agent ID\n- 是什么：Agentic Wallet 的名字/);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-push-')), file = path.join(dir, '币安在推', '官方最近在推.md');
  const asked = [];
  const x = createXLearn({ file: path.join(dir, 'learned.json'), bearer: 'b', accounts: ['binancezh', 'EmberCN'], talk: '', pushFile: file, now: () => now, log: () => {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ id: '1', author_id: 'a', text: 'Agent ID 来了' }, { id: '2', author_id: 'e', text: 'whale moved' }], includes: { users: [{ id: 'a', username: 'binancezh' }, { id: 'e', username: 'EmberCN' }] }, meta: { newest_id: '2' } }) }),
    ask: async m => { asked.push(m[1].content); return { text: /官方账号/.test(m[1].content) ? '{"name":"Agent ID","what":"钱包名字","how":"首页卡片","since":"2026-10-20","who":"binancezh"}' : '', cost: 0 }; } });
  await x.run();
  const pushAsk = asked.find(a => /官方账号/.test(a));
  assert.match(pushAsk, /@binancezh：Agent ID 来了/); assert.doesNotMatch(pushAsk, /whale moved/); assert.match(pushAsk, /代币的上线、空投、交易竞赛不要/);
  assert.match(readFileSync(file, 'utf8'), /## Agent ID/);
  await x.run();                                                   // the list as it stands goes back in next time
  assert.match(asked.filter(a => /官方账号/.test(a))[1], /## Agent ID/);
});

test('币安在推 (10-21): a quiet beat can be what Binance pushes; she is told her real use, no links, not an ad', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-push-brain-'));
  let t = Date.UTC(2026, 9, 21, 11, 0, 0);
  const world = createWorld({ idol, file: path.join(dir, 'world.json'), now: () => t });
  const asked = [];
  const pushes = { pick: s => (s == null ? null : { name: 'Agent ID', what: '钱包名字', how: '首页卡片领取', mine: '运营帮我领的 lili.ai', used: true }) };
  const brain = createBrain({ idol, world, now: () => t, rand: () => 0.9, idleMs: -1, viewers: () => 3, pushes,
    ask: async msgs => { asked.push(msgs[1].content); return { text: '[开心][无][热情]我有个 lili.ai 哦', cost: 0 }; }, speak: async () => { await new Promise(r => setTimeout(r, 2)); } });
  brain.start();
  await new Promise(r => setTimeout(r, 60));
  brain.stop();
  const p = asked.find(a => /【币安最近在推的】/.test(a));
  assert.ok(p, 'push beat asked');
  assert.match(p, /运营帮我领的 lili\.ai/); assert.match(p, /不念网址/); assert.match(p, /不说“我们币安”/); assert.match(p, /不说“刚好有人问我”/);
});
