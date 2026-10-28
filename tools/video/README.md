# 视频工具：下播片段和每天的更新视频

这里两个工具都是拿主播已经做出来的东西来剪视频，不用 AI 生成画面（AI 出视频在 `tools/studio/`）。

| 工具 | 做什么 |
|---|---|
| [`clips/`](clips/) | 每场直播结束后：拿到回放，挑出最好的几段（用大模型挑，或者用简单的规则挑），剪成 16:9 片段，左边是弹幕，右边是她心里想的；可以顺手复制到别的文件夹或服务器。定时自动跑。 |
| [`update-video/`](update-video/) | 按一份 JSON 分镜，做一条 30-60 秒、16:9 的“今天改了什么”视频：改动列表、数字卡、*改前* 回放（灰调，毛病处加红框）、*改后* 回放（绿框）、截图、结尾卡。中英双字幕，每段一首配乐，有音效，人声出来时音乐自动压低，整体响度统一到 -14 LUFS。 |

## 安装

- **ffmpeg**（要带 libx264；`brew install ffmpeg` / `apt install ffmpeg`）、**Python 3.9+**、**rsync**（只有剪片段要用）。
- `pip install -r requirements.txt`（只有 Pillow）。`clips/install.sh` 会帮你在 `clips/.venv` 建好虚拟环境。
- 可选：`pip install openai-whisper`（剪片段时，用来把直播记录和回放里的声音对齐）。

**字体。** 字是用 Pillow 画上去的，按下面的顺序找字体（见 `common/textdraw.py`）：
1. 分镜或片段配置里的 `"fonts": {"zh": "/path/font.ttc", "en": "/path/font.ttf"}`
   （用 `{"path": ..., "index": n}` 可以选 `.ttc` 里的某一款）；
2. [`fonts/`](fonts/) 里的任何字体文件；
3. 系统字体：Linux 上用 **Noto Sans CJK SC** + **Noto Sans**（SIL Open Font License；`apt install fonts-noto-cjk fonts-noto-core`），
   其次是 macOS 上的 **STHeiti / Hiragino Sans GB**（华文黑体 / 冬青黑体）+ **Avenir Next**（系统自带字体，这里不附带分发），
   再其次是 Windows 上的 Microsoft YaHei / Segoe UI。

这个包里不带任何字体文件。

## 测试

```bash
PYTHON=python3 bash test/run_all.sh
```

它自己生成纯色画面和正弦音当素材，渲染示例分镜；再生成一段 150 秒的“回放”，配一份编出来的直播记录，拿去剪片段。检查的内容：更新视频是 30-60 秒、1920x1080、有音轨、响度约 -14 LUFS；片段是 1920x1080、有声音，报告和上传的 `offer.json` 都在。产物放在 `/tmp/open-yoki-video-test/`（想换位置就设 `VIDEO_TEST_DIR`），不会写进包里。

---

## clips/：下播自动剪片段

```
clips/after_live.py      剪片段的主程序（pull / make / offer / local）
clips/config.example.json   复制成 config.json
clips/run.sh             给定时任务用，同一时间只跑一个；日志在 ~/.open-yoki-clips/run.log
clips/install.sh         建虚拟环境 + config.json
clips/scheduler/         install-launchd.sh（macOS）· install-systemd.sh + systemd/*.service|timer（Linux）
```

### 快速上手

```bash
cd tools/video/clips
bash install.sh                       # 虚拟环境 + config.json
$EDITOR config.json                   # 回放从哪来（source）、片段放哪（output_dir）、怎么挑（picker）、要不要复制出去（upload）
.venv/bin/python after_live.py local --replay ~/Downloads/show.mp4 --journal show.jsonl   # 先拿一场回放试试
bash scheduler/install-launchd.sh     # macOS：每 6 小时一次      （Linux：bash scheduler/install-systemd.sh）
```

### 回放从哪来

`source.lives` 是一个文件夹，可以在本机（`/srv/...`），也可以在别的服务器（`user@host:/srv/...`，用 rsync 走你自己配好的 SSH 去读）。每场播完的直播在里面占一个子文件夹：

