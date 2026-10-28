# Example character: Mika (fictional)

This folder holds only `character.json`. No photos or recordings ship with the package. Add your own:

| File | What to put there |
| --- | --- |
| `face.png` | **Master face.** One sharp, front-facing close-up (at least 1024 px), even light, neutral or soft smile, no hands near the face. Every generation puts it first; every face check compares against it. |
| `body.png` | Same person, same outfit, standing, head to shoes, plain background. Dance tools crop it to head-to-knees. |
| `sides/side-left.png`, `side-right.png` | Two 3/4 side views made **from the master face** (`look/look.mjs sides`). Check them side by side with the face before using. |
| `looks/<name>.png` | One single photo per look (makeup, hair, outfit, mood). Make 2–3 candidates with `look/look.mjs explore`, pick one. |
| `live/frame.png` | (Optional) a screenshot of your live-stream picture, for clips that cut out of and back into the stream. |
| `voice/speaking-ref.wav` | (Optional) 10–30 s of clean speech by the voice you will use, as the target for singing voice conversion. |
| `calib.bad` / `calib.good` | Face crops a human judged "drifted / ugly" and "fine". Copy them from `out/check/<clip>/face*.jpg` after your first runs. Two or more each. |

Only use photos and voices you own or have permission to use.

## 中文

这个文件夹只有 `character.json`，不带任何照片和录音。自己放：主脸（正脸近照，1024 像素以上，所有生成都把它放第一张、验脸也以它为准）、站姿全身照、两张从主脸做出来的 3/4 侧脸、每套造型一张单人照、（可选）直播画面截图和 10–30 秒干净说话录音。`calib` 放人眼判过的“走样 / 合格”脸部截图，各 2 张起，第一次出片后从 `out/check/` 里挑。只用自己有权使用的照片和声音。
