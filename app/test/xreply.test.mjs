// Her X replies: inbox items reach her heart with a #推N; her own files answer them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createXReply, parseXFirst, X_WANT, X_DONE } from '../server/xreply.mjs';
import { createXClient } from '../server/xapi.mjs';

function setup(items = [], opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xr-')), home = path.join(root, 'host'), st = path.join(root, '.state');
  fs.mkdirSync(home); fs.mkdirSync(st);
  let t = Date.parse('2026-10-23T14:00:00Z');
  const fed = [], sent = [], ignored = [];
  const client = { list: async () => items.splice(0), reply: async (id, text) => { sent.push([id, text]); return { ok: true, url: 'https://x.com/host/status/1' }; }, ignore: async id => { ignored.push(id); } };
  const x = createXReply({ home, stateDir: st, client, now: () => t, feed: l => fed.push(l), ...opts });
  const put = (name, text) => { const f = path.join(home, X_WANT, name); fs.writeFileSync(f, text); const old = new Date(t - 60e3); fs.utimesSync(f, old, old); };
  return { home, st, fed, sent, ignored, x, put, step: ms => { t += ms; }, done: () => fs.readdirSync(path.join(home, X_DONE)), make: () => createXReply({ home, stateDir: st, client, now: () => t, feed: l => fed.push(l) }) };
}

test('first line parses only her own reply / ignore commands', () => {
  assert.deepEqual(parseXFirst('回 #推3'), { act: 'reply', n: 3 });
  assert.deepEqual(parseXFirst('回复 #推12'), { act: 'reply', n: 12 });
  assert.deepEqual(parseXFirst('不理 #推4'), { act: 'ignore', n: 4 });
  assert.equal(parseXFirst('回 #3'), null);
  assert.equal(parseXFirst('今天好开心'), null);
});

