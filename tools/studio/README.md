# Studio — make your own videos of your digital human

Give it one photo of your character. It helps you make test shots and outfits, dance clips, short films, music videos and songs in the character's voice, and it checks every result for **face drift** (the character slowly turning into someone else).

Every paid service is an optional adapter. Keys go in `.env`; with no key, a tool tells you which service it needs and where to sign up. Add `--dry-run` to see the exact prompt, references and cost before spending anything.

> Editing existing live-stream recordings into clips lives in `tools/video/`. This folder is about **making new footage**.

| Folder | What you get |
| --- | --- |
| `character/` | One folder per character: master face, looks, `character.json`, offline validator |
| `look/` | Test shots for new looks, turnaround sheets, outfit swaps, style packs, 3/4 side faces |
| `shots/` | Storyboard → offline rule check → model-written shot cards → one generation job per shot → clips (Seedance / Kling O3 / OmniHuman lip-sync / any fal model) |
| `dance/` | Your character performing a dance video: face-bound motion transfer (default), Kling O3 multi-reference, Viggle |
| `sing/` | Your character singing a real song: local Seed-VC conversion (free) + mixing + scoring; cloud songwriting/cover options |
| `mv/` | Voice lines (TTS), music, sound effects, upscaling, and `finish.py` that cuts the final film with captions and a proper mix |
| `check/` | Face check (side-by-side with the master face + calibrated score), per-shot card check, pre-publish film check |
| `selftest/` | `node selftest/run.mjs` — offline tests with generated fake media; no keys, no network |

## Requirements

- Node.js 20+ (built-in `fetch`; for an HTTP proxy use Node 24+ with `NODE_USE_ENV_PROXY=1`)
- ffmpeg / ffprobe on PATH
- Python 3.9+ with Pillow (`pip install pillow`) for captions in `mv/finish.py`
- Optional, for local singing: Python 3.10 and ~2 GB disk (`sing/setup.sh`)

```bash
cp tools/studio/.env.example tools/studio/.env   # fill only what you use
node tools/studio/selftest/run.mjs               # everything offline should pass
```

## From one photo to a 30-second short (worked example)

Commands run from the repository root. `my-char` is your character folder.

```bash
# 1. Character: copy the sample, drop your photo in as face.png, check it
cp -r tools/studio/character/example my-char
node tools/studio/character/validate.mjs my-char

# 2. Looks: three directions, pick one, save it as my-char/looks/daily.png; then a turnaround and two side faces
node tools/studio/look/look.mjs explore my-char "fresh everyday streamer, cream knit sweater" --n 3
node tools/studio/look/look.mjs sheet my-char daily
node tools/studio/look/look.mjs sides my-char          # list the results under "sides" in character.json
node tools/studio/check/face.mjs my-char my-char/looks/daily.png --offline   # look at it next to the master face

# 3. Storyboard: edit tools/studio/shots/storyboard.example.json (6 shots, 30 s), then check it
node tools/studio/shots/card.mjs rules tools/studio/shots/storyboard.example.json
node tools/studio/shots/card.mjs lint  tools/studio/shots/storyboard.example.json      # writes ...cards.json
node tools/studio/shots/card.mjs jobs  tools/studio/shots/storyboard.example.json --char my-char

# 4. Voice for the talking shots, then generate every shot (dry run first)
node tools/studio/mv/voice.mjs tts studio-out/vo/hello.wav "Hi, I'm Mika. This is my very first stream!" --char my-char --tone "excited, a little nervous"
node tools/studio/shots/gen.mjs studio-out/jobs/01-lights-on.json --dry-run
node tools/studio/shots/gen.mjs studio-out/jobs/01-lights-on.json
#    (shot 2 is lip-sync: set "audio": ["<path to hello.wav>"] in its job, via libtv-omni)

# 5. The dance shot: a 6 s clip of a trending dance, standing, facing camera
node tools/studio/dance/dance.mjs driver dance.mp4
node tools/studio/dance/dance.mjs bind my-char stage dance.mp4          # auto face check at the end

# 6. Check each clip against its card, re-roll failures once
node tools/studio/check/clip.mjs check studio-out/shots/01-lights-on/video.mp4 tools/studio/shots/storyboard.example.cards.json --shot 1

# 7. Music + effects, then the final cut
node tools/studio/mv/audio.mjs music studio-out/audio/bgm.mp3 30 "light upbeat lo-fi pop, warm, playful"
node tools/studio/mv/audio.mjs sfx studio-out/audio/pop.mp3 1 "soft cartoon pop"
python3 tools/studio/mv/finish.py tools/studio/mv/plan.example.json
node tools/studio/check/clip.mjs cut studio-out/mika-first-stream.mp4 --goal "Mika goes live for the first time and chat loves it"
```

## What it costs (rough, at the time of writing)

| Step in the example | Service | Cost |
| --- | --- | --- |
| 3 test looks + 1 sheet + 2 side faces | fal nano-banana-pro edit (~$0.15/image) | ~$0.90 |
| 5 shots × ~5 s Seedance, plus re-rolls | fal Seedance (~$0.22/s draft) | ~$6–10 |
| 1 lip-sync shot | LibTV OmniHuman | LibTV credits |
| 6 s dance, face-bound | fal Kling 3.0 motion control ($0.168/s pro) | ~$1.0 |
| 2 voice lines | Doubao TTS (~CNY 3 per 10k chars) | < $0.01 |
| 30 s music + 2 effects | fal ElevenLabs | ~$0.35 |
| storyboard lint, clip checks, face checks, final check | OpenRouter (Gemini Flash) | ~$0.10 |
| **Total** | | **~$9–13 + LibTV credits** |

