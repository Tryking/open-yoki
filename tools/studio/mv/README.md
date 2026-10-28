# mv/ — from shots to a finished short or music video

| Tool | What | Service / cost |
| --- | --- | --- |
| `voice.mjs tts` / `batch` | Dialogue lines in your character's voice, with an acting note (`--tone "whispering, a bit shy"`) | Doubao TTS, ~CNY 3 per 10k chars |
| `audio.mjs music` | Original instrumental background music | fal ElevenLabs Music, ~$0.60/min |
| `audio.mjs sfx` | One short sound effect (pop, whoosh, ding ...) | fal, cents |
| `upscale.mjs` | 480p/720p draft → ~1080p | fal Topaz, ~$2.5 per ~30 s |
| `finish.py` | Cut + join clips, captions, title cards, AI label, music cues, sound effects, music ducked under dialogue, -14 LUFS, H.264/AAC | free (ffmpeg + Pillow) |

Lip-synced talking shots come from `shots/gen.mjs` with `via: libtv-omni` (one image + one voice line), or Seedance with `sound: true` (it voices the line itself). For a music video, the song comes from `sing/`.

## finish.py plan

See `plan.example.json` and the header of `finish.py`. All times are on the finished film's timeline. The plan holds `clips` (file, from, to), `subs` (from, to, text), `cards` (title badges), `label`, `music` (file, at, from, dur, vol, fades), `sfx` (file, at, vol), `voice` (extra lines placed at a time), `speed` (e.g. 1.05 to tighten a slow edit without changing pitch).

Editing rules that held up:
- Rough cut with hard cuts first; only add transitions once the story reads. Transitions never fix a face or outfit that changed.
- Every action gets a result and usually a reaction. A shot is too long once nothing changes; it is fine to wait while an expression is still developing.
- Captions: one idea at a time, readable on a phone, never over the face or the key action; on vertical video keep clear of the bottom 15 % and right edge.
- Voice first, then ambience, effects, music. Music sits under dialogue (`duck: true`).
- Finish with `check/clip.mjs cut film.mp4 --goal "..."`. Fix every measured problem first (usually one ffmpeg pass: `loudnorm=I=-14:TP=-1.5` + a short fade at the end).
- Before/after update videos: 30–60 s, every change shown, music + effects, the "before" clip must show an obvious flaw.

## 中文

`voice.mjs` 豆包配音（带语气提示）、`audio.mjs` 原创配乐和音效、`upscale.mjs` 超分、`finish.py` 按计划文件合成成片：剪接、字幕、标题牌、AI 标、配乐、音效、说话时自动压低音乐、响度 -14 LUFS。时间都写成片时间。剪辑经验：先全硬切；每个动作要有结果和反应；字幕一次一个意思、不挡脸；先人声后音乐；成片跑 `check/clip.mjs cut` 修完量出来的问题再发；前后对比视频 30–60 秒，每个改动都要出现，配乐加音效，“改前”要能看出明显毛病。
