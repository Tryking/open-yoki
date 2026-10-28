# sing/ — your character singing

Main route is **local and free**: take a real recording of the song, split off the vocal, convert the singer's timbre into your character's voice with Seed-VC, mix it back over the original backing track. Melody, rhythm and diction come from the original singer, so it stays in tune.

```bash
bash tools/studio/sing/setup.sh                                  # once: Seed-VC + demucs in ~/seed-vc
bash tools/studio/sing/separate.sh song.mp3 work/sing 66.5 92    # vocals.wav + no_vocals.wav for the chorus
# target voice: 10-30 s of your character speaking (e.g. a TTS line: node tools/studio/mv/voice.mjs tts ...)
bash tools/studio/sing/svc.sh work/sing/vocals.wav voice/speaking-ref.wav work/sing/take1.wav 50 0.7 0
python3 tools/studio/sing/mix.py --vocal work/sing/take1.wav --inst work/sing/no_vocals.wav --match work/sing/vocals.wav --out work/sing/take1.mp3
~/seed-vc/.venv/bin/python tools/studio/sing/score.py work/sing/vocals.wav voice/speaking-ref.wav work/sing/take*.wav
node tools/studio/sing/judge.mjs --ref voice/speaking-ref.wav work/sing/take1.mp3 work/sing/take2.mp3   # optional blind listen
```

Make several takes (different `steps`, `cfg`, a semitone shift, different reference clips), score them, then listen to the top two yourself.

| Script | What | Cost |
| --- | --- | --- |
| `setup.sh` | Seed-VC + demucs into `$SEEDVC_DIR` (default `~/seed-vc`) | free, ~2 GB models |
| `separate.sh` | demucs `htdemucs_ft` vocal / backing split, optional time range | free |
| `svc.sh` | Seed-VC singing conversion (f0-conditioned, 44 kHz) | free, ~10 s per 25 s clip on Apple Silicon |
| `rvc.sh` | RVC via Applio, if you trained a voice model | free |
| `mix.py` | level-match, EQ, de-ess, light reverb, -14 LUFS / -1 dBTP | free (ffmpeg only) |
| `score.py` | pitch accuracy vs the original + voice similarity to the target | free |
| `matcheq.py` | match the long-term spectrum to the speaking reference (fixes thin / nasal) | free |
| `judge.mjs` | blind audio-model ranking, shuffled each round | OpenRouter, cents |
| `cloud.mjs` | fal: new song with your lyrics (MiniMax v2), cover over a reference melody, lyric swap (ACE-Step), Mureka, speech-to-speech | $0.01–0.15 per call |

## What we measured

- Seed-VC on a 25 s chorus: pitch within 0.8 semitone of the original on ~91 % of voiced frames; blind audio-model score ~5.5/10 vs 7 for the original singer; voice similarity to the target ~0.6 (the same person speaking twice scores ~0.86–0.90). It sounds like "a singer who resembles your character", not like your character singing.
- Fine-tuning Seed-VC or training RVC on **TTS speech** of the target voice did **not** beat the base model (blind scores 5.0 / 4.2 / 3.4 vs 5.3). To do better you need 5–10 minutes of the real person singing a cappella, trained locally.
- Typical flaws: slightly thin or nasal tone (try `matcheq.py`), a little metallic sheen on long notes, and **backing vocals in the stem get converted too**. Mute ad-libs in `vocals.wav` before converting.
- Speech-to-speech (`cloud.mjs sts`) plus pitch correction was less clear than Seed-VC for singing.
- Mac notes: run with `PYTORCH_ENABLE_MPS_FALLBACK=1` (svc.sh does). If you hit a float64 error on MPS, cast the F0 tensor to float32 in Seed-VC's inference; if saving fails, write the output with `soundfile`.

Music rights: converting a commercial song is your responsibility. For anything public, check the license of the song and backing track.

## 中文

唱歌主路线在本机免费跑：原曲用 demucs 拆出人声和伴奏 → Seed-VC 把原唱的音色换成你角色的声音（旋律、节奏、咬字都跟原唱，所以不跑调）→ `mix.py` 对齐电平、EQ、去齿音、轻混响、响度 -14 LUFS → `score.py` 量音准和像不像 → 自己听前两名。实测：音准约 91% 帧在 0.8 个半音内，盲评约 5.5/10（原唱 7），声纹像目标声音约 0.6，听起来是“像她的歌手”，还不是“她在唱”；拿 TTS 语料微调 Seed-VC 或训练 RVC 都没超过底模，想更像要本人 5–10 分钟无伴奏清唱在本机训练。坑：伴唱也会被换声（先静音）、音色偏薄偏鼻（试 `matcheq.py`）。云端可选：fal 上 MiniMax 写歌/翻唱、ACE-Step 换词、Mureka、Chatterbox 换声。音乐版权自负。
