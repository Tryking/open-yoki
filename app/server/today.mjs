// What happened today, like a normal person who scrolls her phone: a host who knows what everyone is talking about
// sounds alive. Twice a day the server reads what everyone is looking at: Douyin's hot search list, Google's US daily
// trends (TikTok's own list needs a login past the top 3; Google is the stand-in for the English-speaking side), plus whatever the X / Square / news feeds
// already hold. The model boils it down to about ten plain-words items: what happened, and why people care.
// The heart gets the list in its day (she knows what is going on when someone brings it up), and a quiet room can
// pick one, as 'today' (她刷到的热搜). Stored in <DATA_DIR>/today.json.
import fs from 'node:fs';

export const DOUYIN_URL = 'https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1';
export const GTRENDS_URL = 'https://trends.google.com/trending/rss?geo=US';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
// Same line as news.mjs: she does not do politics, wars, disasters or crime.
const AVOID = /政治|外长|外交|总统|总理|首相|议会|国会|选举|大选|制裁|战争|军事|导弹|袭击|冲突|停火|骚乱|抗议|示威|以色列|伊朗|乌克兰|俄罗斯|朝鲜|台湾|政府|白宫|特朗普|川普|拜登|普京|习近平|中纪委|打虎|落马|关税|恐怖|枪击|死亡|遇难|身亡|地震|事故|election|senator|president|trump|biden|\bwar\b|shooting|killed|\bdead\b/i;

export function parseDouyin(j, most = 20) {
  return (j?.data?.word_list || []).map(x => String(x?.word || '').trim()).filter(w => w && !AVOID.test(w)).slice(0, most);
}

// Each trend is a search term plus the news headlines Google ties to it; the headline is what keeps the model from
// guessing what a bare term like "mu" is about (from a bare term alone the model makes up a story).
export function parseTrends(xml, most = 15) {
  const out = [];
  const un = t => t.replace(/&amp;/g, '&').replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"').trim();
  for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const t = un(m[1].match(/<title>([^<]+)<\/title>/)?.[1] || '');
    const head = un(m[1].match(/<ht:news_item_title>([^<]+)<\/ht:news_item_title>/)?.[1] || '');
    if (!t || AVOID.test(t + ' ' + head)) continue;
    out.push(head ? `${t}（新闻：${head.slice(0, 120)}）` : t);
  }
  return out.slice(0, most);
}

export function todayPrompt({ douyin = [], trends = [], x = [], square = [], news = [] }) {
  const part = (title, list) => list.length ? `【${title}】\n${list.map(s => '- ' + s).join('\n')}` : '';
  return [
    { role: 'system', content: '你帮一个币圈主播整理“今天发生了什么”。她是个正常的年轻人，每天刷抖音、推特、币安广场，知道大家在聊什么。只从给你的材料里整理，不编。' },
    { role: 'user', content: `今天各处的热门：\n\n${[part('抖音热搜', douyin), part('美国谷歌热搜（英文）', trends), part('推特币圈', x), part('币安广场热帖', square), part('币圈快讯', news)].filter(Boolean).join('\n\n')}\n\n挑出今天最值得知道的 10 件左右，生活娱乐和币圈都要有（抖音、美国热搜至少各挑 2 件）。不要政治、战争、灾难、犯罪、死人的事，不要广告。英文的翻成中文大白话，人名和项目名照原样。美国热搜只按括号里的新闻标题说，没有新闻标题、光一个词看不懂的就跳过，别瞎猜。每件输出一行 JSON，不要别的字：{"what":"一句大白话说清发生了什么，40 字以内","why":"大家为什么在聊，或者她可以怎么接，20 字以内","from":"抖音/美国热搜/推特/广场/快讯"}` },
  ];
}

