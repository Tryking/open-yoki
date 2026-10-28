# shots/：分镜 → 镜头卡 → 生成的片段

1. **写分镜**（`storyboard.example.json`）：每个镜头一条，写 `framing`（取景）、`camera`（运镜）、`start`（开始状态）、`action`（动作）、`end`（结束状态），可选 `line`（台词）、`look`、`via`。
2. **花钱前先检查**：
   - `node shots/card.mjs rules storyboard.json`：离线，免费。会标出这些问题：手指数量、画面里有字、东西在手之间传来传去、转头、全身说话（脸太小）、坐着跳舞、几个运镜叠在一起、形容气氛的形容词、缺开始/结束状态、镜头太长、横竖比例混用。
   - `node shots/card.mjs lint storyboard.json`：一个看得懂图的模型把每个镜头改写成 9 行的卡（任务 / 取景 / 视角 / 动作 / 运镜 / 焦点和光线 / 开始 / 结束 / 保持不变），再附 2–5 条能从画面帧上核对的检查项。一部片约 $0.01（OpenRouter）。
3. **生成任务**：`node shots/card.mjs jobs storyboard.json --char my-character` 给每个镜头写一个任务 JSON（提示词 = identity 那句 + 造型 + 看得见的开始/动作/结束 + 运镜）。
4. **生成**：先跑 `node shots/gen.mjs studio-out/jobs/01-lights-on.json --dry-run`，再去掉 `--dry-run` 跑一遍。

手写任务：见 `jobs/example-*.json`（Seedance、用一句台词对口型、任意 fal 模型）。任务里的路径是相对于任务文件本身的。
5. **按卡检查每段片子**：`node check/clip.mjs check studio-out/shots/<name>/video.mp4 storyboard.cards.json --shot 1`。没过的重出一次；再不过，就用检查器标为能用的那几秒。

## 适配器（`via`）

| via | 服务 | 适合做什么 | 大概花费 |
| --- | --- | --- | --- |
| `fal-seedance` | fal 上的 Seedance 参考图生视频 | 多参考镜头，能自己生成声音和台词；一次最长约 30 秒 | 我们用的草稿档约每秒 $0.22 |
| `libtv-o3` | 通过 LibTV 用可灵 O3 | 单张图 → 视频；多张图 + 驱动视频 → 视频（见 dance/） | LibTV 积分 |
| `libtv-omni` | 通过 LibTV 用 OmniHuman 1.5 | 一张图 + 一段配音，出说话 / 对口型 | LibTV 积分 |
| `ark-seedance` | 直接在火山方舟上调 Seedance | 同一系列，按人民币计费。**实验性：照公开接口写的，我们没测过** | 方舟价格 |
| `fal` | 任意 fal 模型 | 其他所有情况：`model` + `input`；`"@file:path"` 这样的字符串会被上传 | 看模型 |

真跑出来的实用规矩：
- 说话或唱歌的镜头：最远框到腰。全身画面里脸只有几十个像素，每个模型都会画出一张“平均脸”。
- 先出一张静帧，和主脸并排检查过，再让它动起来。大多数脸漂在第一帧就已经有了。
- 让每个动作前后都留一点静止时间，剪辑时才有地方下刀。一段 5 秒的片子很少全用上。
- 文字、logo、字幕：永远不要出现在生成的画面里。到 `mv/finish.py` 里再加。
- 生成前定好用 16:9（默认，照顾在电脑上看的人）还是 9:16。
