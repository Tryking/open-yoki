# 搭建工具

给主播一次性配好 Vidu 形象和豆包声音。在 `app/` 目录下运行。钥匙只从环境变量读；
`--idol` 选 `idols/<id>/`，默认是 `example`。

| 工具 | 做什么 | 环境变量 |
| --- | --- | --- |
| `vidu-looks.mjs` | 把每个造型（还有一个可选的 `off` 造型）上传成 Vidu 形象素材，把编号写进 `idols/<id>/vidu-looks.json`。图片从 `public/art/<id>/looks/<stage key>.png\|jpg` 取，或者用 `--src` 指定。免费；素材 90 天后过期，所以要在 `expires` 之前加 `--force` 重跑一次。 | `VIDU_KEY`，可选 `VIDU_BASE` |
| `vidu-upload-one.mjs` | 用任意名字（`--file`、`--key`）上传一张图，写进同一个 `vidu-looks.json`。 | `VIDU_KEY`，可选 `VIDU_BASE` |
| `vidu-actions.mjs` | 把配置里 `actions[*].lib` 的动作描述同步到 Vidu 的动作库，并打印出要绑定的 `VIDU_ACTION_LIB=<id>`。免费。 | `VIDU_KEY`，可选 `VIDU_BASE` |
| `volc-clone.mjs` | 用豆包声音复刻 2.0 把声音复刻进你在火山引擎控制台买的槽位；这个槽位编号就是你的 `DOUBAO_VOICE_ID`。还能把豆包的试听音频存下来。 | `VOLC_API_KEY` |
| `voice-tones-sample.mjs` | 用普通语气和 `idol.avatar.doubao.tones` 里的每一种语气各说同一句话，拼成 `all.mp3`，方便你逐个调语气。需要 ffmpeg。 | `VOLC_API_KEY`、`DOUBAO_VOICE_ID`（或者配置里的 `voiceId`） |

`vidu.mjs` 是几个工具共用的 Vidu 接口小助手。PNG 转 JPEG 在 macOS 上用 `sips`，其他系统用 `ffmpeg`。

新主播的顺序：先复刻声音，试听各种语气，再上传造型，同步动作库，最后把编号填进配置或环境变量
（`DOUBAO_VOICE_ID`、`VIDU_ACTION_LIB`，`VIDU_AVATAR_ID` 是兜底用的形象）。
