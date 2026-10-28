// So she reads as having a soul of her own and not a stiff AI: her feeling shows on her face, and a thought she keeps
// saying drops out of what her heart hands the mouth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faceOfFeel, worn, createBrain } from '../server/brain.mjs';
import { createWorld } from '../server/world.mjs';
import idol from '../idols/example/config.mjs';

test('soul: the feeling she writes for herself picks her face when the tag says calm', async () => {
  assert.equal(faceOfFeel('想笑'), 'happy');
  assert.equal(faceOfFeel('有点烦'), null);   // a mild 烦 must not give her an angry face on plain lines
  assert.equal(faceOfFeel('真生气了'), 'angry');
  assert.equal(faceOfFeel('有点小得意'), 'smug');
  assert.equal(faceOfFeel('委屈'), 'sad');
  assert.equal(faceOfFeel('不太开心'), 'sad');
  assert.equal(faceOfFeel('平静'), null);
  const world = createWorld({ idol });
  const said = [];
  const brain = createBrain({ idol, world, viewers: () => 1, onAir: () => true, idleMs: 1e9,
    ask: async () => ({ text: '想：有点不爽｜又来问能涨到多少的\n[平静][无][吐槽]能涨到多少？我又不是庄。', cost: 0 }),
    speak: async l => { said.push(l); } });
  brain.add({ kind: 'chat', name: '阿杰', text: 'BTC 能涨到多少' });
  brain.start();
  await new Promise(r => setTimeout(r, 60));
  brain.stop();
  assert.equal(said[0].face, 'angry');
  assert.equal(said[0].inner, '有点不爽｜又来问能涨到多少的');
});

test('soul: a thought she already said twice in her last lines leaves the note', () => {
  const note = '心情：有点饿\n在想：泡面加蛋加火腿肠\n接下来想：逗逗糖糖';
  assert.equal(worn(note, ['外卖还没到', '泡面都想好了', '加个泡面吧']), '心情：有点饿\n接下来想：逗逗糖糖');
  assert.equal(worn(note, ['泡面都想好了', 'BTC 还行']), note);
});
