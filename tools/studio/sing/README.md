# sing/：让你的角色唱歌

主路线**在本机跑、免费**：拿一首歌的真实录音，把人声拆出来，用 Seed-VC 把原唱的音色换成你角色的声音，再混回原来的伴奏上。旋律、节奏和咬字都来自原唱，所以不会跑调。

```bash
bash tools/studio/sing/setup.sh                                  # 只跑一次：把 Seed-VC 和 demucs 装到 ~/seed-vc
bash tools/studio/sing/separate.sh song.mp3 work/sing 66.5 92    # 拆出副歌这一段的 vocals.wav + no_vocals.wav
# 目标声音：你角色 10-30 秒的说话录音（比如一句 TTS：node tools/studio/mv/voice.mjs tts ...）
bash tools/studio/sing/svc.sh work/sing/vocals.wav voice/speaking-ref.wav work/sing/take1.wav 50 0.7 0
python3 tools/studio/sing/mix.py --vocal work/sing/take1.wav --inst work/sing/no_vocals.wav --match work/sing/vocals.wav --out work/sing/take1.mp3
~/seed-vc/.venv/bin/python tools/studio/sing/score.py work/sing/vocals.wav voice/speaking-ref.wav work/sing/take*.wav
node tools/studio/sing/judge.mjs --ref voice/speaking-ref.wav work/sing/take1.mp3 work/sing/take2.mp3   # 可选：盲听
```

多做几版（换不同的 `steps`、`cfg`，升降一个半音，换参考片段），打分，再自己听排前两名的。

| 脚本 | 做什么 | 花费 |
| --- | --- | --- |
| `setup.sh` | 把 Seed-VC + demucs 装进 `$SEEDVC_DIR`（默认 `~/seed-vc`） | 免费，模型约 2 GB |
| `separate.sh` | 用 demucs `htdemucs_ft` 拆开人声 / 伴奏，可以指定时间段 | 免费 |
| `svc.sh` | Seed-VC 唱歌换声（带 f0 条件，44 kHz） | 免费，Apple Silicon 上 25 秒片段约 10 秒 |
| `rvc.sh` | 通过 Applio 用 RVC，前提是你训练过声音模型 | 免费 |
| `mix.py` | 对齐电平、EQ、去齿音、轻混响、-14 LUFS / -1 dBTP | 免费（只要 ffmpeg） |
| `score.py` | 和原唱比音准 + 和目标声音比像不像 | 免费 |
| `matcheq.py` | 把整体频谱对齐到说话参考（治声音发薄 / 发鼻） | 免费 |
| `judge.mjs` | 让音频模型盲排名，每轮都打乱顺序 | OpenRouter，几美分 |
| `cloud.mjs` | fal：用你的歌词写新歌（MiniMax v2）、按参考旋律翻唱、换歌词（ACE-Step）、Mureka、语音转语音换声（Chatterbox） | 每次 $0.01–0.15 |

## 我们实测的结果

- Seed-VC 处理一段 25 秒的副歌：约 91% 的有声帧，音高和原唱相差在 0.8 个半音以内；音频模型盲评约 5.5/10，原唱是 7；和目标声音的相似度约 0.6（同一个人说两次话约 0.86–0.90）。听起来像“一个声音有点像你角色的歌手”，不像你的角色本人在唱。
- 拿目标声音的 **TTS 语音**去微调 Seed-VC 或训练 RVC，**没有**超过底模（盲评 5.0 / 4.2 / 3.4，底模 5.3）。想更好，需要真人 5–10 分钟的无伴奏清唱，在本机训练。
- 常见毛病：音色有点薄或者发鼻（试试 `matcheq.py`），长音上有一点金属感，还有**人声轨里的伴唱也会被一起换声**。换声前，先把 `vocals.wav` 里的即兴伴唱静音。
- 唱歌时，语音转语音（`cloud.mjs sts`）加修音，效果没有 Seed-VC 清楚。
- Mac 上要注意：用 `PYTORCH_ENABLE_MPS_FALLBACK=1` 跑（svc.sh 已经设好了）。如果在 MPS 上碰到 float64 报错，就在 Seed-VC 的推理代码里把 F0 张量转成 float32；如果保存失败，就用 `soundfile` 写出结果。

音乐版权：转换商业歌曲的责任在你。要公开发的东西，先查清楚歌和伴奏的授权。
