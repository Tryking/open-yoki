// Futures market data from CoinAnk (optional, COINANK_API_KEY): how the derivatives crowd stands. Read-only.
// Every few minutes: funding, long/short (whole market and Binance big accounts), liquidations for her three coins.
// Written into 交易资料/合约数据.md for her heart; one short line for the mouth. Numbers only, no advice.
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://open-api.coinank.com/api/';
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const hours = s => ({ m: 1 / 60, h: 1, d: 24 }[String(s).slice(-1)] || 1) * parseFloat(s);
const usd = x => x >= 1e8 ? `${(x / 1e8).toFixed(2)} 亿美元` : x >= 1e4 ? `${Math.round(x / 1e4)} 万美元` : `${Math.round(x)} 美元`;

export function createCoinank({ key, dir, coins = ['BTC', 'ETH', 'BNB'], fetchImpl = fetch, now = () => Date.now(), tz = 8, log = () => {} }) {
  let last = null;   // { at, rows: [{ coin, fr, long, big, liq1h, liq24h }] }
  async function get(q) {
    const r = await fetchImpl(BASE + q, { headers: { apikey: key }, signal: AbortSignal.timeout(20e3) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.success) throw new Error(`coinank ${q.split('?')[0]} ${r.status} ${String(j.msg || j.code || '').slice(0, 60)}`);
    return j.data;
  }
  async function refresh() {
    const fr = await get('fundingRate/current?type=current').catch(err => (log(err.message), []));
    const rows = [];
    for (const coin of coins) {
      try {
        const f = fr.find(x => x.symbol === coin)?.cmap?.Binance?.fundingRate;
        const ls = (await get(`longshort/realtimeAll?baseCoin=${coin}&interval=1h`)).find(x => x.exchangeName === 'All');
        const big = await get(`longshort/position?exchange=Binance&symbol=${coin}USDT&interval=1h&endTime=${now()}&size=3`).catch(() => null);
        const liq = await get(`liquidation/allExchange/intervals?baseCoin=${coin}`);
        // the buckets' keys do not say their span ('1h' may hold 12h); each carries its own interval
        const spans = Object.values(liq || {}).filter(x => x?.interval && x.totalTurnover != null)
          .map(x => ({ span: x.interval, long: x.longTurnover, short: x.shortTurnover })).sort((a, b) => hours(a.span) - hours(b.span));
        rows.push({ coin, fr: f ?? null, long: ls?.longRatio ?? null, big: big?.longShortRatio?.at(-1) ?? null, liq: spans });
      } catch (err) { log(err.message); }
    }
    if (!rows.length) return null;
    last = { at: now(), rows };
    if (dir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, '合约数据.md'), page() + '\n'); }
    return last;
  }
  const hm = t => new Date(t + tz * 3600e3).toISOString().slice(11, 16);
  const spanName = s => s.endsWith('h') ? `${parseFloat(s)} 小时` : s.endsWith('d') ? `${parseFloat(s)} 天` : s;
  const liqLine = l => `${spanName(l.span)}爆仓 ${usd(l.long + l.short)}（多单 ${usd(l.long)}，空单 ${usd(l.short)}）`;
  function line(r) {
    return [`${r.coin}：`,
      r.long != null ? `全网主动买 ${pct(r.long)}、卖 ${pct(1 - r.long)}（1 小时）` : '',
      r.big != null ? `币安大户多空比 ${r.big}` : '',
      r.fr != null ? `资金费率 ${pct(r.fr, 4)}` : '',
      ...(r.liq || []).map(liqLine)].filter(Boolean).join('，').replace('：，', '：');
  }
  function page() {
    if (!last) return '';
    return `# 合约数据（CoinAnk，${hm(last.at)} 更新，每 5 分钟一次）\n\n` +
      '大家在合约上是怎么站队的：主动买卖是这 1 小时市价单里买和卖各占多少；大户多空比是币安持仓最大那批账户多单比空单（大于 1 = 偏多）；' +
      '资金费率为正 = 做多的付钱给做空的（多的人挤）；爆仓是被强平的仓位，多单爆得多说明刚砸过，空单爆得多说明刚拉过。数据来自 CoinAnk。\n\n' +
      last.rows.map(r => '- ' + line(r)).join('\n');
  }
  const fresh = () => !!last && now() - last.at < 20 * 60e3;
  // for her mouth: the numbers, only while fresh
  const note = () => fresh() ? `\n【合约数据（CoinAnk ${hm(last.at)}）】${last.rows.map(line).join('；')}` : '';
  // for her heart: one line
  const feedLine = () => fresh() ? `【合约数据 ${hm(last.at)}】${last.rows.map(line).join('；')}（细节在 交易资料/合约数据.md）` : null;
  return { refresh, note, feedLine, page, fresh, get last() { return last; } };
}
