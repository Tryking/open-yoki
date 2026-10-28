// She scrolls X while she streams: every 10 minutes on air, every 8 hours off air, the server reads the new posts of
// a fixed list of crypto accounts through the X API v2 recent search (bearer = X_BEARER_TOKEN from the env; X bills
// per post read, so since_id keeps each run to posts not read before and bigPosts / roomPosts cap a run), and the model picks at most three things worth
// telling her viewers tonight: a new narrative, a new word or meme, something a big name said. She brings them up when
// the room is quiet. Stored in <DATA_DIR>/learned.json.
import fs from 'node:fs';

const SEARCH = 'https://api.x.com/2/tweets/search/recent';
const POLITICS = /政治|总统|选举|制裁|战争|关税|特朗普|川普|拜登|普京|习近平|中国政府|台湾|以色列|伊朗|乌克兰|俄罗斯/;

export function learnPrompt(posts) {
  return [
    { role: 'system', content: '你帮一个币圈深夜女主播挑今晚能跟观众聊的新东西。只从给你的推文里挑，不编。' },
    { role: 'user', content: `下面是币圈推特最近的推（有大号发的，也有普通人在聊的）：\n${posts.map(p => `${p.room ? '【大家】' : '【大号】'}@${p.who}：${p.text.replace(/\s+/g, ' ').slice(0, 280)}`).join('\n')}\n\n这些都是刚刚发的。挑出最多 2 条值得她现在在直播里聊的：新叙事、新黑话或新梗、大家都在聊的事、大佬说的话、行业大事。标【大家】的是普通人在聊的，至少挑一条这种：大家在吐槽什么、新梗新黑话、今天的情绪。不要政治，不要合约地址和链接，不要广告和抽奖。每条输出一行 JSON，不要别的字：{"what":"用中文一句大白话说清这是什么事，40 字以内","term":"里面出现的新词或新梗，没有就空字符串","who":"账号名"}` },
  ];
}

export function parseLearned(text, now = Date.now(), most = 2) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/\{.*\}/);
    if (!m) continue;
    try {
      const j = JSON.parse(m[0]);
      const what = String(j.what || '').trim().slice(0, 60);
      if (!what || POLITICS.test(what) || /0x[0-9a-fA-F]{6,}|https?:\/\//.test(what)) continue;
      out.push({ id: now.toString(36) + out.length, what, term: String(j.term || '').trim().slice(0, 16), who: String(j.who || '').replace(/^@/, '').slice(0, 24), at: now });
    } catch {}
  }
  return out.slice(0, most);
}

// Two searches a run: the big accounts' new posts, and the most relevant recent
// Chinese posts about the market from anyone, which is what the room is actually talking about.
export const TALK = '(币圈 OR 比特币 OR 币安 OR meme OR 土狗 OR 山寨 OR 合约 OR 空投) lang:zh -is:retweet -is:reply';

// What Binance itself is pushing lately, so she can help talk it up. The official accounts' new posts
// go to the model once more, together with the list as it stands, and it hands back the whole list: Binance's own
// products and features (wallet, AI, predictions, Square, trading tools), never one token's listing, airdrop or trading
// contest, which would be calling a coin. The list is a file in her heart's home; she reads it before a show and talks
// about the ones she really uses.
export const OFFICIAL = ['binance', 'binancezh', 'BinanceWallet', 'heyibinance', 'cz_binance'];
export const PUSH_DAYS = 21;

export function pushPrompt(posts, known, today) {
  return [
    { role: 'system', content: '你帮一个币安广场的 AI 女主播整理“币安官方最近在推的东西”，她会挑自己真用过的在直播里跟观众讲。只根据给你的推文和已有清单，不编。' },
    { role: 'user', content: `今天是 ${today}。已有清单（可能是空的）：\n${known || '（空）'}\n\n币安官方账号刚发的推：\n${posts.map(p => `@${p.who}：${p.text.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n')}\n\n` +
      '把已有清单和新推合在一起，回一份完整的新清单，最多 8 条，最新最重要的在前，每条一行 JSON：\n' +
      '{"name":"东西的名字，12 字内","what":"一句大白话说它是什么、对普通人有什么用","how":"普通人怎么开始用，三步内，用 App 里的说法，不写网址","since":"YYYY-MM-DD 官方第一次推它的日子","who":"哪个官方号推的"}\n' +
      '只要币安自己的产品和功能（钱包、AI、预测市场、广场、交易工具、理财借贷这类）。某个具体代币的上线、空投、交易竞赛不要，那等于喊单。节日问候、梗图、财报讨论不要。已有清单里的条目新推没提到也保留（日子照抄），除非明显已经结束。只回 JSON 行，不要别的字。' },
  ];
}

export function parsePushes(text, now = Date.now(), days = PUSH_DAYS) {
  const out = [], seen = new Set(), oldest = new Date(now - days * 864e5).toISOString().slice(0, 10);
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/\{.*\}/);
    if (!m) continue;
    try {
      const j = JSON.parse(m[0]);
      const name = String(j.name || '').trim().slice(0, 16), what = String(j.what || '').trim().slice(0, 80);
      const since = /^\d{4}-\d{2}-\d{2}$/.test(j.since) ? j.since : new Date(now).toISOString().slice(0, 10);
      if (!name || !what || seen.has(name) || since < oldest) continue;
      if (POLITICS.test(name + what) || /0x[0-9a-fA-F]{6,}|https?:\/\/|www\./.test(name + what + (j.how || ''))) continue;
      seen.add(name);
      out.push({ name, what, how: String(j.how || '').trim().slice(0, 120), since, who: String(j.who || '').replace(/^@/, '').slice(0, 24) });
    } catch {}
  }
  return out.slice(0, 8);
}

