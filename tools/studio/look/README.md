# look/：试妆照、三视图、换装

`look.mjs` 用主脸做出各种造型。每次调用都是**在主脸上编辑**（fal `nano-banana-pro/edit`，主脸永远放第一张），所以脸还是同一个人。

| 命令 | 做什么 | 花费 / 时间 |
| --- | --- | --- |
| `explore <char> "<direction>" [--n 3]` | 给新造型出 2–3 张候选单人照 | 约 $0.15 / 张，约 1 分钟 |
| `sheet <char> <look>` | 三视图：脸部特写、全身正面、3/4、侧面 | 约 $0.15，约 1 分钟 |
| `outfit <char> <look> "<clothes>" [--image clothes.png]` | 只换衣服；脸、头发、帽子不变 | 约 $0.15 / 张 |
| `style <char> <key> [--styles pack.json]` | 用风格包（`styles.example.json`）里的一种风格：新发型 + 新衣服 + 新气质，脸不变，取景固定 | 约 $0.15 |
| `sides <char>` | 用主脸做两张 3/4 侧脸（跳舞绑脸用） | 约 $0.30 |
| `status <char>` | 列出已有的造型和输出 | 免费 |

加 `--dry-run` 可以看准确的提示词、参考图顺序和花费，不花钱。输出放在 `<char>/out/{explore,sheets,outfits,styles,sides}/`；估算的花费追加到 `<char>/out/spend.jsonl`。

已经做进工具里的经验：
- 参考图顺序永远是主脸 → 造型照 → 全身照。主脸放在别的位置，脸就会漂。
- 在 `identity` 里用英文写这张脸（眼睛、眼皮、刘海、鼻子、嘴唇、脸型）。气质词（“cute”“cool”）写在 `vibe` 里，不要写进描述脸的那句。
- 暖色逆光和张大嘴大笑都会把脸画圆。拿一张静帧去出视频**之前**，先把它和主脸并排检查（`check/face.mjs --offline`）。
- 同一个风格包里取景保持固定，这样一周换着不同风格，看起来还是同一档节目。
