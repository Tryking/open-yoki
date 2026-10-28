# mv/：从一个个镜头到成品短片或 MV

| 工具 | 做什么 | 服务 / 花费 |
| --- | --- | --- |
| `voice.mjs tts` / `batch` | 用角色的声音说台词，可以加表演提示（`--tone "whispering, a bit shy"`） | 豆包 TTS，约 3 元/万字 |
| `audio.mjs music` | 原创纯音乐配乐 | fal ElevenLabs Music，约 $0.60/分钟 |
| `audio.mjs sfx` | 一个短音效（pop、whoosh、ding……） | fal，几美分 |
| `upscale.mjs` | 480p/720p 草稿 → 约 1080p | fal Topaz，约 30 秒花 $2.5 左右 |
| `finish.py` | 剪切并拼接片段、字幕、标题牌、AI 标识、配乐进出点、音效、说话时自动压低音乐、响度 -14 LUFS、H.264/AAC | 免费（ffmpeg + Pillow） |

对口型的说话镜头，来自 `shots/gen.mjs` 的 `via: libtv-omni`（一张图 + 一句台词），或者 Seedance 加 `sound: true`（它自己把台词配出来）。做 MV 的话，歌来自 `sing/`。

## finish.py 的计划文件

见 `plan.example.json` 和 `finish.py` 开头的说明。所有时间都按成片的时间线算。计划里有：`clips`（file、from、to：哪个文件、从哪剪到哪）、`subs`（from、to、text：字幕起止和文字）、`cards`（标题牌）、`label`、`music`（file、at、from、dur、vol、fades：文件、放在成片哪里、从曲子哪里开始、时长、音量、淡入淡出）、`sfx`（file、at、vol：文件、位置、音量）、`voice`（放在某个时间点的额外台词）、`speed`（比如 1.05，不改音调，把拖沓的剪辑收紧一点）。

实践下来站得住的剪辑规矩：
- 先全用硬切粗剪；故事看得懂了，再加转场。转场永远救不了变了的脸或衣服。
- 每个动作都要有结果，通常还要有反应。画面里不再有变化，这个镜头就太长了；表情还在变的时候，多等一会儿没关系。
- 字幕：一次一个意思，手机上看得清，永远不挡脸和关键动作；竖屏视频要避开底部 15% 和右边缘。
- 先人声，再环境声、音效、音乐。说话时音乐压在下面（`duck: true`）。
- 最后跑 `check/clip.mjs cut film.mp4 --goal "..."`。先把量出来的问题全修掉（通常过一次 ffmpeg 就够：`loudnorm=I=-14:TP=-1.5` 加结尾一个短淡出）。
- 前后对比的更新视频：30–60 秒，每个改动都要出现，配乐加音效，“改前”那段必须看得出明显毛病。
