# character/ — one master face + looks

Everything in the studio reads one folder per character, driven by `character.json`. Start by copying `example/`:

```bash
cp -r tools/studio/character/example my-character
# add face.png, body.png, ... (see example/README.md), edit character.json
node tools/studio/character/validate.mjs my-character
```

## character.json fields

| Field | Meaning |
| --- | --- |
| `name` | Display name |
| `face` | **Master face** (required). Always reference image #1; the face check compares against it. |
| `body` | Standing full-body photo, same person and outfit. Dance tools crop it head-to-knees. |
| `sides` | Two 3/4 side faces made from the master face (`look.mjs sides`). Used for face binding in dance. |
| `identity` | One English sentence on the face: eye size/shape, eyelids, bangs, nose, lips, face shape, makeup. |
| `outfit` / `scene` | Default clothes and setting (optional). |
| `aspect` | `16:9` (default, desktop viewers), `9:16` or `1:1`. Decide before generating; cropping later cuts people and captions. |
| `looks.<id>` | One look: `ref` single photo (controls makeup and mood; used for dance), `sheet` turnaround, `vibe` English mood line, optional `outfit`/`body`, `label`/`use` notes. |
| `live` | Same look as your live stream: `frame` screenshot, `outfit`, `vibe`. Used by `dance o3 --live`. |
| `voice` | `doubao_speaker` voice ID for TTS (optional, else `DOUBAO_SPEAKER` in .env), `singing_reference` speech sample for singing conversion. |
| `calib` | `bad` / `good`: human-judged face crops. They turn the face score from "everything is a 7–8" into a real pass/fail. |

`validate.mjs` checks all of this offline (missing files, small images, non-English identity line, missing vibe, calibration count) and exits non-zero on errors.

## How to start a new character

1. Master face first. Everything else is an edit of it. A blurry or side-lit master face makes every later step drift.
2. `look.mjs explore` 2–3 directions → pick one → put it under `looks` → `look.mjs sheet` for a turnaround.
3. `look.mjs sides` → two 3/4 faces → look at them next to the master face before using.
4. After the first dance or short, copy face crops a human liked/disliked from `out/check/` into `calib`.

## 中文

所有工具都按“一个角色一个文件夹 + character.json”工作。先复制 `example/`，放好主脸等照片，跑 `validate.mjs` 离线检查（缺文件、图太小、identity 不是英文、造型没写 vibe、验脸样例不够都会提示，有错误就返回非 0）。起步顺序：先定主脸 → 出 2–3 个方向挑一个当造型 → 出定妆照 → 从主脸做两张 3/4 侧脸 → 第一次出片后把人看过的好/坏脸放进 `calib`。
