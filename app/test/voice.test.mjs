// The voice service: one stalled fal request is retried, and every request uses the configured voice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { falVoice, doubaoVoice, spokenLang } from '../server/voice.mjs';

test('a failed voice request is retried once with the picked voice and full quality', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-voice-'));
  const bodies = [];
  let calls = 0;
  const fetchImpl = async (url, opts) => {
    if (url.startsWith('https://fal.run/')) {
      bodies.push(JSON.parse(opts.body));
      if (++calls === 1) throw new Error('The operation was aborted due to timeout');
      return { ok: true, status: 200, json: async () => ({ audio: { url: 'https://x/a.mp3' }, duration_ms: 3000 }) };
    }
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  const status = [];
  const voice = falVoice({ key: 'k', dir, voiceId: 'female-tianmei', fetchImpl, status: (r, ok) => status.push(ok) });
  const out = await voice.say('客官里边请', 'happy', 'x1');
  assert.equal(out.url, '/audio/x1.mp3');
  assert.equal(calls, 2);
  assert.deepEqual(status, [true]);
  for (const b of bodies) {
    assert.equal(b.voice_setting.voice_id, 'female-tianmei');
    assert.equal(b.voice_setting.emotion, undefined);
    assert.equal(b.audio_setting.bitrate, 128000);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the Vidu avatar gets raw 24 kHz mono PCM', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-voice-'));
  let body = null;
  const fetchImpl = async (url, opts) => url.startsWith('https://fal.run/')
    ? (body = JSON.parse(opts.body), { ok: true, status: 200, json: async () => ({ audio: { url: 'https://x/a.pcm' }, duration_ms: 1000 }) })
    : { ok: true, arrayBuffer: async () => new ArrayBuffer(48000) };
  const voice = falVoice({ key: 'k', dir, voiceId: 'v', fetchImpl });
  const pcm = await voice.pcm('欸你好喔');
  assert.equal(pcm.length, 48000);
  assert.deepEqual(body.audio_setting, { format: 'pcm', sample_rate: 24000, channel: 1 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Doubao voice: picked speaker and Taiwanese instruction, PCM for Vidu, mp3 for the page, error codes fail cleanly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-doubao-'));
  const sent = [];
  let fail = false;
  const chunk = b => JSON.stringify({ code: 0, data: Buffer.from(b).toString('base64') });
  const fetchImpl = async (url, opts) => {
    sent.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    if (fail) return { ok: true, status: 200, text: async () => JSON.stringify({ code: 45000000, message: 'quota' }) };
    return { ok: true, status: 200, text: async () => [chunk('ab'), chunk('cd'), JSON.stringify({ code: 20000000 })].join('\n') };
  };
  const notes = [];
  const v = doubaoVoice({ key: 'k', dir, voiceId: 'zh_female_xiaohe_uranus_bigtts', context: '用台湾腔说话', fetchImpl, status: (r, ok, err) => notes.push([ok, err]) });
  const pcm = await v.pcm('哈喽');
  assert.equal(pcm.toString(), 'abcd');
  const p = sent[0].body.req_params;
  assert.equal(p.speaker, 'zh_female_xiaohe_uranus_bigtts');
  assert.deepEqual(p.context_texts, ['用台湾腔说话']);
  assert.deepEqual([p.audio_params.format, p.audio_params.sample_rate], ['pcm', 24000]);
  assert.equal(sent[0].headers['X-Api-Resource-Id'], 'seed-tts-2.0');
  const a = await v.say('你好', 'smile', 'line1');
  assert.equal(a.url, '/audio/line1.mp3');
  assert.equal(sent[1].body.req_params.audio_params.format, 'mp3');
  assert.equal(v.used, 4);
  assert.equal(JSON.parse(sent[1].body.req_params.additions).explicit_language, undefined);
  await v.pcm('로봇이라고? 나 밤새 차트 봤거든.');
  assert.equal(JSON.parse(sent[2].body.req_params.additions).explicit_language, 'ko');
  fail = true;
  assert.equal(await v.pcm('再见'), null);
  assert.equal(notes.at(-1)[0], false);
  assert.match(notes.at(-1)[1], /45000000/);
});

// A cloned voice garbles anything but Chinese/English unless the request names the language.
test('spokenLang names the language of a non-Chinese line', () => {
  const cases = [['今晚 BTC 能破 82k 吗', ''], ['ロボット？私、一晩中チャート見てた', 'ja'], ['로봇이라고?', 'ko'], ['Я робот', 'ru'], ['หุ่นยนต์เหรอ', 'th'],
    ['Robot à? Mình xem biểu đồ', 'vi'], ['¿Robot yo? Llevo toda la noche', 'es-mx'], ['Robô, eu? Passei a noite toda', 'pt-br'],
    ["Un robot, moi ? J'ai regardé", 'fr'], ['Coucou Julie, français oui ! Et merci, toi aussi', 'fr'], ['Ein Roboter, ich? Ich habe', 'de'], ['Bitcoin turun lagi ya', 'id'],
    ['Robot? Me? I have been staring at this chart all night', ''], ['The market is red tonight, la la la', ''], ['BTC 81k', ''], ['hahaha', '']];
  for (const [t, want] of cases) assert.equal(spokenLang(t), want, t);
});