export function parseToday(text, now = Date.now(), most = 12) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/\{.*\}/);
    if (!m) continue;
    try {
      const j = JSON.parse(m[0]);
      const what = String(j.what || '').trim().slice(0, 60);
      if (!what || AVOID.test(what) || /0x[0-9a-fA-F]{6,}|https?:\/\//.test(what)) continue;
      out.push({ id: now.toString(36) + out.length, what, why: String(j.why || '').trim().slice(0, 30), from: String(j.from || '').trim().slice(0, 8), at: now });
    } catch {}
    if (out.length >= most) break;
  }
  return out;
}

// sources: () => ({ x: [...], square: [...], news: [...] }) from the feeds that already run; hours: local hours to run.
export function createToday({ file, ask, sources = () => ({}), hours = [10, 17], tz = 8, fetchImpl = fetch, now = Date.now, log = console.log }) {
  let s = { day: '', runs: [], items: [], told: [] };
  try { s = { ...s, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  const save = () => { try { fs.writeFileSync(file + '.tmp', JSON.stringify(s)); fs.renameSync(file + '.tmp', file); } catch (e) { log('today save failed ' + e.message); } };
  const local = () => new Date(now() + tz * 3600e3);
  let timer = null, running = false;

  async function get(url, as) {
    try {
      const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Referer: 'https://www.douyin.com/', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) { log(`today: ${url.slice(8, 30)} answered ${r.status}`); return null; }
      return as === 'json' ? await r.json() : await r.text();
    } catch (e) { log(`today: ${url.slice(8, 30)} failed ${e.message}`); return null; }
  }

  async function run() {
    if (running) return [];
    running = true;
    try {
      const [dy, gt] = await Promise.all([get(DOUYIN_URL, 'json'), get(GTRENDS_URL, 'text')]);
      let more = {}; try { more = sources() || {}; } catch {}
      const input = { douyin: parseDouyin(dy), trends: parseTrends(gt), x: (more.x || []).slice(0, 8), square: (more.square || []).slice(0, 8), news: (more.news || []).slice(0, 8) };
      const day = local().toISOString().slice(0, 10);
      if (s.day !== day) { s.day = day; s.items = []; s.told = []; s.runs = []; }
      // mark the run even when it fails, so a dead source is not retried every 5 minutes
      s.runs = [...s.runs, local().toISOString().slice(11, 16)].slice(-6);
      if (!input.douyin.length && !input.trends.length && !input.x.length && !input.square.length) { save(); log('today: nothing to read'); return []; }
      const a = await ask(todayPrompt(input), { long: true });
      const got = parseToday(a.text, now());
      if (got.length) s.items = got;
      save();
      log(`today: read douyin ${input.douyin.length}, trends ${input.trends.length}, x ${input.x.length}, square ${input.square.length}, news ${input.news.length}; kept ${got.length}`);
      return got;
    } catch (e) { log('today failed ' + e.message); save(); return []; }
    finally { running = false; }
  }

  // Due when a run hour has passed today and no run happened at or after it.
  function due() {
    const d = local(), day = d.toISOString().slice(0, 10), h = d.getUTCHours();
    const want = hours.filter(x => x <= h);
    if (!want.length) return false;
    const runs = s.day === day ? s.runs.map(r => +r.slice(0, 2)) : [];
    return !runs.some(r => r >= Math.max(...want));
  }

  function pick() {
    const it = s.items.find(x => !s.told.includes(x.what));
    if (it) { s.told = [...s.told, it.what].slice(-30); save(); }
    return it || null;
  }

  return {
    run, pick, due,
    // for the heart: the whole list, as she would remember her scrolling
    note: () => s.items.length ? s.items.map(x => `${x.from ? '[' + x.from + '] ' : ''}${x.what}${x.why ? '（' + x.why + '）' : ''}`).join('\n') : '',
    stamp: () => s.day + ' ' + (s.runs.at(-1) || ''),
    start() { if (!timer) { const tick = () => { if (due()) run(); }; tick(); timer = setInterval(tick, 5 * 60e3); timer.unref?.(); } },
    stop() { clearInterval(timer); timer = null; },
    get state() { return { day: s.day, runs: s.runs, items: s.items.length, told: s.told.length }; },
  };
}
