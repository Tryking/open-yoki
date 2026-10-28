import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lookSrc, lookAvatar, createAvatar } from '../server/avatar.mjs';
import base from '../idols/example/config.mjs';

// Each stage is one complete picture of her (clothes pasted onto a face look fake). On air a new stage means she goes
// backstage: the Vidu session reopens on that stage's avatar asset. No pictures are shipped, so the tests make a
// host with four stages and placeholder files.
const LOOKS = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-looks-'));
for (const k of ['s1', 's2', 's3', 's4', 'off']) fs.writeFileSync(path.join(LOOKS, `${k}.jpg`), 'x');
const idol = { ...base, id: 'demo',
  stages: ['s1', 's2', 's3', 's4'].map((key, i) => ({ key, name: key, usd: i * 1000, look: '一句话描述这一身和场景' })),
  avatar: { ...base.avatar, image: '/placeholder.jpg', viduAvatarId: 'A-default', viduLooks: {}, backstage: ['我去换一身', '等我一下'] } };

test('every stage has its look picture on the page', () => {
  for (const [i, st] of idol.stages.entries()) {
    assert.match(lookSrc(idol, i, LOOKS), new RegExp(`^/art/demo/looks/${st.key}\\.jpg\\?v=\\d+$`));
    assert.ok(st.look && !st.dress, `${st.key} look words, no pasted dress`);
  }
});

test('a missing picture falls back to the placeholder; a stage without an asset falls back to the default avatar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-looks-x-'));
  try {
    assert.equal(lookSrc(idol, 0, dir), idol.avatar.image);
    assert.equal(lookSrc(idol, 0, null), idol.avatar.image);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const bare = { ...idol, avatar: { ...idol.avatar, viduLooks: { s2: 'A2' } } };
  assert.equal(lookAvatar(bare, 1), 'A2');
  assert.equal(lookAvatar(bare, 0), idol.avatar.viduAvatarId);
  assert.equal(lookAvatar(bare, 1, { VIDU_AVATAR_ID: 'X' }), 'A2', 'an uploaded look wins over the env fallback');
  assert.equal(lookAvatar(bare, 0, { VIDU_AVATAR_ID: 'X' }), 'X');
});

test('the page shows the current stage look off air', async () => {
  const av = createAvatar({ idol, kind: 'mock', lookDir: LOOKS });
  assert.match(av.view().src, /^\/art\/demo\/looks\/s1\.jpg\?v=/);
  assert.equal(await av.setStage(3), false);
  assert.match(av.view().src, /^\/art\/demo\/looks\/s4\.jpg\?v=/);
});

test('vidu: she goes on air in the current stage avatar; a new stage goes backstage and reopens on the new one', async () => {
  const http = await import('node:http');
  const { WebSocketServer } = await import('ws');
  const opened = [], sent = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
      if (req.method === 'POST') opened.push(JSON.parse(b).avatar_id);
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ live: { id: 'L' + ++n }, client_secret: 'cs' }));
    });
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', ws => ws.on('message', (data, binary) => {
    if (binary) return;
    const m = JSON.parse(String(data));
    sent.push(m.type);
    if (m.type === 1) setTimeout(() => ws.send(JSON.stringify({ type: 2, payload: { conn_init_ack: { success: true } } })), 30);
  }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const ids = Object.fromEntries(idol.stages.map(s => [s.key, 'A-' + s.key]));
  const room = { publisher: () => ({}), appId: 'app', roomId: 'r', publisherId: 'p' };
  const av = createAvatar({ idol: { ...idol, avatar: { ...idol.avatar, viduLooks: ids } }, kind: 'vidu', room, lookDir: LOOKS, env: { VIDU_KEY: 'k', VIDU_BASE: `http://127.0.0.1:${server.address().port}` } });
  try {
    assert.equal(await av.setStage(2), false);   // not on air yet: only remembers the stage
    await av.open();
    assert.deepEqual(opened, ['A-s3']);
    assert.equal(av.view().kind, 'volc');
    assert.equal(av.changesLook(2), false);
    assert.equal(av.changesLook(3), true);
    const change = av.setStage(3);
    await new Promise(r => setTimeout(r, 10));
    assert.equal(av.view().kind, 'backstage');
    assert.match(av.view().src, /^\/art\/demo\/looks\/s4\.jpg\?v=/);
    assert.equal(await change, true);
    assert.deepEqual(opened, ['A-s3', 'A-s4']);
    assert.equal(av.view().kind, 'volc');
    assert.ok(sent.includes(5), 'the old session was hung up');
    assert.ok(!sent.includes(11), 'no image pasting');
    assert.equal(await av.setStage(3), false);
  } finally { await av.close().catch(() => {}); wss.close(); server.close(); }
});