```
<lives>/<show id>/
  done.json        最后写：表示“这场已经完整了”（内容随便，是 JSON 就行）
  detail.json      {"liveStartTime": <ms>, "liveDuration": <ms>, "title": "...", "replayUrl": "<optional mp4/HLS url>"}
  replay.mp4       录像；没有的话就从 replayUrl 下载（"replay_download": true）
  show.jsonl       可选，没有就从 source.journal 取
  heart.jsonl      可选，没有就从 source.notes 取
  data-<lang>.png  可选，数据页截图（用 "panel_crop": [x0, y0, x1, y1, ref_width] 裁剪）
```

谁来写这个文件夹都行：下播后把平台回放存下来的脚本可以，手动把录像拷进去也可以。

**直播记录**（`show.jsonl`，或 `source.journal/<UTC day>.jsonl`）：一行一个 JSON 对象，`at` 用毫秒或 ISO 时间：

```json
{"at": 1767258020000, "k": "chat", "who": "viewer name", "text": "what they wrote"}
{"at": 1767258017000, "k": "join", "who": "viewer name"}
{"at": 1767258023000, "k": "say", "text": "what the host said", "to": "viewer name", "inner": "optional thought"}
```

`k` 可以是 `say` / `blurt`（主播说话）、`chat`（弹幕）、`join`（进场）、`thanks`（礼物；`act` 写送了什么）。**心里话**（`heart.jsonl`）：`{"at": ..., "note": "what she felt"}`。没有直播记录时，她说的话从 Whisper 转写出来（前提是装了），片段里也就没有弹幕那一栏。

### 怎么挑

- `"mode": "llm"`：把整条时间线交给一个兼容 Anthropic Messages API 的接口（`base_url`、`model`；钥匙从 `api_key_env` 里写的那个环境变量读，不要把钥匙写进文件）。提示词让它挑 3 到 `max_clips` 段、每段 12-45 秒、能看出她性格的时刻（回得很妙、记得某个人、安慰人、嘴上说的和心里想的不一样）。你自己的要求写在 `extra_instructions`。接口调用失败时，改用下面的规则挑。
- `"mode": "heuristic"`：不用接口。找观众说了话、她在 90 秒内点名回了的那几段，合并起来，每段 12-45 秒，回得多的排前面。

挑出来的结果存在 `raw/picks.json`。挑得不满意就改这个文件，再跑 `after_live.py make <id>` 重剪；或者用 `--repick` 让它重新挑。

每场出：`01_标题.mp4`（16:9，中间回放，左边弹幕，右边她心里想的）、`_vertical.mp4` 竖屏原片、`chat.md`（每条弹幕她回没回、多快）、`README.md`（为什么挑这段）。发之前看一眼有没有要遮的观众名字。

### 把片段复制到别处（`upload`）

设了 `"upload": {"enabled": true, "dest": "user@host:/var/lib/open-yoki/clips"}` 之后，最近 `max_age_hours` 小时内剪好的每一场，都会放到 `<dest>/<MMDD>/<MMDD>-<NN>.mp4`，最后再放 `offer.json`：

```json
{"show": "<id>", "day": "YYYY-MM-DD", "title": "...", "mins": 95, "at": 1767258000000,
 "items": [{"id": "0101-01", "title": "...", "secs": 24, "why": "...", "chat": ["name：text"], "said": ["..."], "teach": false}]}
```

`offer.json` 列出这个文件夹里有什么，给从那里取片段的程序看。如果同一天已经有别的场次送过片段，新的这场会跳过，并记进日志。

### 定时

`run.sh` 会先加锁（上一次还没跑完时，再启动一次会直接退出），有 `clips/.venv` 就用它，日志接在 `~/.open-yoki-clips/run.log` 后面。`scheduler/install-launchd.sh`（macOS LaunchAgent，每 6 小时一次；`--remove` 卸载）和 `scheduler/install-systemd.sh`（Linux 用户级定时器；`--remove` 卸载）都是给当前用户装的，不写死用户名或路径。macOS 注意：launchd 任务读不了 `~/Desktop`、`~/Documents` 和 `~/Downloads`；把代码和 `output_dir` 放到别的地方，或者在“隐私与安全性”里给它权限。

---

## update-video/：每天的改前/改后视频

