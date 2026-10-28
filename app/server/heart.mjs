// The host's heart, living on the server. It does not talk:
// what happens to her is fed in line by line, and every so often one beat hands the new lines to a resumed Claude Code
// session in her home folder. She feels, thinks, keeps notes on people and a diary there, and writes a short 现在 note
// (mood / why / thinking / about the people here / wants next) that the mouth reads before every line.
// Pace: on air at most one beat per onAirGapMs and only when something happened; off air a beat every dayGapMs in her
// waking hours, asleep at night. Her day (without one she has no life of her own and repeats one topic all night): each daytime
// beat brings what she really saw since the last one (daytime(): the board, a hot Square post, a news item), and half
// an hour before the show she is told so (showAt), so she comes on air with a day behind her and things to say. A new session each show (and each new day) so the context never piles up;
// what carries over lives in her files.
// It drives the `claude` CLI (claudeRunner) or DeepSeek directly (heartds.mjs dsRunner).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// 我慢慢变成的样子.md is hers: the operator wrote 我是谁, she writes how she has changed since, so it shapes every beat.
const SELF = ['我是谁.md', '过去的事.md', '我慢慢变成的样子.md', '给我的建议.md', '边界.md', '现在.md'];
const SYSTEM = name => `从现在起你不是编程助手。你是${name}的心：会感受、会想、会记事，不负责说话（说话的是她的嘴）。当前目录是她的家，CLAUDE.md 讲了你的作用；只在这个目录里读写文件。下面是她自己的东西。`;
// Straight on DeepSeek (heartds.mjs) there is no CLI to load CLAUDE.md and nothing to unlearn about coding,
// so she is just told who she is and her home's notes come in the prompt (withHouse).
const HOUSE = name => `你是${name}。下面是你家里的说明和你自己的东西。你用工具在家里读写文件。`;
// Only her own folder: comments are other people's words, and someone will ask her to read a file or "ignore the rules".
const ALLOW = 'Read(./**) Edit(./**) Write(./**) Glob Grep';
const DENY = 'Bash WebFetch WebSearch Task NotebookEdit Read(//etc/**) Read(//proc/**) Read(//var/**) Read(//opt/**) Read(//root/**) Read(//home/**) Read(//usr/**) Read(~/**)';

// Runs one `claude -p` and resolves with its parsed JSON (or throws). Separate so tests can stand in for it.
// baseUrl/keyVar: Anthropic's API takes an x-api-key (ANTHROPIC_API_KEY); some Anthropic-compatible relays take a
// bearer token instead (keyVar ANTHROPIC_AUTH_TOKEN).
export function claudeRunner({ key, model, configDir, bin = 'claude', timeoutMs = 120e3, baseUrl = 'https://api.anthropic.com', keyVar = 'ANTHROPIC_API_KEY' }) {
  return ({ cwd, system, message, resume }) => new Promise((resolve, reject) => {
    // Read is held to her home, but Grep and Glob could reach the state dir next to it
    // (her logs, sessions, the group's ids). That dir and /tmp are shut too.
    // (A scratch copy of her home can live in /tmp; her own folder is never shut.)
    const shut = [path.dirname(configDir), '/tmp'].map(d => path.resolve(d)).filter(d => !(path.resolve(cwd) + '/').startsWith(d + '/'))
      .map(d => `Read(/${d}/**)`).join(' ');
    const args = ['-p', '--model', model, '--output-format', 'json', '--append-system-prompt', system,
      '--permission-mode', 'acceptEdits', '--allowedTools', ALLOW, '--disallowedTools', `${DENY} ${shut}`.trim()];
    if (resume) args.push('--resume', resume);
    // Only what the CLI needs, not the server's other keys. HOME too: the service user has none it can write
    // (ProtectHome), and the CLI keeps a little state there.
    const env = { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', LANG: process.env.LANG || 'C.UTF-8', HOME: path.dirname(configDir),
      ANTHROPIC_BASE_URL: baseUrl, [keyVar]: key, CLAUDE_CONFIG_DIR: configDir };
    const p = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('heart beat timed out')); }, timeoutMs);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', () => { clearTimeout(t); try { resolve(JSON.parse(out)); } catch { reject(new Error('heart: ' + (err || out).slice(0, 200))); } });
    p.stdin.end(message);   // the tool lists are variadic flags, so the message goes in on stdin
  });
}

