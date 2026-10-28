# check/ — did the face drift, does the clip match its card, is the film ready

| Command | What | Cost |
| --- | --- | --- |
| `face.mjs <char> <video\|image>` | Crops the face from 6 frames, enlarges it, puts it **next to the master face** (`compare_master_left.jpg`), and scores "same person" and "attractive" against your human-judged `calib` examples | ~$0.01 (OpenRouter) |
| `face.mjs <char> <file> --offline` | Only the side-by-side (centre crop, or `--box t,b,l,r`) | free |
| `clip.mjs check <clip> <cards.json> --shot N` | Each check on the shot card → pass/fail + which seconds are usable | ~$0.004 |
| `clip.mjs cut <film> --goal "..."` | Before publishing: export (MP4/H.264/AAC, size, bitrate, orientation), loudness, peaks, clicks at start/end, black frames — measured; story, cuts, continuity, captions, ending — model | ~$0.01 |
| `clip.mjs cut <film> --offline` | Only the measured part | free |

## Why the face check works this way

- Looking at whole frames, a model says "far away, hard to tell, looks consistent" and gives 8/10 to faces people called ugly. Cropping and enlarging the face helps, but scores still bunch at 7–8.
- Adding examples a human already judged ("drifted" vs "fine") and asking **which group is each crop closer to** is what separates good from bad clips. Add 2+ of each to `calib` after your first runs.
- In our runs this ranked three reference videos the same way people did (full-body motion transfer: fail; slightly tighter crop: fail; head-to-knees multi-reference: pass 6/6).
- **The human decides.** Open `compare_master_left.jpg` and compare eye size and shape, bangs, nose, lips, face shape. Faces under ~120 px in the frame are flagged: frame tighter.
- Most drift starts in the first still (warm backlight, wide laugh). Check stills before paying for video.

Optional extra ear: [earshot](https://github.com/Leonxlnx/earshot) (MIT) runs locally and can describe sounds, find a sound in a long recording and critique a promo mix with time stamps.

## 中文

验脸：抽 6 帧、把脸裁出来放大、和主脸并排出一张对比图，再拿你人眼判过的“走样/合格”样例当标尺打分；模型打分只是辅助，过不过以人看对比图为准；`--offline` 只出对比图不花钱。按卡验片：每段片子逐条对卡上的验收项，给出能用的那几秒。成片检查：导出参数、响度、峰值、开头结尾爆音、黑场用 ffmpeg 量（一定准），故事、切点、连续性、字幕、结尾让模型看帧判；`--offline` 只做量的部分。
