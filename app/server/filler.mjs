// 先垫一声: a real host goes "嗯嗯", "哈哈哈" or "啊这" the moment a comment lands, before she has an
// answer; ours sat silent for 3+ s while the line was written and voiced. A handful of short sounds in her own cloned
// voice are made once (cached as 24 kHz PCM under dataDir/fillers) and one goes out as soon as a comment arrives,
// picked by what the comment is about. Never while she is talking, at most once per gapMs, and not every time
// (chance), so it reads as a habit rather than a jingle. idol.fillers: { kind: { tone, says: [...], act: [...] } }, a say
// either a string (the kind's tone) or { say, tone };
// act is the face/hand move that goes with the sound (her reaction shows at once, so the answer needs no lead of its own).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// What kind of comment it is, from its words alone (no model: this has to be instant).
const KINDS = [
  ['laugh', /哈哈|hhh|233|笑死|绷不住|乐|xswl|lol|lmao/i],
  ['sad', /亏|爆仓|爆了|割|套|跌|归零|难受|完了|没了|血亏|裂开|哭|emo|累/i],
  ['praise', /好看|漂亮|美|可爱|喜欢你|爱你|女神|声音好听/i],
  ['wow', /卧槽|我靠|牛|涨了|拉盘|起飞|翻倍|赚了|暴涨|!{2,}|！{2,}/i],
  ['ask', /[?？]|吗|么|怎么|多少|为什么|能不能|会不会|几|哪/],
];
export function fillerKind(text) {
  for (const [kind, re] of KINDS) if (re.test(String(text || ''))) return kind;
  return 'hm';
}

export function createFiller({ idol, voice, dir, gapMs = 20e3, chance = 0.7, rand = Math.random, now = () => Date.now() }) {
  const kinds = idol.fillers;
  if (!kinds || !voice?.pcm) return null;
  fs.mkdirSync(dir, { recursive: true });
  const ready = new Map();   // say -> PCM
  let last = -Infinity, lastSay = '';
  const fileOf = (say, tone) => path.join(dir, createHash('sha256').update(`${voice.voiceId}|${tone || ''}|${say}`).digest('hex').slice(0, 16) + '.pcm');

  // Made once per voice and kept on disk; a sound that fails to make is simply never picked.
  async function warm() {
    for (const k of Object.values(kinds)) for (const s of k.says) {
      const { say, tone } = typeof s === 'string' ? { say: s, tone: k.tone } : { tone: k.tone, ...s };
      if (ready.has(say)) continue;
      const f = fileOf(say, tone);
      if (fs.existsSync(f)) { ready.set(say, fs.readFileSync(f)); continue; }
      const pcm = await voice.pcm(say, 'filler', tone).catch(() => null);
      if (pcm?.length) { fs.writeFileSync(f, pcm); ready.set(say, pcm); }
    }
    return ready.size;
  }

  // One sound for this comment, or null (too soon, skipped this time, nothing made for that kind).
  function pick(text) {
    if (now() - last < gapMs || rand() >= chance) return null;
    const kind = fillerKind(text);
    const says = (kinds[kind] || kinds.hm)?.says.map(s => s.say ?? s).filter(s => ready.has(s) && s !== lastSay) || [];
    if (!says.length) return null;
    const say = says[Math.floor(rand() * says.length)];
    last = now(); lastSay = say;
    const acts = (kinds[kind] || kinds.hm).act || [];
    return { kind, text: say, pcm: ready.get(say), act: acts.length ? acts[Math.floor(rand() * acts.length)] : null };
  }
  return { warm, pick, get size() { return ready.size; } };
}
