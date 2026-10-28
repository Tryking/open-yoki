import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorld, scrub, whoOf } from '../server/world.mjs';
import idol from '../idols/example/config.mjs';

const G = 'guest-0123456789';

test('chat never carries links or contract addresses', () => {
  assert.equal(scrub('buy at https://example.com/x now'), 'buy at [链接] now');
  assert.equal(scrub('ca 0x' + '1234567890abcdef'.repeat(3).slice(0, 40)), 'ca [地址]');
  const world = createWorld({ idol, now: () => 1e12 });
  const item = world.chat({ addr: G, text: '看 www.x.com 和 0xdeadbeef00' });
  assert.ok(!/www|0xdead/.test(item.text));
});

test('everyone in the chat is a guest, named by nickname or by the end of the guest id', () => {
  const world = createWorld({ idol, now: () => 1e12 });
  const a = world.chat({ addr: G, text: '晚上好' });
  assert.deepEqual([a.who, a.tier, a.tierName], ['游客6789', 'guest', '游客']);
  assert.equal(world.chat({ addr: G, text: '我又来了', who: '小A', from: 'square' }).who, '小A');
  assert.equal(whoOf(G), '游客6789');
  assert.equal(world.w.chat[0].from, 'square');
  assert.deepEqual(world.today().chats, ['游客6789：晚上好', '小A：我又来了']);
});

test('what she says is kept with whom she answered, and the comment is marked replied', () => {
  const world = createWorld({ idol, now: () => 1e12 });
  const c = world.chat({ addr: G, text: '在吗', who: '小A' });
  const v = world.version();
  world.say({ text: '在呢', face: 'happy', kind: 'chat', replyTo: c.id });
  assert.ok(world.version() > v);
  assert.equal(world.w.line.text, '在呢');
  assert.equal(world.w.recent[0], '在呢');
  assert.deepEqual([world.w.talk[0].text, world.w.talk[0].to], ['在呢', '小A']);
  assert.equal(world.w.chat[0].replied, true);
});

test('the day rolls over in the host time zone, and the world survives a restart', () => {
  let t = Date.UTC(2026, 0, 1, 15, 59);   // 23:59 at UTC+8
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-world-'));
  const file = path.join(dir, 'world.json');
  try {
    const world = createWorld({ idol: { ...idol, tz: 8 }, file, now: () => t });
    assert.equal(world.today().date, '2026-01-01');
    t += 2 * 60e3;
    assert.equal(world.today().date, '2026-01-02');
    world.addDiary({ date: '2026-01-01', text: '今天还行' });
    world.save();
    const again = createWorld({ idol, file, now: () => t });
    assert.equal(again.w.diary[0].text, '今天还行');
    assert.equal(again.w.stage, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
