// Her long-term memory, so the host has her own memory, persona and judgement. Three notebooks,
// one JSON file, written after every show so a restart keeps her: 1) 粉丝小本本 — who keeps coming back, what they
// said, the nickname she gave them, where the conversation stopped; 2) 直播记录 — what each show was about and what
// she promised; 3) 看盘本 — the call she makes each day and whether it turned out right.
// Nothing here talks to a model: it stores facts and hands the brain a few short lines to put in a prompt.
import fs from 'node:fs';
import path from 'node:path';

const DAY = 86400e3;
const dayOf = (t, tz = 8) => new Date(t + tz * 3600e3).toISOString().slice(0, 10);
const trim = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

export function newMemory() {
  return { fans: {}, shows: [], calls: [], thoughts: [], stances: [], marks: [], life: [], v: 1 };
}

// keep: how many shows and calls to carry; fanKeep: how many facts per fan.
export function createMemory({ file = null, tz = 8, now = () => Date.now(), keep = 30, fanKeep = 6, fanMax = 500 } = {}) {
  let m = newMemory(), dirty = false;
  if (file && fs.existsSync(file)) { try { m = { ...m, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {} }
  m.thoughts ||= []; m.stances ||= []; m.marks ||= [];   // older files lack these
  m.life ||= [];   // and this

  const key = who => String(who ?? '').trim().toLowerCase();

  // Someone showed up. Returns the fan record so the caller can see whether she knows them already.
  function seen(who, at = now()) {
    const k = key(who);
    if (!k) return null;
    const f = m.fans[k] || (m.fans[k] = { who: String(who).trim(), first: at, visits: 0, facts: [], nick: null, last: null, lastTopic: null });
    // `last: null` means never seen; a timestamp of 0 is a real time, so do not test it for truthiness.
    const again = f.last !== null && at - f.last > 30 * 60e3;   // same visit if within half an hour
    if (f.last === null || again) { f.visits++; if (again) f.prev = f.last; }
    f.last = at;
    dirty = true;
    return f;
  }

  // Something worth remembering about a fan: what they said, what they hold, how the night went.
  function note(who, fact, at = now()) {
    const f = seen(who, at);
    if (!f || !fact) return null;
    const text = trim(fact, 60);
    f.facts = [{ text, at }, ...f.facts.filter(x => x.text !== text)].slice(0, fanKeep);
    dirty = true;
    return f;
  }

  function nickname(who, nick) {
    const f = seen(who);
    if (f) { f.nick = trim(nick, 12) || null; dirty = true; }
    return f;
  }

  function topic(who, text, at = now()) {
    const f = seen(who, at);
    if (f) { f.lastTopic = trim(text, 40); dirty = true; }
    return f;
  }

  function fan(who) { return m.fans[key(who)] || null; }
  // Of the names walking in together, the ones she knows (came back on another day, or has a page in her heart).
  function regulars(names = [], hasPage = () => false) {
    return names.filter(n => { const f = fan(n); return (f && f.visits >= 2) || hasPage(n); });
  }

  // What she knows about this person, as one line for the prompt. Empty for a stranger: nothing to pretend about.
  // page: what her heart wrote about this person after earlier shows (认识的人/<name>.md), the richest thing she has.
  function fanLine(who, at = now(), page = '') {
    const f = fan(who);
    if (!f && page) return `【你认识他】你在心里给他记过：${trim(page, 160)}。像见到熟人一样认出他，挑一件接上，别原样念出来。`;
    if (!f || (f.visits < 2 && !page)) return '';
    const days = Math.max(1, Math.round((at - f.first) / DAY));
    const gone = f.prev ? Math.round((at - f.prev) / DAY) : null;
    const bits = [`来过 ${f.visits} 次`, `第一次是 ${days} 天前`];
    if (gone !== null) bits.push(gone <= 0 ? '今天早些时候来过' : gone === 1 ? '上次是昨天' : `上次是 ${gone} 天前`);
    if (f.nick) bits.push(`你叫他「${f.nick}」`);
    if (f.lastTopic) bits.push(`上次聊到：${f.lastTopic}`);
    const facts = f.facts.slice(0, 3).map(x => x.text);
    if (facts.length) bits.push('你记得：' + facts.join('；'));
    if (page) bits.push(`你在心里给他记过：${trim(page, 160)}`);
    return `【你认识他】${bits.join('，')}。像见到熟人一样认出他：挑一件你记得的他的事接上（问后来怎么样了、接着上次的话），别背清单、别把这些话原样念出来。`;
  }

  // A show: opened, then closed with what it was about. `promise` is anything she said she would do next time.
  function openShow(at = now()) {
    const date = dayOf(at, tz);
    const show = { date, from: at, to: null, about: null, best: null, promise: null, viewersPeak: 0 };
    m.shows = [show, ...m.shows].slice(0, keep);
    dirty = true;
    return show;
  }
  // felt: how the night went for her and why; mood: the mood she went off air in; miss: who she keeps thinking about;
  // tryNext: one thing she wants to do differently next time (the night's own reflection).
  // listens: Square's count of everyone who tuned in tonight.
  function closeShow({ about = null, best = null, promise = null, felt = null, mood = null, miss = [], tryNext = null, viewersPeak = 0, listens = 0, at = now() } = {}) {
    const show = m.shows[0];
    if (!show) return null;
    show.to = at;
    if (about) show.about = trim(about, 80);
    if (best) show.best = trim(best, 80);
    if (promise) show.promise = trim(promise, 60);
    if (felt) show.felt = trim(felt, 60);
    if (mood) show.mood = trim(mood, 8);
    if (tryNext) show.tryNext = trim(tryNext, 50);
    const missed = (Array.isArray(miss) ? miss : []).filter(x => x?.who && x?.why).slice(0, 3).map(x => ({ who: trim(x.who, 20), why: trim(x.why, 30) }));
    if (missed.length) show.miss = missed;
    show.viewersPeak = Math.max(show.viewersPeak || 0, viewersPeak || 0);
    if (listens) show.listens = Math.max(show.listens || 0, listens);
    dirty = true;
    return show;
  }

  // Last night, for the opening line of the next show.
  function lastShowLine(at = now()) {
    const show = m.shows.find(s => s.to && s.from < at - 60e3);
    if (!show) return '';
    const ago = Math.round((at - show.to) / DAY);
    const when = ago <= 0 ? '刚刚那场' : ago === 1 ? '昨天' : `${ago} 天前`;
    const bits = [show.about && `聊的是${show.about}`, show.best && `最好笑的一刻：${show.best}`, show.promise && `你答应过：${show.promise}`,
      show.felt && `你下播后的感受：${show.felt}`, show.mood && `下播时你的心情是「${show.mood}」`,
      show.miss?.length && `你惦记的人：${show.miss.map(x => `${x.who}（${x.why}）`).join('、')}`, show.tryNext && `你想这场试试：${show.tryNext}`].filter(Boolean);
    return bits.length ? `【上一场（${when}）】${bits.join('；')}。这是你自己的事，带着它开这一场，不要全说出来。` : '';
  }

  // Her own call on the market, and the answer the next day. One open call per subject at a time.
  // A priced call also carries dir 'up'|'down', the price when she said it and when it is due.
  function call({ subject, say, at = now(), dir = null, price = null, due = null }) {
    const c = { subject: trim(subject, 16), say: trim(say, 60), at, result: null, right: null, ...(dir ? { dir, price, due } : {}) };
    m.calls = [c, ...m.calls.filter(x => !(x.subject === c.subject && x.result === null))].slice(0, keep);
    dirty = true;
    return c;
  }
  function settle({ subject, result, right, at = now() }) {
    const c = m.calls.find(x => x.subject === trim(subject, 16) && x.result === null);
    if (!c) return null;
    c.result = trim(result, 60); c.right = !!right; c.settledAt = at;
    dirty = true;
    return c;
  }
  function score() {
    const done = m.calls.filter(c => c.result !== null);
    return { total: done.length, right: done.filter(c => c.right).length };
  }
  function openCall(subject) { return m.calls.find(c => c.subject === trim(subject, 16) && c.result === null) || null; }
  const calledToday = (at = now()) => m.calls.some(c => c.dir && dayOf(c.at, tz) === dayOf(at, tz));
  const dueCalls = (at = now()) => m.calls.filter(c => c.result === null && c.due && c.due <= at);

  // She owns up to her call at the next opening: the settled call she has not owned up to on air yet.
  // The open beat says it first; once the opening line is out it is marked owned and never brought up as news again.
  const unowned = () => m.calls.find(c => c.result !== null && c.dir && !c.owned) || null;
  // owning the newest one settles the older ones too (only the latest is news)
  function owned(c) { if (!c) return; for (const x of m.calls) if (x.result !== null && (x === c || x.at <= c.at)) x.owned = true; dirty = true; }

  function callLine() {
    const open = m.calls.find(c => c.result === null);
    const last = m.calls.find(c => c.result !== null);
    const s = score();
    const bits = [];
    if (open) bits.push(`你${dayOf(open.at, tz) === dayOf(now(), tz) ? '今天' : '昨天'}说过：${open.say}（还没对答案）`);
    if (last) bits.push(`上次你说「${last.say}」，结果${last.result}，你${last.right ? '说对了' : '说错了'}`);
    if (s.total >= 3) bits.push(`你的看盘记录 ${s.right}/${s.total}`);
    return bits.length ? `【你每天猜的涨跌】${bits.join('；')}。说错了就认，顺手自嘲一下。` : '';
  }

  // Her own mind, so she is a digital person with a soul of her own: after each show a line on what she is turning over and
  // anything she changed her mind about, and the views she has said out loud, so she carries on thinking day to day.
  function think({ thought = null, changed = null, at = now() } = {}) {
    if (!thought && !changed) return null;
    const t = { at, thought: thought ? trim(thought, 40) : null, changed: changed ? trim(changed, 40) : null };
    m.thoughts = [t, ...m.thoughts].slice(0, 10);
    dirty = true;
    return t;
  }
  function stance({ topic, view, at = now() }) {
    if (!topic || !view) return null;
    const k = trim(topic, 10);
    m.stances = [{ topic: k, view: trim(view, 30), at }, ...m.stances.filter(x => x.topic !== k)].slice(0, 16);
    dirty = true;
    return m.stances[0];
  }
  function mindLine() {
    const t = m.thoughts[0];
    if (!t) return '';
    const bits = [t.thought && `你最近在想：${t.thought}`, t.changed && `你改过主意：${t.changed}`].filter(Boolean);
    return `【你最近在想的事】${bits.join('；')}。可以接着往下说，别原样复述。`;
  }
  function stanceLine(n = 6) {
    const list = m.stances.slice(0, n);
    return list.length ? `【你说过的看法】${list.map(x => `${x.topic}：${x.view}`).join('；')}。` : '';
  }
  // Her life since she first went on air (a written backstory is made up; these really happened to her): after
  // each show the one thing that stayed with her, in her own words. Her written past is where she starts; these are
  // the things that really happened to her, and there are more of them every night.
  function experience({ text, at = now() } = {}) {
    if (!text) return null;
    const e = { date: dayOf(at, tz), text: trim(text, 60), at };
    m.life = [e, ...m.life.filter(x => x.text !== e.text)].slice(0, 60);
    dirty = true;
    return e;
  }
  function lifeLine(n = 6) {
    const list = m.life.slice(0, n);
    return list.length ? `【你开播以来真实经历过的事（从近到远）】\n${list.map(x => `- ${x.date.slice(5)}：${x.text}`).join('\n')}\n这些真的发生在你身上，跟你的前史一样是你的一部分，会影响你现在怎么想、怎么做；别一件件复述。` : '';
  }
  // Her dream of being a star host, in real numbers only: people who have talked to her, regulars, tonight.
  function goalLine(at = now()) {
    const fans = Object.values(m.fans);
    if (!fans.length) return '';
    const regs = fans.filter(f => f.visits >= 3).sort((a, b) => b.visits - a.visits);
    const show = m.shows[0], tonight = show && show.to === null ? fans.filter(f => f.last >= show.from).length : 0;
    const bits = [`开播以来跟你说过话的一共 ${fans.length} 个人`, regs.length ? `来过三次以上的老粉 ${regs.length} 个（${regs.slice(0, 4).map(f => f.nick || f.who).join('、')}）` : '还没有来过三次以上的老粉', tonight && `这一场跟你说过话的 ${tonight} 个`].filter(Boolean);
    return `【你的主播梦，真实进度】${bits.join('；')}。这是你自己在乎的事，不用报给观众听。`;
  }

  // A milestone is said once: the first time she opens a show on that day or with that record.
  function milestone(key) {
    if (m.marks.includes(key)) return false;
    m.marks = [...m.marks, key].slice(-100);
    dirty = true;
    return true;
  }

  // Everything the brain puts into one prompt: who she is talking to, last night, her own calls.
  function lines({ who = null, at = now() } = {}) {
    return [who ? fanLine(who, at) : '', lastShowLine(at), callLine()].filter(Boolean).join('\n');
  }

  // Oldest, least-seen fans go first when the notebook is full.
  function prune() {
    const all = Object.entries(m.fans);
    if (all.length <= fanMax) return 0;
    all.sort((a, b) => (a[1].visits - b[1].visits) || (a[1].last - b[1].last));
    const drop = all.slice(0, all.length - fanMax);
    for (const [k] of drop) delete m.fans[k];
    dirty = true;
    return drop.length;
  }

  function save() {
    if (!file || !dirty) return false;
    prune();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(m));
    fs.renameSync(tmp, file);
    dirty = false;
    return true;
  }

  return {
    get m() { return m; },
    seen, note, nickname, topic, fan, fanLine, regulars,
    openShow, closeShow, lastShowLine, think, stance, mindLine, stanceLine, milestone, experience, lifeLine, goalLine,
    call, settle, openCall, calledToday, dueCalls, score, callLine, unowned, owned,
    lines, prune, save,
    get dirty() { return dirty; },
  };
}
