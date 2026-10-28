// Her memory: three notebooks that survive a restart, and the short lines they hand the prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemory } from '../server/memory.mjs';

const DAY = 86400e3;
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xa-mem-')), 'memory.json');

test('a stranger gets no "I know you" line; a regular does', () => {
  let t = Date.UTC(2026, 9, 14, 12);
  const mem = createMemory({ now: () => t });
  mem.seen('老王');
  assert.equal(mem.fanLine('老王'), '', 'first visit: she knows nothing yet');
  t += 3 * DAY;
  mem.note('老王', '说要梭哈 BNB');
  mem.topic('老王', '上周亏了一半');
  const line = mem.fanLine('老王');
  assert.match(line, /来过 2 次/);
  assert.match(line, /3 天前/);
  assert.match(line, /上次聊到：上周亏了一半/);
  assert.match(line, /说要梭哈 BNB/);
});

test('same visit does not count twice; half an hour later does', () => {
  let t = 0;
  const mem = createMemory({ now: () => t });
  mem.seen('a'); t += 60e3; mem.seen('a');
  assert.equal(mem.fan('a').visits, 1);
  t += 31 * 60e3; mem.seen('a');
  assert.equal(mem.fan('a').visits, 2);
});

test('facts stay unique and capped, newest first', () => {
  const mem = createMemory({ fanKeep: 3 });
  for (const f of ['一', '二', '三', '四']) mem.note('b', f);
  mem.note('b', '二');
  const facts = mem.fan('b').facts.map(x => x.text);
  assert.deepEqual(facts, ['二', '四', '三']);
});

test('last show is offered once it is over, with the promise', () => {
  let t = Date.UTC(2026, 9, 13, 14);
  const mem = createMemory({ now: () => t });
  mem.openShow();
  assert.equal(mem.lastShowLine(), '', 'the show she is in now is not "last night"');
  t += 2 * 3600e3;
  mem.closeShow({ about: 'BNB 回调', best: '有人把客服当真人', promise: '明天帮尾号6666看一眼' });
  t += DAY;
  const line = mem.lastShowLine();
  assert.match(line, /昨天/);
  assert.match(line, /聊的是BNB 回调/);
  assert.match(line, /你答应过：明天帮尾号6666看一眼/);
});

test('calls: one open per subject, settle scores it, line owns the mistake', () => {
  let t = 0;
  const mem = createMemory({ now: () => t });
  mem.call({ subject: 'BNB', say: '今晚不破 1000' });
  mem.call({ subject: 'BNB', say: '改口：会破' });
  assert.equal(mem.m.calls.filter(c => c.subject === 'BNB' && c.result === null).length, 1);
  assert.match(mem.callLine(), /还没对答案/);
  t += DAY;
  mem.settle({ subject: 'BNB', result: '破了', right: false });
  assert.equal(mem.openCall('BNB'), null);
  assert.deepEqual(mem.score(), { total: 1, right: 0 });
  assert.match(mem.callLine(), /说错了/);
});

test('score shows up only after three settled calls', () => {
  const mem = createMemory();
  for (const [i, ok] of [[1, true], [2, false], [3, true]].entries()) {
    mem.call({ subject: 's' + i, say: 'x' });
    mem.settle({ subject: 's' + i, result: 'y', right: ok[1] });
  }
  assert.match(mem.callLine(), /2\/3/);
});

test('lines() joins only what it actually has', () => {
  const mem = createMemory();
  assert.equal(mem.lines(), '');
  mem.call({ subject: 'BNB', say: '横盘' });
  const out = mem.lines({ who: '谁都不认识的人' });
  assert.match(out, /每天猜的涨跌/);
  assert.doesNotMatch(out, /你认识他/);
});

test('saved to disk and read back; least-seen fans pruned first', () => {
  const file = tmp();
  let t = Date.UTC(2026, 9, 14);
  const mem = createMemory({ file, fanMax: 2, now: () => t });
  for (let i = 0; i < 4; i++) { mem.seen('常客'); t += DAY; }      // four separate visits
  for (let i = 0; i < 2; i++) { mem.seen('常客2'); t += DAY; }
  mem.seen('路人');                                               // one visit, longest ago among ties
  assert.equal(mem.save(), true);
  const again = createMemory({ file, fanMax: 2 });
  assert.equal(Object.keys(again.m.fans).length, 2);
  assert.ok(again.fan('常客'), 'the regular is kept');
  assert.equal(again.fan('路人'), null, 'the one-off is dropped');
  assert.equal(again.save(), false, 'nothing changed, nothing written');
});

test('a broken memory file does not stop her starting', () => {
  const file = tmp();
  fs.writeFileSync(file, '{not json');
  const mem = createMemory({ file });
  assert.deepEqual(Object.keys(mem.m.fans), []);
  mem.note('a', 'b');
  assert.equal(mem.save(), true);
});

test('regulars: last visit, the heart\'s page, and picking them out of a crowd', () => {
  let t = Date.UTC(2026, 9, 17, 12);
  const mem = createMemory({ now: () => t });
  mem.seen('冰雨'); mem.note('冰雨', '说先不出手，等多空明朗');
  t += 2 * 86400e3; mem.seen('冰雨');
  const line = mem.fanLine('冰雨');
  assert.match(line, /来过 2 次/); assert.match(line, /上次是 2 天前/); assert.match(line, /先不出手/); assert.match(line, /接上/);
  // a first-time name with a page in her heart is still someone she knows
  assert.equal(mem.fanLine('法国朋友'), '');
  assert.match(mem.fanLine('法国朋友', t, '住法国，阿尔及利亚队球迷'), /你在心里给他记过：住法国/);
  assert.deepEqual(mem.regulars(['路人', '冰雨', '法国朋友'], n => n === '法国朋友'), ['冰雨', '法国朋友']);
  // the same visit (within half an hour) does not move "last time"
  t += 10 * 60e3; mem.seen('冰雨');
  assert.match(mem.fanLine('冰雨'), /来过 2 次/);
});