| Service | Sign up | Used for |
| --- | --- | --- |
| fal.ai | fal.ai/dashboard/keys | images, Seedance, Kling motion control, music, effects, upscaling, cloud singing |
| OpenRouter | openrouter.ai/settings/keys | all checks, storyboard cards, finding faces |
| Volcengine Doubao TTS | console.volcengine.com/speech/app | voice lines; voice cloning is done in that console |
| LibTV | liblib.tv (command-line client) | Kling O3 multi-reference, OmniHuman lip-sync |
| Viggle | viggle.ai | quick dance character swap |
| Volcengine Ark | console.volcengine.com/ark | Seedance direct (experimental) |
| Seed-VC / Applio | GitHub, local | singing voice conversion, free |

Prices change; `--dry-run` prints the current estimate the tool uses, and every paid call appends a line to `spend.jsonl` in its output folder.

## Common pitfalls

- **Face drift.** Two causes: (1) the first still is already off (warm backlight and wide laughs round the face), so check every still next to the master face before animating; (2) in full-body frames the face is a few dozen pixels and every model paints an "average face". Frame talking and singing shots waist-up or closer; for dances use face binding (`dance bind`) or crop head-to-knees (`dance o3`). The face check gives a score, but a human looking at the side-by-side decides.
- **Dancing seated.** Always dance standing. Pick the driving video by eye: standing, facing camera, calm natural expression, no spins, no subtitles. The model copies the dancer's expressions; the prompt does not override them.
- **Music rights are yours.** Dance videos keep the original track, `sing/` converts real songs, `finish.py` mixes whatever you give it. For anything public, use music you have the rights to, or generate original music (`mv/audio.mjs music`).
- **16:9 vs 9:16.** Decide before generating; cropping later cuts people and captions. Default here is 16:9 (most viewers of streamer clips watch on desktop); dance tools work in 9:16 internally because dancers are vertical.
- **Text in generated frames** comes out garbled. Keep frames text-free; add captions and titles in `finish.py`.
- **Seams.** Kling O3 does 10 s per call; long dances get seams where the face or move can jump. Watch them.
- **Network.** fal and OpenRouter are outside mainland China; LibTV and Doubao are inside. The LibTV adapter strips proxy variables automatically.

---

# Studio（中文）

给一张角色照片，就能自己出视频：定妆照和换装、跳舞片、短片、MV、用角色的声音唱歌，每一步都检查**脸有没有走样**。剪现成直播回放在 `tools/video/`，这里只管“做新的画面”。

所有付费服务都是可选适配：钥匙放 `tools/studio/.env`（照 `.env.example` 抄），没配的服务工具会提示要哪个钥匙、在哪开号；每个付费命令都能加 `--dry-run`，只打印提示词、参考图顺序和花费。

| 文件夹 | 能做什么 |
| --- | --- |
| `character/` | 一个角色一个文件夹：主脸、造型、`character.json`，离线校验 |
| `look/` | 探造型方向、定妆照、只换衣服、风格包、从主脸做 3/4 侧脸 |
| `shots/` | 分镜 → 离线规则检查 → 模型改写镜头任务卡 → 每个镜头一个任务 → 出镜头（Seedance / 可灵 O3 / OmniHuman 对口型 / 任意 fal 模型） |
| `dance/` | 换人跳舞：绑脸动作迁移（默认）、可灵 O3 多参考、Viggle |
| `sing/` | 唱歌：本机 Seed-VC 换声（免费）+ 混音 + 打分；云端写歌/翻唱可选 |
| `mv/` | 配音、配乐、音效、超分，`finish.py` 合成成片（字幕、标题牌、配乐压人声、响度） |
| `check/` | 验脸（和主脸并排 + 按人判过的样例打分）、按卡验片、发布前成片检查 |
| `selftest/` | `node selftest/run.mjs` 离线自检，用假素材，不要钥匙不联网 |

**从一张照片到 30 秒短片**：复制样例角色放主脸 → 校验 → 出 3 个造型方向挑一个 → 定妆照和侧脸 → 和主脸并排看 → 写 6 个镜头的分镜 → `rules` 离线挑毛病、`lint` 出任务卡 → `jobs` 生成任务 → 配音 → 先 `--dry-run` 再出每个镜头（说话镜头用对口型）→ 跳舞镜头 `dance bind` → 每段按卡验片 → 配乐音效 → `finish.py` 合成 → `check/clip.mjs cut` 发布前检查。命令见上面英文部分。示例整片大约 9–13 美元加 LibTV 积分。

**常见坑**
- **脸漂**：一是起始静帧就变了（暖逆光、露牙大笑会把脸画圆），每张静帧先和主脸并排看再出视频；二是全身远景脸只有几十像素，模型都会画成“平均脸”，说话/唱歌镜头最远到腰，跳舞用绑脸或框到膝盖。验脸分数只是辅助，人看对比图定。
- **跳舞要站着**：坐着跳像出错。选驱动视频比写提示词重要：站着、正对镜头、表情自然、不转圈、没字幕；模型会照搬原舞者表情。
- **音乐版权自负**：跳舞保留原舞曲、唱歌换声用的是现成歌、合成时用的音乐，都要自己确认能不能公开用；不确定就用 `mv/audio.mjs music` 生成原创配乐。
- **横竖屏**：开工前定，后裁会切掉人和字幕。这里默认 16:9（看主播切片的人多在电脑上），跳舞工具内部用 9:16。
- 模型画的字会乱，画面里不让它写字，字幕后期加；可灵 O3 一段最长 10 秒，长舞有接缝要看；fal、OpenRouter 在国外，LibTV、豆包在国内，LibTV 适配会自动去掉代理变量。
