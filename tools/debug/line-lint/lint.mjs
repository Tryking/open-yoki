#!/usr/bin/env node
// Line lint: read what the host actually said in a show and point at the habits that make her sound like a machine:
// words and numbers she wore out, lines that start or end the same way, disclaimers, sermons, "nobody is here",
// replying in Chinese to an English comment, calling every viewer by name, every line the same length, long silences.
//
//   node lint.mjs show.jsonl [--config lint.config.json] [--json out.json] [--md out.md]
//
// Input, one of:
//   .jsonl  one object per line: { "at": "2026-01-01T12:00:00Z" | 1767268800000, "who": "host" | "viewer",
//           "name": "Sam", "text": "...", "to": "Sam" }   ("who" defaults to host; "to" = whom a host line answers)
//   .txt    one host line per line
// The helper functions are exported too, so the live brain can use the same rules before a line goes out.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- worn-out words and numbers ----------
const NUM = /(\d{2,3}(?:,\d{3})+|\d{4,6}|[一二三四五六七八九十]万[一二三四五六七八九]?(?:千)?)/g;
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
// "八万二", "82,000" and "82000" are one number to a listener
const numKey = x => {
  const m = x.match(/^([一二三四五六七八九十])万([一二三四五六七八九])?/);
  return m ? String(CN[m[1]] * 10000 + (m[2] ? CN[m[2]] * 1000 : 0)) : x.replace(/,/g, '');
};
// Single characters that never make a "topic" on their own (pronouns, particles, numerals ...)
export const LITTLE = new Set('我你他她它这那是不了就的个还在有么吗呢啊吧呀哦嘛也都很没看说要会想去来一上下大小多少好点儿得着过和跟把被给让对从到为能可以自己们今天明晚现时候先再又才只真太最其实反正然后但所如果因为啥谁怎样哪里二三四五六七八九十百千万');
const EN_STOP = new Set('the a an and or but to of in on at for with is are was were be been it its this that these those i you he she we they me my your our their just so very really what when how why do does did not no yes yeah ok okay lol haha gonna wanna get got have has had can will would could should about like right now here there then than too also out up down'.split(' '));

