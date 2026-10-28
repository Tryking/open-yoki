import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSongs } from '../server/songs.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'songs-'));
const list = [{ id: 'apt', title: 'APT.', artist: 'ROSÉ', mood: '魔性搞笑', dur: 170 }, { id: 'haoyunlai', title: '好运来', artist: '祖海', mood: '财运', dur: 200 }, { id: 'badguy', title: 'bad guy', artist: 'Billie Eilish', mood: '装逼大气', dur: 194 }];
fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify([...list, { id: 'gone', title: '没文件', mood: '财运' }]));
for (const s of list) fs.writeFileSync(path.join(dir, s.id + '.m4a'), 'x');

test('show songs: only songs with a file, no repeat right away, a request goes next', () => {
  let r = 0;
  const songs = createSongs({ dir, now: () => Date.parse('2026-10-22T12:00:00Z'), rand: () => (r++ * 0.37) % 1 });
  assert.equal(songs.count, 3);
  const a = songs.next(), b = songs.next();
  assert.notEqual(a.id, b.id);
  assert.ok(list.some(s => s.id === a.id) && a.id !== 'gone');
  assert.deepEqual(songs.ask('小王', '点歌 好运来'), { id: 'haoyunlai', title: '好运来' });
  const c = songs.next();
  assert.equal(c.id, 'haoyunlai'); assert.equal(c.by, '小王');
  assert.deepEqual(songs.ask('小李', '点歌 晴天'), { miss: '晴天' });
  assert.equal(songs.ask('小李', '今天大饼怎么看'), null);
});
