import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { volcToken, createVolcRoom, PRIV } from '../server/rtc.mjs';

// Reads a token back the way Volcano's reference Parse() does (github.com/volcengine/rtc-aigc-demo server/token.js).
function parse(raw) {
  const appId = raw.slice(3, 27), buf = Buffer.from(raw.slice(27), 'base64');
  let at = 0;
  const bytes = b => { const n = b.readUInt16LE(at); at += 2; const out = b.subarray(at, at + n); at += n; return out; };
  const msg = bytes(buf), sig = bytes(buf);
  at = 0;
  const u32 = () => { const v = msg.readUInt32LE(at); at += 4; return v; };
  const nonce = u32(), issuedAt = u32(), expireAt = u32();
  const roomId = String(bytes(msg)), userId = String(bytes(msg));
  const n = msg.readUInt16LE(at); at += 2;
  const privs = {};
  for (let i = 0; i < n; i++) { const k = msg.readUInt16LE(at); at += 2; privs[k] = u32(); }
  return { version: raw.slice(0, 3), appId, msg, sig, nonce, issuedAt, expireAt, roomId, userId, privs };
}

const APP = 'a'.repeat(24), KEY = 'k'.repeat(32);

test('volc token: reference layout, signed with the app key, publish implies audio/video/data', () => {
  const now = Date.UTC(2026, 9, 7);
  const t = parse(volcToken({ appId: APP, appKey: KEY, roomId: 'lh-test', userId: 'lh-host', ttlSec: 60, privileges: [PRIV.publish, PRIV.subscribe], now, nonce: 7 }));
  assert.equal(t.version, '001');
  assert.equal(t.appId, APP);
  assert.equal(t.nonce, 7);
  assert.equal(t.issuedAt, now / 1000);
  assert.equal(t.expireAt, now / 1000 + 60);
  assert.equal(t.roomId, 'lh-test');
  assert.equal(t.userId, 'lh-host');
  assert.deepEqual(Object.keys(t.privs).map(Number), [0, 1, 2, 3, 4]);
  assert.ok(Object.values(t.privs).every(v => v === t.expireAt));
  assert.deepEqual(t.sig, crypto.createHmac('sha256', KEY).update(t.msg).digest());
  assert.notDeepEqual(t.sig, crypto.createHmac('sha256', 'x'.repeat(32)).update(t.msg).digest());
});

test('volc room: Vidu publishes, each visitor gets a different subscribe-only ticket', () => {
  const room = createVolcRoom({ appId: APP, appKey: KEY, roomId: 'lh-live' });
  const pub = room.publisher();
  assert.equal(pub.provider, 'volcengine');
  assert.equal(pub.channel_id, 'lh-live');
  assert.ok(0 in parse(pub.token).privs);
  const a = room.viewer(), b = room.viewer();
  assert.notEqual(a.user_id, b.user_id);
  assert.equal(a.publisher, 'lh-host');
  const t = parse(a.token);
  assert.deepEqual(Object.keys(t.privs).map(Number), [PRIV.subscribe]);
  assert.equal(t.userId, a.user_id);
  assert.ok(!('app_key' in a) && !JSON.stringify(a).includes(KEY));
});

test('server: own room hides tickets from /api/state and only hands them out on air', async () => {
  const { start } = await import('../server/index.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-rtc-'));
  const app = await start({ DATA_DIR: dir, MODEL_OFF: '1', VOICE_OFF: '1', AVATAR: 'vidu', ON_AIR: 'off', VIDU_KEY: 'test', VOLC_RTC_APP_ID: APP, VOLC_RTC_APP_KEY: KEY });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const state = await (await fetch(`${base}/api/state`)).text();
    assert.ok(!state.includes(KEY));
    const av = JSON.parse(state).avatar;
    assert.equal(av.kind, 'offline');
    assert.ok(!JSON.stringify(av).includes('token'));
    assert.equal((await fetch(`${base}/api/rtc-ticket`)).status, 409);
  } finally { await app.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); }
});
