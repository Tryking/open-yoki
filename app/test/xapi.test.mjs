// Tests for server/xapi.mjs. Every call goes to a fake fetch; nothing touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createXClient, oauth1Header, percentEncode, signatureBaseString, XError } from '../server/xapi.mjs';

// Made-up keys, distinctive enough to search for in error text.
const ENV = { X_API_KEY: 'ck-AAAA1111consumer', X_API_SECRET: 'cs-BBBB2222consumersecret', X_ACCESS_TOKEN: '42-CCCC3333accesstoken',
  X_ACCESS_SECRET: 'as-DDDD4444accesssecret', X_BEARER_TOKEN: 'bt-EEEE5555bearer', X_USER_ID: '42' };
const KEYS = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET', 'X_BEARER_TOKEN'].map(k => ENV[k]);

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// A fake fetch answering from a list of [match, reply] routes; every call is recorded.
function fakeX(routes) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url), call = { url, u, method: init.method || 'GET', headers: init.headers || {}, body: init.body };
    calls.push(call);
    for (const [m, reply] of routes) {
      const [meth, p] = m.split(' ');
      if (meth === call.method && (p instanceof RegExp ? p.test(u.pathname) : new RegExp('^' + p + '$').test(u.pathname))) return typeof reply === 'function' ? reply(call) : reply.clone();   // a Response body reads once
    }
    return json({ title: 'no route', detail: `${call.method} ${u.pathname}` }, 404);
  };
  return { fetchFn, calls };
}

const client = (fetchFn, extra = {}) => createXClient({ env: ENV, fetchFn, nonce: () => 'nonce123', now: () => 1_800_000_000_000, sleep: async () => {}, ...extra });

