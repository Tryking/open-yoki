# character/：一张主脸 + 多套造型

Studio 里的所有工具都按“一个角色一个文件夹”来读，由 `character.json` 说了算。先复制 `example/`：

```bash
cp -r tools/studio/character/example my-character
# 放好 face.png、body.png 等（见 example/README.md），再改 character.json
node tools/studio/character/validate.mjs my-character
```

## character.json 里的字段

| 字段 | 含义 |
| --- | --- |
| `name` | 显示的名字 |
| `face` | **主脸**（必填）。永远是第 1 张参考图；验脸就拿它来比。 |
| `body` | 站姿全身照，同一个人、同一套衣服。跳舞工具会把它裁成头到膝盖。 |
| `sides` | 用主脸做出来的两张 3/4 侧脸（`look.mjs sides`）。跳舞绑脸时用。 |
| `identity` | 用一句英文描述这张脸：眼睛大小和形状、眼皮、刘海、鼻子、嘴唇、脸型、妆容。 |
| `outfit` / `scene` | 默认的衣服和场景（可选）。 |
| `aspect` | `16:9`（默认，照顾在电脑上看的人）、`9:16` 或 `1:1`。生成前定好；事后再裁会切掉人和字幕。 |
| `looks.<id>` | 一套造型：`ref` 单人照（管妆容和气质；跳舞用它），`sheet` 三视图，`vibe` 一句英文写的气质，可选的 `outfit`/`body`，`label`/`use` 是备注。 |
| `live` | 和你直播时同一个造型：`frame` 直播截图、`outfit`、`vibe`。`dance o3 --live` 会用它。 |
| `voice` | `doubao_speaker` 是 TTS 用的音色 ID（可选，不填就用 .env 里的 `DOUBAO_SPEAKER`），`singing_reference` 是唱歌换声用的说话样本。 |
| `calib` | `bad` / `good`：人判过的脸部截图。有了它们，验脸分数才不会“什么都是 7–8 分”，而是能真正分出过和不过。 |

`validate.mjs` 会离线检查以上全部内容（缺文件、图太小、identity 不是英文、没写 vibe、校准样例数量），有错误就以非 0 退出。

## 怎么开始一个新角色

1. 先定主脸。别的都是在它基础上改出来的。主脸模糊或者是侧光，后面每一步都会漂。
2. `look.mjs explore` 出 2–3 个方向 → 挑一个 → 放进 `looks` → 用 `look.mjs sheet` 出三视图。
3. `look.mjs sides` → 得到两张 3/4 侧脸 → 用之前先和主脸并排看看。
4. 第一次跳舞或做完短片后，从 `out/check/` 里把人觉得好的、不好的脸部截图复制进 `calib`。
