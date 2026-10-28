// Big moves: each clip has its own moment, never from a viewer's words, rare, and served only by name.
// The clips themselves are made per host (none are shipped), so these tests run on their own small clip set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBigMoves } from '../server/bigmoves.mjs';

const MOVES = {
  gapMs: 240e3, againMs: 20 * 60e3, holdMs: 4600,
  clips: {
    rocket: { label: '冲天', on: [{ kinds: ['market'], up: true }, { words: /起飞|拉起来了|暴涨/ }] },
    crash: { label: '崩溃', on: [{ kinds: ['market'], up: false }, { words: /爆仓|暴跌|砸穿/ }] },
    party: { label: '嗨起来', on: [{ words: /嗨起来|蹦迪|狂欢/ }] },
    jump: { label: '跳起来', on: [{ words: /卧槽|天哪|真的假的/, shades: ['surprised'], faces: ['happy'] }] },
    laugh: { label: '笑倒', on: [{ words: /笑死|哈哈哈哈/ }] },
    peek: { label: '偷看', on: [{ words: /不敢看|吓死/ }] },
    bow: { label: '鞠躬比心', on: [{ kinds: ['thanks'], acts: ['gift', 'tip', 'red', 'follow'] }] },
  },
};

test('big moves: the example host config has a well-formed clip table', async () => {
  const idol = (await import('../idols/example/config.mjs')).default;
  for (const [k, c] of Object.entries(idol.bigMoves?.clips || {})) {
    assert.match(k, /^[a-z0-9_-]+$/, k);
    assert.ok(Array.isArray(c.on), k);
  }
});

test('big moves: a pump or dump picks its own clip; a follow gets the bow', () => {
  const b = createBigMoves({ ...MOVES, gapMs: 0, againMs: 0 }, { now: () => 0, rand: () => 0 });
  assert.equal(b.pick({ text: 'BTC 拉了', face: 'neutral' }, { kind: 'market', pct: 2 }), 'rocket');
  assert.equal(b.pick({ text: 'BTC 砸了', face: 'neutral' }, { kind: 'market', pct: -2 }), 'crash');
  assert.equal(b.pick({ text: '谢谢关注', face: 'happy' }, { kind: 'thanks', act: 'follow' }), 'bow');
  assert.equal(b.pick({ text: '笑死我了哈哈哈哈', face: 'happy' }, { kind: 'chat' }), 'laugh');
  assert.equal(b.pick({ text: '我不敢看了', face: 'neutral' }, { kind: 'idle' }), 'peek');
});

test('big moves: an ordinary line, a silent move or a viewer-only word picks nothing', () => {
  const b = createBigMoves({ ...MOVES, gapMs: 0, againMs: 0 }, { now: () => 0, rand: () => 0 });
  assert.equal(b.pick({ text: '今天盘挺平的', face: 'neutral' }, { kind: 'idle' }), null);
  assert.equal(b.pick({ text: '', silent: true, face: 'happy' }, { kind: 'idle' }), null);
  // a viewer said 起飞, she answered something else: only her own line counts
  assert.equal(b.pick({ text: '你先别急', face: 'neutral' }, { kind: 'chat', text: '起飞起飞' }), null);
});

test('big moves: at most one per gap, and the same clip not again within againMs', () => {
  let t = 0;
  const b = createBigMoves(MOVES, { now: () => t, rand: () => 0 });
  const pump = [{ text: '起飞了', face: 'happy' }, { kind: 'market', pct: 3 }];
  assert.equal(b.pick(...pump), 'rocket');
  t += 60e3; assert.equal(b.pick(...pump), null);                // within 4 min
  t += 200e3; assert.notEqual(b.pick(...pump), 'rocket');        // 4+ min later, rocket still resting
  t += 20 * 60e3; assert.equal(b.pick(...pump), 'rocket');
});
