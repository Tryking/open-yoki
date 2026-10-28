// Futures data from CoinAnk: numbers for her, written where her heart reads; stale numbers never said.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCoinank } from '../server/coinank.mjs';

const ok = data => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });
function fake(calls = []) {
  return async (u, o) => {
    calls.push({ u, key: o.headers.apikey });
    if (u.includes('fundingRate')) return ok([{ symbol: 'BTC', cmap: { Binance: { fundingRate: 0.0001 } } }]);
    if (u.includes('realtimeAll')) return ok([{ exchangeName: 'OKX', longRatio: 0.9 }, { exchangeName: 'All', longRatio: 0.504 }]);
    if (u.includes('longshort/position')) return ok({ longShortRatio: [1.5, 1.6, 1.6783] });
    // keys mislabeled like the real thing: '1h' holds 12h, '24h' holds 4h
    if (u.includes('liquidation')) return ok({ '1h': { interval: '12h', totalTurnover: 3e7, longTurnover: 2e7, shortTurnover: 1e7 }, '24h': { interval: '4h', totalTurnover: 13690000, longTurnover: 9e6, shortTurnover: 4690000 } });
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test('coinank: one line per coin, spans from each bucket, the page in her trading notes', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-')), calls = [];
  let t = Date.parse('2026-10-24T02:00:00Z');
  const c = createCoinank({ key: 'K', dir: d, coins: ['BTC'], fetchImpl: fake(calls), now: () => t });
  assert.equal(c.note(), ''); assert.equal(c.feedLine(), null);
  await c.refresh();
  const page = fs.readFileSync(path.join(d, '合约数据.md'), 'utf8');
  assert.match(page, /^# 合约数据（CoinAnk，10:00 更新/);
  assert.match(page, /- BTC：全网主动买 50\.4%、卖 49\.6%（1 小时），币安大户多空比 1\.6783，资金费率 0\.0100%，4 小时爆仓 1369 万美元（多单 900 万美元，空单 469 万美元），12 小时爆仓 3000 万美元/);
  assert.match(c.note(), /^\n【合约数据（CoinAnk 10:00）】BTC：/);
  assert.match(c.feedLine(), /（细节在 交易资料\/合约数据\.md）$/);
  for (const x of calls) { assert.equal(x.key, 'K'); assert.doesNotMatch(x.u, /K$|apikey/); }
  t += 21 * 60e3;
  assert.equal(c.note(), ''); assert.equal(c.feedLine(), null);
});

test('coinank: a failing endpoint leaves the others; nothing at all leaves the old page alone', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-')), logs = [];
  const base = fake();
  const c = createCoinank({ key: 'K', dir: d, coins: ['BTC', 'ETH'], log: m => logs.push(m),
    fetchImpl: async (u, o) => u.includes('ETH') && u.includes('liquidation') ? { ok: false, status: 500, json: async () => ({ success: false, msg: 'boom' }) } : base(u, o) });
  const r = await c.refresh();
  assert.deepEqual(r.rows.map(x => x.coin), ['BTC']); assert.match(logs.join(), /boom/);
  const down = createCoinank({ key: 'K', dir: d, fetchImpl: async () => { throw new Error('offline'); }, log: () => {} });
  assert.equal(await down.refresh(), null);
  assert.match(fs.readFileSync(path.join(d, '合约数据.md'), 'utf8'), /BTC/);
});

test('coinank: wired in the server only with the key', () => {
  const src = fs.readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');
  assert.match(src, /env\.COINANK_API_KEY && env\.HEART_HOME \? createCoinank\(/);
  assert.match(src, /coinank\?\.feedLine\(\)/);
});