test('new items reach her heart once, numbered, with who and what they replied to', async () => {
  const items = [{ id: 'a1', author: 'niuniu0988', name: '牛头哥', kind: 'reply', text: '今天播得 不错', ours: '晚上好，今天亏了一点' }, { id: 'a2', author: 'bob', kind: 'mention', text: 'gm 小例' }];
  const { fed, x } = setup(items);
  assert.equal(await x.poll(), 2);
  assert.match(fed[0], /^【推特 22:00 #推1】牛头哥 @niuniu0988 回你（你那条「晚上好，今天亏了一点」）：今天播得 不错$/);
  assert.match(fed[1], /#推2】@bob @你：gm 小例/);
  items.push({ id: 'a1', text: 'again' });
  assert.equal(await x.poll(), 0);
});

test('her file replies through the client; ignore clears; numbers survive a restart', async () => {
  const items = [{ id: 'a1', author: 'tt', name: '糖糖', kind: 'reply', text: '你好呀' }, { id: 'a2', author: 'sp', kind: 'mention', text: 'promo' }];
  const { fed, sent, ignored, put, done, make } = setup(items);
  const x0 = make(); await x0.poll();
  const x = make();   // restart: state comes back from the file
  put('1.md', '回 #推1\n嗨糖糖，晚上好～（她是活人，回一句就行）');
  put('2.md', '不理 #推2');
  await x.scan();
  assert.deepEqual(sent, [['a1', '嗨糖糖，晚上好～']]);
  assert.deepEqual(ignored, ['a2']);
  assert.equal(done().length, 2);
  assert.ok(fed.some(l => l.startsWith('【推特】你回了 糖糖')));
});

test('links, contract addresses, unknown numbers, missing first line and repeats are refused', async () => {
  const items = [{ id: 'a1', author: 'tt', kind: 'reply', text: 'hi' }];
  const { fed, sent, x, put, step } = setup(items);
  await x.poll();
  put('a.md', '回 #推1\n看这里 https://example.com');
  put('b.md', '回 #推1\n0x' + 'a'.repeat(40));
  put('c.md', '回 #推9\n你好');
  put('d.md', '你好');
  await x.scan();
  assert.equal(sent.length, 0);
  assert.equal(fed.filter(l => l.startsWith('【推特】你想回的没发')).length, 4);
  put('e.md', '回 #推1\n你好'); await x.scan();
  step(120e3); put('f.md', '回 #推1\n再说一次'); await x.scan();
  assert.equal(sent.length, 1);
  assert.ok(fed.some(l => /已经回过了/.test(l)));
});

test('a minute between replies and a daily cap', async () => {
  const items = [1, 2, 3].map(i => ({ id: 'a' + i, author: 'u' + i, kind: 'reply', text: 'hi' }));
  const { sent, x, put, step, home } = setup(items, { perDay: 2 });
  await x.poll();
  put('1.md', '回 #推1\n一'); put('2.md', '回 #推2\n二');
  await x.scan();
  assert.equal(sent.length, 1);
  assert.equal(fs.readdirSync(path.join(home, X_WANT)).length, 1);
  step(61e3); await x.scan(); assert.equal(sent.length, 2);
  step(61e3); put('3.md', '回 #推3\n三'); await x.scan();
  assert.equal(sent.length, 2);
});

test('a real createXClient plugs in; without keys her reply is not sent and she hears why', async () => {
  const calls = [];
  const xc = createXClient({ env: {}, fetchFn: async (...a) => { calls.push(a); throw new Error('no network in tests'); } });
  for (const k of ['list', 'reply', 'replyTo', 'ignore']) assert.equal(typeof xc[k], 'function', k);
  assert.equal(xc.configured.user, false);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xr-')), home = path.join(root, 'host'), st = path.join(root, '.state');
  fs.mkdirSync(home); fs.mkdirSync(st);
  const t = Date.parse('2026-01-02T06:00:00Z'), fed = [];
  const x = createXReply({ home, stateDir: st, client: { ...xc, list: async () => [{ id: 'k1', author: 'tt', kind: 'mention', text: 'hi' }] }, now: () => t, feed: l => fed.push(l) });
  await x.poll();
  const f = path.join(home, X_WANT, 'a.md'); fs.writeFileSync(f, '回 #推1\n你好'); fs.utimesSync(f, new Date(t - 60e3), new Date(t - 60e3));
  await x.scan();
  assert.deepEqual(calls, []);
  assert.ok(fed.some(l => /没回成：X keys missing/.test(l)), fed.join('\n'));
  assert.match(fs.readFileSync(path.join(home, X_DONE, 'a.md'), 'utf8'), /没回成：X keys missing: set X_API_KEY/);
});

test('people tagging a crowd are cleared without reaching her; at most a few a time', async () => {
  const items = [{ id: 'm1', author: 'x', kind: 'mention', text: '@a @b @host_x @c gm' }, { id: 'm2', author: 'y', kind: 'reply', text: '@bsc_daily @irys_xyz @host_x $SI to the moon' }, ...[1, 2, 3].map(i => ({ id: 'r' + i, author: 'u' + i, kind: 'reply', text: 'hi', ours: '晚上好' }))];
  const { fed, ignored, x } = setup(items, { perPoll: 2 });
  assert.equal(await x.poll(), 2);
  assert.deepEqual(ignored, ['m1', 'm2']);
  assert.equal(fed.filter(l => l.startsWith('【推特 ')).length, 2);
});

test('the @ chain X puts in front of a reply is cut off what she reads', async () => {
  const { fed, x } = setup([{ id: 'r', author: 'tt', kind: 'reply', text: '@host_x @cz_binance 今天播得不错', ours: '晚上好' }]);
  await x.poll();
  assert.match(fed[0], /回你（你那条「晚上好」）：今天播得不错$/);
});

test('a crowd post that tags Binance, or comes from a big account, still reaches her; the rest pass', async () => {
  const items = [
    { id: 'b', author: 'aa', kind: 'mention', text: '@bsc_daily @irys_xyz @cz_binance @host_x AI 主播谁最强' },
    { id: 'f', author: 'kol', name: 'KOL', followers: 52000, verified: true, kind: 'mention', text: '@a @b @host_x gm' },
    { id: 's', author: 'nobody', followers: 30, kind: 'reply', text: '@bsc_daily @irys_xyz @Alaya_AI @host_x $SI moon' },
  ];
  const { fed, ignored, x } = setup(items);
  assert.equal(await x.poll(), 2);
  assert.deepEqual(ignored, ['s']);
  assert.match(fed[0], /（他还 @ 了币安官方：@cz_binance）：AI 主播谁最强$/);
  assert.match(fed[1], /^【推特 [^】]+】KOL @kol（蓝V，5\.2 万 粉丝） @你/);
});