function wordsOf(t, extraStop) {
  const s = String(t);
  const z = s.replace(/[^一-鿿]/g, '');
  const w = new Set();
  for (let i = 0; i < z.length - 1; i++) {
    const b = z.slice(i, i + 2);
    if (!LITTLE.has(b[0]) && !LITTLE.has(b[1]) && !extraStop.has(b)) w.add(b);
  }
  for (const e of s.toLowerCase().match(/[a-z][a-z']{3,}/g) || []) if (!EN_STOP.has(e) && !extraStop.has(e)) w.add(e);
  return w;
}

// The numbers / chart words / two-character words she leaned on in `said` (her last lines). A number or a listed
// word counts after `min` lines, any other word after `min + 1`.
export function wornTopics(said, { min = 3, chartWords = [], stop = [] } = {}) {
  const extraStop = new Set(stop), n = new Map(), wn = new Map();
  for (const t of said) {
    const seen = new Set([...(String(t).match(NUM) || []).map(numKey), ...chartWords.filter(w => String(t).includes(w))]);
    for (const k of seen) n.set(k, (n.get(k) || 0) + 1);
    for (const k of wordsOf(t, extraStop)) if (!chartWords.some(c => c.includes(k))) wn.set(k, (wn.get(k) || 0) + 1);
  }
  const top = m => [...m].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return [...top(new Map([...n].filter(([, c]) => c >= min))), ...top(new Map([...wn].filter(([, c]) => c >= min + 1)))].slice(0, 6);
}

// A line to add to the prompt when answering a comment: steer off the worn words unless the comment itself asks.
export function wornReply(commentText, worn) {
  if (!worn?.length) return '';
  const keep = worn.filter(k => !String(commentText || '').includes(k) && !wornTopics([commentText, commentText, commentText]).includes(k));
  return keep.length ? `You have said these again and again tonight: ${keep.join(', ')}. Do not bring them up in this answer; talk about what they said.` : '';
}

// The heart's note to the mouth: drop a "thinking about / want to talk about" line once she has said it twice.
// `keys` are the note labels that carry topics (Chinese or English).
export function wornNote(note, said, keys = ['在想', '接下来想', '今天', '今晚想聊', 'thinking about', 'next', 'today']) {
  const re = new RegExp(`^\\s*(${keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*[:：]\\s*(.+)$`, 'i');
  return String(note || '').split('\n').filter(l => {
    const m = l.match(re);
    if (!m) return true;
    const bits = m[2].split(/[，,；;、。！？\s]+|加|和|跟|还是|然后/).map(b => b.replace(/^(想|吃|再|先|继续|去|有点)/, '')).filter(b => b.length >= 2).map(b => /[a-z]/i.test(b) ? b.toLowerCase() : b.slice(0, 2));
    return !bits.some(b => said.filter(t => String(t).toLowerCase().includes(b)).length >= 2);
  }).join('\n').trim();
}

// ---------- same opening / same ending / copied run ----------
const bare = t => String(t).replace(/[\[【][^\]】]*[\]】]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
// What repeats between `raw` and her recent lines (newest first): same first 2 chars as one of the last 3 lines,
// same last 4 chars, or any 5-char run. '' when nothing does.
export function repeatOf(raw, recent) {
  const s = bare(raw);
  if (s.length < 6) return '';
  for (const [k, r] of recent.map(bare).entries()) {
    if (k < 3 && r.length >= 2 && s.slice(0, 2) === r.slice(0, 2)) return s.slice(0, 2);
    if (r.length >= 4 && s.slice(-4) === r.slice(-4)) return s.slice(-4);
    for (let i = 0; i + 5 <= s.length; i++) if (r.includes(s.slice(i, i + 5))) return s.slice(i, i + 5);
  }
  return '';
}

// ---------- language ----------
const LANGS = [['Korean', /[가-힯ᄀ-ᇿ]/], ['Japanese', /[぀-ヿ]/], ['Russian', /[Ѐ-ӿ]/], ['Thai', /[฀-๿]/], ['Arabic', /[؀-ۿ]/]];
const VIET = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệịỉĩọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
// null = Chinese (or nothing to tell), else the language to answer in
export const langOf = t => {
  for (const [n, re] of LANGS) if (re.test(t)) return n;
  return !/[㐀-鿿]/.test(t) && /[a-z]{2}/i.test(t) ? (VIET.test(t) ? 'Vietnamese' : 'Latin-script (English etc.)') : null;
};
const hasHan = t => /[㐀-鿿]/.test(t);

// ---------- phrase lists (override or extend in lint.config.json) ----------
export const DEFAULT_CONFIG = {
  window: 20,            // worn words are counted in sliding windows of this many host lines
  min: 3,                // a number counts as worn after this many lines in a window, a word after min + 1
  chartWords: ['收盘', '这根', '站住', '插针', '偏空', '偏弱'],
  stop: [],
  maxGapSec: 40,         // host silent longer than this (needs "at") counts as a dead-air gap
  phrases: {
    disclaimer: ['不构成投资建议', '投资有风险', '我没喊单', '不是喊单', '仅供参考', 'DYOR', 'not financial advice', 'NFA'],
    sermon: ['理性投资', '一定要', '千万不要', '记住了', '要学会', 'remember to', 'always remember', 'you should never'],
    ai_tell: ['作为一个AI', '作为AI', '作为一个人工智能', '我理解你的感受', '希望对你有帮助', '有什么可以帮你', 'As an AI', 'I understand how you feel', 'I hope this helps'],
    generic_address: ['各位朋友', '各位观众', '亲爱的观众', 'dear viewers', 'everyone out there'],
    quiet_complaint: ['没人', '就我一个', '一个人在这', '没人理我', '冷场了', 'nobody is here', 'no one is here'],
  },
};

export function loadLines(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.jsonl')) {
    return raw.split('\n').filter(l => l.trim()).map(l => JSON.parse(l)).map(j => ({
      at: j.at == null ? null : typeof j.at === 'number' ? j.at : Date.parse(j.at),
      who: j.who || 'host', name: j.name || '', text: String(j.text || ''), to: j.to || '',
    }));
  }
  return raw.split('\n').filter(l => l.trim()).map(text => ({ at: null, who: 'host', name: '', text: text.trim(), to: '' }));
}

export function lint(rows, cfgIn = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...cfgIn, phrases: { ...DEFAULT_CONFIG.phrases, ...(cfgIn.phrases || {}) } };
  const host = rows.filter(r => r.who === 'host');
  const said = host.map(r => r.text);
  const R = { lines: host.length, viewerLines: rows.length - host.length };

  // worn: count, for every word, in how many windows it was worn, and its total use
  const wornCount = new Map();
  for (let i = 0; i + 1 <= said.length; i += Math.max(1, Math.floor(cfg.window / 2))) {
    for (const k of wornTopics(said.slice(i, i + cfg.window), cfg)) wornCount.set(k, (wornCount.get(k) || 0) + 1);
  }
  R.worn = [...wornCount.keys()].map(k => ({ word: k, lines: said.filter(t => String(t).includes(k) || (String(t).match(NUM) || []).map(numKey).includes(k)).length }))
    .sort((a, b) => b.lines - a.lines).slice(0, 12);

  // repeats against the 12 lines before
  R.repeats = [];
  said.forEach((t, i) => { const r = repeatOf(t, said.slice(Math.max(0, i - 12), i).reverse()); if (r) R.repeats.push({ line: i + 1, text: t, repeated: r }); });
  const openings = new Map();
  for (const t of said) { const o = bare(t).slice(0, 2); if (o.length === 2) openings.set(o, (openings.get(o) || 0) + 1); }
  R.topOpenings = [...openings].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([o, n]) => ({ opening: o, lines: n }));

  // phrase lists
  R.phrases = {};
  for (const [kind, list] of Object.entries(cfg.phrases)) {
    const hits = [];
    said.forEach((t, i) => { const p = list.find(w => t.toLowerCase().includes(w.toLowerCase())); if (p) hits.push({ line: i + 1, phrase: p, text: t }); });
    R.phrases[kind] = hits;
  }

  // reply checks: language follow + calling the viewer by name
  R.language = []; let answered = 0, named = 0;
  rows.forEach((r, i) => {
    if (r.who !== 'viewer') return;
    const reply = rows.slice(i + 1).find(x => x.who === 'host' && (!x.to || x.to === r.name));
    if (!reply || (reply.to && reply.to !== r.name)) return;
    answered++;
    if (r.name && bare(reply.text).startsWith(bare(r.name))) named++;
    const l = langOf(r.text);
    if (l && hasHan(reply.text)) R.language.push({ comment: `${r.name}: ${r.text}`, reply: reply.text, want: l });
    if (!l && hasHan(r.text) && !hasHan(reply.text)) R.language.push({ comment: `${r.name}: ${r.text}`, reply: reply.text, want: 'Chinese' });
  });
  R.answered = answered; R.namedShare = answered ? +(named / answered).toFixed(2) : 0;

  // shape: question endings, length spread, action-tag overuse
  const q = said.filter(t => /[？?]\s*$|[吗呢吧]\s*[。！!~～]?\s*$/.test(t)).length;
  R.questionShare = said.length ? +(q / said.length).toFixed(2) : 0;
  const lens = said.map(t => bare(t).length), mean = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / (lens.length || 1));
  R.length = { mean: Math.round(mean), sd: Math.round(sd), spread: mean ? +(sd / mean).toFixed(2) : 0 };
  const tags = new Map();
  for (const t of said) for (const m of t.match(/[\[【]([^\]】]{1,12})[\]】]/g) || []) tags.set(m, (tags.get(m) || 0) + 1);
  R.tags = [...tags].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag, n]) => ({ tag, lines: n, share: +(n / (said.length || 1)).toFixed(2) }));

  // dead air (needs timestamps)
  const times = host.map(r => r.at).filter(x => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => (t - times[i]) / 1000).filter(g => g > cfg.maxGapSec);
  R.deadAir = times.length > 1 ? { gaps: gaps.length, longestSec: Math.round(Math.max(0, ...gaps)) } : null;

  // verdict: what is worth looking at
  const flags = [];
  if (R.worn.length && R.worn[0].lines >= Math.max(5, said.length * 0.1)) flags.push(`worn: "${R.worn[0].word}" in ${R.worn[0].lines} of ${said.length} lines`);
  if (R.repeats.length > said.length * 0.15) flags.push(`repeats: ${R.repeats.length} lines copy an opening, ending or 5-char run from a recent line`);
  for (const [k, v] of Object.entries(R.phrases)) if (v.length) flags.push(`${k}: ${v.length} lines`);
  if (R.language.length) flags.push(`language: ${R.language.length} replies not in the commenter's language`);
  if (R.namedShare > 0.5 && answered >= 5) flags.push(`names: ${Math.round(R.namedShare * 100)}% of replies start with the viewer's name`);
  if (R.questionShare > 0.4 && said.length >= 10) flags.push(`questions: ${Math.round(R.questionShare * 100)}% of lines end in a question`);
  if (R.length.spread < 0.3 && said.length >= 10) flags.push(`length: every line about ${R.length.mean} chars (spread ${R.length.spread})`);
  if (R.tags[0]?.share > 0.2 && said.length >= 10) flags.push(`tags: ${R.tags[0].tag} on ${Math.round(R.tags[0].share * 100)}% of lines`);
  if (R.deadAir?.gaps) flags.push(`dead air: ${R.deadAir.gaps} gaps over ${cfg.maxGapSec}s, longest ${R.deadAir.longestSec}s`);
  R.flags = flags;
  return R;
}

