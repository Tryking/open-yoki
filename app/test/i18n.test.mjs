// Every piece of Chinese page text must have an English entry: the static HTML markers, every t('…') in app.js,
// the mood and action names the server sends and every error message the server can return. The page itself must
// stay generic: the host's name, handles and pictures come from /api/state, never from the files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

Object.defineProperty(globalThis, 'navigator', { value: { languages: ['en'] }, configurable: true });
globalThis.localStorage = { getItem: () => 'en', setItem() {} };
const { dict, t, setVars } = await import('../public/i18n.js');
const { MOODS } = await import('../server/world.mjs');
const idol = (await import('../idols/example/config.mjs')).default;
const url = f => new URL(f, import.meta.url);
const read = f => readFileSync(url(f), 'utf8');
const han = /[一-龥]/;

test('every Chinese UI string has an English version', () => {
  const html = read('../public/index.html'), app = read('../public/app.js');
  const keys = new Set();
  for (const m of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) keys.add(m[1]);
  for (const m of app.matchAll(/\bt\('([^']+)'/g)) keys.add(m[1]);
  for (const m of app.matchAll(/'([^'\n]*[一-龥][^'\n]*)'/g)) keys.add(m[1]);
  for (const v of Object.values(MOODS)) keys.add(v);
  for (const k of Object.keys(idol.actions || {})) keys.add(k);
  for (const f of ['../server/index.mjs', '../server/auth.mjs']) {
    if (!existsSync(url(f))) continue;
    for (const m of read(f).matchAll(/(?:error: |AuthError\()'([^']+)'/g)) if (han.test(m[1])) keys.add(m[1]);
  }
  const missing = [...keys].filter(k => han.test(k) && !(k in dict) && k !== '中');
  assert.deepEqual(missing, []);
  for (const [k, v] of Object.entries(dict)) if (k !== '中') assert.ok(!han.test(v), `English still has Chinese: ${k}`);
});

test('no Chinese text in the page is left without a data-i18n marker', () => {
  const html = read('../public/index.html');
  const bare = [...html.matchAll(/<(\w+)([^>]*)>([^<]*)</g)]
    .filter(([, tag, attrs, text]) => han.test(text) && !/data-i18n=/.test(attrs) && tag !== 'script' && text.trim() !== '中').map(m => m[0]);
  for (const m of html.matchAll(/\s(alt|title|placeholder|aria-label)="([^"]*)"/g)) {
    if (han.test(m[2]) && !html.includes(`data-i18n-${m[1]}="${m[2]}"`)) bare.push(m[0]);
  }
  assert.deepEqual(bare, []);
});

test('placeholders are filled in English, and {name} comes from the server', () => {
  assert.equal(t('{m}月{d}日', { m: 10, d: 2 }), 'Oct 2');
  assert.equal(t('没有翻译的字'), '没有翻译的字');
  setVars({ name: 'Nova' });
  assert.equal(t('{name} 是 AI，她说的不是投资建议。'), 'Nova is an AI. Nothing she says is financial advice.');
  assert.match(t('{name} 是陪你熬夜看盘的 AI 主播。'), /^Nova /);
});

test('the page hard-codes no host: no name, handle, domain or picture of her', () => {
  const dir = url('../public/');
  const files = readdirSync(dir).filter(f => /\.(html|js|css|svg)$/.test(f)).map(f => [f, readFileSync(new URL(f, dir), 'utf8')]);
  const names = [idol.name, idol.nameEn, idol.short, idol.id].filter(n => typeof n === 'string' && n.length > 1);
  const handles = [idol.x, idol.square, idol.tg].flatMap(v => typeof v === 'string' ? [v] : v ? Object.values(v) : [])
    .filter(v => typeof v === 'string' && v.length > 3);
  for (const [f, s] of files) {
    for (const n of names) assert.ok(!s.toLowerCase().includes(n.toLowerCase()), `${f} names the host: ${n}`);
    for (const h of handles) assert.ok(!s.includes(h), `${f} has the host's link or handle: ${h}`);
    assert.ok(!/x\.com\/\w|t\.me\/\w|square\/profile\/\w/.test(s), `${f} has a fixed profile link`);
    assert.ok(!/\/art\/[a-z0-9-]+\/looks\//.test(s), `${f} has a fixed picture path`);
  }
  // the page asks /api/state for who she is
  const app = files.find(([f]) => f === 'app.js')[1];
  assert.match(app, /idol\.name/);
});
