# Video tools: after-live clips and the daily update video

[中文说明在下面](#中文说明)

Two tools that cut videos from what your AI host already produced. Nothing here generates video with AI; that lives
in `tools/studio/`.

| tool | what it does |
|---|---|
| [`clips/`](clips/) | After every live: fetch the replay, pick the best moments (LLM or a simple heuristic), cut 16:9 clips with the chat on the left and the host's thoughts on the right, optionally copy them to another folder or server. Runs on a timer. |
| [`update-video/`](update-video/) | A 30-60 s 16:9 "what changed today" video from a JSON storyboard: list of changes, number cards, *before* replay (greyed, red frames on the problem), *after* replay (green), screenshots, an end card. Chinese + English subtitles, a music track per section, sound effects, music ducked under voices, loudness normalised to -14 LUFS. |

## Install

- **ffmpeg** (with libx264; `brew install ffmpeg` / `apt install ffmpeg`), **Python 3.9+**, **rsync** (clips only).
- `pip install -r requirements.txt` (just Pillow). `clips/install.sh` makes a virtualenv in `clips/.venv` for you.
- Optional: `pip install openai-whisper` (clips: lines the show journal up with the replay's audio).

**Fonts.** Text is drawn with Pillow; fonts are looked up in this order (see `common/textdraw.py`):
1. `"fonts": {"zh": "/path/font.ttc", "en": "/path/font.ttf"}` in the storyboard or clips config
   (`{"path": ..., "index": n}` picks a face inside a `.ttc`);
2. any font file in [`fonts/`](fonts/);
3. system fonts: **Noto Sans CJK SC** + **Noto Sans** on Linux (SIL Open Font License; `apt install fonts-noto-cjk fonts-noto-core`),
   then **STHeiti / Hiragino Sans GB** + **Avenir Next** on macOS (system fonts, not redistributed here),
   then Microsoft YaHei / Segoe UI on Windows.

No font files are included in this package.

## Tests

```bash
PYTHON=python3 bash test/run_all.sh
```

Renders the example storyboard from generated solid-colour clips and sine tones, and cuts a generated 150 s
"replay" with a made-up journal. Checks: 30-60 s, 1920x1080, an audio track, about -14 LUFS for the update video;
1920x1080 clips with sound, the reports and the uploaded `offer.json` for the clips. Output goes to
`/tmp/open-yoki-video-test/` (set `VIDEO_TEST_DIR` to change it), never into the package.

---

## clips/: after-live highlights

```
clips/after_live.py      the clipper (pull / make / offer / local)
clips/config.example.json   copy to config.json
clips/run.sh             one locked run for a timer; log in ~/.open-yoki-clips/run.log
clips/install.sh         virtualenv + config.json
clips/scheduler/         install-launchd.sh (macOS) · install-systemd.sh + systemd/*.service|timer (Linux)
```

### Quick start

```bash
cd tools/video/clips
bash install.sh                       # venv + config.json
$EDITOR config.json                   # source, output_dir, picker, upload
.venv/bin/python after_live.py local --replay ~/Downloads/show.mp4 --journal show.jsonl   # try one replay
bash scheduler/install-launchd.sh     # macOS: every 6 h      (Linux: bash scheduler/install-systemd.sh)
```

### Where shows come from

`source.lives` is a folder, local (`/srv/...`) or remote (`user@host:/srv/...`, read with rsync over your own SSH
setup), with one sub-folder per finished show:

```
<lives>/<show id>/
  done.json        written last: "this show is complete" (any JSON)
  detail.json      {"liveStartTime": <ms>, "liveDuration": <ms>, "title": "...", "replayUrl": "<optional mp4/HLS url>"}
  replay.mp4       the recording; if missing, it is downloaded from replayUrl ("replay_download": true)
  show.jsonl       optional, else taken from source.journal
  heart.jsonl      optional, else taken from source.notes
  data-<lang>.png  optional stats-page screenshots (cropped with "panel_crop": [x0, y0, x1, y1, ref_width])
```

Anything that writes this folder works: a script that saves your platform's replay after the show, or a recording
you copy in by hand.

**Show journal** (`show.jsonl`, or `source.journal/<UTC day>.jsonl`): one JSON object per line, `at` in ms or ISO time:

```json
{"at": 1767258020000, "k": "chat", "who": "viewer name", "text": "what they wrote"}
{"at": 1767258017000, "k": "join", "who": "viewer name"}
{"at": 1767258023000, "k": "say", "text": "what the host said", "to": "viewer name", "inner": "optional thought"}
```

`k` is `say` / `blurt` (the host speaking), `chat`, `join`, `thanks` (gifts; `act` says what). **Notes**
(`heart.jsonl`): `{"at": ..., "note": "what she felt"}`. Without a journal, her lines come from Whisper (if installed)
and clips have no chat column.

### Picking

- `"mode": "llm"`: the whole timeline goes to an Anthropic Messages API compatible endpoint (`base_url`, `model`,
  key read from the environment variable named in `api_key_env`; never put the key in the file). The prompt asks for
  3-`max_clips` moments of 12-45 s that show her character (a sharp answer, remembering someone, comforting, a gap
  between what she says and thinks). Add your own wishes in `extra_instructions`. If the call fails, the heuristic runs.
- `"mode": "heuristic"`: no API. Stretches where a viewer wrote and she answered them by name within 90 s, merged,
  12-45 s, most answers first.

The pick is saved in `raw/picks.json`; edit it and run `after_live.py make <id>` to re-cut, or `--repick` to ask again.

### Copying clips elsewhere (`upload`)

With `"upload": {"enabled": true, "dest": "user@host:/var/lib/open-yoki/clips"}`, every show cut in the last
`max_age_hours` goes to `<dest>/<MMDD>/<MMDD>-<NN>.mp4`, then `offer.json` last:

```json
{"show": "<id>", "day": "YYYY-MM-DD", "title": "...", "mins": 95, "at": 1767258000000,
 "items": [{"id": "0101-01", "title": "...", "secs": 24, "why": "...", "chat": ["name：text"], "said": ["..."], "teach": false}]}
```

`offer.json` lists what is in the folder, for whatever picks clips up from there. If another show already sent clips
for the same day, the new one is skipped and logged.

### Timer

`run.sh` takes a lock (a second run while one is going just exits), uses `clips/.venv` if present, and appends to
`~/.open-yoki-clips/run.log`. `scheduler/install-launchd.sh` (macOS LaunchAgent, every 6 h; `--remove` to undo) and
`scheduler/install-systemd.sh` (Linux user timer; `--remove`) install it for the current user, no fixed user names
or paths. macOS: launchd jobs cannot read `~/Desktop`, `~/Documents` or `~/Downloads`; keep the repo and `output_dir`
elsewhere or grant access in Privacy & Security.

---

## update-video/: the daily before / after video

```bash
cd tools/video/update-video
python render.py storyboard.example.json                       # -> out/update.mp4
python render.py my-day.json --assets ~/my-assets --out ~/Videos/today.mp4
python render.py my-day.json --still before@1.5 --out f.png    # one frame, to check a layout in a second
```

Put your media in [`update-video/assets/`](update-video/assets/) (clips, images, music, sfx, voice; nothing is shipped).
A missing music or sound-effect file is skipped with a warning, so you can render before picking music.

### Storyboard

Top level: `output`, `assets_dir` (default `assets`, relative to the storyboard), `fps` (30), `fonts`,
`theme` (`bg`, `accent`, `before`, `after`, `card`, `en` colours), `mix` (`lufs` -14, `true_peak` -1.5, `duck` true,
`voice_gain` 1.6, `duck_threshold`, `duck_ratio`), and `segments`, played in order. Every segment has a unique `id`,
a `type` and `dur` in seconds (`"auto"` = until the last voice line ends, plus `pad`).

| type | fields |
|---|---|
| `title_list` | `title` {zh, en}; `items` [{zh, en}] (slide in one by one, `every` s apart) |
| `number_cards` | `title`; `cards` [{`value`, `decimals`, `prefix`, `unit`, `commas`, `label` {zh, en}, `delta` "+48%"}] (count up); `note` {zh, en} |
| `clip` | `src`, `start` (s into the file), `tone` `before` (greyed, red frame) / `after` (green frame), `grey`, `keep_audio` (true), `volume`, `box` [x, y, w, h] (default 240, 182, 1440, 810) |
| `image` | `src`, `crop` [x0, y0, x1, y1], `scale` or `max_size` [w, h], `position` `left`/`center`, `label` {zh, en}, `list` [{zh, en}] (numbered rows on the right, `list_at`, `every`) |
| `stinger` | `zh`, `en`: one big word between before and after ("改。" / "Fixed.") |
| `end` | `avatar` (image, cut to a circle), `lines` [{zh, en, `style` accent/normal/small}] |

Any segment can also have:

- `banner` {`tag`, `zh`, `en`, `tone`}: the title bar on top ("改前 Before", "改后 After", "新 New");
- `callouts` [{`at`, `x`, `y`, `w`, `tone`, `lines` [{zh, en}], `highlight`}]: boxes that slide in;
- `marks` [{`at`, `until`, `box` [x0, y0, x1, y1] as 0-1 fractions of the clip/image, `label`, `tone`}]: frames on the problem;
- `subs` [{`at`, `until`, `zh`, `en`}]: subtitles (leave `zh` empty when the clip already shows Chinese captions);
- `footer` {zh, en}: small source line bottom-left;
- `voice` [{`file`, `at`, `vol`, `tempo`}]: voice-over lines (`tempo` 0.5-2 speeds them up or down);
- `music` {`file`, `ss` (start inside the track), `vol`, `fade_in`, `fade_out`, `delay`}: starts a new track at this
  segment and plays until the next segment that has a `music` key (`"music": null` = silence from there);
- `sfx` [{`file`, `at`, `vol`, `repeat`, `every`}]: sound effects, times relative to the segment.

How the sound is mixed: each segment's own sound (clip audio + voices) is the voice bus; it is high-passed and
lightly compressed, and pushes the music down whenever it is loud (sidechain). Music + voices + effects are then
normalised to `mix.lufs`.

**Recipe that works:** what changed (`title_list`, 3 s) → numbers (`number_cards`, 4 s) → before (`clip`, tone
before, sad music, error sounds) → `stinger` with a hit → after (`clip`, tone after, upbeat music) → new features
(`image` with a `list`, voice-over) → `end`. 30-60 s in total, every change shown on screen, each section with its
own music. Before clips should show an obvious problem: mark it with `marks`.

---

## 中文说明

这里两个工具都是“剪现成的东西”，不用 AI 生成画面（AI 出视频在 `tools/studio/`）。

**装什么**：ffmpeg、Python 3.9+、Pillow（`pip install -r requirements.txt`）；下播片段还要 rsync。可选：
openai-whisper（让台词时间和回放对齐）。字体不附带：Linux 装
`fonts-noto-cjk`（思源黑体/Noto Sans CJK，开源 OFL 协议），macOS 自动用系统的华文黑体和 Avenir Next，也可以把字体放进 `fonts/`。

**下播自动剪片段（clips/）**

1. `bash clips/install.sh`，然后改 `clips/config.json`：回放从哪来（`source.lives`，本机目录或 `用户@服务器:/路径`）、
   片段放哪（`output_dir`）、怎么挑（`picker`：`llm` 用 Anthropic 兼容接口，钥匙放环境变量；`heuristic` 不用接口，
   按“观众说话、她点名回”挑）、要不要复制到别的目录或服务器（`upload`）。
2. 先试一场：`.venv/bin/python after_live.py local --replay 回放.mp4 --journal show.jsonl`。
3. 定时跑：macOS `bash clips/scheduler/install-launchd.sh`，Linux `bash clips/scheduler/install-systemd.sh`，都是每 6 小时一次，`--remove` 卸载。
4. 回放目录怎么来：任何能在下播后把回放和直播信息存成上面那种文件夹的脚本都行，手动放进去也行，本机的定时任务就会拉下来剪。

每场出：`01_标题.mp4`（16:9，中间回放，左边弹幕，右边她心里想的）、`_vertical.mp4` 竖屏原片、`chat.md`（每条弹幕她回没回、多快）、`README.md`（为什么挑）。
挑得不满意就改 `raw/picks.json` 再 `after_live.py make <id>`。发之前看一眼有没有要遮的观众名字。

**每天的改前/改后视频（update-video/）**

1. 素材放进 `update-video/assets/` 对应文件夹（回放片段、截图、配乐、音效、配音），包里不带任何素材。
2. 复制 `storyboard.example.json` 改成今天的内容：每一段写类型（标题列表 / 数字卡 / 回放片段+标注 / 截图 / 结尾），
   中英字幕，配乐文件和从第几秒开始，音效时间点。上表列了全部字段。
3. `python render.py 你的.json` 出片；想先看某一帧：`--still 段名@秒数 --out 预览.png`。
4. 做法：改前片段自动灰调加红框，`marks` 框出毛病；改后片段绿框；每段可以换配乐，人声出来时音乐自动压低，最后整体响度 -14 LUFS。总长 30-60 秒，16:9。

**测试**：`PYTHON=python3 bash test/run_all.sh`，用纯色画面和正弦音自己生成素材，跑完两个工具并检查时长、16:9、有声音，产物放在 /tmp/open-yoki-video-test/，不进包。