// ---- OAuth 1.0a: the worked example from X's docs (docs.x.com, "Creating a signature"; api.x.com host) ----
test('OAuth 1.0a signature matches the X docs example', () => {
  const r = oauth1Header({
    method: 'POST', url: 'https://api.x.com/1.1/statuses/update.json?include_entities=true',
    params: { status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
    consumerKey: 'xvz1evFS4wEEPTGEFPHBog', consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: 1318622958,
  });
  assert.equal(r.baseString, 'POST&https%3A%2F%2Fapi.x.com%2F1.1%2Fstatuses%2Fupdate.json&include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521');
  assert.equal(r.signature, 'Ls93hJiZbQ3akF3HF3x1Bz8/zU4=');
  assert.match(r.header, /^OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog", oauth_nonce="kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", oauth_signature="Ls93hJiZbQ3akF3HF3x1Bz8%2FzU4%3D", oauth_signature_method="HMAC-SHA1", oauth_timestamp="1318622958", oauth_token="370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", oauth_version="1.0"$/);
});

test('percent-encoding follows RFC 3986', () => {
  assert.equal(percentEncode("Ladies + Gentlemen!*'()~"), 'Ladies%20%2B%20Gentlemen%21%2A%27%28%29~');
  assert.equal(percentEncode('☃'), '%E2%98%83');
  assert.equal(signatureBaseString('get', 'https://a.b/c', [['b', '2'], ['a', '2'], ['a', '1']]), 'GET&https%3A%2F%2Fa.b%2Fc&a%3D1%26a%3D2%26b%3D2');
});

// The header a request carried must be the one we would compute for its exact URL (query params signed, body not).
function assertSigned(call) {
  const want = oauth1Header({ method: call.method, url: call.url, consumerKey: ENV.X_API_KEY, consumerSecret: ENV.X_API_SECRET,
    token: ENV.X_ACCESS_TOKEN, tokenSecret: ENV.X_ACCESS_SECRET, nonce: 'nonce123', timestamp: 1_800_000_000 }).header;
  assert.equal(call.headers.authorization, want);
}

// ---- posting ----
test('post(): text post via POST /2/tweets with OAuth 1.0a', async () => {
  const x = fakeX([['POST /2/tweets', json({ data: { id: '1001', text: 'gm' } }, 201)]]);
  const r = await client(x.fetchFn).post('gm');
  assert.deepEqual(r, { ok: true, id: '1001', url: 'https://x.com/i/status/1001', text: 'gm' });
  assert.equal(x.calls.length, 1);
  assert.equal(x.calls[0].url, 'https://api.x.com/2/tweets');
  assert.deepEqual(JSON.parse(x.calls[0].body), { text: 'gm' });
  assertSigned(x.calls[0]);
});

test('reply() and replyTo(): reply.in_reply_to_tweet_id, and reply() clears the inbox item', async () => {
  let n = 0;
  const x = fakeX([
    ['GET /2/users/42/mentions', json({ data: [{ id: '500', author_id: '7', text: '@me hi' }], includes: { users: [{ id: '7', username: 'bob', name: 'Bob' }] }, meta: { newest_id: '500' } })],
    ['POST /2/tweets', () => json({ data: { id: String(900 + ++n), text: 'x' } }, 201)],
  ]);
  const c = client(x.fetchFn);
  assert.equal((await c.list()).length, 1);
  const r1 = await c.reply('500', 'hello bob');
  assert.equal(r1.url, 'https://x.com/i/status/901');
  assert.deepEqual(JSON.parse(x.calls[1].body), { text: 'hello bob', reply: { in_reply_to_tweet_id: '500' } });
  assert.equal(c.state().inbox.length, 0);
  const r2 = await c.replyTo('777', 'found you');
  assert.equal(r2.id, '902');
  assert.deepEqual(JSON.parse(x.calls[2].body), { text: 'found you', reply: { in_reply_to_tweet_id: '777' } });
  assertSigned(x.calls[2]);
});

test('post() with an image: one multipart upload, then the media id in the post', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xapi-')), img = path.join(dir, 'a.png');
  fs.writeFileSync(img, Buffer.alloc(1000, 1));
  const x = fakeX([
    ['POST /2/media/upload', json({ data: { id: '3001', media_key: '3_3001' } })],
    ['POST /2/tweets', json({ data: { id: '1002', text: 'pic' } }, 201)],
  ]);
  const r = await client(x.fetchFn).post('pic', { media: [img] });
  assert.equal(r.id, '1002');
  const up = x.calls[0];
  assert.ok(up.body instanceof FormData);
  assert.equal(up.body.get('media_category'), 'tweet_image');
  assert.equal(up.body.get('media_type'), 'image/png');
  assert.equal((await up.body.get('media').arrayBuffer()).byteLength, 1000);
  assertSigned(up);   // multipart fields are not part of the signature
  assert.deepEqual(JSON.parse(x.calls[1].body), { text: 'pic', media: { media_ids: ['3001'] } });
  fs.rmSync(dir, { recursive: true });
});

test('post() with a video: initialize, append in chunks, finalize, wait for processing, then post', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xapi-')), vid = path.join(dir, 'clip.mp4');
  fs.writeFileSync(vid, Buffer.alloc(25, 7));
  const states = ['in_progress', 'succeeded'], slept = [];
  const x = fakeX([
    ['POST /2/media/upload/initialize', json({ data: { id: '4001', media_key: '7_4001', expires_after_secs: 86400 } })],
    ['POST /2/media/upload/4001/append', json({})],
    ['POST /2/media/upload/4001/finalize', json({ data: { id: '4001', processing_info: { state: 'pending', check_after_secs: 3 } } })],
    ['GET /2/media/upload', () => json({ data: { id: '4001', processing_info: { state: states.shift(), check_after_secs: 2 } } })],
    ['POST /2/tweets', json({ data: { id: '1003', text: 'clip' } }, 201)],
  ]);
  const r = await client(x.fetchFn, { chunkBytes: 10, sleep: async ms => { slept.push(ms); } }).post('clip', { media: [vid] });
  assert.equal(r.id, '1003');
  const seq = x.calls.map(c => `${c.method} ${c.u.pathname}`);
  assert.deepEqual(seq, ['POST /2/media/upload/initialize', 'POST /2/media/upload/4001/append', 'POST /2/media/upload/4001/append',
    'POST /2/media/upload/4001/append', 'POST /2/media/upload/4001/finalize', 'GET /2/media/upload', 'GET /2/media/upload', 'POST /2/tweets']);
  assert.deepEqual(JSON.parse(x.calls[0].body), { media_type: 'video/mp4', total_bytes: 25, media_category: 'tweet_video' });
  assert.deepEqual(x.calls.slice(1, 4).map(c => c.body.get('segment_index')), ['0', '1', '2']);
  assert.deepEqual(await Promise.all(x.calls.slice(1, 4).map(async c => (await c.body.get('media').arrayBuffer()).byteLength)), [10, 10, 5]);
  assert.equal(x.calls[5].u.searchParams.get('command'), 'STATUS');
  assert.equal(x.calls[5].u.searchParams.get('media_id'), '4001');
  assertSigned(x.calls[5]);   // query params are signed
  assert.deepEqual(slept, [3000, 2000]);
  assert.deepEqual(JSON.parse(x.calls[7].body).media, { media_ids: ['4001'] });
  fs.rmSync(dir, { recursive: true });
});