```bash
cd tools/video/update-video
python render.py storyboard.example.json                       # -> out/update.mp4
python render.py my-day.json --assets ~/my-assets --out ~/Videos/today.mp4
python render.py my-day.json --still before@1.5 --out f.png    # 只出一帧，几秒钟就能看排版对不对
```

素材放进 [`update-video/assets/`](update-video/assets/)（回放片段、图片、配乐、音效、配音；包里不带任何素材）。缺了配乐或音效文件只会警告并跳过，所以还没挑好音乐也能先出片。

### 分镜

最外层：`output`、`assets_dir`（默认 `assets`，相对分镜文件所在位置）、`fps`（30）、`fonts`、`theme`（`bg`、`accent`、`before`、`after`、`card`、`en` 这几种颜色）、`mix`（`lufs` -14、`true_peak` -1.5、`duck` true、`voice_gain` 1.6、`duck_threshold`、`duck_ratio`），以及 `segments`（按顺序播放的各段）。每一段都要有不重复的 `id`、一个 `type`，和以秒为单位的 `dur`（写 `"auto"` 表示到最后一句配音结束为止，再加 `pad`）。

| 类型 | 字段 |
|---|---|
| `title_list` | `title` {zh, en}；`items` [{zh, en}]（一条一条滑进来，间隔 `every` 秒） |
| `number_cards` | `title`；`cards` [{`value`, `decimals`, `prefix`, `unit`, `commas`, `label` {zh, en}, `delta` "+48%"}]（数字从小往上跳）；`note` {zh, en} |
| `clip` | `src`、`start`（从文件第几秒开始）、`tone` 填 `before`（灰调，红框）或 `after`（绿框）、`grey`、`keep_audio`（true）、`volume`、`box` [x, y, w, h]（默认 240, 182, 1440, 810） |
| `image` | `src`、`crop` [x0, y0, x1, y1]、`scale` 或 `max_size` [w, h]、`position` `left`/`center`、`label` {zh, en}、`list` [{zh, en}]（右边带编号的几行，配 `list_at`、`every`） |
| `stinger` | `zh`、`en`：改前和改后之间的一个大字（"改。" / "Fixed."） |
| `end` | `avatar`（图片，裁成圆形）、`lines` [{zh, en, `style` accent/normal/small}] |

任何一段还可以加：

- `banner` {`tag`, `zh`, `en`, `tone`}：顶上的标题栏（"改前 Before"、"改后 After"、"新 New"）；
- `callouts` [{`at`, `x`, `y`, `w`, `tone`, `lines` [{zh, en}], `highlight`}]：滑进来的说明框；
- `marks` [{`at`, `until`, `box` [x0, y0, x1, y1] 按片段/图片的 0-1 比例, `label`, `tone`}]：框出毛病的地方；
- `subs` [{`at`, `until`, `zh`, `en`}]：字幕（片段里本来就有中文字幕时，`zh` 留空）；
- `footer` {zh, en}：左下角一行小字，写来源；
- `voice` [{`file`, `at`, `vol`, `tempo`}]：配音（`tempo` 填 0.5-2，调快或调慢）；
- `music` {`file`, `ss`（从这首歌第几秒开始）, `vol`, `fade_in`, `fade_out`, `delay`}：从这一段开始换一首配乐，一直放到下一个带 `music` 的段（写 `"music": null` 表示从这里开始没有音乐）；
- `sfx` [{`file`, `at`, `vol`, `repeat`, `every`}]：音效，时间从这一段开头算。

声音怎么混：每段自己的声音（片段原声 + 配音）算作人声，先切掉低频、轻轻压缩一下；人声一大，音乐就自动压低（侧链压缩）。最后把音乐、人声、音效合在一起，响度统一到 `mix.lufs`。

**好用的套路：** 改了什么（`title_list`，3 秒）→ 数字（`number_cards`，4 秒）→ 改前（`clip`，tone 填 before，配伤感音乐和报错音效）→ 一个 `stinger` 配一声重音 → 改后（`clip`，tone 填 after，配欢快音乐）→ 新功能（带 `list` 的 `image`，配音）→ `end`。总长 30-60 秒，每个改动都要在画面上看得到，每段配自己的音乐。改前片段要能看出明显的毛病，用 `marks` 框出来。