// Vidu pings about every 5 s and drops a socket that has not answered with a pong for about 15 s; ordinary data frames
// do not count (component docs, WebSocket 连接约定). The global WebSocket answers protocol pings itself, so a silent
// stretch on air (nobody talking) must not end the session.
test('vidu: protocol pings are answered with pongs while she is quiet', async () => {
  const http = await import('node:http');
  const { WebSocketServer } = await import('ws');
  let pongs = 0;
  const server = http.createServer((req, res) => {
    req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ live: { id: 'L1' }, client_secret: 'cs' })); });
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', ws => {
    ws.on('pong', () => { pongs++; });
    const t = setInterval(() => ws.ping(), 50);
    ws.on('close', () => clearInterval(t));
    ws.on('message', (data, binary) => {
      if (!binary && JSON.parse(String(data)).type === 1) ws.send(JSON.stringify({ type: 2, payload: { conn_init_ack: { success: true } } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const av = createAvatar({ idol, kind: 'vidu', room: { publisher: () => ({}), appId: 'a', roomId: 'r', publisherId: 'p' }, env: { VIDU_KEY: 'k', VIDU_BASE: `http://127.0.0.1:${server.address().port}` } });
  try {
    await av.open();
    await new Promise(r => setTimeout(r, 400));
    assert.ok(pongs >= 4, `pongs: ${pongs}`);
    assert.equal(av.onAir, true);
  } finally { await av.close(); wss.close(); server.close(); }
});

test('忘关麦: off stage she wears the off look (page and Vidu), then the stage look again', async () => {
  const mock = createAvatar({ idol, kind: 'mock', lookDir: LOOKS });
  await mock.setStage(3);
  await mock.offStage(true);
  assert.match(mock.view().src, /^\/art\/demo\/looks\/off\.jpg\?v=/);
  await mock.offStage(false);
  assert.match(mock.view().src, /^\/art\/demo\/looks\/s4\.jpg\?v=/);
  assert.equal(lookAvatar({ ...idol, avatar: { ...idol.avatar, viduLooks: { off: 'OFF', s1: 'S1' } } }, 0, {}, 'off'), 'OFF');
});

test('vidu 忘关麦: on air, going off stage reconnects on the off avatar; the next show opens in the stage look', async () => {
  const http = await import('node:http');
  const { WebSocketServer } = await import('ws');
  const opened = [];
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
      if (req.method === 'POST') opened.push(JSON.parse(b).avatar_id);
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ live: { id: 'L' + opened.length }, client_secret: 'cs' }));
    });
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', ws => ws.on('message', (data, binary) => {
    if (!binary && JSON.parse(String(data)).type === 1) ws.send(JSON.stringify({ type: 2, payload: { conn_init_ack: { success: true } } }));
  }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const ids = { ...Object.fromEntries(idol.stages.map(s => [s.key, 'A-' + s.key])), off: 'A-off' };
  const av = createAvatar({ idol: { ...idol, avatar: { ...idol.avatar, viduLooks: ids } }, kind: 'vidu', room: { publisher: () => ({}), appId: 'a', roomId: 'r', publisherId: 'p' }, lookDir: LOOKS, env: { VIDU_KEY: 'k', VIDU_BASE: `http://127.0.0.1:${server.address().port}` } });
  try {
    await av.open();
    assert.equal(await av.offStage(true), true);
    assert.match(av.view().src, /looks\/off\.jpg/);
    assert.equal(av.changesLook(0), false, 'off stage nothing else changes her look');
    await av.close();
    assert.equal(await av.offStage(false), false);   // off air: only remembered
    await av.open();
    assert.deepEqual(opened, ['A-s1', 'A-off', 'A-s1']);
  } finally { await av.close(); wss.close(); server.close(); }
});
