// Her own posts: a file in 想发的动态/ is checked, queued a few a day, handed to the Square poster once, settled back;
// with an X client it also goes to X when queued.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOutbox, checkPost, WANT, DONE } from '../server/outbox.mjs';

function setup(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-')), home = path.join(root, 'host'), st = path.join(root, '.state');
  fs.mkdirSync(home); fs.mkdirSync(st);
  let t = Date.parse('2026-10-16T04:00:00Z');
  const fed = [];
  const ob = createOutbox({ home, stateDir: st, now: () => t, feed: l => fed.push(l), ...opts });
  const put = (name, text) => { const f = path.join(home, WANT, name); fs.writeFileSync(f, text); const old = new Date(t - 60e3); fs.utimesSync(f, old, old); };
  return { home, st, fed, ob, put, now: () => t, step: ms => { t += ms; }, done: () => fs.readdirSync(path.join(home, DONE)) };
}

test('what stops a post: empty, too long, a contract address, a link', () => {
  assert.equal(checkPost('  '), '是空的');
  assert.match(checkPost('a'.repeat(2001)), /太长了/);
  assert.equal(checkPost('冲 0x' + '12345678'.repeat(5)), '里面有合约地址');
  assert.equal(checkPost('看这里 https://x.com/a'), '里面有链接');
  assert.equal(checkPost('来 example.com 看我'), '里面有链接');
  assert.equal(checkPost('今晚大饼好平，我困了。'), null);
});

test('she writes a file, the poster takes it once, it moves to 发过的动态 with the link and her heart hears', () => {
  const { home, fed, ob, put, done } = setup();
  put('夜宵.md', '凌晨三点想吃烤串，谁陪我。');
  ob.scan();
  const got = ob.take();
  assert.deepEqual(got.map(x => x.text), ['凌晨三点想吃烤串，谁陪我。']);
  assert.deepEqual(ob.take(), [], 'handed out once');
  assert.equal(ob.settle({ id: got[0].id, ok: true, link: 'https://www.binance.com/square/post/1' }), true);
  assert.deepEqual(done(), ['夜宵.md']);
  assert.match(fs.readFileSync(path.join(home, DONE, '夜宵.md'), 'utf8'), /^（2026-10-16 12:00）发出去了：https:\/\/www\.binance\.com\/square\/post\/1\n\n凌晨三点/);
  assert.deepEqual(fs.readdirSync(path.join(home, WANT)), []);
  assert.match(fed[0], /发出去了/);
});

test('a refused post comes back with the reason; a few a day, half an hour apart, one at a time', () => {
  const { home, fed, ob, put, step, done } = setup({ perDay: 2 });
  put('a.md', '有链接 www.abc.com');
  ob.scan();
  assert.match(fs.readFileSync(path.join(home, DONE, 'a.md'), 'utf8'), /没发：里面有链接/);
  assert.match(fed[0], /没发出去：里面有链接/);
  put('b.md', '一'); put('c.md', '二'); ob.scan();
  assert.equal(ob.take().length, 1, 'one at a time');
  const [b] = ob.state.items; ob.settle({ id: b.id, ok: true });
  ob.scan(); assert.deepEqual(ob.take(), [], 'not before half an hour');
  step(31 * 60e3); ob.scan();
  const [c] = ob.take(); ob.settle({ id: c.id, ok: false, error: 'API error [220009]' });
  assert.match(fs.readFileSync(path.join(home, DONE, 'c.md'), 'utf8'), /没发出去：API error \[220009\]/);
  assert.equal(ob.state.count, 1, 'a refused post does not use up one of today\'s');
  assert.equal(done().length, 3);
});

test('a post the poster took but never answered for is settled as unknown, never offered again', () => {
  const { home, ob, put, step } = setup();
  put('x.md', '晚安'); ob.scan(); ob.take();
  step(31 * 60e3); ob.scan();
  assert.match(fs.readFileSync(path.join(home, DONE, 'x.md'), 'utf8'), /不知道发没发出去/);
  assert.deepEqual(ob.take(), []);
});

// A fake X client shaped like createXClient(): post(text, { media }) → { ok, id, url }.
const fakeX = ({ user = true, fail = null } = {}) => {
  const posts = [];
  return { posts, configured: { user, read: user }, post: async (text, { media = [] } = {}) => { if (fail) throw new Error(fail); posts.push({ text, media }); return { ok: true, id: '77', url: 'https://x.com/i/status/77' }; } };
};

test('with an X client the post goes to X when queued; the link lands in her feed and the Square note', async () => {
  const x = fakeX();
  const { home, fed, ob, put } = setup({ x });
  put('夜宵.md', '凌晨三点想吃烤串，谁陪我。');
  ob.scan(); await ob.flush();
  assert.deepEqual(x.posts, [{ text: '凌晨三点想吃烤串，谁陪我。', media: [] }]);
  assert.match(fed.at(-1), /^【推特】你那条动态发到推特了：「凌晨三点想吃烤串，谁陪我。」 https:\/\/x\.com\/i\/status\/77$/);
  assert.equal(ob.state.items[0].x.url, 'https://x.com/i/status/77');
  const [it] = ob.take();
  ob.settle({ id: it.id, ok: true, link: 'https://www.binance.com/square/post/1' });
  assert.match(fs.readFileSync(path.join(home, DONE, '夜宵.md'), 'utf8'), /^（[^）]+）发出去了：https:\/\/www\.binance\.com\/square\/post\/1\n推特：https:\/\/x\.com\/i\/status\/77\n\n凌晨三点/);
});

test('X failing is told to her; an X client without user keys is not used', async () => {
  const bad = fakeX({ fail: 'X rate limit on /2/tweets' });
  const a = setup({ x: bad });
  a.put('a.md', '今晚早点睡。'); a.ob.scan(); await a.ob.flush();
  assert.match(a.fed.at(-1), /^【推特】你那条动态没发到推特：X rate limit on \/2\/tweets/);
  assert.equal(a.ob.state.items[0].x.ok, false);
  const [it] = a.ob.take(); a.ob.settle({ id: it.id, ok: false, error: '广场不让发' });
  assert.match(fs.readFileSync(path.join(a.home, DONE, 'a.md'), 'utf8'), /没发出去：广场不让发\n推特没发出去：X rate limit/);
  const off = fakeX({ user: false });
  const b = setup({ x: off });
  b.put('b.md', '今晚早点睡。'); b.ob.scan(); await b.ob.flush();
  assert.deepEqual(off.posts, []); assert.equal(b.ob.state.items[0].x, undefined);
  assert.ok(!b.fed.some(l => l.startsWith('【推特】')));
});
