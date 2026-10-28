// The host's fallback voice: fal MiniMax Speech 2.8 Turbo ($0.06 per 1000 characters, about 5 s per 60-character line).
// Lines are saved under data/audio and served from /audio/. A daily character cap keeps the bill bounded;
// past it, or when fal fails, she keeps talking in text only (each route fails on its own).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const VOICE = { model: 'fal-ai/minimax/speech-2.8-turbo', usdPerChar: 0.00006 };
// fal's default 128 kbps / 32 kHz and no emotion setting: a 64 kbps copy and per-face emotions made the voice sound
// like a different person from line to line.
const AUDIO = { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 };

export function falVoice({ key, dir, dailyChars = 60000, voiceId, speed = 1.05, fetchImpl = fetch, now = () => Date.now(), keepFiles = 300, tries = 2, timeoutMs = 20000, status }) {
  fs.mkdirSync(dir, { recursive: true });
  let day = '', used = 0;
  const today = () => new Date(now() + 8 * 3600e3).toISOString().slice(0, 10);

  async function say(text, face, id) {
    if (today() !== day) { day = today(); used = 0; }
    if (used + text.length > dailyChars) { status?.('voice', false, 'daily cap reached'); return null; }
    const voice_setting = { voice_id: voiceId, speed };
    // fal now and then sits on one request past the timeout (a line goes silent); one retry covers it.
    for (let attempt = 1; ; attempt++) {
      const r = await once(text, voice_setting, id).catch(err => ({ err }));
      if (!r.err) { used += text.length; prune(); status?.('voice', true); return r; }
      if (attempt >= tries) { const why = String(r.err.message || r.err).slice(0, 120); status?.('voice', false, why); console.warn('voice failed: ' + why); return null; }
    }
  }

  async function synth(text, voice_setting, audio_setting) {
    const r = await fetchImpl(`https://fal.run/${VOICE.model}`, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, voice_setting, language_boost: /[一-鿿]/.test(text) ? 'Chinese' : 'English', audio_setting, output_format: 'url' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.audio?.url) throw new Error(`fal ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
    const a = await fetchImpl(j.audio.url, { signal: AbortSignal.timeout(20000) });
    if (!a.ok) throw new Error('audio download ' + a.status);
    return { buf: Buffer.from(await a.arrayBuffer()), durationMs: j.duration_ms || text.length * 220 };
  }
  async function once(text, voice_setting, id) {
    const { buf, durationMs } = await synth(text, voice_setting, AUDIO);
    const file = `${id}.mp3`;
    fs.writeFileSync(path.join(dir, file), buf);
    return { url: `/audio/${file}`, durationMs };
  }

  // Raw 24 kHz mono s16le PCM for the Vidu component avatar (its WebSocket takes exactly this). MiniMax's pcm output
  // at 24 kHz is from its API docs; not yet run through fal.
  async function pcm(text) {
    if (today() !== day) { day = today(); used = 0; }
    if (used + text.length > dailyChars) { status?.('voice', false, 'daily cap reached'); return null; }
    try {
      const { buf } = await synth(text, { voice_id: voiceId, speed }, { format: 'pcm', sample_rate: 24000, channel: 1 });
      used += text.length; status?.('voice', true);
      return buf;
    } catch (err) { status?.('voice', false, String(err.message || err).slice(0, 120)); return null; }
  }

  function prune() {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp3')).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keepFiles)) fs.rmSync(path.join(dir, f), { force: true });
  }

  return { say, pcm, voiceId, get used() { return used; }, dailyChars, get usd() { return used * VOICE.usdPerChar; } };
}

// Doubao (Volcano Engine) speech synthesis 2.0, the main voice: a stock voice or the host's own cloned voice (slot
// DOUBAO_VOICE_ID), with a context sentence for the delivery. 3 RMB per 10k characters; first audio about 0.4 s,
// a 30-character line about 1.4 s. It returns 24 kHz PCM directly, which is what the Vidu component takes.
export const DOUBAO = { resource: 'seed-tts-2.0', rmbPerChar: 0.0003 };
// A cloned voice (a slot id S_…, voice cloning 2.0) is billed and served under its own resource.
export const doubaoResource = voiceId => /^S_/.test(voiceId || '') ? 'seed-icl-2.0' : DOUBAO.resource;

// Her cloned voice reads a line in another language as Chinese-accented gibberish unless the request names the
// language (Korean/Japanese/Spanish/Vietnamese come out garbled; with explicit_language all of ja, ko, es, pt, fr,
// de, ru, th, vi, id read right in her own voice, checked with Whisper). Chinese lines (and English, which reads fine
// either way) keep the plain request.
const SCRIPTS = [['ja', /[\u3040-\u30ff]/], ['ko', /[\uac00-\ud7af\u1100-\u11ff]/], ['ru', /[\u0400-\u04ff]/], ['th', /[\u0e00-\u0e7f]/]];
const LATIN = [
  ['vi', /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệịỉĩọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i, null],
  ['es-mx', /[¿¡ñ]/i, /\b(que|los|las|yo|tú|pero|muy|sigue|toda|noche|está|estoy|también|hola|gracias|porque)\b/gi],
  ['pt-br', /[ãõôê]/i, /\b(eu|você|não|muito|obrigad[oa]|olá|está|também|porque|uma|isso|então)\b/gi],
  ['fr', /[œàèùâîûëç]/i, /\b(je|j'ai|suis|tu|vous|moi|toi|aussi|est|c'est|pas|très|merci|bonjour|oui|avec|pour|mais)\b/gi],
  ['de', /[ßäöü]/i, /\b(ich|du|nicht|und|ist|das|sehr|danke|hallo|auch|aber|mit|ein|eine)\b/gi],
  ['id', null, /\b(aku|kamu|yang|tidak|nggak|gak|sudah|udah|banget|masih|ini|itu|juga|sama|dong|deh|kok|lagi|turun|naik|ya)\b/gi],
];
export function spokenLang(text) {
  const t = String(text || '');
  for (const [code, re] of SCRIPTS) if (re.test(t)) return code;
  if (/[\u3400-\u9fff]/.test(t) || !/[a-z]{2}/i.test(t)) return '';
  let best = '', score = 0;
  for (const [code, mark, words] of LATIN) {
    const hit = mark && mark.test(t), w = words ? (t.match(words) || []).length : 0, n = (hit ? 2 : 0) + w;
    if ((hit || w >= 2) && n > score) { best = code; score = n; }
  }
  return best;
}

// tones: per-line delivery the brain may pick ({ 吐槽: { context, speed } }, from the idol config); an unknown or missing tone reads
// with the voice's own context and speed.
export function doubaoVoice({ key, dir, dailyChars = 60000, voiceId, context = '', dialect = '', speed = 0, tones = {}, fetchImpl = fetch, now = () => Date.now(), keepFiles = 300, tries = 2, timeoutMs = 20000, status }) {
  fs.mkdirSync(dir, { recursive: true });
  const baseContext = context;
  let day = '', used = 0, lastUse = 0;
  const today = () => new Date(now() + 8 * 3600e3).toISOString().slice(0, 10);
  const room = text => { if (today() !== day) { day = today(); used = 0; } return used + text.length <= dailyChars; };

  // One streamed request: newline-separated JSON chunks, each with base64 audio in `data`. Yields each chunk's audio
  // as it arrives (the first comes in ~0.4 s, the whole of a long line only after ~2.4 s); stopping early
  // aborts the request.
  async function* request(text, format, tone) {
    const t = tones[tone] || {};
    const context = t.context ?? baseContext, speech_rate = t.speed ?? speed;
    const req_params = { text, speaker: voiceId, audio_params: { format, sample_rate: 24000, speech_rate } };
    // dialect: Doubao's own dialect mode (explicit_dialect, e.g. 'dongbei'; only some voices take it, see Doubao's docs).
    const lang = spokenLang(text);
    const additions = { ...(context ? { context_texts: [context] } : {}), ...(dialect ? { explicit_dialect: dialect } : {}), ...(lang ? { explicit_language: lang } : {}) };
    if (context) req_params.context_texts = [context];
    if (context || dialect || lang) req_params.additions = JSON.stringify(additions);
    lastUse = now();
    const stop = new AbortController();
    try {
      const r = await fetchImpl('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
        method: 'POST', signal: AbortSignal.any([stop.signal, AbortSignal.timeout(timeoutMs)]),
        headers: { 'X-Api-Key': key, 'X-Api-Resource-Id': doubaoResource(voiceId), 'X-Api-Request-Id': randomUUID(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ req_params }),
      });
      let got = 0;
      for await (const line of lines(r)) {
        if (!line.trim()) continue;
        const j = JSON.parse(line);
        if (j.code && j.code !== 20000000) throw new Error(`doubao ${j.code} ${String(j.message).slice(0, 100)}`);
        if (j.data) { got++; yield Buffer.from(j.data, 'base64'); }
      }
      if (!r.ok || !got) throw new Error(`doubao ${r.status} no audio`);
    } finally { stop.abort(); }
  }
  async function synth(text, format, tone) {
    const parts = [];
    for await (const b of request(text, format, tone)) parts.push(b);
    return Buffer.concat(parts);
  }
  async function retry(text, format, tone) {
    for (let attempt = 1; ; attempt++) {
      try { const buf = await synth(text, format, tone); used += text.length; status?.('voice', true); return buf; }
      catch (err) { if (attempt >= tries) { const why = String(err.message || err).slice(0, 120); status?.('voice', false, why); console.warn('voice failed: ' + why); return null; } }
    }
  }

  async function say(text, face, id, tone) {
    if (!room(text)) { status?.('voice', false, 'daily cap reached'); return null; }
    const buf = await retry(text, 'mp3', tone);
    if (!buf) return null;
    const file = `${id}.mp3`;
    fs.writeFileSync(path.join(dir, file), buf);
    prune();
    return { url: `/audio/${file}`, durationMs: Math.round(buf.length / 8) };   // Doubao mp3 is 64 kbps: 8 bytes per ms
  }
  async function pcm(text, id, tone) {
    if (!room(text)) { status?.('voice', false, 'daily cap reached'); return null; }
    return retry(text, 'pcm', tone);
  }
  // pcm() as it is made, chunk by chunk, so Vidu can start on the first one. Same cap, billing and status; a
  // request that fails before any audio is retried, one that fails midway stops there (no restarting a line she has
  // begun). The line is counted at its first chunk: Doubao has started billing it by then. Yields nothing on failure.
  async function* pcmStream(text, id, tone) {
    if (!room(text)) { status?.('voice', false, 'daily cap reached'); return; }
    for (let attempt = 1; ; attempt++) {
      let started = false;
      try {
        for await (const b of request(text, 'pcm', tone)) {
          if (!started) { started = true; used += text.length; }
          yield b;
        }
        status?.('voice', true);
        return;
      } catch (err) {
        if (!started && attempt < tries) continue;
        const why = String(err.message || err).slice(0, 120);
        status?.('voice', false, why); console.warn('voice failed' + (started ? ' midway: ' : ': ') + why);
        return;
      }
    }
  }
  function prune() {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp3')).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keepFiles)) fs.rmSync(path.join(dir, f), { force: true });
  }

  // A free request to the same host so the open connection never idles out (nothing is synthesized or billed).
  async function warm(idleMs = 40e3) {
    if (now() - lastUse < idleMs) return false;
    lastUse = now();
    try { const r = await fetchImpl('https://openspeech.bytedance.com/', { signal: AbortSignal.timeout(5000) }); await r.arrayBuffer?.(); } catch {}
    return true;
  }
  return { say, pcm, pcmStream, warm, voiceId, tones: Object.keys(tones), provider: 'doubao', get used() { return used; }, dailyChars, get rmb() { return used * DOUBAO.rmbPerChar; } };
}

// A fetch response's body line by line as it arrives; a response without a readable body is read whole.
async function* lines(r) {
  if (!r.body) { yield* (await r.text()).split('\n'); return; }
  const dec = new TextDecoder();
  let rest = '';
  for await (const b of r.body) {
    rest += dec.decode(b, { stream: true });
    const ls = rest.split('\n');
    rest = ls.pop();
    yield* ls;
  }
  yield rest + dec.decode();
}

// Two voices (optional, idol.avatar.doubaoOff): a host with an on-stage persona may now and then slip into her
// "real self" in a second voice. A slip is marked in the line as {东北}…{/东北} (the marker name is historical; any
// second voice works); this voice reads each part with its own voice and joins them (mp3 for the page, 24 kHz PCM
// for Vidu).
export const SLIP_RE = /\{东北\}([\s\S]*?)\{\/东北\}/g;
export function splitSlip(text) {
  const parts = [];
  let at = 0;
  for (const m of String(text).matchAll(SLIP_RE)) {
    if (m.index > at) parts.push({ off: false, text: text.slice(at, m.index) });
    parts.push({ off: true, text: m[1] });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ off: false, text: text.slice(at) });
  return parts.map(p => ({ ...p, text: p.text.trim() })).filter(p => p.text);
}
export const plainText = text => String(text).replace(SLIP_RE, '$1');
// Roughly what of a line went out before she stopped at a pause (按句可停): ~230 ms a character, ended at the last
// sentence or comma break that fits, so her own record of what she said reads like where she really stopped.
export function saidPart(text, spokenMs, msPerChar = 230) {
  const t = plainText(text), n = Math.max(1, Math.round(spokenMs / msPerChar));
  if (n >= t.length) return t;
  const head = t.slice(0, n + 2), at = Math.max(...[...'。！？!?，,；;…～~'].map(c => head.lastIndexOf(c)));
  return (at >= 2 ? t.slice(0, at) : t.slice(0, n)).replace(/[，,；;、\s]+$/, '');
}

export function duoVoice({ stage, off, dir, keepFiles = 300 }) {
  const GAP_PCM = Buffer.alloc(24000 * 2 * 0.35);   // 0.35 s of silence between the two voices
  async function join(text, read, gap) {
    const parts = splitSlip(text), bufs = [];
    for (const p of parts) {
      const b = await read(p.off ? off : stage, p.text);
      if (!b) return null;
      if (bufs.length && gap) bufs.push(gap);
      bufs.push(b);
    }
    return bufs.length ? Buffer.concat(bufs) : null;
  }
  // Two Doubao mp3s glued together carry two ID3/Xing headers and players stop at the first part's length, so a slip
  // goes to the page as one WAV built from the same PCM Vidu gets (only the mock avatar plays it; Vidu speaks itself).
  async function say(text, face, id, tone) {
    if (!String(text).includes('{东北}')) return stage.say(text, face, id, tone);
    const pcm = await join(text, (v, t) => v.pcm(t), GAP_PCM);
    if (!pcm) return null;
    const head = Buffer.alloc(44);
    head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVEfmt ', 8);
    head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(24000, 24);
    head.writeUInt32LE(48000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
    const file = `${id}.wav`;
    fs.writeFileSync(path.join(dir, file), Buffer.concat([head, pcm]));
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.wav')).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keepFiles)) fs.rmSync(path.join(dir, f), { force: true });
    return { url: `/audio/${file}`, durationMs: Math.round(pcm.length / 48) };
  }
  const pcm = text => join(text, (v, t) => v.pcm(t), GAP_PCM);
  // Streamed: each part streams in its own voice, in order, with the gap just before the next part's first
  // chunk. A part that fails ends the line there (its voice has reported it); a slip line no longer goes all-or-nothing.
  async function* pcmStream(text, id, tone) {
    let any = false;
    for (const p of splitSlip(text)) {
      let none = true;
      for await (const b of (p.off ? off : stage).pcmStream(p.text, id, p.off ? undefined : tone)) {
        if (none && any) yield GAP_PCM;
        none = false; any = true;
        yield b;
      }
      if (none) return;
    }
  }
  const streams = !!(stage.pcmStream && off.pcmStream);
  return { say, pcm, ...(streams ? { pcmStream } : {}), warm: () => stage.warm?.(), voiceId: stage.voiceId, offVoiceId: off.voiceId, provider: stage.provider, dailyChars: stage.dailyChars,
    get used() { return stage.used + off.used; }, get rmb() { return stage.rmb + off.rmb; } };
}
