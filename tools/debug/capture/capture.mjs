#!/usr/bin/env node
// Capture what really goes to the model. Point your app (or the agent shell your heart runs in) at this fake API
// instead of the real one, trigger one beat or one line, and read exactly which system prompt, tool list, thinking
// setting and temperature were sent. Wrappers often add far more than you think (an agent shell can put tens of
// thousands of characters of its own instructions in front of your persona).
//
//   node capture.mjs [--port 8787] [--out captured.jsonl]
//   then set your app's base URL to http://127.0.0.1:8787 (OpenAI-style /v1/chat/completions and
//   Anthropic-style /v1/messages both answer with a short dummy reply)
//   node capture.mjs --show captured.jsonl      summary of what was captured
// Authorization / api-key headers are dropped before anything is written.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function summarize(req) {
  const b = req.body || {};
  const sys = typeof b.system === 'string' ? b.system : Array.isArray(b.system) ? b.system.map(s => s.text || '').join('\n') : (b.messages || []).filter(m => m.role === 'system').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
  const tools = (b.tools || []).map(t => t.name || t.function?.name).filter(Boolean);
  return {
    path: req.path, model: b.model, system_chars: sys.length, system_start: sys.slice(0, 160),
    messages: (b.messages || []).length, tools: tools.length, tool_names: tools.slice(0, 20), tools_chars: JSON.stringify(b.tools || []).length,
    temperature: b.temperature ?? '(not set)', thinking: b.thinking ? JSON.stringify(b.thinking) : b.reasoning ? JSON.stringify(b.reasoning) : '(not set)', max_tokens: b.max_tokens,
  };
}

export function start({ port = 8787, out = 'captured.jsonl' } = {}) {
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', d => (raw += d));
    req.on('end', () => {
      let body; try { body = JSON.parse(raw || '{}'); } catch { body = { raw }; }
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !/authorization|api-key|x-api-key|cookie/i.test(k)));
      const rec = { at: new Date().toISOString(), method: req.method, path: req.url, headers, body };
      fs.appendFileSync(out, JSON.stringify(rec) + '\n');
      const s = summarize(rec);
      console.log(`${s.path} model=${s.model} system=${s.system_chars} chars, ${s.tools} tools (${s.tools_chars} chars), temperature=${s.temperature}, thinking=${s.thinking}`);
      res.setHeader('content-type', 'application/json');
      if (/\/messages/.test(req.url)) res.end(JSON.stringify({ id: 'cap', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: '(captured)' }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } }));
      else res.end(JSON.stringify({ id: 'cap', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: '(captured)' }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0 } }));
    });
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r(srv)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  if (opt('--show')) {
    for (const l of fs.readFileSync(opt('--show'), 'utf8').split('\n').filter(Boolean)) console.log(JSON.stringify(summarize(JSON.parse(l)), null, 1));
  } else {
    const srv = await start({ port: Number(opt('--port') || 8787), out: opt('--out') || 'captured.jsonl' });
    console.log(`listening on http://127.0.0.1:${srv.address().port}, writing ${opt('--out') || 'captured.jsonl'}`);
  }
}