test('video processing failure stops before posting', async () => {
  const x = fakeX([
    ['POST /2/media/upload/initialize', json({ data: { id: '4002' } })],
    ['POST /2/media/upload/4002/append', json({})],
    ['POST /2/media/upload/4002/finalize', json({ data: { id: '4002', processing_info: { state: 'pending', check_after_secs: 1 } } })],
    ['GET /2/media/upload', json({ data: { processing_info: { state: 'failed', error: { message: 'Unsupported video codec' } } } })],
  ]);
  await assert.rejects(client(x.fetchFn).post('v', { media: [{ data: Buffer.alloc(5), mimeType: 'video/mp4' }] }), e => e.code === 'media_failed' && /codec/.test(e.message));
  assert.ok(!x.calls.some(c => c.u.pathname === '/2/tweets'));
});

test('video still processing past the poll limit gives media_timeout, no endless loop', async () => {
  const x = fakeX([
    ['POST /2/media/upload/initialize', json({ data: { id: '4003' } })],
    ['POST /2/media/upload/4003/append', json({})],
    ['POST /2/media/upload/4003/finalize', json({ data: { id: '4003', processing_info: { state: 'pending', check_after_secs: 1 } } })],
    ['GET /2/media/upload', json({ data: { processing_info: { state: 'in_progress', check_after_secs: 1 } } })],
  ]);
  await assert.rejects(client(x.fetchFn, { maxPolls: 5 }).uploadMedia({ data: Buffer.alloc(5), mimeType: 'video/mp4' }), e => e.code === 'media_timeout');
  assert.equal(x.calls.filter(c => c.method === 'GET').length, 5);
});

// ---- reading ----
test('list(): mentions become inbox items (reply / quote / mention), oldest first, since_id next time, Bearer for reads', async () => {
  const page1 = {
    data: [
      { id: '120', author_id: '9', text: '@me @a @b look', referenced_tweets: [{ type: 'replied_to', id: '50' }] },
      { id: '110', author_id: '8', text: 'so true @me', referenced_tweets: [{ type: 'quoted', id: '60' }] },
      { id: '100', author_id: '7', text: '@me gm', referenced_tweets: [{ type: 'replied_to', id: '70' }] },
      { id: '105', author_id: '42', text: 'my own post' },
    ],
    includes: {
      users: [{ id: '7', username: 'amy', name: 'Amy', public_metrics: { followers_count: 12 } },
        { id: '8', username: 'ben', name: 'Ben', verified: true, public_metrics: { followers_count: 9000 } },
        { id: '9', username: 'cat', name: 'Cat', verified_type: 'blue' }],
      tweets: [{ id: '70', author_id: '42', text: 'my morning post' }, { id: '60', author_id: '42', text: 'my take' }, { id: '50', author_id: '5', text: 'someone else' }],
    },
    meta: { newest_id: '120', result_count: 4 },
  };
  const pages = [page1, { data: [{ id: '130', author_id: '7', text: '@me again' }], includes: { users: [{ id: '7', username: 'amy', name: 'Amy' }] }, meta: { newest_id: '130' } }];
  const x = fakeX([['GET /2/users/42/mentions', () => json(pages.shift())]]);
  const c = client(x.fetchFn);
  const a = await c.list();
  assert.deepEqual(a.map(i => [i.id, i.kind, i.author, i.ours]), [['100', 'reply', 'amy', 'my morning post'], ['110', 'quote', 'ben', 'my take'], ['120', 'mention', 'cat', '']]);
  assert.deepEqual([a[1].followers, a[1].verified, a[2].verified, a[0].verified], [9000, true, true, false]);
  assert.equal(a[0].url, 'https://x.com/amy/status/100');
  assert.equal(x.calls[0].headers.authorization, 'Bearer ' + ENV.X_BEARER_TOKEN);
  assert.equal(x.calls[0].u.searchParams.get('since_id'), null);
  await c.ignore('110');
  const b = await c.list();
  assert.equal(x.calls[1].u.searchParams.get('since_id'), '120');
  assert.deepEqual(b.map(i => i.id), ['100', '120', '130']);
});

