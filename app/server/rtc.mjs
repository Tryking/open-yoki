// Our own Volcano Engine RTC channel: the fastest, sturdiest way to get her picture to many viewers.
// Vidu pushes her into the room with a publish token; every visitor gets their own subscribe-only token from
// /api/rtc-ticket and joins invisibly, so the 50-visible-user room limit never applies to the audience.
// Tokens follow Volcano's AccessToken "001" layout (github.com/volcengine/rtc-token): little-endian
// nonce|issuedAt|expireAt|room|user|privileges, HMAC-SHA256 with the app key, then "001" + appId + base64.
import crypto from 'node:crypto';

export const PRIV = { publish: 0, publishAudio: 1, publishVideo: 2, publishData: 3, subscribe: 4 };

export function volcToken({ appId, appKey, roomId, userId, ttlSec = 7200, privileges = [PRIV.subscribe], now = Date.now(), nonce }) {
  const issuedAt = Math.floor(now / 1000);
  const expireAt = issuedAt + ttlSec;
  const privs = new Map();
  for (const p of privileges) {
    privs.set(p, expireAt);
    if (p === PRIV.publish) for (const q of [PRIV.publishAudio, PRIV.publishVideo, PRIV.publishData]) privs.set(q, expireAt);
  }
  const parts = [];
  const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); parts.push(b); };
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); parts.push(b); };
  const bytes = b => { u16(b.length); parts.push(b); };
  u32(nonce ?? crypto.randomInt(0, 0xffffffff));
  u32(issuedAt);
  u32(expireAt);
  bytes(Buffer.from(roomId));
  bytes(Buffer.from(userId));
  const keys = [...privs.keys()].sort((a, b) => a - b);
  u16(keys.length);
  for (const k of keys) { u16(k); u32(privs.get(k)); }
  const msg = Buffer.concat(parts);
  const sig = crypto.createHmac('sha256', appKey).update(msg).digest();
  const out = Buffer.concat([Buffer.from([msg.length & 0xff, msg.length >> 8]), msg, Buffer.from([sig.length & 0xff, sig.length >> 8]), sig]);
  return '001' + appId + out.toString('base64');
}

// One room per idol. publisher() is what Vidu's customer_rtc gets; viewer() is one visitor's ticket.
export function createVolcRoom({ appId, appKey, roomId, publisherId = 'lh-host' }) {
  return {
    appId, roomId, publisherId,
    publisher: () => ({ provider: 'volcengine', app_id: appId, channel_id: roomId, user_id: publisherId,
      token: volcToken({ appId, appKey, roomId, userId: publisherId, ttlSec: 26 * 3600, privileges: [PRIV.publish, PRIV.subscribe] }) }),
    viewer: () => {
      const userId = 'v' + crypto.randomBytes(6).toString('hex');
      return { app_id: appId, room_id: roomId, user_id: userId, publisher: publisherId, token: volcToken({ appId, appKey, roomId, userId, ttlSec: 4 * 3600 }) };
    },
  };
}
