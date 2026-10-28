# distill-prep：真人主播蒸馏素材 / distill prep

```sh
python3 prep.py talk.mp4 --code c1 --start 00:20:00 --dur 150 --every 2 --out study --who "某主播" \
  --asr 'whisper "$AUDIO" --model small --language zh --output_format txt --output_dir /tmp/asr >/dev/null && cat /tmp/asr/audio.txt'
python3 prep.py talk2.mp4 --code c2 --start 00:05:00 --dur 120 --out study
python3 selftest.py
```

每段素材出：低清片段、每 N 秒一帧的 6×6 编号拼图（`frames.txt` 写着第几帧是第几秒）、音频、转写（可选），所有片段共用一份 `notes.md` 模板（说话层、肢体层、对到自己的动作库、建议、待定的改动）。素材只放本机，不进仓库。方法见手册第 7 节。

English: cut a clip, make numbered frame grids every N seconds, extract audio, optionally transcribe, and add a notes template for the distilling method (manual section 7). Keep the material local.
