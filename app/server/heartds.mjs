// Her heart straight on DeepSeek. Through the claude CLI the model first reads "You are Claude Code…", 18 coding
// tools and thinking mode, and her diary comes out sounding like an assistant's report. Here it gets her own system
// prompt, five small file tools for her home and nothing else, thinking off. Same result shape as the CLI's
// `--output-format json`, so heart.mjs and fallbackRunner do not know the difference.
// The conversation lives in sessionDir/<id>.json (not in the CLI's store), so resume works across a restart.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// USD per 1M tokens. A rough estimate of DeepSeek's list price, only for the cost log, not billing.
export const DS_PRICE = { hit: 0.07, miss: 0.56, out: 1.68 };
const FFFD = /\uFFFD+/g, MAX_READ = 20e3, MAX_FILE = 1 << 20, OLD = '（已读过）', KEEP_DAYS = 3;
const WRITABLE = /\.(md|txt|json)$/i;

export const DS_TOOLS = [
  ['list_dir', '看家里某个文件夹里有什么（文件夹名后面带 /）。', { path: { type: 'string', description: '相对家里的路径，家本身是 .' } }, ['path']],
  ['read_file', '读一个文件。长文件可以按行读：offset 从第几行开始（从 1 数），limit 读几行。', { path: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } }, ['path']],
  ['write_file', '写一个文件（整份覆盖，没有就新建，文件夹自动建）。只能写 .md .txt .json。', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']],
  ['edit_file', '把文件里的一段原文换成新的。原文要一字不差，而且只出现一次。', { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } }, ['path', 'old', 'new']],
  ['append_file', '在文件末尾接着写（没有就新建）。只能写 .md .txt .json。', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']],
].map(([name, description, properties, required]) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } }));

// A path she gave, resolved inside her home or null. Comments are other people's words and someone will ask her to
// read /etc/passwd or ../.state; realpath on the part that exists also catches a symlink pointing out (even a dangling one).
export function inside(cwd, p) {
  if (typeof p !== 'string' || !p.trim() || path.isAbsolute(p) || p.includes('\0')) return null;
  let root; try { root = fs.realpathSync(cwd); } catch { return null; }
  let cur = path.resolve(root, p), rest = [];
  for (;;) {
    let st = null; try { st = fs.lstatSync(cur); } catch {}
    if (st) { let real; try { real = fs.realpathSync(cur); } catch { return null; } cur = path.join(real, ...rest); break; }
    const up = path.dirname(cur); if (up === cur) return null;
    rest.unshift(path.basename(cur)); cur = up;
  }
  return cur === root || cur.startsWith(root + path.sep) ? cur : null;
}

const NO = '不行：只能在家里读写';
export function runTool(cwd, name, args, wrote) {
  const clean = s => String(s ?? '').replace(FFFD, '');
  const f = inside(cwd, args?.path ?? (name === 'list_dir' ? '.' : undefined));
  if (!f) return NO;
  const writing = /^(write|edit|append)_file$/.test(name);
  if (writing && !WRITABLE.test(f)) return '不行：只能写 .md .txt .json 文件';
  try {
    if (name === 'list_dir') return fs.readdirSync(f, { withFileTypes: true }).map(d => d.name + (d.isDirectory() ? '/' : '')).sort().join('\n') || '（空的）';
    if (name === 'read_file') {
      const st = fs.statSync(f);
      if (st.isDirectory()) return '不行：这是个文件夹，用 list_dir';
      if (st.size > MAX_FILE) return '不行：文件太大（超过 1MB）';
      let lines = fs.readFileSync(f, 'utf8').replace(FFFD, '').split('\n');
      const from = Math.max(1, Number(args.offset) || 1);
      lines = lines.slice(from - 1, args.limit ? from - 1 + Math.max(1, Number(args.limit) || 1) : undefined);
      const t = lines.join('\n');
      return t.length > MAX_READ ? t.slice(0, MAX_READ) + '\n…（后面还有，用 offset 按行接着读）' : t || '（空文件）';
    }
    if (name === 'write_file' || name === 'append_file') {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      (name === 'write_file' ? fs.writeFileSync : fs.appendFileSync)(f, clean(args.content));
      wrote.add(f); return '好了';
    }
    if (name === 'edit_file') {
      const old = clean(args.old), now = fs.readFileSync(f, 'utf8');
      if (!old) return '不行：原文是空的';
      const n = now.split(old).length - 1;
      if (!n) return '不行：没找到这段原文，先 read_file 看看现在写的是什么';
      if (n > 1) return `不行：这段原文出现了 ${n} 次，多带一点前后文`;
      fs.writeFileSync(f, now.replace(old, () => clean(args.new)));
      wrote.add(f); return '好了';
    }
    return '不行：没有这个工具';
  } catch (err) { return '不行：' + (err.code === 'ENOENT' ? '没有这个文件' : String(err.code || err.message).slice(0, 80)); }
}

