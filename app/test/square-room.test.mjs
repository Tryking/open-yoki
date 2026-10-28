// Her Square room's own senses: Square's count of who is watching, total listens, the night's peak and
// who walks in by nickname, posted by the room reader (ops/) to /api/square/room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSquareRoom, watching } from '../server/square.mjs';
import { createBrain, promptFor, memoryFor } from '../server/brain.mjs';
import { createWorld } from '../server/world.mjs';
import { createMemory } from '../server/memory.mjs';
import idol from '../idols/example/config.mjs';

test('square room: counts from the socket, room-detail only as the backup, peak and listens kept, a stale count dropped', () => {
  let t = 1e9;
  const r = createSquareRoom({ now: () => t });
  assert.equal(r.online, null);
  r.take({ online: '3', pv: 12, src: 'im' });
  assert.deepEqual([r.online, r.pv, r.peak, r.listens], [3, 12, 3, 12]);
  t += 30e3; r.take({ online: 9, pv: 40, src: 'detail' });   // the socket spoke 30 s ago: it wins
  assert.equal(r.online, 3);
  t += 100e3; r.take({ online: 5, pv: 14, src: 'detail' });  // quiet socket for 130 s: the backup counts
  assert.deepEqual([r.online, r.pv, r.peak], [5, 14, 5]);
  r.take({ online: 'x', pv: -1 }); assert.equal(r.online, 5);
  t += 5 * 60e3 + 1; assert.equal(r.online, null);            // reader gone quiet: not trusted any more
  r.take({ online: 2, events: [{ type: 'end' }] });
  assert.deepEqual([r.online, r.peak, r.listens], [0, 5, 14]);
  r.reset(); assert.deepEqual([r.online, r.peak, r.listens], [null, 0, 0]);
});

test('square room: walk-ins by nickname, the same person back within 10 min is not news, filtered names dropped', () => {
  let t = 1e9;
  const r = createSquareRoom({ now: () => t });
  const nickOf = n => (/小例|币安/i.test(n || '') ? null : String(n || '').trim().slice(0, 12) || null);
  assert.deepEqual(r.take({ events: [{ type: 'enter', name: '小米粥' }, { type: 'enter', name: '小例' }, { type: 'enter', name: '' }, { type: 'enter', name: '小米粥' }, { type: 'like' }] }, nickOf), { joins: ['小米粥'], thanks: [], ended: false, warned: false });
  t += 3 * 60e3;
  assert.deepEqual(r.take({ events: [{ type: 'enter', name: '小米粥' }, { type: 'enter', name: 'Moonfish' }] }, nickOf).joins, ['Moonfish']);
  t += 8 * 60e3;
  assert.deepEqual(r.take({ events: [{ type: 'enter', name: '小米粥' }] }, nickOf).joins, ['小米粥']);
  assert.equal(r.take({ events: [{ type: 'end' }] }).ended, true);
});

test('watching: on Square her brain counts Square\'s room (plus the site), not the site standing in for it', () => {
  assert.equal(watching({ onSquare: true, square: 7, site: 0 }), 7);
  assert.equal(watching({ onSquare: true, square: 7, site: 2 }), 9);
  assert.equal(watching({ onSquare: true, square: 0, site: 0 }), 0);       // Square says nobody: nobody
  assert.equal(watching({ onSquare: true, square: null, site: 0 }), 1);    // no number yet: the push counts as one
  assert.equal(watching({ onSquare: false, square: 7, site: 2 }), 2);      // off Square its number means nothing
});

test('brain: a named walk-in is mentioned by name, a crowd folds into one line, 2.5 min apart at most', async () => {
  let t = 1e6, n = 1;
  const world = createWorld({ idol });
  const brain = createBrain({ idol, world, ask: async () => ({ text: '' }), speak: async () => {}, viewers: () => n, onAir: () => false, now: () => t });
  brain.add({ kind: 'join', name: '小米粥', viewers: 2 });
  brain.add({ kind: 'join', name: 'Moonfish', viewers: 3 });
  brain.add({ kind: 'join', name: '小米粥', viewers: 3 });
  assert.equal(brain.queue.length, 1);
  assert.deepEqual([brain.queue[0].names, brain.queue[0].viewers], [['小米粥', 'Moonfish'], 3]);
  const p = promptFor(idol, brain.queue[0], world.w).text;
  assert.match(p, /小米粥、Moonfish 刚进来，现在 3 个人在看。不用专门欢迎/);
  assert.match(p, /别说“进来坐”/);   // night 1: 坐 in 58 greetings
  assert.match(promptFor(idol, { kind: 'join', viewers: 4 }, world.w).text, /刚有人进来，现在 4 个人在看/);
  // Said already (taken off the queue): within 2.5 min a new name waits for the next greeting instead of a second one.
  brain.queue.length = 0; t += 10e3;
  brain.add({ kind: 'join', name: '阿杰', viewers: 4 });
  assert.equal(brain.queue.length, 0);
  t += 60e3; brain.add({ kind: 'join', name: '阿杰', viewers: 4 });
  assert.equal(brain.queue.length, 0);
  t += 90e3; brain.add({ kind: 'join', name: '阿杰', viewers: 4 });
  assert.deepEqual(brain.queue.map(q => q.names), [['阿杰']]);
});