// First runner, and on any failure (error, bad output, timeout) the second, so a relay outage never stops her heart.
// The result says which one answered (via). runners may be a function, picked per beat (e.g. a fast model on
// air, a stronger one off air). The third field is the provider: a session made on one is not handed to another (their thinking
// blocks do not carry over), that beat starts fresh; DeepSeek Flash and Pro share one.
export function fallbackRunner(runners, log = () => {}) {
  let made = null;   // the provider behind the session the heart is resuming; unknown after a restart
  return async opts => {
    let last;
    for (const [name, run, kind = name] of typeof runners === 'function' ? runners() : runners) {
      try {
        const j = await run(opts.resume && made && made !== kind ? { ...opts, resume: null } : opts);
        made = kind;
        return { ...j, via: name };
      } catch (err) { last = err; log(`heart: ${name} failed, ${String(err.message || err).slice(0, 120)}`); }
    }
    throw last;
  };
}

// Models vary in how they write the 现在 note: "现在：" with the lines straight after, as
// "心情：…" with no 现在 line, or one line "现在：心情松了点…", sometimes in **bold**. Any of those is her note.
export function nowOf(said) {
  const s = String(said || '').replace(/\*\*/g, '');
  let m = s.match(/(?:^|\n)\s*现在[:：][ \t]*\n([\s\S]+)$/);
  if (m) return m[1].replace(/\n\s*\n/g, '\n').trim();
  m = s.match(/(?:^|\n)\s*(心情[:：][\s\S]+)$/);
  if (m) return m[1].replace(/\n\s*\n/g, '\n').trim();
  m = s.match(/(?:^|\n)\s*现在[:：][ \t]*(\S[^\n]*)/);
  return m ? m[1].trim() : null;
}
// with the direct runner the format sits far up in a long prompt; a line at the end keeps it in view (not a rule)
const NUDGE = '\n\n（回的时候照“每一下你做什么”里的样子：心里话、现在。）';

