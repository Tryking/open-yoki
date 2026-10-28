// Direct client for the official X (Twitter) API v2, for the streamer's own account. No panel, no extra
// dependencies: OAuth 1.0a user-context signing is done here with node:crypto.
//
// Keys come only from env (never from files, never echoed in errors):
//   X_API_KEY, X_API_SECRET          app consumer key / secret
//   X_ACCESS_TOKEN, X_ACCESS_SECRET  the account's access token / secret (app permission must be "Read and write")
//   X_BEARER_TOKEN                   optional app-only token, used for read-only calls when present
//   X_USER_ID                        optional: the account's numeric id, saves one /2/users/me call
//   X_API_BASE                       optional: defaults to https://api.x.com
//
// Methods:
//   list()                  inbox of mentions / replies / quotes-with-@ of the account.
//                             Item shape: { id, kind: 'reply'|'mention'|'quote', text, url, author, name,
//                             followers, verified, ours, at }. Oldest first. Items stay until reply() or ignore().
//   reply(id, text)         reply to an inbox item (the item id is the post id).
//   replyTo(tweet, text)    reply to any post id.
//   ignore(id)              X has no inbox: drops the item locally only.
//   post(text, { media })   post, optionally with media: file paths or { data, mimeType }; images go up in one
//                             request, videos and GIFs in chunks (initialize / append / finalize) and wait for X's
//                             processing. Returns { ok, id, url } as soon as X accepts it.
//   uploadMedia(input)      returns the media id string.
//   status(id)              { exists, state: 'PUBLISHED'|'MISSING', url, text, metrics }.
//   search(query, max, extra) GET /2/tweets/search/recent, { posts, newest } (posts: { id, who, text, at, url });
//                             throws XError instead of returning null. Used by xlearn.mjs.
//   latest(accounts, max, extra) the "big accounts" search: (from:a OR from:b) -is:retweet -is:reply.
//   me()                    the account's { id, username, name } (cached; X_USER_ID skips the call).
//
// Wiring the reply loop: client: createXClient({ env, stateFile }).
//
// Errors are XError { code, status, resetAt, endpoint }. Codes: missing_keys, rate_limited (resetAt = ms when X
// lets the call again; the same endpoint is refused locally until then, so callers never spin), no_read_access
// (free tier / plan cannot read), no_write_access (app is read-only), no_credits, bad_auth, duplicate, not_found,
// x_unavailable, network, media_failed, media_timeout, bad_answer. Nothing retries on its own.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const API = 'https://api.x.com';
const KEY_ENV = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET', 'X_BEARER_TOKEN'];
const USER_ENV = KEY_ENV.slice(0, 4);
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4' };
const IMAGE_MAX = 5 * 1024 * 1024;

export class XError extends Error {
  constructor(message, { code = 'x_error', status = 0, resetAt = null, endpoint = '' } = {}) {
    super(message);
    this.name = 'XError'; this.code = code; this.status = status; this.resetAt = resetAt; this.endpoint = endpoint;
  }
}

// RFC 3986 percent-encoding, as OAuth 1.0a requires (encodeURIComponent leaves !'()* alone).
export function percentEncode(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// pairs: [key, value] of every query/form parameter plus the oauth_* ones (JSON and multipart bodies are not signed).
export function signatureBaseString(method, baseUrl, pairs) {
  const enc = pairs.map(([k, v]) => [percentEncode(k), percentEncode(v)]).sort((a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]));
  return [String(method).toUpperCase(), percentEncode(baseUrl), percentEncode(enc.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
}

// One OAuth 1.0a HMAC-SHA1 Authorization header. params: extra signed params (object or [k, v] pairs) besides the
// ones already in url's query string.
export function oauth1Header({ method, url, params = [], consumerKey, consumerSecret, token, tokenSecret, nonce, timestamp }) {
  const u = new URL(url);
  const base = `${u.protocol}//${u.host}${u.pathname}`;
  const oauth = { oauth_consumer_key: consumerKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp), oauth_token: token, oauth_version: '1.0' };
  const pairs = [...u.searchParams, ...(Array.isArray(params) ? params : Object.entries(params)), ...Object.entries(oauth)];
  const baseString = signatureBaseString(method, base, pairs);
  const signature = crypto.createHmac('sha1', `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret || '')}`).update(baseString).digest('base64');
  const header = 'OAuth ' + Object.entries({ ...oauth, oauth_signature: signature }).sort((a, b) => cmp(a[0], b[0]))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`).join(', ');
  return { header, signature, baseString };
}

// Query strings are built with RFC 3986 encoding (spaces as %20, never '+') so the signed and sent forms agree.
const qs = o => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`).join('&');
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || lo));
const newer = (a, b) => { try { return BigInt(a) > BigInt(b); } catch { return String(a) > String(b); } };