test('list() keeps its place in a state file across restarts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xapi-')), stateFile = path.join(dir, 'x.json');
  const x = fakeX([['GET /2/users/42/mentions', json({ data: [{ id: '200', author_id: '7', text: '@me hey' }], includes: { users: [{ id: '7', username: 'amy' }] }, meta: { newest_id: '200' } })]]);
  await client(x.fetchFn, { stateFile }).list();
  const again = client(x.fetchFn, { stateFile });
  assert.equal(again.state().sinceId, '200');
  const got = await again.list();
  assert.equal(x.calls[1].u.searchParams.get('since_id'), '200');
  assert.deepEqual(got.map(i => i.id), ['200']);   // no duplicate
  fs.rmSync(dir, { recursive: true });
});

test('me(): /2/users/me with OAuth 1.0a when X_USER_ID is not set, cached', async () => {
  const x = fakeX([['GET /2/users/me', json({ data: { id: '77', username: 'host', name: 'Host' } })]]);
  const env = { ...ENV }; delete env.X_USER_ID;
  const c = createXClient({ env, fetchFn: x.fetchFn, nonce: () => 'nonce123', now: () => 1_800_000_000_000 });
  assert.deepEqual(await c.me(), { id: '77', username: 'host', name: 'Host' });
  await c.me();
  assert.equal(x.calls.length, 1);
  assertSigned(x.calls[0]);
});

test('status(): published and missing posts', async () => {
  const x = fakeX([
    ['GET /2/tweets/1001', json({ data: { id: '1001', text: 'gm', created_at: '2026-10-27T00:00:00.000Z', public_metrics: { like_count: 3 } } })],
    ['GET /2/tweets/1002', json({ errors: [{ title: 'Not Found Error', detail: 'Could not find tweet with id: [1002].' }] })],
    ['GET /2/tweets/1003', json({ title: 'Not Found', detail: 'gone' }, 404)],
  ]);
  const c = client(x.fetchFn);
  const a = await c.status('1001');
  assert.equal(a.state, 'PUBLISHED'); assert.equal(a.url, 'https://x.com/i/status/1001'); assert.equal(a.metrics.like_count, 3);
  assert.equal((await c.status('1002')).state, 'MISSING');
  assert.equal((await c.status('1003')).exists, false);
});

test('search() / latest(): xlearn shape, RFC 3986 query', async () => {
  const x = fakeX([['GET /2/tweets/search/recent', json({ data: [{ id: '9', author_id: '1', text: 'BNB', created_at: '2026-10-27T01:00:00.000Z' }], includes: { users: [{ id: '1', username: 'cz_binance' }] }, meta: { newest_id: '9' } })]]);
  const c = client(x.fetchFn);
  const r = await c.latest(['@cz_binance', 'binance'], 20, { since_id: '5' });
  assert.deepEqual(r, { posts: [{ id: '9', who: 'cz_binance', text: 'BNB', at: '2026-10-27T01:00:00.000Z', url: 'https://x.com/cz_binance/status/9' }], newest: '9' });
  assert.equal(x.calls[0].u.searchParams.get('query'), '(from:cz_binance OR from:binance) -is:retweet -is:reply');
  assert.equal(x.calls[0].u.searchParams.get('since_id'), '5');
  assert.ok(!x.calls[0].url.includes('+'), 'spaces are %20, never +');
  const noBearer = { ...ENV }; delete noBearer.X_BEARER_TOKEN;
  await createXClient({ env: noBearer, fetchFn: x.fetchFn, nonce: () => 'nonce123', now: () => 1_800_000_000_000 }).search('bnb lang:en', 10);
  assertSigned(x.calls[1]);   // no Bearer: reads fall back to the user keys
});

