// What Binance is pushing lately, brought up in a quiet moment: a host on Square helps spread what the platform is
// promoting. Two files in her heart's home: 币安在推/官方最近在推.md (kept by xlearn from the official accounts)
// and 币安在推/我自己在用的.md (what she really uses and how it felt, she writes it herself). At most twice a show, not in
// the first minutes, far apart; the things she uses come first, then one she hasn't tried, which she says she hasn't.
import fs from 'node:fs';
import path from 'node:path';

// "## 名字" sections with "- 键：值" bullets
export function sections(text) {
  const out = [];
  for (const part of String(text || '').split(/^## /m).slice(1)) {
    const [head, ...rest] = part.split('\n');
    const bullets = rest.map(l => l.trim()).filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());
    const kv = Object.fromEntries(bullets.map(b => b.match(/^([^：:]{1,8})[：:]\s*(.+)$/)).filter(Boolean).map(m => [m[1], m[2]]));
    out.push({ name: head.trim(), bullets, kv });
  }
  return out;
}

const key = s => String(s).split(/[：:（(]/)[0].trim();
const same = (a, b) => { const x = key(a), y = key(b); return x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x)); };

export function pushItems(official, mine) {
  const used = sections(mine).filter(s => !/还没用过/.test(s.name));
  return sections(official).map(o => {
    const u = used.find(m => same(m.name, o.name));
    // her own lines only: the placeholder "（还没写）" is not a feeling
    const felt = u ? u.bullets.filter(b => !/（还没写）/.test(b)).join('；') : '';
    return { name: o.name, what: o.kv['是什么'] || '', how: o.kv['怎么开始'] || '', mine: felt, used: !!u };
  }).filter(x => x.what);
}

export function createPushTalk({ dir, perShow = 2, firstMin = 12, gapMin = 40, now = Date.now, read = f => fs.readFileSync(f, 'utf8') }) {
  let show = null, told = [], lastAt = -Infinity;
  return {
    // showAt: when tonight's show started (brain knows); null off air
    pick(showAt) {
      if (showAt == null) return null;
      if (show !== showAt) { show = showAt; told = []; lastAt = -Infinity; }
      const t = now();
      if (told.length >= perShow || t - showAt < firstMin * 60e3 || t - lastAt < gapMin * 60e3) return null;
      let items = [];
      try { items = pushItems(read(path.join(dir, '官方最近在推.md')), (() => { try { return read(path.join(dir, '我自己在用的.md')); } catch { return ''; } })()); } catch { return null; }
      const fresh = items.filter(x => !told.includes(x.name));
      // one she uses first; the second one may be one she hasn't tried
      const it = (told.length === 0 ? fresh.find(x => x.used) : null) || fresh.find(x => x.used) || fresh[0];
      if (!it) return null;
      told.push(it.name); lastAt = t;
      return it;
    },
  };
}
