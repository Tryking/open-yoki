// Her big moves on the Square feed: a handful of clips, each with its own moment.
// They are 5-second clips made beforehand (any image-to-video model, first and last frame = her live sitting picture), not Vidu moves:
// the feed page plays one over her live picture, cross-fading in and out, then she says her line. Each clip has its
// own kind of moment: a major pumping or dumping, a follow or gift, or her own line (its words, mood shade or face).
// Viewers' words never pick one: only her own line, the board or the room's events do.
// Rare on purpose: one every few minutes at most, and the same clip not again for a while.
export function createBigMoves(cfg, { now = () => Date.now(), rand = Math.random } = {}) {
  const clips = cfg?.clips || {};
  const gapMs = cfg?.gapMs ?? 240e3, againMs = cfg?.againMs ?? 20 * 60e3;
  let lastAt = -Infinity;
  const used = {};
  // a clip fits when any one of its `on` moments matches: { kinds, up, acts } for an event, { words, shades, faces } for her line
  const one = (w, line, e) => {
    if (w.kinds && !w.kinds.includes(e.kind)) return false;
    if (e.kind === 'market' && 'up' in w && (e.pct > 0) !== w.up) return false;
    if (w.acts && !w.acts.includes(e.act)) return false;
    if (w.words && !w.words.test(String(line.text || ''))) return false;
    if (w.shades || w.faces) return !!(w.shades?.includes(line.shade) || w.faces?.includes(line.face));
    return !!(w.kinds || w.words);
  };
  const fits = (c, line, e) => [].concat(c.on || []).some(w => one(w, line, e));
  function pick(line, e) {
    const t = now();
    if (!line?.text || line.silent || t - lastAt < gapMs) return null;
    const ok = Object.keys(clips).filter(k => t - (used[k] ?? -Infinity) >= againMs && fits(clips[k], line, e));
    if (!ok.length) return null;
    const k = ok[Math.floor(rand() * ok.length)];
    lastAt = used[k] = t;
    return k;
  }
  return { pick, holdMs: cfg?.holdMs ?? 4600, keys: Object.keys(clips) };
}
