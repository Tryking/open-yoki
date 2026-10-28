// What the host sees of the market: every coin Binance trades, from three public boards — spot (every USDT pair), USDT
// perpetuals, and Binance Alpha (the on-chain list, many BSC memes). From a US server api.binance.com and
// fapi.binance.com answer 451; data-api.binance.vision (spot) and www.binance.com (perps, Alpha) answer. Spot prices win when a
// coin is on more than one board. She gets the majors, the movers on each board, any coin a viewer names, and a nudge
// when a major jumps within minutes. Her daily call (看盘本) is settled against these prices.
export const SOURCES = {
  spot: 'https://data-api.binance.vision/api/v3/ticker/24hr',
  perp: 'https://www.binance.com/fapi/v1/ticker/24hr',
  alpha: 'https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list',
};
// Hourly candles for the coin on her 16:9 card (spot pairs only; the same host as spot answers from a US server).
export const KLINES = 'https://data-api.binance.vision/api/v3/klines';
export const BOARD_NAME = { spot: '现货', perp: '合约', alpha: 'Alpha' };
export const MAJORS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE'];
const NOT_COINS = new Set(['USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'BUSD', 'USDE', 'USD1', 'XUSD', 'RLUSD', 'RWUSD', 'BFUSD', 'U', 'EUR', 'EURI', 'AEUR', 'TRY', 'BRL', 'WBTC', 'WBETH', 'BETH', 'XAUT', 'PAXG']);
// Tokenised US stocks trade as <ticker>B (NVDAB, QQQB…); she hosts crypto, so they stay out of the movers.
const STOCKS = new Set(['NVDA', 'INTC', 'SNDK', 'QQQ', 'SOXL', 'MSTR', 'CRCL', 'SKHY', 'SPCX', 'SNXX', 'TSLA', 'AAPL', 'COIN', 'SPY', 'HOOD', 'GOOGL', 'AMZN', 'META', 'MSFT', 'AMD', 'NFLX', 'PLTR']);
export const ALIASES = {
  比特币: 'BTC', 大饼: 'BTC', 以太坊: 'ETH', 以太: 'ETH', 姨太: 'ETH', 二饼: 'ETH', 币安币: 'BNB', 索拉纳: 'SOL',
  瑞波: 'XRP', 狗狗币: 'DOGE', 狗狗: 'DOGE', 狗币: 'DOGE', 艾达: 'ADA', 波场: 'TRX', 莱特币: 'LTC', 柚子: 'EOS', 链克: 'LINK',
  bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', ripple: 'XRP', dogecoin: 'DOGE',
};
// Lower-case words that are also tickers; in lower case they are English, in capitals or with $ they are coins.
const WORDS = new Set(['NOT', 'ME', 'IO', 'ID', 'THE', 'ONE', 'FOR', 'AI', 'ACT', 'GAS', 'PEOPLE', 'MOVE', 'FUN', 'HOOK', 'BANANA', 'S', 'W', 'U', 'OG', 'ON', 'IN', 'UP', 'OK', 'BAT', 'CAT', 'DOG', 'BIO', 'HIGH', 'TRUMP', 'MAGIC', 'COOKIE', 'PUMP', 'HOME', 'LISTA', 'NIL', 'KITE', 'SIGN', 'RARE', 'ZK', 'HYPE', 'WAL', 'AVA', 'OP', 'RLC', 'AMP', 'ICP', 'NEAR', 'LINK', 'TON', 'DOT', 'UNI', 'CAKE', 'ATOM', 'BLUR', 'RENDER', 'POL', 'SAND', 'MEME', 'BABY', 'SUPER', 'POWER', 'FLOW', 'DATA', 'RED', 'WIN', 'HOT', 'KEY', 'SUN', 'LIT', 'MASK', 'CITY', 'FORM', 'LAYER', 'SHELL', 'TURBO', 'PIXEL', 'PORTAL', 'EDU', 'ACE', 'COW', 'JOE', 'RAY', 'BAR', 'HARD', 'DENT', 'INIT', 'AIR', 'YOU', 'HI', 'GO', 'NO', 'YES', 'LOL', 'WTF', 'GM', 'GN', 'BULL', 'BEAR', 'MOON', 'APE', 'PEPE2']);
const MOVE = { BTC: 1.5, ETH: 2, BNB: 2, SOL: 2.5, XRP: 2.5, DOGE: 3 };   // % within moveMs that counts as a jump
const MIN_VOL = { spot: 5e6, perp: 2e7, alpha: 1e6 };   // only liquid coins count as movers or as lower-case mentions

export const price = n => {
  if (!Number.isFinite(n)) return '?';
  if (n >= 1000) return String(Math.round(n));
  if (n >= 100) return n.toFixed(1).replace(/\.0$/, '');
  if (n >= 1) return n.toFixed(2).replace(/0$/, '').replace(/\.0?$/, '');
  return String(Number(n.toPrecision(3)));
};
export const pct = n => (n > 0 ? '+' : '') + n.toFixed(1) + '%';
const usdShort = n => n >= 1e8 ? (n / 1e8).toFixed(1) + ' 亿美元' : n >= 1e4 ? Math.round(n / 1e4) + ' 万美元' : Math.round(n) + ' 美元';

// One board's raw list → Map(coin → { coin, price, chg, vol, chain? }).
export function parseBoard(key, raw) {
  const out = new Map();
  const put = c => { if (c.price > 0 && c.coin && !NOT_COINS.has(c.coin) && !(c.coin.endsWith('B') && STOCKS.has(c.coin.slice(0, -1)))) { const had = out.get(c.coin); if (!had || had.vol < c.vol) out.set(c.coin, c); } };
  if (key === 'alpha') {
    for (const t of raw?.data || []) {
      if (t.offline || t.fullyDelisted || t.offsell) continue;
      put({ coin: String(t.symbol || '').trim(), price: +t.price, chg: +t.percentChange24h || 0, vol: +t.volume24h || 0, chain: t.chainName || '' });
    }
    return out;
  }
  for (const t of raw || []) {
    if (!t.symbol?.endsWith('USDT') || !(+t.count > 0)) continue;
    let coin = t.symbol.slice(0, -4), k = 1;
    if (key === 'perp') { const m = coin.match(/^(1000000|1M|10000|1000)(.+)$/); if (m) { k = m[1] === '1M' ? 1e6 : +m[1]; coin = m[2]; } }   // 1000PEPE = 1000 PEPE
    put({ coin, price: +t.lastPrice / k, chg: +t.priceChangePercent || 0, vol: +t.quoteVolume || 0 });
  }
  return out;
}

export function createMarket({ fetchImpl = fetch, now = () => Date.now(), urls = SOURCES, klinesUrl = KLINES, everyMs = 60e3, alphaEveryMs = 120e3, moveMs = 5 * 60e3, gapMs = 10 * 60e3, staleMs = 10 * 60e3, onMove = () => {}, onTick = () => {}, log = console } = {}) {
  const boards = { spot: { coins: new Map(), at: 0, fails: 0 }, perp: { coins: new Map(), at: 0, fails: 0 }, alpha: { coins: new Map(), at: 0, fails: 0 } };
  const hist = [], lastMove = {};
  let timers = [];

  // Feed one board (tests call this directly). Only spot drives the majors, their jumps and the 看盘本 settling.
  function take(raw, key = 'spot') {
    const coins = parseBoard(key, raw);
    if (!coins.size) throw new Error('no tickers on ' + key);
    const b = boards[key];
    b.coins = coins; b.at = now();
    if (key !== 'spot') return;
    const at = b.at;
    hist.push({ at, p: Object.fromEntries(MAJORS.filter(c => coins.has(c)).map(c => [c, coins.get(c).price])) });
    while (hist.length && at - hist[0].at > moveMs + everyMs) hist.shift();
    for (const c of MAJORS) {
      const then = hist.find(h => at - h.at <= moveMs && h.p[c])?.p[c], p = coins.get(c)?.price;
      if (!then || !p || at - (lastMove[c] || 0) < gapMs) continue;
      const d = (p / then - 1) * 100;
      if (Math.abs(d) >= MOVE[c]) { lastMove[c] = at; onMove({ kind: 'market', coin: c, pct: d, price: price(p), minutes: Math.round(moveMs / 60e3) }); }
    }
    onTick();
  }
  async function poll(key = 'spot') {
    const b = boards[key];
    try {
      const r = await fetchImpl(urls[key], { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(key + ' ' + r.status);
      take(await r.json(), key);
      b.fails = 0;
    } catch (err) { if (++b.fails === 3) log.warn?.(`market ${key} down:`, String(err.message || err).slice(0, 120)); }
  }

  const live = key => boards[key].coins.size && now() - boards[key].at < staleMs;
  const fresh = () => !!live('spot');
  const ORDER = ['spot', 'perp', 'alpha'];
  // A coin as she sees it: the first board that has it sets the price; `on` lists every board that trades it.
  function get(c) {
    const coin = String(c || '').trim(), up = coin.toUpperCase();
    let hit = null; const on = [];
    for (const k of ORDER) {
      if (!live(k)) continue;
      const x = boards[k].coins.get(up) || boards[k].coins.get(coin);
      if (x) { on.push(k); hit ||= { ...x, board: k }; }
    }
    return hit ? { ...hit, on } : null;
  }
  const has = c => !!get(c);
  const counts = () => {
    const all = new Set();
    const n = {};
    for (const k of ORDER) { n[k] = live(k) ? boards[k].coins.size : 0; if (live(k)) for (const c of boards[k].coins.keys()) all.add(c); }
    return { ...n, all: all.size };
  };
  const majors = () => (fresh() ? MAJORS.map(c => boards.spot.coins.get(c)).filter(Boolean) : []);
  // The biggest movers on one board among its liquid coins; perps and Alpha only list coins spot does not have.
  function movers(key = 'spot', n = 3) {
    if (!live(key)) return { up: [], down: [] };
    let list = [...boards[key].coins.values()].filter(c => c.vol >= MIN_VOL[key]);
    if (key !== 'spot') list = list.filter(c => !boards.spot.coins.has(c.coin));
    list.sort((a, b) => b.chg - a.chg);
    const bar = key === 'spot' ? 3 : 10;   // a quiet night has no movers
    return { up: list.slice(0, n).filter(c => c.chg >= bar), down: list.slice(-n).reverse().filter(c => c.chg <= -bar) };
  }
  // Coins a chat line names: Chinese nicknames, $TICKER, a capitalised ticker, a liquid ticker in lower case, or the
  // name of a Chinese-named coin (Alpha has many).
  function mentioned(text) {
    const s = String(text || ''), found = new Set();
    for (const [k, c] of Object.entries(ALIASES)) if (s.toLowerCase().includes(k.toLowerCase())) found.add(c);
    for (const m of s.matchAll(/\$?[A-Za-z][A-Za-z0-9]{0,11}/g)) {
      const w = m[0], up = w.replace('$', '').toUpperCase(), c = get(up);
      if (!c) continue;
      const loud = w.startsWith('$') || (w === w.toUpperCase() && up.length >= 2);
      const quiet = MAJORS.includes(up) || (!WORDS.has(up) && up.length >= 3 && c.vol >= MIN_VOL[c.board]);
      if (loud || quiet) found.add(c.coin);
    }
    if (/[^\x00-\x7f]/.test(s)) {
      for (const k of ORDER) {
        if (!live(k)) continue;
        for (const c of boards[k].coins.keys()) if (c.length >= 2 && /[^\x00-\x7f]/.test(c) && s.includes(c)) found.add(c);
      }
    }
    return [...found].slice(0, 3);
  }

  const where = c => c.on.map(k => k === 'alpha' && c.chain ? `Alpha·${c.chain}` : BOARD_NAME[k]).join('/');
  const one = c => `${c.coin} ${price(c.price)} 美元（24 小时 ${pct(c.chg)}）`;
  const move = (c, k) => `${c.coin} ${pct(c.chg)}${k === 'alpha' && c.chain ? `（${c.chain}）` : ''}`;
  // The block that goes into her prompt. When spot is stale she is told she can't see the board.
  function lineFor(e = {}) {
    if (!fresh()) return '\n【行情】行情面板现在连不上，你看不到价格，别编数字。';
    const n = counts();
    const bits = [`【行情（币安，刚刚更新；你能查到币安上 ${n.all} 个币：现货 ${n.spot}、合约 ${n.perp}、Alpha ${n.alpha}）】${majors().map(one).join('；')}`];
    const s = movers('spot');
    if (s.up.length) bits.push(`现货 24 小时涨得最猛：${s.up.map(c => move(c, 'spot')).join('、')}`);
    if (s.down.length) bits.push(`现货跌得最狠：${s.down.map(c => move(c, 'spot')).join('、')}`);
    const named = new Set();
    for (const k of ['alpha', 'perp']) {
      const m = movers(k, 4);
      m.up = m.up.filter(c => !named.has(c.coin)).slice(0, 2);   // an Alpha coin with a perp shows once
      m.up.forEach(c => named.add(c.coin));
      if (m.up.length) bits.push(`${BOARD_NAME[k]}里涨得最猛：${m.up.map(c => move(c, k)).join('、')}`);
    }
    let out = '\n' + bits.join('。') + '。';
    if (e.kind === 'chat') {
      const said = mentioned(e.text).filter(c => !MAJORS.includes(c)).map(get).filter(Boolean);
      if (said.length) out += `\n他提到的币：${said.map(c => `${one(c)}，在${where(c)}，24 小时成交 ${usdShort(c.vol)}`).join('；')}。只用这些数字，别念合约地址。`;
    }
    return out;
  }
  // The last day of hourly candles for one spot coin, cached 5 min; [] for coins spot does not list.
  const kcache = new Map();
  async function klines(coin) {
    const c = get(coin);
    if (!c?.on?.includes('spot')) return [];
    const hit = kcache.get(c.coin);
    if (hit && now() - hit.at < 5 * 60e3) return hit.k;
    const r = await fetchImpl(`${klinesUrl}?symbol=${encodeURIComponent(c.coin)}USDT&interval=1h&limit=24`);
    if (!r.ok) throw new Error('klines ' + r.status);
    const k = (await r.json()).map(x => ({ o: +x[1], h: +x[2], l: +x[3], c: +x[4] })).filter(x => x.h > 0);
    kcache.set(c.coin, { at: now(), k });
    if (kcache.size > 50) kcache.delete(kcache.keys().next().value);
    return k;
  }
  // The small board on the page.
  const board = () => (fresh() ? { at: boards.spot.at, majors: majors().map(c => ({ coin: c.coin, price: c.price, chg: c.chg })), count: counts() } : null);

  return {
    poll, take, get, has, counts, majors, movers, mentioned, lineFor, board, klines,
    start() {
      if (!timers.length) {
        for (const k of ['spot', 'perp']) { poll(k); timers.push(setInterval(() => poll(k), everyMs)); }
        poll('alpha'); timers.push(setInterval(() => poll('alpha'), alphaEveryMs));
      }
      return this;
    },
    stop() { timers.forEach(clearInterval); timers = []; },
    get fresh() { return fresh(); },
  };
}
