// Offline self-test with a made-up show. node selftest.mjs
import assert from 'node:assert/strict';
import { lint, wornTopics, wornReply, wornNote, repeatOf, langOf } from './lint.mjs';

const t0 = Date.parse('2026-01-01T12:00:00Z');
const rows = [];
let s = 0;
const host = (text, to = '') => rows.push({ at: t0 + (s += 10) * 1000, who: 'host', name: '', text, to });
const viewer = (name, text) => rows.push({ at: t0 + (s += 2) * 1000, who: 'viewer', name, text, to: '' });

// planted problems: one number worn all night, a disclaimer, an English comment answered in Chinese,
// a "nobody is here" complaint and a 90-second silence
for (let i = 0; i < 8; i++) host(`我还是盯着 64000 这条线，第${i}次看它${'啊'.repeat(i)}`);
viewer('Sam', 'hey what are you trading tonight?');
host('今晚我就看着，不乱动', 'Sam');
viewer('小鱼', '主播吃饭了吗');
host('小鱼你好，吃了一碗面，辣到流眼泪', '小鱼');
host('先说好，这不构成投资建议啊');
s += 90;
host('又没人说话了，就我一个在这');
host('楼下那家面馆今天排了二十分钟队');

const R = lint(rows);
assert.ok(R.worn.some(w => w.word === '64000'), 'worn number found');
assert.equal(R.phrases.disclaimer.length, 1, 'disclaimer found');
assert.equal(R.phrases.quiet_complaint.length, 1, 'quiet complaint found');
assert.equal(R.language.length, 1, 'wrong-language reply found');
assert.equal(R.language[0].want, 'Latin-script (English etc.)');
assert.ok(R.deadAir.gaps >= 1 && R.deadAir.longestSec >= 90, 'dead air found');
assert.ok(R.repeats.length >= 5, 'repeated openings found');
assert.ok(R.flags.length >= 5, 'flags raised: ' + R.flags.join(' | '));

// helpers
assert.deepEqual(wornTopics(['八万二站住了', '我盯 82000', '82,000 上面磨了一天']), ['82000']);
assert.match(wornReply('今天吃啥', ['82000']), /82000/);
assert.equal(wornReply('82000 能守住吗', ['82000']), '');
assert.equal(wornNote('心情：开心\n在想：面馆排队', ['面馆人好多', '那个面馆又排队']), '心情：开心');
assert.equal(wornNote('mood: fine\nthinking about: noodles', ['noodles again', 'more noodles']), 'mood: fine');
assert.equal(repeatOf('今天的面真的很好吃呀', ['今天的面真的超辣']), '今天');
assert.equal(repeatOf('换个完全不一样的说法', ['刚才那句话是别的']), '');
assert.equal(langOf('hello there'), 'Latin-script (English etc.)');
assert.equal(langOf('안녕하세요'), 'Korean');
assert.equal(langOf('你好'), null);
console.log('line-lint selftest: ok (' + R.flags.length + ' flags on the planted show)');
