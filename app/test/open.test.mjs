// The open-source package must carry nothing private: no names or nicknames of the people behind the original host,
// no private tool names, no accounts, domains, server addresses, wallet addresses, keys, cloned-voice ids or local
// paths, and no broken characters. This scans every text file in the package (node_modules, third-party vendor files
// and binaries skipped) and fails with file:line for each hit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = fileURLToPath(import.meta.url);
// Only in the source package: a release on the server holds app/ alone (deploy/release.sh runs the tests there too).
const inPackage = ['deploy', 'heart-template', 'app'].every(d => fs.existsSync(path.join(PKG, d)));
const pkgOnly = { skip: inPackage ? false : 'not in the source package' };
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'venv', '__pycache__', 'data']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|mp4|mov|m4a|mp3|wav|ogg|ttf|otf|woff2?|pdf|zip|gz|tgz|bin|pcm|ts)$/i;

const RULES = [
  // the package's own name (open-yoki, OPEN_YOKI_*) is fine; any other yoki is the original host
  ['original host account or domain', /(?<!open[-_])yoki/i],
  ['IP address', /(?<![\w./-])(?!127\.0\.0\.1\b|0\.0\.0\.0\b|169\.254\.169\.254\b)\d{1,3}(?:\.\d{1,3}){3}(?![\w.])/],
  ['wallet or contract address', /0x[0-9a-fA-F]{40}/],
  ['key-like string', /\bsk-[A-Za-z0-9_-]{16,}|\bxai-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/=-]{30,}|\b[0-9a-f]{64}\b/],
  ['cloned voice id', /\bS_[A-Za-z0-9]{6,}\b/],
  ['local path', /\/Users\/[A-Za-z]|\/home\/[a-z]+\//],
  ['broken character', /\uFFFD/],
];
// Names, handles and tool names that must never ship are personal, so they live in a file next to this one that is
// not committed (private-words.local.json: [{ rule, re, flags }]); without it only the rules above run.
const LOCAL = path.join(path.dirname(fileURLToPath(import.meta.url)), 'private-words.local.json');
if (fs.existsSync(LOCAL)) for (const w of JSON.parse(fs.readFileSync(LOCAL, 'utf8'))) RULES.push([w.rule, new RegExp(w.re, w.flags || '')]);
// The README may say where the project comes from; nothing else may name the original host.
const ALLOW = [
  { file: /^README(\.[a-z]+)?\.md$/, rule: 'original host account or domain', line: /\byoki\b/i, top: true },
  // the web tool's address guard is tested with public and private addresses on purpose
  { file: /^web\.test\.mjs$/, rule: 'IP address', line: /./, top: false },
  // and the guard itself lists the private ranges it blocks
  { file: /^web\.mjs$/, rule: 'IP address', line: /addSubnet/, top: false },
];

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* files(path.join(dir, e.name)); }
    else if (e.isFile() && !BINARY.test(e.name) && !e.name.endsWith('.local.json')) yield path.join(dir, e.name);
  }
}

export function scan(root = PKG) {
  const hits = [];
  for (const f of files(root)) {
    if (f === SELF) continue;
    const buf = fs.readFileSync(f);
    if (buf.includes(0)) continue;   // binary without a known extension
    const rel = path.relative(root, f), base = path.basename(f);
    buf.toString('utf8').split('\n').forEach((l, i) => {
      for (const [name, re] of RULES) {
        if (!re.test(l)) continue;
        if (ALLOW.some(a => a.rule === name && a.file.test(base) && a.line.test(l) && (!a.top || path.dirname(rel) === '.'))) continue;
        hits.push(`${rel}:${i + 1} ${name}: ${l.trim().slice(0, 120)}`);
      }
    });
  }
  return hits;
}

test('the package carries no private names, accounts, addresses, keys or local paths', pkgOnly, () => {
  assert.deepEqual(scan(), []);
});

test('the scan itself catches what it is meant to catch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-open-'));
  const bad = ['yo' + 'ki', '8.8.' + '8.8', '0x' + 'a'.repeat(40), 's' + 'k-' + 'A'.repeat(20), 'S' + '_abcdefg1', '/Us' + 'ers/someone', '�'];
  fs.writeFileSync(path.join(dir, 'x.md'), bad.join('\n'));
  fs.writeFileSync(path.join(dir, 'ok.md'), 'http://127.0.0.1:4370 Chrome/120.0.0.0 X_ACCESS_SECRET= lastErr cc=cn jacket open-yoki OPEN_YOKI_CLIPS');
  const hits = scan(dir);
  assert.equal(hits.length, bad.length, hits.join('\n'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('heart-template seeds an empty home once, with the host name filled in', pkgOnly, async () => {
  const { seedHeartHome } = await import('../server/index.mjs');
  const home = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lh-home-')), 'heart');
  assert.equal(seedHeartHome(home, path.join(PKG, 'heart-template'), { name: '小例', tzName: '北京时间' }), true);
  const who = fs.readFileSync(path.join(home, 'CLAUDE.md'), 'utf8');
  assert.match(who, /^# 这是 小例 的家/);
  assert.doesNotMatch(who, /\{name\}|\{tzName\}/);
  assert.ok(fs.existsSync(path.join(home, '认识的人')) && !fs.existsSync(path.join(home, '认识的人', '.gitkeep')));
  fs.writeFileSync(path.join(home, '边界.md'), 'mine');
  assert.equal(seedHeartHome(home, path.join(PKG, 'heart-template'), { name: 'x' }), false, 'a home with 我是谁.md is left alone');
  assert.equal(fs.readFileSync(path.join(home, '边界.md'), 'utf8'), 'mine');
});