// Old tool results are the bulk of a long session (her whole diary, read again and again); beyond the last `keep`
// beats only the fact that she read it stays. A beat starts at a user message.
export function shrink(messages, keep = 2) {
  const starts = messages.flatMap((m, i) => m.role === 'user' ? [i] : []);
  const cut = starts.length > keep ? starts[starts.length - keep] : 0;
  return messages.map((m, i) => i < cut && m.role === 'tool' && m.content !== OLD ? { ...m, content: OLD } : m);
}

// `extra` (e.g. web.mjs): more tools besides her files, { tools, run(name, args) → text }; her way out to the world.
export function dsRunner({ key, model, sessionDir, temperature = 1.0, maxTokens = 1500, timeoutMs = 150e3, maxRounds = 12,
  base = 'https://api.deepseek.com', fetchImpl = fetch, price = DS_PRICE, extra = null }) {
  // read each beat: the extra tools may come and go (web.mjs: off air only)
  const extraTools = () => extra?.tools || [];
  fs.mkdirSync(sessionDir, { recursive: true });
  const file = id => path.join(sessionDir, `${id}.json`);
  const scrub = s => String(s || '').split(key || '\0').join('***').replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***').replace(/\*{2,}[A-Za-z0-9]+/g, '***');
  function prune() {
    const old = Date.now() - KEEP_DAYS * 86400e3;
    for (const f of fs.readdirSync(sessionDir)) {
      if (!f.endsWith('.json')) continue;
      try { if (fs.statSync(path.join(sessionDir, f)).mtimeMs < old) fs.rmSync(path.join(sessionDir, f)); } catch {}
    }
  }

  return async ({ cwd, system, message, resume }) => {
    const signal = AbortSignal.timeout(timeoutMs);
    let id = resume && /^[\w-]{1,80}$/.test(resume) ? resume : null, hist = [], total = 0;
    if (id) { try { const s = JSON.parse(fs.readFileSync(file(id), 'utf8')); hist = shrink(s.messages || []); total = Number(s.total) || 0; } catch { id = null; } }
    if (!id) { id = randomUUID(); prune(); }
    const msgs = [...hist, { role: 'user', content: String(message || '').replace(FFFD, '') }];
    const usage = { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 };
    const wrote = new Set(), more = extraTools(), tools = [...DS_TOOLS, ...more], extraNames = new Set(more.map(t => t.function.name));

    async function call(last) {
      let r;
      try {
        r = await fetchImpl(`${base}/chat/completions`, { method: 'POST', signal,
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...msgs], temperature, max_tokens: maxTokens,
            thinking: { type: 'disabled' }, tools, ...(last ? { tool_choice: 'none' } : {}) }) });
      } catch (err) {
        if (signal.aborted) throw new Error('heart beat timed out');
        throw new Error('deepseek: ' + scrub(err.message).slice(0, 120));
      }
      const j = await r.json().catch(() => ({}));
      if (signal.aborted) throw new Error('heart beat timed out');
      const m = j?.choices?.[0]?.message;
      if (!r.ok || !m) throw new Error(`deepseek ${r.status} ${scrub(j?.error?.message).slice(0, 120)}`);
      const u = j.usage || {}, hit = u.prompt_cache_hit_tokens || 0, miss = u.prompt_cache_miss_tokens ?? Math.max(0, (u.prompt_tokens || 0) - hit);
      // the heart reads input + cache as how big the context is now (maxContext): the last call's prompt, not a sum
      usage.input_tokens = miss; usage.cache_read_input_tokens = hit; usage.output_tokens += u.completion_tokens || 0;
      total += (hit * price.hit + miss * price.miss + (u.completion_tokens || 0) * price.out) / 1e6;
      return m;
    }

    let m = null, used = 0;
    for (let round = 0; round < maxRounds; round++) {
      m = await call(false);
      if (!m.tool_calls?.length) break;
      used += m.tool_calls.length;
      msgs.push({ role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls });
      for (const tc of m.tool_calls) {
        let args; try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = null; }
        const name = tc.function?.name;
        const out = !args ? '不行：参数不是 JSON' : extraNames.has(name) ? String(await extra.run(name, args).catch(err => '没打开：' + scrub(err.message).slice(0, 60))).replace(FFFD, '') : runTool(cwd, name, args, wrote);
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: out });
      }
      m = null;
    }
    if (!m) m = await call(true);   // maxRounds of tools: one last call to put it into words
    const result = String(m.content || '').replace(FFFD, '').trim();
    if (!result && !wrote.size) throw new Error('heart: empty answer');
    msgs.push({ role: 'assistant', content: result });
    fs.writeFileSync(file(id), JSON.stringify({ model, total, messages: msgs }));
    // tools: how many she used this beat; the heart starts over a session where she only talks
    return { result, session_id: id, total_cost_usd: total, usage, tools: used };
  };
}
