import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pushItems, createPushTalk } from '../server/pushes.mjs';

// Two files in her heart's home: 官方最近在推.md (what the platform is pushing) and 我自己在用的.md (what she uses).
const OFFICIAL = '## Agent ID\n- 是什么：钱包名字\n- 怎么开始：App 里领\n\n## 预测市场\n- 是什么：猜结果\n\n## AI Pro\n- 是什么：AI 帮你交易\n- 怎么开始：App 里找';
const MINE = '## Agent ID：demo.ai\n- 朋友帮我领的\n\n## 预测市场\n- 我自己的感觉：（还没写）\n\n## 还没用过的\n- AI Pro';

test('币安在推: the heart files parse; what she uses is matched, her placeholder is not a feeling', () => {
  const items = pushItems(OFFICIAL, MINE);
  const by = n => items.find(x => x.name.startsWith(n));
  assert.equal(items.length, 3);
  assert.ok(by('Agent ID').used); assert.match(by('Agent ID').mine, /demo\.ai|朋友/); assert.doesNotMatch(by('Agent ID').mine, /还没写/);
  assert.equal(by('AI Pro').used, false);
  for (const x of items) { assert.ok(x.what); assert.doesNotMatch(x.what + (x.how || ''), /https?:|www\.|0x[0-9a-f]{6}/i); }
});

test('币安在推: at most twice a show, not in the first minutes, spaced out, used ones first, new show starts over', () => {
  let t = 0;
  const read = f => f.endsWith('官方最近在推.md')
    ? '## AI Pro\n- 是什么：AI 帮你交易\n- 怎么开始：App 里找\n\n## Agent ID\n- 是什么：钱包名字\n\n## 跟单\n- 是什么：跟着买'
    : '## Agent ID：demo.ai\n- 朋友帮我领的\n- 我自己的感觉：（还没写）\n\n## 还没用过的\n- AI Pro';
  const p = createPushTalk({ dir: '/x', now: () => t, read });
  assert.equal(p.pick(null), null);                         // off air
  t = 5 * 60e3; assert.equal(p.pick(0), null);              // too early
  t = 15 * 60e3; const a = p.pick(0);
  assert.equal(a.name, 'Agent ID'); assert.equal(a.mine, '朋友帮我领的');
  t = 30 * 60e3; assert.equal(p.pick(0), null);             // too soon after
  t = 60 * 60e3; const b = p.pick(0); assert.equal(b.name, 'AI Pro'); assert.equal(b.used, false);
  t = 120 * 60e3; assert.equal(p.pick(0), null);            // two a show
  t = 185 * 60e3; assert.equal(p.pick(180 * 60e3), null);   // next show, early
  t = 195 * 60e3 + 12 * 60e3; assert.equal(p.pick(180 * 60e3).name, 'Agent ID');
});