test('brain: a regular walking back in is recognised; the show record keeps Square\'s peak and listens', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-sqroom-'));
  try {
    let t = 1e12;
    const memory = createMemory({ file: path.join(dir, 'memory.json'), tz: idol.tz, now: () => t });
    memory.seen('小米粥'); t += 3600e3; memory.seen('小米粥'); memory.note('小米粥', '爱喝豆浆');
    assert.match(memoryFor(memory, { kind: 'join', names: ['小米粥'] }), /你认识他.*爱喝豆浆/);
    // a regular in a crowd is picked out too (it used to be skipped), strangers are not looked up
    const crowd = memoryFor(memory, { kind: 'join', names: ['路人', '小米粥'] });
    assert.match(crowd, /你认识他.*爱喝豆浆/); assert.match(crowd, /小米粥 是老朋友/); assert.doesNotMatch(crowd, /路人 是/);
    assert.equal(memoryFor(memory, { kind: 'join', names: ['路人', '过客'] }), '');
    const greet = promptFor(idol, { kind: 'join', names: ['路人', '小米粥'], regulars: ['小米粥'], viewers: 9 }, {}).text;
    assert.match(greet, /小米粥 是你认识的老朋友/); assert.doesNotMatch(greet, /不用专门欢迎/);
    memory.openShow();
    const show = memory.closeShow({ about: '聊盘', viewersPeak: 6, listens: 31 });
    assert.deepEqual([show.viewersPeak, show.listens], [6, 31]);
    assert.equal(memory.closeShow({ viewersPeak: 0 }).listens, 31);   // no Square that night: nothing added
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('server: /api/square/room needs the reader key, keeps Square\'s count and hands walk-ins to her brain by name', async () => {
  const { start } = await import('../server/index.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-sqroom-'));
  const app = await start({ IDOL: 'example', DATA_DIR: dir, MODEL_OFF: '1', VOICE_OFF: '1', ON_AIR: 'off', NEWS_OFF: '1', MARKET_OFF: '1' });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const key = fs.readFileSync(path.join(dir, 'square-ingest.key'), 'utf8').trim();
  const post = async (body, k = key) => { const r = await fetch(base + '/api/square/room', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Square-Key': k }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  try {
    assert.equal((await post({ online: 4 }, 'x'.repeat(key.length))).status, 403);
    const r = await post({ online: '4', pv: 20, events: [{ type: 'enter', name: '小米粥' }, { type: 'enter', name: idol.name }, { type: 'enter', name: 'Moonfish' }], src: 'im' });
    assert.deepEqual([r.status, r.body.online, r.body.took], [200, 4, 2]);
    const joins = app.brain.queue.filter(q => q.kind === 'join');
    assert.equal(joins.length, 1);
    assert.deepEqual(joins[0].names, ['小米粥', 'Moonfish']);
    assert.equal((await post({ events: [{ type: 'enter', name: '小米粥' }] })).body.took, 0);   // back again at once: no second hello
    assert.equal((await post({ events: [{ type: 'end' }] })).body.online, 0);
  } finally { await app.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('follows, gifts, tips and red envelopes are thanked by name; a live warning is flagged', () => {
  const r = createSquareRoom();
  const out = r.take({ src: 'im', events: [{ type: 'follow', name: '阿呆' }, { type: 'gift', name: '糖糖', what: '小心心 x3' }, { type: 'red' }, { type: 'warning' }, { type: 'nope', name: 'x' }] });
  assert.deepEqual(out.thanks, [{ act: 'follow', name: '阿呆', what: null, usd: null }, { act: 'gift', name: '糖糖', what: '小心心 x3', usd: null }, { act: 'red', name: null, what: null, usd: null }]);
  assert.equal(out.warned, true);
  assert.deepEqual(out.joins, []);
});
