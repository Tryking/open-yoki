// What she has to talk about when nobody is chatting: the Binance Square news feed. This bapi list answers without a
// login (pageSize above 20 is refused as 参数非法) with 快讯 titles and summaries in Chinese. Only crypto items are
// kept; the feed also carries world politics and macro news, which she never brings up.
export const NEWS_URL = 'https://www.binance.com/bapi/composite/v4/friendly/pgc/feed/news/list?pageIndex=1&pageSize=20&strategy=6&tagId=0&featured=false';

const CRYPTO = /比特币|区块链|以太|币安|加密|代币|稳定币|链上|公链|空投|爆仓|合约|现货|ETF|DEX|DeFi|NFT|meme|Meme|迷因|钱包|挖矿|矿工|交易所|上线|下架|主网|质押|BTC|ETH|BNB|SOL|XRP|DOGE|USDT|USDC|Binance|Coinbase|Solana|Aave|Uniswap|CZ|赵长鹏|何一|Web3|layer|Layer|L2|RWA|AI Agent|鲸鱼|巨鲸|多单|空单|清算/;
const POLITICS = /地缘|政治|外长|外交|总统|总理|首相|议长|议会|国会|选举|大选|制裁|战争|军事|导弹|袭击|冲突|停火|以色列|伊朗|黎巴嫩|乌克兰|俄罗斯|朝鲜|台湾|中国|中共|政府|白宫|特朗普|川普|拜登|普京|习近平|关税|示威|抗议|恐怖|枪击|死亡|遇难/;

export function keepNews(v) {
  const title = String(v?.title || '').trim(), sub = String(v?.subTitle || '').replace(/\s+/g, ' ').trim();
  const all = title + ' ' + sub;
  // The crypto word has to be in the title or the summary's opening: a diesel story that mentions 现货 late is macro.
  if (!title || !CRYPTO.test(title + ' ' + sub.slice(0, 40)) || POLITICS.test(all)) return null;
  // Summaries open with "据彭博社报道，" and the like; she tells it in her own words, so the source goes.
  return { id: String(v.id), title: title.slice(0, 60), sub: sub.replace(/^据[^，,]{1,20}(报道|消息|数据)[，,]\s*/, '').slice(0, 140), at: (Number(v.date) || 0) * 1000 };
}

// Hot posts on Binance Square (bapi v9 feed-recommend; it only answers with the versioncode header). What real people there are shouting about: 抄底, 被冻卡, 行情好无聊. Ads, red packets, links and
// contract addresses are dropped; she says who posted it and reacts.
export const SQUARE_URL = 'https://www.binance.com/bapi/composite/v9/friendly/pgc/feed/feed-recommend/list';
const SPAM = /红包|邀请码|返佣|注册|领取|空投码|私信|加群|电报|telegram|t\.me|http|www\.|0x[0-9a-fA-F]{6,}/i;

export function keepPost(v) {
  const text = String(v?.content || v?.title || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[\u200b\s]+/g, ' ').trim();
  const who = String(v?.authorName || '').trim();
  if (!who || who === '币安广场' || text.length < 4 || SPAM.test(text) || POLITICS.test(text)) return null;
  return { id: String(v.id), who: who.slice(0, 16), text: text.slice(0, 100), comments: Number(v.commentCount) || 0, likes: Number(v.likeCount) || 0, at: (Number(v.date) || 0) * 1000 };
}

export function createSquareFeed({ fetchImpl = fetch, url = SQUARE_URL, everyMs = 5 * 60e3, maxAgeMs = 12 * 3600e3, now = Date.now, log = console.warn } = {}) {
  let items = [], timer = null, failed = 0;
  const told = new Set();
  async function poll() {
    try {
      const r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', lang: 'zh-CN', clienttype: 'web', versioncode: 'web' }, body: JSON.stringify({ pageIndex: 1, pageSize: 20, scene: 'web-homepage', contentIds: [] }), signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      const got = (j?.data?.vos || []).map(keepPost).filter(Boolean);
      if (got.length) items = got.concat(items.filter(x => !got.some(g => g.id === x.id))).slice(0, 80);
      failed = 0;
    } catch (e) { if (++failed === 3) log('square feed failing: ' + String(e.message || e).slice(0, 100)); }
  }
  // The busiest post she hasn't read out yet: most comments first, that is where the room on Square is.
  function pick() {
    const n = items.filter(x => !told.has(x.id) && now() - x.at < maxAgeMs).sort((a, b) => b.comments - a.comments)[0];
    if (n) told.add(n.id);
    return n || null;
  }
  return {
    poll, pick, peek: () => items.filter(x => now() - x.at < maxAgeMs),
    start() { if (!timer) { poll(); timer = setInterval(poll, everyMs); timer.unref?.(); } },
    stop() { clearInterval(timer); timer = null; },
    get count() { return items.length; },
  };
}

export function createNews({ fetchImpl = fetch, url = NEWS_URL, everyMs = 10 * 60e3, maxAgeMs = 6 * 3600e3, now = Date.now, log = console.warn } = {}) {
  let items = [], timer = null, failed = 0;
  const told = new Set();
  async function poll() {
    try {
      const r = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0', lang: 'zh-CN', clienttype: 'web' }, signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      const got = (j?.data?.vos || []).map(keepNews).filter(Boolean);
      if (got.length) items = got.concat(items.filter(x => !got.some(g => g.id === x.id))).slice(0, 60);
      failed = 0;
    } catch (e) { if (++failed === 3) log('news feed failing: ' + String(e.message || e).slice(0, 100)); }
  }
  // The newest item she hasn't told yet, a few hours old at most.
  function pick() {
    const n = items.find(x => !told.has(x.id) && now() - x.at < maxAgeMs);
    if (n) told.add(n.id);
    return n || null;
  }
  return {
    poll, pick, peek: () => items.filter(x => now() - x.at < maxAgeMs),
    start() { if (!timer) { poll(); timer = setInterval(poll, everyMs); timer.unref?.(); } },
    stop() { clearInterval(timer); timer = null; },
    get count() { return items.length; },
  };
}