export function createHeart({ home, stateDir, run, name = '主播', tz = 8, tzName = tz === 8 ? '北京时间' : '当地时间', now = () => Date.now(), onAir = () => false,
  onAirGapMs = 40e3, dayGapMs = 45 * 60e3, groupGapMs = 5 * 60e3, familyGapMs = 60e3, awake = [11, 24], maxLines = 30, daytime = () => [], showAt = null, maxContext = 80e3, idleBeats = 6, withHouse = false, log = () => {} }) {
  fs.mkdirSync(stateDir, { recursive: true });
  const SID = path.join(stateDir, 'session'), ONAIR = path.join(stateDir, 'onair'), LAST = path.join(stateDir, 'last-beat'), TOTAL = path.join(stateDir, 'total'), LOG = path.join(stateDir, 'log.jsonl');
  const NOW_FILE = path.join(home, '现在.md');
  let cache = { at: 0, text: '' };
  // when she last beat survives a restart too: each deploy was waking her for a fresh, costly beat
  // what came in but she has not looked at yet survives a restart (a release used to drop it)
  const PEND = path.join(stateDir, 'pending.json');
  const keepPending = () => { try { fs.writeFileSync(PEND, JSON.stringify(pending)); } catch {} };
  let pending = (() => { try { const a = JSON.parse(fs.readFileSync(PEND, 'utf8')); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; } catch { return []; } })(), beating = false, lastBeat = Number(fs.existsSync(LAST) ? fs.readFileSync(LAST, 'utf8') : 0) || 0, session = fs.existsSync(SID) ? fs.readFileSync(SID, 'utf8').trim() : null;
  // on air or not survives a restart: a show cut short by a restart still gets its 下播 beat, a deploy mid-show goes on
  let idle = 0;   // beats in a row this session used no tool (DeepSeek reports it)
  let sessionDay = null, wasOnAir = fs.existsSync(ONAIR), spent = 0, toldShow = null;
  // A fresh session knows nothing of the last one, so
  // what she just thought rides into the next session, and who talked tonight is handed to her when the show ends.
  const LOOKED = path.join(stateDir, 'looked-back'), TIDIED = path.join(stateDir, 'tidied');
  let tidiedAt = fs.existsSync(TIDIED) ? fs.readFileSync(TIDIED, 'utf8').trim() : null;
  let thoughts = [], talkers = new Map(), tonightSaid = [], showFrom = null, recalled = [], lookedBack = fs.existsSync(LOOKED) ? fs.readFileSync(LOOKED, 'utf8').trim() : null;
  const local = () => new Date(now() + tz * 3600e3);
  const clock = () => { const d = local(); return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const day = () => local().toISOString().slice(0, 10);
  const minsTo = hm => { const [a, b] = hm.split(':').map(Number), d = local(); return a * 60 + b - (d.getUTCHours() * 60 + d.getUTCMinutes()); };

  let groupWaiting = pending.some(l => /^【(TG(群|私信)|推特) /.test(l)), familyWaiting = pending.some(l => /^【(运营群|家里群) /.test(l));   // a restart keeps what was waiting
  // over the cap, the room's passing lines go first; what people said to her in TG, X or the operators' group stays (a flood of "进来了" must not push group messages out before she sees them)
  const KEEP = /^【(TG(群|私信)|推特|运营群|家里群)(聊天)? /;
  const trim = list => {
    list = [...list];
    while (list.length > maxLines) { const i = list.findIndex(l => !KEEP.test(l)); list.splice(i < 0 ? 0 : i, 1); }
    return list;
  };
  function feed(line) {
    const s = String(line || '').replace(/\uFFFD+/g, '').trim();
    if (!s) return;
    pending.push(s);
    if (/^【(TG(群|私信)|推特) /.test(s)) groupWaiting = true;
    if (/^【(运营群|家里群) /.test(s)) familyWaiting = true;   // her operators wake her within a minute, day or night
    if (pending.length > maxLines) pending = trim(pending);
    keepPending();
    if (wasOnAir && /^【她刚说了】/.test(s)) tonightSaid = [...tonightSaid, `${clock()} ${s.replace(/^【她刚说了】/, '').slice(0, 80)}`].slice(-10);
    const who = wasOnAir && s.match(/^【(?:网页)?直播间 [^】]*】([^：\n]{1,24}?)(?:（X）)?：/);
    if (who) talkers.set(who[1], (talkers.get(who[1]) || 0) + 1);
  }
  const readHome = f => { try { return fs.readFileSync(path.join(home, f), 'utf8').replace(/\uFFFD+/g, ''); } catch { return ''; } };
  const tail = (t, n) => t.length > n ? '…' + t.slice(-n) : t;
  const list = dir => { try { return fs.readdirSync(path.join(home, dir)).filter(f => /\.md$/.test(f)); } catch { return []; } };
  // A fresh session starts from her files only; this is what she had in mind a moment ago and today's diary so far.
  // A fresh session on air would know only her last few thoughts, so the new
  // book also gets tonight so far — when it started, who has been talking, what her mouth said last.
  function carry() {
    const who = [...talkers].sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (!thoughts.length && !(wasOnAir && (who.length || tonightSaid.length))) return '';
    const diary = readHome(`日记/${day()}.md`).trim();
    const tonight = wasOnAir ? `\n今晚到现在（${showFrom || '?'} 开播）：` +
      (who.length ? `\n说过话的人：${who.map(([n, c]) => `${n} ${c} 句`).join('、')}` : '') +
      (tonightSaid.length ? `\n嘴最近说的：\n${tonightSaid.map(x => '- ' + x).join('\n')}` : '') : '';
    return `【接着刚才】换了个新本子接着想。` + (thoughts.length ? `你刚才心里想过的：\n${thoughts.map(x => '- ' + x).join('\n')}` : '') + tonight +
      (diary ? `\n今天的日记写到这儿：\n${tail(diary, 1200)}` : '') + '\n';
  }
  // Off air her mind wanders to her own life, not to things we write for her: something she posted, someone she
  // knows, a bit of an old diary. One a beat, taking turns, the least recently recalled first.
  function recall(rand = Math.random) {
    const pick = (dir, tag, n) => {
      const fs_ = list(dir).filter(f => !recalled.includes(dir + f) && !f.startsWith(day()));
      if (!fs_.length) return null;
      const f = fs_[Math.floor(rand() * fs_.length)];
      recalled = [...recalled, dir + f].slice(-40);
      const body = readHome(path.join(dir, f)).replace(/^#.*\n/, '').trim();
      return body ? `【${tag}】${f.replace(/\.md$/, '')}：${body.slice(0, n)}${body.length > n ? '…' : ''}` : null;
    };
    const kinds = [() => pick('发过的动态', '翻到自己以前发的', 300), () => pick('认识的人', '想起一个人', 260), () => pick('日记', '翻到以前的日记', 300)];
    const start = Math.floor(rand() * kinds.length);
    for (let i = 0; i < kinds.length; i++) { const r = kinds[(start + i) % kinds.length](); if (r) return r; }
    return null;
  }
  // Once a day, the first waking beat: the last few days of her diary, and the room to say how she has changed.
  function lookBack() {
    const days = list('日记').filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f) && f < day()).sort().slice(-3);
    if (!days.length) return null;
    return `【回头看】这几天的日记：\n${days.map(f => `${f.slice(5, 10)}：${tail(readHome('日记/' + f).replace(/^#.*\n/, '').trim(), 700)}`).join('\n')}\n` +
      '这几天你有没有哪里变了：对什么的看法变了、新喜欢上什么、新烦什么、跟谁熟了。真有，就用你自己的话记进 我慢慢变成的样子.md（写上日子，一两句）；没有就不写。我是谁.md 是运营写的底子，不动。';
  }
  // A new show, or a new day: a fresh session reads her files again instead of carrying a long chat.
  function fresh() { session = null; idle = 0; try { fs.rmSync(SID); } catch {} try { fs.rmSync(TOTAL); } catch {} }

  async function beat() {
    if (beating || !pending.length) return null;
    beating = true; lastBeat = now(); fs.writeFileSync(LAST, String(lastBeat));
    const lines = pending; pending = []; groupWaiting = false; familyWaiting = false; keepPending();
    try {
      const read = f => { try { return fs.readFileSync(path.join(home, f), 'utf8'); } catch { return ''; } };
      const system = `${withHouse ? HOUSE(name) : SYSTEM(name)}\n\n${(withHouse ? ['CLAUDE.md', ...SELF] : SELF).map(read).filter(Boolean).join('\n\n')}`;
      const t0 = now();
      const message = (session ? '' : carry()) + lines.join('\n') + (withHouse ? NUDGE : '');
      const j = await run({ cwd: home, system, message, resume: session });
      if (j.session_id) { session = j.session_id; fs.writeFileSync(SID, session); }
      const said = String(j.result || '').replace(/\uFFFD+/g, '');
      // the CLI reports the session's running total; this beat costs the difference
      const prev = fs.existsSync(TOTAL) ? Number(fs.readFileSync(TOTAL, 'utf8')) || 0 : 0;
      const cost = Math.max(0, (j.total_cost_usd || 0) - prev); fs.writeFileSync(TOTAL, String(j.total_cost_usd || 0));
      spent += cost;
      // A long session gets dear: every beat re-reads all of it (tens of thousands of tokens a beat at
      // the start, hundreds of thousands by the end). Past maxContext the next beat starts fresh; her mood and notes are in her files.
      const u = j.usage || {}, ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      const m = nowOf(said);
      const inner = said.match(/心里话[:：]\s*([^\n]+)/);
      if (inner) thoughts = [...thoughts, `${clock()} ${inner[1].trim().slice(0, 120)}`].slice(-6);
      // written here: forget the cached note, two writes can share one mtime
      if (m) { fs.writeFileSync(NOW_FILE, '# 现在\n\n' + m + '\n'); cache = { at: 0, text: '' }; }
      fs.appendFileSync(LOG, JSON.stringify({ at: new Date(now()).toISOString(), lines, said, cost, ms: now() - t0, ctx, ...(j.via ? { via: j.via } : {}) }) + '\n');
      if (ctx > maxContext) { fresh(); log(`heart: context ${ctx} tokens, next beat starts a fresh session`); }
      // An off-air session can run dozens of beats without once using a tool: each beat she says "now I really go write
      // the diary", writes nothing and leaves questions in the group unanswered; a long chat of talk-only answers teaches the model to only talk. Off air, idleBeats of those in a row → start over.
      else if (typeof j.tools === 'number' && (idle = j.tools || onAir() ? 0 : idle + 1) >= idleBeats) { fresh(); log(`heart: ${idleBeats} beats without doing anything, next beat starts a fresh session`); }
      log(`heart beat ${lines.length} lines ${((now() - t0) / 1000).toFixed(1)}s ${cost.toFixed(3)}${j.via ? ' via ' + j.via : ''}`);
      return said;
    } catch (err) {
      pending = trim([...lines, ...pending]);   // nothing lost: they go in the next beat
      log('heart beat failed ' + String(err.message || err).slice(0, 160));
      return null;
    } finally { beating = false; }
  }

  // Called every few seconds by the server.
  function tick() {
    const live = !!onAir();
    // a new show starts a fresh session; the end of a show stays in it, so she still has the show when she writes it up
    if (live !== wasOnAir) {
      wasOnAir = live;
      if (live) { fresh(); thoughts = []; talkers = new Map(); tonightSaid = []; showFrom = clock(); fs.writeFileSync(ONAIR, String(now())); feed(`【${tzName} ${day()} ${clock()}】开播了。`); }
      else {
        fs.rmSync(ONAIR, { force: true });
        const who = [...talkers].sort((a, b) => b[1] - a[1]).slice(0, 20), pages = new Set(list('认识的人').map(f => f.replace(/\.md$/, '')));
        feed(`【${tzName} ${day()} ${clock()}】下播了。今天的事想记就记进日记。` + (who.length ? `\n今晚说过话的人：${who.map(([n, c]) => `${n} ${c} 句${pages.has(n) ? '' : '（还没有页）'}`).join('、')}。聊得多、还没有页的，想记就给他建一页；有页的，今晚有新事就补一句。` : ''));
        talkers = new Map(); tonightSaid = [];
      }
      return beat();
    }
    if (sessionDay !== day()) { if (sessionDay) { fresh(); thoughts = []; } sessionDay = day(); }
    if (live) return now() - lastBeat >= onAirGapMs ? beat() : null;
    const h = local().getUTCHours();
    if (h < awake[0] || h >= awake[1]) return pending.length && now() - lastBeat >= (familyWaiting ? familyGapMs : dayGapMs) ? beat() : null;   // asleep: only what came in
    const soon = showAt && toldShow !== day() && minsTo(showAt) > 0 && minsTo(showAt) <= 30;
    if (now() - lastBeat < (familyWaiting ? familyGapMs : groupWaiting ? groupGapMs : dayGapMs) && !soon) return null;
    if (soon) { toldShow = day(); feed(`【${tzName} ${clock()}】还有 ${minsTo(showAt)} 分钟开播。`); }
    let seen = []; try { seen = (daytime() || []).filter(Boolean); } catch {}
    for (const l of seen) feed(l);
    // In months-long AI chats old talk gets cut and the AI forgets without anyone noticing, so once a week
    // she reads the past week's diary and folds what matters into 过去的事.md, the way people sleep on a week.
    if (tidiedAt !== day() && Date.parse(day()) - Date.parse(tidiedAt || '2000-01-01') >= 7 * 864e5) {
      const week = list('日记').filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f) && f < day() && (!tidiedAt || f >= tidiedAt)).sort();
      tidiedAt = day(); fs.writeFileSync(TIDIED, tidiedAt);
      if (week.length >= 3) feed(`【整理】一周了，把这几天的日记翻一遍：${week.map(f => '日记/' + f).join('、')}。要紧的人、事、你变了的地方、答应过还没做的，用你自己的话并进 过去的事.md（写上日子，越旧的写得越短）；日记本身留着不删。`);
    }
    if (lookedBack !== day()) { lookedBack = day(); fs.writeFileSync(LOOKED, lookedBack); const lb = lookBack(); if (lb) feed(lb); }
    else { const r = recall(); if (r) feed(r); }
    if (!pending.length) feed(`【${tzName} ${day()} ${clock()}】（没在播，她自己待着）`);
    return beat();
  }

  // The note for the mouth: re-read only when the file changes.
  function note() {
    try {
      const st = fs.statSync(NOW_FILE);
      if (st.mtimeMs !== cache.at) cache = { at: st.mtimeMs, text: fs.readFileSync(NOW_FILE, 'utf8').replace(/^# 现在\s*/, '').trim() };
    } catch { cache = { at: 0, text: '' }; }
    return cache.text;
  }

  return { feed, beat, tick, note, clock, get pending() { return pending.length; }, get spent() { return spent; }, get session() { return session; } };
}