export function toMarkdown(R, title = 'Line lint') {
  const L = [`# ${title}`, '', `${R.lines} host lines, ${R.viewerLines} viewer lines, ${R.answered} replies matched.`, ''];
  L.push('## Worth a look', '', ...(R.flags.length ? R.flags.map(f => `- ${f}`) : ['- nothing stands out']), '');
  if (R.worn.length) L.push('## Worn words / numbers', '', '| word | lines |', '|---|---|', ...R.worn.map(w => `| ${w.word} | ${w.lines} |`), '');
  if (R.topOpenings.length) L.push('## Most used openings', '', ...R.topOpenings.map(o => `- "${o.opening}" x${o.lines}`), '');
  if (R.repeats.length) L.push('## Repeats (first 10)', '', ...R.repeats.slice(0, 10).map(r => `- line ${r.line} repeats "${r.repeated}": ${r.text}`), '');
  for (const [k, v] of Object.entries(R.phrases)) if (v.length) L.push(`## ${k} (first 5)`, '', ...v.slice(0, 5).map(h => `- line ${h.line} "${h.phrase}": ${h.text}`), '');
  if (R.language.length) L.push('## Wrong language (first 5)', '', ...R.language.slice(0, 5).map(x => `- ${x.comment} -> ${x.reply} (should be ${x.want})`), '');
  L.push('## Shape', '', `- line length: mean ${R.length.mean}, sd ${R.length.sd}`, `- ends in a question: ${Math.round(R.questionShare * 100)}%`,
    `- replies starting with the viewer's name: ${Math.round(R.namedShare * 100)}%`, ...(R.tags.length ? [`- top tags: ${R.tags.map(t => `${t.tag} x${t.lines}`).join(', ')}`] : []),
    ...(R.deadAir ? [`- dead air: ${R.deadAir.gaps} gaps, longest ${R.deadAir.longestSec}s`] : []), '');
  return L.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const cfgFile = opt('--config'), jsonOut = opt('--json'), mdOut = opt('--md');
  const file = args[0];
  if (!file) { console.error('usage: node lint.mjs show.jsonl|lines.txt [--config c.json] [--json out.json] [--md out.md]'); process.exit(2); }
  const R = lint(loadLines(file), cfgFile ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {});
  const md = toMarkdown(R, `Line lint: ${path.basename(file)}`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(R, null, 1));
  if (mdOut) fs.writeFileSync(mdOut, md);
  console.log(md);
}
