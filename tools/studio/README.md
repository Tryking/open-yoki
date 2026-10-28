# Studio：给你的数字人做新视频

给它一张角色照片。它帮你做试妆照和换装、跳舞片、短片、MV、用角色的声音唱歌，还会检查每一个成果有没有**脸漂**（角色慢慢变成了另一个人）。

所有付费服务都是可选的适配器。钥匙放在 `.env`；没有钥匙时，工具会告诉你它需要哪个服务、去哪注册。加上 `--dry-run`，可以先看准确的提示词、参考图和花费，一分钱不花。

> 把已有的直播录像剪成片段，在 `tools/video/`。这个文件夹管的是**做新画面**。

| 文件夹 | 能得到什么 |
| --- | --- |
| `character/` | 一个角色一个文件夹：主脸、造型、`character.json`、离线校验 |
| `look/` | 新造型的试妆照、三视图、换装、风格包、3/4 侧脸 |
| `shots/` | 分镜 → 离线规则检查 → 模型写镜头卡 → 每个镜头一个生成任务 → 出片段（Seedance / 可灵 O3 / OmniHuman 对口型 / 任意 fal 模型） |
| `dance/` | 让角色跳一段舞：绑脸动作迁移（默认）、可灵 O3 多参考、Viggle |
| `sing/` | 让角色唱一首真实的歌：本机 Seed-VC 换声（免费）+ 混音 + 打分；云端写歌、翻唱可选 |
| `mv/` | 台词配音（TTS）、配乐、音效、超分，还有 `finish.py`：加字幕、好好混音，剪出成片 |
| `check/` | 验脸（和主脸并排 + 校准过的分数）、按镜头卡验片、发布前成片检查 |
| `selftest/` | `node selftest/run.mjs`：用生成的假素材离线测试；不要钥匙，不联网 |

## 需要准备

- Node.js 20+（用它自带的 `fetch`；要走 HTTP 代理，就用 Node 24+ 并设 `NODE_USE_ENV_PROXY=1`）
- PATH 里能找到 ffmpeg / ffprobe
- Python 3.9+ 和 Pillow（`pip install pillow`），`mv/finish.py` 加字幕要用
- 可选，本机唱歌用：Python 3.10，约 2 GB 硬盘空间（`sing/setup.sh`）

```bash
cp tools/studio/.env.example tools/studio/.env   # 只填你要用的
node tools/studio/selftest/run.mjs               # 离线部分应该全部通过
```

## 从一张照片到 30 秒短片（完整示例）

命令都在仓库根目录下跑。`my-char` 是你的角色文件夹。

```bash
# 1. 角色：复制样例，把你的照片放进去、命名为 face.png，然后校验
cp -r tools/studio/character/example my-char
node tools/studio/character/validate.mjs my-char

# 2. 造型：出三个方向，挑一个存成 my-char/looks/daily.png；再出一张三视图和两张侧脸
node tools/studio/look/look.mjs explore my-char "fresh everyday streamer, cream knit sweater" --n 3
node tools/studio/look/look.mjs sheet my-char daily
node tools/studio/look/look.mjs sides my-char          # 把结果写进 character.json 的 "sides"
node tools/studio/check/face.mjs my-char my-char/looks/daily.png --offline   # 和主脸并排看一看

# 3. 分镜：改 tools/studio/shots/storyboard.example.json（6 个镜头，30 秒），然后检查
node tools/studio/shots/card.mjs rules tools/studio/shots/storyboard.example.json
node tools/studio/shots/card.mjs lint  tools/studio/shots/storyboard.example.json      # 会写出 ...cards.json
node tools/studio/shots/card.mjs jobs  tools/studio/shots/storyboard.example.json --char my-char

# 4. 给说话的镜头配音，然后生成每个镜头（先空跑一遍）
node tools/studio/mv/voice.mjs tts studio-out/vo/hello.wav "Hi, I'm Mika. This is my very first stream!" --char my-char --tone "excited, a little nervous"
node tools/studio/shots/gen.mjs studio-out/jobs/01-lights-on.json --dry-run
node tools/studio/shots/gen.mjs studio-out/jobs/01-lights-on.json
#    （第 2 个镜头是对口型：在它的任务文件里设 "audio": ["<path to hello.wav>"]，走 libtv-omni）

# 5. 跳舞镜头：6 秒的热门舞片段，站着跳，正对镜头
node tools/studio/dance/dance.mjs driver dance.mp4
node tools/studio/dance/dance.mjs bind my-char stage dance.mp4          # 最后会自动验脸

# 6. 每段片子按它的镜头卡检查，没过的重出一次
node tools/studio/check/clip.mjs check studio-out/shots/01-lights-on/video.mp4 tools/studio/shots/storyboard.example.cards.json --shot 1

# 7. 配乐 + 音效，然后剪成片
node tools/studio/mv/audio.mjs music studio-out/audio/bgm.mp3 30 "light upbeat lo-fi pop, warm, playful"
node tools/studio/mv/audio.mjs sfx studio-out/audio/pop.mp3 1 "soft cartoon pop"
python3 tools/studio/mv/finish.py tools/studio/mv/plan.example.json
node tools/studio/check/clip.mjs cut studio-out/mika-first-stream.mp4 --goal "Mika goes live for the first time and chat loves it"
```

