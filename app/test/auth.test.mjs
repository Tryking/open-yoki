import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, isGuest, SESSION_MS } from '../server/auth.mjs';

test('a guest gets a token that names them for a day, then expires', () => {
  let t = 1e12;
  const auth = createAuth({ now: () => t });
  const { token, address } = auth.guest();
  assert.ok(isGuest(address));
  assert.equal(auth.who(token), address);
  t += SESSION_MS + 1;
  assert.equal(auth.who(token), null);
});

test('unknown tokens are nobody', () => {
  const auth = createAuth();
  assert.equal(auth.who('nope'), null);
  assert.equal(auth.who(''), null);
  assert.ok(!isGuest('someone'));
});

test('bad request bodies get 400, not 500, and the server keeps running', async () => {
  const { start } = await import('../server/index.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-auth-'));
  const app = await start({ IDOL: 'example', MODE: 'test', DATA_DIR: dir, MODEL_OFF: '1', VOICE_OFF: '1' });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/chat`, { method: 'POST', body: '{bad' })).status, 400);
    assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 404);
    // A scanner path that reads as a host under new URL(path, base); sent raw so nothing normalizes it first.
    const http = await import('node:http');
    const raw = path => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: app.server.address().port, path }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject));
    assert.equal(await raw('//%2e%2e%2f%2eenv'), 404);
    assert.equal(await raw('/../../etc/passwd'), 404);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  } finally { app.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); }
});
