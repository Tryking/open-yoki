// The 16:9 Square feed: her thought behind each line for 心里话, the
// coin she is watching with a day of hourly candles and her own words about it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { splitInner, coinView } from '../server/square.mjs';
import { createMarket } from '../server/market.mjs';

test('square wide: the thought behind a line is its mood and first reason', () => {
  assert.deepEqual(splitInner('平静｜盘跟我一样在发呆｜先看看'), { mood: '平静', text: '盘跟我一样在发呆' });
  // a host's plan is not her 心里话 (night 1: 87 of 249 were 招呼住/别冷场)
  for (const x of ['平静｜招呼新人，顺便圆外卖的场', '有点急｜别冷场', '想笑｜接住他的梗']) assert.equal(splitInner(x), null, x);
  assert.deepEqual(splitInner('想：有点馋|没人报菜名。'), { mood: '有点馋', text: '没人报菜名' });
  assert.deepEqual(splitInner('开心'), { mood: '', text: '开心' });
  assert.equal(splitInner(''), null);
  assert.equal(splitInner(undefined), null);
});

test('square wide: her words about a coin are the sentence that names it, by code or nickname, kept short', () => {
  assert.equal(coinView('饿了。TIA 都涨三十个点了，我手痒，但追高这事儿我真不想干。好吧', ['TIA']), 'TIA 都涨三十个点了，我手痒，但追高这事儿我真不想干。');
  assert.equal(coinView('以太啊，刚回来一点', ['ETH', '以太']), '以太啊，刚回来一点');
  assert.equal(coinView('今天挺好。', ['BTC']), '');
  assert.ok(coinView('BTC ' + '涨'.repeat(40), ['BTC']).length <= 28);
});

test('square wide: hourly candles for a spot coin, cached 5 min; none for a coin spot does not list', async () => {
  let t = 1e9, calls = [];
  const kl = Array.from({ length: 24 }, (_, i) => [0, String(1 + i / 100), String(1.02 + i / 100), String(0.99 + i / 100), String(1.01 + i / 100)]);
  const fetchImpl = async u => { calls.push(u); return { ok: true, json: async () => kl }; };
  const m = createMarket({ fetchImpl, now: () => t, klinesUrl: 'https://k.test/klines' });
  m.take([{ symbol: 'TIAUSDT', lastPrice: '2.18', priceChangePercent: '31', quoteVolume: '9e7', count: 10 }], 'spot');
  m.take({ data: [{ symbol: 'ZZZ', price: '0.1', percentChange24h: '5', volume24h: '2e6' }] }, 'alpha');
  const k = await m.klines('tia');
  assert.equal(k.length, 24);
  assert.deepEqual(k[0], { o: 1, h: 1.02, l: 0.99, c: 1.01 });
  assert.match(calls[0], /symbol=TIAUSDT&interval=1h&limit=24$/);
  await m.klines('TIA'); assert.equal(calls.length, 1);
  t += 5 * 60e3 + 1; await m.klines('TIA'); assert.equal(calls.length, 2);
  assert.deepEqual(await m.klines('ZZZ'), []);
  assert.deepEqual(await m.klines('NOPE'), []);
});

test('square wide: the feed page has its two OFL fonts and the feed server serves them', () => {
  for (const f of ['kai.ttf', 'num.ttf']) assert.ok(fs.statSync(new URL('../relay/fonts/' + f, import.meta.url)).size > 10e3, f);
  const html = fs.readFileSync(new URL('../relay/square.html', import.meta.url), 'utf8');
  for (const s of ['function wide(pw)', "'/font/kai.ttf'", "'/font/num.ttf'", 'm.focus']) assert.ok(html.includes(s), s);
  const sq = fs.readFileSync(new URL('../server/square.mjs', import.meta.url), 'utf8');
  assert.match(sq, /'\/font\/kai\.ttf': 'kai\.ttf'/);
});

test('square room: a gift carries its USD price', async () => {
  const { createSquareRoom } = await import('../server/square.mjs');
  const r = createSquareRoom();
  const { thanks } = r.take({ events: [{ type: 'gift', name: '鲸鱼哥', what: '火箭', usd: 199 }, { type: 'gift', name: 'a', usd: 'x' }] });
  assert.equal(thanks[0].usd, 199); assert.equal(thanks[1].usd, null);
});