## 大概花多少钱（按写这份文档时的价格）

| 示例里的步骤 | 服务 | 花费 |
| --- | --- | --- |
| 3 张试妆照 + 1 张三视图 + 2 张侧脸 | fal nano-banana-pro edit（约 $0.15/张） | 约 $0.90 |
| 5 个镜头 × 约 5 秒 Seedance，加上重出 | fal Seedance（草稿档约 $0.22/秒） | 约 $6–10 |
| 1 个对口型镜头 | LibTV OmniHuman | LibTV 积分 |
| 6 秒绑脸跳舞 | fal 可灵 3.0 动作控制（pro 档 $0.168/秒） | 约 $1.0 |
| 2 句配音 | 豆包 TTS（约 3 元/万字） | < $0.01 |
| 30 秒配乐 + 2 个音效 | fal ElevenLabs | 约 $0.35 |
| 分镜检查、片段检查、验脸、成片检查 | OpenRouter（Gemini Flash） | 约 $0.10 |
| **合计** | | **约 $9–13 + LibTV 积分** |

| 服务 | 去哪注册 | 用来做什么 |
| --- | --- | --- |
| fal.ai | fal.ai/dashboard/keys | 图片、Seedance、可灵动作控制、配乐、音效、超分、云端唱歌 |
| OpenRouter | openrouter.ai/settings/keys | 所有检查、分镜卡、找脸 |
| 火山引擎豆包语音 | console.volcengine.com/speech/app | 台词配音；声音复刻在这个控制台里做 |
| LibTV | liblib.tv（命令行客户端） | 可灵 O3 多参考、OmniHuman 对口型 |
| Viggle | viggle.ai | 快速换人跳舞 |
| 火山方舟 | console.volcengine.com/ark | 直接调 Seedance（实验性） |
| Seed-VC / Applio | GitHub，本机运行 | 唱歌换声，免费 |

价格会变。`--dry-run` 会打印工具当前用的估价；每次付费调用，都会在它的输出文件夹里的 `spend.jsonl` 追加一行。

## 常见坑

- **脸漂。** 有两个原因：(1) 第一张静帧就已经不像了（暖色逆光和咧嘴大笑会把脸画圆），所以出视频之前，每张静帧都先和主脸并排看一遍；(2) 全身画面里脸只有几十个像素，每个模型都会画出一张“平均脸”。说话和唱歌的镜头最远框到腰；跳舞用绑脸（`dance bind`），或者从头框到膝盖（`dance o3`）。验脸会给出分数，但最后由人看并排图来定。
- **坐着跳舞。** 一律站着跳。驱动视频要用眼睛挑：站着、正对镜头、表情平静自然、不转圈、没有字幕。模型会照搬舞者的表情，提示词改不了。
- **音乐版权自己负责。** 跳舞视频会保留原曲，`sing/` 换声用的是真实的歌，`finish.py` 你给它什么音乐它就混什么。要公开发的东西，用你有版权的音乐，或者生成原创音乐（`mv/audio.mjs music`）。
- **16:9 还是 9:16。** 生成前就定好；事后再裁会切掉人和字幕。这里默认 16:9（看主播切片的人多数在电脑上看）；跳舞工具内部用 9:16，因为跳舞的人是竖着的。
- **生成画面里的字**会是乱码。画面里别放字；字幕和标题在 `finish.py` 里加。
- **接缝。** 可灵 O3 一次最多出 10 秒；长一点的舞会有接缝，脸或动作可能在接缝处跳一下。要看一看。
- **网络。** fal 和 OpenRouter 在国外；LibTV 和豆包在国内。LibTV 适配器会自动去掉代理变量。
