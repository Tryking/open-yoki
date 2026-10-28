# look/ — test shots, turnaround sheets, outfit swaps

`look.mjs` turns the master face into looks. Every call is an **edit of the master face** (fal `nano-banana-pro/edit`, master face always first), so the face stays the same person.

| Command | What it does | Cost / time |
| --- | --- | --- |
| `explore <char> "<direction>" [--n 3]` | 2–3 candidate single photos for a new look | ~$0.15 / image, ~1 min |
| `sheet <char> <look>` | Turnaround: face close-up, full body front, 3/4, side | ~$0.15, ~1 min |
| `outfit <char> <look> "<clothes>" [--image clothes.png]` | Change only the clothes; face, hair, hat stay | ~$0.15 / image |
| `style <char> <key> [--styles pack.json]` | One style from a style pack (`styles.example.json`): new hair + outfit + mood, same face, fixed framing | ~$0.15 |
| `sides <char>` | Two 3/4 side faces from the master face (for face binding in dance) | ~$0.30 |
| `status <char>` | List looks and outputs | free |

Add `--dry-run` to see the exact prompt, reference order and cost without spending anything. Output goes to `<char>/out/{explore,sheets,outfits,styles,sides}/`; spend estimates are appended to `<char>/out/spend.jsonl`.

Lessons that are baked in:
- Reference order is always master face → look photo → body. Put the face anywhere else and it drifts.
- Write the face in English in `identity` (eyes, eyelids, bangs, nose, lips, face shape). Mood words ("cute", "cool") belong in `vibe`, not in the face line.
- Warm backlight and a big open-mouth laugh both make the face rounder. Check every still next to the master face (`check/face.mjs --offline`) **before** you pay for video from it.
- Keep the framing fixed across a style pack, so a week of styles still looks like one show.

## 中文

`look.mjs` 用主脸出造型：探方向（`explore`）、定妆照（`sheet`）、只换衣服（`outfit`）、按风格包换整套风格（`style`）、从主脸做两张 3/4 侧脸（`sides`）。每次都是“编辑主脸”，主脸永远第一张参考图。加 `--dry-run` 只打印提示词、参考图顺序和花费，不花钱。经验：暖色逆光和露牙大笑会把脸画圆；每张静帧先和主脸并排看过再拿去出视频。
