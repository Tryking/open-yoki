# shots/ — storyboard → shot cards → generated clips

1. **Write a storyboard** (`storyboard.example.json`): one entry per shot with `framing`, `camera`, `start`, `action`, `end`, optional `line` (dialogue), `look`, `via`.
2. **Check it before spending**:
   - `node shots/card.mjs rules storyboard.json` — offline, free. Flags finger counts, on-screen text, objects passing hands, head turns, full-body talking (tiny face), seated dancing, stacked camera moves, mood adjectives, missing start/end states, over-long shots, mixed aspect ratios.
   - `node shots/card.mjs lint storyboard.json` — a vision model rewrites every shot into a 9-line card (task / framing / viewpoint / action / camera / focus & light / start / end / keep) with 2–5 checks you can verify from frames. ~$0.01 per film (OpenRouter).
3. **Make jobs**: `node shots/card.mjs jobs storyboard.json --char my-character` writes one job JSON per shot (prompt = identity line + look + visible start/action/end + camera).
4. **Generate**: `node shots/gen.mjs studio-out/jobs/01-lights-on.json --dry-run`, then without `--dry-run`.

Hand-written jobs: see `jobs/example-*.json` (Seedance, lip-sync from a voice line, any fal model). Paths inside a job are relative to the job file.
5. **Check each clip** against its card: `node check/clip.mjs check studio-out/shots/<name>/video.mp4 storyboard.cards.json --shot 1`. Re-roll fails once; if it fails again, use the seconds the checker marks as usable.

## Adapters (`via`)

| via | Service | Good for | Rough cost |
| --- | --- | --- | --- |
| `fal-seedance` | Seedance reference-to-video on fal | multi-reference shots, can generate its own sound and dialogue; up to ~30 s per call | ~$0.22 per second at the draft setting we used |
| `libtv-o3` | Kling O3 via LibTV | single image → video; images + driving video → video (see dance/) | LibTV credits |
| `libtv-omni` | OmniHuman 1.5 via LibTV | talking / lip-sync from one image + one voice track | LibTV credits |
| `ark-seedance` | Seedance directly on Volcengine Ark | same family, billed in CNY. **Experimental: written to the public API, not tested by us** | Ark pricing |
| `fal` | any fal model | anything else: `model` + `input`; `"@file:path"` strings get uploaded | per model |

Practical rules that came out of real runs:
- Talking or singing shots: waist-up or closer. In full-body frames the face is a few dozen pixels and every model paints an "average face".
- Generate a still first, check it next to the master face, then animate it. Most face drift is already in the first frame.
- Ask for a little still time before and after each action, so the editor has room to cut. You rarely use all 5 seconds of a clip.
- Text, logos, subtitles: never in the generated frame. Add them in `mv/finish.py`.
- Decide 16:9 (default, desktop viewers) or 9:16 before generating.

## 中文

流程：写分镜 → `card.mjs rules` 离线挑毛病（免费）→ `card.mjs lint` 让模型改写成镜头任务卡（约 0.01 美元一部片）→ `card.mjs jobs` 每个镜头生成一个任务文件 → `gen.mjs` 先 `--dry-run` 看提示词和花费再真出 → `check/clip.mjs check` 按卡验每段。服务都是可选适配：fal 的 Seedance、LibTV 的可灵 O3 和 OmniHuman 对口型、火山方舟 Seedance（按公开接口写的，未实测）、任意 fal 模型。手写任务文件的样例见 `jobs/example-*.json`，里面的路径相对任务文件本身。经验：说话/唱歌镜头最远到腰；先出静帧和主脸并排看过再出视频；画面里不让模型写字，字幕后期加；开工前定横竖屏。
