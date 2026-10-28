// Memes and BGM: a host who plays her own music and weaves in memes, using popular originals. Each line she is offered a few
// memes that fit the moment to weave in, and now and then a few hot Douyin songs; if she writes [放歌:id] the hook of
// that song (12–18 s) plays under her voice on the site and on the Square feed.
//   memes: <DATA_DIR>/memes.json  [{ id, meme, mean, use, tags: ['拉盘', …], era }]
//   songs: <DATA_DIR>/bgm/index.json [{ id, title, artist, mood, dur, why }] with clips at <DATA_DIR>/bgm/<id>.m4a
import fs from 'node:fs';
import path from 'node:path';

export const LOSS = /亏|跌|砸|爆仓|归零|被套|套牢|割肉|腰斩|血亏|清零|没了|完了|惨/;
const GAIN = /涨|赚|翻倍|起飞|拉盘|暴富|发财|吃到|盈利|赢/;
const PRAISE = /美|漂亮|好看|可爱|仙女|女神|喜欢你|爱你|声音好听|夸/;
const ANGRY = /丑|滚|骗子|傻|垃圾|假的|骂/;
const FOOD = /吃|饿|宵夜|奶茶|外卖|火锅/;
const NIGHT = /睡不着|失眠|难过|累|emo|孤独|一个人|分手/;
const BYE = /晚安|睡了|下了|拜拜|走了/;

// What the moment is about, as meme tags and song moods.
export function momentOf(e) {
  const t = String(e.text || '');
  if (e.kind === 'open') return { tags: ['欢迎', '互动'], moods: ['开场欢迎'] };
  if (e.kind === 'join') return { tags: ['欢迎', '互动'], moods: ['开场欢迎', '装逼大气'] };
  if (e.kind === 'close') return { tags: ['晚安'], moods: ['晚安下播'] };
  if (e.kind === 'market') return e.pct > 0 ? { tags: ['拉盘', '赚钱', '币圈'], moods: ['拉盘嗨', '财运'] } : { tags: ['砸盘', '亏钱', '币圈'], moods: ['砸盘惨', '紧张悬疑'] };
  if (e.kind === 'request') return { tags: ['撒娇', '互动', '美'], moods: ['撒娇甜', '魔性搞笑'] };
  if (e.kind === 'chat') {
    if (LOSS.test(t)) return { tags: ['亏钱', '砸盘', '自嘲'], moods: ['砸盘惨', '深夜emo'] };
    if (GAIN.test(t)) return { tags: ['赚钱', '拉盘'], moods: ['拉盘嗨', '财运', '装逼大气'] };
    if (PRAISE.test(t)) return { tags: ['被夸', '美', '撒娇'], moods: ['装逼大气', '撒娇甜'] };
    if (ANGRY.test(t)) return { tags: ['吐槽'], moods: ['生气怼人', '魔性搞笑'] };
    if (FOOD.test(t)) return { tags: ['吃', '互动'], moods: [] };
    if (NIGHT.test(t)) return { tags: ['深夜', '打工'], moods: ['深夜emo'] };
    if (BYE.test(t)) return { tags: ['晚安'], moods: ['晚安下播'] };
    return { tags: ['互动', '吐槽', '币圈'], moods: ['魔性搞笑'] };
  }
  // idle and the rest: anything goes.
  return { tags: ['演戏', '自嘲', '币圈', '吐槽', '深夜', '吃', '美', '打工'], moods: ['魔性搞笑', '装逼大气', '撒娇甜', '紧张悬疑'] };
}

const readJson = (file, d) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return d; } };

// songGapMs: least time between two songs; songOdds: how often a moment is offered songs at all (open/close/market
// always). The same meme or song is not offered again within a show (forget() at each opening).
export function createMemes({ dir, songGapMs = 60e3, songOdds = 0.45, rand = Math.random, now = Date.now } = {}) {
  let memes = [], songs = [];
  const used = new Set(), played = new Set();
  let lastSong = 0;
  function load() {
    memes = readJson(path.join(dir, 'memes.json'), []).filter(m => m?.id && m.meme && Array.isArray(m.tags));
    songs = readJson(path.join(dir, 'bgm', 'index.json'), []).filter(s => s?.id && s.mood && fs.existsSync(path.join(dir, 'bgm', s.id + '.m4a')));
  }
  load();
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // bare: one or two memes, no example sentence. Example sentences written by a model in an older voice get copied
  // word for word until one pet phrase turns up every few lines.
  function offer(e, { bare = false } = {}) {
    const { tags, moods } = momentOf(e);
    const fresh = memes.filter(m => !used.has(m.id) && m.tags.some(t => tags.includes(t)));
    // Newer memes first, a couple of classics mixed in.
    const pickM = [...shuffle(fresh.filter(m => m.era === '2026' || m.era === '2025')).slice(0, 2), ...shuffle(fresh.filter(m => m.era !== '2026' && m.era !== '2025')).slice(0, 2)].slice(0, bare ? 1 + Math.floor(rand() * 2) : 4);
    const always = ['open', 'close', 'market'].includes(e.kind);
    const songTime = now() - lastSong > songGapMs && (always || rand() < songOdds);
    // The model rarely writes a song tag on its own (offered a song three times, it may take it none), so the moment picks
    // the song and she is told it is playing.
    const pickS = songTime ? shuffle(songs.filter(s => moods.includes(s.mood) && !played.has(s.id))).slice(0, 1) : [];
    let text = '';
    if (pickM.length) text += '\n【能用的梗】合适就自然地融一个进台词，不合适就不用；别解释梗，别一句堆好几个：' + pickM.map(m => `「${m.meme}」（${m.mean}${m.use && !bare ? '；' + m.use : ''}）`).join(' ');
    if (pickS.length) text += `\n【放首歌】你顺手放了《${pickS[0].title}》${pickS[0].why ? '（' + pickS[0].why + '）' : ''}，你说这句的时候它会响起。可以顺嘴接一句这首歌，也可以不提，别解释为什么放。`;
    return { text, memes: pickM, songs: pickS };
  }

  // After she spoke: the memes she used and the song she asked for are marked so they don't come back tonight.
  function took(o, said) {
    // She rarely says a meme word for word ("韭菜自我修养"), so any four characters of it in a row count.
    const bare = t => String(t).replace(/[^\p{L}\p{N}]/gu, '');
    const heard = bare(said);
    for (const m of o.memes) { const w = bare(m.meme); for (let i = 0; i + 4 <= Math.max(4, w.length); i++) if (heard.includes(w.slice(i, i + 4))) { used.add(m.id); break; } }
  }
  function song(id) {
    const key = String(id || '').replace(/[《》\s]/g, '').toLowerCase();
    const s = songs.find(x => x.id === key || x.title.replace(/\s/g, '').toLowerCase() === key);
    if (!s || now() - lastSong < songGapMs * 0.5) return null;
    lastSong = now(); played.add(s.id);
    return { id: s.id, title: s.title, url: `/bgm/${s.id}.m4a`, dur: s.dur };
  }
  function forget() { used.clear(); played.clear(); }
  return { offer, took, song, forget, load, get counts() { return { memes: memes.length, songs: songs.length }; } };
}

// "[放歌:haoyunlai]" anywhere in a reply (the model sometimes writes the title instead): taken out, the pick returned.
export function takeSong(raw) {
  let id = null;
  const text = String(raw || '').replace(/[\[【]\s*放歌\s*[:：]\s*([^\]】]{1,40}?)\s*[\]】]/g, (_, x) => { id ||= x; return ''; }).trim();
  return { text, id };
}
