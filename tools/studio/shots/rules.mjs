// Offline storyboard rules (no model, free). Flags the shot patterns that most often fail in AI video.
// Used by card.mjs `rules` and `lint`. Each finding: { level: "high"|"mid"|"low", msg }.
const RX = {
  adjectives: /\b(cinematic|epic|premium|stunning|breathtaking|masterpiece|high[- ]end|beautiful shot)\b|电影感|高级感|震撼|大片感|氛围感/i,
  cameraMoves: /\b(push(es)? in|pull(s)? (out|back)|pan(s|ning)?|tilt(s|ing)?|dolly|orbit(s|ing)?|zoom(s|ing)?|truck(s|ing)?|crane|tracking|whip)\b|推镜|拉镜|摇镜|环绕|跟拍|升降/gi,
  fingers: /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+fingers?\b|比[一二三四五六七八九十\d]|手指数/i,
  text: /\b(text|logo|(?<!heart |peace |hand |v |ok )signs?|caption|subtitle|letters?|words? on|writes?|written|banner|label)\b|文字|字幕|招牌|logo|标语|写着/i,
  handoff: /\b(hands (the|a|an|it|over|him|her|them)\b|hand (the|a|an|it|over)\b|passes|gives .* to|takes .* from|hand-?off)\b|递给|接过|传给/i,
  faceTurn: /\b(turns? (her|his|their)? ?head|looks? back|turns around|spins?|twirls?)\b|转头|回头|转身|转圈|甩头/i,
  crowd: /\b(crowd|everyone|all of them|many people|audience)\b.*\b(same|together|in sync|at once)\b|一起|齐刷刷/i,
  fullBody: /\b(full[- ]body|wide shot|long shot|head to (toe|shoes|feet))\b|全身|远景/i,
  speaking: /\b(says|speaks|talks|sings|lip[- ]?sync|dialogue)\b|说|唱|台词|对口型/i,
  dance: /\b(danc(e|es|ing)|choreograph)/i,
  seated: /\b(sit(s|ting)?|seated|on the (sofa|couch|chair))\b|坐/i,
  laugh: /\b(laugh(s|ing)?|big grin|open[- ]mouth(ed)? smile|teeth)\b|大笑|露牙/i,
};

const text = (s) => Object.entries(s).filter(([k]) => !["id", "risk"].includes(k)).map(([, v]) => (typeof v === "string" ? v : JSON.stringify(v))).join(" \n ");

export function ruleCheck(shots, { maxSeconds = 15 } = {}) {
  const ids = new Set(), aspects = new Set();
  const out = shots.map((s, i) => {
    const t = text(s), f = [];
    const add = (level, msg) => f.push({ level, msg });
    const id = s.id ?? i + 1;
    if (ids.has(String(id))) add("high", `duplicate shot id ${id}`);
    ids.add(String(id));
    if (s.aspect) aspects.add(s.aspect);
    if (!s.start || !s.end) add("mid", "no start/end state: write what the first and last frame look like, otherwise the clip cannot be checked");
    if (!s.action && !s.prompt) add("high", "no action or prompt");
    if (RX.adjectives.test(t)) add("mid", "mood adjectives (cinematic/epic/...) tell the model nothing; describe visible states instead");
    const moves = new Set((t.match(RX.cameraMoves) || []).map((m) => m.toLowerCase().replace(/(es|s|ing)$/, "")));
    if (moves.size > 1) add("mid", `stacked camera moves (${[...moves].join(", ")}): pick one, or cut to a new shot`);
    if (RX.fingers.test(t)) add("high", "exact finger count: video models miscount; use a sign/prop or keep hands out of frame");
    if (RX.text.test(t)) add("high", "on-screen text/logo: models garble it; add text in the edit (mv/finish.py), keep the generated frame text-free");
    if (RX.handoff.test(t)) add("high", "an object passes between hands: often appears/vanishes; say which hand holds what at start and end");
    if (RX.faceTurn.test(t)) add("mid", "head turn / spin: the face drifts or blurs mid-turn; keep it short or hide the face");
    if (RX.crowd.test(t)) add("mid", "many people doing the same gesture: expect mismatched bodies");
    if (RX.fullBody.test(t) && RX.speaking.test(t)) add("high", "full body while talking/singing: the face is a few dozen pixels and becomes an 'average face'; frame waist-up or closer");
    else if (RX.fullBody.test(t)) add("low", "full body: the face will be small; keep it short or turn the face away");
    if (RX.dance.test(t) && RX.seated.test(t)) add("high", "dancing while seated: dances must be standing (seated dance reads as a glitch)");
    if (RX.laugh.test(t)) add("low", "big open-mouth laugh tends to round the face; prefer a closed-mouth smile and check the still first");
    const d = +s.duration || (s.end_time != null && s.start_time != null ? s.end_time - s.start_time : 0);
    if (d > maxSeconds) add("mid", `${d}s is long for one generation; split it (most models do 5–10 s, Kling O3 max 10 s)`);
    const risk = f.some((x) => x.level === "high") ? "high" : f.some((x) => x.level === "mid") ? "mid" : "low";
    return { id, risk, findings: f };
  });
  const sequence = [];
  if (aspects.size > 1) sequence.push(`mixed aspect ratios ${[...aspects].join(" / ")}: decide 16:9 or 9:16 before generating`);
  const total = shots.reduce((a, s) => a + (+s.duration || 0), 0);
  if (total) sequence.push(`total ${total.toFixed(1)} s planned`);
  return { shots: out, sequence };
}
