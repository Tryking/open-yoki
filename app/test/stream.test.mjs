// Streamed voice: Doubao's audio goes to Vidu chunk by chunk as it is made, instead of after the whole line.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { doubaoVoice, duoVoice } from '../server/voice.mjs';
import { createAvatar } from '../server/avatar.mjs';

// with an action library bound (as after tools/vidu-actions.mjs) the avatar sends move names, not descriptions
const base = (await import('../idols/example/config.mjs')).default;
const idol = { ...base, avatar: { ...base.avatar, viduActionLib: base.avatar.viduActionLib || 'test-lib' } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const line = (b, extra = {}) => JSON.stringify({ code: 0, data: Buffer.from(b).toString('base64'), ...extra }) + '\n';
// A Doubao-like response body: the given pieces arrive one by one, `ms` apart, cut at arbitrary byte offsets.
function body(text, cuts, ms, log) {
  const all = Buffer.from(text);
  return (async function* () {
    let at = 0;
    for (const c of [...cuts, all.length]) { await sleep(ms); log?.push(Date.now()); yield new Uint8Array(all.subarray(at, c)); at = c; }
  })();
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lh-stream-'));

test('pcmStream: the first chunk comes out while the rest is still arriving; pcm() reads the same stream whole', async () => {
  const dir = tmp(), sent = [], notes = [];
  const text = line('aaaa') + line('bbbb') + line('cc') + JSON.stringify({ code: 20000000 }) + '\n';
  const fetchImpl = async (url, opts) => { sent.push(opts); return { ok: true, status: 200, body: body(text, [5, 30, 31, 50], 60) }; };
  const v = doubaoVoice({ key: 'k', dir, voiceId: 'zh_female_xiaohe_uranus_bigtts', fetchImpl, status: (r, ok, why) => notes.push([ok, why]) });
  const t0 = Date.now(), got = [];
  for await (const b of v.pcmStream('哈喽你好', 'x', undefined)) got.push([Date.now() - t0, b.toString()]);
  assert.deepEqual(got.map(g => g[1]), ['aaaa', 'bbbb', 'cc']);
  assert.ok(got[0][0] < got.at(-1)[0] - 100, `first ${got[0][0]} ms, last ${got.at(-1)[0]} ms`);
  assert.ok(sent[0].signal instanceof AbortSignal);
  assert.equal(v.used, 4);
  assert.deepEqual(notes, [[true, undefined]]);
  assert.equal((await v.pcm('再来')).toString(), 'aaaabbbbcc');
  assert.equal(v.used, 6);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pcmStream: a failure before any audio is retried once; a failure midway stops there and is reported', async () => {
  const dir = tmp(), notes = [];
  let calls = 0, mode = 'retry';
  const fetchImpl = async () => {
    calls++;
    if (mode === 'retry' && calls === 1) throw new Error('The operation was aborted due to timeout');
    if (mode === 'retry') return { ok: true, status: 200, body: body(line('ok'), [], 5) };
    return { ok: true, status: 200, body: body(line('half') + JSON.stringify({ code: 55000000, message: 'server busy' }) + '\n', [], 5) };
  };
  const v = doubaoVoice({ key: 'k', dir, voiceId: 'v', fetchImpl, status: (r, ok, why) => notes.push([ok, why]) });
  const a = [];
  for await (const b of v.pcmStream('第一句')) a.push(b.toString());
  assert.deepEqual(a, ['ok']);
  assert.equal(calls, 2);
  assert.deepEqual(notes.at(-1), [true, undefined]);
  mode = 'midway'; calls = 0;
  const b = [];
  for await (const x of v.pcmStream('第二句')) b.push(x.toString());
  assert.deepEqual(b, ['half']);
  assert.equal(calls, 1, 'a line she has begun is not restarted');
  assert.equal(notes.at(-1)[0], false);
  assert.match(notes.at(-1)[1], /55000000/);
  assert.equal(v.used, 6, 'the begun line still counts toward the cap');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pcmStream: past the daily cap nothing is requested and nothing comes out', async () => {
  const dir = tmp(), notes = [];
  let calls = 0;
  const v = doubaoVoice({ key: 'k', dir, voiceId: 'v', dailyChars: 3, fetchImpl: async () => { calls++; return { ok: true, status: 200, body: body(line('x'), [], 1) }; }, status: (r, ok, why) => notes.push([ok, why]) });
  const out = [];
  for await (const b of v.pcmStream('四个字呀')) out.push(b);
  assert.deepEqual([out.length, calls, v.used], [0, 0, 0]);
  assert.deepEqual(notes, [[false, 'daily cap reached']]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('duoVoice streams each part in its own voice with the gap between, and stops at a part that fails', async () => {
  const calls = [];
  const fake = (name, fails = false) => ({ voiceId: name, used: 0, rmb: 0, provider: 'doubao', say: async () => null, pcm: async () => null,
    async *pcmStream(t, id, tone) { calls.push([name, t, tone]); if (fails) return; yield Buffer.from(name + '1'); await sleep(5); yield Buffer.from(name + '2'); } });
  const dir = tmp();
  const duo = duoVoice({ stage: fake('main'), off: fake('off'), dir });
  const parts = [];
  for await (const b of duo.pcmStream('{东北}卧槽！{/东北}咳，没事喔', 'id', '吐槽')) parts.push(b.length > 100 ? 'GAP' : b.toString());
  assert.deepEqual(parts, ['off1', 'off2', 'GAP', 'main1', 'main2']);
  assert.deepEqual(calls, [['off', '卧槽！', undefined], ['main', '咳，没事喔', '吐槽']]);
  const plain = [];
  for await (const b of duo.pcmStream('只有台湾腔喔', 'id2')) plain.push(b.toString());
  assert.deepEqual(plain, ['main1', 'main2']);
  const broken = duoVoice({ stage: fake('main', true), off: fake('off'), dir });
  const cut = [];
  for await (const b of broken.pcmStream('{东北}妈呀{/东北}好喔')) cut.push(b.length > 100 ? 'GAP' : b.toString());
  assert.deepEqual(cut, ['off1', 'off2'], 'no gap and nothing after the part that failed');
  const noStream = duoVoice({ stage: { ...fake('a'), pcmStream: undefined }, off: fake('b'), dir });
  assert.equal(noStream.pcmStream, undefined, 'without streaming on both voices the avatar reads whole lines');
  fs.rmSync(dir, { recursive: true, force: true });
});

// A local stand-in for Vidu's live API and WebSocket that records what arrives and when.
async function fakeVidu(onBinary) {
  const got = [];
  const server = http.createServer((req, res) => {
    req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ live: { id: 'L1' }, client_secret: 'cs' })); });
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', ws => ws.on('message', (data, binary) => {
    if (binary) { got.push({ type: 'pcm', at: Date.now(), buf: Buffer.from(data) }); return onBinary?.(ws, got); }
    const m = JSON.parse(String(data));
    if (m.type === 1) ws.send(JSON.stringify({ type: 2, payload: { conn_init_ack: { success: true } } }));
    else got.push({ type: m.type, content: m.payload?.text_msg?.content, at: Date.now() });
  }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { got, env: { VIDU_KEY: 'k', VIDU_BASE: `http://127.0.0.1:${server.address().port}` }, stop: () => { wss.close(); server.close(); } };
}
const room = { publisher: () => ({}), appId: 'a', roomId: 'r', publisherId: 'p' };

test('vidu + streamed voice: she starts on the first chunk, after the move lead, and a slow voice never breaks or shifts the frames', async () => {
  const vidu = await fakeVidu();
  const me = { ...idol, avatar: { ...idol.avatar, reactLeadMs: 300 } };
  // Odd-sized chunks with stalls between them: 0.2 s of audio at 50 ms, a 600 ms stall, then the rest.
  const src = Buffer.alloc(48 * 700);
  for (let i = 0; i < src.length; i++) src[i] = (i * 7 + 3) & 0xff;
  const cuts = [48 * 200 + 1, 48 * 230, 48 * 230 + 3, 48 * 600 - 1, src.length], made = [];
  const voice = { pcm: async () => { throw new Error('whole-line path used'); },
    async *pcmStream() {
      let at = 0;
      for (const [i, c] of cuts.entries()) { await sleep(i === 0 ? 50 : i === 2 ? 600 : 20); made.push(Date.now()); yield src.subarray(at, c); at = c; }
    } };
  const av = createAvatar({ idol: me, kind: 'vidu', voice, room, env: vidu.env });
  try {
    await av.open();
    const t0 = Date.now();
    const r = await av.perform({ text: '哈哈你好', action: '捧脸笑', id: 'x' });
    await sleep(50);
    const act = vidu.got.filter(m => m.type === 9).at(-1), said = vidu.got.find(m => m.type === 10), frames = vidu.got.filter(m => m.type === 'pcm');
    assert.equal(act.content, '捧脸笑');
    assert.ok(said.at - act.at >= 280, `lead ${said.at - act.at} ms`);
    assert.ok(frames[0].at >= said.at);
    assert.ok(frames[0].at - t0 < 450, `first frame ${frames[0].at - t0} ms`);
    assert.ok(frames[0].at < made.at(-1), 'the first frame goes out before the voice has finished');
    for (const f of frames) assert.ok(f.buf.length > 0 && f.buf.length % 2 === 0 && f.buf.length <= 4800, `frame ${f.buf.length} bytes`);
    assert.ok(frames.slice(0, -1).every(f => f.buf.length === 4800), 'only the last frame may be short');
    assert.ok(Buffer.concat(frames.map(f => f.buf)).equals(src), 'every byte arrives, in order');
    for (let i = 1; i < frames.length; i++) assert.ok(frames[i].at - frames[i - 1].at >= 75, `frame ${i} came ${frames[i].at - frames[i - 1].at} ms after the last`);
    assert.equal(r.durationMs, 0);
    assert.equal(r.spokenMs, 700);
  } finally { await av.close(); vidu.stop(); }
});

test('vidu + streamed voice: a voice that gives nothing leaves a text-only line; Vidu dropping midway stops the voice request', async () => {
  let closed = false;
  const vidu = await fakeVidu((ws, got) => { if (got.filter(m => m.type === 'pcm').length === 2) ws.send(JSON.stringify({ type: 6, payload: { hangup: { hangup_reason: 'test' } } })); });
  let mode = 'none';
  const voice = { pcm: async () => null,
    async *pcmStream() {
      if (mode === 'none') return;
      try { for (let i = 0; i < 50; i++) { await sleep(30); yield Buffer.alloc(4800); } } finally { closed = true; }
    } };
  const av = createAvatar({ idol: { ...idol, avatar: { ...idol.avatar, reactLeadMs: 0 } }, kind: 'vidu', voice, room, env: vidu.env });
  try {
    await av.open();
    const r = await av.perform({ text: '嗯', id: 'a' });
    assert.equal(r.durationMs, 3500);
    await sleep(50);
    assert.ok(vidu.got.some(m => m.type === 10 && m.content === '嗯'));
    mode = 'drop';
    const t0 = Date.now();
    const d = await av.perform({ text: '我一直说一直说', id: 'b' });
    assert.ok(Date.now() - t0 < 1500, 'she stops when Vidu hangs up');
    assert.ok(d.spokenMs < 1000);
    await sleep(100);
    assert.ok(closed, 'the voice stream was told to stop');
  } finally { await av.close(); vidu.stop(); }
});

// 按句可停: her own musing gives way to a waiting comment at her next pause, never mid-word.
test('vidu + streamed voice: asked to stop, she stops at the next pause after she has said something', async () => {
  const vidu = await fakeVidu();
  const pcmOf = parts => Buffer.concat(parts.map(([ms, amp]) => { const b = Buffer.alloc(ms * 48); for (let i = 0; i + 1 < b.length; i += 2) b.writeInt16LE(i % 4 ? amp : -amp, i); return b; }));
  // a short pause at 0.4 s (too early to stop), talking, the gap between sentences at 1.6 s, then more talking
  const src = pcmOf([[400, 8000], [200, 0], [1000, 8000], [300, 0], [1000, 8000]]);
  const voice = { pcm: async () => src, async *pcmStream() { for (let at = 0; at < src.length; at += 9600) { await sleep(5); yield src.subarray(at, at + 9600); } } };
  const av = createAvatar({ idol: { ...idol, avatar: { ...idol.avatar, reactLeadMs: 0 } }, kind: 'vidu', voice, room, env: { ...vidu.env, AV_TIMING: process.env.AV_TIMING } });
  try {
    await av.open();
    let asks = 0;
    const r = await av.perform({ text: '我刚才在想啊，今天这个盘。然后呢', id: 'c', cut: () => { asks++; return true; } });
    assert.equal(r.cut, true);
    assert.equal(r.spokenMs, 1600, 'stopped at the gap between sentences, not at the early pause');
    assert.ok(asks >= 1);
    const whole = await av.perform({ text: '一口气说完', id: 'd', cut: () => false });
    assert.equal(whole.spokenMs, 2900);
    assert.equal(whole.cut, undefined);
    const plain = await av.perform({ text: '没人打断', id: 'e' });
    assert.equal(plain.spokenMs, 2900);
  } finally { await av.close(); vidu.stop(); }
});

test('saidPart: what she got out before stopping, ended at a natural break', async () => {
  const { saidPart } = await import('../server/voice.mjs');
  assert.equal(saidPart('我刚才在想啊，今天这个盘真的好怪。然后呢我就', 230 * 7), '我刚才在想啊');
  assert.equal(saidPart('今天这个盘真的好怪。然后呢', 230 * 9), '今天这个盘真的好怪');
  assert.equal(saidPart('嗯', 5000), '嗯');
  assert.equal(saidPart('没有标点的一长串话一直说下去', 230 * 4), '没有标点');
});

// 微表情: a long line gets a second, small face about halfway in; a short one doesn't.
test('vidu: a long line gets its small second face partway through, a short line only its own move', async () => {
  const vidu = await fakeVidu();
  const src = Buffer.alloc(6500 * 48, 1);
  const voice = { pcm: async () => src, async *pcmStream() { for (let at = 0; at < src.length; at += 9600) { await sleep(5); yield src.subarray(at, at + 9600); } } };
  const av = createAvatar({ idol: { ...idol, fidget: null, avatar: { ...idol.avatar, reactLeadMs: 0 } }, kind: 'vidu', voice, room, env: vidu.env });
  try {
    await av.open();
    await av.perform({ text: '我跟你说，今天这个盘真的有点意思，你们看这根线拉得多好看呀', action: '抿嘴笑', beat: '眯眼笑', id: 'l' });
    await sleep(50);
    const acts = vidu.got.filter(m => m.type === 9), first = vidu.got.find(m => m.type === 'pcm');
    assert.deepEqual(acts.map(a => a.content), ['抿嘴笑', '眯眼笑']);
    const at = acts[1].at - first.at;
    assert.ok(at >= 2500 && at < 3500, `second face ${at} ms into the line`);   // halfway, from 2.5 s
    vidu.got.length = 0;
    await sleep(4100);
    await av.perform({ text: '对呀', action: '点头', beat: '眯眼笑', id: 's' });
    await sleep(50);
    assert.deepEqual(vidu.got.filter(m => m.type === 9).map(a => a.content), ['点头']);
  } finally { await av.close(); vidu.stop(); }
});