// ---- limits and errors ----
test('429: clear error with the reset time, and the endpoint is not called again before it', async () => {
  const reset = 1_800_000_000 + 600;
  const x = fakeX([['POST /2/tweets', json({ title: 'Too Many Requests', detail: 'Too Many Requests' }, 429, { 'x-rate-limit-reset': String(reset), 'x-rate-limit-remaining': '0' })]]);
  let t = 1_800_000_000_000;
  const c = client(x.fetchFn, { now: () => t });
  await assert.rejects(c.post('a'), e => e instanceof XError && e.code === 'rate_limited' && e.resetAt === reset * 1000 && /600s/.test(e.message) && e.message.includes(new Date(reset * 1000).toISOString()));
  await assert.rejects(c.post('b'), e => e.code === 'rate_limited');
  assert.equal(x.calls.length, 1, 'second call refused locally');
  t = reset * 1000 + 1;
  await assert.rejects(c.post('c'), e => e.code === 'rate_limited');
  assert.equal(x.calls.length, 2, 'allowed again after the reset');
});

test('429 from the 24-hour post cap uses that reset', async () => {
  const x = fakeX([['POST /2/tweets', json({ title: 'Too Many Requests' }, 429, { 'x-rate-limit-reset': '1800000060', 'x-user-limit-24hour-remaining': '0', 'x-user-limit-24hour-reset': '1800050000' })]]);
  await assert.rejects(client(x.fetchFn).post('a'), e => e.resetAt === 1800050000 * 1000);
});

test('free tier without read access: no_read_access with a plain explanation', async () => {
  const x = fakeX([['GET /2/users/42/mentions', json({ title: 'Client Forbidden', reason: 'client-not-enrolled', required_enrollment: 'Appropriate Level of API Access',
    detail: 'When authenticating requests to the Twitter API v2 endpoints, you must use keys and tokens from a Twitter developer App that is attached to a Project.' }, 403)]]);
  await assert.rejects(client(x.fetchFn).list(), e => e.code === 'no_read_access' && e.status === 403 && /free tier can only post/.test(e.message));
});

test('read-only app trying to post: no_write_access', async () => {
  const x = fakeX([['POST /2/tweets', json({ title: 'Forbidden', detail: 'Your client app is not configured with the appropriate oauth1 app permissions for this endpoint.', reason: 'oauth1-permissions' }, 403)]]);
  await assert.rejects(client(x.fetchFn).post('a'), e => e.code === 'no_write_access' && /Read and write/.test(e.message));
});

test('missing keys: names the env vars, sends nothing', async () => {
  const x = fakeX([]);
  const c = createXClient({ env: { X_USER_ID: '42' }, fetchFn: x.fetchFn });
  await assert.rejects(c.post('a'), e => e.code === 'missing_keys' && /X_API_KEY/.test(e.message));
  await assert.rejects(c.list(), e => e.code === 'missing_keys' && /X_BEARER_TOKEN/.test(e.message));
  assert.equal(x.calls.length, 0);
  assert.deepEqual(c.configured, { user: false, read: false });
});

test('keys never show up in error messages', async () => {
  const leak = KEYS.join(' ') + ' ' + KEYS.map(percentEncode).join(' ');
  const cases = [
    async () => { throw new Error('connect failed ' + leak); },                      // network error text
    async () => json({ title: 'Unauthorized', detail: 'bad token ' + leak }, 401),    // X echoing something back
    async () => json({ errors: [{ message: leak }] }, 400),
    async () => json({ data: { id: '1', processing_info: { state: 'failed', error: { message: leak } } } }),
  ];
  for (const reply of cases) {
    const c = client(reply);
    const tries = [c.post('a'), c.list(), c.uploadMedia({ data: Buffer.alloc(3), mimeType: 'video/mp4' })];
    for (const p of tries) {
      const err = await p.then(() => null, e => e);
      if (!err) continue;
      const shown = `${err.message} ${err.stack} ${JSON.stringify(err)}`;
      for (const k of KEYS) { assert.ok(!shown.includes(k), `key leaked: ${err.message}`); assert.ok(!shown.includes(percentEncode(k))); }
    }
  }
  const x = fakeX([['POST /2/tweets', json({ detail: 'nope' }, 401)]]);
  await assert.rejects(client(x.fetchFn).post('a'), e => e.code === 'bad_auth' && !/ck-AAAA|cs-BBBB|CCCC3333|DDDD4444/.test(e.message));
});
