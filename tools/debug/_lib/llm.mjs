// Minimal model adapters shared by the debug tools.
// A "provider" config is a plain object:
//   { name, provider: 'openai', base_url, model, key_env, temperature, max_tokens, extra }
//       any OpenAI-compatible /chat/completions endpoint (OpenRouter, DeepSeek, a local server ...)
//       the key is read from process.env[key_env] and never printed
//   { name, provider: 'command', cmd }
//       runs `cmd` in a shell, writes {system, messages, model} as JSON to stdin, takes stdout as the answer;
//       use this to plug in your own brain/prompt builder instead of a bare model
//   { name, provider: 'mock', replies?: [...] }
//       offline, deterministic; used by the self-tests
import { spawn } from 'node:child_process';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function makeAsk(cfg) {
  const p = cfg.provider || 'openai';
  if (p === 'mock') {
    let i = 0;
    return async ({ messages }) => {
      const last = messages.filter(m => m.role === 'user').at(-1)?.content || '';
      const text = cfg.replies?.length ? cfg.replies[i++ % cfg.replies.length] : `${cfg.name || 'mock'} heard: ${String(last).slice(0, 40)}`;
      return { text, ms: 1, cost: 0 };
    };
  }
  if (p === 'command') {
    return ({ system, messages }) => new Promise((resolve, reject) => {
      const t0 = Date.now();
      const ch = spawn(cfg.cmd, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '', err = '';
      ch.stdout.on('data', d => (out += d));
      ch.stderr.on('data', d => (err += d));
      ch.on('error', reject);
      ch.on('close', code => code === 0 ? resolve({ text: out.trim(), ms: Date.now() - t0, cost: 0 })
        : reject(new Error(`command exited ${code}: ${err.slice(0, 200)}`)));
      ch.stdin.end(JSON.stringify({ system, messages, model: cfg.model || null }));
    });
  }
  if (p === 'openai') {
    const key = cfg.key_env ? process.env[cfg.key_env] : '';
    if (cfg.key_env && !key) throw new Error(`${cfg.name || cfg.model}: environment variable ${cfg.key_env} is empty`);
    const url = String(cfg.base_url || '').replace(/\/$/, '') + '/chat/completions';
    return async ({ system, messages, temperature, max_tokens }) => {
      const body = {
        model: cfg.model,
        messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
        temperature: temperature ?? cfg.temperature ?? 1.0,
        max_tokens: max_tokens ?? cfg.max_tokens ?? 400,
        ...(cfg.extra || {}),
      };
      for (let i = 0; ; i++) {
        const t0 = Date.now();
        try {
          const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) });
          const j = await r.json();
          if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
          return { text: (j.choices?.[0]?.message?.content || '').trim(), ms: Date.now() - t0, cost: j.usage?.cost || 0 };
        } catch (e) {
          // flaky networks drop connections now and then; retry those twice, fail on anything else
          if (i >= 2 || !/fetch failed|ECONN|socket|ETIMEDOUT/i.test(String(e.message))) throw e;
          await sleep(3000);
        }
      }
    };
  }
  throw new Error(`unknown provider "${p}"`);
}

// Ask with an audio clip attached (OpenAI-compatible "input_audio" content parts). Used by voice-audition/ear.mjs.
export function makeListen(cfg) {
  // mock: labels every clip with cfg.label (default calm/neutral); the second argument is the list of clip names
  if ((cfg.provider || 'openai') === 'mock') return async (content, names = []) => ({ text: names.map((_, k) => `clip ${k + 1} | ${cfg.label || 'calm/neutral'} | 5 | none`).join('\n'), ms: 0, cost: 0 });
  const ask = makeAsk(cfg);
  return async (content) => ask({ messages: [{ role: 'user', content }] });
}