export function pushesMd(list, now = Date.now()) {
  const day = new Date(now + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  return `# 币安官方最近在推的\n\n程序从币安官方推特上替你整理的，${day}（北京时间）更新。你自己真在用的、用着什么感觉，写在 我自己在用的.md。\n\n` +
    list.map(x => `## ${x.name}\n- 是什么：${x.what}\n- 怎么开始：${x.how || '（官方没说清）'}\n- ${x.since} 起 @${x.who || 'binance'} 在推\n`).join('\n');
}

export function createXLearn({ file, bearer, accounts = [], talk = TALK, ask, onAir = () => false, airEveryMs = 10 * 60e3, everyMs = 8 * 3600e3, bigPosts = 20, roomPosts = 10, keepMs = 4 * 3600e3, pushFile = null, official = OFFICIAL, fetchImpl = fetch, now = Date.now, log = console.log }) {
  let s = { sinceId: null, roomSinceId: null, lastRun: 0, items: [], told: [], posts: 0 };
  try { s = { ...s, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  const save = () => { try { fs.writeFileSync(file + '.tmp', JSON.stringify(s)); fs.renameSync(file + '.tmp', file); } catch (e) { log('learned save failed ' + e.message); } };
  let timer = null, running = false;

  async function run() {
    if (!bearer || (!accounts.length && !talk) || running) return [];
    running = true;
    // since_id on both searches: X bills every post it returns, so each run pays only for posts newer than the last.
    async function search(query, max, extra) {
      const q = new URLSearchParams({ query, max_results: String(Math.min(100, Math.max(10, max))), 'tweet.fields': 'created_at,author_id', expansions: 'author_id', 'user.fields': 'username', ...extra });
      const r = await fetchImpl(`${SEARCH}?${q}`, { headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) { log(`x learn: X answered ${r.status}`); return null; }
      const j = await r.json();
      const users = new Map((j.includes?.users || []).map(u => [u.id, u.username]));
      return { posts: (j.data || []).map(t => ({ who: users.get(t.author_id) || '?', text: String(t.text || '') })), newest: j.meta?.newest_id };
    }
    try {
      const since = s.lastRun;
      s.lastRun = now();
      const big = accounts.length ? await search(`(${accounts.map(a => 'from:' + a).join(' OR ')}) -is:retweet -is:reply`, bigPosts, s.sinceId ? { since_id: s.sinceId } : {}) : null;
      if (big?.newest) s.sinceId = big.newest;
      // X's start_time must be at least 10 s ago and within the last 7 days.
      const start = new Date(Math.min(now() - 60e3, Math.max(since, now() - 6 * 24 * 3600e3, now() - everyMs * 2))).toISOString();
      const room = talk ? await search(talk, roomPosts, { sort_order: 'relevancy', ...(s.roomSinceId ? { since_id: s.roomSinceId } : { start_time: start }) }) : null;
      if (room?.newest) s.roomSinceId = room.newest;
      const posts = [...(big?.posts || []), ...(room?.posts || []).map(p => ({ ...p, room: true }))];
      if (!big && !room) { save(); return []; }
      s.posts += posts.length;
      let got = [];
      if (posts.length) {
        const a = await ask(learnPrompt(posts), { long: true });
        got = parseLearned(a.text, now());
      }
      const offs = official.map(o => o.toLowerCase()), mine = (big?.posts || []).filter(p => offs.includes(p.who.toLowerCase()));
      if (pushFile && mine.length) {
        let known = '';
        try { known = fs.readFileSync(pushFile, 'utf8').split('\n').filter(l => /^## |^- /.test(l)).join('\n'); } catch {}
        const a = await ask(pushPrompt(mine, known, new Date(now() + 8 * 3600e3).toISOString().slice(0, 10)), { long: true });
        const list = parsePushes(a.text, now());
        if (list.length) {
          try { fs.mkdirSync(pushFile.replace(/\/[^/]+$/, ''), { recursive: true }); fs.writeFileSync(pushFile + '.tmp', pushesMd(list, now())); fs.renameSync(pushFile + '.tmp', pushFile); }
          catch (e) { log('pushes save failed ' + e.message); }
        }
        log(`x learn: ${mine.length} official posts, pushes list ${list.length}`);
      }
      s.items = [...got, ...s.items.filter(x => now() - x.at < keepMs)].slice(0, 30);
      save();
      log(`x learn: read ${posts.length} posts, learned ${got.length}`);
      return got;
    } catch (e) { log('x learn failed: ' + String(e.message || e).slice(0, 120)); return []; }
    finally { running = false; }
  }
  // The newest thing she hasn't told yet.
  function pick() {
    const it = s.items.find(x => !s.told.includes(x.id) && now() - x.at < keepMs);
    if (it) { s.told = [it.id, ...s.told].slice(0, 60); save(); }
    return it || null;
  }
  return {
    run, pick,
    // read-only, for today.mjs: what she picked up on X lately
    peek: () => s.items.filter(x => now() - x.at < keepMs),
    start() {
      if (timer) return;
      const tick = () => { if (now() - s.lastRun > (onAir() ? airEveryMs : everyMs)) run(); };
      tick(); timer = setInterval(tick, 60e3); timer.unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
    get state() { return { lastRun: s.lastRun, items: s.items.length, posts: s.posts }; },
  };
}