const TWEET_FIELDS = 'created_at,author_id,conversation_id,referenced_tweets';
const USER_FIELDS = 'username,name,public_metrics,verified,verified_type';

export function createXClient({ env = process.env, fetchFn = globalThis.fetch, stateFile = null, timeoutMs = 30e3, uploadTimeoutMs = 300e3,
  chunkBytes = 4 * 1024 * 1024, processTimeoutMs = 10 * 60e3, maxPolls = 200, mentionsMax = 20, mentionPages = 3, keepMs = 3 * 864e5,
  inboxMax = 200, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)),
  nonce = () => crypto.randomBytes(16).toString('hex'), log = () => {} } = {}) {
  const base = String(env.X_API_BASE || API).replace(/\/$/, '');
  const secrets = KEY_ENV.map(k => env[k]).filter(v => typeof v === 'string' && v.length >= 4);
  const scrub = s => secrets.reduce((t, k) => t.split(k).join('***').split(percentEncode(k)).join('***'), String(s));
  const hasUser = USER_ENV.every(k => env[k]), hasBearer = !!env.X_BEARER_TOKEN;
  const blocked = new Map();   // endpoint -> ms until X allows it again (after a 429)

  let st = { sinceId: null, inbox: [], ignored: [] };
  if (stateFile) { try { st = { ...st, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch {} }
  const save = () => {
    if (!stateFile) return;
    try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile + '.tmp', JSON.stringify(st)); fs.renameSync(stateFile + '.tmp', stateFile); }
    catch (err) { log('xapi: state save failed ' + err.message); }
  };

  function authHeader(auth, method, url) {
    if (auth === 'read' && hasBearer) return `Bearer ${env.X_BEARER_TOKEN}`;
    if (!hasUser) {
      const miss = (auth === 'read' ? [...USER_ENV, 'or X_BEARER_TOKEN'] : USER_ENV.filter(k => !env[k])).join(', ');
      throw new XError(`X keys missing: set ${miss}`, { code: 'missing_keys' });
    }
    return oauth1Header({ method, url, consumerKey: env.X_API_KEY, consumerSecret: env.X_API_SECRET, token: env.X_ACCESS_TOKEN,
      tokenSecret: env.X_ACCESS_SECRET, nonce: nonce(), timestamp: Math.floor(now() / 1000) }).header;
  }

  function rateError(ep, resetAt) {
    const secs = Math.max(0, Math.ceil((resetAt - now()) / 1000));
    return new XError(`X rate limit on ${ep}: wait until ${new Date(resetAt).toISOString()} (${secs}s)`, { code: 'rate_limited', status: 429, resetAt, endpoint: ep });
  }

  function httpError(ep, method, status, j) {
    const e0 = Array.isArray(j?.errors) ? j.errors[0] || {} : {};
    const reason = scrub(String(j?.detail || j?.title || e0.message || e0.detail || e0.title || j?.raw || '').replace(/\s+/g, ' ').trim().slice(0, 240));
    const all = `${j?.reason || ''} ${j?.required_enrollment || ''} ${j?.title || ''} ${reason}`;
    let code = `http_${status}`, hint = '';
    if (status === 401) { code = 'bad_auth'; hint = 'X did not accept the keys: check X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET and the server clock'; }
    else if (status === 402) { code = 'no_credits'; hint = 'the X developer account has no credits or plan for this call'; }
    else if (status === 403 && /client-not-enrolled|not enrolled|attached to a Project|Level of API Access|subset of X API|access level|upgrade/i.test(all)) {
      code = method === 'GET' ? 'no_read_access' : 'no_access';
      hint = method === 'GET' ? "this app's X plan cannot read this endpoint (the free tier can only post); upgrade the plan or turn this feature off"
        : "this app's X plan does not include this endpoint";
    }
    else if (status === 403 && /oauth1[- ]permissions|not permitted to perform|read-only|Read and Write/i.test(all)) {
      code = 'no_write_access'; hint = 'set the app to "Read and write" in the X developer portal, then regenerate the access token and secret';
    }
    else if (status === 403 && /duplicate/i.test(all)) code = 'duplicate';
    else if (status === 403) code = 'forbidden';
    else if (status === 404) code = 'not_found';
    else if (status >= 500) code = 'x_unavailable';
    return new XError(`X ${ep}: ${status}${reason ? ' ' + reason : ''}${hint ? ` (${hint})` : ''}`, { code, status, endpoint: ep });
  }

  // One call. label is the endpoint with ids replaced (/2/users/:id/mentions), used for messages and rate-limit memory.
  async function request(method, p, { query, json, form, auth = 'user', label = p, timeout = timeoutMs } = {}) {
    const ep = `${method} ${label}`;
    const until = blocked.get(ep);
    if (until && now() < until) throw rateError(ep, until);
    const url = base + p + (query && qs(query) ? '?' + qs(query) : '');
    const headers = { authorization: authHeader(auth, method, url) };
    let body;
    if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
    else if (form) body = form;
    let r;
    try { r = await fetchFn(url, { method, headers, body, signal: AbortSignal.timeout(timeout) }); }
    catch (err) { throw new XError(scrub(`X ${ep}: network error: ${err?.message || err}`), { code: 'network', endpoint: ep }); }
    const text = await r.text().catch(() => '');
    let j;
    try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text.slice(0, 200) }; }
    if (r.status === 429) {
      const h = k => r.headers.get(k);
      let resetAt = 0;
      if (h('x-rate-limit-reset')) resetAt = Number(h('x-rate-limit-reset')) * 1000;
      for (const who of ['user', 'app']) {   // the 24-hour post caps answer 429 too
        if (h(`x-${who}-limit-24hour-remaining`) === '0' && h(`x-${who}-limit-24hour-reset`)) resetAt = Math.max(resetAt, Number(h(`x-${who}-limit-24hour-reset`)) * 1000);
      }
      if (!(resetAt > now())) resetAt = now() + 60e3;   // no usable header: hold the endpoint for a minute
      blocked.set(ep, resetAt);
      throw rateError(ep, resetAt);
    }
    if (!r.ok) throw httpError(ep, method, r.status, j);
    return j;
  }

  let meP = null;
  function me() {
    if (env.X_USER_ID) return Promise.resolve({ id: String(env.X_USER_ID), username: env.X_USERNAME || '', name: '' });
    meP ||= request('GET', '/2/users/me', { auth: 'user' }).then(j => {
      if (!j.data?.id) throw new XError('X GET /2/users/me: no user id in the answer', { code: 'bad_answer' });
      return { id: j.data.id, username: j.data.username || '', name: j.data.name || '' };
    }).catch(err => { meP = null; throw err; });
    return meP;
  }

  // ---- inbox (mentions) ----
  function toItem(t, users, tweets, myId) {
    const u = users.get(t.author_id) || {};
    const refs = t.referenced_tweets || [];
    const mine = type => { const r = refs.find(x => x.type === type); const o = r && tweets.get(r.id); return o && o.author_id === myId ? o : null; };
    const rep = mine('replied_to'), quo = rep ? null : mine('quoted');
    const verified = !!(u.verified || (u.verified_type && u.verified_type !== 'none'));
    return { id: t.id, kind: rep ? 'reply' : quo ? 'quote' : 'mention', text: String(t.text || ''),
      url: `https://x.com/${u.username || 'i'}/status/${t.id}`, author: u.username || '', name: u.name || '',
      followers: u.public_metrics?.followers_count || 0, verified, ours: (rep || quo)?.text || '',
      at: t.created_at ? Date.parse(t.created_at) : now() };
  }

  async function list({ max = mentionsMax } = {}) {
    const myId = (await me()).id;
    const got = [];
    let token = null, newest = null, pages = 0;
    do {
      const query = { max_results: clamp(max, 5, 100), 'tweet.fields': TWEET_FIELDS, 'user.fields': USER_FIELDS,
        expansions: 'author_id,referenced_tweets.id,referenced_tweets.id.author_id', since_id: st.sinceId, pagination_token: token };
      const j = await request('GET', `/2/users/${myId}/mentions`, { query, auth: 'read', label: '/2/users/:id/mentions' });
      newest ||= j.meta?.newest_id || null;
      const users = new Map((j.includes?.users || []).map(u => [u.id, u]));
      const tweets = new Map((j.includes?.tweets || []).map(t => [t.id, t]));
      for (const t of Array.isArray(j.data) ? j.data : []) if (t?.author_id !== myId) got.push(toItem(t, users, tweets, myId));
      token = st.sinceId ? j.meta?.next_token : null;   // first run: the newest page only
    } while (token && ++pages < mentionPages);
    if (newest && (!st.sinceId || newer(newest, st.sinceId))) st.sinceId = newest;
    const have = new Set(st.inbox.map(x => x.id)), ign = new Set(st.ignored);
    for (const it of got) if (!have.has(it.id) && !ign.has(it.id)) st.inbox.push(it);
    st.inbox = st.inbox.filter(x => now() - x.at < keepMs).sort((a, b) => (newer(a.id, b.id) ? 1 : -1)).slice(-inboxMax);
    save();
    return st.inbox.map(x => ({ ...x }));
  }

  const drop = id => { st.inbox = st.inbox.filter(x => x.id !== String(id)); };

  function ignore(id) {
    drop(id);
    st.ignored = [...st.ignored.filter(x => x !== String(id)), String(id)].slice(-500);
    save();
    return Promise.resolve({ ok: true });
  }

  // ---- media ----
  async function readMedia(input, mimeType) {
    if (typeof input === 'string' || input?.path) {
      const file = typeof input === 'string' ? input : input.path;
      const data = await fs.promises.readFile(file);
      return { data, type: mimeType || input?.mimeType || MIME[path.extname(file).toLowerCase()], name: path.basename(file) };
    }
    const data = input?.data ?? input;
    if (!(data instanceof Uint8Array)) throw new XError('X media: give a file path, a Buffer, or { data, mimeType }', { code: 'bad_media' });
    return { data: Buffer.from(data), type: mimeType || input?.mimeType, name: input?.name || 'media' };
  }

  async function waitProcessing(id, info) {
    const deadline = now() + processTimeoutMs;
    for (let n = 0; info && (info.state === 'pending' || info.state === 'in_progress'); n++) {
      if (n >= maxPolls || now() > deadline) throw new XError(`X media ${id}: still processing after the wait limit`, { code: 'media_timeout' });
      await sleep(clamp(info.check_after_secs, 1, 60) * 1000);
      const j = await request('GET', '/2/media/upload', { query: { command: 'STATUS', media_id: id }, auth: 'user', label: '/2/media/upload STATUS' });
      info = j.data?.processing_info;
    }
    if (info?.state === 'failed') {
      const why = scrub(info.error?.message || info.error?.name || 'X could not process it');
      throw new XError(`X media ${id}: processing failed: ${why}`, { code: 'media_failed' });
    }
  }

  async function uploadMedia(input, { mimeType, category } = {}) {
    const { data, type, name } = await readMedia(input, mimeType);
    if (!type) throw new XError(`X media: unknown file type for ${name}; pass mimeType`, { code: 'bad_media' });
    const video = type.startsWith('video/'), gif = type === 'image/gif';
    const cat = category || (video ? 'tweet_video' : gif ? 'tweet_gif' : 'tweet_image');
    const idOf = (j, step) => {
      const id = j.data?.id || j.data?.media_id_string || j.media_id_string;
      if (!id) throw new XError(`X media ${step}: no media id in the answer`, { code: 'bad_answer' });
      return String(id);
    };
    if (!video && !gif && data.length <= IMAGE_MAX) {
      const form = new FormData();
      form.append('media', new Blob([data], { type }), name);
      form.append('media_category', cat);
      form.append('media_type', type);
      const j = await request('POST', '/2/media/upload', { form, auth: 'user', timeout: uploadTimeoutMs });
      return idOf(j, 'upload');
    }
    const init = await request('POST', '/2/media/upload/initialize', { json: { media_type: type, total_bytes: data.length, media_category: cat }, auth: 'user' });
    const id = idOf(init, 'initialize');
    for (let i = 0, off = 0; off < data.length; i++, off += chunkBytes) {
      const form = new FormData();
      form.append('media', new Blob([data.subarray(off, off + chunkBytes)], { type: 'application/octet-stream' }), name);
      form.append('segment_index', String(i));
      await request('POST', `/2/media/upload/${id}/append`, { form, auth: 'user', label: '/2/media/upload/:id/append', timeout: uploadTimeoutMs });
    }
    const fin = await request('POST', `/2/media/upload/${id}/finalize`, { auth: 'user', label: '/2/media/upload/:id/finalize' });
    await waitProcessing(id, fin.data?.processing_info);
    return id;
  }

  // ---- posting ----
  async function post(text, { media = [], mediaIds = [], replyTo = null, replySettings = null } = {}) {
    const ids = mediaIds.map(String);
    for (const m of [].concat(media || [])) ids.push(await uploadMedia(m));
    const body = { text: String(text ?? '') };
    if (ids.length) body.media = { media_ids: ids };
    if (replyTo) body.reply = { in_reply_to_tweet_id: String(replyTo) };
    if (replySettings) body.reply_settings = replySettings;
    const j = await request('POST', '/2/tweets', { json: body, auth: 'user' });
    const id = j.data?.id;
    if (!id) throw new XError('X POST /2/tweets: no post id in the answer', { code: 'bad_answer' });
    return { ok: true, id: String(id), url: `https://x.com/i/status/${id}`, text: j.data.text ?? body.text };
  }

  async function reply(id, text) {
    const r = await post(text, { replyTo: id });
    drop(id); save();
    return r;
  }
  const replyTo = (tweet, text) => post(text, { replyTo: tweet });

  async function status(id) {
    let j;
    try { j = await request('GET', `/2/tweets/${id}`, { query: { 'tweet.fields': 'created_at,author_id,public_metrics' }, auth: 'read', label: '/2/tweets/:id' }); }
    catch (err) { if (err.code === 'not_found') return { ok: true, exists: false, state: 'MISSING', id: String(id), reason: err.message }; throw err; }
    if (!j.data) return { ok: true, exists: false, state: 'MISSING', id: String(id), reason: scrub(j.errors?.[0]?.detail || j.errors?.[0]?.title || 'not found') };
    return { ok: true, exists: true, state: 'PUBLISHED', id: String(j.data.id), text: j.data.text || '', url: `https://x.com/i/status/${j.data.id}`,
      createdAt: j.data.created_at || null, metrics: j.data.public_metrics || null };
  }

  // ---- reading others (learning) ----
  async function search(query, max = 10, extra = {}) {
    const q = { query, max_results: clamp(max, 10, 100), 'tweet.fields': 'created_at,author_id', expansions: 'author_id', 'user.fields': 'username', ...extra };
    const j = await request('GET', '/2/tweets/search/recent', { query: q, auth: 'read' });
    const users = new Map((j.includes?.users || []).map(u => [u.id, u.username]));
    return { posts: (Array.isArray(j.data) ? j.data : []).map(t => ({ id: t.id, who: users.get(t.author_id) || '?', text: String(t.text || ''), at: t.created_at || null,
      url: `https://x.com/${users.get(t.author_id) || 'i'}/status/${t.id}` })), newest: j.meta?.newest_id || null };
  }

  const latest = (accounts, max = 20, extra = {}) => {
    const from = [].concat(accounts || []).map(a => 'from:' + String(a).replace(/^@/, '')).filter(a => a.length > 5);
    if (!from.length) return Promise.resolve({ posts: [], newest: null });
    return search(`(${from.join(' OR ')}) -is:retweet -is:reply`, max, extra);
  };

  return { list, reply, replyTo, ignore, post, uploadMedia, status, search, latest, me,
    configured: { user: hasUser, read: hasUser || hasBearer }, state: () => st };
}
